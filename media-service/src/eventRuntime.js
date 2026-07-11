'use strict';

const taskStore = require('./taskStore');
const workflowStore = require('./workflowStore');
const workflowGraph = require('./workflowGraph');
const workflowPlanner = require('./workflowPlanner');
const capabilityRegistry = require('./capabilityRegistry');
const resourceGovernor = require('./resourceGovernor');
const configStore = require('./configStore');
const approvalPolicy = require('./approvalPolicy');
const kairoxAdmissionFence = require('./kairoxAdmissionFence');
const kairoxSignalBus = require('./kairoxSignalBus');

const dispatching = new Map();
const retryTimers = new Map();
const SUCCESS = new Set(['succeeded', 'skipped']);

function eventContext(task, events, config) {
  return {
    task,
    facts: task.itemInfo || {},
    policy: config,
    events: Object.fromEntries(events.map((event) => [event.eventId, { status: event.status, result: event.result, evidence: event.evidence }])),
  };
}

function resourceKeyFor(event, task) {
  const request = event.intent.resourceRequest || {};
  const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
  if (request.resourceKey) return request.resourceKey;
  if (request.resourceType === 'transcode') return 'local:ffmpeg';
  if (request.resourceType === 'emby') return `emby:${descriptor.identityPayload && descriptor.identityPayload.serverId || 'default'}:api`;
  if (request.resourceType === 'moviepilot') return 'service:moviepilot';
  if (request.resourceType === 'filesystem') return `filesystem:${descriptor.locator && descriptor.locator.path || task.itemPath || task.itemId}:mutation`;
  return 'service:task';
}
function scheduleDispatch(task, eventId, delayMs) {
  if (retryTimers.has(eventId)) clearTimeout(retryTimers.get(eventId));
  const timer = setTimeout(() => { retryTimers.delete(eventId); dispatchTask(taskStore.getTask(task.id) || task); }, delayMs);
  timer.unref && timer.unref();
  retryTimers.set(eventId, timer);
}

function ensurePlan(task, config) {
  let plan = workflowStore.getPlanForTask(task.id);
  if (plan) return plan;
  plan = workflowPlanner.planTask(task, config);
  workflowGraph.validateGraph(plan, capabilityRegistry);
  return workflowStore.createPlan(plan, capabilityRegistry);
}

function planPrerequisitesCurrent(plan, task, config) {
  const libraryId = task.itemInfo && task.itemInfo.subLibraryId || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor && task.helixAdmission.sourceAccessDescriptor.subLibraryId || '';
  const library = (config.subLibraries || []).find((entry) => entry.uuid === libraryId) || {};
  const current = {
    objectiveRevision: String(task.objectiveRevisionSnapshot || ''),
    sourceRevision: String(task.helixAdmission && task.helixAdmission.sourceRevision || ''),
    policyRevision: String(task.helixAdmission && task.helixAdmission.policyRevision || ''),
    capabilityPolicyRevision: String(task.capabilityPolicyRevision || library.capabilityPolicyRevision || ''),
  };
  return Object.entries(current).every(([key, value]) => !plan[key] || !value || String(plan[key]) === value);
}

function invalidatePlan(task, plan) {
  for (const event of workflowStore.listEvents(task.id)) {
    if (!workflowStore.TERMINAL.has(event.status)) workflowStore.transition(event.eventId, 'cancelled', { finishedAt: new Date().toISOString(), failure: { code: 'WORKFLOW_PLAN_INVALIDATED' } });
  }
  const updated = taskStore.updateTask(task.id, { status: 'plan_invalidated', phase: 'workflow_plan_invalidated', progress: 0 });
  kairoxSignalBus.publish({ kind: 'task_terminal', itemId: task.itemId, taskId: task.id, status: 'plan_invalidated', planId: plan.planId });
  return updated;
}

function approvalSatisfied(event, task, config) {
  const requirement = event.intent.approvalRequirement;
  if (!requirement || !requirement.gateId) return true;
  const mode = approvalPolicy.resolveGate(requirement.gateId, { task, itemInfo: task.itemInfo, config });
  if (mode === 'auto') return true;
  return !!(event.result && event.result.approved === true);
}

