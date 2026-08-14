'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { createResourceWorkerRegistry } = require('./helix/platform/application/resource-worker-registry');
const { createResourceWorkerRepository } = require('./helix/platform/persistence/resource-worker-repository');

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

const SDR_PROFILE_ID='ordinary_to_hevc@1';
const DV_SDR_PROFILE_ID='pq_bt2020_base_to_sdr_bt709_hevc@1';
const DV_SDR_FILTER='setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=limited,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

async function runValidatedPipelineProbe(executable,encoder,timeoutMs){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-device-pipeline-')),output=path.join(root,'probe.mkv');
  try{
    const encoded=await runCommand(executable,['-hide_banner','-nostdin','-loglevel','error','-y','-f','lavfi','-i',
      'color=c=white:s=256x256:r=24:d=0.25,format=yuv420p10le','-vf',DV_SDR_FILTER,'-frames:v','6',
      '-c:v',encoder,'-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',output],timeoutMs);
    if(!encoded.passed)return Object.freeze({passed:false,reasonCode:'pipeline_encode_failed',evidenceDigest:canonicalDigest(encoded)});
    const metadata=await runJsonCommand(resolveFfprobePath(),['-v','fatal','-of','json=compact=1','-select_streams','v:0',
      '-show_entries','stream=codec_name,pix_fmt,color_range,color_primaries,color_transfer,color_space:stream_side_data',output],timeoutMs);
    const stream=metadata.value?.streams?.[0],metadataPassed=metadata.passed&&stream?.codec_name==='hevc'&&stream?.pix_fmt==='yuv420p'&&
      ['tv','mpeg'].includes(stream?.color_range)&&stream?.color_primaries==='bt709'&&stream?.color_transfer==='bt709'&&stream?.color_space==='bt709'&&
      !(stream?.side_data_list||[]).some((item)=>/dovi/i.test(String(item.side_data_type||'')));
    if(!metadataPassed)return Object.freeze({passed:false,reasonCode:'pipeline_output_profile_failed',
      evidenceDigest:canonicalDigest({encoder,filter:DV_SDR_FILTER,encoded,metadata})});
    const decoded=await runCommand(executable,['-hide_banner','-nostdin','-loglevel','error','-i',output,'-map','0:v:0','-frames:v','1','-f','null',process.platform==='win32'?'NUL':'/dev/null'],timeoutMs);
    return Object.freeze({passed:decoded.passed,reasonCode:decoded.passed?null:'pipeline_decode_failed',
      evidenceDigest:canonicalDigest({encoder,filter:DV_SDR_FILTER,encoded,metadata,decoded})});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

function pipeline(profileId,selfTestDigest){
  if(profileId===SDR_PROFILE_ID)return Object.freeze({pipelineProfileId:profileId,inputDynamicRangeKinds:Object.freeze(['sdr','hdr10_compatible','hlg','unknown']),
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
  if(!pending){pending=Promise.all(PROBES.map(async(spec)=>{const result=await runProbe(ffmpegPath,spec.encoder,options.timeoutMs||15_000);
    const dv=result.passed?await runValidatedPipelineProbe(ffmpegPath,spec.encoder,options.pipelineTimeoutMs||30_000):
      Object.freeze({passed:false,reasonCode:'device_unavailable',evidenceDigest:result.evidenceDigest});
    return Object.freeze({spec,result,dv});}));probeCache.set(ffmpegPath,pending);}
  const observations=await pending;
  for(const {spec,result,dv} of observations){
    const capability={supportedVideoCodecs:Object.freeze(['hevc']),supportedRateControlModes:spec.modes,
      validatedConcurrentSlots:1,validatedVideoPipelines:Object.freeze([
        pipeline(SDR_PROFILE_ID,result.evidenceDigest),...(dv.passed?[pipeline(DV_SDR_PROFILE_ID,dv.evidenceDigest)]:[]),
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
  runValidatedPipelineProbe,createCleanComputeDeviceRuntime});
