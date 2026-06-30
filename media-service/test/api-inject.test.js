'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildApp } = require('../src/app');
const taskStore = require('../src/taskStore');
const libraryStore = require('../src/libraryStore');
const mediaLibraryService = require('../src/mediaLibraryService');
const runtimeResourceTracker = require('../src/runtimeResourceTracker');
const diagnosticLog = require('../src/diagnosticLog');
const backgroundIoGuard = require('../src/backgroundIoGuard');
const activityLog = require('../src/activityLog');
const smartTaskEngine = require('../src/smartTaskEngine');
const nodeStore = require('../src/nodeStore');

function metadataReadyMovie(overrides = {}) {
  const itemId = overrides.itemId || 'movie-' + crypto.randomUUID().slice(0, 8);
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

function metadataReadyAdultItem(item, overrides = {}) {
  const base = item || {};
  return {
    ...base,
    source: base.source || 'adult_folder',
    mediaType: 'adult',
    scraped: true,
    size: base.size || 1024 * 1024,
    duration: base.duration || 1200,
    bitrate: base.bitrate || 3_000_000,
    resolution: base.resolution || '1920x1080',
    codec: base.codec || 'h264',
    adultMetadata: {
      ...((base && base.adultMetadata) || {}),
      region: 'japanese_jav',
      scrapeStatus: 'done',
      adultId: 'MVSD-175',
      title: base.name || 'MVSD-175',
    },
    ...overrides,
  };
}

// ── Health ────────────────────────────────────────────────────────────────────

test('GET /v1/health (no auth) returns v2 format', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/health' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(['green', 'yellow', 'red'].includes(body.status), 'status is green/yellow/red');
  assert.ok(body.timestamp, 'timestamp present');
  await app.close();
});

test('GET /v1/admin/health includes checks detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/health' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.status, 'status present');
  assert.ok(body.checks, 'checks present');
  assert.ok(body.checks.scheduler, 'scheduler check present');
  assert.ok(body.checks.smartTask, 'smartTask check present');
  assert.ok(body.checks.mediaLib, 'mediaLib check present');
  assert.ok(body.checks.douban, 'douban check present');
  assert.ok(body.checks.strategy, 'strategy check present');
  assert.ok(body.checks.emby, 'emby check present');
  assert.ok(body.checks.upgrade, 'upgrade check present');
  assert.ok(body.checks.transcode, 'transcode check present');
  await app.close();
});

test('media library health does not mark manual folder libraries stale', async () => {
  const mediaLibraryService = require('../src/mediaLibraryService');
  const now = new Date().toISOString();
  const health = mediaLibraryService.getHealth({
    defaultRefreshIntervalMinutes: 60,
    subLibraries: [
      {
        uuid: 'emby-fresh',
        name: '电影',
        enabled: true,
        source: 'emby',
        lastRefreshedAt: now,
      },
      {
        uuid: 'adult-folder-old',
        name: 'US',
        enabled: true,
        source: 'folder',
        mediaType: 'adult',
        lastRefreshedAt: '2020-01-01T00:00:00.000Z',
      },
    ],
  });

  assert.strictEqual(health.status, 'green');
  assert.deepStrictEqual(health.staleSubLibraries, []);
  assert.strictEqual(health.scheduledRefreshCount, 1);
  assert.strictEqual(health.manualFolderCount, 1);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

test('X-API-Key enforced when apiKey set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: 'test-secret-key' });
  let res = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(res.statusCode, 401);
  res = await app.inject({ method: 'GET', url: '/v1/config', headers: { 'x-api-key': 'test-secret-key' } });
  assert.strictEqual(res.statusCode, 200);
  await app.close();
});

// ── Config ────────────────────────────────────────────────────────────────────

test('GET /v1/config includes v2 schema fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(res.statusCode, 200);
  const cfg = res.json();
  assert.ok(Array.isArray(cfg.ruleTemplates), 'ruleTemplates is array');
  assert.ok(cfg.ruleTemplates.length > 0, 'at least one rule template');
  assert.strictEqual(cfg.ruleTemplates[0].id, 'default');
  assert.strictEqual(cfg.ruleTemplates[0].name, '默认策略（电影）');
  assert.ok(cfg.ruleTemplates.length >= 2, 'at least two rule templates (movie + TV)');
  assert.strictEqual(cfg.ruleTemplates[1].id, 'tv_default', 'second template is TV default');
  assert.strictEqual(cfg.ruleTemplates[1].name, '默认策略（剧集）');
  assert.ok(cfg.embyServers !== undefined, 'embyServers present');
  assert.ok(Array.isArray(cfg.subLibraries), 'subLibraries is array');
  assert.ok(Array.isArray(cfg.transcodeEncodingDevices), 'transcodeEncodingDevices is array');
  assert.strictEqual(typeof cfg.smartTaskInitialDelaySeconds, 'number');
  assert.strictEqual(typeof cfg.mediaLibraryStartupRefreshOnStartup, 'boolean');
  assert.strictEqual(typeof cfg.mediaLibraryStartupRefreshDelaySeconds, 'number');
  assert.strictEqual(typeof cfg.mediaLibrarySelfComputeOnStartup, 'boolean');
  await app.close();
});

test('PATCH /v1/config persists and reloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const patch = {
    deleteConcurrency: 5,
    smartTaskPollIntervalMinutes: 20,
  };
  const res = await app.inject({ method: 'PATCH', url: '/v1/config', payload: patch });
  assert.strictEqual(res.statusCode, 200);
  const updated = res.json();
  assert.strictEqual(updated.deleteConcurrency, 5);
  assert.strictEqual(updated.smartTaskPollIntervalMinutes, 20);
  const res2 = await app.inject({ method: 'GET', url: '/v1/config' });
  const reloaded = res2.json();
  assert.strictEqual(reloaded.deleteConcurrency, 5);
  await app.close();
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

test('POST /v1/tasks missing itemId -> 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { actionType: 'delete' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks missing actionType -> 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'abc' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks invalid actionType -> 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'abc', actionType: 'invalid' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks creates task and returns 201', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'test-item-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Task Create Movie',
      path: '/media/task-create-movie.mkv',
    })],
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'transcode' },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.id, 'task id present');
  assert.strictEqual(body.status, 'created');
  assert.strictEqual(body.actionType, 'transcode');
  assert.strictEqual(body.source, 'manual');
  assert.strictEqual(body.taskBridge.kind, 'optimize');
  assert.strictEqual(body.flowPlan.direction, 'optimize.transcode');
  assert.strictEqual(body.flowPlan.operationKind, 'transcode');
  assert.strictEqual(body.admission.allowed, true);
  assert.strictEqual(body.admission.operation, 'transcode');
  assert.strictEqual(body.admission.reason, 'allowed');
  assert.strictEqual(body.admission.bridgeKind, 'optimize');
  assert.strictEqual(body.admission.intentMode, 'action_type_compatibility');
  assert.strictEqual(body.admission.taskBridge.kind, 'optimize');
  assert.strictEqual(body.admission.flowPlan.operationKind, 'transcode');

  const detail = await app.inject({ method: 'GET', url: `/v1/tasks/${body.id}?includeEvents=1` });
  assert.strictEqual(detail.statusCode, 200);
  assert.strictEqual(detail.json().taskBridge.kind, 'optimize');
  assert.ok(detail.json().events.some((event) => event.eventType === 'flow.planned'));
  await app.close();
});

test('POST /v1/tasks accepts optimize bridge intent and resolves recommended operation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'intent-upgrade-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Intent Upgrade Movie',
      path: '/media/intent-upgrade.mkv',
      action: 'upgrade',
    })],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, bridgeKind: 'optimize' },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.strictEqual(body.actionType, 'upgrade');
  assert.strictEqual(body.taskBridge.kind, 'optimize');
  assert.strictEqual(body.flowPlan.operationKind, 'upgrade');
  assert.strictEqual(body.admission.allowed, true);
  assert.strictEqual(body.admission.operation, 'upgrade');
  assert.strictEqual(body.admission.bridgeKind, 'optimize');
  assert.strictEqual(body.admission.intentMode, 'bridge_intent');
  assert.deepStrictEqual(body.requestedIntent, {
    bridgeKind: 'optimize',
    preferredOperation: '',
    actionType: '',
  });
  await app.close();
});

test('POST /v1/tasks accepts optimize bridge intent with delete operation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'intent-delete-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Intent Delete Movie',
      path: '/media/intent-delete.mkv',
      action: 'keep',
    })],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, intent: { bridgeKind: 'optimize', preferredOperation: 'delete' } },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.strictEqual(body.actionType, 'delete');
  assert.strictEqual(body.taskBridge.kind, 'optimize');
  assert.strictEqual(body.flowPlan.direction, 'optimize.delete');
  assert.strictEqual(body.flowPlan.operationKind, 'delete');
  assert.strictEqual(body.admission.allowed, true);
  assert.strictEqual(body.admission.operation, 'delete');
  assert.strictEqual(body.admission.bridgeKind, 'optimize');
  assert.deepStrictEqual(body.requestedIntent, {
    bridgeKind: 'optimize',
    preferredOperation: 'delete',
    actionType: '',
  });
  await app.close();
});

test('POST /v1/tasks rejects ambiguous or mismatched bridge intents as validation errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'intent-keep-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Intent Keep Movie',
      path: '/media/intent-keep.mkv',
      action: 'keep',
    })],
  });

  const missingOperation = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, bridgeKind: 'optimize' },
  });
  assert.strictEqual(missingOperation.statusCode, 400);
  const missingBody = missingOperation.json();
  assert.strictEqual(missingBody.error.message, 'preferred_operation_required');
  assert.strictEqual(missingBody.admission.reason, 'preferred_operation_required');
  assert.deepStrictEqual(missingBody.admission.supportedOperations, ['transcode', 'upgrade', 'delete']);
  assert.ok(missingBody.businessFlowDecision.allowedOperations.some((op) => op.bridgeKind === 'optimize'));

  const mismatch = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, bridgeKind: 'archive', preferredOperation: 'delete' },
  });
  assert.strictEqual(mismatch.statusCode, 400);
  const mismatchBody = mismatch.json();
  assert.strictEqual(mismatchBody.error.message, 'preferred_operation_bridge_mismatch');
  assert.strictEqual(mismatchBody.admission.reason, 'preferred_operation_bridge_mismatch');
  assert.strictEqual(mismatchBody.admission.bridgeKind, 'archive');
  await app.close();
});

test('TaskAdmission rejects optimize/archive tasks when metadata is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'metadata-missing-item';
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [{
      itemId,
      source: 'emby',
      name: 'Incomplete Movie',
      type: 'movie',
    }],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'delete' },
  });
  assert.strictEqual(res.statusCode, 409);
  const body = res.json();
  assert.strictEqual(body.error.code, 'TASK_ADMISSION_REJECTED');
  assert.strictEqual(body.error.message, 'metadata_missing');
  assert.strictEqual(body.admission.operation, 'delete');
  assert.strictEqual(body.admission.reason, 'metadata_missing');
  assert.ok(Array.isArray(body.admission.metadataMissingReasons));
  assert.strictEqual(body.businessFlowDecision.blockedReasons.delete, 'metadata_missing');
  await app.close();
});

test('TaskAdmission accepts standard metadata repair scrape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  diagnosticLog.resetForTests();
  const itemId = 'standard-scrape-repair';
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Standard Scrape Repair',
      source: 'emby',
      tmdbId: '',
      doubanId: '',
    })],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'scrape' },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.strictEqual(body.actionType, 'scrape');
  assert.strictEqual(body.taskBridge.kind, 'metadata');
  assert.strictEqual(body.flowPlan.primaryResourceType, 'emby');
  assert.ok(body.flowPlan.resourceTypes.includes('emby'));
  const logs = diagnosticLog.list({ limit: 20 }).logs;
  assert.ok(!logs.some((entry) => entry.operation === 'reject_task' && entry.payload.itemId === itemId));
  await app.close();
});

test('GET /v1/library exposes v3 business flow decision for media rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'business-flow-row';
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Business Flow Row',
      source: 'emby',
      action: 'transcode',
    }), metadataReadyMovie({
      itemId: 'business-flow-keep',
      name: 'Business Flow Keep',
      source: 'emby',
      action: 'keep',
    })],
  });

  const res = await app.inject({ method: 'GET', url: '/v1/library?limit=20' });
  assert.strictEqual(res.statusCode, 200);
  const item = res.json().items.find((row) => row.itemId === itemId);
  assert.ok(item, 'media row present');
  assert.ok(item.businessFlowDecision, 'business decision present');
  assert.strictEqual(item.businessFlowDecision.lifecycleStage, 'metadata_ready');
  assert.strictEqual(item.businessFlowDecision.metadataStatus, 'complete');
  assert.strictEqual(item.businessFlowDecision.recommendedOperation, 'transcode');
  assert.ok(item.businessFlowDecision.allowedOperations.some((op) => op.operation === 'transcode' && op.bridgeKind === 'optimize'));
  assert.strictEqual(item.businessFlowDecision.blockedReasons.scrape, 'metadata_already_complete');
  const keepItem = res.json().items.find((row) => row.itemId === 'business-flow-keep');
  assert.ok(keepItem, 'keep media row present');
  assert.strictEqual(keepItem.businessFlowDecision.lifecycleStage, 'archived');
  assert.strictEqual(keepItem.businessFlowDecision.recommendedOperation, 'keep');
  assert.strictEqual(keepItem.businessFlowDecision.nextBridge, null);
  await app.close();
});

test('GET /v1/library explains active task as operation blocker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();
  const itemId = 'business-flow-active';
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Business Flow Active',
      action: 'upgrade',
    })],
  });
  const task = taskStore.createTask({
    itemId,
    itemName: 'Business Flow Active',
    actionType: 'upgrade',
    status: 'queued',
  });

  const originalLoadTasks = taskStore.loadTasks;
  taskStore.loadTasks = () => {
    throw new Error('library business decision should use lightweight active summaries');
  };
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/library?limit=20' });
    assert.strictEqual(res.statusCode, 200);
    const item = res.json().items.find((row) => row.itemId === itemId);
    assert.ok(item, 'media row present');
    assert.deepStrictEqual(item.businessFlowDecision.allowedOperations, []);
    assert.strictEqual(item.businessFlowDecision.blockedReasons.upgrade, 'active_task_exists');
    assert.strictEqual(item.businessFlowDecision.activeTaskBridge, 'optimize');
    assert.strictEqual(item.businessFlowDecision.activeFlowOperation, 'upgrade');
    assert.strictEqual(item.businessFlowDecision.latestEventSummary.taskId, task.id);

    const detail = await app.inject({ method: 'GET', url: `/v1/library/items/${itemId}` });
    assert.strictEqual(detail.statusCode, 200);
    assert.strictEqual(detail.json().businessFlowDecision.latestEventSummary.taskId, task.id);
  } finally {
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('GET /v1/library exposes latest terminal failure summary for media rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();
  const itemId = 'business-flow-failed';
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId,
      name: 'Business Flow Failed',
      action: 'transcode',
    })],
  });
  const failed = taskStore.createTask({
    itemId,
    itemName: 'Business Flow Failed',
    actionType: 'transcode',
    status: 'queued',
  });
  taskStore.updateTask(failed.id, {
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    logs: [{ ts: '2026-06-30T00:00:00.000Z', level: 'error', msg: 'Encoder failed before replace' }],
  });
  taskStore.updateTask(failed.id, { status: 'failed_hard' });

  const originalLoadTasks = taskStore.loadTasks;
  taskStore.loadTasks = () => {
    throw new Error('library failure summary should use task event projection');
  };
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/library?limit=20' });
    assert.strictEqual(res.statusCode, 200);
    const item = res.json().items.find((row) => row.itemId === itemId);
    assert.ok(item, 'media row present');
    assert.strictEqual(item.businessFlowDecision.latestEventSummary.kind, 'failure_event');
    assert.strictEqual(item.businessFlowDecision.latestEventSummary.taskId, failed.id);
    assert.strictEqual(item.businessFlowDecision.latestEventSummary.eventType, 'task.failed');
    assert.strictEqual(item.businessFlowDecision.latestEventSummary.failureSummary.message, 'Encoder failed before replace');
    assert.strictEqual(item.businessFlowDecision.diagnosticSummary.latestFailure.message, 'Encoder failed before replace');

    const detail = await app.inject({ method: 'GET', url: `/v1/library/items/${itemId}` });
    assert.strictEqual(detail.statusCode, 200);
    assert.strictEqual(detail.json().businessFlowDecision.latestEventSummary.kind, 'failure_event');
    assert.strictEqual(detail.json().businessFlowDecision.latestEventSummary.failureSummary.source, 'task_log');
  } finally {
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('manual delete task is planned as optimize bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'optimize-delete-item';
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({ itemId, name: 'Delete Candidate' })],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'delete' },
  });
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.json().taskBridge.kind, 'optimize');
  assert.strictEqual(res.json().flowPlan.direction, 'optimize.delete');
  assert.strictEqual(res.json().flowPlan.operationKind, 'delete');
  await app.close();
});

