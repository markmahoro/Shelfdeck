'use strict';

/**
 * SmartTaskEngine — independent periodic auto-enqueue engine.
 *
 * Scans the media library store for items that meet lifecycle gates, then
 * creates target-gate tasks that feed into TaskScheduler. Flow operations are
 * implementation paths inside those tasks.
 */

const activityLog = require('./activityLog');
const lifecycleProjection = require('./lifecycleProjection');
const automationPolicy = require('./automationPolicy');
const assetIdentity = require('./assetIdentity');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const taskStoreModule = require('./taskStore');
const adultLibraryService = require('./adultLibraryService');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const backgroundIoGuard = require('./backgroundIoGuard');
const resourceProjection = require('./resourceProjection');
const resourceCapacity = require('./resourceCapacity');
const factsFreshnessService = require('./factsFreshnessService');

const BACKGROUND_IO_LOCK = 'library_background_io';

let timer = null;
let initialTimer = null;
let lastRunAt = null;
let lastError = null;
let _enabled = false;
let configReader = null;
let mediaLibraryReader = null;
let taskStoreReader = null;
let candidateProvider = null;
let lastEnabledTaskTargets = [];
let lastAllowedOptimizeFlows = [];
let lastScanSummary = null;

function incrementCounter(target, key, amount = 1) {
  const safeKey = String(key || 'unknown');
  target[safeKey] = (target[safeKey] || 0) + amount;
}

function automationSnapshot(config = {}) {
  return automationPolicy.automationSnapshot(config);
}
function newScanSummary(automation = {}) {
  return {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    enabledTaskTargets: Array.isArray(automation.enabledTaskTargets) ? [...automation.enabledTaskTargets] : [],
    allowedOptimizeFlowKinds: Array.isArray(automation.allowedOptimizeFlowKinds) ? [...automation.allowedOptimizeFlowKinds] : [],
    libraryItems: 0,
    candidateCount: 0,
    evaluatedCandidates: 0,
    enqueued: 0,
    candidatesByTargetGate: {},
    enqueuedByTargetGate: {},
    admissionRejected: 0,
    admissionRejectedByReason: {},
    skippedByQueueCap: 0,
    skippedByQueueCapByTargetGate: {},
    skippedByResourcePressure: 0,
    skippedByResourcePressureByResource: {},
    deferredByActiveBacklog: false,
    activeBacklog: 0,
    activeBacklogByTargetGate: {},
    activeBacklogByResource: {},
    maxPerRunReached: false,
    supplyPolicy: 'pressure_aware',
    reason: '',
    error: '',
  };
}

function finishScanSummary(summary, status, extra = {}) {
  const finished = {
    ...(summary || newScanSummary()),
    ...extra,
    status,
    finishedAt: new Date().toISOString(),
  };
  lastScanSummary = finished;
  return finished;
}

function readEnabledTaskTargets(config) {
  return automationPolicy.resolveAutomaticTaskTargets(config);
}

function targetGateLabel(targetGate) {
  switch (targetGate) {
    case 'ingest': return '入库';
    case 'metadata': return '元数据';
    case 'optimize': return '优化';
    case 'archive': return '归档';
    case 'delete': return '处置';
    default: return targetGate;
  }
}

function maxTimestamp(a, b) {
  if (!a && !b) return 0;
  if (!a) return new Date(b).getTime();
  if (!b) return new Date(a).getTime();
  return Math.max(new Date(a).getTime(), new Date(b).getTime());
}

function itemTimestamp(item) {
  const meta = item && item.adultMetadata || {};
  return [
    item && item.userRatingUpdatedAt,
    item && item.doubanRatingUpdatedAt,
    item && item.lastRefreshedAt,
    item && item.updatedAt,
    meta.scrapedAt,
  ].reduce((latest, value) => maxTimestamp(latest, value), 0);
}

