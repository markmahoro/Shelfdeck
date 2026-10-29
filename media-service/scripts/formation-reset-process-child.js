'use strict';
const { verifyWorkspaceStorage } = require('./formation-reset-workspace-protection');

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createColdResetFence } = require('../src/clean-reset-generation-fence');
const { verifyBackupFiles } = require('./formation-reset-backup');
const { readResetOwnerSnapshot } = require('./formation-reset-owner-snapshot');
const { buildOwnerRetentionPolicy } = require('./formation-reset-owner-policy');
const { normalizeRetainedSubjects } = require('./formation-reset-normalize');
const { verifyRetainedCollections } = require('./formation-reset-verify');
const { createOfflineFormationReset } = require('./formation-reset-offline');
const { fileDigest } = require('./formation-reset-generation');
const { buildStorageBudget } = require('./formation-reset-storage');
const { stageResetDatabase } = require('./formation-reset-stage');
const { withResetOperatorLease } = require('./formation-reset-operator-lease');

function fail(code) { throw Object.assign(new Error(code), { code }); }
async function execute(file, digest) {
  if (!path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink()) fail('RESET_PROCESS_REQUEST_CHANGED');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (body.schemaRef !== 'formation-reset-process-request@1' || canonicalDigest(body) !== digest ||
      !['inspect', 'prepare', 'apply', 'run'].includes(body.action)) fail('RESET_PROCESS_REQUEST_CHANGED');
  const { spec, temporaryRoot } = body;
  const expectedTemp = path.join(spec.operationRoot, spec.generationId + '-operator', 'sqlite-temp');
  if (temporaryRoot !== expectedTemp || process.env.SQLITE_TMPDIR !== temporaryRoot || process.env.TMPDIR !== temporaryRoot ||
      fs.realpathSync.native(temporaryRoot) !== temporaryRoot || fs.lstatSync(temporaryRoot).isSymbolicLink())
    fail('RESET_PROCESS_TEMP_VOLUME_MISMATCH');
  // Load the native SQLite module only after its process environment is fixed.
  const Database = require('better-sqlite3');
  return withResetOperatorLease({ Database, operationRoot: spec.operationRoot, dataDir: spec.dataDir,
    run: () => executeLeased({ Database, body, spec, temporaryRoot }) });
}

