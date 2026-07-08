'use strict';

const taskStore = require('./taskStore');
const flowPlanner = require('./flowPlanner');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const diagnosticLog = require('./diagnosticLog');
const ingestFlow = require('./ingestFlowExecutor');
const scrapeFlow = require('./scrapeFlowExecutor');
const transcodeFlow = require('./transcodeFlowExecutor');
const upgradeFlow = require('./upgradeFlowExecutor');
const archiveFlow = require('./archiveFlowExecutor');
const deleteFlow = require('./deleteFlowExecutor');

const FLOW_EXECUTORS = {
  ingest: ingestFlow,
  scrape: scrapeFlow,
  transcode: transcodeFlow,
  upgrade: upgradeFlow,
  archive: archiveFlow,
  delete: deleteFlow,
};

let callbacks = {
  pauseForConfirm: null,
  reportStatus: null,
  reportGateInvalidation: null,
};

function flowKindForTask(task = {}) {
  return String(task.flowPlan && task.flowPlan.flowKind || '');
}

function executorForFlowKind(flowKind) {
  return FLOW_EXECUTORS[String(flowKind || '')] || null;
}

function setSchedulerCallbacks(input = {}) {
  callbacks = {
    pauseForConfirm: input.pauseForConfirm,
    reportStatus: input.reportStatus,
    reportGateInvalidation: input.reportGateInvalidation,
  };
  const executorCallbacks = {
    pauseForConfirm: callbacks.pauseForConfirm,
    reportStatus: callbacks.reportStatus,
    reportGateInvalidation: callbacks.reportGateInvalidation,
  };
  Object.values(FLOW_EXECUTORS).forEach((executor) => {
    if (executor && typeof executor.setScheduler === 'function') {
      executor.setScheduler(executorCallbacks);
    }
  });
}

function errorSummary(err) {
  return {
    name: err && err.name ? String(err.name) : 'Error',
    message: err && err.message ? err.message : String(err),
  };
}

function ensureFlowPlan(task = {}) {
  const existing = task.flowPlan && typeof task.flowPlan === 'object' ? task.flowPlan : null;
  const hasFlowKind = existing && existing.flowKind;
  const hasSteps = existing && Array.isArray(existing.steps) && existing.steps.length > 0;
  if (hasFlowKind && hasSteps) return task;

  const planned = flowPlanner.planFlow({
    ...task,
    targetGate: task.taskTarget && task.taskTarget.targetGate || task.targetGate,
    taskTarget: task.taskTarget,
    gateObjective: task.taskTarget && task.taskTarget.gateObjective,
    itemInfo: task.itemInfo,
  });
  const updates = {
    taskBridge: planned.taskBridge,
    flowPlan: planned.flowPlan,
  };
  const updated = taskStore.updateTask(task.id, updates);
  return updated || { ...task, ...updates };
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
    targetGate: task.taskTarget && task.taskTarget.targetGate,
    flowDirection: task.flowPlan && task.flowPlan.direction,
    flowKind: task.flowPlan && task.flowPlan.flowKind,
    effect: 'mark_failed_hard_after_flow_exception',
  }, {
    resourceType: resource && resource.resourceType,
  });
  diagnosticLog.record({
    category: 'resource_runtime',
    scope: 'resourceRuntime.flowDispatch',
    operation: 'flow_executor_failed',
    component: 'resourceRuntime',
    resourceType: resource && resource.resourceType || 'resource_runtime',
    resourceKey: resource && resource.resourceKey || 'resourceRuntime',
    status: 'failed',
    payload: {
      taskId: task.id,
      itemId: task.itemId,
      targetGate: task.taskTarget && task.taskTarget.targetGate,
      flowDirection: task.flowPlan && task.flowPlan.direction,
      flowKind: task.flowPlan && task.flowPlan.flowKind,
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

function dispatchTask(inputTask, options = {}) {
  const task = ensureFlowPlan(inputTask);
  const flowKind = flowKindForTask(task);
  const executor = executorForFlowKind(flowKind);
  if (!executor) {
    return { dispatched: false, reason: 'flow_executor_missing', task };
  }

  const resource = options.resource || {};
  const flowStep = flowPlanner.currentFlowStep(task);
  taskStore.appendTaskEvent(taskStore.getTask(task.id) || task, 'flow.dispatched', {
    flowEventType: flowStep.eventType,
    flowEventPhase: flowStep.phase,
    resourceType: resource.resourceType,
    resourceKey: resource.resourceKey,
    resourceLabel: resource.resourceLabel,
    targetGate: task.taskTarget && task.taskTarget.targetGate,
    flowDirection: task.flowPlan && task.flowPlan.direction,
    flowKind: task.flowPlan && task.flowPlan.flowKind,
  }, { resourceType: resource.resourceType });

  const runtimeEvent = runtimeResourceTracker.startEvent({
    eventType: 'task.dispatch',
    component: 'resourceRuntime',
    resourceType: resource.resourceType,
    resourceKey: resource.resourceKey,
    resourceLabel: resource.resourceLabel,
    taskId: task.id,
    itemId: task.itemId,
    itemName: task.itemName,
    source: task.source,
    payload: {
      targetGate: task.taskTarget && task.taskTarget.targetGate,
      flowDirection: task.flowPlan && task.flowPlan.direction,
      flowKind,
      phase: task.phase,
      priority: task.priority,
      status: 'executing',
    },
  });

  executor.driveTask(task.id).then(() => {
    runtimeEvent.finish('done');
  }).catch((err) => {
    runtimeEvent.finish('failed', { error: err && err.message ? err.message : String(err) });
    console.error(`[resourceRuntime] driveTask error for ${task.id}:`, err);
    if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'failed_hard');
    recordFlowFailure(task, resource, flowStep, err);
  });

  return { dispatched: true, task, flowKind, flowStep };
}

function taskFlowKind(task = {}) {
  return flowKindForTask(task);
}

function confirmTask(task = {}) {
  const executor = executorForFlowKind(taskFlowKind(task));
  if (executor && typeof executor.confirmReceived === 'function') {
    executor.confirmReceived(task.id);
    return true;
  }
  return false;
}

async function pauseTask(task = {}) {
  const executor = executorForFlowKind(taskFlowKind(task));
  if (executor && typeof executor.pause === 'function') {
    await executor.pause(task.id);
    return true;
  }
  return false;
}

async function cancelTask(task = {}) {
  const executor = executorForFlowKind(taskFlowKind(task));
  if (executor && typeof executor.cancel === 'function') {
    await executor.cancel(task.id);
    return true;
  }
  return false;
}

module.exports = {
  setSchedulerCallbacks,
  dispatchTask,
  confirmTask,
  pauseTask,
  cancelTask,
  executorForFlowKind,
  flowKindForTask,
};
