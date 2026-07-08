'use strict';

const test = require('node:test');
const assert = require('node:assert');

const userPerceptionManagement = require('../src/userPerceptionManagement');

test('user perception prefers local rating over Douban private rating', () => {
  const item = userPerceptionManagement.projectItem({
    itemId: 'movie-1',
    userRating: 4,
    userRatingUpdatedAt: '2026-07-01T10:00:00.000Z',
    doubanRating: 5,
    doubanRatingUpdatedAt: '2026-07-01T09:00:00.000Z',
    watched: true,
    playCount: 2,
    lastPlayedAt: '2026-07-01T08:00:00.000Z',
  }, { now: '2026-07-01T11:00:00.000Z' });

  assert.strictEqual(item.userPerceptionFacts.rating, 4);
  assert.strictEqual(item.userPerceptionFacts.ratingSource, 'local');
  assert.strictEqual(item.userPerceptionFacts.watched, true);
  assert.strictEqual(item.userPerceptionFacts.playCount, 2);
  assert.strictEqual(item.userPerceptionFacts.perceptionVersion, 1);
});

test('user perception uses Douban private rating when no local rating exists', () => {
  const item = userPerceptionManagement.projectItem({
    itemId: 'movie-2',
    doubanRating: 3,
    doubanRatingUpdatedAt: '2026-07-01T09:00:00.000Z',
    watched: false,
  }, { now: '2026-07-01T11:00:00.000Z' });

  assert.strictEqual(item.userPerceptionFacts.rating, 3);
  assert.strictEqual(item.userPerceptionFacts.ratingSource, 'douban');
  assert.strictEqual(item.userPerceptionFacts.watched, false);
  assert.strictEqual(item.userPerceptionFacts.perceptionVersion, 1);
});

test('user perception bumps version only when normalized facts change', () => {
  const item = userPerceptionManagement.projectItem({
    itemId: 'movie-3',
    userRating: 3,
    watched: true,
  }, { now: '2026-07-01T11:00:00.000Z' });

  const unchanged = userPerceptionManagement.projectItem(item, { now: '2026-07-01T12:00:00.000Z' });
  assert.strictEqual(unchanged.userPerceptionFacts.perceptionVersion, 1);

  unchanged.userRating = 4;
  const changed = userPerceptionManagement.projectItem(unchanged, { now: '2026-07-01T13:00:00.000Z' });
  assert.strictEqual(changed.userPerceptionFacts.rating, 4);
  assert.strictEqual(changed.userPerceptionFacts.perceptionVersion, 2);
  assert.strictEqual(changed.userPerceptionFacts.perceptionUpdatedAt, '2026-07-01T13:00:00.000Z');
});
