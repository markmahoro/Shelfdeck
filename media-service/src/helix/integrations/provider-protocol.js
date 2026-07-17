'use strict';

const catalog = require('../contracts/ports/p5-provider-operation-contracts.json');

const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/;
const operations = new Map(catalog.operations.map((operation) => [operation.operationId, Object.freeze(operation)]));

class ProviderProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderProtocolError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new ProviderProtocolError(code, message, details); }
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(code, 'Provider value must match the exact contract.');
}
function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_PROVIDER_FIELD', 'Provider field is invalid.', { field });
  return value;
}
function positive(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P5_PROVIDER_INTEGER', 'Provider integer must be positive.', { field });
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonical(value)); }
function freezeClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value)) fail('P5_PROVIDER_BINARY_RESULT_FORBIDDEN', 'Provider results must use typed Artifact handles, not inline bytes.');
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeClone(item)])));
  }
  return value;
}

function typedRef(value, field) {
  exact(value, ['objectType', 'objectId', 'revision', 'digest'], 'P5_PROVIDER_TYPED_REF_SHAPE');
  token(value.objectType, field + '.objectType');
  token(value.objectId, field + '.objectId');
  positive(value.revision, field + '.revision');
  if (!SHA256.test(value.digest || '')) fail('P5_PROVIDER_TYPED_REF_DIGEST', 'Provider typed reference digest is invalid.', { field });
  return Object.freeze({ ...value });
}

function validateInput(kind, input) {
  if (kind === 'empty') { exact(input, [], 'P5_PROVIDER_INPUT_SHAPE'); return Object.freeze({}); }
  if (kind === 'perception-source') {
    exact(input, ['sourceRef', 'cursor', 'limit'], 'P5_PROVIDER_INPUT_SHAPE');
    if (input.cursor !== null) token(input.cursor, 'cursor');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) fail('P5_PROVIDER_LIMIT', 'Provider page limit is invalid.');
    return Object.freeze({ sourceRef: typedRef(input.sourceRef, 'sourceRef'), cursor: input.cursor, limit: input.limit });
  }
  if (kind === 'person-hint') {
    exact(input, ['personHintRef', 'limit'], 'P5_PROVIDER_INPUT_SHAPE');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) fail('P5_PROVIDER_LIMIT', 'Provider person limit is invalid.');
    return Object.freeze({ personHintRef: typedRef(input.personHintRef, 'personHintRef'), limit: input.limit });
  }
  if (kind === 'product-identity') {
    exact(input, ['productIdentityRef', 'locale'], 'P5_PROVIDER_INPUT_SHAPE');
    return Object.freeze({ productIdentityRef: typedRef(input.productIdentityRef, 'productIdentityRef'), locale: token(input.locale, 'locale') });
  }
  if (kind === 'acquisition-query') {
    exact(input, ['acquisitionQueryRef', 'limit'], 'P5_PROVIDER_INPUT_SHAPE');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) fail('P5_PROVIDER_LIMIT', 'Provider search limit is invalid.');
    return Object.freeze({ acquisitionQueryRef: typedRef(input.acquisitionQueryRef, 'acquisitionQueryRef'), limit: input.limit });
  }
  if (kind === 'artifact-target') {
    exact(input, ['sourceRef', 'workspaceTargetRef'], 'P5_PROVIDER_INPUT_SHAPE');
    return Object.freeze({ sourceRef: typedRef(input.sourceRef, 'sourceRef'), workspaceTargetRef: typedRef(input.workspaceTargetRef, 'workspaceTargetRef') });
  }
  if (kind === 'acquisition-request') {
    exact(input, ['candidateRef', 'deliveryContractRef'], 'P5_PROVIDER_INPUT_SHAPE');
    return Object.freeze({ candidateRef: typedRef(input.candidateRef, 'candidateRef'), deliveryContractRef: typedRef(input.deliveryContractRef, 'deliveryContractRef') });
  }
  fail('P5_PROVIDER_INPUT_KIND', 'Provider input kind is unsupported.');
}

function validateHandle(handle, operation, now) {
  exact(handle, ['schemaRef', 'schemaVersion', 'handleId', 'integrationId', 'integrationType', 'configRevision',
    'secretRef', 'allowedOperation', 'expiresAtMs', 'fenceDigest'], 'P5_PROVIDER_HANDLE_SHAPE');
  if (handle.schemaRef !== 'helix://contracts/types/IntegrationHandle/v1' || handle.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(operation.atoms, handle.integrationType) || handle.allowedOperation !== operation.operationId ||
      !Number.isSafeInteger(handle.expiresAtMs) || handle.expiresAtMs < now || !SHA256.test(handle.fenceDigest || '')) {
    fail('P5_PROVIDER_HANDLE_DENIED', 'Integration Handle is stale or does not authorize this provider operation.');
  }
  token(handle.handleId, 'handleId'); token(handle.integrationId, 'integrationId'); token(handle.secretRef, 'secretRef');
  positive(handle.configRevision, 'configRevision');
}

