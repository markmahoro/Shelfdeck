'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {faceModelReference}=require('../../../contracts/us-adult-face-model');
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function name(value){return typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);}
function assertPreparedRegistration(prepared){
  const {operationId,personId,actorId,idempotencyKey,requestDigest,payload}=prepared||{};
  if(!exact(prepared,['schema','operationId','personId','actorId','idempotencyKey','requestDigest','payload'])||
    !exact(payload,['schema','operationKind','expectedPersonRevision','expectedReferenceRevision','operationId','personId','actorId','canonicalName','aliases','selectedImage','faceModelRef'])||
    prepared.schema!=='people.prepared-registration@1'||typeof actorId!=='string'||!actorId||actorId.length>256||
    typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>128||!/^[a-f0-9]{64}$/.test(requestDigest)||
    operationId!==stable('people-image-operation-',{actorId,key:idempotencyKey})||personId!==stable('person-',operationId)||
    payload.schema!=='people.image-operation-request@1'||payload.operationKind!=='registration'||payload.expectedPersonRevision!==1||payload.expectedReferenceRevision!==0||
    payload.operationId!==operationId||payload.personId!==personId||payload.actorId!==actorId||!name(payload.canonicalName)||payload.canonicalName.trim()!==payload.canonicalName||
    !Array.isArray(payload.aliases)||payload.aliases.length<1||payload.aliases.length>33||payload.aliases.some(value=>!name(value)||value.trim()!==value)||
    payload.aliases[0]!==payload.canonicalName||new Set(payload.aliases.map(value=>value.toLocaleLowerCase())).size!==payload.aliases.length||
    canonicalJson(payload.faceModelRef)!==canonicalJson(faceModelReference('single_reference_face'))||Buffer.byteLength(canonicalJson(prepared),'utf8')>16384)
    throw Object.assign(new TypeError('Persistent registration differs from its controlled image preparation.'),{code:'PEOPLE_REGISTRATION_INPUT_INVALID'});
  return prepared;
}
module.exports=Object.freeze({assertPreparedRegistration});
