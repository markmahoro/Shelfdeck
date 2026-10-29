'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { fileDigest } = require('./formation-reset-generation');
const { buildStorageBudget, linuxMountPoints } = require('./formation-reset-storage');
const { writeAtomic } = require('../src/clean-runtime-operations');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function key(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function within(parent, child) { return key(parent) === key(child) || key(child).startsWith(key(parent + path.sep)); }
function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) === path.parse(value).root)
    fail('RESET_BACKUP_PATH_UNSAFE');
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || key(fs.realpathSync.native(value)) !== key(path.resolve(value)))
    fail('RESET_BACKUP_PATH_UNSAFE');
  return path.resolve(value);
}
function syncDirectory(value) {
  if (process.platform !== 'linux') return;
  const fd = fs.openSync(value, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function stamp(stat) {
  return { device: String(stat.dev), inode: String(stat.ino), bytes: String(stat.size),
    modifiedNs: String(stat.mtimeNs), changedNs: String(stat.ctimeNs) };
}

// Exclusions are explicit previously inventoried archive roots. No wildcard,
// age-based rule or directory-name heuristic can exclude application evidence.
function backupSourceBoundaries({ roots, excludedArchives = [] }) {
  if (!Array.isArray(roots) || !roots.length || roots.some(root => !/^[a-z][a-z0-9_-]*$/.test(root.id)))
    fail('RESET_BACKUP_INPUT_INVALID');
  const sources = roots.map(root => ({ id: root.id, path: directory(root.path) }));
  if (new Set(sources.map(root => root.id)).size !== sources.length ||
      sources.some((root, i) => sources.some((other, j) => i !== j && (within(root.path, other.path) || within(other.path, root.path)))))
    fail('RESET_BACKUP_ROOT_OVERLAP');
  const exclusions = excludedArchives.map(item => {
    if (!item || !['verified_backup_archive', 'verified_diagnostic_archive', 'verified_release_archive'].includes(item.reason) ||
        !/^[a-f0-9]{64}$/.test(item.inventoryDigest)) fail('RESET_BACKUP_EXCLUSION_UNREVIEWED');
    const actual = directory(item.path);
    if (!sources.some(source => within(source.path, actual) && key(source.path) !== key(actual)))
      fail('RESET_BACKUP_EXCLUSION_OUTSIDE_SOURCE');
    return { ...item, path: actual };
  });
  return { sources, exclusions };
}

// Preflight is read-only and may run before the stopped Host closes its last
// SQLite reader. Count WAL/SHM conservatively, but never call this a verified
// backup inventory: the cold inventory and hashes are established after close.
function measureBackupSources(options) {
  const { sources, exclusions } = backupSourceBoundaries(options);
  const mountPoints = process.platform === 'linux' ? linuxMountPoints(fs.readFileSync('/proc/self/mountinfo', 'utf8')) : [];
  let bytes = 0n, largestFileBytes = 0n, fileCount = 0;
  function walk(source, relative, device) {
    const file = path.join(source.path, relative);
    if (exclusions.some(item => key(item.path) === key(file))) return;
    const stat = fs.lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink() || key(fs.realpathSync.native(file)) !== key(file)) fail('RESET_BACKUP_ALIAS_REFUSED');
    if (String(stat.dev) !== device || mountPoints.some(mount => relative && key(mount) === key(file))) fail('RESET_BACKUP_NESTED_MOUNT_REFUSED');
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(source, path.join(relative, name), device);
    else if (stat.isFile()) { fileCount++; bytes += stat.size; if (stat.size > largestFileBytes) largestFileBytes = stat.size; }
    else fail('RESET_BACKUP_SPECIAL_FILE_REFUSED');
  }
  for (const source of sources) walk(source, '', String(fs.statSync(source.path, { bigint: true }).dev));
  return { schemaRef: 'formation-reset-backup-measurement@1', sources, exclusions, bytes: bytes.toString(),
    largestFileBytes: largestFileBytes.toString(), fileCount };
}

function inventoryBackupSources(options) {
  const { sources, exclusions } = backupSourceBoundaries(options);
  const mountPoints = process.platform === 'linux' ? linuxMountPoints(fs.readFileSync('/proc/self/mountinfo', 'utf8')) : [];
  const entries = [];
  function walk(source, relative, rootDevice) {
    const absolute = path.join(source.path, relative);
    if (exclusions.some(item => key(item.path) === key(absolute))) return;
    const stat = fs.lstatSync(absolute, { bigint: true });
    if (stat.isSymbolicLink() || key(fs.realpathSync.native(absolute)) !== key(absolute)) fail('RESET_BACKUP_ALIAS_REFUSED');
    if (String(stat.dev) !== rootDevice || mountPoints.some(mount => relative && key(mount) === key(absolute)))
      fail('RESET_BACKUP_NESTED_MOUNT_REFUSED');
    if (stat.isDirectory()) {
      entries.push({ root: source.id, relative, kind: 'directory' });
      for (const name of fs.readdirSync(absolute).sort()) walk(source, path.join(relative, name), rootDevice);
    } else if (stat.isFile()) {
      // Empty SQLite sidecars have no recovery payload. A nonempty WAL must
      // already have been checkpointed by the closed business generation.
      if (relative === 'shelfdeck.db-wal' || relative === 'shelfdeck.db-shm' || relative === 'shelfdeck.db-journal') {
        if (relative !== 'shelfdeck.db-shm' && stat.size) fail('RESET_BACKUP_DATABASE_NOT_COLD');
        return;
      }
      const sha256 = fileDigest(absolute), after = fs.lstatSync(absolute, { bigint: true });
      if (canonicalDigest(stamp(stat)) !== canonicalDigest(stamp(after))) fail('RESET_BACKUP_SOURCE_CHANGED');
      entries.push({ root: source.id, relative, kind: 'file', ...stamp(after), sha256 });
    } else fail('RESET_BACKUP_SPECIAL_FILE_REFUSED');
  }
  for (const source of sources) walk(source, '', String(fs.statSync(source.path, { bigint: true }).dev));
  const value = { schemaRef: 'formation-reset-backup-inventory@1', sources, exclusions, entries,
    bytes: entries.filter(row => row.kind === 'file').reduce((sum, row) => sum + BigInt(row.bytes), 0n).toString() };
  return { ...value, inventoryDigest: canonicalDigest(value) };
}

function assertManifest(manifest) {
  const { inventoryDigest, ...body } = manifest || {};
  if (manifest?.schemaRef !== 'formation-reset-backup-inventory@1' || canonicalDigest(body) !== inventoryDigest)
    fail('RESET_BACKUP_MANIFEST_CORRUPT');
  if (new Set(manifest.sources.map(source => source.id)).size !== manifest.sources.length ||
      manifest.entries.some(row => !manifest.sources.some(source => source.id === row.root) ||
        typeof row.relative !== 'string' || path.isAbsolute(row.relative) ||
        row.relative.split(/[\\/]/).some(part => part === '..') || !['directory', 'file'].includes(row.kind)))
    fail('RESET_BACKUP_MANIFEST_PATH_INVALID');
}

function verifyBackupFiles({ targetRoot, manifest }) {
  assertManifest(manifest); directory(targetRoot);
  const expected = new Set();
  for (const row of manifest.entries) {
    const file = path.join(targetRoot, row.root, row.relative); expected.add(key(file));
    if (!within(targetRoot, file)) fail('RESET_BACKUP_MANIFEST_PATH_INVALID');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || key(fs.realpathSync.native(file)) !== key(file) ||
        (row.kind === 'file' ? !stat.isFile() || String(stat.size) !== row.bytes || fileDigest(file) !== row.sha256 : !stat.isDirectory()))
      fail('RESET_BACKUP_VERIFICATION_FAILED');
  }
  function inspect(value) {
    for (const name of fs.readdirSync(value)) {
      const file = path.join(value, name);
      if (!expected.has(key(file))) fail('RESET_BACKUP_UNEXPECTED_FILE');
      if (fs.lstatSync(file).isDirectory()) inspect(file);
    }
  }
  inspect(targetRoot);
  return { fileCount: manifest.entries.filter(row => row.kind === 'file').length,
    bytes: manifest.bytes, inventoryDigest: manifest.inventoryDigest };
}

