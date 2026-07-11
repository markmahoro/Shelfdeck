'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildApp } = require('../src/app');
const cleanState = require('../src/helixCleanState');
const embyService = require('../src/services/embyService');
const transcodeService = require('../src/services/transcodeService');

test('Emby connection test is read-only and saving requires a selected user', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-admin-config-api-'));
  cleanState.applyCleanInit({ dataDir: dir, confirmation: cleanState.APPLY_CONFIRMATION });
  const originals = {
    authenticateByUsername: embyService.authenticateByUsername,
    testConnection: embyService.testConnection,
    getUsers: embyService.getUsers,
    probeEncodeDevices: transcodeService.probeEncodeDevices,
  };
  embyService.authenticateByUsername = async () => ({ token: 'access-token', userId: 'user-one' });
  embyService.testConnection = async () => ({ serverName: 'Test Emby', version: '1.0' });
  embyService.getUsers = async () => [{ id: 'user-one', name: 'User One' }];
  transcodeService.probeEncodeDevices = async () => ({ devices: [{ stableKey: 'cpu:libx265', label: 'CPU', backend: 'cpu', gpuIndex: -1 }] });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  try {
    const tested = await app.inject({
      method: 'POST', url: '/v1/admin/emby/connections/test',
      payload: { baseUrl: 'http://emby.test', username: 'tester', password: 'secret' },
    });
    assert.strictEqual(tested.statusCode, 200);
    assert.deepStrictEqual(tested.json().users, [{ id: 'user-one', name: 'User One' }]);
    assert.deepStrictEqual((await app.inject({ method: 'GET', url: '/v1/admin/emby/servers' })).json().servers, []);

    const missingUser = await app.inject({
      method: 'POST', url: '/v1/admin/emby/servers',
      payload: { baseUrl: 'http://emby.test', username: 'tester', password: 'secret' },
    });
    assert.strictEqual(missingUser.statusCode, 400);
    assert.strictEqual(missingUser.json().error.code, 'EMBY_USER_REQUIRED');

    const saved = await app.inject({
      method: 'POST', url: '/v1/admin/emby/servers',
      payload: { baseUrl: 'http://emby.test', username: 'tester', password: 'secret', userId: 'user-one' },
    });
    assert.strictEqual(saved.statusCode, 201);
    const servers = (await app.inject({ method: 'GET', url: '/v1/admin/emby/servers' })).json().servers;
    assert.strictEqual(servers.length, 1);
    assert.strictEqual(servers[0].userId, 'user-one');
    assert.strictEqual(servers[0].credentialConfigured, true);
    assert.strictEqual(servers[0].username, 'tester');

    const probe = await app.inject({ method: 'POST', url: '/v1/admin/transcode/actions/probe-devices' });
    assert.strictEqual(probe.statusCode, 200);
    assert.strictEqual(probe.json().devices[0].stableKey, 'cpu:libx265');
    assert.strictEqual((await app.inject({ method: 'GET', url: '/v1/admin/transcode/probe-devices' })).statusCode, 404);
    assert.strictEqual((await app.inject({ method: 'POST', url: '/v1/admin/emby/test' })).statusCode, 404);

    const moviepilotSaved = await app.inject({
      method: 'PATCH', url: '/v1/admin/upgrade/config',
      payload: { moviepilot: { baseUrl: 'http://moviepilot.test', apiKey: 'moviepilot-secret', savePath: '/staging' } },
    });
    assert.strictEqual(moviepilotSaved.statusCode, 200);
    assert.strictEqual(moviepilotSaved.json().moviepilot.apiKey, '********');
    await app.inject({
      method: 'PATCH', url: '/v1/admin/upgrade/config',
      payload: { moviepilot: { baseUrl: 'http://moviepilot.changed', apiKey: '********', savePath: '/staging' } },
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.strictEqual(persisted.moviepilot.apiKey, 'moviepilot-secret');
    const storedEmby = Object.values(persisted.embyServers || {})[0];
    assert.strictEqual(storedEmby.accessToken, 'access-token');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(storedEmby, 'embyUserPassword'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(storedEmby, 'apiKey'), false);
  } finally {
    await app.close();
    Object.assign(embyService, { authenticateByUsername: originals.authenticateByUsername, testConnection: originals.testConnection, getUsers: originals.getUsers });
    transcodeService.probeEncodeDevices = originals.probeEncodeDevices;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});
