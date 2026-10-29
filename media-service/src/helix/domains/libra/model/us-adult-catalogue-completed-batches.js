'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {BATCHES,FRAME,EMBED,CLUSTER,resultRef,completedBatchSetSchema}=require('../../../contracts/us-adult-catalogue-work-types');
const {assertCatalogueAnalysisBasis}=require('./us-adult-catalogue-analysis-basis');
const {catalogueFrameBatch,catalogueFrameWork}=require('./us-adult-catalogue-frame-work');
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_CATALOGUE_COMPLETION_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function sourceRef(record,workId,capabilityRef){
  if(record?.workId!==workId||record.outcomeKind!=='succeeded'||record.capabilityRef!==capabilityRef||record.resultSchemaRef!==resultRef(capabilityRef)||
    canonicalDigest(record.result)!==record.resultDigest||!record.inputBindings||canonicalDigest(record.inputBindings)!==record.inputBindingDigest||
    !['attemptId','planId','eventId','resultId'].every(key=>typeof record[key]==='string'&&record[key]&&record[key].length<=256))
    fail('Completed catalogue inputs require exact successful durable Capability Results and frozen input bindings.');
  return Object.fromEntries(['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'].map(key=>[key,record[key]]));
}
function assertCompletedCatalogueBatches(value,{basis,snapshot,validator}={}){
  if(!basis||!snapshot||!validator)throw new TypeError('Catalogue completion validation requires the frozen Owner Basis and formal nominal schemas.');
  assertCatalogueAnalysisBasis(basis);validator.validate(BATCHES,value);
  const stages=value.mode==='initial'?['initial']:['initial','supplement'];
  if(value.analysisId!==basis.analysisId||value.libraRunId!==basis.libraRunId||value.basisDigest!==basis.basisDigest||
    value.batches.length!==stages.length||Buffer.byteLength(canonicalJson(value))>65536)fail('Completed catalogue batches crossed their exact frozen Run or byte bound.');
  for(const [index,batch]of value.batches.entries()){
    const stage=stages[index],expected=catalogueFrameBatch(basis,stage),work=catalogueFrameWork(snapshot,basis,stage),
      frame=batch.frameArtifactSet,embedding=batch.faceEmbeddingSetHandle,cluster=batch.faceClusterSetHandle;
    if(!expected||batch.stage!==stage||batch.batchDigest!==expected.batchDigest||batch.workId!==work.workId||
      batch.sourceResultRefs.length!==3||batch.sourceResultRefs.some((ref,index)=>ref.workId!==work.workId||ref.capabilityRef!==[FRAME,EMBED,CLUSTER][index]||
        ref.resultSchemaRef!==resultRef(ref.capabilityRef)||ref.resultDigest!==canonicalDigest([frame,embedding,cluster][index]))||
      new Set(batch.sourceResultRefs.map(ref=>ref.attemptId)).size!==1||new Set(batch.sourceResultRefs.map(ref=>ref.planId)).size!==1||
      new Set(batch.sourceResultRefs.map(ref=>ref.eventId)).size!==3||new Set(batch.sourceResultRefs.map(ref=>ref.resultId)).size!==3)
      fail('The source Result set is not the complete frozen batch Work.');
    if(frame.libraRunId!==basis.libraRunId||frame.workspaceId!==basis.workspaceId||frame.frameCount!==expected.points.length||
      frame.sourceMaterialDigest!==canonicalDigest(basis.sourceHandle)||frame.samplingPlanDigest!==expected.samplingPlan.digest||
      embedding.libraRunId!==basis.libraRunId||embedding.workspaceId!==basis.workspaceId||embedding.dimension!==512||
      embedding.faceModelRefDigest!==basis.faceModelRef.digest||embedding.sourceArtifactSetDigest!==frame.manifestDigest||
      cluster.libraRunId!==basis.libraRunId||cluster.workspaceId!==basis.workspaceId||cluster.faceModelRefDigest!==basis.faceModelRef.digest||
      cluster.sourceEmbeddingDigest!==embedding.embeddingDigest||cluster.clusterParameterDigest!==basis.clusterParameters.digest)
      fail('The completed face chain lost its Run, Workspace, source frames or buffalo feature space.');
    for(const [index,handle]of [frame.frameSetArtifactHandle,embedding.artifactHandle,cluster.artifactHandle].entries())if(handle.ownerDomain!=='libra'||
      handle.ownerScope.scopeType!=='libra_run'||handle.ownerScope.scopeId!==basis.libraRunId||
      handle.artifactKind!==['western_frame_set','face_embedding_set','face_cluster_set'][index])fail('A producer Artifact belongs to another Run or kind.');
    const {manifestDigest,publishedAtMs,...manifest}=frame,{handleDigest:embeddingDigest,...embeddingBody}=embedding,{handleDigest:clusterDigest,...clusterBody}=cluster;
    if(canonicalDigest(manifest)!==manifestDigest||canonicalDigest(embeddingBody)!==embeddingDigest||canonicalDigest(clusterBody)!==clusterDigest||
      frame.memberCount!==1||frame.membersDigest!==canonicalDigest({schema:'libra.western-frame-artifact-set@1',items:[frame.frameSetArtifactHandle]})||
      embedding.artifactHandleId!==embedding.artifactHandle.artifactHandleId||cluster.artifactHandleId!==cluster.artifactHandle.artifactHandleId||
      embedding.artifactHandle.digestHex!==embedding.embeddingDigest||cluster.artifactHandle.digestHex!==cluster.clusterDigest)
      fail('A producer Result or nested Artifact commitment changed.');
  }
  const {setDigest,...body}=value;if(canonicalDigest(body)!==setDigest)fail('The complete catalogue input commitment changed.');
  return value;
}
function buildCompletedCatalogueBatches({basis,snapshot,mode,records,validator}){
  if(!['initial','initial_and_supplement'].includes(mode)||!Array.isArray(records)||records.length!==(mode==='initial'?1:2))
    fail('Catalogue inputs require one complete initial set or exactly both source batches.');
  const body={schemaRef:BATCHES,schemaVersion:1,analysisId:basis.analysisId,libraRunId:basis.libraRunId,basisDigest:basis.basisDigest,mode,
    batches:records.map((source,index)=>{
      const stage=index===0?'initial':'supplement',batch=catalogueFrameBatch(basis,stage),work=catalogueFrameWork(snapshot,basis,stage);
      if(!batch||!source||!source.frame||!source.embedding||!source.cluster)fail('No nonempty complete frozen batch exists for this stage.');
      return {stage,batchDigest:batch.batchDigest,workId:work.workId,frameArtifactSet:source.frame.result,
        faceEmbeddingSetHandle:source.embedding.result,faceClusterSetHandle:source.cluster.result,
        sourceResultRefs:[sourceRef(source.frame,work.workId,FRAME),sourceRef(source.embedding,work.workId,EMBED),sourceRef(source.cluster,work.workId,CLUSTER)]};
    })},value=JSON.parse(canonicalJson({...body,setDigest:canonicalDigest(body)}));
  return freeze(assertCompletedCatalogueBatches(value,{basis,snapshot,validator}));
}
module.exports=Object.freeze({buildCompletedCatalogueBatches,assertCompletedCatalogueBatches,completedBatchSetSchema});
