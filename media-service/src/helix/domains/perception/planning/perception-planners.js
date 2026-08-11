'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');

const ACQUIRE='perception.source.acquire@1',NORMALIZE='perception.record.normalize@1',COMMIT='perception.record.commit@1',RESOLVE='perception.dedup.resolve@1',RESOLUTION_COMMIT='perception.resolution.commit@1';
const P=Object.freeze({source:'helix://perception/input-projections/SourceSnapshot/v1',integration:'helix://perception/input-projections/IntegrationHandle/v1',cursor:'helix://perception/input-projections/AcquisitionCursor/v1',
  directPage:'helix://perception/input-projections/DirectObservationPage/v1',observationResult:'helix://perception/input-projections/ObservationResult/v1',rule:'helix://perception/input-projections/NormalizationRule/v1',
  draftResult:'helix://perception/input-projections/CommitDraftResult/v1',recordHandle:'helix://perception/input-projections/RecordCommitHandle/v1',query:'helix://perception/input-projections/ResolutionQuery/v1',
  recordSet:'helix://perception/input-projections/ResolutionRecordSet/v1',resolutionRule:'helix://perception/input-projections/ResolutionRule/v1',resolutionDraft:'helix://perception/input-projections/ResolutionDraftResult/v1',resolutionHandle:'helix://perception/input-projections/ResolutionCommitHandle/v1'});
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function owner(portName,request,projectionRef,parameters={}){return Object.freeze({portName,bindingKind:'projected_owner_facts',ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,projectionRef,parameters:Object.freeze(parameters)});}
function projected(portName,eventId,resultSchemaRef,projectionRef,parameters={}){return Object.freeze({portName,bindingKind:'projected_event_result',eventId,resultSchemaRef,projectionRef,parameters:Object.freeze(parameters)});}
function bindings(values){return Object.freeze({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:Object.freeze(values)});}
function demand(resourceKinds){const body={resourceKinds:Object.freeze(resourceKinds)};return Object.freeze({...body,demandDigest:canonicalDigest(body)});}
function node(options,ref,nodeId,eventId,inputBindings,dependsOn,resourceKinds){const manifest=options.registry.resolve(ref,'perception').manifest,policy=options.policyRegistry.bindingFor(ref,manifest.effectClass);
  const fence={basisDigest:options.request.executionBasisDigest,inputSetDigest:canonicalDigest(inputBindings),eventFenceDigest:canonicalDigest({schema:'perception.event-fence@1',eventId,workId:options.request.workId}),effectScopeDigest:canonicalDigest({schema:'perception.event-scope@1',eventId,processId:options.request.processId})};
  return Object.freeze({nodeId,eventId,capabilityRef:ref,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),inputBindings:bindings(inputBindings),
    parametersSchemaRef:manifest.parametersSchemaRef,parameters:Object.freeze({}),dependsOn:Object.freeze(dependsOn),whenSchemaRef:null,when:null,effectClass:manifest.effectClass,
    resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:demand(resourceKinds),approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
    fenceBasis:Object.freeze(fence),retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});}
function plan(options,kind,nodes){const r=options.request;return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:stable('perception-plan-',{attempt:r.workAttemptId}),
  workAttemptId:r.workAttemptId,ownerDomain:'perception',plannerContractRef:options.plannerContractRef,plannerVersion:1,workObjectiveTypeRef:'helix://perception/work/'+kind+'/v1',workObjectiveVersion:1,
  executionBasisDigest:r.executionBasisDigest,capabilityCatalogDigest:options.catalogDigest,resolution:'planned',diagnosticClassification:null,nodes:Object.freeze(nodes)});}

function createAcquisitionPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);return Object.freeze({plannerContractRef:'helix://perception/planners/AcquisitionPage/v1',plannerVersion:1,plan(request){
  const context=options.processServices.acquisitionContext(request.processId);if(!context)throw new Error('Perception Acquisition context is absent.');const suffix=canonicalDigest(request.workAttemptId).slice(0,20),
    acquireId='perception-acquire-'+suffix,normalizeId='perception-normalize-'+suffix,commitId='perception-record-commit-'+suffix,common={...options,request};let pageBinding,dependencies=[],nodes=[];
  if(context.scope.mode==='provider'){nodes.push(node(common,ACQUIRE,'acquire',acquireId,[owner('perceptionSourceSnapshot',request,P.source),owner('integrationHandle',request,P.integration),owner('perceptionAcquisitionCursor',request,P.cursor)],[],['network']));
    pageBinding=projected('perceptionObservationPage',acquireId,options.registry.resolve(ACQUIRE,'perception').manifest.resultSchemaRef,P.observationResult);dependencies=[{eventId:acquireId,satisfaction:'success'}];}
  else pageBinding=owner('perceptionObservationPage',request,P.directPage);
  nodes.push(node(common,NORMALIZE,'normalize',normalizeId,[pageBinding,owner('perceptionNormalizationRuleRef',request,P.rule)],dependencies,['cpu']));
  nodes.push(node(common,COMMIT,'commit',commitId,[projected('perceptionAcquisitionCommitDraft',normalizeId,options.registry.resolve(NORMALIZE,'perception').manifest.resultSchemaRef,P.draftResult),projected('domainFactCommitHandle',normalizeId,options.registry.resolve(NORMALIZE,'perception').manifest.resultSchemaRef,P.recordHandle,{processId:request.processId,commitEventId:commitId})],[{eventId:normalizeId,satisfaction:'success'}],['cpu']));
  return plan({request,plannerContractRef:this.plannerContractRef,catalogDigest},'AcquisitionPage',nodes);}});}
function createResolutionPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);return Object.freeze({plannerContractRef:'helix://perception/planners/Resolution/v1',plannerVersion:1,plan(request){
  const suffix=canonicalDigest(request.workAttemptId).slice(0,20),resolveId='perception-resolve-'+suffix,commitId='perception-resolution-commit-'+suffix,common={...options,request};
  return plan({request,plannerContractRef:this.plannerContractRef,catalogDigest},'Resolution',[
    node(common,RESOLVE,'resolve',resolveId,[owner('perceptionResolutionQuery',request,P.query),owner('perceptionResolutionRecordSet',request,P.recordSet),owner('perceptionResolutionRuleSnapshot',request,P.resolutionRule)],[],['cpu']),
    node(common,RESOLUTION_COMMIT,'commit',commitId,[projected('perceptionResolutionDraft',resolveId,options.registry.resolve(RESOLVE,'perception').manifest.resultSchemaRef,P.resolutionDraft),projected('domainFactCommitHandle',resolveId,options.registry.resolve(RESOLVE,'perception').manifest.resultSchemaRef,P.resolutionHandle,{processId:request.processId,commitEventId:commitId})],[{eventId:resolveId,satisfaction:'success'}],['cpu'])]);}});}

function sourceSnapshot(context){const body={sourceId:context.source.perceptionSourceId,sourceKind:context.source.sourceKind,integrationId:context.source.integrationId,sourceConfigRevision:context.source.configRevision,sourceScopeDigest:context.acquisition.scopeDigest};
  return Object.freeze({schemaRef:'helix://contracts/domain-types/PerceptionSourceSnapshot/v1',schemaVersion:1,objectId:body.sourceId,revision:body.sourceConfigRevision,digest:canonicalDigest(body),...body});}
function cursor(context){const body={perceptionAcquisitionId:context.acquisition.perceptionAcquisitionId,pageOrdinal:context.pageOrdinal,expectedCursorRevision:context.expectedCursorRevision,cursorIn:context.cursorIn,pageBudget:20};
  return Object.freeze({schemaRef:'helix://contracts/domain-types/PerceptionAcquisitionCursor/v1',schemaVersion:1,objectId:'cursor:'+body.perceptionAcquisitionId+':'+body.pageOrdinal,revision:context.expectedCursorRevision+1,digest:canonicalDigest(body),...body});}
