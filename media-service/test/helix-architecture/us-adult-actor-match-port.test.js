'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-match-context');
const {executionScope,sourceWork}=require('../../src/helix/domains/arca/model/us-adult-actor-refresh-execution');
const {createUsAdultActorMatchQuery}=require('../../src/helix/domains/arca/application/us-adult-actor-match-query');
const {createUsAdultActorMatchPort}=require('../../src/helix/domains/arca/capabilities/us-adult-actor-match-port');
const {createUsAdultActorMatchPlanner,createUsAdultActorMatchProjections}=require('../../src/helix/domains/arca/planning/us-adult-actor-match-planner');
const {MATCH,matchWork}=require('../../src/helix/domains/arca/model/us-adult-actor-match-work');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
function setup(t){
  const x=fixture(t),{intent,aftercareCaseId,sourceRecord,pages,contractValidator}=x.request,sourceDefinition=sourceWork(intent,aftercareCaseId),
    scope=executionScope({context:x.f.context,care:x.s.care.getCase(aftercareCaseId),intent,rootHandleRef:x.s.care.aftercareWorkspaceRootSnapshot.rootHandleRef}),
    work=matchWork(intent,aftercareCaseId,1,pages[1].pageDigest,sourceRecord.resultDigest);
  let controlled=true,ready=true,reads=0;
  const actorRefreshSource={store:x.s.store,read:()=>({intent,scope}),assertAuthority:()=>controlled},
    workResultReader={status:()=>({state:ready?'succeeded':'running'}),readDefinition:id=>({definition:id===sourceDefinition.workId?sourceDefinition:work}),read:()=>[sourceRecord]},
    actorMatchQuery=createUsAdultActorMatchQuery({actorRefreshSource,workResultReader,contractValidator}),
    options={actorRefreshSource,actorMatchQuery,workResultReader,contractValidator,aftercareContextReader:x.s.reader,now:()=>10000,
      createUsAdultInventoryAnalysisPort:()=>({matchPage:async()=>{reads++;const raw=x.records([null,0.95,null])[1].result.matches[0];
        return {matches:[Object.fromEntries(['personId','faceGroupId','score','referenceAssetId','artifactDigest','threshold','faceModelRefDigest','referenceModelRefDigest','confidenceClass'].map(key=>[key,raw[key]]))]};}})},
    port=createUsAdultActorMatchPort(options),context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},capabilityRef:MATCH,workId:work.workId,
      namedInputs:{usAdultActorRefreshScope:scope,usAdultActorRefreshIntent:intent,arcaUsAdultSourcePrepared:sourceRecord.result,peopleReferenceLibraryPage:pages[1]}};
  return {...x,options,port,context,work,setControlled:value=>{controlled=value;},setReady:value=>{ready=value;},reads:()=>reads};
}
test('page matching executes a pure observation against exact completed source and frozen page inputs',async t=>{
  const x=setup(t),outcome=await x.port.execute(x.context);x.port.validateResult(x.context,outcome);
  assert.equal(outcome.kind,'succeeded');assert.equal(outcome.result.pageOrdinal,1);assert.equal(outcome.result.matches[0].personId,'actor-b');
  assert.equal(outcome.result.matches[0].personRevision,1);assert.equal(outcome.effectReceipt,undefined);assert.equal(x.reads(),1);
});
test('page matching cannot start before Source Work completion or after ownership changes',async t=>{
  const x=setup(t);x.setReady(false);
  await assert.rejects(x.port.execute(x.context),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});assert.equal(x.reads(),0);
  x.setReady(true);x.setControlled(false);
  await assert.rejects(x.port.execute(x.context),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});assert.equal(x.reads(),0);
});
test('page matching rejects another frozen page, source Result and Work before technical reads',t=>{
  const x=setup(t);
  for(const namedInputs of [{...x.context.namedInputs,peopleReferenceLibraryPage:x.request.pages[0]},
    {...x.context.namedInputs,arcaUsAdultSourcePrepared:{...x.request.sourceRecord.result,analysisDigest:D('other')}}])
    assert.throws(()=>x.port.validateInputs({...x.context,namedInputs}),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});
  assert.throws(()=>x.port.validateInputs({...x.context,workId:'another-work'}),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});assert.equal(x.reads(),0);
});
test('matching planner and all four projections bind the exact source Result and page ordinal',t=>{
  const x=setup(t),manifest=require('../../src/helix/contracts/capabilities/arca/us_adult/references/match/v1/manifest.json'),
    options={...x.options,registry:{snapshot:[],resolve:()=>({manifest})},policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})}},
    planner=createUsAdultActorMatchPlanner(options),request={workId:x.work.workId,processType:'arca_shelf_entry',processId:'entry',workAttemptId:'match-attempt',executionBasisDigest:x.request.intent.intentDigest},
    plan=planner.plan(request),projections=new Map(createUsAdultActorMatchProjections(options).map(item=>[item.projectionRef,item.projection]));
  assert.equal(plan.nodes[0].effectClass,'pure_observation');assert.equal(plan.nodes[0].capabilityRef,MATCH);
  for(const binding of plan.nodes[0].inputBindings.bindings){
    const value=projections.get(binding.projectionRef).project({ownerScope:{ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry'},parameters:binding.parameters});
    assert.deepEqual(value,x.context.namedInputs[binding.portName]);
    assert.throws(()=>projections.get(binding.projectionRef).project({ownerScope:{ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry'},
      parameters:{...binding.parameters,sourceResultDigest:D('other')}}),/source Result or Intent changed/);
  }
  assert.throws(()=>planner.plan({...request,workId:'other-work'}),/exact admitted page Work/);
});
