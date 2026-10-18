'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),{createHash}=require('node:crypto');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {frameGeometry}=require('../../src/helix/contracts/us-adult-frame-geometry');
const {createUsAdultFrameAnalysis}=require('../../src/helix/integrations/us-adult-frame-analysis');
const pack=require('../../src/helix/contracts/us-adult-face-model-pack.json');
const {createCleanUsAdultRecommendationImagePort}=require('../../src/clean-us-adult-recommendation-image-port');
const {normalizeVector}=require('../../src/helix/integrations/local-face-math');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture({vector=[1,...Array(127).fill(0)]}={}){
  const other=[0,1,...Array(126).fill(0)],
    bytes=await sharp({create:{width:320,height:240,channels:3,background:'#705050'}}).jpeg().toBuffer();
  let frame=0;
  const analysis=await createUsAdultFrameAnalysis({faceModel:{async analyzeImage(){const ordinal=frame++;
    return {modelRef:pack.modelRef,width:320,height:240,detectedFaceCount:1,faces:[{x:60,y:40,width:ordinal===1?100:60,
      height:100,confidence:0.95,vector:ordinal===2?other:vector}]};}}}).analyze([0,1,2].map(index=>({timestampMs:100*index,bytes}))),
    members=analysis.frameMembers.map(item=>({ordinal:item.ordinal,timestampMs:item.timestampMs,contentDigest:item.imageDigest,locator:'composite-member:'+item.ordinal})),
    frames={schema:'libra.western-frame-composite@1',members,memberPayloads:members.map(item=>({ordinal:item.ordinal,contentDigest:item.contentDigest,encoding:'base64',bytesBase64:bytes.toString('base64')})),
      frameMemberSetDigest:D({schema:'libra.western-frame-member-set@1',items:members})},
    embedding={schema:'shared.face-embedding-set@1',dimension:128,vectors:analysis.faces.map(face=>face.vector),frameGeometry:frameGeometry(analysis)},
    clusters={schema:'shared.face-cluster-set@1',clusters:[{clusterId:'dominant',memberOrdinals:[0,1],vectors:[normalizeVector(vector),normalizeVector(vector)]},
      {clusterId:'minor',memberOrdinals:[2],vectors:[other]}]},payloads={western_frame_set:frames,face_embedding_set:embedding,face_cluster_set:clusters},
    artifacts=new Map(),handle=kind=>{const content=Buffer.from(canonicalJson(payloads[kind]));const value={ownerDomain:'libra',
      ownerScope:{scopeType:'libra_run',scopeId:'run'},artifactKind:kind,sizeBytes:content.length,digestHex:hash(content)};
      artifacts.set(kind,content);return value;},
    source={libraRunId:'run',sourceDigest:D('source'),frameArtifactSet:{frameCount:3,frameMemberSetDigest:frames.frameMemberSetDigest,frameSetArtifactHandle:handle('western_frame_set')},
      faceEmbeddingSetHandle:{artifactHandle:handle('face_embedding_set'),faceModelRefDigest:analysis.modelRef.digest,detectedFaceCount:3},
      faceClusterSetHandle:{artifactHandle:handle('face_cluster_set'),clusterCount:2}};
  let reads=0,stale=false,artifactReads=0;
  const port=createCleanUsAdultRecommendationImagePort({sourceQuery:{readSource(value){reads++;if(stale)throw Object.assign(new Error('Source changed'),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
    assert.equal(value,source);return source;}},workspaceProductPort:{readArtifactBytes(value){artifactReads++;return {bytes:artifacts.get(value.artifactKind)};}}});
  function replace(kind,value){const content=Buffer.from(canonicalJson(value)),target=kind==='western_frame_set'?source.frameArtifactSet.frameSetArtifactHandle:
    kind==='face_embedding_set'?source.faceEmbeddingSetHandle.artifactHandle:source.faceClusterSetHandle.artifactHandle;
    artifacts.set(kind,content);target.sizeBytes=content.length;target.digestHex=hash(content);}
  return {port,source,analysis,artifacts,payloads,replace,reads:()=>reads,artifactReads:()=>artifactReads,setStale:()=>{stale=true;}};
}
test('recommendation image selects the clearest face from the dominant source cluster and returns a bounded visible crop',async()=>{
  const h=await fixture(),candidate=h.port.readCandidate(h.source);
  assert.equal(candidate.clusterId,'dominant');assert.equal(candidate.clusterFaceCount,2);assert.equal(candidate.frameOrdinal,1);
  assert.deepEqual(candidate.vector,h.analysis.faces[1].vector);assert.equal(candidate.faceDigest,h.analysis.faces[1].faceDigest);
  assert.equal(candidate.sourceDigest,h.source.sourceDigest);assert.equal(candidate.workspacePath,undefined);
  const before=h.reads(),image=await h.port.readImage({source:h.source,expectedEvidenceDigest:candidate.evidenceDigest}),metadata=await sharp(image.bytes).metadata();
  assert.equal(metadata.format,'jpeg');assert.ok(metadata.width>100&&metadata.width<=640);assert.ok(metadata.height>100&&metadata.height<=640);
  assert.equal(image.imageDigest,hash(image.bytes));assert.equal(image.evidenceDigest,candidate.evidenceDigest);assert.equal(h.reads()-before,3);
});
test('cluster features conserve the exact native normalization operation rather than requiring byte-identical pre-normalized floats',async()=>{
  const vector=[6/7,2/7,3/7,...Array(125).fill(0)];assert.notDeepEqual(normalizeVector(vector),vector);
  const h=await fixture({vector});assert.deepEqual(h.port.readCandidate(h.source).vector,vector);
});
test('stale sources fail before byte access and a source changed during image encoding fails before exposure',async()=>{
  const h=await fixture(),candidate=h.port.readCandidate(h.source),pending=h.port.readImage({source:h.source,expectedEvidenceDigest:candidate.evidenceDigest});
  h.setStale();await assert.rejects(pending,{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
  const before=h.artifactReads();assert.throws(()=>h.port.readCandidate(h.source),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});assert.equal(h.artifactReads(),before);
});
test('recommendation images reject changed screenshot bytes and substituted or omitted cluster members',async()=>{
  for(const change of [
    h=>{h.artifacts.set('western_frame_set',Buffer.from('changed'));},
    h=>{const changed=structuredClone(h.payloads.face_cluster_set);changed.clusters[0].vectors[0]=changed.clusters[1].vectors[0];h.replace('face_cluster_set',changed);},
    h=>{const changed=structuredClone(h.payloads.face_cluster_set);changed.clusters[0].memberOrdinals=[0];changed.clusters[0].vectors.splice(1);h.replace('face_cluster_set',changed);},
    h=>{const changed=structuredClone(h.payloads.western_frame_set);changed.memberPayloads[0].bytesBase64=Buffer.from('different').toString('base64');h.replace('western_frame_set',changed);},
  ]){const h=await fixture();change(h);assert.throws(()=>h.port.readCandidate(h.source),{code:'US_ADULT_RECOMMENDATION_IMAGE_INVALID'});}
});
test('image reads reject another selection digest, Run scope or forged frame dimensions',async()=>{
  let h=await fixture();await assert.rejects(h.port.readImage({source:h.source,expectedEvidenceDigest:D('other')}),{code:'US_ADULT_RECOMMENDATION_IMAGE_INVALID'});
  h=await fixture();h.source.faceEmbeddingSetHandle.artifactHandle.ownerScope.scopeId='another-run';
  assert.throws(()=>h.port.readCandidate(h.source),{code:'US_ADULT_RECOMMENDATION_IMAGE_INVALID'});
  h=await fixture();const changed=structuredClone(h.analysis);changed.frameMembers.forEach(frame=>{frame.width=321;});
  const {analysisDigest,...body}=changed;changed.analysisDigest=D(body);
  h.replace('face_embedding_set',{...h.payloads.face_embedding_set,frameGeometry:frameGeometry(changed)});
  const candidate=h.port.readCandidate(h.source);
  await assert.rejects(h.port.readImage({source:h.source,expectedEvidenceDigest:candidate.evidenceDigest}),{code:'US_ADULT_RECOMMENDATION_IMAGE_INVALID'});
});