function rule(context){const body={ruleRef:context.scope.mode==='direct'?'shelfdeck-direct-normalize':'douban-normalize',ruleVersion:'1',sourceKind:context.source.sourceKind,canonicalRatingScale:'integer_1_5',ruleDigest:canonicalDigest({sourceKind:context.source.sourceKind,version:1})};
  return Object.freeze({schemaRef:'helix://contracts/domain-types/PerceptionNormalizationRuleRef/v1',schemaVersion:1,objectId:body.ruleRef,revision:1,digest:canonicalDigest(body),...body});}
function directPage(context){const input=context.scope.directInput,entries=[['targetType',input.targetType],['targetId',input.targetId],['title',input.title],['year',input.year],['providerIdentity',input.providerIdentity],['rating',input.rating],['watched',input.watched],
    ['supersedesSourceRecordKey',input.supersedes?.sourceRecordKey||null],['supersedesSourceRecordRevision',input.supersedes?.sourceRecordRevision||null],['supersedesSourceRecordDigest',input.supersedes?.sourceRecordDigest||null]].map(([key,value])=>({key,value}));
  const payloadBody={schemaRef:'helix://contracts/types/ShelfDeckDirectRatingObservation/v1',schemaVersion:1,recordKind:'perception-observation-inline-payload',entries},inlinePayload={...payloadBody,recordDigest:canonicalDigest(payloadBody)};
  const observation={observationId:stable('perception-direct-observation-',{acquisitionId:context.acquisition.perceptionAcquisitionId}),sourceRecordKey:input.sourceRecordKey,sourceRecordRevision:input.sourceRecordRevision,
    sourceRecordDigest:input.sourceRecordDigest,observedAtMs:context.acquisition.createdAtMs,payloadSchemaRef:inlinePayload.schemaRef,payloadDigest:canonicalDigest(inlinePayload),inlinePayload,
    provenanceDigest:canonicalDigest({mode:'direct',targetDigest:context.scope.target.targetDigest,idempotencyKey:context.scope.idempotencyKey})};
  const cursorOut='terminal:'+canonicalDigest(observation),body={perceptionAcquisitionId:context.acquisition.perceptionAcquisitionId,pageOrdinal:context.pageOrdinal,
    source:{sourceId:context.source.perceptionSourceId,sourceKind:context.source.sourceKind,sourceConfigRevision:context.source.configRevision},cursor:{expectedCursorRevision:context.expectedCursorRevision,cursorIn:context.cursorIn,cursorOut},observations:[observation],hasMore:false},digest=canonicalDigest(body);
  return Object.freeze({schemaRef:'helix://contracts/types/PerceptionObservationPage/v1',schemaVersion:1,evidenceId:stable('perception-direct-page-',{acquisitionId:context.acquisition.perceptionAcquisitionId}),evidenceKind:'perception_observation_page',producerRef:'shelfdeck.direct.rating@1',basisDigest:context.acquisition.scopeDigest,payloadDigest:digest,observedAtMs:observation.observedAtMs,...body,observationPageDigest:digest});}
