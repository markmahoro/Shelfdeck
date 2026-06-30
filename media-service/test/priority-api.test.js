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
const mediaLibraryService = require('../src/mediaLibraryService');
const diagnosticLog = require('../src/diagnosticLog');

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-prio-'));
  // Point the data dir at our temp so taskStore/configStore use isolated files.
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  return dir;
}

function metadataReadyMovie(overrides = {}) {
  const itemId = overrides.itemId || 'movie-' + Math.random().toString(16).slice(2, 10);
  return {
    itemId,
    source: 'emby',
    sourceId: itemId,
    name: 'Metadata Ready Movie',
    type: 'movie',
    path: `/media/${itemId}.mkv`,
    size: 1024 * 1024 * 1024,
    duration: 3600,
    bitrate: 4_000_000,
    resolution: '1920x1080',
    codec: 'h264',
    watched: true,
    userRating: 4,
    tmdbId: '10001',
    action: 'transcode',
    ...overrides,
  };
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
    assert.strictEqual(body.priorityAdjustment.enabled, true);
    assert.strictEqual(body.priorityAdjustment.effect, 'override_queue_priority');
    assert.strictEqual(body.priorityAdjustment.requestedPriority, 5);
    assert.strictEqual(body.controlState.state, 'queued');
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
    assert.strictEqual(r1.json().error.code, 'VALIDATION_ERROR');
    assert.strictEqual(r1.json().validation.reason, 'non_negative_integer_required');
    assert.strictEqual(r1.json().priorityAdjustment.requestedPriority, -1);
    assert.strictEqual(r1.json().priorityAdjustment.enabled, true);
    const r2 = await app.inject({ method: 'PATCH', url: `/v1/admin/tasks/${created.id}`, payload: { priority: 1.5 } });
    assert.strictEqual(r2.statusCode, 400);
    assert.strictEqual(r2.json().priorityAdjustment.requestedPriority, 1.5);
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
    assert.strictEqual(res.json().error.code, 'TASK_PRIORITY_REJECTED');
    assert.strictEqual(res.json().error.message, 'status_not_priority_editable');
    assert.strictEqual(res.json().task.id, created.id);
    assert.strictEqual(res.json().controlState.state, 'running');
    assert.strictEqual(res.json().priorityAdjustment.enabled, false);
    assert.strictEqual(res.json().priorityAdjustment.requestedPriority, 1);
    assert.ok(res.json().priorityAdjustment.editableStatuses.includes('queued'));
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
    mediaLibraryService.saveLibrary({
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({ itemId: 'manual-1' })],
    });
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