function buildItemInfo(item) {
  return {
    name: item.name,
    itemId: item.itemId,
    embyItemId: assetIdentity.getEmbyItemId(item),
    path: item.path,
    subLibraryId: item.subLibraryId,
    assetKey: item.assetKey,
    assetRootPath: item.assetRootPath,
    externalRefs: item.externalRefs,
    resolution: item.resolution,
    bitrate: item.bitrate,
    audioCodecs: item.audioCodecs,
    size: item.size,
    duration: item.duration,
    type: item.type,
    isDiscLike: !!item.isDiscLike,
    doubanRating: item.doubanRating,
    userRating: item.userRating,
    tmdbId: item.tmdbId,
    seriesName: item.seriesName,
    seasonNumber: item.seasonNumber,
    targetCodec: item.targetCodec,
    targetMediaFacts: item.targetMediaFacts,
    optimizeObjectiveStatus: item.optimizeObjectiveStatus,
    optimizeObjective: item.optimizeObjective,
    objectiveHash: item.objectiveHash,
    objectiveVersion: item.objectiveVersion,
    objectiveDerivedFrom: item.objectiveDerivedFrom,
    seedPreferences: item.seedPreferences,
    maxSizeGB: item.maxSizeGB,
    equivalentBitrate: item.equivalentBitrate,
    codec: item.codec,
    videoCodec: item.videoCodec,
    scraped: !!item.scraped,
    adultMetadata: item.adultMetadata,
    metadataStatus: item.metadataStatus,
    metadataComplete: item.metadataComplete,
    metadataMissingReasons: item.metadataMissingReasons,
    metadataKind: item.metadataKind,
    factsFreshness: item.factsFreshness,
    optimizationStatus: item.optimizationStatus,
    optimizeFlowKind: item.optimizeFlowKind,
    optimizationDoneAt: item.optimizationDoneAt,
    optimizationGate: item.optimizationGate,
    optimizeGate: item.optimizeGate,
    archiveStatus: item.archiveStatus,
    archiveDoneAt: item.archiveDoneAt,
    archiveBlockers: item.archiveBlockers,
  };
}

function buildCandidate(item, { config }) {
  const projected = lifecycleProjection.decorateItem(item, config);
  const targetGate = projected.lifecycleNextTask || '';
  if (!targetGate) return null;
  const adultMeta = projected.adultMetadata && typeof projected.adultMetadata === 'object' ? projected.adultMetadata : {};
  const scrapeStatus = String(adultMeta.scrapeStatus || '').trim().toLowerCase();
  const metadataFactsStale = targetGate === 'metadata' && (
    factsFreshnessService.isBlockingStale(projected.factsFreshness || {}, 'mediaFacts')
    || factsFreshnessService.isBlockingStale(projected.factsFreshness || {}, 'metadataFacts')
  );
  if (targetGate === 'metadata' && !metadataFactsStale && (projected.scraped === true || scrapeStatus === 'done')) return null;
  if (targetGate === 'metadata' && ['failed', 'ambiguous', 'needs_review'].includes(scrapeStatus)) return null;
  if (!automationPolicy.automaticTargetEnabled(config, targetGate)) return null;
  const itemInfo = buildItemInfo(projected);
  const metadataRefreshObjective = {
    kind: 'metadata_refresh',
    refreshFacts: ['mediaFacts', 'metadataFacts'],
    reason: projected.lifecycleReason || 'facts_stale',
  };
  return {
    item: projected,
    itemInfo,
    targetGate,
    gateObjective: targetGate === 'optimize'
      ? (projected.optimizeObjective || {})
      : (metadataFactsStale ? metadataRefreshObjective : {}),
    allowedOptimizeFlowKinds: automationPolicy.resolveOptimizeAllowedFlowKinds(config),
    timestamp: itemTimestamp(item),
  };
}
function buildSourceCandidate(candidate) {
  const itemInfo = candidate && candidate.itemInfo;
  if (!itemInfo || !itemInfo.itemId) return null;
  const targetGate = candidate.targetGate || 'ingest';
  return {
    item: itemInfo,
    itemInfo,
    targetGate,
    gateObjective: candidate.gateObjective || {},
    timestamp: Number(candidate.timestamp) || itemTimestamp(itemInfo),
  };
}

