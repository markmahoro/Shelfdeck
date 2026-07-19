'use strict';

const catalog = require('../../../contracts/ports/p8-libra-intake-public-contracts.json');
const productionCatalog = require('../../../contracts/ports/p9-libra-production-public-contracts.json');
const { packageId } = require('./package.boundary.json');

class LibraPublicFacadeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraPublicFacadeError';
    this.code = code;
    this.details = details;
  }
}

const contract = catalog.facades.find((entry) => entry.packageId === packageId && entry.exportName === 'LibraIntakeFacade');
if (!contract) throw new LibraPublicFacadeError('P8_LIBRA_INTAKE_CONTRACT_MISSING', 'Libra Intake public contract is missing.');
const productDeliveryContract = productionCatalog.ports.find((entry) =>
  entry.packageId === packageId && entry.exportName === 'ProductDeliveryPort'
);
if (!productDeliveryContract) {
  throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_CONTRACT_MISSING', 'Product Delivery public contract is missing.');
}

function bind(implementation) {
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new LibraPublicFacadeError('P8_LIBRA_INTAKE_IMPLEMENTATION_REQUIRED', 'A typed Libra Intake implementation is required.');
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...contract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || typeof implementation.offerCandidate !== 'function') {
    throw new LibraPublicFacadeError('P8_LIBRA_INTAKE_PORT_SHAPE_MISMATCH',
      'Libra Intake implementation must expose only the frozen offerCandidate method.', { expected, provided });
  }
  return Object.freeze({ offerCandidate:(message) => implementation.offerCandidate(message) });
}

function bindProductDelivery(implementation) {
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_IMPLEMENTATION_REQUIRED',
      'A typed Product Delivery implementation is required.');
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...productDeliveryContract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || typeof implementation.readPackage !== 'function') {
    throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_PORT_SHAPE_MISMATCH',
      'Product Delivery implementation must expose only the frozen readPackage method.', { expected, provided });
  }
  return Object.freeze({ readPackage: (query) => implementation.readPackage(query) });
}

module.exports = Object.freeze({ PACKAGE_ID:packageId, LibraIntakeFacade:bind, ProductDeliveryPort:bindProductDelivery });
