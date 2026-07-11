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
    reconcileObjectives(subjectIds) {
      if (typeof implementation.reconcileObjectives === 'function') return implementation.reconcileObjectives(subjectIds);
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
    getMaintenanceProjection(subjectId) {
      if (typeof implementation.getMaintenanceProjection === 'function') {
        return implementation.getMaintenanceProjection(subjectId);
      }
      throw notImplemented('KairoxService.getMaintenanceProjection');
    },
    getMaintenanceProjections(subjectIds) {
      if (typeof implementation.getMaintenanceProjections === 'function') {
        return implementation.getMaintenanceProjections(subjectIds);
      }
      return (subjectIds || []).reduce((out, subjectId) => {
        out[subjectId] = this.getMaintenanceProjection(subjectId);
        return out;
      }, {});
    },
    getMaintenanceSummaryProjections(subjectIds) {
      if (typeof implementation.getMaintenanceSummaryProjections === 'function') {
        return implementation.getMaintenanceSummaryProjections(subjectIds);
      }
      return this.getMaintenanceProjections(subjectIds);
    },
    getPendingSourceMutations(limit) {
      if (typeof implementation.getPendingSourceMutations === 'function') return implementation.getPendingSourceMutations(limit);
      throw notImplemented('KairoxService.getPendingSourceMutations');
    },
    acknowledgeSourceMutation(mutationId) {
      if (typeof implementation.acknowledgeSourceMutation === 'function') return implementation.acknowledgeSourceMutation(mutationId);
      throw notImplemented('KairoxService.acknowledgeSourceMutation');
    },
  });
}

module.exports = { SERVICE_NAME, createKairoxService };