const buildIngestCandidate = buildSourceCandidate;
function createTargetGateTask(input = {}) {
  const config = input.config || (configReader && configReader.loadConfig && configReader.loadConfig()) || {};
  const store = input.taskStore || taskStoreModule;
  const item = input.item || input.itemInfo || {};
  const itemInfo = input.itemInfo || item;
  const targetGate = input.targetGate || (input.taskTarget && input.taskTarget.targetGate) || '';
  const source = input.source || 'manual';
  const tasks = input.tasks || (store && store.getTasks ? store.getTasks() : []);
  const admissionInput = {
    item,
    itemInfo,
    targetGate,
    gateObjective: input.gateObjective || {},
    flowPreference: input.flowPreference,
    intent: input.requestedIntent || input.intent,
    config,
    tasks,
  };
  const admission = source === 'manual'
    ? taskAdmission.canCreateManualIntent(admissionInput)
    : taskAdmission.canCreateTask({ ...admissionInput, source });
  if (!admission.allowed) return { allowed: false, admission };

  const priorityBreakdown = priorityEngine.explainTaskPriority({
    source,
    taskTarget: admission.taskTarget,
    itemInfo,
    config,
  });
  const taskData = {
    itemId: itemInfo.itemId || item.itemId,
    itemName: itemInfo.name || item.name,
    source,
    status: input.status || (source === 'auto' ? 'queued' : 'created'),
    priority: priorityBreakdown.priority,
    priorityModelVersion: priorityEngine.TASK_PRIORITY_MODEL_VERSION,
    priorityBreakdown,
    taskTarget: admission.taskTarget,
    flowPreference: input.flowPreference || null,
    requestedIntent: admission.requestedIntent || input.requestedIntent || input.intent,
    allowedOptimizeFlowKinds: input.allowedOptimizeFlowKinds,
    itemInfo,
    logs: input.logs || [{
      ts: new Date().toISOString(),
      source: source === 'auto' ? 'smart_task_engine' : 'manual_task_creator',
      event: 'target_gate_task_created',
    }],
  };
  const task = input.deferSave && store.buildTask
    ? store.buildTask(taskData)
    : store.createTask(taskData);
  return { allowed: true, admission, task, taskData };
}

function taskTargetGate(task = {}) {
  return String(
    task.taskTarget && task.taskTarget.targetGate
    || task.targetGate
    || task.taskBridge && task.taskBridge.kind
    || '',
  );
}

function resourceKeyForTask(task = {}, config = {}) {
  const resource = resourceProjection.resourceForTask(task, config);
  return resource && resource.resourceKey || 'unknown:task';
}

function resourceStateForTask(task = {}) {
  return resourceProjection.resourceStateForStatus(task.status);
}

function pressureSnapshot(tasks = [], config = {}) {
  const byTargetGate = {};
  const byResource = {};
  for (const task of tasks || []) {
    const targetGate = taskTargetGate(task) || 'unknown';
    incrementCounter(byTargetGate, targetGate);
    const resourceKey = resourceKeyForTask(task, config);
    const state = resourceStateForTask(task);
    if (!byResource[resourceKey]) {
      const resource = resourceProjection.resourceForTask(task, config);
      byResource[resourceKey] = {
        resourceType: resource.resourceType || '',
        resourceKey,
        resourceLabel: resource.resourceLabel || resourceKey,
        configuredSlots: resourceCapacity.capacityForResource(resource, config, 1),
        running: 0,
        waiting: 0,
        blocked: 0,
        total: 0,
      };
    }
    byResource[resourceKey][state] = (byResource[resourceKey][state] || 0) + 1;
    byResource[resourceKey].total += 1;
  }
  return { byTargetGate, byResource };
}

function resourceQueueLimit(resourceKey, resource = {}, config = {}) {
  const explicit = config.smartTaskMaxQueuedByResource && config.smartTaskMaxQueuedByResource[resourceKey];
  const explicitNumber = Number(explicit);
  if (Number.isFinite(explicitNumber) && explicitNumber > 0) return Math.floor(explicitNumber);

  const capacity = Number(resource.configuredSlots || 1);
  const multiplier = Number(config.smartTaskResourceQueueMultiplier || 5);
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 5;
  return Math.max(1, Math.floor((Number.isFinite(capacity) && capacity > 0 ? capacity : 1) * safeMultiplier));
}

