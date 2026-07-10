'use strict';

const assert = require('assert');
const test = require('node:test');

const { buildMaintenanceProjection } = require('../src/kairoxRuntime');

test('maintenanceComplete requires admission, fresh metadata, current optimize objective and no incident', () => {
  const item = {
    itemId: 'maintenance-complete-1',
    metadataComplete: true,
    factsFreshness: {
      mediaFacts: { status: 'fresh' },
      metadataFacts: { status: 'fresh' },
    },
  };
  const admission = { itemId: item.itemId, status: 'active', admissionGeneration: 3, incidentCode: '' };
  const projection = {
    optimizeGate: { passed: true, status: 'passed' },
    optimizeObjectiveStatus: 'ready',
    objectiveVersion: 7,
    objectiveHash: 'objective-7',
    archiveGate: { passed: false },
  };
  const result = buildMaintenanceProjection(item, admission, projection, []);
  assert.strictEqual(result.metadataPassed, true);
  assert.strictEqual(result.optimizePassed, true);
  assert.strictEqual(result.maintenanceComplete, true);
});

test('archive is not required for maintenanceComplete', () => {
  const result = buildMaintenanceProjection({
    itemId: 'maintenance-complete-2',
    metadataComplete: true,
    factsFreshness: { mediaFacts: { status: 'fresh' }, metadataFacts: { status: 'fresh' } },
  }, {
    itemId: 'maintenance-complete-2', status: 'active', admissionGeneration: 1,
  }, {
    optimizeGate: { passed: true, status: 'passed' },
    optimizeObjectiveStatus: 'ready',
    archiveGate: { passed: false, status: 'not_archived' },
  });
  assert.strictEqual(result.maintenanceComplete, true);
});

test('source incident and pending canonical refresh block maintenanceComplete', () => {
  const baseItem = {
    itemId: 'maintenance-complete-3', metadataComplete: true,
    factsFreshness: { mediaFacts: { status: 'fresh' }, metadataFacts: { status: 'fresh' } },
  };
  const baseProjection = { optimizeGate: { passed: true, status: 'passed' }, optimizeObjectiveStatus: 'ready' };
  assert.strictEqual(buildMaintenanceProjection(baseItem, { status: 'active', incidentCode: 'source_missing' }, baseProjection).maintenanceComplete, false);
  assert.strictEqual(buildMaintenanceProjection(baseItem, { status: 'active' }, { ...baseProjection, optimizeGate: { passed: true, status: 'pending_canonical_refresh' } }).maintenanceComplete, false);
});
