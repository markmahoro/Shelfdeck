'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const comparableLocation = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

function observedIdentity(location, mountScopeId, fingerprint) {
  const bounded = fingerprint(location);
  const tuple = {
    mountScopeId,
    inode:String(bounded.stat.ino),
    sizeBytes:Number(bounded.stat.size),
    fingerprintAlgorithm:bounded.fingerprintAlgorithm,
    fingerprintVersion:Number(bounded.fingerprintVersion),
    contentFingerprint:bounded.contentFingerprint,
  };
  return Object.freeze({
    schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion:2,
    materialKey:canonicalDigest({ schema:'physical-material-identity@2', ...tuple }),
    ...tuple,
  });
}

function observeKnownOldBindings(raw, fingerprint) {
  if (typeof fingerprint !== 'function') {
    throw new TypeError('Known old Binding observation requires the bounded fingerprint port.');
  }
  const currentLocations = new Set((raw.materials || []).map((item) =>
    comparableLocation(item.location)));
  return Object.freeze((raw.oldBindings || []).filter((binding) =>
    String(binding.role || '').startsWith('offload:') &&
    !currentLocations.has(comparableLocation(binding.location))).map((binding) => {
    try {
      const identity = observedIdentity(binding.location,
        binding.mount_scope_id, fingerprint);
      if (identity.materialKey !== binding.material_key) {
        return Object.freeze({ kind:'identity_changed', binding, identity });
      }
      const matches = (raw.materials || []).filter((item) =>
        Number(item.size_bytes) === identity.sizeBytes &&
        item.fingerprint_algorithm === identity.fingerprintAlgorithm &&
        Number(item.fingerprint_version) === identity.fingerprintVersion &&
        item.content_fingerprint === identity.contentFingerprint);
      return Object.freeze(matches.length === 1
        ? { kind:'duplicate_of_final', binding, identity, final:matches[0] }
        : { kind:matches.length > 1 ? 'ambiguous_final' : 'unmatched', binding, identity });
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze({ kind:'absent', binding });
      if (String(error?.code || '').includes('NOT_REGULAR')) return Object.freeze({ kind:'not_regular', binding });
      return Object.freeze({ kind:'unreadable', binding, causeCode:error?.code || 'UNKNOWN' });
    }
  }));
}

module.exports = Object.freeze({ observedIdentity, observeKnownOldBindings });