function validateLease(lease, handle, operation, now) {
  exact(lease, ['schemaRef', 'schemaVersion', 'handleId', 'secretRef', 'ownerScopeType', 'ownerScopeId', 'secretKind',
    'purpose', 'revision', 'issuedAtMs', 'expiresAtMs', 'fenceDigest'], 'P5_PROVIDER_LEASE_SHAPE');
  if (lease.schemaRef !== 'helix://contracts/ports/platform.secret-lease.resolve/v1/output' || lease.schemaVersion !== 1 ||
      lease.secretRef !== handle.secretRef || lease.ownerScopeType !== 'integration' || lease.ownerScopeId !== handle.integrationId ||
      lease.purpose !== operation.operationId || lease.expiresAtMs < now || !SHA256.test(lease.fenceDigest || '')) {
    fail('P5_PROVIDER_LEASE_DENIED', 'Secret lease does not match the exact provider operation.');
  }
}

function validateArtifact(value) {
  exact(value, ['schemaRef', 'schemaVersion', 'artifactHandleId', 'artifactKind', 'ownerDomain', 'ownerScope', 'storageRef',
    'digestAlgorithm', 'digestHex', 'sizeBytes', 'mediaType', 'provenanceRef', 'referenceRevision'], 'P5_PROVIDER_ARTIFACT_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ArtifactHandle/v1' || value.schemaVersion !== 1 ||
      value.digestAlgorithm !== 'sha256' || !SHA256.test(value.digestHex || '') || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) {
    fail('P5_PROVIDER_ARTIFACT_INVALID', 'Provider Artifact Handle is invalid.');
  }
  return value;
}

function validateJob(value, request) {
  exact(value, ['schemaRef', 'schemaVersion', 'receiptId', 'integrationId', 'externalJobId', 'operationKind',
    'idempotencyKey', 'requestDigest', 'configRevision', 'createdAtMs'], 'P5_PROVIDER_JOB_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ExternalJobReceipt/v1' || value.schemaVersion !== 1 ||
      value.integrationId !== request.integrationHandle.integrationId || value.operationKind !== request.operationId ||
      value.idempotencyKey !== request.idempotencyKey || value.requestDigest !== request.requestDigest ||
      value.configRevision !== request.integrationHandle.configRevision) fail('P5_PROVIDER_JOB_MISMATCH', 'External Job Receipt does not match the request fence.');
  return value;
}

function validateResult(kind, value, request) {
  if (kind === 'availability') {
    exact(value, ['availabilityEvidenceRef'], 'P5_PROVIDER_RESULT_SHAPE');
    typedRef(value.availabilityEvidenceRef, 'availabilityEvidenceRef');
  } else if (kind === 'reference') {
    exact(value, ['resultRef'], 'P5_PROVIDER_RESULT_SHAPE'); typedRef(value.resultRef, 'resultRef');
  } else if (kind === 'reference-list') {
    exact(value, ['resultRefs', 'nextCursor'], 'P5_PROVIDER_RESULT_SHAPE');
    if (!Array.isArray(value.resultRefs) || value.resultRefs.length > 100) fail('P5_PROVIDER_RESULT_BOUND', 'Provider result reference list is invalid.');
    value.resultRefs.forEach((item, index) => typedRef(item, 'resultRefs.' + index));
    if (value.nextCursor !== null) token(value.nextCursor, 'nextCursor');
  } else if (kind === 'artifact') {
    exact(value, ['artifactHandle'], 'P5_PROVIDER_RESULT_SHAPE'); validateArtifact(value.artifactHandle);
  } else if (kind === 'job') {
    exact(value, ['externalJobReceipt'], 'P5_PROVIDER_RESULT_SHAPE'); validateJob(value.externalJobReceipt, request);
  } else fail('P5_PROVIDER_RESULT_KIND', 'Provider result kind is unsupported.');
  return freezeClone(value);
}