// The entry point acquires the native lease before this composition. The
// checkpoint port permits deterministic interruption qualification offline;
// requests arriving over IPC cannot supply executable hooks.
async function executeLeased({ Database, body, spec, temporaryRoot, checkpoint = () => {} }) {
  if (body.action === 'inspect') return require('./formation-reset-inspect').inspectFreshReset({ Database, spec, privateRoot: path.dirname(temporaryRoot) });
  const fence = createColdResetFence(spec);
  if (body.action === 'run') {
    require('./formation-reset-preflight').assertResetPreflight(spec.approvedPreflight);
    if (typeof body.request?.idempotencyKey !== 'string' || !body.request.idempotencyKey || body.request.idempotencyKey.length > 128 ||
        Object.keys(body.request).some(key => key !== 'idempotencyKey')) fail('RESET_OPERATOR_KEY_INVALID');
    const requestPath = path.join(spec.operationRoot, spec.generationId + '-run-request.json');
    const requestIdentity = canonicalDigest({ spec, request: body.request });
    if (fs.existsSync(requestPath)) {
      if (fs.lstatSync(requestPath).isSymbolicLink() || JSON.parse(fs.readFileSync(requestPath, 'utf8')).requestIdentity !== requestIdentity)
        fail('RESET_OPERATOR_KEY_CONFLICT');
    } else {
      fence.assertClosed();
      require('../src/clean-runtime-operations').writeAtomic(requestPath, { requestIdentity });
    }
    const complete = fence.completedReceipt();
    if (complete) return complete;
    fence.assertClosed();
    const backup = await require('./formation-reset-cold-backup').ensureColdResetBackup({ Database, spec, assertStopped: fence.assertClosed, checkpoint });
    const coldSpec = { ...spec, ...backup };
    const previewPath = path.join(spec.operationRoot, spec.generationId, 'preview.json');
    let previewDigest;
    if (fs.existsSync(previewPath)) {
      if (fs.lstatSync(previewPath).isSymbolicLink()) fail('RESET_OPERATOR_RECORD_CORRUPT');
      // apply validates this journal's digest, identity and preparation record.
      previewDigest = JSON.parse(fs.readFileSync(previewPath, 'utf8')).previewDigest;
    } else previewDigest = (await executeLeased({ Database, spec: coldSpec, temporaryRoot, checkpoint, body: { action: 'prepare' } })).previewDigest;
    const result = await executeLeased({ Database, spec: coldSpec, temporaryRoot, checkpoint,
      body: { action: 'apply', request: { previewDigest, idempotencyKey: body.request.idempotencyKey } } });
    fence.complete(result);
    return result;
  }
  fence.assertClosed();
  if (!path.isAbsolute(spec.backupManifestPath) || fs.lstatSync(spec.backupManifestPath).isSymbolicLink())
    fail('RESET_PROCESS_BACKUP_MANIFEST_INVALID');
  const manifest = JSON.parse(fs.readFileSync(spec.backupManifestPath, 'utf8'));
  if (manifest.inventoryDigest !== spec.backupInventoryDigest) fail('RESET_PROCESS_BACKUP_MANIFEST_INVALID');
  const data = manifest.sources.find(root => root.id === spec.backupDataRootId);
  if (!data || data.path !== spec.dataDir || !manifest.entries.some(row => row.root === data.id && row.relative === 'shelfdeck.db'))
    fail('RESET_PROCESS_DATABASE_BACKUP_MISSING');
  const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl = fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
  const backupPath = path.join(spec.backupRoot, data.id, 'shelfdeck.db');
  verifyBackupFiles({ targetRoot: spec.backupRoot, manifest });
  // SQLite may create WAL/SHM sidecars even for a read-only connection. Never
  // open the verified backup itself: inspect an exact private copy instead.
  const inspectedSource = path.join(path.dirname(temporaryRoot), 'verified-source.db');
  const expectedSource = manifest.entries.find(row => row.root === data.id && row.relative === 'shelfdeck.db');
  if (!fs.existsSync(inspectedSource)) {
    const bytes = BigInt(expectedSource.bytes);
    const budget = buildStorageBudget({ allocations: [
      { directory: spec.operationRoot, purpose: 'inspection-copy-retained-database-and-sqlite-work', bytes: bytes * 4n },
      { directory: spec.dataDir, purpose: 'database-switch-staging', bytes: bytes * 2n },
    ], reserveBytes: 256n * 1024n * 1024n });
    if (!budget.ready) fail('RESET_OPERATOR_SPACE_INSUFFICIENT');
  }
  // Use the same journaled publication discipline as the final staging copy.
  // A killed inspection copy must not permanently poison this generation, and
  // retry must never overwrite an unverified file at the canonical path.
  stageResetDatabase({ sourcePath: backupPath, stagePath: inspectedSource,
    journalPath: path.join(path.dirname(temporaryRoot), 'inspection-copy.json'),
    generationId: spec.generationId, candidateDigest: expectedSource.sha256, assertStopped: fence.assertClosed, checkpoint });
  if (fileDigest(inspectedSource) !== expectedSource.sha256) fail('RESET_PROCESS_INSPECTION_COPY_CHANGED');
  const owner = readResetOwnerSnapshot({ Database, sourcePath: inspectedSource });
  const policy = buildOwnerRetentionPolicy(schemaManifest, owner);
  const operator = createOfflineFormationReset({ Database, activePath: path.join(spec.dataDir, 'shelfdeck.db'),
    checkpoint,
    approvedPreflight: spec.approvedPreflight,
    targetSchema: { schemaManifest, schemaDdl },
    operationRoot: spec.operationRoot, generationId: spec.generationId, policy, storage: spec.storage,
    assertStopped: fence.assertClosed,
    backup: { databasePath: backupPath, receiptDigest: canonicalDigest({ manifest, backupRoot: spec.backupRoot }),
      verify: () => verifyBackupFiles({ targetRoot: spec.backupRoot, manifest }) },
    normalizeRetained: input => normalizeRetainedSubjects({ ...input, Database, schemaManifest, schemaDdl, seriesRetention: owner.seriesRetention }),
    verifyRetained: input => {
      if (input.sourcePath !== backupPath || fileDigest(inspectedSource) !== expectedSource.sha256)
        fail('RESET_PROCESS_INSPECTION_COPY_CHANGED');
      const result = verifyRetainedCollections({ ...input, sourcePath: inspectedSource, Database, schemaManifest, schemaDdl });
      return { ...result, workspaceProtection: verifyWorkspaceStorage({ Database, targetPath: input.targetPath, storage: spec.storage }) };
    },
  });
  return body.action === 'prepare' ? operator.prepare() : operator.apply(body.request);
}

if (require.main === module) {
  const [, , file, requestDigest] = process.argv;
  execute(file, requestDigest).then(value => {
    process.send?.({ kind: 'result', requestDigest, value }, () => process.disconnect?.());
  }).catch(error => {
    process.exitCode = 1;
    // Detailed input/HTTP/Secret data never crosses the Operator IPC channel.
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'RESET_PROCESS_FAILED';
    process.send?.({ kind: 'failure', requestDigest, code }, () => process.disconnect?.());
  });
}

module.exports = Object.freeze({ execute, executeLeased });