test('taskScheduler clears resume state when a task reaches a closed status', () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');

  try {
    const doneTask = taskStoreMod.createTask({
      itemId: 'closed-done',
      itemName: 'Closed Done',
      actionType: 'delete',
      status: 'executing',
      phase: 'delete_executing',
      resumePoint: 'delete_executing',
    });
    taskStoreMod.updateTask(doneTask.id, {
      approval: { gateId: 'delete.beforeExecute', message: 'Delete?', options: ['approve'] },
    });
    scheduler.reportStatus(doneTask.id, 'done', 100);
    const afterDone = taskStoreMod.getTask(doneTask.id);
    assert.strictEqual(afterDone.status, 'done');
    assert.strictEqual(afterDone.resumePoint, null);
    assert.strictEqual(afterDone.approval, null);

    const failedTask = taskStoreMod.createTask({
      itemId: 'closed-failed',
      itemName: 'Closed Failed',
      actionType: 'scrape',
      status: 'executing',
      phase: 'scrape_executing',
      resumePoint: 'scrape_executing',
    });
    scheduler.reportStatus(failedTask.id, 'failed_hard', 0);
    const afterFailed = taskStoreMod.getTask(failedTask.id);
    assert.strictEqual(afterFailed.status, 'failed_hard');
    assert.strictEqual(afterFailed.resumePoint, 'scrape_executing');
  } finally {
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler records flow failure events and diagnostics when executor rejects', async () => {
  tmpDir();
  diagnosticLog.resetForTests();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');
  const transcodeFlow = require('../src/transcodeFlowExecutor');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.executionMode = 'auto';
  cfg.transcodeConcurrency = 1;
  configStoreMod.saveConfig(cfg);

  const task = taskStoreMod.createTask({
    itemId: 'flow-fail-item',
    itemName: 'Flow Fail Item',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    priority: 1,
    itemInfo: { path: '/media/flow-fail-item.mkv', subLibraryId: 'sub-flow-fail' },
  });

  const origDrive = transcodeFlow.driveTask;
  transcodeFlow.driveTask = async () => {
    throw new Error('encoder exploded in test');
  };

  try {
    await scheduler.scheduleRound();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const after = taskStoreMod.getTask(task.id);
    assert.strictEqual(after.status, 'failed_hard');

    const events = taskStoreMod.queryTaskEvents({ taskId: task.id }, { pageSize: 50 }).events;
    const failed = events.find((event) => event.eventType === 'flow.failed');
    assert.ok(failed, 'scheduler writes flow.failed event on executor rejection');
    assert.strictEqual(failed.eventStatus, 'failed_hard');
    assert.strictEqual(failed.resourceType, 'local_transcode');
    assert.strictEqual(failed.payload.reason, 'flow_executor_rejected');
    assert.strictEqual(failed.payload.errorMessage, 'encoder exploded in test');
    assert.strictEqual(failed.payload.operationKind, 'transcode');
    assert.strictEqual(failed.payload.effect, 'mark_failed_hard_after_flow_exception');

    const logs = diagnosticLog.list({ limit: 50 }).logs
      .filter((log) => log.scope === 'scheduler.flowDispatch' && log.payload && log.payload.taskId === task.id);
    assert.ok(logs.some((log) => log.status === 'failed' && log.operation === 'flow_executor_failed'));
    assert.ok(logs.some((log) => log.payload.errorMessage === 'encoder exploded in test'));
  } finally {
    transcodeFlow.driveTask = origDrive;
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});

test('taskScheduler capacity follows flow resource rather than legacy actionType', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  const configStoreMod = require('../src/configStore');
  const transcodeFlow = require('../src/transcodeFlowExecutor');
  const upgradeFlow = require('../src/upgradeFlowExecutor');

  const cfg = configStoreMod.getDefaultConfig();
  cfg.transcodeConcurrency = 2;
  cfg.upgradeConcurrency = 1;
  configStoreMod.saveConfig(cfg);

  const moviepilotPlan = {
    version: 'test',
    bridgeKind: 'optimize',
    direction: 'optimize.custom',
    operationKind: 'transcode',
    executor: 'transcodeFlowExecutor',
    primaryResourceType: 'moviepilot',
    actionType: 'transcode',
    source: 'manual',
    resourceTypes: ['moviepilot'],
    steps: [],
    plannedAt: new Date().toISOString(),
  };
  const plannedTranscode = taskStoreMod.createTask({
    itemId: 'planned-moviepilot-transcode',
    itemName: 'Planned MoviePilot Transcode',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    priority: 1,
    flowPlan: moviepilotPlan,
    taskBridge: { kind: 'optimize', actionType: 'transcode', source: 'manual' },
  });
  const upgrade = taskStoreMod.createTask({
    itemId: 'regular-upgrade',
    itemName: 'Regular Upgrade',
    actionType: 'upgrade',
    source: 'manual',
    status: 'queued',
    priority: 2,
  });

  const dispatched = [];
  const origTranscodeDrive = transcodeFlow.driveTask;
  const origUpgradeDrive = upgradeFlow.driveTask;
  transcodeFlow.driveTask = async (taskId) => {
    dispatched.push({ taskId, actionType: 'transcode' });
    scheduler.reportStatus(taskId, 'done', 100);
  };
  upgradeFlow.driveTask = async (taskId) => {
    dispatched.push({ taskId, actionType: 'upgrade' });
    scheduler.reportStatus(taskId, 'done', 100);
  };

  try {
    await scheduler.scheduleRound();
    assert.deepStrictEqual(dispatched.map((entry) => entry.taskId), [plannedTranscode.id]);
    assert.strictEqual(taskStoreMod.getTask(upgrade.id).status, 'queued');
    const dispatchEvent = taskStoreMod
      .queryTaskEvents({ taskId: plannedTranscode.id }, { pageSize: 20 })
      .events.find((event) => event.eventType === 'flow.dispatched');
    assert.ok(dispatchEvent);
    assert.strictEqual(dispatchEvent.resourceType, 'moviepilot');
    assert.strictEqual(dispatchEvent.payload.resourceKey, 'moviepilot');
  } finally {
    transcodeFlow.driveTask = origTranscodeDrive;
    upgradeFlow.driveTask = origUpgradeDrive;
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

test('taskScheduler restart recovery marks active runtime tasks with explanatory events', async () => {
  tmpDir();
  const scheduler = require('../src/taskScheduler');
  const taskStoreMod = require('../src/taskStore');
  diagnosticLog.resetForTests();

  const executing = taskStoreMod.createTask({
    itemId: 'restart-executing',
    itemName: 'Restart Executing',
    actionType: 'transcode',
    status: 'executing',
  });
  taskStoreMod.updateTask(executing.id, {
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    progress: 42,
  });
  const pausing = taskStoreMod.createTask({
    itemId: 'restart-pausing-requested',
    itemName: 'Restart Pausing Requested',
    actionType: 'upgrade',
    status: 'queued',
  });
  taskStoreMod.updateTask(pausing.id, {
    phase: 'upgrade_executing',
    resumePoint: 'upgrade_executing',
    pausingRequested: true,
  });

  try {
    scheduler.recoverInterruptedTasks();

    const executingAfter = taskStoreMod.getTask(executing.id);
    const pausingAfter = taskStoreMod.getTask(pausing.id);
    assert.strictEqual(executingAfter.status, 'interrupted');
    assert.strictEqual(pausingAfter.status, 'interrupted');

    const executingEvents = taskStoreMod.queryTaskEvents({ taskId: executing.id }, { pageSize: 50 }).events;
    const restartInterrupted = executingEvents.find((event) => event.eventType === 'task.restart_interrupted');
    assert.ok(restartInterrupted, 'restart recovery writes an explanatory interruption event');
    assert.strictEqual(restartInterrupted.payload.reason, 'service_restart_runtime_state_recovered');
    assert.strictEqual(restartInterrupted.payload.fromStatus, 'executing');
    assert.strictEqual(restartInterrupted.payload.fromPhase, 'transcode_executing');
    assert.strictEqual(restartInterrupted.payload.fromResumePoint, 'transcode_executing');
    assert.strictEqual(restartInterrupted.payload.effect, 'mark_interrupted_for_scheduler_recovery');

    const pausingEvents = taskStoreMod.queryTaskEvents({ taskId: pausing.id }, { pageSize: 50 }).events;
    const pausingRestart = pausingEvents.find((event) => event.eventType === 'task.restart_interrupted');
    assert.ok(pausingRestart);
    assert.strictEqual(pausingRestart.payload.pausingRequested, true);

    const logs = diagnosticLog.list({ limit: 50 }).logs
      .filter((log) => log.scope === 'scheduler.restartRecovery');
    assert.ok(logs.some((log) => log.operation === 'mark_interrupted' && log.payload.taskId === executing.id));
    assert.ok(logs.some((log) => log.operation === 'mark_interrupted' && log.payload.taskId === pausing.id));
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
  diagnosticLog.resetForTests();

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
    assert.strictEqual(recoveredAfter.retryCount, 1);
    const recoveredEvents = taskStoreMod.queryTaskEvents({ taskId: recovered.id }, { pageSize: 50 }).events;
    const restartQueued = recoveredEvents.find((event) => event.eventType === 'task.restart_recovery_queued');
    assert.ok(restartQueued, 'interrupted task recovery writes restart queue event');
    assert.strictEqual(restartQueued.payload.reason, 'restart_recovery_auto_queue');
    assert.strictEqual(restartQueued.payload.fromPhase, 'transcode_executing');
    assert.strictEqual(restartQueued.payload.fromResumePoint, 'transcode_executing');
    assert.strictEqual(restartQueued.payload.retryCount, 1);
    assert.ok(recoveredEvents.some((event) => event.eventType === 'task.retry_recorded'));
    const recoveryLogs = diagnosticLog.list({ limit: 50 }).logs
      .filter((log) => log.scope === 'scheduler.restartRecovery' && log.payload && log.payload.taskId === recovered.id);
    assert.ok(recoveryLogs.some((log) => log.operation === 'recover_interrupted_task' && log.status === 'done'));

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

test('taskScheduler dispatches automatic western pending scrape tasks before identity is known', async () => {
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
    scheduler.reportStatus(taskId, 'done', 100);
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
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(after.status, 'done');
    assert.strictEqual(after.skippedReason, undefined);
  } finally {
    scrapeFlow.driveTask = origDrive;
    mediaLibraryService.getLibraryItem = origGetLibraryItem;
    delete process.env.CONTROL_PLANE_DATA_DIR;
    delete process.env.MEDIA_SERVICE_DATA_DIR;
  }
});
