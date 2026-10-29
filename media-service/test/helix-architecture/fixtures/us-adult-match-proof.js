'use strict';
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {MATCH,REFERENCE_PROJECTION_REF,workId,resultRef,projectionSetDigest,EMBED,CLUSTER}=require('../../../src/helix/domains/libra/model/us-adult-analysis-work');
function scoredPage(basis,page,ordinal,score,clusterSetDigest=D('cluster-handle')){
  const person=page.items[0],projection=person.referenceProjection,asset=projection.contributions[0].activeAssets[0],
    matchBody={clusterId:'face-cluster-000000',personId:person.personId,personRevision:person.personRevision,projectionRevision:projection.projectionRevision,
      projectionDigest:projection.projectionDigest,confidenceClass:'strong',score,threshold:0.42,referenceAssetId:asset.referenceAssetId,
      artifactDigest:asset.artifactDigest,faceModelRefDigest:basis.faceModelRef.digest,referenceModelRefDigest:basis.referenceModelRefDigest},
    payload={clusterSetDigest,referenceProjectionSetDigest:projectionSetDigest(page),
      matches:score===null?[]:[{...matchBody,evidenceDigest:D({schema:'shared.face-reference-match-evidence@1',...matchBody})}],unmatchedClusterIds:[]},
    result={schemaRef:'helix://contracts/types/PersonMatchEvidence/v1',schemaVersion:1,evidenceId:'evidence-'+ordinal,evidenceKind:'face_reference_match',
      producerRef:MATCH,basisDigest:D({schema:'shared.face-reference-match-basis@1',clusterSetDigest:payload.clusterSetDigest,
        referenceProjectionSetDigest:payload.referenceProjectionSetDigest}),payloadDigest:D(payload),observedAtMs:1,...payload},
    inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[{
      portName:'personReferenceProjectionList',bindingKind:'projected_owner_facts',ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId,
      projectionRef:REFERENCE_PROJECTION_REF,parameters:{analysisId:basis.analysisId,pageOrdinal:ordinal}}]};
  return {attemptId:'match-attempt-'+ordinal,planId:'match-plan-'+ordinal,eventId:'match-event-'+ordinal,resultId:'match-result-'+ordinal,outcomeKind:'succeeded',capabilityRef:MATCH,workId:workId(basis,ordinal),resultSchemaRef:resultRef(MATCH),result,resultDigest:D(result),inputBindings,inputBindingDigest:D(inputBindings)};
}
function proof(input,{noFaces=false}={}){
  const {basis,pages}=input,frameId=workId(basis,null),embedding={computationMode:'western_frame_set',libraRunId:basis.libraRunId,
    workspaceId:basis.workspaceId,dimension:128,detectedFaceCount:noFaces?0:20,vectorCount:noFaces?0:20,
    faceModelRefDigest:basis.faceModelRef.digest,embeddingDigest:D('embedding-bytes')},
    cluster={libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,faceModelRefDigest:basis.faceModelRef.digest,
      sourceEmbeddingDigest:embedding.embeddingDigest,handleDigest:D('cluster-handle')},
    record=(capabilityRef,result)=>({outcomeKind:'succeeded',workId:frameId,capabilityRef,result,resultDigest:D(result)});
  return {basis,pages,results:pages.map((page,ordinal)=>scoredPage(basis,page,ordinal,noFaces?null:ordinal===2?0.95:0.8)),
    embeddingRecord:record(EMBED,embedding),clusterRecord:record(CLUSTER,cluster)};
}
module.exports=Object.freeze({scoredPage,proof});
