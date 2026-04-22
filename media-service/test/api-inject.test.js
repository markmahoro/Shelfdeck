'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildApp } = require('../src/app');
const embyService = require('../src/services/embyService');
const mediaPolicyService = require('../src/services/mediaPolicyService');

test('GET /v1/health (no auth)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/health' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.status, 'ok');
  await app.close();
});

test('POST /v1/client/actions/launch-player → 501', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/client/actions/launch-player', payload: {} });
  assert.strictEqual(res.statusCode, 501);
  await app.close();
});

test('X-API-Key enforced when CONTROL_PLANE_API_KEY set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: 'test-secret-key' });
  let res = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(res.statusCode, 401);
  res = await app.inject({ method: 'GET', url: '/v1/config', headers: { 'x-api-key': 'test-secret-key' } });
  assert.strictEqual(res.statusCode, 200);
  await app.close();
});

test('PUT/GET /v1/sync/task-queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  let res = await app.inject({
    method: 'PUT',
    url: '/v1/sync/task-queue',
    payload: [{ id: 't1', itemId: 'i1', itemName: 'x', actionType: 'delete', status: 'queued', progress: 0, createdAt: '', updatedAt: '', retryCount: 0 }],
  });
  assert.strictEqual(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/v1/sync/task-queue' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(Array.isArray(body), true);
  assert.strictEqual(body.length, 1);
  assert.strictEqual(body[0].id, 't1');
  await app.close();
});

test('GET /v1/config includes mediaPolicy defaults', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.strictEqual(res.statusCode, 200);
  const cfg = res.json();
  assert.ok(cfg.mediaPolicy, 'mediaPolicy field present');
  assert.strictEqual(cfg.mediaPolicy.target1080p[5], 12);
  assert.strictEqual(cfg.mediaPolicy.target4k[5], 25);
  await app.close();
});

test('PATCH /v1/config persists mediaPolicy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const patch = {
    mediaPolicy: {
      target1080p: { 2: 3, 3: 5, 4: 8, 5: 15 },
      target4k: { 2: 6, 3: 12, 4: 18, 5: 30 },
    },
  };
  const res = await app.inject({ method: 'PATCH', url: '/v1/config', payload: patch });
  assert.strictEqual(res.statusCode, 200);
  const updated = res.json();
  assert.strictEqual(updated.mediaPolicy.target1080p[5], 15);
  assert.strictEqual(updated.mediaPolicy.target4k[5], 30);
  // Confirm persisted
  const res2 = await app.inject({ method: 'GET', url: '/v1/config' });
  const reloaded = res2.json();
  assert.strictEqual(reloaded.mediaPolicy.target1080p[5], 15);
  await app.close();
});

test('PATCH /v1/library/ratings + GET round-trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const itemId = 'test-item-' + crypto.randomUUID().slice(0, 8);
  let res = await app.inject({
    method: 'PATCH',
    url: '/v1/library/ratings',
    payload: { [itemId]: 4 },
  });
  assert.strictEqual(res.statusCode, 200);
  const patchResult = res.json();
  assert.strictEqual(patchResult.ok, true);
  assert.strictEqual(patchResult.count, 1);

  res = await app.inject({ method: 'GET', url: '/v1/library/ratings' });
  assert.strictEqual(res.statusCode, 200);
  const ratings = res.json();
  assert.strictEqual(ratings[itemId]?.rating, 4);

  // Set to null (delete)
  await app.inject({ method: 'PATCH', url: '/v1/library/ratings', payload: { [itemId]: null } });
  const res2 = await app.inject({ method: 'GET', url: '/v1/library/ratings' });
  const afterDelete = res2.json();
  assert.strictEqual(afterDelete[itemId], undefined);

  await app.close();
});

test('POST /v1/tasks missing itemId → 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { actionType: 'delete' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks missing actionType → 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'abc' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks invalid actionType → 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'abc', actionType: 'invalid' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasks with old-format id still works (backward compat)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { id: 'legacy-task-1', itemId: 'x', itemName: 'Test', actionType: 'delete', status: 'queued', progress: 0, createdAt: '', updatedAt: '', retryCount: 0 },
  });
  assert.strictEqual(res.statusCode, 201);
  const body = res.json();
  assert.strictEqual(body.id, 'legacy-task-1');
  await app.close();
});

