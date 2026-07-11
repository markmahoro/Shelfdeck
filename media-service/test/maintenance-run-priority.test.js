'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-maintenance-run-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const cleanState = require('../src/helixCleanState');
const configStore = require('../src/configStore');
const admissionStore = require('../src/kairoxAdmissionStore');
const kairoxStore = require('../src/kairoxStore');
const taskStore = require('../src/taskStore');
const { createKairoxRuntime } = require('../src/kairoxRuntime');
const { _compareDispatchOrder } = require('../src/taskScheduler');

cleanState.applyCleanInit({ dataDir, confirmation: cleanState.APPLY_CONFIRMATION });
const config = configStore.loadConfig();
config.subLibraries = [
  { uuid: 'auto-library', libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto', priorityWeight: 100, ruleTemplateId: 'default' },
  { uuid: 'manual-library', libraryAutomationMode: 'auto', maintenanceAutomationMode: 'manual', priorityWeight: 100, ruleTemplateId: 'default' },
];
configStore.saveConfig(config);
const runtime = createKairoxRuntime();

function admit(subjectId, subLibraryId) {
  return runtime.reconcileMaintenance({
    subjectId,
    admissionGeneration: 1,
    sourceRevision: 'source-1',
    sourceAccessDescriptor: { subLibraryId, sourceType: 'emby' },
    maintenancePolicy: { maintenanceAutomationMode: subLibraryId === 'auto-library' ? 'auto' : 'manual', libraryPriority: 100 },
    maintenanceSubject: { mediaKind: 'movie', playable: true },
  });
}

test.after(() => {
  admissionStore.resetForTests();
  kairoxStore.resetForTests();
  taskStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('auto and manual modes are mutually exclusive Run start policies', () => {
  admit('auto-item', 'auto-library');
  admit('manual-item', 'manual-library');
  const automatic = runtime.reconcileMaintenanceRun({ subjectId: 'auto-item', config });
  const manual = runtime.reconcileMaintenanceRun({ subjectId: 'manual-item', config });
  assert.strictEqual(automatic.run.initiatedBy, 'system');
  assert.strictEqual(manual.run, null);
  assert.throws(
    () => runtime.startMaintenanceRun({ subjectId: 'auto-item', config }),
    (error) => error.code === 'KAIROX_MANUAL_START_NOT_ALLOWED',
  );
  const started = runtime.startMaintenanceRun({ subjectId: 'manual-item', config });
  assert.strictEqual(started.run.initiatedBy, 'user');
  assert.strictEqual(started.run.status, 'ready');
});

test('MediaItem priority is durable and is snapshotted into a Lifecycle-selected task', () => {
  const prioritized = runtime.setMaintenancePriority({ subjectId: 'manual-item', config, reason: 'test_expedite' });
  assert.strictEqual(prioritized.media.maintenancePriorityClass, 'expedited');
  assert.ok(prioritized.media.priorityRevision > 0);
  const projection = runtime.getMaintenanceProjection('manual-item');
  const created = runtime.requestMaintenance({
    subjectId: 'manual-item',
    runId: projection.run.runId,
    libraryGeneration: 1,
    targetGate: projection.nextTargetGate,
    gateObjective: projection.nextGateObjective,
    config,
  });
  assert.strictEqual(created.allowed, true);
  assert.strictEqual(created.task.maintenancePrioritySnapshot.class, 'expedited');
  assert.strictEqual(created.task.maintenanceRun.runId, projection.run.runId);
});

test('Runner supply and Scheduler dispatch use strict MediaItem priority first', () => {
  admit('normal-ready', 'auto-library');
  admit('expedited-ready', 'auto-library');
  runtime.reconcileMaintenanceRun({ subjectId: 'normal-ready', config });
  runtime.setMaintenancePriority({ subjectId: 'expedited-ready', config, reason: 'test_expedite' });
  runtime.reconcileMaintenanceRun({ subjectId: 'expedited-ready', config });
  const ready = kairoxStore.listMaintenanceRuns({ statuses: ['ready'], limit: 20 });
  assert.strictEqual(ready[0].subjectId, 'expedited-ready');

  const normal = { id: 'normal-task', priority: 0, createdAt: '2026-01-01T00:00:00.000Z', maintenancePrioritySnapshot: { class: 'normal' } };
  const expedited = { id: 'expedited-task', priority: 999, createdAt: '2026-01-02T00:00:00.000Z', maintenancePrioritySnapshot: { class: 'expedited' } };
  assert.ok(_compareDispatchOrder(expedited, normal) < 0);
});
