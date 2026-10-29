'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {validateRequirements}=require('./rule-template-contracts');
const SCHEMA='arca.collection-care-target@1';
const KEYS=['schemaRef','shelfEntryId','shelfId','inventoryRevision','contentProfile','structureKind','targetKind','targetRevision','intentId','intentDigest',
  'requirements','requirementsDigest','projectionDigest'];
const SHA=/^[a-f0-9]{64}$/;
function fail(){throw Object.assign(new Error('Current collection target projection is invalid.'),{code:'ARCA_COLLECTION_TARGET_INVALID'});}
function assertCollectionCareTarget(value,shelfEntryId,{shelfId,inventoryRevision}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||canonicalJson(Object.keys(value).sort())!==canonicalJson([...KEYS].sort())||
      value.schemaRef!==SCHEMA||value.shelfEntryId!==shelfEntryId||!['standard','user_custom'].includes(value.targetKind)||
      typeof value.shelfId!=='string'||!value.shelfId||shelfId!==undefined&&value.shelfId!==shelfId||
      !Number.isSafeInteger(value.inventoryRevision)||value.inventoryRevision<1||
      inventoryRevision!==undefined&&value.inventoryRevision!==Number(inventoryRevision)||
      !['movie','series','jav','western_adult'].includes(value.contentProfile)||
      !['single','season'].includes(value.structureKind)||
      (value.contentProfile==='series')!==(value.structureKind==='season')||
      value.targetKind==='user_custom'&&(value.contentProfile!=='movie'||value.structureKind!=='single')||
      !Number.isSafeInteger(value.targetRevision)||value.targetRevision<1||typeof value.intentId!=='string'||!value.intentId.trim()||
      value.intentId.length>256||!SHA.test(value.intentDigest||'')||!value.requirements||typeof value.requirements!=='object'||
      Array.isArray(value.requirements)||canonicalJson(Object.keys(value.requirements).sort())!==canonicalJson(
        ['identity','structure','metadata','mandatoryMedia','space','inventory'].sort())||
      Object.values(value.requirements).some(item=>!item||typeof item!=='object'||Array.isArray(item))||
      value.requirementsDigest!==canonicalDigest(value.requirements)||
      value.projectionDigest!==canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='projectionDigest')))||
      Buffer.byteLength(canonicalJson(value),'utf8')>64*1024)fail();
  try{validateRequirements(value.requirements,value.contentProfile,value.structureKind);}catch{fail();}
  return value;
}
module.exports=Object.freeze({SCHEMA,assertCollectionCareTarget});
