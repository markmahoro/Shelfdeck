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
const personCatalogStore = require('./personCatalogStore');
const defaultResourceGovernor = require('./resourceGovernor');
const workflowStore = require('./workflowStore');
const resourceRuntime = require('./resourceRuntime');

const MAINTENANCE_TARGETS = new Set(['basedata', 'metadata', 'optimize']);

function buildOptimizationProjection(projection = {}, activeTasks = []) {
  const gate = projection.optimizeGate || null;
  const optimizeTask = (activeTasks || []).find((task) => String(task.taskTarget && task.taskTarget.targetGate || task.targetGate || '') === 'optimize') || null;
  const plan = optimizeTask ? workflowStore.getPlanForTask(optimizeTask.id) : null;
  const plannedCapabilities = plan ? plan.nodes.map((node) => node.capability) : [];
  let optimizationDirection = 'undetermined';
  let directionReason = gate && gate.reason || projection.lifecycleReason || 'objective_not_ready';
  if (projection.basedataGate && projection.basedataGate.status === 'blocked') {
    optimizationDirection = 'blocked';
    directionReason = projection.basedataGate.reason || 'basedata_required_facts_missing';
  } else if (projection.metadataGate && projection.metadataGate.status === 'blocked') {
    optimizationDirection = 'blocked';
    directionReason = projection.metadataGate.reason || 'metadata_blocked';
  } else if (gate && gate.status === 'blocked') {
    optimizationDirection = 'blocked';
  } else if (plannedCapabilities.includes('source.upgrade.request')) {
    optimizationDirection = 'upgrade';
  } else if (plannedCapabilities.includes('media.transcode')) {
    optimizationDirection = 'transcode';
  } else if (gate && gate.passed) {
    optimizationDirection = 'none';
    directionReason = gate && gate.reason || 'objective_already_satisfied';
  } else if (projection.optimizeObjectiveStatus === 'blocked') {
    optimizationDirection = 'blocked';
  }
  const target = gate && gate.target || projection.optimizeObjective && projection.optimizeObjective.targetMediaFacts || {};
  return {
    optimizationDirection,
    plannedWorkflowClassification: plan && plan.classification || null,
    plannedCapabilities,
    directionReason,
    maintenanceTargetSummary: {
      qualityTier: target.qualityTier || '',
      targetCodec: target.codec || target.targetCodec || '',
      targetBitrateMbps: target.bitrateMbps || target.targetBitrate || null,
      maxSizeGB: target.maxSizeGB || null,
    },
  };
}

