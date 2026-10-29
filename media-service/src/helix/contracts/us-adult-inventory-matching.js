'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {faceModelReference}=require('./us-adult-face-model');
const MATCH='arca.us_adult.references.match@1',RESULT='helix://contracts/types/ArcaUsAdultPageMatch/v1';
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),text=()=>({type:'string',minLength:1,maxLength:256}),
  integer=(minimum=0)=>({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER}),object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
function matchSchema(){return object({personId:text(),personRevision:integer(1),referenceRevision:integer(1),projectionRevision:integer(1),projectionDigest:digest(),
  referenceAssetId:text(),artifactDigest:digest(),faceGroupId:{type:'string',pattern:'^arca-face-[a-f0-9]{64}$'},score:{type:'number',minimum:0.363,maximum:1},
  threshold:{type:'number',minimum:0,maximum:1},faceModelRefDigest:{const:faceModelReference('western_frame_set').digest},
  referenceModelRefDigest:{const:faceModelReference('single_reference_face').digest},confidenceClass:{const:'strong'},matchDigest:digest()});}
function pageMatchSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:RESULT,title:'ArcaUsAdultPageMatch@1',
  'x-helix-ssotRefs':['6.6.8','8.6.18'],'x-helix-envelopeRef':'helix://contracts/types/EvidenceEnvelope/v1','x-helix-maxCanonicalBytes':16384,
  ...object({schemaRef:{const:RESULT},schemaVersion:{const:1},evidenceId:text(),evidenceKind:{const:'arca_us_adult_page_match'},producerRef:{const:MATCH},
    basisDigest:digest(),payloadDigest:digest(),observedAtMs:integer(),shelfEntryId:text(),aftercareCaseId:text(),intentId:digest(),intentDigest:digest(),
    pageOrdinal:integer(),pageDigest:digest(),libraryDigest:digest(),sourceResultDigest:digest(),analysisDigest:digest(),
    matches:{type:'array',minItems:0,maxItems:1,items:matchSchema()}})};}
function fail(message){throw Object.assign(new TypeError(message),{code:'ARCA_US_ADULT_PAGE_MATCH_INVALID'});}
function assertMatch(match,page){
  const {matchDigest,...body}=match||{},person=page.items.find(item=>item.personId===match.personId),projection=person?.referenceProjection,
    contribution=projection?.contributions[0];
  if(!person||match.personRevision!==person.personRevision||match.referenceRevision!==projection.currentReferenceRevision||
      match.projectionRevision!==projection.projectionRevision||match.projectionDigest!==projection.projectionDigest||
      !contribution?.activeAssets.some(item=>item.referenceAssetId===match.referenceAssetId&&item.artifactDigest===match.artifactDigest)||
      !contribution.activeFaces.some(item=>item.referenceAssetId===match.referenceAssetId&&item.modelRef===match.referenceModelRefDigest)||
      matchDigest!==canonicalDigest(body))fail('Page match is outside its exact frozen Person, reference image and feature model.');
  return match;
}
const fields=['shelfEntryId','aftercareCaseId','intentId','intentDigest','pageOrdinal','pageDigest','libraryDigest','sourceResultDigest','analysisDigest','matches'];
function pageMatch({intent,aftercareCaseId,pageOrdinal,page,sourceResult,matches,atMs}){
  if(!Array.isArray(matches)||matches.length>1||sourceResult.detectedFaceCount===0&&matches.length)fail('A complete page publishes at most one valid actor.');
  const frozen=matches.map(raw=>{
    const person=page.items.find(item=>item.personId===raw.personId),projection=person?.referenceProjection;
    if(!person)fail('The highest candidate is absent from the frozen reference page.');
    const value={...raw,personRevision:person.personRevision,referenceRevision:projection.currentReferenceRevision,
      projectionRevision:projection.projectionRevision,projectionDigest:projection.projectionDigest},match={...value,matchDigest:canonicalDigest(value)};
    return Object.freeze(assertMatch(match,page));
  }),value={shelfEntryId:intent.shelfEntryId,aftercareCaseId,intentId:intent.intentId,intentDigest:intent.intentDigest,pageOrdinal,
    pageDigest:page.pageDigest,libraryDigest:page.libraryDigest,sourceResultDigest:canonicalDigest(sourceResult),analysisDigest:sourceResult.analysisDigest,matches:frozen},
    payloadDigest=canonicalDigest(value);
  return Object.freeze({schemaRef:RESULT,schemaVersion:1,evidenceId:'arca-us-match-'+payloadDigest,evidenceKind:'arca_us_adult_page_match',
    producerRef:MATCH,basisDigest:intent.intentDigest,payloadDigest,observedAtMs:atMs,...value});
}
function assertPageMatch({intent,aftercareCaseId,pageOrdinal,page,sourceResult,result,validator}){
  validator.validate(RESULT,result);
  if(result.shelfEntryId!==intent.shelfEntryId||result.aftercareCaseId!==aftercareCaseId||result.intentId!==intent.intentId||result.intentDigest!==intent.intentDigest||
      result.basisDigest!==intent.intentDigest||result.pageOrdinal!==pageOrdinal||result.pageDigest!==page.pageDigest||result.libraryDigest!==intent.libraryDigest||
      result.sourceResultDigest!==canonicalDigest(sourceResult)||result.analysisDigest!==sourceResult.analysisDigest||
      result.payloadDigest!==canonicalDigest(Object.fromEntries(fields.map(key=>[key,result[key]])))||result.evidenceId!=='arca-us-match-'+result.payloadDigest||
      Buffer.byteLength(canonicalJson(result))>16384||sourceResult.detectedFaceCount===0&&result.matches.length)fail('Page match lost its exact Case, source and complete frozen page provenance.');
  result.matches.forEach(match=>assertMatch(match,page));return result;
}
module.exports=Object.freeze({MATCH,RESULT,matchSchema,pageMatchSchema,pageMatch,assertPageMatch,assertMatch});
