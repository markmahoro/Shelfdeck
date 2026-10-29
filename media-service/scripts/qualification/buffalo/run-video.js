'use strict';
// Read-only real-video qualification. It cannot publish People, actor choices or collection facts.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createCleanUsAdultFrameExtractor}=require('../../../src/clean-us-adult-frame-extractor');
const {createCleanMediaProbe}=require('../../../src/clean-media-probe');
const {computeBoundedMaterialFingerprint}=require('../../../src/helix/integrations/bounded-material-fingerprint');
const {createImageSession}=require('./image-session');
const {samplingPoints,clusterFaces,candidateEvidence}=require('./video-evidence');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const root=process.env.BUFFALO_VIDEO_OUTPUT||'/output',inputs=JSON.parse(fs.readFileSync('/inputs/inventory-inputs.json','utf8'));
const report={schema:'shelfdeck.buffalo-video-qualification@1',startedAt:new Date().toISOString(),automaticActorSelection:false,
  sampling:{initial:20,supplementLimit:20,range:[0.05,0.95],supplementExecuted:false},groupingThresholdGrid:[0.35,0.45,0.55,0.6],samples:[],control:{requests:0,errors:0,maximumMs:0}};
if(!Array.isArray(inputs)||inputs.length<1||inputs.length>4)throw Error('BOUNDED_INVENTORY_INPUT_REQUIRED');
for(const row of inputs){
  // Inventory stores the fingerprint version as TEXT; the public physical handle uses an integer.
  if(String(row.fingerprint_version)!=='1')throw Error('INVENTORY_FINGERPRINT_VERSION_UNSUPPORTED');
  row.fingerprint_version=Number(row.fingerprint_version);
}
fs.mkdirSync(root,{recursive:true});
const started=performance.now(),server=http.createServer((_,res)=>res.end('ok'));
let interval,stopped=false,session,extractor;
function checkpoint(){fs.writeFileSync(path.join(root,'video-report.json'),JSON.stringify(report));}
function assertActive(){if(stopped||performance.now()-started>900000)throw Object.assign(new Error('Qualification stopped or reached its deadline.'),{code:'BUFFALO_VIDEO_STOPPED'});}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let inFlight=false;
  interval=setInterval(()=>{
    if(inFlight)return;inFlight=true;const began=performance.now();
    const req=http.get({host:'127.0.0.1',port:server.address().port,path:'/',agent:false},res=>{
      res.resume();res.once('end',()=>{report.control.requests++;report.control.maximumMs=Math.max(report.control.maximumMs,performance.now()-began);inFlight=false;});
    });req.setTimeout(1500,()=>req.destroy());req.on('error',()=>{report.control.errors++;inFlight=false;});
  },100);
  session=createImageSession({modelRoot:'/catalogue/models/models/buffalo_l',catalogueRoot:'/catalogue'});
  let loading=performance.now();report.loaded=await session.load();report.loadMs=performance.now()-loading;
  extractor=createCleanUsAdultFrameExtractor({mediaProbe:createCleanMediaProbe()});
  for(const [sampleOrdinal,row]of inputs.entries()){
    assertActive();const location='/videos/video-'+sampleOrdinal,observed=await computeBoundedMaterialFingerprint(location),stat=observed.stat;
    if(String(stat.ino)!==row.inode||Number(stat.size)!==row.size_bytes||observed.contentFingerprint!==row.content_fingerprint||
      observed.fingerprintAlgorithm!==row.fingerprint_algorithm||observed.fingerprintVersion!==row.fingerprint_version)
      throw Object.assign(Error('Inventory material identity changed.'),{code:'BUFFALO_VIDEO_INVENTORY_CHANGED'});
    const sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',
      identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:row.material_key,mountScopeId:row.mount_scope_id,
        inode:row.inode,sizeBytes:row.size_bytes,contentFingerprint:row.content_fingerprint,fingerprintAlgorithm:row.fingerprint_algorithm,fingerprintVersion:row.fingerprint_version},
      location,ownerDomain:'arca',ownerScope:{scopeType:'shelf_entry',scopeId:row.shelf_entry_id},
      expectedMtimeNs:Number(stat.mtimeNs/1000000n),expectedCtimeNs:Number(stat.ctimeNs/1000000n)};
    const context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:row.shelf_entry_id},assertExecutionActive:assertActive};
    const probe=await createCleanMediaProbe().probe(sourceHandle),points=samplingPoints(probe.durationMs).initial;
    const sample={sampleOrdinal,shelfEntryId:row.shelf_entry_id,inventoryRevision:row.inventory_revision,materialKey:row.material_key,
      probe:{container:probe.container,durationMs:probe.durationMs,videoStreams:probe.videoStreams},sourceSnapshot:{inode:String(stat.ino),sizeBytes:Number(stat.size),
        mtimeNs:String(stat.mtimeNs),ctimeNs:String(stat.ctimeNs),contentFingerprint:observed.contentFingerprint},frames:[],faces:[],groups:[],outcome:'in_progress'};
    report.samples.push(sample);checkpoint();
    const destination=path.join(root,'sample-'+sampleOrdinal);fs.mkdirSync(destination,{recursive:true});
    const began=performance.now();
    await extractor.extractPoints({sourceHandle,context,durationMs:probe.durationMs,timestampsMs:points.map(x=>x.timestampMs),async onFrame(frame){
      const frameOrdinal=sample.frames.length,point=points[frameOrdinal],imageDigest=sha(frame.bytes);
      fs.writeFileSync(path.join(destination,'frame-'+frameOrdinal+'.jpg'),frame.bytes);
      const result=await session.frameEvidence(frame.bytes,{timeoutMs:60000});assertActive();
      sample.frames.push({...point,frameOrdinal,imageDigest,encodedBytes:frame.bytes.length,coordinateSpace:result.coordinateSpace,
        faceCount:result.faces.length,inferenceMs:result.elapsedMs,memory:result.memory});
      result.faces.forEach((face,faceOrdinal)=>{
        const width=face.rectangle[2]-face.rectangle[0],height=face.rectangle[3]-face.rectangle[1];
        sample.faces.push({...face,frameOrdinal,faceOrdinal,timestampMs:point.timestampMs,stratum:point.stratum,imageDigest,
          quality:Math.max(0,Math.min(1,face.confidence*Math.min(width,height)/160))});
      });
      checkpoint();console.log(JSON.stringify({sampleOrdinal,frameOrdinal,timestampMs:point.timestampMs,faces:result.faces.length,inferenceMs:result.elapsedMs}));
    }});
    sample.elapsedMs=performance.now()-began;
    for(const threshold of report.groupingThresholdGrid){
      const groups=clusterFaces(sample.faces,{threshold,assertActive});
      sample.groups.push({threshold,clusters:groups.map(cluster=>({...cluster,candidates:candidateEvidence(cluster,sample.faces)}))});
    }
    const after=await computeBoundedMaterialFingerprint(location);
    if(String(after.stat.ino)!==String(stat.ino)||after.stat.size!==stat.size||after.stat.mtimeNs!==stat.mtimeNs||after.stat.ctimeNs!==stat.ctimeNs||after.contentFingerprint!==observed.contentFingerprint)
      throw Object.assign(Error('Source bytes or identity changed during qualification.'),{code:'BUFFALO_VIDEO_SOURCE_CHANGED'});
    sample.outcome='completed';checkpoint();
    console.log(JSON.stringify({sampleOrdinal,outcome:sample.outcome,frames:sample.frames.length,faces:sample.faces.length,elapsedMs:sample.elapsedMs}));
  }
}
process.once('SIGTERM',()=>{stopped=true;void session?.stop();void extractor?.close();});
main().then(()=>{report.outcome='completed';},error=>{report.outcome='failed';report.error={code:error.code||'BUFFALO_VIDEO_QUALIFICATION_FAILED',message:String(error.message).slice(0,256)};process.exitCode=1;}).finally(async()=>{
  stopped=true;clearInterval(interval);const began=performance.now();await Promise.all([session?.stop(),extractor?.close()]);
  report.stopMs=performance.now()-began;report.finishedAt=new Date().toISOString();report.elapsedMs=performance.now()-started;
  try{report.cgroup={memoryPeak:fs.readFileSync('/sys/fs/cgroup/memory.peak','utf8').trim(),events:fs.readFileSync('/sys/fs/cgroup/memory.events','utf8').trim()};}catch{}
  checkpoint();await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify({outcome:report.outcome,error:report.error,samples:report.samples.length,elapsedMs:report.elapsedMs,control:report.control}));
});
