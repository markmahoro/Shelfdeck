'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');
const { inspectTemporaryStorage } = require('./formation-reset-storage');
const { fileDigest } = require('./formation-reset-generation');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function contained(root, value) {
  const relative = path.relative(root, value);
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function entryKey(entry) { return JSON.stringify([entry.root, entry.relative]); }
function syncDirectory(directory) {
  if (process.platform !== 'linux') return;
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function stableDirectory(entry) {
  return { root: entry.root, relative: entry.relative, kind: entry.kind, disposition: entry.disposition, device: entry.device, inode: entry.inode };
}

// This is an offline Operator, never a business-domain cleanup heuristic.
// It removes only the frozen private manifest, one exact path at a time.
// A journaled intent distinguishes a crash after unlink from an unexplained
// missing file. No recursive delete or source/collection directory traversal.
function cleanTemporaryStorage({ manifest, storage, journalPath, generationId, assertStopped, checkpoint = () => {} }) {
  if (typeof assertStopped !== 'function' || !/^[a-f0-9]{64}$/.test(generationId) ||
      !path.isAbsolute(journalPath) || !manifest || manifest.schemaRef !== 'formation-reset-storage@1')
    fail('RESET_CLEANUP_INPUT_INVALID');
  const { digest, ...body } = manifest;
  if (canonicalDigest(body) !== digest) fail('RESET_CLEANUP_MANIFEST_CORRUPT');
  const parent = path.dirname(journalPath);
  if (!samePath(fs.realpathSync.native(parent), parent) || fs.lstatSync(parent).isSymbolicLink() ||
      [...manifest.roots, ...storage.protectedDirectories].some(root => contained(root, journalPath)))
    fail('RESET_CLEANUP_JOURNAL_UNSAFE');
  assertStopped(generationId);
  if (manifest.entries.some(entry => !['retain', 'clear'].includes(entry.disposition))) fail('RESET_CLEANUP_MANIFEST_CORRUPT');
  const targets = manifest.entries.filter(e => e.relative !== '' && e.disposition === 'clear').slice().reverse();
  const request = { generationId, manifestDigest: digest, storageDigest: canonicalDigest(storage) };
  let state;
  function save() {
    const value = { ...request, ...state };
    writeAtomic(journalPath, { ...value, receiptDigest: canonicalDigest(value) });
    syncDirectory(parent);
  }
  if (fs.existsSync(journalPath)) {
    fileDigest(journalPath);
    const { receiptDigest, ...value } = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (receiptDigest !== canonicalDigest(value) || Object.keys(request).some(k => value[k] !== request[k]) ||
        !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > targets.length ||
        ![null, value.cursor].includes(value.pending) || !['cleaning', 'complete'].includes(value.phase))
      fail('RESET_CLEANUP_RECEIPT_CORRUPT');
    state = { cursor: value.cursor, pending: value.pending, phase: value.phase };
    if (state.phase === 'complete' && (state.cursor !== targets.length || state.pending !== null))
      fail('RESET_CLEANUP_RECEIPT_CORRUPT');
  } else {
    const current = inspectTemporaryStorage(storage);
    if (current.digest !== digest) fail('RESET_STORAGE_CHANGED');
    state = { cursor: 0, pending: null, phase: 'cleaning' }; save(); checkpoint('prepared');
  }

  const current = inspectTemporaryStorage(storage);
  const removed = new Set(targets.slice(0, state.cursor).map(entryKey));
  const pendingKey = state.pending === null ? null : entryKey(targets[state.cursor]);
  const expected = new Map(manifest.entries.filter(e => !removed.has(entryKey(e))).map(e => [entryKey(e), e]));
  const seen = new Set();
  for (const entry of current.entries) {
    const id = entryKey(entry), before = expected.get(id);
    if (!before || (entry.kind === 'directory' ? canonicalDigest(stableDirectory(entry)) !== canonicalDigest(stableDirectory(before)) :
      canonicalDigest(entry) !== canonicalDigest(before))) fail('RESET_STORAGE_CHANGED');
    seen.add(id);
  }
  for (const id of expected.keys()) if (!seen.has(id) && id !== pendingKey) fail('RESET_STORAGE_CHANGED');

  function assertAncestors(entry) {
    let relative = path.dirname(entry.relative);
    for (;;) {
      if (relative === '.') relative = '';
      const absolute = path.resolve(entry.root, relative);
      if (!contained(entry.root, absolute)) fail('RESET_STORAGE_CHANGED');
      const original = expected.get(entryKey({ root: entry.root, relative }));
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (!original || !stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(absolute), absolute) ||
          String(stat.dev) !== original.device || String(stat.ino) !== original.inode) fail('RESET_STORAGE_CHANGED');
      if (relative === '') return;
      relative = path.dirname(relative);
    }
  }
  while (state.cursor < targets.length) {
    assertStopped(generationId);
    const entry = targets[state.cursor], absolute = path.resolve(entry.root, entry.relative);
    if (!contained(entry.root, absolute) || samePath(entry.root, absolute)) fail('RESET_STORAGE_CHANGED');
    assertAncestors(entry);
    const exists = fs.existsSync(absolute);
    if (!exists && state.pending !== state.cursor) fail('RESET_STORAGE_CHANGED');
    state.pending = state.cursor; save(); checkpoint('delete_intent', entry);
    if (exists) {
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (stat.isSymbolicLink() || !samePath(fs.realpathSync.native(absolute), absolute) ||
          String(stat.dev) !== entry.device || String(stat.ino) !== entry.inode) fail('RESET_STORAGE_CHANGED');
      if (entry.kind === 'file') {
        if (!stat.isFile() || String(stat.size) !== entry.bytes || fileDigest(absolute) !== entry.sha256)
          fail('RESET_STORAGE_CHANGED');
        fs.unlinkSync(absolute);
      } else if (entry.kind === 'directory' && stat.isDirectory()) fs.rmdirSync(absolute);
      else fail('RESET_STORAGE_CHANGED');
      syncDirectory(path.dirname(absolute));
    }
    checkpoint('deleted', entry);
    state.cursor++; state.pending = null; save(); checkpoint('recorded', entry);
  }
  assertStopped(generationId);
  const final = inspectTemporaryStorage(storage);
  if (final.entries.some(e => e.relative !== '' && e.disposition !== 'retain')) fail('RESET_STORAGE_CHANGED');
  const retainedBefore = manifest.entries.filter(entry => entry.disposition === 'retain')
    .map(entry => entry.kind === 'directory' ? stableDirectory(entry) : entry);
  const retainedAfter = final.entries.filter(entry => entry.disposition === 'retain')
    .map(entry => entry.kind === 'directory' ? stableDirectory(entry) : entry);
  if (canonicalDigest(retainedBefore) !== canonicalDigest(retainedAfter)) fail('RESET_STORAGE_CHANGED');
  state.phase = 'complete'; save();
  return { generationId, manifestDigest: digest, complete: true, deletedEntries: targets.length,
    releasedFileBytes: manifest.bytes, retainedFileBytes: final.retainedBytes,
    retainedEntries: final.entries.filter(entry => entry.disposition === 'retain').length,
    retainedRoots: manifest.roots, receiptDigest: fileDigest(journalPath) };
}

module.exports = Object.freeze({ cleanTemporaryStorage });