async function runScan(input = {}) {
  const configStore = input.configStore || configReader;
  const mediaLibraryService = input.mediaLibraryService || mediaLibraryReader;
  const taskStore = input.taskStore || taskStoreReader || taskStoreModule;
  const ingestCandidateProvider = input.ingestCandidateProvider || candidateProvider || adultLibraryService.listIngestCandidates;
  const explicitIntent = input.explicitIntent === true;
  const requestedSubLibraryId = String(input.subLibraryId || '').trim();
  const source = explicitIntent ? 'manual' : 'auto';
  return backgroundIoGuard.runExclusive({
    operation: 'smartTask.scan',
    component: 'smartTaskEngine',
    lockKey: BACKGROUND_IO_LOCK,
    resourceType: 'background_io',
    resourceKey: 'smartTask:scan',
    source: explicitIntent ? 'manual' : 'background',
  }, async () => {
    const runtimeEvent = runtimeResourceTracker.startEvent({
      eventType: 'smartTask.scan',
      component: 'smartTaskEngine',
      resourceType: 'service_cpu',
      resourceKey: 'service:smart-task',
      resourceLabel: 'Smart task scan',
      payload: {
        explicitIntent,
        subLibraryId: requestedSubLibraryId || undefined,
      },
    });
    let finalStatus = 'done';
    const finalPayload = {};
    let scanSummary = null;
    try {
      lastError = null;
      const cfg2 = configStore.loadConfig();
      const enabledTaskTargets = readEnabledTaskTargets(cfg2);
      const enabledAutomation = automationSnapshot(cfg2);
      scanSummary = newScanSummary(enabledAutomation);
      scanSummary.explicitIntent = explicitIntent;
      scanSummary.subLibraryId = requestedSubLibraryId || '';
      runtimeEvent.update({
        enabledTaskTargets: enabledAutomation.enabledTaskTargets,
        allowedOptimizeFlowKinds: enabledAutomation.allowedOptimizeFlowKinds,
      });
      lastEnabledTaskTargets = enabledAutomation.enabledTaskTargets;
      lastAllowedOptimizeFlows = enabledAutomation.allowedOptimizeFlowKinds;
      _enabled = enabledTaskTargets.length > 0 || explicitIntent;
      if (!explicitIntent && enabledTaskTargets.length === 0) {
        lastRunAt = Date.now();
        finalStatus = 'skipped';
        finalPayload.reason = 'no_enabled_task_targets';
        return finishScanSummary(scanSummary, finalStatus, { reason: 'no_enabled_task_targets' });
      }

      const maxPerRun = cfg2.smartTaskMaxPerRun || 10;

      const libraryItems = typeof mediaLibraryService.getSmartTaskCandidateItems === 'function'
        ? mediaLibraryService.getSmartTaskCandidateItems()
        : ((mediaLibraryService.getLibrary() || {}).items || []);
      if (!Array.isArray(libraryItems)) {
        finalStatus = 'skipped';
        finalPayload.reason = 'no_library_items';
        return finishScanSummary(scanSummary, finalStatus, { reason: 'no_library_items' });
      }
      const scopedLibraryItems = requestedSubLibraryId
        ? libraryItems.filter((item) => item && item.subLibraryId === requestedSubLibraryId)
        : libraryItems;
      runtimeEvent.update({ libraryItems: scopedLibraryItems.length });
      scanSummary.libraryItems = scopedLibraryItems.length;

      const activeTasks = typeof taskStore.querySchedulerTasks === 'function'
        ? taskStore.querySchedulerTasks()
        : taskStore.loadTasks({ includeHistory: false });
      scanSummary.activeBacklog = Array.isArray(activeTasks) ? activeTasks.length : 0;
      const pressure = pressureSnapshot(activeTasks, cfg2);
      scanSummary.activeBacklogByTargetGate = pressure.byTargetGate;
      scanSummary.activeBacklogByResource = pressure.byResource;
      if (!explicitIntent && cfg2.smartTaskDeferWhenActiveBacklog === true && scanSummary.activeBacklog > 0) {
        finalStatus = 'skipped';
        finalPayload.reason = 'active_task_backlog';
        finalPayload.activeBacklog = scanSummary.activeBacklog;
        scanSummary.deferredByActiveBacklog = true;
        scanSummary.supplyPolicy = 'defer_all_active_backlog';
        return finishScanSummary(scanSummary, finalStatus, {
          reason: 'active_task_backlog',
          activeBacklog: scanSummary.activeBacklog,
        });
      }

      const allTasks = typeof taskStore.queryTaskAdmissionRows === 'function'
        ? taskStore.queryTaskAdmissionRows()
        : taskStore.getTasks();

      const activeByTargetGate = {};
      for (const t of activeTasks) {
        const targetGate = taskTargetGate(t) || 'unknown';
        activeByTargetGate[targetGate] = (activeByTargetGate[targetGate] || 0) + 1;
      }
      const resourcePressure = { ...pressure.byResource };

      const maxQueueSize = Number(cfg2.smartTaskMaxQueueSize) > 0 ? Number(cfg2.smartTaskMaxQueueSize) : 50;
      const queueCap = {
        ingest: maxQueueSize,
        archive: maxQueueSize,
        delete: maxQueueSize,
        optimize: maxQueueSize,
        metadata: maxQueueSize,
      };

      const now = Date.now();
      const candidates = scopedLibraryItems
        .map((item) => buildCandidate(item, { config: cfg2 }))
        .filter(Boolean);
      const canDiscoverIngest = explicitIntent || enabledTaskTargets.includes('ingest');
      if (canDiscoverIngest) {
        const provided = await Promise.resolve(ingestCandidateProvider(cfg2, {
          subLibraryId: requestedSubLibraryId || undefined,
          explicitIntent,
          source,
        }) || []);
        for (const candidate of provided) {
          const sourceCandidate = buildSourceCandidate(candidate, cfg2);
          if (sourceCandidate) candidates.push(sourceCandidate);
        }
      }
      runtimeEvent.update({ candidateCount: candidates.length });
      scanSummary.candidateCount = candidates.length;
      for (const candidate of candidates) {
        incrementCounter(scanSummary.candidatesByTargetGate, candidate.targetGate || 'unknown');
      }

      const admittedTasks = [];
      for (const candidate of candidates) {
        const { item, itemInfo, targetGate, gateObjective } = candidate;
        scanSummary.evaluatedCandidates += 1;

        const subLibSchedule2 = typeof configStore.resolveSubLibSchedule === 'function'
          ? configStore.resolveSubLibSchedule(item, cfg2)
          : { autoExecute: true };
        const status = subLibSchedule2.autoExecute ? 'queued' : 'pending_manual';

        const admission = taskAdmission.canCreateTask({
          item,
          itemInfo,
          targetGate,
          gateObjective,
          source,
          config: cfg2,
          tasks: allTasks,
        });
        if (!admission.allowed) {
          scanSummary.admissionRejected += 1;
          incrementCounter(scanSummary.admissionRejectedByReason, admission.reason || 'rejected');
          continue;
        }

        const priorityBreakdown = priorityEngine.explainTaskPriority({
          source,
          taskTarget: admission.taskTarget,
          itemInfo,
          config: cfg2,
        });

        admittedTasks.push({
          item,
          targetGate,
          timestamp: candidate.timestamp,
          taskData: {
            itemId: item.itemId,
            itemName: item.name,
            source,
            status,
            priority: priorityBreakdown.priority,
            priorityModelVersion: priorityEngine.TASK_PRIORITY_MODEL_VERSION,
            priorityBreakdown,
            taskTarget: admission.taskTarget,
            allowedOptimizeFlowKinds: candidate.allowedOptimizeFlowKinds,
            itemInfo,
            logs: [{
              ts: new Date().toISOString(),
              source: source === 'auto' ? 'smart_task_engine' : 'manual_scan',
              event: source === 'auto' ? 'auto_enqueued' : 'manual_scan_enqueued',
            }],
          },
        });
      }

      admittedTasks.sort((a, b) => (
        (a.taskData.priority - b.taskData.priority)
        || (b.timestamp - a.timestamp)
      ));

      const selectedTasks = [];
      const selectedItemIds = new Set();
      for (const admitted of admittedTasks) {
        if (selectedTasks.length >= maxPerRun) {
          scanSummary.maxPerRunReached = true;
          break;
        }
        const itemId = admitted.item && admitted.item.itemId || admitted.taskData.itemId;
        if (itemId && selectedItemIds.has(itemId)) continue;
        const targetGate = admitted.targetGate || (admitted.taskData.taskTarget && admitted.taskData.taskTarget.targetGate) || 'unknown';
        const cur = activeByTargetGate[targetGate] || 0;
        const cap = queueCap[targetGate] || maxQueueSize;
        if (cur >= cap) {
          scanSummary.skippedByQueueCap += 1;
          incrementCounter(scanSummary.skippedByQueueCapByTargetGate, targetGate);
          continue;
        }
        const resourceKey = resourceKeyForTask(admitted.taskData, cfg2);
        const existingResource = resourcePressure[resourceKey]
          || (() => {
            const resource = resourceProjection.resourceForTask(admitted.taskData, cfg2);
            return {
              resourceType: resource.resourceType || '',
              resourceKey,
              resourceLabel: resource.resourceLabel || resourceKey,
              configuredSlots: resourceCapacity.capacityForResource(resource, cfg2, 1),
              running: 0,
              waiting: 0,
              blocked: 0,
              total: 0,
            };
          })();
        const resourceUsage = (existingResource.running || 0) + (existingResource.waiting || 0);
        const resourceCap = resourceQueueLimit(resourceKey, existingResource, cfg2);
        if (resourceUsage >= resourceCap) {
          scanSummary.skippedByResourcePressure += 1;
          incrementCounter(scanSummary.skippedByResourcePressureByResource, resourceKey);
          resourcePressure[resourceKey] = existingResource;
          continue;
        }
        selectedTasks.push(admitted);
        if (itemId) selectedItemIds.add(itemId);
        activeByTargetGate[targetGate] = cur + 1;
        existingResource.waiting = (existingResource.waiting || 0) + 1;
        existingResource.total = (existingResource.total || 0) + 1;
        resourcePressure[resourceKey] = existingResource;
      }
      scanSummary.activeBacklogByResource = resourcePressure;

      const toEnqueue = [];
      const taskDataToCreate = [];
      for (const admitted of selectedTasks) {
        const { item, taskData } = admitted;
        taskDataToCreate.push(taskData);
        const targetGate = taskData.taskTarget && taskData.taskTarget.targetGate || 'unknown';
        console.log(`[smartTaskEngine] ${source}-enqueue ${item.itemId} targetGate=${targetGate} "${item.name}"`);
        toEnqueue.push({ item, targetGate });
        scanSummary.enqueued += 1;
        incrementCounter(scanSummary.enqueuedByTargetGate, targetGate);
      }

      if (taskDataToCreate.length > 0) {
        if (typeof taskStore.createTasks === 'function') {
          taskStore.createTasks(taskDataToCreate);
        } else {
          for (const taskData of taskDataToCreate) taskStore.createTask(taskData);
        }
      }

      if (toEnqueue.length > 0) {
        const byTargetGate = {};
        for (const entry of toEnqueue) {
          byTargetGate[entry.targetGate] = (byTargetGate[entry.targetGate] || 0) + 1;
        }
        const parts = Object.entries(byTargetGate).map(([a, n]) => `${targetGateLabel(a)} ${n} 个`);
        const msg = `后台自动入队：${toEnqueue.length} 个任务已自动创建（${parts.join('，')}）`;
        console.log(`[smartTaskEngine] ${msg} (${candidates.length} target-gate candidates total)`);
        activityLog.addActivity('smart_task_engine', msg, { enqueued: toEnqueue.length, byTargetGate, totalCandidates: candidates.length });
      }

      lastRunAt = now;
      Object.assign(finalPayload, {
        candidateCount: candidates.length,
        enqueued: toEnqueue.length,
        admissionRejected: scanSummary.admissionRejected,
        skippedByQueueCap: scanSummary.skippedByQueueCap,
        enabledTaskTargets: enabledAutomation.enabledTaskTargets,
        allowedOptimizeFlowKinds: enabledAutomation.allowedOptimizeFlowKinds,
      });
      return finishScanSummary(scanSummary, finalStatus);
    } catch (e) {
      lastError = e.message;
      finalStatus = 'failed';
      finalPayload.error = e.message;
      const summary = finishScanSummary(scanSummary, finalStatus, { error: e.message });
      console.error('[smartTaskEngine] error:', e.message);
      return summary;
    } finally {
      runtimeEvent.finish(finalStatus, finalPayload);
    }
  }, {
    onSkipped: () => {
      console.log('[smartTaskEngine] scan skipped: background I/O guard is busy');
      return finishScanSummary(newScanSummary({
        enabledTaskTargets: lastEnabledTaskTargets,
        allowedOptimizeFlowKinds: lastAllowedOptimizeFlows,
      }), 'skipped', { reason: 'background_io_busy' });
    },
  });
}

