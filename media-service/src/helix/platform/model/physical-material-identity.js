'use strict';

const SHA256 = /^[0-9a-f]{64}$/;

class PhysicalMaterialIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PhysicalMaterialIdentityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new PhysicalMaterialIdentityError(code, message, details); }
function text(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    fail('P5_MATERIAL_IDENTITY_FIELD', 'Physical Material Identity field is invalid.', { field });
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(Object.keys(value).sort().reduce((result, key) => {
    result[key] = value[key];
    return result;
  }, {}));
}

function createPhysicalMaterialIdentityFactory(options) {
  if (!options || typeof options.digest !== 'function') fail('P5_MATERIAL_IDENTITY_DIGEST_REQUIRED', 'Explicit SHA-256 digest dependency is required.');
  return Object.freeze({
    derive(observation) {
      const expected = ['contentFingerprint', 'fingerprintAlgorithm', 'fingerprintVersion', 'boundedFingerprintComplete', 'inode', 'mountScopeId', 'sizeBytes'];
      if (!observation || JSON.stringify(Object.keys(observation).sort()) !== JSON.stringify(expected.sort())) {
        fail('P5_MATERIAL_IDENTITY_OBSERVATION_SHAPE', 'Identity observation must match the exact contract.');
      }
      if (observation.boundedFingerprintComplete !== true || observation.fingerprintAlgorithm !== 'middle-256k-sha256' ||
          observation.fingerprintVersion !== 1 || !Number.isSafeInteger(observation.sizeBytes) || observation.sizeBytes < 0 ||
          !SHA256.test(observation.contentFingerprint || '')) {
        fail('P5_MATERIAL_IDENTITY_FINGERPRINT_REQUIRED', 'A complete middle-256k-sha256 fingerprint is required.');
      }
      const tuple = Object.freeze({
        mountScopeId: text(observation.mountScopeId, 'mountScopeId'),
        inode: text(observation.inode, 'inode'),
        sizeBytes: observation.sizeBytes,
        fingerprintAlgorithm: observation.fingerprintAlgorithm,
        fingerprintVersion: observation.fingerprintVersion,
        contentFingerprint: observation.contentFingerprint
      });
      if (!/^(0|[1-9][0-9]*)$/.test(tuple.inode)) fail('P5_MATERIAL_IDENTITY_FIELD', 'Physical Material inode must be an unsigned decimal string.', { field: 'inode' });
      const materialKey = options.digest(canonicalJson({ schema: 'physical-material-identity@2', ...tuple }));
      if (!SHA256.test(materialKey || '')) fail('P5_MATERIAL_IDENTITY_DIGEST_INVALID', 'Identity digest dependency returned an invalid SHA-256.');
      return Object.freeze({
        schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion: 2,
        materialKey, ...tuple
      });
    }
  });
}

module.exports = Object.freeze({
  PhysicalMaterialIdentityError,
  createPhysicalMaterialIdentityFactory
});
