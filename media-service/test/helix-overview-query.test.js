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

test('Overview treats missing Field or Shelf as unconfigured, not as a system fault', () => {
  const query = createOverviewQuery({
    readMaterialFields: () => ({ items: [{ status: 'active' }] }),
    readShelves: () => ({ items: [] }),
    readFormation: () => ({ summary: {}, attentionItems: [], inProgressItems: [], completedItems: [] }),
    readCollectionStats: () => ({ currentCount: 0, monthNewCount: 0, healthyCount: 0, healthAttentionCount: 0, recentOnDeck: [] }),
    readOffdeck: () => ({ candidates: [] }),
    readHealth: () => ({ kind: 'faulted' }),
  });
  assert.equal(query.get().systemState.kind, 'faulted');
  const running = createOverviewQuery({
    readMaterialFields: () => ({ items: [{ status: 'active' }] }),
    readShelves: () => ({ items: [{ status: 'active' }] }),
    readFormation: () => ({ summary: {}, attentionItems: [], inProgressItems: [], completedItems: [] }),
    readCollectionStats: () => ({ currentCount: 1, monthNewCount: 0, healthyCount: 1, healthAttentionCount: 0, recentOnDeck: [] }),
    readOffdeck: () => ({ candidates: [] }),
  });
  assert.equal(running.get().systemState.kind, 'running');
  assert.equal(running.get().todos.length, 0);
});
