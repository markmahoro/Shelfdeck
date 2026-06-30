'use strict';

/**
 * TaskScheduler (TASK_SCHEDULER.md).
 *
 * Scheduler ↔ Flow Executor bidirectional API:
 *   Scheduler → Flow:  flow.driveTask(taskId), flow.pause(taskId), flow.cancel(taskId)
 *   Flow → Scheduler:  scheduler.pauseForConfirm(taskId, resumePoint), scheduler.reportStatus(taskId, status, progress?)
 *   Confirm API → Flow: flow.confirmReceived(taskId)
 *
 * status (Scheduler-managed) vs phase (Flow-managed):
 *   Scheduler reads/writes status only; Flow reads/writes phase only.
 */

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const mediaLibraryService = require('./mediaLibraryService');
const deleteFlow = require('./deleteFlowExecutor');
const transcodeFlow = require('./transcodeFlowExecutor');
const upgradeFlow = require('./upgradeFlowExecutor');
const scrapeFlow = require('./scrapeFlowExecutor');
const ingestFlow = require('./ingestFlowExecutor');
const healthCheck = require('./healthCheck');
const activityLog = require('./activityLog');
const nodeStore = require('./nodeStore');
const nodeService = require('./nodeService');
const priorityEngine = require('./priorityEngine');
const resourceProjection = require('./resourceProjection');
const flowPlanner = require('./flowPlanner');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const diagnosticLog = require('./diagnosticLog');
const backgroundIoGuard = require('./backgroundIoGuard');

let schedulerInterval = null;
let nodeHealthInterval = null;
let schedulerRunning = false;
let schedulerBusy = false;

// Concurrency protection
const runningTasks = new Set(); // taskId Set — prevents re-entry within same polling round
const justConfirmedIds = new Set(); // tasks confirmed by user this round — bypass awaiting guard

function getFlow(actionType) {
  switch (actionType) {
    case 'ingest': return ingestFlow;
    case 'delete': return deleteFlow;
    case 'transcode': return transcodeFlow;
    case 'upgrade': return upgradeFlow;
    case 'scrape': return scrapeFlow;
    default: return null;
  }
}

function getConcurrencyLimit(actionType, limits) {
  switch (actionType) {
    case 'ingest': return limits.ingestConcurrency || 1;
    case 'delete': return limits.deleteConcurrency || 1;
    case 'transcode': return limits.transcodeConcurrency || 1;
    case 'upgrade': return limits.upgradeConcurrency || 1;
    case 'scrape': return limits.scrapeConcurrency || 1;
    default: return 1;
  }
}

function shouldRecomputeAutoPriority(task) {
  return task
    && task.source === 'auto'
    && !task.priorityManuallyAdjusted
    && ['created', 'pending_manual', 'queued'].includes(task.status)
    && task.actionType
    && task.itemInfo;
}

function reconcileAutoTaskPriorities(tasks, config) {
  for (const task of tasks) {
    if (!shouldRecomputeAutoPriority(task)) continue;
    const priorityBreakdown = priorityEngine.explainPriority({
      source: 'auto',
      actionType: task.actionType,
      itemInfo: task.itemInfo,
      config,
      task,
    });
    const priority = priorityBreakdown.priority;
    if (task.priority === priority && task.priorityModelVersion === priorityEngine.PRIORITY_MODEL_VERSION) continue;
    const updated = taskStore.updateTask(task.id, {
      priority,
      priorityModelVersion: priorityEngine.PRIORITY_MODEL_VERSION,
      priorityBreakdown,
    });
    if (updated) {
      task.priority = updated.priority;
      task.priorityModelVersion = updated.priorityModelVersion;
      task.priorityBreakdown = updated.priorityBreakdown;
    }
  }
}

function clearQueuedRuntimeState(task) {
  if (task.manualExecuteRequested && task.resumePoint) return task;
  const updates = {};
  if (task.phase !== null && task.phase !== undefined) updates.phase = null;
  if (task.resumePoint !== null && task.resumePoint !== undefined) updates.resumePoint = null;
  if (task.progress !== 0 && task.progress !== undefined) updates.progress = 0;
  if (!Object.keys(updates).length) return task;

  const updated = taskStore.updateTask(task.id, updates);
  if (updated) {
    task.phase = updated.phase;
    task.resumePoint = updated.resumePoint;
    task.progress = updated.progress;
  }
  taskStore.deleteProgress(task.id);
  return updated || task;
}

