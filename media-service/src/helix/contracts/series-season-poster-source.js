'use strict';

const {canonicalDigest,canonicalJson}=require('./canonical-json');
const POLICY='shelfdeck.series-season-poster-source@1';
const SCHEMA='shelfdeck.series-season-poster-proof@1';
const DIGEST=/^[a-f0-9]{64}$/;
const fields=['schema','policyRef','providerKey','seasonNumber','basisDigest','sourceKind','seasonResult',
  'sourceQualificationDigest','sourceByteDigest','outputDigest','proofDigest'];
function fail(){throw Object.assign(new Error('Season poster must retain its exact same-show acquisition proof.'),{code:'SERIES_SEASON_POSTER_SOURCE_INVALID'});}
function assertPosterSourceProof(value){
  if(!value||canonicalJson(Object.keys(value).sort())!==canonicalJson([...fields].sort())||
      value.schema!==SCHEMA||value.policyRef!==POLICY||!/^\d+$/.test(value.providerKey||'')||
      !Number.isSafeInteger(value.seasonNumber)||value.seasonNumber<1||
      !['season_provider','series_local','series_provider'].includes(value.sourceKind)||
      value.seasonResult!==(value.sourceKind==='season_provider'?'acquired':'not_available')||
      !['basisDigest','sourceQualificationDigest','sourceByteDigest','outputDigest','proofDigest'].every(key=>DIGEST.test(value[key]||'')))fail();
  const {proofDigest,...body}=value;if(canonicalDigest(body)!==proofDigest)fail();return value;
}
function buildPosterSourceProof(value){const body={schema:SCHEMA,policyRef:POLICY,...value};return Object.freeze(assertPosterSourceProof({...body,proofDigest:canonicalDigest(body)}));}
function posterSourceProofSchema(){const digest={type:'string',pattern:'^[a-f0-9]{64}$'};return {
  type:'object',additionalProperties:false,required:fields,properties:{schema:{const:SCHEMA},policyRef:{const:POLICY},
    providerKey:{type:'string',pattern:'^\\d+$'},seasonNumber:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},
    basisDigest:digest,sourceKind:{enum:['season_provider','series_local','series_provider']},seasonResult:{enum:['acquired','not_available']},
    sourceQualificationDigest:digest,sourceByteDigest:digest,outputDigest:digest,proofDigest:digest},
  allOf:[{if:{properties:{sourceKind:{const:'season_provider'}}},then:{properties:{seasonResult:{const:'acquired'}}},else:{properties:{seasonResult:{const:'not_available'}}}}],
};}
module.exports=Object.freeze({POLICY,assertPosterSourceProof,buildPosterSourceProof,posterSourceProofSchema});
