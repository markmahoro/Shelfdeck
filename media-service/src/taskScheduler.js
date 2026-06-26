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
const healthCheck = require('./healthCheck');
const activityLog = require('./activityLog');
const nodeStore = require('./nodeStore');
const nodeService = require('./nodeService');

let schedulerInterval = null;
let nodeHealthInterval = null;
let schedulerRunning = false;
let schedulerBusy = false;

// Concurrency protection
const runningTasks = new Set(); // taskId Set — prevents re-entry within same polling round
const justConfirmedIds = new Set(); // tasks confirmed by user this round — bypass awaiting guard

function getFlow(actionType) {
  switch (actionType) {
    case 'delete': return deleteFlow;
    case 'transcode': return transcodeFlow;
    case 'upgrade': return upgradeFlow;
    case 'scrape': return scrapeFlow;
    default: return null;
  }
}

function getConcurrencyLimit(actionType, limits) {
  switch (actionType) {
    case 'delete': return limits.deleteConcurrency || 1;
    case 'transcode': return limits.transcodeConcurrency || 1;
    case 'upgrade': return limits.upgradeConcurrency || 1;
    case 'scrape': return limits.scrapeConcurrency || 1;
    default: return 1;
  }
}

// ── Exposed to Flow Executors ───────────────────────────────────────────────

function pauseForConfirm(taskId, resumePoint) {
  taskStore.updateTask(taskId, { status: 'awaiting_user_confirm', resumePoint });
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
  const tasks = taskStore.loadTasks();
  const interruptible = ['precheck', 'executing', 'verify', 'transcode_executing', 'transcode_replace', 'upgrade_executing', 'upgrade_replace', 'scrape_precheck', 'scrape_executing', 'planning', 'pre_replace_verify', 'pausing'];
  let changed = false;
  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'failed_hard') continue;
    // awaiting_user_confirm is a stable state — user hasn't decided yet, preserve it
    if (t.status === 'awaiting_user_confirm') continue;
    if (interruptible.includes(t.status) || t.pausingRequested) {
      t.status = 'interrupted';
      console.log('[scheduler] recovered interrupted task', t.id);
      changed = true;
    }
  }
  if (changed) {
    taskStore.saveTasks(tasks);
  }
}

function isActiveStatus(status) {
  return status === 'executing' || status === 'pausing' || status === 'awaiting_user_confirm';
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
      const tasks = taskStore.loadTasks();
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
    transcodeFlow.setScheduler({ pauseForConfirm, reportStatus });
    upgradeFlow.setScheduler({ pauseForConfirm, reportStatus });
  scrapeFlow.setScheduler({ pauseForConfirm, reportStatus });

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
  const tasks = taskStore.loadTasks();

  // Count active tasks per actionType (occupying slots)
  const activeCount = { delete: 0, transcode: 0, upgrade: 0, scrape: 0 };
  const usedItemIds = new Set();

  for (const t of tasks) {
    if (isActiveStatus(t.status)) {
      activeCount[t.actionType] = (activeCount[t.actionType] || 0) + 1;
      usedItemIds.add(t.itemId);
    }
  }

  healthCheck.setSchedulerState({ running: true, runningTasks: Object.values(activeCount).reduce((a, b) => a + b, 0) });

  // ── Pass 1: recover interrupted tasks first (batch update, single save) ─
  const recoveredIds = new Set();
  let pass1Changed = false;
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'failed_hard') continue;
    if (task.status !== 'interrupted') continue;

    const retryCount = (task.retryCount || 0) + 1;
    if (retryCount > 3) {
      task.status = 'failed_hard';
      task.retryCount = retryCount;
      console.log('[scheduler] task', task.id, 'failed after', retryCount - 1, 'retries');
      pass1Changed = true;
      continue;
    }
    task.status = 'queued';
    task.retryCount = retryCount;
    recoveredIds.add(task.id);
    pass1Changed = true;
  }
  if (pass1Changed) {
    taskStore.saveTasks(tasks);
  }

  // ── Pass 2: dispatch queued tasks (recovered first, then others) ──────
  // Sort so recovered tasks get first shot at concurrency slots
  const dispatchOrder = [...tasks].sort((a, b) => {
    const aRec = recoveredIds.has(a.id) ? 0 : 1;
    const bRec = recoveredIds.has(b.id) ? 0 : 1;
    return aRec - bRec;
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

    // subLibrary scheduleMode check: skip if subLib autoExecute is off
    if (task.status === 'pending_manual' || task.status === 'created') {
      const subLibSchedule = configStore.resolveSubLibSchedule(task.itemInfo || {}, config);
      if (!subLibSchedule.autoExecute) continue;
    }

    // itemId lock: only one flow per itemId
    if (usedItemIds.has(task.itemId) && task.status !== 'executing') continue;

    // Transition created/pending_manual → queued (always allowed — pure status change)
    if (task.status === 'created' || task.status === 'pending_manual') {
      taskStore.updateTask(task.id, { status: 'queued' });
      task.status = 'queued';
    }

    if (task.status === 'queued') {
      // actionType slot check — just-confirmed tasks bypass (they already held a slot)
      const limit = getConcurrencyLimit(task.actionType, config);
      if (activeCount[task.actionType] >= limit && !justConfirmedIds.has(task.id)) continue;

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
