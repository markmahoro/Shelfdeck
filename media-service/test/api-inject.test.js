'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildApp } = require('../src/app');
const taskStore = require('../src/taskStore');

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
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'test-item-' + crypto.randomUUID().slice(0, 8), actionType: 'transcode' },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.id, 'task id present');
  assert.strictEqual(body.status, 'created');
  assert.strictEqual(body.actionType, 'transcode');
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
      { itemId: 'auto-lib-item', name: 'Auto Item', type: 'movie', subLibraryId: 'auto-lib' },
      { itemId: 'manual-lib-item', name: 'Manual Item', type: 'movie', subLibraryId: 'manual-lib' },
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
  taskStore.getTasks = () => {
    throw new Error('full history should not be loaded for manual admission');
  };
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: { itemId: 'manual-fast-path', actionType: 'transcode' },
    });
    assert.strictEqual(res.statusCode, 201);
    assert.ok(res.json().id);
  } finally {
    taskStore.getTasks = originalGetTasks;
    await app.close();
  }
});

test('GET /v1/tasks lists created tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i1', actionType: 'delete' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i2', actionType: 'transcode' } });
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
  const done = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-done', actionType: 'delete' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-active', actionType: 'transcode' } });
  taskStore.updateTask(done.json().id, { status: 'done' });

  const res = await app.inject({ method: 'GET', url: '/v1/tasks' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.deepStrictEqual(body.tasks.map((t) => t.itemId), ['i-active']);

  const historyRes = await app.inject({ method: 'GET', url: '/v1/tasks?includeHistory=1' });
  assert.strictEqual(historyRes.statusCode, 200);
  const historyIds = historyRes.json().tasks.map((t) => t.itemId).sort();
  assert.deepStrictEqual(historyIds, ['i-active', 'i-done']);
  await app.close();
});

test('GET /v1/tasks/:id returns task detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-detail', actionType: 'delete' } });
  const { id } = create.json();
  const res = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(res.statusCode, 200);
  const task = res.json();
  assert.strictEqual(task.id, id);
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
  assert.strictEqual(body.assets.poster, true);
  assert.strictEqual(body.assets.nfo, true);
  assert.strictEqual(body.scrapeVerification.ok, false);
  assert.ok(body.scrapeVerification.failures.some((f) => f.code === 'media.exists'));
  await app.close();
});

test('DELETE /v1/tasks/:id removes task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-del', actionType: 'delete' } });
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

test('delete task removes an adult folder media file and library item', async () => {
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
  const filePath = path.join(watchRoot, 'MVSD-175.mp4');
  fs.writeFileSync(filePath, 'delete-me');
  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath, { enqueueScrape: false });

  const createTask = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: item.itemId, actionType: 'delete' } });
  assert.strictEqual(createTask.statusCode, 201);

  const taskStore = require('../src/taskStore');
  const deleteFlow = require('../src/deleteFlowExecutor');
  deleteFlow.setScheduler({
    reportStatus: (id, status, progress) => taskStore.updateTask(id, { status, progress: progress ?? undefined }),
    pauseForConfirm: () => { throw new Error('delete should not pause when approval is auto'); },
  });
  await deleteFlow.driveTask(createTask.json().id);

  assert.strictEqual(fs.existsSync(filePath), false, 'delete task should remove the media file');
  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib.json().total, 0, 'delete task should remove the library cache item');
  const done = await app.inject({ method: 'GET', url: `/v1/tasks/${createTask.json().id}` });
  assert.strictEqual(done.json().status, 'done');
  const report = await app.inject({ method: 'GET', url: `/v1/tasks/${createTask.json().id}/report` });
  assert.strictEqual(report.statusCode, 200);
  assert.strictEqual(report.json().bytesFreed, Buffer.byteLength('delete-me'));
  assert.strictEqual(report.json().delete.targetKind, 'file');
  assert.strictEqual(report.json().delete.targetPath, filePath);
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
  const item = await adultLibraryService.upsertFileItem(subLib, filePath, { enqueueScrape: false });
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
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'i-pause', actionType: 'transcode' } });
  const { id } = create.json();
  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/pause` });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.id, id);
  assert.strictEqual(body.status, 'paused');
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
  // Verify persisted
  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.json().status, 'queued');
  await app.close();
});

test('POST /v1/tasks/:id/actions/execute non-existent task -> 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks/nonexistent/actions/execute' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

test('DELETE /v1/tasks/:id cancels then removes executing task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
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
  // Verify gone
  const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}` });
  assert.strictEqual(get.statusCode, 404);
  await app.close();
});

