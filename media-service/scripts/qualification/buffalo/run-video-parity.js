'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createImageSession}=require('./image-session'),policy=require('./parity-policy.json'),math=require('./buffalo-math');
const reference=JSON.parse(fs.readFileSync('/reference/reference.json','utf8'));
const report={schema:'shelfdeck.buffalo-video-image-parity@1',cases:[]};
const cosine=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b));
async function main(){
  const session=createImageSession({modelRoot:'/catalogue/models/models/buffalo_l',catalogueRoot:'/catalogue'});
  try{
    await session.load();
    for(const name of ['original-0','original-1','original-2','rolled-35']){
      const prior=reference.cases.find(x=>x.name===name),bytes=fs.readFileSync(path.join('/reference',name+'.png')),
        image=await require('sharp')(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true}),result=await session.frameEvidence(bytes);
      assert.equal(result.faces.length,prior.faces.length);
      const comparisons=result.faces.map((face,i)=>{
        const expected=prior.faces[i],similarity=cosine(face.vector,expected.vector),coordinates=[expected.box.x,expected.box.y,expected.box.x+expected.box.w,expected.box.y+expected.box.h],
          difference=Math.max(...coordinates.map((x,n)=>Math.abs(x-face.rectangle[n])));
        assert.ok(similarity>=policy.minimumEmbeddingCosine);assert.ok(difference<=policy.maximumCoordinateDifferencePixels);
        assert.deepEqual(face.matches.map(x=>x.uid),expected.matches.map(x=>x.uid));
        return {cosine:similarity,maximumCoordinateDifference:difference};
      });
      const canvas=result.coordinateSpace.rotationDegrees?math.rotateNearest({data:image.data,width:image.info.width,height:image.info.height},result.coordinateSpace.rotationDegrees):
        {data:image.data,width:image.info.width,height:image.info.height};
      assert.equal(result.coordinateSpace.width,canvas.width);assert.equal(result.coordinateSpace.height,canvas.height);
      assert.equal(result.coordinateSpace.sourceWidth,image.info.width);assert.equal(result.coordinateSpace.sourceHeight,image.info.height);
      assert.equal(result.coordinateSpace.pixelDigest,crypto.createHash('sha256').update(canvas.data).digest('hex'));
      report.cases.push({name,comparisons,coordinateSpace:result.coordinateSpace});console.log(JSON.stringify({name,passed:true}));
    }
  }finally{await session.stop();}
}
main().then(()=>{report.outcome='passed';},error=>{report.outcome='failed';report.error={code:error.code||error.name,message:error.message};process.exitCode=1;})
  .finally(()=>fs.writeFileSync('/output/video-image-parity.json',JSON.stringify(report)));
