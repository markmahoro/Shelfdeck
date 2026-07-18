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

test('builds all 30 canonical transactions with stable identities and crash fixtures', () => {
  assert.equal(contracts.length, 30);
  assert.equal(new Set(contracts.map((contract) => contract.transactionId)).size, 30);
  assert.equal(contracts.reduce((sum, contract) => sum + contract.crashFixtures.length, 0), 31);
  for (const contract of contracts) {
    assert.ok(contract.crashFixtures.length > 0);
    assert.equal(contract.fenceContract.commitMarkerRequired, contract.writeTables.includes('fx_commit_markers'));
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

test('materializes the exact Handoff A ten Libra plus five Foundation transaction', () => {
  const contract = byName.get('Handoff A Accepted');
  assert.equal(contract.writeTables.length, 15);
  assert.deepEqual(contract.readTables, contract.writeTables);
  assert.deepEqual(contract.participants[0].tables, [
    'libra_subject_continuity_heads', 'libra_intake_decisions', 'libra_intake_resolution_match_witnesses',
    'libra_intake_resolution_episode_overlaps', 'libra_handoff_a_receipts', 'libra_subjects',
    'libra_subject_season_continuity_claims', 'libra_subject_episode_scopes', 'libra_material_bindings',
    'libra_material_binding_episode_claims'
  ]);
});

test('materializes the exact Candidate Publication 8+3 write participant contract', () => {
  const contract = byName.get('Procurement Candidate Publication');
  assert.deepEqual(contract.participants, [
    {
      participantKind: 'domain', owner: 'procurement', access: 'write', tables: [
        'proc_procurement_runs', 'proc_candidate_packages', 'proc_candidate_season_continuity_claims',
        'proc_candidate_primary_materials', 'proc_candidate_primary_material_episode_claims',
        'proc_candidate_related_references', 'proc_candidate_deliveries', 'proc_run_materials'
      ]
    },
    {
      participantKind: 'foundation', owner: 'execution-foundation', access: 'write', tables: [
        'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'
      ]
    }
  ]);
  assert.equal(contract.writeTables.length, 11);
  assert.ok(contract.readTables.includes('proc_procurement_runs'));
  assert.ok(contract.crashFixtures[0].requiredInvariant.includes('Episode Claim/Related relation'));
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
  assert.deepEqual(contract.writeTables, ['fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox']);
});

test('freezes the Perception page as one typed-result transaction and keeps its Outbox internal', () => {
  const contract = byName.get('Perception Acquisition Page Commit');
  for (const table of ['perception_acquisitions', 'perception_source_cursors', 'perception_acquisition_commits',
    'perception_records', 'perception_identity_anchors', 'perception_record_relations', 'fx_event_result_bindings',
    'fx_commit_markers', 'fx_outbox']) assert.ok(contract.writeTables.includes(table), table);
  assert.equal(contract.ownerScope, 'perception');
  assert.ok(contract.crashFixtures[0].requiredInvariant.includes('Outbox不通知Libra/Arca'));
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