test('DELETE /v1/tasks/:id removes queued task without running flow cancel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
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

// ── Admin tasks ────────────────────────────────────────────────────────────────

test('GET /v1/admin/tasks returns list with summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const taskStore = require('../src/taskStore');
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'a1', actionType: 'delete' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'a2', actionType: 'transcode' } });
  taskStore.createTask({
    itemId: 'a3',
    actionType: 'scrape',
    status: 'done',
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
  assert.strictEqual(body.summary.byStatus.done, 1);
  assert.ok(body.tasks.every((t) => t.logs === undefined), 'list payload omits logs');
  assert.ok(body.tasks.every((t) => t.report === undefined), 'list payload omits reports');
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

test('PATCH /v1/admin/sublibraries cannot reintroduce adult private autoscrape fields', async () => {
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
  assert.strictEqual(scan.json().error.code, 'ADULT_FOLDER_SCAN_REMOVED');

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

test('legacy adult private autoscrape sub-library fields are migrated out of config', async () => {
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

  const tasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  assert.ok(tasks.json().tasks.some((t) => t.itemId === item.itemId && t.actionType === 'scrape'));
  await app.close();
});

test('adult folder scan is not a task creation path and ingest follow-up follows automatic allow-list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    smartTaskEnabledActions: ['ingest'],
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

  const scan = await adultLibraryService.scanSubLibrary(subLib);
  assert.strictEqual(scan.scanned, 1);
  assert.strictEqual(scan.queued, 0, 'folder scan does not create ingest tasks');
  assert.strictEqual(scan.scrapeQueued, 0, 'folder scan does not create scrape tasks');

  const ingestTask = adultLibraryService.enqueueIngestTask(subLib, path.join(watchRoot, 'MVSD-175.mp4'), { source: 'auto' });
  assert.ok(ingestTask, 'auto ingest can still be admitted through TaskAdmission when ingest is enabled');

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
  assert.strictEqual(scrapeTasks.json().tasks.length, 0, 'follow-up scrape is blocked when scrape is not globally enabled');

  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  const item = lib.json().items[0];
  const manual = await app.inject({ method: 'POST', url: `/v1/admin/adult/items/${item.itemId}/actions/rescrape` });
  assert.strictEqual(manual.statusCode, 201, 'manual rescrape remains an explicit user action');
  await app.close();
});

test('adult folder scan endpoint is removed and scan creates no task when automatic allow-list is empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    smartTaskEnabledActions: [],
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

  const autoScan = await adultLibraryService.scanSubLibrary(subLib);
  assert.strictEqual(autoScan.scanned, 1);
  assert.strictEqual(autoScan.queued, 0, 'folder scan never creates ingest tasks');
  assert.strictEqual(autoScan.scrapeQueued, 0, 'folder scan never creates scrape tasks');

  const manualScan = await app.inject({ method: 'POST', url: `/v1/admin/sublibraries/${subLib.uuid}/actions/scan` });
  assert.strictEqual(manualScan.statusCode, 410);
  assert.strictEqual(manualScan.json().error.code, 'ADULT_FOLDER_SCAN_REMOVED');
  await app.close();
});

test('adult folder scan does not avalanche item or task creation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const watchRoot = path.join(dir, 'jav');
  fs.mkdirSync(watchRoot, { recursive: true });

  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    ingestConcurrency: 1,
    scrapeConcurrency: 1,
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
  const scan = await adultLibraryService.scanSubLibrary(subLib);
  assert.strictEqual(scan.scanned, 12);
  assert.strictEqual(scan.queued, 0);
  assert.strictEqual(scan.scrapeQueued, 0);

  const lib = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib.json().total, 0, 'folder scan should not write library items directly');

  const ingestTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=ingest' });
  assert.strictEqual(ingestTasks.json().tasks.length, 0, 'folder scan should not create ingest tasks');
  const scrapeTasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  assert.strictEqual(scrapeTasks.json().tasks.length, 0, 'folder scan should not create scrape tasks');
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

  const globalConfig = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(globalConfig.statusCode, 200);
  assert.strictEqual(globalConfig.json().adultLibrary.western.stashBoxApiKey, '********');

  const patch = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/adult/config',
    payload: {
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

  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
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
  require('../src/adultLibraryService').stopSubLibraryWatcher(subLib.uuid);
  const filePath = path.join(watchRoot, 'MVSD-175.mp4');
  fs.writeFileSync(filePath, 'fake-video');

  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath, { enqueueScrape: false });
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

  // resetScrapeStatus cleared the failure marker.
  const lib2 = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLib.uuid}` });
  assert.strictEqual(lib2.json().items[0].adultMetadata.scrapeStatus, 'pending');

  // A second rescrape while a task is active → 409.
  const dup = await app.inject({ method: 'POST', url: `/v1/admin/adult/items/${itemId}/actions/rescrape` });
  assert.strictEqual(dup.statusCode, 409);
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
  const item = await adultLibraryService.upsertFileItem(sl, path.join(movieDir, 'MVSD-175.mp4'), { enqueueScrape: false });
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
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile, { enqueueScrape: false });
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
  const scanAfterOrganize = await adultLibraryService.scanSubLibrary(sl);
  assert.strictEqual(scanAfterOrganize.scanned, 0, 'default scan should ignore the consolidated scraped folder');
  assert.strictEqual(scanAfterOrganize.queued, 0);

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
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile, { enqueueScrape: false });
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
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile, { enqueueScrape: false });
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
  await adultLibraryService.upsertFileItem(sl, siblingFile, { enqueueScrape: false });
  const item = await adultLibraryService.upsertFileItem(sl, sourceFile, { enqueueScrape: false });
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

  const itemA = await adultLibraryService.upsertFileItem(subLib, fileA, { enqueueScrape: false });
  const itemB = await adultLibraryService.upsertFileItem(subLib, fileB, { enqueueScrape: false });
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

test('scrape of low-confidence (unknown prefix) item enters queue and attempts scraping', async () => {
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
  require('../src/adultLibraryService').stopSubLibraryWatcher(subLib.uuid);
  // Unknown prefix ZZZZZ — parses but is not a known maker, → ambiguous.
  const filePath = path.join(watchRoot, 'ZZZZZ-999.mp4');
  fs.writeFileSync(filePath, 'fake-video');
  const adultLibraryService = require('../src/adultLibraryService');
  const item = await adultLibraryService.upsertFileItem(subLib, filePath);
  assert.strictEqual(item.adultMetadata.scrapeStatus, 'ambiguous');
  assert.strictEqual(item.adultMetadata.idConfidence, 'low');

  // Ambiguous items still enter the task flow; the scrape executor attempts the
  // detected ID instead of failing before it contacts a scraper.
  const tasks = await app.inject({ method: 'GET', url: '/v1/tasks?actionType=scrape' });
  const task = tasks.json().tasks.find((t) => t.itemId === item.itemId);
  assert.ok(task, 'auto scrape task exists for ambiguous item');

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
    itemId: `task-filter-item-${index + 1}`,
    subLibraryId: 'sub-task-filter',
    source: 'emby',
    type: 'movie',
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
  libraryStore.loadLibrary = () => {
    throw new Error('task filter should not load full library');
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

test('adult JAV default template requires scraped=true and transcodes non-HEVC or high bitrate', async () => {
  const { buildAdultJavDefaultTemplate } = require('../src/configStore');
  const { ruleMatches } = require('../src/strategyEngine');
  const tpl = buildAdultJavDefaultTemplate();
  assert.strictEqual(tpl.tag.version, 2);
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
  assert.ok(!ruleMatches({ scraped: false, codec: 'h264', bucket: '1080p', equivalentBitrate: 8 }, nonHevc));
  assert.ok(!ruleMatches({ bucket: '1080p', equivalentBitrate: 8 }, transcode1080p));
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
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'upgrade-test-' + crypto.randomUUID().slice(0, 8), actionType: 'upgrade' },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.id);
  assert.strictEqual(body.actionType, 'upgrade');
  assert.strictEqual(body.status, 'created');
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
  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'upgrade-confirm-' + crypto.randomUUID().slice(0, 8), actionType: 'upgrade' },
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

  await app.close();
});

test('POST /v1/tasks/:id/actions/pause on upgrade task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'upgrade-pause-' + crypto.randomUUID().slice(0, 8), actionType: 'upgrade' },
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

  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'upgrade-resume-' + crypto.randomUUID().slice(0, 8), actionType: 'upgrade' },
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

  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { itemId: 'upgrade-noconfig-' + crypto.randomUUID().slice(0, 8), actionType: 'upgrade' },
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

  const create = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: {
      itemId: 'upgrade-precheck-' + crypto.randomUUID().slice(0, 8),
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
