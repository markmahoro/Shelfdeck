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
  const created = [];
  const service = {
    reconcileObjectives(itemIds) {
      return Object.fromEntries(itemIds.map((itemId) => [itemId, { itemId, nextTargetGate: 'basedata', nextGateObjective: { kind: 'basedata_current' }, activeTasks: [], maintenanceComplete: false }]));
    },
    requestMaintenance(command) {
      created.push(command);
      return { allowed: true, task: { id: 'task-1' } };
    },
  };
  governor.configure({ resourceGovernor: { capacities: { 'control:kairox': 1 } } });
  runner.start(service, { immediate: false });
  const result = await runner.runOnce({ limit: 100 });
  assert.strictEqual(result.created, 1);
  assert.strictEqual(created[0].targetGate, 'basedata');
  assert.strictEqual(created[0].source, 'auto');
  assert.strictEqual(kairoxStore.getAutomationState('maintenance').lastError, '');
});

test('Kairox Automation Runner does not retry-storm a failed automatic target', async () => {
  runner.stop();
  admissionStore.upsertAdmission({
    itemId: 'blocked-item', admissionGeneration: 1, status: 'active', sourceRevision: 'source-1',
    sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'auto-maintenance' },
  });
  let requested = 0;
  const service = {
    reconcileObjectives(itemIds) {
      return Object.fromEntries(itemIds.map((itemId) => [itemId, itemId === 'blocked-item' ? {
        itemId, nextTargetGate: 'optimize', activeTasks: [], maintenanceComplete: false,
        automationBlocker: { code: 'previous_automatic_task_failed', taskId: 'failed-task' },
      } : { itemId, maintenanceComplete: true, activeTasks: [] }]));
    },
    requestMaintenance() { requested += 1; return { allowed: true, task: { id: 'unexpected' } }; },
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
    flowPlan: { flowKind: 'transcode', flowSelection: { objectiveHash: 'objective-1' }, steps: [] },
  });
  const failure = taskStore.queryLatestAutomaticFailures(['failure-lookup-item'])['failure-lookup-item'];
  assert.strictEqual(failure.taskId, created.id);
  assert.strictEqual(failure.targetGate, 'optimize');
  assert.strictEqual(failure.admissionGeneration, 1);
  assert.strictEqual(failure.objectiveHash, 'objective-1');
});
