'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');

const SCHEMA = 'shelfdeck.formation-retirement-journal@1';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// The Operator records sequencing, not business outcomes. Every business change
// is made by its Owner command; a crash after a commit replays the exact command.
function createRetirementJournal(options) {
  const root = path.resolve(options.dataDir, 'reset-journals');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink()) fail('RESET_JOURNAL_PATH_UNSAFE', 'Reset journal directory is unsafe.');
  function file(id) {
    if (!/^formation-reset-[a-zA-Z0-9-]{1,100}$/.test(id || '')) fail('RESET_JOURNAL_ID_INVALID', 'Reset journal identity is invalid.');
    return path.join(root, id + '.json');
  }
  function validate(value) {
    const { journalDigest, ...payload } = value;
    if (value.schema !== SCHEMA || canonicalDigest(payload) !== journalDigest ||
        !Array.isArray(value.steps) || !Array.isArray(value.completed) || value.completed.length > value.steps.length ||
        !['prepared', 'executing', 'completed'].includes(value.state) ||
        value.manifestDigest !== canonicalDigest(value.manifest) ||
        value.steps.some((step, index) => step.ordinal !== index || !['execution', 'arca', 'libra', 'intake', 'procurement', 'procurement_acceptance', 'arca_shared'].includes(step.owner)) ||
        value.completed.some((step, index) => step.ordinal !== index || !/^[a-f0-9]{64}$/.test(step.requestDigest || '') ||
          step.resultDigest !== canonicalDigest(step.result)) ||
        value.currentRequest && (value.state !== 'executing' || value.currentRequest.ordinal !== value.completed.length ||
          value.completed.length === value.steps.length || value.currentRequest.requestDigest !== canonicalDigest(value.currentRequest.request)) ||
        value.state === 'prepared' && (value.completed.length !== 0 || value.currentRequest !== null) ||
        value.state === 'completed' && (value.completed.length !== value.steps.length || value.currentRequest !== null || !value.verification))
      fail('RESET_JOURNAL_CORRUPT', 'Reset journal does not match its frozen manifest.');
    return value;
  }
  function save(value) {
    const { journalDigest: _old, ...payload } = value;
    const next = { ...payload, journalDigest: canonicalDigest(payload) };
    writeAtomic(file(value.resetId), next);
    return validate(next);
  }
  function read(id) {
    const target = file(id);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('RESET_JOURNAL_PATH_UNSAFE', 'Reset journal is not a regular standalone file.');
    const value = validate(JSON.parse(fs.readFileSync(target, 'utf8')));
    if (value.resetId !== id) fail('RESET_JOURNAL_ID_INVALID', 'Reset journal belongs to another operation.');
    return value;
  }
  function prepare({ resetId, manifest, backup, steps }) {
    if (fs.existsSync(file(resetId))) fail('RESET_JOURNAL_EXISTS', 'Reset journal already exists.');
    if (!backup || !/^[a-f0-9]{64}$/.test(backup.backupDigest || '') || !backup.backupId)
      fail('RESET_JOURNAL_BACKUP_REQUIRED', 'A verified backup is required before preparing Reset.');
    return save({ schema: SCHEMA, resetId, state: 'prepared', manifest, manifestDigest: canonicalDigest(manifest),
      backup, steps: steps.map((step, ordinal) => ({ ...step, ordinal })), completed: [], currentRequest: null });
  }
  async function execute(resetId) {
    let journal = read(resetId);
    // This check belongs to the enclosing stopped-runtime operation. A journal
    // file alone is never permission to resume a partially completed Reset.
    await options.assertAuthorized(journal);
    await options.verifyBackup(journal.backup);
    if (journal.state === 'completed') {
      const verified = await options.verifyCompleted(journal);
      if (canonicalDigest(verified) !== canonicalDigest(journal.verification))
        fail('RESET_JOURNAL_CLOSURE_CHANGED', 'Completed Reset no longer has the recorded Owner postconditions.');
      return journal;
    }
    journal = save({ ...journal, state: 'executing' });
    while (journal.completed.length < journal.steps.length) {
      const step = journal.steps[journal.completed.length];
      if (!journal.currentRequest) {
        const request = await options.prepareRequest(step, journal);
        journal = save({ ...journal, currentRequest: { ordinal: step.ordinal, request, requestDigest: canonicalDigest(request) } });
      }
      const current = journal.currentRequest;
      if (current.ordinal !== step.ordinal || current.requestDigest !== canonicalDigest(current.request))
        fail('RESET_JOURNAL_REQUEST_CORRUPT', 'Reset step request does not match its frozen digest.');
      const result = await options.commitStep(step, current.request, journal);
      await options.afterCommit?.(step, result);
      journal = save({ ...journal, currentRequest: null, completed: [...journal.completed,
        { ordinal: step.ordinal, requestDigest: current.requestDigest, result, resultDigest: canonicalDigest(result) }] });
    }
    const verification = await options.verifyCompleted(journal);
    return save({ ...journal, state: 'completed', verification });
  }
  return Object.freeze({ prepare, read, execute });
}

module.exports = Object.freeze({ createRetirementJournal });
