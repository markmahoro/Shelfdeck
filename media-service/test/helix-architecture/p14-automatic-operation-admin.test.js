'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');

const secretRoot = 'p14-automatic-operation-secret-root-0123456789abcdef';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-automatic-operation-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  return Object.freeze({ root, dataDir, adminDistDir, initialized });
}

async function session(host, apiKey) {
  const exchange = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  });
  assert.equal(exchange.statusCode, 204, exchange.body);
  return exchange.headers['set-cookie'];
}

test('Librarian can choose 全自动 or 关键步骤确认 without granting Off-deck destruction', async (t) => {
  const value = fixture();
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  t.after(async () => {
    await host.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const cookie = await session(host, value.initialized.adminApiKey);

  const setup = await host.inject({ method: 'GET', url: '/v1/admin/setup-readiness', headers: { cookie } });
  assert.equal(setup.statusCode, 200, setup.body);
  const setupBody = setup.json();
  assert.equal(setupBody.data.productChoice, 'key_step_confirmation');
  assert.equal(setupBody.data.offdeckDestruction.independentlyDisabled, true);
  assert.equal(setupBody.data.offdeckDestruction.grantedByFullAuto, false);

  const before = await host.inject({ method: 'GET', url: '/v1/admin/settings/automatic-operation', headers: { cookie } });
  assert.equal(before.statusCode, 200, before.body);
  assert.deepEqual(before.json().data.productChoice, setupBody.data.productChoice);
  assert.equal(before.json().data.standingInputSettlement, null);

  const enabled = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/automatic-operation/actions/enable-full',
    headers: { cookie },
    payload: {
      idempotencyKey: 'enable-full-v1',
      expectedRevision: 0,
      coverExclusiveRelatedInput: true,
    },
  });
  assert.equal(enabled.statusCode, 200, enabled.body);
  const enabledBody = enabled.json();
  assert.equal(enabledBody.standingAuthorization.state, 'enabled');
  assert.equal(enabledBody.standingAuthorization.coversExclusiveRelatedInput, true);
  assert.equal(enabledBody.standingAuthorization.authorizationScopeKind, 'old_primary_and_exclusive_related');
  assert.equal(enabledBody.readiness.data.productChoice, 'full_auto');
  assert.ok(enabledBody.ownerResults.some((item) => item.topic === 'offdeck_destruction' && item.result === 'unchanged_disabled'));
  assert.equal(enabledBody.readiness.data.offdeckDestruction.grantedByFullAuto, false);

  const replay = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/automatic-operation/actions/enable-full',
    headers: { cookie },
    payload: {
      idempotencyKey: 'enable-full-v1',
      expectedRevision: 0,
      coverExclusiveRelatedInput: true,
    },
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().replayed, true);

  const stale = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/automatic-operation/actions/require-settlement-confirmation',
    headers: { cookie },
    payload: { idempotencyKey: 'require-stale', expectedRevision: 0 },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().error.code, 'ADMIN_AUTOMATION_CONFLICT');

  const confirmation = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/automatic-operation/actions/require-settlement-confirmation',
    headers: { cookie },
    payload: {
      idempotencyKey: 'require-confirmation-v1',
      expectedRevision: enabledBody.standingAuthorization.revision,
    },
  });
  assert.equal(confirmation.statusCode, 200, confirmation.body);
  assert.equal(confirmation.json().standingAuthorization.state, 'revoked');
  assert.equal(confirmation.json().readiness.data.productChoice, 'key_step_confirmation');

  const overview = await host.inject({ method: 'GET', url: '/v1/admin/overview', headers: { cookie } });
  assert.equal(overview.statusCode, 200, overview.body);
  assert.equal(overview.json().setup.productChoice, 'key_step_confirmation');

  const offdeck = await host.inject({ method: 'GET', url: '/v1/admin/offdeck/policies', headers: { cookie } });
  assert.equal(offdeck.statusCode, 200, offdeck.body);
  assert.equal(offdeck.json().status, 'disabled');
});
