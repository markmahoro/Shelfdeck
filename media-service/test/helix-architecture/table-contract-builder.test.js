'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { allowedForeignKey, buildTableContracts, parseColumns, parseFunctionCalls } = require('../../scripts/helix-architecture/table-contract-builder');
const { readTableSourceEntries } = require('../../scripts/helix-architecture/table-contract-materializer');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const contracts = buildTableContracts(readTableSourceEntries(contractsRoot));

test('builds all 156 sole-Owner table contracts with accepted owner counts', () => {
  assert.equal(contracts.length, 156);
  assert.equal(new Set(contracts.map((contract) => contract.tableId)).size, 156);
  const counts = Object.fromEntries([...new Set(contracts.map((contract) => contract.owner))].map((owner) => [
    owner, contracts.filter((contract) => contract.owner === owner).length
  ]));
  assert.deepEqual(counts, {
    'execution-foundation': 23, 'material-control-authority': 2, procurement: 13, libra: 31,
    arca: 54, perception: 7, people: 10, 'platform-settings': 16
  });
});

test('parses inline PK/FK and enums without splitting parenthetical values', () => {
  const columns = parseColumns('`rule_template_id PK/FK, state(open|accepted|dismissed), revision`');
  assert.equal(columns[0].primaryKeyPart, true);
  assert.equal(columns[0].foreignKeyMarker, true);
  assert.deepEqual(columns[1].enumValues, ['open', 'accepted', 'dismissed']);
});

test('closes every SSOT state/status column to an explicit enum and keeps revision-set digests as TEXT', () => {
  for (const contract of contracts) {
    for (const column of contract.columns.filter((item) => /(?:^|_)(?:state|status)$/.test(item.name))) {
      assert.ok(column.enumValues.length > 0, `${contract.tableId}.${column.name}`);
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
      assert.ok([16 * 1024, 64 * 1024].includes(json.maxBytes));
    }
    const covered = new Set(contract.revisionContract.pointerTargets.flatMap((target) => [...target.sourceColumns, ...target.consistencyColumns]));
    for (const pointer of contract.revisionContract.currentPointerColumns) assert.ok(covered.has(pointer), `${contract.tableId}.${pointer}`);
  }
});

test('freezes complete restart-recoverable Workflow Plan execution contracts', () => {
  const byId = new Map(contracts.map((contract) => [contract.tableId, contract]));
  const plan = byId.get('fx_workflow_plans');
  const node = byId.get('fx_plan_nodes');
  for (const column of ['work_objective_type_ref', 'work_objective_version', 'diagnostic_classification']) {
    assert.ok(plan.columns.some((entry) => entry.name === column), column);
  }
  for (const column of ['approval_requirement_ref', 'authorization_requirement_ref', 'retry_policy_ref', 'timeout_policy_ref',
    'output_contract_ref', 'compensation_for_event_id', 'compensation_contract_ref']) {
    assert.ok(node.columns.some((entry) => entry.name === column), column);
  }
  assert.equal(plan.immutability.immutable, true);
  assert.equal(node.immutability.immutable, true);
  assert.deepEqual(node.foreignKeys.find((entry) => entry.columns.includes('compensation_for_event_id')).targetTable, 'fx_workflow_events');
});

test('forbids Foundation and Platform FK ownership inversion', () => {
  assert.equal(allowedForeignKey('execution-foundation', 'libra'), false);
  assert.equal(allowedForeignKey('platform-settings', 'arca'), false);
  assert.equal(allowedForeignKey('libra', 'execution-foundation'), true);
  assert.equal(allowedForeignKey('libra', 'arca'), false);
});
