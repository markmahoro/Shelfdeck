'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');
const { assertResetPreflight, assertPreflightCapacityNow } = require('./formation-reset-preflight');
const { digestResetSnapshot } = require('./formation-reset-snapshot-digest');
const { inspectTemporaryStorage } = require('./formation-reset-storage');
const { inventoryBackupSources, createVerifiedBackup, verifyBackupFiles } = require('./formation-reset-backup');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function read(file) {
  if (fs.lstatSync(file).isSymbolicLink()) fail('RESET_BACKUP_OPERATION_CORRUPT');
  const { recordDigest, ...body } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (canonicalDigest(body) !== recordDigest) fail('RESET_BACKUP_OPERATION_CORRUPT');
  return body;
}
function save(file, body) { writeAtomic(file, { ...body, recordDigest: canonicalDigest(body) }); }
function directory(value) {
  const key = item => process.platform === 'win32' ? item.toLowerCase() : item;
  if (!path.isAbsolute(value) || fs.lstatSync(value).isSymbolicLink() || !fs.statSync(value).isDirectory() ||
      key(fs.realpathSync.native(value)) !== key(path.resolve(value))) fail('RESET_BACKUP_PATH_UNSAFE');
}

// Called only under the independent Operator lease and closed-generation
// fence. Failed copies remain evidence. A new attempt may capture later
// Operator audit records, but the approved business snapshot and private media
// inventory must still match before a replacement full backup is admitted.
async function ensureColdResetBackup({ Database, spec, assertStopped, checkpoint = () => {} }) {
  const basis = assertResetPreflight(spec.approvedPreflight);
  if (!/^[a-f0-9]{64}$/.test(spec.generationId) || spec.expectedRuntimeRevision !== basis.runtimeRevision + 1 ||
      canonicalDigest(spec.storage) !== basis.storageBoundaryDigest) fail('RUNTIME_RESET_PREVIEW_STALE');
  assertStopped(); directory(spec.operationRoot); directory(spec.backupParent);
  const journal = path.join(spec.operationRoot, spec.generationId + '-backup.json');
  const identity = canonicalDigest({ generationId: spec.generationId, preflightDigest: spec.approvedPreflight.previewDigest,
    backupParent: spec.backupParent, sourceOptions: spec.backupSourceOptions });
  let state = fs.existsSync(journal) ? read(journal) : { identity, attempts: [] };
  if (state.identity !== identity || !Array.isArray(state.attempts) || state.attempts.some((row, index) =>
      row.attempt !== index + 1 || !['copying', 'verified'].includes(row.phase))) fail('RESET_BACKUP_OPERATION_CORRUPT');
  const paths = attempt => ({
    manifestPath: path.join(spec.operationRoot, spec.generationId + '-backup-' + attempt + '.json'),
    backupRoot: path.join(spec.backupParent, 'reset-' + spec.generationId + '-attempt-' + attempt),
  });
  function result(attempt, manifest) {
    const p = paths(attempt);
    return { backupManifestPath: p.manifestPath, backupRoot: p.backupRoot,
      backupInventoryDigest: manifest.inventoryDigest, backupDataRootId: 'data' };
  }
  const latest = state.attempts.at(-1);
  if (latest?.phase === 'verified') {
    const p = paths(latest.attempt);
    if (fs.lstatSync(p.manifestPath).isSymbolicLink()) fail('RESET_BACKUP_OPERATION_CORRUPT');
    const manifest = JSON.parse(fs.readFileSync(p.manifestPath, 'utf8'));
    if (latest.inventoryDigest !== manifest.inventoryDigest) fail('RESET_BACKUP_OPERATION_CORRUPT');
    verifyBackupFiles({ targetRoot: p.backupRoot, manifest });
    return result(latest.attempt, manifest);
  }
  assertPreflightCapacityNow(spec.approvedPreflight);
  const database = new Database(path.join(spec.dataDir, 'shelfdeck.db'), { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only=ON'); database.exec('BEGIN');
    if (digestResetSnapshot(database).digest !== basis.sourceSnapshotDigest) fail('RUNTIME_RESET_PREVIEW_STALE');
  } finally { if (database.inTransaction) database.exec('ROLLBACK'); database.close(); }
  if (inspectTemporaryStorage(spec.storage).digest !== basis.storageManifestDigest) fail('RUNTIME_RESET_PREVIEW_STALE');
  const manifest = inventoryBackupSources(spec.backupSourceOptions);
  if (!manifest.sources.some(row => row.id === 'data' && row.path === spec.dataDir) ||
      canonicalDigest({ sources: manifest.sources, exclusions: manifest.exclusions, backupParent: spec.backupParent }) !== basis.backupPlanDigest)
    fail('RUNTIME_RESET_PREVIEW_STALE');
  const attempt = state.attempts.length + 1, p = paths(attempt);
  if (fs.existsSync(p.manifestPath) || fs.existsSync(p.backupRoot)) fail('RESET_BACKUP_ATTEMPT_CONFLICT');
  // Persist the attempt first: a crash at either following checkpoint consumes
  // this number and retry allocates another exclusive destination.
  state = { ...state, attempts: [...state.attempts, { attempt, phase: 'copying', inventoryDigest: manifest.inventoryDigest }] };
  save(journal, state); checkpoint('backup_attempt_allocated');
  writeAtomic(p.manifestPath, manifest); checkpoint('backup_manifest_frozen');
  await createVerifiedBackup({ sourceOptions: spec.backupSourceOptions, targetRoot: p.backupRoot, manifest, assertStopped, checkpoint });
  assertStopped(); checkpoint('backup_files_verified');
  state.attempts.at(-1).phase = 'verified'; save(journal, state);
  return result(attempt, manifest);
}

module.exports = Object.freeze({ ensureColdResetBackup });
