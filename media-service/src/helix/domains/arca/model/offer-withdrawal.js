'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const SCHEMA='arca.offer-withdrawal-receipt@1',REASON='target_not_current';
const OFFER_KEYS=['offerId','onDeckPackageId','packageRevision','packageDigest','shelfId','libraRunId','subjectId',
  'acceptanceSpecId','relatedDispositionSetDigest'];
const FENCE_KEYS=['eligibility','reasonCode','libraRunId','runState','runStateRevision','runStateDigest',
  'acceptanceSpecId','packageRevisionHead','deliveryReceiptAbsent','fenceDigest'];
const SHA=/^[a-f0-9]{64}$/;
function fail(){throw Object.assign(new Error('Offer withdrawal evidence is incomplete or inconsistent.'),{code:'ARCA_OFFER_WITHDRAWAL_INVALID'});}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function offerIdentity(input){
  if(!input||typeof input!=='object')fail();
  const value=Object.fromEntries(OFFER_KEYS.map(key=>[key,input[key]]));
  for(const key of OFFER_KEYS.filter(key=>key!=='packageRevision'))
    if(typeof value[key]!=='string'||!value[key].trim()||Buffer.byteLength(value[key])>256)fail();
  if(!Number.isSafeInteger(value.packageRevision)||value.packageRevision<1||!SHA.test(value.packageDigest)||
      !SHA.test(value.relatedDispositionSetDigest)||value.offerId!==canonicalDigest({schema:'libra.product-offer-id@1',
        onDeckPackageId:value.onDeckPackageId,packageDigest:value.packageDigest}))fail();
  return Object.freeze(value);
}
function checkedFence(offer,input){
  if(!exactKeys(input,FENCE_KEYS)||input.eligibility!=='ineligible'||input.reasonCode!==REASON||
      input.libraRunId!==offer.libraRunId||input.acceptanceSpecId!==offer.acceptanceSpecId||input.deliveryReceiptAbsent!==true||
      !['active','suspended','frozen','superseded','completed','discarded'].includes(input.runState)||
      !Number.isSafeInteger(input.runStateRevision)||input.runStateRevision<1||!SHA.test(input.runStateDigest)||
      !Number.isSafeInteger(input.packageRevisionHead)||input.packageRevisionHead<offer.packageRevision)fail();
  const {fenceDigest,...body}=input;
  if(!SHA.test(fenceDigest)||canonicalDigest(body)!==fenceDigest)fail();
  return Object.freeze({...body,fenceDigest});
}
function buildOfferWithdrawal({offer:input,deliveryFence,closedAtMs}){
  const offer=offerIdentity(input),fence=checkedFence(offer,deliveryFence);
  if(!Number.isSafeInteger(closedAtMs)||closedAtMs<0)fail();
  const value={schemaRef:SCHEMA,receiptId:canonicalDigest({schema:'arca.offer-withdrawal-id@1',offerId:offer.offerId,
    packageDigest:offer.packageDigest}),ownerDomain:'arca',reasonCode:REASON,offer,deliveryFence:fence,closedAtMs};
  const result={...value,receiptDigest:canonicalDigest(value)};
  if(Buffer.byteLength(canonicalJson(result))>16*1024)fail();
  return Object.freeze(result);
}
function assertOfferWithdrawal(value){
  if(!exactKeys(value,['schemaRef','receiptId','ownerDomain','reasonCode','offer','deliveryFence','closedAtMs','receiptDigest']))fail();
  const expected=buildOfferWithdrawal(value);
  if(canonicalJson(expected)!==canonicalJson(value))fail();
  return Object.freeze({...expected,offer:Object.freeze(expected.offer),deliveryFence:Object.freeze(expected.deliveryFence)});
}
module.exports=Object.freeze({SCHEMA,REASON,offerIdentity,buildOfferWithdrawal,assertOfferWithdrawal});
