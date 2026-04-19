'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildApp } = require('../src/app');

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
