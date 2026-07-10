'use strict';

const { notImplemented } = require('./helixError');

const SERVICE_NAME = 'kairox';

function createKairoxService(dependencies = {}) {
  const implementation = dependencies.implementation
    || require('./kairoxRuntime').createKairoxRuntime(dependencies);

  return Object.freeze({
    serviceName: SERVICE_NAME,
    reconcileMaintenance(command) {
      if (typeof implementation.reconcileMaintenance === 'function') {
        return implementation.reconcileMaintenance(command);
      }
      throw notImplemented('KairoxService.reconcileMaintenance');
    },
    reconcileObjectives(itemIds) {
      if (typeof implementation.reconcileObjectives === 'function') return implementation.reconcileObjectives(itemIds);
      throw notImplemented('KairoxService.reconcileObjectives');
    },
    suspendMaintenance(command) {
      if (typeof implementation.suspendMaintenance === 'function') {
        return implementation.suspendMaintenance(command);
      }
      throw notImplemented('KairoxService.suspendMaintenance');
    },
    requestMaintenance(command) {
      if (typeof implementation.requestMaintenance === 'function') {
        return implementation.requestMaintenance(command);
      }
      throw notImplemented('KairoxService.requestMaintenance');
    },
    updateUserPerception(command) {
      if (typeof implementation.updateUserPerception === 'function') return implementation.updateUserPerception(command);
      throw notImplemented('KairoxService.updateUserPerception');
    },
    getMaintenanceProjection(itemId) {
      if (typeof implementation.getMaintenanceProjection === 'function') {
        return implementation.getMaintenanceProjection(itemId);
      }
      throw notImplemented('KairoxService.getMaintenanceProjection');
    },
    getMaintenanceProjections(itemIds) {
      if (typeof implementation.getMaintenanceProjections === 'function') {
        return implementation.getMaintenanceProjections(itemIds);
      }
      return (itemIds || []).reduce((out, itemId) => {
        out[itemId] = this.getMaintenanceProjection(itemId);
        return out;
      }, {});
    },
  });
}

module.exports = { SERVICE_NAME, createKairoxService };
