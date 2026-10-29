'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {FRAME,EMBED,CLUSTER,resultRef}=require('../model/us-adult-analysis-work');
const {catalogueFrameBatch,catalogueFrameWork}=require('../model/us-adult-catalogue-frame-work');
const {frameTarget}=require('./us-adult-analysis-planner');
const PREFIX='helix://libra/input-projections/UsAdultCatalogueFrame';
const PROJECTIONS=Object.freeze(Object.fromEntries(['source','sampling','target','model','cluster','frameList'].map(name=>[name,
  PREFIX+name[0].toUpperCase()+name.slice(1)+'/v1'])));
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_FRAME_PLAN_INVALID'});}
function current(options,processId,expectedBasisDigest){
  const historical=options.usAdultCatalogueStore.getByRun(processId);
  if(!historical)fail('A persisted catalogue Basis is required.');
  const basis=options.usAdultCatalogueStore.readForExecution({libraRunId:processId,expectedBasisDigest:expectedBasisDigest??historical.basisDigest}),
    snapshot=options.movieProductionReader.readRunSnapshot(processId);
  if(snapshot?.spec?.contentProfile!=='western_adult'||snapshot.run.executionBasisDigest!==basis.runExecutionBasisDigest)
    fail('The current Run no longer owns this catalogue execution basis.');
  return {basis,snapshot};
}
function projectionState(options,input){
  const {ownerScope:scope,parameters:p}=input;
  if(scope?.ownerDomain!=='libra'||scope.processType!=='libra_run'||!p||
    Object.keys(p).sort().join(',')!=='analysisId,basisDigest,batchDigest,stage')fail('The batch projection scope is not closed.');
  const state=current(options,scope.processId,p.basisDigest),batch=catalogueFrameBatch(state.basis,p.stage);
  if(!batch||p.analysisId!==state.basis.analysisId||p.batchDigest!==batch.batchDigest)fail('The projected batch was substituted.');
  return {...state,batch};
}
function createUsAdultCatalogueFramePlanner(options){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/UsAdultCatalogueFrames/v1',plannerVersion:1,plan(request){
    if(request.ownerDomain!=='libra'||request.processType!=='libra_run'||typeof request.workAttemptId!=='string'||!request.workAttemptId)
      fail('The catalogue frame planner requires its exact Owner and attempt.');
    const {basis,snapshot}=current(options,request.processId),stage=['initial','supplement'].find(value=>catalogueFrameWork(snapshot,basis,value)?.workId===request.workId);
    if(!stage)fail('The requested Work is not a frozen frame batch.');
    const batch=catalogueFrameBatch(basis,stage),work=catalogueFrameWork(snapshot,basis,stage);
    if(request.executionBasisDigest!==work.executionBasisDigest||request.workObjectiveTypeRef!==work.workObjectiveTypeRef||request.workObjectiveVersion!==1)
      fail('The requested Work objective or execution basis changed.');
    const parameters={analysisId:basis.analysisId,basisDigest:basis.basisDigest,stage,batchDigest:batch.batchDigest},
      owner=(portName,projectionRef)=>({portName,bindingKind:'projected_owner_facts',ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId,projectionRef,parameters}),
      node=(name,capabilityRef,bindings,dependsOn=[])=>{
        const manifest=options.registry.resolve(capabilityRef,'libra').manifest,policy=options.policyRegistry.bindingFor(capabilityRef,manifest.effectClass),
          eventId='libra-catalogue-'+name+'-event-'+canonicalDigest({attempt:request.workAttemptId,batchDigest:batch.batchDigest}).slice(0,40),
          demand={resourceKinds:capabilityRef===FRAME?['cpu','disk_io']:capabilityRef===EMBED?['compute_device','cpu','disk_io']:['compute_device','cpu']};
        return {nodeId:name,eventId,capabilityRef,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
          inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},
          parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},dependsOn,whenSchemaRef:null,when:null,effectClass:manifest.effectClass,
          resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},
          approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
          fenceBasis:{basisDigest:request.executionBasisDigest,inputSetDigest:canonicalDigest(bindings),
            eventFenceDigest:canonicalDigest({schema:'libra.catalogue-frame-event-fence@1',eventId,workId:work.workId,batchDigest:batch.batchDigest}),
            effectScopeDigest:canonicalDigest({schema:'libra.catalogue-frame-effect-scope@1',eventId,analysisId:basis.analysisId,batchDigest:batch.batchDigest,capabilityRef})},
          retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef};
      };
    const frames=node('frames',FRAME,[owner('physicalMaterialReadHandleOrWorkspaceMaterialHandle',PROJECTIONS.source),
      owner('samplingPlan',PROJECTIONS.sampling),owner('workspaceArtifactOutputTarget',PROJECTIONS.target)]),
      embeddings=node('embedding',EMBED,[{portName:'artifactHandleList',bindingKind:'projected_event_result',eventId:frames.eventId,
        resultSchemaRef:resultRef(FRAME),projectionRef:PROJECTIONS.frameList,parameters},owner('faceModelRef',PROJECTIONS.model)],
        [{eventId:frames.eventId,satisfaction:'success'}]),
      clusters=node('clustering',CLUSTER,[{portName:'faceEmbeddingSetHandle',bindingKind:'event_result',eventId:embeddings.eventId,
        resultSchemaRef:resultRef(EMBED)},owner('clusterParameters',PROJECTIONS.cluster)],[{eventId:embeddings.eventId,satisfaction:'success'}]);
    return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:'libra-catalogue-frame-plan-'+canonicalDigest({attempt:request.workAttemptId,batchDigest:batch.batchDigest}).slice(0,40),
      workAttemptId:request.workAttemptId,ownerDomain:'libra',plannerContractRef:this.plannerContractRef,plannerVersion:1,
      workObjectiveTypeRef:work.workObjectiveTypeRef,workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,
      capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,nodes:[frames,embeddings,clusters]};
  }});
}
function createUsAdultCatalogueFrameProjections(options){
  const projectors={source:({basis})=>basis.sourceHandle,sampling:({batch})=>batch.samplingPlan,
    target:({basis,batch})=>frameTarget(options,basis,{targetRelativePath:'analysis/catalogue/'+basis.analysisId+'/'+batch.stage+'-'+batch.batchDigest+'.json',samplingPlan:batch.samplingPlan}),
    model:({basis})=>basis.faceModelRef,cluster:({basis})=>basis.clusterParameters,
    frameList:({basis,batch,sourceResult})=>{
      if(sourceResult?.libraRunId!==basis.libraRunId||sourceResult.workspaceId!==basis.workspaceId||
        sourceResult.sourceMaterialDigest!==canonicalDigest(basis.sourceHandle)||sourceResult.samplingPlanDigest!==batch.samplingPlan.digest)
        fail('The frame Result is not the complete exact frozen batch.');
      return [sourceResult.frameSetArtifactHandle];
    }};
  return Object.freeze(Object.entries(projectors).map(([name,project])=>Object.freeze({projectionRef:PROJECTIONS[name],
    projection:Object.freeze({project(input){return project({...input,...projectionState(options,input)});}})})));
}
module.exports=Object.freeze({PROJECTIONS,createUsAdultCatalogueFramePlanner,createUsAdultCatalogueFrameProjections});
