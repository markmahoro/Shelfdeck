'use strict';

const taskStore = require('./taskStore');
const flowPlanner = require('./flowPlanner');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const diagnosticLog = require('./diagnosticLog');
const basedataFlow = require('./basedataFlowExecutor');
const scrapeFlow = require('./scrapeFlowExecutor');
const transcodeFlow = require('./transcodeFlowExecutor');
const upgradeFlow = require('./upgradeFlowExecutor');
const kairoxAdmissionFence = require('./kairoxAdmissionFence');
const resourceGovernor = require('./resourceGovernor');
const resourceProjection = require('./resourceProjection');
const configStore = require('./configStore');

const FLOW_EXECUTORS = {
  basedata: basedataFlow,
  scrape: scrapeFlow,
  transcode: transcodeFlow,
  upgrade: upgradeFlow,
};

let callbacks = {
  pauseForConfirm: null,
  reportStatus: null,
  reportGateInvalidation: null,
  reportResourceDeferred: null,
};

const pendingDispatches = new Map();

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
    reportResourceDeferred: input.reportResourceDeferred,
  };
  const executorCallbacks = {
    pauseForConfirm: callbacks.pauseForConfirm,
    reportStatus: callbacks.reportStatus,
    reportGateInvalidation: callbacks.reportGateInvalidation,
    assertHelixAdmission(taskId, checkpoint) {
      const task = taskStore.getTask(taskId);
      return kairoxAdmissionFence.assertTask(task || { id: taskId }, checkpoint);
    },
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

function dispatchTask(inputTask) {
  if (pendingDispatches.has(inputTask.id)) {
    return { dispatched: true, waitingForResource: true, reason: 'resource_waiter_exists', task: inputTask, flowKind: flowKindForTask(inputTask) };
  }
  const fence = kairoxAdmissionFence.checkTask(inputTask, 'resource_dispatch');
  if (!fence.allowed) {
    const updated = taskStore.updateTask(inputTask.id, {
      status: 'interrupted',
      phase: 'helix_fenced',
      resumePoint: inputTask.resumePoint || inputTask.phase || null,
      helixFence: fence,
      logs: [{ ts: new Date().toISOString(), level: 'warning', msg: `Task fenced: ${fence.reason}` }],
    });
    taskStore.appendTaskEvent(updated || inputTask, 'task.helix_fenced', fence, { resourceType: 'scheduler' });
    return { dispatched: false, reason: 'helix_admission_fenced', fence, task: updated || inputTask };
  }
  const task = ensureFlowPlan(inputTask);
  const flowKind = flowKindForTask(task);
  if (flowKind === 'no_op') {
    const updated = taskStore.updateTask(task.id, { phase: 'flow_no_op', resumePoint: null });
    taskStore.appendTaskEvent(updated || task, 'flow.no_op', {
      targetGate: task.taskTarget && task.taskTarget.targetGate,
      flowPlan: task.flowPlan,
    });
    if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'done', 100);
    else taskStore.updateTask(task.id, { status: 'done', progress: 100 });
    return { dispatched: true, waitingForResource: false, reason: 'flow_no_op', task: taskStore.getTask(task.id) || task, flowKind };
  }
  if (flowKind === 'blocked') {
    const blockedReason = String(task.flowPlan && task.flowPlan.flowSelection
      && (task.flowPlan.flowSelection.blockedReason || task.flowPlan.flowSelection.reason)
      || 'flow_plan_blocked');
    const updated = taskStore.updateTask(task.id, {
      phase: 'flow_plan_blocked',
      resumePoint: null,
      failureContext: {
        message: `Flow Planner blocked this task: ${blockedReason}`,
        source: 'flow_planner',
        phase: 'flow_plan_blocked',
        recoveryClass: 'non_retryable',
        failedAt: new Date().toISOString(),
      },
    });
    taskStore.appendTaskEvent(updated || task, 'flow.blocked', {
      targetGate: task.taskTarget && task.taskTarget.targetGate,
      blockedReason,
      flowPlan: task.flowPlan,
    });
    if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'failed_hard', 0);
    else taskStore.updateTask(task.id, { status: 'failed_hard', progress: 0 });
    return { dispatched: false, waitingForResource: false, reason: 'flow_plan_blocked', task: taskStore.getTask(task.id) || task, flowKind };
  }
  const executor = executorForFlowKind(flowKind);
  if (!executor) {
    return { dispatched: false, reason: 'flow_executor_missing', task };
  }

  const resource = resourceProjection.resourceForTask(task, configStore.loadConfig());
  const flowStep = flowPlanner.currentFlowStep(task);
  const currentBeforeWait = taskStore.getTask(task.id) || task;
  if (currentBeforeWait.status !== 'waiting_for_resource') {
    taskStore.appendTaskEvent(currentBeforeWait, 'flow.waiting_for_resource', {
      flowEventType: flowStep.eventType,
      flowEventPhase: flowStep.phase,
      resourceType: resource.resourceType,
      resourceKey: resource.resourceKey,
      resourceLabel: resource.resourceLabel,
      targetGate: task.taskTarget && task.taskTarget.targetGate,
      flowDirection: task.flowPlan && task.flowPlan.direction,
      flowKind: task.flowPlan && task.flowPlan.flowKind,
    }, { resourceType: resource.resourceType });
    if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'waiting_for_resource');
  }
  const resources = resourceProjection.resourcesForTask(task, configStore.loadConfig());
  const acquireFlowPermits = async () => {
    const permits = [];
    try {
      for (const required of resources.length > 0 ? resources : [{ resourceKey: resource.resourceKey || 'service:task' }]) {
        permits.push(await resourceGovernor.acquire({
          owner: 'kairox', workId: task.id, resourceKey: required.resourceKey, priority: task.priority,
          trafficClass: 'maintenance',
          maintenancePriorityClass: task.maintenancePrioritySnapshot && task.maintenancePrioritySnapshot.class || 'normal',
        }));
      }
      return permits;
    } catch (error) {
      for (const permit of permits.reverse()) permit.release();
      throw error;
    }
  };
  const dispatchPromise = acquireFlowPermits().then(async (permits) => {
    const current = taskStore.getTask(task.id) || task;
    const currentFence = kairoxAdmissionFence.checkTask(current, 'resource_permit_acquired');
    if (!currentFence.allowed) {
      for (const permit of permits.reverse()) permit.release();
      if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'interrupted');
      return;
    }
    if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'executing', current.progress || 0);
    taskStore.appendTaskEvent(current, 'flow.dispatched', {
      flowEventType: flowStep.eventType,
      flowEventPhase: flowStep.phase,
      resourceType: resource.resourceType,
      resourceKey: resource.resourceKey,
      resourceLabel: resource.resourceLabel,
      permitIds: permits.map((permit) => permit.permitId),
      targetGate: task.taskTarget && task.taskTarget.targetGate,
      flowDirection: task.flowPlan && task.flowPlan.direction,
      flowKind,
    }, { resourceType: resource.resourceType });
    const runtimeEvent = runtimeResourceTracker.startEvent({
      eventType: 'task.dispatch', component: 'resourceRuntime', resourceType: resource.resourceType,
      resourceKey: resource.resourceKey, resourceLabel: resource.resourceLabel, taskId: task.id,
      itemId: task.itemId, itemName: task.itemName, source: task.source,
      payload: { targetGate: task.taskTarget && task.taskTarget.targetGate, flowDirection: task.flowPlan && task.flowPlan.direction, flowKind, phase: task.phase, priority: task.priority, status: 'executing', permitIds: permits.map((permit) => permit.permitId) },
    });
    try {
      await executor.driveTask(task.id);
      runtimeEvent.finish('done');
    } catch (err) {
      runtimeEvent.finish('failed', { error: err && err.message ? err.message : String(err) });
      console.error(`[resourceRuntime] driveTask error for ${task.id}:`, err);
      if (typeof callbacks.reportStatus === 'function') callbacks.reportStatus(task.id, 'failed_hard');
      recordFlowFailure(task, resource, flowStep, err);
    } finally {
      for (const permit of permits.reverse()) permit.release();
    }
  }).catch((error) => {
    const current = taskStore.getTask(task.id) || task;
    const attempts = Number(current.resourceBlocker && current.resourceBlocker.attempts || 0) + 1;
    const retryDelayMs = Math.min(60000, 1000 * (2 ** Math.min(6, attempts - 1)));
    const blocker = {
      status: 'resource_deferred',
      resourceKey: resource.resourceKey,
      code: error.code || 'RESOURCE_WAIT_FAILED',
      message: error.message,
      attempts,
      retryAt: new Date(Date.now() + retryDelayMs).toISOString(),
    };
    if (typeof callbacks.reportResourceDeferred === 'function') callbacks.reportResourceDeferred(task.id, blocker);
    else taskStore.updateTask(task.id, { status: 'waiting_for_resource', resourceBlocker: blocker });
  }).finally(() => {
    pendingDispatches.delete(task.id);
  });
  pendingDispatches.set(task.id, dispatchPromise);

  return { dispatched: true, waitingForResource: true, task, flowKind, flowStep };
}

function taskFlowKind(task = {}) {
  return flowKindForTask(task);
}

function hasPendingDispatch(taskId) {
  return pendingDispatches.has(String(taskId || ''));
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
  hasPendingDispatch,
};
