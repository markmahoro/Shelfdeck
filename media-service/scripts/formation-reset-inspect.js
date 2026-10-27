'use strict';

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { assertBusinessGenerationOpenAllowed } = require('../src/clean-reset-generation-fence');
const { measureBackupSources } = require('./formation-reset-backup');
const { createRetainedDatabase } = require('./formation-reset-copy');
const { readResetOwnerSnapshot } = require('./formation-reset-owner-snapshot');
const { buildOwnerRetentionPolicy } = require('./formation-reset-owner-policy');
const { normalizeRetainedSubjects } = require('./formation-reset-normalize');
const { verifyRetainedCollections } = require('./formation-reset-verify');
const { inspectTemporaryStorage, assertStorageUnchanged, buildStorageBudget } = require('./formation-reset-storage');
const { buildResetPreflight, buildCapacityBlockedPreflight } = require('./formation-reset-preflight');
const { deriveWorkspaceStorage } = require('./formation-reset-workspace-protection');
const { databaseFiles } = require('../src/clean-reset-bootstrap');
const { fileDigest } = require('./formation-reset-generation');
const { verifyRetainedPeopleReferences } = require('./formation-reset-people-references');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function realDirectory(directory) {
  const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!path.isAbsolute(directory) || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink() ||
      key(fs.realpathSync.native(directory)) !== key(path.resolve(directory))) fail('RESET_PREFLIGHT_PATH_UNSAFE');
}
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Invoked in the separate Operator process with its SQLite temp environment
// already fixed. Cold Bootstrap inspection reads an exact private source copy;
// a stopped live Host supplies its normal SQLite snapshot. No intent, Offer or
// media is changed, including SQLite sidecars in the closed source directory.
function inspectFreshReset({ Database, spec, privateRoot }) {
  for (const directory of [spec.dataDir, spec.operationRoot, spec.backupParent, privateRoot]) realDirectory(directory);
  if (path.dirname(privateRoot) !== spec.operationRoot) fail('RESET_PREFLIGHT_PATH_UNSAFE');
  const intentPath = path.join(spec.dataDir, 'operator-runtime', 'intent.json');
  function stopped() {
    assertBusinessGenerationOpenAllowed(spec.dataDir);
    if (fs.lstatSync(intentPath).isSymbolicLink()) fail('RESET_PREFLIGHT_PATH_UNSAFE');
    const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
    if (intent.schema !== 'shelfdeck.runtime-intent@1' || intent.desiredMode !== 'stopped' || intent.pendingReset ||
        intent.revision !== spec.expectedRuntimeRevision) fail('RUNTIME_RESET_REQUIRES_STOPPED');
    return canonicalDigest(intent);
  }
  const intentDigest = stopped();
  const measured = measureBackupSources(spec.backupSourceOptions);
  if (!measured.sources.some(source => source.id === 'data' && source.path === spec.dataDir)) fail('RESET_PREFLIGHT_BACKUP_DATA_MISSING');
  for (const source of measured.sources) {
    if (inside(source.path, spec.operationRoot) || inside(source.path, spec.backupParent) ||
        inside(spec.operationRoot, source.path) || inside(spec.backupParent, source.path)) fail('RESET_PREFLIGHT_ARCHIVE_OVERLAP');
  }
  for (const root of [...spec.storage.roots, ...spec.storage.protectedDirectories]) {
    if (inside(root, spec.operationRoot) || inside(spec.operationRoot, root)) fail('RESET_PREFLIGHT_ARCHIVE_OVERLAP');
  }
  const activePath = path.join(spec.dataDir, 'shelfdeck.db');
  if (fs.lstatSync(activePath).isSymbolicLink()) fail('RESET_PREFLIGHT_PATH_UNSAFE');
  let databaseBytes = fs.statSync(activePath, { bigint: true }).size;
  const wal = fs.lstatSync(activePath + '-wal', { bigint: true, throwIfNoEntry: false });
  if (wal) {
    if (!wal.isFile() || wal.isSymbolicLink()) fail('RESET_PREFLIGHT_PATH_UNSAFE');
    databaseBytes += wal.size;
  }
  const backupPlanDigest = canonicalDigest({ sources: measured.sources, exclusions: measured.exclusions, backupParent: spec.backupParent });
  // The backup includes the old private Workspace, without crediting deletion.
  // One failed largest-file copy and fixed Operator bookkeeping also fit before
  // initial admission; later retries still have to pass their own space checks.
  const volumeBudget = buildStorageBudget({ allocations: [
    { directory: spec.backupParent, purpose: 'complete-backup-and-copy-retry',
      bytes: BigInt(measured.bytes) + BigInt(measured.largestFileBytes) + 16n * 1024n * 1024n },
    { directory: spec.operationRoot, purpose: 'inspection-retained-generation-and-sqlite-work', bytes: databaseBytes * 4n },
    { directory: spec.dataDir, purpose: 'database-switch-staging', bytes: databaseBytes * 2n },
  ], reserveBytes: 256n * 1024n * 1024n });
  if (!volumeBudget.ready) return buildCapacityBlockedPreflight({ runtimeRevision: spec.expectedRuntimeRevision,
    backupPlanDigest, storage: spec.storage, volumeBudget });
  const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl = fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
  const candidatePath = path.join(privateRoot, 'preflight-' + crypto.randomUUID() + '.db');
  const coldSourcePath = spec.bootstrapId ? path.join(privateRoot, 'cold-source-' + crypto.randomUUID() + '.db') : null;
  let completed = false;
  try {
    let sourceFiles;
    if (coldSourcePath) {
      if (!/^[a-f0-9]{64}$/.test(spec.bootstrapId)) fail('RESET_BOOTSTRAP_PROOF_INVALID');
      sourceFiles = databaseFiles(spec.dataDir);
      if (sourceFiles[1].bytes > 0) fail('RESET_BOOTSTRAP_SOURCE_NOT_COLD');
      fs.copyFileSync(activePath, coldSourcePath, fs.constants.COPYFILE_EXCL);
      const fd = fs.openSync(coldSourcePath, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fileDigest(coldSourcePath) !== sourceFiles[0].sha256 ||
          canonicalDigest(databaseFiles(spec.dataDir)) !== canonicalDigest(sourceFiles)) fail('RUNTIME_RESET_PREVIEW_STALE');
    }
    const sourcePath = coldSourcePath || activePath;
    const peopleSource = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
      peopleSource.pragma('query_only=ON'); peopleSource.exec('BEGIN');
      verifyRetainedPeopleReferences(peopleSource, peopleSource);
    } finally { if (peopleSource.inTransaction) peopleSource.exec('ROLLBACK'); peopleSource.close(); }
    const owner = readResetOwnerSnapshot({ Database, sourcePath });
    const policy = buildOwnerRetentionPolicy(schemaManifest, owner);
    const copy = createRetainedDatabase({ Database, sourcePath, targetPath: candidatePath, policy,
      targetSchema: { schemaManifest, schemaDdl } });
    const evidenceDigest = canonicalDigest({ purpose: 'disposable-preflight-only', sourceSnapshot: copy.sourceSnapshot.digest });
    normalizeRetainedSubjects({ Database, targetPath: candidatePath, schemaManifest, schemaDdl,
      generationId: evidenceDigest, backupDigest: evidenceDigest, manifestDigest: evidenceDigest,
      seriesRetention: owner.seriesRetention, assertIsolated(file) {
        if (file !== candidatePath || stopped() !== intentDigest) fail('RUNTIME_RESET_PREVIEW_STALE');
      } });
    const verified = verifyRetainedCollections({ Database, sourcePath, targetPath: candidatePath, schemaManifest, schemaDdl });
    const { storage, protection: workspaceProtection } = deriveWorkspaceStorage({ Database, targetPath: candidatePath, storage: spec.storage });
    for (const root of storage.roots) {
      if (!measured.sources.some(source => inside(source.path, root)) || measured.exclusions.some(item => inside(item.path, root)))
        fail('RESET_PREFLIGHT_WORKSPACE_BACKUP_MISSING');
    }
    for (const root of [...storage.roots, ...storage.protectedDirectories]) {
      if (inside(root, spec.operationRoot) || inside(spec.operationRoot, root) || inside(root, spec.backupParent))
        fail('RESET_PREFLIGHT_ARCHIVE_OVERLAP');
    }
    const storageManifest = inspectTemporaryStorage(storage);
    if (canonicalDigest(readResetOwnerSnapshot({ Database, sourcePath })) !== canonicalDigest(owner) || stopped() !== intentDigest ||
        sourceFiles && canonicalDigest(databaseFiles(spec.dataDir)) !== canonicalDigest(sourceFiles))
      fail('RUNTIME_RESET_PREVIEW_STALE');
    assertStorageUnchanged(storageManifest, storage);
    const preview = buildResetPreflight({ runtimeRevision: spec.expectedRuntimeRevision, copy, policy, storage,
      storageManifest, backupPlanDigest,
      volumeBudget, protectedSummary: { collectionCount: verified.protections.find(row => row.table === 'arca_shelf_entries').count,
        protections: verified.protections, ownershipDigest: verified.ownershipDigest, packageReadDigest: verified.packageReadDigest,
        shared: verified.shared, peopleReferences: verified.peopleReferences, workspaceProtection } });
    completed = true; return preview;
  } finally {
    // A failed preflight remains evidence. A successful disposable copy is not
    // a backup or an approved switch input; remove only this process's exact
    // named regular files after all native connections above have closed.
    if (completed) for (const base of [candidatePath, coldSourcePath].filter(Boolean)) for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const file = base + suffix, stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(file) !== privateRoot) fail('RESET_PREFLIGHT_PATH_UNSAFE');
      fs.unlinkSync(file);
    }
  }
}

module.exports = Object.freeze({ inspectFreshReset });
