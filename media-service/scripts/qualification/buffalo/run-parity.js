'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createImageSession}=require('./image-session');
const policy=require('./parity-policy.json');
async function main(){
  const referenceRoot=process.env.BUFFALO_REFERENCE_ROOT||'/reference';
  const reference=JSON.parse(fs.readFileSync(path.join(referenceRoot,'reference.json'),'utf8'));
  const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'parity-policy.json'))).digest('hex');
  assert.equal(digest,reference.policyDigest,'The comparison policy must be fixed before oracle inference.');
  const settings={modelRoot:'/catalogue/models/models/buffalo_l',catalogueRoot:'/catalogue'};
  const session=createImageSession(settings);
  const report={policyDigest:digest,node:process.version,cases:[],failures:[],maxMainLoopDelayMs:0,peakRssBytes:0};
  // This probes only the parent event loop, not business health or a production Host.
  const control=http.createServer((request,response)=>{response.setHeader('content-type','application/json');response.end('{"probe":"parent-event-loop"}');});
  await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
  let checking=false;
  report.controlProbe={requests:0,errors:0,maximumMs:0};
  const probe=setInterval(()=>{
    if(checking)return;checking=true;const began=performance.now();
    const request=http.get({hostname:'127.0.0.1',port:control.address().port,path:'/qualification-control',agent:false,timeout:policy.maximumMainLoopDelayMs},response=>{
      response.resume();response.once('end',()=>{checking=false;report.controlProbe.requests++;report.controlProbe.maximumMs=Math.max(report.controlProbe.maximumMs,performance.now()-began);});
    });
    request.on('timeout',()=>request.destroy(new Error('CONTROL_PROBE_TIMEOUT')));
    request.on('error',()=>{checking=false;report.controlProbe.errors++;});
  },100);
  let tick=performance.now();const timer=setInterval(()=>{const now=performance.now();report.maxMainLoopDelayMs=Math.max(report.maxMainLoopDelayMs,now-tick-10);tick=now;},10);
  const started=performance.now();
  const vectors=new Map();
  try{
    const loaded=session.load();
    await assert.rejects(session.load(),{code:'BUFFALO_BUSY'});
    report.loaded=await loaded;report.loadMs=performance.now()-started;
    const retiredFile='/retired-slot-vectors.json';
    report.retiredSlotQueries=[];
    for(const item of JSON.parse(fs.readFileSync(retiredFile,'utf8'))){
      const result=await session.query(item.vector);
      assert.ok(result.retiredSlots.some(value=>value.key===item.key),'An explicit null slot was not recorded.');
      assert.ok(result.matches.every(value=>value.key!==item.key),'An explicit null slot produced a performer.');
      report.retiredSlotQueries.push({key:item.key,recorded:result.retiredSlots});
    }
    for(const item of reference.cases){
      const bytes=fs.readFileSync(path.join(referenceRoot,item.rawFile));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256);
      const result=await session.analyzeRaw({data:bytes,width:item.width,height:item.height});
      vectors.set(item.name,result.faces.map(face=>face.vector));
      const comparisons=[];
      if(result.faces.length!==item.faces.length)report.failures.push({case:item.name,kind:'face_count',expected:item.faces.length,actual:result.faces.length});
      for(let i=0;i<Math.min(result.faces.length,item.faces.length);i++){
        const actual=result.faces[i],expected=item.faces[i];
        const dot=actual.vector.reduce((sum,value,n)=>sum+value*expected.vector[n],0);
        const norm=vector=>Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0));
        const cosine=dot/(norm(actual.vector)*norm(expected.vector));
        const coordinates=[expected.box.x,expected.box.y,expected.box.x+expected.box.w,expected.box.y+expected.box.h];
        const geometryDifference=Math.max(...actual.rectangle.map((value,n)=>Math.abs(value-coordinates[n])));
        const matches=actual.matches.map(value=>({uid:value.uid,name:value.name,distance:value.distance,combinedDistance:value.combinedDistance}));
        const expectedIds=expected.matches.map(value=>value.uid),actualIds=matches.map(value=>value.uid);
        const distanceDifference=Math.max(0,...matches.map(value=>{
          const prior=expected.matches.find(candidate=>candidate.uid===value.uid);
          return prior?Math.abs(value.combinedDistance-prior.combinedDistance):Infinity;
        }));
        const valid=cosine>=policy.minimumEmbeddingCosine&&geometryDifference<=policy.maximumCoordinateDifferencePixels&&
          distanceDifference<=policy.maximumDistanceDifference&&JSON.stringify(actualIds)===JSON.stringify(expectedIds);
        comparisons.push({cosine,geometryDifference,distanceDifference,matches,expectedMatches:expected.matches,valid,
          actualRotation:actual.rotationApplied,expectedRotation:expected.box.rotation_applied});
        if(!valid)report.failures.push({case:item.name,face:i,kind:'numerical_or_identity_parity'});
      }
      report.peakRssBytes=Math.max(report.peakRssBytes,result.memory.rss);
      report.cases.push({name:item.name,faces:result.faces.length,elapsedMs:result.elapsedMs,comparisons});
      console.log(JSON.stringify({case:item.name,faces:result.faces.length,elapsedMs:result.elapsedMs,valid:comparisons.every(value=>value.valid)}));
    }
    report.localReferenceQueries=[];
    const references=[0,1,2].map(number=>({number,vector:vectors.get('original-'+number)[0]}));
    for(const [name,expected]of [['smaller-0',0],['smaller-1',1],['smaller-2',2],['mirrored',0],['rolled-35',0]]){
      const query=vectors.get(name)[0];
      const ranked=references.map(reference=>({number:reference.number,cosine:reference.vector.reduce((sum,value,index)=>sum+value*query[index],0)}))
        .sort((a,b)=>b.cosine-a.cosine);
      assert.equal(ranked[0].number,expected,'A local reference image selected the wrong sample identity.');
      report.localReferenceQueries.push({name,ranked});
    }
    // The encoded input route is independently exercised; raw-input parity cannot hide a decoder discrepancy.
    const encoded=await session.analyze(fs.readFileSync(path.join(referenceRoot,'original-0.png')));
    const first=reference.cases.find(value=>value.name==='original-0');
    assert.equal(encoded.faces.length,first.faces.length);
    report.encodedTopMatch=encoded.faces[0]?.matches[0]?.uid;
    assert.equal(report.encodedTopMatch,first.faces[0]?.matches[0]?.uid);
    const encodedCosine=(left,right)=>{
      const dot=left.reduce((sum,value,index)=>sum+value*right[index],0);
      return dot/Math.sqrt(left.reduce((sum,value)=>sum+value*value,0)*right.reduce((sum,value)=>sum+value*value,0));
    };
    report.encodedPngCosine=encodedCosine(encoded.faces[0].vector,first.faces[0].vector);
    assert.ok(report.encodedPngCosine>=policy.minimumEmbeddingCosine,'Decoded PNG feature parity failed.');
    for(let number=0;number<3;number++){
      const jpeg=await session.analyze(fs.readFileSync('/qualification/sample-'+number+'.image'));
      const oracle=reference.cases.find(item=>item.name==='original-'+number);
      assert.equal(jpeg.faces.length,oracle.faces.length,'Original encoded face-count parity failed.');
      const cosine=encodedCosine(jpeg.faces[0].vector,oracle.faces[0].vector);
      assert.ok(cosine>=policy.minimumEmbeddingCosine,'Original encoded feature parity failed.');
      assert.equal(jpeg.faces[0].matches[0]?.uid,oracle.faces[0].matches[0]?.uid,'Original encoded identity parity failed.');
      (report.encodedOriginals||=[]).push({number,cosine,topMatch:jpeg.faces[0].matches[0]?.uid});
    }
    await assert.rejects(session.analyze(Buffer.from('not an image')),{code:'BUFFALO_IMAGE_INVALID'});
    const cancel=new AbortController();cancel.abort();
    await assert.rejects(session.analyze(Buffer.alloc(1),{signal:cancel.signal}),{code:'BUFFALO_CANCELLED'});
    const controller=new AbortController();
    const inFlight=session.analyzeRaw({data:fs.readFileSync(path.join(referenceRoot,'original-0.rgb')),width:first.width,height:first.height},{signal:controller.signal});
    let cancelledAt;
    setTimeout(()=>{cancelledAt=performance.now();controller.abort();},10);
    await assert.rejects(inFlight,{code:'BUFFALO_CANCELLED'});
    await session.stop();report.stopMs=performance.now()-cancelledAt;
    await assert.rejects(session.load(),{code:'BUFFALO_CLOSED'});
    if(report.stopMs>policy.maximumStopMs)report.failures.push({kind:'stop_budget'});
    const deadlineSession=createImageSession(settings);
    try{await assert.rejects(deadlineSession.load({timeoutMs:20}),{code:'BUFFALO_TIMEOUT'});report.deadlineRejection=true;}
    finally{await deadlineSession.stop();}
  }catch(error){report.failures.push({kind:'execution',code:error.code,message:error.message});}
  finally{await session.stop();clearInterval(timer);clearInterval(probe);await new Promise(resolve=>control.close(resolve));}
  if(report.maxMainLoopDelayMs>policy.maximumMainLoopDelayMs)report.failures.push({kind:'main_loop_budget'});
  if(report.peakRssBytes>policy.maximumContainerBytes)report.failures.push({kind:'rss_budget'});
  if(report.controlProbe.errors||report.controlProbe.maximumMs>policy.maximumMainLoopDelayMs)report.failures.push({kind:'control_probe_budget'});
  report.cgroup={};
  for(const name of ['memory.current','memory.peak','memory.events']){
    const file='/sys/fs/cgroup/'+name;if(fs.existsSync(file))report.cgroup[name]=fs.readFileSync(file,'utf8').trim();
  }
  if(/(?:^|\n)oom(?:_kill)? [1-9]/.test(report.cgroup['memory.events']||''))report.failures.push({kind:'cgroup_oom'});
  const output=process.env.BUFFALO_REPORT_FILE;
  if(!output)throw new Error('An explicit qualification output file is required.');
  fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({complete:report.cases.length,failures:report.failures,loadMs:report.loadMs,maxMainLoopDelayMs:report.maxMainLoopDelayMs,stopMs:report.stopMs,peakRssBytes:report.peakRssBytes}));
  if(report.failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
