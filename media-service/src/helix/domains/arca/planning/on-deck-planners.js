'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { CAPABILITY_REFS:C } = require('../model/on-deck-contract');
const { requiresInputSettlement } = require('../model/offload-settlement');
// Resource demand is part of each exact Capability contract. A Planner may
// choose when to issue a Capability, but it may not weaken or improvise the
// resources declared by that Capability's manifest.
const R = Object.freeze({
  [C.identity]:Object.freeze(['cpu']),
  [C.metadata]:Object.freeze(['cpu','disk_io']),
  [C.structure]:Object.freeze(['cpu']),
  [C.mandatory]:Object.freeze(['cpu','disk_io']),
  [C.space]:Object.freeze(['cpu']),
  [C.feasibility]:Object.freeze(['disk_io']),
  [C.accept]:Object.freeze(['cpu']),
  [C.reject]:Object.freeze(['cpu']),
  [C.slot]:Object.freeze(['disk_io']),
  [C.stage]:Object.freeze(['disk_io']),
  [C.stagedVerify]:Object.freeze(['cpu','disk_io']),
  [C.finalVerify]:Object.freeze(['cpu','disk_io']),
  [C.placement]:Object.freeze(['disk_io']),
  [C.settlement]:Object.freeze(['disk_io']),
  [C.fulfillment]:Object.freeze(['cpu','disk_io']),
  [C.commit]:Object.freeze(['cpu']),
});
const P = Object.freeze({
  packageIdentity:'helix://arca/input-projections/PackageIdentity/v1', shelfStandard:'helix://arca/input-projections/ShelfStandard/v1',
  productMetadata:'helix://arca/input-projections/ProductMetadataArtifact/v1', metadataRequirement:'helix://arca/input-projections/MetadataRequirement/v1',
  productManifest:'helix://arca/input-projections/ProductManifest/v1', structureRequirement:'helix://arca/input-projections/StructureRequirement/v1',
  productMedia:'helix://arca/input-projections/ProductMediaEvidence/v1', mandatoryRequirement:'helix://arca/input-projections/MandatoryRequirement/v1',
  spaceRequirement:'helix://arca/input-projections/SpaceRequirement/v1', offload:'helix://arca/input-projections/OffLoadContext/v1',
  placementPolicy:'helix://arca/input-projections/PlacementPolicy/v1', targetEndpoint:'helix://arca/input-projections/TargetEndpoint/v1',
  acceptedPayload:'helix://arca/input-projections/AcceptedPayload/v1', acceptanceControl:'helix://arca/input-projections/AcceptanceControlHandle/v1',
  rejectionDecision:'helix://arca/input-projections/AcceptanceRejectionDecision/v1', rejectionCommit:'helix://arca/input-projections/RejectionCommitHandle/v1',
  finalDecision:'helix://arca/input-projections/FinalInventoryDecision/v1', targetHandle:'helix://arca/input-projections/TargetCommitSlotHandle/v1',
  productHandles:'helix://arca/input-projections/ProductMaterialHandles/v1', finalBindings:'helix://arca/input-projections/FinalBindings/v1',
  disposition:'helix://arca/input-projections/ProductDispositionManifest/v1', targetBindings:'helix://arca/input-projections/TargetBindings/v1',
  settlementHandles:'helix://arca/input-projections/SettlementHandles/v1', settlementApproval:'helix://arca/input-projections/SettlementApproval/v1',
  finalReality:'helix://arca/input-projections/FinalReality/v1', onDeckControl:'helix://arca/input-projections/OnDeckControlHandle/v1',
});

function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function owner(port,request,projectionRef,parameters={}){return Object.freeze({portName:port,bindingKind:'projected_owner_facts',
  ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,projectionRef,
  parameters:Object.freeze({dependencyRefs:request.dependencyRefs||[],...parameters})});}
function projected(port,eventId,resultSchemaRef,projectionRef,request,parameters={}){return Object.freeze({portName:port,bindingKind:'projected_event_result',
  eventId,resultSchemaRef,projectionRef,parameters:Object.freeze({dependencyRefs:request.dependencyRefs||[],...parameters})});}
