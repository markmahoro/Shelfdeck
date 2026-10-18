'use strict';
const {setup}=require('./us-adult-cast-context');
const {scoredPage}=require('./us-adult-match-proof');
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createUsAdultMatchCompletionStore}=require('../../../src/helix/domains/libra/persistence/us-adult-match-completion-store');
const {FRAME,EMBED,CLUSTER,frameWork,resultRef}=require('../../../src/helix/domains/libra/model/us-adult-analysis-work');
const {createUsAdultRecommendationQuery}=require('../../../src/helix/domains/libra/application/us-adult-recommendation-query');
function setupSources(input,{noFaces=false}={}){
  const owner=setup(input),schemas=[...require('../../../src/helix/domains/libra/application/western-analysis-plan-schema-graph'),
    ...['UsAdultRecommendationPageQuery','UsAdultRecommendationSource','UsAdultRecommendationSourcePage','UsAdultAnalysisBasis'].map(type=>
      require('../../../src/helix/contracts/domain-types/'+type+'/v1/schema.json')),
    ...['ResolvedProductIdentity','SeasonContinuityClaim'].map(type=>require('../../../src/helix/contracts/types/'+type+'/v1/schema.json'))],
    contractValidator=createCapabilityContractValidator({schemas}),basis=input.basis,work=frameWork(input.snapshot,basis);
  const artifact=kind=>({schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:kind+'-artifact',artifactKind:kind,
    ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:basis.libraRunId},storageRef:'fixture:'+kind,digestAlgorithm:'sha256',digestHex:D(kind),
    sizeBytes:1,mediaType:'application/json',provenanceRef:{objectType:'source-fixture',objectId:kind,revision:1,digest:D(kind+'-provenance')},referenceRevision:1}),
    frames={schemaRef:'helix://contracts/types/FrameArtifactSet/v1',schemaVersion:1,manifestId:'frame-manifest',manifestKind:'western_frame_artifact_set',
      ownerDomain:'libra',memberCount:1,membersDigest:D('members'),manifestDigest:D('manifest'),publishedAtMs:1,libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,
      sourceMaterialDigest:D(basis.sourceHandle),samplingPlanDigest:basis.samplingPlan.digest,outputTargetDigest:D('target'),frameCount:20,
      frameMemberSetDigest:D('frames'),frameSetArtifactHandle:artifact('western_frame_set')},
    embeddingArtifact=artifact('face_embedding_set'),embeddingValue={schemaRef:'helix://contracts/types/FaceEmbeddingSetHandle/v1',schemaVersion:1,
      artifactHandleId:embeddingArtifact.artifactHandleId,artifactHandle:embeddingArtifact,computationMode:'western_frame_set',libraRunId:basis.libraRunId,
      workspaceId:basis.workspaceId,faceModelRefDigest:basis.faceModelRef.digest,sourceArtifactSetDigest:frames.manifestDigest,
      detectedFaceCount:noFaces?0:20,vectorCount:noFaces?0:20,dimension:128,embeddingDigest:embeddingArtifact.digestHex},
    embedding={...embeddingValue,handleDigest:D(embeddingValue)},clusterArtifact=artifact('face_cluster_set'),
    clusterValue={schemaRef:'helix://contracts/types/FaceClusterSetHandle/v1',schemaVersion:1,artifactHandleId:clusterArtifact.artifactHandleId,artifactHandle:clusterArtifact,
      libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,faceModelRefDigest:basis.faceModelRef.digest,clusterParameterDigest:basis.clusterParameters.digest,
      sourceEmbeddingDigest:embedding.embeddingDigest,clusterCount:noFaces?0:1,clusterDigest:clusterArtifact.digestHex},clusters={...clusterValue,handleDigest:D(clusterValue)},
    record=(capabilityRef,result)=>{
      const inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]};
      return {workId:work.workId,attemptId:'frames-attempt',planId:'frames-plan',eventId:capabilityRef+'-event',resultId:capabilityRef+'-result',capabilityRef,
        outcomeKind:'succeeded',resultSchemaRef:resultRef(capabilityRef),result,resultDigest:D(result),inputBindings,inputBindingDigest:D(inputBindings)};
    },records=[record(FRAME,frames),record(EMBED,embedding),record(CLUSTER,clusters)],
    completion=createUsAdultMatchCompletionStore({...input.options,contractValidator}).freeze({basis,pages:input.pages,
      results:input.pages.map((page,ordinal)=>scoredPage(basis,page,ordinal,null,clusters.handleDigest)),embeddingRecord:records[1],clusterRecord:records[2]});
  let onRead=()=>{},reads=0;
  const options={...input.options,contractValidator,workResultReader:{status:()=>({state:'succeeded'}),read(){reads++;onRead();return records;}}},
    query=createUsAdultRecommendationQuery(options),pageQuery={schemaRef:'helix://contracts/domain-types/UsAdultRecommendationPageQuery/v1',schemaVersion:1,cursor:null,limit:1};
  return {owner,options,query,pageQuery,records,completion,reads:()=>reads,onRead:callback=>{onRead=callback;}};
}
module.exports=Object.freeze({setupSources});
