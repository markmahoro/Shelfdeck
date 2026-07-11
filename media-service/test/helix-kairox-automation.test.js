'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-kairox-automation-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const cleanState = require('../src/helixCleanState');
const configStore = require('../src/configStore');
const admissionStore = require('../src/kairoxAdmissionStore');
const kairoxStore = require('../src/kairoxStore');
const runner = require('../src/kairoxAutomationRunner');
const governor = require('../src/resourceGovernor');
const taskStore = require('../src/taskStore');

test.after(() => {
  runner.stop();
  governor.resetForTests();
  admissionStore.resetForTests();
  kairoxStore.resetForTests();
  taskStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Kairox Automation Runner creates only Lifecycle next-gate tasks for auto maintenance libraries', async () => {
  cleanState.applyCleanInit({ dataDir, confirmation: cleanState.APPLY_CONFIRMATION });
  const config = configStore.loadConfig();
  config.subLibraries = [{
    uuid: 'auto-maintenance', name: 'Auto', source: 'emby', embyServerId: 'server', sectionId: 'section',
    libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto', approvalPolicy: {},
  }];
  configStore.saveConfig(config);
  admissionStore.upsertAdmission({
    itemId: 'auto-item', admissionGeneration: 1, status: 'active', sourceRevision: 'source-1',
    sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'auto-maintenance', identityPayload: { serverId: 'server', embyItemId: 'emby-1' } },
  });
  kairoxStore.ensureMedia({ itemId: 'auto-item', mediaKind: 'movie', playable: true });
  const created = [];
  const reconciledRuns = [];
  const service = {
    reconcileObjectives(itemIds) {
      return Object.fromEntries(itemIds.map((itemId) => [itemId, { itemId, nextTargetGate: 'basedata', nextGateObjective: { kind: 'basedata_current' }, activeTasks: [], maintenanceComplete: false }]));
    },
    requestMaintenance(command) {
      created.push(command);
      const run = kairoxStore.getMaintenanceRun(command.itemId);
      if (run) kairoxStore.updateMaintenanceRun(run.runId, { status: 'task_active', currentTaskId: 'task-1' });
      return { allowed: true, task: { id: 'task-1' } };
    },
    reconcileMaintenanceRun(command) {
      reconciledRuns.push(command);
      const { itemId } = command;
      let run = kairoxStore.getMaintenanceRun(itemId);
      if (!run) run = kairoxStore.createMaintenanceRun({ itemId, admissionGeneration: 1, initiatedBy: 'system' }).run;
      return { run };
    },
  };
  governor.configure({ resourceGovernor: { capacities: { 'control:kairox': 1 } } });
  runner.start(service, { immediate: false });
  const result = await runner.runOnce({ limit: 100 });
  assert.strictEqual(result.created, 1);
  assert.strictEqual(created[0].targetGate, 'basedata');
  assert.ok(created[0].runId);
  assert.strictEqual(created[0].maintenanceProjection.itemId, 'auto-item');
  assert.strictEqual(reconciledRuns[0].maintenanceProjection.itemId, 'auto-item');
  assert.strictEqual(kairoxStore.getAutomationState('maintenance').lastError, '');
});

test('Kairox Automation Runner does not retry-storm a failed automatic target', async () => {
  runner.stop();
  admissionStore.upsertAdmission({
    itemId: 'blocked-item', admissionGeneration: 1, status: 'active', sourceRevision: 'source-1',
    sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'auto-maintenance' },
  });
  kairoxStore.ensureMedia({ itemId: 'blocked-item', mediaKind: 'movie', playable: true });
  kairoxStore.createMaintenanceRun({ itemId: 'blocked-item', admissionGeneration: 1, initiatedBy: 'system' });
  let requested = 0;
  const service = {
    reconcileObjectives(itemIds) {
      return Object.fromEntries(itemIds.map((itemId) => [itemId, itemId === 'blocked-item' ? {
        itemId, nextTargetGate: 'optimize', activeTasks: [], maintenanceComplete: false,
        automationBlocker: { code: 'previous_automatic_task_failed', taskId: 'failed-task' },
      } : { itemId, maintenanceComplete: true, activeTasks: [] }]));
    },
    requestMaintenance() { requested += 1; return { allowed: true, task: { id: 'unexpected' } }; },
    reconcileMaintenanceRun({ itemId }) { return { run: kairoxStore.getMaintenanceRun(itemId) }; },
  };
  runner.start(service, { immediate: false, intervalMs: 60000 });
  const result = await runner.runOnce({ limit: 100 });
  assert.strictEqual(result.created, 0);
  assert.strictEqual(requested, 0);
});