test('POST /v1/tasks no emby config → 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'abc', actionType: 'delete' } });
  assert.strictEqual(res.statusCode, 400);
  const body = res.json();
  assert.strictEqual(body.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/tasksBluRay item → 409 BLURAY_DISC_REJECTED (stubbed)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });

  // Pre-set embyClient.baseUrl so resolveEmbyClientFromConfig passes
  const configStore = require('../src/configStore');
  configStore.patchConfig({ embyClient: { baseUrl: 'http://localhost:8096', apiKey: 'test', userId: 'user', embyUserPassword: '' } });

  // Stub embyService.getLibraryItem to return a BluRay item
  const orig = embyService.getLibraryItem;
  embyService.getLibraryItem = async () => ({ Name: 'Test Movie', Path: '/mnt/Bluray/disk.iso' });
  const origBluray = embyService.inferIsBluRayDisc;
  embyService.inferIsBluRayDisc = () => true;

  // Provide emby config via query
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tasks?embyProfileId=_main',
    payload: { itemId: 'bd-item', actionType: 'transcode' },
  });
  assert.strictEqual(res.statusCode, 409);
  const body = res.json();
  assert.strictEqual(body.code, 'BLURAY_DISC_REJECTED');

  embyService.inferIsBluRayDisc = origBluray;
  embyService.getLibraryItem = orig;
  await app.close();
});

test('mediaPolicyService.recommendedAction scenarios', async () => {
  const policy = {
    target1080p: { 2: 2, 3: 4, 4: 7, 5: 12 },
    target4k: { 2: 5, 3: 10, 4: 16, 5: 25 },
  };

  // 3★ above target (eq=30 > target+1=5) → transcode
  // sizeGb=8,dur=3600,codec=h264: eq = (8*8192/3600 - 0.5) * 1.35 = 23.9
  const t3 = { sizeGb: 8, durationSec: 3600, codec: 'h264', resolution: '1080p', rating: 3, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t3, policy), 'transcode');

  // 3★ well below target (eq=2.7 < target=4) → keep
  // sizeGb=1,dur=3600,codec=h265: eq = (1*8192/3600 - 0.5) * 1.0 = 1.8
  const t3low = { sizeGb: 1, durationSec: 3600, codec: 'h265', resolution: '1080p', rating: 3, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t3low, policy), 'keep');

  // 4★ below target×0.8 (eq=2.1 < target*0.8=12.8 for 4K) → upgrade
  // sizeGb=1,dur=3600,codec=h265: eq = 1.8
  const t4low = { sizeGb: 1, durationSec: 3600, codec: 'h265', resolution: '4K', rating: 4, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t4low, policy), 'upgrade');

  // 4★ at target → keep
  // sizeGb=2.8,dur=3600,codec=h265: eq = (2.8*8192/3600-0.5)*1.0 = 5.9
  // 5.9 < 5.6 (upgrade)? NO; 5.9 > 8 (transcode)? NO → keep
  const t4ok = { sizeGb: 2.8, durationSec: 3600, codec: 'h265', resolution: '1080p', rating: 4, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t4ok, policy), 'keep');

  // 5★ 1080p → always upgrade
  const t5_1080 = { sizeGb: 10, durationSec: 3600, codec: 'h264', resolution: '1080p', rating: 5, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t5_1080, policy), 'upgrade');

  // 1★/2★ → delete
  const t1 = { sizeGb: 5, durationSec: 3600, codec: 'h264', resolution: '1080p', rating: 1, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(t1, policy), 'delete');

  // No rating → keep
  const tNone = { sizeGb: 5, durationSec: 3600, codec: 'h264', resolution: '1080p', rating: null, doubanStars: null };
  assert.strictEqual(mediaPolicyService.recommendedAction(tNone, policy), 'keep');
});
