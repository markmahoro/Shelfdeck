'use strict';

const contractCatalog = require('../../contracts/ports/p5-public-port-contracts.json');
const { packageId } = require('./package.boundary.json');

class PlatformPublicPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PlatformPublicPortError';
    this.code = code;
    this.details = details;
  }
}

const contracts = new Map(contractCatalog.contracts
  .filter((contract) => contract.packageId === 'platform.public')
  .map((contract) => [contract.exportName, Object.freeze({ ...contract })]));

function bind(exportName, implementation) {
  const contract = contracts.get(exportName);
  if (!contract) throw new PlatformPublicPortError('P5_UNKNOWN_PLATFORM_PORT', 'Unknown Platform public port.', { exportName });
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new PlatformPublicPortError('P5_PLATFORM_PORT_IMPLEMENTATION_REQUIRED', 'A typed implementation object is required.', { exportName });
  }
  const expected = contract.methods ? contract.methods.map((item) => item.name).sort() : [contract.method];
  const provided = Object.keys(implementation).sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || expected.some((method) => typeof implementation[method] !== 'function')) {
    throw new PlatformPublicPortError('P5_PLATFORM_PORT_SHAPE_MISMATCH', 'Implementation must match the nominal method exactly.', {
      exportName, expected, provided
    });
  }
  return Object.freeze(Object.fromEntries(expected.map((method) => [method, (input) => implementation[method](input)])));
}

const exported = { PACKAGE_ID: packageId };
for (const exportName of [...contracts.keys()].sort()) exported[exportName] = (implementation) => bind(exportName, implementation);

module.exports = Object.freeze(exported);
