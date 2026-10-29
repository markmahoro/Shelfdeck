'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { createExecutionPolicyRegistry } = require('../../src/helix/foundation/execution/execution-policy');
const { createStoredPlanContractVerifier } = require('../../src/helix/foundation/execution/stored-plan-contract-verifier');
const { capturePlanContracts, structuralDigest, PROVENANCE } = require('../../src/helix/foundation/execution/plan-contract-evidence');

function fixture(terminal = false, effectClass = 'pure_observation') {
  const prefix = 'helix://fixture/stored/', hash = 'a'.repeat(64);
  const schemas = ['inputs', 'parameters', 'result', 'evidence', 'fence', 'resource'].map(name => ({ $id: prefix + name, type: 'object' }));
  const manifest = { capabilityRef: 'libra.fixture.observe@1', contractVersion: 1, ownerScope: 'libra', effectClass,
    inputPorts: { value: { schemaRef: prefix + 'parameters', required: true, cardinality: 'one' } },
    parametersSchemaRef: prefix + 'parameters', resultSchemaRef: prefix + 'result', evidenceSchemaRef: prefix + 'evidence',
    fenceSchemaRef: prefix + 'fence', resourceDemandSchemaRef: prefix + 'resource' };
  const policy = { expectedCapabilityRefs: [manifest.capabilityRef], compensationContracts: [],
    retryPolicies: [{ ref: prefix + 'retry/v1', effectClass, maxFailureAttempts: 1, backoffMs: [], retryableFailureClasses: [] }],
    timeoutPolicies: [{ ref: prefix + 'timeout/v1', timeoutMs: 1000, minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null }],
    capabilityBindings: [{ capabilityRef: manifest.capabilityRef, effectClass, retryPolicyRef: prefix + 'retry/v1',
      timeoutPolicyRef: prefix + 'timeout/v1', compensationContractRefs: [] }] };
  const options = { registry: { resolve(ref, owner) { assert.equal(ref, manifest.capabilityRef); assert.equal(owner, 'libra');
    return { manifest, executor: { version: 1 } }; } }, policyRegistry: createExecutionPolicyRegistry(policy),
    contractValidator: createCapabilityContractValidator({ schemas }), bindingProjectionRegistry: { resolve() { throw Error('Unexpected projection'); } } };
  const raw = { ownerDomain: 'libra', workAttemptId: 'attempt', executionBasisDigest: hash, nodes: [{ nodeId: 'node', eventId: 'event',
    capabilityRef: manifest.capabilityRef, contractVersion: 1, effectClass,
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
  return { facts, saved, raw, options, reasons, reader, policy, manifest, schemas, verify: () => createStoredPlanContractVerifier(options).verify(facts) };
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


test('an exact atomic Owner Result remains recoverable before journal completion and rejects damaged Commit links', () => {
  function pending() {
    const f=fixture(true,'domain_fact_commit'),hash='a'.repeat(64);
    f.facts.work.state=f.facts.workAttempt.state='running';
    f.facts.events[0].state='executing';f.facts.events[0].result_id=null;
    Object.assign(f.facts.attempts[0],{state:'executing',outcome_kind:null,evidence_digest:null,
      input_snapshot_digest:hash,fence_snapshot_digest:hash,started_at_ms:10});
    const result={ownerDomain:'libra',scopeType:'fixture',scopeId:'work',effectReceiptRef:'receipt'};
    Object.assign(f.facts.results[0],{result_json:canonicalJson(result),result_digest:canonicalDigest(result),effect_receipt_id:'receipt',committed_at_ms:20});
    f.facts.effects=[{effect_id:'effect',event_attempt_id:'event-attempt',effect_class:'domain_fact_commit',state:'intended',
      idempotency_key:'key',output_digest:null,intent_digest:canonicalDigest({eventId:'event',capabilityRef:'libra.fixture.observe@1',contractVersion:1,inputSnapshotDigest:hash,fenceSnapshotDigest:hash})}];
    f.facts.markers=[{commit_marker:'marker',effect_id:'effect',owner_domain:'libra',scope_type:'fixture',scope_id:'work',
      commit_digest:hash,result_id:'result',result_schema_ref:f.facts.results[0].result_schema_ref,
      result_digest:f.facts.results[0].result_digest,committed_at_ms:20}];
    return f;
  }
  const f=pending(),before=structuredClone(f.facts);
  assert.equal(f.verify(),true,f.reasons.join('\n'));assert.deepEqual(f.facts,before);
  function domainFact() {
    const value = pending(), result = value.facts.results[0], marker = value.facts.markers[0];
    const fact = { ownerDomain: 'libra', aggregateType: 'fixture', aggregateId: 'work',
      commitMarker: marker.commit_marker, factSchemaRef: result.result_schema_ref, committedAtMs: 20 };
    result.result_json = canonicalJson(fact); result.result_digest = marker.result_digest = canonicalDigest(fact);
    return value;
  }
  const fact = domainFact(); assert.equal(fact.verify(), true, fact.reasons.join('\n'));
  for (const key of ['aggregateId', 'aggregateType', 'commitMarker', 'factSchemaRef', 'committedAtMs']) {
    const broken = domainFact(), result = broken.facts.results[0], payload = JSON.parse(result.result_json);
    payload[key] = 'foreign'; result.result_json = canonicalJson(payload);
    result.result_digest = broken.facts.markers[0].result_digest = canonicalDigest(payload);
    assert.equal(broken.verify(), false, key);
  }
  for(const corrupt of [f=>{f.facts.markers=[];},f=>{f.facts.markers[0].result_digest='c'.repeat(64);},
    f=>{f.facts.markers[0].scope_id='foreign';},f=>{f.facts.markers[0].committed_at_ms=9;},
    f=>{f.facts.effects[0].intent_digest='c'.repeat(64);},f=>{f.facts.results[0].effect_receipt_id='foreign';},
    f=>{f.facts.work.state=f.facts.workAttempt.state='succeeded';}]) {
    const broken=pending();corrupt(broken);assert.equal(broken.verify(),false);
  }
});


test('frozen prebound Evidence references retain strict nominal, shape, digest and Commit proof', () => {
  function reference(representation = 'evidence_reference') {
    const f = fixture(true, 'domain_fact_commit');
    const referenceRef = 'helix://fixture/DomainEvidence/v1';
    f.manifest.evidenceSchemaRef = 'helix://contracts/types/EvidenceEnvelope/v1';
    f.manifest.preboundEvidenceContracts = [{ schemaRef: referenceRef, representation }];
    f.schemas.push({ $id: f.manifest.evidenceSchemaRef, type: 'object' },
      { $id: referenceRef, type: 'object', required: ['fullObservation'] });
    f.options.contractValidator = createCapabilityContractValidator({ schemas: f.schemas });
    const captured = capturePlanContracts(f.raw, f.options);
    f.saved.evidence = captured.evidence;
    f.saved.binding.contract_digest = captured.digest;
    const value = { schemaRef: referenceRef, schemaVersion: 1, evidenceId: 'evidence', payloadDigest: 'b'.repeat(64) };
    Object.assign(f.facts.results[0], { evidence_schema_ref: referenceRef, evidence_json: canonicalJson(value),
      evidence_digest: canonicalDigest(value), effect_receipt_id: 'receipt' });
    f.facts.effects.push({ effect_id: 'effect', event_attempt_id: 'event-attempt', effect_class: 'domain_fact_commit',
      state: 'committed', output_digest: f.facts.results[0].result_digest });
    f.facts.markers.push({ commit_marker: 'marker', commit_digest: 'a'.repeat(64), effect_id: 'effect', result_id: 'result', owner_domain: 'libra',
      result_schema_ref: f.facts.results[0].result_schema_ref, result_digest: f.facts.results[0].result_digest });
    return f;
  }
  const good = reference();
  assert.equal(good.verify(), true, good.reasons.join('\n'));
  for (const representation of ['domain_evidence', 'full_result', 'unknown']) {
    const wrong = reference(representation);
    assert.equal(wrong.verify(), false, representation);
  }
  for (const mutate of [value => { value.payloadDigest = 'bad'; }, value => { value.schemaVersion = 2; },
    value => { value.evidenceId = ''; }, value => { value.extra = 'undeclared'; },
    value => { value.schemaRef = 'helix://foreign/Evidence/v1'; }]) {
    const broken = reference(), result = broken.facts.results[0], value = JSON.parse(result.evidence_json);
    mutate(value); result.evidence_json = canonicalJson(value); result.evidence_digest = canonicalDigest(value);
    assert.equal(broken.verify(), false);
  }
  for (const corrupt of [f => { f.facts.markers = []; }, f => { f.facts.results[0].evidence_digest = 'c'.repeat(64); },
    f => { f.facts.markers[0].owner_domain = 'arca'; }]) {
    const broken = reference(); corrupt(broken); assert.equal(broken.verify(), false);
  }
});
