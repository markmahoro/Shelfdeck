'use strict';
const {canonicalDigest,canonicalJson}=require('./helix/contracts/canonical-json');
const {assertCatalogueObservation,MAX_BYTES}=require('./helix/contracts/buffalo-catalogue-observation');
function fail(message){throw Object.assign(new Error(message),{code:'CLEAN_BUFFALO_CATALOGUE_ARTIFACT_INVALID'});}
function createCleanBuffaloCataloguePort(options){
  if(typeof options?.context?.assertExecutionActive!=='function'||typeof options.computeObservation!=='function'||
    typeof options.validateObservation!=='function'||typeof options.capturePublicationFence!=='function'||!['recoverMaterializedArtifact','materializeArtifact','readArtifactBytes']
      .every(method=>typeof options.workspaceProductPort?.[method]==='function'))
    throw new TypeError('Catalogue publication requires live execution, its scoped Workspace Port and exact Observation validation.');
  const port=options.workspaceProductPort,active=()=>options.context.assertExecutionActive();
  function validate(observation){assertCatalogueObservation(observation);options.validateObservation(observation);active();return observation;}
  function decode(bytes){
    if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_BYTES)fail('Catalogue recovery bytes exceed their declared bound.');
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('Catalogue recovery bytes are not complete JSON.');}
    if(!Buffer.from(canonicalJson(value)).equals(bytes))fail('Catalogue recovery bytes are not their exact canonical content.');
    return validate(value);
  }
  function read(handle){
    if(handle?.artifactKind!=='face_catalogue_observation'||!Number.isSafeInteger(handle.sizeBytes)||handle.sizeBytes<1||handle.sizeBytes>MAX_BYTES)
      fail('Catalogue recovery requires one bounded immutable Observation Artifact.');
    const {bytes}=port.readArtifactBytes(handle),value=decode(bytes);
    if(bytes.length!==handle.sizeBytes||canonicalDigest(value)!==handle.digestHex)
      fail('Catalogue recovery bytes no longer match their immutable Handle.');
    return value;
  }
  return Object.freeze({async observe({basis,completedBatches,outputTarget}){
    active();
    const {targetDigest,...target}=outputTarget||{};
    if(outputTarget?.libraRunId!==basis.libraRunId||outputTarget.workspaceId!==basis.workspaceId||
      outputTarget.outputKind!=='face_catalogue_observation'||canonicalDigest(target)!==targetDigest||
      outputTarget.sourceInputDigest!==canonicalDigest({usAdultCatalogueAnalysisBasis:basis,usAdultCatalogueCompletedBatchSet:completedBatches}))
      fail('Catalogue publication lost its exact frozen Run and output target.');
    const request={libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,relativePath:outputTarget.targetRelativePath,
      artifactKind:'face_catalogue_observation',mediaType:'application/vnd.shelfdeck.face-catalogue-observation+json',
      provenanceRef:{objectType:'us_adult_catalogue_observation',objectId:completedBatches.setDigest,revision:1,digest:targetDigest},
      capturePublicationFence:options.capturePublicationFence};
    let materialized=port.recoverMaterializedArtifact({...request,validateRecoveredBytes:decode});
    if(!materialized){
      const value=validate(await options.computeObservation());active();
      materialized=port.materializeArtifact({...request,bytes:Buffer.from(canonicalJson(value))});
    }
    const observation=read(materialized.artifactHandle);active();
    return Object.freeze({observation,artifactHandle:materialized.artifactHandle});
  }});
}
module.exports=Object.freeze({createCleanBuffaloCataloguePort});