test('GET task events and admin resource view expose v2.5 projections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();
  runtimeResourceTracker.resetForTests();
  diagnosticLog.resetForTests();
  backgroundIoGuard.resetForTests();

  const task = taskStore.createTask({
    itemId: 'resource-item',
    itemName: 'Resource Item',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    itemInfo: { subLibraryId: 'movie-lib', path: '/media/resource-item.mkv' },
  });
  taskStore.updateTask(task.id, { status: 'executing', phase: 'transcode_executing' });
  const failedTask = taskStore.createTask({
    itemId: 'resource-failed',
    itemName: 'Resource Failed',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    itemInfo: { subLibraryId: 'movie-lib', path: '/media/resource-failed.mkv' },
  });
  taskStore.updateTask(failedTask.id, {
    status: 'failed_hard',
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    retryCount: 1,
    logs: [{ ts: '2026-06-30T00:00:00.000Z', level: 'error', msg: 'Encoder exited with code 1' }],
  });
  diagnosticLog.record({
    category: 'flow',
    scope: 'transcode.execute',
    operation: 'encode',
    component: 'transcodeFlow',
    resourceType: 'local_transcode',
    resourceKey: 'local:ffmpeg',
    status: 'failed',
    payload: {
      taskId: failedTask.id,
      itemId: failedTask.itemId,
      error: 'encoder exited',
    },
  });

  let res = await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}/events` });
  assert.strictEqual(res.statusCode, 200);
  const events = res.json();
  assert.ok(events.events.some((event) => event.eventType === 'task.created'));
  assert.ok(events.events.some((event) => event.eventType === 'flow.planned'));
  assert.ok(events.events.some((event) => event.eventType === 'task.status_changed'));

  runtimeResourceTracker.startEvent({
    eventType: 'library.query',
    component: 'test',
    resourceType: 'service_api',
    resourceKey: 'service:library.query',
    resourceLabel: 'Library query',
    payload: { route: '/v1/library' },
  });
  const guardHandle = backgroundIoGuard.tryStart({
    operation: 'test.background.write',
    component: 'test',
    lockKey: 'library_background_io',
    resourceKey: 'test:background-write',
  });

  res = await app.inject({ method: 'GET', url: '/v1/admin/resources' });
  assert.strictEqual(res.statusCode, 200);
  const resources = res.json();
  assert.strictEqual(resources.summary.totalTasks, 1);
  assert.strictEqual(resources.summary.totalEvents, 1);
  assert.strictEqual(resources.summary.runningEvents, 1);
  assert.strictEqual(resources.summary.byResourceType.local_transcode, 1);
  assert.strictEqual(resources.summary.byResourceType.service_api, 1);
  const transcodeBucket = resources.resources.find((bucket) => bucket.resourceKey === 'local:ffmpeg');
  assert.ok(transcodeBucket, 'local transcode bucket exists');
  assert.strictEqual(transcodeBucket.tasks[0].taskId, task.id);
  assert.strictEqual(transcodeBucket.tasks[0].resourceState, 'running');
  const queryBucket = resources.resources.find((bucket) => bucket.resourceKey === 'service:library.query');
  assert.ok(queryBucket, 'library query bucket exists');
  assert.strictEqual(queryBucket.events[0].eventType, 'library.query');
  assert.strictEqual(queryBucket.events[0].eventStatus, 'running');
  assert.ok(resources.diagnostics, 'diagnostics present');
  assert.ok(resources.diagnostics.logs.some((log) => log.scope === 'resourceProjection.buildResourceView'));
  assert.ok(resources.diagnostics.metrics.storage.some((metric) => metric.store === 'library'));
  assert.ok(resources.diagnostics.metrics.storage.some((metric) => metric.store === 'tasks'));
  assert.ok(resources.diagnostics.backgroundIo, 'background I/O diagnostics present');
  assert.strictEqual(resources.diagnostics.backgroundIo.summary.activeCount, 1);
  assert.strictEqual(resources.diagnostics.backgroundIo.active[0].operation, 'test.background.write');
  const failedEvent = resources.diagnostics.failedEvents.find((event) => event.taskId === failedTask.id);
  assert.ok(failedEvent, 'failed task event appears in resource diagnostics');
  assert.strictEqual(failedEvent.task.id, failedTask.id);
  assert.strictEqual(failedEvent.task.status, 'failed_hard');
  assert.strictEqual(failedEvent.recovery.state, 'retry_available');
  assert.strictEqual(failedEvent.recovery.resumePoint, 'transcode_executing');
  assert.strictEqual(failedEvent.controlState.actions.retry.enabled, true);
  assert.strictEqual(failedEvent.controlState.actions.retry.effect, 'queue_failed_task_from_resume_point');
  assert.strictEqual(failedEvent.resourceContext.resourceKey, 'local:ffmpeg');
  assert.strictEqual(failedEvent.diagnosticSummary.scope, 'transcode.execute');
  assert.strictEqual(failedEvent.diagnosticSummary.error, 'encoder exited');
  assert.strictEqual(failedEvent.failureSummary.message, 'Encoder exited with code 1');
  assert.strictEqual(failedEvent.failureSummary.level, 'error');
  assert.strictEqual(failedEvent.failureSummary.source, 'task_log');
  guardHandle.finish('done');

  await app.close();
});

test('DELETE /v1/admin/nodes/:id explains active worker job conflicts from task summaries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();

  const node = nodeStore.addNode({
    name: 'GPU Node',
    address: '127.0.0.1:19000',
    apiKey: 'node-key',
    capabilities: { devices: [] },
  });
  const task = taskStore.createTask({
    itemId: 'node-active-item',
    itemName: 'Node Active Item',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    itemInfo: { path: '/media/node-active-item.mkv' },
  });
  taskStore.updateTask(task.id, {
    status: 'executing',
    phase: 'transcode_executing',
    nodeId: node.id,
  });

  const originalLoadTasks = taskStore.loadTasks;
  taskStore.loadTasks = () => {
    throw new Error('DELETE node conflict must not load full task history');
  };
  try {
    const res = await app.inject({ method: 'DELETE', url: `/v1/admin/nodes/${node.id}` });
    assert.strictEqual(res.statusCode, 409);
    const body = res.json();
    assert.strictEqual(body.error.code, 'NODE_HAS_ACTIVE_JOBS');
    assert.strictEqual(body.error.message, 'node_has_active_jobs');
    assert.strictEqual(body.node.id, node.id);
    assert.strictEqual(body.node.name, 'GPU Node');
    assert.strictEqual(body.resourceContext.resourceType, 'worker_node');
    assert.strictEqual(body.resourceContext.resourceKey, `node:${node.id}`);
    assert.strictEqual(body.activeJobCount, 1);
    assert.strictEqual(body.activeTasks.length, 1);
    assert.strictEqual(body.activeTasks[0].id, task.id);
    assert.strictEqual(body.activeTasks[0].nodeId, node.id);
    assert.strictEqual(body.activeTasks[0].flowPlan.operationKind, 'transcode');
    assert.strictEqual(body.activeTasks[0].controlState.state, 'running');
    assert.strictEqual(body.forceDelete.available, true);
    assert.strictEqual(body.forceDelete.effect, 'mark_active_tasks_failed_hard_then_delete_node');

    const force = await app.inject({ method: 'DELETE', url: `/v1/admin/nodes/${node.id}?force=true` });
    assert.strictEqual(force.statusCode, 200);
    assert.strictEqual(force.json().ok, true);
    assert.strictEqual(force.json().node.id, node.id);
    assert.strictEqual(force.json().resourceContext.resourceKey, `node:${node.id}`);
    assert.strictEqual(force.json().forceDelete.applied, true);
    assert.strictEqual(force.json().forceDelete.effect, 'marked_active_tasks_failed_hard_then_deleted_node');
    assert.deepStrictEqual(force.json().forceDelete.affectedTaskIds, [task.id]);
    assert.strictEqual(nodeStore.getNode(node.id), null);
    assert.strictEqual(taskStore.getTask(task.id).status, 'failed_hard');
  } finally {
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('task event journal records retry, interruption, and failure semantics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();

  const task = taskStore.createTask({
    itemId: 'event-failure-item',
    itemName: 'Event Failure Item',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
    itemInfo: { itemId: 'event-failure-item', name: 'Event Failure Item' },
  });
  taskStore.updateTask(task.id, { status: 'executing' });
  taskStore.updateTask(task.id, { status: 'interrupted' });
  taskStore.updateTask(task.id, { status: 'queued', retryCount: 1 });
  taskStore.updateTask(task.id, { status: 'failed_hard' });

  const eventTypes = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 50 }).events.map((event) => event.eventType);
  assert.ok(eventTypes.includes('task.interrupted'));
  assert.ok(eventTypes.includes('task.retry_recorded'));
  assert.ok(eventTypes.includes('task.failed'));
  await app.close();
});

test('GET /v1/library records a runtime library.query event for resource attribution', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();
  runtimeResourceTracker.resetForTests();
  diagnosticLog.resetForTests();

  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({ itemId: 'runtime-library-query' })],
  });

  let res = await app.inject({ method: 'GET', url: '/v1/library?limit=1' });
  assert.strictEqual(res.statusCode, 200);

  res = await app.inject({ method: 'GET', url: '/v1/admin/resources' });
  assert.strictEqual(res.statusCode, 200);
  const view = res.json();
  assert.strictEqual(view.summary.totalEvents, 1);
  const bucket = view.resources.find((entry) => entry.resourceKey === 'service:library.query');
  assert.ok(bucket, 'library query resource bucket exists');
  assert.strictEqual(bucket.events[0].eventType, 'library.query');
  assert.strictEqual(bucket.events[0].eventStatus, 'done');
  assert.strictEqual(bucket.events[0].payload.itemCount, 1);
  assert.strictEqual(bucket.events[0].payload.total, 1);
  assert.ok(view.diagnostics.logs.some((log) => log.scope === 'libraryStore.queryItems'), 'library store query diagnostic exists');
  const libraryMetric = view.diagnostics.metrics.storage.find((metric) => metric.store === 'library');
  assert.ok(libraryMetric, 'library storage metric exists');
  assert.ok(libraryMetric.files.some((file) => file.name === 'library.db-wal'), 'library WAL metric exists');

  await app.close();
});

test('POST /v1/tasks follows sub-library automation mode for initial status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const configStore = require('../src/configStore');
  const mediaLibraryService = require('../src/mediaLibraryService');

  configStore.patchConfig({
    executionMode: 'manual',
    subLibraries: [
      { uuid: 'auto-lib', name: 'Auto Lib', automationMode: 'auto', scheduleMode: 'full_auto' },
      { uuid: 'manual-lib', name: 'Manual Lib', automationMode: 'manual', scheduleMode: 'full_manual' },
    ],
  });
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [
      metadataReadyMovie({ itemId: 'auto-lib-item', name: 'Auto Item', subLibraryId: 'auto-lib' }),
      metadataReadyMovie({ itemId: 'manual-lib-item', name: 'Manual Item', subLibraryId: 'manual-lib' }),
    ],
  });

  const autoRes = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'auto-lib-item', actionType: 'transcode' },
  });
  assert.strictEqual(autoRes.statusCode, 201);
  assert.strictEqual(autoRes.json().status, 'created');

  const manualRes = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'manual-lib-item', actionType: 'transcode' },
  });
  assert.strictEqual(manualRes.statusCode, 201);
  assert.strictEqual(manualRes.json().status, 'pending_manual');
  await app.close();
});

test('POST /v1/tasks manual admission does not load full task history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();
  const originalGetTasks = taskStore.getTasks;
  const originalLoadTasks = taskStore.loadTasks;
  const unrelated = taskStore.createTask({
    itemId: 'manual-fast-path-other',
    itemName: 'Other Active Item',
    actionType: 'transcode',
    source: 'manual',
    status: 'queued',
  });
  taskStore.getTasks = () => {
    throw new Error('full history should not be loaded for manual admission');
  };
  taskStore.loadTasks = () => {
    throw new Error('full active task list should not be loaded for manual admission');
  };
  try {
    mediaLibraryService.saveLibrary({
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({ itemId: 'manual-fast-path' })],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: { itemId: 'manual-fast-path', actionType: 'transcode' },
    });
    assert.strictEqual(res.statusCode, 201);
    assert.ok(res.json().id);
    assert.notStrictEqual(res.json().id, unrelated.id);
  } finally {
    taskStore.getTasks = originalGetTasks;
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('GET /v1/tasks lists created tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i1', actionType: 'scrape' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i2', actionType: 'scrape' } });
  const res = await app.inject({ method: 'GET', url: '/v1/tasks' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.tasks), 'returns tasks array');
  assert.ok(body.tasks.length >= 2);
  await app.close();
});

test('GET /v1/tasks defaults to active tasks and includeHistory returns completed history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const done = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-done', actionType: 'scrape' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-active', actionType: 'scrape' } });
  taskStore.updateTask(done.json().id, { status: 'done' });

  const originalLoadTasks = taskStore.loadTasks;
  taskStore.loadTasks = () => {
    throw new Error('active task list should use lightweight summaries');
  };
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/tasks' });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.deepStrictEqual(body.tasks.map((t) => t.itemId), ['i-active']);
    assert.strictEqual(body.tasks[0].controlState.state, 'ready_to_start');
    assert.strictEqual(body.tasks[0].logs, undefined);

    const activeByOperation = await app.inject({ method: 'GET', url: '/v1/tasks?operationKind=scrape&activeOnly=1' });
    assert.strictEqual(activeByOperation.statusCode, 200);
    assert.deepStrictEqual(activeByOperation.json().tasks.map((t) => t.itemId), ['i-active']);

    const historyRes = await app.inject({ method: 'GET', url: '/v1/tasks?includeHistory=1' });
    assert.strictEqual(historyRes.statusCode, 200);
    const historyIds = historyRes.json().tasks.map((t) => t.itemId).sort();
    assert.deepStrictEqual(historyIds, ['i-active', 'i-done']);
  } finally {
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('GET /v1/tasks/:id returns task detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-detail', actionType: 'scrape' } });
  const { id } = create.json();
  const res = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(res.statusCode, 200);
  const task = res.json();
  assert.strictEqual(task.id, id);
  assert.strictEqual(task.source, 'manual');
  assert.ok(task.logs, 'logs field present');
  await app.close();
});

test('GET /v1/tasks/:id/report returns scrape details', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  const task = taskStore.createTask({
    itemId: 'scrape-report-item',
    itemName: 'SORA-107',
    actionType: 'scrape',
    status: 'done',
    itemInfo: {
      source: 'adult_folder',
      subLibraryId: 'adult-report-lib',
      name: 'SORA-107 Some Title',
      path: '/adult_media/JAV/SORA-107 Some Title/SORA-107.mp4',
      adultMetadata: {
        adultId: 'SORA-107',
        title: 'SORA-107 Some Title',
        source: 'javbus',
        sourceUrl: 'https://www.javbus.com/SORA-107',
        scrapeStatus: 'done',
        posterPath: '/adult_media/JAV/SORA-107 Some Title/poster.jpg',
        fanartPath: '/adult_media/JAV/SORA-107 Some Title/poster.jpg',
        nfoPath: '/adult_media/JAV/SORA-107 Some Title/movie.nfo',
        fileNfoPath: '/adult_media/JAV/SORA-107 Some Title/SORA-107.nfo',
        markerPath: '/adult_media/JAV/SORA-107 Some Title/.shelfdeck.json',
        organized: true,
        originalFolder: '/adult_media/JAV/SORA-107.HD',
        faceClusters: [{
          clusterId: 'face-1',
          matchedName: 'Actor A',
          embedding: [0.1, 0.2, 0.3],
          sampleImageBase64: Buffer.from('face-sample').toString('base64'),
        }],
        unknownFaces: [{
          clusterId: 'unknown-1',
          embedding: [0.4, 0.5, 0.6],
          sampleImageBase64: Buffer.from('unknown-face').toString('base64'),
        }],
      },
    },
    logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Scrape metadata saved; strategy recalculated' }],
  });

  const res = await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}/report` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.actionType, 'scrape');
  assert.strictEqual(body.scrape.adultId, 'SORA-107');
  assert.strictEqual(body.scrape.source, 'javbus');
  assert.strictEqual(body.scrape.organized, true);
  assert.strictEqual(body.scrape.faceClusters[0].clusterId, 'face-1');
  assert.strictEqual(body.scrape.faceClusters[0].embedding, undefined);
  assert.ok(body.scrape.faceClusters[0].sampleImageBase64, 'report keeps face thumbnail for UI actions');
  assert.strictEqual(body.scrape.unknownFaces[0].embedding, undefined);
  assert.strictEqual(body.assets.poster, true);
  assert.strictEqual(body.assets.nfo, true);
  assert.strictEqual(body.scrapeVerification.ok, false);
  assert.strictEqual(body.scrapeVerification.source, 'current_filesystem');
  assert.ok(body.scrapeVerification.failures.some((f) => f.code === 'media.exists'));
  assert.ok(body.scrapeVerification.warnings.some((w) => w.code === 'snapshot.missing'));
  await app.close();
});

test('DELETE /v1/tasks/:id removes task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-del', actionType: 'scrape' } });
  const { id } = create.json();
  const res = await app.inject({ method: 'DELETE', url: `/v1/tasks/${id}` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.ok, true);
  // Verify gone
  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.statusCode, 404);
  await app.close();
});

test('delete task removes an adult folder media directory and library item', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    approvalPolicy: { 'delete.beforeExecute': 'auto' },
  }, null, 2));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const createLib = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Delete Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = createLib.json();
  const movieDir = path.join(watchRoot, 'MVSD-175 Delete Me');
  fs.mkdirSync(movieDir, { recursive: true });
  const filePath = path.join(movieDir, 'MVSD-175.mp4');
  fs.writeFileSync(filePath, 'delete-me');
  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath);
  mediaLibraryService.updateLibraryItems([metadataReadyAdultItem(item, {
    name: item.name || 'MVSD-175 Delete Me',
    path: filePath,
    size: Buffer.byteLength('delete-me'),
  })]);

  const createTask = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: item.itemId, actionType: 'delete' } });
  assert.strictEqual(createTask.statusCode, 201);

  const taskStore = require('../src/taskStore');
  const deleteFlow = require('../src/deleteFlowExecutor');
  deleteFlow.setScheduler({
    reportStatus: (id, status, progress) => taskStore.updateTask(id, { status, progress: progress ?? undefined }),
    pauseForConfirm: () => { throw new Error('delete should not pause when approval is auto'); },
  });
  await deleteFlow.driveTask(createTask.json().id);

  assert.strictEqual(fs.existsSync(movieDir), false, 'delete task should remove the whole media folder');
  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib.json().total, 0, 'delete task should remove the library cache item');
  const done = await app.inject({ method: 'GET', url: `/v1/tasks/${createTask.json().id}` });
  assert.strictEqual(done.json().status, 'done');
  const report = await app.inject({ method: 'GET', url: `/v1/tasks/${createTask.json().id}/report` });
  assert.strictEqual(report.statusCode, 200);
  assert.strictEqual(report.json().bytesFreed, Buffer.byteLength('delete-me'));
  assert.strictEqual(report.json().delete.targetKind, 'directory');
  assert.strictEqual(report.json().delete.targetPath, movieDir);
  await app.close();
});

test('delete task removes an adult scraped movie folder when the marker matches', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    approvalPolicy: { 'delete.beforeExecute': 'auto' },
  }, null, 2));
  const watchRoot = path.join(dir, 'jav');
  const movieDir = path.join(watchRoot, 'scraped', 'MVSD-175 Some Title');
  fs.mkdirSync(movieDir, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const createLib = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Folder Delete Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = createLib.json();
  const filePath = path.join(movieDir, 'MVSD-175.mp4');
  const nfoPath = path.join(movieDir, 'movie.nfo');
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(nfoPath, '<movie><title>Some Title</title><id>MVSD-175</id></movie>');
  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath);
  mediaLibraryService.updateLibraryItems([metadataReadyAdultItem(item, {
    name: item.name || 'MVSD-175 Some Title',
    path: filePath,
    size: fs.statSync(filePath).size,
  })]);
  fs.writeFileSync(path.join(movieDir, '.shelfdeck.json'), JSON.stringify({
    itemId: item.itemId,
    subLibraryId: subLib.uuid,
    mediaPath: filePath,
    scrapedAt: new Date().toISOString(),
  }, null, 2));
  const expectedBytesFreed = fs.readdirSync(movieDir)
    .map((name) => fs.statSync(path.join(movieDir, name)).size)
    .reduce((sum, size) => sum + size, 0);

  const createTask = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: item.itemId, actionType: 'delete' } });
  assert.strictEqual(createTask.statusCode, 201);

  const taskStore = require('../src/taskStore');
  const deleteFlow = require('../src/deleteFlowExecutor');
  deleteFlow.setScheduler({
    reportStatus: (id, status, progress) => taskStore.updateTask(id, { status, progress: progress ?? undefined }),
    pauseForConfirm: () => { throw new Error('delete should not pause when approval is auto'); },
  });
  await deleteFlow.driveTask(createTask.json().id);

  assert.strictEqual(fs.existsSync(movieDir), false, 'delete task should remove the whole scraped movie folder');
  assert.strictEqual(fs.existsSync(path.join(watchRoot, 'scraped')), true, 'delete task must not remove the scraped root');
  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib.json().total, 0, 'delete task should remove the library cache item');
  const report = await app.inject({ method: 'GET', url: `/v1/tasks/${createTask.json().id}/report` });
  assert.strictEqual(report.statusCode, 200);
  assert.strictEqual(report.json().bytesFreed, expectedBytesFreed);
  assert.strictEqual(report.json().delete.targetKind, 'directory');
  assert.strictEqual(report.json().delete.targetPath, movieDir);
  await app.close();
});

test('delete task refuses adult folder media paths outside watchRoot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    approvalPolicy: { 'delete.beforeExecute': 'auto' },
  }, null, 2));
  const watchRoot = path.join(dir, 'jav');
  const outsideDir = path.join(dir, 'outside');
  fs.mkdirSync(watchRoot, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const createLib = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Unsafe Delete Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = createLib.json();
  const outsideFile = path.join(outsideDir, 'MVSD-175.mp4');
  fs.writeFileSync(outsideFile, 'must-stay');

  const mediaLibraryService = require('../src/mediaLibraryService');
  const itemId = 'unsafe-adult-delete-item';
  const lib = mediaLibraryService.loadLibrary();
  lib.items = [...(lib.items || []), {
    itemId,
    subLibraryId: subLib.uuid,
    source: 'adult_folder',
    mediaType: 'adult',
    name: 'Unsafe Delete',
    path: outsideFile,
    size: Buffer.byteLength('must-stay'),
    duration: 1200,
    bitrate: 3_000_000,
    resolution: '1920x1080',
    codec: 'h264',
    scraped: true,
    adultMetadata: {
      region: 'japanese_jav',
      scrapeStatus: 'done',
      adultId: 'MVSD-175',
      title: 'Unsafe Delete',
    },
  }];
  mediaLibraryService.saveLibrary(lib);

  const createTask = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId, actionType: 'delete' } });
  assert.strictEqual(createTask.statusCode, 201);

  const taskStore = require('../src/taskStore');
  const deleteFlow = require('../src/deleteFlowExecutor');
  deleteFlow.setScheduler({
    reportStatus: (id, status, progress) => taskStore.updateTask(id, { status, progress: progress ?? undefined }),
    pauseForConfirm: () => { throw new Error('unsafe delete should fail before confirmation'); },
  });
  await deleteFlow.driveTask(createTask.json().id);

  assert.strictEqual(fs.existsSync(outsideFile), true, 'delete task must not remove files outside watchRoot');
  const failed = await app.inject({ method: 'GET', url: `/v1/tasks/${createTask.json().id}` });
  assert.strictEqual(failed.json().status, 'failed_hard');
  await app.close();
});

// ── Task actions: pause / execute / cancel ────────────────────────────────────

