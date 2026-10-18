'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {fixture}=require('./fixtures/us-adult-inventory-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {buildDomainInputSchemas}=require('../../scripts/helix-architecture/domain-input-schema-builder');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const model=require('../../src/helix/domains/arca/model/us-adult-actor-refresh');
const schemas=buildDomainInputSchemas(),validator=createCapabilityContractValidator({schemas:
  ['UsAdultActorRefreshIntent','UsAdultPersonSnapshot','PersonReferenceProjection','PeopleReferenceLibraryPage','FaceModelRef','CareRequirement'].map(name=>schemas[name])});
function input(source,mode='specified') {
  const context=fixture(),identity=source.sourceHandle.identity;
  context.basis={digest:D('care-basis')};context.knownBindings={digest:D('known-bindings')};
  context.raw.materials=[{role:'primary_payload',material_key:identity.materialKey,mount_scope_id:identity.mountScopeId,inode:identity.inode,
    size_bytes:identity.sizeBytes,fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:identity.fingerprintVersion,
    content_fingerprint:identity.contentFingerprint,endpoint_id:'endpoint',location:'fixture/owned-video.mkv',binding_revision:3}];
  const person=source.pages[0].items[0];
  return {context,actorId:'admin',body:{mode,idempotencyKey:'refresh-key',expectedInventoryRevision:2,
    expectedRepresentationDigest:context.raw.inventory.representation_digest,...(mode==='specified'?{personId:person.personId,
      expectedPersonRevision:person.personRevision,expectedReferenceRevision:person.referenceProjection.currentReferenceRevision}:{})},
    personSnapshot:mode==='specified'?person:null,pages:mode==='specified'?[]:source.pages,contractValidator:validator};
}
test('specified refresh freezes the exact requested actor, original naming and current Inventory without library scanning',()=>harness(source=>{
  const value=input(source),intent=model.buildIntent(value),requirement=model.requirement(intent);
  assert.equal(intent.manualPersonSnapshot.personId,value.body.personId);assert.equal(intent.pageCount,0);assert.equal(intent.libraryDigest,null);
  assert.equal(intent.inventoryRevision,2);assert.equal(intent.deckFactRevision,1);assert.equal(intent.canonicalIdentityRevision,1);
  assert.equal(intent.originalName.originalFileName,'Studio.Scene.1080p.mp4');assert.ok(Object.isFrozen(intent.manualPersonSnapshot.referenceProjection));
  validator.validate(requirement.schemaRef,requirement);
  assert.deepEqual(model.readRequirement(requirement),{intentId:intent.intentId,intentDigest:intent.intentDigest});
  assert.ok(requirement.typedParameters.every(parameter=>/^(target|source)\./.test(parameter.parameter)));
  assert.equal(Object.hasOwn(intent,'libraRunId'),false);
}));
test('automatic refresh freezes every same-version reference page and rejects partial or reordered libraries',()=>harness(source=>{
  const value=input(source,'automatic'),intent=model.buildIntent(value);
  assert.equal(intent.personCount,3);assert.equal(intent.pageCount,3);assert.equal(intent.manualPersonSnapshot,null);
  assert.throws(()=>model.buildIntent({...value,pages:value.pages.slice(0,1)}),{code:'ARCA_US_ADULT_REFRESH_LIBRARY_INVALID'});
  assert.throws(()=>model.buildIntent({...value,pages:[...value.pages].reverse()}),{code:'ARCA_US_ADULT_REFRESH_LIBRARY_INVALID'});
  assert.throws(()=>model.buildIntent({...value,personSnapshot:source.pages[0].items[0]}),{code:'ARCA_US_ADULT_REFRESH_PERSON_INVALID'});
}));
test('an empty complete library remains a valid automatic request rather than inventing an actor',()=>harness(source=>{
  const value=input(source,'automatic'),{pageDigest,...page}=source.pages[0];
  Object.assign(page,{items:[],totalPersonCount:0,nextCursor:null,libraryDigest:D('empty-library')});
  const intent=model.buildIntent({...value,pages:[{...page,pageDigest:D(page)}]});
  assert.equal(intent.personCount,0);assert.equal(intent.pageCount,1);assert.equal(intent.manualPersonSnapshot,null);
}));
test('refresh fences stale inventory, a changed selected actor and concurrent Entry modifications',()=>harness(source=>{
  const value=input(source);
  assert.throws(()=>model.buildIntent({...value,body:{...value.body,expectedInventoryRevision:1}}),{code:'ARCA_US_ADULT_REFRESH_BASIS_STALE'});
  assert.throws(()=>model.buildIntent({...value,body:{...value.body,expectedPersonRevision:99}}),{code:'ARCA_US_ADULT_REFRESH_PERSON_STALE'});
  assert.throws(()=>model.buildIntent({...value,pages:source.pages}),{code:'ARCA_US_ADULT_REFRESH_LIBRARY_INVALID'});
  assert.throws(()=>model.buildIntent({...value,activeCases:[{state:'queued'}]}),{code:'ARCA_US_ADULT_REFRESH_BUSY'});
  value.context.raw.reservations=[{state:'active'}];assert.throws(()=>model.buildIntent(value),{code:'ARCA_US_ADULT_REFRESH_BUSY'});
}));
test('a refresh objective cannot substitute a health Finding, another Intent or extra required effects',()=>harness(source=>{
  const intent=model.buildIntent(input(source)),value=model.requirement(intent);
  assert.equal(model.readRequirement({typedParameters:[]}),null);
  const changed=structuredClone(value);changed.requiredEffects.push({...changed.requiredEffects[0],objectId:D('other')});
  const {digest,...body}=changed;changed.digest=D(body);
  assert.throws(()=>model.readRequirement(changed),{code:'ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID'});
  const substituted=structuredClone(value);substituted.typedParameters[1].value=D('other-intent');
  assert.throws(()=>model.readRequirement(substituted),{code:'ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID'});
  const duplicate=structuredClone(value);duplicate.typedParameters.unshift({parameter:'source.triggerKind',valueType:'string',value:'health_maintenance',valueDigest:D('health_maintenance')});
  assert.throws(()=>model.readRequirement(duplicate),{code:'ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID'});
}));

