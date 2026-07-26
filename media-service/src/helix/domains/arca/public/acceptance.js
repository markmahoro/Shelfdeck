'use strict';

class ArcaAcceptanceFacadeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArcaAcceptanceFacadeError';
    this.code = code;
  }
}

function createArcaAcceptanceFacade(implementation) {
  if (!implementation || typeof implementation !== 'object' ||
      Array.isArray(implementation) ||
      canonicalKeys(implementation) !== 'acceptProductOffer' ||
      typeof implementation.acceptProductOffer !== 'function') {
    throw new ArcaAcceptanceFacadeError(
      'P14_ARCA_ACCEPTANCE_PORT_SHAPE',
      'Arca Acceptance Facade exposes only acceptProductOffer.',
    );
  }
  return Object.freeze({
    acceptProductOffer: (message) =>
      implementation.acceptProductOffer(message),
  });
}

function canonicalKeys(value) {
  return Object.keys(value).sort().join(',');
}

module.exports = Object.freeze({ createArcaAcceptanceFacade });
