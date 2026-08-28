'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { createResourceWorkerRegistry } = require('./helix/platform/application/resource-worker-registry');
const { createResourceWorkerRepository } = require('./helix/platform/persistence/resource-worker-repository');
const { compileFfmpegPipeline, DV_SDR_FILTER, SDR_PROFILE_ID, DV_SDR_PROFILE_ID } = require('./clean-ffmpeg-pipeline');

const PROBES = Object.freeze([
  Object.freeze({ deviceId:'local-nvidia-nvenc-0', deviceKind:'nvidia_nvenc', encoder:'hevc_nvenc',
    modes:Object.freeze(['target_size','strict_abr','quality_bound']) }),
  Object.freeze({ deviceId:'local-intel-qsv-0', deviceKind:'intel_qsv', encoder:'hevc_qsv',
    modes:Object.freeze(['target_size','strict_abr','quality_bound']) }),
  Object.freeze({ deviceId:'local-amd-vaapi-0', deviceKind:'amd_vaapi', encoder:'hevc_vaapi',
    modes:Object.freeze(['target_size','strict_abr','quality_bound']) }),
  Object.freeze({ deviceId:'local-software-cpu-0', deviceKind:'software_cpu', encoder:'libx265',
    modes:Object.freeze(['two_pass_abr','strict_abr','quality_bound']) }),
]);
// NVENC's HEVC encoder rejects the 64x64 frame that older device discovery
// used even when the physical device and encoder are healthy.  Keep the probe
// tiny and bounded, but large enough to be accepted by every registered local
// encoder class.  This is a capability probe, not a throughput benchmark.
const DEVICE_PROBE_LAVFI_SOURCE = 'color=c=black:s=256x256:r=1:d=0.1';
const probeCache=new Map();
const digestText=(value)=>crypto.createHash('sha256').update(value).digest('hex');
function resolveFfmpegPath(explicit){
  if(typeof explicit==='string'&&explicit.trim())return explicit.trim();
  if(typeof process.env.FFMPEG_PATH==='string'&&process.env.FFMPEG_PATH.trim())return process.env.FFMPEG_PATH.trim();
  try { const bundled=require('ffmpeg-static');if(typeof bundled==='string'&&bundled)return bundled; } catch {}
  return 'ffmpeg';
}
function resolveFfprobePath(){try{const installed=require('@ffprobe-installer/ffprobe');return installed.path;}catch{return 'ffprobe';}}

function runProbe(executable, encoder, timeoutMs) {
  return new Promise((resolve) => {
    const nullTarget=process.platform==='win32'?'NUL':'/dev/null';
    const child=spawn(executable,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i',
      DEVICE_PROBE_LAVFI_SOURCE,'-frames:v','1','-c:v',encoder,'-f','null',nullTarget],
    {windowsHide:true,stdio:['ignore','ignore','pipe']});
    let bytes=0;const chunks=[];let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
    child.stderr.on('data',(chunk)=>{bytes+=chunk.length;if(bytes<=64*1024)chunks.push(Buffer.from(chunk));});
    child.once('error',(error)=>{clearTimeout(timer);resolve(Object.freeze({passed:false,reasonCode:'spawn_failed',
      evidenceDigest:canonicalDigest({encoder,errorCode:error.code||'unknown'})}));});
    child.once('close',(code)=>{clearTimeout(timer);const stderr=Buffer.concat(chunks).toString('utf8');
      resolve(Object.freeze({passed:!timedOut&&code===0,reasonCode:timedOut?'timeout':code===0?null:'encode_failed',
        evidenceDigest:canonicalDigest({encoder,exitCode:code,timedOut,stderrDigest:canonicalDigest(stderr),stderrBytes:bytes})}));});
  });
}

function runCommand(executable,args,timeoutMs){
  return new Promise((resolve)=>{const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let bytes=0;const chunks=[];let timedOut=false,settled=false;const finish=(value)=>{if(settled)return;settled=true;resolve(value);};
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
    child.stderr.on('data',(chunk)=>{bytes+=chunk.length;if(bytes<=64*1024)chunks.push(Buffer.from(chunk));});
    child.once('error',(error)=>{clearTimeout(timer);finish({passed:false,reasonCode:'spawn_failed',errorCode:error.code||'unknown'});});
    child.once('close',(code)=>{clearTimeout(timer);finish({passed:!timedOut&&code===0,
      reasonCode:timedOut?'timeout':code===0?null:'command_failed',exitCode:code,timedOut,
      stderrDigest:canonicalDigest(Buffer.concat(chunks).toString('utf8')),stderrBytes:bytes});});});
}

