'use strict';

const configStore = require('./configStore');
const kairoxAdmissionStore = require('./kairoxAdmissionStore');
const kairoxStore = require('./kairoxStore');
const lifecycleProjection = require('./lifecycleProjection');
const kairoxTaskCreator = require('./kairoxTaskCreator');
const taskStore = require('./taskStore');
const { HelixError } = require('./helixError');
const kairoxObjectivePolicy = require('./kairoxObjectivePolicy');
const kairoxSignalBus = require('./kairoxSignalBus');
const lifecycleObjectiveResolver = require('./lifecycleObjectiveResolver');
const lifecycleGateService = require('./lifecycleGateService');
const automationPolicy = require('./automationPolicy');

const MAINTENANCE_TARGETS = new Set(['basedata', 'metadata', 'optimize']);

function buildMaintenanceProjection(item, admission, projection, activeTasks = [], automaticFailure = null) {
  const basedataPassed = !!(projection && projection.basedataGate && projection.basedataGate.passed);
  const metadataPassed = !!(projection && projection.metadataGate && projection.metadataGate.passed);
  const optimizeGate = projection && projection.optimizeGate || null;
  const optimizePassed = !!(optimizeGate && optimizeGate.passed);
  const objectiveCurrent = optimizePassed && projection.optimizeObjectiveStatus === 'ready';
  const pendingCanonicalRefresh = !!(optimizeGate && optimizeGate.status === 'pending_canonical_refresh');
  const admissionCurrent = !!(admission && admission.status === 'active');
  const unresolvedSourceIncident = !!(admission && admission.incidentCode);
  const maintenanceComplete = !!(projection && projection.maintenanceComplete);
  const nextTargetGate = projection && ['basedata', 'metadata', 'optimize'].includes(projection.lifecycleNextTask)
    ? projection.lifecycleNextTask
    : null;
  const failureBlocksCurrentTarget = !!(automaticFailure
    && automaticFailure.targetGate === nextTargetGate
    && automaticFailure.admissionGeneration === (admission && admission.admissionGeneration || 0)
    && (nextTargetGate !== 'optimize' || !automaticFailure.objectiveHash || automaticFailure.objectiveHash === projection.objectiveHash));
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
    basedataPassed,
    metadataPassed,
    optimizePassed,
    objectiveCurrent,
    pendingCanonicalRefresh,
    unresolvedSourceIncident,
    maintenanceComplete,
    maintenanceState: projection && projection.maintenanceState || 'maintaining',
    nextTargetGate,
    automationBlocker: failureBlocksCurrentTarget ? {
      code: 'previous_automatic_task_failed',
      taskId: automaticFailure.taskId,
      targetGate: automaticFailure.targetGate,
      failedAt: automaticFailure.updatedAt,
    } : null,
    basedataFacts: item && item.basedataFacts || {},
    metadataFacts: item && item.metadataFacts || {},
    userPerceptionFacts: item && item.userPerceptionFacts || {},
    optimizeGate,
    basedataGate: projection && projection.basedataGate || null,
    metadataGate: projection && projection.metadataGate || null,
    optimizeObjective: projection && projection.optimizeObjective || {},
    optimizeObjectiveStatus: projection && projection.optimizeObjectiveStatus || '',
    disposalRecommendation: item && item.disposalRecommendation || null,
    nextGateObjective: projection && projection.lifecycleNextTask === 'optimize' ? projection.optimizeObjective || {} : {},
    activeTasks,
  };
}

