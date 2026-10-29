'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {HANDLE,assertObservationHandle}=require('../../../contracts/us-adult-catalogue-work-types');
const {assertCatalogueObservation,catalogueAssessmentGroups}=require('../../../contracts/buffalo-catalogue-observation');
const {assertCatalogueAnalysisBasis}=require('./us-adult-catalogue-analysis-basis');
const {assertCompletedCatalogueBatches}=require('./us-adult-catalogue-completed-batches');
const {assessCatalogueActors}=require('./us-adult-catalogue-assessment');
const {buildWorkspaceArtifactTarget}=require('./workspace-frame-target');
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_OBSERVATION_RESULT_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function relativePath(basis,completedBatches){
  return 'analysis/catalogue-observations/'+basis.analysisId+'/'+completedBatches.mode+'-'+completedBatches.setDigest+'.json';
}
function catalogueObservationTarget({basis,completedBatches,workspace,rootSnapshot}){
  return buildWorkspaceArtifactTarget({basis,workspace,rootSnapshot,outputKind:'face_catalogue_observation',
    targetRelativePath:relativePath(basis,completedBatches),
    sourceInputDigest:canonicalDigest({usAdultCatalogueAnalysisBasis:basis,usAdultCatalogueCompletedBatchSet:completedBatches})});
}
function assertArtifactSource({basis,completedBatches,artifact,outputTargetDigest}){
  if(artifact?.storageRef!=='workspace://'+basis.workspaceId+'/'+relativePath(basis,completedBatches)||
    artifact.provenanceRef?.objectType!=='us_adult_catalogue_observation'||artifact.provenanceRef.objectId!==completedBatches.setDigest||
    artifact.provenanceRef.revision!==1||artifact.provenanceRef.digest!==outputTargetDigest)
    fail('The catalogue Artifact lost its exact Workspace path or producer target.');
}
function assertSource({basis,completedBatches,observation,snapshot,validator}){
  assertCatalogueAnalysisBasis(basis);assertCompletedCatalogueBatches(completedBatches,{basis,snapshot,validator});assertCatalogueObservation(observation);
  const expected=completedBatches.batches.map(batch=>({stage:batch.stage,batchDigest:batch.batchDigest,frameArtifactSetDigest:batch.frameArtifactSet.manifestDigest,
    embeddingDigest:batch.faceEmbeddingSetHandle.embeddingDigest,frameCount:batch.frameArtifactSet.frameCount}));
  if(observation.basisDigest!==basis.basisDigest||observation.mode!==completedBatches.mode||observation.modelRefDigest!==basis.faceModelRef.digest||
    observation.catalogueGenerationDigest!==basis.catalogueGeneration.generationDigest||observation.searchPolicyDigest!==basis.catalogueSearchPolicy.policyDigest||
    observation.clusterParameterDigest!==basis.clusterParameters.digest||canonicalJson(observation.sourceBatches)!==canonicalJson(expected))
    fail('The complete catalogue Observation is not the exact frozen Run, resource generation and source Results.');
}
function buildCatalogueObservationHandle({basis,completedBatches,observation,artifactHandle,outputTarget,snapshot,validator}){
  assertSource({basis,completedBatches,observation,snapshot,validator});
  const bytes=Buffer.from(canonicalJson(observation)),{targetDigest,...target}=outputTarget||{};
  if(artifactHandle.digestHex!==canonicalDigest(observation)||artifactHandle.sizeBytes!==bytes.length||outputTarget?.outputKind!=='face_catalogue_observation'||
    outputTarget.libraRunId!==basis.libraRunId||outputTarget.workspaceId!==basis.workspaceId||outputTarget.executionBasisDigest!==basis.runExecutionBasisDigest||
    outputTarget.sourceInputDigest!==canonicalDigest({usAdultCatalogueAnalysisBasis:basis,usAdultCatalogueCompletedBatchSet:completedBatches})||
    canonicalDigest(target)!==targetDigest)
    fail('The catalogue Artifact bytes, producer or frozen output target changed.');
  const expected=catalogueObservationTarget({basis,completedBatches,rootSnapshot:outputTarget.rootSnapshot,workspace:{state:'active',
    libraRunId:basis.libraRunId,currentRevision:outputTarget.expectedWorkspaceRevision,stateDigest:outputTarget.expectedWorkspaceStateDigest,
    workspaceScopeDigest:outputTarget.workspaceScopeDigest}});
  if(canonicalJson(expected)!==canonicalJson(outputTarget))fail('The catalogue output target is not its unique compiled target.');
  assertArtifactSource({basis,completedBatches,artifact:artifactHandle,outputTargetDigest:targetDigest});
  const body={schemaRef:HANDLE,schemaVersion:1,analysisId:basis.analysisId,libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,
    runExecutionBasisDigest:basis.runExecutionBasisDigest,basisDigest:basis.basisDigest,mode:completedBatches.mode,completedBatchSetDigest:completedBatches.setDigest,
    observationSourceSetDigest:observation.sourceSetDigest,modelRefDigest:basis.faceModelRef.digest,catalogueGenerationDigest:basis.catalogueGeneration.generationDigest,
    searchPolicyDigest:basis.catalogueSearchPolicy.policyDigest,clusterParameterDigest:basis.clusterParameters.digest,resultKind:observation.resultKind,
    frameCount:observation.frameEvidenceRefs.length,faceCount:observation.frameEvidenceRefs.reduce((count,frame)=>count+frame.faces.length,0),
    groupCount:observation.groups.length,queryCount:observation.queries.length,observationDigest:observation.observationDigest,
    observationArtifactHandle:artifactHandle,outputTargetDigest:targetDigest};
  const value=JSON.parse(canonicalJson({...body,handleDigest:canonicalDigest(body)}));return freeze(assertObservationHandle(value,{validator}));
}
function readCatalogueObservationResult({basis,completedBatches,snapshot,validator,handle,bytes}){
  assertObservationHandle(handle,{validator});
  assertArtifactSource({basis,completedBatches,artifact:handle.observationArtifactHandle,outputTargetDigest:handle.outputTargetDigest});
  if(!Buffer.isBuffer(bytes)||bytes.length!==handle.observationArtifactHandle.sizeBytes)fail('The complete catalogue Artifact byte length changed.');
  let observation;try{observation=JSON.parse(bytes.toString('utf8'));}catch{fail('Catalogue Artifact bytes are not JSON.');}
  if(!Buffer.from(canonicalJson(observation)).equals(bytes)||canonicalDigest(observation)!==handle.observationArtifactHandle.digestHex)
    fail('Catalogue Artifact bytes no longer match their exact canonical content.');
  assertSource({basis,completedBatches,observation,snapshot,validator});
  if(handle.analysisId!==basis.analysisId||handle.libraRunId!==basis.libraRunId||handle.workspaceId!==basis.workspaceId||
    handle.runExecutionBasisDigest!==basis.runExecutionBasisDigest||handle.basisDigest!==basis.basisDigest||handle.mode!==completedBatches.mode||
    handle.completedBatchSetDigest!==completedBatches.setDigest||handle.observationSourceSetDigest!==observation.sourceSetDigest||
    handle.modelRefDigest!==observation.modelRefDigest||handle.catalogueGenerationDigest!==observation.catalogueGenerationDigest||
    handle.searchPolicyDigest!==observation.searchPolicyDigest||handle.clusterParameterDigest!==observation.clusterParameterDigest||
    handle.resultKind!==observation.resultKind||handle.observationDigest!==observation.observationDigest||
    handle.frameCount!==observation.frameEvidenceRefs.length||handle.faceCount!==observation.frameEvidenceRefs.reduce((count,frame)=>count+frame.faces.length,0)||
    handle.groupCount!==observation.groups.length||handle.queryCount!==observation.queries.length)
    fail('The catalogue Result summary is not its complete exact frozen Artifact.');
  const owned=freeze(JSON.parse(canonicalJson(observation))),assessment=assessCatalogueActors({groups:catalogueAssessmentGroups(owned),policy:basis.selectionPolicy});
  return Object.freeze({observation:owned,assessment});
}
module.exports=Object.freeze({catalogueObservationTarget,buildCatalogueObservationHandle,readCatalogueObservationResult});
