'use strict';

const contractCatalog = require('../contracts/ports/p5-public-port-contracts.json');
const { packageId } = require('./package.boundary.json');

class IntegrationPublicPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationPublicPortError';
    this.code = code;
    this.details = details;
  }
}

const contracts = new Map(contractCatalog.contracts
  .filter((contract) => contract.packageId === 'integrations')
  .map((contract) => [contract.exportName, Object.freeze({ ...contract })]));

function bind(exportName, implementation) {
  const contract = contracts.get(exportName);
  if (!contract) throw new IntegrationPublicPortError('P5_UNKNOWN_INTEGRATION_PORT', 'Unknown Integration public port.', { exportName });
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new IntegrationPublicPortError('P5_INTEGRATION_PORT_IMPLEMENTATION_REQUIRED', 'A typed implementation object is required.', { exportName });
  }
  const provided = Object.keys(implementation).sort();
  if (provided.length !== 1 || provided[0] !== contract.method || typeof implementation[contract.method] !== 'function') {
    throw new IntegrationPublicPortError('P5_INTEGRATION_PORT_SHAPE_MISMATCH', 'Implementation must match the nominal method exactly.', {
      exportName, expected: [contract.method], provided
    });
  }
  return Object.freeze({ [contract.method]: (input) => implementation[contract.method](input) });
}

const exported = { PACKAGE_ID: packageId };
for (const exportName of [...contracts.keys()].sort()) exported[exportName] = (implementation) => bind(exportName, implementation);

module.exports = Object.freeze(exported);
