'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createBoundedCatalogTransition } = require('../../src/helix/foundation/execution/bounded-catalog-transition');
const { schemaClosure } = require('../../src/helix/foundation/execution/catalog-schema-closure');
const { executionCatalogDigest } = require('../../src/helix/foundation/execution/workflow-plan');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');

const HASH = 'a'.repeat(64);
function fixture(settings = {}) {
  const owner = settings.owner || 'libra';
  const prefix = 'helix://contracts/capabilities/libra.fixture/v1/';
  const manifest = { capabilityRef: 'libra.fixture@1', contractVersion: 1, ownerScope: owner, effectClass: settings.effectClass || 'pure_observation',
    inputPorts: { value: { schemaRef: prefix + 'inputs', required: true, cardinality: 'one' } },
    ...Object.fromEntries(['parameters', 'result', 'evidence', 'fence', 'resourceDemand'].map(kind => [kind + 'SchemaRef', prefix + kind])) };
  const schemas = new Map(['inputs', 'parameters', 'result', 'evidence', 'fence', 'resourceDemand'].map(kind => {
    const schema = { $id: prefix + kind, type: 'object' }; return [schema.$id, schema];
  }));
  const semantic = canonicalDigest(manifest);
  const record = { capabilityRef: manifest.capabilityRef, contractVersion: 1, ownerScope: owner, effectClass: manifest.effectClass,
    executorVersion: 1, previousContractDigest: semantic, currentContractDigest: semantic,
    previousSchemaDigest: canonicalDigest(schemaClosure(manifest, schemas)), currentSchemaDigest: canonicalDigest(schemaClosure(manifest, schemas)) };
  // The unrelated changed capability causes the exact Catalog transition.
  const changed = structuredClone(manifest); changed.capabilityRef = 'libra.changed@1';
  const changedRecord = { ...record, capabilityRef: changed.capabilityRef, previousManifest: { ...changed, idempotencyScope: 'event' },
    currentContractDigest: canonicalDigest(changed) };
  changedRecord.previousContractDigest = canonicalDigest(changedRecord.previousManifest);
  const records = [changedRecord, record];
  const entry = (row, previous) => ({ capabilityRef: row.capabilityRef, contractVersion: 1, ownerScope: owner,
    effectClass: row.effectClass, executorVersion: 1, contractDigest: row[previous ? 'previousContractDigest' : 'currentContractDigest'] });
  const policyRegistry = { digest: HASH, bindingFor() { return {}; } };
  const registry = { snapshot: records.map(row => ({ ...entry(row, false), executionContractDigest: row.currentContractDigest })),
    resolve(ref, requestedOwner) { assert.equal(requestedOwner, owner); assert.ok([manifest.capabilityRef, changed.capabilityRef].includes(ref));
      return { manifest: ref === manifest.capabilityRef ? manifest : changed }; } };
  const witness = { policyDigest: HASH, capabilities: records, excludedActiveProcessTypes: ['libra_intake'],
    previousCatalogDigest: executionCatalogDigest({ snapshot: records.map(row => entry(row, true)) }, policyRegistry),
    currentCatalogDigest: executionCatalogDigest(registry, policyRegistry) };
  const facts = { plan: { plan_id: 'plan', attempt_id: 'attempt', catalog_digest: witness.previousCatalogDigest,
    graph_digest: HASH, basis_digest: HASH, state: 'planned' },
    workAttempt: { attempt_id: 'attempt', work_id: 'work', ordinal: 1, basis_digest: HASH, state: 'succeeded' },
    work: { work_id: 'work', owner_domain: owner, process_type: 'media', process_id: 'process', state: 'succeeded' },
    nodes: [{ plan_id: 'plan', node_id: 'node', capability_ref: manifest.capabilityRef, contract_version: 1,
      effect_class: manifest.effectClass, input_binding_schema_ref: prefix + 'inputs', input_bindings_json: JSON.stringify({
        schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1,
        bindings: [{ portName: 'value', bindingKind: 'literal', value: {} }] }),
      parameter_schema_ref: prefix + 'parameters', parameters_json: '{}', fence_schema_ref: prefix + 'fence', fence_basis_json: '{}',
      resource_demand_schema_ref: prefix + 'resourceDemand', resource_demand_json: '{}', when_schema_ref: null, when_json: null }],
    events: [{ event_id: 'event', plan_id: 'plan', node_id: 'node', work_id: 'work', attempt_id: 'attempt', owner_domain: owner,
      capability_ref: manifest.capabilityRef, contract_version: 1, state: 'succeeded', result_id: 'result' }],
    attempts: [{ event_attempt_id: 'execution', event_id: 'event', ordinal: 1, state: 'completed', outcome_kind: 'succeeded',
      evidence_digest: canonicalDigest({}) }],
    results: [{ event_id: 'event', result_id: 'result', outcome_kind: 'succeeded', result_schema_ref: prefix + 'result',
      result_json: '{}', result_digest: canonicalDigest({}), evidence_schema_ref: prefix + 'evidence', evidence_json: '{}',
      evidence_digest: canonicalDigest({}), effect_receipt_id: null }], edges: [], effects: [], markers: [] };
  const graphs = new Map([['plan', facts]]), reasons = [];
  function verifier() { return createBoundedCatalogTransition({ witness, registry, policyRegistry, schemas,
    contractValidator: createCapabilityContractValidator({ schemas: [...schemas.values()] }),
    bindingProjectionRegistry: { resolve(ref) { assert.equal(ref, 'projection@1'); return {}; } },
    proofReader: { verify(callback) { return callback({ read: id => graphs.get(id),
      workPlanIds: workId => [...graphs.values()].filter(graph => graph.work.work_id === workId).map(graph => graph.plan.plan_id) }); } },
    terminalEffectObserver:settings.terminalEffectObserver, onRejected: reason => reasons.push(reason) }); }
  return { facts, witness, schemas, registry, graphs, reasons, verify: () => verifier().verify(facts), prefix };
}

