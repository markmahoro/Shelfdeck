'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const {
  EVIDENCE_SCHEMA_REF,
  targetDigest,
} = require('./helix/domains/arca/model/shelf-target-folder-contracts');

class CleanShelfTargetProbeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanShelfTargetProbeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanShelfTargetProbeError(code, message, details);
}

function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, 'Shelf Target probe input does not match its closed contract.');
  }
}

function text(value, field, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail('P14_SHELF_TARGET_FIELD_REQUIRED', 'Shelf Target field is invalid.', { field });
  }
  return value;
}

function createCleanShelfTargetFolderProbe(options = {}) {
  const fsApi = options.fsApi || fs;
  const pathApi = options.pathApi || path;

  function inspectResolved(shelfId, requestedRoot, proposedTarget) {
    let resolvedRoot;
    let filesystemType = 'unknown';
    let deviceId = 'unknown';
    try {
      const realpath = fsApi.realpathSync.native || fsApi.realpathSync;
      resolvedRoot = pathApi.normalize(realpath(requestedRoot));
      const stat = fsApi.statSync(resolvedRoot);
      if (!stat.isDirectory()) {
        fail(
          'P14_SHELF_TARGET_NOT_DIRECTORY',
          'Shelf Target Folder must resolve to a directory.',
        );
      }
      deviceId = String(stat.dev);
      fsApi.accessSync(resolvedRoot, fs.constants.R_OK | fs.constants.W_OK);
      if (typeof fsApi.statfsSync === 'function') {
        try {
          filesystemType = String(fsApi.statfsSync(resolvedRoot).type);
        } catch (_error) {
          filesystemType = 'unknown';
        }
      }
    } catch (error) {
      if (error instanceof CleanShelfTargetProbeError) throw error;
      fail(
        'P14_SHELF_TARGET_UNAVAILABLE',
        'Shelf Target Folder is not reachable and writable.',
        { causeCode: error.code || 'TARGET_PROBE_FAILED' },
      );
    }

    const target = proposedTarget || Object.freeze({
      endpointId: `local-filesystem-${process.platform}`,
      rootLocation: resolvedRoot,
      mountScopeId: `local-mount-${canonicalDigest({
        schema: 'platform.local-mount-scope@1',
        platform: process.platform,
        deviceId,
        filesystemType,
        pathRoot: pathApi.parse(resolvedRoot).root,
      }).slice(0, 32)}`,
      mountScopeRevision: 1,
    });
    const normalizedTarget = Object.freeze({ ...target, rootLocation: resolvedRoot });
    const evidenceBase = {
      schemaRef: EVIDENCE_SCHEMA_REF,
      shelfId,
      targetDigest: targetDigest(shelfId, normalizedTarget),
      endpointId: normalizedTarget.endpointId,
      rootLocation: resolvedRoot,
      mountScopeId: normalizedTarget.mountScopeId,
      mountScopeRevision: normalizedTarget.mountScopeRevision,
      directoryReadable: true,
      directoryWritable: true,
      safeMaterialCommit: true,
      commitProtocol: 'target_local_slot_then_atomic_switch',
      observationMode: 'read_only',
      filesystemType,
      physicalEffect: 'none',
    };
    const evidence = Object.freeze({
      ...evidenceBase,
      probeDigest: canonicalDigest(evidenceBase),
    });
    return Object.freeze({ target: normalizedTarget, evidence });
  }

  function inspectRoot(request) {
    exact(request, ['shelfId', 'rootLocation'], 'P14_SHELF_TARGET_PROBE_INPUT');
    const shelfId = text(request.shelfId, 'shelfId', 256);
    const requestedRoot = text(request.rootLocation, 'rootLocation');
    if (!pathApi.isAbsolute(requestedRoot)) {
      fail(
        'P14_SHELF_TARGET_ROOT_ABSOLUTE',
        'Shelf Target Folder must be an absolute location.',
      );
    }
    return inspectResolved(shelfId, requestedRoot);
  }

  function inspect(request) {
    exact(request, ['shelfId', 'target'], 'P14_SHELF_TARGET_PROBE_INPUT');
    exact(
      request.target,
      ['endpointId', 'rootLocation', 'mountScopeId', 'mountScopeRevision'],
      'P14_SHELF_TARGET_INPUT',
    );
    const shelfId = text(request.shelfId, 'shelfId', 256);
    const endpointId = text(request.target.endpointId, 'target.endpointId', 256);
    const mountScopeId = text(request.target.mountScopeId, 'target.mountScopeId', 256);
    if (!Number.isSafeInteger(request.target.mountScopeRevision) ||
        request.target.mountScopeRevision < 1) {
      fail(
        'P14_SHELF_TARGET_MOUNT_REVISION',
        'Shelf Target Mount Scope revision must be a positive integer.',
      );
    }
    const requestedRoot = text(request.target.rootLocation, 'target.rootLocation');
    if (!pathApi.isAbsolute(requestedRoot)) {
      fail(
        'P14_SHELF_TARGET_ROOT_ABSOLUTE',
        'Shelf Target Folder must be an absolute location.',
      );
    }

    const target = Object.freeze({
      endpointId,
      rootLocation: requestedRoot,
      mountScopeId,
      mountScopeRevision: request.target.mountScopeRevision,
    });
    return inspectResolved(shelfId, requestedRoot, target);
  }

  return Object.freeze({ inspect, inspectRoot });
}

module.exports = Object.freeze({
  CleanShelfTargetProbeError,
  createCleanShelfTargetFolderProbe,
});
