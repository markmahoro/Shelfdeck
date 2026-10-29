'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),{createHash}=require('node:crypto');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {frameEvidence,assertFrameEvidence}=require('../../src/helix/contracts/buffalo-frame-evidence');
const {createBuffaloRepresentativeImage}=require('../../src/helix/integrations/buffalo-representative-image');
const {rotateNearest}=require('../../src/helix/integrations/buffalo-math');
const {representativeImagePolicy}=require('../../src/helix/contracts/buffalo-representative-policy');
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(rotationDegrees=0){
  const image={width:120,height:100,data:Buffer.alloc(120*100*3)};
  for(let y=0;y<100;y++)for(let x=0;x<120;x++){
    const offset=(y*120+x)*3;image.data[offset]=x;image.data[offset+1]=y;image.data[offset+2]=80;
  }
  const bytes=await sharp(image.data,{raw:{width:120,height:100,channels:3}}).png().toBuffer(),canvas=rotationDegrees?rotateNearest(image,rotationDegrees):image,
    vector=Array(512).fill(0);vector[0]=1;
  const face={rectangle:[10,12,65,72],landmarks:[[20,25],[50,25],[35,40],[25,55],[45,55]],confidence:0.99,vector,rotationApplied:rotationDegrees},
    evidence=frameEvidence({basisDigest:D('basis'),frame:{ordinal:0,stage:'initial',stratum:0,timestampMs:100,imageDigest:sha(bytes)},analysis:{
      coordinateSpace:{kind:'corrected_canvas',sourceWidth:120,sourceHeight:100,width:canvas.width,height:canvas.height,rotationDegrees,pixelDigest:sha(canvas.data)},faces:[face]}});
  return {bytes,evidence,image,canvas,face};
}
test('frame Evidence owns immutable 512-dimensional vectors, corrected geometry and exact frame provenance',async()=>{
  const f=await fixture(35);assert.equal(assertFrameEvidence(f.evidence),f.evidence);
  assert.equal(Object.isFrozen(f.evidence.faces[0].vector),true);assert.equal(Object.isFrozen(f.face.vector),false);
  f.face.vector[0]=0;assert.equal(f.evidence.faces[0].vector[0],1);
  for(const mutate of [x=>x.frame.imageDigest=D('other'),x=>x.faces[0].rectangle[0]++,x=>x.faces[0].vector=[1],
    x=>x.coordinateSpace.rotationDegrees=0,x=>x.modelRefDigest=D('old'),x=>x.faces[0].extra='field']){
    const copy=structuredClone(f.evidence);mutate(copy);assert.throws(()=>assertFrameEvidence(copy),{code:'BUFFALO_FRAME_EVIDENCE_INVALID'});
  }
  assert.throws(()=>assertFrameEvidence(f.evidence,{basisDigest:D('other')}),{code:'BUFFALO_FRAME_EVIDENCE_INVALID'});
  assert.throws(()=>frameEvidence({basisDigest:D('basis'),frame:f.evidence.frame,analysis:{coordinateSpace:f.evidence.coordinateSpace,
    faces:[{...f.face,vector:Array(128).fill(1)}]}}),{code:'BUFFALO_FRAME_EVIDENCE_INVALID'});
});
test('representative images crop the reconstructed correction canvas instead of applying its box to original pixels',async()=>{
  const render=createBuffaloRepresentativeImage().render;
  for(const degrees of [0,35,90,-30]){
    const f=await fixture(degrees),out=await render({frameBytes:f.bytes,evidence:f.evidence,faceOrdinal:0,policy:representativeImagePolicy(),deadlineAtMs:Date.now()+5000}),
      decoded=await sharp(out.bytes).raw().toBuffer({resolveWithObject:true});
    assert.equal(decoded.info.width,79);assert.equal(decoded.info.height,87);assert.equal(decoded.info.channels,3);
    assert.deepEqual(out.proof.rectangle,{left:0,top:0,width:79,height:87});
    const expected=Buffer.alloc(79*87*3);
    for(let y=0;y<87;y++)f.canvas.data.copy(expected,y*79*3,y*f.canvas.width*3,(y*f.canvas.width+79)*3);
    assert.deepEqual(decoded.data,expected);assert.equal(out.proof.imageDigest,sha(out.bytes));
    assert.equal(out.proof.faceEvidenceDigest,f.evidence.faces[0].faceEvidenceDigest);assert.equal(out.proof.sourceImageDigest,sha(f.bytes));
  }
});
test('representative crops reject different frame bytes, changed geometry, tiny faces and overlapping detected identities',async()=>{
  const f=await fixture(),render=createBuffaloRepresentativeImage().render,args={frameBytes:f.bytes,evidence:f.evidence,faceOrdinal:0,policy:representativeImagePolicy(),deadlineAtMs:Date.now()+5000};
  await assert.rejects(render({...args,frameBytes:Buffer.from('other')}),{code:'BUFFALO_REPRESENTATIVE_INVALID'});
  await assert.rejects(render({...args,faceOrdinal:1}),{code:'BUFFALO_REPRESENTATIVE_INVALID'});
  const changed=frameEvidence({basisDigest:f.evidence.basisDigest,frame:f.evidence.frame,analysis:{coordinateSpace:{...f.evidence.coordinateSpace,pixelDigest:D('other')},faces:[f.face]}});
  await assert.rejects(render({...args,evidence:changed}),{code:'BUFFALO_REPRESENTATIVE_INVALID'});
  for(const faces of [[{...f.face,rectangle:[10,10,20,20]}],[f.face,{...f.face,rectangle:[20,20,50,60]}]]){
    const evidence=frameEvidence({basisDigest:f.evidence.basisDigest,frame:f.evidence.frame,analysis:{coordinateSpace:f.evidence.coordinateSpace,faces}});
    await assert.rejects(render({...args,evidence}),{code:'BUFFALO_REPRESENTATIVE_INVALID'});
  }
});
test('representative operations preserve cancellation and deadline failures',async()=>{
  const f=await fixture(),render=createBuffaloRepresentativeImage().render,controller=new AbortController();controller.abort();
  const args={frameBytes:f.bytes,evidence:f.evidence,faceOrdinal:0,policy:representativeImagePolicy(),deadlineAtMs:Date.now()+5000};
  await assert.rejects(render({...args,signal:controller.signal}),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
  await assert.rejects(render({...args,deadlineAtMs:Date.now()-1}),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
  await assert.rejects(render({...args,deadlineAtMs:Date.now()+600001}),{code:'BUFFALO_REPRESENTATIVE_INVALID'});
});