function createPerceptionProjections(options){function acquisition(ownerScope){const c=options.processServices.acquisitionContext(ownerScope.processId);if(!c)throw new Error('Perception Acquisition context is absent.');return c;}
  function resolution(ownerScope){return options.processServices.resolutionContext(...ownerScope.processId.split(/:(.*)/s).slice(0,2));}
  return Object.freeze([
    {projectionRef:P.source,projection:{project:({ownerScope})=>sourceSnapshot(acquisition(ownerScope))}},
    {projectionRef:P.integration,projection:{project:({ownerScope})=>{const c=acquisition(ownerScope),handle=options.resolvePerceptionIntegrationHandle(c.source);if(!handle)throw new Error('Perception integration is unavailable.');return handle;}}},
    {projectionRef:P.cursor,projection:{project:({ownerScope})=>cursor(acquisition(ownerScope))}},
    {projectionRef:P.directPage,projection:{project:({ownerScope})=>directPage(acquisition(ownerScope))}},
    {projectionRef:P.observationResult,projection:{project:({sourceResult})=>sourceResult}},
    {projectionRef:P.rule,projection:{project:({ownerScope})=>rule(acquisition(ownerScope))}},
    {projectionRef:P.draftResult,projection:{project:({sourceResult})=>sourceResult}},
    {projectionRef:P.recordHandle,projection:{project:({sourceResult,parameters})=>{const c=options.processServices.acquisitionContext(parameters.processId);if(!c)throw new Error('Perception Acquisition context is absent.');
      return Object.freeze({schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:stable('perception-record-handle-',{acquisitionId:c.acquisition.perceptionAcquisitionId,pageOrdinal:c.pageOrdinal}),ownerDomain:'perception',aggregateType:'perception-acquisition',aggregateId:c.acquisition.perceptionAcquisitionId,
        factType:'PerceptionAcquisitionCommitDraft',factSchemaRef:'helix://contracts/types/PerceptionAcquisitionCommitDraft/v1',expectedRevision:c.expectedCursorRevision,payloadDigest:canonicalDigest(sourceResult),
        resultSchemaRef:'helix://contracts/types/PerceptionRecordCommitResult/v1',commitIdempotencyKey:stable('perception-record-marker-',{acquisitionId:c.acquisition.perceptionAcquisitionId,pageOrdinal:c.pageOrdinal}),eventFenceDigest:canonicalDigest({schema:'perception.record-commit-fence@1',acquisitionId:c.acquisition.perceptionAcquisitionId,pageOrdinal:c.pageOrdinal,eventId:parameters.commitEventId})});}}},
    {projectionRef:P.query,projection:{project:({ownerScope})=>resolution(ownerScope).query}},
    {projectionRef:P.recordSet,projection:{project:({ownerScope})=>resolution(ownerScope).recordSet}},
    {projectionRef:P.resolutionRule,projection:{project:({ownerScope})=>resolution(ownerScope).ruleSnapshot}},
    {projectionRef:P.resolutionDraft,projection:{project:({sourceResult})=>sourceResult}},
    {projectionRef:P.resolutionHandle,projection:{project:({sourceResult,parameters})=>{const parts=parameters.processId.split(/:(.*)/s).slice(0,2),c=options.processServices.resolutionContext(...parts),current=options.processServices.store.getResolution(c.query.queryContract,c.query.queryInputDigest),expectedRevision=current?.revision||0,aggregateId='perception-resolution:'+canonicalDigest({queryContract:c.query.queryContract,queryInputDigest:c.query.queryInputDigest});
      return Object.freeze({schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:stable('perception-resolution-handle-',{aggregateId,expectedRevision,recordSetDigest:c.recordSet.recordSetDigest}),ownerDomain:'perception',aggregateType:'perception-resolution',aggregateId,
        factType:'PerceptionResolutionDraft',factSchemaRef:'helix://contracts/types/PerceptionResolutionDraft/v1',expectedRevision,payloadDigest:canonicalDigest(sourceResult),
        resultSchemaRef:'helix://contracts/types/PerceptionResolutionRevision/v1',commitIdempotencyKey:stable('perception-resolution-marker-',{aggregateId,expectedRevision,recordSetDigest:c.recordSet.recordSetDigest}),eventFenceDigest:canonicalDigest({schema:'perception.resolution-commit-fence@1',aggregateId,expectedRevision,eventId:parameters.commitEventId})});}}},
  ].map(Object.freeze));}

function createPerceptionPlanners(options){return Object.freeze([createAcquisitionPlanner(options),createResolutionPlanner(options)]);}
module.exports=Object.freeze({createPerceptionPlanners,createPerceptionProjections});