function effectHistoryFixture() {
  let receipt;
  const settings = { owner:'arca', effectClass:'destructive_commit', terminalEffectObserver:{ observe:() => [receipt] } };
  const f = fixture(settings), old = f.facts;
  old.work.state = old.workAttempt.state = old.events[0].state = 'failed';
  old.events[0].result_id = null; old.results = [];
  old.attempts[0].outcome_kind = 'failed';
  old.attempts[0].input_snapshot_digest = HASH; old.attempts[0].fence_snapshot_digest = HASH;
  old.attempts[0].started_at_ms = 100;
  const intent = (eventId, input = HASH) => canonicalDigest({ eventId, capabilityRef:'libra.fixture@1', contractVersion:1,
    inputSnapshotDigest:input, fenceSnapshotDigest:HASH });
  old.effects = [{ effect_id:'old-effect', event_attempt_id:'execution', effect_class:'destructive_commit',
    state:'reconcile_required', output_digest:null, intent_digest:intent('event') }];
  const source = fixture({ owner:'arca', effectClass:'destructive_commit' }).facts;
  source.plan.plan_id = 'source-plan'; source.plan.attempt_id = source.workAttempt.attempt_id = 'source-attempt';
  source.work.work_id = source.workAttempt.work_id = 'source-work';
  source.nodes[0].plan_id = 'source-plan';
  Object.assign(source.events[0], { event_id:'source-event', plan_id:'source-plan', work_id:'source-work', attempt_id:'source-attempt', result_id:'source-result' });
  Object.assign(source.attempts[0], { event_attempt_id:'source-execution', event_id:'source-event', input_snapshot_digest:HASH, fence_snapshot_digest:HASH, started_at_ms:200 });
  Object.assign(source.results[0], { event_id:'source-event', result_id:'source-result', effect_receipt_id:'source-receipt' });
  source.effects = [{ effect_id:'source-effect', event_attempt_id:'source-execution', effect_class:'destructive_commit',
    state:'committed', output_digest:source.results[0].result_digest, intent_digest:intent('source-event') }];
  receipt = { schemaRef:'arca.terminal-effect-history-proof@1', ownerDomain:'arca', disposition:'fulfilled_by_successor',
    historicalAuthorization:'unproven_system_policy', effectId:'old-effect', eventId:'event', inputDigest:HASH,
    sourcePlanId:'source-plan', sourceEventId:'source-event', sourceInputDigest:HASH,
    sourceResultId:'source-result', sourceResultDigest:source.results[0].result_digest,
    sourceCommitResultId:'source-result', sourceCommitResultDigest:source.results[0].result_digest };
  f.graphs.set('source-plan', source);
  return { ...f, source, receipt };
}