function buildMaintenanceProjection(item, admission, projection, activeTasks = [], automaticFailure = null, run = null, media = null) {
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
  const optimization = buildOptimizationProjection(projection || {}, activeTasks);
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
    ...optimization,
    maintenanceState: projection && projection.maintenanceState || 'maintaining',
    nextTargetGate,
    run,
    priority: {
      class: media && media.maintenancePriorityClass || 'normal',
      revision: media && media.priorityRevision || 0,
      reason: media && media.priorityReason || '',
      runId: media && media.priorityRunId || '',
      setAt: media && media.prioritySetAt || '',
    },
    maintenanceSubject: {
      mediaKind: media && media.mediaKind || '',
      playable: media ? media.playable !== false : true,
      parentItemId: media && media.parentItemId || '',
      seriesItemId: media && media.seriesItemId || '',
    },
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

function bundleToLifecycleItem(bundle, admission, peopleProjection = null) {
  const basedata = bundle && bundle.basedata;
  const metadata = bundle && bundle.metadata;
  const optimize = bundle && bundle.optimize;
  const objective = bundle && bundle.objective;
  const userPerception = bundle && bundle.userPerception;
  const pendingRefresh = (bundle && bundle.refreshRequests || []).some((request) => request.status === 'pending');
  const metadataRefresh = (bundle && bundle.refreshRequests || []).find((request) => request.factGroup === 'metadata' && request.status === 'pending');
  const optimizePassed = !!(optimize && optimize.status === 'fresh' && (!optimize.facts || optimize.facts.passed !== false));
  const people = peopleProjection || personCatalogStore.getItemPreferenceProjection(bundle && bundle.itemId || admission && admission.itemId || '');
  const media = bundle && bundle.media || {};
  const observedStructure = admission && admission.sourceAccessDescriptor && admission.sourceAccessDescriptor.observedStructure || {};
  return {
    itemId: bundle && bundle.itemId || admission && admission.itemId || '',
    name: basedata && basedata.facts && (basedata.facts.name || basedata.facts.title)
      || metadata && metadata.facts && (metadata.facts.title || metadata.facts.name)
      || observedStructure.displayName
      || '',
    subLibraryId: admission && admission.sourceAccessDescriptor && admission.sourceAccessDescriptor.subLibraryId || '',
    mediaKind: media.mediaKind || '',
    type: media.mediaKind || '',
    playable: media.playable !== false,
    parentItemId: media.parentItemId || '',
    seriesItemId: media.seriesItemId || '',
    ...(basedata && basedata.facts || {}),
    ...(metadata && metadata.facts || {}),
    ...(userPerception && userPerception.facts || {}),
    ...people,
    adultMetadata: metadataRefresh && metadataRefresh.evidence && metadataRefresh.evidence.adultId
      ? { adultId: metadataRefresh.evidence.adultId }
      : {},
    basedataFacts: basedata && basedata.facts || {},
    basedataComplete: !!(basedata && basedata.status === 'fresh'),
    basedataSourceRevision: basedata && basedata.sourceRevision || '',
    basedataUpdatedAt: basedata && basedata.updatedAt || '',
    metadataFacts: metadata && metadata.facts || {},
    metadataArtifactRevision: metadata && metadata.evidence && metadata.evidence.artifactRevision || '',
    metadataArtifactsReady: !!(metadata && metadata.evidence && metadata.evidence.artifactRevision),
    metadataArtifactsMaterialized: !!(optimize && optimize.facts && optimize.facts.metadataArtifactsMaterialized),
    layoutFacts: basedata && basedata.facts && basedata.facts.layout || {},
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
  const governor = dependencies.resourceGovernor || defaultResourceGovernor;

  function configContext(admission, config = configs.loadConfig()) {
    const descriptor = admission && admission.sourceAccessDescriptor || {};
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {};
    const policy = admission && admission.maintenancePolicy || {};
    return {
      maintenanceAutomationMode: subLibrary.maintenanceAutomationMode || policy.maintenanceAutomationMode || 'manual',
      libraryPriority: Number(subLibrary.priorityWeight || policy.libraryPriority) || 100,
      subLibrary,
      config,
    };
  }

  function prioritySnapshot(media) {
    return {
      class: media && media.maintenancePriorityClass || 'normal',
      revision: media && media.priorityRevision || 0,
      reason: media && media.priorityReason || '',
      runId: media && media.priorityRunId || '',
    };
  }

  function propagatePriority(media) {
    const snapshot = prioritySnapshot(media);
    const terminal = new Set(['done', 'failed_hard', 'failed_soft', 'skipped', 'cancelled', 'interrupted', 'plan_invalidated']);
    const active = tasks.getTasks({ itemId: media.itemId }).filter((task) => !terminal.has(task.status));
    for (const task of active) tasks.updateTask(task.id, { maintenancePrioritySnapshot: snapshot });
    if (typeof governor.reprioritizeWork === 'function') {
      for (const task of active) governor.reprioritizeWork({ owner: 'kairox', workId: task.id, maintenancePriorityClass: snapshot.class });
    }
    return active.map((task) => task.id);
  }

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
    const policyItem = kairoxObjectivePolicy.applyObjectivePolicy(item, cfg);
    const projection = lifecycle.decorateItem(policyItem, cfg);
    const failures = typeof tasks.queryLatestAutomaticFailures === 'function' ? tasks.queryLatestAutomaticFailures([itemId]) : {};
    return buildMaintenanceProjection(
      item, admission, projection, taskSummaries([itemId])[itemId] || [], failures[itemId] || null,
      facts.getMaintenanceRun(itemId), facts.getMedia(itemId),
    );
  }

  function getMaintenanceProjections(itemIds = []) {
    const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const admissionMap = admissions.getAdmissions(ids);
    const bundleMap = facts.getBundles(ids);
    const peopleMap = personCatalogStore.getItemPreferenceProjections(ids);
    const taskMap = taskSummaries(ids);
    const cfg = configs.loadConfig();
    const failureMap = typeof tasks.queryLatestAutomaticFailures === 'function' ? tasks.queryLatestAutomaticFailures(ids) : {};
    const runMap = typeof facts.getMaintenanceRuns === 'function' ? facts.getMaintenanceRuns(ids) : {};
    return ids.reduce((out, itemId) => {
      const admission = admissionMap[itemId];
      const item = bundleToLifecycleItem(bundleMap[itemId] || { itemId }, admission, peopleMap[itemId]);
      const policyItem = kairoxObjectivePolicy.applyObjectivePolicy(item, cfg);
      out[itemId] = buildMaintenanceProjection(
        item, admission, lifecycle.decorateItem(policyItem, cfg), taskMap[itemId] || [], failureMap[itemId] || null,
        runMap[itemId] || null, bundleMap[itemId] && bundleMap[itemId].media || null,
      );
      return out;
    }, {});
  }

  function getMaintenanceSummaryProjections(itemIds = []) {
    const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const admissionMap = admissions.getAdmissions(ids);
    const bundleMap = facts.getBundles(ids);
    const peopleMap = personCatalogStore.getItemPreferenceProjections(ids);
    const cfg = configs.loadConfig();
    return ids.reduce((out, itemId) => {
      const admission = admissionMap[itemId];
      const item = bundleToLifecycleItem(bundleMap[itemId] || { itemId }, admission, peopleMap[itemId]);
      const policyItem = kairoxObjectivePolicy.applyObjectivePolicy(item, cfg);
      const projection = buildMaintenanceProjection(
        item, admission, lifecycle.decorateItem(policyItem, cfg), [], null, null,
        bundleMap[itemId] && bundleMap[itemId].media || null,
      );
      out[itemId] = {
        itemId,
        basedataPassed: projection.basedataPassed,
        metadataPassed: projection.metadataPassed,
        optimizePassed: projection.optimizePassed,
        maintenanceComplete: projection.maintenanceComplete,
        optimizationDirection: projection.optimizationDirection,
      };
      return out;
    }, {});
  }

  function reconcileMaintenance(command = {}) {
    const subject = command.maintenanceSubject || {};
    facts.ensureMedia({
      itemId: command.itemId,
      mediaKind: subject.mediaKind,
      playable: subject.playable,
      parentItemId: subject.parentItemId,
      seriesItemId: subject.seriesItemId,
    });
    admissions.upsertAdmission({ ...command, status: 'active', incidentCode: '' });
    const projection = getMaintenanceProjection(command.itemId);
    kairoxSignalBus.publish({ kind: 'admission_changed', itemId: command.itemId });
    return projection;
  }

  function reconcileObjectives(itemIds = []) {
    const cfg = configs.loadConfig();
    const ids = [...new Set(itemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean))];
    const admissionMap = admissions.getAdmissions(ids);
    const bundleMap = facts.getBundles(ids);
    const peopleMap = personCatalogStore.getItemPreferenceProjections(ids);
    for (const itemId of ids) {
      const admission = admissionMap[itemId];
      if (!admission || admission.status !== 'active') continue;
      const bundle = bundleMap[itemId];
      if (!bundle) continue;
      const item = kairoxObjectivePolicy.applyObjectivePolicy(bundleToLifecycleItem(bundle, admission, peopleMap[itemId]), cfg);
      const desired = lifecycleObjectiveResolver.projectOptimizeObjective(item, { config: cfg, ignoreExistingProjection: true });
      const objectiveRevision = String(desired.objectiveHash || '');
      const current = bundle.objective;
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
    const active = tasks.getTasks({ itemId: command.itemId }).filter((task) => !['done', 'failed_hard', 'failed_soft', 'skipped', 'cancelled', 'interrupted', 'plan_invalidated'].includes(task.status));
    for (const task of active) {
      resourceRuntime.fenceTask(task, command.reason || 'source_incident');
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
    const run = facts.getMaintenanceRun(command.itemId);
    if (run) {
      facts.updateMaintenanceRun(run.runId, {
        status: command.reason === 'offboarding' ? 'cancelled' : 'suspended',
        currentTaskId: '',
        blockedReason: command.reason || 'source_incident',
        completedAt: command.reason === 'offboarding' ? new Date().toISOString() : '',
      });
    }
    if (command.reason === 'offboarding') {
      const media = facts.setMaintenancePriority({ itemId: command.itemId, priorityClass: 'normal' });
      propagatePriority(media);
    }
    return { admission, interruptedTasks: active.map((task) => task.id), projection: getMaintenanceProjection(command.itemId) };
  }

  function startMaintenanceRun(command = {}) {
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    const context = configContext(admission, command.config || configs.loadConfig());
    if (context.maintenanceAutomationMode !== 'manual') {
      throw new HelixError('KAIROX_MANUAL_START_NOT_ALLOWED', 'Automatic maintenance libraries do not accept manual start');
    }
    const media = facts.getMedia(command.itemId);
    if (!media || media.playable === false) throw new HelixError('KAIROX_MAINTENANCE_SUBJECT_NOT_PLAYABLE', 'Only playable media can start maintenance');
    const projection = getMaintenanceProjection(command.itemId);
    if (projection.maintenanceComplete) throw new HelixError('KAIROX_MAINTENANCE_ALREADY_COMPLETE', 'Media maintenance is already complete');
    const created = facts.createMaintenanceRun({
      itemId: command.itemId,
      admissionGeneration: admission.admissionGeneration,
      initiatedBy: 'user',
      libraryPriority: context.libraryPriority,
    });
    kairoxSignalBus.publish({ kind: 'maintenance_run_started', itemId: command.itemId, runId: created.run.runId });
    return { ...created, projection: getMaintenanceProjection(command.itemId) };
  }

  function reconcileMaintenanceRun(command = {}) {
    const admission = admissions.getAdmission(command.itemId);
    const media = facts.getMedia(command.itemId);
    if (!admission || !media) return {
      run: null,
      projection: command.includeProjection === false ? null : getMaintenanceProjection(command.itemId),
    };
    const context = configContext(admission, command.config || configs.loadConfig());
    let run = facts.getMaintenanceRun(command.itemId);
    if (run && run.libraryPriority !== context.libraryPriority) run = facts.updateMaintenanceRun(run.runId, { libraryPriority: context.libraryPriority });
    const suppliedProjection = command.maintenanceProjection;
    const projection = suppliedProjection && suppliedProjection.itemId === command.itemId
      ? suppliedProjection
      : getMaintenanceProjection(command.itemId);
    if (run && run.admissionGeneration !== admission.admissionGeneration) {
      facts.updateMaintenanceRun(run.runId, { status: 'cancelled', currentTaskId: '', completedAt: new Date().toISOString(), blockedReason: 'admission_generation_changed' });
      if (media.maintenancePriorityClass === 'expedited') propagatePriority(facts.setMaintenancePriority({ itemId: command.itemId, priorityClass: 'normal' }));
      run = null;
    }
    if (run && projection.maintenanceComplete) {
      run = facts.updateMaintenanceRun(run.runId, { status: 'complete', currentTaskId: '', completedAt: new Date().toISOString(), blockedReason: '' });
      if (facts.getMedia(command.itemId).maintenancePriorityClass === 'expedited') propagatePriority(facts.setMaintenancePriority({ itemId: command.itemId, priorityClass: 'normal' }));
      return { run, projection: command.includeProjection === false ? null : getMaintenanceProjection(command.itemId) };
    }
    if (!run) {
      if (context.maintenanceAutomationMode !== 'auto' || media.playable === false || projection.maintenanceComplete) return { run: null, projection };
      run = facts.createMaintenanceRun({
        itemId: command.itemId,
        admissionGeneration: admission.admissionGeneration,
        initiatedBy: 'system',
        libraryPriority: context.libraryPriority,
      }).run;
      const latestMedia = facts.getMedia(command.itemId);
      if (latestMedia.maintenancePriorityClass === 'expedited' && !latestMedia.priorityRunId) {
        propagatePriority(facts.setMaintenancePriority({ itemId: command.itemId, priorityClass: 'expedited', runId: run.runId, reason: latestMedia.priorityReason }));
      }
    }
    if (admission.status !== 'active') {
      run = facts.updateMaintenanceRun(run.runId, { status: 'suspended', currentTaskId: '', blockedReason: admission.incidentCode || 'admission_suspended' });
    } else if (projection.automationBlocker) {
      run = facts.updateMaintenanceRun(run.runId, { status: 'blocked', currentTaskId: '', blockedReason: projection.automationBlocker.code || 'task_terminal_failure' });
    } else if ((projection.activeTasks || []).length > 0) {
      run = facts.updateMaintenanceRun(run.runId, { status: 'task_active', currentTaskId: projection.activeTasks[0].id || '', blockedReason: '' });
    } else if (!['blocked', 'cancelled', 'complete'].includes(run.status)) {
      run = facts.updateMaintenanceRun(run.runId, { status: 'ready', currentTaskId: '', blockedReason: '' });
    }
    return { run, projection: command.includeProjection === false ? null : getMaintenanceProjection(command.itemId) };
  }

  function setMaintenancePriority(command = {}) {
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    const projection = getMaintenanceProjection(command.itemId);
    if (projection.maintenanceComplete) throw new HelixError('KAIROX_PRIORITY_NOT_APPLICABLE', 'Completed media cannot be prioritized');
    const context = configContext(admission, command.config || configs.loadConfig());
    const run = facts.getMaintenanceRun(command.itemId);
    if (context.maintenanceAutomationMode === 'manual' && !run) {
      throw new HelixError('KAIROX_MAINTENANCE_RUN_REQUIRED', 'Manual maintenance must be started before prioritization');
    }
    const media = facts.setMaintenancePriority({
      itemId: command.itemId,
      priorityClass: 'expedited',
      runId: run && run.runId || '',
      reason: command.reason || 'user_expedited',
    });
    const taskIds = propagatePriority(media);
    kairoxSignalBus.publish({ kind: 'maintenance_priority_changed', itemId: command.itemId });
    return { media, run, taskIds, projection: getMaintenanceProjection(command.itemId) };
  }

  function clearMaintenancePriority(command = {}) {
    const media = facts.setMaintenancePriority({ itemId: command.itemId, priorityClass: 'normal' });
    const taskIds = propagatePriority(media);
    kairoxSignalBus.publish({ kind: 'maintenance_priority_changed', itemId: command.itemId });
    return { media, run: facts.getMaintenanceRun(command.itemId), taskIds, projection: getMaintenanceProjection(command.itemId) };
  }

  function requestMetadataRefresh(command = {}) {
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    facts.markMetadataStale({ itemId: command.itemId, reason: command.reason || 'user_metadata_refresh' });
    facts.requestRefresh({
      itemId: command.itemId,
      factGroup: 'metadata',
      sourceRevision: admission.sourceRevision || '',
      reason: command.reason || 'user_metadata_refresh',
      evidence: { adultId: command.adultId || '', requestedBy: 'user' },
    });
    const context = configContext(admission, command.config || configs.loadConfig());
    if (context.maintenanceAutomationMode === 'manual' && !facts.getMaintenanceRun(command.itemId)) {
      facts.createMaintenanceRun({
        itemId: command.itemId,
        admissionGeneration: admission.admissionGeneration,
        initiatedBy: 'user',
        libraryPriority: context.libraryPriority,
      });
    }
    kairoxSignalBus.publish({ kind: 'metadata_refresh_requested', itemId: command.itemId });
    return { run: facts.getMaintenanceRun(command.itemId), projection: getMaintenanceProjection(command.itemId) };
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
    const run = facts.getMaintenanceRun(command.itemId);
    if (!run || run.status !== 'ready') throw new HelixError('KAIROX_MAINTENANCE_RUN_NOT_READY', 'A ready Maintenance Run is required');
    if (!command.runId || command.runId !== run.runId) throw new HelixError('KAIROX_STALE_MAINTENANCE_RUN', 'Maintenance command must use the current Run');
    const suppliedProjection = command.maintenanceProjection;
    const currentProjection = suppliedProjection && suppliedProjection.itemId === command.itemId
      ? suppliedProjection
      : getMaintenanceProjection(command.itemId);
    if (currentProjection.nextTargetGate !== targetGate) throw new HelixError('KAIROX_LIFECYCLE_TARGET_MISMATCH', 'Target gate must match the current Lifecycle projection');
    const item = bundleToLifecycleItem(bundle, admission);
    const created = taskCreator.createTargetGateTask({
      item,
      itemInfo: { ...(command.itemInfo || item), maintenanceRunId: run.runId },
      targetGate,
      gateObjective: command.gateObjective,
      flowPreference: command.flowPreference,
      requestedIntent: command.intent,
      source: 'auto',
      status: 'queued',
      config: command.config || configs.loadConfig(),
      tasks: command.tasks,
      logs: command.logs,
      helixAdmission: admission,
      maintenanceRun: run,
      maintenancePrioritySnapshot: prioritySnapshot(facts.getMedia(command.itemId)),
    });
    if (created && created.allowed !== false && created.task) {
      facts.updateMaintenanceRun(run.runId, { status: 'task_active', currentTaskId: created.task.id, blockedReason: '' });
    }
    return created;
  }

  function updateUserPerception(command = {}) {
    const admission = admissions.getAdmission(command.itemId);
    if (!admission || admission.status !== 'active') {
      throw new HelixError('KAIROX_ADMISSION_REQUIRED', 'Active Libra maintenance admission is required');
    }
    const before = facts.getUserPerception(command.itemId);
    const updated = facts.updateUserPerception({
      itemId: command.itemId,
      facts: command.facts || {},
      evidence: command.evidence || {},
      observedAt: command.observedAt,
    });
    if (!before || updated.factRevision !== before.factRevision) {
      reconcileObjectives([command.itemId]);
      kairoxSignalBus.publish({ kind: 'user_perception_changed', itemId: command.itemId, factRevision: updated.factRevision });
    }
    return updated;
  }

  function getPendingSourceMutations(limit = 100) {
    return workflowStore.listPendingMutations(limit);
  }

  function acknowledgeSourceMutation(mutationId) {
    return workflowStore.markMutationConsumed(mutationId);
  }

  return Object.freeze({
    reconcileMaintenance,
    reconcileObjectives,
    suspendMaintenance,
    requestMaintenance,
    startMaintenanceRun,
    setMaintenancePriority,
    clearMaintenancePriority,
    reconcileMaintenanceRun,
    requestMetadataRefresh,
    updateUserPerception,
    getMaintenanceProjection,
    getMaintenanceProjections,
    getMaintenanceSummaryProjections,
    getPendingSourceMutations,
    acknowledgeSourceMutation,
  });
}

module.exports = { createKairoxRuntime, buildMaintenanceProjection, bundleToLifecycleItem };