// ── Exposed to Flow Executors ───────────────────────────────────────────────

function pauseForConfirm(taskId, resumePoint, approval) {
  const updates = { status: 'awaiting_user_confirm', resumePoint };
  if (approval && typeof approval === 'object') updates.approval = approval;
  taskStore.updateTask(taskId, updates);
  runningTasks.delete(taskId);
}

function reportStatus(taskId, status, progress) {
  if (typeof progress === 'number') taskStore.setProgress(taskId, progress);

  // Skip disk I/O when status hasn't changed (e.g. progress-only updates)
  const cachedStatus = taskStore.getCachedStatus(taskId);
  if (cachedStatus === status) return;

  const oldTask = taskStore.getTask(taskId);
  const updates = { status };
  taskStore.updateTask(taskId, updates);

  // Activity log events for task lifecycle
  if (oldTask) {
    const name = oldTask.itemName || oldTask.itemId;
    const actionLabel = oldTask.actionType === 'transcode' ? '码率压缩'
      : oldTask.actionType === 'upgrade' ? '洗版'
      : oldTask.actionType === 'delete' ? '删除'
      : oldTask.actionType === 'ingest' ? '入库'
      : oldTask.actionType === 'scrape' ? '刮削'
      : oldTask.actionType;

    if (status === 'executing' && oldTask.status !== 'executing') {
      activityLog.addActivity('task', `任务「${name}」开始${actionLabel}…`, { taskId, actionType: oldTask.actionType });
    }
    if (status === 'done') {
      activityLog.addActivity('task', `任务「${name}」${actionLabel}完成 ✓`, { taskId, actionType: oldTask.actionType });

    }
    if (status === 'failed_hard') {
      activityLog.addActivity('task', `任务「${name}」${actionLabel}失败`, { taskId, actionType: oldTask.actionType });
    }

    // 48h freeze after task ends (done or failed_hard) — SmartTaskEngine won't re-enqueue
    if ((status === 'done' || status === 'failed_hard') && oldTask.itemId) {
      const lib = mediaLibraryService.getLibrary();
      const libItem = lib && lib.items && lib.items.find((it) => it.itemId === oldTask.itemId);
      if (libItem) {
        libItem.lastTaskDoneAt = new Date().toISOString();
        if (status === 'done' && oldTask.actionType === 'transcode') {
          libItem.lastTranscodeDoneAt = new Date().toISOString();
        }
        if (status === 'done' && oldTask.actionType === 'upgrade') {
          libItem.lastUpgradeDoneAt = new Date().toISOString();
        }
        mediaLibraryService.saveLibrary(lib);
      }
    }
  }

  if (status === 'done' || status === 'failed_hard' || status === 'interrupted' || status === 'paused') {
    runningTasks.delete(taskId);
  }
}

// ── Scheduling ──────────────────────────────────────────────────────────────

function recoverInterruptedTasks() {
  const tasks = typeof taskStore.querySchedulerTasks === 'function'
    ? taskStore.querySchedulerTasks()
    : taskStore.loadTasks({ includeHistory: false });
  const interruptible = ['precheck', 'executing', 'verify', 'ingest_precheck', 'ingest_commit', 'transcode_executing', 'transcode_replace', 'upgrade_executing', 'upgrade_replace', 'scrape_precheck', 'scrape_executing', 'scrape_write_metadata', 'scrape_review', 'planning', 'pre_replace_verify', 'pausing'];
  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'failed_hard') continue;
    // awaiting_user_confirm is a stable state — user hasn't decided yet, preserve it
    if (t.status === 'awaiting_user_confirm') continue;
    if (interruptible.includes(t.status) || t.pausingRequested) {
      const previousStatus = t.status;
      const previousPhase = t.phase || '';
      const previousResumePoint = t.resumePoint || '';
      const updated = taskStore.updateTask(t.id, { status: 'interrupted' });
      const eventTask = updated || { ...t, status: 'interrupted' };
      taskStore.appendTaskEvent(eventTask, 'task.restart_interrupted', {
        reason: 'service_restart_runtime_state_recovered',
        fromStatus: previousStatus,
        fromPhase: previousPhase,
        fromResumePoint: previousResumePoint,
        pausingRequested: !!t.pausingRequested,
        effect: 'mark_interrupted_for_scheduler_recovery',
      }, {
        resourceType: 'scheduler',
      });
      diagnosticLog.record({
        category: 'scheduler',
        scope: 'scheduler.restartRecovery',
        operation: 'mark_interrupted',
        component: 'taskScheduler',
        resourceType: 'scheduler',
        resourceKey: 'taskScheduler',
        status: 'done',
        payload: {
          taskId: t.id,
          itemId: t.itemId,
          actionType: t.actionType,
          fromStatus: previousStatus,
          fromPhase: previousPhase,
          fromResumePoint: previousResumePoint,
          reason: 'service_restart_runtime_state_recovered',
        },
      });
      console.log('[scheduler] recovered interrupted task', t.id);
    }
  }
}

