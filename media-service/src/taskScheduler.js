'use strict';

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const taskExecutor = require('./taskExecutor');

let schedulerInterval = null;
let isRunning = false;
let schedulerBusy = false;

function startScheduler() {
  if (isRunning) {
    console.log('Scheduler already running');
    return;
  }

  isRunning = true;
  console.log('Task scheduler started');

  // 启动恢复：中断任务降级
  taskExecutor.recoverInterruptedTasks();

  // Run scheduler every 5 seconds
  schedulerInterval = setInterval(async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      await scheduleTasks();
    } catch (err) {
      console.error('Scheduler error:', err);
    } finally {
      schedulerBusy = false;
    }
  }, 5000);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  isRunning = false;
  console.log('Task scheduler stopped');
}

async function scheduleTasks() {
  const config = configStore.loadConfig();
  const { executionMode, deleteConcurrency, transcodeConcurrency, upgradeConcurrency } = config;

  const tasks = taskStore.loadTasks();

  // Count currently running tasks by type (only truly occupying a slot)
  const running = {
    delete: tasks.filter(t => t.actionType === 'delete' && isOccupyingSlot(t.status)).length,
    transcode: tasks.filter(t => t.actionType === 'transcode' && isOccupyingSlot(t.status)).length,
    upgrade: tasks.filter(t => t.actionType === 'upgrade' && isOccupyingSlot(t.status)).length,
  };

  for (const task of tasks) {
    // Skip if already done or failed
    if (task.status === 'done' || task.status === 'failed_hard' || task.status === 'interrupted') continue;

    // Skip if already occupying a slot (already in Flow — will be driven by executor)
    if (isOccupyingSlot(task.status)) continue;

    // Skip if paused
    if (task.status === 'paused') continue;

    // In manual mode, only schedule tasks that are explicitly queued
    if (executionMode === 'manual' && task.status === 'pending_manual') continue;

    // Check concurrency limits
    const limit = getConcurrencyLimit(task.actionType, { deleteConcurrency, transcodeConcurrency, upgradeConcurrency });
    if (running[task.actionType] >= limit) continue;

    // Move task to queued state
    if (task.status === 'pending_manual' || task.status === 'created') {
      taskStore.updateTask(task.id, { status: 'queued' });
      console.log(`Task ${task.id} (${task.actionType}) moved to queued`);
      running[task.actionType]++;
    }

    // If task is queued, drive its Flow
    if (task.status === 'queued') {
      try {
        await taskExecutor.driveTask(task.id);
      } catch (err) {
        console.error(`driveTask error for ${task.id}:`, err);
      }
    }
  }
}

function isOccupyingSlot(status) {
  return ['precheck', 'executing', 'verify'].includes(status);
}

function getConcurrencyLimit(actionType, limits) {
  switch (actionType) {
    case 'delete': return limits.deleteConcurrency;
    case 'transcode': return limits.transcodeConcurrency;
    case 'upgrade': return limits.upgradeConcurrency;
    default: return 1;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  scheduleTasks,
};