function stageHistoryFixture() {
  let receipt;
  const f=fixture({owner:'arca',effectClass:'material_commit',terminalEffectObserver:{observe:()=>[receipt]}}),facts=f.facts;
  const slotEvent={...facts.events[0],event_id:'slot-event',node_id:'slot',result_id:'slot-result'};
  facts.events[0].state='failed';facts.events[0].result_id=null;facts.work.state=facts.workAttempt.state='failed';
  facts.events.push(slotEvent);facts.nodes.push({...facts.nodes[0],node_id:'slot'});
  const slotAttempt={...facts.attempts[0],event_attempt_id:'slot-attempt',event_id:'slot-event'};
  Object.assign(facts.attempts[0],{outcome_kind:'failed',input_snapshot_digest:HASH,fence_snapshot_digest:HASH});
  facts.attempts.push(slotAttempt);
  Object.assign(facts.results[0],{event_id:'slot-event',result_id:'slot-result',effect_receipt_id:'slot-receipt'});
  facts.effects=[{effect_id:'stage-effect',event_attempt_id:'execution',effect_class:'material_commit',state:'reconcile_required',output_digest:null,
    intent_digest:canonicalDigest({eventId:'event',capabilityRef:'libra.fixture@1',contractVersion:1,inputSnapshotDigest:HASH,fenceSnapshotDigest:HASH})},
    {effect_id:'slot-effect',event_attempt_id:'slot-attempt',effect_class:'material_commit',state:'committed',output_digest:facts.results[0].result_digest}];
  receipt={schemaRef:'arca.terminal-stage-history-proof@1',ownerDomain:'arca',disposition:'no_remaining_material_effect',
    effectId:'stage-effect',eventId:'event',inputDigest:HASH,slotEventId:'slot-event',slotResultId:'slot-result',slotResultDigest:facts.results[0].result_digest,observationDigest:HASH};
  return {...f,receipt};
}
test('typed empty stage proof retains original failed Event and unresolved Journal',()=>{
  const f=stageHistoryFixture(),before=JSON.stringify(f.facts);assert.equal(f.verify(),true,f.reasons.join('\n'));assert.equal(JSON.stringify(f.facts),before);
});
for(const [name,mutate] of [
  ['wrong slot Result',f=>f.receipt.slotResultId='foreign'],
  ['wrong slot digest',f=>f.receipt.slotResultDigest=HASH],
  ['foreign Effect',f=>f.receipt.effectId='foreign'],
  ['wrong input digest',f=>f.receipt.inputDigest='b'.repeat(64)],
  ['missing original Fence',f=>f.facts.attempts[0].fence_snapshot_digest=null],
  ['invented proof field',f=>f.receipt.approved=true],
])test('empty stage proof blocks '+name,()=>{const f=stageHistoryFixture();mutate(f);assert.equal(f.verify(),false);});

test('terminal Effect responsibility proof preserves failed history and revalidates successor on every call', () => {
  const f = effectHistoryFixture(), before = JSON.stringify([...f.graphs]);
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  assert.equal(JSON.stringify([...f.graphs]), before);
  f.source.effects[0].state = 'reconcile_required';
  assert.equal(f.verify(), false);
});

