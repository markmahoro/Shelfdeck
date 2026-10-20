'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-match-context');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildSelection}=require('../../src/helix/domains/arca/model/us-adult-actor-selection');
const {assertSelection}=require('../../src/helix/contracts/us-adult-actor-selection');
const {buildFacts}=require('../../src/helix/domains/arca/model/us-adult-actor-products');
const {buildInventoryChange,buildControlChanges}=require('../../src/helix/domains/arca/model/us-adult-actor-inventory-change');
const {executionInput}=require('../../src/helix/domains/arca/model/us-adult-actor-pipeline');
function selected(t){const x=fixture(t),selection=buildSelection({...x.request,records:x.records([0.8,0.95,0.85])}).selection;
  for(const row of x.f.context.raw.facts){row.fact_digest=D(row.value);row.fact_json=canonicalJson(row.value);row.fact_revision=1;}
  return {...x,selection};}
test('Actor products preserve original naming and descriptive fields with one Arca-owned actor Fact',t=>{
  const x=selected(t),context=x.f.context;
  context.raw.facts.find(row=>row.fact_kind==='product_metadata').value.descriptiveFacts.entries.push({key:'plot',value:'Keep this description'});
  const facts=buildFacts(context,x.selection),metadata=new Map(facts.metadata.descriptiveFacts.entries.map(item=>[item.key,item.value]));
  assert.equal(metadata.get('title'),'actor-b Studio.Scene.1080p');assert.equal(metadata.get('plot'),'Keep this description');
  assert.equal(facts.cast.relations.length,1);assert.equal(facts.cast.relations[0].personId,'actor-b');
  assert.equal(facts.cast.sourceBasisKind,'us_adult_actor_refresh');assert.equal(facts.cast.canonicalIdentityDigest,context.raw.identity.identity_digest);
  assert.equal(facts.cast.relationsDigest,D({schema:'arca.us-adult-actor-relations@1',relations:facts.cast.relations}));
});
test('Frozen actor selection rejects a rehashed missing reference and another Case',t=>{
  const x=selected(t);assertSelection(x.selection);
  assert.throws(()=>assertSelection(x.selection,{aftercareCaseId:'another-case'}),{code:'ARCA_US_ADULT_ACTOR_SELECTION_INVALID'});
  const {selectionDigest,...body}=structuredClone(x.selection);body.referenceAssetId='foreign';
  assert.throws(()=>assertSelection({...body,selectionDigest:D(body)}),{code:'ARCA_US_ADULT_ACTOR_SELECTION_INVALID'});
  assert.equal(buildSelection({...x.request,records:x.records([null,null,null])}).kind,'unchanged');
});
test('A phase input stays immutable when its own and later successful Results become visible',t=>{
  const x=selected(t),snapshot={intent:x.request.intent,care:x.s.care.getCase(x.request.aftercareCaseId),selection:x.selection,
    plan:{planDigest:D('plan')},stages:{assets:{record:{workId:'assets',resultDigest:D('assets')}}}};
  const before=executionInput(snapshot,'stage');snapshot.stages.stage={record:{workId:'stage',resultDigest:D('stage')}};
  snapshot.stages.publish={record:{workId:'publish',resultDigest:D('publish')}};
  assert.deepEqual(executionInput(snapshot,'stage'),before);
  assert.equal(executionInput(snapshot,'verify').publishWorkId,'publish');
  assert.equal(executionInput(snapshot,'close').stageWorkId,'stage');
});
test('Actor Inventory changes conserve identity facts and require exact verified members and Control sets',t=>{
  const x=selected(t),context=x.f.context,original=context.raw.materials[0];original.ordinal=0;original.role='primary_payload';
  original.episode_claims_json='[]';original.digest_hex=D('old bytes');original.active_guard=1n;original.ordinal=0n;context.raw.related=[];
  const facts=buildFacts(context,x.selection),identity=require('../../src/helix/domains/arca/model/aftercare-contract').physicalIdentityFromInventoryRow(original),
    body={schemaRef:'helix://contracts/domain-types/UsAdultActorFilePlan/v1',schemaVersion:1,aftercareCaseId:x.selection.aftercareCaseId,
      intentDigest:x.request.intent.intentDigest,selectionDigest:x.selection.selectionDigest,members:[{ordinal:0,role:'primary_payload',
        original:{location:original.location,physicalIdentity:identity,bindingRevision:original.binding_revision},targetLocation:original.location+'.renamed',
        targetEndpointId:original.endpoint_id,source:{kind:'retained_inventory'}}]},plan={...body,planDigest:D(body)},
    verified={schema:'arca.us-adult-final-files@1',aftercareCaseId:x.selection.aftercareCaseId,planDigest:plan.planDigest,stagedManifestDigest:D('staged'),
      members:[{ordinal:0,role:'primary_payload',previousMaterialKey:identity.materialKey,location:original.location+'.renamed',targetLocation:original.location+'.renamed',
        endpointId:original.endpoint_id,physicalIdentity:identity,fullByteDigest:D('complete bytes'),bindingRevision:original.binding_revision+1}]},
    verification={...verified,finalRealityDigest:D(verified)},args={context,intent:x.request.intent,selection:x.selection,plan,facts,verification,committedAtMs:10000},
    change=buildInventoryChange(args),preserved=change.facts.find(row=>row.fact_kind==='resolved_identity');
  assert.equal(preserved.fact_digest,context.raw.facts[0].fact_digest);assert.equal(change.people[0].person_id,'actor-b');
  assert.equal(change.materials[0].material_key,original.material_key);assert.equal(change.materials[0].binding_revision,original.binding_revision+1);
  const projection={materialKey:identity.materialKey,resultKind:'available',controlState:'controlled',ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:'entry',
    controlRevision:1,projectionDigest:D('control')};
  assert.equal(buildControlChanges({context,change,projections:[projection]})[0].action,'assert_same_field');
  assert.throws(()=>buildControlChanges({context,change,projections:[{...projection,ownerScopeId:'another-entry'}]}),{code:'ARCA_US_ADULT_INVENTORY_INVALID'});
  const altered=structuredClone(verification);altered.members[0].targetLocation+='foreign';const {finalRealityDigest,...changed}=altered;altered.finalRealityDigest=D(changed);
  assert.throws(()=>buildInventoryChange({...args,verification:altered}),{code:'ARCA_US_ADULT_INVENTORY_INVALID'});
});
