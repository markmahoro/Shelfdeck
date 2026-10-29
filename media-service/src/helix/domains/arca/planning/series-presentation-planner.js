'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {CAPS}=require('../model/series-presentation');
const PLANNER='helix://arca/planners/series-presentation/v1',OBJECTIVE='helix://arca/work/series_presentation/v1';
const SCOPE='helix://arca/series-presentation-projections/Scope/v1',RESULT='helix://arca/series-presentation-projections/Result/v1';
function createSeriesPresentationPlanner(options,reclaim=false){
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  const plannerRef=reclaim?PLANNER.replace('/series-presentation/','/series-presentation-reclaim/'):PLANNER,objective=reclaim?OBJECTIVE.replace('/series_presentation/','/series_presentation_reclaim/'):OBJECTIVE;
  return {plannerContractRef:plannerRef,plannerVersion:1,plan(request){
    const scope=options.series.seriesStore.build(request.processId),base={schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:'arca-series-plan-'+canonicalDigest(request.workAttemptId).slice(0,40),workAttemptId:request.workAttemptId,ownerDomain:'arca',
      plannerContractRef:plannerRef,plannerVersion:1,workObjectiveTypeRef:objective,workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest};
    if(request.processType!=='arca_series_presentation'||scope?.digest!==request.executionBasisDigest)
      return {...base,resolution:'contract_unplannable',diagnosticClassification:'ARCA_SERIES_SCOPE_STALE',nodes:[]};
    const stages=reclaim?[['reclaim',null]]:[['source',null],['assets','SourceObserved'],['publish','AssetsPrepared'],['commit','FilesPublished']],nodes=[];
    for(const [stage,input] of stages){
      const ref=CAPS[stage],manifest=options.registry.resolve(ref,'arca').manifest,policy=options.policyRegistry.bindingFor(ref,manifest.effectClass),
        eventId='series-'+stage+'-'+canonicalDigest(request.workAttemptId).slice(0,24),bindings=[{portName:'seriesPresentationScope',bindingKind:'projected_owner_facts',
          ownerDomain:'arca',processType:request.processType,processId:request.processId,projectionRef:SCOPE,parameters:{expectedScopeDigest:scope.digest}}];
      if(reclaim)for(const name of ['ReclamationBasis'])bindings.push({portName:'seriesPresentation'+name,bindingKind:'projected_owner_facts',
        ownerDomain:'arca',processType:request.processType,processId:request.processId,projectionRef:RESULT+'/'+name,parameters:{expectedScopeDigest:scope.digest}});
      if(input){const prior=nodes.at(-1);bindings.push({portName:'seriesPresentation'+input,bindingKind:'projected_event_result',eventId:prior.eventId,
        resultSchemaRef:prior.outputContractRef,projectionRef:RESULT,parameters:{expectedScopeDigest:scope.digest}});}
      const demand={resourceKinds:stage==='reclaim'?['cpu','disk_io']:stage==='commit'?['cpu']:stage==='publish'?['disk_io']:stage==='assets'?['cpu','disk_io','network']:['cpu','network']};
      nodes.push({nodeId:eventId,eventId,capabilityRef:ref,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn:input?[{eventId:nodes.at(-1).eventId,satisfaction:'success'}]:[],whenSchemaRef:null,when:null,effectClass:manifest.effectClass,
        resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},approvalRequirementRef:null,authorizationRequirementRef:null,
        fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:{basisDigest:scope.digest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({eventId,workId:request.workId}),effectScopeDigest:canonicalDigest({eventId,scopeId:scope.scopeId,buildId:scope.objectId})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});
    }
    return {...base,resolution:'planned',diagnosticClassification:null,nodes};
  }};
}
function createSeriesPresentationProjections(options){
  function scopeFor(input){const owner=input.ownerScope,scope=options.series.seriesStore.build(owner.processId);
    if(owner.ownerDomain!=='arca'||owner.processType!=='arca_series_presentation'||scope?.digest!==input.parameters?.expectedScopeDigest)
      throw Object.assign(new Error('Shared presentation projection changed.'),{code:'ARCA_SERIES_SCOPE_STALE'});return scope;}
  return [{projectionRef:RESULT+'/ReclamationBasis',projection:{project:input=>options.series.reclamationBasis(scopeFor(input))}},...['AssetsPrepared','Ready'].map(name=>({projectionRef:RESULT+'/'+name,projection:{project(input){const scope=scopeFor(input),
    refs=options.series.readReferences(scope).filter(row=>row.result.schemaRef==='helix://contracts/types/SeriesPresentation'+name+'/v1');
    if(refs.length!==1)throw new Error('Reclamation requires one exact successful build result.');return refs[0].result;}}})),{projectionRef:SCOPE,projection:{project:scopeFor}},{projectionRef:RESULT,projection:{project(input){const scope=scopeFor(input),value=input.sourceResult;
    if(value?.scopeDigest!==scope.digest||value.buildId!==scope.objectId)throw new Error('Shared result belongs to another build.');
    options.contractValidator.validate(value.schemaRef,value);return value;}}}];
}
module.exports=Object.freeze({PLANNER,OBJECTIVE,createSeriesPresentationReclaimPlanner:options=>createSeriesPresentationPlanner(options,true),createSeriesPresentationPlanner,createSeriesPresentationProjections});
