'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {REQUEST,OBSERVE,NORMALIZE,readActorContext,productWork,frameInputs,analysisSpec,analysisTarget,analysisVariant}=require('../model/us-adult-product-work');
const {exactResult,resultRef}=require('../model/us-adult-analysis-work');
const literal=(portName,value)=>Object.freeze({portName,bindingKind:'literal',value});
function createUsAdultProductPlanner(options){
  const capabilityCatalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/UsAdultProduct/v1',plannerVersion:1,plan(request){
    const context=readActorContext(options,request.processId),stage=request.workId===productWork(context,'analysis').workId?'analysis':'normalize',
      work=productWork(context,stage);
    if(request.workId!==work.workId||request.executionBasisDigest!==work.executionBasisDigest)throw new Error('US Adult product planning actor or Run Basis changed.');
    const node=(name,capabilityRef,bindings,dependsOn=[])=>{
      const manifest=options.registry.resolve(capabilityRef,'libra').manifest,policy=options.policyRegistry.bindingFor(capabilityRef,manifest.effectClass),
        eventId='libra-us-adult-'+name+'-event-'+canonicalDigest({attempt:request.workAttemptId}),
        resourceKinds=capabilityRef===NORMALIZE?['compute_device','cpu']:['compute_device','cpu','disk_io'],demand={resourceKinds};
      return Object.freeze({nodeId:name,eventId,capabilityRef,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},
        parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},dependsOn,whenSchemaRef:null,when:null,effectClass:manifest.effectClass,
        resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},
        approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
        fenceBasis:{basisDigest:request.executionBasisDigest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({schema:'libra.us-adult-product-event-fence@1',eventId,workId:request.workId}),
          effectScopeDigest:canonicalDigest({schema:'libra.us-adult-product-event-scope@1',eventId,selectionDigest:context.selection.selectionDigest})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});
    };
    let nodes;
    if(stage==='analysis'){
      const frames=frameInputs(options,context),inputs={...frames,analysisSpec:analysisSpec(context,frames)},
        target=analysisTarget(context,inputs,options.movieProductionReader.readWorkspace(context.basis.workspaceId),options.workspaceProductPort.rootSnapshot()),
        common=Object.entries(inputs).map(([name,value])=>literal(name,value)),
        requested=node('analysis_request',REQUEST,[...common,literal('workspaceArtifactOutputTarget',target)]),
        observed=node('analysis_observe',OBSERVE,[...common,{portName:'artifactHandle',bindingKind:'event_result',eventId:requested.eventId,
          resultSchemaRef:resultRef(REQUEST)}],[{eventId:requested.eventId,satisfaction:'success'}]);
      nodes=[requested,observed];
    }else{
      const record=exactResult(options,productWork(context,'analysis'),OBSERVE),variant=analysisVariant(context,record);
      nodes=[node('metadata_normalize',NORMALIZE,[literal('westernAnalysisVariant',variant)])];
    }
    return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:'libra-us-adult-product-plan-'+canonicalDigest({attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,
      ownerDomain:'libra',plannerContractRef:this.plannerContractRef,plannerVersion:1,workObjectiveTypeRef:work.workObjectiveTypeRef,
      workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest,resolution:'planned',diagnosticClassification:null,nodes:Object.freeze(nodes)});
  }});
}
module.exports=Object.freeze({createUsAdultProductPlanner});
