'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { allowedForeignKey, buildTableContracts, parseColumns, parseFunctionCalls } = require('../../scripts/helix-architecture/table-contract-builder');
const { readTableSourceEntries } = require('../../scripts/helix-architecture/table-contract-materializer');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const contracts = buildTableContracts(readTableSourceEntries(contractsRoot));

test('builds all 162 sole-Owner table contracts with accepted owner counts', () => {
  assert.equal(contracts.length, 162);
  assert.equal(new Set(contracts.map((contract) => contract.tableId)).size, 162);
  const counts = Object.fromEntries([...new Set(contracts.map((contract) => contract.owner))].map((owner) => [
    owner, contracts.filter((contract) => contract.owner === owner).length
  ]));
  assert.deepEqual(counts, {
    'execution-foundation': 23, 'material-control-authority': 2, procurement: 14, libra: 31,
    arca: 54, perception: 9, people: 13, 'platform-settings': 16
  });
});

test('parses inline PK/FK and enums without splitting parenthetical values', () => {
  const columns = parseColumns('`rule_template_id PK/FK, state(open|accepted|dismissed), revision`');
  assert.equal(columns[0].primaryKeyPart, true);
  assert.equal(columns[0].foreignKeyMarker, true);
  assert.deepEqual(columns[1].enumValues, ['open', 'accepted', 'dismissed']);
});

test('preserves an explicit nullable pointer marker from the SSOT table contract', () => {
  const [pointer] = parseColumns('`current_cursor_revision NULL`');
  assert.equal(pointer.nullable, true);
  assert.equal(pointer.logicalType, 'INTEGER');
});

test('closes every SSOT state/status column to an explicit enum and keeps revision-set digests as TEXT', () => {
  for (const contract of contracts) {
    for (const column of contract.columns.filter((item) => /(?:^|_)(?:state|status)$/.test(item.name))) {
      assert.ok(column.enumValues.length > 0 || column.logicalType === 'INTEGER_BOOLEAN', `${contract.tableId}.${column.name}`);
    }
  }
  for (const tableId of ['libra_handoff_a_receipts', 'arca_handoff_b_receipts', 'arca_ondeck_commit_receipts']) {
    assert.equal(contracts.find((contract) => contract.tableId === tableId).columns
      .find((column) => column.name === 'control_revision_set_digest').logicalType, 'TEXT');
  }
  for (const [tableId, columnName] of [
    ['fx_workflow_plans', 'planner_version'], ['fx_plan_nodes', 'contract_version'],
    ['fx_workflow_events', 'contract_version'], ['fx_event_attempts', 'executor_version'],
    ['fx_resource_defer', 'local_priority'], ['libra_decision_basis_inputs', 'query_version']
  ]) {
    assert.equal(contracts.find((contract) => contract.tableId === tableId).columns
      .find((column) => column.name === columnName).logicalType, 'INTEGER', `${tableId}.${columnName}`);
  }
});

test('parses nested hot-index expressions and composite keys at balanced commas', () => {
  assert.deepEqual(parseFunctionCalls('`INDEX(state,COALESCE(retry_at_ms,ready_at_ms),event_id)`', 'INDEX'), [
    ['state', 'COALESCE(retry_at_ms,ready_at_ms)', 'event_id']
  ]);
});

test('closes every PK, declared FK, JSON contract, and current revision pointer', () => {
  const byId = new Map(contracts.map((contract) => [contract.tableId, contract]));
  for (const contract of contracts) {
    assert.ok(contract.primaryKey.length > 0, contract.tableId);
    for (const foreignKey of contract.foreignKeys) {
      assert.ok(byId.has(foreignKey.targetTable), `${contract.tableId}.${foreignKey.columns.join('+')}`);
      assert.equal(foreignKey.deletePolicy, 'RESTRICT');
      assert.equal(allowedForeignKey(contract.owner, byId.get(foreignKey.targetTable).owner), true);
    }
    for (const json of contract.jsonContracts) {
      assert.ok(json.schemaRefColumn, `${contract.tableId}.${json.column}`);
      assert.ok([4 * 1024, 16 * 1024, 64 * 1024].includes(json.maxBytes));
    }
    const covered = new Set(contract.revisionContract.pointerTargets.flatMap((target) => [...target.sourceColumns, ...target.consistencyColumns]));
    for (const pointer of contract.revisionContract.currentPointerColumns) assert.ok(covered.has(pointer), `${contract.tableId}.${pointer}`);
  }
});

