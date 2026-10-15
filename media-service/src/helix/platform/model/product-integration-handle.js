'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');

function buildProductIntegrationHandle(value) {
  const sourceFields = value.integrationType === 'jav_source' ? { siteRef: value.siteRef, authMode: value.authMode,
    endpointProfileDigest: value.endpointProfileDigest, networkRouteDigest: value.networkRouteDigest } : {};
  const basis = { schemaRef: 'helix://contracts/types/IntegrationHandle/v1', schemaVersion: 1,
    handleId: canonicalDigest({ schema: 'platform.integration-handle-id@1', integrationId: value.integrationId,
      configRevision: value.configRevision, allowedOperation: value.allowedOperation, artifactKind: value.artifactKind, ...sourceFields }),
    integrationId: value.integrationId, integrationType: value.integrationType, configRevision: value.configRevision,
    secretRef: value.secretRef, allowedOperation: value.allowedOperation, expiresAtMs: value.expiresAtMs, ...sourceFields };
  return Object.freeze({ ...basis, fenceDigest: canonicalDigest({ schema: 'platform.integration-handle-fence@1', ...basis }) });
}
function validateProductIntegrationHandle(handle, expected, now) {
  const fields = ['allowedOperation', 'configRevision', 'expiresAtMs', 'fenceDigest', 'handleId', 'integrationId',
    'integrationType', 'schemaRef', 'schemaVersion', 'secretRef',
    ...(handle?.integrationType === 'jav_source' ? ['siteRef', 'authMode', 'endpointProfileDigest', 'networkRouteDigest'] : [])];
  if (!handle || Object.getPrototypeOf(handle) !== Object.prototype ||
      Object.keys(handle).sort().join(',') !== fields.sort().join(',') || !Number.isSafeInteger(handle.expiresAtMs) || handle.expiresAtMs < now) return false;
  return canonicalJson(handle) === canonicalJson(buildProductIntegrationHandle({ ...expected, expiresAtMs: handle.expiresAtMs }));
}
module.exports = Object.freeze({ buildProductIntegrationHandle, validateProductIntegrationHandle });
