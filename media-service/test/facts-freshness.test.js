'use strict';

const assert = require('node:assert');
const test = require('node:test');

const factsFreshness = require('../src/factsFreshnessService');
const lifecycleProjection = require('../src/lifecycleProjection');

test('clean fact freshness projects only Helix Kairox fact groups', () => {
  const projected = factsFreshness.projectForItem({
    basedataComplete: true,
    basedataUpdatedAt: '2026-01-01T00:00:00.000Z',
    metadataComplete: false,
    userPerceptionFacts: { watched: false },
  });
  assert.deepStrictEqual(Object.keys(projected), ['basedataFacts', 'metadataFacts', 'userPerceptionFacts', 'gateFacts']);
  assert.strictEqual(projected.basedataFacts.status, 'fresh');
  assert.strictEqual(projected.metadataFacts.status, 'missing');
  assert.strictEqual(projected.userPerceptionFacts.status, 'fresh');
});

test('stale Basedata is repaired before Metadata and Optimize', () => {
  const projection = lifecycleProjection.decorateItem({
    itemId: 'stale-basedata',
    basedataComplete: true,
    metadataComplete: true,
    factsFreshness: {
      basedataFacts: { status: 'stale', updatedAt: '' },
      metadataFacts: { status: 'fresh', updatedAt: '' },
    },
  }, {});
  assert.strictEqual(projection.lifecycleNextTask, 'basedata');
  assert.strictEqual(projection.maintenanceComplete, false);
});

test('fresh Basedata and stale Metadata select Metadata refresh', () => {
  const projection = lifecycleProjection.decorateItem({
    itemId: 'stale-metadata',
    basedataComplete: true,
    basedataSourceRevision: '1',
    admissionSourceRevision: '1',
    metadataComplete: true,
    factsFreshness: {
      basedataFacts: { status: 'fresh', updatedAt: '' },
      metadataFacts: { status: 'stale', updatedAt: '' },
    },
  }, {});
  assert.strictEqual(projection.lifecycleNextTask, 'metadata');
  assert.strictEqual(projection.metadataGate.status, 'stale');
});

test('fresh canonical facts and satisfied objective close maintenance without an archive gate', () => {
  const projection = lifecycleProjection.decorateItem({
    itemId: 'complete',
    basedataComplete: true,
    basedataSourceRevision: '1',
    admissionSourceRevision: '1',
    metadataComplete: true,
    codec: 'h265',
    size: 2 * 1024 ** 3,
    optimizeObjective: {
      kind: 'target_media_facts',
      targetMediaFacts: { targetCodec: 'h265', maxSizeGB: 10 },
    },
    factsFreshness: {
      basedataFacts: { status: 'fresh', updatedAt: '' },
      metadataFacts: { status: 'fresh', updatedAt: '' },
    },
  }, {});
  assert.strictEqual(projection.lifecycleNextTask, null);
  assert.strictEqual(projection.optimizeGate.passed, true);
  assert.strictEqual(projection.maintenanceComplete, true);
});
