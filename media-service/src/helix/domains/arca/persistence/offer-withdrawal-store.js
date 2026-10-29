'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {SCHEMA,offerIdentity,buildOfferWithdrawal,assertOfferWithdrawal}=require('../model/offer-withdrawal');
const COLUMNS=['offer_id','on_deck_package_id','package_revision','package_digest','receipt_id','receipt_schema_ref',
  'receipt_json','receipt_digest','closed_at_ms'];
function fail(code){throw Object.assign(new Error(code),{code});}
function decodeOfferWithdrawalRow(row){
  if(!row)return null;let value;
  try{value=assertOfferWithdrawal(JSON.parse(row.receipt_json));}catch{fail('ARCA_OFFER_WITHDRAWAL_CORRUPT');}
  if(row.receipt_json!==canonicalJson(value)||row.receipt_schema_ref!==SCHEMA||row.receipt_id!==value.receiptId||
      row.receipt_digest!==value.receiptDigest||row.offer_id!==value.offer.offerId||row.on_deck_package_id!==value.offer.onDeckPackageId||
      Number(row.package_revision)!==value.offer.packageRevision||row.package_digest!==value.offer.packageDigest||
      Number(row.closed_at_ms)!==value.closedAtMs)fail('ARCA_OFFER_WITHDRAWAL_CORRUPT');
  return value;
}
function createOfferWithdrawalStore(options){
  const repository=createRepositoryDefinition({repositoryId:'arca_offer_withdrawals',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'arca_offer_withdrawal_receipts',columns:COLUMNS,keyColumns:['offer_id'],safeIntegers:true},
    insert:{kind:'insert',tableId:'arca_offer_withdrawal_receipts',columns:COLUMNS},
    attempts:{kind:'select-all',tableId:'arca_acceptance_attempts',columns:['acceptance_attempt_id','state'],keyColumns:['offer_id']},
    decisions:{kind:'select-all',tableId:'arca_acceptance_decisions',columns:['result'],keyColumns:['offer_id']},
    custodies:{kind:'select-all',tableId:'arca_ondeck_custodies',columns:['custody_id'],keyColumns:['on_deck_package_id']},
    recovery:{kind:'select-one',tableId:'arca_acceptance_recovery_cases',columns:['on_deck_package_id','package_digest','recovery_state'],keyColumns:['offer_id']},
    resolve:{kind:'update',tableId:'arca_acceptance_recovery_cases',setColumns:['recovery_state','updated_at_ms','resolved_at_ms'],
      keyColumns:['offer_id'],compareColumns:[{column:'recovery_state',parameter:'expected_state'}]},
  }}),coordinator=createCommandCommitCoordinator(options);
  const decode=decodeOfferWithdrawalRow;
  function read(offerId){return options.unitOfWork.execute([{participantId:'arca_offer_withdrawal_read',owner:'arca',repositories:[repository],
    execute:context=>decode(context.repository(repository.repositoryId).invoke('find',{offer_id:offerId}))}]).arca_offer_withdrawal_read;}
  function admissionParticipant(receipt){
    const checked=assertOfferWithdrawal(receipt);
    return Object.freeze({participantId:'arca_withdrawn_offer_consumption',owner:'arca',repositories:[repository],execute(context){
      const stored=decode(context.repository(repository.repositoryId).invoke('find',{offer_id:checked.offer.offerId}));
      if(!stored||stored.receiptDigest!==checked.receiptDigest)fail('ARCA_OFFER_WITHDRAWAL_CORRUPT');
      return {offerId:stored.offer.offerId,receiptId:stored.receiptId,receiptDigest:stored.receiptDigest};
    }});
  }
  function close({offer:input,deliveryFence,readFence}){
    const offer=offerIdentity(input),commandId=canonicalDigest({schema:'arca.offer-withdrawal-command@1',offer}),
      requestDigest=canonicalDigest({schema:'arca.offer-withdrawal@1',offer,reasonCode:'target_not_current'});
    return coordinator.execute({readFence,command:{commandReceiptId:commandId,ownerDomain:'arca',commandContract:'arca.offer-withdrawal@1',
      callerScope:'arca.offer-lifecycle',idempotencyKey:offer.offerId,requestDigest,targetType:'handoff_b_offer',targetId:offer.offerId},
      domainParticipant:{participantId:'arca_offer_withdrawal_commit',owner:'arca',repositories:[repository],execute(context){
        if(!readFence)fail('ARCA_OFFER_WITHDRAWAL_READ_FENCE_REQUIRED');
        const repo=context.repository(repository.repositoryId);
        if(repo.invoke('attempts',{offer_id:offer.offerId}).some(row=>row.state==='accepted')||
            repo.invoke('decisions',{offer_id:offer.offerId}).some(row=>row.result==='accepted')||
            repo.invoke('custodies',{on_deck_package_id:offer.onDeckPackageId}).length)fail('ARCA_OFFER_ALREADY_ACCEPTED');
        if(repo.invoke('find',{offer_id:offer.offerId}))fail('ARCA_OFFER_WITHDRAWAL_CORRUPT');
        const receipt=buildOfferWithdrawal({offer,deliveryFence,closedAtMs:context.commitTimeMs}),
          current=repo.invoke('recovery',{offer_id:offer.offerId});
        if(current&&(current.on_deck_package_id!==offer.onDeckPackageId||current.package_digest!==offer.packageDigest||
            current.recovery_state==='administratively_retired'))fail('ARCA_OFFER_WITHDRAWAL_RECOVERY_CONFLICT');
        repo.invoke('insert',{offer_id:offer.offerId,on_deck_package_id:offer.onDeckPackageId,package_revision:offer.packageRevision,
          package_digest:offer.packageDigest,receipt_id:receipt.receiptId,receipt_schema_ref:SCHEMA,receipt_json:canonicalJson(receipt),
          receipt_digest:receipt.receiptDigest,closed_at_ms:receipt.closedAtMs});
        if(current&&repo.invoke('resolve',{offer_id:offer.offerId,recovery_state:'resolved',updated_at_ms:context.commitTimeMs,
          resolved_at_ms:context.commitTimeMs,expected_state:current.recovery_state}).changes!==1)fail('ARCA_OFFER_WITHDRAWAL_RECOVERY_CONFLICT');
        return receipt;
      }},commitMarker:{commitMarker:commandId,scopeType:'handoff_b_offer',scopeId:offer.offerId,commitDigest:requestDigest},
      auditRecords:[{auditId:commandId,actorType:'system',actorId:'arca.offer-lifecycle',action:'arca.offer.withdraw',
        scopeType:'handoff_b_offer',scopeId:offer.offerId,evidenceDigest:requestDigest}],
      resultEnvelope:receipt=>({resultSchemaRef:SCHEMA,resultRef:receipt})});
  }
  return Object.freeze({read,close,admissionParticipant});
}

