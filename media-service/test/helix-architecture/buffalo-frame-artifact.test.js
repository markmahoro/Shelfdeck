'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {frameEvidence}=require('../../src/helix/contracts/buffalo-frame-evidence');
const {encodeBuffaloEmbeddingSet,restoreBuffaloEmbeddingSet}=require('../../src/helix/contracts/buffalo-frame-artifact');
function fixture(){
  const points=[0,1,2].map(i=>({ordinal:i,compositeOrdinal:i,stage:'initial',stratum:i,timestampMs:i*1000})),
    source={basisDigest:D('basis'),batchDigest:D('batch'),frameArtifactSetDigest:D('frame-set'),frameMemberSetDigest:D('members'),frameArtifactBytes:1000,points},
    vector=Array(512).fill(0);vector[0]=1;
  const frames=points.map((point,index)=>{const {compositeOrdinal,...frame}=point;return frameEvidence({basisDigest:source.basisDigest,
    frame:{...frame,imageDigest:D(index)},analysis:{coordinateSpace:{kind:'corrected_canvas',sourceWidth:1280,sourceHeight:720,width:1280,height:720,
      rotationDegrees:0,pixelDigest:D('pixels-'+index)},faces:index===1?[]:[{rectangle:[40,40,140,140],landmarks:[[60,60],[100,60],[80,80],[60,110],[100,110]],
      confidence:0.95,vector,rotationApplied:0}]}});});
  return {source,frames};
}
test('persisted embeddings preserve no-face frames, exact sampled points and corrected canvas proof without duplicating vectors',()=>{
  const f=fixture(),payload=encodeBuffaloEmbeddingSet(f),restored=restoreBuffaloEmbeddingSet(payload,{expectedSource:f.source});
  assert.deepEqual(restored.frames,f.frames);assert.equal(payload.vectors.length,2);assert.equal(payload.frameGeometry.frames.length,3);
  assert.deepEqual(payload.frameGeometry.frames[1].faces,[]);
  assert.ok(payload.frameGeometry.frames.every(frame=>frame.faces.every(face=>!Object.hasOwn(face,'vector'))));
  assert.equal(Object.isFrozen(payload.vectors[0]),true);assert.equal(Object.isFrozen(restored.frames[0].faces[0].vector),true);
});
test('an Artifact cannot be replayed as another source, batch or frozen frame set even with the same feature bytes',()=>{
  const f=fixture(),payload=encodeBuffaloEmbeddingSet(f);
  for(const key of ['basisDigest','batchDigest','frameArtifactSetDigest','frameMemberSetDigest'])
    assert.throws(()=>restoreBuffaloEmbeddingSet(payload,{expectedSource:{...f.source,[key]:D('other')}}),{code:'BUFFALO_FRAME_ARTIFACT_INVALID'});
  assert.throws(()=>encodeBuffaloEmbeddingSet({...f,frames:f.frames.slice(0,2)}),{code:'BUFFALO_FRAME_ARTIFACT_INVALID'});
  assert.throws(()=>encodeBuffaloEmbeddingSet({...f,frames:[...f.frames].reverse()}),{code:'BUFFALO_FRAME_ARTIFACT_INVALID'});
});
test('vector omission, duplication, non-unit substitution and coordinate changes cannot pass reconstructed frame hashes',()=>{
  for(const mutate of [x=>x.vectors.pop(),x=>x.vectors.push(x.vectors[0]),x=>x.frameGeometry.frames[2].faces[0].vectorOrdinal=0,
    x=>x.vectors[0][0]=0.5,x=>x.frameGeometry.frames[0].coordinateSpace.rotationDegrees=90,
    x=>x.frameGeometry.frames[0].frame.imageDigest=D('changed')]){
    const value=JSON.parse(JSON.stringify(encodeBuffaloEmbeddingSet(fixture())));mutate(value);
    const {geometryDigest,...geometry}=value.frameGeometry;value.frameGeometry.geometryDigest=D(geometry);
    assert.throws(()=>restoreBuffaloEmbeddingSet(value));
  }
});
test('caller mutations cannot rewrite frozen records and unknown metadata cannot enter an Artifact',()=>{
  const input=fixture(),payload=encodeBuffaloEmbeddingSet(input);input.source.points[0].timestampMs=1;
  assert.equal(payload.frameGeometry.source.points[0].timestampMs,0);
  const changed=JSON.parse(JSON.stringify(payload));changed.frameGeometry.frames[0].extra='x'.repeat(1024);
  const {geometryDigest,...geometry}=changed.frameGeometry;changed.frameGeometry.geometryDigest=D(geometry);
  assert.throws(()=>restoreBuffaloEmbeddingSet(changed));
});
