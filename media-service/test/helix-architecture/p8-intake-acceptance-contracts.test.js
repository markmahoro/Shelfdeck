'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {bindingResolutionBasisDigest,buildAcceptedIntakePayload,buildLibraBindingDraft,buildLibraBindingDraftReceipt,rebuildLibraBindingDraftFromReceipt,buildLibraCandidateAcceptedMessage,
  buildSubjectAndTransferReceipt}=require('../../src/helix/domains/libra/model/intake-acceptance-contracts');

const D=(value)=>canonicalDigest({value});
const without=(value,...fields)=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));
function basis(){
  const physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount-1',inode:'42',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('content')};
  physicalIdentity.materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:physicalIdentity.mountScopeId,inode:physicalIdentity.inode,sizeBytes:physicalIdentity.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:physicalIdentity.contentFingerprint});
  const materialKey=physicalIdentity.materialKey;
  const member={ordinal:0,materialKey,role:'primary_payload',physicalIdentity,sizeBytes:100,bindingRevision:1,admittedControlRevision:2,
    admittedControlProjectionDigest:D('control'),endpointId:'endpoint-1',location:'/field/show.mkv',lastSnapshotDigest:D('snapshot'),
    realityDigest:D('reality'),provenanceDigest:D('provenance'),manifestMemberDigest:D('manifest-member'),episodeClaims:[{
      episodeKey:'S01E01',seasonClaimDigest:D('season'),claimDigest:D('episode')}],deliveryMemberDigest:D('delivery-member')};
  const relatedReferences=[];
  const relatedReferenceSetDigest=canonicalDigest({schema:'procurement.related-reference-set@1',items:relatedReferences});
  const relatedDispositionScopeDigest=canonicalDigest({schema:'procurement.related-disposition-scope@1',items:[]});
  const candidatePackage={candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),
    materialFieldContextRef:{fieldId:'field-1',accessRevision:1,contextDigest:D('field-context')},contentProfile:'series',materialInputForm:'stream_file',
    identityClaim:{claimDigest:D('identity-claim')},seasonContinuityClaims:[],seasonContinuityClaimSetDigest:canonicalDigest({schema:'season-continuity-claim-set@1',items:[]}),
    relatedReferences,relatedReferenceSetDigest,relatedDispositionScopeDigest};
  const snapshot={snapshotContract:'procurement.candidate-delivery@1',offer:{offerId:'offer-1'},
    acceptanceBasis:{acceptanceBasisDigest:D('basis')},candidatePackage,materialInputForm:'stream_file',primaryInputManifest:{manifestDigest:D('manifest'),structureKind:'season'},
    primaryMaterialDeliveries:[member],deliveryMemberSetDigest:D('members'),deliverySnapshotDigest:''};
  snapshot.deliverySnapshotDigest=canonicalDigest(without(snapshot,'deliverySnapshotDigest'));
  const decision={decisionId:canonicalDigest({schema:'libra.intake-decision-id@1',offerId:'offer-1'}),offerId:'offer-1',
    candidatePackageId:'candidate-1',packageRevision:1,packageDigest:candidatePackage.packageDigest,
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,expectedContinuityHead:{revision:0,digest:D('head')},
    candidateContinuityClaims:[],candidateContinuitySetDigest:candidatePackage.seasonContinuityClaimSetDigest,
    candidateEpisodeScope:{structureKind:'season',episodeKeys:['S01E01'],episodeScopeDigest:D('episodes')},matchCardinality:'none',
    matchWitnesses:[],matchedSubjectSetDigest:D('matches'),overlapEvaluation:'not_applicable_no_match',overlappingEpisodeKeys:[],
    episodeOverlapDigest:D('overlap'),result:'new_subject',allocatedSubjectId:'subject-1',decisionDigest:''};
  decision.decisionDigest=canonicalDigest(without(decision,'decisionDigest'));
  const common={result:'passed',reasonCodes:[],candidatePackageId:'candidate-1',packageDigest:candidatePackage.packageDigest,
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest};
  const candidateVerification={...common,offerId:'offer-1',packageRevision:1,acceptanceBasisDigest:snapshot.acceptanceBasis.acceptanceBasisDigest,
    primaryInputManifestDigest:snapshot.primaryInputManifest.manifestDigest};
  const materialVerification={...common};return {snapshot,decision,candidateVerification,materialVerification};
}

test('derives accepted Binding, Control scope, Receipt and notification from one immutable Delivery basis',()=>{
  const value=basis(),bindingDraft=buildLibraBindingDraft(value.snapshot,value.decision,10);
  assert.equal(bindingDraft.bindingSetDigest,bindingDraft.draftDigest);assert.equal(bindingDraft.bindings[0].locationEvidenceDigest,D('delivery-member'));
  const payload=buildAcceptedIntakePayload({...value,bindingDraft});assert.equal(payload.controlTransferScope.items[0].toOwnerScopeId,'subject-1');
  const receipt=buildSubjectAndTransferReceipt(payload,{subjectIntakeRevision:1,subjectContinuityHeadRevision:1,
    subjectContinuitySetDigest:D('continuity'),subjectEpisodeScopeDigest:D('episodes-final'),controlRevisionSetDigest:D('control-final')},20);
  assert.equal(receipt.scopeDigest,payload.payloadDigest);
  const message=buildLibraCandidateAcceptedMessage(receipt);assert.equal(message.messageKind,'libra_candidate_accepted');
  assert.equal(message.receiptDigest,receipt.receiptDigest);
});

