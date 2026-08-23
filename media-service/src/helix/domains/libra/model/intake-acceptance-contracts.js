'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {utf8Compare}=require('./libra-intake-contracts');

const BINDING_SCHEMA='helix://contracts/types/LibraBindingDraft/v1';
const BINDING_RECEIPT_SCHEMA='helix://contracts/types/LibraBindingDraftReceipt/v1';
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
function isClaimFreeNewSubject(decision){return decision?.result==='new_subject'&&
  Array.isArray(decision.candidateContinuityClaims)&&decision.candidateContinuityClaims.length===0&&
  Array.isArray(decision.candidateEpisodeScope?.episodeKeys)&&decision.candidateEpisodeScope.episodeKeys.length===0;}
function bindingResolutionBasisDigest(decision){return isClaimFreeNewSubject(decision)
  ?canonicalDigest({schema:'libra.claim-free-binding-resolution-basis@1',
    decision:without(decision,'decisionDigest','expectedContinuityHead')})
  :decision?.decisionDigest;}
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
  const primaryBindings=deliveries.map((item)=>{
    const episodeClaims=[...item.episodeClaims].sort((a,b)=>utf8Compare(a.episodeKey,b.episodeKey));
    const identity=item.physicalIdentity;
    if(!identity||identity.materialKey!==item.materialKey||identity.fingerprintAlgorithm!=='middle-256k-sha256'||
        identity.fingerprintVersion!==1||identity.sizeBytes!==item.sizeBytes||
        identity.materialKey!==canonicalDigest({schema:'physical-material-identity@2',mountScopeId:identity.mountScopeId,
          inode:identity.inode,sizeBytes:identity.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
          contentFingerprint:identity.contentFingerprint})||
        !Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<0)fail('P8_BINDING_IDENTITY_INVALID','Delivery Physical Identity or size is invalid.');
    const value={materialKey:item.materialKey,role:item.role,authorityKind:'primary_control',primaryMaterialKey:null,
      sourceRelatedReferenceId:null,associationEvidenceDigest:null,dispositionBasisDigest:null,
      physicalIdentity:identity,sizeBytes:item.sizeBytes,
      endpointId:item.endpointId,location:item.location,bindingRevision:1,
      locationEvidenceDigest:item.deliveryMemberDigest,episodeClaims};
    return {...value,bindingDigest:canonicalDigest(value)};
  });
  const primaryKeys=new Set(primaryBindings.map((item)=>item.materialKey));
  const relatedBindings=(snapshot.candidatePackage.relatedReferences||[]).map((reference)=>{
    const identity=reference.identity;
    if(reference.associationKind!=='exclusive'||reference.dispositionRequired!==true||!primaryKeys.has(reference.primaryMaterialKey)||
        !identity||identity.materialKey!==canonicalDigest({schema:'physical-material-identity@2',mountScopeId:identity.mountScopeId,
          inode:identity.inode,sizeBytes:identity.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
          contentFingerprint:identity.contentFingerprint})||reference.dispositionBasisDigest!==canonicalDigest({
          schema:'procurement.related-disposition-basis@1',referenceId:reference.referenceId,
          primaryMaterialKey:reference.primaryMaterialKey,role:reference.role,identity,
          associationEvidenceDigest:reference.associationEvidenceDigest})){
      fail('P8_BINDING_RELATED_INVALID','Related Binding requires an exact exclusive Candidate reference and disposition basis.');
    }
    const value={materialKey:identity.materialKey,role:reference.role,authorityKind:'related_derived',
      primaryMaterialKey:reference.primaryMaterialKey,sourceRelatedReferenceId:reference.referenceId,
      associationEvidenceDigest:reference.associationEvidenceDigest,dispositionBasisDigest:reference.dispositionBasisDigest,
      physicalIdentity:identity,sizeBytes:identity.sizeBytes,endpointId:reference.endpointId,location:reference.location,
      bindingRevision:1,locationEvidenceDigest:reference.referenceDigest,episodeClaims:[]};
    return {...value,bindingDigest:canonicalDigest(value)};
  });
  const bindings=[...primaryBindings,...relatedBindings].sort((a,b)=>utf8Compare(a.authorityKind,b.authorityKind)||utf8Compare(a.materialKey,b.materialKey));
  if(bindings.length>1024||new Set(bindings.map((item)=>item.authorityKind+'\0'+item.materialKey)).size!==bindings.length){
    fail('P8_BINDING_SCOPE_TOO_LARGE','Combined Primary and Related Binding scope must be unique and bounded.');
  }
  const dispositionScopeDigest=canonicalDigest({schema:'procurement.related-disposition-scope@1',items:relatedBindings
    .sort((a,b)=>utf8Compare(a.sourceRelatedReferenceId,b.sourceRelatedReferenceId)).map((item)=>({
      referenceId:item.sourceRelatedReferenceId,primaryMaterialKey:item.primaryMaterialKey,role:item.role,
      materialKey:item.materialKey,dispositionBasisDigest:item.dispositionBasisDigest}))});
  if(dispositionScopeDigest!==snapshot.candidatePackage.relatedDispositionScopeDigest){
    fail('P8_BINDING_RELATED_SCOPE_MISMATCH','Related Binding scope must exactly equal the Candidate disposition scope.');
  }
  const bindingSetDigest=canonicalDigest({schema:'libra.binding-set@1',subjectRef,
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,items:bindings});
  const value={schemaRef:BINDING_SCHEMA,schemaVersion:1,draftId:canonicalDigest({schema:'libra.binding-draft-id@1',
    intakeDecisionId:decision.decisionId}),draftKind:'libra_material_binding',basisDigest:decision.decisionDigest,draftDigest:bindingSetDigest,
    producedAtMs,subjectRef,resolutionDecision:decision,candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,bindings,bindingSetDigest};
  bounded(value,8*1024*1024,'P8_BINDING_DRAFT_TOO_LARGE');return freeze(value);
}

