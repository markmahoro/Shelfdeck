'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCleanUsAdultFrameExtractor}=require('../../src/clean-us-adult-frame-extractor');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {createCleanMediaProbe}=require('../../src/clean-media-probe');
const {computeBoundedMaterialFingerprint}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createFfmpegProcessRegistry}=require('../../src/clean-ffmpeg-process-registry');
test('explicit video sampling rejects malformed or excessive points before reading material',async()=>{
  let reads=0;
  const extractor=createCleanUsAdultFrameExtractor({ffmpegPath:process.execPath,mediaProbe:{probe(){reads++;throw Error('Unexpected read');}}});
  const sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',ownerDomain:'arca',ownerScope:{scopeType:'shelf_entry',scopeId:'entry'}},
    context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive:()=>{}};
  try{
    for(const timestampsMs of [[],[NaN],[-1],[1.5],[2,1],[1,1],Array.from({length:41},(_,i)=>i)])
      await assert.rejects(extractor.extractPoints({sourceHandle,context,timestampsMs}),{code:'US_ADULT_SAMPLING_INVALID'});
    await assert.rejects(extractor.extractPoints({sourceHandle,context,timestampsMs:[1],onFrame:true}),{code:'US_ADULT_SAMPLING_INVALID'});
    await assert.rejects(extractor.extractPoints({sourceHandle,context:{...context,ownerScope:{...context.ownerScope,processId:'other'}},timestampsMs:[1]}),{code:'US_ADULT_FRAME_AUTHORITY_INVALID'});
    assert.equal(reads,0);
  }finally{await extractor.close();}
});
test('Linux FFmpeg streams exact bounded points, preserves the source, and stops without accepting partial success',{
  timeout:45000,skip:process.platform!=='linux'||!process.env.FFMPEG_PATH?'Linux Docker media binaries are required.':false,
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buffalo-frame-')),video=path.join(root,'source.mp4'),registry=createFfmpegProcessRegistry(),
    extractor=createCleanUsAdultFrameExtractor({ffmpegPath:process.env.FFMPEG_PATH,mediaProbe:createCleanMediaProbe(),ffmpegProcessRegistry:registry});
  t.after(async()=>{await extractor.close();assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const encoded=spawnSync(process.env.FFMPEG_PATH,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x240:rate=4:duration=2',
    '-an','-c:v','libx264','-preset','ultrafast','-threads','1','-y',video],{encoding:'utf8',timeout:15000});
  assert.equal(encoded.status,0,encoded.stderr);
  const observed=await computeBoundedMaterialFingerprint(video),stat=observed.stat,
    sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',ownerDomain:'arca',ownerScope:{scopeType:'shelf_entry',scopeId:'entry'},location:video,
      identity:{inode:String(stat.ino),sizeBytes:Number(stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
      expectedMtimeNs:Number(stat.mtimeNs/1000000n),expectedCtimeNs:Number(stat.ctimeNs/1000000n)},
    before=crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex');
  let active=true;const context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive(){
    if(!active)throw Object.assign(Error('Cancelled'),{code:'TEST_CANCELLED'});
  }};
  const received=[],points=[100,1100];
  const result=await extractor.extractPoints({sourceHandle,context,durationMs:2000,timestampsMs:points,onFrame:async frame=>{
    received.push(frame.timestampMs);assert.equal(frame.bytes.readUInt16BE(0),0xffd8);points.push(999999);
  }});
  assert.deepEqual(result,[],'A streaming sink does not retain a second in-memory copy of every frame.');
  assert.deepEqual(received,[100,1100],'Caller mutation cannot change the frozen sampling points.');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'),before);
  await assert.rejects(extractor.extractPoints({sourceHandle,context,durationMs:2000,timestampsMs:[2000]}),{code:'US_ADULT_SAMPLING_INVALID'});
  let partial=0;
  await assert.rejects(extractor.extractPoints({sourceHandle,context,durationMs:2000,timestampsMs:[100,1100],onFrame(){partial++;active=false;}}),{code:'TEST_CANCELLED'});
  assert.equal(partial,1);assert.equal(registry.size(),0);
  active=true;
  const stoppedRegistry=createFfmpegProcessRegistry();await stoppedRegistry.quiesce();
  const stopped=createCleanUsAdultFrameExtractor({ffmpegPath:process.env.FFMPEG_PATH,mediaProbe:createCleanMediaProbe(),ffmpegProcessRegistry:stoppedRegistry});
  try{await assert.rejects(stopped.extractPoints({sourceHandle,context,durationMs:2000,timestampsMs:[100]}),{code:'US_ADULT_FRAME_INTERRUPTED'});}
  finally{await stopped.close();}
  assert.equal(stoppedRegistry.size(),0);
  fs.appendFileSync(video,'changed');
  await assert.rejects(extractor.extractPoints({sourceHandle,context,durationMs:2000,timestampsMs:[100]}),{code:'US_ADULT_SOURCE_CHANGED'});
});
test('Linux 4K decoding emits a bounded frame without changing the physical source',{
  timeout:45000,skip:process.platform!=='linux'||!process.env.FFMPEG_PATH?'Linux Docker media binaries are required.':false,
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buffalo-4k-')),video=path.join(root,'source.mp4'),
    extractor=createCleanUsAdultFrameExtractor({ffmpegPath:process.env.FFMPEG_PATH,mediaProbe:createCleanMediaProbe()});
  t.after(async()=>{await extractor.close();assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const encoded=spawnSync(process.env.FFMPEG_PATH,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=size=3840x2160:rate=1:duration=2',
    '-an','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-threads','1','-y',video],{encoding:'utf8',timeout:25000});
  assert.equal(encoded.status,0,encoded.stderr);
  const observed=await computeBoundedMaterialFingerprint(video),stat=observed.stat,
    sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',ownerDomain:'arca',ownerScope:{scopeType:'shelf_entry',scopeId:'entry-4k'},location:video,
      identity:{inode:String(stat.ino),sizeBytes:Number(stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
      expectedMtimeNs:Number(stat.mtimeNs/1000000n),expectedCtimeNs:Number(stat.ctimeNs/1000000n)},
    context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry-4k'},assertExecutionActive(){}},
    probe=await createCleanMediaProbe().probe(sourceHandle);
  assert.equal(probe.videoStreams[0].width,3840);assert.equal(probe.videoStreams[0].height,2160);
  const frames=await extractor.extractPoints({sourceHandle,context,durationMs:2000,timestampsMs:[100]});
  const metadata=await require('sharp')(frames[0].bytes).metadata();
  assert.equal(metadata.width,1280);assert.equal(metadata.height,720);
  const after=await computeBoundedMaterialFingerprint(video);
  assert.equal(after.contentFingerprint,observed.contentFingerprint);assert.equal(after.stat.mtimeNs,stat.mtimeNs);assert.equal(after.stat.ctimeNs,stat.ctimeNs);
});
