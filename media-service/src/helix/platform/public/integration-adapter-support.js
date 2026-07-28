'use strict';

const crypto = require('node:crypto');
const {
  canonicalDigest,
  canonicalJson,
} = require('../../contracts/canonical-json');
const {
  requireIntegrationProfile,
} = require('../application/integration-profile-catalog');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomUUID() {
  return crypto.randomUUID();
}

function buildProductIntegrationHandle(value) {
  const basis = {
    schemaRef: 'helix://contracts/types/IntegrationHandle/v1',
    schemaVersion: 1,
    handleId: canonicalDigest({
      schema: 'platform.integration-handle-id@1',
      integrationId: value.integrationId,
      configRevision: value.configRevision,
      allowedOperation: value.allowedOperation,
      artifactKind: value.artifactKind,
    }),
    integrationId: value.integrationId,
    integrationType: value.integrationType,
    configRevision: value.configRevision,
    secretRef: value.secretRef,
    allowedOperation: value.allowedOperation,
    expiresAtMs: value.expiresAtMs,
  };
  return Object.freeze({
    ...basis,
    fenceDigest: canonicalDigest({
      schema: 'platform.integration-handle-fence@1',
      ...basis,
    }),
  });
}

function validateProductIntegrationHandle(handle, expected, now) {
  if (!handle || typeof handle !== 'object' ||
      Array.isArray(handle) ||
      Object.keys(handle).sort().join(',') !== [
        'allowedOperation',
        'configRevision',
        'expiresAtMs',
        'fenceDigest',
        'handleId',
        'integrationId',
        'integrationType',
        'schemaRef',
        'schemaVersion',
        'secretRef',
      ].sort().join(',') ||
      !Number.isSafeInteger(handle.expiresAtMs) ||
      handle.expiresAtMs < now) {
    return false;
  }
  const rebuilt = buildProductIntegrationHandle({
    ...expected,
    expiresAtMs: handle.expiresAtMs,
  });
  return canonicalJson(handle) === canonicalJson(rebuilt);
}

module.exports = Object.freeze({
  buildProductIntegrationHandle,
  randomUUID,
  requireIntegrationProfile,
  sha256,
  validateProductIntegrationHandle,
});
