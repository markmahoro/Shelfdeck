'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { createResetManagementCredentialReader } = require('./helix/platform/public/admin-credential-runtime');
const { createAdminCredentialSecretStore } = require('./admin-credential-secret-store');
const { fileDigest } = require('../scripts/formation-reset-generation');
const SCHEMA = 'shelfdeck.cold-reset-bootstrap@1';
function fail(code = 'RESET_BOOTSTRAP_PROOF_INVALID') { throw Object.assign(new Error(code), { code, statusCode: 409 }); }
function read(file) {
  if (!path.isAbsolute(file) || fs.realpathSync.native(file) !== file || !fs.lstatSync(file).isFile()) fail();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function databaseFiles(dataDir) {
  return ['', '-wal'].map(suffix => {
    const file = path.join(dataDir, 'shelfdeck.db' + suffix), stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) { if (!suffix) fail(); return { suffix, absent: true }; }
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file) !== file) fail();
    return { suffix, bytes: stat.size, sha256: fileDigest(file) };
  });
}

// This explicit deployment proof is independent of the business schema. It
// never turns a failed normal startup into permission to reset or resume.
function readBootstrapIdentity(file) {
  const record = read(file), { bootstrapId, credential, ...body } = record;
  if (body.schema !== SCHEMA || canonicalDigest(body) !== bootstrapId || credential?.generationId !== bootstrapId ||
      !Number.isSafeInteger(body.runtimeRevision) || body.runtimeRevision < 1) fail();
  return record;
}
function loadColdResetBootstrap({ file, dataDir, configuration, secretRoot }) {
  const record = readBootstrapIdentity(file), { bootstrapId, credential, ...body } = record;
  if (body.dataDir !== dataDir || body.configurationDigest !== canonicalDigest(configuration)) fail();
  function assertStopped({ pending = false } = {}) {
    const intent = read(path.join(dataDir, 'operator-runtime', 'intent.json'));
    if (intent.desiredMode !== 'stopped') fail();
    if (pending && intent.pendingReset && intent.resetWorkflow?.spec.bootstrapId === bootstrapId &&
        intent.revision === body.runtimeRevision + 1) return intent;
    if (intent.pendingReset || intent.revision !== body.runtimeRevision || canonicalDigest(intent) !== body.intentDigest) fail();
    const stop = read(path.join(dataDir, 'operator-runtime', body.stopOperationId + '.json'));
    if (stop.operationId !== body.stopOperationId || stop.kind !== 'stop' || stop.state !== 'completed' || stop.result?.mode !== 'stopped' ||
        canonicalDigest(stop) !== body.stopReceiptDigest) fail();
    return intent;
  }
  const readCredential = createResetManagementCredentialReader({ descriptor: credential,
    secretStore: createAdminCredentialSecretStore({ dataDir, secretRoot }),
    assertStoppedGeneration(id) { if (id !== bootstrapId) fail(); assertStopped({ pending: true }); } });
  readCredential();
  function assertSourceUnchanged() {
    assertStopped();
    if (canonicalDigest(databaseFiles(dataDir)) !== canonicalDigest(body.databaseFiles)) fail('RESET_BOOTSTRAP_SOURCE_CHANGED');
  }
  assertSourceUnchanged();
  return Object.freeze({ bootstrapId, runtimeRevision: body.runtimeRevision, readCredential, assertStopped, assertSourceUnchanged,
    drainReceipt() { assertStopped({ pending: true }); return { allFileWritersStopped: true, runtimeRevision: body.runtimeRevision,
      deploymentClosureDigest: canonicalDigest(body.closure), bootstrapId }; } });
}

module.exports = Object.freeze({ SCHEMA, databaseFiles, readBootstrapIdentity, loadColdResetBootstrap });