function approvalProjection(event, task, config, events) {
  const requirement = event.intent.approvalRequirement || {};
  const search = events.find((entry) => entry.eventId.endsWith(':upgrade-search'));
  return approvalPolicy.makeApproval(requirement.gateId, {
    task,
    itemInfo: task.itemInfo,
    config,
    message: requirement.gateId === 'upgrade.candidateSelect' ? '请选择用于来源升级的候选。' : '此操作需要确认。',
    options: ['approve'],
    payload: search && search.result ? { candidates: search.result.candidates || [] } : {},
  });
}

function immutableInputSnapshot(event, task, events) {
  const dependencies = new Set(event.intent.dependsOn || []);
  return {
    bindings: event.intent.inputBindings || {},
    task: {
      taskId: task.id,
      itemId: task.itemId,
      targetGate: task.taskTarget && task.taskTarget.targetGate || task.targetGate || '',
      objectiveRevision: task.objectiveRevisionSnapshot || '',
      sourceRevision: task.helixAdmission && task.helixAdmission.sourceRevision || '',
      admissionGeneration: task.helixAdmission && task.helixAdmission.admissionGeneration || 0,
      mappingRevision: task.sourceAccessMappingRevision || '',
    },
    dependencies: Object.fromEntries(events.filter((entry) => dependencies.has(entry.eventId)).map((entry) => [entry.eventId, { status: entry.status, result: entry.result, evidence: entry.evidence }])),
  };
}

function validateOutputContract(contract = {}, result = {}) {
  for (const [field, expected] of Object.entries(contract || {})) {
    const value = result && result[field];
    const valid = expected === 'array' ? Array.isArray(value)
      : expected === 'number' ? Number.isFinite(Number(value))
        : expected === 'string' ? typeof value === 'string' && value.length > 0
          : expected === 'boolean' ? typeof value === 'boolean' : value !== undefined;
    if (!valid) throw Object.assign(new Error(`Capability output does not satisfy ${field}:${expected}`), { code: 'KAIROX_EVENT_OUTPUT_CONTRACT_VIOLATION', field, expected });
  }
}

function aggregateTask(task, events) {
  let updated;
  if (events.some((event) => event.status === 'failed')) updated = taskStore.updateTask(task.id, { status: 'failed_hard', phase: 'workflow_failed', progress: 0 });
  else if (events.every((event) => SUCCESS.has(event.status))) updated = taskStore.updateTask(task.id, { status: 'done', phase: 'workflow_complete', progress: 100 });
  if (updated) {
    if (task.status !== updated.status) kairoxSignalBus.publish({ kind: 'task_terminal', itemId: task.itemId, taskId: task.id, status: updated.status });
    return updated;
  }
  if (events.some((event) => event.status === 'waiting_for_approval')) return taskStore.updateTask(task.id, { status: 'awaiting_user_confirm', phase: 'event_waiting_for_approval' });
  if (events.some((event) => event.status === 'waiting_for_resource')) return taskStore.updateTask(task.id, { status: 'waiting_for_resource', phase: 'event_waiting_for_resource' });
  if (events.some((event) => event.status === 'ready' && event.retryAt && Date.parse(event.retryAt) > Date.now())) return taskStore.updateTask(task.id, { status: 'waiting_for_resource', phase: 'event_resource_deferred' });
  return taskStore.updateTask(task.id, { status: 'executing', phase: 'workflow_executing', progress: Math.floor(events.filter((event) => SUCCESS.has(event.status)).length * 100 / Math.max(1, events.length)) });
}

