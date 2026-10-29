'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {imageSourceSchema,assertImageSource}=require('./series-image-source');
const REQUEST='shelfdeck.series-presentation-maintenance@1',OBSERVED='shelfdeck.series-presentation-observed@1';
const text=maxLength=>({type:'string',minLength:1,maxLength}),digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const omit=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='basisDigest'));
function requestSchema(){return object({schema:{const:REQUEST},sourceObservation:object({schema:{const:'shelfdeck.series-source-request@1'},provider:{const:'tmdb'},namespace:{const:'tmdb_series'},providerKey:{type:'string',pattern:'^[0-9]+$'},seasonIdentityAnchorDigest:digest,integrationId:text(256),configRevision:{type:'integer',minimum:1},language:text(32),originalLanguage:{type:'string',maxLength:16}}),
  imageSourceQualification:imageSourceSchema(),entryBinding:object({shelfEntryId:text(256),shelfId:text(256),inventoryRevision:{type:'integer',minimum:1},identityRevision:{type:'integer',minimum:1},identityDigest:digest,inventoryDigest:digest,rootLocation:text(4096)}),basisDigest:digest});}
function observedSchema(sourceSchema){return object({schema:{const:OBSERVED},sourceObservation:sourceSchema(),requestDigest:digest,basisDigest:digest});}
function buildMaintenanceBasis(entryBinding,identity,qualification){
  assertImageSource(qualification);
  if(identity.provider!=='tmdb'||identity.namespace!=='tmdb_series'||identity.providerKey!==qualification.providerKey)throw new TypeError('Shared maintenance requires the committed Season identity.');
  const body={schema:REQUEST,sourceObservation:{schema:'shelfdeck.series-source-request@1',provider:'tmdb',namespace:'tmdb_series',providerKey:identity.providerKey,
    seasonIdentityAnchorDigest:identity.identityAnchorDigest,integrationId:qualification.integrationId,configRevision:qualification.configRevision,language:qualification.language,originalLanguage:qualification.originalLanguage},imageSourceQualification:qualification,entryBinding};
  return {...body,basisDigest:canonicalDigest(body)};
}
function assertMaintenanceBasis(value){
  const schema=requestSchema(),source=value?.sourceObservation,entry=value?.entryBinding;
  if(!value||value.schema!==REQUEST||canonicalJson(Object.keys(value).sort())!==canonicalJson(Object.keys(schema.properties).sort())||value.basisDigest!==canonicalDigest(omit(value))||
    !source||source.schema!=='shelfdeck.series-source-request@1'||source.provider!=='tmdb'||source.namespace!=='tmdb_series'||!/^\d+$/.test(source.providerKey)||!entry||!entry.shelfEntryId||!entry.rootLocation||
    !Number.isSafeInteger(entry.inventoryRevision)||entry.inventoryRevision<1||!Number.isSafeInteger(entry.identityRevision)||entry.identityRevision<1||
    [entry.identityDigest,entry.inventoryDigest,source.seasonIdentityAnchorDigest].some(item=>!/^[a-f0-9]{64}$/.test(item||'')))throw new TypeError('Invalid shared maintenance request.');
  const q=assertImageSource(value.imageSourceQualification);if(q.providerKey!==source.providerKey||q.integrationId!==source.integrationId||q.configRevision!==source.configRevision||q.language!==source.language)throw new TypeError('Shared maintenance qualification changed.');
  return value;
}
function observeMaintenanceBasis(request,source){assertMaintenanceBasis(request);
  if(source.providerKey!==request.sourceObservation.providerKey||source.seasonIdentityAnchorDigest!==request.sourceObservation.seasonIdentityAnchorDigest||source.integrationId!==request.imageSourceQualification.integrationId||source.configRevision!==request.imageSourceQualification.configRevision)
    throw new TypeError('Observed show metadata differs from the committed identity and qualification.');
  const body={schema:OBSERVED,sourceObservation:source,requestDigest:request.basisDigest};return {...body,basisDigest:canonicalDigest(body)};
}
module.exports=Object.freeze({REQUEST,OBSERVED,requestSchema,observedSchema,buildMaintenanceBasis,assertMaintenanceBasis,observeMaintenanceBasis});
