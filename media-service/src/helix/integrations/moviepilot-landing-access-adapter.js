'use strict';

const fs = require('node:fs');
const path = require('node:path');

class MoviePilotLandingAccessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MoviePilotLandingAccessError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MoviePilotLandingAccessError(code, message, details);
}

function overlaps(left, right) {
  const normalize = process.platform === 'win32'
    ? (value) => value.toLowerCase()
    : (value) => value;
  const a = normalize(path.resolve(left));
  const b = normalize(path.resolve(right));
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

function probe(input) {
  const requested = input?.settings?.shelfDeckVisibleRoot;
  let real;
  let stat;
  try {
    real = fs.realpathSync.native(path.resolve(requested));
    stat = fs.statSync(real);
    fs.accessSync(real, fs.constants.R_OK);
  } catch (error) {
    fail('PLATFORM_MOVIEPILOT_LANDING_UNAVAILABLE',
      'MoviePilot Landing local path is not readable.', {
        field: 'shelfDeckVisibleRoot',
        cause: error.code || error.name,
      });
  }
  if (!stat.isDirectory()) {
    fail('PLATFORM_MOVIEPILOT_LANDING_NOT_DIRECTORY',
      'MoviePilot Landing local path must be a directory.');
  }
  const conflictingRoot = [...(input.reservedRoots || [])]
    .filter((item) => typeof item === 'string' && item.trim())
    .find((item) => overlaps(real, item));
  if (conflictingRoot) {
    fail('PLATFORM_MOVIEPILOT_LANDING_ROOT_OVERLAP',
      'MoviePilot Landing cannot overlap a Workspace, Artifact, Material Field, or Shelf Target root.');
  }
  return Object.freeze({
    settings: Object.freeze({
      ...input.settings,
      shelfDeckVisibleRoot: real,
    }),
    deviceId: String(stat.dev),
    checkedAtMs: input.now(),
  });
}

function assertRootDoesNotOverlap(binding, requestedRoot) {
  if (!binding) return;
  if (typeof requestedRoot !== 'string' || !requestedRoot.trim()) {
    fail('PLATFORM_MOVIEPILOT_LANDING_PATH_INVALID',
      'Reserved location root is invalid.');
  }
  let resolved = path.resolve(requestedRoot);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch (_error) {
    // The owning Domain probes its own path. The unresolved comparison still
    // protects future roots placed at or below the durable Landing root.
  }
  if (overlaps(binding.shelfDeckVisibleRoot, resolved)) {
    fail('PLATFORM_MOVIEPILOT_LANDING_ROOT_OVERLAP',
      'The requested location overlaps the active MoviePilot External Landing.');
  }
}

function resolve(binding, relativeLocation) {
  if (typeof relativeLocation !== 'string' || relativeLocation.length > 4096 ||
      relativeLocation.includes('\\') || path.posix.isAbsolute(relativeLocation) ||
      relativeLocation.split('/').some((part) => part === '..' || part === '.')) {
    fail('PLATFORM_MOVIEPILOT_LANDING_LOCATION_INVALID',
      'External Landing location is not a canonical endpoint-relative path.');
  }
  const root = fs.realpathSync.native(binding.shelfDeckVisibleRoot);
  const candidate = path.resolve(
    root,
    ...relativeLocation.split('/').filter(Boolean),
  );
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    fail('PLATFORM_MOVIEPILOT_LANDING_CONTAINMENT',
      'External Landing location escapes its configured root.');
  }
  const real = fs.realpathSync.native(candidate);
  if (real !== root && !real.startsWith(root + path.sep)) {
    fail('PLATFORM_MOVIEPILOT_LANDING_SYMLINK_ESCAPE',
      'External Landing location escapes through a symbolic link.');
  }
  return real;
}

module.exports = Object.freeze({
  MoviePilotLandingAccessError,
  assertRootDoesNotOverlap,
  probe,
  resolve,
});
