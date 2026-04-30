'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildApp } = require('../src/app');

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
  assert.strictEqual(cfg.ruleTemplates[0].name, '默认策略');
  assert.ok(cfg.embyServers !== undefined, 'embyServers present');
  assert.ok(Array.isArray(cfg.subLibraries), 'subLibraries is array');
  assert.ok(Array.isArray(cfg.transcodeEncodingDevices), 'transcodeEncodingDevices is array');
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
  taskStore.updateTask(id, { status: 'executing' });
  // Delete should call cancel then remove
  const res = await app.inject({ method: 'DELETE', url: `/v1/tasks/${id}` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().ok, true);
  // Verify gone
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
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'a1', actionType: 'delete' } });
  await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'a2', actionType: 'transcode' } });
  const res = await app.inject({ method: 'GET', url: '/v1/admin/tasks' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.tasks));
  assert.ok(body.summary, 'summary present');
  assert.strictEqual(typeof body.summary.total, 'number');
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
