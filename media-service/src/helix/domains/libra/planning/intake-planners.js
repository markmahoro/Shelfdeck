'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { buildAcceptedIntakePayload } = require('../model/intake-acceptance-contracts');
const { buildIntakeRejectionDecision } = require('../model/intake-rejection-contracts');

const CANDIDATE='libra.intake.candidate.verify@1', MATERIAL='libra.intake.material.verify@1',
  BINDING='libra.intake.binding.resolve@1', ACCEPT='libra.intake.accept.commit@1', REJECT='libra.intake.rejection.commit@1';
const SNAPSHOT='helix://libra/input-projections/IntakeCandidateDeliverySnapshot/v1';
const HANDLES='helix://libra/input-projections/IntakePhysicalReadHandles/v1';
const DECISION='helix://libra/input-projections/SubjectContinuityResolutionDecision/v1';
const PAYLOAD='helix://libra/input-projections/AcceptedIntakePayload/v1';
const CONTROL='helix://libra/input-projections/IntakeResponsibilityControlCommitHandle/v1';
const REJECTION='helix://libra/input-projections/IntakeRejectionDecision/v1';
const REJECTION_HANDLE='helix://libra/input-projections/IntakeRejectionCommitHandle/v1';
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function owner(port,request,projectionRef,parameters={}){return Object.freeze({portName:port,bindingKind:'projected_owner_facts',
  ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,projectionRef,parameters:Object.freeze(parameters)});}
function projected(port,eventId,resultSchemaRef,projectionRef,parameters={}){return Object.freeze({portName:port,bindingKind:'projected_event_result',
  eventId,resultSchemaRef,projectionRef,parameters:Object.freeze(parameters)});}
function set(bindings){return Object.freeze({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:Object.freeze(bindings)});}
function demand(kinds){const value={resourceKinds:Object.freeze(kinds)};return Object.freeze({...value,demandDigest:canonicalDigest(value)});}
function node(options,ref,name,eventId,bindings,dependencies,kinds){const manifest=options.registry.resolve(ref,'libra').manifest;
  const policy=options.policyRegistry.bindingFor(ref,manifest.effectClass);const fence={basisDigest:options.request.executionBasisDigest,
    inputSetDigest:canonicalDigest(bindings),eventFenceDigest:canonicalDigest({schema:'libra.intake-event-fence@1',eventId,workId:options.request.workId}),
    effectScopeDigest:canonicalDigest({schema:'libra.intake-event-scope@1',eventId,intakeDecisionId:options.request.processId})};
  return Object.freeze({nodeId:name,eventId,capabilityRef:ref,contractVersion:1,
    inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),inputBindings:set(bindings),
    parametersSchemaRef:manifest.parametersSchemaRef,parameters:Object.freeze({}),dependsOn:Object.freeze(dependencies),whenSchemaRef:null,when:null,
    effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:demand(kinds),
    approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:Object.freeze(fence),
    retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});}
function plan(options,kind,nodes){const request=options.request;return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
  planId:stable('libra-intake-plan-',{attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,ownerDomain:'libra',
  plannerContractRef:options.plannerContractRef,plannerVersion:1,workObjectiveTypeRef:'helix://libra/work/'+kind+'/v1',workObjectiveVersion:1,
  executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:options.catalogDigest,resolution:'planned',diagnosticClassification:null,
  nodes:Object.freeze(nodes)});}
function createEvidencePlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);return Object.freeze({
  plannerContractRef:'helix://libra/planners/IntakeEvidence/v1',plannerVersion:1,plan(request){
    const suffix=canonicalDigest(request.workAttemptId).slice(0,20),candidateEvent='intake-candidate-'+suffix,materialEvent='intake-material-'+suffix;
    const common={...options,request};return plan({request,plannerContractRef:this.plannerContractRef,catalogDigest},'IntakeEvidence',[
      node(common,CANDIDATE,'candidate_verification',candidateEvent,[owner('candidateDeliverySnapshot',request,SNAPSHOT)],[],['cpu']),
      node(common,MATERIAL,'material_verification',materialEvent,[owner('candidateDeliverySnapshot',request,SNAPSHOT),
        owner('physicalMaterialReadHandleList',request,HANDLES)],[],['cpu','disk_io'])]);}});}
function createAcceptancePlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);return Object.freeze({
  plannerContractRef:'helix://libra/planners/IntakeAcceptance/v1',plannerVersion:1,plan(request){const suffix=canonicalDigest(request.workAttemptId).slice(0,20),
    bindingEvent='intake-binding-'+suffix,acceptEvent='intake-accept-'+suffix,common={...options,request},bindingResult=options.registry.resolve(BINDING,'libra').manifest.resultSchemaRef;
    return plan({request,plannerContractRef:this.plannerContractRef,catalogDigest},'IntakeAcceptance',[
      node(common,BINDING,'binding_resolution',bindingEvent,[owner('candidateDeliverySnapshot',request,SNAPSHOT),
        owner('subjectContinuityResolutionDecision',request,DECISION)],[],['cpu']),
      node(common,ACCEPT,'acceptance_commit',acceptEvent,[projected('acceptedIntakePayload',bindingEvent,bindingResult,PAYLOAD,{processId:request.processId,evidenceWorkId:''}),
        projected('responsibilityControlCommitHandle',bindingEvent,bindingResult,CONTROL,{processId:request.processId,evidenceWorkId:'',acceptEventId:acceptEvent})],
      [{eventId:bindingEvent,satisfaction:'success'}],['cpu'])]);}});}
function createRejectionPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);return Object.freeze({
  plannerContractRef:'helix://libra/planners/IntakeRejection/v1',plannerVersion:1,plan(request){const eventId='intake-reject-'+canonicalDigest(request.workAttemptId).slice(0,20),common={...options,request};
    return plan({request,plannerContractRef:this.plannerContractRef,catalogDigest},'IntakeRejection',[
      node(common,REJECT,'rejection_commit',eventId,[owner('intakeRejectionDecision',request,REJECTION,{evidenceWorkId:request.dependencyRefs?.[0]||''}),
        owner('domainFactCommitHandle',request,REJECTION_HANDLE,{evidenceWorkId:request.dependencyRefs?.[0]||'',eventId})],[],['cpu'])]);}});}

