'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildTransactionContracts } = require('../../scripts/helix-architecture/transaction-contract-builder');
const { readTransactionSourceEntries } = require('../../scripts/helix-architecture/transaction-contract-materializer');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const contracts = buildTransactionContracts(readTransactionSourceEntries(contractsRoot));
const byName = new Map(contracts.map((contract) => [contract.displayName, contract]));

test('builds all 18 canonical transactions with stable identities and crash fixtures', () => {
  assert.equal(contracts.length, 18);
  assert.equal(new Set(contracts.map((contract) => contract.transactionId)).size, 18);
  assert.equal(contracts.reduce((sum, contract) => sum + contract.crashFixtures.length, 0), 19);
  for (const contract of contracts) {
    assert.ok(contract.crashFixtures.length > 0);
    assert.equal(contract.fenceContract.commitMarkerRequired, true);
    assert.ok(contract.rollbackInvariant.includes('zero transaction writes visible'));
  }
});

test('keeps Handoff Accepted writes inside receiving Domain, Control, and Foundation', () => {
  const handoffA = byName.get('Handoff A Accepted');
  assert.equal(handoffA.writeTables.some((table) => table.startsWith('proc_')), false);
  assert.deepEqual(handoffA.forbiddenWritePrefixes, ['proc_']);
  const handoffB = byName.get('Handoff B Accepted');
  assert.equal(handoffB.writeTables.some((table) => table.startsWith('libra_')), false);
  assert.deepEqual(handoffB.forbiddenWritePrefixes, ['libra_']);
  for (const contract of [handoffA, handoffB]) {
    assert.ok(contract.participants.some((participant) => participant.participantKind === 'material-control'));
    assert.ok(contract.participants.some((participant) => participant.participantKind === 'foundation'));
  }
});

test('keeps batch authorization before per-Entry Authorization and Case creation', () => {
  const batch = byName.get('Off-deck Batch Authorization Intent');
  assert.equal(batch.writeTables.includes('arca_offdeck_cases'), false);
  assert.equal(batch.writeTables.includes('arca_offdeck_authorizations'), false);
  assert.ok(batch.forbiddenWriteTables.includes('arca_offdeck_cases'));
  const perEntry = byName.get('Off-deck per-Entry Authorization/Case');
  assert.ok(perEntry.writeTables.includes('arca_offdeck_authorizations'));
  assert.ok(perEntry.writeTables.includes('arca_offdeck_cases'));
});

test('models polymorphic Domain Fact ownership without generic SQL authority', () => {
  const contract = byName.get('Domain Fact Commit');
  const dynamic = contract.participants.find((participant) => participant.dynamicTableSelector);
  assert.equal(dynamic.dynamicTableSelector, 'DomainFactCommitHandle.factSchemaRef');
  assert.equal(dynamic.owner, 'execution_owner');
  assert.deepEqual(contract.writeTables, ['fx_commit_markers', 'fx_outbox']);
});

test('keeps Shelf Deregistration non-destructive and outside Off-deck', () => {
  const contract = byName.get('Shelf Deregistration Commit');
  assert.deepEqual(contract.forbiddenCapabilities.sort(), [
    'arca.offdeck.primary_material.delete@1', 'arca.offdeck.unreferenced_related.delete@1'
  ]);
  assert.equal(contract.writeTables.includes('arca_offdeck_deletion_evidence'), false);
  assert.ok(contract.crashFixtures[0].requiredInvariant.includes('实际Physical data保持'));
});

test('references only frozen P2 table contracts', () => {
  const tableIds = new Set(fs.readdirSync(path.join(contractsRoot, 'table-contracts')));
  for (const contract of contracts) {
    for (const table of [...contract.writeTables, ...contract.readTables]) assert.ok(tableIds.has(table), `${contract.displayName}: ${table}`);
  }
});
