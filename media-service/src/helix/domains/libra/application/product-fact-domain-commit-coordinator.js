'use strict';

const {
  createCanonicalTransactionRegistry,
  createDomainCommitCoordinator,
  createDomainCommitRegistry,
} = require('../../../foundation/persistence/domain-commit-registry');
const domainFactTransaction = require('../../../contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const { createProductFactRegistrations } = require('../persistence/product-fact-store');

function createProductFactDomainCommitCoordinator(options) {
  return createDomainCommitCoordinator({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
    registry: createDomainCommitRegistry({
      registrations: createProductFactRegistrations(options),
    }),
    transactionRegistry: createCanonicalTransactionRegistry({
      contracts: [domainFactTransaction],
    }),
  });
}

module.exports = Object.freeze({ createProductFactDomainCommitCoordinator });
