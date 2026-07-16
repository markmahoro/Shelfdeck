'use strict';

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
      !options.workspaceProbe || typeof options.workspaceProbe.inspect !== 'function' ||
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
    exactKeys(request, ['rootId', 'rootKind', 'requestedRoot', 'expectedConfigRevision', 'updatedAtMs'], 'P5_WORKSPACE_ROOT_REQUEST_SHAPE');
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
    const root = Object.freeze({
      rootId: request.rootId, ownerScope, rootKind: request.rootKind, resolvedRoot, configRevision,
      capabilityDigest: observed.capabilityDigest, state: 'active', updatedAtMs: request.updatedAtMs
    });
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
    exactKeys(request, ['rootId', 'expectedConfigRevision', 'ownerScope', 'rootKind'], 'P5_WORKSPACE_ROOT_RESOLVE_SHAPE');
    const current = options.repository.getWorkspaceRoot(request.rootId);
    if (!current || current.state !== 'active') fail('P5_WORKSPACE_ROOT_NOT_FOUND', 'Active Workspace Root was not found.');
    if (current.configRevision !== request.expectedConfigRevision || current.ownerScope !== request.ownerScope ||
        current.rootKind !== request.rootKind) fail('P5_WORKSPACE_ROOT_STALE', 'Workspace Root scope or revision is stale.');
    return Object.freeze({
      schemaRef: 'helix://contracts/ports/platform.workspace-root.resolve/v1/output', schemaVersion: 1,
      rootId: current.rootId, ownerScope: current.ownerScope, rootKind: current.rootKind,
      resolvedRoot: current.resolvedRoot, configRevision: current.configRevision,
      capabilityDigest: current.capabilityDigest
    });
  }

  return Object.freeze({ publishMountScope, publishWorkspaceRoot, resolveMountScope, resolveWorkspaceRoot });
}

module.exports = Object.freeze({ LocationRegistryError, ROOT_OWNERS, createLocationRegistryService });
