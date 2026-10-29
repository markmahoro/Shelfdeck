'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { createResetManagementHost } = require('../src/clean-reset-management-host');
const { createSessionTokenService } = require('../src/helix/platform/public/session-token-service');
const { apiKeyDigest } = require('../src/admin-credential-secret-store');

test('cold management preserves authentication and status while every ordinary business route stays unavailable', async t => {
  const apiKey = 'isolated-management-host-test-key-20261026';
  const credential = { credentialId: 'admin-primary', revision: 1, apiKeyDigest: apiKeyDigest(apiKey),
    signingSecret: 'isolated-management-host-signing-secret-20261026' };
  let authorized = true;
  const readCredential = () => { if (!authorized) throw Error('generation is no longer stopped'); return credential; };
  const state = { mode: 'resetting', desiredMode: 'stopped', normalSupplyAllowed: false, revision: 3,
    operation: { kind: 'reset', state: 'pending', operationId: 'operation-1' }, error: null };
  let retryCount = 0;
  const host = await createResetManagementHost({ readCredential, readStatus: () => state, retryReset(body, actor) {
    assert.equal(actor.actorId, 'admin-primary');
    assert.deepEqual(body, { confirmed: true, previewDigest: 'approved', idempotencyKey: 'same-request' });
    retryCount++; return state.operation;
  } });
  t.after(() => host.close());
  const request = (method, url, payload, headers = { 'x-api-key': apiKey }) => host.inject({ method, url, payload, headers });
  const health = await request('GET', '/v1/health', undefined, {});
  assert.equal(health.statusCode, 200); assert.equal(health.json().status, 'maintenance');
  assert.equal(health.json().normalSupplyAllowed, false);
  assert.equal((await request('GET', '/v1/admin/runtime', undefined, {})).statusCode, 401);
  assert.equal((await request('GET', '/v1/admin/runtime', undefined, { cookie: 'shelfdeck_admin_session=%zz' })).statusCode, 401);
  const status = await request('GET', '/v1/admin/runtime');
  assert.equal(status.statusCode, 200); assert.deepEqual(status.json(), state);
  for (const [method, url] of [['GET', '/v1/admin/collection'], ['POST', '/v1/admin/runtime/actions/resume'], ['POST', '/v1/admin/material-fields']]) {
    const blocked = await request(method, url, method === 'POST' ? {} : undefined);
    assert.equal(blocked.statusCode, 503); assert.equal(blocked.json().error.code, 'RESET_BUSINESS_DATABASE_CLOSED');
  }
  assert.equal(retryCount, 0);
  const login = await request('POST', '/v1/admin/session', {});
  assert.equal(login.statusCode, 204);
  assert.match(login.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await request('GET', '/v1/admin/runtime', undefined, { cookie })).statusCode, 200);
  const body = { confirmed: true, previewDigest: 'approved', idempotencyKey: 'same-request' };
  assert.equal((await request('POST', '/v1/admin/runtime/actions/reset', body, { cookie, origin: 'https://elsewhere.invalid' })).statusCode, 403);
  assert.equal(retryCount, 0);
  assert.equal((await request('POST', '/v1/admin/runtime/actions/reset', body, { cookie })).statusCode, 202);
  assert.equal(retryCount, 1);
  const earlierSessions = createSessionTokenService({ readActiveCredential: () => credential });
  const token = earlierSessions.issue({ apiKey, nowMs: Date.now(), ttlMs: 60000, nonce: 'earlier-host-session' });
  assert.equal((await request('GET', '/v1/admin/runtime', undefined, { cookie: 'shelfdeck_admin_session=' + token })).statusCode, 200);
  authorized = false;
  assert.equal((await request('GET', '/v1/admin/runtime', undefined, { cookie })).statusCode, 401);
});

test('cold status cannot claim normal supply and errors do not return raw diagnostics or secrets', async t => {
  const secret = 'isolated-private-message-must-not-escape';
  const host = await createResetManagementHost({ readCredential() { throw Error(secret); },
    readStatus: () => ({ mode: 'running', desiredMode: 'running', normalSupplyAllowed: true }) });
  t.after(() => host.close());
  const health = await host.inject({ method: 'GET', url: '/v1/health' });
  assert.equal(health.statusCode, 503); assert.equal(health.json().error.code, 'RESET_MANAGEMENT_STATE_INVALID');
  const response = await host.inject({ method: 'GET', url: '/v1/admin/runtime', headers: { 'x-api-key': 'invalid' } });
  assert.equal(response.statusCode, 401); assert.equal(response.body.includes(secret), false);
});

test('cold preflight errors identify People blockers without implying that Reset has begun', async t => {
  const apiKey = 'isolated-people-error-copy-key';
  let code;
  const fail = () => { throw Object.assign(new Error('private details must not escape'), { code, statusCode: 409 }); };
  const host = await createResetManagementHost({ readCredential: () => ({ credentialId: 'admin-primary', revision: 1,
    apiKeyDigest: apiKeyDigest(apiKey), signingSecret: 'isolated-people-error-copy-signing-secret' }),
    readStatus: () => ({ mode: 'stopped', desiredMode: 'stopped', normalSupplyAllowed: false }), previewReset: fail, retryReset: fail });
  t.after(() => host.close());
  for (code of ['RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_INVALID', 'RESET_VERIFY_PEOPLE_REFERENCE_STORAGE_INVALID']) {
    const response = await host.inject({ method: 'GET', url: '/v1/admin/runtime/reset-preview?fresh=true', headers: { 'x-api-key': apiKey } });
    assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, code);
    assert.match(response.json().error.message, /^预检未通过：人物参考资料/);
    assert.doesNotMatch(response.body, /重置未完成|private details/);
    const execute = await host.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers: { 'x-api-key': apiKey }, payload: {} });
    assert.match(execute.json().error.message, /^重置无法继续：/);
    assert.doesNotMatch(execute.body, /预检未通过/);
  }
  code = 'RESET_COPY_OWNER_REFERENCE_MISSING';
  const generic = await host.inject({ method: 'GET', url: '/v1/admin/runtime/reset-preview', headers: { 'x-api-key': apiKey } });
  assert.match(generic.json().error.message, /^预检未通过/); assert.doesNotMatch(generic.body, /人物/);
});
