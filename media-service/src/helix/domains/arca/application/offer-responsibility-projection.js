'use strict';

const {canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {offerIdentity}=require('../model/offer-withdrawal');
const {COLUMNS:WITHDRAWAL_COLUMNS,decodeOfferWithdrawalRow}=require('../persistence/offer-withdrawal-store');

function fail(){throw Object.assign(new Error('Arca Offer responsibility evidence is inconsistent.'),
  {code:'ARCA_OFFER_RESPONSIBILITY_CORRUPT'});}

// The caller supplies an exact Libra public Offer and captures a Foundation
// read fence before this read. A later write must validate that same fence.
// Acceptance evidence is deliberately a blocking signal, not a claim that a
// complete Accepted receipt or collection commit has been reconstructed.
function createArcaOfferResponsibilityProjection(options){
  if(!options?.schemaManifest||!options.unitOfWork)throw new TypeError('Arca Offer responsibility requires clean persistence.');
  const statements={},sources=[
    ['attempt','arca_acceptance_attempts',['acceptance_attempt_id','offer_id','on_deck_package_id','package_digest','shelf_id','state']],
    ['decision','arca_acceptance_decisions',['acceptance_decision_id','offer_id','on_deck_package_id','package_digest','shelf_id','result']],
    ['receipt','arca_handoff_b_receipts',['receipt_id','offer_id','on_deck_package_id','package_digest','outcome']],
    ['withdrawal','arca_offer_withdrawal_receipts',WITHDRAWAL_COLUMNS],
  ];
  for(const [name,tableId,columns] of sources){
    statements[name+'_offer']={kind:'select-all',tableId,columns,keyColumns:['offer_id'],safeIntegers:true};
    statements[name+'_package']={kind:'select-all',tableId,columns,keyColumns:['on_deck_package_id'],safeIntegers:true};
  }
  statements.custody={kind:'select-all',tableId:'arca_ondeck_custodies',
    columns:['custody_id','on_deck_package_id','package_digest','state'],keyColumns:['on_deck_package_id']};
  const repository=createRepositoryDefinition({repositoryId:'arca_offer_responsibility_projection',owner:'arca',
    schemaManifest:options.schemaManifest,readOnly:true,statements});
  function read(input){
    const offer=offerIdentity(input);
    return options.unitOfWork.execute([{participantId:'arca_offer_responsibility_read',owner:'arca',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);
      function rows(name,key){
        const values=[...repo.invoke(name+'_offer',{offer_id:offer.offerId}),
          ...repo.invoke(name+'_package',{on_deck_package_id:offer.onDeckPackageId})],unique=new Map();
        for(const row of values){
          if(typeof row[key]!=='string'||!row[key]||row.offer_id!==offer.offerId||row.on_deck_package_id!==offer.onDeckPackageId||
              row.package_digest!==offer.packageDigest)fail();
          unique.set(row[key],row);
        }
        return [...unique.values()];
      }
      const attempts=rows('attempt','acceptance_attempt_id'),decisions=rows('decision','acceptance_decision_id'),
        receipts=rows('receipt','receipt_id'),withdrawals=rows('withdrawal','receipt_id'),
        custodies=repo.invoke('custody',{on_deck_package_id:offer.onDeckPackageId});
      if(attempts.some(row=>row.shelf_id!==offer.shelfId||!['active','accepted','rejected','administratively_retired'].includes(row.state))||
          decisions.some(row=>row.shelf_id!==offer.shelfId||!['accepted','rejected'].includes(row.result))||
          receipts.some(row=>!['accepted','rejected'].includes(row.outcome))||
          custodies.some(row=>!row.custody_id||row.package_digest!==offer.packageDigest||!['active','committed','released'].includes(row.state))||
          withdrawals.length>1)fail();
      const acceptancePresent=attempts.some(row=>row.state==='accepted')||decisions.some(row=>row.result==='accepted')||
        receipts.some(row=>row.outcome==='accepted')||custodies.length>0;
      if(withdrawals.length){
        if(acceptancePresent)fail();
        const receipt=decodeOfferWithdrawalRow(withdrawals[0]);
        if(canonicalJson(receipt.offer)!==canonicalJson(offer))fail();
        return Object.freeze({kind:'ready',offer,state:'withdrawn',withdrawalReceipt:receipt});
      }
      return Object.freeze({kind:'ready',offer,state:acceptancePresent?'acceptance_present':'not_accepted'});
    }}]).arca_offer_responsibility_read;
  }
  return Object.freeze({read});
}

module.exports=Object.freeze({createArcaOfferResponsibilityProjection});
