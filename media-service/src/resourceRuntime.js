'use strict';

const taskStore = require('./taskStore');
const workflowStore = require('./workflowStore');
const eventRuntime = require('./eventRuntime');
const builtInCapabilities = require('./builtInCapabilities');

builtInCapabilities.registerBuiltIns();

function initialize() {
  eventRuntime.recoverStartup();
}

function dispatchTask(task) {
  return eventRuntime.dispatchTask(task);
}

function hasPendingDispatch(taskId) {
  return eventRuntime.hasPendingDispatch(taskId);
}

function confirmTask(task = {}) {
  task = taskStore.getTask(task.id) || task;
  const event = workflowStore.listEvents(task.id).find((entry) => entry.status === 'waiting_for_approval');
  if (!event) return false;
  workflowStore.transition(event.eventId, 'ready', {
    approvalWaitStartedAt: event.approvalWaitStartedAt,
    result: { ...(event.result || {}), approved: true, approvedAt: new Date().toISOString(), confirmData: task.confirmData || {} },
  });
  const updated = taskStore.updateTask(task.id, { status: 'queued', approval: null });
  eventRuntime.dispatchTask(updated || task);
  return true;
}

async function pauseTask(task = {}) {
  for (const event of workflowStore.listEvents(task.id)) {
    if (['ready', 'waiting_for_resource'].includes(event.status)) workflowStore.transition(event.eventId, 'pending', {});
  }
  taskStore.updateTask(task.id, { status: 'paused', phase: 'workflow_paused' });
  return true;
}

async function cancelTask(task = {}) {
  for (const event of workflowStore.listEvents(task.id)) {
    if (!workflowStore.TERMINAL.has(event.status)) workflowStore.transition(event.eventId, 'cancelled', { finishedAt: new Date().toISOString(), failure: { code: 'TASK_CANCELLED' } });
  }
  taskStore.updateTask(task.id, { status: 'cancelled', phase: 'workflow_cancelled' });
  return true;
}

module.exports = { initialize, dispatchTask, confirmTask, pauseTask, cancelTask, hasPendingDispatch };
