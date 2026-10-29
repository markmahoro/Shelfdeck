'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');
const { fileDigest } = require('./formation-reset-generation');
function fail(code) { throw Object.assign(new Error(code), { code }); }
const present = file => fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
function syncDirectory(directory) {
  if (process.platform !== 'linux') return;
  const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// Publish a complete cold database on the active filesystem. A crash during
// copying leaves a named, journaled partial; it cannot become the switch input.
function stageResetDatabase({ sourcePath, stagePath, journalPath, generationId, candidateDigest, assertStopped, checkpoint = () => {} }) {
  if (![sourcePath, stagePath, journalPath].every(path.isAbsolute) || !/^[a-f0-9]{64}$/.test(generationId) ||
      !/^[a-f0-9]{64}$/.test(candidateDigest) || typeof assertStopped !== 'function') fail('RESET_STAGE_INPUT_INVALID');
  const parent = path.dirname(stagePath);
  for (const directory of [parent, path.dirname(journalPath)])
    if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync.native(directory) !== directory) fail('RESET_STAGE_PATH_UNSAFE');
  const request = { schemaRef: 'formation-reset-staging@1', sourcePath, stagePath, generationId, candidateDigest };
  const requestDigest = canonicalDigest(request);
  const temporaryPath = index => path.join(parent, '.reset-stage-' + generationId + '-' + index + '.db');
  let state = { attempts: [], phase: 'copying' };
  function save() { const body = { request, requestDigest, ...state }; writeAtomic(journalPath, { ...body, recordDigest: canonicalDigest(body) }); }
  assertStopped();
  if (fileDigest(sourcePath) !== candidateDigest) fail('RESET_OPERATOR_CANDIDATE_CHANGED');
  if (present(journalPath)) {
    fileDigest(journalPath);
    const { recordDigest, ...body } = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (recordDigest !== canonicalDigest(body) || body.requestDigest !== requestDigest || canonicalDigest(body.request) !== requestDigest ||
        !Array.isArray(body.attempts) || !['copying', 'complete'].includes(body.phase) || body.attempts.some((attempt, i) =>
          attempt.index !== i + 1 || attempt.path !== temporaryPath(i + 1) || !['copying', 'verified', 'published', 'closed', 'abandoned'].includes(attempt.state)))
      fail('RESET_STAGE_JOURNAL_CHANGED');
    state = { attempts: body.attempts, phase: body.phase };
  } else {
    if (present(stagePath)) fail('RESET_STAGE_TARGET_OCCUPIED');
    save();
  }
  let attempt = state.attempts.at(-1);
  if (state.phase === 'complete') {
    if (attempt?.state !== 'closed' || fileDigest(stagePath) !== candidateDigest) fail('RESET_STAGE_JOURNAL_CHANGED');
    return state;
  }
  if (present(stagePath)) {
    if (!attempt || !['verified', 'published'].includes(attempt.state) || fileDigest(stagePath) !== candidateDigest)
      fail('RESET_STAGE_TARGET_OCCUPIED');
  } else {
    if (!attempt || attempt.state === 'abandoned') {
      attempt = { index: state.attempts.length + 1, path: temporaryPath(state.attempts.length + 1), state: 'copying' };
      if (present(attempt.path)) fail('RESET_STAGE_TARGET_OCCUPIED');
      state.attempts.push(attempt); save();
    }
    if (attempt.state === 'copying' && present(attempt.path)) {
      const observedDigest = fileDigest(attempt.path);
      if (observedDigest !== candidateDigest) {
        attempt.state = 'abandoned'; attempt.observedDigest = observedDigest; save();
        // Keep the exact failed copy; retry never overwrites or deletes it.
        return stageResetDatabase({ sourcePath, stagePath, journalPath, generationId, candidateDigest, assertStopped, checkpoint });
      }
    }
    if (!present(attempt.path)) {
      if (attempt.state !== 'copying') fail('RESET_STAGE_FILE_MISSING');
      assertStopped(); fs.copyFileSync(sourcePath, attempt.path, fs.constants.COPYFILE_EXCL);
      const fd = fs.openSync(attempt.path, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      syncDirectory(parent); checkpoint('database_copy_staged');
    }
    if (fileDigest(attempt.path) !== candidateDigest) fail('RESET_STAGE_FILE_CHANGED');
    attempt.state = 'verified'; save(); assertStopped();
    fs.linkSync(attempt.path, stagePath); syncDirectory(parent);
    attempt.state = 'published'; save(); checkpoint('database_stage_published');
  }
  assertStopped();
  if (present(attempt.path)) {
    const staged = fs.lstatSync(stagePath, { bigint: true }), temporary = fs.lstatSync(attempt.path, { bigint: true });
    if (fileDigest(attempt.path) !== candidateDigest || staged.dev !== temporary.dev || staged.ino !== temporary.ino)
      fail('RESET_STAGE_FILE_CHANGED');
    fs.unlinkSync(attempt.path); syncDirectory(parent);
  } else if (attempt.state !== 'published') fail('RESET_STAGE_FILE_MISSING');
  attempt.state = 'closed'; state.phase = 'complete'; save();
  return state;
}

module.exports = Object.freeze({ stageResetDatabase });