function start(configStore, mediaLibraryService, taskStore, opts = {}) {
  configReader = configStore;
  mediaLibraryReader = mediaLibraryService;
  taskStoreReader = taskStore;
  lastRunAt = null;
  lastError = null;
  lastScanSummary = null;
  candidateProvider = typeof opts.ingestCandidateProvider === 'function'
    ? opts.ingestCandidateProvider
    : async (scanConfig, scanOptions = {}) => {
      const adultCandidates = adultLibraryService.listIngestCandidates(scanConfig) || [];
      const embyCandidates = typeof mediaLibraryService.listSourceObservationCandidates === 'function'
        ? await mediaLibraryService.listSourceObservationCandidates(scanConfig, scanOptions)
        : [];
      return [...adultCandidates, ...(Array.isArray(embyCandidates) ? embyCandidates : [])];
    };
  const cfg = configStore.loadConfig();
  const initialAutomation = automationSnapshot(cfg);
  lastEnabledTaskTargets = initialAutomation.enabledTaskTargets;
  lastAllowedOptimizeFlows = initialAutomation.allowedOptimizeFlowKinds;
  const initialEnabledTaskTargets = readEnabledTaskTargets(cfg);
  if (initialEnabledTaskTargets.length === 0) {
    console.log('[smartTaskEngine] disabled: no enabled automatic task targets');
    return;
  }
  const intervalMs = (cfg.smartTaskPollIntervalMinutes || 10) * 60 * 1000;

  const run = () => runScan({ configStore, mediaLibraryService, taskStore, ingestCandidateProvider: candidateProvider });

  const initialDelaySeconds = Math.max(0, Number(cfg.smartTaskInitialDelaySeconds) || 0);
  console.log(`[smartTaskEngine] will run first scan in ${initialDelaySeconds}s, then every ${intervalMs / 60000}min`);
  initialTimer = setTimeout(() => {
    initialTimer = null;
    run();
    timer = setInterval(run, intervalMs);
    timer.unref && timer.unref();
  }, initialDelaySeconds * 1000);
  initialTimer.unref && initialTimer.unref();
}

