'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture:storeFixture}=require('./fixtures/us-adult-catalogue-store');
const {fixture:inputFixture}=require('./fixtures/us-adult-catalogue-basis');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {buildCatalogueAnalysisBasis}=require('../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
const {createUsAdultCatalogueStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {catalogueFrameBatch,catalogueFrameWork}=require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {createUsAdultCatalogueFramePlanner,createUsAdultCatalogueFrameProjections,PROJECTIONS}=require('../../src/helix/domains/libra/planning/us-adult-catalogue-frame-planner');
const {FRAME,EMBED,CLUSTER}=require('../../src/helix/domains/libra/model/us-adult-analysis-work');
const {createUsAdultAnalysisCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/us-adult-analysis-capability-ports');
const {createCapabilityRegistry}=require('../../src/helix/foundation/capability/capability-registry');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {validateWorkflowPlan}=require('../../src/helix/foundation/execution/workflow-plan');
const {validateSupportingWorkDefinition}=require('../../src/helix/foundation/execution/runtime-contracts');
function planning(f){
  const refs=[FRAME,EMBED,CLUSTER],manifests=Object.fromEntries(refs.map(ref=>[ref,
    require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/manifest.json'))])),
    registry=createCapabilityRegistry({registrations:createUsAdultAnalysisCapabilityRegistrations({manifests,
      ports:Object.fromEntries(refs.map(ref=>[ref,{execute(){throw Error('Planning tests must not execute an Effect.');},validateInputs(){},validateResult(){}}]))}),expectedCapabilityRefs:refs}),
    schemas=refs.flatMap(ref=>['parameters','resource-demand','fence'].map(kind=>
      require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/')+kind+'.schema.json'))),
    options={registry,policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})},
      usAdultCatalogueStore:createUsAdultCatalogueStore(f.options),movieProductionReader:{readRunSnapshot:()=>f.args.snapshot,
        readWorkspace:()=>({libraRunId:'run',workspaceId:'workspace',state:'active',currentRevision:1,stateDigest:D('workspace'),workspaceScopeDigest:D('workspace-scope')})},
      workspaceProductPort:{rootSnapshot:()=>({snapshotDigest:D('root')})}};
  options.usAdultCatalogueStore.freeze(f.basis);
  return {options,contractValidator:createCapabilityContractValidator({schemas})};
}
test('twenty initial and twenty supplemental points conserve unique bounded global faces and exact parent provenance',()=>{
  const args=inputFixture(),basis=buildCatalogueAnalysisBasis(args),initial=catalogueFrameBatch(basis,'initial'),supplement=catalogueFrameBatch(basis,'supplement');
  assert.equal(initial.points.length,20);assert.equal(supplement.points.length,20);
  assert.deepEqual([...initial.points,...supplement.points].map(x=>x.ordinal),Array.from({length:40},(_,i)=>i));
  assert.equal(new Set([...initial.points,...supplement.points].map(x=>x.timestampMs)).size,40);
  for(const batch of [initial,supplement]){
    assert.equal(batch.parentSamplingPlanDigest,basis.samplingPlan.digest);assert.equal(batch.samplingPlan.maxFrames,20);
    args.contractValidator.validate('helix://contracts/domain-types/SamplingPlan/v1',batch.samplingPlan);
    const {batchDigest,...body}=batch;assert.equal(D(body),batchDigest);assert.equal(Object.isFrozen(batch.points[0]),true);
  }
  const first=catalogueFrameWork(args.snapshot,basis,'initial'),second=catalogueFrameWork(args.snapshot,basis,'supplement');
  assert.equal(validateSupportingWorkDefinition(first).workId,first.workId);
  assert.equal(validateSupportingWorkDefinition(second).workId,second.workId);
  assert.equal(first.dependencyRefs[0].objectId,basis.sourceProbeRef.workId);assert.equal(second.dependencyRefs[0].objectId,first.workId);
  assert.notEqual(first.workId,second.workId);assert.notEqual(first.concurrencyScope,second.concurrencyScope);
  assert.deepEqual(catalogueFrameWork(args.snapshot,basis,'initial'),first);
  assert.equal(catalogueFrameWork({...args.snapshot,run:{...args.snapshot.run,priorityClass:'expedited'}},basis,'initial').workId,first.workId);
  assert.throws(()=>catalogueFrameBatch(basis,'third'),{code:'US_ADULT_CATALOGUE_BATCH_INVALID'});
});
test('short clips deduplicate times across both stages without fabricating an empty supplemental Work',()=>{
  const args=inputFixture();args.sourceProbeRecord.result.durationMs=1;
  const probe=args.sourceProbeRecord.result,{payloadDigest,...payload}=probe;probe.payloadDigest=D(payload);args.sourceProbeRecord.resultDigest=D(probe);
  const basis=buildCatalogueAnalysisBasis(args),first=catalogueFrameBatch(basis,'initial');
  assert.equal(first.points.length,1);assert.equal(first.points[0].timestampMs,0);assert.equal(catalogueFrameBatch(basis,'supplement'),null);
  assert.equal(catalogueFrameWork(args.snapshot,basis,'supplement'),null);
});
test('formal plans bind separate frame, embedding and cluster Effects to each persisted batch and exact event dependencies',t=>{
  const f=storeFixture(t),{options,contractValidator}=planning(f),planner=createUsAdultCatalogueFramePlanner(options);
  const plans=[];
  for(const stage of ['initial','supplement']){
    const work=catalogueFrameWork(f.args.snapshot,f.basis,stage),request={...work,workAttemptId:stage+'-attempt'},plan=planner.plan(request);
    assert.deepEqual(plan.nodes.map(x=>x.capabilityRef),[FRAME,EMBED,CLUSTER]);
    assert.deepEqual(plan.nodes[1].dependsOn,[{eventId:plan.nodes[0].eventId,satisfaction:'success'}]);
    assert.deepEqual(plan.nodes[2].dependsOn,[{eventId:plan.nodes[1].eventId,satisfaction:'success'}]);
    assert.equal(validateWorkflowPlan(plan,{...options,contractValidator}).plan.planId,plan.planId);
    assert.deepEqual(planner.plan(request),plan);
    assert.throws(()=>planner.plan({...request,executionBasisDigest:D('other')}),{code:'US_ADULT_CATALOGUE_FRAME_PLAN_INVALID'});
    assert.throws(()=>planner.plan({...request,workObjectiveTypeRef:'another'}),{code:'US_ADULT_CATALOGUE_FRAME_PLAN_INVALID'});
    plans.push(plan);
  }
  assert.notEqual(plans[0].nodes[0].eventId,plans[1].nodes[0].eventId);
  assert.notEqual(plans[0].nodes[0].fenceBasis.effectScopeDigest,plans[1].nodes[0].fenceBasis.effectScopeDigest);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_effect_journal').get().n,0);
});
test('projections fence batch inputs, formal producer provenance and live Run state instead of trusting immutable history',t=>{
  const f=storeFixture(t),{options}=planning(f),projections=new Map(createUsAdultCatalogueFrameProjections(options).map(x=>[x.projectionRef,x.projection])),
    projected=(name,input)=>projections.get(PROJECTIONS[name]).project(input),inputs=stage=>{
      const batch=catalogueFrameBatch(f.basis,stage);return {ownerScope:{ownerDomain:'libra',processType:'libra_run',processId:'run'},
        parameters:{analysisId:f.basis.analysisId,basisDigest:f.basis.basisDigest,stage,batchDigest:batch.batchDigest}};
    },initial=inputs('initial'),supplement=inputs('supplement'),target=projected('target',initial),second=projected('target',supplement);
  assert.equal(projected('source',initial).identity.materialKey,f.basis.sourceHandle.identity.materialKey);
  assert.deepEqual(projected('model',initial),f.basis.faceModelRef);
  assert.notEqual(target.targetRelativePath,second.targetRelativePath);assert.notEqual(target.sourceInputDigest,second.sourceInputDigest);
  assert.equal(target.sourceInputDigest,D({sourceHandle:f.basis.sourceHandle,samplingPlan:projected('sampling',initial)}));
  const result={libraRunId:'run',workspaceId:'workspace',sourceMaterialDigest:D(f.basis.sourceHandle),
    samplingPlanDigest:projected('sampling',initial).digest,frameSetArtifactHandle:{handleId:'produced-frame-artifact'}};
  assert.deepEqual(projected('frameList',{...initial,sourceResult:result}),[result.frameSetArtifactHandle]);
  assert.throws(()=>projected('frameList',{...supplement,sourceResult:result}),{code:'US_ADULT_CATALOGUE_FRAME_PLAN_INVALID'});
  assert.throws(()=>projected('source',{...initial,parameters:{...initial.parameters,batchDigest:D('other')}}),{code:'US_ADULT_CATALOGUE_FRAME_PLAN_INVALID'});
  assert.throws(()=>projected('source',{...initial,parameters:{...initial.parameters,extra:true}}),{code:'US_ADULT_CATALOGUE_FRAME_PLAN_INVALID'});
  f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");
  assert.deepEqual(options.usAdultCatalogueStore.getByRun('run'),f.basis);
  assert.throws(()=>projected('source',initial),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
  assert.throws(()=>createUsAdultCatalogueFramePlanner(options).plan({...catalogueFrameWork(f.args.snapshot,f.basis,'initial'),workAttemptId:'late-attempt'}),
    {code:'US_ADULT_CATALOGUE_BASIS_STALE'});
});
