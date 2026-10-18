'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {SOURCE,OBJECTIVE,sourceWork}=require('../model/us-adult-actor-refresh-execution');
const PLANNER='helix://arca/planners/UsAdultActorSource/v1',PREFIX='helix://arca/input-projections/UsAdultActorSource';
const PROJECTIONS=Object.freeze({scope:PREFIX+'Scope/v1',intent:PREFIX+'Intent/v1',source:PREFIX+'ReadHandle/v1'});
function createUsAdultActorSourcePlanner(options){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:PLANNER,plannerVersion:1,plan(request){
    const work=options.workResultReader.readDefinition(request.workId)?.definition,
      caseId=work?.dependencyRefs.find(item=>item.ownerDomain==='arca'&&item.objectType==='aftercare_case')?.objectId,
      current=caseId&&options.actorRefreshSource.read(request.processId,caseId);
    if(!current||request.processType!=='arca_shelf_entry'||request.executionBasisDigest!==current.intent.intentDigest||
        request.workId!==sourceWork(current.intent,caseId).workId)throw new Error('Actor source planner requires its exact admitted Work and active Case.');
    const manifest=options.registry.resolve(SOURCE,'arca').manifest,policy=options.policyRegistry.bindingFor(SOURCE,'workspace_write'),
      eventId='arca-us-source-event-'+canonicalDigest(request.workAttemptId),parameters={aftercareCaseId:caseId,intentId:current.intent.intentId},
      bindings=Object.entries({usAdultActorRefreshScope:PROJECTIONS.scope,usAdultActorRefreshIntent:PROJECTIONS.intent,physicalMaterialReadHandle:PROJECTIONS.source})
        .map(([portName,projectionRef])=>({portName,bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:'arca_shelf_entry',processId:request.processId,projectionRef,parameters})),
      demand={resourceKinds:['cpu','disk_io']};
    return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:'arca-us-source-plan-'+canonicalDigest(request.workAttemptId),
      workAttemptId:request.workAttemptId,ownerDomain:'arca',plannerContractRef:PLANNER,plannerVersion:1,workObjectiveTypeRef:OBJECTIVE,workObjectiveVersion:1,
      executionBasisDigest:current.intent.intentDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,
      nodes:[{nodeId:'source',eventId,capabilityRef:SOURCE,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn:[],whenSchemaRef:null,when:null,effectClass:'workspace_write',resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
        resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},approvalRequirementRef:null,authorizationRequirementRef:null,
        fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:{basisDigest:current.intent.intentDigest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({eventId,workId:request.workId}),effectScopeDigest:canonicalDigest({eventId,scopeDigest:current.scope.scopeDigest})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef}]};
  }});
}
function createUsAdultActorSourceProjections(options){
  return Object.freeze(Object.entries(PROJECTIONS).map(([kind,projectionRef])=>({projectionRef,projection:{project({ownerScope,parameters}){
    if(ownerScope.ownerDomain!=='arca'||ownerScope.processType!=='arca_shelf_entry')throw new Error('Actor source projection Owner is invalid.');
    const current=options.actorRefreshSource.read(ownerScope.processId,parameters.aftercareCaseId);
    if(current.intent.intentId!==parameters.intentId)throw new Error('Actor source projection substituted a different Intent.');
    return kind==='scope'?current.scope:kind==='intent'?current.intent:options.actorRefreshSource.capture(ownerScope.processId,parameters.aftercareCaseId);
  }}})));
}
module.exports=Object.freeze({PLANNER,PROJECTIONS,createUsAdultActorSourcePlanner,createUsAdultActorSourceProjections});
