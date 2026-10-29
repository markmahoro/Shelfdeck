'use strict';

const { canonicalDigest, canonicalJson } = require('./canonical-json');
const { JAV_SITE_REFS } = require('./jav-source-contracts');

const SCHEMA = 'helix://contracts/domain-types/JavSourceQualification/v1';
const FIELDS = Object.freeze(['siteRef', 'integrationId', 'configRevision', 'endpointProfileDigest', 'networkRouteDigest', 'authMode']);

function buildJavSourceQualification(source, allowedOperation, artifactKind = null) {
  if (!source || !JAV_SITE_REFS.includes(source.siteRef) || !source.integrationId ||
      !Number.isSafeInteger(source.configRevision) || source.configRevision < 1 || source.authMode !== 'anonymous' ||
      !['endpointProfileDigest', 'networkRouteDigest'].every(key => /^[a-f0-9]{64}$/.test(source[key])) ||
      !['libra.product_identity.evidence.observe@1', 'libra.product_metadata.fetch@1', 'libra.product_artifact.acquire@1'].includes(allowedOperation) ||
      (allowedOperation === 'libra.product_artifact.acquire@1' ? !['poster', 'fanart'].includes(artifactKind) : artifactKind !== null)) {
    throw new TypeError('JAV source binding requires exact qualified source and operation.');
  }
  const value = { schemaRef:SCHEMA, schemaVersion:1,
    ...Object.fromEntries(FIELDS.map(key => [key, source[key]])), allowedOperation, artifactKind };
  return Object.freeze({ ...value, sourceFenceDigest:canonicalDigest(value) });
}

function resolveJavQualifiedHandle(binding, source, allowedOperation, resolve, artifactKind = null) {
  const expected = buildJavSourceQualification(source, allowedOperation, artifactKind);
  if (canonicalJson(binding) !== canonicalJson(expected))
    throw new TypeError('JAV execution binding differs from its frozen source qualification.');
  const handle = resolve({ siteRef:binding.siteRef, operationId:allowedOperation, ...(artifactKind ? { artifactKind } : {}) });
  if (!handle || handle.integrationType !== 'jav_source' || handle.allowedOperation !== allowedOperation ||
      FIELDS.some(key => handle[key] !== binding[key])) {
    const error = new Error('JAV source configuration changed after planning.');
    error.code = 'LIBRA_JAV_SOURCE_CONFIG_STALE';
    throw error;
  }
  return handle;
}

module.exports = Object.freeze({ buildJavSourceQualification, resolveJavQualifiedHandle });
