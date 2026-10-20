'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertPerson}=require('./us-adult-actor-refresh');
const {assertRecord,completeMatching}=require('./us-adult-actor-match-work');
const {assertSourcePrepared}=require('../../../contracts/us-adult-inventory-analysis');
const {SOURCE,sourceWork}=require('./us-adult-actor-refresh-execution');
const {SCHEMA,assertSelection}=require('../../../contracts/us-adult-actor-selection');
const REF_FIELDS=['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'];
function fail(message){throw Object.assign(new TypeError(message),{code:'ARCA_US_ADULT_ACTOR_SELECTION_INVALID'});}
function immutable(value){if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value;}
function buildSelection({intent,aftercareCaseId,sourceRecord,pages=[],records=[],contractValidator}){
  assertRecord(sourceRecord,sourceWork(intent,aftercareCaseId),SOURCE);
  assertSourcePrepared({intent,aftercareCaseId,result:sourceRecord.result,validator:contractValidator});
  let person,referenceAssetId,completion=null;
  if(intent.mode==='specified'){
    if(pages.length||records.length)fail('An explicitly chosen actor cannot import automatic match Results.');
    person=assertPerson(intent.manualPersonSnapshot,contractValidator);
    const contribution=person.referenceProjection.contributions[0],usable=new Set(contribution.activeFaces.map(face=>face.referenceAssetId));
    referenceAssetId=contribution.activeAssets.filter(asset=>usable.has(asset.referenceAssetId))
      .sort((left,right)=>Buffer.compare(Buffer.from(left.referenceAssetId),Buffer.from(right.referenceAssetId)))[0]?.referenceAssetId;
  }else{
    completion=completeMatching({intent,aftercareCaseId,pages,sourceRecord,records,contractValidator});
    if(!completion.winner)return Object.freeze({kind:'unchanged',reasonCode:'no_valid_match',completion});
    person=completion.winner.personSnapshot;referenceAssetId=completion.winner.match.referenceAssetId;
  }
  if(!referenceAssetId)fail('A target actor requires one exact active reference image.');
  const body={schemaRef:SCHEMA,schemaVersion:1,shelfEntryId:intent.shelfEntryId,aftercareCaseId,intentId:intent.intentId,intentDigest:intent.intentDigest,
    inventoryRevision:intent.inventoryRevision,representationDigest:intent.representationDigest,canonicalIdentityKey:intent.canonicalIdentityKey,
    canonicalIdentityRevision:intent.canonicalIdentityRevision,canonicalIdentityDigest:intent.canonicalIdentityDigest,deckFactRevision:intent.deckFactRevision,
    originalName:intent.originalName,rendererVersion:intent.rendererVersion,selectionOrigin:intent.mode==='specified'?'specified':'automatic_match',
    personSnapshot:person,referenceAssetId,sourceResultRef:Object.fromEntries(REF_FIELDS.map(key=>[key,sourceRecord[key]])),
    matchCompletion:completion?{completionDigest:completion.completionDigest,resultSetDigest:completion.resultSetDigest,completedPageCount:completion.completedPageCount,
      match:completion.winner.match,matchResultRef:completion.winner.resultRef}:null},
    selectionDigest=canonicalDigest(body),value={...body,selectionDigest};
  if(Buffer.byteLength(canonicalJson(value))>256*1024)fail('The exact target actor exceeds its frozen selection budget.');
  assertSelection(value,{shelfEntryId:intent.shelfEntryId,aftercareCaseId});
  return Object.freeze({kind:'selected',selection:immutable(JSON.parse(canonicalJson(value)))});
}
module.exports=Object.freeze({SCHEMA,buildSelection});
