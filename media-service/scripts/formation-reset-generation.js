'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');
const DIGEST = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function syncDirectory(directory) {
  if (process.platform !== 'linux') return;
  const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fileDigest(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file) !== path.resolve(file))
    fail('RESET_GENERATION_PATH_UNSAFE');
  const fd = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024), hash = crypto.createHash('sha256');
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function assertCold(file) {
  for (const suffix of ['-wal', '-journal']) {
    const companion = file + suffix;
    if (fs.existsSync(companion) && fs.statSync(companion).size !== 0) fail('RESET_GENERATION_NOT_COLD');
  }
}
function write(file, body) {
  writeAtomic(file, { ...body, receiptDigest: canonicalDigest(body) });
  syncDirectory(path.dirname(file));
}
function read(file) {
  fileDigest(file);
  const { receiptDigest, ...body } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receiptDigest !== canonicalDigest(body)) fail('RESET_GENERATION_RECEIPT_CORRUPT');
  return body;
}

// The Host closes its database connections before invoking this Operator.
// Every retry requires the same stopped-generation fence. No business worker
// or media operation is resumed to make an abandoned task look complete.
function createGenerationSwitch(options) {
  const { activePath, candidatePath, backupPath, journalPath, markerPath, generationId,
    sourceDigest, candidateDigest, retainedDigest, assertStopped, checkpoint = () => {} } = options;
  if (typeof assertStopped !== 'function' || !DIGEST.test(generationId) || !DIGEST.test(sourceDigest) ||
      !DIGEST.test(candidateDigest) || !DIGEST.test(retainedDigest)) fail('RESET_GENERATION_INPUT_INVALID');
  const paths = [activePath, candidatePath, backupPath, journalPath, markerPath];
  if (paths.some(p => typeof p !== 'string' || !path.isAbsolute(p)) ||
      new Set(paths.map(p => path.resolve(p).toLowerCase())).size !== paths.length ||
      path.dirname(activePath) !== path.dirname(candidatePath)) fail('RESET_GENERATION_PATH_UNSAFE');
  const previousPath = path.join(path.dirname(activePath), '.reset-previous-' + generationId + '.db');
  const request = { schemaRef: 'formation-reset-generation@1', generationId, activePath, candidatePath,
    backupPath, previousPath, markerPath, sourceDigest, candidateDigest, retainedDigest };
  const requestDigest = canonicalDigest(request);
  function verify(file, digest) { if (fileDigest(file) !== digest) fail('RESET_GENERATION_FILE_CHANGED'); }
  function state() {
    const value = read(journalPath);
    if (value.requestDigest !== requestDigest || canonicalDigest(value.request) !== requestDigest)
      fail('RESET_GENERATION_REQUEST_CHANGED');
    return value;
  }
  function advance(phase, extra = {}) { const value = { ...state(), ...extra, phase }; write(journalPath, value); checkpoint(phase); return value; }
  function prepare() {
    assertStopped(generationId);
    if (fs.existsSync(journalPath)) return state();
    if (fs.existsSync(previousPath)) fail('RESET_GENERATION_TARGET_OCCUPIED');
    for (const file of [activePath, candidatePath, backupPath]) assertCold(file);
    verify(activePath, sourceDigest); verify(backupPath, sourceDigest); verify(candidatePath, candidateDigest);
    write(journalPath, { request, requestDigest, phase: 'prepared' }); checkpoint('prepared');
    return state();
  }
  function switchDatabase() {
    assertStopped(generationId);
    let current = prepare();
    if (['database_switched', 'cleaning', 'complete'].includes(current.phase)) {
      const marker = read(markerPath);
      if (marker.generationId !== generationId || marker.requestDigest !== requestDigest)
        fail('RESET_GENERATION_MARKER_MISMATCH');
      assertCold(activePath);
      verify(activePath, candidateDigest);
      return current;
    }
    if (current.phase === 'prepared') current = advance('switching');
    if (current.phase !== 'switching') fail('RESET_GENERATION_PHASE_INVALID');
    verify(backupPath, sourceDigest);
    if (fs.existsSync(activePath) && !fs.existsSync(previousPath)) {
      assertCold(activePath); verify(activePath, sourceDigest); verify(candidatePath, candidateDigest);
      fs.renameSync(activePath, previousPath); syncDirectory(path.dirname(activePath)); checkpoint('old_database_moved');
    }
    verify(previousPath, sourceDigest);
    if (!fs.existsSync(activePath)) {
      verify(candidatePath, candidateDigest); assertCold(candidatePath);
      fs.renameSync(candidatePath, activePath); syncDirectory(path.dirname(activePath)); checkpoint('new_database_moved');
    }
    verify(activePath, candidateDigest);
    write(markerPath, { generationId, requestDigest, retainedDigest, candidateDigest }); checkpoint('generation_marked');
    return advance('database_switched');
  }
  function completeCleanup(cleanupReceipt) {
    assertStopped(generationId);
    const current = switchDatabase();
    if (!cleanupReceipt || cleanupReceipt.generationId !== generationId ||
        cleanupReceipt.complete !== true || !DIGEST.test(cleanupReceipt.manifestDigest))
      fail('RESET_GENERATION_CLEANUP_INCOMPLETE');
    const cleanupDigest = canonicalDigest(cleanupReceipt);
    if (current.phase === 'complete') {
      if (current.cleanupDigest !== cleanupDigest) fail('RESET_GENERATION_CLEANUP_CHANGED');
      return current;
    }
    advance('cleaning');
    return advance('complete', { cleanupDigest, cleanupReceipt });
  }
  return Object.freeze({ prepare, switchDatabase, completeCleanup, read: state });
}

module.exports = Object.freeze({ createGenerationSwitch, fileDigest });
