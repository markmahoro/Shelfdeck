'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { FORMAT, terminalFactsDigest } = require('../../src/helix/foundation/execution/terminal-plan-attestation');
const { PROVENANCE, structuralDigest, planFromFacts } = require('../../src/helix/foundation/execution/plan-contract-evidence');
const { createStoredPlanContractVerifier } = require('../../src/helix/foundation/execution/stored-plan-contract-verifier');
const HASH = 'a'.repeat(64);

// This models an already imported terminal graph. Its original qualification
// is sealed; the tests exercise the separate current physical responsibility.
function fixture() {
  const facts = { plan: { plan_id: 'plan', attempt_id: 'work-attempt', basis_digest: HASH, graph_digest: HASH, catalog_digest: HASH },
    workAttempt: { attempt_id: 'work-attempt', work_id: 'work', basis_digest: HASH, state: 'failed' },
    work: { work_id: 'work', owner_domain: 'arca', state: 'failed' }, edges: [], markers: [],
    nodes: ['slot', 'stage'].map(node_id => ({ node_id, plan_id: 'plan', capability_ref: node_id, contract_version: 1,
      effect_class: node_id === 'stage' ? 'material_commit' : 'pure_observation', input_binding_schema_ref: 'input', input_bindings_json: '{}',
      parameter_schema_ref: 'parameters', parameters_json: '{}', fence_schema_ref: 'fence', fence_basis_json: '{}',
      resource_demand_schema_ref: 'resources', resource_demand_json: '{}', when_schema_ref: null, when_json: null })),
    events: ['slot', 'stage'].map(node_id => ({ event_id: node_id, node_id, plan_id: 'plan', attempt_id: 'work-attempt', work_id: 'work',
      owner_domain: 'arca', capability_ref: node_id, contract_version: 1, state: node_id === 'slot' ? 'succeeded' : 'failed' })),
    attempts: [{ event_attempt_id: 'attempt', event_id: 'stage', state: 'completed', input_snapshot_digest: HASH, fence_snapshot_digest: HASH }],
    effects: [{ effect_id: 'effect', event_attempt_id: 'attempt', effect_class: 'material_commit', state: 'reconcile_required',
      intent_digest: canonicalDigest({ eventId: 'stage', capabilityRef: 'stage', contractVersion: 1, inputSnapshotDigest: HASH, fenceSnapshotDigest: HASH }) }],
    results: [{ event_id: 'slot', result_id: 'slot-result', result_digest: HASH }] };
  const evidence = { schemaRef: FORMAT, schemaVersion: 1, planId: 'plan', catalogDigest: HASH, sourceCommit: 'b'.repeat(40),
    sourceArchiveDigest: HASH, verifierDigest: HASH, footprint: [{ planId: 'plan', factsDigest: terminalFactsDigest(facts) }] };
  const saved = { evidence, binding: { plan_id: 'plan', graph_digest: HASH, catalog_digest: HASH, contract_digest: canonicalDigest(evidence),
    provenance_json: JSON.stringify({ schemaRef: PROVENANCE, schemaVersion: 1, kind: 'verified_contract_import', ownerDomain: 'arca',
      sourceCommit: evidence.sourceCommit, sourceArchiveDigest: HASH, verifierDigest: HASH, structureDigest: structuralDigest(planFromFacts(facts)) }) } };
  const receipt = { schemaRef: 'arca.terminal-stage-history-proof@1', ownerDomain: 'arca', disposition: 'no_remaining_material_effect',
    effectId: 'effect', eventId: 'stage', inputDigest: HASH, slotEventId: 'slot', slotResultId: 'slot-result', slotResultDigest: HASH,
    observationDigest: HASH };
  const proofReader = { verify(callback) { return callback({ read: id => id === 'plan' ? facts : null,
    readContract: id => id === 'plan' ? saved : null }); } };
  return { facts, receipt, proofReader };
}

test('terminal attestation cannot discharge a remaining physical Effect without fresh Owner proof', () => {
  const f = fixture();
  assert.equal(createStoredPlanContractVerifier({ proofReader: f.proofReader }).verify(f.facts), false);
  let calls = 0, empty = true;
  const verifier = createStoredPlanContractVerifier({ proofReader: f.proofReader, terminalEffectObserver: {
    observe() { calls++; if (!empty) throw new Error('Stage slot is not empty.'); return [f.receipt]; },
  } });
  assert.equal(verifier.verify(f.facts), true);
  assert.equal(calls, 1);
  empty = false;
  assert.equal(verifier.verify(f.facts), false);
  assert.equal(calls, 2);
});

test('terminal attestation rejects changed, missing or foreign Owner proof and rereads graph after observation', () => {
  for (const mutate of [receipt => ({ ...receipt, inputDigest: 'c'.repeat(64) }), receipt => ({ ...receipt, effectId: 'foreign' }),
    receipt => ({ ...receipt, unexpected: true })]) {
    const f = fixture();
    assert.equal(createStoredPlanContractVerifier({ proofReader: f.proofReader,
      terminalEffectObserver: { observe: () => [mutate(f.receipt)] } }).verify(f.facts), false);
  }
  const f = fixture();
  assert.equal(createStoredPlanContractVerifier({ proofReader: f.proofReader,
    terminalEffectObserver: { observe() { f.facts.results[0].result_digest = 'd'.repeat(64); return [f.receipt]; } } }).verify(f.facts), false);
});
