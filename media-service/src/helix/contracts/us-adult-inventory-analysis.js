'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {faceModelReference}=require('./us-adult-face-model');
const readAuthority=require('./us-adult-inventory-read-handle');
const SOURCE='arca.us_adult.source.prepare@1',RESULT='helix://contracts/types/ArcaUsAdultSourcePrepared/v1';
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),text=()=>({type:'string',minLength:1,maxLength:256}),
  integer=()=>({type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}),object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const workspace=()=>({$ref:'helix://contracts/types/WorkspaceMaterialHandle/v1'});
function sourcePreparedSchema(){
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:RESULT,title:'ArcaUsAdultSourcePrepared@1','x-helix-ssotRefs':['6.6.8','8.6.18'],
    'x-helix-envelopeRef':'helix://contracts/types/EvidenceEnvelope/v1','x-helix-maxCanonicalBytes':16384,
    ...object({schemaRef:{const:RESULT},schemaVersion:{const:1},evidenceId:text(),evidenceKind:{const:'arca_us_adult_source_prepared'},producerRef:{const:SOURCE},
      basisDigest:digest(),payloadDigest:digest(),observedAtMs:integer(),shelfEntryId:text(),aftercareCaseId:text(),intentId:digest(),intentDigest:digest(),
      sourceHandle:{$ref:'helix://contracts/types/PhysicalMaterialReadHandle/v1'},sourceProbeDigest:digest(),durationMs:{...integer(),minimum:1},
      container:text(),frameCount:{const:20},detectedFaceCount:{type:'integer',minimum:0,maximum:1280},analysisDigest:digest(),
      faceModelRefDigest:{const:faceModelReference('western_frame_set').digest},referenceModelRefDigest:{const:faceModelReference('single_reference_face').digest},
      frameManifestHandle:workspace(),featuresHandle:workspace()})};
}
const fields=['shelfEntryId','aftercareCaseId','intentId','intentDigest','sourceHandle','sourceProbeDigest','durationMs','container','frameCount',
  'detectedFaceCount','analysisDigest','faceModelRefDigest','referenceModelRefDigest','frameManifestHandle','featuresHandle'];
function sourcePrepared({intent,aftercareCaseId,sourceHandle,sourceProbeDigest,durationMs,container,analysis,frameManifestHandle,featuresHandle,atMs}){
  const value={shelfEntryId:intent.shelfEntryId,aftercareCaseId,intentId:intent.intentId,intentDigest:intent.intentDigest,sourceHandle,sourceProbeDigest,
    durationMs,container,frameCount:20,detectedFaceCount:analysis.detectedFaceCount,analysisDigest:analysis.analysisDigest,
    faceModelRefDigest:analysis.modelRef.digest,referenceModelRefDigest:analysis.referenceModelRefDigest,frameManifestHandle,featuresHandle},payloadDigest=canonicalDigest(value);
  return Object.freeze({schemaRef:RESULT,schemaVersion:1,evidenceId:'arca-us-source-'+payloadDigest,evidenceKind:'arca_us_adult_source_prepared',
    producerRef:SOURCE,basisDigest:intent.intentDigest,payloadDigest,observedAtMs:atMs,...value});
}
function assertSourcePrepared({intent,aftercareCaseId,result,validator}){
  if(typeof validator?.validate!=='function')throw new TypeError('Actor source Result requires nominal contract validation.');
  validator.validate(RESULT,result);
  const value=Object.fromEntries(fields.map(key=>[key,result[key]]));
  if(result.shelfEntryId!==intent.shelfEntryId||result.aftercareCaseId!==aftercareCaseId||result.intentId!==intent.intentId||result.intentDigest!==intent.intentDigest||
      result.basisDigest!==intent.intentDigest||result.payloadDigest!==canonicalDigest(value)||result.evidenceId!=='arca-us-source-'+result.payloadDigest||
      Buffer.byteLength(canonicalJson(result))>16384||result.sourceHandle.fingerprintVerifiedAtMs>result.observedAtMs)
    throw Object.assign(new TypeError('Source Result does not explain the exact Actor Intent, Case and immutable output handles.'),{code:'ARCA_US_ADULT_SOURCE_RESULT_INVALID'});
  readAuthority.assertReadHandle({intent,aftercareCaseId,handle:result.sourceHandle,atMs:result.observedAtMs});
  for(const handle of [result.featuresHandle,result.frameManifestHandle]){
    if(handle.ownerDomain!=='arca'||handle.processId!==aftercareCaseId||handle.workspaceId!==aftercareCaseId||
        !handle.relativePath.startsWith('us-adult/'+intent.intentId+'/'))
      throw Object.assign(new TypeError('Source Result crossed its exact Arca Case Workspace.'),{code:'ARCA_US_ADULT_SOURCE_RESULT_INVALID'});
  }
  return result;
}
module.exports=Object.freeze({SOURCE,RESULT,sourcePreparedSchema,sourcePrepared,assertSourcePrepared});