test('POST /v1/tasks/:id/actions/pause returns paused status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId: 'i-pause' })] });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-pause', actionType: 'transcode' } });
  const { id } = create.json();
  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/pause` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.id, id);
  assert.strictEqual(body.status, 'paused');
  assert.strictEqual(body.controlState.state, 'paused');
  assert.strictEqual(body.controlState.primaryAction, 'execute');
  assert.strictEqual(body.controlState.actions.execute.enabled, true);
  assert.strictEqual(body.controlState.actions.execute.effect, 'resume_from_pause');
  assert.strictEqual(body.controlState.recovery.state, 'resume_available');
  const events = await app.inject({ method: 'GET', url: `/v1/tasks/${id}/events` });
  assert.ok(events.json().events.some((event) => event.eventType === 'task.pause_requested'));
  assert.ok(events.json().events.some((event) => event.eventType === 'task.paused'));
  await app.close();
});

test('POST /v1/tasks/:id/actions/pause non-existent task -> 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks/nonexistent/actions/pause' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

test('POST /v1/tasks/:id/actions/execute resumes paused task to queued', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId: 'i-resume' })] });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-resume', actionType: 'transcode' } });
  const { id } = create.json();
  // Pause first
  await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/pause` });
  // Then resume
  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/execute` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.id, id);
  assert.strictEqual(body.status, 'queued');
  assert.strictEqual(body.controlState.state, 'queued');
  assert.strictEqual(body.controlState.actions.execute.enabled, false);
  assert.strictEqual(body.controlState.actions.execute.reason, 'already_active');
  assert.strictEqual(body.controlState.actions.pause.enabled, true);
  // Verify persisted
  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.json().status, 'queued');
  assert.strictEqual(get.json().controlState.state, 'queued');
  const events = await app.inject({ method: 'GET', url: `/v1/tasks/${id}/events` });
  assert.ok(events.json().events.some((event) => event.eventType === 'task.execute_requested'));
  assert.ok(events.json().events.some((event) => event.eventType === 'task.resumed'));
  await app.close();
});

test('POST /v1/tasks/:id/actions/execute non-existent task -> 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks/nonexistent/actions/execute' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

test('transcode resume at verify does not re-encode partial output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const configStore = require('../src/configStore');
  const transcodeFlow = require('../src/transcodeFlowExecutor');
  const transcodeService = require('../src/services/transcodeService');

  const partialPath = path.join(dir, 'movie.etp.partial.mkv');
  const sourcePath = path.join(dir, 'movie.mkv');
  fs.writeFileSync(sourcePath, Buffer.alloc(2048));
  fs.writeFileSync(partialPath, Buffer.alloc(1024));

  configStore.patchConfig({
    transcodeTempRoot: dir,
    approvalPolicy: { 'transcode.beforeReplace': 'auto' },
  });

  const task = taskStore.createTask({
    itemId: 'resume-transcode-verify',
    itemName: 'Resume Transcode Verify',
    actionType: 'transcode',
    source: 'manual',
    status: 'executing',
    resumePoint: 'transcode_verify',
    itemInfo: {
      itemId: 'resume-transcode-verify',
      name: 'Resume Transcode Verify',
      sourcePath,
      partialPath,
      tempDir: dir,
      durationSec: 10,
      originalSizeBytes: 2048,
      targetBitrate: 4,
    },
  });

  const originalStartEncode = transcodeService.startEncode;
  const originalProbeSummary = transcodeService.probeSummary;
  const originalExtractPreviewClip = transcodeService.extractPreviewClip;
  const originalReplaceWithRetries = transcodeService.replaceWithRetries;
  let encodeCalls = 0;
  let probeCalls = 0;
  let replaceCalls = 0;
  transcodeService.startEncode = async () => {
    encodeCalls += 1;
    throw new Error('resume should not encode again');
  };
  transcodeService.probeSummary = async () => {
    probeCalls += 1;
    return {
      durationSec: 10,
      width: 1920,
      height: 1080,
      videoCodec: 'hevc',
      audioCodec: 'aac',
    };
  };
  transcodeService.extractPreviewClip = async () => ({
    method: 'stub',
    duration: 5,
    startSec: 0,
    previewPath: path.join(dir, 'preview.mp4'),
  });
  transcodeService.replaceWithRetries = async () => {
    replaceCalls += 1;
    return { resultSizeBytes: 1024 };
  };
  transcodeFlow.setScheduler({
    reportStatus: (id, status, progress) => {
      const updates = { status, progress: progress ?? undefined };
      if (status === 'done') {
        updates.resumePoint = null;
      }
      taskStore.updateTask(id, updates);
    },
    pauseForConfirm: () => { throw new Error('replace confirmation should be auto-passed'); },
  });

  try {
    await transcodeFlow.driveTask(task.id);
  } finally {
    transcodeService.startEncode = originalStartEncode;
    transcodeService.probeSummary = originalProbeSummary;
    transcodeService.extractPreviewClip = originalExtractPreviewClip;
    transcodeService.replaceWithRetries = originalReplaceWithRetries;
    await app.close();
  }

  const after = taskStore.getTask(task.id);
  assert.strictEqual(encodeCalls, 0);
  assert.strictEqual(probeCalls, 1);
  assert.strictEqual(replaceCalls, 1);
  assert.strictEqual(after.status, 'done');
  assert.strictEqual(after.phase, 'done');
  assert.strictEqual(after.resumePoint, null);
  assert.strictEqual(after.verifyResult.videoCodec, 'hevc');
});

test('task action endpoints reject transitions disabled by control policy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const queued = taskStore.createTask({
    itemId: 'control-reject-queued',
    actionType: 'transcode',
    status: 'queued',
  });
  const execute = await app.inject({ method: 'POST', url: `/v1/tasks/${queued.id}/actions/execute` });
  assert.strictEqual(execute.statusCode, 409);
  assert.strictEqual(execute.json().error.code, 'TASK_ACTION_REJECTED');
  assert.strictEqual(execute.json().error.message, 'already_active');
  assert.strictEqual(execute.json().actionName, 'execute');
  assert.strictEqual(execute.json().action.enabled, false);
  assert.strictEqual(execute.json().action.reason, 'already_active');
  assert.strictEqual(execute.json().controlState.state, 'queued');
  assert.strictEqual(execute.json().controlState.actions.pause.enabled, true);
  assert.strictEqual(execute.json().task.id, queued.id);
  assert.strictEqual(taskStore.getTask(queued.id).status, 'queued');

  const waiting = taskStore.createTask({
    itemId: 'control-reject-confirm',
    actionType: 'upgrade',
    status: 'queued',
  });
  taskStore.updateTask(waiting.id, {
    status: 'awaiting_user_confirm',
    resumePoint: 'upgrade_executing',
    approval: { gateId: 'upgrade.candidateSelect', message: 'Choose candidate' },
  });
  const pause = await app.inject({ method: 'POST', url: `/v1/tasks/${waiting.id}/actions/pause` });
  assert.strictEqual(pause.statusCode, 409);
  assert.strictEqual(pause.json().error.code, 'TASK_ACTION_REJECTED');
  assert.strictEqual(pause.json().error.message, 'confirmation_required');
  assert.strictEqual(pause.json().actionName, 'pause');
  assert.strictEqual(pause.json().action.reason, 'confirmation_required');
  assert.strictEqual(pause.json().controlState.state, 'awaiting_confirmation');
  assert.strictEqual(pause.json().controlState.confirmation.gateId, 'upgrade.candidateSelect');
  assert.strictEqual(pause.json().recovery.nextAction, 'confirm');
  assert.strictEqual(taskStore.getTask(waiting.id).status, 'awaiting_user_confirm');

  await app.close();
});

test('DELETE /v1/tasks/:id cancels then removes executing task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId: 'i-cancel-del' })] });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-cancel-del', actionType: 'transcode' } });
  const { id } = create.json();
  // Manually set task to executing via taskStore
  const taskStore = require('../src/taskStore');
  const partialPath = path.join(dir, 'executing.etp.partial.mkv');
  fs.writeFileSync(partialPath, 'partial');
  taskStore.updateTask(id, { status: 'executing', itemInfo: { partialPath } });
  // Delete should call cancel then remove
  const res = await app.inject({ method: 'DELETE', url: `/v1/tasks/${id}` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().ok, true);
  assert.strictEqual(fs.existsSync(partialPath), false, 'executing task cancel should clean partial file');
  const events = taskStore.queryTaskEvents({ taskId: id }, { pageSize: 50 }).events;
  assert.ok(events.some((event) => event.eventType === 'task.cancel_requested'));
  assert.ok(events.some((event) => event.eventType === 'task.deleted'));
  // Verify gone
  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.statusCode, 404);
  await app.close();
});

test('DELETE /v1/tasks/:id removes queued task without running flow cancel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId: 'i-remove-queued' })] });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-remove-queued', actionType: 'transcode' } });
  const { id } = create.json();
  const taskStore = require('../src/taskStore');
  const partialPath = path.join(dir, 'queued.etp.partial.mkv');
  fs.writeFileSync(partialPath, 'not-owned-by-running-flow');
  taskStore.updateTask(id, { status: 'queued', itemInfo: { partialPath } });

  const res = await app.inject({ method: 'DELETE', url: `/v1/tasks/${id}` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().ok, true);
  assert.strictEqual(fs.existsSync(partialPath), true, 'queued task removal should not run transcode cancel cleanup');
  const events = taskStore.queryTaskEvents({ taskId: id }, { pageSize: 50 }).events;
  assert.ok(events.some((event) => event.eventType === 'task.cancel_requested'));
  assert.ok(events.some((event) => event.eventType === 'task.deleted'));
  fs.rmSync(partialPath, { force: true });

  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.statusCode, 404);
  await app.close();
});

test('pause on executing transcode task deletes partial file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  // Write config with transcodeTempRoot so flow executor can resolve paths
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    transcodeTempRoot: tempRoot,
    transcodeEncodingDevices: [],
  }));

  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();

  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId: 'i-partial' })] });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-partial', actionType: 'transcode' } });
  const { id } = create.json();

  // Set up executing state with a partial file
  const taskStore = require('../src/taskStore');
  const partialPath = path.join(tempRoot, 'test.etp.partial.mkv');
  fs.writeFileSync(partialPath, 'fake-encode-data');
  taskStore.updateTask(id, {
    status: 'executing',
    phase: 'transcode_executing',
    itemInfo: { partialPath },
  });

  // Call pause
  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/pause` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().status, 'paused');

  // Verify partial file was deleted
  assert.strictEqual(fs.existsSync(partialPath), false, 'partial file should be deleted on pause');

  // Verify task status persisted
  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  const task = get.json();
  assert.strictEqual(task.status, 'paused');

  // Verify log entry added
  const pauseLog = (task.logs || []).find((e) => e.msg && e.msg.includes('paused by user'));
  assert.ok(pauseLog, 'should have pause log entry');

  await app.close();
});

test('GET /v1/admin/tasks exposes task control semantics for confirmation and recovery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const waiting = taskStore.createTask({
    itemId: 'control-confirm',
    itemName: 'Control Confirm',
    actionType: 'upgrade',
    status: 'queued',
  });
  const waitingApproval = {
    gateId: 'upgrade.candidateSelect',
    message: 'Choose upgrade candidate',
    options: [{ label: 'Candidate A' }],
  };
  taskStore.updateTask(waiting.id, {
    status: 'awaiting_user_confirm',
    phase: 'upgrade_candidate_select',
    resumePoint: 'upgrade_executing',
    approval: waitingApproval,
  });
  taskStore.appendTaskEvent(taskStore.getTask(waiting.id), 'approval.requested', {
      gateId: 'upgrade.candidateSelect',
      message: 'Choose upgrade candidate',
  });
  const failed = taskStore.createTask({
    itemId: 'control-failed',
    itemName: 'Control Failed',
    actionType: 'transcode',
    status: 'queued',
  });
  const failedRuntime = taskStore.updateTask(failed.id, {
    status: 'failed_hard',
    phase: 'transcode_executing',
    resumePoint: 'transcode_executing',
    retryCount: 2,
  });
  taskStore.appendTaskEvent(failedRuntime, 'task.failed', { message: 'Encoder failed' });

  const list = await app.inject({ method: 'GET', url: '/v1/admin/tasks?statuses=awaiting_user_confirm,failed_hard&page=1&pageSize=10' });
  assert.strictEqual(list.statusCode, 200);
  const waitingRow = list.json().tasks.find((task) => task.id === waiting.id);
  assert.ok(waitingRow, 'waiting task appears in list');
  assert.strictEqual(waitingRow.controlState.state, 'awaiting_confirmation');
  assert.strictEqual(waitingRow.controlState.requiresUserAction, true);
  assert.strictEqual(waitingRow.controlState.actions.confirm.enabled, true);
  assert.strictEqual(waitingRow.controlState.actions.execute.reason, 'confirmation_required');

  const detail = await app.inject({ method: 'GET', url: `/v1/admin/tasks/${waiting.id}?includeEvents=1` });
  assert.strictEqual(detail.statusCode, 200);
  assert.strictEqual(detail.json().controlState.confirmation.gateId, 'upgrade.candidateSelect');
  assert.strictEqual(detail.json().controlState.recovery.state, 'waiting_for_user_confirmation');
  assert.ok(detail.json().events.some((event) => event.eventType === 'approval.requested'));

  const failedDetail = await app.inject({ method: 'GET', url: `/v1/admin/tasks/${failed.id}?includeEvents=1` });
  assert.strictEqual(failedDetail.statusCode, 200);
  assert.strictEqual(failedDetail.json().controlState.state, 'terminal');
  assert.strictEqual(failedDetail.json().controlState.primaryAction, 'retry');
  assert.strictEqual(failedDetail.json().controlState.actions.retry.enabled, true);
  assert.strictEqual(failedDetail.json().controlState.actions.retry.effect, 'queue_failed_task_from_resume_point');
  assert.strictEqual(failedDetail.json().controlState.actions.retry.endpoint, `/v1/tasks/${failed.id}/actions/retry`);
  assert.strictEqual(failedDetail.json().controlState.recovery.state, 'retry_available');
  assert.strictEqual(failedDetail.json().controlState.recovery.nextAction, 'retry');
  assert.ok(failedDetail.json().events.some((event) => event.eventType === 'task.failed'));
  await app.close();
});

test('GET /v1/admin/confirmations exposes a lightweight confirmation queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const waitingUpgrade = taskStore.createTask({
    itemId: 'confirm-upgrade',
    itemName: 'Confirm Upgrade',
    actionType: 'upgrade',
    status: 'queued',
    priority: 8,
  });
  taskStore.updateTask(waitingUpgrade.id, {
    status: 'awaiting_user_confirm',
    phase: 'upgrade_candidate_select',
    resumePoint: 'upgrade_executing',
    approval: {
      gateId: 'upgrade.candidateSelect',
      message: 'Choose upgrade candidate',
      options: [{ label: 'Candidate A', value: 'a' }],
    },
  });
  const waitingDelete = taskStore.createTask({
    itemId: 'confirm-delete',
    itemName: 'Confirm Delete',
    actionType: 'delete',
    status: 'queued',
  });
  taskStore.updateTask(waitingDelete.id, {
    status: 'awaiting_user_confirm',
    phase: 'delete_precheck',
    resumePoint: 'delete_executing',
    approval: {
      gateId: 'delete.beforeExecute',
      message: 'Delete this media?',
      options: ['approve', 'reject'],
    },
  });
  taskStore.createTask({
    itemId: 'confirm-queued',
    itemName: 'Confirm Queued',
    actionType: 'transcode',
    status: 'queued',
  });

  const originalGetTasks = taskStore.getTasks;
  const originalLoadTasks = taskStore.loadTasks;
  taskStore.getTasks = () => {
    throw new Error('confirmation queue should use lightweight summaries');
  };
  taskStore.loadTasks = () => {
    throw new Error('confirmation queue should not load full task history');
  };
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/confirmations?page=1&pageSize=20' });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.total, 2);
    assert.strictEqual(body.summary.total, 2);
    assert.strictEqual(body.summary.byGate['upgrade.candidateSelect'], 1);
    assert.strictEqual(body.summary.byGate['delete.beforeExecute'], 1);
    assert.strictEqual(body.summary.byBridgeKind.optimize, 2);
    const upgrade = body.confirmations.find((item) => item.taskId === waitingUpgrade.id);
    assert.ok(upgrade, 'upgrade confirmation appears');
    assert.strictEqual(upgrade.confirmation.required, true);
    assert.strictEqual(upgrade.confirmation.gateId, 'upgrade.candidateSelect');
    assert.strictEqual(upgrade.confirmation.message, 'Choose upgrade candidate');
    assert.strictEqual(upgrade.confirmation.resumePoint, 'upgrade_executing');
    assert.strictEqual(upgrade.confirmation.whyRequired, 'flow_gate_requires_user_decision');
    assert.strictEqual(upgrade.confirmAction.enabled, true);
    assert.strictEqual(upgrade.confirmAction.effect, 'store_confirmation_and_queue_task');
    assert.strictEqual(upgrade.recovery.nextAction, 'confirm');
    assert.strictEqual(upgrade.taskBridge.kind, 'optimize');
    assert.strictEqual(upgrade.flowPlan.operationKind, 'upgrade');
    const deletion = body.confirmations.find((item) => item.taskId === waitingDelete.id);
    assert.ok(deletion, 'delete confirmation appears');
    assert.strictEqual(deletion.taskBridge.kind, 'optimize');
    assert.strictEqual(deletion.flowPlan.operationKind, 'delete');
    assert.ok(!body.confirmations.some((item) => item.itemId === 'confirm-queued'));

    const optimizeOnly = await app.inject({ method: 'GET', url: '/v1/admin/confirmations?bridgeKind=optimize&page=1&pageSize=20' });
    assert.strictEqual(optimizeOnly.statusCode, 200);
    assert.deepStrictEqual(new Set(optimizeOnly.json().confirmations.map((item) => item.taskId)), new Set([waitingUpgrade.id, waitingDelete.id]));
  } finally {
    taskStore.getTasks = originalGetTasks;
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('GET /v1/admin/confirmations includes adult review items without loading full library payloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [
      {
        itemId: 'adult-ambiguous-review',
        subLibraryId: 'adult-lib',
        source: 'adult_folder',
        sourceId: 'ZZZZZ-001',
        name: 'ZZZZZ-001 Low Confidence',
        type: 'movie',
        path: path.join(dir, 'adult', 'ambiguous.mp4'),
        scraped: false,
        adultMetadata: {
          region: 'japanese_jav',
          adultId: 'ZZZZZ-001',
          title: 'ZZZZZ-001 Low Confidence',
          scrapeStatus: 'ambiguous',
          idConfidence: 'low',
        },
      },
      {
        itemId: 'adult-needs-review',
        subLibraryId: 'adult-lib',
        source: 'adult_folder',
        sourceId: 'WEST-001',
        name: 'WEST-001 Needs Review',
        type: 'movie',
        path: path.join(dir, 'adult', 'western.mp4'),
        scraped: false,
        adultMetadata: {
          region: 'western_adult',
          adultId: 'WEST-001',
          title: 'WEST-001 Needs Review',
          scrapeStatus: 'needs_review',
          reviewStatus: 'needs_review',
          protagonist: { name: 'Unknown Performer' },
          scrapeError: 'No confirmed protagonist',
        },
      },
      {
        itemId: 'adult-done-review',
        subLibraryId: 'adult-lib',
        source: 'adult_folder',
        sourceId: 'DONE-001',
        name: 'DONE-001 Done',
        type: 'movie',
        path: path.join(dir, 'adult', 'done.mp4'),
        scraped: true,
        adultMetadata: {
          region: 'japanese_jav',
          adultId: 'DONE-001',
          scrapeStatus: 'done',
        },
      },
    ],
  });
  const waitingUpgrade = taskStore.createTask({
    itemId: 'confirm-plus-review',
    itemName: 'Confirm Plus Review',
    actionType: 'upgrade',
    status: 'queued',
  });
  taskStore.updateTask(waitingUpgrade.id, {
    status: 'awaiting_user_confirm',
    resumePoint: 'upgrade_executing',
    approval: { gateId: 'upgrade.candidateSelect', message: 'Choose upgrade candidate' },
  });

  const originalLoadLibrary = libraryStore.loadLibrary;
  const originalQueryItems = libraryStore.queryItems;
  libraryStore.loadLibrary = () => {
    throw new Error('confirmation review queue should not load full library');
  };
  libraryStore.queryItems = () => {
    throw new Error('confirmation review queue should use adult review summaries');
  };
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/confirmations?page=1&pageSize=20' });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.total, 3);
    assert.strictEqual(body.taskTotal, 1);
    assert.strictEqual(body.reviewTotal, 2);
    assert.strictEqual(body.confirmations.length, 1);
    assert.strictEqual(body.reviews.length, 2);
    assert.strictEqual(body.items.length, 3);
    assert.strictEqual(body.summary.taskConfirmations.byGate['upgrade.candidateSelect'], 1);
    assert.strictEqual(body.summary.adultReviews.byScrapeStatus.ambiguous, 1);
    assert.strictEqual(body.summary.adultReviews.byReviewStatus.needs_review, 1);
    assert.strictEqual(body.summary.adultReviews.byRegion.western_adult, 1);
    const ambiguous = body.reviews.find((item) => item.itemId === 'adult-ambiguous-review');
    assert.ok(ambiguous, 'ambiguous adult review appears');
    assert.strictEqual(ambiguous.kind, 'adult_review');
    assert.strictEqual(ambiguous.confirmation.required, true);
    assert.strictEqual(ambiguous.confirmation.whyRequired, 'adult_identity_ambiguous');
    assert.strictEqual(ambiguous.taskBridge.kind, 'metadata');
    assert.strictEqual(ambiguous.flowPlan.operationKind, 'scrape');
    assert.strictEqual(ambiguous.confirmAction.enabled, false);
    assert.strictEqual(ambiguous.recovery.nextAction, 'review');
    assert.ok(!body.items.some((item) => item.itemId === 'adult-done-review'));

    const reviewOnly = await app.inject({ method: 'GET', url: '/v1/admin/confirmations?kind=adult_review&q=WEST&page=1&pageSize=20' });
    assert.strictEqual(reviewOnly.statusCode, 200);
    assert.deepStrictEqual(reviewOnly.json().reviews.map((item) => item.itemId), ['adult-needs-review']);
    assert.deepStrictEqual(reviewOnly.json().confirmations, []);

    const archiveOnly = await app.inject({ method: 'GET', url: '/v1/admin/confirmations?bridgeKind=archive&page=1&pageSize=20' });
    assert.strictEqual(archiveOnly.statusCode, 200);
    assert.strictEqual(archiveOnly.json().reviewTotal, 0);
    assert.strictEqual(archiveOnly.json().taskTotal, 0);
  } finally {
    libraryStore.loadLibrary = originalLoadLibrary;
    libraryStore.queryItems = originalQueryItems;
    await app.close();
  }
});

