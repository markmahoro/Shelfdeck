'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createMaterialControlExactTransferParticipant } = require('../../../foundation/persistence/material-control');
const { CONTINUITY_HEAD_ID, candidateProvenance, continuityHeadDigest, subjectContinuitySetDigest, subjectEpisodeScopeDigest, utf8Compare } = require('../model/libra-intake-contracts');
const { RECEIPT_SCHEMA, MESSAGE_SCHEMA, buildLibraCandidateAcceptedMessage, buildSubjectAndTransferReceipt } = require('../model/intake-acceptance-contracts');
const {
  buildDecisionIdentityEvidenceSnapshot,
} = require('../model/decision-identity-evidence-contracts');
const { createLibraIntakeRepositoryDefinitions } = require('./libra-intake-store');

const DECISION_SCHEMA='helix://contracts/types/SubjectContinuityResolutionDecision/v1';
const HANDLE_SCHEMA='helix://contracts/types/ResponsibilityControlCommitHandle/v1';
const SHA256=/^[a-f0-9]{64}$/;

class IntakeAcceptanceStoreError extends Error { constructor(code,message,details={}){super(message);this.name='IntakeAcceptanceStoreError';this.code=code;this.details=details;} }
class Replay extends Error { constructor(receipt){super('Handoff A acceptance replay');this.receipt=receipt;} }
function fail(code,message,details){throw new IntakeAcceptanceStoreError(code,message,details);}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function subjectId(decision){return decision.result==='season_extension'?decision.targetSubjectId:decision.allocatedSubjectId;}
function number(value){return Number(value);}

