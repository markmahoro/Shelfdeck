'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {CAPS,capability,executionInput,effectClass}=require('../model/us-adult-actor-pipeline');
const {executionScope}=require('../model/us-adult-actor-refresh-execution');
const PREFIX='helix://arca/projections/us-adult-actor-pipeline/';
function named(snapshot,action,options){
  if(action==='assets')return {usAdultActorRefreshScope:executionScope({...snapshot,
    rootHandleRef:options.aftercareContextReader.store.aftercareWorkspaceRootSnapshot.rootHandleRef}),
    usAdultActorRefreshSelection:snapshot.selection,arcaUsAdultSourcePrepared:snapshot.source.record.result};
  return {usAdultActorExecutionInput:executionInput(snapshot,action),...(['close','unchanged'].includes(action)?{}:{usAdultActorFilePlan:snapshot.plan})};
}
function createUsAdultActorPipelinePlanners(options){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze([...Object.keys(CAPS),'discard'].map(configured=>{
    const plannerContractRef='helix://arca/planners/UsAdultActor'+configured[0].toUpperCase()+configured.slice(1)+'/v1';
    return Object.freeze({plannerContractRef,plannerVersion:1,plan(request){
      const work=options.workResultReader.readDefinition(request.workId)?.definition,
        caseId=work?.dependencyRefs.find(item=>item.objectType==='aftercare_case'&&item.ownerDomain==='arca')?.objectId,
        action=configured==='close'&&work?.workObjectiveTypeRef==='helix://arca/work/us_adult_actor_unchanged/v1'?'unchanged':configured,
        snapshot=caseId&&options.actorPipelineQuery.inspect(request.processId,caseId);
      if(!snapshot||request.processType!=='arca_shelf_entry'||canonicalJson(snapshot.stages[action]?.work)!==canonicalJson(work)||
          request.executionBasisDigest!==snapshot.intent.intentDigest)throw new Error('Actor phase planner requires its exact frozen predecessor lineage.');
      const cap=capability(configured),manifest=options.registry.resolve(cap,'arca').manifest,policy=options.policyRegistry.bindingFor(cap,effectClass(action)),
        eventId='arca-us-'+action+'-event-'+D(request.workAttemptId),parameters={aftercareCaseId:caseId,intentId:snapshot.intent.intentId,action},
        bindings=Object.keys(named(snapshot,action,options)).map(portName=>({portName,bindingKind:'projected_owner_facts',ownerDomain:'arca',
          processType:'arca_shelf_entry',processId:request.processId,projectionRef:PREFIX+portName+'/v1',parameters})),
        demand={resourceKinds:action==='assets'?['cpu','disk_io']:['commit','close','unchanged'].includes(action)?['sqlite_write']:['disk_io']};
      return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:'arca-us-'+action+'-plan-'+D(request.workAttemptId),
        workAttemptId:request.workAttemptId,ownerDomain:'arca',plannerContractRef,plannerVersion:1,workObjectiveTypeRef:work.workObjectiveTypeRef,workObjectiveVersion:1,
        executionBasisDigest:snapshot.intent.intentDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,
        nodes:[{nodeId:action,eventId,capabilityRef:cap,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
          inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,
          parameters:{},dependsOn:[],whenSchemaRef:null,when:null,effectClass:effectClass(action),resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
          resourceDemand:{...demand,demandDigest:D(demand)},approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
          fenceBasis:{basisDigest:snapshot.intent.intentDigest,inputSetDigest:D(bindings),eventFenceDigest:D({eventId,workId:request.workId}),
            effectScopeDigest:D({eventId,intentDigest:snapshot.intent.intentDigest,action,selectionDigest:snapshot.selection?.selectionDigest||null,planDigest:snapshot.plan?.planDigest||null})},
          retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef}]};
    }});
  }));
}
function createUsAdultActorPipelineProjections(options){return Object.freeze([
  'usAdultActorRefreshScope','usAdultActorRefreshSelection','arcaUsAdultSourcePrepared','usAdultActorExecutionInput','usAdultActorFilePlan',
].map(portName=>({projectionRef:PREFIX+portName+'/v1',projection:{project({ownerScope,parameters}){
  if(ownerScope.ownerDomain!=='arca'||ownerScope.processType!=='arca_shelf_entry')throw new Error('Actor pipeline projection Owner is foreign.');
  const snapshot=options.actorPipelineQuery.inspect(ownerScope.processId,parameters.aftercareCaseId);
  if(snapshot.intent.intentId!==parameters.intentId)throw new Error('Actor pipeline projection Intent changed.');
  const value=named(snapshot,parameters.action,options)[portName];if(!value)throw new Error('Actor phase does not declare this projection.');return value;
}}})));}
module.exports=Object.freeze({createUsAdultActorPipelinePlanners,createUsAdultActorPipelineProjections});