function buildLibraBindingDraftReceipt(snapshot,decision,producedAtMs){
  const draft=buildLibraBindingDraft(snapshot,decision,producedAtMs);
  const primaryBindingCount=draft.bindings.filter((item)=>item.authorityKind==='primary_control').length;
  const relatedBindingCount=draft.bindings.filter((item)=>item.authorityKind==='related_derived').length;
  const value={schemaRef:BINDING_RECEIPT_SCHEMA,schemaVersion:1,
    receiptId:canonicalDigest({schema:'libra.binding-draft-receipt-id@1',draftId:draft.draftId,bindingSetDigest:draft.bindingSetDigest}),
    receiptKind:'libra_binding_draft_resolved',basisDigest:draft.basisDigest,subjectRef:draft.subjectRef,
    resolutionDecisionDigest:draft.resolutionDecision.decisionDigest,
    bindingResolutionBasisDigest:bindingResolutionBasisDigest(draft.resolutionDecision),
    candidateDeliverySnapshotDigest:draft.candidateDeliverySnapshotDigest,bindingCount:draft.bindings.length,
    primaryBindingCount,relatedBindingCount,bindingSetDigest:draft.bindingSetDigest,producedAtMs:draft.producedAtMs};
  const result={...value,receiptDigest:canonicalDigest(value)};
  bounded(result,16*1024,'P8_BINDING_DRAFT_RECEIPT_TOO_LARGE');return freeze(result);
}