test('automatic failure lookup is fenced by admission generation and target gate', () => {
  const created = taskStore.createTask({
    itemId: 'failure-lookup-item', source: 'auto', status: 'failed_soft',
    taskTarget: { object: { type: 'media_item', itemId: 'failure-lookup-item' }, targetGate: 'optimize', gateObjective: {} },
    helixAdmission: { admissionGeneration: 1 },
    objectiveRevisionSnapshot: 'objective-1',
  });
  const failure = taskStore.queryLatestAutomaticFailures(['failure-lookup-item'])['failure-lookup-item'];
  assert.strictEqual(failure.taskId, created.id);
  assert.strictEqual(failure.targetGate, 'optimize');
  assert.strictEqual(failure.admissionGeneration, 1);
  assert.strictEqual(failure.objectiveHash, 'objective-1');
});

test('Kairox Runner stops offering ready Runs after the authoritative Gate budget is exhausted', async () => {
  runner.stop();
  const config = configStore.loadConfig();
  const basedataLimit = Number(config.taskAdmission && config.taskAdmission.maxQueuedByTargetGate && config.taskAdmission.maxQueuedByTargetGate.basedata) || 50;
  for (let index = 0; index < basedataLimit - 1; index += 1) {
    taskStore.createTask({
      itemId: `budget-existing-${index}`, status: 'queued', source: 'auto',
      taskTarget: { object: { type: 'media_item', itemId: `budget-existing-${index}` }, targetGate: 'basedata' },
    });
  }
  for (const itemId of ['budget-a', 'budget-b']) {
    admissionStore.upsertAdmission({ itemId, admissionGeneration: 1, status: 'active', sourceRevision: 'source-1' });
    kairoxStore.ensureMedia({ itemId, mediaKind: 'movie', playable: true });
    kairoxStore.createMaintenanceRun({ itemId, admissionGeneration: 1, initiatedBy: 'system' });
  }
  let requested = 0;
  const service = {
    reconcileObjectives(itemIds) {
      return Object.fromEntries(itemIds.map((itemId) => [itemId, {
        itemId, nextTargetGate: 'basedata', nextGateObjective: {}, activeTasks: [], maintenanceComplete: false,
      }]));
    },
    reconcileMaintenanceRun({ itemId }) { return { run: kairoxStore.getMaintenanceRun(itemId) }; },
    requestMaintenance(command) {
      requested += 1;
      taskStore.createTask({ itemId: command.itemId, status: 'queued', source: 'auto', taskTarget: { targetGate: 'basedata' } });
      return { allowed: true, task: { id: `task-${requested}` } };
    },
  };
  runner.start(service, { immediate: false, intervalMs: 60000 });
  await runner.runOnce({ limit: 100 });
  assert.strictEqual(requested, 1);
});

test('a saturated Gate cannot monopolize the bounded Runner supply window', async () => {
  runner.stop();
  const config = configStore.loadConfig();
  const optimizeLimit = Number(config.taskAdmission && config.taskAdmission.maxQueuedByTargetGate && config.taskAdmission.maxQueuedByTargetGate.optimize) || 50;
  for (let index = 0; index < optimizeLimit; index += 1) {
    taskStore.createTask({
      itemId: `saturated-task-${index}`, status: 'queued', source: 'auto',
      taskTarget: { object: { type: 'media_item', itemId: `saturated-task-${index}` }, targetGate: 'optimize' },
    });
  }
  for (let index = 0; index < 100; index += 1) {
    const itemId = `z-old-optimize-${String(index).padStart(3, '0')}`;
    admissionStore.upsertAdmission({ itemId, admissionGeneration: 1, status: 'active', sourceRevision: 'source-1' });
    kairoxStore.ensureMedia({ itemId, mediaKind: 'movie', playable: true });
    kairoxStore.createMaintenanceRun({
      itemId, admissionGeneration: 1, initiatedBy: 'system', requestedAt: '2026-01-01T00:00:00.000Z',
    });
  }
  admissionStore.upsertAdmission({ itemId: '000-metadata-ready', admissionGeneration: 1, status: 'active', sourceRevision: 'source-1' });
  kairoxStore.ensureMedia({ itemId: '000-metadata-ready', mediaKind: 'movie', playable: true });
  kairoxStore.createMaintenanceRun({
    itemId: '000-metadata-ready', admissionGeneration: 1, initiatedBy: 'user', requestedAt: '2026-07-11T00:00:00.000Z',
  });

  const requested = [];
  const service = {
    reconcileObjectives(itemIds) {
      return Object.fromEntries(itemIds.map((itemId) => [itemId, {
        itemId,
        nextTargetGate: itemId === '000-metadata-ready' ? 'metadata' : 'optimize',
        nextGateObjective: {},
        activeTasks: [],
        maintenanceComplete: false,
      }]));
    },
    reconcileMaintenanceRun({ itemId }) { return { run: kairoxStore.getMaintenanceRun(itemId) }; },
    requestMaintenance(command) {
      requested.push(command);
      return { allowed: true, task: { id: `created-${command.itemId}` } };
    },
  };
  runner.start(service, { immediate: false, intervalMs: 60000 });
  await runner.runOnce({ limit: 100 });

  assert.deepStrictEqual(requested.map((command) => command.itemId), ['000-metadata-ready']);
  assert.strictEqual(requested[0].targetGate, 'metadata');
});
