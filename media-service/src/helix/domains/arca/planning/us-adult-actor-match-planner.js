'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {MATCH,PROJECTIONS}=require('../model/us-adult-actor-match-work');
const PLANNER='helix://arca/planners/UsAdultActorMatch/v1';
function createUsAdultActorMatchPlanner(options){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:PLANNER,plannerVersion:1,plan(request){
    const work=options.workResultReader.readDefinition(request.workId)?.definition,
      caseId=work?.dependencyRefs.find(item=>item.ownerDomain==='arca'&&item.objectType==='aftercare_case')?.objectId,
      pageOrdinal=Number(work?.dependencyRefs.find(item=>item.objectType==='us_adult_reference_page')?.objectId),
      current=caseId&&options.actorMatchQuery.read(request.processId,caseId,pageOrdinal);
    if(!current||request.processType!=='arca_shelf_entry'||request.workId!==current.work.workId||canonicalJson(work)!==canonicalJson(current.work)||
        request.executionBasisDigest!==current.intent.intentDigest)throw new Error('Actor matching planner requires its exact admitted page Work.');
    const manifest=options.registry.resolve(MATCH,'arca').manifest,policy=options.policyRegistry.bindingFor(MATCH,'pure_observation'),
      eventId='arca-us-match-event-'+canonicalDigest(request.workAttemptId),parameters={aftercareCaseId:caseId,intentId:current.intent.intentId,
        pageOrdinal,sourceResultDigest:current.sourceRecord.resultDigest},
      bindings=Object.entries({usAdultActorRefreshScope:PROJECTIONS.scope,usAdultActorRefreshIntent:PROJECTIONS.intent,
        arcaUsAdultSourcePrepared:PROJECTIONS.source,peopleReferenceLibraryPage:PROJECTIONS.page}).map(([portName,projectionRef])=>({
        portName,bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:'arca_shelf_entry',processId:request.processId,projectionRef,parameters})),
      demand={resourceKinds:['cpu','disk_io']};
    return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:'arca-us-match-plan-'+canonicalDigest(request.workAttemptId),
      workAttemptId:request.workAttemptId,ownerDomain:'arca',plannerContractRef:PLANNER,plannerVersion:1,workObjectiveTypeRef:current.work.workObjectiveTypeRef,workObjectiveVersion:1,
      executionBasisDigest:current.intent.intentDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,
      nodes:[{nodeId:'reference_page',eventId,capabilityRef:MATCH,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn:[],whenSchemaRef:null,when:null,effectClass:'pure_observation',resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
        resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},approvalRequirementRef:null,authorizationRequirementRef:null,
        fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:{basisDigest:current.intent.intentDigest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({eventId,workId:request.workId}),effectScopeDigest:canonicalDigest({eventId,scopeDigest:current.scope.scopeDigest,pageDigest:current.page.pageDigest})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef}]};
  }});
}
function createUsAdultActorMatchProjections(options){return Object.freeze(Object.entries(PROJECTIONS).map(([kind,projectionRef])=>({projectionRef,
  projection:{project({ownerScope,parameters}){
    if(ownerScope.ownerDomain!=='arca'||ownerScope.processType!=='arca_shelf_entry')throw new Error('Actor matching projection Owner is invalid.');
    const current=options.actorMatchQuery.read(ownerScope.processId,parameters.aftercareCaseId,parameters.pageOrdinal);
    if(current.intent.intentId!==parameters.intentId||current.sourceRecord.resultDigest!==parameters.sourceResultDigest)
      throw new Error('Actor matching projection source Result or Intent changed.');
    return kind==='scope'?current.scope:kind==='intent'?current.intent:kind==='source'?current.sourceRecord.result:current.page;
  }}})));}
module.exports=Object.freeze({PLANNER,createUsAdultActorMatchPlanner,createUsAdultActorMatchProjections});