function resourceConcurrencyLimit(resource, task, limits = {}) {
  const resourceType = resource && resource.resourceType;
  const resourceKey = resource && resource.resourceKey;
  switch (resourceType) {
    case 'local_transcode':
    case 'worker_transcode':
      return limits.transcodeConcurrency || 1;
    case 'moviepilot':
      return limits.upgradeConcurrency || 1;
    case 'emby':
      return limits.embyMetadataRepairConcurrency || limits.scrapeConcurrency || 1;
    case 'scraper':
      return limits.scrapeConcurrency || 1;
    case 'local_ai':
      return getLocalWesternAiScrapeLimit(limits);
    case 'filesystem':
      if (resourceKey === 'filesystem:ingest') return limits.ingestConcurrency || 1;
      if (resourceKey === 'filesystem:mutation') return limits.deleteConcurrency || 1;
      return 1;
    default:
      return getConcurrencyLimit(task && task.actionType, limits);
  }
}

function resourceCountKey(resource) {
  return resource && resource.resourceKey ? resource.resourceKey : 'unknown:task';
}

function incrementResourceCount(counts, resource, by = 1) {
  const key = resourceCountKey(resource);
  counts[key] = (counts[key] || 0) + by;
  return counts[key];
}

function errorSummary(err) {
  return {
    name: err && err.name ? String(err.name) : 'Error',
    message: err && err.message ? String(err.message) : String(err),
  };
}

function recordFlowFailure(task, resource, flowStep, err) {
  const failure = errorSummary(err);
  const freshTask = taskStore.getTask(task.id) || task;
  taskStore.appendTaskEvent(freshTask, 'flow.failed', {
    reason: 'flow_executor_rejected',
    errorName: failure.name,
    errorMessage: failure.message,
    flowEventType: flowStep && flowStep.eventType,
    flowEventPhase: flowStep && flowStep.phase,
    resourceType: resource && resource.resourceType,
    resourceKey: resource && resource.resourceKey,
    resourceLabel: resource && resource.resourceLabel,
    bridgeKind: task.taskBridge && task.taskBridge.kind,
    flowDirection: task.flowPlan && task.flowPlan.direction,
    operationKind: task.flowPlan && task.flowPlan.operationKind,
    effect: 'mark_failed_hard_after_flow_exception',
  }, {
    resourceType: resource && resource.resourceType,
  });
  diagnosticLog.record({
    category: 'scheduler',
    scope: 'scheduler.flowDispatch',
    operation: 'flow_executor_failed',
    component: 'taskScheduler',
    resourceType: resource && resource.resourceType || 'scheduler',
    resourceKey: resource && resource.resourceKey || 'taskScheduler',
    status: 'failed',
    payload: {
      taskId: task.id,
      itemId: task.itemId,
      actionType: task.actionType,
      bridgeKind: task.taskBridge && task.taskBridge.kind,
      flowDirection: task.flowPlan && task.flowPlan.direction,
      operationKind: task.flowPlan && task.flowPlan.operationKind,
      flowEventType: flowStep && flowStep.eventType,
      flowEventPhase: flowStep && flowStep.phase,
      resourceType: resource && resource.resourceType,
      resourceKey: resource && resource.resourceKey,
      errorName: failure.name,
      errorMessage: failure.message,
      effect: 'mark_failed_hard_after_flow_exception',
    },
  });
}

