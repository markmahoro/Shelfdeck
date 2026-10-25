'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {createCleanMediaProbe}=require('../src/clean-media-probe');
const handle={location:'/fixture/movie.mkv',identity:{materialKey:'fixture'}};
const topology={async inspect(){return null;}};

for(const format of ['mpegts','matroska'])test('Configured Media Probe reads real '+format+' and preserves declared color facts',async t=>{
  const {spawnSync}=require('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-probe-format-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const location=path.join(root,format==='mpegts'?'sample.ts':'sample.mkv');
  const encoder=process.env.FFMPEG_PATH||require('ffmpeg-static');
  const encoded=spawnSync(encoder,['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=128x72:rate=24:duration=1',
    '-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited',
    '-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv',
    '-f',format,location],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(encoded.status,0,encoded.stderr);
  const result=await createCleanMediaProbe({discTopologyReader:topology}).probe({location,identity:{materialKey:'generated-'+format}});
  assert.equal(result.resultKind,'probed');assert.ok(result.durationMs>0);
  const video=result.videoStreams[0];assert.equal(video.codec,'hevc');assert.equal(video.width,128);assert.equal(video.height,72);
  assert.equal(video.colorPrimaries,'bt709');assert.equal(video.colorTransfer,'bt709');assert.equal(video.dynamicRangeKind,'sdr');
});
test('Media Probe honors configured FFPROBE_PATH and explicit binary precedence',async()=>{
  const previous=process.env.FFPROBE_PATH;
  process.env.FFPROBE_PATH=path.join(os.tmpdir(),'missing-secondary-probe-executable');
  try{
    await assert.rejects(createCleanMediaProbe({discTopologyReader:topology}).probe(handle),error=>error.code==='CLEAN_MEDIA_PROBE_EXECUTION'&&error.details.cause==='ENOENT');
    await assert.rejects(createCleanMediaProbe({binary:process.execPath,discTopologyReader:topology}).probe(handle),{code:'CLEAN_MEDIA_PROBE_CONTRACT'});
  }finally{if(previous===undefined)delete process.env.FFPROBE_PATH;else process.env.FFPROBE_PATH=previous;}
});
test('A crashed FFprobe is a technical error, never successful non-media evidence',{skip:process.platform==='win32'},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-probe-signal-')),binary=path.join(root,'probe');
  try{
    fs.writeFileSync(binary,'#!/bin/sh\nkill -SEGV $$\n',{mode:0o700});
    await assert.rejects(createCleanMediaProbe({binary,discTopologyReader:topology}).probe(handle),error=>error.code==='CLEAN_MEDIA_PROBE_EXECUTION'&&error.details.cause==='CLEAN_MEDIA_PROBE_PROCESS_SIGNAL');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
