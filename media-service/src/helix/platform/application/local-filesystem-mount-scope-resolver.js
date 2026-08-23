'use strict';

class LocalFilesystemMountScopeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalFilesystemMountScopeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new LocalFilesystemMountScopeError(code, message, details);
}

function createLocalFilesystemMountScopeResolver(options) {
  if (!options?.repository || typeof options.repository.getMountScope !== 'function' ||
      typeof options.repository.publishMountScope !== 'function' ||
      typeof options.inspectRoot !== 'function') {
    fail('P5_LOCAL_MOUNT_SCOPE_DEPENDENCIES',
      'Platform Mount Scope Registry repository and local mount probe are required.');
  }
  const now = options.now || Date.now;

  function observed(rootLocation) {
    const value = options.inspectRoot(rootLocation);
    const required = ['resolvedRoot','endpointId','mountBoundary','filesystemType',
      'stableMountFingerprint','inodeCapabilityDigest','probeEvidenceDigest'];
    if (!value || required.some((key) => typeof value[key] !== 'string' || !value[key])) {
      fail('HELIX_MOUNT_SCOPE_UNSAFE', 'Local filesystem mount probe returned incomplete evidence.');
    }
    return value;
  }

  function snapshot(scope, root) {
    return Object.freeze({
      endpointId: scope.endpointId,
      rootLocation: root.resolvedRoot,
      mountScopeId: scope.mountScopeId,
      mountScopeRevision: scope.revision,
    });
  }

  function sameEvidence(current, root) {
    return current.endpointId === root.endpointId &&
      current.mountBoundary === root.mountBoundary &&
      current.filesystemType === root.filesystemType &&
      current.stableMountFingerprint === root.stableMountFingerprint &&
      current.inodeCapabilityDigest === root.inodeCapabilityDigest &&
      current.probeEvidenceDigest === root.probeEvidenceDigest;
  }

  function resolveRoot(request) {
    const root = observed(request.rootLocation);
    const mountScopeId = 'local-mount-' + root.stableMountFingerprint.slice(0, 32);
    let current = options.repository.getMountScope(mountScopeId);
    if (!current) {
      const revision = Object.freeze({
        mountScopeId,
        revision: 1,
        endpointId: root.endpointId,
        mountBoundary: root.mountBoundary,
        filesystemType: root.filesystemType,
        stableMountFingerprint: root.stableMountFingerprint,
        inodeCapabilityDigest: root.inodeCapabilityDigest,
        probeEvidenceDigest: root.probeEvidenceDigest,
        effectiveAtMs: now(),
      });
      current = options.repository.publishMountScope(revision, (active) => {
        if (active.some((item) => item.mountScopeId !== mountScopeId &&
            item.stableMountFingerprint === root.stableMountFingerprint)) {
          fail('HELIX_MOUNT_SCOPE_UNSAFE',
            'Stable mount fingerprint is already registered under another scope.');
        }
      });
    }
    if (!sameEvidence(current, root)) {
      fail('HELIX_MOUNT_SCOPE_UNSAFE',
        'Registered Mount Scope no longer matches current mount evidence.', { mountScopeId });
    }
    return snapshot(current, root);
  }

  function validateReference(reference) {
    const current = options.repository.getMountScope(reference.mountScopeId);
    if (!current || current.revision !== reference.mountScopeRevision ||
        current.endpointId !== reference.endpointId) {
      fail('HELIX_MOUNT_SCOPE_UNSAFE',
        'Configured Field or Shelf Mount Scope reference is unsafe.', {
          mountScopeId: reference.mountScopeId,
        });
    }
    let root;
    try {
      root = observed(reference.rootLocation);
    } catch (error) {
      if (reference.allowUnavailable === true) {
        return Object.freeze({
          endpointId: current.endpointId,
          rootLocation: reference.rootLocation,
          mountScopeId: current.mountScopeId,
          mountScopeRevision: current.revision,
          available: false,
        });
      }
      throw error;
    }
    if (!sameEvidence(current, root)) {
      fail('HELIX_MOUNT_SCOPE_UNSAFE',
        'Configured Field or Shelf Mount Scope reference is unsafe.', {
          mountScopeId: reference.mountScopeId,
        });
    }
    return snapshot(current, root);
  }

  return Object.freeze({ resolveRoot, validateReference });
}

module.exports = Object.freeze({
  LocalFilesystemMountScopeError,
  createLocalFilesystemMountScopeResolver,
});
