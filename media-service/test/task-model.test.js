'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const approvalPolicy = require('../src/approvalPolicy');
const configStore = require('../src/configStore');
const taskAdmission = require('../src/taskAdmission');
const smartTaskEngine = require('../src/smartTaskEngine');
const taskStore = require('../src/taskStore');

test('approvalPolicy default gate catalog is complete and normalized', () => {
  const expected = [
    'delete.beforeExecute',
    'transcode.dolbyVisionTonemap',
    'transcode.beforeReplace',
    'upgrade.candidateSelect',
    'upgrade.identityMismatch',
    'upgrade.beforeReplace',
    'scrape.beforeWriteMetadata',
    'scrape.beforeOrganize',
    'scrape.reviewResult',
  ];
  const actual = Object.keys(approvalPolicy.DEFAULT_APPROVAL_POLICY).sort();
  assert.deepStrictEqual(actual, [...expected].sort());
  for (const gateId of expected) {
    assert.ok(['auto', 'confirm', 'forceConfirm'].includes(approvalPolicy.DEFAULT_APPROVAL_POLICY[gateId]));
  }
});

test('approvalPolicy resolves global, sub-library, and task overrides', () => {
  const config = {
    approvalPolicy: { 'transcode.beforeReplace': 'confirm' },
    subLibraries: [{
      uuid: 'lib-a',
      approvalPolicy: { 'transcode.beforeReplace': 'auto' },
    }],
  };
  const itemInfo = { itemId: 'i1', subLibraryId: 'lib-a' };

  assert.strictEqual(
    approvalPolicy.resolveGate('transcode.beforeReplace', { itemInfo, config }),
    'auto',
  );
  assert.strictEqual(
    approvalPolicy.resolveGate('transcode.beforeReplace', {
      itemInfo,
      task: { approvalPolicy: { 'transcode.beforeReplace': 'confirm' } },
      config,
    }),
    'confirm',
  );
});

test('approvalPolicy forceConfirm cannot be lowered by overrides', () => {
  const config = {
    approvalPolicy: { 'upgrade.identityMismatch': 'auto' },
    subLibraries: [{ uuid: 'lib-a', approvalPolicy: { 'upgrade.identityMismatch': 'auto' } }],
  };
  const itemInfo = { itemId: 'i1', subLibraryId: 'lib-a' };
  assert.strictEqual(
    approvalPolicy.resolveGate('upgrade.identityMismatch', { itemInfo, config }),
    'forceConfirm',
  );
});

test('resolveSubLibSchedule treats automationMode as the canonical scheduling switch', () => {
  const config = {
    subLibraries: [{
      uuid: 'lib-a',
      automationMode: 'manual',
      scheduleMode: 'full_auto',
      autoCreate: true,
      autoExecute: true,
      approvalPolicy: { 'scrape.reviewResult': 'confirm' },
    }, {
      uuid: 'lib-b',
      automationMode: 'auto',
      scheduleMode: 'full_manual',
      autoCreate: false,
      autoExecute: false,
    }, {
      uuid: 'legacy-custom',
      scheduleMode: 'custom',
      autoCreate: true,
      autoExecute: false,
    }],
  };

  assert.deepStrictEqual(
    configStore.resolveSubLibSchedule({ subLibraryId: 'lib-a' }, config),
    {
      automationMode: 'manual',
      autoCreate: false,
      autoExecute: false,
      approvalPolicy: { 'scrape.reviewResult': 'confirm' },
    },
  );
  assert.deepStrictEqual(
    configStore.resolveSubLibSchedule({ subLibraryId: 'lib-b' }, config),
    {
      automationMode: 'auto',
      autoCreate: true,
      autoExecute: true,
      approvalPolicy: {},
    },
  );
  assert.deepStrictEqual(
    configStore.resolveSubLibSchedule({ subLibraryId: 'legacy-custom' }, config),
    {
      automationMode: 'manual',
      autoCreate: true,
      autoExecute: false,
      approvalPolicy: {},
    },
  );
});

