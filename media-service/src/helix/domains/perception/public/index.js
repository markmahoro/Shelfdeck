'use strict';

const catalog = require('../../../contracts/ports/p6-horizontal-domain-public-contracts.json');
const { packageId } = require('./package.boundary.json');

class PerceptionPublicFacadeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionPublicFacadeError';
    this.code = code;
    this.details = details;
  }
}

const contracts = new Map(catalog.facades
  .filter((contract) => contract.packageId === packageId)
  .map((contract) => [contract.exportName, Object.freeze({ ...contract, methods: Object.freeze([...contract.methods]) })]));

function bind(exportName, implementation) {
  const contract = contracts.get(exportName);
  if (!contract) throw new PerceptionPublicFacadeError('P6_UNKNOWN_PERCEPTION_FACADE', 'Unknown Perception public Facade.', { exportName });
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new PerceptionPublicFacadeError('P6_PERCEPTION_FACADE_IMPLEMENTATION_REQUIRED', 'A typed implementation object is required.', { exportName });
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...contract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || contract.methods.some((method) => typeof implementation[method] !== 'function')) {
    throw new PerceptionPublicFacadeError('P6_PERCEPTION_FACADE_SHAPE_MISMATCH', 'Implementation must match the nominal methods exactly.', {
      exportName, expected, provided
    });
  }
  return Object.freeze(Object.fromEntries(contract.methods.map((method) => [method, (input) => implementation[method](input)])));
}

module.exports = Object.freeze({
  PACKAGE_ID: packageId,
  PerceptionCommandFacade: (implementation) => bind('PerceptionCommandFacade', implementation),
  PerceptionResolutionFacade: (implementation) => bind('PerceptionResolutionFacade', implementation)
});
