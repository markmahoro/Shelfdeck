'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { candidateProvenance } = require('../model/libra-intake-contracts');
const {
  DECISION_SCHEMA, MESSAGE_SCHEMA, RECEIPT_SCHEMA, REJECTION_SCHEMA,
  buildIntakeRejectionDecision, buildIntakeRejectionReceipt, buildLibraCandidateRejectedMessage
} = require('../model/intake-rejection-contracts');

const HANDLE_SCHEMA = 'helix://contracts/types/DomainFactCommitHandle/v1';
const SHA256 = /^[a-f0-9]{64}$/;

class IntakeRejectionStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'IntakeRejectionStoreError'; this.code = code; this.details = details; }
}
class Replay extends Error {
  constructor(decision, receipt, marker) { super('Handoff A rejection replay'); this.decision=decision; this.receipt=receipt; this.marker=marker; }
}
function fail(code, message, details) { throw new IntakeRejectionStoreError(code, message, details); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }

const DECISION_COLUMNS = ['intake_decision_id','decision_revision','decision_kind','offer_id','candidate_package_id','package_revision','package_digest',
  'acceptance_basis_digest','candidate_delivery_snapshot_digest','expected_continuity_head_revision','expected_continuity_head_digest',
  'source_field_id','source_field_access_revision','source_field_context_digest','candidate_structure_kind','candidate_content_profile','candidate_identity_claim_digest',
  'committed_continuity_head_revision','candidate_continuity_set_digest','candidate_episode_scope_digest','match_cardinality',
  'matched_subject_set_digest','episode_overlap_digest','accepted_result','target_subject_id','expected_target_status','expected_target_intake_revision',
  'expected_target_continuity_set_digest','expected_target_episode_scope_digest','committed_target_intake_revision',
  'committed_subject_continuity_set_digest','committed_subject_episode_scope_digest','accepted_payload_digest','rejection_schema_ref',
  'rejection_id','primary_rejection_code','rejection_reason_set_digest','rejection_digest','decision_digest','decided_at_ms'];