test('GET /v1/admin/tasks attention queues are derived from task control actions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const waiting = taskStore.createTask({
    itemId: 'attention-confirm',
    itemName: 'Attention Confirm',
    actionType: 'upgrade',
    status: 'awaiting_user_confirm',
  });
  taskStore.updateTask(waiting.id, {
    approval: { gateId: 'upgrade.candidateSelect', mode: 'confirm', message: 'Choose upgrade candidate' },
  });
  const failed = taskStore.createTask({
    itemId: 'attention-failed',
    itemName: 'Attention Failed',
    actionType: 'transcode',
    status: 'failed_hard',
  });
  taskStore.updateTask(failed.id, {
    resumePoint: 'transcode_executing',
    retryCount: 1,
  });
  const paused = taskStore.createTask({
    itemId: 'attention-paused',
    itemName: 'Attention Paused',
    actionType: 'transcode',
    status: 'paused',
  });
  taskStore.updateTask(paused.id, {
    resumePoint: 'transcode_executing',
  });
  const manual = taskStore.createTask({
    itemId: 'attention-manual',
    itemName: 'Attention Manual',
    actionType: 'scrape',
    status: 'pending_manual',
  });
  const active = taskStore.createTask({
    itemId: 'attention-active',
    itemName: 'Attention Active',
    actionType: 'scrape',
    status: 'queued',
  });
  const exhausted = taskStore.createTask({
    itemId: 'attention-exhausted',
    itemName: 'Attention Exhausted',
    actionType: 'upgrade',
    status: 'failed_hard',
  });
  taskStore.updateTask(exhausted.id, {
    resumePoint: 'upgrade_executing',
    retryCount: 3,
  });

  const needsAction = await app.inject({ method: 'GET', url: '/v1/admin/tasks?attention=needs_action&page=1&pageSize=20' });
  assert.strictEqual(needsAction.statusCode, 200);
  const needsActionBody = needsAction.json();
  const needsActionIds = new Set(needsActionBody.tasks.map((task) => task.id));
  assert.strictEqual(needsActionBody.attention, 'needs_action');
  assert.strictEqual(needsActionBody.summary.total, 4);
  assert.ok(needsActionIds.has(waiting.id));
  assert.ok(needsActionIds.has(failed.id));
  assert.ok(needsActionIds.has(paused.id));
  assert.ok(needsActionIds.has(manual.id));
  assert.ok(!needsActionIds.has(active.id), 'queued active task is not a user attention task');
  assert.ok(!needsActionIds.has(exhausted.id), 'retry-exhausted failure is not actionable');
  assert.strictEqual(needsActionBody.summary.attention.needs_action.count, 4);
  assert.strictEqual(needsActionBody.summary.attention.confirmation.count, 1);
  assert.strictEqual(needsActionBody.summary.attention.recovery.count, 2);
  assert.strictEqual(needsActionBody.summary.attention.manual_start.count, 1);

  const plainList = await app.inject({ method: 'GET', url: '/v1/admin/tasks?page=1&pageSize=20' });
  assert.strictEqual(plainList.statusCode, 200);
  const plainBody = plainList.json();
  assert.strictEqual(plainBody.summary.attention.needs_action.count, 4);
  assert.strictEqual(plainBody.summary.attention.recovery.count, 2);
  const exhaustedRow = plainBody.tasks.find((task) => task.id === exhausted.id);
  assert.ok(exhaustedRow, 'retry-exhausted task appears in ordinary list');
  assert.strictEqual(exhaustedRow.retryCount, 3);
  assert.strictEqual(exhaustedRow.controlState.actions.retry.enabled, false);
  assert.strictEqual(exhaustedRow.controlState.actions.retry.reason, 'retry_limit_reached');

  const originalGetTasks = taskStore.getTasks;
  taskStore.getTasks = () => {
    throw new Error('admin task list should use lightweight task summaries');
  };
  try {
    const lightPlain = await app.inject({ method: 'GET', url: '/v1/admin/tasks?page=1&pageSize=1' });
    assert.strictEqual(lightPlain.statusCode, 200);
    const lightAttention = await app.inject({ method: 'GET', url: '/v1/admin/tasks?attention=needs_action&page=1&pageSize=1' });
    assert.strictEqual(lightAttention.statusCode, 200);
  } finally {
    taskStore.getTasks = originalGetTasks;
  }

  const recovery = await app.inject({ method: 'GET', url: '/v1/admin/tasks?attention=recovery&page=1&pageSize=20' });
  assert.strictEqual(recovery.statusCode, 200);
  const recoveryIds = new Set(recovery.json().tasks.map((task) => task.id));
  assert.deepStrictEqual(recoveryIds, new Set([failed.id, paused.id]));

  const manualStart = await app.inject({ method: 'GET', url: '/v1/admin/tasks?attention=manual_start&page=1&pageSize=20' });
  assert.strictEqual(manualStart.statusCode, 200);
  assert.deepStrictEqual(new Set(manualStart.json().tasks.map((task) => task.id)), new Set([manual.id]));

  const invalid = await app.inject({ method: 'GET', url: '/v1/admin/tasks?attention=unknown' });
  assert.strictEqual(invalid.statusCode, 400);
  assert.strictEqual(invalid.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks/:id/actions/retry queues failed task with recovery event', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const failed = taskStore.createTask({
    itemId: 'retry-failed',
    itemName: 'Retry Failed',
    actionType: 'transcode',
    status: 'queued',
  });
  taskStore.updateTask(failed.id, {
    status: 'failed_hard',
    phase: 'failed_hard',
    resumePoint: 'transcode_executing',
    retryCount: 1,
    progress: 72,
  });

  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${failed.id}/actions/retry` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.status, 'queued');
  assert.strictEqual(body.controlState.state, 'queued');
  assert.strictEqual(body.controlState.actions.retry.enabled, false);
  assert.strictEqual(body.controlState.actions.pause.enabled, true);

  const stored = taskStore.getTask(failed.id);
  assert.strictEqual(stored.status, 'queued');
  assert.strictEqual(stored.retryCount, 2);
  assert.strictEqual(stored.resumePoint, 'transcode_executing');
  assert.strictEqual(stored.phase, null);
  assert.strictEqual(stored.progress, 0);
  assert.strictEqual(stored.manualExecuteRequested, true);

  const events = taskStore.queryTaskEvents({ taskId: failed.id }, { pageSize: 50 }).events;
  assert.ok(events.some((event) => event.eventType === 'task.retry_requested'));
  assert.ok(events.some((event) => event.eventType === 'task.retry_recorded'));
  await app.close();
});

test('POST /v1/tasks/:id/actions/retry rejects retry limit and active task conflict', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const exhausted = taskStore.createTask({
    itemId: 'retry-exhausted',
    actionType: 'upgrade',
    status: 'queued',
  });
  taskStore.updateTask(exhausted.id, {
    status: 'failed_hard',
    resumePoint: 'upgrade_executing',
    retryCount: 3,
  });
  const exhaustedView = await app.inject({ method: 'GET', url: `/v1/tasks/${exhausted.id}` });
  assert.strictEqual(exhaustedView.statusCode, 200);
  assert.strictEqual(exhaustedView.json().controlState.actions.retry.enabled, false);
  assert.strictEqual(exhaustedView.json().controlState.actions.retry.reason, 'retry_limit_reached');
  assert.strictEqual(exhaustedView.json().controlState.recoveryContract.flowKey, 'upgrade');
  assert.strictEqual(exhaustedView.json().controlState.recoveryContract.currentResumePoint, 'upgrade_executing');
  assert.ok(exhaustedView.json().controlState.recoveryContract.resumePoints.some((point) => point.resumePoint === 'upgrade_executing'));

  const retryLimit = await app.inject({ method: 'POST', url: `/v1/tasks/${exhausted.id}/actions/retry` });
  assert.strictEqual(retryLimit.statusCode, 409);
  assert.strictEqual(retryLimit.json().error.code, 'TASK_RECOVERY_REJECTED');
  assert.strictEqual(retryLimit.json().error.message, 'retry_limit_reached');
  assert.strictEqual(retryLimit.json().actionName, 'retry');
  assert.strictEqual(retryLimit.json().action.enabled, false);
  assert.strictEqual(retryLimit.json().action.reason, 'retry_limit_reached');
  assert.strictEqual(retryLimit.json().controlState.actions.retry.effect, 'manual_recovery_retry_limit_reached');
  assert.strictEqual(retryLimit.json().recovery.state, 'flow_specific_recovery_required');
  assert.strictEqual(retryLimit.json().recoveryPlan.reason, 'retry_limit_reached');

  const failed = taskStore.createTask({
    itemId: 'retry-conflict',
    actionType: 'transcode',
    status: 'queued',
  });
  taskStore.updateTask(failed.id, {
    status: 'failed_hard',
    resumePoint: 'transcode_executing',
  });
  const blocker = taskStore.createTask({
    itemId: 'retry-conflict',
    actionType: 'transcode',
    status: 'queued',
  });
  const conflict = await app.inject({ method: 'POST', url: `/v1/tasks/${failed.id}/actions/retry` });
  assert.strictEqual(conflict.statusCode, 409);
  assert.strictEqual(conflict.json().error.code, 'TASK_RECOVERY_REJECTED');
  assert.strictEqual(conflict.json().error.message, 'active_task_conflict');
  assert.strictEqual(conflict.json().actionName, 'retry');
  assert.strictEqual(conflict.json().action.enabled, true);
  assert.strictEqual(conflict.json().controlState.actions.retry.enabled, true);
  assert.strictEqual(conflict.json().recoveryPlan.reason, 'active_task_conflict');
  assert.strictEqual(conflict.json().activeTask.id, blocker.id);
  assert.strictEqual(conflict.json().activeTask.controlState.state, 'queued');
  await app.close();
});

// ── Admin tasks ────────────────────────────────────────────────────────────────

test('GET /v1/admin/tasks returns list with summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'a1', actionType: 'scrape' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'a2', actionType: 'scrape' } });
  taskStore.createTask({
    itemId: 'a3',
    actionType: 'scrape',
    status: 'queued',
    itemInfo: {
      name: 'Heavy adult scrape',
      adultMetadata: {
        adultId: 'UNK-001',
        scrapeStatus: 'done',
        region: 'western_adult',
        faceClusters: [{ clusterId: 'face-heavy', embedding: Array.from({ length: 512 }, (_, i) => i), sampleImageBase64: Buffer.from('face').toString('base64') }],
      },
    },
    logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'large log entry' }],
    report: { frames: Array.from({ length: 20 }, (_, i) => ({ i, text: 'large report payload' })) },
  });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/tasks?page=1&pageSize=2' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.tasks));
  assert.strictEqual(body.tasks.length, 2);
  assert.ok(body.summary, 'summary present');
  assert.strictEqual(body.summary.total, 3);
  assert.strictEqual(body.summary.byStatus.created, 2);
  assert.strictEqual(body.summary.byStatus.queued, 1);
  assert.ok(body.tasks.every((t) => t.logs === undefined), 'list payload omits logs');
  assert.ok(body.tasks.every((t) => t.report === undefined), 'list payload omits reports');
  const manualSummaries = body.tasks.filter((t) => t.itemId === 'a1' || t.itemId === 'a2');
  assert.ok(manualSummaries.every((t) => t.source === 'manual'), 'list payload includes task source');
  const scrapeSummary = body.tasks.find((t) => t.itemId === 'a3');
  if (scrapeSummary) {
    assert.strictEqual(scrapeSummary.itemInfo.adultMetadata.faceClusters, undefined, 'list payload omits heavy face clusters');
  }
  await app.close();
});

test('GET /v1/admin/tasks/lifecycle-audit groups task lifecycles by library type', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    subLibraries: [
      { uuid: 'movie-audit', name: 'Movies', source: 'emby', mediaType: 'movie', enabled: true },
      { uuid: 'adult-audit', name: 'JAV', source: 'folder', mediaType: 'adult', adultRegion: 'japanese_jav', enabled: true },
    ],
  }));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  taskStore.createTask({
    itemId: 'movie-transcode',
    itemName: 'Movie Transcode',
    actionType: 'transcode',
    status: 'queued',
    source: 'auto',
    itemInfo: { name: 'Movie Transcode', subLibraryId: 'movie-audit' },
  });
  taskStore.createTask({
    itemId: 'movie-repair-scrape',
    itemName: 'Movie Repair Scrape',
    actionType: 'scrape',
    status: 'queued',
    source: 'manual',
    itemInfo: { name: 'Movie Repair Scrape', subLibraryId: 'movie-audit', source: 'emby', metadataKind: 'emby' },
  });
  taskStore.createTask({
    itemId: 'movie-wrong-scrape',
    itemName: 'Movie Wrong Scrape',
    actionType: 'scrape',
    status: 'queued',
    source: 'manual',
    itemInfo: { name: 'Movie Wrong Scrape', subLibraryId: 'movie-audit' },
  });
  taskStore.createTask({
    itemId: 'movie-legacy-scrape',
    itemName: 'Movie Legacy Scrape',
    actionType: 'scrape',
    status: 'failed_hard',
    source: 'manual',
    itemInfo: { name: 'Movie Legacy Scrape', subLibraryId: 'movie-audit' },
  });
  taskStore.createTask({
    itemId: 'adult-scrape',
    itemName: 'Adult Scrape',
    actionType: 'scrape',
    status: 'awaiting_user_confirm',
    source: 'manual',
    itemInfo: {
      name: 'Adult Scrape',
      subLibraryId: 'adult-audit',
      adultMetadata: { adultId: 'MVSD-175', scrapeStatus: 'needs_review', region: 'japanese_jav' },
    },
  });
  taskStore.createTask({
    itemId: 'unknown-task',
    itemName: 'Unknown Library',
    actionType: 'upgrade',
    status: 'failed_hard',
    source: 'manual',
    itemInfo: { name: 'Unknown Library', subLibraryId: 'missing-lib' },
  });

  const originalGetTasks = taskStore.getTasks;
  const originalLoadTasks = taskStore.loadTasks;
  taskStore.getTasks = () => {
    throw new Error('lifecycle audit should use lightweight task summaries');
  };
  taskStore.loadTasks = () => {
    throw new Error('lifecycle audit should not load full task payloads');
  };
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/tasks/lifecycle-audit?sampleLimit=10' });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.total, 6);
    assert.strictEqual(body.summary.byLifecycleStage.queued, 3);
    assert.strictEqual(body.summary.byLifecycleStage.user_gate, 1);
    assert.strictEqual(body.summary.byLifecycleStage.terminal_failure, 2);
    assert.strictEqual(body.byLibraryType.movie.total, 4);
    assert.strictEqual(body.byLibraryType.movie.byOperationKind.scrape, 3);
    assert.strictEqual(body.byLibraryType.adult.total, 1);
    assert.strictEqual(body.byLibraryType.movie.bySource.auto, 1);
    assert.strictEqual(body.signals.byCode.standard_media_scrape_task, undefined);
    assert.strictEqual(body.signals.byCode.standard_media_scrape_wrong_resource, 1);
    assert.strictEqual(body.signals.byCode.legacy_standard_media_scrape_task, 1);
    assert.strictEqual(body.signals.byCode.unknown_sub_library, 1);
    assert.ok(body.signals.items.some((item) => item.taskId && item.code === 'standard_media_scrape_wrong_resource'));
    assert.ok(body.signals.items.some((item) => item.taskId && item.code === 'legacy_standard_media_scrape_task'));
    assert.ok(!body.signals.items.some((item) => item.itemId === 'movie-repair-scrape'), 'Emby metadata repair scrape is expected for standard media');
    const movieBucket = body.bySubLibrary.find((bucket) => bucket.subLibraryId === 'movie-audit');
    assert.ok(movieBucket);
    assert.strictEqual(movieBucket.name, 'Movies');
    assert.strictEqual(movieBucket.byBridgeKind.optimize, 1);
    assert.strictEqual(movieBucket.byBridgeKind.metadata, 3);

    const adultOnly = await app.inject({ method: 'GET', url: '/v1/admin/tasks/lifecycle-audit?mediaType=adult' });
    assert.strictEqual(adultOnly.statusCode, 200);
    assert.strictEqual(adultOnly.json().total, 1);
    assert.strictEqual(adultOnly.json().byLibraryType.adult.total, 1);
    assert.strictEqual(adultOnly.json().signals.byCode.standard_media_scrape_task, undefined);
    assert.strictEqual(adultOnly.json().signals.byCode.standard_media_scrape_wrong_resource, undefined);
  } finally {
    taskStore.getTasks = originalGetTasks;
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('GET /v1/admin/dashboard/health returns media and task health aggregates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    smartTaskEnabledActions: ['ingest', 'scrape'],
  }));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const closed = metadataReadyMovie({
    itemId: 'dashboard-closed',
    name: 'Closed',
    action: 'keep',
    metadataComplete: true,
  });
  const missing = metadataReadyMovie({
    itemId: 'dashboard-missing',
    name: 'Missing Metadata',
    action: 'transcode',
    metadataComplete: false,
    metadataStatus: 'missing',
    metadataMissingReasons: ['tmdb_id_missing'],
  });
  const pending = metadataReadyMovie({
    itemId: 'dashboard-pending',
    name: 'Pending Optimize',
    action: 'transcode',
    metadataComplete: true,
    optimizationStatus: 'none',
  });
  libraryStore.saveLibrary({ version: 1, cachedAt: new Date().toISOString(), items: [closed, missing, pending] });
  const waiting = taskStore.createTask({
    itemId: 'dashboard-pending',
    itemName: 'Pending Optimize',
    actionType: 'transcode',
    status: 'awaiting_user_confirm',
    itemInfo: { name: 'Pending Optimize', subLibraryId: '' },
  });
  taskStore.createTask({
    itemId: 'dashboard-failed',
    itemName: 'Failed Bridge',
    actionType: 'upgrade',
    status: 'failed_hard',
    itemInfo: { name: 'Failed Bridge', subLibraryId: '' },
  });
  const manual = taskStore.createTask({
    itemId: 'dashboard-manual',
    itemName: 'Manual Start',
    actionType: 'scrape',
    status: 'pending_manual',
    itemInfo: { name: 'Manual Start', subLibraryId: '' },
  });
  taskStore.createTask({
    itemId: 'dashboard-queued',
    itemName: 'Queued Active',
    actionType: 'scrape',
    status: 'queued',
    itemInfo: { name: 'Queued Active', subLibraryId: '' },
  });
  taskStore.appendTaskEvent(waiting, 'task.awaiting_confirmation', { bridgeKind: 'optimize' });
  activityLog.addActivity('health', 'Emby 服务器连接已恢复', { ok: true });

  const originalGetTasks = taskStore.getTasks;
  const originalQueryTaskEvents = taskStore.queryTaskEvents;
  const originalSmartTaskHealth = smartTaskEngine.getHealth;
  taskStore.getTasks = () => {
    throw new Error('dashboard health should use lightweight task summaries');
  };
  taskStore.queryTaskEvents = () => {
    throw new Error('dashboard health should use recent task event projection');
  };
  smartTaskEngine.getHealth = () => ({
    status: 'green',
    enabled: true,
    enabledActions: ['scrape', 'transcode'],
    lastRunAt: '2026-06-30T00:00:00.000Z',
    lastScanSummary: {
      status: 'done',
      startedAt: '2026-06-30T00:00:00.000Z',
      finishedAt: '2026-06-30T00:00:01.000Z',
      enabledActions: ['scrape', 'transcode'],
      libraryItems: 9,
      candidateCount: 4,
      evaluatedCandidates: 3,
      enqueued: 1,
      candidatesByAction: { scrape: 2, transcode: 2 },
      enqueuedByAction: { transcode: 1 },
      admissionRejected: 1,
      admissionRejectedByReason: { recent_task_cooldown: 1 },
      skippedByQueueCap: 1,
      skippedByQueueCapByAction: { scrape: 1 },
      maxPerRunReached: true,
      payload: { shouldNotLeak: true },
    },
  });
  let res;
  try {
    res = await app.inject({ method: 'GET', url: '/v1/admin/dashboard/health' });
  } finally {
    taskStore.getTasks = originalGetTasks;
    taskStore.queryTaskEvents = originalQueryTaskEvents;
    smartTaskEngine.getHealth = originalSmartTaskHealth;
  }
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.status, 'red');
  assert.strictEqual(body.media.totalItems, 3);
  assert.strictEqual(body.media.closedItems, 1);
  assert.strictEqual(body.media.openItems, 2);
  assert.strictEqual(body.media.metadataIncompleteItems, 1);
  assert.strictEqual(body.media.pendingOptimizationItems, 1);
  assert.strictEqual(body.media.byRecommendedAction.transcode, 2);
  assert.strictEqual(body.media.pendingBridges.metadata, 1);
  assert.strictEqual(body.media.pendingBridges.optimize, 1);
  assert.deepStrictEqual(body.media.topMetadataMissingReasons[0], { reason: 'tmdb_id_missing', count: 1 });
  assert.strictEqual(body.tasks.awaitingConfirmationTasks, 1);
  assert.strictEqual(body.tasks.failedTasks, 1);
  assert.strictEqual(body.tasks.activeTasks, 3);
  assert.strictEqual(body.tasks.activeByBridgeKind.optimize, 1);
  assert.strictEqual(body.tasks.attention.needs_action.count, 3);
  assert.strictEqual(body.tasks.attention.confirmation.count, 1);
  assert.strictEqual(body.tasks.attention.manual_start.count, 1);
  assert.strictEqual(body.tasks.attention.recovery.count, 1);
  assert.strictEqual(body.tasks.primaryAttention.key, 'needs_action');
  assert.strictEqual(body.tasks.primaryAttention.count, 3);
  assert.strictEqual(body.tasks.byStatus.pending_manual, 1);
  assert.deepStrictEqual(body.automation.enabledOperations, ['ingest', 'scrape']);
  assert.strictEqual(body.automation.smartTask.status, 'green');
  assert.strictEqual(body.automation.smartTask.enabled, true);
  assert.strictEqual(body.automation.smartTask.lastRunAt, '2026-06-30T00:00:00.000Z');
  assert.strictEqual(body.automation.smartTask.lastScanSummary.candidateCount, 4);
  assert.strictEqual(body.automation.smartTask.lastScanSummary.enqueued, 1);
  assert.strictEqual(body.automation.smartTask.lastScanSummary.admissionRejectedByReason.recent_task_cooldown, 1);
  assert.strictEqual(body.automation.smartTask.lastScanSummary.skippedByQueueCapByAction.scrape, 1);
  assert.strictEqual(body.automation.smartTask.lastScanSummary.maxPerRunReached, true);
  assert.strictEqual(body.automation.smartTask.lastScanSummary.payload, undefined);
  assert.ok(manual.id, 'manual task fixture created');
  assert.ok(body.diagnostics.signals.some((signal) => signal.code === 'failed_tasks'));
  assert.ok(body.diagnostics.signals.some((signal) => signal.code === 'smart_task_admission_rejected'));
  assert.ok(body.diagnostics.signals.some((signal) => signal.code === 'smart_task_queue_cap'));
  assert.ok(body.diagnostics.signals.some((signal) => signal.code === 'smart_task_max_per_run'));
  assert.ok(body.diagnostics.storage.some((metric) => metric.store === 'library'));
  assert.ok(body.diagnostics.storage.some((metric) => metric.store === 'tasks'));
  assert.ok(body.events.recent.length > 0, 'dashboard health includes event projection');
  assert.ok(body.events.bySource.task_event > 0);
  assert.ok(body.events.recent.some((entry) => entry.source === 'health' && entry.sourceLabel === '健康'));
  const waitingEvent = body.events.recent.find((entry) => entry.kind === 'task_event' && entry.taskId === waiting.id);
  assert.ok(waitingEvent, 'task event projection includes recent task event');
  assert.strictEqual(waitingEvent.detail, undefined);
  assert.strictEqual(waitingEvent.payload, undefined);
  await app.close();
});

test('GET /v1/admin/tasks/:id omits heavy adult face payloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  const task = taskStore.createTask({
    itemId: 'heavy-detail',
    itemName: 'Heavy Detail',
    actionType: 'scrape',
    status: 'failed_hard',
    itemInfo: {
      name: 'Heavy Detail',
      adultMetadata: {
        adultId: 'UNK-002',
        scrapeStatus: 'failed',
        galleryImages: [{ imageBase64: Buffer.alloc(4096, 1).toString('base64') }],
        ai: { faceEmbeddingsEnabled: true },
        faceClusters: [{ clusterId: 'face-1', embedding: [0.1, 0.2], sampleImageBase64: Buffer.from('face').toString('base64') }],
        unknownFaces: [{ clusterId: 'unknown-1', embedding: [0.3, 0.4], sampleImageBase64: Buffer.from('unknown').toString('base64') }],
      },
    },
  });

  const res = await app.inject({ method: 'GET', url: `/v1/admin/tasks/${task.id}` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.deepStrictEqual(body.itemInfo.adultMetadata.faceClusters, []);
  assert.deepStrictEqual(body.itemInfo.adultMetadata.unknownFaces, []);
  assert.strictEqual(body.itemInfo.adultMetadata.galleryImages, undefined);
  assert.strictEqual(body.itemInfo.adultMetadata.ai, undefined);
  await app.close();
});

test('GET /v1/tasks/:id omits heavy adult face payloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  const task = taskStore.createTask({
    itemId: 'heavy-public-detail',
    itemName: 'Heavy Public Detail',
    actionType: 'scrape',
    status: 'failed_hard',
    itemInfo: {
      name: 'Heavy Public Detail',
      adultMetadata: {
        adultId: 'UNK-003',
        scrapeStatus: 'failed',
        galleryImages: [{ imageBase64: Buffer.alloc(4096, 1).toString('base64') }],
        ai: { faceEmbeddingsEnabled: true },
        faceClusters: [{ clusterId: 'face-1', embedding: [0.1, 0.2], sampleImageBase64: Buffer.from('face').toString('base64') }],
        unknownFaces: [{ clusterId: 'unknown-1', embedding: [0.3, 0.4], sampleImageBase64: Buffer.from('unknown').toString('base64') }],
      },
    },
  });

  const res = await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.deepStrictEqual(body.itemInfo.adultMetadata.faceClusters, []);
  assert.deepStrictEqual(body.itemInfo.adultMetadata.unknownFaces, []);
  assert.strictEqual(body.itemInfo.adultMetadata.galleryImages, undefined);
  assert.strictEqual(body.itemInfo.adultMetadata.ai, undefined);
  await app.close();
});

test('GET /v1/admin/tasks filters by multiple statuses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  taskStore.createTask({ itemId: 'active-1', actionType: 'transcode', status: 'queued' });
  taskStore.createTask({ itemId: 'active-2', actionType: 'scrape', status: 'executing' });
  taskStore.createTask({ itemId: 'done-1', actionType: 'delete', status: 'done' });

  const res = await app.inject({ method: 'GET', url: '/v1/admin/tasks?statuses=queued,executing&page=1&pageSize=10' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.summary.total, 2);
  assert.deepStrictEqual(new Set(body.tasks.map((t) => t.status)), new Set(['queued', 'executing']));
  assert.strictEqual(body.summary.byStatus.queued, 1);
  assert.strictEqual(body.summary.byStatus.executing, 1);
  assert.strictEqual(body.summary.byStatus.done, undefined);
  await app.close();
});

test('GET /v1/admin/tasks filters by bridge and flow operation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  taskStore.createTask({ itemId: 'optimize-transcode', actionType: 'transcode', status: 'queued' });
  taskStore.createTask({ itemId: 'metadata-scrape', actionType: 'scrape', status: 'queued' });
  taskStore.createTask({ itemId: 'optimize-delete', actionType: 'delete', status: 'queued' });

  const byBridge = await app.inject({ method: 'GET', url: '/v1/admin/tasks?bridgeKind=optimize&page=1&pageSize=10' });
  assert.strictEqual(byBridge.statusCode, 200);
  const bridgeBody = byBridge.json();
  assert.strictEqual(bridgeBody.summary.total, 2);
  assert.deepStrictEqual(new Set(bridgeBody.tasks.map((t) => t.itemId)), new Set(['optimize-transcode', 'optimize-delete']));
  assert.ok(bridgeBody.tasks.every((t) => t.taskBridge.kind === 'optimize'));

  const byOperation = await app.inject({ method: 'GET', url: '/v1/admin/tasks?operationKind=scrape&page=1&pageSize=10' });
  assert.strictEqual(byOperation.statusCode, 200);
  const operationBody = byOperation.json();
  assert.strictEqual(operationBody.summary.total, 1);
  assert.strictEqual(operationBody.tasks[0].itemId, 'metadata-scrape');
  assert.strictEqual(operationBody.tasks[0].flowPlan.operationKind, 'scrape');

  const activeByBridge = await app.inject({ method: 'GET', url: '/v1/tasks?bridgeKind=optimize&activeOnly=1' });
  assert.strictEqual(activeByBridge.statusCode, 200);
  assert.deepStrictEqual(new Set(activeByBridge.json().tasks.map((t) => t.itemId)), new Set(['optimize-transcode', 'optimize-delete']));

  const activeByOperation = await app.inject({ method: 'GET', url: '/v1/tasks?operationKind=transcode&activeOnly=1' });
  assert.strictEqual(activeByOperation.statusCode, 200);
  assert.deepStrictEqual(activeByOperation.json().tasks.map((t) => t.itemId), ['optimize-transcode']);
  await app.close();
});

// ── SubLibraries ──────────────────────────────────────────────────────────────

test('GET /v1/admin/sublibraries returns list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/sublibraries' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.subLibraries));
  await app.close();
});

// ── Emby servers ──────────────────────────────────────────────────────────────

test('GET /v1/admin/emby/servers returns list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/emby/servers' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.servers));
  await app.close();
});

// ── Transcode config ──────────────────────────────────────────────────────────

test('GET /v1/admin/transcode/config returns config', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/transcode/config' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok('transcodeTempRoot' in body);
  assert.ok('ffmpegPath' in body);
  await app.close();
});

test('POST /v1/admin/sublibraries creates adult Japanese JAV folder library', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
      scrapeSettleSeconds: 99,
      scrapeEnabled: true,
      scanIntervalMinutes: 10,
    },
  });

  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.strictEqual(body.source, 'folder');
  assert.strictEqual(body.mediaType, 'adult');
  assert.strictEqual(body.adultRegion, 'japanese_jav');
  assert.strictEqual(body.scraperType, 'shelfdeck_japanese_jav');
  assert.strictEqual(body.watchRoot, watchRoot);
  assert.strictEqual(body.scrapeSettleSeconds, undefined);
  assert.strictEqual(body.scrapeEnabled, undefined, 'new adult libraries should not write a private scrape gate');
  assert.strictEqual(body.scanIntervalMinutes, undefined, 'new adult libraries should not write a private scan interval');
  await app.close();
});

test('PATCH /v1/admin/sublibraries cannot reintroduce adult private scheduling fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = create.json();

  const patch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/sublibraries/${subLib.uuid}`,
    payload: { scrapeEnabled: true, scanIntervalMinutes: 3, name: 'JAV Renamed' },
  });
  assert.strictEqual(patch.statusCode, 200);
  const body = patch.json();
  assert.strictEqual(body.name, 'JAV Renamed');
  assert.strictEqual(body.scrapeEnabled, undefined);
  assert.strictEqual(body.scanIntervalMinutes, undefined);

  const list = await app.inject({ method: 'GET', url: '/v1/admin/sublibraries' });
  const saved = list.json().subLibraries.find((sl) => sl.uuid === subLib.uuid);
  assert.strictEqual(saved.scrapeEnabled, undefined);
  assert.strictEqual(saved.scanIntervalMinutes, undefined);
  await app.close();
});