test('taskAdmission rejects automatic tasks for manual sub-libraries', () => {
  const config = {
    subLibraries: [{ uuid: 'manual-lib', automationMode: 'manual' }],
  };
  const item = { itemId: 'i1', subLibraryId: 'manual-lib' };
  const auto = taskAdmission.canCreateTask({
    item,
    actionType: 'transcode',
    source: 'auto',
    config,
    tasks: [],
  });
  const manual = taskAdmission.canCreateTask({
    item,
    actionType: 'transcode',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'automation_manual');
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission applies cooldown and active task dedupe', () => {
  const config = {
    taskAdmission: { defaultCooldownHours: 48 },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const item = {
    itemId: 'i1',
    subLibraryId: 'lib-a',
    lastTaskDoneAt: new Date().toISOString(),
  };
  const cooled = taskAdmission.canCreateTask({
    item,
    actionType: 'upgrade',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(cooled.allowed, false);
  assert.strictEqual(cooled.reason, 'recent_task_cooldown');
  assert.ok(cooled.nextEligibleAt);

  const active = taskAdmission.canCreateTask({
    item: { itemId: 'i2', subLibraryId: 'lib-a' },
    actionType: 'scrape',
    source: 'auto',
    config,
    tasks: [{ id: 't1', itemId: 'i2', status: 'queued' }],
  });
  assert.strictEqual(active.allowed, false);
  assert.strictEqual(active.reason, 'active_task_exists');
});

test('taskAdmission blocks automatic re-transcode after successful transcode', () => {
  const config = {
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const item = {
    itemId: 'i1',
    subLibraryId: 'lib-a',
    path: '/media/movie.mkv',
    assetKey: 'asset-1',
  };
  const tasks = [{
    id: 'done-transcode',
    itemId: 'old-id',
    actionType: 'transcode',
    status: 'done',
    itemInfo: { subLibraryId: 'lib-a', path: '/media/movie.mkv', assetKey: 'asset-1' },
  }];
  const result = taskAdmission.canCreateTask({
    item,
    actionType: 'transcode',
    source: 'auto',
    config,
    tasks,
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'already_transcoded');
});

test('taskAdmission caps automatic queue by action type', () => {
  const config = {
    taskAdmission: {
      cooldownHoursByAction: { ingest: 6 },
      maxQueuedByAction: { ingest: 2 },
    },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const tasks = [
    { id: 't1', itemId: 'ingest:a', actionType: 'ingest', status: 'queued' },
    { id: 't2', itemId: 'ingest:b', actionType: 'ingest', status: 'pending_manual' },
    { id: 's1', itemId: 'item-c', actionType: 'scrape', status: 'queued' },
  ];
  const auto = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:c', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'auto',
    config,
    tasks,
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'queue_limit');
  assert.strictEqual(auto.limit, 2);

  const manual = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:c', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'manual',
    config,
    tasks,
  });
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission applies cooldown from terminal task history', () => {
  const config = {
    taskAdmission: {
      cooldownHoursByAction: { ingest: 6 },
      maxQueuedByAction: { ingest: 10 },
    },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const result = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:lib-a:file-a', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'auto',
    config,
    tasks: [{
      id: 'old-ingest',
      itemId: 'ingest:lib-a:file-a',
      actionType: 'ingest',
      status: 'failed_hard',
      updatedAt: new Date().toISOString(),
    }],
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'recent_task_cooldown');
});

test('smartTaskEngine stop cancels delayed startup scan', async () => {
  let getLibraryCalls = 0;
  smartTaskEngine.stop();
  smartTaskEngine.start(
    {
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 60,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          smartTaskEnabledActions: ['transcode', 'upgrade'],
          smartTaskLookbackDays: 30,
        };
      },
    },
    {
      getLibrary() {
        getLibraryCalls += 1;
        return { items: [] };
      },
    },
    { getTasks() { return []; } },
  );
  smartTaskEngine.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(getLibraryCalls, 0);
});

test('taskStore migrates JSON history to SQLite without feeding scheduler hot path', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-store-sqlite-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  try {
    const legacy = [
      { id: 'done-1', itemId: 'i1', itemName: 'Done', actionType: 'scrape', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
      { id: 'failed-1', itemId: 'i2', itemName: 'Failed', actionType: 'scrape', status: 'failed_hard', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z' },
      { id: 'queued-1', itemId: 'i3', itemName: 'Queued', actionType: 'ingest', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z' },
    ];
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(legacy, null, 2), 'utf8');

    const active = taskStore.loadTasks({ includeHistory: false });
    assert.deepStrictEqual(active.map((t) => t.id), ['queued-1']);
    assert.strictEqual(taskStore.getTasks().length, 3);
    assert.ok(fs.existsSync(path.join(dir, 'tasks.db')));
    assert.ok(fs.existsSync(path.join(dir, 'tasks.json.migrated')));
    assert.ok(fs.existsSync(path.join(dir, 'tasks.json')), 'legacy JSON is preserved as migration source record');

    taskStore.updateTask('queued-1', { status: 'done' });
    assert.strictEqual(taskStore.loadTasks({ includeHistory: false }).length, 0);
    assert.strictEqual(taskStore.getTask('queued-1').status, 'done');
    assert.strictEqual(taskStore.getTasks({ status: 'done' }).length, 2);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore exposes lightweight optimization task rows', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-store-opt-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const done = taskStore.createTask({
      itemId: 'item-opt',
      itemName: 'Optimized Movie',
      actionType: 'transcode',
      status: 'executing',
      itemInfo: {
        subLibraryId: 'sub-opt',
        path: '/media/movie.mkv',
        sourcePath: '/mapped/movie.mkv',
      },
      logs: Array.from({ length: 20 }, (_, i) => ({ ts: new Date().toISOString(), level: 'info', msg: `verbose log ${i}` })),
    });
    taskStore.updateTask(done.id, {
      status: 'done',
      verifyResult: { outputPath: '/transcode/movie.partial.mkv' },
    });
    taskStore.createTask({
      itemId: 'item-active',
      itemName: 'Active Movie',
      actionType: 'transcode',
      status: 'queued',
    });

    const rows = taskStore.queryOptimizationTaskIndexRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, done.id);
    assert.strictEqual(rows[0].itemInfo.subLibraryId, 'sub-opt');
    assert.strictEqual(rows[0].itemInfo.path, '/media/movie.mkv');
    assert.strictEqual(rows[0].verifyResult.outputPath, '/transcode/movie.partial.mkv');
    assert.strictEqual(rows[0].logs, undefined);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});
