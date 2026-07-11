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
    startMaintenanceRun(command) {
      if (typeof implementation.startMaintenanceRun === 'function') return implementation.startMaintenanceRun(command);
      throw notImplemented('KairoxService.startMaintenanceRun');
    },
    setMaintenancePriority(command) {
      if (typeof implementation.setMaintenancePriority === 'function') return implementation.setMaintenancePriority(command);
      throw notImplemented('KairoxService.setMaintenancePriority');
    },
    clearMaintenancePriority(command) {
      if (typeof implementation.clearMaintenancePriority === 'function') return implementation.clearMaintenancePriority(command);
      throw notImplemented('KairoxService.clearMaintenancePriority');
    },
    reconcileMaintenanceRun(command) {
      if (typeof implementation.reconcileMaintenanceRun === 'function') return implementation.reconcileMaintenanceRun(command);
      throw notImplemented('KairoxService.reconcileMaintenanceRun');
    },
    requestMetadataRefresh(command) {
      if (typeof implementation.requestMetadataRefresh === 'function') return implementation.requestMetadataRefresh(command);
      throw notImplemented('KairoxService.requestMetadataRefresh');
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
    getMaintenanceSummaryProjections(itemIds) {
      if (typeof implementation.getMaintenanceSummaryProjections === 'function') {
        return implementation.getMaintenanceSummaryProjections(itemIds);
      }
      return this.getMaintenanceProjections(itemIds);
    },
  });
}

module.exports = { SERVICE_NAME, createKairoxService };
