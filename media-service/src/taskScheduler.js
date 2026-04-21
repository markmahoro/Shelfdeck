'use strict';

const taskStore = require('./taskStore');
const configStore = require('./configStore');

let schedulerInterval = null;
let isRunning = false;

function startScheduler() {
  if (isRunning) {
    console.log('Scheduler already running');
    return;
  }

  isRunning = true;
  console.log('Task scheduler started');

  // Run scheduler every 5 seconds
  schedulerInterval = setInterval(() => {
    try {
      scheduleTasks();
    } catch (err) {
      console.error('Scheduler error:', err);
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

function scheduleTasks() {
  const config = configStore.loadConfig();
  const { executionMode, deleteConcurrency, transcodeConcurrency, upgradeConcurrency } = config;

  const tasks = taskStore.loadTasks();

  // Count currently running tasks by type
  const running = {
    delete: tasks.filter(t => t.actionType === 'delete' && isOccupyingSlot(t.status)).length,
    transcode: tasks.filter(t => t.actionType === 'transcode' && isOccupyingSlot(t.status)).length,
    upgrade: tasks.filter(t => t.actionType === 'upgrade' && isOccupyingSlot(t.status)).length,
  };

  // Find tasks that can be scheduled
  for (const task of tasks) {
    // Skip if already done or failed
    if (task.status === 'done' || task.status === 'failed_hard') continue;

    // Skip if already running
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
    }

    // If task is queued, try to start execution
    if (task.status === 'queued') {
      // In a real implementation, this would trigger the worker
      // For now, we just log it
      console.log(`Task ${task.id} (${task.actionType}) ready for execution`);
      running[task.actionType]++;
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