test('PATCH /v1/admin/sublibraries rejects metadataGate that does not cover strategy inputs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    embyServers: { emby: { baseUrl: 'http://emby.local', apiKey: 'token', userId: 'user' } },
    subLibraries: [{
      uuid: 'movie-lib',
      name: 'Movies',
      source: 'emby',
      mediaType: 'movie',
      embyServerId: 'emby',
      sectionId: '1',
      ruleTemplateId: 'rating_strategy',
    }],
    ruleTemplates: [{
      id: 'rating_strategy',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'or', conditions: [['userRating', '=', 4], ['doubanRating', '=', 4]] }],
        action: 'transcode',
        actionParams: { targetBitrate: 4, targetCodec: 'h265' },
      }],
    }],
  }));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/sublibraries/movie-lib',
    payload: {
      metadataGate: {
        all: ['identity.itemId', 'identity.name', 'media.path'],
      },
    },
  });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'METADATA_GATE_CONTRACT_BROKEN');
  assert.match(res.json().error.message, /decision\.rating/);
  assert.match(res.json().error.message, /media\.duration/);
  await app.close();
});

test('POST /v1/admin/sublibraries/:uuid/actions/scan is removed and has no side effects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = create.json();
  fs.writeFileSync(path.join(watchRoot, 'MVSD-175.mp4'), 'fake-video');

  const scan = await app.inject({ method: 'POST', url: `/v1/admin/sublibraries/${subLib.uuid}/actions/scan` });
  assert.strictEqual(scan.statusCode, 410);
  assert.strictEqual(scan.json().error.code, 'SUBLIBRARY_SCAN_REMOVED');

  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib.statusCode, 200);
  assert.strictEqual(lib.json().total, 0, 'removed scan should not upsert items');

  const ingestTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=ingest' });
  assert.strictEqual(ingestTasks.statusCode, 200);
  assert.strictEqual(ingestTasks.json().tasks.length, 0, 'removed scan should not create ingest tasks');
  await app.close();
});

test('POST /v1/admin/sublibraries creates adult western folder library', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'us');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'US Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'western_adult',
      scraperType: 'western_builtin',
      watchRoot,
      scrapeEnabled: true,
      scanIntervalMinutes: 10,
    },
  });

  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.strictEqual(body.source, 'folder');
  assert.strictEqual(body.mediaType, 'adult');
  assert.strictEqual(body.adultRegion, 'western_adult');
  assert.strictEqual(body.scraperType, 'western_builtin');
  assert.strictEqual(body.ruleTemplateId, 'adult_western_default');
  assert.strictEqual(body.scrapeEnabled, undefined, 'new adult libraries should not write a private scrape gate');
  assert.strictEqual(body.scanIntervalMinutes, undefined, 'new adult libraries should not write a private scan interval');
  await app.close();
});

test('legacy adult private scheduling sub-library fields are migrated out of config', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    subLibraries: [{
      uuid: 'legacy-adult',
      name: 'Legacy Adult',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'western_adult',
      scraperType: 'western_builtin',
      watchRoot: path.join(dir, 'us'),
      scrapeEnabled: true,
      scanIntervalMinutes: 10,
      scheduleMode: 'full_auto',
    }],
  }, null, 2));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(res.statusCode, 200);
  const subLib = res.json().subLibraries.find((sl) => sl.uuid === 'legacy-adult');
  assert.ok(subLib);
  assert.strictEqual(subLib.scrapeEnabled, undefined);
  assert.strictEqual(subLib.scanIntervalMinutes, undefined);
  await app.close();
});

test('western adult ingest uses path identity before scrape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'us');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'US Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'western_adult',
      scraperType: 'western_builtin',
      watchRoot,
    },
  });
  const subLib = create.json();
  fs.writeFileSync(path.join(watchRoot, 'Loft.Scene.01.mp4'), 'fake-video');
  const adultLibraryService = require('../src/adultLibraryService');
  const task = adultLibraryService.enqueueIngestTask(subLib, path.join(watchRoot, 'Loft.Scene.01.mp4'), { source: 'manual', force: true });
  assert.ok(task, 'explicit ingest action creates an ingest task');

  const beforeIngest = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(beforeIngest.json().total, 0, 'ingest should not upsert western items before it runs');

  const ingestTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=ingest' });
  const taskStore = require('../src/taskStore');
  const ingestFlow = require('../src/ingestFlowExecutor');
  ingestFlow.setScheduler({
    reportStatus: (id, status) => taskStore.updateTask(id, { status }),
    pauseForConfirm: () => {},
  });
  await ingestFlow.driveTask(ingestTasks.json().tasks[0].id);

  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  const item = lib.json().items[0];
  assert.strictEqual(item.adultMetadata.region, 'western_adult');
  // 番号 is now self-assigned metadata (UNK-NNN placeholder) at ingest, not ''.
  assert.ok(/^UNK-\d+$/.test(item.adultMetadata.adultId), 'western adult gets an UNK placeholder 番号 at ingest');
  assert.strictEqual(item.adultMetadata.scrapeStatus, 'pending');
  assert.ok(item.assetKey.includes(':adult:'), 'western adult uses itemId-based identity (番号 is metadata, not the key)');

  const tasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape&includeHistory=1' });
  assert.strictEqual(
    tasks.json().tasks.some((t) => t.itemId === item.itemId && t.actionType === 'scrape'),
    false,
    'ingest ends at 已入库 and must not create a scrape task',
  );
  await app.close();
});

test('adult directory discovery is inventory only and ingest does not create scrape follow-up', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    smartTaskEnabledActions: ['ingest', 'scrape'],
    adultLibrary: { settleSeconds: 0 },
    taskAdmission: {
      cooldownHoursByAction: { ingest: 0, scrape: 0 },
      maxQueuedByAction: { ingest: 10, scrape: 10 },
    },
  }, null, 2));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV No Auto Scrape',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = create.json();
  const adultLibraryService = require('../src/adultLibraryService');
  fs.writeFileSync(path.join(watchRoot, 'MVSD-175.mp4'), 'fake-video');

  const candidates = adultLibraryService.listIngestCandidates();
  assert.strictEqual(candidates.length, 1, 'folder discovery exposes a single ingest candidate');
  assert.strictEqual(candidates[0].itemInfo.actionType, undefined, 'candidate discovery does not pre-create a task shape');
  assert.strictEqual(candidates[0].itemInfo.subLibraryId, subLib.uuid);

  const ingestTask = adultLibraryService.enqueueIngestTask(subLib, path.join(watchRoot, 'MVSD-175.mp4'), { source: 'auto' });
  assert.ok(ingestTask, 'auto ingest can still be admitted through TaskAdmission when ingest is enabled');
  assert.strictEqual(ingestTask.taskBridge.kind, 'metadata');
  assert.strictEqual(ingestTask.flowPlan.direction, 'metadata.ingest');
  assert.strictEqual(ingestTask.flowPlan.operationKind, 'ingest');

  const ingestTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=ingest' });
  const taskStore = require('../src/taskStore');
  const ingestFlow = require('../src/ingestFlowExecutor');
  ingestFlow.setScheduler({
    reportStatus: (id, status) => taskStore.updateTask(id, { status }),
    pauseForConfirm: () => {},
  });
  await ingestFlow.driveTask(ingestTasks.json().tasks[0].id);

  const scrapeTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape&includeHistory=1' });
  assert.strictEqual(scrapeTasks.statusCode, 200);
  assert.strictEqual(scrapeTasks.json().tasks.length, 0, 'ingest must not create scrape even when scrape is globally enabled');

  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  const item = lib.json().items[0];
  const manual = await app.inject({ method: 'POST', url: `/v1/admin/adult/items/${item.itemId}/actions/rescrape` });
  assert.strictEqual(manual.statusCode, 201, 'manual rescrape remains an explicit user action');
  await app.close();
});

test('sub-library directory scan endpoint is removed and discovery creates no task when automatic allow-list is empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    smartTaskEnabledActions: [],
    adultLibrary: { settleSeconds: 0 },
    taskAdmission: {
      cooldownHoursByAction: { ingest: 0, scrape: 0 },
      maxQueuedByAction: { ingest: 10, scrape: 10 },
    },
  }, null, 2));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Disabled Auto',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = create.json();
  const adultLibraryService = require('../src/adultLibraryService');
  fs.writeFileSync(path.join(watchRoot, 'MVSD-176.mp4'), 'fake-video');

  const candidates = adultLibraryService.listIngestCandidates();
  assert.strictEqual(candidates.length, 1, 'candidate discovery is inventory only and does not create tasks');
  const ingestTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=ingest' });
  assert.strictEqual(ingestTasks.json().tasks.length, 0, 'candidate discovery never creates ingest tasks');
  const scrapeTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  assert.strictEqual(scrapeTasks.json().tasks.length, 0, 'candidate discovery never creates scrape tasks');

  const manualScan = await app.inject({ method: 'POST', url: `/v1/admin/sublibraries/${subLib.uuid}/actions/scan` });
  assert.strictEqual(manualScan.statusCode, 410);
  assert.strictEqual(manualScan.json().error.code, 'SUBLIBRARY_SCAN_REMOVED');
  await app.close();
});

test('adult directory discovery does not avalanche item or task creation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });

  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    ingestConcurrency: 1,
    scrapeConcurrency: 1,
    adultLibrary: { settleSeconds: 0 },
    taskAdmission: {
      defaultCooldownHours: 48,
      cooldownHoursByAction: { ingest: 6, scrape: 6 },
      maxQueuedByAction: { ingest: 5, scrape: 2 },
    },
  }, null, 2));

  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: {
      name: 'JAV Cap Test',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      scraperType: 'shelfdeck_japanese_jav',
      watchRoot,
      ruleTemplateId: 'adult_jav_default',
    },
  });
  const subLib = create.json();
  for (let i = 1; i <= 12; i++) {
    fs.writeFileSync(path.join(watchRoot, `MVSD-${String(i).padStart(3, '0')}.mp4`), 'fake-video');
  }

  const adultLibraryService = require('../src/adultLibraryService');
  const candidates = adultLibraryService.listIngestCandidates();
  assert.strictEqual(candidates.length, 12);

  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib.json().total, 0, 'candidate discovery should not write library items directly');

  const ingestTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=ingest' });
  assert.strictEqual(ingestTasks.json().tasks.length, 0, 'candidate discovery should not create ingest tasks');
  const scrapeTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  assert.strictEqual(scrapeTasks.json().tasks.length, 0, 'candidate discovery should not create scrape tasks');
  await app.close();
});

