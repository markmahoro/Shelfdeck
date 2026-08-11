'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

class IntakeOfferReaderError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'IntakeOfferReaderError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new IntakeOfferReaderError(code, message, details); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function decisionId(offerId) { return canonicalDigest({ schema:'libra.intake-decision-id@1', offerId }); }
function query(offer) {
  const value={queryContract:'procurement.candidate-delivery@1',offerId:offer.offerId,
    candidatePackageId:offer.candidatePackageId,packageRevision:offer.packageRevision,packageDigest:offer.packageDigest,
    acceptanceBasisDigest:offer.acceptanceBasisDigest,queryDigest:''};
  value.queryDigest=canonicalDigest(without(value,'queryDigest'));return Object.freeze(value);
}

function definition(schemaManifest) {
  return createRepositoryDefinition({repositoryId:'libra_intake_offer_reader',owner:'execution-foundation',schemaManifest,statements:{
    list_offer_messages:{kind:'select-all',tableId:'fx_outbox',columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id',
      'aggregate_revision','dedup_key','payload_schema_ref','payload_json','payload_digest','state','created_at_ms'],
      keyColumns:['producer_domain','message_kind'],safeIntegers:true},
  }});
}

function createIntakeOfferReader(options) {
  if(!options?.schemaManifest||!options.unitOfWork||!options.candidateDeliveryPort||
      typeof options.candidateDeliveryPort.readSnapshot!=='function'){
    fail('P14_INTAKE_OFFER_READER_DEPENDENCIES','Intake Offer reader requires Foundation persistence and Candidate Delivery Port.');
  }
  const repository=definition(options.schemaManifest);
  function list(){return options.unitOfWork.execute([{participantId:'libra_intake_offer_read',owner:'execution-foundation',repositories:[repository],
    execute:(context)=>context.repository(repository.repositoryId).invoke('list_offer_messages',{
      producer_domain:'procurement',message_kind:'procurement_candidate_offer_available'})}]).libra_intake_offer_read;}
  function envelope(row){let offer;try{offer=JSON.parse(row.payload_json);}catch{fail('P14_INTAKE_OFFER_JSON_CORRUPT','Offer Outbox payload is invalid JSON.');}
    if(row.payload_digest!==canonicalDigest(offer)||row.payload_json!==canonicalJson(offer)||
        offer.schemaRef!=='helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1'||offer.schemaVersion!==1||
        offer.messageKind!=='procurement_candidate_offer_available'||offer.acceptanceOwnerDomain!=='libra'||offer.targetContext!=='libra_intake'){
      fail('P14_INTAKE_OFFER_CONTRACT_CORRUPT','Offer Outbox payload is not the exact Handoff A contract.');
    }
    return Object.freeze({row,offer:Object.freeze(offer)});
  }
  function read(processId){const matches=list().map(envelope).filter((item)=>decisionId(item.offer.offerId)===processId);
    if(matches.length>1)fail('P14_INTAKE_PROCESS_OFFER_CONFLICT','One Intake technical process resolves multiple Offers.',{processId});
    if(matches.length===0)return null;const item=matches[0];const delivery=options.candidateDeliveryPort.readSnapshot(query(item.offer));
    if(!delivery||delivery.resultKind!=='found'||!delivery.snapshot)fail('P14_INTAKE_DELIVERY_UNAVAILABLE','Candidate Delivery Snapshot is unavailable.',{processId});
    if(delivery.snapshot.offer.offerId!==item.offer.offerId||delivery.snapshot.deliverySnapshotDigest!==
        canonicalDigest(without(delivery.snapshot,'deliverySnapshotDigest'))){
      fail('P14_INTAKE_DELIVERY_MISMATCH','Candidate Delivery Snapshot does not match the offered immutable identity.',{processId});
    }
    return Object.freeze({processId,offer:item.offer,messageId:item.row.message_id,dedupKey:item.row.dedup_key,snapshot:delivery.snapshot});
  }
  function listProcessPage(cursor,limit=100){const ids=list().map(envelope).map((item)=>decisionId(item.offer.offerId)).sort();
    const start=cursor?ids.findIndex((item)=>item>cursor):0;const offset=start<0?ids.length:start;
    const items=ids.slice(offset,offset+limit).map((processId)=>Object.freeze({processId}));
    return Object.freeze({items,nextCursor:offset+items.length<ids.length?items.at(-1).processId:null});
  }
  return Object.freeze({read,decisionId,query,listProcessPage});
}

module.exports=Object.freeze({IntakeOfferReaderError,createIntakeOfferReader,decisionId});
