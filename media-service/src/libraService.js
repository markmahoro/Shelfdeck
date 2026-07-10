'use strict';

const { notImplemented } = require('./helixError');

const SERVICE_NAME = 'libra';

function requireCapability(service, name) {
  if (!service || typeof service[name] !== 'function') {
    throw new TypeError(`Missing required Helix capability: ${name}`);
  }
}

function createLibraService(dependencies = {}) {
  const nexoraService = dependencies.nexoraService;
  const kairoxService = dependencies.kairoxService;
  requireCapability(nexoraService, 'getSourceProjection');
  requireCapability(kairoxService, 'getMaintenanceProjection');
  const implementation = dependencies.implementation || {};

  return Object.freeze({
    serviceName: SERVICE_NAME,
    acceptSource(command) {
      if (typeof implementation.acceptSource === 'function') return implementation.acceptSource(command);
      throw notImplemented('LibraService.acceptSource');
    },
    requestMaintenance(command) {
      if (typeof implementation.requestMaintenance === 'function') return implementation.requestMaintenance(command);
      throw notImplemented('LibraService.requestMaintenance');
    },
    requestOffboarding(command) {
      if (typeof implementation.requestOffboarding === 'function') return implementation.requestOffboarding(command);
      throw notImplemented('LibraService.requestOffboarding');
    },
    requestOffboardingBatch(command) {
      if (typeof implementation.requestOffboardingBatch === 'function') return implementation.requestOffboardingBatch(command);
      throw notImplemented('LibraService.requestOffboardingBatch');
    },
    reconcileItem(itemId) {
      if (typeof implementation.reconcileItem === 'function') return implementation.reconcileItem(itemId);
      throw notImplemented('LibraService.reconcileItem');
    },
    reconcileBatch(itemIds) {
      if (typeof implementation.reconcileBatch === 'function') return implementation.reconcileBatch(itemIds);
      throw notImplemented('LibraService.reconcileBatch');
    },
    getLibraryProjection(itemId) {
      if (typeof implementation.getLibraryProjection === 'function') return implementation.getLibraryProjection(itemId);
      throw notImplemented('LibraService.getLibraryProjection');
    },
    getLibraryProjections(itemIds) {
      if (typeof implementation.getLibraryProjections === 'function') return implementation.getLibraryProjections(itemIds);
      return (itemIds || []).reduce((out, itemId) => {
        out[itemId] = this.getLibraryProjection(itemId);
        return out;
      }, {});
    },
  });
}

module.exports = { SERVICE_NAME, createLibraService };