function createAdapter(effectClass, options) {
  if (!options || !options.transport || typeof options.transport.execute !== 'function' ||
      !options.secretLeaseBroker || typeof options.secretLeaseBroker.consumeAsync !== 'function' ||
      !options.timeoutController || typeof options.timeoutController.run !== 'function' ||
      typeof options.now !== 'function' || typeof options.digest !== 'function') {
    fail('P5_PROVIDER_DEPENDENCIES', 'Provider transport, async Secret Lease broker, timeout controller, and clock are required.');
  }
  return Object.freeze({
    async execute(request) {
      exact(request, ['integrationHandle', 'secretLeaseHandle', 'operationId', 'idempotencyKey', 'requestDigest', 'timeoutMs', 'input'],
        'P5_PROVIDER_REQUEST_SHAPE');
      const operation = operations.get(request.operationId);
      if (!operation || operation.effectClass !== effectClass) fail('P5_PROVIDER_OPERATION_DENIED', 'Provider operation is unknown or uses the wrong Effect Class port.');
      const now = options.now();
      if (!Number.isSafeInteger(now) || now < 0) fail('P5_PROVIDER_TIME', 'Provider clock is invalid.');
      validateHandle(request.integrationHandle, operation, now);
      validateLease(request.secretLeaseHandle, request.integrationHandle, operation, now);
      token(request.idempotencyKey, 'idempotencyKey');
      if (!SHA256.test(request.requestDigest || '') || !Number.isSafeInteger(request.timeoutMs) ||
          request.timeoutMs < 1 || request.timeoutMs > operation.maxTimeoutMs) fail('P5_PROVIDER_REQUEST_FENCE', 'Provider request digest or timeout is invalid.');
      const input = validateInput(operation.inputKind, request.input);
      const digestBasis = Object.freeze({
        integrationId: request.integrationHandle.integrationId, integrationType: request.integrationHandle.integrationType,
        configRevision: request.integrationHandle.configRevision, operationId: request.operationId,
        idempotencyKey: request.idempotencyKey, input
      });
      if (options.digest(canonicalJson(digestBasis)) !== request.requestDigest) fail('P5_PROVIDER_REQUEST_DIGEST_MISMATCH', 'Provider request digest does not match the exact normalized request.');
      if (Buffer.byteLength(canonicalJson(input), 'utf8') > 32768) fail('P5_PROVIDER_INPUT_BOUND', 'Provider input exceeds the port bound.');
      let response;
      try {
        response = await options.secretLeaseBroker.consumeAsync(request.secretLeaseHandle, (secretBytes) =>
          options.timeoutController.run(options.transport.execute(Object.freeze({
            protocolVersion: 1, providerType: request.integrationHandle.integrationType,
            protocolAtomId: operation.atoms[request.integrationHandle.integrationType],
            integrationId: request.integrationHandle.integrationId, configRevision: request.integrationHandle.configRevision,
            operationId: request.operationId, effectClass, idempotencyKey: request.idempotencyKey,
            requestDigest: request.requestDigest, timeoutMs: request.timeoutMs, input, secretBytes
          })), request.timeoutMs));
      } catch (error) {
        if (error instanceof ProviderProtocolError) throw error;
        fail('P5_PROVIDER_TRANSPORT_FAILED', 'External Provider invocation failed.');
      }
      exact(response, ['transportRequestId', 'statusCode', 'responseBytes', 'responseDigest', 'result'], 'P5_PROVIDER_RESPONSE_SHAPE');
      token(response.transportRequestId, 'transportRequestId');
      const result = validateResult(operation.resultKind, response.result, request);
      const resultJson = canonicalJson(result);
      const actualResponseBytes = Buffer.byteLength(resultJson, 'utf8');
      if (!Number.isSafeInteger(response.statusCode) || response.statusCode < 200 || response.statusCode > 299 ||
          response.responseBytes !== actualResponseBytes || actualResponseBytes > operation.maxResponseBytes ||
          response.responseDigest !== options.digest(resultJson)) fail('P5_PROVIDER_RESPONSE_INVALID', 'Provider response status, size, or digest is invalid.');
      return Object.freeze({
        schemaRef: 'helix://contracts/ports/integration.external-provider-' +
          (effectClass === 'pure_observation' ? 'observation' : effectClass === 'workspace_write' ? 'artifact' : 'request') + '.execute/v1/output',
        schemaVersion: 1, operationId: operation.operationId, effectClass, integrationId: request.integrationHandle.integrationId,
        configRevision: request.integrationHandle.configRevision, idempotencyKey: request.idempotencyKey,
        requestDigest: request.requestDigest, transportRequestId: response.transportRequestId,
        responseDigest: response.responseDigest, responseBytes: response.responseBytes, result
      });
    }
  });
}

function createProviderObservationAdapter(options) { return createAdapter('pure_observation', options); }
function createProviderArtifactAdapter(options) { return createAdapter('workspace_write', options); }
function createProviderRequestAdapter(options) { return createAdapter('external_request', options); }

module.exports = Object.freeze({
  ProviderProtocolError, canonicalJson, createProviderArtifactAdapter,
  createProviderObservationAdapter, createProviderRequestAdapter
});
