'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildApp } = require('../src/app');
const mediaPolicyService = require('../src/mediaPolicyService');

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
  assert.ok(body.checks.service, 'service check present');
  assert.ok(body.checks.config, 'config check present');
  assert.ok(body.checks.emby, 'emby check present');
  assert.ok(body.checks.scheduler, 'scheduler check present');
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
  assert.ok(cfg.mediaPolicy, 'mediaPolicy present');
  assert.strictEqual(cfg.mediaPolicy.target1080p['5'], 12);
  assert.strictEqual(cfg.mediaPolicy.target4k['5'], 25);
  assert.ok(cfg.embyServers !== undefined, 'embyServers present');
  assert.ok(Array.isArray(cfg.subLibraries), 'subLibraries is array');
  assert.ok(Array.isArray(cfg.transcodeEncodingDevices), 'transcodeEncodingDevices is array');
  await app.close();
});

test('PATCH /v1/config persists and reloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const patch = {
    mediaPolicy: {
      target1080p: { '2': 3, '3': 5, '4': 8, '5': 15 },
      target4k: { '2': 6, '3': 12, '4': 18, '5': 30 },
    },
  };
  const res = await app.inject({ method: 'PATCH', url: '/v1/config', payload: patch });
  assert.strictEqual(res.statusCode, 200);
  const updated = res.json();
  assert.strictEqual(updated.mediaPolicy.target1080p['5'], 15);
  assert.strictEqual(updated.mediaPolicy.target4k['5'], 30);
  const res2 = await app.inject({ method: 'GET', url: '/v1/config' });
  const reloaded = res2.json();
  assert.strictEqual(reloaded.mediaPolicy.target1080p['5'], 15);
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

test('mediaPolicyService.recommendedAction scenarios', async () => {
  const policy = {
    target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
    target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
  };

  // 3-star above target (30 Mbps > target+1=5) -> transcode
  const t3 = { bitrate: 30_000_000, resolution: '1080p', doubanRating: 3, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t3, policy).action, 'transcode');

  // 3-star well below target (2 Mbps < target=4) -> keep
  const t3low = { bitrate: 2_000_000, resolution: '1080p', doubanRating: 3, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t3low, policy).action, 'keep');

  // 4-star below target*0.8 for 4K (2 Mbps < 16*0.8=12.8) -> upgrade
  const t4low = { bitrate: 2_000_000, resolution: '4K', doubanRating: 4, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t4low, policy).action, 'upgrade');

  // 4-star at target (7 Mbps between 5.6 and 8) -> keep
  const t4ok = { bitrate: 7_000_000, resolution: '1080p', doubanRating: 4, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t4ok, policy).action, 'keep');

  // 5-star 1080p -> upgrade
  const t5_1080 = { bitrate: 10_000_000, resolution: '1080p', doubanRating: 5, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t5_1080, policy).action, 'upgrade');

  // 1-star/2-star -> delete
  const t1 = { bitrate: 5_000_000, resolution: '1080p', doubanRating: 1, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t1, policy).action, 'delete');

  // No rating -> keep
  const tNone = { bitrate: 5_000_000, resolution: '1080p', doubanRating: null, userRating: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(tNone, policy).action, 'keep');
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
