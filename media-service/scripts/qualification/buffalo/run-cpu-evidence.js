'use strict';
// Qualification of the formal CPU adapter and image provenance; no Domain publication.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createBuffaloCpuSession}=require('../../../src/helix/integrations/buffalo-cpu-session');
const {frameEvidence}=require('../../../src/helix/contracts/buffalo-frame-evidence');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {representativeImagePolicy}=require('../../../src/helix/contracts/buffalo-representative-policy');
const policy=require('./parity-policy.json'),reference=JSON.parse(fs.readFileSync('/reference/reference.json','utf8')),
  cosine=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),
  report={schema:'shelfdeck.buffalo-cpu-evidence-qualification@1',formalHostJourney:false,samples:[]};
async function main(){
  const session=createBuffaloCpuSession({modelRoot:'/catalogue/models/models/buffalo_l'}),deadline=()=>({deadlineAtMs:Date.now()+60000});
  const began=performance.now();let stopMs;
  try{
    await session.load(deadline());report.loadMs=performance.now()-began;
    for(const name of ['original-0','original-1','original-2','rolled-35']){
      const bytes=fs.readFileSync(path.join('/reference',name+'.png')),expected=reference.cases.find(x=>x.name===name),
        result=await session.analyzeEvidence(bytes,deadline()),accepted=result.faces.filter(face=>
          Math.trunc(face.rectangle[2])-Math.trunc(face.rectangle[0])>=40&&Math.trunc(face.rectangle[3])-Math.trunc(face.rectangle[1])>=40);
      assert.equal(accepted.length,expected.faces.length);
      const comparisons=accepted.map((face,i)=>{
        const previous=expected.faces[i],similarity=cosine(face.vector,previous.vector),box=[previous.box.x,previous.box.y,previous.box.x+previous.box.w,previous.box.y+previous.box.h],
          coordinateDifference=Math.max(...box.map((x,n)=>Math.abs(x-face.rectangle[n])));
        assert.ok(similarity>=policy.minimumEmbeddingCosine);assert.ok(coordinateDifference<=policy.maximumCoordinateDifferencePixels);
        return {cosine:similarity,maximumCoordinateDifference:coordinateDifference};
      });
      const evidence=frameEvidence({basisDigest:canonicalDigest({schema:'qualification-only-basis@1',name}),
        frame:{ordinal:0,stage:'initial',stratum:0,timestampMs:0,imageDigest:sha(bytes)},analysis:{...result,faces:accepted}}),crops=[];
      report.samples.push({name,comparisons,coordinateSpace:result.coordinateSpace,crops});
      for(const [faceOrdinal,face]of evidence.faces.entries()){
        const crop=await session.renderRepresentative({frameBytes:bytes,evidence,faceOrdinal,policy:representativeImagePolicy()},deadline());
        assert.equal(sha(crop.bytes),crop.proof.imageDigest);assert.equal(crop.proof.faceEvidenceDigest,face.faceEvidenceDigest);
        const reobserved=await session.analyzeEvidence(crop.bytes,deadline());
        crops.push({faceOrdinal,proof:crop.proof,detectedFaceCount:reobserved.faces.length,
          maximumFeatureCosine:reobserved.faces.length?Math.max(...reobserved.faces.map(x=>cosine(face.vector,x.vector))):null});
        assert.equal(reobserved.faces.length,1,'A qualified representative image must independently remain one detectable face.');
      }
      console.log(JSON.stringify({name,passed:true,cropCount:crops.length}));
    }
  }finally{const stopBegan=performance.now();await session.stop();stopMs=performance.now()-stopBegan;report.stopMs=stopMs;report.elapsedMs=performance.now()-began;}
}
main().then(()=>report.outcome='passed',error=>{report.outcome='failed';report.error={code:error.code||error.name,message:String(error.message).slice(0,512)};process.exitCode=1;})
  .finally(()=>fs.writeFileSync('/output/cpu-evidence-report.json',JSON.stringify(report)));