test('Owner command replays its original Case before reading changed People or current Entry state',()=>harness(source=>{
  const value=input(source),records=new Map(),cases=new Map();let reads=0,admitted=0,unavailable=false;
  const store={findCommand(actor,key){return records.get(actor+':'+key)||null;},get(id){return [...records.values()].find(item=>item.intent.intentId===id);},
    participant(intent,pages,aftercareCaseId){assert.equal(pages.length,0);return {commit(){records.set(intent.actorId+':'+intent.idempotencyKey,{intent,aftercareCaseId});}};}};
  const caseStore={history:()=>({cases:[]}),getCase:id=>cases.get(id),createCase(request){
    const aftercareCaseId='case',care={aftercareCaseId,shelfEntryId:request.shelfEntryId,careBasisDigest:request.careBasis.digest,
      careRequirement:request.careRequirement,state:'queued'};
    assert.equal(model.readRequirement(request.careRequirement).intentId,request.basisInputs[0].aggregateId);
    for(const participant of request.atomicParticipants(aftercareCaseId))participant.commit();cases.set(aftercareCaseId,care);return care;
  }};
  const command=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-command').createUsAdultActorRefreshCommand({actorRefreshStore:store,
    aftercareContextReader:{store:caseStore,read(){if(unavailable)throw new Error('Current Entry must not be read on replay.');return value.context;}},
    peopleReferenceQuery:{readUsAdultPersonSnapshot(){reads++;if(unavailable)throw new Error('Changed People must not be read on replay.');return value.personSnapshot;}},
    contractValidator:validator,onAdmitted(){admitted++;}});
  const first=command.request('entry',value.body,'admin');assert.equal(first.replayed,false);assert.equal(reads,1);assert.equal(admitted,1);
  unavailable=true;cases.get('case').state='resolved';
  const replay=command.request('entry',value.body,'admin');assert.equal(replay.replayed,true);assert.equal(replay.aftercareCaseId,first.aftercareCaseId);
  assert.equal(replay.state,'resolved');assert.equal(reads,1);assert.equal(admitted,1);
  assert.throws(()=>command.request('entry',{...value.body,expectedPersonRevision:99},'admin'),{code:'ARCA_US_ADULT_REFRESH_IDEMPOTENCY_CONFLICT'});
}));

test('automatic command rejects a repeating reference cursor before signing any Case',()=>harness(source=>{
  const value=input(source,'automatic');let calls=0;
  const page=source.pages[0],command=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-command').createUsAdultActorRefreshCommand({
    actorRefreshStore:{findCommand:()=>null},aftercareContextReader:{store:{history:()=>({cases:[]}),createCase(){assert.fail('No partial library may create a Case.');}},read:()=>value.context},
    peopleReferenceQuery:{readUsAdultReferencePage(){calls++;return page;}},contractValidator:validator});
  assert.throws(()=>command.request('entry',value.body,'admin'),{code:'ARCA_US_ADULT_REFRESH_LIBRARY_INVALID'});assert.equal(calls,2);
}));