for (const [name, mutate] of [
  ['wrong original input', f => { f.receipt.inputDigest = 'b'.repeat(64); }],
  ['wrong original intent', f => { f.facts.effects[0].intent_digest = HASH; }],
  ['changed original Fence', f => { f.facts.attempts[0].fence_snapshot_digest = 'b'.repeat(64); }],
  ['wrong successor input', f => { f.receipt.sourceInputDigest = 'b'.repeat(64); }],
  ['wrong successor intent', f => { f.source.effects[0].intent_digest = HASH; }],
  ['wrong successor process', f => { f.source.work.process_id = 'foreign'; }],
  ['earlier completion presented as successor', f => { f.source.attempts[0].started_at_ms = 50; }],
  ['missing successor Result', f => { f.source.results = []; }],
  ['forged successor commit digest', f => { f.receipt.sourceCommitResultDigest = HASH; }],
  ['circular successor', f => { f.receipt.sourcePlanId = 'plan'; }],
  ['active history consumption', f => { f.facts.workAttempt.state = 'running'; f.facts.events[0].state = 'executing'; }],
]) test('terminal Effect proof blocks ' + name, () => {
  const f = effectHistoryFixture(); mutate(f); assert.equal(f.verify(), false);
});

test('exact bounded transition recognizes complete terminal history without mutating it', () => {
  const f = fixture(), before = JSON.stringify(f.facts);
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  assert.equal(JSON.stringify(f.facts), before);
});

for (const [name, mutate] of [
  ['unknown Catalog', f => { f.facts.plan.catalog_digest = HASH; }],
  ['forged old Catalog witness', f => { f.witness.previousCatalogDigest = HASH; f.facts.plan.catalog_digest = HASH; }],
  ['changed transitive Result schema', f => { f.schemas.get(f.prefix + 'result').$ref = 'helix://nested'; f.schemas.set('helix://nested', { $id: 'helix://nested', type: 'string' }); }],
  ['removed schema dependency', f => { f.schemas.delete(f.prefix + 'evidence'); }],
  ['wrong Work parent', f => { f.facts.events[0].work_id = 'foreign-work'; }],
  ['wrong Attempt parent', f => { f.facts.events[0].attempt_id = 'foreign-attempt'; }],
  ['missing node', f => { f.facts.nodes = []; }],
  ['duplicate Event', f => { f.facts.events.push({ ...f.facts.events[0] }); }],
  ['cross-Plan edge', f => { f.facts.edges.push({ plan_id: 'foreign', from_node_id: 'node', to_node_id: 'node', dependency_kind: 'success' }); }],
  ['cycle', f => { f.facts.edges.push({ plan_id: 'plan', from_node_id: 'node', to_node_id: 'node', dependency_kind: 'success' }); }],
  ['missing successful Result', f => { f.facts.results = []; }],
  ['wrong Result identity', f => { f.facts.events[0].result_id = 'foreign'; }],
  ['corrupt Result digest', f => { f.facts.results[0].result_digest = HASH; }],
  ['corrupt Evidence digest', f => { f.facts.results[0].evidence_json = '{"changed":true}'; }],
  ['wrong Result contract', f => { f.facts.results[0].result_schema_ref = f.prefix + 'evidence'; }],
  ['unfinished Event in terminal Attempt', f => { f.facts.events[0].state = 'ready'; }],
  ['unfinished Event Attempt', f => { f.facts.attempts[0].state = 'executing'; }],
  ['unknown projection', f => { const input = JSON.parse(f.facts.nodes[0].input_bindings_json); input.bindings[0] = {
    portName: 'value', bindingKind: 'projected_owner_facts', ownerDomain: 'libra', processType: 'media', processId: 'process',
    projectionRef: 'missing@1', parameters: {} }; f.facts.nodes[0].input_bindings_json = JSON.stringify(input); }],
]) test('bounded transition blocks ' + name, () => {
  const f = fixture(); mutate(f); assert.equal(f.verify(), false);
});

test('affected terminal capability is history only; affected active execution is rejected', () => {
  const f = fixture(); f.facts.nodes[0].capability_ref = f.facts.events[0].capability_ref = 'libra.changed@1';
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.workAttempt.state = 'running'; assert.equal(f.verify(), false);
});

