'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {utf8Compare}=require('./libra-intake-contracts');

const BINDING_SCHEMA='helix://contracts/types/LibraBindingDraft/v1';
const PAYLOAD_SCHEMA='helix://contracts/domain-types/AcceptedIntakePayload/v1';
const RECEIPT_SCHEMA='helix://contracts/types/SubjectAndTransferReceipt/v1';
const MESSAGE_SCHEMA='helix://contracts/types/LibraCandidateAcceptedMessage/v1';

class IntakeAcceptanceContractError extends Error{
  constructor(code,message,details={}){super(message);this.name='IntakeAcceptanceContractError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new IntakeAcceptanceContractError(code,message,details);}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function freeze(value){if(Array.isArray(value))return Object.freeze(value.map(freeze));if(value&&typeof value==='object')return Object.freeze(
  Object.fromEntries(Object.entries(value).map(([key,item])=>[key,freeze(item)])));return value;}
function bounded(value,maximum,code){if(Buffer.byteLength(canonicalJson(value),'utf8')>maximum)fail(code,'Canonical value exceeds its SSOT byte bound.');}
function subjectId(decision){return decision.result==='season_extension'?decision.targetSubjectId:decision.allocatedSubjectId;}
function validateDecision(snapshot,decision){
  if(!snapshot||snapshot.snapshotContract!=='procurement.candidate-delivery@1'||
      snapshot.deliverySnapshotDigest!==canonicalDigest(without(snapshot,'deliverySnapshotDigest'))||!decision||
      decision.decisionDigest!==canonicalDigest(without(decision,'decisionDigest'))||decision.offerId!==snapshot.offer.offerId||
      decision.candidatePackageId!==snapshot.candidatePackage.candidatePackageId||decision.packageRevision!==snapshot.candidatePackage.packageRevision||
      decision.packageDigest!==snapshot.candidatePackage.packageDigest||decision.candidateDeliverySnapshotDigest!==snapshot.deliverySnapshotDigest||
      !['new_subject','season_extension'].includes(decision.result)||!subjectId(decision)){
    fail('P8_ACCEPTANCE_DECISION_LINK','A digest-valid Resolution Decision for the exact Delivery Snapshot is required.');
  }
}

function buildLibraBindingDraft(snapshot,decision,producedAtMs){
  validateDecision(snapshot,decision);if(!Number.isSafeInteger(producedAtMs)||producedAtMs<0)fail('P8_BINDING_DRAFT_TIME','Draft time is invalid.');
  const subjectRef={subjectId:subjectId(decision),resolutionKind:decision.result};
  const deliveries=snapshot.primaryMaterialDeliveries;
  if(!Array.isArray(deliveries)||deliveries.length<1||deliveries.length>1024||new Set(deliveries.map((item)=>item.materialKey)).size!==deliveries.length){
    fail('P8_BINDING_DELIVERY_SET','Binding Draft requires the exact non-empty unique Delivery member set.');
  }
  const bindings=deliveries.map((item)=>{
    const episodeClaims=[...item.episodeClaims].sort((a,b)=>utf8Compare(a.episodeKey,b.episodeKey));
    const value={materialKey:item.materialKey,role:item.role,endpointId:item.endpointId,location:item.location,bindingRevision:1,
      locationEvidenceDigest:item.deliveryMemberDigest,episodeClaims};
    return {...value,bindingDigest:canonicalDigest(value)};
  }).sort((a,b)=>utf8Compare(a.materialKey,b.materialKey));
  const bindingSetDigest=canonicalDigest({schema:'libra.binding-set@1',subjectRef,
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,items:bindings});
  const value={schemaRef:BINDING_SCHEMA,schemaVersion:1,draftId:canonicalDigest({schema:'libra.binding-draft-id@1',
    intakeDecisionId:decision.decisionId}),draftKind:'libra_material_binding',basisDigest:decision.decisionDigest,draftDigest:bindingSetDigest,
    producedAtMs,subjectRef,candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,bindings,bindingSetDigest};
  bounded(value,8*1024*1024,'P8_BINDING_DRAFT_TOO_LARGE');return freeze(value);
}

function assertVerification(verification,snapshot,kind){
  if(!verification||verification.result!=='passed'||verification.reasonCodes.length!==0||
      verification.candidatePackageId!==snapshot.candidatePackage.candidatePackageId||verification.packageDigest!==snapshot.candidatePackage.packageDigest||
      verification.candidateDeliverySnapshotDigest!==snapshot.deliverySnapshotDigest||kind==='candidate'&&(
        verification.offerId!==snapshot.offer.offerId||verification.packageRevision!==snapshot.candidatePackage.packageRevision||
        verification.acceptanceBasisDigest!==snapshot.acceptanceBasis.acceptanceBasisDigest||
        verification.primaryInputManifestDigest!==snapshot.primaryInputManifest.manifestDigest)){
    fail('P8_ACCEPTANCE_VERIFICATION','Both passed Verifications must bind the exact Delivery Snapshot.');
  }
}