function unlock(task, plan, config) {
  let changed;
  do {
    changed = false;
    const events = workflowStore.listEvents(task.id);
    const byId = new Map(events.map((event) => [event.eventId, event]));
    const context = eventContext(task, events, config);
    for (const node of plan.nodes) {
      const current = byId.get(node.eventId);
      if (!current || current.status !== 'pending') continue;
      const dependencies = (node.dependsOn || []).map((id) => byId.get(id));
      if (dependencies.some((entry) => !entry || entry.status === 'failed' || entry.status === 'cancelled')) {
        workflowStore.transition(node.eventId, 'cancelled', { finishedAt: new Date().toISOString(), failure: { code: 'DEPENDENCY_FAILED' } });
        changed = true;
        continue;
      }
      if (!dependencies.every((entry) => SUCCESS.has(entry.status))) continue;
      if (!workflowGraph.evaluateCondition(node.when, context)) workflowStore.transition(node.eventId, 'skipped', { finishedAt: new Date().toISOString() });
      else workflowStore.transition(node.eventId, 'ready', { readyAt: new Date().toISOString() });
      changed = true;
    }
  } while (changed);
  return workflowStore.listEvents(task.id);
}

async function executeEvent(task, event, config) {
  const capability = capabilityRegistry.get(event.capability);
  if (!capability) throw Object.assign(new Error(`Capability executor is missing: ${event.capability}`), { code: 'KAIROX_CAPABILITY_MISSING' });
  const targetGate = task.taskTarget && task.taskTarget.targetGate || task.targetGate || '';
  if (capability.allowedTargetGates.length > 0 && !capability.allowedTargetGates.includes(targetGate)) {
    throw Object.assign(new Error(`Capability ${event.capability} is not allowed for ${targetGate}`), { code: 'KAIROX_CAPABILITY_GATE_VIOLATION' });
  }
  if (!approvalSatisfied(event, task, config)) {
    workflowStore.transition(event.eventId, 'waiting_for_approval', { approvalWaitStartedAt: event.approvalWaitStartedAt || new Date().toISOString() });
    taskStore.updateTask(task.id, { approval: approvalProjection(event, task, config, workflowStore.listEvents(task.id)) });
    return;
  }
  const fence = kairoxAdmissionFence.checkTask(task, `event.${event.capability}.before_resource`);
  if (!fence.allowed) {
    workflowStore.transition(event.eventId, 'failed', { finishedAt: new Date().toISOString(), failure: { code: 'HELIX_ADMISSION_FENCED', fence } });
    return;
  }
  const resourceKey = resourceKeyFor(event, task);
  workflowStore.transition(event.eventId, 'waiting_for_resource', { resourceKey, resourceWaitStartedAt: new Date().toISOString() });
  let permit;
  try {
    permit = await resourceGovernor.acquire({ owner: 'kairox-event', workId: event.eventId, resourceKey, priority: task.priority, trafficClass: 'maintenance', maintenancePriorityClass: task.maintenancePrioritySnapshot && task.maintenancePrioritySnapshot.class || 'normal' });
  } catch (error) {
    const attempts = Number(event.failure && event.failure.resourceAttempts || 0) + 1;
    const delayMs = Math.min(60000, 1000 * (2 ** Math.min(6, attempts - 1)));
    workflowStore.transition(event.eventId, 'ready', { retryAt: new Date(Date.now() + delayMs).toISOString(), resourceKey, resourceWaitStartedAt: event.resourceWaitStartedAt || new Date().toISOString(), failure: { code: error.code || 'RESOURCE_WAIT_FAILED', message: error.message, resourceAttempts: attempts, retryable: true } });
    taskStore.updateTask(task.id, { status: 'waiting_for_resource', phase: 'event_resource_deferred' });
    scheduleDispatch(task, event.eventId, delayMs);
    return;
  }
  try {
    const currentTask = taskStore.getTask(task.id) || task;
    const currentFence = kairoxAdmissionFence.checkTask(currentTask, `event.${event.capability}.before_execute`);
    if (!currentFence.allowed) throw Object.assign(new Error('Event admission fence changed'), { code: 'HELIX_ADMISSION_FENCED', fence: currentFence });
    const allEvents = workflowStore.listEvents(task.id);
    const current = workflowStore.transition(event.eventId, 'executing', { attempt: event.attempt + 1, startedAt: new Date().toISOString(), executorVersion: capability.executorVersion, fencing: currentFence, input: event.input || immutableInputSnapshot(event, currentTask, allEvents) });
    const execution = capability.execute({ task: currentTask, event: current, config, events: allEvents, outputs: Object.fromEntries(allEvents.map((entry) => [entry.eventId, entry.result])) });
    const timeoutMs = Number(event.intent.timeoutPolicy && event.intent.timeoutPolicy.timeoutMs) || 0;
    const result = timeoutMs > 0 ? await Promise.race([execution, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Capability Event timed out'), { code: 'KAIROX_EVENT_TIMEOUT' })), timeoutMs))]) : await execution;
    const output = result && result.result !== undefined ? result.result : result || {};
    validateOutputContract(event.intent.outputContract, output);
    workflowStore.transition(event.eventId, 'succeeded', { finishedAt: new Date().toISOString(), result: output, evidence: result && result.evidence || null, commitMarker: result && result.commitMarker || null });
  } catch (error) {
    const latest = workflowStore.getEvent(event.eventId) || event;
    const maxAttempts = Math.max(1, Number(event.intent.retryPolicy && event.intent.retryPolicy.maxAttempts) || 1);
    if (latest.attempt < maxAttempts && !(latest.commitMarker && capability.idempotency === 'commit_once')) {
      const delayMs = Math.min(60000, 1000 * (2 ** Math.max(0, latest.attempt - 1)));
      const retryAt = new Date(Date.now() + delayMs).toISOString();
      workflowStore.transition(event.eventId, 'ready', { retryAt, failure: { code: error.code || 'KAIROX_CAPABILITY_FAILED', message: error.message, retryable: true } });
      scheduleDispatch(task, event.eventId, delayMs);
    } else {
      workflowStore.transition(event.eventId, 'failed', { finishedAt: new Date().toISOString(), failure: { code: error.code || 'KAIROX_CAPABILITY_FAILED', message: error.message } });
      taskStore.appendTaskEvent(task, 'workflow.event_failed', { eventId: event.eventId, capability: event.capability, code: error.code || 'KAIROX_CAPABILITY_FAILED', message: error.message });
    }
  } finally {
    permit.release();
  }
}

async function driveTask(taskId) {
  let task = taskStore.getTask(taskId);
  if (!task) return { dispatched: false, reason: 'task_not_found' };
  const config = configStore.loadConfig();
  const plan = ensurePlan(task, config);
  if (!planPrerequisitesCurrent(plan, task, config)) {
    invalidatePlan(task, plan);
    return { dispatched: false, reason: 'workflow_plan_invalidated', plan };
  }
  let events;
  while (true) {
    task = taskStore.getTask(taskId) || task;
    events = unlock(task, plan, config);
    const ready = events.filter((event) => event.status === 'ready' && (!event.retryAt || Date.parse(event.retryAt) <= Date.now()));
    if (ready.length === 0) break;
    await Promise.all(ready.map((event) => executeEvent(task, event, config)));
  }
  aggregateTask(taskStore.getTask(taskId) || task, events);
  return { dispatched: true, plan, events };
}

function dispatchTask(task) {
  if (dispatching.has(task.id)) return { dispatched: true, waitingForResource: true, reason: 'event_runtime_active', task };
  const promise = driveTask(task.id).finally(() => dispatching.delete(task.id));
  dispatching.set(task.id, promise);
  return { dispatched: true, waitingForResource: true, reason: 'event_runtime_dispatched', task };
}

function hasPendingDispatch(taskId) { return dispatching.has(String(taskId || '')); }
function recoverStartup() {
  const taskIds = workflowStore.recoverInterruptedEvents();
  for (const taskId of taskIds) taskStore.updateTask(taskId, { status: 'queued', phase: 'workflow_recovered' });
  return taskIds.length;
}

module.exports = { dispatchTask, driveTask, hasPendingDispatch, recoverStartup, resourceKeyFor, unlock, aggregateTask, planPrerequisitesCurrent, validateOutputContract };