function createIntakeProjections(options){
  function read(ownerScope){const value=options.offerReader.read(ownerScope.processId);if(!value)throw new Error('Intake Offer is unavailable.');return value;}
  function evidenceWorkId(ownerScope, requested){if(requested)return requested;const rows=options.workResultReader.listWorks({ownerDomain:'libra',
    processType:'libra_intake',processId:ownerScope.processId,workKind:'evidence'});if(rows.length!==1)throw new Error('Intake Evidence Work identity is ambiguous.');return rows[0].work_id;}
  function verificationResults(ownerScope,workId){return options.workResultReader.read(evidenceWorkId(ownerScope,workId)).filter((item)=>item.outcomeKind==='succeeded').map((item)=>item.result);}
  function verifications(ownerScope,workId){const values=verificationResults(ownerScope,workId),candidate=values.find((item)=>item.schemaRef==='helix://contracts/types/CandidateContractVerification/v1'),
    material=values.find((item)=>item.schemaRef==='helix://contracts/types/IntakeMaterialVerification/v1');if(!candidate||!material)throw new Error('Intake Evidence Results are incomplete.');
    return {candidate,material};}
  function payload(ownerScope,bindingDraft,requestedWorkId){const snapshot=read(ownerScope).snapshot,decision=options.decisionResolver.resolve(snapshot),v=verifications(ownerScope,requestedWorkId);
    return buildAcceptedIntakePayload({snapshot,decision,bindingDraft,candidateVerification:v.candidate,materialVerification:v.material});}
  function controlHandle(value,eventId){const p=value,decision=p.resolutionDecision;return Object.freeze({schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
    handleId:stable('libra-handoff-a-control-',{intakeDecisionId:decision.decisionId,payloadDigest:p.payloadDigest}),operationKind:'transfer',ownerDomain:'libra',
    receivingDomain:'libra',transferPoint:'handoff_a_accepted',processType:'libra_intake',processId:decision.decisionId,
    basisRef:Object.freeze({objectType:'accepted_intake_payload',objectId:decision.decisionId,revision:1,digest:p.payloadDigest}),basisDigest:p.payloadDigest,
    canonicalFactSetDigest:decision.decisionDigest,bindingSetDigest:p.bindingDraft.bindingSetDigest,controlScopeDigest:p.controlTransferScope.controlScopeDigest,
    expectedControlRevisions:Object.freeze(p.controlTransferScope.items.map((item)=>Object.freeze({materialKey:item.materialKey,revision:item.expectedControlRevision}))),
    receiptContract:Object.freeze({receiptSchemaRef:'SubjectAndTransferReceipt@1',controlRevisionSetSchemaRef:'libra.handoff-a-transferred-control-set@1'}),
    eventFenceDigest:canonicalDigest({schema:'libra.handoff-a-intake-event-fence@1',intakeDecisionId:decision.decisionId,payloadDigest:p.payloadDigest,eventId})});}
  function rejection(ownerScope,requestedWorkId){const snapshot=read(ownerScope).snapshot,v=verifications(ownerScope,requestedWorkId),reasonInputs=[];
    if(v.candidate.result!=='passed')reasonInputs.push({reasonCode:'candidate_contract_invalid',evidenceRefs:[{evidenceSchemaRef:v.candidate.schemaRef,evidenceId:v.candidate.verificationId,evidenceDigest:canonicalDigest(v.candidate)}]});
    for(const code of v.material.reasonCodes)reasonInputs.push({reasonCode:code,evidenceRefs:[{evidenceSchemaRef:v.material.schemaRef,evidenceId:v.material.verificationId,evidenceDigest:canonicalDigest(v.material)}]});
    return buildIntakeRejectionDecision({deliverySnapshot:snapshot,reasons:reasonInputs,decidedAtMs:Math.max(v.candidate.verifiedAtMs,v.material.verifiedAtMs)});}
  return Object.freeze([
    {projectionRef:SNAPSHOT,projection:{project:({ownerScope})=>read(ownerScope).snapshot}},
    {projectionRef:HANDLES,projection:{project:({ownerScope})=>Object.freeze((read(ownerScope).snapshot.primaryMaterialDeliveries.map((item)=>{
      const basis={identity:item.physicalIdentity,ownerDomain:'libra',ownerScope:{scopeType:'intake_decision',scopeId:ownerScope.processId},bindingRevision:item.bindingRevision,
        endpointId:item.endpointId,location:item.location,mountScopeRevision:1,expectedSizeBytes:item.sizeBytes,expectedMtimeNs:0,expectedCtimeNs:0,
        fingerprintVerifiedAtMs:0,readScope:'bounded_read',expiresAtMs:Number.MAX_SAFE_INTEGER};return Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
          handleId:stable('libra-intake-read-handle-',{decisionId:ownerScope.processId,materialKey:item.materialKey}),...basis,
          fenceDigest:canonicalDigest({schema:'libra.intake-read-fence@1',...basis})});})))}},
    {projectionRef:DECISION,projection:{project:({ownerScope})=>options.decisionResolver.resolve(read(ownerScope).snapshot)}},
    {projectionRef:PAYLOAD,projection:{project:({sourceResult,parameters})=>payload({processId:parameters.processId},sourceResult,parameters.evidenceWorkId)}},
    {projectionRef:CONTROL,projection:{project:({sourceResult,parameters})=>controlHandle(payload({processId:parameters.processId},sourceResult,parameters.evidenceWorkId),parameters.acceptEventId)}},
    {projectionRef:REJECTION,projection:{project:({ownerScope,parameters})=>rejection(ownerScope,parameters.evidenceWorkId)}},
    {projectionRef:REJECTION_HANDLE,projection:{project:({ownerScope,parameters})=>{const decision=rejection(ownerScope,parameters.evidenceWorkId);return Object.freeze({
      schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:stable('libra-intake-rejection-handle-',{decisionId:decision.intakeDecisionId}),
      ownerDomain:'libra',aggregateType:'intake_decision',aggregateId:decision.intakeDecisionId,factType:'IntakeRejectionDecision',
      factSchemaRef:'helix://contracts/domain-types/IntakeRejectionDecision/v1',expectedRevision:0,payloadDigest:decision.decisionDigest,
      resultSchemaRef:'helix://contracts/types/IntakeRejectionReceipt/v1',commitIdempotencyKey:stable('libra-intake-rejection-key-',{decisionId:decision.intakeDecisionId}),
      eventFenceDigest:canonicalDigest({schema:'libra.intake-rejection-fence@1',decisionId:decision.intakeDecisionId,eventId:parameters.eventId})});}}}
  ].map(Object.freeze));
}

module.exports=Object.freeze({SNAPSHOT,HANDLES,DECISION,PAYLOAD,CONTROL,REJECTION,REJECTION_HANDLE,
  createEvidencePlanner,createAcceptancePlanner,createRejectionPlanner,createIntakeProjections});