test('unaffected active execution can proceed, while every active excluded process is blocked', () => {
  const f = fixture(); f.facts.workAttempt.state = 'running';
  f.facts.events[0].state = 'pending'; f.facts.events[0].result_id = null; f.facts.results = []; f.facts.attempts = [];
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.work.process_type = 'libra_intake'; assert.equal(f.verify(), false);
});

test('failed and skipped terminal Events may lack Results but cannot carry foreign Results', () => {
  const f = fixture(); f.facts.workAttempt.state = 'failed'; f.facts.events[0].state = 'failed';
  f.facts.events[0].result_id = null; f.facts.attempts[0].outcome_kind = 'failed'; f.facts.results = [];
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.events[0].result_id = 'missing'; assert.equal(f.verify(), false);
});

test('cross-Work Result graph is proved recursively and missing or affected active dependencies block', () => {
  const f = fixture();
  const source = structuredClone(f.facts);
  source.plan.plan_id = 'source-plan'; source.plan.attempt_id = source.workAttempt.attempt_id = 'source-attempt';
  source.workAttempt.work_id = source.work.work_id = 'source-work';
  source.nodes[0].plan_id = source.events[0].plan_id = 'source-plan';
  source.events[0].work_id = 'source-work'; source.events[0].attempt_id = 'source-attempt';
  f.graphs.set('source-plan', source);
  const input = JSON.parse(f.facts.nodes[0].input_bindings_json); input.bindings[0] = {
    portName: 'value', bindingKind: 'projected_work_results', sourceWorkId: 'source-work', projectionRef: 'projection@1',
    resultSchemaRefs: [f.prefix + 'result'], parameters: {} };
  f.facts.nodes[0].input_bindings_json = JSON.stringify(input);
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.workAttempt.state = 'running'; source.nodes[0].capability_ref = source.events[0].capability_ref = 'libra.changed@1';
  assert.equal(f.verify(), false);
  f.graphs.delete('source-plan'); assert.equal(f.verify(), false);
});

test('terminal unresolved physical Effects remain blockers', () => {
  const f = fixture({ effectClass: 'material_commit' });
  f.facts.events[0].state = 'failed'; f.facts.events[0].result_id = null;
  f.facts.attempts[0].outcome_kind = 'failed'; f.facts.results = [];
  f.facts.effects.push({ effect_id: 'effect', event_attempt_id: 'execution', effect_class: 'material_commit', state: 'reconcile_required' });
  assert.equal(f.verify(), false); assert.match(f.reasons.at(-1), /Unresolved terminal Effect/);
  f.facts.effects[0].state = 'failed'; assert.equal(f.verify(), true, f.reasons.join('\n'));
});

test('a nominal alias must be an exact schema reference chain', () => {
  const f = fixture(); const schema = { $id: 'helix://alias/result', type: 'object' };
  f.schemas.set(schema.$id, schema); f.schemas.get(f.prefix + 'result').$ref = schema.$id;
  const closureDigest = canonicalDigest(schemaClosure(f.registry.resolve('libra.fixture@1', 'libra').manifest, f.schemas));
  for (const record of f.witness.capabilities) record.previousSchemaDigest = record.currentSchemaDigest = closureDigest;
  f.facts.results[0].result_schema_ref = schema.$id;
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.results[0].result_schema_ref = f.prefix + 'parameters'; assert.equal(f.verify(), false);
});

test('same-Work projection cannot read a sibling without its success edge or a proven earlier Attempt', () => {
  const f = fixture(); const input = JSON.parse(f.facts.nodes[0].input_bindings_json);
  input.bindings[0] = { portName: 'value', bindingKind: 'projected_work_results', sourceWorkId: 'work',
    projectionRef: 'projection@1', parameters: {}, resultSchemaRefs: [f.prefix + 'result'] };
  f.facts.nodes[0].input_bindings_json = JSON.stringify(input);
  assert.equal(f.verify(), false);
  f.facts.workAttempt.ordinal = 2; assert.equal(f.verify(), false);
});