test('adult people API stores western people in service data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/adult/people',
    payload: {
      name: 'Skin Diamond',
      aliases: ['Skin.Diamond'],
      referenceAssetIds: ['asset-1'],
    },
  });
  assert.strictEqual(create.statusCode, 201);
  const person = create.json();
  assert.ok(person.personId);
  assert.strictEqual(person.name, 'Skin Diamond');
  assert.deepStrictEqual(person.aliases, ['Skin.Diamond']);
  assert.strictEqual(person.adultRegion, 'western_adult');

  const list = await app.inject({ method: 'GET', url: '/v1/admin/adult/people?adultRegion=western_adult' });
  assert.strictEqual(list.statusCode, 200);
  assert.strictEqual(list.json().people.length, 1);
  assert.strictEqual(list.json().people[0].name, 'Skin Diamond');

  const patch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/adult/people/${person.personId}`,
    payload: {
      aliases: ['Skin.Diamond', 'Skin Diamond'],
      referenceAssetIds: ['asset-2'],
    },
  });
  assert.strictEqual(patch.statusCode, 200);
  assert.deepStrictEqual(patch.json().aliases, ['Skin.Diamond', 'Skin Diamond']);
  assert.deepStrictEqual(patch.json().referenceAssetIds, ['asset-2']);

  const del = await app.inject({ method: 'DELETE', url: `/v1/admin/adult/people/${person.personId}` });
  assert.strictEqual(del.statusCode, 200);
  assert.strictEqual(del.json().ok, true);
  const empty = await app.inject({ method: 'GET', url: '/v1/admin/adult/people' });
  assert.strictEqual(empty.json().people.length, 0);
  await app.close();
});

test('adult people from-face API uses service-owned unknown face cluster', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [{
      itemId: 'western-face-item',
      name: 'Unknown Person - Scene',
      path: path.join(dir, 'scene.mkv'),
      source: 'adult_folder',
      subLibraryId: 'sl-western',
      assetKey: 'sl-western:path:scene',
      type: 'movie',
      adultMetadata: {
        region: 'western_adult',
        unknownFaces: [{
          clusterId: 'face-cluster-1',
          embedding: [0.1, 0.2, 0.3],
          sampleImageBase64: Buffer.from('jpg').toString('base64'),
          confidence: 0.88,
        }],
      },
    }],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/adult/people/from-face',
    payload: {
      itemId: 'western-face-item',
      clusterId: 'face-cluster-1',
      name: 'Skin Diamond',
      aliases: ['Skin.Diamond'],
    },
  });
  assert.strictEqual(res.statusCode, 201, res.body);
  const person = res.json();
  assert.strictEqual(person.name, 'Skin Diamond');
  assert.deepStrictEqual(person.referenceAssetIds, ['western-face-item']);
  assert.strictEqual(person.referenceFaces.length, 1);
  assert.deepStrictEqual(person.referenceFaces[0].embedding, [0.1, 0.2, 0.3]);
  assert.strictEqual(person.referenceFaces[0].sourceItemId, 'western-face-item');
  await app.close();
});

test('adult people from-image API creates and replaces a confirmed reference face', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const localAi = require('../src/services/westernAdultLocalAiService');
  const originalCreateReferenceFace = localAi.createReferenceFace;
  localAi.createReferenceFace = async () => ({
    faceId: 'ref-face-1',
    embedding: [0.9, 0.1, 0.2],
    detectionScore: 0.93,
    faceCount: 1,
    bbox: [10, 20, 110, 140],
  });

  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const imageBase64 = Buffer.from('fake-jpg').toString('base64');
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/adult/people/from-image',
    payload: { name: 'Tia Ling', imageBase64 },
  });
  assert.strictEqual(created.statusCode, 201);
  const person = created.json();
  assert.strictEqual(person.name, 'Tia Ling');
  assert.strictEqual(person.referenceFaces.length, 1);
  assert.deepStrictEqual(person.referenceFaces[0].embedding, [0.9, 0.1, 0.2]);
  assert.strictEqual(person.referenceFaces[0].sampleImageBase64, imageBase64);

  localAi.createReferenceFace = async () => ({
    faceId: 'ref-face-1-duplicate',
    embedding: [0.9, 0.1, 0.2],
    detectionScore: 0.93,
    faceCount: 1,
  });
  const duplicate = await app.inject({
    method: 'POST',
    url: '/v1/admin/adult/people/from-image',
    payload: { name: 'Tia Ling', imageBase64 },
  });
  assert.strictEqual(duplicate.statusCode, 201);
  assert.strictEqual(duplicate.json().personId, person.personId, 'same-name actor is merged');
  assert.strictEqual(duplicate.json().referenceFaces.length, 1, 'same actor image is not duplicated');

  const summary = await app.inject({ method: 'GET', url: '/v1/admin/adult/people?adultRegion=western_adult' });
  assert.strictEqual(summary.statusCode, 200);
  assert.strictEqual(summary.json().people[0].referenceFaceCount, 1);
  assert.strictEqual(summary.json().people[0].referenceFaces, undefined);
  assert.ok(!summary.body.includes(imageBase64), 'people list should not inline reference image base64');

  const image = await app.inject({ method: 'GET', url: `/v1/admin/adult/people/${person.personId}/reference-image` });
  assert.strictEqual(image.statusCode, 200);
  assert.strictEqual(image.headers['content-type'], 'image/jpeg');
  assert.strictEqual(image.body, 'fake-jpg');

  localAi.createReferenceFace = async () => ({
    faceId: 'ref-face-2',
    embedding: [0.3, 0.4, 0.5],
    detectionScore: 0.88,
    faceCount: 1,
  });
  const replaced = await app.inject({
    method: 'POST',
    url: '/v1/admin/adult/people/from-image',
    payload: { personId: person.personId, name: 'Tia Ling', imageBase64: Buffer.from('better-jpg').toString('base64') },
  });
  assert.strictEqual(replaced.statusCode, 200);
  assert.strictEqual(replaced.json().referenceFaces.length, 1, 'confirmed image replaces old reference by default');
  assert.deepStrictEqual(replaced.json().referenceFaces[0].embedding, [0.3, 0.4, 0.5]);

  localAi.createReferenceFace = originalCreateReferenceFace;
  delete process.env.CONTROL_PLANE_DATA_DIR;
  await app.close();
});

test('adult config masks provider keys and preserves masked values on save', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    adultLibrary: {
      scanIntervalMinutes: 5,
      western: {
        metadataApiKey: 'metadata-secret',
        stashBoxApiKey: 'stash-secret',
        tmdbApiKey: 'tmdb-secret',
      },
    },
  }, null, 2));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const admin = await app.inject({ method: 'GET', url: '/v1/admin/adult/config' });
  assert.strictEqual(admin.statusCode, 200);
  assert.strictEqual(admin.json().western.metadataApiKey, '********');
  assert.strictEqual(admin.json().western.stashBoxApiKey, '********');
  assert.strictEqual(admin.json().western.tmdbApiKey, '********');
  assert.strictEqual(admin.json().scanIntervalMinutes, undefined);

  const globalConfig = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(globalConfig.statusCode, 200);
  assert.strictEqual(globalConfig.json().adultLibrary.western.stashBoxApiKey, '********');
  assert.strictEqual(globalConfig.json().adultLibrary.scanIntervalMinutes, undefined);

  const patch = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/adult/config',
    payload: {
      scanIntervalMinutes: 3,
      western: {
        metadataApiKey: '',
        stashBoxApiKey: '********',
        tmdbApiKey: 'tmdb-new',
      },
    },
  });
  assert.strictEqual(patch.statusCode, 200);
  assert.strictEqual(patch.json().western.metadataApiKey, '');
  assert.strictEqual(patch.json().western.stashBoxApiKey, '********');
  assert.strictEqual(patch.json().western.tmdbApiKey, '********');
  assert.strictEqual(patch.json().scanIntervalMinutes, undefined);

  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.strictEqual(stored.adultLibrary.scanIntervalMinutes, undefined);
  assert.strictEqual(stored.adultLibrary.western.metadataApiKey, '', 'blank input clears the key');
  assert.strictEqual(stored.adultLibrary.western.stashBoxApiKey, 'stash-secret', 'masked input preserves the existing key');
  assert.strictEqual(stored.adultLibrary.western.tmdbApiKey, 'tmdb-new', 'new input replaces the key');
  await app.close();
});

test('adult actor image search includes stash-box GraphQL performer images', async () => {
  const service = require('../src/services/adultActorImageSearchService');
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async (url, opts = {}) => {
    fetchCount++;
    assert.strictEqual(String(url), 'https://stash.example/graphql');
    assert.strictEqual(opts.method, 'POST');
    assert.match(String(opts.headers.ApiKey), /secret/);
    const body = JSON.parse(opts.body);
    assert.strictEqual(body.variables.term, 'Indie Performer');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          searchPerformer: [{
            id: 'perf-1',
            name: 'Indie Performer',
            images: [{ url: 'https://img.example/indie.jpg', width: 900, height: 1200 }],
          }],
        },
      }),
    };
  };

  try {
    const result = await service.searchActorImages({
      name: 'Indie Performer',
      limit: 3,
      config: {
        adultLibrary: {
          western: {
            stashBoxGraphqlUrl: 'https://stash.example/graphql',
            stashBoxApiKey: 'secret',
            metadataApiBaseUrl: '',
          },
        },
      },
    });
    assert.strictEqual(result.candidates[0].source, 'stashbox:tpdb');
    assert.strictEqual(result.candidates[0].imageUrl, 'https://img.example/indie.jpg');
    assert.strictEqual(result.candidates[0].width, 900);
    assert.ok(result.candidates[0].qualityReasons.includes('adult_source'));
    assert.ok(result.candidates[0].qualityReasons.includes('name_exact'));
    assert.strictEqual(result.diagnostics.adultFallback, 'skipped');
    assert.strictEqual(result.diagnostics.publicFallback, 'skipped');
    assert.strictEqual(fetchCount, 1, 'exact stash-box hit should not query lower-priority sources');
  } finally {
    global.fetch = originalFetch;
  }
});

test('adult actor image search uses public fallback only when adult sources are weak', async () => {
  const service = require('../src/services/adultActorImageSearchService');
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, opts = {}) => {
    seen.push(String(url));
    if (String(url) === 'https://stash.example/graphql') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { searchPerformer: [] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: { get: () => '' },
    };
  };

  try {
    const result = await service.searchActorImages({
      name: 'Fallback Performer',
      limit: 3,
      config: {
        adultLibrary: {
          western: {
            stashBoxGraphqlUrl: 'https://stash.example/graphql',
            metadataApiBaseUrl: 'https://metadata.example',
          },
        },
      },
    });
    assert.strictEqual(result.candidates.length, 0);
    assert.strictEqual(result.diagnostics.adultFallback, 'searched');
    assert.strictEqual(result.diagnostics.publicFallback, 'searched');
    assert.ok(seen.some((url) => url.startsWith('https://www.wikidata.org/')), 'public fallback should query Wikidata');
  } finally {
    global.fetch = originalFetch;
  }
});

test('adult actor image search reuses JAV proxy for outbound candidate sources', async () => {
  const service = require('../src/services/adultActorImageSearchService');
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, opts = {}) => {
    seen.push(String(url));
    assert.ok(opts.dispatcher, `expected proxy dispatcher for ${url}`);
    if (String(url) === 'https://stash.example/graphql') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            searchPerformer: [{
              id: 'perf-2',
              name: 'Proxy Performer',
              images: [{ url: 'https://img.example/proxy.jpg', width: 800, height: 1100 }],
            }],
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const result = await service.searchActorImages({
      name: 'Proxy Performer',
      limit: 3,
      config: {
        adultLibrary: {
          japaneseJav: { proxyServer: 'http://proxy.example:7890' },
          western: {
            stashBoxGraphqlUrl: 'https://stash.example/graphql',
            stashBoxApiKey: '',
            metadataApiBaseUrl: '',
          },
        },
      },
    });
    assert.strictEqual(result.proxyUsed, true);
    assert.ok(seen.includes('https://stash.example/graphql'));
    assert.strictEqual(result.candidates[0].imageUrl, 'https://img.example/proxy.jpg');
  } finally {
    global.fetch = originalFetch;
  }
});

test('adult actor image search falls back to findPerformers stash-box schema', async () => {
  const service = require('../src/services/adultActorImageSearchService');
  const originalFetch = global.fetch;
  const seenQueries = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url) === 'https://stash.example/graphql') {
      const body = JSON.parse(opts.body);
      seenQueries.push(body.query);
      if (body.query.includes('searchPerformer')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ errors: [{ message: 'Cannot query field "searchPerformer"' }] }),
        };
      }
      assert.strictEqual(body.variables.term, 'Schema Performer');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            findPerformers: {
              performers: [{
                id: 'perf-3',
                name: 'Schema Performer',
                image: 'https://img.example/schema.jpg',
              }],
            },
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const result = await service.searchActorImages({
      name: 'Schema Performer',
      limit: 3,
      config: {
        adultLibrary: {
          western: {
            stashBoxGraphqlUrl: 'https://stash.example/graphql',
            metadataApiBaseUrl: '',
          },
        },
      },
    });
    assert.ok(seenQueries.some((q) => q.includes('searchPerformer')));
    assert.ok(seenQueries.some((q) => q.includes('findPerformers')));
    assert.strictEqual(result.candidates[0].source, 'stashbox:tpdb');
    assert.strictEqual(result.candidates[0].imageUrl, 'https://img.example/schema.jpg');
  } finally {
    global.fetch = originalFetch;
  }
});

test('queued scrape task respects sub-library autoExecute=false after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskScheduler = require('../src/taskScheduler');
  const taskStore = require('../src/taskStore');
  const configStore = require('../src/configStore');
  taskScheduler.stopScheduler();

  const config = configStore.loadConfig();
  config.subLibraries = [{
    uuid: 'adult-western-manual',
    name: 'US Manual',
    scheduleMode: 'custom',
    autoCreate: true,
    autoExecute: false,
  }];
  configStore.saveConfig(config);

  const task = taskStore.createTask({
    itemId: 'manual-scrape-item',
    actionType: 'scrape',
    status: 'queued',
    itemInfo: { subLibraryId: 'adult-western-manual', name: 'Queued Scrape' },
  });

  await taskScheduler.scheduleRound();
  assert.strictEqual(taskStore.getTask(task.id).status, 'pending_manual');
  await app.close();
});

test('POST /v1/admin/adult/items/:itemId/actions/rescrape re-enqueues a failed scrape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: { name: 'JAV Test', source: 'folder', mediaType: 'adult', adultRegion: 'japanese_jav', scraperType: 'shelfdeck_japanese_jav', watchRoot, ruleTemplateId: 'adult_jav_default' },
  });
  const subLib = create.json();
  subLib.scrapeEnabled = false;
  const configStore = require('../src/configStore');
  const cfg = configStore.loadConfig();
  cfg.subLibraries = (cfg.subLibraries || []).map((sl) => sl.uuid === subLib.uuid ? { ...sl, scrapeEnabled: false } : sl);
  configStore.saveConfig(cfg);
  const filePath = path.join(watchRoot, 'MVSD-175.mp4');
  fs.writeFileSync(filePath, 'fake-video');

  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath);
  const itemId = item.itemId;

  // Simulate a prior failed scrape: the original scrape task failed_hard and
  // the library item was marked failed. A real scrape failure does both.
  const taskStore = require('../src/taskStore');
  let origTask = taskStore.getTasks({ itemId }).find((t) => t.actionType === 'scrape');
  if (!origTask) {
    origTask = taskStore.createTask({
      itemId,
      itemName: item.name,
      actionType: 'scrape',
      status: 'failed_hard',
      itemInfo: adultLibraryService.itemInfoFromItem(item),
    });
  }
  taskStore.updateTask(origTask.id, { status: 'failed_hard' });
  adultLibraryService.markScrapeFailed(itemId, 'jav321 down');

  const rescrape = await app.inject({ method: 'POST', url: `/v1/admin/adult/items/${itemId}/actions/rescrape` });
  assert.strictEqual(rescrape.statusCode, 201);
  assert.ok(rescrape.json().taskId, 'rescrape returns a task id');
  assert.strictEqual(rescrape.json().task.id, rescrape.json().taskId);
  assert.strictEqual(rescrape.json().taskBridge.kind, 'metadata');
  assert.strictEqual(rescrape.json().flowPlan.operationKind, 'scrape');
  assert.strictEqual(rescrape.json().requestedIntent.bridgeKind, 'metadata');
  assert.strictEqual(rescrape.json().requestedIntent.preferredOperation, 'scrape');
  assert.strictEqual(rescrape.json().requestedIntent.intentMode, 'adult_rescrape');
  assert.strictEqual(rescrape.json().controlState.state, 'queued');
  assert.strictEqual(rescrape.json().controlState.actions.pause.enabled, true);

  const taskDetail = await app.inject({ method: 'GET', url: `/v1/tasks/${rescrape.json().taskId}` });
  assert.strictEqual(taskDetail.statusCode, 200);
  assert.strictEqual(taskDetail.json().requestedIntent.intentMode, 'adult_rescrape');
  assert.strictEqual(taskDetail.json().taskBridge.kind, 'metadata');

  // resetScrapeStatus cleared the failure marker.
  const lib2 = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib2.json().items[0].adultMetadata.scrapeStatus, 'pending');

  // A second rescrape while a task is active → 409.
  const dup = await app.inject({ method: 'POST', url: `/v1/admin/adult/items/${itemId}/actions/rescrape` });
  assert.strictEqual(dup.statusCode, 409);
  assert.strictEqual(dup.json().error.code, 'TASK_CONFLICT');
  assert.strictEqual(dup.json().error.message, 'active_task_exists');
  assert.strictEqual(dup.json().admission.operation, 'scrape');
  assert.strictEqual(dup.json().admission.reason, 'active_task_exists');
  assert.strictEqual(dup.json().admission.bridgeKind, 'metadata');
  assert.strictEqual(dup.json().admission.activeTaskId, rescrape.json().taskId);
  assert.strictEqual(dup.json().activeTask.id, rescrape.json().taskId);
  assert.strictEqual(dup.json().activeTask.taskBridge.kind, 'metadata');
  assert.strictEqual(dup.json().activeTask.flowPlan.operationKind, 'scrape');
  assert.strictEqual(dup.json().activeTask.controlState.state, 'queued');
  assert.strictEqual(dup.json().businessFlowDecision.blockedReasons.scrape, 'active_task_exists');
  assert.strictEqual(dup.json().businessFlowDecision.activeTaskBridge, 'metadata');
  assert.strictEqual(dup.json().businessFlowDecision.activeFlowOperation, 'scrape');
  await app.close();
});

test('POST /v1/admin/adult/items/:itemId/actions/rescrape 404 for unknown item', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/admin/adult/items/nope/actions/rescrape' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

test('scrape failure marks item failed_hard and item scrapeStatus=failed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  fs.writeFileSync(path.join(watchRoot, 'MVSD-175.mp4'), 'fake-video');

  // Stub the scraper before loading the executor so it throws.
  const scraperPath = require.resolve('../src/services/japaneseJavScraper');
  delete require.cache[scraperPath];
  require.cache[scraperPath] = { exports: { scrapeJapaneseJav: async () => { throw new Error('jav321 unreachable'); }, fetchBinary: async () => { throw new Error('no net'); }, abort: () => false, normalizeAdultId: (v) => v } };

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const taskStore = require('../src/taskStore');
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  // Fresh executor picks up the stubbed scraper.
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const cfg = configStore.loadConfig();
  // Register an adult folder sublibrary pointing at watchRoot.
  const sl = {
    uuid: crypto.randomUUID(), name: 'JAV', source: 'folder', mediaType: 'adult',
    adultRegion: 'japanese_jav', scraperType: 'shelfdeck_japanese_jav',
    watchRoot, scrapeEnabled: true, enabled: true, scheduleMode: 'full_auto',
    autoCreate: true, autoExecute: true, ruleTemplateId: 'adult_jav_default',
    videoExtensions: cfg.adultLibrary.videoExtensions,
  };
  configStore.patchConfig({ subLibraries: [sl] });

  const item = await adultLibraryService.upsertFileItem(sl, path.join(watchRoot, 'MVSD-175.mp4'));
  const task = taskStore.createTask({
    itemId: item.itemId, itemName: item.name, actionType: 'scrape',
    status: 'executing', itemInfo: adultLibraryService.itemInfoFromItem(item),
    resumePoint: 'scrape_executing',
  });

  const reported = [];
  scrapeFlow.setScheduler({ reportStatus: (id, status, prog) => reported.push({ id, status, prog }) });
  await scrapeFlow.driveTask(task.id);

  assert.ok(reported.some((r) => r.status === 'failed_hard'), 'scheduler received failed_hard');
  const lib = require('../src/mediaLibraryService').getLibrary();
  const after = lib.items.find((it) => it.itemId === item.itemId);
  assert.strictEqual(after.adultMetadata.scrapeStatus, 'failed');
  assert.ok(after.adultMetadata.scrapeError, 'scrapeError recorded');

  // Cleanup mock so other tests get the real module back.
  delete require.cache[scraperPath];
  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('standard scrape fails current task when metadataGate remains unmet after repair', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const configStore = require('../src/configStore');
  const taskStore = require('../src/taskStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const subLibraryId = 'standard-movie-lib';
  configStore.patchConfig({
    subLibraries: [{
      uuid: subLibraryId,
      name: 'Movies',
      source: 'emby',
      mediaType: 'movie',
      enabled: true,
      embyServerId: 'test-emby',
      ruleTemplateId: 'rating_strategy',
      metadataGate: {
        all: [
          'identity.itemId',
          'identity.name',
          'identity.providerId',
          'media.path',
          'media.duration',
          'media.bitrate',
          'media.resolution',
          'media.codec',
          'decision.rating',
        ],
      },
    }],
    ruleTemplates: [{
      id: 'rating_strategy',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'or', conditions: [['userRating', '=', 4], ['doubanRating', '=', 4]] }],
        action: 'transcode',
        actionParams: { targetBitrate: 4, targetCodec: 'h265' },
      }],
    }],
  });

  mediaLibraryService.upsertItems(subLibraryId, [{
    itemId: 'emby-missing-provider',
    sourceId: 'emby-missing-provider',
    name: 'Missing Provider Movie',
    type: 'movie',
    path: '/media/missing-provider.mkv',
    size: 1024 * 1024,
    duration: 3600,
    bitrate: 4_000_000,
    resolution: '1920x1080',
    codec: 'h264',
    watched: true,
    userRating: 4,
  }], { fullSync: true });
  const item = mediaLibraryService.getLibrary().items.find((it) => it.subLibraryId === subLibraryId);
  const originalComplete = mediaLibraryService.completeEmbyItemMetadata;
  mediaLibraryService.completeEmbyItemMetadata = async () => mediaLibraryService.getLibraryItem(item.itemId);

  const task = taskStore.createTask({
    itemId: item.itemId,
    itemName: item.name,
    actionType: 'scrape',
    status: 'executing',
    itemInfo: { ...item },
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status, progress) => { taskStore.updateTask(tid, { status, progress }); } });
  try {
    await scrapeFlow.driveTask(task.id);
  } finally {
    mediaLibraryService.completeEmbyItemMetadata = originalComplete;
  }

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'failed_hard');
  assert.strictEqual(afterTask.phase, 'failed_hard');
  assert.strictEqual(afterTask.resumePoint, 'scrape_executing');
  assert.strictEqual(afterTask.scrapeVerification.ok, false);
  assert.ok(afterTask.scrapeVerification.metadataMissingReasons.includes('identity.providerId'));
  assert.ok(afterTask.metadataGateFailure.metadataMissingReasons.includes('identity.providerId'));
  assert.ok(afterTask.logs.some((l) => l.level === 'error' && l.msg.includes('Metadata repair incomplete')));

  const events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 50, orderDir: 'asc' }).events;
  const gateEvent = events.find((e) => e.eventType === 'scrape.metadata_gate_failed');
  assert.ok(gateEvent, 'metadata gate failure event recorded');
  assert.ok(gateEvent.payload.metadataMissingReasons.includes('identity.providerId'));
  const failedEvent = events.find((e) => e.eventType === 'task.failed');
  assert.ok(failedEvent, 'task failed event recorded');
  assert.ok(failedEvent.payload.failureSummary.message.includes('Metadata repair incomplete'));

  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('scrape completion verification blocks done when exit gate fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const configStore = require('../src/configStore');
  const taskStore = require('../src/taskStore');
  const libraryStore = require('../src/libraryStore');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const subLibraryId = 'adult-review-lib';
  configStore.patchConfig({
    subLibraries: [{
      uuid: subLibraryId,
      name: 'Adult Review',
      source: 'folder',
      mediaType: 'adult',
      adultRegion: 'japanese_jav',
      enabled: true,
      scrapeEnabled: true,
      watchRoot: dir,
      japaneseJav: { writeNfo: true },
    }],
  });
  libraryStore.saveLibrary({
    version: 1,
    cachedAt: new Date().toISOString(),
    items: [{
      itemId: 'adult-incomplete-exit',
      subLibraryId,
      name: 'MVSD-175 Incomplete',
      source: 'adult_folder',
      mediaType: 'adult',
      path: path.join(dir, 'missing.mp4'),
      scraped: true,
      adultMetadata: {
        region: 'japanese_jav',
        scrapeStatus: 'done',
        adultId: 'MVSD-175',
        title: 'MVSD-175 Incomplete',
      },
    }],
  });
  const task = taskStore.createTask({
    itemId: 'adult-incomplete-exit',
    itemName: 'MVSD-175 Incomplete',
    actionType: 'scrape',
    status: 'executing',
    itemInfo: { subLibraryId, source: 'adult_folder' },
    resumePoint: 'scrape_review',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status, progress) => { taskStore.updateTask(tid, { status, progress }); } });
  await scrapeFlow.driveTask(task.id);

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'failed_hard');
  assert.strictEqual(afterTask.phase, 'failed_hard');
  assert.strictEqual(afterTask.resumePoint, 'scrape_executing');
  assert.strictEqual(afterTask.scrapeVerification.ok, false);
  assert.ok(afterTask.scrapeVerification.failures.some((f) => f.code === 'media.exists'));
  assert.ok(afterTask.logs.some((l) => l.level === 'error' && l.msg.includes('Scrape completion verification failed')));

  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('scrape completion verification exception blocks done', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const configStore = require('../src/configStore');
  const taskStore = require('../src/taskStore');
  const libraryStore = require('../src/libraryStore');
  const scrapeVerification = require('../src/scrapeVerification');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const originalVerify = scrapeVerification.verifyScrapedItem;
  scrapeVerification.verifyScrapedItem = () => {
    throw new Error('verification service exploded');
  };

  const subLibraryId = 'standard-verification-exception-lib';
  configStore.patchConfig({
    subLibraries: [{
      uuid: subLibraryId,
      name: 'Verification Exception',
      source: 'emby',
      mediaType: 'movie',
      enabled: true,
      metadataGate: {
        all: ['identity.itemId', 'identity.name', 'identity.providerId', 'media.path', 'media.duration', 'media.bitrate'],
      },
    }],
  });
  libraryStore.saveLibrary({
    version: 1,
    cachedAt: new Date().toISOString(),
    items: [metadataReadyMovie({
      itemId: 'standard-verification-exception',
      subLibraryId,
      name: 'Verification Exception Movie',
      source: 'emby',
      sourceId: 'emby-verification-exception',
      tmdbId: '99901',
      providerIds: { Tmdb: '99901' },
    })],
  });
  const task = taskStore.createTask({
    itemId: 'standard-verification-exception',
    itemName: 'Verification Exception Movie',
    actionType: 'scrape',
    status: 'executing',
    itemInfo: { subLibraryId, source: 'emby' },
    resumePoint: 'scrape_review',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status, progress) => { taskStore.updateTask(tid, { status, progress }); } });
  try {
    await scrapeFlow.driveTask(task.id);
  } finally {
    scrapeVerification.verifyScrapedItem = originalVerify;
  }

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'failed_hard');
  assert.strictEqual(afterTask.phase, 'failed_hard');
  assert.strictEqual(afterTask.resumePoint, 'scrape_executing');
  assert.strictEqual(afterTask.scrapeVerification.ok, false);
  assert.ok(afterTask.scrapeVerification.failures.some((f) => f.code === 'verification.exception'));
  assert.ok(afterTask.logs.some((l) => l.level === 'error' && l.msg.includes('Scrape completion verification failed')));

  const events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 50, orderDir: 'asc' }).events;
  const gateEvent = events.find((e) => e.eventType === 'scrape.metadata_gate_failed');
  assert.ok(gateEvent, 'metadata gate failure event recorded');
  assert.ok(gateEvent.payload.failureCodes.includes('verification.exception'));

  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('scrape fails when poster download fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  const movieDir = path.join(watchRoot, 'MVSD-175.HD');
  fs.mkdirSync(movieDir, { recursive: true });
  fs.writeFileSync(path.join(movieDir, 'MVSD-175.mp4'), 'fake-video');
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const scraperPath = require.resolve('../src/services/japaneseJavScraper');
  delete require.cache[scraperPath];
  require.cache[scraperPath] = {
    exports: {
      scrapeJapaneseJav: async () => ({
        source: 'stub',
        sourceUrl: 'https://example.test/MVSD-175',
        adultId: 'MVSD-175',
        title: 'MVSD-175 Poster Required',
        originalTitle: 'Poster Required',
        posterUrl: 'https://example.test/poster.jpg',
        fanartUrl: 'https://example.test/poster.jpg',
      }),
      fetchBinary: async () => { throw new Error('HTTP 403 Forbidden'); },
      abort: () => false,
      normalizeAdultId: (v) => v,
    },
  };

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const taskStore = require('../src/taskStore');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const sl = {
    uuid: crypto.randomUUID(), name: 'JAV', source: 'folder', mediaType: 'adult',
    adultRegion: 'japanese_jav', scraperType: 'shelfdeck_japanese_jav',
    watchRoot, scrapeEnabled: true, enabled: true, scheduleMode: 'full_auto',
    autoCreate: true, autoExecute: true, ruleTemplateId: 'adult_jav_default',
    japaneseJav: { organizeAfterScrape: true },
  };
  configStore.patchConfig({ subLibraries: [sl] });
  const item = await adultLibraryService.upsertFileItem(sl, path.join(movieDir, 'MVSD-175.mp4'));
  const task = taskStore.createTask({
    itemId: item.itemId, itemName: item.name, actionType: 'scrape',
    status: 'executing', itemInfo: adultLibraryService.itemInfoFromItem(item),
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); } });
  await scrapeFlow.driveTask(task.id);

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'failed_hard');
  assert.strictEqual(afterTask.phase, 'failed_hard');
  assert.ok(afterTask.logs.some((l) => l.msg && l.msg.includes('HTTP 403 Forbidden')));
  const afterItem = require('../src/mediaLibraryService').getLibraryItem(item.itemId);
  assert.strictEqual(afterItem.scraped, false);
  assert.strictEqual(afterItem.adultMetadata.scrapeStatus, 'failed');

  delete require.cache[scraperPath];
  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('successful JAV scrape creates one movie folder and keeps original naming convention', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  const movieDir = path.join(watchRoot, 'MVSD-175.HD');
  fs.mkdirSync(movieDir, { recursive: true });
  const sourceFile = path.join(movieDir, 'MVSD-175.mp4');
  fs.writeFileSync(sourceFile, 'fake-video');
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const scraperPath = require.resolve('../src/services/japaneseJavScraper');
  delete require.cache[scraperPath];
  require.cache[scraperPath] = {
    exports: {
      scrapeJapaneseJav: async () => ({
        source: 'stub',
        sourceUrl: 'https://example.test/MVSD-175',
        adultId: 'MVSD-175',
        title: 'MVSD-175 Some Title',
        originalTitle: 'Some Title',
        posterUrl: 'https://example.test/poster.jpg',
        fanartUrl: 'https://example.test/poster.jpg',
        genres: ['genre'],
        tags: ['tag'],
      }),
      fetchBinary: async () => ({ buffer: Buffer.from('jpg'), contentType: 'image/jpeg', finalUrl: 'https://example.test/poster.jpg' }),
      abort: () => false,
      normalizeAdultId: (v) => v,
    },
  };

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const taskStore = require('../src/taskStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const sl = {
    uuid: crypto.randomUUID(), name: 'JAV', source: 'folder', mediaType: 'adult',
    adultRegion: 'japanese_jav', scraperType: 'shelfdeck_japanese_jav',
    watchRoot, scrapeEnabled: true, enabled: true, scheduleMode: 'full_auto',
    autoCreate: true, autoExecute: true, ruleTemplateId: 'adult_jav_default',
    japaneseJav: { organizeAfterScrape: true },
  };
  configStore.patchConfig({ subLibraries: [sl] });
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile);
  const task = taskStore.createTask({
    itemId: item.itemId, itemName: item.name, actionType: 'scrape',
    status: 'executing', itemInfo: adultLibraryService.itemInfoFromItem(item),
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); } });
  await scrapeFlow.driveTask(task.id);

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'done');
  assert.strictEqual(afterTask.phase, 'done');
  assert.strictEqual(afterTask.scrapeVerification.ok, true);
  assert.strictEqual(afterTask.scrapeVerification.source, 'completion_snapshot');
  const afterItem = mediaLibraryService.getLibraryItem(item.itemId);
  const finalDir = path.join(watchRoot, 'scraped', 'MVSD-175 Some Title');
  assert.strictEqual(afterItem.path, path.join(finalDir, 'MVSD-175 Some Title.mp4'));
  assert.strictEqual(fs.existsSync(movieDir), true);
  assert.strictEqual(fs.existsSync(path.join(watchRoot, 'scraped')), true);
  assert.strictEqual(fs.existsSync(finalDir), true);
  assert.strictEqual(fs.existsSync(path.join(finalDir, 'poster.jpg')), true);
  assert.strictEqual(fs.existsSync(path.join(finalDir, 'movie.nfo')), true);
  assert.strictEqual(afterItem.adultMetadata.posterPath, path.join(finalDir, 'poster.jpg'));
  assert.strictEqual(afterItem.adultMetadata.organized, true);
  assert.strictEqual(afterItem.adultMetadata.scrapeVerification.ok, true);
  const candidatesAfterOrganize = adultLibraryService.listIngestCandidates();
  assert.strictEqual(candidatesAfterOrganize.length, 0, 'candidate discovery should ignore the consolidated scraped folder');

  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const reportBeforeDelete = await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}/report` });
  assert.strictEqual(reportBeforeDelete.statusCode, 200);
  assert.strictEqual(reportBeforeDelete.json().scrapeVerification.ok, true);
  assert.strictEqual(reportBeforeDelete.json().scrapeVerification.source, 'completion_snapshot');
  assert.strictEqual(reportBeforeDelete.json().currentScrapeVerification, undefined);

  fs.rmSync(finalDir, { recursive: true, force: true });
  const reportAfterDelete = await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}/report` });
  assert.strictEqual(reportAfterDelete.statusCode, 200);
  const reportBody = reportAfterDelete.json();
  assert.strictEqual(reportBody.scrapeVerification.ok, true, 'historical completion snapshot remains successful after later delete');
  assert.strictEqual(reportBody.scrapeVerification.source, 'completion_snapshot');
  assert.strictEqual(reportBody.currentScrapeVerification.ok, false, 'current filesystem recheck reflects later delete');
  assert.ok(reportBody.currentScrapeVerification.failures.some((f) => f.code === 'media.exists'));
  await app.close();

  delete require.cache[scraperPath];
  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('western adult curation without protagonist fails without writing success artifacts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'us');
  const movieDir = path.join(watchRoot, 'incoming');
  fs.mkdirSync(movieDir, { recursive: true });
  const sourceFile = path.join(movieDir, 'Unknown.Scene.01.mp4');
  fs.writeFileSync(sourceFile, 'fake-video');
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const aiPath = require.resolve('../src/services/westernAdultAiService');
  delete require.cache[aiPath];
  require.cache[aiPath] = {
    exports: {
      analyzeVideo: async () => ({
        title: 'Unknown Person - Unknown Scene',
        generatedTitle: 'Unknown Person - Unknown Scene',
        generatedDescription: 'Unknown Scene',
        actors: [],
        tags: ['western_adult'],
        scene: { performerCount: 1 },
        protagonist: null,
        faceClusters: [{
          clusterId: 'cluster-1',
          status: 'unknown',
          frameCount: 8,
          avgFaceArea: 900,
          protagonistScore: 7200,
          bestFrameIndex: 0,
          sampleImageBase64: Buffer.from('face').toString('base64'),
        }],
        unknownFaces: [{
          clusterId: 'cluster-1',
          sampleImageBase64: Buffer.from('face').toString('base64'),
        }],
        posterImageBase64: Buffer.from('poster').toString('base64'),
        needsReview: true,
        ai: { provider: 'stub', matchMode: 'none' },
      }),
      abort: () => false,
    },
  };

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const taskStore = require('../src/taskStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const cfg = configStore.loadConfig();
  configStore.patchConfig({
    adultLibrary: {
      ...cfg.adultLibrary,
      western: {
        ...(cfg.adultLibrary && cfg.adultLibrary.western || {}),
        enabled: true,
        provider: 'http',
        organizeAfterScrape: true,
        writeNfo: true,
      },
    },
    subLibraries: [{
      uuid: crypto.randomUUID(), name: 'US', source: 'folder', mediaType: 'adult',
      adultRegion: 'western_adult', scraperType: 'western_builtin',
      watchRoot, scrapeEnabled: true, enabled: true, scheduleMode: 'full_auto',
      autoCreate: true, autoExecute: true, ruleTemplateId: 'adult_western_default',
    }],
  });
  const sl = configStore.loadConfig().subLibraries[0];
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile);
  const task = taskStore.createTask({
    itemId: item.itemId, itemName: item.name, actionType: 'scrape',
    status: 'executing', itemInfo: adultLibraryService.itemInfoFromItem(item),
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); } });
  await scrapeFlow.driveTask(task.id);

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'failed_hard');
  assert.strictEqual(afterTask.phase, 'failed_hard');
  const afterItem = mediaLibraryService.getLibraryItem(item.itemId);
  assert.strictEqual(afterItem.scraped, false);
  assert.strictEqual(afterItem.path, sourceFile);
  assert.strictEqual(afterItem.adultMetadata.scrapeStatus, 'failed');
  assert.strictEqual(afterItem.adultMetadata.unknownFaces.length, 1);
  assert.strictEqual(fs.existsSync(path.join(movieDir, 'movie.nfo')), false);
  assert.strictEqual(fs.existsSync(path.join(movieDir, '.shelfdeck.json')), false);
  assert.strictEqual(fs.existsSync(path.join(movieDir, 'poster.jpg')), false);

  delete require.cache[aiPath];
  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('successful western adult curation writes nfo and marks item scraped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'us');
  const movieDir = path.join(watchRoot, 'incoming');
  fs.mkdirSync(movieDir, { recursive: true });
  const sourceFile = path.join(movieDir, 'Loft.Scene.01.mp4');
  fs.writeFileSync(sourceFile, 'fake-video');
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const aiPath = require.resolve('../src/services/westernAdultAiService');
  delete require.cache[aiPath];
  require.cache[aiPath] = {
    exports: {
      analyzeVideo: async () => ({
        title: 'Actor A - Loft Scene',
        generatedTitle: 'Actor A - Loft Scene',
        generatedDescription: 'Loft Scene',
        actors: ['Actor A'],
        tags: ['studio', 'loft'],
        scene: { setting: 'loft', performerCount: 1 },
        faceClusters: [{ clusterId: 'face-1', matchedName: 'Actor A', confidence: 0.91 }],
        actorConfidence: { 'Actor A': 0.91 },
        needsReview: false,
        ai: { provider: 'stub', model: 'test' },
      }),
      abort: () => false,
    },
  };

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const taskStore = require('../src/taskStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const peopleStore = require('../src/peopleStore');
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  // Create the recognized actor so the worker's protagonist result has a real
  // person to mint a {CODE}-{seq} 番号 against.
  const person = peopleStore.createPerson({ name: 'Actor A', adultRegion: 'western_adult' });
  require.cache[aiPath].exports.analyzeVideo = async () => ({
    title: 'Actor A - Loft Scene',
    generatedTitle: 'Actor A - Loft Scene',
    generatedDescription: 'Loft Scene',
    actors: ['Actor A'],
    tags: ['studio', 'loft'],
    scene: { setting: 'loft', performerCount: 1 },
    protagonist: { clusterId: 'face-1', personId: person.personId, name: 'Actor A', confidence: 0.91, protagonistScore: 9000 },
    faceClusters: [{ clusterId: 'face-1', matchedName: 'Actor A', matchedPersonId: person.personId, matchConfidence: 0.91, status: 'named', frameCount: 9, avgFaceArea: 1000, protagonistScore: 9000, bestFrameIndex: 0, sampleImageBase64: '', embedding: [0.1, 0.2] }],
    actorConfidence: { 'Actor A': 0.91 },
    needsReview: false,
    ai: { provider: 'stub', model: 'test' },
  });

  const cfg = configStore.loadConfig();
  configStore.patchConfig({
    adultLibrary: {
      ...cfg.adultLibrary,
      western: {
        ...(cfg.adultLibrary && cfg.adultLibrary.western || {}),
        enabled: true,
        provider: 'http',
        organizeAfterScrape: true,
        writeNfo: true,
      },
    },
    subLibraries: [{
      uuid: crypto.randomUUID(), name: 'US', source: 'folder', mediaType: 'adult',
      adultRegion: 'western_adult', scraperType: 'western_builtin',
      watchRoot, scrapeEnabled: true, enabled: true, scheduleMode: 'full_auto',
      autoCreate: true, autoExecute: true, ruleTemplateId: 'adult_western_default',
    }],
  });
  const sl = configStore.loadConfig().subLibraries[0];
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile);
  const task = taskStore.createTask({
    itemId: item.itemId, itemName: item.name, actionType: 'scrape',
    status: 'executing', itemInfo: adultLibraryService.itemInfoFromItem(item),
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); } });
  await scrapeFlow.driveTask(task.id);

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'done');
  assert.strictEqual(afterTask.phase, 'done');
  const afterItem = mediaLibraryService.getLibraryItem(item.itemId);
  const finalDir = path.join(watchRoot, 'scraped', `${person.canonicalCode}-001 Actor A`);
  assert.strictEqual(afterItem.scraped, true);
  assert.strictEqual(afterItem.path, path.join(finalDir, `${person.canonicalCode}-001 Actor A.mp4`));
  assert.strictEqual(fs.existsSync(movieDir), true);
  assert.deepStrictEqual(afterItem.adultMetadata.actors, ['Actor A']);
  assert.strictEqual(afterItem.adultMetadata.scrapeStatus, 'done');
  assert.strictEqual(afterItem.adultMetadata.scrapeVerification.ok, true);
  assert.strictEqual(fs.existsSync(path.join(finalDir, 'movie.nfo')), true);
  assert.strictEqual(fs.existsSync(path.join(finalDir, '.shelfdeck.json')), true);

  delete require.cache[aiPath];
  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('western adult curation creates one movie folder and leaves sibling videos in place', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'us');
  fs.mkdirSync(watchRoot, { recursive: true });
  const sourceFile = path.join(watchRoot, 'Skin.Scene.01.mp4');
  const siblingFile = path.join(watchRoot, 'Other.Scene.01.mp4');
  fs.writeFileSync(sourceFile, 'fake-video');
  fs.writeFileSync(siblingFile, 'fake-video');
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const aiPath = require.resolve('../src/services/westernAdultAiService');
  delete require.cache[aiPath];

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const taskStore = require('../src/taskStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const peopleStore = require('../src/peopleStore');

  const person = peopleStore.createPerson({ name: 'Actor A', adultRegion: 'western_adult' });
  require.cache[aiPath] = {
    exports: {
      analyzeVideo: async () => ({
        title: 'Actor A - Skin Scene',
        generatedTitle: 'Actor A - Skin Scene',
        generatedDescription: 'Skin Scene',
        actors: ['Actor A'],
        protagonist: { clusterId: 'face-1', personId: person.personId, name: 'Actor A', confidence: 0.91, protagonistScore: 9000 },
        faceClusters: [{ clusterId: 'face-1', matchedName: 'Actor A', matchedPersonId: person.personId, matchConfidence: 0.91, status: 'named', frameCount: 9, avgFaceArea: 1000, protagonistScore: 9000, bestFrameIndex: 0, sampleImageBase64: '', embedding: [0.1, 0.2] }],
        posterImageBase64: Buffer.from('poster').toString('base64'),
        fanartImageBase64: Buffer.from('fanart').toString('base64'),
        ai: { provider: 'stub', model: 'test' },
      }),
      abort: () => false,
    },
  };
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const cfg = configStore.loadConfig();
  configStore.patchConfig({
    adultLibrary: {
      ...cfg.adultLibrary,
      western: {
        ...(cfg.adultLibrary && cfg.adultLibrary.western || {}),
        enabled: true,
        provider: 'http',
        organizeAfterScrape: true,
        writeNfo: true,
      },
    },
    subLibraries: [{
      uuid: crypto.randomUUID(), name: 'US', source: 'folder', mediaType: 'adult',
      adultRegion: 'western_adult', scraperType: 'western_builtin',
      watchRoot, scrapeEnabled: true, enabled: true, scheduleMode: 'full_auto',
      autoCreate: true, autoExecute: true, ruleTemplateId: 'adult_western_default',
    }],
  });
  const sl = configStore.loadConfig().subLibraries[0];
  await adultLibraryService.upsertFileItem(sl, siblingFile);
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile);
  const task = taskStore.createTask({
    itemId: item.itemId, itemName: item.name, actionType: 'scrape',
    status: 'executing', itemInfo: adultLibraryService.itemInfoFromItem(item),
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({ reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); } });
  await scrapeFlow.driveTask(task.id);

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'done');
  const afterItem = mediaLibraryService.getLibraryItem(item.itemId);
  const finalDir = path.join(watchRoot, 'scraped', `${person.canonicalCode}-001 Actor A`);
  assert.strictEqual(afterItem.path, path.join(finalDir, `${person.canonicalCode}-001 Actor A.mp4`));
  assert.strictEqual(fs.existsSync(path.join(finalDir, 'movie.nfo')), true);
  assert.strictEqual(fs.existsSync(path.join(finalDir, 'poster.jpg')), true);
  assert.strictEqual(fs.existsSync(path.join(finalDir, 'fanart.jpg')), true);
  assert.strictEqual(fs.existsSync(siblingFile), true);
  assert.strictEqual(fs.existsSync(sourceFile), false);
  assert.strictEqual(fs.existsSync(path.join(watchRoot, 'movie.nfo')), false);
  assert.strictEqual(fs.existsSync(path.join(watchRoot, 'poster.jpg')), false);
  assert.strictEqual(afterItem.adultMetadata.nfoPath, path.join(finalDir, 'movie.nfo'));
  assert.strictEqual(afterItem.adultMetadata.posterPath, path.join(finalDir, 'poster.jpg'));
  assert.strictEqual(afterItem.adultMetadata.scrapeVerification.ok, true);

  delete require.cache[aiPath];
  delete require.cache[executorPath];
  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('western adult startup repair demotes legacy shared scrape artifacts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'us');
  const videosDir = path.join(watchRoot, 'Videos');
  fs.mkdirSync(videosDir, { recursive: true });
  const fileA = path.join(videosDir, 'Scene.A.mp4');
  const fileB = path.join(videosDir, 'Scene.B.mp4');
  fs.writeFileSync(fileA, 'fake-video');
  fs.writeFileSync(fileB, 'fake-video');
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const configStore = require('../src/configStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const cfg = configStore.loadConfig();
  const subLib = {
    uuid: crypto.randomUUID(), name: 'US', source: 'folder', mediaType: 'adult',
    adultRegion: 'western_adult', scraperType: 'western_builtin',
    watchRoot, enabled: true, ruleTemplateId: 'adult_western_default',
  };
  configStore.patchConfig({
    adultLibrary: {
      ...cfg.adultLibrary,
      western: { ...(cfg.adultLibrary && cfg.adultLibrary.western || {}), writeNfo: true },
    },
    subLibraries: [subLib],
  });

  const itemA = await adultLibraryService.upsertFileItem(subLib, fileA);
  const itemB = await adultLibraryService.upsertFileItem(subLib, fileB);
  const sharedNfo = path.join(videosDir, 'movie.nfo');
  const sharedMarker = path.join(videosDir, '.shelfdeck.json');
  fs.writeFileSync(sharedNfo, '<movie><title>Unknown Person - possibly a scene from a movie or TV show</title></movie>');
  fs.writeFileSync(sharedMarker, JSON.stringify({
    itemId: itemA.itemId,
    subLibraryId: subLib.uuid,
    mediaPath: fileA,
    scrapeTaskId: 'legacy',
    scrapedAt: new Date().toISOString(),
  }, null, 2));

  const lib = mediaLibraryService.loadLibrary();
  lib.items = lib.items.map((it) => {
    if (![itemA.itemId, itemB.itemId].includes(it.itemId)) return it;
    return {
      ...it,
      name: 'Unknown Person - possibly a scene from a movie or TV show',
      scraped: true,
      adultMetadata: {
        ...(it.adultMetadata || {}),
        region: 'western_adult',
        adultId: 'UNK-063',
        title: 'Unknown Person - possibly a scene from a movie or TV show',
        scrapeStatus: 'done',
        nfoPath: sharedNfo,
        markerPath: sharedMarker,
        protagonist: null,
      },
    };
  });
  mediaLibraryService.saveLibrary(lib);

  const result = adultLibraryService.repairInvalidWesternScrapeState({ silent: true });
  assert.strictEqual(result.repaired, 2);
  assert.strictEqual(fs.existsSync(fileA), true);
  assert.strictEqual(fs.existsSync(fileB), true);
  const afterA = mediaLibraryService.getLibraryItem(itemA.itemId);
  const afterB = mediaLibraryService.getLibraryItem(itemB.itemId);
  for (const after of [afterA, afterB]) {
    assert.strictEqual(after.scraped, false);
    assert.strictEqual(after.adultMetadata.scrapeStatus, 'failed');
    assert.strictEqual(after.adultMetadata.reviewStatus, 'needs_review');
    assert.strictEqual(after.adultMetadata.title, '');
    assert.strictEqual(after.adultMetadata.scrapeVerification.ok, false);
    assert.match(after.name, /^Scene\.[AB]$/);
  }

  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('western adult id assignment reuses an existing actor id on rescrape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  const peopleStore = require('../src/peopleStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const person = peopleStore.createPerson({ name: 'Actor A', adultRegion: 'western_adult', canonicalCode: 'ACTA' });
  const cfg = { adultLibrary: { western: { sequencePad: 3 } }, subLibraries: [] };
  const sl = { uuid: crypto.randomUUID(), western: {} };

  const assigned = adultLibraryService.assignWesternAdultId(cfg, sl, {
    personId: person.personId,
    name: 'Actor A',
  }, 'ACTA-007', { filePath: path.join(dir, 'ACTA-007 Actor A', 'ACTA-007 Actor A.mp4') });

  assert.strictEqual(assigned.adultId, 'ACTA-007');
  assert.strictEqual(assigned.reused, true);
  const after = peopleStore.loadPeople().people.find((p) => p.personId === person.personId);
  assert.strictEqual(after.sequenceNumber, undefined);

  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('western adult id assignment does not reuse stale root-level scrape id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  const peopleStore = require('../src/peopleStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const person = peopleStore.createPerson({ name: 'Actor A', adultRegion: 'western_adult', canonicalCode: 'ACTA' });
  const cfg = { adultLibrary: { western: { sequencePad: 3 } }, subLibraries: [] };
  const sl = { uuid: crypto.randomUUID(), western: {} };

  const assigned = adultLibraryService.assignWesternAdultId(cfg, sl, {
    personId: person.personId,
    name: 'Actor A',
  }, 'ACTA-007', { filePath: path.join(dir, 'loose-video.mp4') });

  assert.strictEqual(assigned.adultId, 'ACTA-001');
  assert.strictEqual(assigned.reused, undefined);
  const after = peopleStore.loadPeople().people.find((p) => p.personId === person.personId);
  assert.strictEqual(after.sequenceNumber, 1);

  delete process.env.CONTROL_PLANE_DATA_DIR;
});

test('western adult id assignment trusts an already organized folder id over stale metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  const peopleStore = require('../src/peopleStore');
  const adultLibraryService = require('../src/adultLibraryService');
  const person = peopleStore.createPerson({ name: 'Actor A', adultRegion: 'western_adult', canonicalCode: 'ACTA' });
  const cfg = { adultLibrary: { western: { sequencePad: 3 } }, subLibraries: [] };
  const sl = { uuid: crypto.randomUUID(), western: {} };

  const assigned = adultLibraryService.assignWesternAdultId(cfg, sl, {
    personId: person.personId,
    name: 'Actor A',
  }, 'ACTA-999', { filePath: path.join(dir, 'ACTA-002 Actor A', 'ACTA-002 Actor A.mp4') });

  assert.strictEqual(assigned.adultId, 'ACTA-002');
  assert.strictEqual(assigned.reused, true);
  const after = peopleStore.loadPeople().people.find((p) => p.personId === person.personId);
  assert.strictEqual(after.sequenceNumber, undefined);

  delete process.env.CONTROL_PLANE_DATA_DIR;
});

// ── JAV 番号识别置信度 ────────────────────────────────────────────────────────

test('extractJavIdWithConfidence: known maker prefix → high confidence', () => {
  const { extractJavId } = require('../src/adultLibraryService');
  // extractJavId returns the adultId string for known prefixes.
  assert.strictEqual(extractJavId('Some.Show.MVSD-175.mp4'), 'MVSD-175');
  assert.strictEqual(extractJavId('SSIS-123'), 'SSIS-123');
  assert.strictEqual(extractJavId('fc2-ppv-9876543'), 'FC2-9876543');
});

test('extractJavIdWithConfidence: unknown prefix → low confidence, still parsed', () => {
  // Access the underlying confidence-aware parser via a known-typed path.
  const adultLibraryService = require('../src/adultLibraryService');
  // An unknown but well-formed prefix parses as low confidence.
  // We infer behaviour through extractJavId alone (returns the id); the
  // confidence gating is exercised end-to-end by the ambiguous-status test below.
  assert.strictEqual(adultLibraryService.extractJavId('ZZZZZ-999'), 'ZZZZZ-999');
});

test('extractJavId: rejects common false-positive prefixes', () => {
  const { extractJavId } = require('../src/adultLibraryService');
  // "CD1", "DVD2020", "Part1"-style fragments must not be treated as 番号.
  assert.strictEqual(extractJavId('movie_CD1.mp4'), '');
  assert.strictEqual(extractJavId('DVD-2020'), '');
  assert.strictEqual(extractJavId('PART-2'), '');
});

test('computeRightCoverCrop uses the right-side front cover slice', () => {
  const adultLibraryService = require('../src/adultLibraryService');
  assert.deepStrictEqual(
    adultLibraryService.computeRightCoverCrop(800, 536),
    { x: 406, y: 0, width: 394, height: 536 },
  );
  assert.strictEqual(adultLibraryService.computeRightCoverCrop(147, 200), null);
});

test('manual scrape of low-confidence (unknown prefix) item enters queue and attempts scraping', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: { name: 'JAV Test', source: 'folder', mediaType: 'adult', adultRegion: 'japanese_jav', scraperType: 'shelfdeck_japanese_jav', watchRoot, ruleTemplateId: 'adult_jav_default' },
  });
  const subLib = create.json();
  // Unknown prefix ZZZZZ — parses but is not a known maker, → ambiguous.
  const filePath = path.join(watchRoot, 'ZZZZZ-999.mp4');
  fs.writeFileSync(filePath, 'fake-video');
  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath);
  assert.strictEqual(item.adultMetadata.scrapeStatus, 'ambiguous');
  assert.strictEqual(item.adultMetadata.idConfidence, 'low');

  let tasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  assert.strictEqual(
    tasks.json().tasks.some((t) => t.itemId === item.itemId),
    false,
    'plain adult item upsert should not create a scrape task',
  );

  const manualScrape = await app.inject({
    method: 'POST',
    url: `/v1/admin/adult/items/${item.itemId}/actions/rescrape`,
  });
  assert.strictEqual(manualScrape.statusCode, 201);

  // Ambiguous items can still enter the task flow through explicit user intent;
  // the scrape executor attempts the detected ID instead of failing before it contacts a scraper.
  tasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  const task = tasks.json().tasks.find((t) => t.itemId === item.itemId);
  assert.ok(task, 'manual scrape task exists for ambiguous item');

  const scraperPath = require.resolve('../src/services/japaneseJavScraper');
  delete require.cache[scraperPath];
  require.cache[scraperPath] = {
    exports: {
      scrapeJapaneseJav: async ({ adultId }) => ({
        source: 'stub',
        sourceUrl: `https://example.test/${adultId}`,
        adultId,
        title: `${adultId} Stub Title`,
        originalTitle: 'Stub Title',
        posterUrl: 'https://example.test/poster.jpg',
        fanartUrl: 'https://example.test/poster.jpg',
      }),
      fetchBinary: async () => ({ buffer: Buffer.from('jpg'), contentType: 'image/jpeg', finalUrl: 'https://example.test/poster.jpg' }),
      abort: () => false,
      normalizeAdultId: (v) => v,
    },
  };
  const executorPath = require.resolve('../src/scrapeFlowExecutor');
  delete require.cache[executorPath];
  const taskStore = require('../src/taskStore');
  const scrapeFlow = require('../src/scrapeFlowExecutor');
  scrapeFlow.setScheduler({ reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); } });
  await scrapeFlow.driveTask(task.id);
  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'done');
  assert.ok(afterTask.logs.some((l) => l.msg && l.msg.includes('Starting JAV scrape for ZZZZZ-999')));

  // Rescrape with a corrected 番号 override enqueues a task.
  const rescrape = await app.inject({
    method: 'POST',
    url: `/v1/admin/adult/items/${item.itemId}/actions/rescrape`,
    payload: { adultId: 'MVSD-175' },
  });
  assert.strictEqual(rescrape.statusCode, 201);
  const lib2 = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib2.json().items[0].adultMetadata.adultId, 'MVSD-175');
  assert.strictEqual(lib2.json().items[0].adultMetadata.idConfidence, 'high');
  delete require.cache[scraperPath];
  delete require.cache[executorPath];
  await app.close();
});