function isActiveStatus(status) {
  return status === 'executing' || status === 'pausing' || status === 'awaiting_user_confirm';
}

function isLocalWesternAiScrapeTask(task, config) {
  if (!task || task.actionType !== 'scrape') return false;
  const itemInfo = task.itemInfo || {};
  const adultMetadata = itemInfo.adultMetadata || {};
  const subLib = (config.subLibraries || []).find((s) => s.uuid === itemInfo.subLibraryId) || {};
  const region = adultMetadata.region || subLib.adultRegion || '';
  if (region !== 'western_adult') return false;
  const western = {
    ...(((config.adultLibrary || {}).western) || {}),
    ...((subLib && subLib.western) || {}),
  };
  return String(western.computeMode || 'local').toLowerCase() !== 'worker';
}

function staleAutoScrapeReason(task) {
  if (!task || task.actionType !== 'scrape') return '';
  if (task.source !== 'auto') return '';
  if (task.manualExecuteRequested || justConfirmedIds.has(task.id)) return '';
  const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
  if (!liveItem) return 'library_item_missing';
  if (liveItem.scraped === true) return 'already_scraped';
  const meta = liveItem.adultMetadata || {};
  const status = String(meta.scrapeStatus || '').toLowerCase();
  if (status === 'failed' || status === 'ambiguous' || status === 'needs_review' || status === 'done') {
    return `scrape_status_${status}`;
  }
  return '';
}

function skipStaleAutoScrapeTask(task, reason) {
  const logs = Array.isArray(task.logs) ? task.logs.slice() : [];
  logs.push({
    ts: new Date().toISOString(),
    level: 'info',
    msg: `Automatic scrape skipped: ${reason}`,
  });
  const updated = taskStore.updateTask(task.id, {
    status: 'skipped',
    phase: 'skipped',
    skippedReason: reason,
    logs,
  });
  if (updated) {
    task.status = updated.status;
    task.phase = updated.phase;
    task.skippedReason = updated.skippedReason;
    task.logs = updated.logs;
  } else {
    task.status = 'skipped';
    task.phase = 'skipped';
    task.skippedReason = reason;
    task.logs = logs;
  }
  activityLog.addActivity('task', `自动刮削任务「${task.itemName || task.itemId}」已跳过：${reason}`, {
    taskId: task.id,
    actionType: task.actionType,
    reason,
  });
}

function getLocalWesternAiScrapeLimit(config) {
  const raw = (((config.adultLibrary || {}).western) || {}).localConcurrency;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1) : 1;
}

// ── Node health monitoring ────────────────────────────────────────────────────

async function checkNodeHealth() {
  const nodes = nodeStore.loadNodes();
  const config = configStore.loadConfig();

  for (const node of nodes) {
    if (node.status !== 'online') continue;

    let online = false;
    try {
      const res = await nodeService.checkHealth(node);
      online = res && res.ok;
    } catch (_) {
      online = false;
    }

    const updated = nodeStore.recordHealthCheck(node.id, online);

    // Node just went offline — fail its active tasks
    if (updated && updated.status === 'offline') {
      console.log(`[scheduler] Node ${node.name} (${node.id}) is offline — failing active tasks`);
      const tasks = typeof taskStore.querySchedulerTasks === 'function'
        ? taskStore.querySchedulerTasks()
        : taskStore.loadTasks({ includeHistory: false });
      let failed = 0;
      for (const t of tasks) {
        if (t.nodeId === node.id && t.status === 'executing') {
          taskStore.updateTask(t.id, {
            status: 'failed_hard',
            logs: [{ ts: new Date().toISOString(), level: 'error', msg: `Node ${node.name} went offline, task interrupted` }],
          });
          failed++;
        }
      }
      if (failed > 0) {
        activityLog.write(`Node ${node.name} went offline — ${failed} task(s) failed`);
      }
    }
  }
}