test('terminal unplannable Plans must have a genuinely empty durable graph', () => {
  const f = fixture(); f.facts.plan.state = 'contract_unplannable'; f.facts.workAttempt.state = 'failed';
  f.facts.nodes = []; f.facts.events = []; f.facts.attempts = []; f.facts.results = [];
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.edges.push({ from_node_id: 'missing', to_node_id: 'missing' }); assert.equal(f.verify(), false);
});

test('unpersisted outer Evidence cannot be replaced by the domain Evidence digest', () => {
  const f = fixture(); f.facts.attempts[0].evidence_digest = HASH;
  assert.equal(f.verify(), false); assert.match(f.reasons.at(-1), /Unproven prebound Evidence contract/);
});

test('an unaffected active physical Effect remains with the existing reconciler and Fence', () => {
  const f = fixture({ effectClass: 'material_commit' });
  f.facts.workAttempt.state = 'running'; f.facts.events[0].state = 'executing'; f.facts.events[0].result_id = null;
  f.facts.attempts[0].state = 'executing'; f.facts.attempts[0].outcome_kind = null; f.facts.results = [];
  f.facts.effects = [{ effect_id: 'effect', event_attempt_id: 'execution', effect_class: 'material_commit', state: 'intended' }];
  const before = JSON.stringify(f.facts);
  assert.equal(f.verify(), true, f.reasons.join('\n')); assert.equal(JSON.stringify(f.facts), before);
});

test('same-Work pagination proves only earlier terminal Attempts and rejects future sources', () => {
  const f = fixture(), earlier = structuredClone(f.facts);
  earlier.plan.plan_id = 'earlier'; earlier.plan.attempt_id = earlier.workAttempt.attempt_id = 'earlier-attempt';
  earlier.nodes[0].plan_id = earlier.events[0].plan_id = 'earlier'; earlier.events[0].attempt_id = 'earlier-attempt';
  f.graphs.set('earlier', earlier); f.facts.workAttempt.ordinal = 2;
  const input = JSON.parse(f.facts.nodes[0].input_bindings_json);
  input.bindings[0] = { portName: 'value', bindingKind: 'projected_work_results', sourceWorkId: 'work',
    projectionRef: 'projection@1', parameters: {}, resultSchemaRefs: [f.prefix + 'result'] };
  f.facts.nodes[0].input_bindings_json = JSON.stringify(input);
  assert.equal(f.verify(), true, f.reasons.join('\n'));
  earlier.workAttempt.ordinal = 3; assert.equal(f.verify(), false);
});

test('the checked-in witness pins all 87 semantic manifests and full schema dependency closures', () => {
  const root = path.resolve(__dirname, '../../src/helix/contracts');
  const witness = require('../../src/helix/composition/catalog-transitions/intake-control-20260912.json');
  const schemas = new Map();
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(location);
      else if (entry.name.endsWith('schema.json')) {
        const schema = JSON.parse(fs.readFileSync(location, 'utf8')); if (schema.$id) schemas.set(schema.$id, schema);
      }
    }
  }
  walk(root); assert.equal(witness.capabilities.length, 87);
  for (const record of witness.capabilities) {
    const file = path.join(root, 'capabilities', ...record.capabilityRef.replace('@1', '').split('.'), 'v1', 'manifest.json');
    const { sourceLocator, ...manifest } = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(canonicalDigest(manifest), record.currentContractDigest, record.capabilityRef);
    assert.equal(canonicalDigest(schemaClosure(manifest, schemas)), record.currentSchemaDigest, record.capabilityRef);
  }
  assert.deepEqual(witness.capabilities.filter(record => record.previousSchemaDigest !== record.currentSchemaDigest)
    .map(record => record.capabilityRef), ['libra.intake.accept.commit@1', 'libra.intake.material.verify@1']);
  for (const [schemaRef, record] of Object.entries(witness.preboundEvidenceSchemas)) {
    assert.equal(canonicalDigest(schemaClosure({ inputPorts: { evidence: { schemaRef } } }, schemas)), record.currentSchemaDigest);
  }
  const nominal = witness.preboundEvidenceSchemas['helix://contracts/types/LibraProductFactEvidence/v1'];
  assert.equal(nominal.previousSchemaDigest, null);
  assert.equal(nominal.historicalNominalContract.kind, 'ssot_only');
  assert.equal(canonicalDigest(nominal.historicalNominalContract.text), nominal.historicalNominalContract.textDigest);
  assert.equal(nominal.historicalNominalContract.sourceCommit, witness.sourceCommit);
});

