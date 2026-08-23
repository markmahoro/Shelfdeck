'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');

class CleanLocalFilesystemMountProbeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanLocalFilesystemMountProbeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanLocalFilesystemMountProbeError(code, message, details);
}

function unescapeMountInfo(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)));
}

function contains(root, candidate, pathApi) {
  const relative = pathApi.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + pathApi.sep) &&
    relative !== '..' && !pathApi.isAbsolute(relative));
}

function linuxMountEvidence(resolvedRoot, fsApi, pathApi, platform) {
  if (platform !== 'linux' || typeof fsApi.readFileSync !== 'function') return null;
  let rows;
  try {
    rows = fsApi.readFileSync('/proc/self/mountinfo', 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
  const candidates = [];
  for (const row of rows) {
    if (!row) continue;
    const separator = row.indexOf(' - ');
    if (separator < 0) continue;
    const left = row.slice(0, separator).split(' ');
    const right = row.slice(separator + 3).split(' ');
    if (left.length < 5 || right.length < 2) continue;
    const mountPoint = pathApi.normalize(unescapeMountInfo(left[4]));
    if (!contains(mountPoint, resolvedRoot, pathApi)) continue;
    candidates.push({
      mountBoundary: mountPoint,
      deviceIdentity: left[2],
      mountRoot: unescapeMountInfo(left[3]),
      filesystemType: right[0],
      sourceIdentity: unescapeMountInfo(right[1]),
    });
  }
  candidates.sort((left, right) => right.mountBoundary.length - left.mountBoundary.length);
  return candidates[0] || null;
}

function createCleanLocalFilesystemMountProbe(options = {}) {
  const fsApi = options.fsApi || fs;
  const pathApi = options.pathApi || path;
  const platform = options.platform || process.platform;

  function inspectRoot(rootLocation) {
    if (typeof rootLocation !== 'string' || !rootLocation || !pathApi.isAbsolute(rootLocation)) {
      fail('HELIX_MOUNT_SCOPE_UNSAFE', 'Local filesystem root must be an absolute path.');
    }
    let resolvedRoot;
    let stat;
    let filesystemType = 'unknown';
    try {
      const realpath = fsApi.realpathSync.native || fsApi.realpathSync;
      resolvedRoot = pathApi.normalize(realpath(rootLocation));
      stat = fsApi.statSync(resolvedRoot, { bigint:true });
      if (!stat.isDirectory()) fail('HELIX_MOUNT_SCOPE_UNSAFE', 'Local filesystem root is not a directory.');
      if (typeof fsApi.statfsSync === 'function') {
        try { filesystemType = String(fsApi.statfsSync(resolvedRoot).type); } catch { filesystemType = 'unknown'; }
      }
    } catch (error) {
      if (error instanceof CleanLocalFilesystemMountProbeError) throw error;
      fail('HELIX_MOUNT_SCOPE_UNSAFE', 'Local filesystem root cannot be resolved.', {
        causeCode: error.code || 'LOCAL_ROOT_PROBE_FAILED',
      });
    }
    const linux = linuxMountEvidence(resolvedRoot, fsApi, pathApi, platform);
    const mountBoundary = linux?.mountBoundary || pathApi.parse(resolvedRoot).root;
    const evidence = {
      schema: 'platform.local-filesystem-mount-evidence@1',
      platform,
      deviceIdentity: linux?.deviceIdentity || String(stat.dev),
      mountRoot: linux?.mountRoot || pathApi.normalize(mountBoundary).toLowerCase(),
      sourceIdentity: linux?.sourceIdentity || null,
      filesystemType: linux?.filesystemType || filesystemType,
    };
    const stableMountFingerprint = canonicalDigest(evidence);
    const inodeCapabilityDigest = canonicalDigest({
      schema: 'platform.local-filesystem-inode-capability@1',
      platform,
      inodeType: typeof stat.ino,
      hasMtimeNs: typeof stat.mtimeNs === 'bigint',
      hasCtimeNs: typeof stat.ctimeNs === 'bigint',
    });
    const endpointId = 'local-filesystem-' + platform;
    const probeEvidenceDigest = canonicalDigest({
      schema: 'platform.local-filesystem-mount-probe@1',
      endpointId,
      mountBoundary,
      filesystemType: evidence.filesystemType,
      stableMountFingerprint,
      inodeCapabilityDigest,
    });
    return Object.freeze({
      resolvedRoot,
      endpointId,
      mountBoundary,
      filesystemType: evidence.filesystemType,
      stableMountFingerprint,
      inodeCapabilityDigest,
      probeEvidenceDigest,
    });
  }

  return Object.freeze({ inspectRoot });
}

module.exports = Object.freeze({
  CleanLocalFilesystemMountProbeError,
  createCleanLocalFilesystemMountProbe,
});
