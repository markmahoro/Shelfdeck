'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest: D } = require('../../src/helix/contracts/canonical-json');
const { createUnchangedPausedBatchProof } = require('../../src/helix/foundation/execution/unchanged-paused-batch-proof');
const { createExecutionPolicyRegistry } = require('../../src/helix/foundation/execution/execution-policy');
const { executionCatalogDigest } = require('../../src/helix/foundation/execution/workflow-plan');

function fixture() {
  const prefix = 'helix://fixture/batch/v1/', ref = 'procurement.fixture@1';
  const manifest = { capabilityRef: ref, contractVersion: 1, ownerScope: 'procurement', effectClass: 'pure_observation',
    inputPorts: { value: { schemaRef: prefix + 'inputs', required: true, cardinality: 'one' } },
    ...Object.fromEntries(['parameters', 'result', 'evidence', 'fence', 'resourceDemand'].map(kind => [kind + 'SchemaRef', prefix + kind])) };
  const schemas = new Map(['inputs', 'parameters', 'result', 'evidence', 'fence', 'resourceDemand'].map(kind => {
    const value = { $id: prefix + kind, type: 'object' }; return [value.$id, value];
  }));
  const policy = { expectedCapabilityRefs: [ref], compensationContracts: [],
    retryPolicies: [{ ref: 'helix://retry/batch/v1', effectClass: 'pure_observation', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] }],
    timeoutPolicies: [{ ref: 'helix://timeout/batch/v1', timeoutMs: 1000, minObservationCadenceMs: null,
      maxObservationElapsedMs: null, maxObservationCount: null }],
    capabilityBindings: [{ capabilityRef: ref, effectClass: 'pure_observation', retryPolicyRef: 'helix://retry/batch/v1',
      timeoutPolicyRef: 'helix://timeout/batch/v1', compensationContractRefs: [] }] };
  const registry = { snapshot: [{ capabilityRef: ref, contractVersion: 1, ownerScope: 'procurement',
    effectClass: 'pure_observation', executorVersion: 1, executionContractDigest: D(manifest) }], resolve: () => ({ manifest }) };
  const archive = { sourceCommit: 'f'.repeat(40), catalogDigest: executionCatalogDigest(registry, createExecutionPolicyRegistry(policy)),
    policy: structuredClone(policy), manifests: [structuredClone(manifest)], schemas: structuredClone([...schemas.values()]) };
  const definition = { schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1,
    workId: 'work', ownerDomain: 'procurement', processType: 'field', processId: 'field-1', workKind: 'observation',
    workObjectiveTypeRef: 'helix://fixture/work/Observation/v1', workObjectiveVersion: 1,
    executionBasisId: 'basis', executionBasisDigest: D('basis'), dependencyRefs: [], priorityClass: 'background_observation',
    priorityRevision: 1, capabilityCatalogScope: 'procurement', workspaceMaterialScope: [], idempotencyKey: 'key',
    concurrencyScope: 'field-1', outputContractRef: prefix + 'result' };
  const facts = { plan: { plan_id: 'plan', attempt_id: 'attempt', catalog_digest: archive.catalogDigest,
    graph_digest: D('graph'), basis_digest: D('basis'), state: 'planned' },
    workAttempt: { attempt_id: 'attempt', work_id: 'work', ordinal: 1, basis_digest: D('basis'), state: 'running' },
    work: { work_id: 'work', owner_domain: 'procurement', process_type: 'field', process_id: 'field-1', work_kind: 'observation',
      state: 'running', definition_json: JSON.stringify(definition), definition_digest: D(definition) },
    nodes: [{ plan_id: 'plan', node_id: 'node', capability_ref: ref, contract_version: 1, effect_class: 'pure_observation',
      input_binding_schema_ref: prefix + 'inputs', input_bindings_json: JSON.stringify({
        schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1,
        bindings: [{ portName: 'value', bindingKind: 'literal', value: {} }] }),
      parameter_schema_ref: prefix + 'parameters', parameters_json: '{}', fence_schema_ref: prefix + 'fence', fence_basis_json: '{}',
      resource_demand_schema_ref: prefix + 'resourceDemand', resource_demand_json: '{}', when_schema_ref: null, when_json: null }],
    events: [{ event_id: 'event', plan_id: 'plan', node_id: 'node', work_id: 'work', attempt_id: 'attempt', owner_domain: 'procurement',
      capability_ref: ref, contract_version: 1, state: 'ready', result_id: null }],
    attempts: [], effects: [], results: [], edges: [], markers: [] };
  const reasons = [], archiveDigest = D(archive);
  const create = () => createUnchangedPausedBatchProof({ archive, archiveDigest, registry, schemas,
    policyRegistry: createExecutionPolicyRegistry(policy), scopes: [{ ownerDomain: 'procurement', processType: 'field',
      workKind: 'observation', capabilityRefs: [ref] }],
    bindingProjectionRegistry: { resolve() { throw new Error('No projection expected.'); } },
    proofReader: { verify: callback => callback({ read: () => facts, workPlanIds: () => ['plan'] }) },
    onRejected: reason => reasons.push(reason) });
  return { archive, manifest, schemas, policy, facts, create, reasons };
}

