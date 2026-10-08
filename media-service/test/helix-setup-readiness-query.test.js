'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSetupReadinessQuery } = require('../src/helix/projections/setup-readiness-query');

function readers(overrides = {}) {
  return {
    now: () => Date.UTC(2026, 7, 22),
    readMaterialFields: () => ({ items: [{ fieldId: 'field-1', status: 'active' }] }),
    readShelves: () => ({ items: [{ shelfId: 'shelf-1', status: 'active' }] }),
    readStandingAuthorization: () => null,
    readRouting: () => ({ policy: { revision: 1 } }),
    readIntegration: () => ({ configured: true }),
    readWorkspace: () => ({ ready: true, rootPath: 'E:\\workspace' }),
    ...overrides,
  };
}

test('Setup Readiness reports standing settlement authorization without an operating mode', () => {
  const query = createSetupReadinessQuery(readers());
  const value = query.get();
  assert.equal(Object.hasOwn(value.data, 'productChoice'), false);
  assert.equal(value.data.standingInputSettlement, null);
  assert.equal(value.data.fullAutoReady, false);
  assert.equal(value.data.offdeckDestruction.independentlyDisabled, true);
  assert.equal(value.data.offdeckDestruction.grantedByFullAuto, false);
  assert.ok(value.data.consequences.some((item) => item.topic === 'input_settlement' && item.text.includes('等待授权')));
  assert.ok(value.data.consequences.some((item) => item.topic === 'offdeck_destruction' && item.text.includes('独立关闭')));
  assert.ok(value.availableActions.some((item) => item.actionCode === 'enable_input_settlement_authorization'));
});

test('Readiness is complete only when Field, Shelf, Routing, Workspace, Provider and standing Authorization are all ready', () => {
  const missingTmdb = createSetupReadinessQuery(readers({
    readStandingAuthorization: () => ({
      state: 'enabled',
      authorizationId: 'arca-input-settlement-standing',
      revision: 1,
      authorizationScopeKind: 'old_primary_and_exclusive_related',
      coversExclusiveRelatedInput: true,
    }),
    readIntegration: () => ({ configured: false }),
  }));
  const blocked = missingTmdb.get();
  assert.equal(Object.hasOwn(blocked.data, 'productChoice'), false);
  assert.equal(blocked.data.standingInputSettlement.enabled, true);
  assert.equal(blocked.data.fullAutoReady, false);
  assert.equal(blocked.data.fullAutoReadyLabel, '自动整理配置尚未就绪');
  assert.ok(blocked.data.items.some((item) => item.key === 'provider' && item.ready === false));

  const ready = createSetupReadinessQuery(readers({
    readStandingAuthorization: () => ({
      state: 'enabled',
      authorizationId: 'arca-input-settlement-standing',
      revision: 1,
      authorizationScopeKind: 'old_primary_and_exclusive_related',
      coversExclusiveRelatedInput: true,
    }),
  })).get();
  assert.equal(ready.data.fullAutoReady, true);
  assert.equal(ready.data.fullAutoReadyLabel, '自动整理配置已就绪');
  assert.ok(ready.data.consequences.some((item) => item.text.includes('独占关联文件')));
  assert.ok(ready.data.consequences.every((item) => !item.text.includes('销毁授权')));
});
