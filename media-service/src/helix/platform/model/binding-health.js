'use strict';

const LOCATION_STATES = new Set(['resolved', 'missing', 'unreadable']);

class BindingHealthError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BindingHealthError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new BindingHealthError(code, message, details); }

function evaluateBindingHealth(input) {
  const expected = ['expected', 'observation'];
  if (!input || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected)) {
    fail('P5_BINDING_HEALTH_SHAPE', 'Binding Health input must match the exact contract.');
  }
  const requiredExpected = ['endpointId', 'identity', 'location', 'mountScopeRevision'];
  const requiredObservation = ['contentFingerprint', 'endpointId', 'endpointReachable', 'fingerprintAlgorithm', 'fingerprintVersion',
    'inode', 'location', 'locationState', 'mountScopeId', 'mountScopeRevision', 'observationEvidenceDigest', 'sizeBytes'];
  if (!input.expected || JSON.stringify(Object.keys(input.expected).sort()) !== JSON.stringify(requiredExpected.sort()) ||
      !input.observation || JSON.stringify(Object.keys(input.observation).sort()) !== JSON.stringify(requiredObservation.sort()) ||
      !LOCATION_STATES.has(input.observation.locationState)) {
    fail('P5_BINDING_HEALTH_PAYLOAD', 'Binding Health expected and observed payloads must match the exact contract.');
  }
  if (!input.expected.identity || !/^[0-9a-f]{64}$/.test(input.expected.identity.materialKey || '') ||
      !/^[0-9a-f]{64}$/.test(input.expected.identity.contentFingerprint || '') ||
      typeof input.expected.endpointId !== 'string' || input.expected.endpointId.length === 0 ||
      typeof input.expected.location !== 'string' || input.expected.location.length === 0 ||
      !Number.isSafeInteger(input.expected.mountScopeRevision) || input.expected.mountScopeRevision < 1 ||
      typeof input.observation.endpointReachable !== 'boolean' ||
      input.observation.fingerprintAlgorithm !== 'middle-256k-sha256' || input.observation.fingerprintVersion !== 1 ||
      !Number.isSafeInteger(input.observation.sizeBytes) || input.observation.sizeBytes < 0 ||
      !/^[0-9a-f]{64}$/.test(input.observation.observationEvidenceDigest || '')) {
    fail('P5_BINDING_HEALTH_INVARIANT', 'Binding Health identity, scope, or Evidence is invalid.');
  }
  const reasons = [];
  const observation = input.observation;
  const identity = input.expected.identity;
  if (observation.endpointReachable !== true) {
    reasons.push('endpoint_unreachable');
  } else {
    if (observation.endpointId !== input.expected.endpointId) reasons.push('endpoint_mismatch');
    if (observation.locationState === 'missing') reasons.push('location_missing');
    if (observation.locationState === 'unreadable') reasons.push('location_unreadable');
    if (observation.locationState === 'resolved') {
      if (observation.location !== input.expected.location) reasons.push('location_mismatch');
      if (observation.mountScopeId !== identity.mountScopeId || observation.mountScopeRevision !== input.expected.mountScopeRevision ||
          observation.inode !== identity.inode || observation.sizeBytes !== identity.sizeBytes) reasons.push('filesystem_object_mismatch');
      if (observation.fingerprintAlgorithm !== identity.fingerprintAlgorithm || observation.fingerprintVersion !== identity.fingerprintVersion ||
          observation.contentFingerprint !== identity.contentFingerprint) reasons.push('content_fingerprint_mismatch');
    }
  }
  return Object.freeze({
    health: reasons.length === 0 ? 'healthy' : 'unhealthy',
    reasonCodes: Object.freeze(reasons),
    endpointId: input.expected.endpointId,
    location: input.expected.location,
    observedLocation: observation.location,
    identityMaterialKey: identity.materialKey,
    observationEvidenceDigest: observation.observationEvidenceDigest
  });
}

function assessLocationContinuity(input) {
  const expected = ['candidateIdentity', 'currentBinding', 'locationEvidence'];
  if (!input || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected.sort())) {
    fail('P5_BINDING_CONTINUITY_SHAPE', 'Binding continuity input must match the exact contract.');
  }
  if (!input.candidateIdentity || typeof input.candidateIdentity.materialKey !== 'string' ||
      !input.currentBinding || !input.currentBinding.identity || typeof input.currentBinding.identity.materialKey !== 'string' ||
      typeof input.currentBinding.endpointId !== 'string' || typeof input.currentBinding.location !== 'string' ||
      !Number.isSafeInteger(input.currentBinding.mountScopeRevision) || input.currentBinding.mountScopeRevision < 1) {
    fail('P5_BINDING_CONTINUITY_PAYLOAD', 'Binding continuity payload is invalid.');
  }
  const sameIdentity = input.candidateIdentity && input.currentBinding &&
    input.candidateIdentity.materialKey === input.currentBinding.identity.materialKey;
  const exactEvidence = input.locationEvidence && input.locationEvidence.reliable === true &&
    input.locationEvidence.endpointId === input.currentBinding.endpointId &&
    input.locationEvidence.mountScopeRevision === input.currentBinding.mountScopeRevision &&
    typeof input.locationEvidence.location === 'string' && input.locationEvidence.location.length > 0;
  return Object.freeze({
    identityChanged: !sameIdentity,
    mayUpdateLocation: sameIdentity && exactEvidence,
    nextLocation: sameIdentity && exactEvidence ? input.locationEvidence.location : input.currentBinding.location,
    requiresNewBinding: !sameIdentity
  });
}

module.exports = Object.freeze({ BindingHealthError, assessLocationContinuity, evaluateBindingHealth });