function bundleToLifecycleItem(bundle, admission) {
  const basedata = bundle && bundle.basedata;
  const metadata = bundle && bundle.metadata;
  const optimize = bundle && bundle.optimize;
  const objective = bundle && bundle.objective;
  const userPerception = bundle && bundle.userPerception;
  const pendingRefresh = (bundle && bundle.refreshRequests || []).some((request) => request.status === 'pending');
  const optimizePassed = !!(optimize && optimize.status === 'fresh' && (!optimize.facts || optimize.facts.passed !== false));
  return {
    itemId: bundle && bundle.itemId || admission && admission.itemId || '',
    subLibraryId: admission && admission.sourceAccessDescriptor && admission.sourceAccessDescriptor.subLibraryId || '',
    ...(basedata && basedata.facts || {}),
    ...(metadata && metadata.facts || {}),
    ...(userPerception && userPerception.facts || {}),
    basedataFacts: basedata && basedata.facts || {},
    basedataComplete: !!(basedata && basedata.status === 'fresh'),
    basedataSourceRevision: basedata && basedata.sourceRevision || '',
    basedataUpdatedAt: basedata && basedata.updatedAt || '',
    metadataFacts: metadata && metadata.facts || {},
    userPerceptionFacts: userPerception && userPerception.facts || {},
    metadataComplete: !!(metadata && metadata.status === 'fresh'),
    metadataUpdatedAt: metadata && metadata.updatedAt || '',
    optimizeObjective: objective && objective.status === 'ready' ? objective.objective : null,
    optimizeObjectiveStatus: objective && objective.status || 'pending',
    objectiveVersion: objective && objective.objectiveRevision || '',
    objectiveHash: objective && objective.objectiveRevision || '',
    optimizeGate: optimize ? {
      gate: 'optimize',
      passed: optimizePassed && !pendingRefresh,
      status: pendingRefresh ? 'pending_canonical_refresh' : optimizePassed ? 'passed' : optimize.status,
      reason: pendingRefresh ? 'pending_canonical_refresh' : optimizePassed ? 'objective_satisfied' : 'objective_not_satisfied',
    } : null,
    disposalRecommendation: optimize && optimize.facts && optimize.facts.disposalRecommendation || null,
    factsFreshness: {
      basedataFacts: { status: basedata && basedata.status || 'missing', updatedAt: basedata && basedata.updatedAt || '' },
      metadataFacts: { status: metadata && metadata.status || 'missing', updatedAt: metadata && metadata.updatedAt || '' },
    },
    admissionCurrent: !!(admission && admission.status === 'active'),
    admissionSourceRevision: admission && admission.sourceRevision || '',
    unresolvedSourceIncident: !!(admission && admission.incidentCode),
    updatedAt: bundle && bundle.updatedAt || admission && admission.updatedAt || '',
  };
}