test('rejects a Binding or Verification that does not identify the exact Delivery Snapshot',()=>{
  const value=basis(),bindingDraft=buildLibraBindingDraft(value.snapshot,value.decision,10);
  assert.throws(()=>buildAcceptedIntakePayload({...value,bindingDraft,materialVerification:{...value.materialVerification,
    candidateDeliverySnapshotDigest:D('wrong')}}),(error)=>error.code==='P8_ACCEPTANCE_VERIFICATION');
});

test('persists a compact Binding receipt and reconstructs a large immutable Binding Draft',()=>{
  const value=basis(),primaryMaterialKey=value.snapshot.primaryMaterialDeliveries[0].materialKey;
  const relatedReferences=Array.from({length:61},(_,index)=>{
    const identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount-1',
      inode:String(1000+index),sizeBytes:100+index,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
      contentFingerprint:D('related-content-'+index)};
    identity.materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:identity.mountScopeId,
      inode:identity.inode,sizeBytes:identity.sizeBytes,fingerprintAlgorithm:identity.fingerprintAlgorithm,
      fingerprintVersion:identity.fingerprintVersion,contentFingerprint:identity.contentFingerprint});
    const referenceId='related-'+index,role='subtitle',associationEvidenceDigest=D('association-'+index);
    const dispositionBasisDigest=canonicalDigest({schema:'procurement.related-disposition-basis@1',referenceId,
      primaryMaterialKey,role,identity,associationEvidenceDigest});
    return {referenceId,primaryMaterialKey,role,identity,endpointId:'endpoint-1',location:'/field/subtitle-'+index+'.srt',
      associationKind:'exclusive',dispositionRequired:true,associationEvidenceDigest,dispositionBasisDigest,
      referenceDigest:D('reference-'+index)};
  });
  const relatedDispositionScopeDigest=canonicalDigest({schema:'procurement.related-disposition-scope@1',items:relatedReferences
    .sort((a,b)=>a.referenceId.localeCompare(b.referenceId))
    .map((item)=>({referenceId:item.referenceId,primaryMaterialKey:item.primaryMaterialKey,role:item.role,
      materialKey:item.identity.materialKey,dispositionBasisDigest:item.dispositionBasisDigest}))});
  value.snapshot.candidatePackage={...value.snapshot.candidatePackage,relatedReferences,
    relatedReferenceSetDigest:D('related-set'),relatedDispositionScopeDigest};
  value.snapshot.deliverySnapshotDigest=canonicalDigest(without(value.snapshot,'deliverySnapshotDigest'));
  value.decision.candidateDeliverySnapshotDigest=value.snapshot.deliverySnapshotDigest;
  value.decision.decisionDigest=canonicalDigest(without(value.decision,'decisionDigest'));
  const receipt=buildLibraBindingDraftReceipt(value.snapshot,value.decision,10);
  assert.equal(receipt.bindingCount,62);
  assert.equal(receipt.relatedBindingCount,61);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt),'utf8')<16*1024);
  const rebuilt=rebuildLibraBindingDraftFromReceipt(value.snapshot,value.decision,receipt);
  assert.equal(rebuilt.bindings.length,62);
  assert.equal(rebuilt.bindingSetDigest,receipt.bindingSetDigest);
});

test('claim-free Movie Binding receipt rebases across unrelated continuity head advances',()=>{
  const value=basis();
  value.snapshot.primaryMaterialDeliveries[0]={...value.snapshot.primaryMaterialDeliveries[0],episodeClaims:[]};
  value.snapshot.primaryInputManifest={...value.snapshot.primaryInputManifest,structureKind:'single'};
  value.snapshot.candidatePackage={...value.snapshot.candidatePackage,contentProfile:'movie'};
  value.snapshot.deliverySnapshotDigest=canonicalDigest(without(value.snapshot,'deliverySnapshotDigest'));
  value.decision={...value.decision,candidateDeliverySnapshotDigest:value.snapshot.deliverySnapshotDigest,
    expectedContinuityHead:{revision:3,digest:D('head-3')},candidateEpisodeScope:{structureKind:'single',episodeKeys:[],episodeScopeDigest:D('empty-episodes')},decisionDigest:''};
  value.decision.decisionDigest=canonicalDigest(without(value.decision,'decisionDigest'));
  value.candidateVerification={...value.candidateVerification,candidateDeliverySnapshotDigest:value.snapshot.deliverySnapshotDigest};
  value.materialVerification={...value.materialVerification,candidateDeliverySnapshotDigest:value.snapshot.deliverySnapshotDigest};
  const receipt=buildLibraBindingDraftReceipt(value.snapshot,value.decision,10);
  const current={...value.decision,expectedContinuityHead:{revision:9,digest:D('head-9')},decisionDigest:''};
  current.decisionDigest=canonicalDigest(without(current,'decisionDigest'));
  assert.notEqual(current.decisionDigest,value.decision.decisionDigest);
  assert.equal(bindingResolutionBasisDigest(current),receipt.bindingResolutionBasisDigest);
  const bindingDraft=rebuildLibraBindingDraftFromReceipt(value.snapshot,current,receipt);
  assert.doesNotThrow(()=>buildAcceptedIntakePayload({...value,decision:current,bindingDraft}));
});

test('claim-bearing Binding receipt remains fenced by the exact continuity head',()=>{
  const value=basis(),receipt=buildLibraBindingDraftReceipt(value.snapshot,value.decision,10);
  const current={...value.decision,expectedContinuityHead:{revision:9,digest:D('head-9')},decisionDigest:''};
  current.decisionDigest=canonicalDigest(without(current,'decisionDigest'));
  assert.throws(()=>rebuildLibraBindingDraftFromReceipt(value.snapshot,current,receipt),
    (error)=>error.code==='P8_BINDING_DRAFT_RECEIPT_INVALID');
});
