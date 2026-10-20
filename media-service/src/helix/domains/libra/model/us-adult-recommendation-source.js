'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {originalFromIdentity}=require('./us-adult-identity-evidence');
const {FRAME,EMBED,CLUSTER,resultRef,workId}=require('./us-adult-analysis-work');
const SOURCE_SCHEMA='helix://contracts/domain-types/UsAdultRecommendationSource/v1',
  PAGE_SCHEMA='helix://contracts/domain-types/UsAdultRecommendationSourcePage/v1',QUERY_SCHEMA='helix://contracts/domain-types/UsAdultRecommendationPageQuery/v1';
function buildRecommendationSource({run,identity,basis,completion,records}){
  const [frames,embedding,clusters]=records.map(record=>record.result);
  if(run.libra_run_id!==basis.libraRunId||run.subject_id!==basis.subjectId||run.execution_basis_digest!==basis.runExecutionBasisDigest||
    completion.analysisBasisDigest!==basis.basisDigest||completion.analysisId!==basis.analysisId||completion.libraRunId!==run.libra_run_id||
    completion.subjectId!==run.subject_id||completion.winner!==null||completion.detectedFaceCount<1||
    completion.completedPageCount!==basis.pageCount||completion.detectedFaceCount>1280||
    identity.subjectId!==run.subject_id||identity.identityDigest!==basis.resolvedIdentityDigest||
    records.some((record,ordinal)=>record.capabilityRef!==[FRAME,EMBED,CLUSTER][ordinal]||record.resultSchemaRef!==resultRef(record.capabilityRef)||
      record.workId!==workId(basis,null)||record.outcomeKind!=='succeeded'||record.resultDigest!==canonicalDigest(record.result)||
      record.inputBindingDigest!==canonicalDigest(record.inputBindings)||record.result.libraRunId!==basis.libraRunId||record.result.workspaceId!==basis.workspaceId)||
    [frames.frameSetArtifactHandle,embedding.artifactHandle,clusters.artifactHandle].some((handle,ordinal)=>handle?.ownerDomain!=='libra'||
      handle.ownerScope?.scopeType!=='libra_run'||handle.ownerScope?.scopeId!==basis.libraRunId||handle.artifactKind!==['western_frame_set','face_embedding_set','face_cluster_set'][ordinal])||
    frames.sourceMaterialDigest!==canonicalDigest(basis.sourceHandle)||frames.samplingPlanDigest!==basis.samplingPlan.digest||
    frames.frameCount!==basis.samplingPlan.maxFrames||embedding.computationMode!=='western_frame_set'||embedding.dimension!==128||
    embedding.faceModelRefDigest!==basis.faceModelRef.digest||embedding.sourceArtifactSetDigest!==frames.manifestDigest||
    embedding.detectedFaceCount!==completion.detectedFaceCount||embedding.vectorCount!==completion.detectedFaceCount||
    embedding.embeddingDigest!==embedding.artifactHandle.digestHex||clusters.clusterDigest!==clusters.artifactHandle.digestHex||
    [embedding,clusters].some(({handleDigest,...body})=>canonicalDigest(body)!==handleDigest)||
    clusters.faceModelRefDigest!==basis.faceModelRef.digest||clusters.sourceEmbeddingDigest!==embedding.embeddingDigest||
    clusters.clusterParameterDigest!==basis.clusterParameters.digest||clusters.clusterCount<1)
    throw Object.assign(new Error('Recommendation source must conserve its complete unmatched Run, frames and model Results.'),{code:'US_ADULT_RECOMMENDATION_SOURCE_INVALID'});
  const sourceId=canonicalDigest({schema:'libra.us-adult-recommendation-source-id@1',subjectId:run.subject_id,libraRunId:run.libra_run_id,
    analysisId:basis.analysisId,completionDigest:completion.completionDigest,expectedRunStateRevision:run.state_revision}),
    value={schemaRef:SOURCE_SCHEMA,schemaVersion:1,sourceId,subjectId:run.subject_id,libraRunId:run.libra_run_id,
      expectedRunStateRevision:run.state_revision,expectedChoiceRevision:0,runExecutionBasisDigest:basis.runExecutionBasisDigest,
      analysisId:basis.analysisId,analysisBasisDigest:basis.basisDigest,completionDigest:completion.completionDigest,originalName:originalFromIdentity(identity),
      frameArtifactSet:frames,faceEmbeddingSetHandle:embedding,faceClusterSetHandle:clusters,
      sourceResultRefs:records.map(record=>Object.fromEntries(['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'].map(key=>[key,record[key]])))};
  if(Buffer.byteLength(canonicalJson(value),'utf8')>64*1024-100)throw new Error('Recommendation source exceeds its nominal byte bound.');
  return Object.freeze({...value,sourceDigest:canonicalDigest(value)});
}
module.exports=Object.freeze({SOURCE_SCHEMA,PAGE_SCHEMA,QUERY_SCHEMA,buildRecommendationSource});
