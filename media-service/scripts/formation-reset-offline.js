'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');
const { createRetainedDatabase } = require('./formation-reset-copy');
const { createGenerationSwitch, fileDigest } = require('./formation-reset-generation');
const { inspectTemporaryStorage, assertStorageUnchanged, buildStorageBudget } = require('./formation-reset-storage');
const { cleanTemporaryStorage } = require('./formation-reset-cleanup');
const { stageResetDatabase } = require('./formation-reset-stage');
const { assertColdCopyMatchesPreflight } = require('./formation-reset-preflight');

const CONTRACT = 'shelfdeck.fresh-formation-reset@1';
function fail(code) { throw Object.assign(new Error(code), { code }); }
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function within(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function realDirectory(directory) {
  if (!path.isAbsolute(directory) || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink() ||
      !samePath(path.resolve(directory), fs.realpathSync.native(directory))) fail('RESET_OPERATOR_PATH_UNSAFE');
}
function cold(file) {
  for (const suffix of ['-wal', '-journal']) if (fs.existsSync(file + suffix) && fs.statSync(file + suffix).size)
    fail('RESET_GENERATION_NOT_COLD');
}
function save(file, value) { writeAtomic(file, { ...value, recordDigest: canonicalDigest(value) }); }
function load(file) {
  fileDigest(file);
  const { recordDigest, ...value } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (canonicalDigest(value) !== recordDigest) fail('RESET_OPERATOR_RECORD_CORRUPT');
  return value;
}

// Cold Operator composition. The Host must close its business connections and
// supply the durable stopped-generation fence before calling either method.
// Backup verification, retention and normalization belong to explicit ports;
// this module never guesses that an unreferenced media file may be removed.
function createOfflineFormationReset(options) {
  const { Database, activePath, operationRoot, generationId, policy, storage, backup,
    assertStopped, normalizeRetained, verifyRetained, checkpoint = () => {} } = options;
  if (!/^[a-f0-9]{64}$/.test(generationId) || !path.isAbsolute(activePath) ||
      !/^[a-f0-9]{64}$/.test(backup?.receiptDigest) || !path.isAbsolute(backup?.databasePath || '') ||
      [assertStopped, backup?.verify, normalizeRetained, verifyRetained].some(fn => typeof fn !== 'function'))
    fail('RESET_OPERATOR_INPUT_INVALID');
  realDirectory(operationRoot); realDirectory(path.dirname(activePath));
  const directory = path.join(operationRoot, generationId);
  const paths = { directory, plan: path.join(directory, 'plan.json'), preview: path.join(directory, 'preview.json'),
    preparation: path.join(directory, 'preparation.json'),
    staging: path.join(directory, 'staging.json'),
    stage: path.join(path.dirname(activePath), '.reset-candidate-' + generationId + '.db'),
    switch: path.join(directory, 'switch.json'), cleanup: path.join(directory, 'cleanup.json'), receipt: path.join(directory, 'receipt.json'),
    marker: path.join(path.dirname(activePath), 'database-generation.json') };
  for (const root of [...storage.roots, ...storage.protectedDirectories])
    if (within(root, operationRoot) || within(operationRoot, root)) fail('RESET_OPERATOR_BOUNDARY_OVERLAP');
  if (within(operationRoot, activePath) || within(directory, backup.databasePath) || samePath(activePath, backup.databasePath))
    fail('RESET_OPERATOR_BOUNDARY_OVERLAP');
  const identity = { contractVersion: CONTRACT, generationId, activePath, operationRoot,
    approvedPreflightDigest: options.approvedPreflight?.previewDigest || null,
    policyDigest: canonicalDigest(policy), storageDigest: canonicalDigest(storage),
    backupPath: backup.databasePath, backupDigest: backup.receiptDigest };
  const identityDigest = canonicalDigest(identity);
  function fence() { assertStopped(generationId); }
  function budget(databaseBytes, stageOnly = false) {
    // Account for the retained DB, SQLite's rollback journal/temp queue and
    // the same-filesystem staging copy. Do not borrow future cleanup space.
    const allocations = [{ directory: path.dirname(activePath), purpose: 'database-switch-staging', bytes: databaseBytes * 2n }];
    if (!stageOnly) allocations.push({ directory: operationRoot, purpose: 'retained-database-and-sqlite-working-space', bytes: databaseBytes * 3n });
    return buildStorageBudget({ allocations, reserveBytes: options.reserveBytes ?? 256n * 1024n * 1024n });
  }
  async function verifyBackup() { fence(); await backup.verify(); cold(backup.databasePath); }
  function readPreview() {
    const result = load(paths.preview), { previewDigest, ...body } = result;
    if (canonicalDigest(body) !== previewDigest || result.identityDigest !== identityDigest) fail('RESET_OPERATOR_PREVIEW_CHANGED');
    const preparation = load(paths.preparation);
    if (preparation.phase !== 'verified' || !Number.isSafeInteger(preparation.attempt) || preparation.attempt < 1 ||
        result.candidatePath !== candidatePath(preparation.attempt)) fail('RESET_OPERATOR_PREPARATION_INCOMPLETE');
    return result;
  }
  function candidatePath(attempt) { return path.join(directory, 'retained-attempt-' + attempt + '.db'); }
  function verifyPlan() {
    const plan = load(paths.plan);
    if (plan.identityDigest !== identityDigest || canonicalDigest(plan.identity) !== identityDigest) fail('RESET_OPERATOR_REQUEST_CHANGED');
    return plan;
  }
  async function prepare() {
    fence(); await verifyBackup();
    if (fs.existsSync(paths.preview)) {
      const plan = verifyPlan(), preview = readPreview();
      if (options.approvedPreflight) assertColdCopyMatchesPreflight(options.approvedPreflight,
        { copy: preview.copy, policy, storage, storageManifest: plan.storageManifest });
      if (fileDigest(activePath) !== plan.sourceDigest) fail('RESET_OPERATOR_SOURCE_CHANGED');
      assertStorageUnchanged(plan.storageManifest, storage);
      if (fileDigest(preview.candidatePath) !== preview.candidateDigest) fail('RESET_OPERATOR_CANDIDATE_CHANGED');
      return preview;
    }
    cold(activePath);
    const sourceDigest = fileDigest(activePath);
    if (sourceDigest !== fileDigest(backup.databasePath)) fail('RESET_OPERATOR_BACKUP_CHANGED');
    const storageManifest = inspectTemporaryStorage(storage);
    const volumeBudget = budget(BigInt(fs.statSync(activePath).size));
    if (!volumeBudget.ready) fail('RESET_OPERATOR_SPACE_INSUFFICIENT');
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    realDirectory(directory);
    const plan = { identity, identityDigest, sourceDigest, storageManifest, volumeBudget };
    if (fs.existsSync(paths.plan)) {
      const prior = verifyPlan();
      // Available space changes as an interrupted attempt consumes storage.
      // Recheck the budget, but compare frozen facts rather than free bytes.
      if (prior.sourceDigest !== sourceDigest || prior.storageManifest.digest !== storageManifest.digest)
        fail('RESET_OPERATOR_PREPARATION_CHANGED');
    } else save(paths.plan, plan);
    checkpoint('plan_frozen');
    const prior = fs.existsSync(paths.preparation) ? load(paths.preparation) : null;
    if (prior && (prior.identityDigest !== identityDigest || !Number.isSafeInteger(prior.attempt) || prior.attempt < 1))
      fail('RESET_OPERATOR_RECORD_CORRUPT');
    // A partial database is never resumed or deleted. A new exclusive file
    // is built from the verified source; prior attempts remain audit evidence.
    const attempt = (prior?.attempt || 0) + 1, candidate = candidatePath(attempt);
    if (!Number.isSafeInteger(attempt)) fail('RESET_OPERATOR_ATTEMPT_EXHAUSTED');
    save(paths.preparation, { identityDigest, attempt, phase: 'building' });
    const copy = createRetainedDatabase({ Database, sourcePath: activePath, targetPath: candidate, policy, targetSchema: options.targetSchema });
    checkpoint('database_copied');
    if (options.approvedPreflight) assertColdCopyMatchesPreflight(options.approvedPreflight, { copy, policy, storage, storageManifest });
    const normalization = await normalizeRetained({ targetPath: candidate, generationId,
      backupDigest: backup.receiptDigest, manifestDigest: canonicalDigest(verifyPlan()),
      assertIsolated(target) { fence(); if (!samePath(target, candidate)) fail('RESET_OPERATOR_NOT_ISOLATED'); } });
    checkpoint('owners_normalized');
    const verification = await verifyRetained({ sourcePath: backup.databasePath, targetPath: candidate });
    cold(candidate);
    if (fileDigest(activePath) !== sourceDigest) fail('RESET_OPERATOR_SOURCE_CHANGED');
    assertStorageUnchanged(storageManifest, storage);
    const value = { contractVersion: CONTRACT, generationId, identityDigest, ready: true, blockers: [],
      sourceDigest, candidatePath: candidate, candidateDigest: fileDigest(candidate), retainedDigest: canonicalDigest({ copy, normalization, verification }),
      counts: copy.tables.map(row => ({ table: row.table, retained: row.retained, removed: row.removed })),
      expectedReleasedBytes: storageManifest.bytes, volumeBudget, copy, normalization, verification };
    const result = { ...value, previewDigest: canonicalDigest(value) };
    save(paths.preparation, { identityDigest, attempt, phase: 'verified' });
    save(paths.preview, result); checkpoint('preview_verified');
    return result;
  }
  async function apply({ previewDigest, idempotencyKey }) {
    fence(); await verifyBackup();
    if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 128) fail('RESET_OPERATOR_KEY_INVALID');
    const plan = verifyPlan(), preview = readPreview();
    if (options.approvedPreflight) assertColdCopyMatchesPreflight(options.approvedPreflight,
      { copy: preview.copy, policy, storage, storageManifest: plan.storageManifest });
    if (preview.previewDigest !== previewDigest) fail('RESET_OPERATOR_PREVIEW_CHANGED');
    const request = { previewDigest, idempotencyKey }, requestPath = path.join(directory, 'apply.json');
    if (fs.existsSync(requestPath)) {
      if (canonicalDigest(load(requestPath)) !== canonicalDigest(request)) fail('RESET_OPERATOR_KEY_CONFLICT');
    } else {
      if (fileDigest(activePath) !== plan.sourceDigest) fail('RESET_OPERATOR_SOURCE_CHANGED');
      assertStorageUnchanged(plan.storageManifest, storage);
      if (!budget(BigInt(fs.statSync(preview.candidatePath).size), true).ready) fail('RESET_OPERATOR_SPACE_INSUFFICIENT');
      save(requestPath, request);
    }
    if (fileDigest(backup.databasePath) !== plan.sourceDigest) fail('RESET_OPERATOR_BACKUP_CHANGED');
    if (!fs.existsSync(paths.switch)) {
      cold(activePath);
      if (fileDigest(activePath) !== plan.sourceDigest || fileDigest(preview.candidatePath) !== preview.candidateDigest)
        fail('RESET_OPERATOR_SOURCE_CHANGED');
      assertStorageUnchanged(plan.storageManifest, storage);
      if (!budget(BigInt(fs.statSync(preview.candidatePath).size), true).ready) fail('RESET_OPERATOR_SPACE_INSUFFICIENT');
      stageResetDatabase({ sourcePath: preview.candidatePath, stagePath: paths.stage, journalPath: paths.staging,
        generationId, candidateDigest: preview.candidateDigest, assertStopped: fence, checkpoint });
      checkpoint('database_staged');
    }
    const operation = createGenerationSwitch({ activePath, candidatePath: paths.stage, backupPath: backup.databasePath,
      journalPath: paths.switch, markerPath: paths.marker, generationId, sourceDigest: plan.sourceDigest,
      candidateDigest: preview.candidateDigest, retainedDigest: preview.retainedDigest, assertStopped: fence, checkpoint });
    operation.switchDatabase();
    const cleanup = cleanTemporaryStorage({ manifest: plan.storageManifest, storage, journalPath: paths.cleanup,
      generationId, assertStopped: fence, checkpoint });
    const switched = operation.completeCleanup(cleanup);
    const receipt = { contractVersion: CONTRACT, generationId, previewDigest, backupDigest: backup.receiptDigest,
      databaseGeneration: generationId, sourceDigest: plan.sourceDigest, candidateDigest: preview.candidateDigest,
      retainedDigest: preview.retainedDigest, verification: preview.verification, staging: load(paths.staging), cleanup, phase: switched.phase,
      desiredMode: 'stopped' };
    if (fs.existsSync(paths.receipt) && canonicalDigest(load(paths.receipt)) !== canonicalDigest(receipt)) fail('RESET_OPERATOR_RECEIPT_CONFLICT');
    save(paths.receipt, receipt);
    return receipt;
  }
  return Object.freeze({ prepare, apply, paths });
}

module.exports = Object.freeze({ createOfflineFormationReset });
