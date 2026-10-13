'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');

function fail(message) {
  const error = new Error(message);
  error.code = 'HELIX_CIFS_PROBE_CORRECTION_INVALID';
  throw error;
}

function sameEvidence(current, observed) {
  return current.endpointId === observed.endpointId && current.mountBoundary === observed.mountBoundary &&
    current.filesystemType === observed.filesystemType &&
    current.stableMountFingerprint === observed.stableMountFingerprint &&
    current.inodeCapabilityDigest === observed.inodeCapabilityDigest &&
    current.probeEvidenceDigest === observed.probeEvidenceDigest;
}

function createCifsMountProbeCorrection(options) {
  const { repository, probe } = options;
  function proposal(request, current, active) {
    const keys = ['mountScopeId', 'revision', 'rootLocation', 'legacyDeviceIdentity'];
    if (!request || Object.keys(request).length !== keys.length || keys.some((key) => !Object.hasOwn(request, key)) ||
        typeof request.legacyDeviceIdentity !== 'string' || !/^\d+:\d+$/.test(request.legacyDeviceIdentity) ||
        !current || current.mountScopeId !== request.mountScopeId || current.revision !== request.revision ||
        current.filesystemType !== 'cifs') fail('Correction requires the exact active Linux CIFS Scope and old device number.');
    const legacy = probe.inspectLegacyCifsRoot(request.rootLocation, request.legacyDeviceIdentity);
    const observed = probe.inspectRoot(request.rootLocation);
    const corrected = Object.freeze({ ...current,
      stableMountFingerprint: observed.stableMountFingerprint, probeEvidenceDigest: observed.probeEvidenceDigest });
    // Only the two erroneous derived digests may change. All other evidence must match.
    if (!sameEvidence(corrected, observed)) fail('Mount endpoint, boundary, filesystem or inode capabilities changed.');
    const alreadyCorrected = sameEvidence(current, observed) &&
      current.mountScopeId === 'local-mount-' + legacy.stableMountFingerprint.slice(0, 32);
    if (!sameEvidence(current, legacy) && !alreadyCorrected) fail('Explicit old evidence does not reproduce the registered Scope.');
    if (active.some((item) => item.mountScopeId !== current.mountScopeId &&
        item.stableMountFingerprint === corrected.stableMountFingerprint)) fail('Corrected fingerprint conflicts with another active Scope.');
    return corrected;
  }
  function inspect(request) {
    const before = repository.getMountScope(request.mountScopeId);
    const after = proposal(request, before, repository.listMountScopes());
    const body = { schema: 'platform.cifs-mount-probe-correction@1', request, before, after };
    return Object.freeze({ ...body, receiptDigest: canonicalDigest(body) });
  }
  function apply(request) {
    const inspected = inspect(request);
    const after = repository.correctMountProbeEvidence(request, (current, active) => {
      if (canonicalDigest(current) !== canonicalDigest(inspected.before)) fail('Mount evidence changed after inspection.');
      return proposal(request, current, active);
    });
    return Object.freeze({ ...inspected, after, applied: true });
  }
  return Object.freeze({ inspect, apply });
}

module.exports = Object.freeze({ createCifsMountProbeCorrection });
