'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createBuffaloCpuSession}=require('../../../src/helix/integrations/buffalo-cpu-session');
const {catalogueSearchPolicy}=require('../../../src/helix/contracts/face-catalogue-search-policy');
const policy=require('./parity-policy.json'),input=JSON.parse(fs.readFileSync('/inputs/catalogue-generation-report.json','utf8')),
  reference=JSON.parse(fs.readFileSync('/reference/reference.json','utf8')),report={schema:'shelfdeck.formal-face-catalogue-qualification@1',cases:[]};
async function main(){
  const session=createBuffaloCpuSession({modelRoot:'/catalogue/models/models/buffalo_l',catalogueRoot:'/catalogue',
    catalogueGeneration:input.generation,catalogueSearchPolicy:catalogueSearchPolicy()}),began=performance.now();
  try{
    report.loaded=await session.loadCatalogue({deadlineAtMs:Date.now()+120000});report.loadMs=performance.now()-began;
    for(const name of ['original-0','original-1','original-2','rolled-35']){
      const expected=reference.cases.find(x=>x.name===name);
      for(const [ordinal,face]of expected.faces.entries()){
        const found=await session.searchCatalogue(face.vector,{deadlineAtMs:Date.now()+5000}),difference=Math.max(...face.matches.map((match,i)=>Math.abs(match.combinedDistance-found.matches[i]?.combinedDistance)));
        assert.deepEqual(found.matches.map(x=>x.uid),face.matches.map(x=>x.uid));assert.ok(difference<=policy.maximumDistanceDifference);
        report.cases.push({name,ordinal,maximumDistanceDifference:difference,candidateCount:found.matches.length,generationDigest:found.generationDigest});
      }
    }
  }finally{const beganStop=performance.now();await session.stop();report.stopMs=performance.now()-beganStop;report.elapsedMs=performance.now()-began;}
}
main().then(()=>{report.outcome='passed';console.log(JSON.stringify({passed:true,cases:report.cases.length,loadMs:report.loadMs}));},error=>{
  report.outcome='failed';report.error={code:error.code||error.name,message:String(error.message).slice(0,512)};process.exitCode=1;
}).finally(()=>fs.writeFileSync('/output/formal-catalogue-report.json',JSON.stringify(report)));
