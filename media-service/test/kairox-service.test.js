'use strict';

const assert = require('assert');
const test = require('node:test');

const { buildMaintenanceProjection, bundleToLifecycleItem, createKairoxRuntime } = require('../src/kairoxRuntime');

test('maintenance projection consumes Lifecycle completion without recomputing it', () => {
  const admission = { itemId: 'maintenance-1', status: 'active', admissionGeneration: 3, incidentCode: '' };
  const lifecycle = {
    basedataGate: { passed: true },
    metadataGate: { passed: true },
    optimizeGate: { passed: true, status: 'passed' },
    optimizeObjectiveStatus: 'ready',
    maintenanceComplete: true,
    maintenanceState: 'complete',
  };
  const result = buildMaintenanceProjection({ itemId: admission.itemId }, admission, lifecycle, []);
  assert.strictEqual(result.basedataPassed, true);
  assert.strictEqual(result.metadataPassed, true);
  assert.strictEqual(result.optimizePassed, true);
  assert.strictEqual(result.maintenanceComplete, true);
  assert.strictEqual(result.maintenanceState, 'complete');
});

test('fact bundle maps current source revision and pending refresh into Lifecycle inputs', () => {
  const item = bundleToLifecycleItem({
    itemId: 'maintenance-2',
    basedata: { status: 'fresh', sourceRevision: 'source-2', facts: { codec: 'h265' } },
    metadata: { status: 'fresh', facts: { title: 'Title' } },
    optimize: { status: 'fresh', objectiveRevision: 'objective-2', facts: { passed: true } },
    objective: { status: 'ready', objectiveRevision: 'objective-2', objective: { kind: 'keep_current' } },
    refreshRequests: [{ factGroup: 'basedata', status: 'pending' }],
  }, {
    itemId: 'maintenance-2', status: 'active', sourceRevision: 'source-2', incidentCode: '',
  });
  assert.strictEqual(item.basedataComplete, true);
  assert.strictEqual(item.basedataSourceRevision, 'source-2');
  assert.strictEqual(item.metadataComplete, true);
  assert.strictEqual(item.optimizeGate.status, 'pending_canonical_refresh');
  assert.strictEqual(item.optimizeGate.passed, false);
});

test('Kairox admission creates only an owned skeleton and returns Basedata as next gate', () => {
  const bundles = new Map();
  const admissions = new Map();
  const runtime = createKairoxRuntime({
    kairoxStore: {
      ensureMedia({ itemId }) { bundles.set(itemId, { itemId, basedata: null, metadata: null, optimize: null, objective: null, refreshRequests: [] }); },
      getBundle(itemId) { return bundles.get(itemId) || null; },
      getBundles(itemIds) { return Object.fromEntries(itemIds.filter((id) => bundles.has(id)).map((id) => [id, bundles.get(id)])); },
    },
    admissionStore: {
      getAdmission(itemId) { return admissions.get(itemId) || null; },
      getAdmissions(itemIds) { return Object.fromEntries(itemIds.filter((id) => admissions.has(id)).map((id) => [id, admissions.get(id)])); },
      upsertAdmission(input) {
        const value = { ...input, admissionGeneration: input.admissionGeneration, status: input.status || 'active' };
        admissions.set(input.itemId, value);
        return value;
      },
    },
    taskStore: {
      queryTaskSummaries() { return { tasks: [] }; },
      getTasks() { return []; },
    },
    configStore: { loadConfig() { return {}; } },
  });
  const result = runtime.reconcileMaintenance({
    itemId: 'maintenance-3',
    admissionGeneration: 1,
    sourceRevision: 'source-3',
  });
  assert.strictEqual(result.nextTargetGate, 'basedata');
  assert.strictEqual(result.maintenanceComplete, false);
  assert.ok(bundles.has('maintenance-3'));
});
