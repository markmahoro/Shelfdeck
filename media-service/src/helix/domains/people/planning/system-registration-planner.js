'use strict';
const {canonicalDigest:D}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {OBSERVE,CANDIDATE,PERSON}=require('../model/system-registration-work');
const PLANNER='helix://people/planners/SystemRegistration/v1',PREFIX='helix://people/projections/system-registration/';
function createSystemRegistrationPlanning(options){
  const query=options.systemRegistrationQuery,catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry),
    owner=(portName,processId,workId,projection,parameters={})=>({portName,bindingKind:'projected_owner_facts',ownerDomain:'people',
      processType:'people_system_registration',processId,projectionRef:PREFIX+projection+'/v1',parameters:{workId,...parameters}});
  const planner={plannerContractRef:PLANNER,plannerVersion:1,plan(request){
    const work=query.definition(request.workId),item=query.source(request.workId);
    if(request.processType!=='people_system_registration'||request.processId!==work.processId||request.executionBasisDigest!==work.executionBasisDigest)
      throw new TypeError('System Registration planner requires its exact People Work and Arca Evidence basis.');
    function node(phase,capability,dependsOn){const manifest=options.registry.resolve(capability,'people').manifest,effectClass=phase==='observe'?'pure_observation':'domain_fact_commit',
      policy=options.policyRegistry.bindingFor(capability,effectClass),eventId='people-system-'+phase+'-'+D(request.workAttemptId),
      bindings=phase==='observe'?[owner('providerPersonHintIntegrationHandleOrOnDeckPersonEvidenceProjectionItem',work.processId,work.workId,'source')]:[
        owner(phase==='candidate'?'peopleCandidateDraft':'peopleCandidateAcceptanceDecision',work.processId,work.workId,phase),
        owner('domainFactCommitHandle',work.processId,work.workId,'handle',{eventId,phase})],demand={resourceKinds:phase==='observe'?['cpu']:['sqlite_write']};
      return {nodeId:phase,eventId,capabilityRef:capability,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn,whenSchemaRef:null,when:null,effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:{...demand,demandDigest:D(demand)},
        approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
        fenceBasis:{basisDigest:work.executionBasisDigest,inputSetDigest:D(bindings),eventFenceDigest:D({eventId,workId:work.workId}),effectScopeDigest:D({eventId,workId:work.workId,phase})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef};
    }
    const observed=node('observe',OBSERVE,[]),candidate=node('candidate',CANDIDATE,[{eventId:observed.eventId,satisfaction:'success'}]),
      nodes=[observed,candidate,...(item.providerIdentities.length?[node('person',PERSON,[{eventId:candidate.eventId,satisfaction:'success'}])]:[])];
    return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:'people-system-plan-'+D(request.workAttemptId),
      workAttemptId:request.workAttemptId,ownerDomain:'people',plannerContractRef:PLANNER,plannerVersion:1,
      workObjectiveTypeRef:work.workObjectiveTypeRef,workObjectiveVersion:1,executionBasisDigest:work.executionBasisDigest,
      capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,nodes};
  }};
  return {planners:[{ownerDomain:'people',workKind:'system_person_registration',plannerContractRef:PLANNER,plannerVersion:1,planner}],
    bindingProjections:['source','candidate','person','handle'].map(kind=>({projectionRef:PREFIX+kind+'/v1',projection:{project({ownerScope,parameters}){
      const work=query.definition(parameters.workId);
      if(ownerScope.ownerDomain!=='people'||ownerScope.processType!=='people_system_registration'||ownerScope.processId!==work.processId)
        throw new TypeError('System Registration input Projection belongs to a different Work scope.');
      return kind==='source'?query.source(work.workId):kind==='candidate'?query.draft(work.workId):kind==='person'?query.decision(work.workId):
        query.handle(work.workId,parameters.eventId,parameters.phase);
    }}}))};
}
module.exports=Object.freeze({createSystemRegistrationPlanning});
