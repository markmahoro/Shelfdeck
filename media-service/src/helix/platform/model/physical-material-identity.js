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
      const expected = ['contentHash', 'contentHashAlgorithm', 'fullHashComplete', 'inode', 'mountScopeId'];
      if (!observation || JSON.stringify(Object.keys(observation).sort()) !== JSON.stringify(expected.sort())) {
        fail('P5_MATERIAL_IDENTITY_OBSERVATION_SHAPE', 'Identity observation must match the exact contract.');
      }
      if (observation.fullHashComplete !== true || observation.contentHashAlgorithm !== 'sha256' ||
          !SHA256.test(observation.contentHash || '')) {
        fail('P5_MATERIAL_IDENTITY_FULL_HASH_REQUIRED', 'A complete full-file SHA-256 is required.');
      }
      const tuple = Object.freeze({
        mountScopeId: text(observation.mountScopeId, 'mountScopeId'),
        inode: text(observation.inode, 'inode'),
        contentHashAlgorithm: observation.contentHashAlgorithm,
        contentHash: observation.contentHash
      });
      const materialKey = options.digest(canonicalJson(tuple));
      if (!SHA256.test(materialKey || '')) fail('P5_MATERIAL_IDENTITY_DIGEST_INVALID', 'Identity digest dependency returned an invalid SHA-256.');
      return Object.freeze({
        schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion: 1,
        materialKey, ...tuple
      });
    }
  });
}

function canReuseFullHash(previous, observation) {
  const fields = ['mountScopeId', 'mountScopeRevision', 'inode', 'sizeBytes', 'mtimeNs', 'ctimeNs'];
  if (!previous || !observation || previous.contentHashAlgorithm !== 'sha256' || !SHA256.test(previous.contentHash || '') ||
      previous.fullHashComplete !== true || observation.trustworthyNanosecondStat !== true) return false;
  for (const candidate of [previous, observation]) {
    if (typeof candidate.mountScopeId !== 'string' || candidate.mountScopeId.length === 0 ||
        !Number.isSafeInteger(candidate.mountScopeRevision) || candidate.mountScopeRevision < 1 ||
        typeof candidate.inode !== 'string' || candidate.inode.length === 0 ||
        !Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0 ||
        typeof candidate.mtimeNs !== 'string' || !/^\d+$/.test(candidate.mtimeNs) ||
        typeof candidate.ctimeNs !== 'string' || !/^\d+$/.test(candidate.ctimeNs)) return false;
  }
  return fields.every((field) => previous[field] === observation[field]);
}

module.exports = Object.freeze({
  PhysicalMaterialIdentityError,
  canReuseFullHash,
  createPhysicalMaterialIdentityFactory
});
