'use strict';
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {createFfmpegProcessRegistry}=require('./clean-ffmpeg-process-registry');
const {computeBoundedMaterialFingerprint}=require('./helix/integrations/bounded-material-fingerprint');
const {uniformFrameTimes}=require('./helix/integrations/us-adult-frame-analysis');
function fail(code,message,details){throw Object.assign(new Error(message),{code,details});}
function createCleanUsAdultFrameExtractor(options){
  if(typeof options?.mediaProbe?.probe!=='function')throw new TypeError('US Adult frame extraction requires the Service media probe.');
  let binary=options.ffmpegPath||process.env.FFMPEG_PATH;
  if(!binary){try{binary=require('ffmpeg-static');}catch{fail('US_ADULT_FFMPEG_UNAVAILABLE','The bundled Service FFmpeg is unavailable.');}}
  if(typeof binary!=='string'||!binary)fail('US_ADULT_FFMPEG_UNAVAILABLE','The bundled Service FFmpeg is unavailable.');
  const registry=options.ffmpegProcessRegistry||createFfmpegProcessRegistry();
  async function verifySource(handle){
    const identity=handle.identity,observed=await computeBoundedMaterialFingerprint(handle.location),stat=observed.stat;
    if(String(stat.ino)!==identity.inode||Number(stat.size)!==identity.sizeBytes||observed.contentFingerprint!==identity.contentFingerprint||
      observed.fingerprintAlgorithm!==identity.fingerprintAlgorithm||observed.fingerprintVersion!==identity.fingerprintVersion||
      Number(stat.mtimeNs/1000000n)!==handle.expectedMtimeNs||Number(stat.ctimeNs/1000000n)!==handle.expectedCtimeNs)
      fail('US_ADULT_SOURCE_CHANGED','The frozen US Adult source file has changed.');
  }
  function readFrame(handle,timestampMs,assertActive){
    return new Promise((resolve,reject)=>{
      assertActive();
      const child=spawn(binary,['-hide_banner','-nostdin','-loglevel','error','-ss',(timestampMs/1000).toFixed(3),'-threads','1','-i',handle.location,
        '-map','0:v:0','-frames:v','1','-an','-sn','-vf','scale=1280:1280:force_original_aspect_ratio=decrease','-threads','1',
        '-f','image2pipe','-c:v','mjpeg','-q:v','2','pipe:1'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
      const chunks=[];let size=0,error=null,stderrSize=0;const stderrHash=createHash('sha256');
      const stop=cause=>{if(!error)error=cause;child.kill('SIGKILL');};
      const timeout=setTimeout(()=>stop(Object.assign(new Error('US Adult frame extraction timed out.'),{code:'US_ADULT_FRAME_TIMEOUT'})),30000);
      const authority=setInterval(()=>{try{assertActive();}catch(cause){stop(cause);}},250);
      registry.register(child);
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>10*1024*1024)stop(Object.assign(new Error('Decoded frame exceeds its byte limit.'),{code:'US_ADULT_FRAME_TOO_LARGE'}));else chunks.push(chunk);});
      child.stderr.on('data',chunk=>{stderrSize+=chunk.length;stderrHash.update(chunk);});
      child.once('error',cause=>{error=Object.assign(new Error('Service FFmpeg could not start.'),{code:'US_ADULT_FFMPEG_UNAVAILABLE',details:{causeCode:cause.code}});});
      child.once('close',code=>{
        clearTimeout(timeout);clearInterval(authority);registry.unregister(child);
        if(error)return reject(error);
        if(registry.wasInterrupted(child))return reject(Object.assign(new Error('Frame extraction stopped with the Service.'),{code:'US_ADULT_FRAME_INTERRUPTED'}));
        if(code!==0||!size)return reject(Object.assign(new Error('Service FFmpeg did not return a frame.'),{code:'US_ADULT_FRAME_FAILED',details:{exitCode:code,stderrSize,stderrDigest:stderrHash.digest('hex')}}));
        try{assertActive();resolve(Object.freeze({timestampMs,bytes:Buffer.concat(chunks,size)}));}catch(cause){reject(cause);}
      });
    });
  }
  async function extractPoints({sourceHandle,context,durationMs,timestampsMs,onFrame}){
    const owner=sourceHandle?.ownerDomain,authority=owner==='libra'?{scopeType:'libra_run',processType:'libra_run'}:
      owner==='arca'?{scopeType:'shelf_entry',processType:'arca_shelf_entry'}:null;
    if(sourceHandle?.schemaRef!=='helix://contracts/types/PhysicalMaterialReadHandle/v1'||!authority||sourceHandle.ownerScope?.scopeType!==authority.scopeType||
      sourceHandle.ownerScope.scopeId!==context?.ownerScope?.processId||context?.ownerScope?.domain!==owner||
      context.ownerScope.processType!==authority.processType||typeof context.assertExecutionActive!=='function')
      fail('US_ADULT_FRAME_AUTHORITY_INVALID','Frame extraction requires the exact owning Run or Shelf Entry physical read authority.');
    if(timestampsMs!==undefined&&(!Array.isArray(timestampsMs)||timestampsMs.length<1||timestampsMs.length>40||
      timestampsMs.some((point,index)=>!Number.isSafeInteger(point)||point<0||index>0&&point<=timestampsMs[index-1]))||
      onFrame!==undefined&&typeof onFrame!=='function')
      fail('US_ADULT_SAMPLING_INVALID','Explicit sampling points must be bounded, unique and ordered.');
    if(timestampsMs)timestampsMs=Object.freeze([...timestampsMs]);
    const active=()=>context.assertExecutionActive();active();await verifySource(sourceHandle);active();
    const probe=await options.mediaProbe.probe(sourceHandle);
    if(durationMs!==undefined&&(!Number.isSafeInteger(durationMs)||durationMs<1||durationMs!==probe.durationMs))
      fail('US_ADULT_SOURCE_PROBE_CHANGED','Frame sampling duration differs from the frozen source Probe.');
    const times=timestampsMs??uniformFrameTimes(durationMs??probe.durationMs),frames=[];
    if(times.some(point=>point>=probe.durationMs))fail('US_ADULT_SAMPLING_INVALID','A sampling point is outside the frozen source duration.');
    for(const timestampMs of times){
      const frame=await readFrame(sourceHandle,timestampMs,active);active();
      if(onFrame){await onFrame(frame);active();}else frames.push(frame);
    }
    await verifySource(sourceHandle);active();return Object.freeze(frames);
  }
  return Object.freeze({extract:request=>extractPoints({...request,timestampsMs:undefined,onFrame:undefined}),extractPoints,close:registry.close});
}
module.exports=Object.freeze({createCleanUsAdultFrameExtractor});