function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  console.log('[scheduler] started (interval 5s)');

  recoverInterruptedTasks();

  // Inject scheduler into Flow Executors
  deleteFlow.setScheduler({ pauseForConfirm, reportStatus });
  ingestFlow.setScheduler({ pauseForConfirm, reportStatus });
  transcodeFlow.setScheduler({ pauseForConfirm, reportStatus });
  upgradeFlow.setScheduler({ pauseForConfirm, reportStatus });
  scrapeFlow.setScheduler({ pauseForConfirm, reportStatus });

  healthCheck.setSchedulerState({ running: true, runningTasks: 0 });

  schedulerInterval = setInterval(async () => {
    if (schedulerBusy) return;
    const backgroundIo = backgroundIoGuard.getState({ recentLimit: 0 });
    if (backgroundIo.summary.runningHeavyIo) {
      diagnosticLog.record({
        category: 'scheduler',
        scope: 'scheduler.tick',
        operation: 'schedule_round',
        component: 'taskScheduler',
        resourceType: 'scheduler',
        resourceKey: 'taskScheduler',
        status: 'skipped',
        payload: {
          reason: 'background_io_busy',
          activeBackgroundOperations: backgroundIo.active.map((op) => ({
            operation: op.operation,
            resourceKey: op.resourceKey,
            durationMs: op.durationMs,
          })),
        },
      });
      return;
    }
    schedulerBusy = true;
    try {
      await diagnosticLog.track({
        category: 'scheduler',
        scope: 'scheduler.tick',
        operation: 'schedule_round',
        component: 'taskScheduler',
        resourceType: 'scheduler',
        resourceKey: 'taskScheduler',
        slowMs: 250,
        payload: { runningTasks: runningTasks.size },
        successPayload: () => ({ runningTasks: runningTasks.size }),
      }, () => scheduleRound());
    } catch (err) {
      console.error('[scheduler] error:', err);
    } finally {
      schedulerBusy = false;
    }
  }, 5000);

  // Start node health monitoring
  const nodeIntervalMs = configStore.loadConfig().nodeHealthCheckIntervalMs || 30000;
  nodeHealthInterval = setInterval(() => {
    checkNodeHealth().catch((err) => console.error('[scheduler] node health error:', err));
  }, nodeIntervalMs);
  // Run immediately on startup
  checkNodeHealth().catch((err) => console.error('[scheduler] initial node health check error:', err));
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
  if (nodeHealthInterval) { clearInterval(nodeHealthInterval); nodeHealthInterval = null; }
  schedulerRunning = false;
  healthCheck.setSchedulerState({ running: false, runningTasks: 0 });
  console.log('[scheduler] stopped');
}

