'use strict';

/**
 * TaskScheduler (TASK_SCHEDULER.md).
 *
 * Scheduler ↔ ResourceRuntime bidirectional API:
 *   Scheduler → ResourceRuntime: resourceRuntime.dispatchTask(task)
 *   Event Runtime → Scheduler callbacks: reportStatus(taskId, status, progress?)
 *
 * Scheduler orders durable Tasks. Event Runtime owns workflow recovery, approval,
 * resource waiting, and Event execution state.
 */

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const healthCheck = require('./healthCheck');
const activityLog = require('./activityLog');
const nodeStore = require('./nodeStore');
const nodeService = require('./nodeService');
const resourceRuntime = require('./resourceRuntime');
const diagnosticLog = require('./diagnosticLog');
const gateInvalidationService = require('./gateInvalidationService');
const kairoxSignalBus = require('./kairoxSignalBus');

let schedulerInterval = null;
let nodeHealthInterval = null;
let schedulerRunning = false;
let schedulerBusy = false;

// Concurrency protection
const runningTasks = new Set(); // taskId Set — prevents re-entry within same polling round
const justConfirmedIds = new Set(); // tasks confirmed by user this round — bypass awaiting guard
const CLOSED_STATUSES = new Set(['done', 'failed_hard', 'failed_soft', 'skipped', 'cancelled']);

