'use strict';

const assert = require('node:assert');
const test = require('node:test');

const factsFreshness = require('../src/factsFreshnessService');
const lifecycleProjection = require('../src/lifecycleProjection');

const completeBasedata = {
  path: '/media/item.mkv', size: 1024, duration: 60, bitrate: 1000,
  resolution: '1920x1080', codec: 'h265', playable: true,
};

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
    ...completeBasedata,
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
    ...completeBasedata,
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

test('fresh Basedata row with missing required technical facts blocks later gates without creating a next task', () => {
  const projection = lifecycleProjection.decorateItem({
    itemId: 'incomplete-basedata', playable: true, path: '/media/disc.iso', codec: 'h264',
    basedataComplete: true, basedataSourceRevision: '1', admissionSourceRevision: '1',
    metadataComplete: true,
    factsFreshness: {
      basedataFacts: { status: 'fresh', updatedAt: '' },
      metadataFacts: { status: 'fresh', updatedAt: '' },
    },
  }, {});
  assert.strictEqual(projection.basedataGate.status, 'blocked');
  assert.ok(projection.basedataGate.missingReasons.includes('basedata.bitrate'));
  assert.strictEqual(projection.lifecycleNextTask, null);
  assert.strictEqual(projection.metadataGate, undefined);
});
