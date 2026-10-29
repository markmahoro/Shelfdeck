'use strict';

const {canonicalJson}=require('./canonical-json');
const SCHEMA='libra.collection-target-reference@1';
const KEYS=['schemaRef','targetKind','intentId','intentDigest','targetRevision'];
function buildCollectionTargetReference(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||canonicalJson(Object.keys(value).sort())!==canonicalJson([...KEYS].sort())||
      value.schemaRef!==SCHEMA||!['user_custom','standard'].includes(value.targetKind)||
      ![value.intentId,value.intentDigest].every(item=>typeof item==='string'&&/^[a-f0-9]{64}$/.test(item))||
      !Number.isSafeInteger(value.targetRevision)||value.targetRevision<1)
    throw Object.assign(new TypeError('Collection target reference is invalid.'),{code:'LIBRA_COLLECTION_TARGET_REFERENCE_INVALID'});
  return Object.freeze({...value});
}
function collectionTargetReferenceSchema(){
  const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
  return {type:'object',additionalProperties:false,required:KEYS,properties:{schemaRef:{const:SCHEMA},
    targetKind:{enum:['user_custom','standard']},intentId:digest,intentDigest:digest,
    targetRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}}};
}
module.exports=Object.freeze({SCHEMA,buildCollectionTargetReference,collectionTargetReferenceSchema});