function foundationDefinition(schemaManifest){return createRepositoryDefinition({repositoryId:'libra_intake_acceptance_foundation',owner:'execution-foundation',schemaManifest,statements:{
  find_marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'],keyColumns:['commit_marker']},
  insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
  insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
  insert_outbox:{kind:'insert',tableId:'fx_outbox',columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id','aggregate_revision','dedup_key','consumer_set_digest','intended_consumer_count','payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms','all_acked_at_ms']},
  insert_outbox_delivery:{kind:'insert',tableId:'fx_outbox_deliveries',columns:['message_id','consumer_domain','state','attempt_count','next_attempt_at_ms','acked_at_ms']}
}});}

function validate(request){
  if(!request||!request.deliverySnapshot||!request.payload||!request.responsibilityControlCommitHandle||!request.commitMarker||!request.resultBinding)fail('P8_ACCEPTANCE_REQUEST_INVALID','Accepted commit request is incomplete.');
  const snapshot=request.deliverySnapshot,payload=request.payload,decision=payload.resolutionDecision,handle=request.responsibilityControlCommitHandle,target=subjectId(decision);
  if(payload.payloadDigest!==canonicalDigest(without(payload,'payloadDigest'))||decision.decisionDigest!==canonicalDigest(without(decision,'decisionDigest'))||
      snapshot.deliverySnapshotDigest!==canonicalDigest(without(snapshot,'deliverySnapshotDigest'))||
      payload.intakeDecisionId!==decision.decisionId||payload.delivery.offerId!==decision.offerId||
      payload.delivery.candidateDeliverySnapshotDigest!==snapshot.deliverySnapshotDigest||!target)fail('P8_ACCEPTANCE_PAYLOAD_INVALID','Accepted payload is not a digest-valid exact Resolution product.');
  const expected=payload.controlTransferScope.items.map((item)=>({materialKey:item.materialKey,revision:item.expectedControlRevision}));
  if(handle.schemaRef!==HANDLE_SCHEMA||handle.schemaVersion!==1||handle.operationKind!=='transfer'||handle.ownerDomain!=='libra'||handle.receivingDomain!=='libra'||
      handle.transferPoint!=='handoff_a_accepted'||handle.basisDigest!==payload.payloadDigest||handle.basisRef.objectType!=='accepted_intake_payload'||
      handle.basisRef.objectId!==payload.intakeDecisionId||handle.basisRef.digest!==payload.payloadDigest||handle.bindingSetDigest!==payload.bindingDraft.bindingSetDigest||
      handle.controlScopeDigest!==payload.controlTransferScope.controlScopeDigest||canonicalJson([...handle.expectedControlRevisions].sort((a,b)=>utf8Compare(a.materialKey,b.materialKey)))!==canonicalJson(expected)||
      !handle.receiptContract||handle.receiptContract.receiptSchemaRef!=='SubjectAndTransferReceipt@1'||
      handle.receiptContract.controlRevisionSetSchemaRef!=='libra.handoff-a-transferred-control-set@1')fail('P8_ACCEPTANCE_HANDLE_MISMATCH','Responsibility Control Handle does not authorize the exact accepted payload.');
  if(!SHA256.test(request.commitMarker.commitDigest||'')||typeof request.commitMarker.commitMarker!=='string'||!request.commitMarker.commitMarker||
      typeof request.resultBinding.resultId!=='string'||!request.resultBinding.resultId||
      request.resultBinding.eventId!==null&&request.resultBinding.eventId!==undefined)fail('P8_ACCEPTANCE_REQUEST_INVALID','Synchronous accepted commit requires a Result identity and no Workflow Event identity.');
  return {snapshot,payload,decision,handle,target};
}

function receiptFromRow(row,payload){const value={schemaRef:RECEIPT_SCHEMA,schemaVersion:1,receiptId:row.receipt_id,receiptKind:'handoff_a_accepted',ownerDomain:'libra',
  scopeType:'intake_decision',scopeId:row.intake_decision_id,scopeDigest:row.accepted_payload_digest,effectReceiptRef:null,committedAtMs:number(row.committed_at_ms),
  intakeDecisionId:row.intake_decision_id,offerId:row.offer_id,candidatePackageId:row.candidate_package_id,packageRevision:number(row.package_revision),packageDigest:row.package_digest,
  candidateDeliverySnapshotDigest:row.candidate_delivery_snapshot_digest,subjectId:row.subject_id,subjectIntakeRevision:number(row.subject_intake_revision),
  subjectContinuityHeadRevision:number(row.subject_continuity_head_revision),subjectContinuitySetDigest:row.subject_continuity_set_digest,
  subjectEpisodeScopeDigest:row.subject_episode_scope_digest,libraBindingSetDigest:row.libra_binding_set_digest,
  controlRevisionSetDigest:row.control_revision_set_digest,receiptDigest:row.receipt_digest};
  if(value.scopeDigest!==payload.payloadDigest||canonicalDigest(without(value,'receiptDigest'))!==value.receiptDigest)fail('P8_ACCEPTANCE_REPLAY_CORRUPT','Stored accepted Receipt cannot be reconstructed.');return Object.freeze(value);}

function createIntakeAcceptanceStore(options){
  if(!options||!options.schemaManifest||!options.unitOfWork||typeof options.unitOfWork.execute!=='function')fail('P8_ACCEPTANCE_STORE_DEPENDENCIES','Schema manifest and scoped Unit of Work are required.');
  const libra=createLibraIntakeRepositoryDefinitions(options.schemaManifest),foundation=foundationDefinition(options.schemaManifest);
  return Object.freeze({repositoryManifest:Object.freeze({libraTableIds:libra.tableIds,foundationTableIds:[...foundation.tableIds,'fx_material_controls','fx_material_control_revisions'].sort()}),
    accept(request){
      const {snapshot,payload,decision,handle,target}=validate(request),provenance=candidateProvenance(snapshot),markerId=request.commitMarker.commitMarker,binding=request.resultBinding;
      const decisionIdentityEvidence=buildDecisionIdentityEvidenceSnapshot(snapshot,{
        intakeDecisionId:decision.decisionId,candidatePackageId:decision.candidatePackageId,
        packageRevision:decision.packageRevision,packageDigest:decision.packageDigest,
        candidateDeliverySnapshotDigest:decision.candidateDeliverySnapshotDigest,
        candidateIdentityClaimDigest:provenance.candidateIdentityClaimDigest
      });
      let receipt,message,subjectRevision,headRevision,continuityDigest,episodeDigest,controlSetDigest;
      const preflight={participantId:'acceptance_preflight',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){
        const row=context.repository(foundation.repositoryId).invoke('find_marker',{commit_marker:markerId});if(!row)return;
        if(row.owner_domain!=='libra'||row.scope_type!=='intake_decision'||row.scope_id!==payload.intakeDecisionId||row.commit_digest!==request.commitMarker.commitDigest||
            row.result_schema_ref!==RECEIPT_SCHEMA)fail('P8_ACCEPTANCE_MARKER_CONFLICT','Commit Marker belongs to another accepted fact.');
      }};
      const domain={participantId:'acceptance_domain',owner:'libra',repositories:[libra.subjects,libra.bindings,libra.intake],execute(context){
        const s=context.repository(libra.subjects.repositoryId),b=context.repository(libra.bindings.repositoryId),i=context.repository(libra.intake.repositoryId),at=context.commitTimeMs;
        const existing=i.invoke('find_offer_decision',{offer_id:decision.offerId});
        if(existing){if(existing.intake_decision_id!==decision.decisionId||existing.decision_kind!=='accepted_resolution'||existing.decision_digest!==decision.decisionDigest||existing.accepted_payload_digest!==payload.payloadDigest)fail('P8_ACCEPTANCE_OFFER_TERMINAL_CONFLICT','Offer already has another immutable Intake Decision.');
          const row=i.invoke('find_receipt',{intake_decision_id:decision.decisionId});if(!row)fail('P8_ACCEPTANCE_REPLAY_CORRUPT','Accepted Decision has no Receipt.');throw new Replay(receiptFromRow(row,payload));}
        const head=s.invoke('find_head',{head_id:CONTINUITY_HEAD_ID});
        if(!head||number(head.current_revision)!==decision.expectedContinuityHead.revision||head.head_digest!==decision.expectedContinuityHead.digest||head.head_digest!==continuityHeadDigest(number(head.current_revision)))fail('P8_ACCEPTANCE_GLOBAL_HEAD_CAS','Subject continuity global head is stale.');
        const candidateClaims=decision.candidateContinuityClaims.map((claim)=>({claimKind:claim.claimKind,claimNamespace:claim.claimNamespace,
          claimKey:claim.claimKey,claimDigest:claim.claimDigest,provenanceKind:'candidate',provenanceRef:decision.candidatePackageId}));
        const candidateEpisodes=[...decision.candidateEpisodeScope.episodeKeys];let allClaims=candidateClaims,allEpisodes=candidateEpisodes;
        if(decision.result==='new_subject'){
          if(s.invoke('find_subject',{subject_id:target}))fail('P8_ACCEPTANCE_ALLOCATED_SUBJECT_CONFLICT','Allocated Subject ID already exists.');subjectRevision=1;
        }else{
          const current=s.invoke('find_subject',{subject_id:target});
          if(!current||current.status!==decision.expectedTargetStatus||number(current.intake_revision)!==decision.expectedTargetIntakeRevision||
              current.current_continuity_set_digest!==decision.expectedTargetContinuitySetDigest||current.current_episode_scope_digest!==decision.expectedTargetEpisodeScopeDigest||
              current.structure_kind!==provenance.candidateStructureKind||current.content_profile!==provenance.candidateContentProfile)fail('P8_ACCEPTANCE_TARGET_CAS','Extension target is stale or has incompatible structure/profile provenance.');
          allClaims=[...s.invoke('find_claims',{subject_id:target}).map((row)=>({claimKind:row.claim_kind,claimNamespace:row.claim_namespace,claimKey:row.claim_key,claimDigest:row.claim_digest,provenanceKind:row.provenance_kind,provenanceRef:row.provenance_ref})),...candidateClaims];
          allEpisodes=[...s.invoke('find_episodes',{subject_id:target}).map((row)=>row.episode_key),...candidateEpisodes];subjectRevision=number(current.intake_revision)+1;
        }
        continuityDigest=subjectContinuitySetDigest(target,allClaims);episodeDigest=subjectEpisodeScopeDigest(target,allEpisodes);headRevision=number(head.current_revision)+1;
        if(decision.result==='new_subject')s.invoke('insert_subject',{subject_id:target,structure_kind:provenance.candidateStructureKind,content_profile:provenance.candidateContentProfile,
          routing_anchor_intake_decision_id:decision.decisionId,status:'active',intake_revision:subjectRevision,
          current_continuity_set_digest:continuityDigest,current_episode_scope_digest:episodeDigest,current_identity_revision:null,created_at_ms:at,updated_at_ms:at,terminal_at_ms:null});
        else if(s.invoke('advance_subject',{intake_revision:subjectRevision,current_continuity_set_digest:continuityDigest,current_episode_scope_digest:episodeDigest,updated_at_ms:at,subject_id:target,
          expected_status:decision.expectedTargetStatus,expected_intake_revision:decision.expectedTargetIntakeRevision,expected_continuity_set_digest:decision.expectedTargetContinuitySetDigest,
          expected_episode_scope_digest:decision.expectedTargetEpisodeScopeDigest}).changes!==1)fail('P8_ACCEPTANCE_TARGET_CAS','Extension target CAS failed.');
        i.invoke('insert_decision',{intake_decision_id:decision.decisionId,decision_revision:1,decision_kind:'accepted_resolution',offer_id:decision.offerId,
          candidate_package_id:decision.candidatePackageId,package_revision:decision.packageRevision,package_digest:decision.packageDigest,
          acceptance_basis_digest:payload.delivery.acceptanceBasisDigest,candidate_delivery_snapshot_digest:decision.candidateDeliverySnapshotDigest,
          source_field_id:provenance.sourceFieldId,source_field_access_revision:provenance.sourceFieldAccessRevision,
          source_field_context_digest:provenance.sourceFieldContextDigest,candidate_structure_kind:provenance.candidateStructureKind,
          candidate_content_profile:provenance.candidateContentProfile,candidate_identity_claim_digest:provenance.candidateIdentityClaimDigest,
          decision_identity_evidence_schema_ref:decisionIdentityEvidence.schemaRef,
          decision_identity_evidence_json:canonicalJson(decisionIdentityEvidence),
          decision_identity_evidence_digest:decisionIdentityEvidence.snapshotDigest,
          expected_continuity_head_revision:decision.expectedContinuityHead.revision,expected_continuity_head_digest:decision.expectedContinuityHead.digest,
          committed_continuity_head_revision:headRevision,candidate_continuity_set_digest:decision.candidateContinuitySetDigest,
          candidate_episode_scope_digest:decision.candidateEpisodeScope.episodeScopeDigest,match_cardinality:decision.matchCardinality,
          matched_subject_set_digest:decision.matchedSubjectSetDigest,episode_overlap_digest:decision.episodeOverlapDigest,accepted_result:decision.result,target_subject_id:target,
          expected_target_status:decision.expectedTargetStatus||null,expected_target_intake_revision:decision.expectedTargetIntakeRevision??null,
          expected_target_continuity_set_digest:decision.expectedTargetContinuitySetDigest||null,expected_target_episode_scope_digest:decision.expectedTargetEpisodeScopeDigest||null,
          committed_target_intake_revision:subjectRevision,committed_subject_continuity_set_digest:continuityDigest,committed_subject_episode_scope_digest:episodeDigest,
          accepted_payload_digest:payload.payloadDigest,rejection_schema_ref:null,rejection_id:null,primary_rejection_code:null,rejection_reason_set_digest:null,rejection_digest:null,
          decision_digest:decision.decisionDigest,decided_at_ms:at});
        decision.matchWitnesses.forEach((w,index)=>i.invoke('insert_match_witness',{intake_decision_id:decision.decisionId,ordinal:index,subject_id:w.subjectId,
          expected_subject_status:w.expectedSubjectStatus,expected_subject_intake_revision:w.expectedSubjectIntakeRevision,expected_subject_continuity_set_digest:w.expectedSubjectContinuitySetDigest,
          expected_subject_episode_scope_digest:w.expectedSubjectEpisodeScopeDigest,claim_kind:w.claimKind,claim_namespace:w.claimNamespace,claim_key:w.claimKey,
          candidate_claim_digest:w.candidateClaimDigest,subject_claim_digest:w.subjectClaimDigest,subject_claim_provenance_kind:w.subjectClaimProvenanceKind,
          subject_claim_provenance_ref:w.subjectClaimProvenanceRef,witness_digest:w.witnessDigest}));
        decision.overlappingEpisodeKeys.forEach((key)=>i.invoke('insert_overlap',{intake_decision_id:decision.decisionId,subject_id:decision.targetSubjectId,
          episode_key:key,overlap_digest:canonicalDigest({schema:'libra.episode-overlap-member@1',subjectId:decision.targetSubjectId,episodeKey:key})}));
        for(const claim of candidateClaims)s.invoke('insert_claim',{subject_id:target,claim_kind:claim.claimKind,claim_namespace:claim.claimNamespace,claim_key:claim.claimKey,
          claim_digest:claim.claimDigest,provenance_kind:claim.provenanceKind,provenance_ref:claim.provenanceRef,accepted_at_ms:at});
        for(const key of candidateEpisodes)s.invoke('insert_episode',{subject_id:target,episode_key:key,first_intake_decision_id:decision.decisionId,source_episode_scope_digest:decision.candidateEpisodeScope.episodeScopeDigest,accepted_at_ms:at});
        const relatedReferenceSetDigest=request.deliverySnapshot.candidatePackage.relatedReferenceSetDigest||
          canonicalDigest({schema:'procurement.related-reference-set@1',items:request.deliverySnapshot.relatedReferences||[]});
        for(const item of payload.bindingDraft.bindings){b.invoke('insert_binding_with_origin',{subject_id:target,material_key:item.materialKey,role:item.role,
          mount_scope_id:item.physicalIdentity.mountScopeId,inode:item.physicalIdentity.inode,
          content_hash_algorithm:item.physicalIdentity.contentHashAlgorithm,content_hash:item.physicalIdentity.contentHash,size_bytes:item.sizeBytes,
          endpoint_id:item.endpointId,location:item.location,
          binding_revision:item.bindingRevision,health_state:'active',evidence_digest:item.locationEvidenceDigest,
          origin_intake_decision_id:decision.decisionId,origin_offer_id:payload.delivery.offerId,
          origin_candidate_package_id:payload.delivery.candidatePackageId,origin_package_revision:payload.delivery.packageRevision,
          origin_package_digest:payload.delivery.packageDigest,
          origin_candidate_delivery_snapshot_digest:payload.delivery.candidateDeliverySnapshotDigest,
          origin_related_reference_set_digest:relatedReferenceSetDigest,current:1});for(const claim of item.episodeClaims)b.invoke('insert_binding_episode',{
          subject_id:target,material_key:item.materialKey,binding_revision:item.bindingRevision,episode_key:claim.episodeKey,season_claim_digest:claim.seasonClaimDigest,claim_digest:claim.claimDigest});}
        if(s.invoke('advance_head',{current_revision:headRevision,head_digest:continuityHeadDigest(headRevision),updated_at_ms:at,head_id:CONTINUITY_HEAD_ID,
          expected_revision:decision.expectedContinuityHead.revision,expected_digest:decision.expectedContinuityHead.digest}).changes!==1)fail('P8_ACCEPTANCE_GLOBAL_HEAD_CAS','Subject continuity global head CAS failed.');
      }};
      const changes=payload.controlTransferScope.items.map((item)=>({materialKey:item.materialKey,expectedRevision:item.expectedControlRevision,
        expectedProjectionDigest:item.expectedControlProjectionDigest,fromScope:{ownerDomain:'procurement',scopeType:'material_field',scopeId:payload.controlTransferScope.fieldId},
        toScope:{ownerDomain:'libra',scopeType:'subject',scopeId:target}}));
      const controlBase=createMaterialControlExactTransferParticipant({schemaManifest:options.schemaManifest,handle,changes,
        authorizedScopeDigest:payload.controlTransferScope.controlScopeDigest,commitMarker:markerId,participantId:'acceptance_control'});
      let controlOutputs;const control={...controlBase,execute(context){controlOutputs=controlBase.execute(context);return controlOutputs;}};
      const receiptWrite={participantId:'acceptance_receipt',owner:'libra',repositories:[libra.intake],execute(context){const items=controlOutputs.map((output)=>{const expected=payload.controlTransferScope.items.find((item)=>item.materialKey===output.materialKey);return {
        materialKey:output.materialKey,expectedControlRevision:expected.expectedControlRevision,expectedControlProjectionDigest:expected.expectedControlProjectionDigest,
        committedControlRevision:output.revision,committedControlProjectionDigest:output.projection.projectionDigest,fromOwnerDomain:'procurement',fromOwnerScopeType:'material_field',
        fromOwnerScopeId:payload.controlTransferScope.fieldId,toOwnerDomain:'libra',toOwnerScopeType:'subject',toOwnerScopeId:target};}).sort((a,b)=>utf8Compare(a.materialKey,b.materialKey));
        controlSetDigest=canonicalDigest({schema:'libra.handoff-a-transferred-control-set@1',intakeDecisionId:decision.decisionId,subjectId:target,
          controlScopeDigest:payload.controlTransferScope.controlScopeDigest,items});receipt=buildSubjectAndTransferReceipt(payload,{subjectIntakeRevision:subjectRevision,
          subjectContinuityHeadRevision:headRevision,subjectContinuitySetDigest:continuityDigest,subjectEpisodeScopeDigest:episodeDigest,controlRevisionSetDigest:controlSetDigest},context.commitTimeMs);
        context.repository(libra.intake.repositoryId).invoke('insert_receipt',{receipt_id:receipt.receiptId,intake_decision_id:decision.decisionId,outcome:'accepted',offer_id:decision.offerId,
          candidate_package_id:decision.candidatePackageId,package_revision:decision.packageRevision,package_digest:decision.packageDigest,candidate_delivery_snapshot_digest:decision.candidateDeliverySnapshotDigest,
          subject_id:target,subject_intake_revision:subjectRevision,subject_continuity_head_revision:headRevision,subject_continuity_set_digest:continuityDigest,
          subject_episode_scope_digest:episodeDigest,accepted_payload_digest:payload.payloadDigest,libra_binding_set_digest:payload.bindingDraft.bindingSetDigest,
          control_revision_set_digest:controlSetDigest,rejection_id:null,primary_rejection_code:null,rejection_reason_set_digest:null,rejection_digest:null,
          receipt_digest:receipt.receiptDigest,committed_at_ms:context.commitTimeMs});message=buildLibraCandidateAcceptedMessage(receipt);return receipt;}};
      const result={participantId:'acceptance_result',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){context.repository(foundation.repositoryId).invoke('insert_result',{
        result_id:binding.resultId,event_id:binding.eventId,outcome_kind:'succeeded',result_schema_ref:RECEIPT_SCHEMA,result_json:canonicalJson(receipt),result_digest:receipt.receiptDigest,
        evidence_schema_ref:DECISION_SCHEMA,evidence_json:canonicalJson(decision),evidence_digest:decision.decisionDigest,effect_receipt_id:receipt.receiptId,committed_at_ms:context.commitTimeMs});}};
      const marker={participantId:'acceptance_marker',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){context.repository(foundation.repositoryId).invoke('insert_marker',{
        commit_marker:markerId,effect_id:request.commitMarker.effectId||null,owner_domain:'libra',scope_type:'intake_decision',scope_id:decision.decisionId,
        commit_digest:request.commitMarker.commitDigest,result_id:binding.resultId,result_schema_ref:RECEIPT_SCHEMA,result_digest:receipt.receiptDigest,committed_at_ms:context.commitTimeMs});}};
      const outbox={participantId:'acceptance_outbox',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const dedupKey='libra_candidate_accepted:'+decision.offerId,
        messageId=canonicalDigest({schema:'foundation.outbox-message-id@1',producerDomain:'libra',dedupKey});context.repository(foundation.repositoryId).invoke('insert_outbox',{
          message_id:messageId,producer_domain:'libra',message_kind:'libra_candidate_accepted',aggregate_type:'intake_decision',aggregate_id:decision.decisionId,aggregate_revision:1,dedup_key:dedupKey,
          consumer_set_digest:canonicalDigest(['procurement']),intended_consumer_count:1,payload_schema_ref:MESSAGE_SCHEMA,
          payload_json:canonicalJson(message),payload_digest:canonicalDigest(message),state:'pending',available_at_ms:context.commitTimeMs,created_at_ms:context.commitTimeMs,all_acked_at_ms:null});
        context.repository(foundation.repositoryId).invoke('insert_outbox_delivery',{message_id:messageId,consumer_domain:'procurement',state:'pending',attempt_count:0,next_attempt_at_ms:context.commitTimeMs,acked_at_ms:null});
        return {messageId,dedupKey,message};}};
      try{const values=options.unitOfWork.execute([preflight,domain,control,receiptWrite,result,marker,outbox]);return Object.freeze({replayed:false,decision,receipt,outbox:values.acceptance_outbox,commitMarker:markerId});}
      catch(error){if(error instanceof Replay)return Object.freeze({replayed:true,decision,receipt:error.receipt,outbox:undefined,commitMarker:markerId});throw error;}
    }
  });
}

module.exports=Object.freeze({IntakeAcceptanceStoreError,createIntakeAcceptanceStore});
