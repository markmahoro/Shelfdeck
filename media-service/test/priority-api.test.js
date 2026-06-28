'use strict';

// Integration tests for task queue priority:
//   - PATCH /v1/admin/tasks/:id priority adjustment (validation, state guard)
//   - POST /v1/tasks manual task gets additive priority
//   - taskScheduler dispatch order honors global priority

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildApp } = require('../src/app');
const taskStore = require('../src/taskStore');
const configStore = require('../src/configStore');

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-prio-'));
  // Point the data dir at our temp so taskStore/configStore use isolated files.
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  return dir;
}

test('PATCH /v1/admin/tasks/:id sets priority on a queued task', async () => {
  const dir = tmpDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  try {
    const created = taskStore.createTask({ itemId: 'i1', actionType: 'transcode', status: 'queued', priority: 100 });
    const res = await app.inject({
      method: 'PATCH', url: `/v1/admin/tasks/${created.id}`,
      payload: { priority: 5 },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.priority, 5);
    // Persisted
    const persisted = taskStore.getTask(created.id);
    assert.strictEqual(persisted.priority, 5);
    assert.strictEqual(persisted.priorityManuallyAdjusted, true);
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
    await app.close();
  }
});

test('PATCH /v1/admin/tasks/:id rejects negative / non-integer priority', async () => {
  const dir = tmpDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  try {
    const created = taskStore.createTask({ itemId: 'i2', actionType: 'transcode', status: 'queued' });
    const r1 = await app.inject({ method: 'PATCH', url: `/v1/admin/tasks/${created.id}`, payload: { priority: -1 } });
    assert.strictEqual(r1.statusCode, 400);
    const r2 = await app.inject({ method: 'PATCH', url: `/v1/admin/tasks/${created.id}`, payload: { priority: 1.5 } });
    assert.strictEqual(r2.statusCode, 400);
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
    await app.close();
  }
});

test('PATCH /v1/admin/tasks/:id refuses priority change on executing task (409)', async () => {
  const dir = tmpDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  try {
    const created = taskStore.createTask({ itemId: 'i3', actionType: 'transcode', status: 'executing', priority: 100 });
    const res = await app.inject({ method: 'PATCH', url: `/v1/admin/tasks/${created.id}`, payload: { priority: 1 } });
    assert.strictEqual(res.statusCode, 409);
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
    await app.close();
  }
});

test('POST /v1/tasks (manual) assigns additive priority from source, action, and library dimensions', async () => {
  const dir = tmpDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  try {
    // Seed config with a non-default manual base to prove the path is wired.
    configStore.saveConfig({ ...configStore.getDefaultConfig(), executionMode: 'auto' });
    const res = await app.inject({
      method: 'POST', url: '/v1/tasks',
      payload: { itemId: 'manual-1', actionType: 'transcode' },
    });
    assert.strictEqual(res.statusCode, 201);
    const body = res.json();
    assert.strictEqual(body.priority, 230, 'manual transcode should add manual source + transcode action + default library weights');
    assert.strictEqual(body.priorityModelVersion, 'additive-v3');
    assert.deepStrictEqual(body.priorityBreakdown.dimensions.map((d) => d.value), [0, 130, 100]);
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
    await app.close();
  }
});

test('taskScheduler dispatch order is priority-ascending then FIFO', async () => {
  // Drive the scheduler sort directly via the exported scheduleRound by
  // constructing tasks with mixed priorities and observing dispatch order.
  // We use the scheduler module but stub the flow executors so nothing runs.
  const dir = tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');

  configStoreMod.saveConfig({ ...configStoreMod.getDefaultConfig(), executionMode: 'auto' });

  // Three queued transcode tasks with different priorities and createdAt order.
  // Lower priority should dispatch first regardless of creation order.
  const tLow = taskStoreMod.createTask({ itemId: 'low', actionType: 'transcode', status: 'queued', priority: 5 });
  const tHigh = taskStoreMod.createTask({ itemId: 'high', actionType: 'transcode', status: 'queued', priority: 200 });
  const tMid = taskStoreMod.createTask({ itemId: 'mid', actionType: 'transcode', status: 'queued', priority: 50 });

  // Capture dispatch order by stubbing the flow executors to record itemId.
  const dispatched = [];
  const transcodeFlow = require('../src/transcodeFlowExecutor');
  const origSet = transcodeFlow.setScheduler;
  transcodeFlow.setScheduler(() => {});
  // Monkeypatch driveTask to record + immediately finish the task.
  const origDrive = transcodeFlow.driveTask;
  transcodeFlow.driveTask = async (taskId) => {
    const t = taskStoreMod.getTask(taskId);
    assert.strictEqual(t.status, 'executing', 'scheduler should mark the task executing before flow work starts');
    dispatched.push({ itemId: t.itemId, priority: t.priority });
    // Mark done so it releases the slot; do not run real encoding.
    taskStoreMod.updateTask(taskId, { status: 'done', phase: 'done' });
  };

  try {
    // transcodeConcurrency default = 1, so only the lowest-priority task should
    // dispatch in a single round.
    await scheduler.scheduleRound();
    assert.strictEqual(dispatched.length, 1, 'only one task fits the transcode slot per round');
    assert.strictEqual(dispatched[0].itemId, 'low', 'lowest priority value should dispatch first');
    assert.strictEqual(dispatched[0].priority, 5);
  } finally {
    transcodeFlow.driveTask = origDrive;
    transcodeFlow.setScheduler(origSet);
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler reconciles queued automatic task priorities with the current additive model', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.subLibraries = [{
    uuid: 'adult-lib',
    name: 'Adult',
    mediaType: 'adult',
    automationMode: 'manual',
    priorityWeight: 100,
  }];
  configStoreMod.saveConfig(cfg);

  const stale = taskStoreMod.createTask({
    itemId: 'auto-stale-priority',
    itemName: 'Auto Stale Priority',
    actionType: 'scrape',
    source: 'auto',
    status: 'pending_manual',
    priority: 80,
    itemInfo: { name: 'Auto Stale Priority', subLibraryId: 'adult-lib' },
  });
  const manualOverride = taskStoreMod.createTask({
    itemId: 'auto-manual-override',
    itemName: 'Auto Manual Override',
    actionType: 'scrape',
    source: 'auto',
    status: 'pending_manual',
    priority: 7,
    priorityManuallyAdjusted: true,
    itemInfo: { name: 'Auto Manual Override', subLibraryId: 'adult-lib' },
  });

  try {
    await scheduler.scheduleRound();
    const reconciled = taskStoreMod.getTask(stale.id);
    const preserved = taskStoreMod.getTask(manualOverride.id);
    assert.strictEqual(reconciled.priority, 260);
    assert.strictEqual(reconciled.priorityModelVersion, 'additive-v3');
    assert.deepStrictEqual(reconciled.priorityBreakdown.dimensions.map((d) => d.value), [100, 80, 100, -20]);
    assert.strictEqual(preserved.priority, 7);
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler clears stale runtime state for queued tasks without losing manual resumes', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.transcodeConcurrency = 1;
  configStoreMod.saveConfig(cfg);

  taskStoreMod.createTask({
    itemId: 'slot-blocker',
    itemName: 'Slot Blocker',
    actionType: 'transcode',
    status: 'executing',
  });
  const staleQueued = taskStoreMod.createTask({
    itemId: 'stale-queued',
    itemName: 'Stale Queued',
    actionType: 'transcode',
    source: 'auto',
    status: 'queued',
    itemInfo: { name: 'Stale Queued' },
  });
  taskStoreMod.updateTask(staleQueued.id, {
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    progress: 50,
  });
  const recovered = taskStoreMod.createTask({
    itemId: 'recovered-interrupted',
    itemName: 'Recovered Interrupted',
    actionType: 'transcode',
    source: 'auto',
    status: 'interrupted',
    itemInfo: { name: 'Recovered Interrupted' },
  });
  taskStoreMod.updateTask(recovered.id, {
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    progress: 33,
  });
  const manualResume = taskStoreMod.createTask({
    itemId: 'manual-resume',
    itemName: 'Manual Resume',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    manualExecuteRequested: true,
    itemInfo: { name: 'Manual Resume' },
  });
  taskStoreMod.updateTask(manualResume.id, {
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    progress: 66,
  });
  const staleManualFlag = taskStoreMod.createTask({
    itemId: 'stale-manual-flag',
    itemName: 'Stale Manual Flag',
    actionType: 'transcode',
    source: 'auto',
    status: 'queued',
    manualExecuteRequested: true,
    itemInfo: { name: 'Stale Manual Flag' },
  });
  taskStoreMod.updateTask(staleManualFlag.id, {
    phase: 'transcode_executing',
    resumePoint: null,
    progress: 22,
  });

  try {
    await scheduler.scheduleRound();
    const staleAfter = taskStoreMod.getTask(staleQueued.id);
    const recoveredAfter = taskStoreMod.getTask(recovered.id);
    const manualAfter = taskStoreMod.getTask(manualResume.id);
    const staleManualAfter = taskStoreMod.getTask(staleManualFlag.id);

    assert.strictEqual(staleAfter.status, 'queued');
    assert.strictEqual(staleAfter.phase, null);
    assert.strictEqual(staleAfter.resumePoint, null);
    assert.strictEqual(staleAfter.progress, 0);

    assert.strictEqual(recoveredAfter.status, 'queued');
    assert.strictEqual(recoveredAfter.phase, null);
    assert.strictEqual(recoveredAfter.resumePoint, null);
    assert.strictEqual(recoveredAfter.progress, 0);

    assert.strictEqual(manualAfter.status, 'queued');
    assert.strictEqual(manualAfter.phase, 'transcode_executing');
    assert.strictEqual(manualAfter.resumePoint, 'transcode_executing');
    assert.strictEqual(manualAfter.progress, 66);

    assert.strictEqual(staleManualAfter.status, 'queued');
    assert.strictEqual(staleManualAfter.phase, null);
    assert.strictEqual(staleManualAfter.resumePoint, null);
    assert.strictEqual(staleManualAfter.progress, 0);
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler caps service-local western adult AI scrape to one active task', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.scrapeConcurrency = 3;
  cfg.adultLibrary.western.enabled = true;
  cfg.adultLibrary.western.computeMode = 'local';
  cfg.adultLibrary.western.localConcurrency = 1;
  cfg.subLibraries = [{
    uuid: 'adult-western',
    name: 'US Adult',
    mediaType: 'adult',
    adultRegion: 'western_adult',
    scraperType: 'western_builtin',
    automationMode: 'auto',
  }];
  configStoreMod.saveConfig(cfg);

  for (let i = 0; i < 3; i++) {
    taskStoreMod.createTask({
      itemId: `western-${i}`,
      itemName: `Western ${i}`,
      actionType: 'scrape',
      status: 'queued',
      priority: 80,
      itemInfo: {
        name: `Western ${i}`,
        subLibraryId: 'adult-western',
        adultMetadata: { region: 'western_adult', scrapeStatus: 'pending' },
      },
    });
  }

  const dispatched = [];
  const origDrive = scrapeFlow.driveTask;
  scrapeFlow.driveTask = async (taskId) => {
    dispatched.push(taskId);
    scheduler.reportStatus(taskId, 'done');
  };

  try {
    await scheduler.scheduleRound();
    assert.strictEqual(dispatched.length, 1, 'only one service-local western AI scrape should start per round');
  } finally {
    scrapeFlow.driveTask = origDrive;
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler skips stale automatic scrape tasks when the live item now requires user action', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.scrapeConcurrency = 1;
  cfg.subLibraries = [{
    uuid: 'adult-western',
    name: 'US Adult',
    mediaType: 'adult',
    adultRegion: 'western_adult',
    automationMode: 'auto',
  }];
  configStoreMod.saveConfig(cfg);

  const task = taskStoreMod.createTask({
    itemId: 'western-failed-live',
    itemName: 'Western Failed Live',
    actionType: 'scrape',
    source: 'auto',
    status: 'queued',
    priority: 280,
    itemInfo: {
      name: 'Western Failed Live',
      subLibraryId: 'adult-western',
      adultMetadata: { region: 'western_adult', scrapeStatus: 'pending' },
    },
  });

  const dispatched = [];
  const origDrive = scrapeFlow.driveTask;
  const origGetLibraryItem = mediaLibraryService.getLibraryItem;
  scrapeFlow.driveTask = async (taskId) => {
    dispatched.push(taskId);
  };
  mediaLibraryService.getLibraryItem = (itemId) => {
    if (itemId !== 'western-failed-live') return null;
    return {
      itemId,
      scraped: false,
      adultMetadata: { scrapeStatus: 'failed', region: 'western_adult' },
    };
  };

  try {
    await scheduler.scheduleRound();
    const after = taskStoreMod.getTask(task.id);
    assert.strictEqual(dispatched.length, 0);
    assert.strictEqual(after.status, 'skipped');
    assert.strictEqual(after.skippedReason, 'scrape_status_failed');
  } finally {
    scrapeFlow.driveTask = origDrive;
    mediaLibraryService.getLibraryItem = origGetLibraryItem;
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler skips automatic western scrape tasks without identity signal', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.scrapeConcurrency = 1;
  cfg.subLibraries = [{
    uuid: 'adult-western',
    name: 'US Adult',
    mediaType: 'adult',
    adultRegion: 'western_adult',
    automationMode: 'auto',
  }];
  configStoreMod.saveConfig(cfg);

  const task = taskStoreMod.createTask({
    itemId: 'western-no-identity',
    itemName: 'UNK-999',
    actionType: 'scrape',
    source: 'auto',
    status: 'queued',
    priority: 280,
    itemInfo: {
      name: 'UNK-999',
      subLibraryId: 'adult-western',
      adultMetadata: { region: 'western_adult', scrapeStatus: 'pending' },
    },
  });

  const dispatched = [];
  const origDrive = scrapeFlow.driveTask;
  const origGetLibraryItem = mediaLibraryService.getLibraryItem;
  scrapeFlow.driveTask = async (taskId) => {
    dispatched.push(taskId);
  };
  mediaLibraryService.getLibraryItem = (itemId) => {
    if (itemId !== 'western-no-identity') return null;
    return {
      itemId,
      scraped: false,
      adultMetadata: {
        region: 'western_adult',
        scrapeStatus: 'pending',
        actors: [],
        faceClusters: [],
        unknownFaces: [],
      },
    };
  };

  try {
    await scheduler.scheduleRound();
    const after = taskStoreMod.getTask(task.id);
    assert.strictEqual(dispatched.length, 0);
    assert.strictEqual(after.status, 'skipped');
    assert.strictEqual(after.skippedReason, 'western_identity_missing');
  } finally {
    scrapeFlow.driveTask = origDrive;
    mediaLibraryService.getLibraryItem = origGetLibraryItem;
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});