function compareDispatchOrder(a, b, recoveredIds = new Set()) {
  const aItemPriority = a.maintenancePrioritySnapshot && a.maintenancePrioritySnapshot.class === 'expedited' ? 0 : 1;
  const bItemPriority = b.maintenancePrioritySnapshot && b.maintenancePrioritySnapshot.class === 'expedited' ? 0 : 1;
  if (aItemPriority !== bItemPriority) return aItemPriority - bItemPriority;
  const pa = typeof a.priority === 'number' ? a.priority : 100;
  const pb = typeof b.priority === 'number' ? b.priority : 100;
  if (pa !== pb) return pa - pb;
  const aRec = recoveredIds.has(a.id) ? 0 : 1;
  const bRec = recoveredIds.has(b.id) ? 0 : 1;
  if (aRec !== bRec) return aRec - bRec;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

function flowKindForTask(task = {}) {
  return String(task.flowPlan && task.flowPlan.flowKind || '');
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
  if (CLOSED_STATUSES.has(status)) {
    updates.resumePoint = null;
    updates.approval = null;
  }
  taskStore.updateTask(taskId, updates);

  // Activity log events for task lifecycle
  if (oldTask) {
    const name = oldTask.itemName || oldTask.itemId;
    const actionLabel = flowKindForTask(oldTask) === 'transcode' ? '码率压缩'
      : flowKindForTask(oldTask) === 'upgrade' ? '洗版'
      : flowKindForTask(oldTask) === 'scrape' ? '刮削'
      : flowKindForTask(oldTask) === 'basedata' ? '基础信息维护'
      : flowKindForTask(oldTask);

    if (status === 'executing' && oldTask.status !== 'executing') {
      activityLog.addActivity('task', `任务「${name}」开始${actionLabel}…`, { taskId, flowKind: flowKindForTask(oldTask) });
    }
    if (status === 'done') {
      activityLog.addActivity('task', `任务「${name}」${actionLabel}完成 ✓`, { taskId, flowKind: flowKindForTask(oldTask) });

    }
    if (status === 'failed_hard' || status === 'failed_soft') {
      activityLog.addActivity('task', `任务「${name}」${actionLabel}失败`, { taskId, flowKind: flowKindForTask(oldTask) });
    }
  }

  if (status === 'done' || status === 'failed_hard' || status === 'failed_soft' || status === 'interrupted' || status === 'paused' || status === 'queued') {
    runningTasks.delete(taskId);
  }
  if (oldTask && (status === 'done' || status === 'failed_hard' || status === 'failed_soft' || status === 'interrupted')) {
    kairoxSignalBus.publish({
      kind: oldTask.sourceIncident ? 'source_incident' : 'task_terminal',
      itemId: oldTask.itemId,
      taskId,
      status,
      sourceIncident: oldTask.sourceIncident || null,
    });
  }
}

function reportResourceDeferred(taskId, blocker) {
  taskStore.updateTask(taskId, { status: 'waiting_for_resource', resourceBlocker: blocker });
  runningTasks.delete(taskId);
}

function reportGateInvalidation(taskId, signal = {}) {
  const task = taskStore.getTask(taskId);
  const itemId = signal.itemId || (task && task.itemId) || '';
  const invalidation = gateInvalidationService.recordGateInvalidation({
    ...signal,
    taskId,
    itemId,
    sourceFlowKind: signal.sourceFlowKind || (task && flowKindForTask(task)) || '',
    sourceTargetGate: signal.sourceTargetGate
      || (task && task.taskTarget && task.taskTarget.targetGate)
      || (task && task.taskBridge && task.taskBridge.kind)
      || '',
  });
  const gate = invalidation.invalidatedGate;
  const taskInvalidations = {
    ...((task && task.gateInvalidations) || {}),
    [gate]: invalidation,
  };
  const updated = taskStore.updateTask(taskId, {
    upstreamGateInvalidation: invalidation,
    gateInvalidations: taskInvalidations,
  });
  taskStore.appendTaskEvent(updated || task || { id: taskId, itemId }, 'gate.invalidated', {
    invalidatedGate: gate,
    reason: invalidation.reason,
    message: invalidation.message,
    evidence: invalidation.evidence,
    sourceFlowKind: invalidation.sourceFlowKind,
    sourceTargetGate: invalidation.sourceTargetGate,
    recovery: invalidation.recovery,
    stored: invalidation.stored,
    storeReason: invalidation.storeReason,
  });
  diagnosticLog.record({
    category: 'scheduler',
    scope: 'scheduler.gateInvalidation',
    operation: 'report_gate_invalidation',
    component: 'taskScheduler',
    resourceType: 'scheduler',
    resourceKey: 'taskScheduler',
    status: invalidation.stored ? 'done' : 'warning',
    payload: {
      taskId,
      itemId,
      invalidatedGate: gate,
      reason: invalidation.reason,
      sourceFlowKind: invalidation.sourceFlowKind,
      sourceTargetGate: invalidation.sourceTargetGate,
      stored: invalidation.stored,
      storeReason: invalidation.storeReason,
    },
  });
  return invalidation;
}

// ── Scheduling ──────────────────────────────────────────────────────────────

function recoverInterruptedTasks() {
  // Event Runtime is the sole recovery owner. Initializing scheduler callbacks
  // invokes recoverStartup(), which discards in-memory permits/waiters and
  // restores durable executing Events without consuming Task retry budget.
  return [];
}

function isActiveStatus(status) {
  return status === 'waiting_for_resource' || status === 'executing' || status === 'pausing' || status === 'awaiting_user_confirm';
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

  resourceRuntime.setSchedulerCallbacks({ pauseForConfirm, reportStatus, reportGateInvalidation, reportResourceDeferred });

  healthCheck.setSchedulerState({ running: true, runningTasks: 0 });

  schedulerInterval = setInterval(async () => {
    if (schedulerBusy) return;
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
  schedulerInterval.unref && schedulerInterval.unref();

  // Start node health monitoring
  const nodeIntervalMs = configStore.loadConfig().nodeHealthCheckIntervalMs || 30000;
  nodeHealthInterval = setInterval(() => {
    checkNodeHealth().catch((err) => console.error('[scheduler] node health error:', err));
  }, nodeIntervalMs);
  nodeHealthInterval.unref && nodeHealthInterval.unref();
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
  const tasks = typeof taskStore.querySchedulerTasks === 'function'
    ? taskStore.querySchedulerTasks()
    : taskStore.loadTasks({ includeHistory: false });

  const now = Date.now();
  for (const task of tasks) {
    if (task.status !== 'waiting_for_resource' || resourceRuntime.hasPendingDispatch(task.id)) continue;
    const retryAt = Date.parse(task.resourceBlocker && task.resourceBlocker.retryAt || '');
    if (!Number.isFinite(retryAt) || retryAt > now) continue;
    const updated = taskStore.updateTask(task.id, { status: 'queued', resourceBlocker: null });
    if (updated) {
      task.status = updated.status;
      task.resourceBlocker = null;
    }
  }

  // Count active work by resource bucket. flowKind remains the executor/API
  // compatibility field; scheduling capacity follows flow/resource semantics.
  let activeTaskCount = 0;
  const usedItemIds = new Set();

  for (const t of tasks) {
    if (isActiveStatus(t.status)) {
      activeTaskCount++;
      usedItemIds.add(t.itemId);
    }
  }

  healthCheck.setSchedulerState({ running: true, runningTasks: activeTaskCount });

  const recoveredIds = new Set();
  // Dispatch queued Tasks. Workflow recovery has already happened at the
  // Event layer before this scheduling round.
  // Lower priority value = runs first. Recovered (interrupted) tasks get a
  // secondary tiebreak so a resume isn't starved by a flood of equal-priority
  // new tasks; FIFO (createdAt) is the final stable tiebreak.
  const dispatchOrder = [...tasks].sort((a, b) => compareDispatchOrder(a, b, recoveredIds));

  for (const task of dispatchOrder) {
    // Skip terminal states
    if (task.status === 'done' || task.status === 'failed_hard') continue;

    // Skip already-running (prevent re-entry)
    if (runningTasks.has(task.id)) continue;
    if (resourceRuntime.hasPendingDispatch(task.id)) continue;
    // Skip paused / pausing (flow controls handle their own state transitions)
    if (task.status === 'paused') continue;
    if (task.status === 'pausing') continue;
    // Skip awaiting confirm
    if (task.status === 'awaiting_user_confirm') continue;
    // Skip waiting_media_source (flow parks, retry handled by flow timer)
    if (task.status === 'waiting_media_source') continue;

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

      runningTasks.add(task.id);
      usedItemIds.add(task.itemId);
      const dispatch = resourceRuntime.dispatchTask(task);
      if (!dispatch.dispatched) {
        console.warn(`[scheduler] resource runtime could not dispatch task ${task.id}: ${dispatch.reason}`);
        reportStatus(task.id, 'failed_hard');
      }
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
  reportGateInvalidation,
  markConfirmed,
  isRunning,
  scheduleRound,
  recoverInterruptedTasks,
  _compareDispatchOrder: compareDispatchOrder,
  getHealth() {
    return {
      status: schedulerRunning ? 'green' : 'red',
      runningTasks: runningTasks.size,
    };
  },
};
