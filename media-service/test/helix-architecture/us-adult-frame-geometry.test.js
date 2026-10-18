'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultFrameAnalysis}=require('../../src/helix/integrations/us-adult-frame-analysis');
const {frameGeometry,restoreFrameAnalysis}=require('../../src/helix/contracts/us-adult-frame-geometry');
const pack=require('../../src/helix/contracts/us-adult-face-model-pack.json');
async function fixture(noFace=false){
  const analyzer=createUsAdultFrameAnalysis({faceModel:{analyzeImage:async()=>({modelRef:pack.modelRef,width:640,height:480,
    detectedFaceCount:noFace?0:1,faces:noFace?[]:[{x:10,y:20,width:100,height:120,confidence:0.95,vector:[1,...Array(127).fill(0)]}]})}}),
    analysis=await analyzer.analyze([{timestampMs:50,bytes:Buffer.from('controlled-synthetic-image')}]);
  return {analysis,payload:{schema:'shared.face-embedding-set@1',dimension:128,vectors:analysis.faces.map(face=>face.vector),frameGeometry:frameGeometry(analysis)}};
}
test('geometry retains exact source frame, face position and quality without duplicating stored feature vectors',async()=>{
  const {analysis,payload}=await fixture();assert.deepEqual(restoreFrameAnalysis(payload),analysis);
  assert.equal(payload.frameGeometry.faces[0].vector,undefined);assert.deepEqual(payload.frameGeometry.faces[0].box,{x:10,y:20,width:100,height:120});
  assert.equal(payload.frameGeometry.faces[0].qualityScore,0.59375);assert.equal(payload.frameGeometry.faces[0].frameOrdinal,0);
});
test('zero faces retain the complete screenshot evidence while yielding no representative face',async()=>{
  const {analysis,payload}=await fixture(true);assert.deepEqual(restoreFrameAnalysis(payload),analysis);
  assert.equal(payload.frameGeometry.faces.length,0);assert.equal(payload.frameGeometry.frameMembers.length,1);
});
test('geometry rejects missing, substituted vector, source image, model and quality evidence',async()=>{
  const {payload}=await fixture();assert.throws(()=>restoreFrameAnalysis({...payload,frameGeometry:undefined}),{code:'US_ADULT_FRAME_GEOMETRY_INVALID'});
  for(const mutate of [
    value=>{value.vectors[0][0]=0;value.vectors[0][1]=1;},
    value=>{value.frameGeometry.faces[0].imageDigest=D('another-image');},
    value=>{value.frameGeometry.modelRefDigest=D('another-model');},
    value=>{value.frameGeometry.faces[0].qualityScore=1;},
    value=>{value.frameGeometry.faces[0].frameOrdinal=20;},
    value=>{value.frameGeometry.faces[0].unexpected='extra';},
  ]){
    const changed=structuredClone(payload);mutate(changed);const {geometryDigest,...value}=changed.frameGeometry;
    changed.frameGeometry.geometryDigest=D(value);assert.throws(()=>restoreFrameAnalysis(changed),{code:'US_ADULT_FRAME_GEOMETRY_INVALID'});
  }
});
test('geometry does not accept a rehashed low-confidence face as pinned detector output',async()=>{
  const {analysis}=await fixture(),changed=structuredClone(analysis),face=changed.faces[0];face.confidence=0.2;face.qualityScore=0.125;
  const {faceDigest,...body}=face;face.faceDigest=D(body);const {analysisDigest,...value}=changed;changed.analysisDigest=D(value);
  assert.throws(()=>frameGeometry(changed),{code:'US_ADULT_FRAME_GEOMETRY_INVALID'});
});