function preboundFixture() {
  const f = fixture({ effectClass: 'domain_fact_commit' });
  const inner = 'helix://contracts/types/FixtureDomainEvidence/v1';
  const envelope = 'helix://contracts/types/EvidenceEnvelope/v1';
  f.schemas.set(inner, { $id: inner, type: 'object' });
  f.schemas.set(envelope, { $id: envelope, type: 'object' });
  f.schemas.get(f.prefix + 'evidence').$ref = envelope;
  const closure = canonicalDigest(schemaClosure(f.registry.resolve('libra.fixture@1', 'libra').manifest, f.schemas));
  f.witness.capabilities.forEach(record => { record.currentSchemaDigest = record.previousSchemaDigest = closure; });
  f.witness.sourceCommit = 'b'.repeat(40);
  const text = 'Frozen existing nominal contract';
  f.witness.preboundEvidenceSchemas = { [inner]: { capabilityRefs: ['libra.fixture@1'], previousSchemaDigest: null,
    currentSchemaDigest: canonicalDigest(schemaClosure({ inputPorts: { evidence: { schemaRef: inner } } }, f.schemas)),
    historicalNominalContract: { kind: 'ssot_only', sourceCommit: f.witness.sourceCommit, sourcePath: 'docs/ssot.md',
      lineNumber: 1, text, textDigest: canonicalDigest(text) } } };
  const evidence = { schemaRef: inner, evidenceId: 'inner-evidence' };
  f.facts.results[0].evidence_schema_ref = inner;
  f.facts.results[0].evidence_json = JSON.stringify(evidence); f.facts.results[0].evidence_digest = canonicalDigest(evidence);
  f.facts.results[0].effect_receipt_id = 'receipt';
  f.facts.effects = [{ effect_id: 'effect', event_attempt_id: 'execution', effect_class: 'domain_fact_commit', state: 'committed',
    output_digest: f.facts.results[0].result_digest }];
  f.facts.markers = [{ commit_marker: 'marker', commit_digest: HASH, effect_id: 'effect', owner_domain: 'libra', result_id: 'result', result_schema_ref: f.prefix + 'result',
    result_digest: f.facts.results[0].result_digest }];
  return { ...f, inner };
}

test('prebound canonical commit chain recognizes SSOT-only terminal Evidence without inventing schema bytes', () => {
  const f = preboundFixture(); assert.equal(f.verify(), true, f.reasons.join('\n'));
  f.facts.workAttempt.state = 'running'; assert.equal(f.verify(), false);
});

for (const [name, mutate] of [
  ['missing Marker', f => { f.facts.markers = []; }],
  ['foreign Marker', f => { f.facts.markers[0].owner_domain = 'arca'; }],
  ['wrong Marker digest', f => { f.facts.markers[0].result_digest = HASH; }],
  ['unknown nominal schema', f => { f.facts.results[0].evidence_schema_ref = 'helix://unknown'; }],
  ['unwitnessed producer', f => { f.witness.preboundEvidenceSchemas[f.inner].capabilityRefs = ['libra.changed@1']; }],
  ['fake old schema digest', f => { f.witness.preboundEvidenceSchemas[f.inner].previousSchemaDigest = HASH; }],
  ['corrupt SSOT provenance', f => { f.witness.preboundEvidenceSchemas[f.inner].historicalNominalContract.text = 'changed'; }],
]) test('prebound Evidence rejects ' + name, () => { const f = preboundFixture(); mutate(f); assert.equal(f.verify(), false); });
