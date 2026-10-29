'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSeriesRootRelocationExecution}=require('../../src/helix/domains/arca/persistence/series-root-relocation-execution');
const {createSeriesRootRelocationPorts}=require('../../src/helix/domains/arca/capabilities/series-root-relocation-ports');
const {CAPS}=require('../../src/helix/domains/arca/model/series-root-relocation-contract');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {reference}=require('../../src/helix/domains/arca/model/series-root-relocation-contract');

function fixture() {
  const row={relocation_id:'move',scope_id:'scope',plan_digest:'frozen',state:'active',plan:{files:[]}};
  const facts={work:{owner_domain:'arca',process_type:'arca_series_root_relocation',process_id:'move',basis_digest:'frozen'},
    event:{work_id:'work',capability_ref:CAPS.files,state:'executing'},attempt:{event_id:'event',state:'executing'},
    effect:{event_attempt_id:'attempt',effect_class:'material_commit',state:'intended'}};
  const keys={work:{work_id:'work'},event:{event_id:'event'},attempt:{event_attempt_id:'attempt'},effect:{effect_id:'effect'}};
  const context={work:{work_id:'work',owner_domain:'arca',process_type:'arca_series_root_relocation',process_id:'move'},
    event:{event_id:'event',capability_ref:CAPS.files},node:{capability_ref:CAPS.files},
    attempt:{event_attempt_id:'attempt'},effect:{effect_id:'effect',effect_class:'material_commit'}};
  let observations=0;
  const options={schemaManifest,relocationStore:{read:()=>row,inspect:()=>row,fenceParticipant:()=>({participantId:'owner-fence',execute:()=>row})},
    unitOfWork:{execute:parts=>Object.fromEntries(parts.map(part=>[part.participantId,part.execute({repository:()=>({invoke(name,key){
      assert.deepEqual(key,keys[name]);return facts[name];
    }})})]))},
    relocationIo:{observe:()=>{observations++;return {state:'target_verified',realityDigest:'observed'};}}};
  options.relocationExecution=createSeriesRootRelocationExecution(options);
  const port=createSeriesRootRelocationPorts(options)[CAPS.files];
  return {facts,keys,row,context,port,execution:options.relocationExecution,observations:()=>observations};
}

test('startup recovery verifies the original persisted basis when its Work projection contains identity only',()=>{
  const f=fixture();assert.equal(f.context.work.basis_digest,undefined);
  assert.equal(f.port.observeEffectReality(f.context).status,'forward_required');
  assert.equal(f.observations(),1);
});

for(const [name,change] of [
  ['another Work basis',f=>{f.work.basis_digest='changed';}],
  ['another Event',f=>{f.attempt.event_id='foreign';}],
  ['another Effect owner attempt',f=>{f.effect.event_attempt_id='foreign';}],
  ['a terminal execution',f=>{f.event.state='failed';}],
  ['an already failed Effect',f=>{f.effect.state='failed';}],
])test('relocation recovery refuses '+name+' before inspecting files',()=>{
  const f=fixture();change(f.facts);
  assert.equal(f.port.observeEffectReality(f.context).status,'conflict');assert.equal(f.observations(),0);
});

function retryFixture() {
  const f=fixture(),input=canonicalDigest({seriesRootRelocationReference:reference(f.row)});
  f.facts.work.state='failed';
  Object.assign(f.keys,{work_events:{work_id:'work'},event_attempts:{event_id:'event'},attempt_effects:{event_attempt_id:'attempt'},result:{event_id:'event'}});
  Object.assign(f.facts,{work_events:[{event_id:'event',capability_ref:CAPS.files,contract_version:1,state:'failed'}],
    event_attempts:[{event_attempt_id:'attempt',state:'completed',input_snapshot_digest:input,fence_snapshot_digest:'fence'}],
    attempt_effects:[{effect_id:canonicalDigest(['material_commit','key']),effect_class:'material_commit',idempotency_key:'key',state:'reconcile_required',
      intent_digest:canonicalDigest({eventId:'event',capabilityRef:CAPS.files,contractVersion:1,inputSnapshotDigest:input,fenceSnapshotDigest:'fence'})}]});
  return f;
}

test('explicit retry can recover an unresolved rename only with the exact stopped intent and unchanged complete physical plan',()=>{
  const f=retryFixture();f.execution.assertRetrySafe(f.row,[{work_id:'work'}]);assert.equal(f.observations(),1);
});
for(const [name,change] of [
  ['an active Work',f=>{f.work.state='running';}],
  ['an active Attempt',f=>{f.event_attempts[0].state='executing';}],
  ['a different input snapshot',f=>{f.event_attempts[0].input_snapshot_digest='changed';}],
  ['a different original Effect intent',f=>{f.attempt_effects[0].intent_digest='changed';}],
  ['an unknown Effect state',f=>{f.attempt_effects[0].state='unknown';}],
])test('explicit relocation retry rejects '+name,()=>{
  const f=retryFixture();change(f.facts);
  assert.throws(()=>f.execution.assertRetrySafe(f.row,[{work_id:'work'}]),{code:'ARCA_SERIES_RELOCATION_EXECUTION_FENCE'});
  assert.equal(f.observations(),0);
});
