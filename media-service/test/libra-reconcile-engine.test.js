'use strict';

const assert = require('assert');
const test = require('node:test');

const engine = require('../src/libraReconcileEngine');

test.afterEach(() => engine.stop());

test('Libra Reconcile Engine performs targeted and full recovery scans without task-terminal signals', async () => {
  const calls = [];
  engine.start({
    reconcileBatch(itemIds) {
      calls.push(itemIds);
      return itemIds == null ? [{ itemId: 'all' }] : itemIds.map((itemId) => ({ itemId }));
    },
  }, {
    loadConfig: () => ({ libraReconcileInitialDelaySeconds: 3600, libraReconcilePollIntervalMinutes: 60 }),
  });

  engine.wake(['item-a', 'item-a', 'item-b']);
  await engine._drainForTests();
  assert.deepStrictEqual(calls, [['item-a', 'item-b']]);
  assert.strictEqual(engine.getHealth().status, 'green');
  assert.strictEqual(engine.getHealth().reconciled, 2);

  engine.wake();
  await engine._drainForTests();
  assert.deepStrictEqual(calls[1], null);
});
