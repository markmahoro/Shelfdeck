'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { SCHEMA, databaseFiles } = require('../src/clean-reset-bootstrap');
const { initializeResetTarget } = require('./formation-reset-schema');
const { captureColdResetManagementCredential } = require('../src/helix/platform/public/admin-credential-runtime');
const { createAdminCredentialSecretStore } = require('../src/admin-credential-secret-store');
const { writeAtomic } = require('../src/clean-runtime-operations');
function fail(code = 'RESET_BOOTSTRAP_CLOSURE_INVALID') { throw Object.assign(new Error(code), { code }); }

// Called only by a deployment controller after it has verified safe Stop,
// removed the old container, and inventoried all Docker mounts. The proof is
// explicit operator input, never inferred from PID disappearance or SQL locks.
function prepareColdResetBootstrap({ dataDir, configuration, closure, secretRoot, outputFile, qualificationPath,
  Database = require('better-sqlite3') }) {
  const sha = value => /^[a-f0-9]{64}$/.test(value || '');
  if (closure?.schema !== 'shelfdeck.deployment-closure@1' || !sha(closure.oldContainerId) ||
      !/^sha256:[a-f0-9]{64}$/.test(closure.oldImageId || '') || closure.oldContainerRemoved !== true ||
      !Array.isArray(closure.remainingDataMounts) || closure.remainingDataMounts.length ||
      !sha(closure.intentDigest) || !sha(closure.stopOperationId) || !sha(closure.stopReceiptDigest) ||
      !sha(closure.inventoryDigest) || !Number.isFinite(Date.parse(closure.closedAt))) fail();
  if (configuration.dataDir !== dataDir || fs.realpathSync.native(dataDir) !== dataDir ||
      fs.existsSync(outputFile) || fs.existsSync(qualificationPath)) fail();
  for (const file of [outputFile, qualificationPath]) {
    if (!path.isAbsolute(file) || fs.realpathSync.native(path.dirname(file)) !== path.dirname(file) ||
        path.dirname(file) !== configuration.operationRoot) fail();
  }
  const read = file => {
    if (fs.lstatSync(file).isSymbolicLink()) fail();
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const intentPath = path.join(dataDir, 'operator-runtime', 'intent.json'), intent = read(intentPath);
  const stop = read(path.join(dataDir, 'operator-runtime', closure.stopOperationId + '.json'));
  if (intent.schema !== 'shelfdeck.runtime-intent@1' || intent.desiredMode !== 'stopped' || intent.pendingReset ||
      intent.revision !== closure.runtimeRevision || canonicalDigest(intent) !== closure.intentDigest ||
      stop.kind !== 'stop' || stop.operationId !== closure.stopOperationId || stop.state !== 'completed' ||
      stop.result?.mode !== 'stopped' || canonicalDigest(stop) !== closure.stopReceiptDigest) fail();
  const files = databaseFiles(dataDir), db = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true, fileMustExist: true });
  let snapshot;
  try {
    db.pragma('query_only=ON'); db.exec('BEGIN');
    initializeResetTarget({ Database, targetPath: qualificationPath, source: db,
      schemaManifest: require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
      schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8') });
    const marker = db.prepare('SELECT * FROM platform_schema_marker').get();
    const credentials = db.prepare("SELECT * FROM platform_admin_credentials WHERE state='active'").all();
    const reference = credentials.length === 1 ? db.prepare('SELECT * FROM platform_secret_refs WHERE secret_ref=?').get(credentials[0].secret_ref) : null;
    snapshot = { marker, credentials, reference,
      expected: { schemaName: marker.schema_name, generation: marker.generation, schemaDigest: marker.schema_digest } };
  } finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
  if (canonicalDigest(databaseFiles(dataDir)) !== canonicalDigest(files) || canonicalDigest(read(intentPath)) !== closure.intentDigest) fail();
  const body = { schema: SCHEMA, dataDir, configurationDigest: canonicalDigest(configuration), closure,
    runtimeRevision: intent.revision, intentDigest: closure.intentDigest, stopOperationId: closure.stopOperationId,
    stopReceiptDigest: closure.stopReceiptDigest, databaseFiles: files };
  const bootstrapId = canonicalDigest(body);
  const credential = captureColdResetManagementCredential({ snapshot, generationId: bootstrapId,
    secretStore: createAdminCredentialSecretStore({ dataDir, secretRoot }) });
  writeAtomic(outputFile, { ...body, bootstrapId, credential });
  return { bootstrapId, outputFile };
}

if (require.main === module) {
  try {
    const requestPath = process.argv[2];
    if (!path.isAbsolute(requestPath) || fs.realpathSync.native(requestPath) !== requestPath) fail();
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    const temporary = path.join(request.configuration.operationRoot, 'sqlite-bootstrap-temp');
    if (fs.realpathSync.native(request.configuration.operationRoot) !== request.configuration.operationRoot) fail();
    fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
    if (fs.realpathSync.native(temporary) !== temporary || fs.lstatSync(temporary).isSymbolicLink()) fail();
    process.env.SQLITE_TMPDIR = temporary; process.env.TMPDIR = temporary;
    console.log(JSON.stringify(prepareColdResetBootstrap({ ...request, secretRoot: process.env.SHELFDECK_SECRET_ROOT })));
  } catch (error) { console.error(error.code || 'RESET_BOOTSTRAP_FAILED'); process.exitCode = 1; }
}
module.exports = Object.freeze({ prepareColdResetBootstrap });