async function scheduleRound() {
  const config = configStore.loadConfig();
  const tasks = typeof taskStore.querySchedulerTasks === 'function'
    ? taskStore.querySchedulerTasks()
    : taskStore.loadTasks({ includeHistory: false });

  // Count active work by resource bucket. actionType remains the executor/API
  // compatibility field; scheduling capacity follows flow/resource semantics.
  const activeResourceCount = {};
  let activeTaskCount = 0;
  const localWesternAiScrapeLimit = getLocalWesternAiScrapeLimit(config);
  let activeLocalWesternAiScrapes = 0;
  const usedItemIds = new Set();

  for (const t of tasks) {
    if (isActiveStatus(t.status)) {
      incrementResourceCount(activeResourceCount, resourceProjection.resourceForTask(t, config));
      activeTaskCount++;
      usedItemIds.add(t.itemId);
      if (t.status !== 'awaiting_user_confirm' && isLocalWesternAiScrapeTask(t, config)) {
        activeLocalWesternAiScrapes++;
      }
    }
  }

  healthCheck.setSchedulerState({ running: true, runningTasks: activeTaskCount });

  // ── Pass 1: recover interrupted tasks first without saving lightweight rows ─
  const recoveredIds = new Set();
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'failed_hard') continue;
    if (task.status !== 'interrupted') continue;

    const previousPhase = task.phase || '';
    const previousResumePoint = task.resumePoint || '';
    const retryCount = (task.retryCount || 0) + 1;
    if (retryCount > 3) {
      const updated = taskStore.updateTask(task.id, { status: 'failed_hard', retryCount });
      if (updated) {
        task.status = updated.status;
        task.retryCount = updated.retryCount;
      }
      taskStore.appendTaskEvent(updated || task, 'task.restart_recovery_failed', {
        reason: 'restart_recovery_retry_limit_reached',
        fromStatus: 'interrupted',
        fromPhase: previousPhase,
        fromResumePoint: previousResumePoint,
        retryCount,
        effect: 'mark_failed_hard_after_restart_recovery_limit',
      }, {
        resourceType: 'scheduler',
      });
      diagnosticLog.record({
        category: 'scheduler',
        scope: 'scheduler.restartRecovery',
        operation: 'recover_interrupted_task',
        component: 'taskScheduler',
        resourceType: 'scheduler',
        resourceKey: 'taskScheduler',
        status: 'failed',
        payload: {
          taskId: task.id,
          itemId: task.itemId,
          actionType: task.actionType,
          retryCount,
          reason: 'restart_recovery_retry_limit_reached',
        },
      });
      console.log('[scheduler] task', task.id, 'failed after', retryCount - 1, 'retries');
      continue;
    }
    const updated = taskStore.updateTask(task.id, {
      status: 'queued',
      retryCount,
      phase: null,
      resumePoint: null,
      progress: 0,
    });
    if (updated) {
      task.status = updated.status;
      task.retryCount = updated.retryCount;
      task.phase = updated.phase;
      task.resumePoint = updated.resumePoint;
      task.progress = updated.progress;
    }
    taskStore.deleteProgress(task.id);
    taskStore.appendTaskEvent(updated || task, 'task.restart_recovery_queued', {
      reason: 'restart_recovery_auto_queue',
      fromStatus: 'interrupted',
      fromPhase: previousPhase,
      fromResumePoint: previousResumePoint,
      retryCount,
      effect: 'queue_task_after_service_restart',
    }, {
      resourceType: 'scheduler',
    });
    diagnosticLog.record({
      category: 'scheduler',
      scope: 'scheduler.restartRecovery',
      operation: 'recover_interrupted_task',
      component: 'taskScheduler',
      resourceType: 'scheduler',
      resourceKey: 'taskScheduler',
      status: 'done',
      payload: {
        taskId: task.id,
        itemId: task.itemId,
        actionType: task.actionType,
        retryCount,
        fromPhase: previousPhase,
        fromResumePoint: previousResumePoint,
        reason: 'restart_recovery_auto_queue',
      },
    });
    recoveredIds.add(task.id);
  }

  reconcileAutoTaskPriorities(tasks, config);

  // ── Pass 2: dispatch queued tasks, ordered by queue priority ──────────
  // Lower priority value = runs first. Recovered (interrupted) tasks get a
  // secondary tiebreak so a resume isn't starved by a flood of equal-priority
  // new tasks; FIFO (createdAt) is the final stable tiebreak.
  const dispatchOrder = [...tasks].sort((a, b) => {
    const pa = typeof a.priority === 'number' ? a.priority : 100;
    const pb = typeof b.priority === 'number' ? b.priority : 100;
    if (pa !== pb) return pa - pb;
    const aRec = recoveredIds.has(a.id) ? 0 : 1;
    const bRec = recoveredIds.has(b.id) ? 0 : 1;
    if (aRec !== bRec) return aRec - bRec;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });

  for (const task of dispatchOrder) {
    // Skip terminal states
    if (task.status === 'done' || task.status === 'failed_hard') continue;

    // Skip already-running (prevent re-entry)
    if (runningTasks.has(task.id)) continue;
    // Skip paused / pausing (flow controls handle their own state transitions)
    if (task.status === 'paused') continue;
    if (task.status === 'pausing') continue;
    // Skip awaiting confirm
    if (task.status === 'awaiting_user_confirm') continue;
    // Skip waiting_media_source (flow parks, retry handled by flow timer)
    if (task.status === 'waiting_media_source') continue;

    if (task.actionType === 'scrape' && task.status === 'queued' && !task.manualExecuteRequested && !justConfirmedIds.has(task.id)) {
      const subLibSchedule = configStore.resolveSubLibSchedule(task.itemInfo || {}, config);
      if (!subLibSchedule.autoExecute) {
        taskStore.updateTask(task.id, { status: 'pending_manual' });
        task.status = 'pending_manual';
        continue;
      }
    }

    // subLibrary automation check: skip if this library does not auto-execute.
    if (task.status === 'pending_manual' || task.status === 'created') {
      const subLibSchedule = configStore.resolveSubLibSchedule(task.itemInfo || {}, config);
      if (!subLibSchedule.autoExecute) continue;
    }

    // itemId lock: only one flow per itemId
    if (usedItemIds.has(task.itemId) && task.status !== 'executing') continue;

    // Transition created/pending_manual → queued (always allowed — pure status change)
    if (task.status === 'created' || task.status === 'pending_manual') {
      taskStore.updateTask(task.id, { status: 'queued', phase: null, resumePoint: null, progress: 0 });
      taskStore.deleteProgress(task.id);
      task.status = 'queued';
      task.phase = null;
      task.resumePoint = null;
      task.progress = 0;
    }

    if (task.status === 'queued') {
      clearQueuedRuntimeState(task);

      const staleScrapeReason = staleAutoScrapeReason(task);
      if (staleScrapeReason) {
        skipStaleAutoScrapeTask(task, staleScrapeReason);
        continue;
      }

      // Resource slot check — just-confirmed tasks bypass (they already held a slot).
      const resource = resourceProjection.resourceForTask(task, config);
      const resourceKey = resourceCountKey(resource);
      const limit = resourceConcurrencyLimit(resource, task, config);
      if ((activeResourceCount[resourceKey] || 0) >= limit && !justConfirmedIds.has(task.id)) continue;
      if (
        isLocalWesternAiScrapeTask(task, config) &&
        activeLocalWesternAiScrapes >= localWesternAiScrapeLimit &&
        !justConfirmedIds.has(task.id)
      ) {
        continue;
      }

      const flow = getFlow(task.actionType);
      if (!flow) continue;

      runningTasks.add(task.id);
      incrementResourceCount(activeResourceCount, resource);
      if (isLocalWesternAiScrapeTask(task, config)) activeLocalWesternAiScrapes++;
      usedItemIds.add(task.itemId);
      reportStatus(task.id, 'executing', task.progress || 0);
      task.status = 'executing';
      const flowStep = flowPlanner.currentFlowStep(task);
      taskStore.appendTaskEvent(taskStore.getTask(task.id) || task, 'flow.dispatched', {
        flowEventType: flowStep.eventType,
        flowEventPhase: flowStep.phase,
        resourceType: resource.resourceType,
        resourceKey: resource.resourceKey,
        resourceLabel: resource.resourceLabel,
        bridgeKind: task.taskBridge && task.taskBridge.kind,
        flowDirection: task.flowPlan && task.flowPlan.direction,
        operationKind: task.flowPlan && task.flowPlan.operationKind,
      }, { resourceType: resource.resourceType });
      const runtimeEvent = runtimeResourceTracker.startEvent({
        eventType: 'task.dispatch',
        component: 'taskScheduler',
        resourceType: resource.resourceType,
        resourceKey: resource.resourceKey,
        resourceLabel: resource.resourceLabel,
        taskId: task.id,
        itemId: task.itemId,
        itemName: task.itemName,
        source: task.source,
        payload: {
          actionType: task.actionType,
          bridgeKind: task.taskBridge && task.taskBridge.kind,
          flowDirection: task.flowPlan && task.flowPlan.direction,
          operationKind: task.flowPlan && task.flowPlan.operationKind,
          phase: task.phase,
          priority: task.priority,
          status: 'executing',
        },
      });

      // Fire-and-forget: Flow calls reportStatus when done
      flow.driveTask(task.id).then(() => {
        runtimeEvent.finish('done');
      }).catch((err) => {
        runtimeEvent.finish('failed', { error: err && err.message ? err.message : String(err) });
        console.error(`[scheduler] driveTask error for ${task.id}:`, err);
        reportStatus(task.id, 'failed_hard');
        recordFlowFailure(task, resource, flowStep, err);
      });
    }
  }
  justConfirmedIds.clear();
}

function markConfirmed(taskId) {
  justConfirmedIds.add(taskId);
}

function isRunning() {
  return schedulerRunning;
}

module.exports = {
  startScheduler,
  stopScheduler,
  pauseForConfirm,
  reportStatus,
  markConfirmed,
  isRunning,
  scheduleRound,
  recoverInterruptedTasks,
  getHealth() {
    return {
      status: schedulerRunning ? 'green' : 'red',
      runningTasks: runningTasks.size,
    };
  },
};
