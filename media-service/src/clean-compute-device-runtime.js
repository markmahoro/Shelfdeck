'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
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
const probeCache=new Map();
const digestText=(value)=>crypto.createHash('sha256').update(value).digest('hex');
function resolveFfmpegPath(explicit){
  if(typeof explicit==='string'&&explicit.trim())return explicit.trim();
  if(typeof process.env.FFMPEG_PATH==='string'&&process.env.FFMPEG_PATH.trim())return process.env.FFMPEG_PATH.trim();
  try { const bundled=require('ffmpeg-static');if(typeof bundled==='string'&&bundled)return bundled; } catch {}
  return 'ffmpeg';
}

function runProbe(executable, encoder, timeoutMs) {
  return new Promise((resolve) => {
    const nullTarget=process.platform==='win32'?'NUL':'/dev/null';
    const child=spawn(executable,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i',
      'color=c=black:s=64x64:r=1:d=0.1','-frames:v','1','-c:v',encoder,'-f','null',nullTarget],
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
  if(!pending){pending=Promise.all(PROBES.map(async(spec)=>Object.freeze({spec,result:await runProbe(ffmpegPath,spec.encoder,
    options.timeoutMs||15_000)})));probeCache.set(ffmpegPath,pending);}
  const observations=await pending;
  for(const {spec,result} of observations){
    const capability={supportedVideoCodecs:Object.freeze(['hevc']),supportedRateControlModes:spec.modes,
      probeEvidenceDigest:result.evidenceDigest,logicalCpu:spec.deviceKind==='software_cpu'?Math.max(1,os.cpus().length):null};
    const withSlots={...capability,validatedConcurrentSlots:1},capabilityDigest=canonicalDigest(withSlots);
    const current=repository.getDevice(spec.deviceId);
    if(current&&current.enabled===result.passed&&current.state===(result.passed?'ready':'unavailable')&&
        current.capability.probeEvidenceDigest===result.evidenceDigest)continue;
    verified.add(spec.deviceId+'\0'+capabilityDigest);
    registry.publishDevice({deviceId:spec.deviceId,deviceKind:spec.deviceKind,stableDeviceKey:spec.deviceId,
      revision:current?current.revision+1:1,availability:result.passed?'available':'unavailable',enabled:result.passed,
      validatedConcurrentSlots:1,capability,probeResult:result.passed?'passed':'failed',probedAtMs:now()});
  }
  return registry;
}

module.exports=Object.freeze({PROBES,createCleanComputeDeviceRuntime});
