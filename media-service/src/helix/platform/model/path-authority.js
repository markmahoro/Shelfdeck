'use strict';

class PathAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PathAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PathAuthorityError(code, message, details);
}

function createPathAuthority(pathAdapter) {
  if (!pathAdapter || ['resolve', 'normalize', 'isAbsolute', 'relative'].some((name) => typeof pathAdapter[name] !== 'function')) {
    fail('P5_PATH_ADAPTER_REQUIRED', 'An explicit platform path adapter is required.');
  }

  function canonicalize(candidate) {
    if (typeof candidate !== 'string' || candidate.length < 1 || candidate.length > 4096 || candidate.includes('\0')) {
      fail('P5_PATH_INVALID', 'Path must be a bounded non-empty string.');
    }
    const segments = candidate.split(/[\\/]+/);
    if (segments.includes('..')) fail('P5_PATH_TRAVERSAL', 'Parent traversal segments are forbidden.');
    if (!pathAdapter.isAbsolute(candidate)) fail('P5_PATH_ABSOLUTE_REQUIRED', 'Registry paths must be absolute.');
    const resolved = pathAdapter.normalize(pathAdapter.resolve(candidate));
    if (!pathAdapter.isAbsolute(resolved)) fail('P5_PATH_CANONICALIZATION_FAILED', 'Canonical path is not absolute.');
    return resolved;
  }

  function contains(root, candidate) {
    const canonicalRoot = canonicalize(root);
    const canonicalCandidate = canonicalize(candidate);
    const relative = pathAdapter.relative(canonicalRoot, canonicalCandidate);
    return relative === '' || (!relative.startsWith('..') && !pathAdapter.isAbsolute(relative));
  }

  function overlaps(left, right) {
    return contains(left, right) || contains(right, left);
  }

  return Object.freeze({ canonicalize, contains, overlaps });
}

module.exports = Object.freeze({ PathAuthorityError, createPathAuthority });
