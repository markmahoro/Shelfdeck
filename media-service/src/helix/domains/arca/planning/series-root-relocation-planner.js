'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {CAPS,PROCESS,PLANNER,OBJECTIVE,reference}=require('../model/series-root-relocation-contract');
const SCOPE='helix://arca/series-root-relocation-projections/Reference/v1',RESULT='helix://arca/series-root-relocation-projections/Result/v1';
function createSeriesRootRelocationPlanner(options){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  const plannerRef=PLANNER,objective=OBJECTIVE;
  return {plannerContractRef:plannerRef,plannerVersion:1,plan(request){
    const scope=options.relocation.relocationStore.read(request.processId),base={schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:'arca-series-plan-'+canonicalDigest(request.workAttemptId).slice(0,40),workAttemptId:request.workAttemptId,ownerDomain:'arca',
      plannerContractRef:plannerRef,plannerVersion:1,workObjectiveTypeRef:objective,workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest};
    if(request.processType!==PROCESS||scope?.plan_digest!==request.executionBasisDigest)
      return {...base,resolution:'contract_unplannable',diagnosticClassification:'ARCA_SERIES_SCOPE_STALE',nodes:[]};
    const stages=[['files',null],['commit','FilesVerified']],nodes=[];
    for(const [stage,input] of stages){
      const ref=CAPS[stage],manifest=options.registry.resolve(ref,'arca').manifest,policy=options.policyRegistry.bindingFor(ref,manifest.effectClass),
        eventId='series-'+stage+'-'+canonicalDigest(request.workAttemptId).slice(0,24),bindings=[{portName:'seriesRootRelocationReference',bindingKind:'projected_owner_facts',
          ownerDomain:'arca',processType:request.processType,processId:request.processId,projectionRef:SCOPE,parameters:{expectedScopeDigest:scope.plan_digest}}];
      if(input){const prior=nodes.at(-1);bindings.push({portName:'seriesRootRelocation'+input,bindingKind:'projected_event_result',eventId:prior.eventId,
        resultSchemaRef:prior.outputContractRef,projectionRef:RESULT,parameters:{expectedScopeDigest:scope.plan_digest}});}
      const demand={resourceKinds:stage==='files'?['disk_io']:['sqlite_write']};
      nodes.push({nodeId:eventId,eventId,capabilityRef:ref,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn:input?[{eventId:nodes.at(-1).eventId,satisfaction:'success'}]:[],whenSchemaRef:null,when:null,effectClass:manifest.effectClass,
        resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},approvalRequirementRef:null,authorizationRequirementRef:null,
        fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:{basisDigest:scope.plan_digest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({eventId,workId:request.workId}),effectScopeDigest:canonicalDigest({eventId,scopeId:scope.scope_id,buildId:scope.relocation_id})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});
    }
    return {...base,resolution:'planned',diagnosticClassification:null,nodes};
  }};
}

function createSeriesRootRelocationProjections(options){
  function scopeFor(input){const owner=input.ownerScope,row=options.relocation.relocationStore.read(owner.processId);
    if(owner.ownerDomain!=='arca'||owner.processType!==PROCESS||row?.plan_digest!==input.parameters?.expectedScopeDigest)
      throw Object.assign(new Error('Frozen Series relocation projection changed.'),{code:'ARCA_SERIES_RELOCATION_STALE'});
    return row;
  }
  return [{projectionRef:SCOPE,projection:{project:input=>reference(scopeFor(input))}},{projectionRef:RESULT,projection:{project(input){
    const row=scopeFor(input),value=input.sourceResult;
    if(value?.planDigest!==row.plan_digest||value.relocationId!==row.relocation_id||value.scopeId!==row.scope_id)throw new Error('Relocation result belongs to another plan.');
    options.contractValidator.validate(value.schemaRef,value);return value;
  }}}];
}
module.exports=Object.freeze({createSeriesRootRelocationPlanner,createSeriesRootRelocationProjections});
