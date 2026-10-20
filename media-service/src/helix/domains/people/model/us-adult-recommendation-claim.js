'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertPreparedRegistration}=require('./prepared-registration');
const ACTIVE=Object.freeze(['preparing_person','confirming_source']);
const PAYLOAD='people.us-adult-recommendation-claim@1',PERSON='people.us-adult-recommendation-person@1',ACK='people.us-adult-recommendation-ack@1';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256,hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),positive=value=>Number.isSafeInteger(value)&&value>0;
function invalid(){throw Object.assign(new TypeError('Recommendation claim differs from its exact source, actor or prepared registration.'),{code:'PEOPLE_RECOMMENDATION_CLAIM_INVALID'});}
function claimId(actorId,idempotencyKey){return canonicalDigest({schema:PAYLOAD,actorId,idempotencyKey});}
function assertPayload(value){
  if(!exact(value,['schema','claimId','actorId','recommendationId','publicationWindowKey','publicationRevision','source','imageEvidenceDigest','target'])||
    value.schema!==PAYLOAD||![value.claimId,value.recommendationId,value.imageEvidenceDigest].every(hash)||!id(value.actorId)||
    !positive(value.publicationWindowKey)||!positive(value.publicationRevision)||value.source?.schemaRef!=='helix://contracts/domain-types/UsAdultRecommendationSource/v1'||
    Buffer.byteLength(canonicalJson(value),'utf8')>131072)invalid();
  const {sourceDigest,...body}=value.source;if(canonicalDigest(body)!==sourceDigest)invalid();
  const target=value.target;
  if(target?.kind==='existing'){
    if(!exact(target,['kind','personId','expectedPersonRevision','expectedReferenceRevision'])||!id(target.personId)||
      !positive(target.expectedPersonRevision)||!positive(target.expectedReferenceRevision))invalid();
  }else if(target?.kind==='create'){
    if(!exact(target,['kind','preparedRegistration']))invalid();
    assertPreparedRegistration(target.preparedRegistration);if(target.preparedRegistration.actorId!==value.actorId)invalid();
  }else invalid();
  return value;
}
function personForExisting(target){return Object.freeze({schema:PERSON,personId:target.personId,personRevision:target.expectedPersonRevision,referenceRevision:target.expectedReferenceRevision});}
function assertPerson(value,payload){
  if(!exact(value,['schema','personId','personRevision','referenceRevision'])||value.schema!==PERSON||!id(value.personId)||!positive(value.personRevision)||!positive(value.referenceRevision))invalid();
  const target=payload.target;
  if(target.kind==='existing'&&(value.personId!==target.personId||value.personRevision!==target.expectedPersonRevision||value.referenceRevision!==target.expectedReferenceRevision)||
    target.kind==='create'&&(value.personId!==target.preparedRegistration.personId||value.personRevision!==1||value.referenceRevision!==1))invalid();
  return value;
}
function assertAck(value,payload,person){
  const receipt=value?.receipt;
  if(!exact(value,['schema','receipt'])||value.schema!==ACK||!person||receipt?.libraRunId!==payload.source.libraRunId||receipt.subjectId!==payload.source.subjectId||
    receipt.choiceRevision!==payload.source.expectedChoiceRevision+1||receipt.personId!==person.personId||receipt.personRevision!==person.personRevision||
    receipt.referenceRevision!==person.referenceRevision)invalid();
  return value;
}
module.exports=Object.freeze({ACTIVE,PAYLOAD,PERSON,ACK,claimId,assertPayload,personForExisting,assertPerson,assertAck});
