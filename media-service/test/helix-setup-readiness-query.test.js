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

test('Setup Readiness defaults to 关键步骤确认 and never claims Off-deck destruction', () => {
  const query = createSetupReadinessQuery(readers());
  const value = query.get();
  assert.equal(value.data.productChoice, 'key_step_confirmation');
  assert.equal(value.data.productChoiceLabel, '关键步骤确认');
  assert.equal(value.data.fullAutoReady, false);
  assert.equal(value.data.offdeckDestruction.independentlyDisabled, true);
  assert.equal(value.data.offdeckDestruction.grantedByFullAuto, false);
  assert.ok(value.data.consequences.some((item) => item.topic === 'input_settlement' && item.text.includes('每次上架处理旧输入')));
  assert.ok(value.data.consequences.some((item) => item.topic === 'offdeck_destruction' && item.text.includes('独立关闭')));
  assert.ok(value.availableActions.some((item) => item.actionCode === 'enable_full_automatic_operation'));
});

test('全自动已就绪 only when Field, Shelf, Routing, Workspace, Provider and standing Authorization are all ready', () => {
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
  assert.equal(blocked.data.productChoice, 'full_auto');
  assert.equal(blocked.data.fullAutoReady, false);
  assert.equal(blocked.data.fullAutoReadyLabel, '全自动尚未就绪');
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
  assert.equal(ready.data.fullAutoReadyLabel, '全自动已就绪');
  assert.ok(ready.data.consequences.some((item) => item.text.includes('独占附属文件')));
  assert.ok(ready.data.consequences.every((item) => !item.text.includes('销毁授权')));
});
