'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  EFFECT_CLASSES, PLAN_RESOLUTIONS, STATE_MACHINES, assertEffectClass, assertPlanResolution, assertTransition,
  validateSupportingWorkDefinition
} = require('../../src/helix/foundation/execution/runtime-contracts');

const serviceRoot = path.resolve(__dirname, '../..');

function tableStates(tableId, column) {
  const contract = JSON.parse(fs.readFileSync(path.join(
    serviceRoot, 'src/helix/contracts/table-contracts', tableId, 'v1/contract.json'
  ), 'utf8')).contract;
  return contract.columns.find((item) => item.name === column).enumValues;
}

function effectClassesFromCapabilityContracts() {
  const root = path.join(serviceRoot, 'src/helix/contracts/capabilities');
  const result = new Set();
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.name === 'manifest.json') result.add(JSON.parse(fs.readFileSync(absolute, 'utf8')).effectClass);
    }
  }
  return [...result].sort();
}

test('runtime nominal states exactly match the frozen P2 table enums', () => {
  const mappings = [
    ['supporting_work', 'fx_supporting_works'], ['work_attempt', 'fx_work_attempts'],
    ['workflow_event', 'fx_workflow_events'], ['event_attempt', 'fx_event_attempts'],
    ['effect_journal', 'fx_effect_journal'], ['resource_defer', 'fx_resource_defer'], ['circuit', 'fx_circuit_states']
  ];
  for (const [kind, tableId] of mappings) assert.deepEqual(Object.keys(STATE_MACHINES[kind]).sort(), tableStates(tableId, 'state').sort(), kind);
  assert.deepEqual([...PLAN_RESOLUTIONS].sort(), tableStates('fx_workflow_plans', 'state').sort());
});

test('seven Effect Classes exactly match all 112 frozen Capability contracts', () => {
  assert.deepEqual([...EFFECT_CLASSES].sort(), effectClassesFromCapabilityContracts());
  assert.equal(assertEffectClass('material_commit'), 'material_commit');
  assert.throws(() => assertEffectClass('generic_write'), (error) => error.code === 'P4_RUNTIME_UNKNOWN_EFFECT_CLASS');
});

test('state machines allow declared progress and reject terminal resurrection or unknown state', () => {
  assert.deepEqual(assertTransition('supporting_work', 'admitted', 'ready'), { kind: 'supporting_work', from: 'admitted', to: 'ready' });
  assertTransition('workflow_event', 'executing', 'waiting_for_external');
  assertTransition('circuit', 'open', 'recovering');
  assert.throws(() => assertTransition('supporting_work', 'succeeded', 'ready'), (error) => error.code === 'P4_RUNTIME_ILLEGAL_TRANSITION');
  assert.throws(() => assertTransition('workflow_event', 'ready', 'unknown'), (error) => error.code === 'P4_RUNTIME_UNKNOWN_STATE');
  assert.throws(() => assertTransition('business_process', 'ready', 'running'), (error) => error.code === 'P4_RUNTIME_UNKNOWN_STATE_MACHINE');
});

test('Plan Resolution has events only when planned', () => {
  assert.equal(assertPlanResolution('planned', 2), 'planned');
  for (const resolution of PLAN_RESOLUTIONS.filter((value) => value !== 'planned')) assert.equal(assertPlanResolution(resolution, 0), resolution);
  assert.throws(() => assertPlanResolution('planned', 0), (error) => error.code === 'P4_RUNTIME_PLAN_RESOLUTION_NODE_MISMATCH');
  assert.throws(() => assertPlanResolution('contract_unplannable', 1), (error) => error.code === 'P4_RUNTIME_PLAN_RESOLUTION_NODE_MISMATCH');
});

function definition(overrides = {}) {
  return {
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1, workId: 'work-1', ownerDomain: 'libra',
    processType: 'libra_run', processId: 'run-1', workKind: 'product_gap', workObjectiveTypeRef: 'helix://libra/work/ProductGap/v1',
    workObjectiveVersion: 1, executionBasisId: 'basis-1', executionBasisDigest: 'a'.repeat(64), dependencyRefs: [],
    priorityClass: 'normal_foreground', priorityRevision: 1, capabilityCatalogScope: 'libra', workspaceMaterialScope: [],
    idempotencyKey: 'work-key-1', concurrencyScope: 'run-1/product', outputContractRef: 'helix://libra/results/ProductGap/v1', ...overrides
  };
}

test('Supporting Work Definition is exact and cannot preselect execution details', () => {
  assert.equal(validateSupportingWorkDefinition(definition()).workId, 'work-1');
  for (const [field, value] of [['capabilityRef', 'libra.media.transcode@1'], ['executor', 'legacy'], ['flowKind', 'optimize'], ['path', 'x']]) {
    assert.throws(() => validateSupportingWorkDefinition(definition({ [field]: value })),
      (error) => error.code === 'P4_RUNTIME_WORK_DEFINITION_SHAPE_MISMATCH', field);
  }
  assert.throws(() => validateSupportingWorkDefinition(definition({ ownerDomain: 'kairox' })),
    (error) => error.code === 'P4_RUNTIME_INVALID_WORK_DEFINITION');
  assert.throws(() => validateSupportingWorkDefinition(definition({
    dependencyRefs: [{ ownerDomain: 'libra', objectType: 'subject', objectId: 'subject-1', revision: 1, digest: 'a'.repeat(64), path: 'raw.mkv' }]
  })), (error) => error.code === 'P4_RUNTIME_INVALID_WORK_REFERENCE');
  assert.throws(() => validateSupportingWorkDefinition(definition({ capabilityCatalogScope: 'shared' })),
    (error) => error.code === 'P4_RUNTIME_INVALID_WORK_DEFINITION');
});