function runJsonCommand(executable,args,timeoutMs){return new Promise((resolve)=>{const child=spawn(executable,args,
  {windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timedOut=false,settled=false;
  const finish=(value)=>{if(settled)return;settled=true;resolve(value);},timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',(chunk)=>{if(stdout.length<64*1024)stdout+=chunk;});
  child.stderr.on('data',(chunk)=>{if(stderr.length<64*1024)stderr+=chunk;});
  child.once('error',(error)=>{clearTimeout(timer);finish({passed:false,errorCode:error.code||'unknown'});});
  child.once('close',(code)=>{clearTimeout(timer);if(timedOut||code!==0)return finish({passed:false,code,timedOut,stderrDigest:canonicalDigest(stderr)});
    try{finish({passed:true,value:JSON.parse(stdout),stdoutDigest:canonicalDigest(stdout)});}catch{finish({passed:false,code,reasonCode:'invalid_json'});}});});}

function probeVideo(mode,profileId){return Object.freeze({rateControlMode:mode,
  targetVideoBitrateBps:mode==='quality_bound'?null:1_000_000,qualityBound:mode==='quality_bound'?23:null,
  dynamicRangeOperation:profileId===DV_SDR_PROFILE_ID?'tone_map_to_sdr_bt709':'preserve',pipelineProfileId:profileId});}

async function createGeneratedProbeInput(executable,target,kind,timeoutMs){
  const hdr=kind==='hdr10_compatible';
  const colorArgs=kind==='unknown'?[]:['-color_range','tv','-color_primaries',hdr?'bt2020':'bt709',
    '-color_trc',hdr?'smpte2084':'bt709','-colorspace',hdr?'bt2020nc':'bt709'];
  return runCommand(executable,['-hide_banner','-nostdin','-loglevel','error','-y','-f','lavfi','-i',
    'color=c=white:s=256x256:r=24:d=0.5,format='+(hdr?'yuv420p10le':'yuv420p'),'-frames:v','12','-c:v',hdr?'libx265':'libx264',
    '-preset','ultrafast','-pix_fmt',hdr?'yuv420p10le':'yuv420p',...colorArgs,target],timeoutMs);
}

async function encodeProbeMode(executable,input,output,deviceClass,mode,profileId,timeoutMs){
  const compiled=compileFfmpegPipeline({deviceClass,video:probeVideo(mode,profileId)}),base=['-hide_banner','-nostdin','-loglevel','error','-y',
    ...compiled.inputArgs,'-i',input,'-map','0:v:0',...compiled.videoArgs],nullTarget=process.platform==='win32'?'NUL':'/dev/null';
  if(mode!=='two_pass_abr')return runCommand(executable,[...base,'-an','-sn','-f','matroska',output],timeoutMs);
  const passlog=output+'.passlog';
  try{
    const first=await runCommand(executable,[...base,'-pass','1','-passlogfile',passlog,'-an','-sn','-f','null',nullTarget],timeoutMs);
    if(!first.passed)return first;
    return runCommand(executable,[...base,'-pass','2','-passlogfile',passlog,'-an','-sn','-f','matroska',output],timeoutMs);
  }finally{for(const suffix of ['', '.log', '.log.mbtree', '-0.log', '-0.log.mbtree']){const item=passlog+suffix;if(fs.existsSync(item))fs.rmSync(item,{force:true});}}
}

function noDolbyVision(stream) {
  return !(stream?.side_data_list || []).some((item) => /dovi/i.test(String(item.side_data_type || '')));
}
function probeStreamMatchesProfile(profileId, inputKind, stream) {
  if (!stream || stream.codec_name !== 'hevc' || !noDolbyVision(stream)) return false;
  const toneMapped = profileId === DV_SDR_PROFILE_ID;
  if (toneMapped) {
    return stream.pix_fmt === 'yuv420p' && ['tv', 'mpeg'].includes(stream.color_range) &&
      stream.color_primaries === 'bt709' && stream.color_transfer === 'bt709' && stream.color_space === 'bt709';
  }
  if (!['yuv420p', 'yuv420p10le'].includes(stream.pix_fmt)) return false;
  if (stream.color_range && !['tv', 'mpeg', 'unknown', 'pc', 'jpeg'].includes(stream.color_range)) return false;
  return true;
}
async function validateProbeOutput(executable,output,profileId,inputKind,timeoutMs){
  const metadata=await runJsonCommand(resolveFfprobePath(),['-v','fatal','-of','json=compact=1','-select_streams','v:0',
    '-show_entries','stream=codec_name,pix_fmt,color_range,color_primaries,color_transfer,color_space:stream_side_data',output],timeoutMs),
    stream=metadata.value?.streams?.[0];
  if(!metadata.passed||!probeStreamMatchesProfile(profileId,inputKind,stream))
    return Object.freeze({passed:false,reasonCode:'pipeline_output_profile_failed',metadata});
  const decoded=await runCommand(executable,['-hide_banner','-nostdin','-loglevel','error','-i',output,'-map','0:v:0','-frames:v','1',
    '-f','null',process.platform==='win32'?'NUL':'/dev/null'],timeoutMs);
  return Object.freeze({passed:decoded.passed,reasonCode:decoded.passed?null:'pipeline_decode_failed',metadata,decoded});
}

async function runValidatedDeviceProfileProbe(executable,spec,profileId,modes,timeoutMs){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-device-pipeline-')),results=[],
    inputKinds=profileId===DV_SDR_PROFILE_ID?['hdr10_compatible']:['sdr','hdr10_compatible','unknown'],inputs=[];
  try{
    for(const inputKind of inputKinds){const input=path.join(root,'generated-'+inputKind+'.mkv'),generated=await createGeneratedProbeInput(executable,input,inputKind,timeoutMs);
      inputs.push(Object.freeze({inputKind,input,generated}));if(!generated.passed)return Object.freeze({passed:false,passedModes:Object.freeze([]),
        reasonCode:'pipeline_input_generation_failed',evidenceDigest:canonicalDigest({deviceClass:spec.deviceKind,profileId,inputKind,generated})});}
    for(const mode of modes)for(const item of inputs){const output=path.join(root,'probe-'+mode+'-'+item.inputKind+'.mkv');let encoded;
      try{encoded=await encodeProbeMode(executable,item.input,output,spec.deviceKind,mode,profileId,timeoutMs);}catch(error){encoded={passed:false,
        reasonCode:error?.code||'pipeline_compile_failed',errorDigest:canonicalDigest({message:error?.message||'unknown'})};}
      const verified=encoded.passed?await validateProbeOutput(executable,output,profileId,item.inputKind,timeoutMs):null;
      results.push(Object.freeze({mode,inputKind:item.inputKind,passed:Boolean(encoded.passed&&verified?.passed),encoded,verified}));}
    const passedModes=Object.freeze(modes.filter((mode)=>inputKinds.every((inputKind)=>results.some((item)=>item.mode===mode&&item.inputKind===inputKind&&item.passed))));
    return Object.freeze({passed:passedModes.length===modes.length,passedModes,reasonCode:passedModes.length===modes.length?null:'pipeline_mode_failed',
      evidenceDigest:canonicalDigest({deviceClass:spec.deviceKind,encoder:spec.encoder,profileId,inputs:inputs.map((item)=>({inputKind:item.inputKind,generated:item.generated})),results})});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

async function runValidatedPipelineProbe(executable,encoder,timeoutMs){
  const deviceKind=encoder==='hevc_nvenc'?'nvidia_nvenc':encoder==='hevc_qsv'?'intel_qsv':encoder==='hevc_vaapi'?'amd_vaapi':'software_cpu',
    modes=deviceKind==='software_cpu'?['quality_bound']:['quality_bound'];
  return runValidatedDeviceProfileProbe(executable,{deviceKind,encoder},DV_SDR_PROFILE_ID,modes,timeoutMs);
}

function pipeline(profileId,selfTestDigest){
  if(profileId===SDR_PROFILE_ID)return Object.freeze({pipelineProfileId:profileId,inputDynamicRangeKinds:Object.freeze(['sdr','hdr10_compatible','unknown']),
    inputPixelFormats:Object.freeze(['yuv420p','yuv420p10le']),outputCodec:'hevc',outputDynamicRangeKind:'unknown',
    outputPixelFormat:'encoder_selected',outputColorProfile:Object.freeze({range:'source',primaries:'source',transfer:'source',matrix:'source'}),selfTestDigest});
  return Object.freeze({pipelineProfileId:profileId,inputDynamicRangeKinds:Object.freeze(['dolby_vision','hdr10_compatible']),
    inputPixelFormats:Object.freeze(['yuv420p10le']),outputCodec:'hevc',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
    outputColorProfile:Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}),selfTestDigest});
}

async function createCleanComputeDeviceRuntime(options) {
  if(!options?.schemaManifest||!options.unitOfWork)throw new TypeError('Clean Compute Device Runtime requires clean persistence.');
  const now=options.now||Date.now,ffmpegPath=resolveFfmpegPath(options.ffmpegPath);
  const repository=createResourceWorkerRepository({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,
    digest:digestText});
  const verified=new Set();
  const registry=createResourceWorkerRegistry({repository,digest:digestText,now,nextHandleId:()=>canonicalDigest({schema:'clean-worker-handle@1',at:now()}),
    infrastructureProjection:{current:()=>Object.freeze({integrations:Object.freeze([]),volumes:Object.freeze([])})},
    probeVerifier:{verifyDevice:(proposal)=>verified.has(proposal.deviceId+'\0'+proposal.capabilityDigest),verifyWorker:()=>false}});
  let pending=probeCache.get(ffmpegPath);
  if(!pending){pending=Promise.all(PROBES.map(async(spec)=>{
    const ordinary=await runValidatedDeviceProfileProbe(ffmpegPath,spec,SDR_PROFILE_ID,spec.modes,options.pipelineTimeoutMs||30_000),
      ordinaryAvailable=ordinary.passedModes.length>0,
      dv=ordinaryAvailable?await runValidatedDeviceProfileProbe(ffmpegPath,spec,DV_SDR_PROFILE_ID,ordinary.passedModes,options.pipelineTimeoutMs||30_000):
        Object.freeze({passed:false,passedModes:Object.freeze([]),reasonCode:'ordinary_pipeline_unavailable',evidenceDigest:ordinary.evidenceDigest}),
      result=Object.freeze({passed:ordinaryAvailable,reasonCode:ordinaryAvailable?null:ordinary.reasonCode,
        evidenceDigest:canonicalDigest({ordinary,dv})});
    return Object.freeze({spec,result,ordinary,dv});}));probeCache.set(ffmpegPath,pending);}
  const observations=await pending;
  for(const {spec,result,ordinary,dv} of observations){
    const capability={supportedVideoCodecs:Object.freeze(['hevc']),supportedRateControlModes:ordinary.passedModes.length?ordinary.passedModes:spec.modes,
      validatedConcurrentSlots:1,validatedVideoPipelines:Object.freeze([
        pipeline(SDR_PROFILE_ID,ordinary.evidenceDigest),...(dv.passed?[pipeline(DV_SDR_PROFILE_ID,dv.evidenceDigest)]:[]),
      ])};
    const capabilityDigest=canonicalDigest(capability);
    const current=repository.getDevice(spec.deviceId);
    if(current&&current.enabled===result.passed&&current.state===(result.passed?'ready':'unavailable')&&
        current.capabilityDigest===capabilityDigest)continue;
    verified.add(spec.deviceId+'\0'+capabilityDigest);
    registry.publishDevice({deviceId:spec.deviceId,deviceKind:spec.deviceKind,stableDeviceKey:spec.deviceId,
      revision:current?current.revision+1:1,availability:result.passed?'available':'unavailable',enabled:result.passed,
      validatedConcurrentSlots:1,capability,probeResult:result.passed?'passed':'failed',probedAtMs:now()});
  }
  return registry;
}

module.exports=Object.freeze({PROBES,DEVICE_PROBE_LAVFI_SOURCE,DV_SDR_FILTER,SDR_PROFILE_ID,DV_SDR_PROFILE_ID,
  probeStreamMatchesProfile,runValidatedPipelineProbe,runValidatedDeviceProfileProbe,createCleanComputeDeviceRuntime});
