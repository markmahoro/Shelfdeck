'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-supply-invariants-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const cleanState = require('../src/helixCleanState');
const taskCreator = require('../src/kairoxTaskCreator');
const taskStore = require('../src/taskStore');
const governor = require('../src/resourceGovernor');

cleanState.applyCleanInit({ dataDir, confirmation: cleanState.APPLY_CONFIRMATION });

test.after(() => {
  governor.resetForTests();
  taskStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function create(itemId, config, extra = {}) {
  return taskCreator.createTargetGateTask({
    item: { itemId, factsFreshness: {}, basedataComplete: false },
    itemInfo: { itemId },
    targetGate: 'basedata',
    gateObjective: { kind: 'basedata_current' },
    source: 'auto',
    config,
    helixAdmission: { admissionGeneration: 1, sourceRevision: 'source-1' },
    ...extra,
  });
}

test('Task Creator enforces authoritative global Gate capacity and ignores caller task snapshots', () => {
  const config = { taskAdmission: { defaultMaxQueued: 2, maxQueuedByTargetGate: { basedata: 2 }, cooldownHoursByTargetGate: {}, automaticAttemptLimitsByTargetGate: {} } };
  assert.strictEqual(create('supply-1', config).allowed, true);
  assert.strictEqual(create('supply-2', config).allowed, true);
  const denied = create('supply-3', config, { tasks: [] });
  assert.strictEqual(denied.allowed, false);
  assert.strictEqual(denied.admission.reason, 'queue_limit');
  assert.strictEqual(taskStore.queryAutomationInvariantSnapshot().activeByTargetGate.basedata, 2);
});

test('Resource Governor returns the same waiter for the same work and resource', async () => {
  governor.configure({ resourceGovernor: { capacities: { 'local:ffmpeg': 1 } } });
  const active = await governor.acquire({ owner: 'kairox', workId: 'active', resourceKey: 'local:ffmpeg' });
  const first = governor.acquire({ owner: 'kairox', workId: 'same-task', resourceKey: 'local:ffmpeg' });
  const second = governor.acquire({ owner: 'kairox', workId: 'same-task', resourceKey: 'local:ffmpeg' });
  assert.strictEqual(first, second);
  assert.strictEqual(governor.snapshot().waitingWork.length, 1);
  active.release();
  const permit = await first;
  permit.release();
});

test('Task Creator creates only a target-gate Task and never asks Flow Planner to preselect a Flow', () => {
  const result = taskCreator.createTargetGateTask({
    item: {
      itemId: 'blocked-flow', codec: 'h264', bitrate: 0, metadataComplete: true,
      factsFreshness: { basedataFacts: { status: 'fresh' }, metadataFacts: { status: 'fresh' } },
      optimizeObjectiveStatus: 'ready',
      optimizeObjective: { kind: 'target_media_facts', targetMediaFacts: { targetCodec: 'vp9', targetBitrate: 4 } },
    },
    itemInfo: {
      itemId: 'blocked-flow', codec: 'h264', bitrate: 0, metadataComplete: true,
      factsFreshness: { basedataFacts: { status: 'fresh' }, metadataFacts: { status: 'fresh' } },
      optimizeObjectiveStatus: 'ready',
      optimizeObjective: { kind: 'target_media_facts', targetMediaFacts: { targetCodec: 'vp9', targetBitrate: 4 } },
    },
    targetGate: 'optimize',
    source: 'auto',
    config: { taskAdmission: { defaultMaxQueued: 10, maxQueuedByTargetGate: { optimize: 10 }, cooldownHoursByTargetGate: {}, automaticAttemptLimitsByTargetGate: {} } },
    allowedOptimizeFlowKinds: ['transcode', 'upgrade'],
    helixAdmission: { admissionGeneration: 1, sourceRevision: 'source-1' },
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.task.taskTarget.targetGate, 'optimize');
  assert.strictEqual(result.task.flowPlan, undefined);
  assert.strictEqual(result.task.taskBridge, undefined);
  const persisted = taskStore.getTask(result.task.id);
  assert.strictEqual(persisted.flowPlan, undefined);
  assert.strictEqual(persisted.taskBridge, undefined);
});

test('Task Store durably preserves the source access mapping revision fence', () => {
  const task = taskStore.createTask({
    itemId: 'mapping-revision-task',
    itemName: 'Mapping revision',
    source: 'auto',
    status: 'queued',
    taskTarget: { object: { type: 'media_item', itemId: 'mapping-revision-task' }, targetGate: 'basedata', gateObjective: {} },
    sourceAccessMappingRevision: 'mapping-revision-42',
    allowedOptimizeFlowKinds: ['transcode'],
  });
  assert.strictEqual(task.sourceAccessMappingRevision, 'mapping-revision-42');
  const persisted = taskStore.getTask(task.id);
  assert.strictEqual(persisted.sourceAccessMappingRevision, 'mapping-revision-42');
  assert.deepStrictEqual(persisted.allowedOptimizeFlowKinds, ['transcode']);
  const scheduled = taskStore.querySchedulerTasks().find((row) => row.id === task.id);
  assert.strictEqual(scheduled.sourceAccessMappingRevision, 'mapping-revision-42');
  assert.deepStrictEqual(scheduled.allowedOptimizeFlowKinds, ['transcode']);
  assert.strictEqual(scheduled.flowPlan, undefined);
});

test('Flow Planner is physically owned by Resource Runtime, not Creator, Store or Scheduler', () => {
  const root = path.join(__dirname, '..', 'src');
  for (const file of ['kairoxTaskCreator.js', 'taskStore.js', 'taskFactsModel.js', 'taskScheduler.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\/flowPlanner['"]\)|flowPlanner\.planFlow/);
  }
  const runtimeSource = fs.readFileSync(path.join(root, 'resourceRuntime.js'), 'utf8');
  assert.match(runtimeSource, /require\(['"]\.\/flowPlanner['"]\)/);
  assert.match(runtimeSource, /const task = ensureFlowPlan\(inputTask\)/);
});