function bindingSet(bindings){return Object.freeze({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:Object.freeze(bindings)});}
function demand(kinds){const value={resourceKinds:Object.freeze(kinds)};return Object.freeze({...value,demandDigest:canonicalDigest(value)});}
function node(options,capabilityRef,nodeId,eventId,bindings,dependsOn){const manifest=options.registry.resolve(capabilityRef,'arca').manifest,
  policy=options.policyRegistry.bindingFor(capabilityRef,manifest.effectClass),fence={basisDigest:options.request.executionBasisDigest,
    inputSetDigest:canonicalDigest(bindings),eventFenceDigest:canonicalDigest({schema:'arca.event-fence@1',eventId,workId:options.request.workId}),
    effectScopeDigest:canonicalDigest({schema:'arca.event-scope@1',eventId,processId:options.request.processId})};
  return Object.freeze({nodeId,eventId,capabilityRef,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
    inputBindings:bindingSet(bindings),parametersSchemaRef:manifest.parametersSchemaRef,parameters:Object.freeze({}),dependsOn:Object.freeze(dependsOn),
    whenSchemaRef:null,when:null,effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
    resourceDemand:demand(R[capabilityRef]||(()=>{throw new Error('Arca Planner lacks an exact Resource Demand for '+capabilityRef);})()),
    approvalRequirementRef:manifest.approvalRequirementRef||null,
    authorizationRequirementRef:manifest.authorizationRequirementRef||null,fenceSchemaRef:manifest.fenceSchemaRef,
    fenceBasis:Object.freeze(fence),retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,
    outputContractRef:manifest.resultSchemaRef});}
function plan(request,plannerContractRef,catalogDigest,kind,nodes){return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',
  schemaVersion:1,planId:stable('arca-plan-',{attempt:request.workAttemptId,kind}),workAttemptId:request.workAttemptId,ownerDomain:'arca',
  plannerContractRef,plannerVersion:1,workObjectiveTypeRef:'helix://arca/work/'+kind+'/v1',workObjectiveVersion:1,
  executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,
  nodes:Object.freeze(nodes)});}
function resultSchema(options,ref){return options.registry.resolve(ref,'arca').manifest.resultSchemaRef;}

function createAcceptanceAssessmentPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry),
  plannerContractRef='helix://arca/planners/AcceptanceAssessment/v1';return Object.freeze({plannerContractRef,plannerVersion:1,plan(request){
    const s=canonicalDigest(request.workAttemptId).slice(0,18),o={...options,request};
    const specs=[
      [C.identity,'identity','accept-identity-'+s,[owner('packageIdentity',request,P.packageIdentity),owner('shelfStandard',request,P.shelfStandard)]],
      [C.metadata,'metadata','accept-metadata-'+s,[owner('productMetadataArtifact',request,P.productMetadata),owner('metadataRequirement',request,P.metadataRequirement)]],
      [C.structure,'structure','accept-structure-'+s,[owner('productManifest',request,P.productManifest),owner('structureRequirement',request,P.structureRequirement)]],
      [C.mandatory,'mandatory_media','accept-media-'+s,[owner('onDeckProductPackage',request,P.productMedia),owner('mandatoryRequirement',request,P.mandatoryRequirement)]],
      [C.space,'space','accept-space-'+s,[owner('productManifest',request,P.productManifest),owner('spaceRequirement',request,P.spaceRequirement)]],
      [C.feasibility,'inventory_feasibility','accept-feasibility-'+s,[owner('offLoadContext',request,P.offload),owner('placementPolicy',request,P.placementPolicy),owner('targetEndpoint',request,P.targetEndpoint)]],
    ];return plan(request,plannerContractRef,catalogDigest,'acceptance_assessment',specs.map(x=>node(o,x[0],x[1],x[2],x[3],[],['cpu'])));}});}

function createAcceptanceCommitPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry),
  plannerContractRef='helix://arca/planners/AcceptanceCommit/v1';return Object.freeze({plannerContractRef,plannerVersion:1,plan(request){
    const eventId='accept-commit-'+canonicalDigest(request.workAttemptId).slice(0,18),o={...options,request};return plan(request,plannerContractRef,catalogDigest,
      'acceptance_commit',[node(o,C.accept,'acceptance_commit',eventId,[owner('acceptedPayload',request,P.acceptedPayload,{eventId}),
        owner('responsibilityControlCommitHandle',request,P.acceptanceControl,{eventId})],[],['sqlite_write'])]);}});}

function createAcceptanceRejectionPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry),
  plannerContractRef='helix://arca/planners/AcceptanceRejection/v1';return Object.freeze({plannerContractRef,plannerVersion:1,plan(request){
    const eventId='accept-reject-'+canonicalDigest(request.workAttemptId).slice(0,18),o={...options,request};return plan(request,plannerContractRef,catalogDigest,
      'acceptance_rejection',[node(o,C.reject,'acceptance_rejection',eventId,[owner('arcaAcceptanceRejectionDecision',request,P.rejectionDecision,{eventId}),
        owner('domainFactCommitHandle',request,P.rejectionCommit,{eventId})],[],['sqlite_write'])]);}});}

function createOnDeckExecutionPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry),
  plannerContractRef='helix://arca/planners/OnDeckExecution/v1';return Object.freeze({plannerContractRef,plannerVersion:1,plan(request){
    const context=options.contextReader.readAccepted(request.processId,request.dependencyRefs||[]);
    const settlementMembers=(context.packageValue.offloadContextManifest?.members||[]).filter(requiresInputSettlement)
      .sort((left,right)=>Buffer.compare(Buffer.from(left.materialKey),Buffer.from(right.materialKey)));
    const s=canonicalDigest(request.workAttemptId).slice(0,18),o={...options,request},ids={slot:'ondeck-slot-'+s,stage:'ondeck-stage-'+s,
      staged:'ondeck-staged-verify-'+s,final:'ondeck-final-verify-'+s,placement:'ondeck-placement-'+s,
      fulfillment:'ondeck-fulfillment-'+s,commit:'ondeck-commit-'+s};
    const rs=(ref)=>resultSchema(options,ref),dep=(id)=>[{eventId:id,satisfaction:'success'}];
    const nodes=[
      node(o,C.slot,'target_slot',ids.slot,[owner('finalInventoryDecision',request,P.finalDecision),owner('targetHandle',request,P.targetHandle)],[],['disk_io']),
      node(o,C.stage,'product_stage',ids.stage,[owner('productMaterialHandleList',request,P.productHandles),
        projected('targetCommitSlotHandle',ids.slot,rs(C.slot),P.targetHandle,request)],dep(ids.slot),['disk_io']),
      node(o,C.stagedVerify,'staged_verify',ids.staged,[projected('stagedManifest',ids.stage,rs(C.stage),P.productManifest,request),
        owner('finalInventoryDecision',request,P.finalDecision)],dep(ids.stage),['disk_io']),
      node(o,C.finalVerify,'final_product_verify',ids.final,[projected('finalBindings',ids.stage,rs(C.stage),P.finalBindings,request),
        owner('productDispositionManifest',request,P.disposition)],[...dep(ids.stage),...dep(ids.staged)],['disk_io']),
      node(o,C.placement,'placement_switch',ids.placement,[projected('verifiedStagedManifest',ids.staged,rs(C.stagedVerify),P.productManifest,request),
        projected('targetBindings',ids.stage,rs(C.stage),P.targetBindings,request)],[...dep(ids.stage),...dep(ids.staged),...dep(ids.final)],['disk_io']),
      ...settlementMembers.map((member,index)=>{const eventId='ondeck-settlement-'+s+'-'+String(index).padStart(4,'0');
        return node(o,C.settlement,'input_settlement_'+String(index).padStart(4,'0'),eventId,
          [owner('oldPrimaryStructuralExclusiveRelatedHandleList',request,P.settlementHandles,{materialKey:member.materialKey}),
            owner('inputSettlementApproval',request,P.settlementApproval,{eventId,materialKey:member.materialKey})],dep(ids.placement),['disk_io']);}),
      node(o,C.fulfillment,'fulfillment_verify',ids.fulfillment,[owner('finalReality',request,P.finalReality),
        owner('finalInventoryDecision',request,P.finalDecision),owner('shelfStandard',request,P.shelfStandard)],
        settlementMembers.length?settlementMembers.map((_member,index)=>({eventId:'ondeck-settlement-'+s+'-'+String(index).padStart(4,'0'),satisfaction:'success'})):
          dep(ids.placement),['disk_io']),
      node(o,C.commit,'on_deck_commit',ids.commit,[projected('fulfillmentResult',ids.fulfillment,rs(C.fulfillment),P.finalReality,request),
        owner('responsibilityControlCommitHandle',request,P.onDeckControl,{eventId:ids.commit})],dep(ids.fulfillment),['sqlite_write']),
    ];return plan(request,plannerContractRef,catalogDigest,'on_deck_execution',nodes);}});}

module.exports=Object.freeze({C,P,createAcceptanceAssessmentPlanner,createAcceptanceCommitPlanner,createAcceptanceRejectionPlanner,createOnDeckExecutionPlanner});