function rebuildLibraBindingDraftFromReceipt(snapshot,decision,receipt){
  validateDecision(snapshot,decision);
  const headIndependent=isClaimFreeNewSubject(decision),exactDecision=receipt?.basisDigest===decision.decisionDigest&&
    receipt?.resolutionDecisionDigest===decision.decisionDigest;
  if(!receipt||receipt.schemaRef!==BINDING_RECEIPT_SCHEMA||receipt.schemaVersion!==1||
      receipt.receiptKind!=='libra_binding_draft_resolved'||receipt.receiptDigest!==canonicalDigest(without(receipt,'receiptDigest'))||
      receipt.bindingResolutionBasisDigest!==bindingResolutionBasisDigest(decision)||
      (!headIndependent&&!exactDecision)||(headIndependent&&receipt.basisDigest!==receipt.resolutionDecisionDigest)||
      receipt.candidateDeliverySnapshotDigest!==snapshot.deliverySnapshotDigest||
      receipt.subjectRef?.subjectId!==subjectId(decision)||receipt.subjectRef?.resolutionKind!==decision.result||
      !Number.isSafeInteger(receipt.bindingCount)||receipt.bindingCount<1||
      !Number.isSafeInteger(receipt.primaryBindingCount)||receipt.primaryBindingCount<1||
      !Number.isSafeInteger(receipt.relatedBindingCount)||receipt.relatedBindingCount<0||
      receipt.bindingCount!==receipt.primaryBindingCount+receipt.relatedBindingCount){
    fail('P8_BINDING_DRAFT_RECEIPT_INVALID','Binding Draft Receipt does not bind the exact Resolution and Delivery Snapshot.');
  }
  const draft=buildLibraBindingDraft(snapshot,decision,receipt.producedAtMs);
  const primaryBindingCount=draft.bindings.filter((item)=>item.authorityKind==='primary_control').length;
  const relatedBindingCount=draft.bindings.filter((item)=>item.authorityKind==='related_derived').length;
  if(receipt.bindingSetDigest!==draft.bindingSetDigest||receipt.bindingCount!==draft.bindings.length||
      receipt.primaryBindingCount!==primaryBindingCount||receipt.relatedBindingCount!==relatedBindingCount){
    fail('P8_BINDING_DRAFT_RECEIPT_MISMATCH','Rebuilt Binding Draft does not match its compact Receipt.');
  }
  return draft;
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
      bindingDraft.resolutionDecision?.decisionDigest!==decision.decisionDigest||
      bindingDraft.subjectRef.subjectId!==target||bindingDraft.subjectRef.resolutionKind!==decision.result||
      bindingDraft.candidateDeliverySnapshotDigest!==snapshot.deliverySnapshotDigest){
    fail('P8_ACCEPTANCE_BINDING_LINK','Binding Draft must be derived from the exact Resolution and Delivery.');
  }
  const fieldId=snapshot.candidatePackage.materialFieldContextRef.fieldId;
  const items=[...snapshot.primaryMaterialDeliveries].sort((a,b)=>utf8Compare(a.materialKey,b.materialKey)).map((item)=>({
    materialKey:item.materialKey,expectedControlRevision:item.admittedControlRevision,
    expectedControlProjectionDigest:item.admittedControlProjectionDigest,toOwnerDomain:'libra',toOwnerScopeType:'subject',toOwnerScopeId:target}));
  const primaryBindings=bindingDraft.bindings.filter((item)=>item.authorityKind==='primary_control')
    .sort((a,b)=>utf8Compare(a.materialKey,b.materialKey));
  if(items.length!==primaryBindings.length||items.some((item,index)=>item.materialKey!==primaryBindings[index].materialKey)){
    fail('P8_ACCEPTANCE_SCOPE_MISMATCH','Binding and Control scopes must exactly equal the Delivery member set.');
  }
  const controlTransferScope={fieldId,fromOwnerDomain:'procurement',fromOwnerScopeType:'material_field',fromOwnerScopeId:fieldId,items,
    controlScopeDigest:''};
  controlTransferScope.controlScopeDigest=canonicalDigest({schema:'libra.handoff-a-control-scope@1',fieldId,
    fromOwnerDomain:controlTransferScope.fromOwnerDomain,fromOwnerScopeType:controlTransferScope.fromOwnerScopeType,
    fromOwnerScopeId:controlTransferScope.fromOwnerScopeId,items});
  const materialInputForm=snapshot.materialInputForm;
  if (!['stream_file','bdmv','dvd','iso'].includes(materialInputForm) ||
      snapshot.candidatePackage.materialInputForm !== materialInputForm) {
    fail('P8_ACCEPTANCE_INPUT_FORM','Candidate Delivery input form is missing or inconsistent.');
  }
  const sourceProvenance={fieldId,fieldAccessRevision:Number(snapshot.candidatePackage.materialFieldContextRef.accessRevision),
    fieldContextDigest:snapshot.candidatePackage.materialFieldContextRef.contextDigest,structureKind:snapshot.primaryInputManifest.structureKind,
    contentProfile:snapshot.candidatePackage.contentProfile,materialInputForm,identityClaimDigest:snapshot.candidatePackage.identityClaim.claimDigest};
  const relatedDispositionScope={relatedReferenceSetDigest:snapshot.candidatePackage.relatedReferenceSetDigest,
    relatedDispositionScopeDigest:snapshot.candidatePackage.relatedDispositionScopeDigest};
  const value={intakeDecisionId:decision.decisionId,decisionRevision:1,delivery:{offerId:decision.offerId,
    candidatePackageId:decision.candidatePackageId,packageRevision:decision.packageRevision,packageDigest:decision.packageDigest,
    acceptanceBasisDigest:snapshot.acceptanceBasis.acceptanceBasisDigest,candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest},
    sourceProvenance,candidateVerification,materialVerification,resolutionDecision:decision,bindingDraft,
    relatedDispositionScope,controlTransferScope,payloadDigest:''};
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
    candidateDeliverySnapshotDigest:payload.delivery.candidateDeliverySnapshotDigest,
    relatedDispositionScopeDigest:canonicalDigest({schema:'procurement.related-disposition-scope@1',items:payload.bindingDraft.bindings
      .filter((item)=>item.authorityKind==='related_derived')
      .sort((a,b)=>utf8Compare(a.sourceRelatedReferenceId,b.sourceRelatedReferenceId)).map((item)=>({
        referenceId:item.sourceRelatedReferenceId,primaryMaterialKey:item.primaryMaterialKey,role:item.role,
        materialKey:item.materialKey,dispositionBasisDigest:item.dispositionBasisDigest}))}),
    subjectId:target,
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

module.exports=Object.freeze({BINDING_SCHEMA,BINDING_RECEIPT_SCHEMA,MESSAGE_SCHEMA,PAYLOAD_SCHEMA,RECEIPT_SCHEMA,IntakeAcceptanceContractError,
  bindingResolutionBasisDigest,isClaimFreeNewSubject,
  buildAcceptedIntakePayload,buildLibraBindingDraft,buildLibraBindingDraftReceipt,rebuildLibraBindingDraftFromReceipt,
  buildLibraCandidateAcceptedMessage,buildSubjectAndTransferReceipt});