test('freezes complete restart-recoverable Workflow Plan execution contracts', () => {
  const byId = new Map(contracts.map((contract) => [contract.tableId, contract]));
  const plan = byId.get('fx_workflow_plans');
  const node = byId.get('fx_plan_nodes');
  for (const column of ['planner_ref', 'planner_version', 'catalog_digest', 'basis_digest', 'graph_digest']) {
    assert.ok(plan.columns.some((entry) => entry.name === column), column);
  }
  for (const column of ['capability_ref', 'contract_version', 'input_binding_schema_ref', 'input_bindings_json',
    'parameter_schema_ref', 'parameters_json', 'when_schema_ref', 'when_json', 'effect_class',
    'fence_schema_ref', 'fence_basis_json', 'resource_demand_schema_ref', 'resource_demand_json']) {
    assert.ok(node.columns.some((entry) => entry.name === column), column);
  }
  assert.deepEqual(node.primaryKey, ['plan_id', 'node_id']);
  assert.equal(node.foreignKeys.find((entry) => entry.columns.includes('plan_id')).targetTable, 'fx_workflow_plans');
});

test('keeps Candidate payload immutable without misclassifying its revision head as an immutable row', () => {
  const byId = new Map(contracts.map((contract) => [contract.tableId, contract]));
  for (const kind of ['registration', 'merge']) {
    const head = byId.get(`people_${kind}_candidates`);
    const revisions = byId.get(`people_${kind}_candidate_revisions`);
    assert.equal(head.immutability.immutable, false);
    assert.deepEqual(head.revisionContract.currentPointerColumns, ['current_revision']);
    assert.equal(revisions.immutability.immutable, true);
  }
});

test('materializes the one-terminal-merge-target invariant as a database uniqueness constraint', () => {
  const mergeRecords = contracts.find((contract) => contract.tableId === 'people_merge_records');
  assert.deepEqual(mergeRecords.uniqueConstraints, [['source_person_id']]);
});

test('keeps Procurement admission facts frozen without blocking declared lifecycle CAS updates', () => {
  const byId = new Map(contracts.map((contract) => [contract.tableId, contract]));
  for (const tableId of ['proc_procurement_runs', 'proc_run_materials', 'proc_procurement_retry_intent_materials']) {
    assert.equal(byId.get(tableId).immutability.immutable, false, tableId);
    assert.ok(byId.get(tableId).immutability.rules.length > 0, `${tableId} retains its column-level immutable rules`);
  }
});

test('binds every Field Observation revision to its durable Foundation commit marker', () => {
  const observation = contracts.find((contract) => contract.tableId === 'proc_field_observations');
  const marker = observation.foreignKeys.find((entry) => entry.columns.length === 1 && entry.columns[0] === 'commit_marker');
  assert.deepEqual(marker.targetTable, 'fx_commit_markers');
  assert.deepEqual(marker.targetColumns, ['commit_marker']);
  assert.equal(marker.deferrable, true);
});

test('forbids Foundation and Platform FK ownership inversion', () => {
  assert.equal(allowedForeignKey('execution-foundation', 'libra'), false);
  assert.equal(allowedForeignKey('platform-settings', 'arca'), false);
  assert.equal(allowedForeignKey('libra', 'execution-foundation'), true);
  assert.equal(allowedForeignKey('libra', 'arca'), false);
});