function createKairoxRuntime(dependencies = {}) {
  const admissions = dependencies.admissionStore || kairoxAdmissionStore;
  const facts = dependencies.kairoxStore || kairoxStore;
  const tasks = dependencies.taskStore || taskStore;
  const lifecycle = dependencies.lifecycleProjection || lifecycleProjection;
  const configs = dependencies.configStore || configStore;
  const taskCreator = dependencies.taskCreator || kairoxTaskCreator;

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
    const admission = admissions.getAdmission(itemId);
    const bundle = facts.getBundle(itemId);
    const item = bundleToLifecycleItem(bundle || { itemId }, admission);
    const cfg = configs.loadConfig();
    const policyItem = { ...kairoxObjectivePolicy.applyObjectivePolicy(item, cfg), allowedOptimizeFlowKinds: automationPolicy.resolveOptimizeAllowedFlowKinds(cfg) };
    const projection = lifecycle.decorateItem(policyItem, cfg);
    const failures = typeof tasks.queryLatestAutomaticFailures === 'function' ? tasks.queryLatestAutomaticFailures([itemId]) : {};
    return buildMaintenanceProjection(item, admission, projection, taskSummaries([itemId])[itemId] || [], failures[itemId] || null);
  }

  function getMaintenanceProjections(itemIds = []) {
    const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const admissionMap = admissions.getAdmissions(ids);
    const bundleMap = facts.getBundles(ids);
    const taskMap = taskSummaries(ids);
    const cfg = configs.loadConfig();
    const failureMap = typeof tasks.queryLatestAutomaticFailures === 'function' ? tasks.queryLatestAutomaticFailures(ids) : {};
    return ids.reduce((out, itemId) => {
      const admission = admissionMap[itemId];
      const item = bundleToLifecycleItem(bundleMap[itemId] || { itemId }, admission);
      const policyItem = { ...kairoxObjectivePolicy.applyObjectivePolicy(item, cfg), allowedOptimizeFlowKinds: automationPolicy.resolveOptimizeAllowedFlowKinds(cfg) };
      out[itemId] = buildMaintenanceProjection(item, admission, lifecycle.decorateItem(policyItem, cfg), taskMap[itemId] || [], failureMap[itemId] || null);
      return out;
    }, {});
  }

  function reconcileMaintenance(command = {}) {
    facts.ensureMedia({ itemId: command.itemId });
    admissions.upsertAdmission({ ...command, status: 'active', incidentCode: '' });
    const projection = getMaintenanceProjection(command.itemId);
    kairoxSignalBus.publish({ kind: 'admission_changed', itemId: command.itemId });
    return projection;
  }

  function reconcileObjectives(itemIds = []) {
    const cfg = configs.loadConfig();
    const ids = [...new Set(itemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean))];
    for (const itemId of ids) {
      const admission = admissions.getAdmission(itemId);
      if (!admission || admission.status !== 'active') continue;
      const bundle = facts.getBundle(itemId);
      if (!bundle) continue;
      const item = kairoxObjectivePolicy.applyObjectivePolicy(bundleToLifecycleItem(bundle, admission), cfg);
      const desired = lifecycleObjectiveResolver.projectOptimizeObjective(item, { config: cfg, ignoreExistingProjection: true });
      const objectiveRevision = String(desired.objectiveHash || '');
      const current = facts.getBundle(itemId).objective;
      const objective = desired.optimizeObjective || {};
      const changed = !current
        || current.objectiveRevision !== objectiveRevision
        || current.status !== desired.optimizeObjectiveStatus
        || JSON.stringify(current.objective || {}) !== JSON.stringify(objective);
      if (changed) {
        if (current && current.objectiveRevision !== objectiveRevision) {
          facts.markOptimizeStale({ itemId, reason: 'objective_revision_changed' });
        }
        facts.upsertObjective({
          itemId,
          policyRevision: admission.policyRevision || '',
          objectiveRevision,
          status: desired.optimizeObjectiveStatus || 'pending',
          objective,
        });
      }
      if (desired.optimizeObjectiveStatus === 'ready' && objectiveRevision) {
        const gate = lifecycleGateService.evaluateOptimizeGate({
          ...item,
          optimizeObjective: objective,
          optimizeObjectiveStatus: 'ready',
          objectiveHash: objectiveRevision,
          objectiveVersion: objectiveRevision,
        });
        const optimize = facts.getBundle(itemId).optimize;
        if (gate.passed && gate.flowKind === 'no_op'
          && (!optimize || optimize.status !== 'fresh' || optimize.objectiveRevision !== objectiveRevision)) {
          facts.publishOptimize({
            itemId,
            objectiveRevision,
            status: 'fresh',
            facts: { passed: true, flowKind: 'no_op', reason: gate.reason },
            evidence: { source: 'kairox_objective_reconciler' },
          });
        }
      }
    }
    return getMaintenanceProjections(ids);
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
      throw new HelixError('KAIROX_INVALID_TARGET_GATE', 'Kairox Service only accepts basedata, metadata or optimize targets');
    }
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') {
      throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    }
    if (command.libraryGeneration != null && Number(command.libraryGeneration) !== admission.admissionGeneration) {
      throw new HelixError('KAIROX_STALE_ADMISSION', 'Maintenance command uses a stale admission generation');
    }
    const bundle = facts.getBundle(command.itemId);
    if (!bundle) throw new HelixError('KAIROX_ITEM_NOT_FOUND', 'Kairox maintenance item not found');
    const item = bundleToLifecycleItem(bundle, admission);
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
      allowedOptimizeFlowKinds: automationPolicy.resolveOptimizeAllowedFlowKinds(command.config || configs.loadConfig()),
      tasks: command.tasks,
      logs: command.logs,
      helixAdmission: admission,
    });
  }

  function updateUserPerception(command = {}) {
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') {
      throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    }
    return facts.updateUserPerception({
      itemId: command.itemId,
      facts: command.facts || {},
      evidence: command.evidence || {},
      observedAt: command.observedAt,
    });
  }

  return Object.freeze({ reconcileMaintenance, reconcileObjectives, suspendMaintenance, requestMaintenance, updateUserPerception, getMaintenanceProjection, getMaintenanceProjections });
}

module.exports = { createKairoxRuntime, buildMaintenanceProjection, bundleToLifecycleItem };