async function createVerifiedBackup({ sourceOptions, manifest, targetRoot, assertStopped, reserveBytes = 256n * 1024n * 1024n,
  checkpoint = () => {} }) {
  if (typeof assertStopped !== 'function') fail('RESET_BACKUP_STOPPED_FENCE_REQUIRED');
  assertStopped(); assertManifest(manifest);
  const parent = directory(path.dirname(targetRoot));
  const journalPath = targetRoot + '.journal.json';
  const exists = value => fs.lstatSync(value, { throwIfNoEntry: false }) !== undefined;
  if (!path.isAbsolute(targetRoot) || manifest.sources.some(source => within(source.path, targetRoot) || within(source.path, journalPath)))
    fail('RESET_BACKUP_TARGET_UNSAFE');
  if (manifest.inventoryDigest !== inventoryBackupSources(sourceOptions).inventoryDigest) fail('RESET_BACKUP_SOURCE_CHANGED');
  const request = { schemaRef: 'formation-reset-backup-copy@1', targetRoot, inventoryDigest: manifest.inventoryDigest };
  const requestDigest = canonicalDigest(request);
  let state = { cursor: 0, pending: null, attempt: 0, currentCopy: null, retainedPartialCopies: [], phase: 'copying' };
  const temporaryPath = (ordinal, attempt) => path.join(parent, '.reset-backup-' + canonicalDigest({ requestDigest, ordinal, attempt }) + '.partial');
  function save() {
    const body = { ...request, requestDigest, ...state };
    writeAtomic(journalPath, { ...body, recordDigest: canonicalDigest(body) });
  }
  if (exists(journalPath)) {
    fileDigest(journalPath);
    const { recordDigest, ...body } = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (recordDigest !== canonicalDigest(body) || body.requestDigest !== requestDigest || body.targetRoot !== targetRoot ||
        body.inventoryDigest !== manifest.inventoryDigest || !Number.isSafeInteger(body.cursor) ||
        body.cursor < 0 || body.cursor > manifest.entries.length || ![null, body.cursor].includes(body.pending) ||
        !Number.isSafeInteger(body.attempt) || body.attempt < 0 || !Array.isArray(body.retainedPartialCopies) ||
        [body.currentCopy, ...body.retainedPartialCopies].filter(Boolean).some(copy => !Number.isSafeInteger(copy.ordinal) ||
          copy.ordinal < 0 || copy.ordinal >= manifest.entries.length || !Number.isSafeInteger(copy.attempt) ||
          copy.attempt < 1 || copy.attempt > body.attempt || copy.path !== temporaryPath(copy.ordinal, copy.attempt)) ||
        !['copying', 'complete'].includes(body.phase) ||
        body.phase === 'complete' && (body.cursor !== manifest.entries.length || body.pending !== null))
      fail('RESET_BACKUP_JOURNAL_CHANGED');
    state = { cursor: body.cursor, pending: body.pending, attempt: body.attempt, currentCopy: body.currentCopy,
      retainedPartialCopies: body.retainedPartialCopies, phase: body.phase };
  } else if (exists(targetRoot)) fail('RESET_BACKUP_TARGET_UNSAFE');
  if (exists(targetRoot)) directory(targetRoot);
  // A retry pays for all still-possible copies. Partial files from an earlier
  // attempt remain evidence and their already-used space is not credited.
  const remainingBytes = manifest.entries.slice(state.cursor).filter(row => row.kind === 'file').reduce((sum, row) => sum + BigInt(row.bytes), 0n);
  const budget = buildStorageBudget({ allocations: [{ directory: parent, purpose: 'complete-reset-backup', bytes: remainingBytes }], reserveBytes });
  if (!budget.ready) fail('RESET_BACKUP_SPACE_INSUFFICIENT');
  if (!exists(journalPath)) save();
  if (state.currentCopy) {
    if (exists(state.currentCopy.path)) {
      fileDigest(state.currentCopy.path);
      state.retainedPartialCopies.push(state.currentCopy);
    }
    state.currentCopy = null; save();
  }
  if (!exists(targetRoot)) { fs.mkdirSync(targetRoot, { mode: 0o700 }); syncDirectory(parent); }
  for (let ordinal = 0; ordinal < manifest.entries.length; ordinal++) {
    const row = manifest.entries[ordinal];
    assertStopped();
    const dest = path.join(targetRoot, row.root, row.relative);
    if (!within(targetRoot, dest)) fail('RESET_BACKUP_TARGET_UNSAFE');
    if (ordinal < state.cursor || ordinal === state.pending && exists(dest)) {
      if (row.kind === 'directory') directory(dest);
      else if (String(fs.lstatSync(dest).size) !== row.bytes || fileDigest(dest) !== row.sha256)
        fail('RESET_BACKUP_VERIFICATION_FAILED');
      if (ordinal < state.cursor) continue;
    } else {
      if (exists(dest)) fail('RESET_BACKUP_UNEXPECTED_FILE');
      state.pending = ordinal; save(); checkpoint('copy_intent', { ordinal });
      if (row.kind === 'directory') {
        fs.mkdirSync(dest, { mode: 0o700 }); syncDirectory(path.dirname(dest));
      } else {
        directory(path.dirname(dest));
        const source = path.join(manifest.sources.find(root => root.id === row.root).path, row.relative);
        if (fileDigest(source) !== row.sha256) fail('RESET_BACKUP_SOURCE_CHANGED');
        state.attempt++;
        const temporary = temporaryPath(ordinal, state.attempt);
        state.currentCopy = { path: temporary, ordinal, attempt: state.attempt }; save();
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        syncDirectory(parent); checkpoint('file_copy_staged', { ordinal });
        if (fileDigest(temporary) !== row.sha256) fail('RESET_BACKUP_VERIFICATION_FAILED');
        assertStopped();
        // link() is an atomic, no-overwrite publication on this filesystem.
        // It links our independent copy, never the original source file.
        fs.linkSync(temporary, dest); syncDirectory(path.dirname(dest)); checkpoint('file_published', { ordinal });
        fs.unlinkSync(temporary); syncDirectory(parent); state.currentCopy = null;
      }
    }
    state.cursor = ordinal + 1; state.pending = null; save();
    if (row.kind === 'file') checkpoint('file_copied', { root: row.root, relative: row.relative });
  }
  assertStopped();
  if (manifest.inventoryDigest !== inventoryBackupSources(sourceOptions).inventoryDigest) fail('RESET_BACKUP_SOURCE_CHANGED');
  const verified = verifyBackupFiles({ targetRoot, manifest });
  state.phase = 'complete'; save();
  return { schemaRef: 'formation-reset-verified-backup@1', targetRoot, ...verified, retainedPartialCopies: state.retainedPartialCopies,
    verificationDigest: canonicalDigest({ manifest, verified }) };
}

module.exports = Object.freeze({ inventoryBackupSources, measureBackupSources, createVerifiedBackup, verifyBackupFiles });