test('PATCH /v1/admin/transcode/config persists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/transcode/config',
    payload: { transcodeTempRoot: 'C:\\tmp\\transcode', ffmpegPath: 'C:\\ffmpeg.exe' },
  });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.transcodeTempRoot, 'C:\\tmp\\transcode');
  assert.strictEqual(body.ffmpegPath, 'C:\\ffmpeg.exe');
  // Reload
  const res2 = await app.inject({ method: 'GET', url: '/v1/admin/transcode/config' });
  assert.strictEqual(res2.json().transcodeTempRoot, 'C:\\tmp\\transcode');
  await app.close();
});

test('PATCH /v1/admin/transcode/config strips transient device status fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/transcode/config',
    payload: {
      transcodeEncodingDevices: [
        {
          stableKey: 'qsv:0',
          inPool: true,
          priority: 200,
          maxSlots: 1,
          encoder: '',
          status: 'busy',
          activeSlots: 1,
          remote: false,
          nodeStatus: 'online',
        },
      ],
    },
  });
  assert.strictEqual(res.statusCode, 200);
  const device = res.json().transcodeEncodingDevices[0];
  assert.deepStrictEqual(device, {
    stableKey: 'qsv:0',
    inPool: true,
    priority: 200,
    maxSlots: 1,
    encoder: '',
  });

  const reload = await app.inject({ method: 'GET', url: '/v1/admin/transcode/config' });
  const reloadedDevice = reload.json().transcodeEncodingDevices[0];
  assert.strictEqual(reloadedDevice.status, undefined);
  assert.strictEqual(reloadedDevice.activeSlots, undefined);
  await app.close();
});

