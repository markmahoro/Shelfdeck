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
    requestMaintenanceRun(command) {
      if (typeof implementation.requestMaintenanceRun === 'function') return implementation.requestMaintenanceRun(command);
      throw notImplemented('LibraService.requestMaintenanceRun');
    },
    setMaintenancePriority(command) {
      if (typeof implementation.setMaintenancePriority === 'function') return implementation.setMaintenancePriority(command);
      throw notImplemented('LibraService.setMaintenancePriority');
    },
    clearMaintenancePriority(command) {
      if (typeof implementation.clearMaintenancePriority === 'function') return implementation.clearMaintenancePriority(command);
      throw notImplemented('LibraService.clearMaintenancePriority');
    },
    requestMetadataRefresh(command) {
      if (typeof implementation.requestMetadataRefresh === 'function') return implementation.requestMetadataRefresh(command);
      throw notImplemented('LibraService.requestMetadataRefresh');
    },
    updateUserPerception(command) {
      if (typeof implementation.updateUserPerception === 'function') return implementation.updateUserPerception(command);
      throw notImplemented('LibraService.updateUserPerception');
    },
    createSubLibrary(command) {
      if (typeof implementation.createSubLibrary === 'function') return implementation.createSubLibrary(command);
      throw notImplemented('LibraService.createSubLibrary');
    },
    updateSubLibrary(subLibraryId, updates) {
      if (typeof implementation.updateSubLibrary === 'function') return implementation.updateSubLibrary(subLibraryId, updates);
      throw notImplemented('LibraService.updateSubLibrary');
    },
    deleteSubLibrary(subLibraryId) {
      if (typeof implementation.deleteSubLibrary === 'function') return implementation.deleteSubLibrary(subLibraryId);
      throw notImplemented('LibraService.deleteSubLibrary');
    },
    requestLibraryObservation(command) {
      if (typeof implementation.requestLibraryObservation === 'function') return implementation.requestLibraryObservation(command);
      throw notImplemented('LibraService.requestLibraryObservation');
    },
    requestReconcileSweep(command) {
      if (typeof implementation.requestReconcileSweep === 'function') return implementation.requestReconcileSweep(command);
      throw notImplemented('LibraService.requestReconcileSweep');
    },
    requestUserPerceptionSync(command) {
      if (typeof implementation.requestUserPerceptionSync === 'function') return implementation.requestUserPerceptionSync(command);
      throw notImplemented('LibraService.requestUserPerceptionSync');
    },
    runLibraryWork(workId, options) {
      if (typeof implementation.runLibraryWork === 'function') return implementation.runLibraryWork(workId, options);
      throw notImplemented('LibraService.runLibraryWork');
    },
    getAutomationProjection() {
      if (typeof implementation.getAutomationProjection === 'function') return implementation.getAutomationProjection();
      throw notImplemented('LibraService.getAutomationProjection');
    },
    requestOffboarding(command) {
      if (typeof implementation.requestOffboarding === 'function') return implementation.requestOffboarding(command);
      throw notImplemented('LibraService.requestOffboarding');
    },
    requestOffboardingBatch(command) {
      if (typeof implementation.requestOffboardingBatch === 'function') return implementation.requestOffboardingBatch(command);
      throw notImplemented('LibraService.requestOffboardingBatch');
    },
    reconcileItem(subjectId) {
      if (typeof implementation.reconcileItem === 'function') return implementation.reconcileItem(subjectId);
      throw notImplemented('LibraService.reconcileItem');
    },
    reconcileBatch(subjectIds) {
      if (typeof implementation.reconcileBatch === 'function') return implementation.reconcileBatch(subjectIds);
      throw notImplemented('LibraService.reconcileBatch');
    },
    getLibraryProjection(subjectId) {
      if (typeof implementation.getLibraryProjection === 'function') return implementation.getLibraryProjection(subjectId);
      throw notImplemented('LibraService.getLibraryProjection');
    },
    getLibraryProjections(subjectIds) {
      if (typeof implementation.getLibraryProjections === 'function') return implementation.getLibraryProjections(subjectIds);
      return (subjectIds || []).reduce((out, subjectId) => {
        out[subjectId] = this.getLibraryProjection(subjectId);
        return out;
      }, {});
    },
    queryLibraryProjections(filter, options) {
      if (typeof implementation.queryLibraryProjections === 'function') {
        return implementation.queryLibraryProjections(filter, options);
      }
      throw notImplemented('LibraService.queryLibraryProjections');
    },
    getLibraryMaintenanceSummaries(options) {
      if (typeof implementation.getLibraryMaintenanceSummaries === 'function') {
        return implementation.getLibraryMaintenanceSummaries(options);
      }
      throw notImplemented('LibraService.getLibraryMaintenanceSummaries');
    },
  });
}

module.exports = { SERVICE_NAME, createLibraService };
