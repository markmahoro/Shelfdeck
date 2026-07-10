'use strict';

class HelixError extends Error {
  constructor(code, message, details = {}) {
    super(message || code || 'Helix error');
    this.name = 'HelixError';
    this.code = String(code || 'HELIX_ERROR');
    this.details = details && typeof details === 'object' ? details : {};
  }
}

function notImplemented(capability) {
  return new HelixError(
    'HELIX_CAPABILITY_NOT_IMPLEMENTED',
    `${capability} is not implemented yet`,
    { capability },
  );
}

module.exports = { HelixError, notImplemented };
