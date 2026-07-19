'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const MESSAGE_SCHEMA='helix://contracts/types/LibraCandidateRejectedMessage/v1';
const CLOSURE_SCHEMA='helix://contracts/types/ProcurementCandidateRejectionClosureResult/v1';

class CandidateRejectionConsumerError extends Error {
  constructor(code, message, details = {}) { super(message); this.name='CandidateRejectionConsumerError'; this.code=code; this.details=details; }
}
function fail(code,message,details) { throw new CandidateRejectionConsumerError(code,message,details); }
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function compareUtf8(left,right){return Buffer.compare(Buffer.from(left,'utf8'),Buffer.from(right,'utf8'));}
function buildProcurementRejectionClosure(message,materialKeys){
  if(!Array.isArray(materialKeys)||materialKeys.length<1)fail('P8_REJECTION_CLOSURE_INPUT','Closure requires a non-empty exact Reservation set.');
  const keys=[...materialKeys].sort(compareUtf8);
  if(new Set(keys).size!==keys.length)fail('P8_REJECTION_CLOSURE_DUPLICATE','Closure Material keys must be unique.');
  const items=keys.map((materialKey)=>({materialKey,terminalDisposition:'handoff_rejected',terminalEvidenceDigest:message.receiptDigest}));
  const value={schemaRef:CLOSURE_SCHEMA,schemaVersion:1,offerId:message.offerId,candidatePackageId:message.candidatePackageId,
    packageRevision:message.packageRevision,packageDigest:message.packageDigest,acceptanceBasisDigest:message.acceptanceBasisDigest,
    terminalDeliveryState:'rejected',releasedMaterialCount:items.length,releasedMaterialSetDigest:canonicalDigest({
      schema:'procurement.handoff-a-rejected-released-material-set@1',items}),rejectionReceiptDigest:message.receiptDigest,closureDigest:''};
  value.closureDigest=canonicalDigest(without(value,'closureDigest'));return Object.freeze(value);
}

function procurementDefinition(schemaManifest) {
  return createRepositoryDefinition({repositoryId:'candidate_rejection_consumer',owner:'procurement',schemaManifest,statements:{
    find_delivery:{kind:'select-one',tableId:'proc_candidate_deliveries',columns:['offer_id','candidate_package_id','package_revision','package_digest',
      'acceptance_basis_digest','state','handoff_decision_id','handoff_decision_digest','handoff_receipt_id','handoff_receipt_digest',
      'terminal_evidence_digest','offered_at_ms','closed_at_ms'],keyColumns:['offer_id'],safeIntegers:true},
    reject_delivery:{kind:'update',tableId:'proc_candidate_deliveries',setColumns:['state','handoff_decision_id','handoff_decision_digest',
      'handoff_receipt_id','handoff_receipt_digest','terminal_evidence_digest','closed_at_ms'],keyColumns:['offer_id'],compareColumns:[
        {column:'state',parameter:'expected_state'},{column:'candidate_package_id',parameter:'expected_candidate_package_id'},
        {column:'package_revision',parameter:'expected_package_revision'},{column:'package_digest',parameter:'expected_package_digest'},
        {column:'acceptance_basis_digest',parameter:'expected_acceptance_basis_digest'}]},
    list_members:{kind:'select-all',tableId:'proc_run_materials',columns:['procurement_run_id','ordinal','material_key','selection_state',
      'candidate_package_id','terminal_disposition','terminal_evidence_digest'],keyColumns:['candidate_package_id'],safeIntegers:true},
    release_member:{kind:'update',tableId:'proc_run_materials',setColumns:['selection_state','terminal_disposition','terminal_evidence_digest',
      'reservation_updated_at_ms'],keyColumns:['procurement_run_id','ordinal'],compareColumns:[
        {column:'selection_state',parameter:'expected_selection_state'},{column:'candidate_package_id',parameter:'expected_candidate_package_id'},
        {column:'terminal_disposition',parameter:'expected_terminal_disposition',nullSafe:true},
        {column:'terminal_evidence_digest',parameter:'expected_terminal_evidence_digest',nullSafe:true}]}
  }});
}

function inboxDefinition(schemaManifest) {
  return createRepositoryDefinition({repositoryId:'candidate_rejection_inbox',owner:'execution-foundation',schemaManifest,statements:{
    find_message:{kind:'select-one',tableId:'fx_inbox',columns:['consumer_domain','message_id','dedup_key','received_at_ms','consumed_at_ms','result_digest'],keyColumns:['consumer_domain','message_id']},
    find_dedup:{kind:'select-one',tableId:'fx_inbox',columns:['consumer_domain','message_id','dedup_key','received_at_ms','consumed_at_ms','result_digest'],keyColumns:['consumer_domain','dedup_key']},
    insert_message:{kind:'insert',tableId:'fx_inbox',columns:['consumer_domain','message_id','dedup_key','received_at_ms','consumed_at_ms','result_digest']}
  }});
}

function validateEnvelope(envelope) {
  const message=envelope && envelope.payload;
  if (!message || message.schemaRef !== MESSAGE_SCHEMA || message.schemaVersion !== 1 || message.messageKind !== 'libra_candidate_rejected') {
    fail('P8_REJECTION_MESSAGE_INVALID','A typed Libra Candidate Rejected message is required.');
  }
  const dedupKey='libra_candidate_rejected:' + message.offerId;
  const messageId=canonicalDigest({schema:'foundation.outbox-message-id@1',producerDomain:'libra',dedupKey});
  if (envelope.messageId !== messageId || envelope.dedupKey !== dedupKey || envelope.producerDomain !== 'libra' ||
      envelope.consumerDomain !== 'procurement' || envelope.payloadSchemaRef !== MESSAGE_SCHEMA ||
      envelope.payloadDigest !== canonicalDigest(message)) fail('P8_REJECTION_MESSAGE_ENVELOPE','Message identity, dedup, routing, or payload digest is invalid.');
  return {message,messageId,dedupKey};
}

