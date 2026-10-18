'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');

test('formal Host exposes versioned maintenance configuration and preserves operator stop across restart', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-maintenance-host-'));
  const dataDir = path.join(root, 'data'), adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir); fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const secretRoot = 'maintenance-host-isolated-fixture-root-0123456789';
  let now = Date.parse('2026-10-24T02:59:00+08:00'), host = null;
  const errors = [];
  const initialized = initializeCleanData({ dataDir, secretRoot, confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
  const create = () => createCleanServiceHost({ dataDir, adminDistDir, secretRoot, now: () => now, onExecutionRuntimeError: error => errors.push(error.code) });
  t.after(async () => {
    await host?.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('helix-maintenance-host-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  host = await create();
  async function login() {
    const response = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': initialized.adminApiKey } });
    assert.equal(response.statusCode, 204, response.body);
    return response.headers['set-cookie'];
  }
  let cookie = await login();
  const get = async url => { const response = await host.inject({ method: 'GET', url, headers: { cookie } }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const configuration = await get('/v1/admin/runtime/maintenance');
  assert.deepEqual(configuration.settings, { weekday: 6, startTime: '03:00', endTime: '09:00', timeZone: 'Asia/Shanghai' });
  const command = { expectedRevision: configuration.revision, idempotencyKey: 'maintenance-test-edit', settings: { endTime: '08:00' } };
  const patch = payload => host.inject({ method: 'PATCH', url: '/v1/admin/runtime/maintenance', headers: { cookie }, payload });
  const saved = await patch(command); assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().pendingSettings.settings.startTime, '03:00');
  assert.equal(saved.json().pendingSettings.settings.endTime, '08:00');
  assert.deepEqual((await patch(command)).json(), saved.json());
  const stale = await patch({ ...command, idempotencyKey: 'stale' }); assert.equal(stale.statusCode, 409);
  now = Date.parse('2026-10-24T03:00:00+08:00');
  let runtime;
  const deadline = Date.now() + 5000;
  do { await new Promise(resolve => setTimeout(resolve, 100)); runtime = await get('/v1/admin/runtime'); }
  while (!runtime.maintenance.maintenanceActive && Date.now() < deadline);
  assert.equal(runtime.maintenance.maintenanceActive, true);
  assert.equal(runtime.normalSupplyAllowed, false);
  assert.equal(runtime.desiredMode, 'running');
  assert.equal(runtime.maintenance.windowEndAtMs, Date.parse('2026-10-24T08:00:00+08:00'));
  const stopped = await host.inject({ method: 'POST', url: '/v1/admin/runtime/actions/stop', headers: { cookie }, payload: { idempotencyKey: 'manual-stop' } });
  assert.equal(stopped.statusCode, 202, stopped.body);
  const stopDeadline = Date.now() + 5000;
  do { await new Promise(resolve => setTimeout(resolve, 50)); runtime = await get('/v1/admin/runtime'); }
  while (runtime.mode !== 'stopped' && Date.now() < stopDeadline);
  assert.equal(runtime.mode, 'stopped');
  await host.close(); host = null;
  host = await create(); cookie = await login();
  const restarted = await get('/v1/admin/runtime');
  assert.equal(restarted.desiredMode, 'stopped'); assert.equal(restarted.mode, 'stopped');
  assert.equal(restarted.normalSupplyAllowed, false); assert.equal(restarted.maintenance.maintenanceActive, false);
  assert.deepEqual(errors, []);
});
