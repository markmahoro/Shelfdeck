'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {CAPABILITY}=require('../../../contracts/us-adult-catalogue-work-types');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {PROJECTIONS,currentObservationScope:current,observationTarget:target,observationBindings}=require('../model/us-adult-catalogue-observation-scope');
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_OBSERVATION_PLAN_INVALID'});}
function createUsAdultCatalogueObservationPlanner(options){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/UsAdultCatalogueObservation/v1',plannerVersion:1,plan(request){
    if(request.ownerDomain!=='libra'||request.processType!=='libra_run'||typeof request.workAttemptId!=='string'||!request.workAttemptId)
      fail('Catalogue planning requires its exact Owner and Work Attempt.');
    let state;
    for(const mode of ['initial','initial_and_supplement']){
      const candidate=current(options,request.processId,mode);
      if(candidate.work.workId===request.workId){state=candidate;break;}
    }
    if(!state)fail('The requested Work is not an exact completed catalogue source set.');
    const{basis,completedBatches,work}=state;
    if(request.executionBasisDigest!==work.executionBasisDigest||request.workObjectiveTypeRef!==work.workObjectiveTypeRef||request.workObjectiveVersion!==1)
      fail('The catalogue Work objective or execution basis changed.');
    const manifest=options.registry.resolve(CAPABILITY,'libra').manifest,policy=options.policyRegistry.bindingFor(CAPABILITY,manifest.effectClass),
      bindings=observationBindings(state),
      id=canonicalDigest({workAttemptId:request.workAttemptId,completedBatchSetDigest:completedBatches.setDigest}).slice(0,40),
      eventId='libra-catalogue-observation-event-'+id,demand={resourceKinds:['compute_device','cpu','disk_io']},
      node={nodeId:'observation',eventId,capabilityRef:CAPABILITY,contractVersion:1,
        inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},
        parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},dependsOn:[],whenSchemaRef:null,when:null,effectClass:manifest.effectClass,
        resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},
        approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
        fenceBasis:{basisDigest:request.executionBasisDigest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({schema:'libra.catalogue-observation-event-fence@1',eventId,workId:work.workId,completedBatchSetDigest:completedBatches.setDigest}),
          effectScopeDigest:canonicalDigest({schema:'libra.catalogue-observation-effect-scope@1',eventId,workId:work.workId,outputTargetDigest:target(options,state).targetDigest})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef};
    return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:'libra-catalogue-observation-plan-'+id,
      workAttemptId:request.workAttemptId,ownerDomain:'libra',plannerContractRef:this.plannerContractRef,plannerVersion:1,
      workObjectiveTypeRef:work.workObjectiveTypeRef,workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,
      capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,nodes:[node]};
  }});
}
function createUsAdultCatalogueObservationProjections(options){
  return Object.freeze(Object.entries(PROJECTIONS).map(([name,projectionRef])=>Object.freeze({projectionRef,projection:Object.freeze({project(input){
    const scope=input.ownerScope,p=input.parameters;
    if(scope?.ownerDomain!=='libra'||scope.processType!=='libra_run'||!p||
      Object.keys(p).sort().join(',')!=='analysisId,basisDigest,completedBatchSetDigest,mode')fail('The catalogue Owner projection is not closed.');
    const state=current(options,scope.processId,p.mode,p.basisDigest);
    if(p.analysisId!==state.basis.analysisId||p.completedBatchSetDigest!==state.completedBatches.setDigest)
      fail('The projected catalogue source set was substituted.');
    return name==='basis'?state.basis:name==='batches'?state.completedBatches:target(options,state);
  }})})));
}
module.exports=Object.freeze({PROJECTIONS,createUsAdultCatalogueObservationPlanner,createUsAdultCatalogueObservationProjections});
