'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {originalNameProvenance,US_ADULT_PRESENTATION_VERSION}=require('./us-adult-presentation');
const {matchSchema}=require('./us-adult-inventory-matching');
const SCHEMA='helix://contracts/domain-types/UsAdultActorRefreshSelection/v1';
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),text=()=>({type:'string',minLength:1,maxLength:256}),
  integer=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}),object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
function resultReferenceSchema(){return object(Object.fromEntries(['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest']
  .map(key=>[key,key.endsWith('Digest')?digest():text()])));}
function selectionSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'UsAdultActorRefreshSelection@1',
  'x-helix-ssotRefs':['6.6.8','8.6.18'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':262144,
  ...object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},shelfEntryId:text(),aftercareCaseId:text(),intentId:digest(),intentDigest:digest(),
    inventoryRevision:integer(),representationDigest:digest(),canonicalIdentityKey:digest(),canonicalIdentityRevision:integer(),canonicalIdentityDigest:digest(),deckFactRevision:integer(),
    originalName:object({schema:{const:'us-adult-original-name@1'},originalFileName:{type:'string',minLength:1,maxLength:4096},provenanceDigest:digest()}),
    rendererVersion:{const:US_ADULT_PRESENTATION_VERSION},selectionOrigin:{enum:['specified','automatic_match']},
    personSnapshot:{$ref:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1'},referenceAssetId:text(),sourceResultRef:resultReferenceSchema(),
    matchCompletion:{oneOf:[{type:'null'},object({completionDigest:digest(),resultSetDigest:digest(),completedPageCount:integer(),match:matchSchema(),
      matchResultRef:object({...resultReferenceSchema().properties,pageOrdinal:{type:'integer',minimum:0},pageDigest:digest()})})]},selectionDigest:digest()})};}
function assertSelection(value,{shelfEntryId,aftercareCaseId,validator}={}){
  if(validator)validator.validate(SCHEMA,value);
  const {selectionDigest,...body}=value||{},person=value?.personSnapshot,{snapshotDigest,...personBody}=person||{},
    projection=person?.referenceProjection,contribution=projection?.contributions?.[0];
  if(value?.schemaRef!==SCHEMA||value.schemaVersion!==1||selectionDigest!==canonicalDigest(body)||Buffer.byteLength(canonicalJson(value))>262144||
      value.rendererVersion!==US_ADULT_PRESENTATION_VERSION||shelfEntryId&&value.shelfEntryId!==shelfEntryId||aftercareCaseId&&value.aftercareCaseId!==aftercareCaseId||
      canonicalJson(value.originalName)!==canonicalJson(originalNameProvenance(value.originalName?.originalFileName))||person?.libraryKind!=='us_adult'||
      snapshotDigest!==canonicalDigest(personBody)||projection.personId!==person.personId||projection.personRevision!==person.personRevision||
      projection.contributions.length!==1||contribution.ownerPersonId!==person.personId||contribution.inheritedReadOnly||
      !contribution.activeAssets.some(item=>item.referenceAssetId===value.referenceAssetId)||!contribution.activeFaces.some(item=>item.referenceAssetId===value.referenceAssetId)||
      value.selectionOrigin==='specified'&&value.matchCompletion!==null||value.selectionOrigin==='automatic_match'&&(!value.matchCompletion||
        value.matchCompletion.match.personId!==person.personId||value.matchCompletion.match.personRevision!==person.personRevision||
        value.matchCompletion.match.referenceAssetId!==value.referenceAssetId)||!['specified','automatic_match'].includes(value.selectionOrigin))
    throw Object.assign(new TypeError('Actor target selection lost its exact Case, original naming, frozen Person or complete match proof.'),{code:'ARCA_US_ADULT_ACTOR_SELECTION_INVALID'});
  return value;
}
module.exports=Object.freeze({SCHEMA,selectionSchema,resultReferenceSchema,assertSelection});
