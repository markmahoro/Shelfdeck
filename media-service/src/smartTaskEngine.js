'use strict';

/**
 * SmartTaskEngine — independent periodic auto-enqueue engine.
 *
 * Scans the media library store for items that meet lifecycle gates and have a
 * recommended action (transcode/upgrade/delete), then creates tasks
 * that feed into TaskScheduler.
 * Decoupled from StrategyEngine — only reads action/reason, never writes them.
 */

const activityLog = require('./activityLog');
const optimizationStatus = require('./optimizationStatus');
const businessFlowPolicy = require('./businessFlowPolicy');
const assetIdentity = require('./assetIdentity');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const adultLibraryService = require('./adultLibraryService');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const backgroundIoGuard = require('./backgroundIoGuard');

const BACKGROUND_IO_LOCK = 'library_background_io';

let timer = null;
let initialTimer = null;
let lastRunAt = null;
let lastError = null;
let _enabled = false;
let configReader = null;
let lastEnabledActions = [];
let lastScanSummary = null;

function incrementCounter(target, key, amount = 1) {
  const safeKey = String(key || 'unknown');
  target[safeKey] = (target[safeKey] || 0) + amount;
}

function newScanSummary(enabledActions = []) {
  return {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    enabledActions: [...enabledActions],
    libraryItems: 0,
    candidateCount: 0,
    evaluatedCandidates: 0,
    enqueued: 0,
    candidatesByAction: {},
    enqueuedByAction: {},
    admissionRejected: 0,
    admissionRejectedByReason: {},
    skippedByQueueCap: 0,
    skippedByQueueCapByAction: {},
    deferredByActiveBacklog: false,
    activeBacklog: 0,
    maxPerRunReached: false,
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

function readEnabledActions(config) {
  return Array.isArray(config.smartTaskEnabledActions)
    ? config.smartTaskEnabledActions
    : [];
}

function actionLabel(actionType) {
  switch (actionType) {
    case 'ingest': return '入库';
    case 'archive': return '归档';
    case 'scrape': return '刮削';
    case 'transcode': return '转码压缩';
    case 'upgrade': return '洗版';
    case 'delete': return '删除';
    default: return actionType;
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
    targetBitrate: item.targetBitrate,
    targetCodec: item.targetCodec,
    seedPreferences: item.seedPreferences,
    maxSizeGB: item.maxSizeGB,
    equivalentBitrate: item.equivalentBitrate,
    scraped: !!item.scraped,
    adultMetadata: item.adultMetadata,
    metadataStatus: item.metadataStatus,
    metadataComplete: item.metadataComplete,
    metadataMissingReasons: item.metadataMissingReasons,
    metadataKind: item.metadataKind,
    optimizationStatus: item.optimizationStatus,
    optimizationAction: item.optimizationAction,
    optimizationDoneAt: item.optimizationDoneAt,
    optimizationGate: item.optimizationGate,
    optimizeGate: item.optimizeGate,
    archiveStatus: item.archiveStatus,
    archiveDoneAt: item.archiveDoneAt,
    archiveBlockers: item.archiveBlockers,
  };
}

function buildCandidate(item, { config }) {
  const trigger = businessFlowPolicy.resolveAutomaticTrigger({ item, config });
  if (!trigger.allowed) return null;

  const actionType = trigger.actionType;
  const itemWithMetadata = trigger.item || item;

  const itemInfo = buildItemInfo(itemWithMetadata);
  const priorityBreakdown = priorityEngine.explainPriority({
    source: 'auto',
    actionType,
    itemInfo,
    config,
  });
  return {
    item: itemWithMetadata,
    itemInfo,
    actionType,
    priority: priorityBreakdown.priority,
    priorityBreakdown,
    timestamp: itemTimestamp(item),
  };
}

function buildIngestCandidate(candidate, config) {
  const itemInfo = candidate && candidate.itemInfo;
  if (!itemInfo || !itemInfo.itemId) return null;
  const priorityBreakdown = priorityEngine.explainPriority({
    source: 'auto',
    actionType: 'ingest',
    itemInfo,
    config,
  });
  return {
    item: itemInfo,
    itemInfo,
    actionType: 'ingest',
    priority: priorityBreakdown.priority,
    priorityBreakdown,
    timestamp: Number(candidate.timestamp) || itemTimestamp(itemInfo),
  };
}

function start(configStore, mediaLibraryService, taskStore, opts = {}) {
  configReader = configStore;
  lastRunAt = null;
  lastError = null;
  lastScanSummary = null;
  const ingestCandidateProvider = typeof opts.ingestCandidateProvider === 'function'
    ? opts.ingestCandidateProvider
    : adultLibraryService.listIngestCandidates;
  const cfg = configStore.loadConfig();
  lastEnabledActions = readEnabledActions(cfg);
  const intervalMs = (cfg.smartTaskPollIntervalMinutes || 10) * 60 * 1000;

  const run = () => backgroundIoGuard.runExclusive({
    operation: 'smartTask.scan',
    component: 'smartTaskEngine',
    lockKey: BACKGROUND_IO_LOCK,
    resourceType: 'background_io',
    resourceKey: 'smartTask:scan',
    source: 'background',
  }, () => {
    const runtimeEvent = runtimeResourceTracker.startEvent({
      eventType: 'smartTask.scan',
      component: 'smartTaskEngine',
      resourceType: 'service_cpu',
      resourceKey: 'service:smart-task',
      resourceLabel: 'Smart task scan',
    });
    let finalStatus = 'done';
    const finalPayload = {};
    let scanSummary = null;
    try {
      lastError = null;
      const cfg2 = configStore.loadConfig();
      const enabledActions = readEnabledActions(cfg2);
      scanSummary = newScanSummary(enabledActions);
      runtimeEvent.update({ enabledActions });
      lastEnabledActions = enabledActions;
      _enabled = enabledActions.length > 0;
      if (enabledActions.length === 0) {
        lastRunAt = Date.now();
        finalStatus = 'skipped';
        finalPayload.reason = 'no_enabled_actions';
        finishScanSummary(scanSummary, finalStatus, { reason: 'no_enabled_actions' });
        return;
      }

      const maxPerRun = cfg2.smartTaskMaxPerRun || 10;

      const libraryItems = typeof mediaLibraryService.getSmartTaskCandidateItems === 'function'
        ? mediaLibraryService.getSmartTaskCandidateItems()
        : ((mediaLibraryService.getLibrary() || {}).items || []);
      if (!Array.isArray(libraryItems)) {
        finalStatus = 'skipped';
        finalPayload.reason = 'no_library_items';
        finishScanSummary(scanSummary, finalStatus, { reason: 'no_library_items' });
        return;
      }
      runtimeEvent.update({ libraryItems: libraryItems.length });
      scanSummary.libraryItems = libraryItems.length;

      const activeTasks = typeof taskStore.querySchedulerTasks === 'function'
        ? taskStore.querySchedulerTasks()
        : taskStore.loadTasks({ includeHistory: false });
      scanSummary.activeBacklog = Array.isArray(activeTasks) ? activeTasks.length : 0;
      if (cfg2.smartTaskDeferWhenActiveBacklog !== false && scanSummary.activeBacklog > 0) {
        finalStatus = 'skipped';
        finalPayload.reason = 'active_task_backlog';
        finalPayload.activeBacklog = scanSummary.activeBacklog;
        scanSummary.deferredByActiveBacklog = true;
        finishScanSummary(scanSummary, finalStatus, {
          reason: 'active_task_backlog',
          activeBacklog: scanSummary.activeBacklog,
        });
        return;
      }

      const allTasks = typeof taskStore.queryTaskAdmissionRows === 'function'
        ? taskStore.queryTaskAdmissionRows()
        : taskStore.getTasks();
      const optimizationIndex = optimizationStatus.buildOptimizationIndex(allTasks, cfg2);

      // Count active (non-terminal) tasks per action type
      const activeByType = {};
      for (const t of activeTasks) {
        activeByType[t.actionType] = (activeByType[t.actionType] || 0) + 1;
      }

      // Per-type queue cap: how many non-terminal tasks of a given type may be
      // in the queue at once. This decouples queue depth from concurrency slots
      // (previously concurrency×5, which kept the queue nearly empty) so a real
      // backlog forms and PriorityEngine ordering becomes meaningful.
      const maxQueueSize = Number(cfg2.smartTaskMaxQueueSize) > 0 ? Number(cfg2.smartTaskMaxQueueSize) : 50;
      const queueCap = {
        ingest: maxQueueSize,
        archive: maxQueueSize,
        delete: maxQueueSize,
        transcode: maxQueueSize,
        upgrade: maxQueueSize,
        scrape: maxQueueSize,
      };

      const now = Date.now();
      const candidates = libraryItems
        .map((item) => buildCandidate(item, { config: cfg2 }))
        .filter(Boolean);
      if (enabledActions.includes('ingest')) {
        for (const candidate of ingestCandidateProvider(cfg2) || []) {
          const ingestCandidate = buildIngestCandidate(candidate, cfg2);
          if (ingestCandidate) candidates.push(ingestCandidate);
        }
      }
      runtimeEvent.update({ candidateCount: candidates.length });
      scanSummary.candidateCount = candidates.length;
      for (const candidate of candidates) {
        incrementCounter(scanSummary.candidatesByAction, candidate.actionType);
      }

      // Sort by computed task priority first, then most recent signal. This
      // keeps high-priority task types from being hidden behind large low-priority
      // candidate pools when smartTaskMaxPerRun is small.
      candidates.sort((a, b) => (a.priority - b.priority) || (b.timestamp - a.timestamp));

      const toEnqueue = [];
      const taskDataToCreate = [];
      for (const candidate of candidates) {
        if (toEnqueue.length >= maxPerRun) {
          scanSummary.maxPerRunReached = true;
          break;
        }
        const { item, itemInfo, actionType } = candidate;
        scanSummary.evaluatedCandidates += 1;

        // Per-action-type queue depth cap. Skip this type once the backlog is
        // full so one action doesn't starve others.
        const cur = activeByType[actionType] || 0;
        const cap = queueCap[actionType] || maxQueueSize;
        if (cur >= cap) {
          scanSummary.skippedByQueueCap += 1;
          incrementCounter(scanSummary.skippedByQueueCapByAction, actionType);
          continue;
        }

        const subLibSchedule2 = configStore.resolveSubLibSchedule(item, cfg2);
        const status = subLibSchedule2.autoExecute ? 'queued' : 'pending_manual';

        const admission = taskAdmission.canCreateTask({
          item,
          itemInfo,
          actionType,
          source: 'auto',
          config: cfg2,
          tasks: allTasks,
          optimizationIndex,
        });
        if (!admission.allowed) {
          scanSummary.admissionRejected += 1;
          incrementCounter(scanSummary.admissionRejectedByReason, admission.reason || 'rejected');
          continue;
        }
        activeByType[actionType] = cur + 1;

        const priorityBreakdown = priorityEngine.explainPriority({
          source: 'auto',
          actionType,
          itemInfo,
          config: cfg2,
        });

        const taskData = {
          itemId: item.itemId,
          itemName: item.name,
          actionType,
          source: 'auto',
          status,
          priority: priorityBreakdown.priority,
          priorityModelVersion: priorityEngine.PRIORITY_MODEL_VERSION,
          priorityBreakdown,
          taskTarget: admission.taskTarget,
          taskBridge: admission.taskBridge,
          flowPlan: admission.flowPlan,
          itemInfo,
          logs: [{
            ts: new Date().toISOString(),
            source: 'smart_task_engine',
            action: 'auto_enqueued',
          }],
        };
        taskDataToCreate.push(taskData);
        allTasks.push({
          id: `smart-task-pending:${item.itemId}:${actionType}`,
          itemId: item.itemId,
          itemName: item.name,
          actionType,
          source: 'auto',
          status,
          taskTarget: admission.taskTarget,
          taskBridge: admission.taskBridge,
          flowPlan: admission.flowPlan,
          itemInfo,
        });
        console.log(`[smartTaskEngine] auto-enqueue ${item.itemId} ${actionType} "${item.name}"`);
        toEnqueue.push({ item, actionType });
        scanSummary.enqueued += 1;
        incrementCounter(scanSummary.enqueuedByAction, actionType);
      }

      if (taskDataToCreate.length > 0) {
        if (typeof taskStore.createTasks === 'function') {
          taskStore.createTasks(taskDataToCreate);
        } else {
          for (const taskData of taskDataToCreate) taskStore.createTask(taskData);
        }
      }

      if (toEnqueue.length > 0) {
        const byAction = {};
        for (const entry of toEnqueue) {
          byAction[entry.actionType] = (byAction[entry.actionType] || 0) + 1;
        }
        const parts = Object.entries(byAction).map(([a, n]) => `${actionLabel(a)} ${n} 个`);
        const msg = `后台自动入队：${toEnqueue.length} 个任务已自动创建（${parts.join('，')}）`;
        console.log(`[smartTaskEngine] ${msg} (${candidates.length} candidates total)`);
        activityLog.addActivity('smart_task_engine', msg, { enqueued: toEnqueue.length, byAction, totalCandidates: candidates.length });
      }

      lastRunAt = now;
      Object.assign(finalPayload, {
        candidateCount: candidates.length,
        enqueued: toEnqueue.length,
        admissionRejected: scanSummary.admissionRejected,
        skippedByQueueCap: scanSummary.skippedByQueueCap,
        enabledActions,
      });
      finishScanSummary(scanSummary, finalStatus);
    } catch (e) {
      lastError = e.message;
      finalStatus = 'failed';
      finalPayload.error = e.message;
      finishScanSummary(scanSummary, finalStatus, { error: e.message });
      console.error('[smartTaskEngine] error:', e.message);
    } finally {
      runtimeEvent.finish(finalStatus, finalPayload);
    }
  }, {
    onSkipped: () => {
      console.log('[smartTaskEngine] scan skipped: background I/O guard is busy');
      finishScanSummary(newScanSummary(lastEnabledActions), 'skipped', { reason: 'background_io_busy' });
      return null;
    },
  });

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

module.exports = { start, stop, getHealth };

function getHealth() {
  let enabledActions = lastEnabledActions;
  if (configReader) {
    try {
      enabledActions = readEnabledActions(configReader.loadConfig());
    } catch (_) {}
  }
  if (enabledActions.length === 0) {
    return {
      status: 'green',
      enabled: false,
      enabledActions,
      disabledReason: 'no_enabled_actions',
      message: '后台自动入队未启用',
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      lastScanSummary,
    };
  }
  if (!_enabled) {
    return { status: 'green', enabled: true, enabledActions, lastRunAt: null, lastScanSummary };
  }
  if (!timer) {
    return { status: 'red', enabled: true, enabledActions, lastRunAt, lastError, lastScanSummary };
  }
  if (!lastRunAt) {
    return { status: 'yellow', enabled: true, enabledActions, lastRunAt: null, lastError, lastScanSummary };
  }
  return {
    status: 'green',
    enabled: true,
    enabledActions,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastError,
    lastScanSummary,
  };
}