function buildAcceptedIntakePayload({snapshot,decision,bindingDraft,candidateVerification,materialVerification}){
  validateDecision(snapshot,decision);assertVerification(candidateVerification,snapshot,'candidate');assertVerification(materialVerification,snapshot,'material');
  const target=subjectId(decision);
  if(!bindingDraft||bindingDraft.bindingSetDigest!==bindingDraft.draftDigest||bindingDraft.basisDigest!==decision.decisionDigest||
      bindingDraft.subjectRef.subjectId!==target||bindingDraft.subjectRef.resolutionKind!==decision.result||
      bindingDraft.candidateDeliverySnapshotDigest!==snapshot.deliverySnapshotDigest){
    fail('P8_ACCEPTANCE_BINDING_LINK','Binding Draft must be derived from the exact Resolution and Delivery.');
  }
  const fieldId=snapshot.candidatePackage.materialFieldContextRef.fieldId;
  const items=[...snapshot.primaryMaterialDeliveries].sort((a,b)=>utf8Compare(a.materialKey,b.materialKey)).map((item)=>({
    materialKey:item.materialKey,expectedControlRevision:item.admittedControlRevision,
    expectedControlProjectionDigest:item.admittedControlProjectionDigest,toOwnerDomain:'libra',toOwnerScopeType:'subject',toOwnerScopeId:target}));
  if(items.length!==bindingDraft.bindings.length||items.some((item,index)=>item.materialKey!==bindingDraft.bindings[index].materialKey)){
    fail('P8_ACCEPTANCE_SCOPE_MISMATCH','Binding and Control scopes must exactly equal the Delivery member set.');
  }
  const controlTransferScope={fieldId,fromOwnerDomain:'procurement',fromOwnerScopeType:'material_field',fromOwnerScopeId:fieldId,items,
    controlScopeDigest:''};
  controlTransferScope.controlScopeDigest=canonicalDigest({schema:'libra.handoff-a-control-scope@1',fieldId,
    fromOwnerDomain:controlTransferScope.fromOwnerDomain,fromOwnerScopeType:controlTransferScope.fromOwnerScopeType,
    fromOwnerScopeId:controlTransferScope.fromOwnerScopeId,items});
  const value={intakeDecisionId:decision.decisionId,decisionRevision:1,delivery:{offerId:decision.offerId,
    candidatePackageId:decision.candidatePackageId,packageRevision:decision.packageRevision,packageDigest:decision.packageDigest,
    acceptanceBasisDigest:snapshot.acceptanceBasis.acceptanceBasisDigest,candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest},
    candidateVerification,materialVerification,resolutionDecision:decision,bindingDraft,controlTransferScope,payloadDigest:''};
  value.payloadDigest=canonicalDigest(without(value,'payloadDigest'));bounded(value,8*1024*1024,'P8_ACCEPTANCE_PAYLOAD_TOO_LARGE');return freeze(value);
}

function buildSubjectAndTransferReceipt(payload,committed,committedAtMs){
  if(!payload||payload.payloadDigest!==canonicalDigest(without(payload,'payloadDigest'))||!committed||
      !Number.isSafeInteger(committed.subjectIntakeRevision)||committed.subjectIntakeRevision<1||
      !Number.isSafeInteger(committed.subjectContinuityHeadRevision)||committed.subjectContinuityHeadRevision<1||
      !Number.isSafeInteger(committedAtMs)||committedAtMs<0)fail('P8_ACCEPTANCE_RECEIPT_INPUT','Receipt requires exact committed Subject and Control facts.');
  const decision=payload.resolutionDecision,target=subjectId(decision);
  const receipt={schemaRef:RECEIPT_SCHEMA,schemaVersion:1,receiptId:canonicalDigest({schema:'handoff-a-accepted-receipt-id@1',
    intakeDecisionId:payload.intakeDecisionId,payloadDigest:payload.payloadDigest}),receiptKind:'handoff_a_accepted',ownerDomain:'libra',
    scopeType:'intake_decision',scopeId:payload.intakeDecisionId,scopeDigest:payload.payloadDigest,effectReceiptRef:null,committedAtMs,
    intakeDecisionId:payload.intakeDecisionId,offerId:payload.delivery.offerId,candidatePackageId:payload.delivery.candidatePackageId,
    packageRevision:payload.delivery.packageRevision,packageDigest:payload.delivery.packageDigest,
    candidateDeliverySnapshotDigest:payload.delivery.candidateDeliverySnapshotDigest,subjectId:target,
    subjectIntakeRevision:committed.subjectIntakeRevision,subjectContinuityHeadRevision:committed.subjectContinuityHeadRevision,
    subjectContinuitySetDigest:committed.subjectContinuitySetDigest,subjectEpisodeScopeDigest:committed.subjectEpisodeScopeDigest,
    libraBindingSetDigest:payload.bindingDraft.bindingSetDigest,controlRevisionSetDigest:committed.controlRevisionSetDigest,receiptDigest:''};
  receipt.receiptDigest=canonicalDigest(without(receipt,'receiptDigest'));bounded(receipt,64*1024,'P8_ACCEPTANCE_RECEIPT_TOO_LARGE');return freeze(receipt);
}

function buildLibraCandidateAcceptedMessage(receipt){
  if(!receipt||receipt.receiptDigest!==canonicalDigest(without(receipt,'receiptDigest')))fail('P8_ACCEPTANCE_MESSAGE_INPUT','Accepted message requires a digest-valid Receipt.');
  const value={schemaRef:MESSAGE_SCHEMA,schemaVersion:1,messageKind:'libra_candidate_accepted',offerId:receipt.offerId,
    candidatePackageId:receipt.candidatePackageId,packageRevision:receipt.packageRevision,packageDigest:receipt.packageDigest,
    intakeDecisionId:receipt.intakeDecisionId,subjectId:receipt.subjectId,subjectIntakeRevision:receipt.subjectIntakeRevision,
    receiptId:receipt.receiptId,receiptDigest:receipt.receiptDigest};bounded(value,16*1024,'P8_ACCEPTANCE_MESSAGE_TOO_LARGE');return freeze(value);
}

module.exports=Object.freeze({BINDING_SCHEMA,MESSAGE_SCHEMA,PAYLOAD_SCHEMA,RECEIPT_SCHEMA,IntakeAcceptanceContractError,
  buildAcceptedIntakePayload,buildLibraBindingDraft,buildLibraCandidateAcceptedMessage,buildSubjectAndTransferReceipt});
