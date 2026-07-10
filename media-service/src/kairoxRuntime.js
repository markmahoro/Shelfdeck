'use strict';

const configStore = require('./configStore');
const factsFreshnessService = require('./factsFreshnessService');
const kairoxAdmissionStore = require('./kairoxAdmissionStore');
const libraryStore = require('./libraryStore');
const lifecycleProjection = require('./lifecycleProjection');
const smartTaskEngine = require('./smartTaskEngine');
const taskStore = require('./taskStore');
const { HelixError } = require('./helixError');

const MAINTENANCE_TARGETS = new Set(['metadata', 'optimize', 'archive']);

function buildMaintenanceProjection(item, admission, projection, activeTasks = []) {
  const freshness = projection && projection.factsFreshness || item && item.factsFreshness || {};
  const metadataPassed = !!(item && item.metadataComplete)
    && factsFreshnessService.isFresh(freshness, 'mediaFacts')
    && factsFreshnessService.isFresh(freshness, 'metadataFacts');
  const optimizeGate = projection && projection.optimizeGate || null;
  const optimizePassed = !!(optimizeGate && optimizeGate.passed);
  const objectiveCurrent = optimizePassed && projection.optimizeObjectiveStatus === 'ready';
  const pendingCanonicalRefresh = !!(optimizeGate && optimizeGate.status === 'pending_canonical_refresh');
  const admissionCurrent = !!(admission && admission.status === 'active');
  const unresolvedSourceIncident = !!(admission && admission.incidentCode);
  const maintenanceComplete = admissionCurrent
    && metadataPassed
    && optimizePassed
    && objectiveCurrent
    && !pendingCanonicalRefresh
    && !unresolvedSourceIncident;
  return {
    itemId: item && item.itemId || admission && admission.itemId || '',
    maintenanceRevision: [
      admission && admission.admissionGeneration || 0,
      projection && projection.objectiveVersion || '',
      projection && projection.objectiveHash || '',
      projection && projection.updatedAt || item && item.updatedAt || '',
    ].join(':'),
    admission: admission || null,
    admissionCurrent,
    metadataPassed,
    optimizePassed,
    objectiveCurrent,
    pendingCanonicalRefresh,
    unresolvedSourceIncident,
    maintenanceComplete,
    nextTargetGate: projection && ['metadata', 'optimize', 'archive'].includes(projection.lifecycleNextTask)
      ? projection.lifecycleNextTask
      : null,
    activeTasks,
  };
}

function createKairoxRuntime(dependencies = {}) {
  const admissions = dependencies.admissionStore || kairoxAdmissionStore;
  const library = dependencies.libraryStore || libraryStore;
  const tasks = dependencies.taskStore || taskStore;
  const lifecycle = dependencies.lifecycleProjection || lifecycleProjection;
  const configs = dependencies.configStore || configStore;
  const taskCreator = dependencies.taskCreator || smartTaskEngine;

  function taskSummaries(itemIds) {
    if (!itemIds || itemIds.length === 0) return {};
    const rows = tasks.queryTaskSummaries({ itemIds }, { includeAll: true, includeHistory: false, maxPageSize: 1000 }).tasks || [];
    return rows.reduce((out, task) => {
      if (!out[task.itemId]) out[task.itemId] = [];
      out[task.itemId].push(task);
      return out;
    }, {});
  }

  function getMaintenanceProjection(itemId) {
    const item = library.getItem(itemId);
    const admission = admissions.getAdmission(itemId);
    if (!item) return buildMaintenanceProjection({ itemId }, admission, {}, []);
    const projection = lifecycle.decorateItem(item, configs.loadConfig());
    return buildMaintenanceProjection(item, admission, projection, taskSummaries([itemId])[itemId] || []);
  }

  function getMaintenanceProjections(itemIds = []) {
    const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const admissionMap = admissions.getAdmissions(ids);
    const taskMap = taskSummaries(ids);
    const cfg = configs.loadConfig();
    return ids.reduce((out, itemId) => {
      const item = library.getItem(itemId) || { itemId };
      out[itemId] = buildMaintenanceProjection(item, admissionMap[itemId], lifecycle.decorateItem(item, cfg), taskMap[itemId] || []);
      return out;
    }, {});
  }

  function reconcileMaintenance(command = {}) {
    const item = library.getItem(command.itemId);
    if (!item) throw new HelixError('KAIROX_ITEM_NOT_FOUND', 'Kairox maintenance item not found');
    admissions.upsertAdmission({ ...command, status: 'active', incidentCode: '' });
    return getMaintenanceProjection(command.itemId);
  }

  function suspendMaintenance(command = {}) {
    const current = admissions.getAdmission(command.itemId);
    const generation = Math.max(Number(command.admissionGeneration) || 0, current && current.admissionGeneration || 0);
    const admission = admissions.upsertAdmission({
      ...(current || {}),
      itemId: command.itemId,
      admissionGeneration: generation,
      status: 'suspended',
      incidentCode: command.reason || 'source_incident',
    });
    const active = tasks.getTasks({ itemId: command.itemId }).filter((task) => !['done', 'failed_hard', 'failed_soft', 'skipped', 'cancelled', 'interrupted'].includes(task.status));
    for (const task of active) {
      tasks.updateTask(task.id, {
        status: 'interrupted',
        phase: 'helix_fenced',
        helixFence: {
          reason: command.reason || 'source_incident',
          currentGeneration: generation,
          expectedGeneration: task.helixAdmission && task.helixAdmission.admissionGeneration,
        },
        logs: [{ ts: new Date().toISOString(), level: 'warning', msg: `Maintenance suspended: ${command.reason || 'source_incident'}` }],
      });
    }
    return { admission, interruptedTasks: active.map((task) => task.id), projection: getMaintenanceProjection(command.itemId) };
  }

  function requestMaintenance(command = {}) {
    const targetGate = String(command.targetGate || '');
    if (!MAINTENANCE_TARGETS.has(targetGate)) {
      throw new HelixError('KAIROX_MAINTENANCE_TARGET_REQUIRED', 'Kairox Service only accepts metadata, optimize or archive targets');
    }
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') {
      throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    }
    if (command.libraryGeneration != null && Number(command.libraryGeneration) !== admission.admissionGeneration) {
      throw new HelixError('KAIROX_STALE_ADMISSION', 'Maintenance command uses a stale admission generation');
    }
    const item = library.getItem(command.itemId);
    if (!item) throw new HelixError('KAIROX_ITEM_NOT_FOUND', 'Kairox maintenance item not found');
    return taskCreator.createTargetGateTask({
      item,
      itemInfo: command.itemInfo || item,
      targetGate,
      gateObjective: command.gateObjective,
      flowPreference: command.flowPreference,
      requestedIntent: command.intent,
      source: command.source || 'manual',
      status: command.status,
      config: command.config || configs.loadConfig(),
      tasks: command.tasks,
      logs: command.logs,
      helixAdmission: admission,
    });
  }

  return Object.freeze({ reconcileMaintenance, suspendMaintenance, requestMaintenance, getMaintenanceProjection, getMaintenanceProjections });
}

module.exports = { createKairoxRuntime, buildMaintenanceProjection };
