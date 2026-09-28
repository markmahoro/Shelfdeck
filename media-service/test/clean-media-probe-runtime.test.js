'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {createCleanMediaProbe}=require('../src/clean-media-probe');
const handle={location:'/fixture/movie.mkv',identity:{materialKey:'fixture'}};
const topology={async inspect(){return null;}};
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
