'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
function imageSourceSchema(){return {type:'object',additionalProperties:false,required:['schema','providerKey','integrationId','configRevision','language','originalLanguage','qualificationDigest'],properties:{
  schema:{const:'shelfdeck.series-image-source@1'},providerKey:{type:'string',pattern:'^[0-9]+$'},integrationId:{type:'string',minLength:1,maxLength:256},
  configRevision:{type:'integer',minimum:1},language:{type:'string',minLength:1,maxLength:32},originalLanguage:{type:'string',maxLength:16},qualificationDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}};}
function buildImageSource(source){const body={schema:'shelfdeck.series-image-source@1',providerKey:source.providerKey,integrationId:source.integrationId,
  configRevision:source.configRevision,language:source.language,originalLanguage:source.originalLanguage??''};return assertImageSource({...body,qualificationDigest:canonicalDigest(body)});}
function assertImageSource(value){if(!value||canonicalJson(Object.keys(value).sort())!==canonicalJson(imageSourceSchema().required.slice().sort())||
    value.schema!=='shelfdeck.series-image-source@1'||!/^\d+$/.test(value.providerKey)||!value.integrationId||!Number.isSafeInteger(value.configRevision)||value.configRevision<1||
    typeof value.language!=='string'||!value.language||value.language.length>32||typeof value.originalLanguage!=='string'||value.originalLanguage.length>16||
    value.qualificationDigest!==canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='qualificationDigest'))))
  throw Object.assign(new TypeError('Series image qualification is invalid.'),{code:'ARCA_SERIES_IMAGE_SOURCE_INVALID'});return value;}
module.exports=Object.freeze({imageSourceSchema,buildImageSource,assertImageSource});