function stop() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function runOnce(options = {}) {
  if (!configReader || !mediaLibraryReader || !taskStoreReader) {
    throw new Error('SmartTaskEngine has not been started');
  }
  return runScan(options);
}

module.exports = { start, stop, getHealth, runOnce, createTargetGateTask, buildIngestCandidate, buildSourceCandidate };

function getHealth() {
  let automation = {
    enabledTaskTargets: lastEnabledTaskTargets,
    allowedOptimizeFlowKinds: lastAllowedOptimizeFlows,
  };
  let enabledTaskTargets = readEnabledTaskTargets({
    automaticTaskTargets: automation.enabledTaskTargets,
    optimizeAllowedFlowKinds: automation.allowedOptimizeFlowKinds,
  });
  if (configReader) {
    try {
      const config = configReader.loadConfig();
      automation = automationSnapshot(config);
      enabledTaskTargets = readEnabledTaskTargets(config);
    } catch (_) {}
  }
  const kairoxAutomation = {
    enabledTaskTargets: automation.enabledTaskTargets,
    allowedOptimizeFlowKinds: automation.allowedOptimizeFlowKinds,
  };
  if (enabledTaskTargets.length === 0) {
    return {
      status: 'green',
      enabled: false,
      ...kairoxAutomation,
      disabledReason: 'no_enabled_task_targets',
      message: '后台自动入队未启用',
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      lastScanSummary,
    };
  }
  if (!_enabled) {
    return { status: 'green', enabled: true, ...kairoxAutomation, lastRunAt: null, lastScanSummary };
  }
  if (!timer) {
    return { status: 'red', enabled: true, ...kairoxAutomation, lastRunAt, lastError, lastScanSummary };
  }
  if (!lastRunAt) {
    return { status: 'yellow', enabled: true, ...kairoxAutomation, lastRunAt: null, lastError, lastScanSummary };
  }
  return {
    status: 'green',
    enabled: true,
    ...kairoxAutomation,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastError,
    lastScanSummary,
  };
}
