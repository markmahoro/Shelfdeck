'use strict';

const taskStore = require('./taskStore');
const workflowStore = require('./workflowStore');
const eventRuntime = require('./eventRuntime');
const builtInCapabilities = require('./builtInCapabilities');
const workflowCompensation = require('./workflowCompensation');
const configStore = require('./configStore');

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
    if (event.status === 'executing') await eventRuntime.cancelExecutingEvent(event, 'paused');
    if (['ready', 'waiting_for_resource'].includes(event.status)) workflowStore.transition(event.eventId, 'pending', {});
    else if (event.status === 'executing') workflowStore.transition(event.eventId, 'pending', { failure: { code: 'EVENT_PAUSED', retryable: true } });
  }
  taskStore.updateTask(task.id, { status: 'paused', phase: 'workflow_paused' });
  return true;
}

async function cancelTask(task = {}) {
  for (const event of workflowStore.listEvents(task.id)) {
    if (event.status === 'executing') await eventRuntime.cancelExecutingEvent(event, 'cancelled');
    if (!workflowStore.TERMINAL.has(event.status)) workflowStore.transition(event.eventId, 'cancelled', { finishedAt: new Date().toISOString(), failure: { code: 'TASK_CANCELLED' } });
  }
  taskStore.updateTask(task.id, { status: 'cancelled', phase: 'workflow_cancelled' });
  const compensation = workflowCompensation.cleanupTask(task.id, configStore.loadConfig(), 'cancelled');
  if (compensation.removed.length) taskStore.appendTaskEvent(task, 'workflow.compensated', compensation);
  return true;
}

function fenceTask(task = {}, reason = 'helix_fenced') {
  const cancellations = [];
  for (const event of workflowStore.listEvents(task.id)) {
    if (event.status === 'executing') {
      const cancellation = Promise.resolve(eventRuntime.cancelExecutingEvent(event, reason)).catch(() => {});
      cancellations.push(cancellation);
    }
    if (!workflowStore.TERMINAL.has(event.status)) workflowStore.transition(event.eventId, 'cancelled', { finishedAt: new Date().toISOString(), failure: { code: 'HELIX_ADMISSION_FENCED', reason } });
  }
  return { taskId: task.id, cancellationCount: cancellations.length, cancellations };
}

module.exports = { initialize, dispatchTask, confirmTask, pauseTask, cancelTask, fenceTask, hasPendingDispatch };