const RECEIPT_COLUMNS = ['receipt_id','intake_decision_id','outcome','offer_id','candidate_package_id','package_revision','package_digest',
  'candidate_delivery_snapshot_digest','subject_id','subject_intake_revision','subject_continuity_head_revision','subject_continuity_set_digest',
  'subject_episode_scope_digest','accepted_payload_digest','libra_binding_set_digest','control_revision_set_digest','rejection_id',
  'primary_rejection_code','rejection_reason_set_digest','rejection_digest','receipt_digest','committed_at_ms'];

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'libra_intake_rejection', owner:'libra', schemaManifest, statements:{
    find_decision:{ kind:'select-one', tableId:'libra_intake_decisions', columns:DECISION_COLUMNS, keyColumns:['intake_decision_id'], safeIntegers:true },
    find_offer_decision:{ kind:'select-one', tableId:'libra_intake_decisions', columns:DECISION_COLUMNS, keyColumns:['offer_id'], safeIntegers:true },
    insert_decision:{ kind:'insert', tableId:'libra_intake_decisions', columns:DECISION_COLUMNS },
    list_reasons:{ kind:'select-all', tableId:'libra_intake_rejection_reason_evidence', columns:['intake_decision_id','reason_ordinal','reason_code',
      'evidence_ordinal','evidence_schema_ref','evidence_id','evidence_digest','reason_digest'], keyColumns:['intake_decision_id'], safeIntegers:true },
    insert_reason:{ kind:'insert', tableId:'libra_intake_rejection_reason_evidence', columns:['intake_decision_id','reason_ordinal','reason_code',
      'evidence_ordinal','evidence_schema_ref','evidence_id','evidence_digest','reason_digest'] },
    find_receipt:{ kind:'select-one', tableId:'libra_handoff_a_receipts', columns:RECEIPT_COLUMNS, keyColumns:['intake_decision_id'], safeIntegers:true },
    insert_receipt:{ kind:'insert', tableId:'libra_handoff_a_receipts', columns:RECEIPT_COLUMNS }
  }});
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'libra_intake_rejection_foundation', owner:'execution-foundation', schemaManifest, statements:{
    find_marker:{ kind:'select-one', tableId:'fx_commit_markers', columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'], keyColumns:['commit_marker'] },
    find_result:{ kind:'select-one', tableId:'fx_event_result_bindings', columns:['result_id','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id'], keyColumns:['result_id'] },
    insert_result:{ kind:'insert', tableId:'fx_event_result_bindings', columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'] },
    insert_marker:{ kind:'insert', tableId:'fx_commit_markers', columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'] },
    insert_outbox:{ kind:'insert', tableId:'fx_outbox', columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id','aggregate_revision','dedup_key','consumer_set_digest','intended_consumer_count','payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms','all_acked_at_ms'] }
  }});
}

function validateHandle(handle, decision) {
  if (!handle || handle.schemaRef !== HANDLE_SCHEMA || handle.schemaVersion !== 1 || handle.ownerDomain !== 'libra' ||
      handle.aggregateType !== 'intake_decision' || handle.aggregateId !== decision.intakeDecisionId ||
      handle.factType !== 'IntakeRejectionDecision' || handle.factSchemaRef !== DECISION_SCHEMA || handle.expectedRevision !== 0 ||
      handle.payloadDigest !== decision.decisionDigest || handle.resultSchemaRef !== DECISION_SCHEMA ||
      typeof handle.commitIdempotencyKey !== 'string' || !handle.commitIdempotencyKey || !SHA256.test(handle.eventFenceDigest || '')) {
    fail('P8_REJECTION_HANDLE_MISMATCH', 'Commit Handle does not authorize this exact immutable rejection Decision.');
  }
}

function decisionFromRows(row, reasonRows) {
  const grouped = new Map();
  for (const item of reasonRows) {
    const key=Number(item.reason_ordinal); let reason=grouped.get(key);
    if (!reason) { reason={ reasonCode:item.reason_code, evidenceRefs:[], reasonDigest:item.reason_digest }; grouped.set(key,reason); }
    if (reason.reasonCode !== item.reason_code || reason.reasonDigest !== item.reason_digest) fail('P8_REJECTION_REPLAY_CORRUPT', 'Stored reason group is inconsistent.');
    reason.evidenceRefs.push({ evidenceSchemaRef:item.evidence_schema_ref, evidenceId:item.evidence_id, evidenceDigest:item.evidence_digest });
  }
  const reasons=[...grouped.entries()].sort((a,b)=>a[0]-b[0]).map(([,reason])=>reason);
  const structuredRejection={ rejectionId:row.rejection_id, handoffKind:'procurement_to_libra', offerId:row.offer_id,
    deliverableId:row.candidate_package_id, deliverableRevision:Number(row.package_revision), deliverableDigest:row.package_digest,
    decisionBasisDigest:row.acceptance_basis_digest, observedSnapshotDigest:row.candidate_delivery_snapshot_digest,
    reasonCodes:reasons.map((reason)=>reason.reasonCode), primaryRejectionCode:row.primary_rejection_code, reasons,
    rejectionReasonSetDigest:row.rejection_reason_set_digest, rejectionDigest:row.rejection_digest, decidedAtMs:Number(row.decided_at_ms) };
  const decision={ intakeDecisionId:row.intake_decision_id, decisionRevision:Number(row.decision_revision), offerId:row.offer_id,
    candidatePackageId:row.candidate_package_id, packageRevision:Number(row.package_revision), packageDigest:row.package_digest,
    acceptanceBasisDigest:row.acceptance_basis_digest, candidateDeliverySnapshotDigest:row.candidate_delivery_snapshot_digest,
    structuredRejection, decisionDigest:row.decision_digest };
  if (canonicalDigest(without(structuredRejection,'rejectionDigest')) !== structuredRejection.rejectionDigest ||
      canonicalDigest(without(decision,'decisionDigest')) !== decision.decisionDigest) fail('P8_REJECTION_REPLAY_CORRUPT', 'Stored rejection Decision digest is invalid.');
  return Object.freeze(decision);
}

function receiptFromRow(row, decision) {
  const receipt={ schemaRef:RECEIPT_SCHEMA, schemaVersion:1, receiptId:row.receipt_id, receiptKind:'handoff_a_rejected', ownerDomain:'libra',
    scopeType:'intake_decision', scopeId:decision.intakeDecisionId, scopeDigest:decision.decisionDigest, effectReceiptRef:null,
    committedAtMs:Number(row.committed_at_ms), intakeDecisionId:decision.intakeDecisionId, handoffKind:'procurement_to_libra',
    offerId:row.offer_id, deliverableId:row.candidate_package_id, deliverableRevision:Number(row.package_revision),
    deliverableDigest:row.package_digest, rejectionId:row.rejection_id, primaryRejectionCode:row.primary_rejection_code,
    rejectionReasonSetDigest:row.rejection_reason_set_digest, rejectionDigest:row.rejection_digest, receiptDigest:row.receipt_digest };
  if (canonicalDigest(without(receipt,'receiptDigest')) !== receipt.receiptDigest) fail('P8_REJECTION_REPLAY_CORRUPT', 'Stored rejection Receipt digest is invalid.');
  return Object.freeze(receipt);
}

function createIntakeRejectionStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P8_REJECTION_STORE_DEPENDENCIES', 'Schema manifest and scoped Unit of Work are required.');
  }
  const libra=libraDefinition(options.schemaManifest), foundation=foundationDefinition(options.schemaManifest);
  return Object.freeze({ repositoryManifest:Object.freeze({ libraTableIds:libra.tableIds, foundationTableIds:foundation.tableIds }),
    reject(request) {
      if (!request || !request.deliverySnapshot || !request.commitMarker || !request.resultBinding) fail('P8_REJECTION_REQUEST_INVALID', 'Rejection request is incomplete.');
      const decision=buildIntakeRejectionDecision({ deliverySnapshot:request.deliverySnapshot, reasons:request.reasons, decidedAtMs:request.decidedAtMs });
      const provenance=candidateProvenance(request.deliverySnapshot);
      validateHandle(request.domainFactCommitHandle,decision);
      const markerId=request.commitMarker.commitMarker, commitDigest=request.commitMarker.commitDigest, binding=request.resultBinding;
      if (typeof markerId !== 'string' || !markerId || !SHA256.test(commitDigest || '') || typeof binding.resultId !== 'string' || !binding.resultId ||
          typeof binding.eventId !== 'string' || !binding.eventId) fail('P8_REJECTION_REQUEST_INVALID', 'Commit Marker and Result binding identities are required.');
      let receipt, message;
      const preflight={ participantId:'intake_rejection_preflight', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        const repo=context.repository(foundation.repositoryId), marker=repo.invoke('find_marker',{commit_marker:markerId});
        if (!marker) return;
        if (marker.owner_domain !== 'libra' || marker.scope_type !== 'intake_decision' || marker.scope_id !== decision.intakeDecisionId ||
            marker.commit_digest !== commitDigest || marker.result_schema_ref !== DECISION_SCHEMA) fail('P8_REJECTION_MARKER_CONFLICT', 'Commit Marker belongs to another fact.');
        const result=repo.invoke('find_result',{result_id:marker.result_id});
        if (!result || result.result_schema_ref !== DECISION_SCHEMA || result.result_digest !== marker.result_digest ||
            result.result_digest !== decision.decisionDigest || result.evidence_schema_ref !== RECEIPT_SCHEMA) fail('P8_REJECTION_REPLAY_CORRUPT', 'Commit Marker Result is missing or inconsistent.');
      }};
      const write={ participantId:'intake_rejection_write', owner:'libra', repositories:[libra], execute(context) {
        const repo=context.repository(libra.repositoryId), existing=repo.invoke('find_offer_decision',{offer_id:decision.offerId});
        if (existing) {
          if (existing.intake_decision_id !== decision.intakeDecisionId || existing.decision_digest !== decision.decisionDigest || existing.decision_kind !== 'rejected_acceptance') {
            fail('P8_REJECTION_OFFER_TERMINAL_CONFLICT', 'Offer already has a different immutable Intake Decision.');
          }
          const restored=decisionFromRows(existing,repo.invoke('list_reasons',{intake_decision_id:decision.intakeDecisionId}));
          const receiptRow=repo.invoke('find_receipt',{intake_decision_id:decision.intakeDecisionId});
          if (!receiptRow) fail('P8_REJECTION_REPLAY_CORRUPT', 'Rejected Decision has no matching Receipt.');
          throw new Replay(restored,receiptFromRow(receiptRow,restored),markerId);
        }
        const rejection=decision.structuredRejection;
        const nulls={ expected_continuity_head_revision:null,expected_continuity_head_digest:null,committed_continuity_head_revision:null,
          candidate_continuity_set_digest:null,candidate_episode_scope_digest:null,match_cardinality:null,matched_subject_set_digest:null,
          episode_overlap_digest:null,accepted_result:null,target_subject_id:null,expected_target_status:null,expected_target_intake_revision:null,
          expected_target_continuity_set_digest:null,expected_target_episode_scope_digest:null,committed_target_intake_revision:null,
          committed_subject_continuity_set_digest:null,committed_subject_episode_scope_digest:null,accepted_payload_digest:null };
        repo.invoke('insert_decision',{ intake_decision_id:decision.intakeDecisionId,decision_revision:1,decision_kind:'rejected_acceptance',
          offer_id:decision.offerId,candidate_package_id:decision.candidatePackageId,package_revision:decision.packageRevision,
          package_digest:decision.packageDigest,acceptance_basis_digest:decision.acceptanceBasisDigest,
          candidate_delivery_snapshot_digest:decision.candidateDeliverySnapshotDigest,source_field_id:provenance.sourceFieldId,
          source_field_access_revision:provenance.sourceFieldAccessRevision,source_field_context_digest:provenance.sourceFieldContextDigest,
          candidate_structure_kind:provenance.candidateStructureKind,candidate_content_profile:provenance.candidateContentProfile,
          candidate_identity_claim_digest:provenance.candidateIdentityClaimDigest,...nulls,rejection_schema_ref:REJECTION_SCHEMA,
          rejection_id:rejection.rejectionId,primary_rejection_code:rejection.primaryRejectionCode,
          rejection_reason_set_digest:rejection.rejectionReasonSetDigest,rejection_digest:rejection.rejectionDigest,
          decision_digest:decision.decisionDigest,decided_at_ms:rejection.decidedAtMs });
        rejection.reasons.forEach((reason,reasonOrdinal)=>reason.evidenceRefs.forEach((evidence,evidenceOrdinal)=>repo.invoke('insert_reason',{
          intake_decision_id:decision.intakeDecisionId,reason_ordinal:reasonOrdinal,reason_code:reason.reasonCode,evidence_ordinal:evidenceOrdinal,
          evidence_schema_ref:evidence.evidenceSchemaRef,evidence_id:evidence.evidenceId,evidence_digest:evidence.evidenceDigest,reason_digest:reason.reasonDigest })));
        receipt=buildIntakeRejectionReceipt(decision,context.commitTimeMs);
        repo.invoke('insert_receipt',{ receipt_id:receipt.receiptId,intake_decision_id:decision.intakeDecisionId,outcome:'rejected',
          offer_id:decision.offerId,candidate_package_id:decision.candidatePackageId,package_revision:decision.packageRevision,
          package_digest:decision.packageDigest,candidate_delivery_snapshot_digest:decision.candidateDeliverySnapshotDigest,
          subject_id:null,subject_intake_revision:null,subject_continuity_head_revision:null,subject_continuity_set_digest:null,
          subject_episode_scope_digest:null,accepted_payload_digest:null,libra_binding_set_digest:null,control_revision_set_digest:null,
          rejection_id:rejection.rejectionId,primary_rejection_code:rejection.primaryRejectionCode,
          rejection_reason_set_digest:rejection.rejectionReasonSetDigest,rejection_digest:rejection.rejectionDigest,
          receipt_digest:receipt.receiptDigest,committed_at_ms:context.commitTimeMs });
        message=buildLibraCandidateRejectedMessage(decision,receipt);
        return decision;
      }};
      const result={ participantId:'intake_rejection_result', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        context.repository(foundation.repositoryId).invoke('insert_result',{ result_id:binding.resultId,event_id:binding.eventId,outcome_kind:'succeeded',
          result_schema_ref:DECISION_SCHEMA,result_json:canonicalJson(decision),result_digest:decision.decisionDigest,evidence_schema_ref:RECEIPT_SCHEMA,
          evidence_json:canonicalJson(receipt),evidence_digest:receipt.receiptDigest,effect_receipt_id:receipt.receiptId,committed_at_ms:context.commitTimeMs });
      }};
      const marker={ participantId:'intake_rejection_marker', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        context.repository(foundation.repositoryId).invoke('insert_marker',{ commit_marker:markerId,effect_id:request.commitMarker.effectId || null,
          owner_domain:'libra',scope_type:'intake_decision',scope_id:decision.intakeDecisionId,commit_digest:commitDigest,result_id:binding.resultId,
          result_schema_ref:DECISION_SCHEMA,result_digest:decision.decisionDigest,committed_at_ms:context.commitTimeMs });
      }};
      const outbox={ participantId:'intake_rejection_outbox', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        const dedupKey='libra_candidate_rejected:' + decision.offerId;
        const messageId=canonicalDigest({schema:'foundation.outbox-message-id@1',producerDomain:'libra',dedupKey});
        context.repository(foundation.repositoryId).invoke('insert_outbox',{ message_id:messageId,producer_domain:'libra',message_kind:'libra_candidate_rejected',
          aggregate_type:'intake_decision',aggregate_id:decision.intakeDecisionId,aggregate_revision:1,dedup_key:dedupKey,
          consumer_set_digest:canonicalDigest({schema:'foundation.outbox-consumer-set@1',consumers:['procurement']}),intended_consumer_count:1,
          payload_schema_ref:MESSAGE_SCHEMA,payload_json:canonicalJson(message),payload_digest:canonicalDigest(message),state:'pending',
          available_at_ms:context.commitTimeMs,created_at_ms:context.commitTimeMs,all_acked_at_ms:null });
        return Object.freeze({messageId,dedupKey,message});
      }};
      try {
        const values=options.unitOfWork.execute([preflight,write,result,marker,outbox]);
        return Object.freeze({replayed:false,decision,receipt,outbox:values.intake_rejection_outbox,commitMarker:markerId});
      } catch (error) {
        if (error instanceof Replay) return Object.freeze({replayed:true,decision:error.decision,receipt:error.receipt,outbox:undefined,commitMarker:error.marker});
        throw error;
      }
    }
  });
}

module.exports=Object.freeze({ IntakeRejectionStoreError, createIntakeRejectionStore });