function createCandidateRejectionConsumer(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P8_REJECTION_CONSUMER_DEPENDENCIES','Schema manifest and scoped Unit of Work are required.');
  }
  const procurement=procurementDefinition(options.schemaManifest), inbox=inboxDefinition(options.schemaManifest);
  return Object.freeze({repositoryManifest:Object.freeze({procurementTableIds:procurement.tableIds,foundationTableIds:inbox.tableIds}),
    consume(envelope) {
      const {message,messageId,dedupKey}=validateEnvelope(envelope);
      let closure;
      const domain={participantId:'candidate_rejection_close',owner:'procurement',repositories:[procurement],execute(context){
        const repo=context.repository(procurement.repositoryId), delivery=repo.invoke('find_delivery',{offer_id:message.offerId});
        if (!delivery) fail('P8_REJECTION_DELIVERY_MISSING','Rejected Offer has no Procurement Candidate Delivery.');
        if (delivery.candidate_package_id !== message.candidatePackageId || Number(delivery.package_revision) !== message.packageRevision ||
            delivery.package_digest !== message.packageDigest || delivery.acceptance_basis_digest !== message.acceptanceBasisDigest) {
          fail('P8_REJECTION_DELIVERY_EVIDENCE_CONFLICT','Rejected message does not identify the exact Candidate Delivery.');
        }
        const members=repo.invoke('list_members',{candidate_package_id:message.candidatePackageId});
        if (members.length < 1) fail('P8_REJECTION_MEMBER_SET_EMPTY','Candidate Delivery must own a non-empty Reservation set.');
        closure=buildProcurementRejectionClosure(message,members.map((row)=>row.material_key));
        if (delivery.state === 'rejected') {
          if (delivery.handoff_decision_id !== message.intakeDecisionId || delivery.handoff_decision_digest !== message.decisionDigest ||
              delivery.handoff_receipt_id !== message.receiptId || delivery.handoff_receipt_digest !== message.receiptDigest ||
              delivery.terminal_evidence_digest !== message.receiptDigest || members.some((row)=>row.selection_state !== 'released' ||
                row.terminal_disposition !== 'handoff_rejected' || row.terminal_evidence_digest !== message.receiptDigest)) {
            fail('P8_REJECTION_TERMINAL_CONFLICT','Terminal Delivery or Reservation Evidence conflicts with the replayed rejection.');
          }
          return closure;
        }
        if (delivery.state !== 'open' || members.some((row)=>row.selection_state !== 'candidate_delivery' || row.terminal_disposition !== null ||
            row.terminal_evidence_digest !== null)) fail('P8_REJECTION_RESERVATION_STALE','Candidate Delivery or exact Reservation set is not open.');
        for (const row of members) {
          const changed=repo.invoke('release_member',{selection_state:'released',terminal_disposition:'handoff_rejected',
            terminal_evidence_digest:message.receiptDigest,reservation_updated_at_ms:context.commitTimeMs,procurement_run_id:row.procurement_run_id,
            ordinal:Number(row.ordinal),expected_selection_state:'candidate_delivery',expected_candidate_package_id:message.candidatePackageId,
            expected_terminal_disposition:null,expected_terminal_evidence_digest:null});
          if (changed.changes !== 1) fail('P8_REJECTION_RESERVATION_CAS','Candidate Reservation release CAS failed.');
        }
        const changed=repo.invoke('reject_delivery',{state:'rejected',handoff_decision_id:message.intakeDecisionId,
          handoff_decision_digest:message.decisionDigest,handoff_receipt_id:message.receiptId,handoff_receipt_digest:message.receiptDigest,
          terminal_evidence_digest:message.receiptDigest,closed_at_ms:context.commitTimeMs,offer_id:message.offerId,expected_state:'open',
          expected_candidate_package_id:message.candidatePackageId,expected_package_revision:message.packageRevision,
          expected_package_digest:message.packageDigest,expected_acceptance_basis_digest:message.acceptanceBasisDigest});
        if (changed.changes !== 1) fail('P8_REJECTION_DELIVERY_CAS','Candidate Delivery rejection CAS failed.');
        return closure;
      }};
      const inboxParticipant={participantId:'candidate_rejection_inbox',owner:'execution-foundation',boundBusinessOwner:'procurement',repositories:[inbox],execute(context){
        const repo=context.repository(inbox.repositoryId), existing=repo.invoke('find_message',{consumer_domain:'procurement',message_id:messageId}) ||
          repo.invoke('find_dedup',{consumer_domain:'procurement',dedup_key:dedupKey});
        if (existing) {
          if (existing.message_id !== messageId || existing.dedup_key !== dedupKey || existing.result_digest !== closure.closureDigest) {
            fail('P8_REJECTION_INBOX_CONFLICT','Inbox replay does not match the durable Procurement closure.');
          }
          return {replayed:true};
        }
        repo.invoke('insert_message',{consumer_domain:'procurement',message_id:messageId,dedup_key:dedupKey,
          received_at_ms:context.commitTimeMs,consumed_at_ms:context.commitTimeMs,result_digest:closure.closureDigest});
        return {replayed:false};
      }};
      const results=options.unitOfWork.execute([domain,inboxParticipant]);
      return Object.freeze({replayed:results.candidate_rejection_inbox.replayed,closure});
    }
  });
}

module.exports=Object.freeze({CandidateRejectionConsumerError,createCandidateRejectionConsumer});
