'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultAnalysisStore}=require('../../src/helix/domains/libra/persistence/us-adult-analysis-store');
const {createUsAdultAnalysisPlanner,createUsAdultAnalysisProjections,PROJECTIONS}=require('../../src/helix/domains/libra/planning/us-adult-analysis-planner');
const {FRAME,EMBED,CLUSTER,MATCH,REFERENCE_PROJECTION_REF,frameWork,matchWork,resultRef,workId,projectionSetDigest,pickCompleteMatch}=require('../../src/helix/domains/libra/model/us-adult-analysis-work');
const {createCapabilityRegistry}=require('../../src/helix/foundation/capability/capability-registry');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {validateWorkflowPlan}=require('../../src/helix/foundation/execution/workflow-plan');
const {createUsAdultAnalysisCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/us-adult-analysis-capability-ports');
const {buildUsAdultAnalysisBasis}=require('../../src/helix/domains/libra/model/us-adult-analysis-basis');
const {faceModelReference}=require('../../src/helix/contracts/us-adult-face-model');
const D=canonicalDigest;
function catalog(){
  const refs=[FRAME,EMBED,CLUSTER,MATCH],manifests=Object.fromEntries(refs.map(ref=>[ref,require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/manifest.json'))]));
  return createCapabilityRegistry({registrations:createUsAdultAnalysisCapabilityRegistrations({manifests,
    ports:Object.fromEntries(refs.map(ref=>[ref,{execute(){},validateInputs(){},validateResult(){}}]))}),expectedCapabilityRefs:refs});
}
test('formal planner binds every stage to the persisted analysis and exact reference page',()=>harness(({options,basis,pages,snapshot})=>{
  const store=createUsAdultAnalysisStore(options);store.freeze(basis,pages);
  const registry=catalog(),planning={registry,policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})},
    movieProductionReader:{readRunSnapshot:()=>snapshot,readWorkspace:()=>({libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,state:'active',
      currentRevision:1,stateDigest:D('workspace'),workspaceScopeDigest:D('workspace-scope')})},
    workspaceProductPort:{rootSnapshot:()=>({snapshotDigest:D('root')})},usAdultAnalysisStore:store},
    planner=createUsAdultAnalysisPlanner(planning),work=frameWork(snapshot,basis),request={...work,workAttemptId:'frame-attempt'};
  const plan=planner.plan(request);assert.deepEqual(plan.nodes.map(item=>item.capabilityRef),[FRAME,EMBED,CLUSTER]);
  assert.deepEqual(plan.nodes[1].dependsOn,[{eventId:plan.nodes[0].eventId,satisfaction:'success'}]);
  assert.deepEqual(plan.nodes[2].dependsOn,[{eventId:plan.nodes[1].eventId,satisfaction:'success'}]);
  const schemas=[FRAME,EMBED,CLUSTER,MATCH].flatMap(ref=>['parameters','resource-demand','fence'].map(kind=>
    require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/')+kind+'.schema.json'))),
    planValidation={registry,policyRegistry:planning.policyRegistry,contractValidator:createCapabilityContractValidator({schemas})};
  assert.equal(validateWorkflowPlan(plan,planValidation).plan.planId,plan.planId);
  const invalidGraph=structuredClone(plan);invalidGraph.nodes[1].dependsOn=['frames'];
  assert.throws(()=>validateWorkflowPlan(invalidGraph,planValidation),{code:'P4_PLAN_DEPENDENCY_SHAPE_MISMATCH'});
  assert.equal(plan.nodes[1].inputBindings.bindings[0].bindingKind,'projected_event_result');
  const page=matchWork(snapshot,basis,2),pagePlan=planner.plan({...page,workAttemptId:'page-attempt'});
  assert.equal(pagePlan.nodes.length,1);assert.equal(pagePlan.nodes[0].capabilityRef,MATCH);
  assert.deepEqual(pagePlan.nodes[0].inputBindings.bindings[1].parameters,{analysisId:basis.analysisId,pageOrdinal:2});
  assert.equal(validateWorkflowPlan(pagePlan,planValidation).plan.planId,pagePlan.planId);
  assert.throws(()=>planner.plan({...request,workId:'substituted-work'}));
  const projections=new Map(createUsAdultAnalysisProjections(planning).map(item=>[item.projectionRef,item.projection]));
  assert.deepEqual(projections.get(PROJECTIONS.references).project({ownerScope:{ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId},
    parameters:{analysisId:basis.analysisId,pageOrdinal:2}}),pages[2].items.map(item=>item.referenceProjection));
  assert.throws(()=>projections.get(PROJECTIONS.references).project({ownerScope:{ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId},
    parameters:{analysisId:D('another-basis'),pageOrdinal:2}}),/stale Owner basis/);
}));
const {scoredPage}=require('./fixtures/us-adult-match-proof');

test('complete page folding selects the actual highest score and rejects missing or substituted page provenance',()=>harness(input=>{
  // These fixtures represent already validated producer Results; CPU inference has separate real-model tests.
  const pages=structuredClone(input.pages);
  for(const page of pages){
    for(const person of page.items){
      person.referenceProjection.contributions[0].activeFaces[0].modelRef=faceModelReference('single_reference_face').digest;
      const {snapshotDigest,...body}=person;person.snapshotDigest=D(body);
    }
    const {pageDigest,...body}=page;page.pageDigest=D(body);
  }
  const basis=buildUsAdultAnalysisBasis({...input,referencePages:pages,workspaceId:input.basis.workspaceId}),
    results=pages.map((page,ordinal)=>scoredPage(basis,page,ordinal,ordinal===2?0.95:0.8)),
    request={basis,pages,results,clusterResult:{handleDigest:D('cluster-handle')}};
  assert.equal(pickCompleteMatch(request).personSnapshot.personId,'actor-3');
  assert.throws(()=>pickCompleteMatch({...request,results:results.slice(0,2)}),/missing reference pages/);
  const changed=structuredClone(results);changed[2].inputBindings.bindings[0].parameters.pageOrdinal=0;changed[2].inputBindingDigest=D(changed[2].inputBindings);
  assert.throws(()=>pickCompleteMatch({...request,results:changed}),/provenance changed/);
  const tied=pages.map((page,ordinal)=>scoredPage(basis,page,ordinal,0.8));
  assert.equal(pickCompleteMatch({...request,results:tied}).personSnapshot.personId,'actor-1');
  assert.throws(()=>pickCompleteMatch({...request,results:[...results].reverse()}),/provenance changed/);
}));
