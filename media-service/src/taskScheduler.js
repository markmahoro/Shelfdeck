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
const deleteFlow = require('./deleteFlowExecutor');
const transcodeFlow = require('./transcodeFlowExecutor');
const upgradeFlow = require('./upgradeFlowExecutor');
const healthCheck = require('./healthCheck');
const activityLog = require('./activityLog');

let schedulerInterval = null;
let schedulerRunning = false;
let schedulerBusy = false;

// Concurrency protection
const runningTasks = new Set(); // taskId Set — prevents re-entry within same polling round

function getFlow(actionType) {
  switch (actionType) {
    case 'delete': return deleteFlow;
    case 'transcode': return transcodeFlow;
    case 'upgrade': return upgradeFlow;
    default: return null;
  }
}

function getConcurrencyLimit(actionType, limits) {
  switch (actionType) {
    case 'delete': return limits.deleteConcurrency || 1;
    case 'transcode': return limits.transcodeConcurrency || 1;
    case 'upgrade': return limits.upgradeConcurrency || 1;
    default: return 1;
  }
}

// ── Exposed to Flow Executors ───────────────────────────────────────────────

function pauseForConfirm(taskId, resumePoint) {
  taskStore.updateTask(taskId, { status: 'awaiting_user_confirm', resumePoint });
  runningTasks.delete(taskId);
}

function reportStatus(taskId, status, progress) {
  const oldTask = taskStore.getTask(taskId);
  const updates = { status };
  if (typeof progress === 'number') updates.progress = progress;
  taskStore.updateTask(taskId, updates);

  // Activity log events for task lifecycle
  if (oldTask) {
    const name = oldTask.itemName || oldTask.itemId;
    const actionLabel = oldTask.actionType === 'transcode' ? '码率压缩' : oldTask.actionType === 'upgrade' ? '洗版' : oldTask.actionType === 'delete' ? '删除' : oldTask.actionType;

    if (status === 'executing' && oldTask.status !== 'executing') {
      activityLog.addActivity('task', `任务「${name}」开始${actionLabel}…`, { taskId, actionType: oldTask.actionType });
    }
    if (status === 'done') {
      activityLog.addActivity('task', `任务「${name}」${actionLabel}完成 ✓`, { taskId, actionType: oldTask.actionType });
    }
    if (status === 'failed_hard') {
      activityLog.addActivity('task', `任务「${name}」${actionLabel}失败`, { taskId, actionType: oldTask.actionType });
    }
  }

  if (status === 'done' || status === 'failed_hard' || status === 'interrupted' || status === 'paused') {
    runningTasks.delete(taskId);
  }
}

// ── Scheduling ──────────────────────────────────────────────────────────────

function recoverInterruptedTasks() {
  const tasks = taskStore.loadTasks();
  const interruptible = ['precheck', 'executing', 'verify', 'transcode_executing', 'transcode_replace', 'upgrade_executing', 'upgrade_replace', 'planning', 'pre_replace_verify', 'pausing'];
  for (const t of tasks) {
    // awaiting_user_confirm is a stable state — user hasn't decided yet, preserve it
    if (t.status === 'awaiting_user_confirm') continue;
    if (interruptible.includes(t.status) || interruptible.includes(t.phase) || t.pausingRequested) {
      taskStore.updateTask(t.id, { status: 'interrupted' });
      console.log('[scheduler] recovered interrupted task', t.id);
    }
  }
}

function isActiveStatus(status) {
  return status === 'executing' || status === 'pausing';
}

function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  console.log('[scheduler] started (interval 5s)');

  recoverInterruptedTasks();

  // Inject scheduler into Flow Executors
  deleteFlow.setScheduler({ pauseForConfirm, reportStatus });
  transcodeFlow.setScheduler({ pauseForConfirm, reportStatus });
  upgradeFlow.setScheduler({ pauseForConfirm, reportStatus });

  healthCheck.setSchedulerState({ running: true, runningTasks: 0 });

  schedulerInterval = setInterval(async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      await scheduleRound();
    } catch (err) {
      console.error('[scheduler] error:', err);
    } finally {
      schedulerBusy = false;
    }
  }, 5000);
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
  schedulerRunning = false;
  healthCheck.setSchedulerState({ running: false, runningTasks: 0 });
  console.log('[scheduler] stopped');
}

async function scheduleRound() {
  const config = configStore.loadConfig();
  const tasks = taskStore.loadTasks();

  // Count active tasks per actionType (occupying slots)
  const activeCount = { delete: 0, transcode: 0, upgrade: 0 };
  const usedItemIds = new Set();

  for (const t of tasks) {
    if (isActiveStatus(t.status)) {
      activeCount[t.actionType] = (activeCount[t.actionType] || 0) + 1;
      usedItemIds.add(t.itemId);
    }
  }

  healthCheck.setSchedulerState({ running: true, runningTasks: Object.values(activeCount).reduce((a, b) => a + b, 0) });

  for (const task of tasks) {
    // Skip terminal states
    if (task.status === 'done' || task.status === 'failed_hard') continue;

    // Interrupted tasks: retry up to 3 times, then give up
    if (task.status === 'interrupted') {
      const retryCount = (task.retryCount || 0) + 1;
      if (retryCount > 3) {
        taskStore.updateTask(task.id, { status: 'failed_hard', retryCount });
        console.log('[scheduler] task', task.id, 'failed after', retryCount - 1, 'retries');
        continue;
      }
      taskStore.updateTask(task.id, { status: 'queued', retryCount });
      task.status = 'queued';
    }
    // Skip already-running (prevent re-entry)
    if (runningTasks.has(task.id)) continue;
    // Skip paused / pausing (flow controls handle their own state transitions)
    if (task.status === 'paused') continue;
    if (task.status === 'pausing') continue;
    // Skip awaiting confirm
    if (task.status === 'awaiting_user_confirm') continue;
    // Skip waiting_media_source (flow parks, retry handled by flow timer)
    if (task.status === 'waiting_media_source') continue;

    // executionMode check
    if (config.executionMode === 'manual' && task.status === 'pending_manual') continue;

    // itemId lock: only one flow per itemId
    if (usedItemIds.has(task.itemId) && task.status !== 'executing') continue;

    // actionType slot check
    const limit = getConcurrencyLimit(task.actionType, config);
    if (activeCount[task.actionType] >= limit && task.status !== 'executing') continue;

    // Transition created/pending_manual → queued
    if (task.status === 'created' || task.status === 'pending_manual') {
      taskStore.updateTask(task.id, { status: 'queued' });
      task.status = 'queued';
    }

    if (task.status === 'queued') {
      const flow = getFlow(task.actionType);
      if (!flow) continue;

      runningTasks.add(task.id);
      activeCount[task.actionType]++;
      usedItemIds.add(task.itemId);

      // Fire-and-forget: Flow calls reportStatus when done
      flow.driveTask(task.id).catch((err) => {
        console.error(`[scheduler] driveTask error for ${task.id}:`, err);
        reportStatus(task.id, 'failed_hard');
      });
    }
  }
}

function isRunning() {
  return schedulerRunning;
}

module.exports = {
  startScheduler,
  stopScheduler,
  pauseForConfirm,
  reportStatus,
  isRunning,
  scheduleRound,
  recoverInterruptedTasks,
};
