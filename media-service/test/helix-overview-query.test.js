'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOverviewQuery } = require('../src/helix/projections/overview-query');

test('Overview uses system three-state, clickable todos, and titled ledger instead of duplicate counts', () => {
  const query = createOverviewQuery({
    now: () => Date.UTC(2026, 7, 22),
    readMaterialFields: () => ({ items: [] }),
    readShelves: () => ({ items: [] }),
    readFormation: () => ({
      summary: { totalCount: 2, pendingCount: 0, inProgressCount: 1, attentionRequiredCount: 1, completedCount: 1 },
      attentionItems: [{ subjectId: 's-att', displayIdentity: '待处理片' }],
      inProgressItems: [{ subjectId: 's-run', displayIdentity: '整理中片' }],
      completedItems: [{ subjectId: 's-done', displayIdentity: '已上架片' }],
    }),
    readCollectionStats: () => ({
      currentCount: 3, monthNewCount: 1, healthyCount: 2, healthAttentionCount: 1,
      recentOnDeck: [{ shelfEntryId: 'e1', displayIdentity: '新片', createdAtMs: 1 }],
    }),
    readOffdeck: () => ({ candidates: [{ state: 'open' }] }),
    readPeopleSummary: () => ({ openRegistrationCandidateCount: 2 }),
    readHealth: () => ({ kind: 'ready' }),
  });
  const value = query.get();
  assert.equal(value.systemState.kind, 'unconfigured');
  assert.equal(value.systemState.label, '尚未配置');
  assert.deepEqual(value.metrics.map((item) => item.key), ['active_collection', 'new_this_month', 'healthy_collection']);
  assert.ok(value.todos.some((item) => item.key === 'formation' && item.count === 1 && item.href === '/formation'));
  assert.ok(value.todos.some((item) => item.key === 'health'));
  assert.ok(value.todos.some((item) => item.key === 'offdeck'));
  assert.ok(value.todos.some((item) => item.key === 'people'));
  assert.ok(value.ledger.some((item) => item.label === '已上架 · 已上架片'));
  assert.ok(value.ledger.some((item) => item.label === '正在整理 · 整理中片'));
  assert.ok(!value.ledger.some((item) => item.label === '已经上架'));
  assert.ok(!value.ledger.some((item) => item.label === '已发现的电影'));
});

function idleReaders(overrides = {}) {
  return {
    readMaterialFields: () => ({ items: [{ status: 'active' }] }),
    readShelves: () => ({ items: [{ status: 'active' }] }),
    readFormation: () => ({ summary: {}, attentionItems: [], inProgressItems: [], completedItems: [] }),
    readCollectionStats: () => ({ currentCount: 1, monthNewCount: 0, healthyCount: 1, healthAttentionCount: 0, recentOnDeck: [] }),
    readOffdeck: () => ({ candidates: [] }),
    ...overrides,
  };
}

test('Overview treats missing Field or Shelf as unconfigured, not as a system fault', () => {
  const query = createOverviewQuery(idleReaders({
    readShelves: () => ({ items: [] }),
    readCollectionStats: () => ({ currentCount: 0, monthNewCount: 0, healthyCount: 0, healthAttentionCount: 0, recentOnDeck: [] }),
    readHealth: () => ({ kind: 'faulted' }),
  }));
  assert.equal(query.get().systemState.kind, 'faulted');
  const running = createOverviewQuery(idleReaders());
  assert.equal(running.get().systemState.kind, 'running');
  assert.equal(running.get().todos.length, 0);
});

test('Overview surfaces unreachable Field access as a clickable todo, not as a system fault', () => {
  const query = createOverviewQuery(idleReaders({
    readMaterialFields: () => ({ items: [
      {
        status: 'active',
        access: { rootLocation: 'E:\\reachable-canary' },
        procurementStatus: { observationScan: { state: 'completed', inProgress: false, pageCount: 3 } },
      },
      {
        status: 'active',
        access: { rootLocation: 'F:\\helix-j02-missing-field-root-does-not-exist' },
        procurementStatus: { observationScan: { state: 'scanning', inProgress: true, pageCount: 0 } },
      },
    ] }),
    readFormation: () => ({
      summary: { pendingCount: 23, inProgressCount: 0, attentionRequiredCount: 0 },
      attentionItems: [], inProgressItems: [], completedItems: [],
    }),
    readCollectionStats: () => ({ currentCount: 0, monthNewCount: 0, healthyCount: 0, healthAttentionCount: 0, recentOnDeck: [] }),
    isLocationAvailable: (root) => root === 'E:\\reachable-canary',
  }));
  const value = query.get();
  assert.equal(value.systemState.kind, 'running');
  assert.equal(value.systemState.href, '/material-fields');
  assert.ok(value.todos.some((item) => item.key === 'field_access' && item.count === 1 && item.href === '/material-fields'));
  assert.equal(value.inProgress.label, '待整理');
  assert.equal(value.inProgress.count, 23);
  assert.equal(value.inProgress.href, '/formation');
});

test('Overview does not treat a healthy in-progress Observation as Field attention', () => {
  const query = createOverviewQuery(idleReaders({
    readMaterialFields: () => ({ items: [{
      status: 'active',
      access: { rootLocation: 'E:\\reachable-canary' },
      procurementStatus: { observationScan: { state: 'scanning', inProgress: true, pageCount: 2 } },
    }] }),
    isLocationAvailable: () => true,
  }));
  const value = query.get();
  assert.equal(value.systemState.kind, 'running');
  assert.equal(value.systemState.href, '/');
  assert.ok(!value.todos.some((item) => item.key === 'field_access'));
});
