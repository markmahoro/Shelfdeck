'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { createExecutionPolicyRegistry } = require('../../src/helix/foundation/execution/execution-policy');
const { createStoredPlanContractVerifier } = require('../../src/helix/foundation/execution/stored-plan-contract-verifier');
const { capturePlanContracts, structuralDigest, PROVENANCE } = require('../../src/helix/foundation/execution/plan-contract-evidence');

function fixture(terminal = false) {
  const prefix = 'helix://fixture/stored/', hash = 'a'.repeat(64);
  const schemas = ['inputs', 'parameters', 'result', 'evidence', 'fence', 'resource'].map(name => ({ $id: prefix + name, type: 'object' }));
  const manifest = { capabilityRef: 'libra.fixture.observe@1', contractVersion: 1, ownerScope: 'libra', effectClass: 'pure_observation',
    inputPorts: { value: { schemaRef: prefix + 'parameters', required: true, cardinality: 'one' } },
    parametersSchemaRef: prefix + 'parameters', resultSchemaRef: prefix + 'result', evidenceSchemaRef: prefix + 'evidence',
    fenceSchemaRef: prefix + 'fence', resourceDemandSchemaRef: prefix + 'resource' };
  const policy = { expectedCapabilityRefs: [manifest.capabilityRef], compensationContracts: [],
    retryPolicies: [{ ref: prefix + 'retry/v1', effectClass: 'pure_observation', maxFailureAttempts: 1, backoffMs: [], retryableFailureClasses: [] }],
    timeoutPolicies: [{ ref: prefix + 'timeout/v1', timeoutMs: 1000, minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null }],
    capabilityBindings: [{ capabilityRef: manifest.capabilityRef, effectClass: 'pure_observation', retryPolicyRef: prefix + 'retry/v1',
      timeoutPolicyRef: prefix + 'timeout/v1', compensationContractRefs: [] }] };
  const options = { registry: { resolve(ref, owner) { assert.equal(ref, manifest.capabilityRef); assert.equal(owner, 'libra');
    return { manifest, executor: { version: 1 } }; } }, policyRegistry: createExecutionPolicyRegistry(policy),
    contractValidator: createCapabilityContractValidator({ schemas }), bindingProjectionRegistry: { resolve() { throw Error('Unexpected projection'); } } };
  const raw = { ownerDomain: 'libra', workAttemptId: 'attempt', executionBasisDigest: hash, nodes: [{ nodeId: 'node', eventId: 'event',
    capabilityRef: manifest.capabilityRef, contractVersion: 1, effectClass: 'pure_observation',
    inputBindingsSchemaRef: prefix + 'inputs', inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1,
      bindings: [{ portName: 'value', bindingKind: 'literal', value: {} }] },
    parametersSchemaRef: prefix + 'parameters', parameters: {}, fenceSchemaRef: prefix + 'fence', fenceBasis: {},
    resourceDemandSchemaRef: prefix + 'resource', resourceDemand: {}, whenSchemaRef: null, when: null, dependsOn: [] }] };
  const n = raw.nodes[0];
  const facts = { plan: { plan_id: 'plan', attempt_id: 'attempt', catalog_digest: 'b'.repeat(64), basis_digest: hash, graph_digest: hash, state: 'planned' },
    workAttempt: { attempt_id: 'attempt', work_id: 'work', basis_digest: hash, state: terminal ? 'succeeded' : 'ready' },
    work: { work_id: 'work', owner_domain: 'libra', state: terminal ? 'succeeded' : 'ready' },
    nodes: [{ plan_id: 'plan', node_id: n.nodeId, capability_ref: n.capabilityRef, contract_version: 1, effect_class: n.effectClass,
      input_binding_schema_ref: n.inputBindingsSchemaRef, input_bindings_json: canonicalJson(n.inputBindings),
      parameter_schema_ref: n.parametersSchemaRef, parameters_json: '{}', fence_schema_ref: n.fenceSchemaRef, fence_basis_json: '{}',
      resource_demand_schema_ref: n.resourceDemandSchemaRef, resource_demand_json: '{}', when_schema_ref: null, when_json: null }],
    events: [{ event_id: 'event', plan_id: 'plan', node_id: 'node', work_id: 'work', attempt_id: 'attempt', owner_domain: 'libra',
      capability_ref: n.capabilityRef, contract_version: 1, state: terminal ? 'succeeded' : 'ready', result_id: terminal ? 'result' : null }],
    edges: [], effects: [], markers: [], attempts: [], results: [] };
  if (terminal) {
    facts.attempts.push({ event_attempt_id: 'event-attempt', event_id: 'event', ordinal: 1, state: 'completed', outcome_kind: 'succeeded', evidence_digest: canonicalDigest({}) });
    facts.results.push({ event_id: 'event', result_id: 'result', outcome_kind: 'succeeded', result_schema_ref: prefix + 'result', result_json: '{}',
      result_digest: canonicalDigest({}), evidence_schema_ref: prefix + 'evidence', evidence_json: '{}', evidence_digest: canonicalDigest({}), effect_receipt_id: null });
  }
  const captured = capturePlanContracts(raw, options);
  const saved = { evidence: captured.evidence, binding: { plan_id: 'plan', contract_digest: captured.digest, graph_digest: hash,
    catalog_digest: facts.plan.catalog_digest, provenance_json: canonicalJson({ schemaRef: PROVENANCE, schemaVersion: 1,
      kind: 'plan_publication', ownerDomain: 'libra', structureDigest: structuralDigest(raw) }) } };
  const reasons = [], reader = { read: () => facts, readContract: () => saved };
  options.proofReader = { verify: callback => callback(reader) };
  options.onRejected = value => reasons.push(value);
  return { facts, saved, raw, options, reasons, reader, policy, verify: () => createStoredPlanContractVerifier(options).verify(facts) };
}

