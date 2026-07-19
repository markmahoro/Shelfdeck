'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildAcceptedIntakePayload,buildLibraBindingDraft,buildLibraCandidateAcceptedMessage,
  buildSubjectAndTransferReceipt}=require('../../src/helix/domains/libra/model/intake-acceptance-contracts');

const D=(value)=>canonicalDigest({value});
const without=(value,...fields)=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));
function basis(){
  const materialKey=D('material');
  const member={ordinal:0,materialKey,role:'primary_payload',bindingRevision:1,admittedControlRevision:2,
    admittedControlProjectionDigest:D('control'),endpointId:'endpoint-1',location:'/field/show.mkv',lastSnapshotDigest:D('snapshot'),
    realityDigest:D('reality'),provenanceDigest:D('provenance'),manifestMemberDigest:D('manifest-member'),episodeClaims:[{
      episodeKey:'S01E01',seasonClaimDigest:D('season'),claimDigest:D('episode')}],deliveryMemberDigest:D('delivery-member')};
  const candidatePackage={candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),
    materialFieldContextRef:{fieldId:'field-1'},seasonContinuityClaims:[],seasonContinuityClaimSetDigest:canonicalDigest({schema:'season-continuity-claim-set@1',items:[]})};
  const snapshot={snapshotContract:'procurement.candidate-delivery@1',offer:{offerId:'offer-1'},
    acceptanceBasis:{acceptanceBasisDigest:D('basis')},candidatePackage,primaryInputManifest:{manifestDigest:D('manifest')},
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
