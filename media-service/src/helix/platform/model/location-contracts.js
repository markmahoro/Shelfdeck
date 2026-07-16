'use strict';

const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ROOT_STATES = new Set(['active', 'disabled', 'faulted']);

class LocationContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocationContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new LocationContractError(code, message, details); }
function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_LOCATION_TOKEN', 'Location registry token is invalid.', { field });
  return value;
}
function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('P5_LOCATION_DIGEST', 'Location registry digest is invalid.', { field });
  return value;
}
function positive(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P5_LOCATION_REVISION', 'Location registry revision must be positive.', { field });
  return value;
}
function time(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P5_LOCATION_TIME', 'Location registry time is invalid.', { field });
  return value;
}

function createMountScopeRevision(value) {
  const expected = ['effectiveAtMs', 'endpointId', 'filesystemType', 'inodeCapabilityDigest', 'mountBoundary',
    'mountScopeId', 'probeEvidenceDigest', 'revision', 'stableMountFingerprint'];
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.sort())) {
    fail('P5_MOUNT_SCOPE_REVISION_SHAPE', 'Mount Scope revision must match the exact contract.');
  }
  if (typeof value.mountBoundary !== 'string' || value.mountBoundary.length < 1 || value.mountBoundary.length > 4096) {
    fail('P5_MOUNT_SCOPE_BOUNDARY', 'Mount Scope boundary is invalid.');
  }
  return Object.freeze({
    mountScopeId: token(value.mountScopeId, 'mountScopeId'), revision: positive(value.revision, 'revision'),
    endpointId: token(value.endpointId, 'endpointId'), mountBoundary: value.mountBoundary,
    filesystemType: token(value.filesystemType, 'filesystemType'),
    stableMountFingerprint: token(value.stableMountFingerprint, 'stableMountFingerprint'),
    inodeCapabilityDigest: digest(value.inodeCapabilityDigest, 'inodeCapabilityDigest'),
    probeEvidenceDigest: digest(value.probeEvidenceDigest, 'probeEvidenceDigest'),
    effectiveAtMs: time(value.effectiveAtMs, 'effectiveAtMs')
  });
}

function createWorkspaceRoot(value) {
  const expected = ['capabilityDigest', 'configRevision', 'ownerScope', 'resolvedRoot', 'rootId', 'rootKind', 'state', 'updatedAtMs'];
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.sort())) {
    fail('P5_WORKSPACE_ROOT_SHAPE', 'Workspace Root must match the exact contract.');
  }
  if (typeof value.resolvedRoot !== 'string' || value.resolvedRoot.length < 1 || value.resolvedRoot.length > 4096) {
    fail('P5_WORKSPACE_ROOT_PATH', 'Workspace Root path is invalid.');
  }
  if (!ROOT_STATES.has(value.state)) fail('P5_WORKSPACE_ROOT_STATE', 'Workspace Root state is invalid.');
  return Object.freeze({
    rootId: token(value.rootId, 'rootId'), ownerScope: token(value.ownerScope, 'ownerScope'),
    rootKind: token(value.rootKind, 'rootKind'), resolvedRoot: value.resolvedRoot,
    configRevision: positive(value.configRevision, 'configRevision'),
    capabilityDigest: digest(value.capabilityDigest, 'capabilityDigest'), state: value.state,
    updatedAtMs: time(value.updatedAtMs, 'updatedAtMs')
  });
}

module.exports = Object.freeze({ LocationContractError, createMountScopeRevision, createWorkspaceRoot });
