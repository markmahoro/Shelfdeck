'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {restoreBuffaloEmbeddingSet}=require('../../src/helix/contracts/buffalo-frame-artifact');
const {setup}=require('./fixtures/buffalo-frame-engine');
async function pipeline(f){
  const frames=await f.port.extractFrames({sourceHandle:f.basis.sourceHandle,samplingPlan:f.batch.samplingPlan,outputTarget:f.target}),
    embeddings=await f.port.computeEmbeddings({frameArtifactSet:frames,faceModelRef:f.basis.faceModelRef}),
    clusters=await f.port.computeClusters({faceEmbeddingSetHandle:embeddings,clusterParameters:f.basis.clusterParameters});
  return {frames,embeddings,clusters};
}
function payload(f,handle){return JSON.parse(f.workspace.readArtifactBytes(handle).bytes.toString('utf8'));}
test('bounded frame engine publishes three real Workspace Artifacts and replays without rerunning CPU or extraction',async t=>{
  const f=setup(t),result=await pipeline(f);
  assert.equal(result.frames.frameCount,20);assert.equal(result.embeddings.dimension,512);assert.equal(result.embeddings.vectorCount,20);assert.equal(result.clusters.clusterCount,1);
  const stored=payload(f,result.embeddings.artifactHandle),restored=restoreBuffaloEmbeddingSet(stored);
  assert.equal(restored.frames.length,20);assert.deepEqual(restored.frames.map(x=>x.frame.timestampMs),f.batch.points.map(x=>x.timestampMs));
  const groups=payload(f,result.clusters.artifactHandle).clusters;assert.equal(groups[0].coverageStrata.length,20);assert.equal(groups[0].representativeKeys.length,3);
  assert.equal(groups[0].clusterProof.sourceEmbeddingDigest,result.embeddings.embeddingDigest);
  const before={...f.counters},count=f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n;
  assert.equal(count,3);assert.deepEqual(await pipeline(f),result);assert.deepEqual(f.counters,before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,count);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');
});
test('completed no-face batches retain all frames and exact empty embedding/cluster Artifacts',async t=>{
  const f=setup(t,{noFaces:true}),result=await pipeline(f);
  assert.equal(result.frames.frameCount,20);assert.equal(result.embeddings.vectorCount,0);assert.equal(result.clusters.clusterCount,0);
  assert.equal(restoreBuffaloEmbeddingSet(payload(f,result.embeddings.artifactHandle)).frames.length,20);
  assert.deepEqual(payload(f,result.clusters.artifactHandle).clusters,[]);
});
test('repeated image bytes do not manufacture independent temporal identity coverage',async t=>{
  const f=setup(t,{repeated:true}),result=await pipeline(f),group=payload(f,result.clusters.artifactHandle).clusters[0];
  assert.equal(group.memberKeys.length,20);assert.equal(group.uniqueFrameCount,20);assert.deepEqual(group.coverageStrata,[0]);assert.equal(group.representativeKeys.length,1);
});
test('partial extraction never commits a frame Artifact or begins CPU inference',async t=>{
  const f=setup(t,{partial:true});await assert.rejects(()=>pipeline(f),{code:'BUFFALO_FRAME_ENGINE_INVALID'});
  assert.equal(f.counters.images,0);assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
});
test('the cumulative frame and embedding bytes cannot overrun one frozen batch share of the Workspace quota',async t=>{
  const f=setup(t,{workspaceBytes:10*1024*1024+40000});
  await assert.rejects(()=>pipeline(f),{code:'BUFFALO_FRAME_WORKSPACE_BUDGET_EXCEEDED'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,1);
});
test('a late CPU response after stop is rejected and awaited CPU termination precedes failure',async t=>{
  const f=setup(t,{late:true});await assert.rejects(()=>pipeline(f),{code:'STOPPED'});
  assert.equal(f.counters.images,1);assert.equal(f.counters.stops,1);assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,1);
});
test('recovered embedding and cluster geometry cannot change source, vector or conserved membership',async t=>{
  const f=setup(t),result=await pipeline(f),embedding=payload(f,result.embeddings.artifactHandle),groups=payload(f,result.clusters.artifactHandle).clusters;
  const frameComposite=payload(f,result.frames.frameSetArtifactHandle),changed=JSON.parse(canonicalJson(embedding));
  changed.vectors[0][0]=0.5;
  assert.throws(()=>f.engine.validateEmbeddingSet({embeddingSet:changed,frameArtifactSet:result.frames,frameComposite,faceModelRef:f.basis.faceModelRef}));
  const omitted=JSON.parse(canonicalJson(groups));omitted[0].memberKeys.pop();
  assert.throws(()=>f.engine.validateClusters({clusters:omitted,faceEmbeddingSetHandle:result.embeddings,embeddingSet:embedding,clusterParameters:f.basis.clusterParameters}),
    {code:'BUFFALO_FRAME_ENGINE_INVALID'});
  const wrongHandle={...result.embeddings,embeddingDigest:createHash('sha256').update('wrong').digest('hex')};
  assert.throws(()=>f.engine.validateClusters({clusters:groups,faceEmbeddingSetHandle:wrongHandle,embeddingSet:embedding,clusterParameters:f.basis.clusterParameters}),
    {code:'BUFFALO_FRAME_ENGINE_INVALID'});
});
