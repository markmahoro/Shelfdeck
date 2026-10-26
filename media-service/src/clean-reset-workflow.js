'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { readColdResetState } = require('./clean-reset-generation-fence');
const SCHEMA = 'shelfdeck.cold-reset-workflow@1', SHA = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code, statusCode: 409 }); }
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('RESET_WORKFLOW_PATH_UNSAFE');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function files(dataDir) {
  const root = path.join(dataDir, 'operator-runtime');
  const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!path.isAbsolute(dataDir) || key(fs.realpathSync.native(root)) !== key(root) || fs.lstatSync(root).isSymbolicLink())
    fail('RESET_WORKFLOW_PATH_UNSAFE');
  return { root, intent: path.join(root, 'intent.json') };
}
function operation(dataDir, operationId) {
  if (!SHA.test(operationId || '')) fail('RESET_WORKFLOW_OPERATION_INVALID');
  const value = read(path.join(files(dataDir).root, operationId + '.json'));
  if (value.operationId !== operationId || value.kind !== 'reset' || !SHA.test(value.requestDigest || '') ||
      !['pending', 'failed', 'completed'].includes(value.state)) fail('RESET_WORKFLOW_OPERATION_INVALID');
  return value;
}
function intentDigest(intent) { const { resetWorkflow, ...body } = intent; return canonicalDigest(body); }
function prepareResetWorkflow({ spec, credential, drainReceipt = null, intent }) {
  const pending = intent.pendingReset;
  if (intent.desiredMode !== 'stopped' || intent.revision !== spec.expectedRuntimeRevision ||
      pending?.resetId !== spec.generationId || pending.previewDigest !== spec.approvedPreflight?.previewDigest ||
      credential?.generationId !== spec.generationId) fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  const prior = operation(spec.dataDir, pending.operationId);
  if (canonicalDigest({ kind: 'reset', body: pending.request }) !== prior.requestDigest ||
      canonicalDigest({ actorId: credential.credentialId, idempotencyKey: pending.request?.idempotencyKey }) !== pending.operationId)
    fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  if (drainReceipt && (drainReceipt.allFileWritersStopped !== true || drainReceipt.runtimeRevision !== spec.expectedRuntimeRevision - 1))
    fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  const body = { schema: SCHEMA, spec, credential, drainReceipt, request: pending.request, operationId: pending.operationId,
    requestDigest: prior.requestDigest, runtimeIntentDigest: intentDigest(intent) };
  return { ...body, recordDigest: canonicalDigest(body) };
}
function loadResetWorkflow(dataDir) {
  const saved = read(files(dataDir).intent).resetWorkflow;
  if (!saved || typeof saved !== 'object') fail('RESET_WORKFLOW_CORRUPT');
  const { recordDigest, ...body } = saved;
  if (body.schema !== SCHEMA || canonicalDigest(body) !== recordDigest || body.spec?.dataDir !== dataDir ||
      !SHA.test(body.spec?.generationId || '') || body.credential?.generationId !== body.spec.generationId ||
      canonicalDigest({ kind: 'reset', body: body.request }) !== body.requestDigest)
    fail('RESET_WORKFLOW_CORRUPT');
  assertResetWorkflow(body);
  return body;
}
function assertResetWorkflow(workflow) {
  const { spec } = workflow, intent = read(files(spec.dataDir).intent);
  const state = readColdResetState(spec.dataDir), prior = operation(spec.dataDir, workflow.operationId);
  if (intent.desiredMode !== 'stopped' || prior.requestDigest !== workflow.requestDigest)
    fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  // A prior completed generation may still be present before the new fence
  // is written. readColdResetState has already verified its matching marker.
  const fence = state?.fence.generationId === spec.generationId ? state.fence : null;
  if (state && !fence && (state.fence.phase !== 'complete' || !intent.pendingReset)) fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  if (intent.pendingReset) {
    if (intentDigest(intent) !== workflow.runtimeIntentDigest || intent.pendingReset.resetId !== spec.generationId ||
        intent.pendingReset.operationId !== workflow.operationId) fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  } else if (fence?.phase !== 'complete' || prior.state !== 'completed' || intent.revision !== spec.expectedRuntimeRevision + 1)
    fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
  return { intent, fence, operation: prior };
}
function assertResetRetry(workflow, body, actor) {
  const state = assertResetWorkflow(workflow);
  if (body?.confirmed !== true || typeof body.idempotencyKey !== 'string' ||
      canonicalDigest({ kind: 'reset', body }) !== workflow.requestDigest ||
      canonicalDigest({ actorId: actor?.actorId, idempotencyKey: body.idempotencyKey }) !== workflow.operationId)
    fail('RUNTIME_OPERATION_KEY_CONFLICT');
  if (!['closed', 'complete'].includes(state.fence?.phase)) fail('RESET_FENCE_CLOSE_NOT_PROVEN');
  return state;
}

module.exports = Object.freeze({ prepareResetWorkflow, loadResetWorkflow, assertResetWorkflow, assertResetRetry });
