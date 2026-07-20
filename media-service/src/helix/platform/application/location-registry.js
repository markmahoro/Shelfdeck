'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createWorkspaceRootSnapshot } = require('../model/location-contracts');

const DIGEST = /^[0-9a-f]{64}$/;
const ROOT_OWNERS = Object.freeze({
  'production-workspace': 'libra',
  'aftercare-workspace': 'arca',
  'internal-artifact': 'platform-settings'
});

class LocationRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocationRegistryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new LocationRegistryError(code, message, details); }
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(code, 'Location registry request must match the exact contract.');
  }
}
function validDigest(value) { return typeof value === 'string' && DIGEST.test(value); }

function createLocationRegistryService(options) {
  if (!options || !options.repository || !options.pathAuthority ||
      !options.mountProbe || typeof options.mountProbe.inspect !== 'function' ||
      !options.workspaceProbe || typeof options.workspaceProbe.inspect !== 'function' || typeof options.workspaceProbe.assessSpace !== 'function' ||
      !options.clock || typeof options.clock.now !== 'function' ||
      !options.reservedRootQuery || typeof options.reservedRootQuery.list !== 'function') {
    fail('P5_LOCATION_REGISTRY_DEPENDENCIES', 'Repository, path authority, probes, and reserved-root query are required.');
  }

  function publishMountScope(request) {
    exactKeys(request, ['mountScopeId', 'revision', 'endpointId', 'mountBoundary', 'filesystemType',
      'stableMountFingerprint', 'inodeCapabilityDigest', 'probeEvidenceDigest', 'effectiveAtMs'], 'P5_MOUNT_SCOPE_REQUEST_SHAPE');
    const canonicalBoundary = options.pathAuthority.canonicalize(request.mountBoundary);
    const observed = options.mountProbe.inspect(Object.freeze({
      mountScopeId: request.mountScopeId, endpointId: request.endpointId, mountBoundary: canonicalBoundary
    }));
    exactKeys(observed, ['resolvedBoundary', 'endpointId', 'filesystemType', 'stableMountFingerprint',
      'inodeCapabilityDigest', 'probeEvidenceDigest'], 'P5_MOUNT_SCOPE_PROBE_SHAPE');
    const exact = observed.resolvedBoundary === canonicalBoundary && observed.endpointId === request.endpointId &&
      observed.filesystemType === request.filesystemType && observed.stableMountFingerprint === request.stableMountFingerprint &&
      observed.inodeCapabilityDigest === request.inodeCapabilityDigest && observed.probeEvidenceDigest === request.probeEvidenceDigest;
    if (!exact || !validDigest(observed.inodeCapabilityDigest) || !validDigest(observed.probeEvidenceDigest)) {
      fail('P5_MOUNT_SCOPE_PROBE_MISMATCH', 'Mount Scope proposal does not match probe evidence.');
    }
    return options.repository.publishMountScope(Object.freeze({ ...request, mountBoundary: canonicalBoundary }), (active) => {
      if (active.some((item) => item.mountScopeId !== request.mountScopeId &&
          item.stableMountFingerprint === request.stableMountFingerprint)) {
        fail('P5_MOUNT_SCOPE_FINGERPRINT_CONFLICT', 'Active Mount Scope fingerprint already belongs to another scope.');
      }
    });
  }

  function resolveMountScope(request) {
    exactKeys(request, ['mountScopeId', 'expectedRevision'], 'P5_MOUNT_SCOPE_RESOLVE_SHAPE');
    const current = options.repository.getMountScope(request.mountScopeId);
    if (!current) fail('P5_MOUNT_SCOPE_NOT_FOUND', 'Active Mount Scope was not found.');
    if (current.revision !== request.expectedRevision) fail('P5_MOUNT_SCOPE_STALE', 'Mount Scope revision is stale.');
    return Object.freeze({
      schemaRef: 'helix://contracts/ports/platform.mount-scope.resolve/v1/output', schemaVersion: 1,
      mountScopeId: current.mountScopeId, mountScopeRevision: current.revision, endpointId: current.endpointId,
      mountBoundary: current.mountBoundary, filesystemType: current.filesystemType,
      stableMountFingerprint: current.stableMountFingerprint,
      inodeCapabilityDigest: current.inodeCapabilityDigest, probeEvidenceDigest: current.probeEvidenceDigest
    });
  }

  function publishWorkspaceRoot(request) {
    exactKeys(request, ['rootId', 'rootKind', 'endpointId', 'mountScopeId', 'mountScopeRevision', 'requestedRoot',
      'expectedConfigRevision', 'updatedAtMs'], 'P5_WORKSPACE_ROOT_REQUEST_SHAPE');
    const ownerScope = ROOT_OWNERS[request.rootKind];
    if (!ownerScope) fail('P5_WORKSPACE_ROOT_KIND', 'Workspace Root kind is unsupported.');
    if (request.expectedConfigRevision !== null &&
        (!Number.isSafeInteger(request.expectedConfigRevision) || request.expectedConfigRevision < 1)) {
      fail('P5_WORKSPACE_ROOT_EXPECTED_REVISION', 'Expected Workspace Root revision is invalid.');
    }
    const resolvedRoot = options.pathAuthority.canonicalize(request.requestedRoot);
    const observed = options.workspaceProbe.inspect(Object.freeze({
      rootId: request.rootId, rootKind: request.rootKind, ownerScope, resolvedRoot
    }));
    exactKeys(observed, ['resolvedRoot', 'created', 'writable', 'atomicRename', 'readable', 'deletable',
      'availableBytes', 'capabilityDigest', 'probeEvidenceDigest'], 'P5_WORKSPACE_ROOT_PROBE_SHAPE');
    if (observed.resolvedRoot !== resolvedRoot || observed.created !== true || observed.writable !== true ||
        observed.atomicRename !== true || observed.readable !== true || observed.deletable !== true ||
        !Number.isSafeInteger(observed.availableBytes) || observed.availableBytes < 0 ||
        !validDigest(observed.capabilityDigest) || !validDigest(observed.probeEvidenceDigest)) {
      fail('P5_WORKSPACE_ROOT_PROBE_FAILED', 'Workspace Root capability probe did not satisfy the required contract.');
    }
    const configRevision = request.expectedConfigRevision === null ? 1 : request.expectedConfigRevision + 1;
    const rootHandleRef = canonicalDigest({ schema: 'platform.workspace-root-handle@1', rootId: request.rootId,
      endpointId: request.endpointId, mountScopeId: request.mountScopeId, mountScopeRevision: request.mountScopeRevision,
      configRevision, capabilityDigest: observed.capabilityDigest });
    const snapshot = { rootId: request.rootId, ownerScope, rootKind: request.rootKind, endpointId: request.endpointId,
      mountScopeId: request.mountScopeId, mountScopeRevision: request.mountScopeRevision, configRevision,
      capabilityDigest: observed.capabilityDigest, state: 'active', rootHandleRef };
    const root = Object.freeze({ ...snapshot, resolvedRoot, snapshotDigest: canonicalDigest(snapshot), updatedAtMs: request.updatedAtMs });
    const reserved = options.reservedRootQuery.list();
    if (!Array.isArray(reserved)) fail('P5_RESERVED_ROOT_QUERY_RESULT', 'Reserved root query must return a bounded array.');
    if (reserved.length > 4096) fail('P5_RESERVED_ROOT_QUERY_BOUND', 'Reserved root query exceeded its bound.');
    for (const item of reserved) {
      exactKeys(item, ['kind', 'rootId', 'resolvedRoot', 'revision'], 'P5_RESERVED_ROOT_SHAPE');
      if (options.pathAuthority.overlaps(root.resolvedRoot, item.resolvedRoot)) {
        fail('P5_WORKSPACE_ROOT_RESERVED_OVERLAP', 'Workspace Root overlaps a Material Field or Shelf target.', {
          reservedKind: item.kind, reservedRootId: item.rootId
        });
      }
    }
    return options.repository.publishWorkspaceRoot(root, request.expectedConfigRevision, (current) => {
      if (current.some((item) => item.rootId !== root.rootId && item.state === 'active' &&
          options.pathAuthority.overlaps(root.resolvedRoot, item.resolvedRoot))) {
        fail('P5_WORKSPACE_ROOT_OVERLAP', 'Active Workspace Roots must not overlap.');
      }
    });
  }

  function resolveWorkspaceRoot(request) {
    const keys = Object.keys(request || {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['queryDigest', 'rootId'].sort()) &&
        JSON.stringify(keys) !== JSON.stringify(['expectedConfigRevision', 'queryDigest', 'rootId'].sort())) {
      fail('P5_WORKSPACE_ROOT_RESOLVE_SHAPE', 'Workspace Root query must match the exact contract.');
    }
    const basis = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'queryDigest'));
    if (request.queryDigest !== canonicalDigest(basis)) fail('P5_WORKSPACE_ROOT_QUERY_DIGEST', 'Workspace Root query digest is invalid.');
    const current = options.repository.getWorkspaceRoot(request.rootId);
    let result;
    if (!current) result = { queryDigest: request.queryDigest, resultKind: 'not_found', reasonCode: 'root_not_found' };
    else if (request.expectedConfigRevision !== undefined && current.configRevision !== request.expectedConfigRevision) {
      result = { queryDigest: request.queryDigest, resultKind: 'stale', reasonCode: 'config_revision_mismatch' };
    } else if (current.state !== 'active') result = { queryDigest: request.queryDigest, resultKind: 'inactive', reasonCode: 'root_inactive' };
    else {
      try { result = { queryDigest: request.queryDigest, resultKind: 'found', snapshot: createWorkspaceRootSnapshot(current) }; }
      catch { result = { queryDigest: request.queryDigest, resultKind: 'integrity_error', reasonCode: 'snapshot_digest_mismatch' }; }
    }
    return Object.freeze({ ...result, resultDigest: canonicalDigest(result) });
  }

  function assessWorkspaceSpace(request) {
    exactKeys(request, ['workspaceId', 'libraRunId', 'executionBasisDigest', 'rootId', 'rootSnapshotDigest',
      'inputPrimaryTotalBytes', 'requiredFreeBytes', 'requestDigest'], 'P5_WORKSPACE_SPACE_REQUEST_SHAPE');
    const basis = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'requestDigest'));
    if (request.requestDigest !== canonicalDigest(basis)) fail('P5_WORKSPACE_SPACE_REQUEST_DIGEST', 'Workspace space request digest is invalid.');
    const observedAtMs = options.clock.now();
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) fail('P5_WORKSPACE_SPACE_TIME', 'Workspace space observation time is invalid.');
    const scaled = request.inputPrimaryTotalBytes * 120;
    const demanded = Number.isSafeInteger(scaled) ? Math.ceil(scaled / 100) + 5368709120 : Number.NaN;
    let result;
    if (!Number.isSafeInteger(request.inputPrimaryTotalBytes) || request.inputPrimaryTotalBytes < 0 ||
        !Number.isSafeInteger(request.requiredFreeBytes) || request.requiredFreeBytes < 0 ||
        !Number.isSafeInteger(demanded) || request.requiredFreeBytes !== Math.ceil(demanded)) {
      result = 'demand_out_of_range';
    }
    const current = options.repository.getWorkspaceRoot(request.rootId);
    if (!result && (!current || current.state !== 'active' || current.ownerScope !== 'libra' ||
        current.snapshotDigest !== request.rootSnapshotDigest)) result = 'root_unavailable';
    let availableBytes;
    if (!result) {
      try {
        const observation = options.workspaceProbe.assessSpace(Object.freeze({ rootId: current.rootId,
          rootHandleRef: current.rootHandleRef, resolvedRoot: current.resolvedRoot }));
        exactKeys(observation, ['availableBytes'], 'P5_WORKSPACE_SPACE_PROBE_SHAPE');
        if (!Number.isSafeInteger(observation.availableBytes) || observation.availableBytes < 0) throw new Error('invalid space');
        availableBytes = observation.availableBytes;
        result = availableBytes >= request.requiredFreeBytes ? 'admitted' : 'insufficient_space';
      } catch { result = 'root_unavailable'; }
    }
    const evidenceId = canonicalDigest({ schema: 'platform.workspace-space-admission-evidence-id@1',
      requestDigest: request.requestDigest, rootSnapshotDigest: request.rootSnapshotDigest, observedAtMs });
    const evidence = { evidenceId, authorityRef: 'platform.workspace-space-admission@1', requestDigest: request.requestDigest,
      workspaceId: request.workspaceId, libraRunId: request.libraRunId, rootId: request.rootId,
      rootSnapshotDigest: request.rootSnapshotDigest, requiredBytes: request.requiredFreeBytes,
      observedAtMs, expiresAtMs: observedAtMs + 30000, result };
    if (availableBytes !== undefined) evidence.availableBytes = availableBytes;
    if (result !== 'admitted') evidence.reasonCode = result;
    evidence.evidenceDigest = canonicalDigest(evidence);
    return Object.freeze(evidence);
  }

  return Object.freeze({ publishMountScope, publishWorkspaceRoot, resolveMountScope, resolveWorkspaceRoot, assessWorkspaceSpace });
}

module.exports = Object.freeze({ LocationRegistryError, ROOT_OWNERS, createLocationRegistryService });
