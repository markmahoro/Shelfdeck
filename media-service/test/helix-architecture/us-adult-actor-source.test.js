'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createUsAdultInventorySource}=require('../../src/helix/integrations/us-adult-inventory-source');
const {createUsAdultActorRefreshSource}=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-source');
const {createUsAdultActorSourcePort}=require('../../src/helix/domains/arca/capabilities/us-adult-actor-source-port');
const {createUsAdultActorSourcePlanner,createUsAdultActorSourceProjections,PROJECTIONS}=require('../../src/helix/domains/arca/planning/us-adult-actor-source-planner');
const {SOURCE,sourceWork}=require('../../src/helix/domains/arca/model/us-adult-actor-refresh-execution');
function setup(t){
  const f=fixture(t),location=path.join(f.root,'native-source.mkv');fs.writeFileSync(location,Buffer.alloc(500000,43));
  const observed=computeBoundedMaterialFingerprintSync(location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
  Object.assign(f.context.raw.materials[0],{material_key:D({schema:'physical-material-identity@2',...tuple}),inode:tuple.inode,size_bytes:tuple.sizeBytes,
    content_fingerprint:tuple.contentFingerprint,location});
  const s=f.services(),started=s.command.request('entry',f.request,'admin'),intent=s.store.get(started.intentId).intent;
  s.care.admitCase(started.aftercareCaseId);
  const reader={...s.reader,sourceTargetBinding:()=>({endpointId:'endpoint',rootLocation:f.root,mountScopeId:'mount',mountScopeRevision:1})};
  let controlled=true,captures=0;
  const make=services=>createUsAdultActorRefreshSource({...services.dependencies,actorRefreshStore:services.store,aftercareContextReader:{...reader,store:services.care},
    materialControlProjectionPort:{getMaterialControlProjection:()=>({resultKind:'available',controlState:controlled?'controlled':'uncontrolled',ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:'entry'})},
    captureUsAdultInventorySource:({assertAuthority,...request})=>{captures++;return createUsAdultInventorySource({assertAuthority,now:()=>10000}).issueReadHandle(request);}}),
    source=make(s),current=source.read('entry',started.aftercareCaseId),work=sourceWork(intent,started.aftercareCaseId),
    input={usAdultActorRefreshScope:current.scope,usAdultActorRefreshIntent:intent,physicalMaterialReadHandle:source.capture('entry',started.aftercareCaseId)},
    context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},workId:work.workId,capabilityRef:SOURCE,namedInputs:input,assertExecutionActive(){}},
    port=createUsAdultActorSourcePort({actorRefreshSource:source,aftercareContextReader:reader,contractValidator:f.contractValidator,now:()=>10000});
  return {f,s,started,intent,source,current,work,input,context,port,make,setControlled:value=>{controlled=value;},captures:()=>captures};
}
test('actor source Work and read authority remain bound to one active durable Case after a database reopen',t=>{
  const x=setup(t);x.port.validateInputs(x.context);
  assert.equal(x.work.processType,'arca_shelf_entry');assert.equal(x.work.processId,'entry');assert.equal(x.work.executionBasisDigest,x.intent.intentDigest);
  assert.deepEqual(x.work.dependencyRefs.map(item=>item.objectType),['aftercare_case','us_adult_actor_refresh_intent']);
  const restarted=x.make(x.f.reopen());assert.deepEqual(restarted.read('entry',x.started.aftercareCaseId).scope,x.current.scope);
  assert.throws(()=>restarted.read('other-entry',x.started.aftercareCaseId),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});
  x.f.context.raw.entry.current_deck_fact_revision=2;
  assert.throws(()=>restarted.read('entry',x.started.aftercareCaseId),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});
});
test('source Capability rejects substituted Work, Intent, Handle, ownership and released Material Control',t=>{
  const x=setup(t);
  assert.throws(()=>x.port.validateInputs({...x.context,workId:'other-work'}),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});
  assert.throws(()=>x.port.validateInputs({...x.context,ownerScope:{domain:'libra',processType:'libra_run',processId:'entry'}}),TypeError);
  assert.throws(()=>x.port.validateInputs({...x.context,namedInputs:{...x.input,usAdultActorRefreshIntent:{...x.intent,actorId:'other-user'}}}),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});
  assert.throws(()=>x.port.validateInputs({...x.context,namedInputs:{...x.input,physicalMaterialReadHandle:{...x.input.physicalMaterialReadHandle,handleId:'borrowed'}}}),{code:'ARCA_US_ADULT_READ_HANDLE_INVALID'});
  x.setControlled(false);
  assert.throws(()=>x.port.validateInputs(x.context),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});
  assert.throws(()=>x.source.capture('entry',x.started.aftercareCaseId),{code:'ARCA_US_ADULT_SOURCE_AUTHORITY_LOST'});
});
test('source planner projects exact Owner inputs and refuses a different admitted Work or Intent',t=>{
  const x=setup(t),manifest=require('../../src/helix/contracts/capabilities/arca/us_adult/source/prepare/v1/manifest.json'),
    dependencies={actorRefreshSource:x.source,workResultReader:{readDefinition:()=>({definition:x.work})},
      registry:{snapshot:[],resolve:()=>({manifest})},policyRegistry:{digest:D('fixture-policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})}},
    planner=createUsAdultActorSourcePlanner(dependencies),request={workId:x.work.workId,processType:'arca_shelf_entry',processId:'entry',
      executionBasisDigest:x.intent.intentDigest,workAttemptId:'source-attempt'},plan=planner.plan(request),
    projections=new Map(createUsAdultActorSourceProjections(dependencies).map(item=>[item.projectionRef,item.projection]));
  assert.equal(plan.nodes.length,1);assert.equal(plan.nodes[0].effectClass,'workspace_write');
  assert.deepEqual(plan.nodes[0].inputBindings.bindings.map(item=>item.portName),['usAdultActorRefreshScope','usAdultActorRefreshIntent','physicalMaterialReadHandle']);
  const ownerScope={ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry'},parameters={aftercareCaseId:x.started.aftercareCaseId,intentId:x.intent.intentId};
  assert.deepEqual(projections.get(PROJECTIONS.scope).project({ownerScope,parameters}),x.current.scope);
  assert.deepEqual(projections.get(PROJECTIONS.source).project({ownerScope,parameters}),x.input.physicalMaterialReadHandle);
  assert.throws(()=>projections.get(PROJECTIONS.intent).project({ownerScope,parameters:{...parameters,intentId:D('other')}}),/different Intent/);
  assert.throws(()=>planner.plan({...request,workId:'other-work'}),/exact admitted Work/);
});
