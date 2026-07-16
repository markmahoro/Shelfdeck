'use strict';

const ERROR_CODE = 'HELIX_COMPOSITION_NOT_IMPLEMENTED';

class HelixCompositionNotImplementedError extends Error {
  constructor() {
    super('The clean Helix composition root is not wired yet');
    this.name = 'HelixCompositionNotImplementedError';
    this.code = ERROR_CODE;
  }
}

function createHelixApplication() {
  throw new HelixCompositionNotImplementedError();
}

module.exports = Object.freeze({
  ERROR_CODE,
  HelixCompositionNotImplementedError,
  createHelixApplication,
});
