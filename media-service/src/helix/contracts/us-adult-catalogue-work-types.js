'use strict';
// Proposed nominal types for the catalogue Work. The integration owner must
// materialize them from the reviewed SSOT before registering the Capability.
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {MAX_BYTES}=require('./buffalo-catalogue-observation');
const BATCHES='helix://contracts/domain-types/UsAdultCatalogueCompletedBatchSet/v1',
  HANDLE='helix://contracts/types/FaceCatalogueObservationHandle/v1',CAPABILITY='libra.us_adult.catalogue.observe@1',
  FRAME='libra.media.frames.extract@1',EMBED='shared.face.embedding.compute@1',CLUSTER='shared.face.cluster.compute@1';
const id=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  integer=(minimum,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum}),
  object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
  ref=name=>({$ref:'helix://contracts/types/'+name+'/v1'}),resultRef=capabilityRef=>'helix://contracts/capabilities/'+capabilityRef.replace('@1','/v1/result');
function sourceResultReferenceSchema(capabilityRef){return object({workId:id(),attemptId:id(),planId:id(),eventId:id(),resultId:id(),
  capabilityRef:{const:capabilityRef},resultSchemaRef:{const:resultRef(capabilityRef)},resultDigest:digest(),inputBindingDigest:digest()});}
function completedBatchSetSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:BATCHES,title:'UsAdultCatalogueCompletedBatchSet@1',
  'x-helix-ssotRefs':['8.6.18'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':65536,
  ...object({schemaRef:{const:BATCHES},schemaVersion:{const:1},analysisId:digest(),libraRunId:id(),basisDigest:digest(),
    mode:{enum:['initial','initial_and_supplement']},batches:{type:'array',minItems:1,maxItems:2,items:object({
      stage:{enum:['initial','supplement']},batchDigest:digest(),workId:id(),frameArtifactSet:ref('FrameArtifactSet'),
      faceEmbeddingSetHandle:ref('FaceEmbeddingSetHandle'),faceClusterSetHandle:ref('FaceClusterSetHandle'),
      sourceResultRefs:{type:'array',minItems:3,maxItems:3,items:{oneOf:[FRAME,EMBED,CLUSTER].map(sourceResultReferenceSchema)}}})},setDigest:digest()}),
  allOf:[{if:{properties:{mode:{const:'initial'}}},then:{properties:{batches:{minItems:1,maxItems:1}}}},
    {if:{properties:{mode:{const:'initial_and_supplement'}}},then:{properties:{batches:{minItems:2,maxItems:2}}}}]};}
function observationHandleSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:HANDLE,title:'FaceCatalogueObservationHandle@1',
  'x-helix-ssotRefs':['8.6.18'],'x-helix-maxCanonicalBytes':16384,
  ...object({schemaRef:{const:HANDLE},schemaVersion:{const:1},analysisId:digest(),libraRunId:id(),workspaceId:id(),runExecutionBasisDigest:digest(),basisDigest:digest(),
    mode:{enum:['initial','initial_and_supplement']},completedBatchSetDigest:digest(),observationSourceSetDigest:digest(),
    modelRefDigest:digest(),catalogueGenerationDigest:digest(),searchPolicyDigest:digest(),clusterParameterDigest:digest(),
    resultKind:{enum:['observed','no_faces']},frameCount:integer(1,40),faceCount:integer(0,1280),groupCount:integer(0,1280),queryCount:integer(0,1280),
    observationDigest:digest(),observationArtifactHandle:ref('ArtifactHandle'),outputTargetDigest:digest(),handleDigest:digest()}),
  allOf:[{if:{properties:{resultKind:{const:'no_faces'}}},then:{properties:{faceCount:{const:0},groupCount:{const:0},queryCount:{const:0}}}},
    {if:{properties:{resultKind:{const:'observed'}}},then:{properties:{faceCount:{minimum:1},groupCount:{minimum:1},queryCount:{minimum:1}}}}]};}
function assertObservationHandle(value,{validator}={}){
  validator?.validate(HANDLE,value);
  const properties=Object.keys(observationHandleSchema().properties),artifact=value?.observationArtifactHandle;
  if(!value||Object.keys(value).sort().join(',')!==properties.sort().join(',')||value.schemaRef!==HANDLE||value.schemaVersion!==1||
    !['analysisId','runExecutionBasisDigest','basisDigest','completedBatchSetDigest','observationSourceSetDigest','modelRefDigest','catalogueGenerationDigest',
      'searchPolicyDigest','clusterParameterDigest','observationDigest','outputTargetDigest','handleDigest'].every(key=>/^[a-f0-9]{64}$/.test(value[key]||''))||
    !['libraRunId','workspaceId'].every(key=>typeof value[key]==='string'&&value[key]&&value[key].length<=256)||
    !['initial','initial_and_supplement'].includes(value.mode)||!['observed','no_faces'].includes(value.resultKind)||
    !Number.isSafeInteger(value.frameCount)||value.frameCount<1||value.frameCount>40||
    !['faceCount','groupCount','queryCount'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=1280)||
    value.resultKind==='no_faces'&&(value.faceCount||value.groupCount||value.queryCount)||
    value.resultKind==='observed'&&(!value.faceCount||!value.groupCount||!value.queryCount)||
    artifact?.artifactKind!=='face_catalogue_observation'||artifact.ownerDomain!=='libra'||artifact.ownerScope?.scopeType!=='libra_run'||
    artifact.ownerScope.scopeId!==value.libraRunId||artifact.digestAlgorithm!=='sha256'||!Number.isSafeInteger(artifact.sizeBytes)||artifact.sizeBytes<1||artifact.sizeBytes>MAX_BYTES||
    !/^[a-f0-9]{64}$/.test(artifact.digestHex||'')||Buffer.byteLength(canonicalJson(value))>16384)
    throw Object.assign(new TypeError('The catalogue Observation Handle is not its exact bounded same-Run contract.'),{code:'US_ADULT_CATALOGUE_HANDLE_INVALID'});
  const {handleDigest,...body}=value;if(canonicalDigest(body)!==handleDigest)
    throw Object.assign(new TypeError('The catalogue Observation Handle commitment changed.'),{code:'US_ADULT_CATALOGUE_HANDLE_INVALID'});
  return value;
}
module.exports=Object.freeze({BATCHES,HANDLE,CAPABILITY,FRAME,EMBED,CLUSTER,resultRef,completedBatchSetSchema,observationHandleSchema,assertObservationHandle});