// ── Library ────────────────────────────────────────────────────────────────────

test('GET /v1/library returns library items', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/library' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.items));
  assert.strictEqual(typeof body.total, 'number');
  await app.close();
});

test('GET /v1/library list endpoints omit heavy adult face payloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/mediaLibraryService').saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [{
      itemId: 'adult-heavy-list-1',
      subLibraryId: 'adult-heavy-list',
      source: 'adult_folder',
      type: 'movie',
      name: 'Heavy Adult List Item',
      path: '/adult/heavy.mp4',
      scraped: false,
      adultMetadata: {
        adultId: 'UNK-010',
        scrapeStatus: 'needs_review',
        region: 'western_adult',
        studio: 'Studio A',
        director: 'Director A',
        premiered: '2026-01-01',
        faceClusters: [{ clusterId: 'face-1', embedding: [0.1, 0.2], sampleImageBase64: Buffer.alloc(4096, 1).toString('base64') }],
        unknownFaces: [{ clusterId: 'unknown-1', embedding: [0.3, 0.4], sampleImageBase64: Buffer.alloc(4096, 2).toString('base64') }],
        galleryImages: [{ imageBase64: Buffer.alloc(4096, 3).toString('base64') }],
        ai: { raw: Buffer.alloc(4096, 4).toString('base64') },
      },
    }],
  });

  for (const url of ['/v1/library?subLibraryId=adult-heavy-list', '/v1/library/queries/manage?subLibraryId=adult-heavy-list&page=1&pageSize=10']) {
    const res = await app.inject({ method: 'GET', url });
    assert.strictEqual(res.statusCode, 200);
    const meta = res.json().items[0].adultMetadata;
    assert.strictEqual(meta.adultId, 'UNK-010');
    assert.strictEqual(meta.scrapeStatus, 'needs_review');
    assert.strictEqual(meta.studio, 'Studio A');
    assert.strictEqual(meta.director, 'Director A');
    assert.strictEqual(meta.premiered, '2026-01-01');
    assert.deepStrictEqual(meta.faceClusters, []);
    assert.deepStrictEqual(meta.unknownFaces, []);
    assert.strictEqual(meta.galleryImages, undefined);
    assert.strictEqual(meta.ai, undefined);
  }
  await app.close();
});

test('GET /v1/library/queries/manage supports page and pageSize pagination', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const items = Array.from({ length: 5 }, (_, index) => ({
    itemId: `page-item-${index + 1}`,
    subLibraryId: 'sub-page',
    source: 'emby',
    type: 'movie',
    name: `Paged Movie ${index + 1}`,
    action: 'transcode',
    path: `/media/paged-${index + 1}.mkv`,
  }));
  const cache = await app.inject({
    method: 'POST',
    url: '/v1/library/cache',
    payload: { subLibraryId: 'sub-page', items },
  });
  assert.strictEqual(cache.statusCode, 200);

  const res = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?page=2&pageSize=2' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.total, 5);
  assert.strictEqual(body.limit, 2);
  assert.strictEqual(body.offset, 2);
  assert.deepStrictEqual(body.items.map((item) => item.name), ['Paged Movie 3', 'Paged Movie 4']);
  await app.close();
});

test('GET /v1/library/queries/manage task filter stays on SQL pagination path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const items = Array.from({ length: 3 }, (_, index) => ({
    ...metadataReadyMovie({ itemId: `task-filter-item-${index + 1}` }),
    subLibraryId: 'sub-task-filter',
    name: `Task Filter Movie ${index + 1}`,
    action: 'transcode',
    path: `/media/task-filter-${index + 1}.mkv`,
  }));
  require('../src/mediaLibraryService').saveLibrary({
    cachedAt: new Date().toISOString(),
    items,
  });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'task-filter-item-2', actionType: 'transcode' },
  });
  assert.strictEqual(create.statusCode, 201);

  const libraryStore = require('../src/libraryStore');
  const originalLoadLibrary = libraryStore.loadLibrary;
  const originalLoadTasks = taskStore.loadTasks;
  libraryStore.loadLibrary = () => {
    throw new Error('task filter should not load full library');
  };
  taskStore.loadTasks = () => {
    throw new Error('task filter should not load full task payloads');
  };
  try {
    const none = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?subLibraryId=sub-task-filter&task=none&page=1&pageSize=10' });
    assert.strictEqual(none.statusCode, 200);
    assert.deepStrictEqual(none.json().items.map((item) => item.itemId), ['task-filter-item-1', 'task-filter-item-3']);

    const active = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?subLibraryId=sub-task-filter&task=active&page=1&pageSize=10' });
    assert.strictEqual(active.statusCode, 200);
    assert.deepStrictEqual(active.json().items.map((item) => item.itemId), ['task-filter-item-2']);
  } finally {
    libraryStore.loadLibrary = originalLoadLibrary;
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

// ── MediaPolicyService (pure function) ─────────────────────────────────────────

test('strategyEngine rule evaluation scenarios', async () => {
  const { ruleMatches } = require('../src/strategyEngine');

  // New format: groupsConnector + per-group connector
  // P10: no rating → keep
  const p10 = { priority: 10, groupsConnector: 'and', groups: [{ connector: 'and', conditions: [['doubanRating','=',null],['userRating','=',null]] }], action: 'keep', reason: '无评分' };
  assert.ok(ruleMatches({ doubanRating: null, userRating: null }, p10));
  assert.ok(!ruleMatches({ doubanRating: 3, userRating: null }, p10));

  // P9: 1-2★ → delete (OR rating group)
  const p9 = { priority: 9, groupsConnector: 'and', groups: [{ connector: 'or', conditions: [['doubanRating','in',[1,2]],['userRating','in',[1,2]]] }], action: 'delete', reason: '低分' };
  assert.ok(ruleMatches({ doubanRating: 1, userRating: null }, p9));
  assert.ok(ruleMatches({ doubanRating: null, userRating: 1 }, p9));
  assert.ok(!ruleMatches({ doubanRating: 3, userRating: null }, p9));

  // P6: 3-4★ + modern codec → keep (rating OR, codec AND)
  const p6 = { priority: 6, groupsConnector: 'and', groups: [{ connector: 'or', conditions: [['doubanRating','in',[3,4]],['userRating','in',[3,4]]] }, { connector: 'and', conditions: [['codec','in',['h265','hevc','av1']]] }], action: 'keep', reason: '现代编码' };
  assert.ok(ruleMatches({ doubanRating: 3, codec: 'h265' }, p6));
  assert.ok(!ruleMatches({ doubanRating: 3, codec: 'h264' }, p6));

  // P5: 3★ + 1080p + bitrate>4 → transcode (rating OR, bucket+bitrate AND)
  const p5 = { priority: 5, groupsConnector: 'and', groups: [{ connector: 'or', conditions: [['doubanRating','=',3],['userRating','=',3]] }, { connector: 'and', conditions: [['bucket','=','1080p'],['equivalentBitrate','>',4]] }], action: 'transcode' };
  assert.ok(ruleMatches({ doubanRating: 3, bucket: '1080p', equivalentBitrate: 8 }, p5));
  assert.ok(!ruleMatches({ doubanRating: 3, bucket: '4K', equivalentBitrate: 8 }, p5));
  assert.ok(!ruleMatches({ doubanRating: 3, bucket: '1080p', equivalentBitrate: 2 }, p5));

  // P1: catch-all (empty groups)
  const p1 = { priority: 1, groupsConnector: 'and', groups: [], action: 'keep', reason: '策略未覆盖' };
  assert.ok(ruleMatches({ doubanRating: 5, bucket: '4K', equivalentBitrate: 10 }, p1));

  // groupsConnector='or': between-group OR
  const ruleOr = { priority: 1, groupsConnector: 'or', groups: [{ connector: 'and', conditions: [['bucket','=','1080p'],['equivalentBitrate','>',5]] }, { connector: 'and', conditions: [['codec','in',['h265']]] }], action: 'transcode' };
  assert.ok(ruleMatches({ bucket: '1080p', equivalentBitrate: 8 }, ruleOr));
  assert.ok(ruleMatches({ codec: 'h265' }, ruleOr));
  assert.ok(!ruleMatches({ bucket: '4K', equivalentBitrate: 8, codec: 'h264' }, ruleOr));
});

test('adult JAV default template transcodes non-HEVC or high bitrate facts', async () => {
  const { buildAdultJavDefaultTemplate } = require('../src/configStore');
  const { ruleMatches } = require('../src/strategyEngine');
  const tpl = buildAdultJavDefaultTemplate();
  assert.strictEqual(tpl.tag.version, 3);
  const nonHevc = tpl.rules.find((r) => r.reason.includes('非 HEVC'));
  const transcode1080p = tpl.rules.find((r) => r.action === 'transcode' && r.reason.includes('1080p'));
  const transcode4k = tpl.rules.find((r) => r.action === 'transcode' && r.reason.includes('4K'));

  assert.ok(nonHevc, 'non-HEVC transcode rule exists');
  assert.ok(transcode1080p, '1080p transcode rule exists');
  assert.ok(transcode4k, '4K transcode rule exists');
  assert.strictEqual(nonHevc.actionParams.targetBitrate, 2.5);
  assert.strictEqual(transcode1080p.actionParams.targetBitrate, 2.5);
  assert.strictEqual(transcode4k.actionParams.targetBitrate, 6);

  assert.ok(ruleMatches({ scraped: true, codec: 'h264', bucket: '1080p', equivalentBitrate: 1.8 }, nonHevc));
  assert.ok(!ruleMatches({ scraped: true, codec: 'h265', bucket: '1080p', equivalentBitrate: 1.8 }, nonHevc));
  assert.ok(ruleMatches({ scraped: true, codec: 'h265', bucket: '1080p', equivalentBitrate: 3 }, transcode1080p));
  assert.ok(!ruleMatches({ scraped: true, codec: 'h265', bucket: '1080p', equivalentBitrate: 2.4 }, transcode1080p));
  assert.ok(ruleMatches({ scraped: false, codec: 'h264', bucket: '1080p', equivalentBitrate: 8 }, nonHevc));
  assert.ok(ruleMatches({ bucket: '1080p', equivalentBitrate: 8 }, transcode1080p));
});

// ── 404 handling ──────────────────────────────────────────────────────────────

test('GET /v1/tasks/nonexistent -> 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/tasks/nonexistent-id' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

test('GET unknown /v1/ endpoint -> 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/nonexistent' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

// ── Upgrade Flow ──────────────────────────────────────────────────────────────

test('POST /v1/tasks upgrade actionType -> 201', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'upgrade-test-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId, action: 'upgrade' })] });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'upgrade' },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.id);
  assert.strictEqual(body.actionType, 'upgrade');
  assert.strictEqual(body.status, 'created');
  assert.strictEqual(body.taskBridge.kind, 'optimize');
  assert.strictEqual(body.flowPlan.direction, 'optimize.upgrade');
  assert.strictEqual(body.flowPlan.operationKind, 'upgrade');
  await app.close();
});

test('GET /v1/admin/upgrade/config returns moviepilot fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/upgrade/config' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok('moviepilot' in body);
  assert.ok('upgradeStagingLocalPath' in body);
  assert.ok('upgradeRetryInterval' in body);
  assert.ok('upgradeMaxRetries' in body);
  assert.strictEqual(body.moviepilot.baseUrl, '');
  assert.strictEqual(body.upgradeRetryInterval, 3600000);
  await app.close();
});

test('PATCH /v1/admin/upgrade/config persists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const patch = {
    moviepilot: { baseUrl: 'http://192.168.1.1:3000', apiKey: 'secret123', savePath: '/downloads', stagingPath: '/staging' },
    upgradeStagingLocalPath: 'C:\\staging',
    upgradeRetryInterval: 7200000,
    upgradeMaxRetries: 5,
  };
  const res = await app.inject({ method: 'PATCH', url: '/v1/admin/upgrade/config', payload: patch });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.upgradeStagingLocalPath, 'C:\\staging');
  assert.strictEqual(body.upgradeRetryInterval, 7200000);
  assert.strictEqual(body.upgradeMaxRetries, 5);
  // apiKey should be masked
  assert.strictEqual(body.moviepilot.apiKey, '********');
  assert.strictEqual(body.moviepilot.baseUrl, 'http://192.168.1.1:3000');

  // Reload
  const res2 = await app.inject({ method: 'GET', url: '/v1/admin/upgrade/config' });
  assert.strictEqual(res2.json().upgradeStagingLocalPath, 'C:\\staging');
  assert.strictEqual(res2.json().moviepilot.apiKey, '********');
  await app.close();
});

test('PATCH /v1/tasks/:id confirm with confirmData stores selection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  // Create upgrade task
  const itemId = 'upgrade-confirm-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId, action: 'upgrade' })] });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'upgrade' },
  });
  const { id } = create.json();

  // Set status to awaiting_user_confirm (simulating flow pausing)
  const taskStore = require('../src/taskStore');
  taskStore.updateTask(id, { status: 'awaiting_user_confirm', resumePoint: 'upgrade_executing' });

  // Confirm with selection data
  const res = await app.inject({
    method: 'PATCH',
    url: `/v1/tasks/${id}`,
    payload: { confirmed: true, confirmData: { selectedIndex: 2 } },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().status, 'queued');

  // Verify confirmData stored
  const task = taskStore.getTask(id);
  assert.ok(task.confirmData);
  assert.strictEqual(task.confirmData.selectedIndex, 2);
  assert.strictEqual(task.status, 'queued');
  const events = taskStore.queryTaskEvents({ taskId: id }, { pageSize: 50 }).events;
  const confirmedEvent = events.find((event) => event.eventType === 'task.confirmed');
  assert.ok(confirmedEvent);
  assert.deepStrictEqual(confirmedEvent.payload.confirmDataKeys, ['selectedIndex']);

  await app.close();
});

test('POST /v1/tasks/:id/actions/pause on upgrade task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const itemId = 'upgrade-pause-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId, action: 'upgrade' })] });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'upgrade' },
  });
  const { id } = create.json();

  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/pause` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().status, 'paused');

  await app.close();
});

test('POST /v1/tasks/:id/actions/execute resumes paused upgrade task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const itemId = 'upgrade-resume-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId, action: 'upgrade' })] });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'upgrade' },
  });
  const { id } = create.json();
  await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/pause` });
  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/execute` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().status, 'queued');

  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.json().status, 'queued');

  await app.close();
});

test('upgrade task with no MoviePilot config -> precheck fails to failed_hard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  // No moviepilot config — default config has empty baseUrl/apiKey
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();

  const itemId = 'upgrade-noconfig-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId, action: 'upgrade' })] });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId, actionType: 'upgrade' },
  });
  const { id } = create.json();

  // Manually set to queued and drive the precheck
  const taskStore = require('../src/taskStore');
  taskStore.updateTask(id, { status: 'queued' });

  const upgradeFlow = require('../src/upgradeFlowExecutor');
  upgradeFlow.setScheduler({
    pauseForConfirm: (tid, rp) => { taskStore.updateTask(tid, { status: 'awaiting_user_confirm', resumePoint: rp }); },
    reportStatus: (tid, status) => { taskStore.updateTask(tid, { status }); },
  });

  await upgradeFlow.driveTask(id);

  const task = taskStore.getTask(id);
  assert.strictEqual(task.status, 'failed_hard');
  // Verify log about missing config
  const configLog = (task.logs || []).find((e) => e.msg && e.msg.includes('not configured'));
  assert.ok(configLog, 'should log "not configured" message');

  await app.close();
});

test('upgrade task with MoviePilot config proceeds to planning', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  // Write config with MoviePilot fields
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    moviepilot: {
      baseUrl: 'http://192.168.12.230:3000',
      apiKey: 'test-token',
      savePath: '/vol1/1000/media_download/shelfdeck',
      stagingPath: '',
    },
    upgradeStagingLocalPath: 'C:\\staging',
    upgradeRetryInterval: 3600000,
    upgradeMaxRetries: 3,
  }));

  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  require('../src/taskScheduler').stopScheduler();

  const itemId = 'upgrade-precheck-' + crypto.randomUUID().slice(0, 8);
  mediaLibraryService.saveLibrary({ cachedAt: new Date().toISOString(), items: [metadataReadyMovie({ itemId, action: 'upgrade' })] });
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: {
      itemId,
      actionType: 'upgrade',
    },
  });
  const { id } = create.json();

  const taskStore = require('../src/taskStore');
  taskStore.updateTask(id, { status: 'queued' });

  const upgradeFlow = require('../src/upgradeFlowExecutor');
  const statuses = [];
  upgradeFlow.setScheduler({
    pauseForConfirm: (tid, rp) => { statuses.push({ type: 'pause', taskId: tid, resumePoint: rp }); },
    reportStatus: (tid, status) => { statuses.push({ type: 'status', taskId: tid, status }); },
  });

  await upgradeFlow.driveTask(id);

  // The flow should have attempted precheck (MoviePilot connection check)
  // Since the test server may or may not be reachable, check for logs
  const task = taskStore.getTask(id);
  assert.ok(task.logs && task.logs.length >= 1, 'should have logs');
  assert.ok(task.phase, 'should have a phase set');

  await app.close();
});