// Cold Reset consumes only bounded Owner projections from its frozen source.
// The Operator determines whether a retained responsibility references an
// Offer; Arca validates the exact immutable withdrawal before it is selected.
function createFreshResetOfferWithdrawalRetention(options){
  const repository=createRepositoryDefinition({repositoryId:'arca_reset_offer_withdrawals',owner:'arca',
    schemaManifest:options.schemaManifest,readOnly:true,statements:{
      page:{kind:'select-page-after',tableId:'arca_offer_withdrawal_receipts',columns:COLUMNS,keyColumn:'offer_id',maxItems:128,safeIntegers:true},
      find:{kind:'select-one',tableId:'arca_offer_withdrawal_receipts',columns:COLUMNS,keyColumns:['offer_id'],safeIntegers:true},
      attempts:{kind:'select-all',tableId:'arca_acceptance_attempts',columns:['state'],keyColumns:['offer_id']},
      decisions:{kind:'select-all',tableId:'arca_acceptance_decisions',columns:['result'],keyColumns:['offer_id']},
      custodies:{kind:'select-all',tableId:'arca_ondeck_custodies',columns:['custody_id'],keyColumns:['on_deck_package_id']},
    }});
  function page(cursor=null){
    return options.unitOfWork.execute([{participantId:'arca_reset_offer_page',owner:'arca',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);
      return repo.invoke('page',{cursor,limit:128}).map(row=>decodeOfferWithdrawalRow(row));
    }}]).arca_reset_offer_page;
  }
  function assertNotAccepted(receipt){
    const value=assertOfferWithdrawal(receipt);
    return options.unitOfWork.execute([{participantId:'arca_reset_offer_check',owner:'arca',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),offer=value.offer;
      if(repo.invoke('attempts',{offer_id:offer.offerId}).some(row=>row.state==='accepted')||
          repo.invoke('decisions',{offer_id:offer.offerId}).some(row=>row.result==='accepted')||
          repo.invoke('custodies',{on_deck_package_id:offer.onDeckPackageId}).length)fail('ARCA_OFFER_WITHDRAWAL_CORRUPT');
      return true;
    }}]).arca_reset_offer_check;
  }
  function read(offerId){
    return options.unitOfWork.execute([{participantId:'arca_reset_offer_read',owner:'arca',repositories:[repository],execute(context){
      return decodeOfferWithdrawalRow(context.repository(repository.repositoryId).invoke('find',{offer_id:offerId}));
    }}]).arca_reset_offer_read;
  }
  return Object.freeze({page,read,assertNotAccepted});
}
module.exports=Object.freeze({COLUMNS,decodeOfferWithdrawalRow,createOfferWithdrawalStore,createFreshResetOfferWithdrawalRetention});
