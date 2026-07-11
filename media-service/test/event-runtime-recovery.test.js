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

test.after(() => { taskStore.resetForTests(); workflowStore.resetForTests(); admissionStore.resetForTests(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function task(id) {
  admissionStore.upsertAdmission({ itemId: `item-${id}`, admissionGeneration: 1, status: 'active', sourceRevision: 's1', sourceAccessDescriptor: { locator: { path: __filename } } });
  return taskStore.createTask({ id, itemId: `item-${id}`, status: 'queued', source: 'manual', helixAdmission: admissionStore.getAdmission(`item-${id}`), sourceAccessMappingRevision: 'identity', taskTarget: { targetGate: 'basedata', gateObjective: {} }, itemInfo: { itemId: `item-${id}` } });
}

test('Event retry resumes the same atomic capability without creating a Task attempt', async () => {
  builtIns.registerBuiltIns();
  let attempts = 0;
  if (!registry.has('test.retry')) registry.register({ capability: 'test.retry', execute: async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('retry me'), { code: 'TEST_RETRY' }); return { ok: true }; } });
  const value = task('retry-task');
  const plan = workflowGraph.buildPlan({ taskId: value.id, itemId: value.itemId, targetGate: 'basedata' }, [{ eventId: 'retry-event', capability: 'test.retry', retryPolicy: { maxAttempts: 2 } }]);
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
  if (!registry.has('test.restart')) registry.register({ capability: 'test.restart', execute: async () => ({ ok: true }) });
  const plan = workflowGraph.buildPlan({ taskId: value.id, itemId: value.itemId, targetGate: 'basedata' }, [{ eventId: 'restart-event', capability: 'test.restart' }]);
  workflowStore.createPlan(plan, registry);
  workflowStore.transition('restart-event', 'executing', { startedAt: new Date().toISOString(), attempt: 1 });
  taskStore.updateTask(value.id, { status: 'executing' });
  assert.strictEqual(eventRuntime.recoverStartup(), 1);
  assert.strictEqual(workflowStore.getEvent('restart-event').status, 'ready');
  assert.strictEqual(taskStore.getTask(value.id).status, 'queued');
  assert.strictEqual(eventRuntime.recoverStartup(), 0);
});