test('unchanged used contracts resume without recognizing any release Catalog', () => {
  const f = fixture();
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.options.registry.snapshot = [{ capabilityRef: 'unrelated.upgraded@1' }];
  assert.equal(f.verify(), true, f.reasons.join('\n'));
});

test('used executable contract drift is rejected while terminal evidence stays independently readable', () => {
  for (const terminal of [false, true]) {
    const f = fixture(terminal);
    f.policy.timeoutPolicies[0].timeoutMs = 2000;
    f.options.policyRegistry = createExecutionPolicyRegistry(f.policy);
    assert.equal(f.verify(), terminal, f.reasons.join('\n'));
  }
});

test('terminal history does not resolve a current Executor', () => {
  const f = fixture(true);
  f.options.registry.resolve = () => { throw Error('No old executor installed'); };
  assert.equal(f.verify(), true, f.reasons.join('\n'));
});

test('missing publication evidence is never replaced by matching current Catalog', () => {
  const f = fixture();
  f.reader.readContract = () => null;
  assert.equal(f.verify(), false);
});

test('mutated immutable graph and foreign Owner are rejected against publication evidence', () => {
  for (const mutate of [f => { f.facts.nodes[0].parameters_json = '{"changed":true}'; },
    f => { f.facts.plan.graph_digest = 'c'.repeat(64); }, f => { f.facts.work.owner_domain = 'arca'; },
    f => { f.facts.events[0].attempt_id = 'foreign'; }]) {
    const f = fixture(); mutate(f); assert.equal(f.verify(), false, f.reasons.join('\n'));
  }
});

test('terminal state cannot hide an active Event or tampered Result', () => {
  const active = fixture(true); active.facts.events[0].state = 'executing';
  assert.equal(active.verify(), false);
  const corrupt = fixture(true); corrupt.facts.results[0].result_json = '{"changed":true}';
  assert.equal(corrupt.verify(), false);
});

test('current consumer validates historical source values without requiring the old producer executor policy', () => {
  for (const rejectSourceValue of [false, true]) {
    const source = fixture(true), target = fixture();
    const names = { plan: 'source-plan', attempt: 'source-attempt', work: 'source-work', node: 'source-node', event: 'source-event',
      result: 'source-result', 'event-attempt': 'source-event-attempt' };
    function rename(value) {
      if (Array.isArray(value)) return value.map(rename);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rename(child)]));
      return typeof value === 'string' && names[value] ? names[value] : value;
    }
    const sourceFacts = rename(source.facts), sourceSaved = rename(source.saved);
    const sourceProvenance = JSON.parse(sourceSaved.binding.provenance_json);
    sourceProvenance.structureDigest = structuralDigest(rename(source.raw));
    sourceSaved.binding.provenance_json = canonicalJson(sourceProvenance);
    target.policy.timeoutPolicies[0].timeoutMs = 2000;
    target.options.policyRegistry = createExecutionPolicyRegistry(target.policy);
    if (rejectSourceValue) {
      const schemaIds = target.saved.evidence.schemas.map(schema => ({ ...schema,
        ...(schema.$id.endsWith('/result') ? { required: ['newField'] } : {}) }));
      target.options.contractValidator = createCapabilityContractValidator({ schemas: schemaIds });
    }
    target.raw.nodes[0].inputBindings.bindings = [{ bindingKind: 'projected_work_results', portName: 'value',
      sourceWorkId: 'source-work', resultSchemaRefs: ['helix://fixture/stored/result'], parameters: {},
      projectionRef: 'helix://fixture/project/v1' }];
    target.facts.nodes[0].input_bindings_json = canonicalJson(target.raw.nodes[0].inputBindings);
    const captured = capturePlanContracts(target.raw, target.options);
    target.saved.evidence = captured.evidence; target.saved.binding.contract_digest = captured.digest;
    const provenance = JSON.parse(target.saved.binding.provenance_json);
    provenance.structureDigest = structuralDigest(target.raw); target.saved.binding.provenance_json = canonicalJson(provenance);
    target.options.bindingProjectionRegistry = { resolve: () => ({}) };
    target.reader.read = id => id === 'source-plan' ? sourceFacts : target.facts;
    target.reader.readContract = id => id === 'source-plan' ? sourceSaved : target.saved;
    target.reader.workPlanIds = id => id === 'source-work' ? ['source-plan'] : ['plan'];
    assert.equal(target.verify(), !rejectSourceValue, target.reasons.join('\n'));
  }
});
