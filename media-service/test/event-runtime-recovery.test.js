'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-event-recovery-'));
process.env.MEDIA_SERVICE_DATA_DIR = dataDir;
const configStore = require('../src/configStore');
const taskStore = require('../src/taskStore');
const workflowStore = require('../src/workflowStore');
const workflowGraph = require('../src/workflowGraph');
const registry = require('../src/capabilityRegistry');
const admissionStore = require('../src/kairoxAdmissionStore');
const builtIns = require('../src/builtInCapabilities');
const eventRuntime = require('../src/eventRuntime');
const resourceRuntime = require('../src/resourceRuntime');

function testCapability(capability, execute, options = {}) {
  return { capability, contractVersion: 1, inputContract: {}, outputContract: { type: 'object', version: 1 }, execute, ...options };
}

test.after(() => { taskStore.resetForTests(); workflowStore.resetForTests(); admissionStore.resetForTests(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function task(id) {
  admissionStore.upsertAdmission({ itemId: `item-${id}`, admissionGeneration: 1, status: 'active', sourceRevision: 's1', sourceAccessDescriptor: { locator: { path: __filename } } });
  return taskStore.createTask({ id, itemId: `item-${id}`, status: 'queued', source: 'manual', helixAdmission: admissionStore.getAdmission(`item-${id}`), sourceAccessMappingRevision: 'identity', taskTarget: { targetGate: 'basedata', gateObjective: {} }, itemInfo: { itemId: `item-${id}` } });
}

test('Event retry resumes the same atomic capability without creating a Task attempt', async () => {
  builtIns.registerBuiltIns();
  let attempts = 0;
  if (!registry.has('test.retry')) registry.register(testCapability('test.retry', async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('retry me'), { code: 'TEST_RETRY' }); return { ok: true }; }));
  const value = task('retry-task');
  const plan = workflowGraph.buildPlan({ taskId: value.id, itemId: value.itemId, targetGate: 'basedata' }, [{ eventId: 'retry-event', capability: 'test.retry', retryPolicy: { maxAttempts: 2 } }], registry);
  workflowStore.createPlan(plan, registry);
  await eventRuntime.driveTask(value.id);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const deadline = Date.now() + 3000;
  while (workflowStore.getEvent('retry-event').status !== 'succeeded' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(workflowStore.getEvent('retry-event').status, 'succeeded');
  assert.strictEqual(workflowStore.getEvent('retry-event').attempt, 2);
  assert.strictEqual(taskStore.getTask(value.id).status, 'done');
});

test('startup recovery discards in-memory execution and requeues the durable Event and Task once', () => {
  const value = task('restart-task');
  if (!registry.has('test.restart')) registry.register(testCapability('test.restart', async () => ({ ok: true })));
  const plan = workflowGraph.buildPlan({ taskId: value.id, itemId: value.itemId, targetGate: 'basedata' }, [{ eventId: 'restart-event', capability: 'test.restart' }], registry);
  workflowStore.createPlan(plan, registry);
  workflowStore.transition('restart-event', 'executing', { startedAt: new Date().toISOString(), attempt: 1 });
  taskStore.updateTask(value.id, { status: 'executing' });
  assert.strictEqual(eventRuntime.recoverStartup(), 1);
  assert.strictEqual(workflowStore.getEvent('restart-event').status, 'ready');
  assert.strictEqual(taskStore.getTask(value.id).status, 'queued');
  assert.strictEqual(eventRuntime.recoverStartup(), 0);
});

test('a persisted graph is invalidated when its objective revision no longer matches the Task snapshot', async () => {
  const value = task('invalidated-task');
  if (!registry.has('test.invalidate')) registry.register(testCapability('test.invalidate', async () => ({ ok: true })));
  const plan = workflowGraph.buildPlan({ taskId: value.id, itemId: value.itemId, targetGate: 'basedata', objectiveRevision: 'objective-old' }, [{ eventId: 'invalidated-event', capability: 'test.invalidate' }], registry);
  workflowStore.createPlan(plan, registry);
  taskStore.updateTask(value.id, { objectiveRevisionSnapshot: 'objective-new' });
  const result = await eventRuntime.driveTask(value.id);
  assert.strictEqual(result.reason, 'workflow_plan_invalidated');
  assert.strictEqual(taskStore.getTask(value.id).status, 'plan_invalidated');
  assert.strictEqual(workflowStore.getEvent('invalidated-event').status, 'cancelled');
});

test('approval is a durable Event prerequisite and confirmation resumes the same Event', async () => {
  const value = taskStore.updateTask(task('approval-task').id, { taskTarget: { targetGate: 'optimize', gateObjective: {} } });
  if (!registry.has('test.approval')) registry.register(testCapability('test.approval', async () => ({ result: { committed: true }, commitMarker: 'approval-test-commit' }), { allowedTargetGates: ['optimize'], effectKind: 'commit_once', approvalContract: { actions: ['transcode.beforeReplace'] } }));
  const plan = workflowGraph.buildPlan({ taskId: value.id, itemId: value.itemId, targetGate: 'optimize' }, [{ eventId: 'approval-event', capability: 'test.approval', approvalRequirement: { gateId: 'transcode.beforeReplace' } }], registry);
  workflowStore.createPlan(plan, registry);
  await eventRuntime.driveTask(value.id);
  assert.strictEqual(workflowStore.getEvent('approval-event').status, 'waiting_for_approval');
  assert.strictEqual(taskStore.getTask(value.id).status, 'awaiting_user_confirm');
  assert.strictEqual(resourceRuntime.confirmTask(taskStore.getTask(value.id)), true);
  const deadline = Date.now() + 2000;
  while (taskStore.getTask(value.id).status !== 'done' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(workflowStore.getEvent('approval-event').status, 'succeeded');
  assert.strictEqual(workflowStore.getEvent('approval-event').attempt, 1);
});

test('conditional approval is required only when its typed dependency evidence matches', () => {
  const event = { intent: { inputBindings: { precheck: { source: 'event', eventId: 'precheck-event' } }, approvalRequirement: { gateId: 'transcode.dolbyVisionTonemap', whenInput: { port: 'precheck', path: 'isDolbyVision', equals: true } } } };
  assert.strictEqual(eventRuntime.approvalRequirementApplies(event, [{ eventId: 'precheck-event', result: { isDolbyVision: false } }]), false);
  assert.strictEqual(eventRuntime.approvalRequirementApplies(event, [{ eventId: 'precheck-event', result: { isDolbyVision: true } }]), true);
});

test('forceWhenInput cannot be bypassed by an auto approval policy', () => {
  const event = { result: null, intent: { inputBindings: { candidates: { source: 'event', eventId: 'search' } }, approvalRequirement: { gateId: 'upgrade.candidateSelect', forceWhenInput: { port: 'candidates', path: 'forceConfirmation', equals: true } } } };
  const events = [{ eventId: 'search', result: { forceConfirmation: true } }];
  assert.strictEqual(eventRuntime.approvalConditionMatches(event.intent.approvalRequirement.forceWhenInput, event, events), true);
});

test('typed runWhen selects an Event branch from dependency output without invoking the Executor', () => {
  const intent = { inputBindings: { verifiedAsset: { source: 'event', eventId: 'disposition' } }, runWhen: { port: 'verifiedAsset', path: 'action', equals: 'replace' } };
  assert.strictEqual(eventRuntime.inputConditionApplies(intent, [{ eventId: 'disposition', result: { action: 'discard' } }]), false);
  assert.strictEqual(eventRuntime.inputConditionApplies(intent, [{ eventId: 'disposition', result: { action: 'replace' } }]), true);
});

test('Runtime invokes the Capability cancellation contract for an executing atomic effect', async () => {
  let cancelled = '';
  if (!registry.has('test.cancellable')) registry.register(testCapability('test.cancellable', async () => ({ ok: true }), { cancel: ({ event, reason }) => { cancelled = `${event.eventId}:${reason}`; } }));
  await eventRuntime.cancelExecutingEvent({ eventId: 'cancellable-event', capability: 'test.cancellable' }, 'paused');
  assert.strictEqual(cancelled, 'cancellable-event:paused');
});
