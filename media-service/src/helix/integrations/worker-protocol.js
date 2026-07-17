'use strict';

const catalog = require('../contracts/ports/p5-worker-operation-contracts.json');

const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/;
const operations = new Map(catalog.operations.map((item) => [item.operationId, Object.freeze({ ...item })]));

class WorkerProtocolError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'WorkerProtocolError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new WorkerProtocolError(code, message, details); }
function exact(value, fields, code) { if (!value || typeof value !== 'object' || Array.isArray(value) ||
  JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(code, 'Worker protocol value must match the exact contract.'); }
function token(value, field) { if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_WORKER_PROTOCOL_TOKEN', 'Worker protocol token is invalid.', { field }); return value; }
function digest(value, field) { if (typeof value !== 'string' || !SHA256.test(value)) fail('P5_WORKER_PROTOCOL_DIGEST', 'Worker protocol digest is invalid.', { field }); return value; }
function time(value, field) { if (!Number.isSafeInteger(value) || value < 0) fail('P5_WORKER_PROTOCOL_TIME', 'Worker protocol time is invalid.', { field }); return value; }
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function safe(error) { return new WorkerProtocolError(error && /^P5_WORKER_PROTOCOL_/.test(error.code || '') ? error.code : 'P5_WORKER_PROTOCOL_EXECUTION_FAILED', 'Worker protocol operation failed.', {}); }

function validateInput(operation, input) {
  if (operation.inputKind === 'asset-registration') {
    exact(input, ['sourceHandleDigest'], 'P5_WORKER_PROTOCOL_INPUT_SHAPE'); digest(input.sourceHandleDigest, 'sourceHandleDigest');
  } else if (operation.inputKind === 'asset-upload') {
    exact(input, ['materialHandleDigest','sizeBytes','workerAssetReceipt'], 'P5_WORKER_PROTOCOL_INPUT_SHAPE');
    digest(input.materialHandleDigest, 'materialHandleDigest');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) fail('P5_WORKER_PROTOCOL_SIZE', 'Worker upload size is invalid.');
    exact(input.workerAssetReceipt, ['configRevision','createdAtMs','registrationReceipt','schemaRef','schemaVersion','sourceHandleDigest','workerAssetId','workerId'], 'P5_WORKER_PROTOCOL_ASSET_RECEIPT_SHAPE');
    if (input.workerAssetReceipt.schemaRef !== 'helix://contracts/types/WorkerAssetReceipt/v1' || input.workerAssetReceipt.schemaVersion !== 1) fail('P5_WORKER_PROTOCOL_ASSET_RECEIPT', 'Worker Asset Receipt is invalid.');
  } else {
    exact(input, ['analysisSpecDigest','workerUploadReceipt'], 'P5_WORKER_PROTOCOL_INPUT_SHAPE'); digest(input.analysisSpecDigest, 'analysisSpecDigest');
    exact(input.workerUploadReceipt, ['completedAtMs','schemaRef','schemaVersion','sizeBytes','uploadReceipt','uploadedDigest','workerAssetId','workerId'], 'P5_WORKER_PROTOCOL_UPLOAD_RECEIPT_SHAPE');
    if (input.workerUploadReceipt.schemaRef !== 'helix://contracts/types/WorkerUploadReceipt/v1' || input.workerUploadReceipt.schemaVersion !== 1) fail('P5_WORKER_PROTOCOL_UPLOAD_RECEIPT', 'Worker Upload Receipt is invalid.');
  }
  if (Buffer.byteLength(canonical(input), 'utf8') > operation.maxInputBytes) fail('P5_WORKER_PROTOCOL_INPUT_BOUND', 'Worker protocol input is too large.');
  return freeze(input);
}

function validateAuthority(request, operation, now) {
  const handle = request.workerHandle;
  exact(handle, ['allowedOperation','capabilityDigest','expiresAtMs','fenceDigest','handleId','protocolVersion','schemaRef','schemaVersion','secretRef','workerId','workerRevision'], 'P5_WORKER_PROTOCOL_HANDLE_SHAPE');
  if (handle.schemaRef !== 'helix://contracts/types/WorkerHandle/v1' || handle.schemaVersion !== 1 || handle.allowedOperation !== operation.operationId ||
      handle.expiresAtMs <= now) fail('P5_WORKER_PROTOCOL_HANDLE_STALE', 'Worker Handle is stale or bound to another operation.');
  token(handle.handleId, 'handleId'); token(handle.workerId, 'workerId'); token(handle.secretRef, 'secretRef');
  digest(handle.capabilityDigest, 'capabilityDigest'); digest(handle.fenceDigest, 'fenceDigest');
  const lease = request.secretLeaseHandle;
  if (!lease || lease.ownerScopeType !== 'worker' || lease.ownerScopeId !== handle.workerId || lease.secretRef !== handle.secretRef ||
      lease.purpose !== operation.operationId || lease.expiresAtMs < now || lease.expiresAtMs > handle.expiresAtMs) {
    fail('P5_WORKER_PROTOCOL_SECRET_SCOPE', 'Secret Lease does not match the exact Worker operation.');
  }
  if (request.input.workerAssetReceipt && request.input.workerAssetReceipt.workerId !== handle.workerId) fail('P5_WORKER_PROTOCOL_RECEIPT_WORKER', 'Asset Receipt belongs to another Worker.');
  if (request.input.workerUploadReceipt && request.input.workerUploadReceipt.workerId !== handle.workerId) fail('P5_WORKER_PROTOCOL_RECEIPT_WORKER', 'Upload Receipt belongs to another Worker.');
  return handle;
}

function createWorkerProtocolAdapter(options) {
  if (!options || !options.transport || typeof options.transport.execute !== 'function' || !options.secretLeaseBroker ||
      typeof options.secretLeaseBroker.consumeAsync !== 'function' || typeof options.digest !== 'function' || typeof options.now !== 'function') {
    fail('P5_WORKER_PROTOCOL_DEPENDENCIES', 'Worker protocol dependencies are required.');
  }
  async function execute(request) {
    try {
      exact(request, ['capabilityRef','effectClass','idempotencyKey','input','operationId','requestDigest','secretLeaseHandle','workerHandle'], 'P5_WORKER_PROTOCOL_REQUEST_SHAPE');
      const operation = operations.get(request.operationId);
      if (!operation || request.capabilityRef !== operation.capabilityRef || request.effectClass !== 'external_request') fail('P5_WORKER_PROTOCOL_OPERATION', 'Worker operation does not match the closed catalog.');
      token(request.idempotencyKey, 'idempotencyKey');
      const input = validateInput(operation, request.input); const now = options.now(); const handle = validateAuthority(request, operation, now);
      const expectedDigest = options.digest(canonical({ operationId: operation.operationId, capabilityRef: operation.capabilityRef,
        idempotencyKey: request.idempotencyKey, workerId: handle.workerId, workerRevision: handle.workerRevision,
        capabilityDigest: handle.capabilityDigest, input }));
      if (request.requestDigest !== expectedDigest) fail('P5_WORKER_PROTOCOL_REQUEST_DIGEST', 'Worker request digest does not match the typed request.');
      const result = await options.secretLeaseBroker.consumeAsync(request.secretLeaseHandle, (secretBytes) => options.transport.execute(Object.freeze({
        protocolAtomId: operation.protocolAtomId, workerHandleId: handle.handleId, protocolVersion: handle.protocolVersion,
        idempotencyKey: request.idempotencyKey, requestDigest: expectedDigest, input, secretBytes, timeoutMs: operation.timeoutMs
      })));
      return normalizeResult(operation, handle, request, result, options);
    } catch (error) { throw safe(error); }
  }
  return freeze({ execute });
}

function normalizeResult(operation, handle, request, result, options) {
  if (operation.resultKind === 'WorkerAssetReceipt') {
    exact(result, ['configRevision','createdAtMs','registrationReceipt','sourceHandleDigest','workerAssetId'], 'P5_WORKER_PROTOCOL_RESULT_SHAPE');
    if (result.sourceHandleDigest !== request.input.sourceHandleDigest || result.configRevision !== handle.workerRevision) fail('P5_WORKER_PROTOCOL_RESULT_BINDING', 'Worker Asset Receipt does not bind the request.');
    return freeze({ schemaRef: 'helix://contracts/types/WorkerAssetReceipt/v1', schemaVersion: 1, workerAssetId: token(result.workerAssetId, 'workerAssetId'),
      workerId: handle.workerId, sourceHandleDigest: digest(result.sourceHandleDigest, 'sourceHandleDigest'), registrationReceipt: token(result.registrationReceipt, 'registrationReceipt'),
      configRevision: result.configRevision, createdAtMs: time(result.createdAtMs, 'createdAtMs') });
  }
  if (operation.resultKind === 'WorkerUploadReceipt') {
    exact(result, ['completedAtMs','sizeBytes','uploadReceipt','uploadedDigest','workerAssetId'], 'P5_WORKER_PROTOCOL_RESULT_SHAPE');
    if (result.workerAssetId !== request.input.workerAssetReceipt.workerAssetId || result.uploadedDigest !== request.input.materialHandleDigest || result.sizeBytes !== request.input.sizeBytes) fail('P5_WORKER_PROTOCOL_RESULT_BINDING', 'Worker Upload Receipt does not bind the request.');
    return freeze({ schemaRef: 'helix://contracts/types/WorkerUploadReceipt/v1', schemaVersion: 1, workerAssetId: token(result.workerAssetId, 'workerAssetId'),
      workerId: handle.workerId, uploadReceipt: token(result.uploadReceipt, 'uploadReceipt'), uploadedDigest: digest(result.uploadedDigest, 'uploadedDigest'),
      sizeBytes: result.sizeBytes, completedAtMs: time(result.completedAtMs, 'completedAtMs') });
  }
  exact(result, ['createdAtMs','externalJobId','receiptId'], 'P5_WORKER_PROTOCOL_RESULT_SHAPE');
  return freeze({ schemaRef: 'helix://contracts/types/ExternalJobReceipt/v1', schemaVersion: 1, receiptId: token(result.receiptId, 'receiptId'),
    integrationId: handle.workerId, externalJobId: token(result.externalJobId, 'externalJobId'), operationKind: operation.operationId,
    idempotencyKey: request.idempotencyKey, requestDigest: request.requestDigest, configRevision: handle.workerRevision,
    createdAtMs: time(result.createdAtMs, 'createdAtMs') });
}

module.exports = Object.freeze({ WorkerProtocolError, createWorkerProtocolAdapter });