test('unchanged paused graph is proven without changing its original cursor or catalog', () => {
  const f = fixture(), before = JSON.stringify(f.facts), proof = f.create();
  assert.equal(proof.verify(f.facts), true, f.reasons.join('\n'));
  assert.equal(proof.inspect(f.facts).length, 1);
  assert.equal(JSON.stringify(f.facts), before);
});

test('durable resource wait has no executing Attempt and remains paused', () => {
  const f = fixture(); f.facts.events[0].state = 'waiting_for_resource';
  const proof = f.create(); assert.equal(proof.verify(f.facts), true);
  f.facts.attempts.push({ state: 'executing' }); assert.equal(proof.verify(f.facts), false);
});

test('a ready batch retains its closed prior page without making that Attempt executable', () => {
  const f = fixture(); f.facts.work.state = 'ready'; f.facts.workAttempt.state = 'cancelled';
  f.facts.events[0].state = 'skipped';
  const proof = f.create(); assert.equal(proof.supports(f.facts), false); assert.equal(proof.inspect(f.facts).length, 1);
  f.facts.work.state = 'succeeded'; assert.equal(proof.inspect(f.facts), null);
});

for (const [name, mutate] of [
  ['owner', f => { f.facts.work.owner_domain = 'libra'; }],
  ['process', f => { f.facts.work.process_type = 'libra_run'; }],
  ['work kind', f => { f.facts.work.work_kind = 'destruction'; }],
  ['catalog', f => { f.facts.plan.catalog_digest = D('foreign'); }],
  ['extra capability', f => { f.facts.nodes.push({ ...f.facts.nodes[0], capability_ref: 'procurement.foreign@1' }); }],
  ['executing event', f => { f.facts.events[0].state = 'executing'; }],
  ['external observation wait', f => { f.facts.events[0].state = 'waiting_for_external'; }],
  ['executing attempt', f => { f.facts.attempts.push({ state: 'executing' }); }],
  ['unresolved effect', f => { f.facts.effects.push({ state: 'intended' }); }],
  ['changed work definition', f => { f.facts.work.definition_json = '{"cursor":9}'; }],
  ['foreign definition Owner', f => { const value = JSON.parse(f.facts.work.definition_json); value.processId = 'foreign';
    f.facts.work.definition_json = JSON.stringify(value); f.facts.work.definition_digest = D(value); }],
  ['invalid parameters', f => { f.facts.nodes[0].parameters_json = '9'; }],
  ['foreign event', f => { f.facts.events[0].work_id = 'foreign'; }],
]) test('paused proof rejects ' + name, () => {
  const f = fixture(), proof = f.create(); mutate(f); assert.equal(proof.verify(f.facts), false); assert.equal(proof.inspect(f.facts), null);
});

for (const [name, mutate] of [
  ['manifest', f => { f.manifest.idempotencyScope = 'changed'; }],
  ['schema closure', f => { f.schemas.values().next().value.additionalProperties = false; }],
  ['retry policy', f => { f.policy.retryPolicies[0].retryableFailureClasses.push('timeout'); }],
  ['timeout policy', f => { f.policy.timeoutPolicies[0].timeoutMs++; }],
]) test('changed current ' + name + ' cannot execute a historical batch', () => {
  const f = fixture(); mutate(f); assert.throws(f.create, /executable contract changed/);
});

test('tampered frozen archive is rejected and terminal graphs remain on the terminal-only verifier', () => {
  const f = fixture(); f.archive.sourceCommit = 'a'.repeat(40); assert.throws(f.create, /provenance mismatch/);
  const g = fixture(); g.facts.workAttempt.state = 'succeeded'; assert.equal(g.create().supports(g.facts), false);
});
