'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { DV_SDR_FILTER } = require('./clean-compute-device-runtime');

class CleanMediaProductionEffectPortError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'CleanMediaProductionEffectPortError'; this.code = code; this.details = details;
  }
}

function fail(code, message, details) { throw new CleanMediaProductionEffectPortError(code, message, details); }
function location(handle) { return path.resolve(String(handle?.location || '').replace(/\//g, path.sep)); }
function escapeConcat(value) { return value.replaceAll("'", "'\\''"); }
function resolveFfmpegPath(explicit){
  if(typeof explicit==='string'&&explicit.trim())return explicit.trim();
  if(typeof process.env.FFMPEG_PATH==='string'&&process.env.FFMPEG_PATH.trim())return process.env.FFMPEG_PATH.trim();
  try { const bundled=require('ffmpeg-static');if(typeof bundled==='string'&&bundled)return bundled; } catch {}
  return 'ffmpeg';
}

function runProcess(executable, argv, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { windowsHide:true, stdio:['ignore', 'ignore', 'pipe'] });
    const chunks = []; let total = 0; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      total += chunk.length;
      if (total <= 256 * 1024) chunks.push(Buffer.from(chunk));
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(chunks).toString('utf8');
      if (timedOut) return reject(Object.assign(new Error('FFmpeg timed out.'), { code:'LIBRA_MEDIA_FFMPEG_TIMEOUT' }));
      if (code !== 0) return reject(Object.assign(new Error('FFmpeg failed.'), {
        code:'LIBRA_MEDIA_FFMPEG_FAILED', details:{ exitCode:code, stderr:stderr.slice(-8192) },
      }));
      resolve(Object.freeze({ exitCode:code, stderrDigest:canonicalDigest(stderr), stderrBytes:total }));
    });
  });
}

function createCleanMediaProductionEffectPort(options) {
  if (!options?.workspaceProductPort || typeof options.workspaceProductPort.materializeMedia !== 'function') {
    fail('LIBRA_MEDIA_WORKSPACE_REQUIRED', 'Media Effect port requires the clean Workspace media sink.');
  }
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  const timeoutMs = options.timeoutMs || 12 * 60 * 60 * 1000;
  function sourceLocation(handle) {
    if (handle?.schemaRef === 'helix://contracts/types/WorkspaceMaterialHandle/v1') {
      if (typeof options.workspaceProductPort.resolveMaterialLocation !== 'function') {
        fail('LIBRA_MEDIA_WORKSPACE_SOURCE_UNRESOLVED', 'Workspace source requires the typed Workspace material resolver.');
      }
      return options.workspaceProductPort.resolveMaterialLocation(handle);
    }
    const resolved = location(handle);
    if (!handle?.location || !resolved) {
      fail('LIBRA_MEDIA_SOURCE_UNRESOLVED', 'Media source handle has no resolvable physical location.');
    }
    return resolved;
  }

  function inputArguments(source, temporaryTarget) {
    const primaries = source.primaryMembers || [];
    if (primaries.length === 1) return Object.freeze({ argv:['-i', location(primaries[0].readHandle)], cleanup:null });
    const listPath = temporaryTarget + '.concat.txt';
    fs.writeFileSync(listPath, primaries.map((item) => "file '" + escapeConcat(location(item.readHandle).replace(/\\/g, '/')) + "'").join('\n') + '\n', 'utf8');
    return Object.freeze({ argv:['-f', 'concat', '-safe', '0', '-i', listPath], cleanup:() => {
      if (fs.existsSync(listPath)) fs.rmSync(listPath, { force:true });
    } });
  }

  function encoderArguments(intent, device) {
    const klass = device.deviceClass;
    const encoder = klass === 'nvidia_nvenc' ? 'hevc_nvenc' : klass === 'intel_qsv' ? 'hevc_qsv' :
      klass === 'amd_vaapi' ? 'hevc_vaapi' : klass === 'software_cpu' ? 'libx265' : null;
    if (!encoder) fail('LIBRA_MEDIA_DEVICE_UNSUPPORTED', 'Selected compute device has no local FFmpeg encoder.', { deviceClass:klass });
    if (intent.video.rateControlMode === 'quality_bound') {
      return klass === 'software_cpu' ? ['-c:v', encoder, '-crf', String(intent.video.qualityBound)] :
        ['-c:v', encoder, '-cq', String(intent.video.qualityBound)];
    }
    const bitrate = String(intent.video.targetVideoBitrateBps);
    if (intent.video.rateControlMode === 'strict_abr') return ['-c:v', encoder, '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', String(intent.video.targetVideoBitrateBps * 2)];
    return ['-c:v', encoder, '-b:v', bitrate];
  }

  function productStreamMap() {
    // A Libra Movie product contains the selected video plus media streams.
    // Container attachments and unknown data streams are not Primary media and
    // must not silently survive a normalization encode (notably test padding,
    // stale cover attachments, or a carried DOVI configuration side channel).
    return ['-map', '0:v:0', '-map', '0:a?', '-map', '0:s?'];
  }

  function videoProfileArguments(intent){
    if(intent.video.dynamicRangeOperation!=='tone_map_to_sdr_bt709')return [];
    if(intent.video.pipelineProfileId!=='pq_bt2020_base_to_sdr_bt709_hevc@1')
      fail('LIBRA_MEDIA_PIPELINE_PROFILE','DV normalization requires the closed PQ/BT.2020 to SDR pipeline.');
    return ['-vf',DV_SDR_FILTER,'-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709',
      '-color_trc','bt709','-colorspace','bt709','-map_metadata','-1'];
  }

  async function verifyTranscodeInput(request){
    const source=sourceLocation(request.sourceHandle),intent=request.productionIntent,device=request.deviceSnapshot,
      durationMs=Math.max(1,Number(request.sourceProbeEvidence.durationMs||1)),points=[5,50,95],encoding=encoderArguments(intent,device),
      profile=videoProfileArguments(intent),passed=[];
    for(const point of points){const seconds=Math.max(0,durationMs/1000*point/100);
      try{await runProcess(ffmpegPath,['-hide_banner','-nostdin','-loglevel','error','-ss',seconds.toFixed(3),'-i',source,
        '-map','0:v:0','-frames:v','8',...profile,...encoding,'-an','-sn','-f','null',process.platform==='win32'?'NUL':'/dev/null'],30_000);
        passed.push(point);
      }catch(error){if(error?.code==='LIBRA_MEDIA_FFMPEG_TIMEOUT'||error?.code==='ENOENT'||error?.code==='EACCES')throw error;
        return Object.freeze({sampleCount:24,passedSampleCount:passed.length*8,reasonCode:'encoder_rejected_source_pipeline',
          samplePointsPercent:Object.freeze(points),passedSamplePointsPercent:Object.freeze(passed),
          preflightDigest:canonicalDigest({schema:'libra.transcode-preflight@1',sourceHandleDigest:canonicalDigest(request.sourceHandle),
            intentDigest:intent.intentDigest,deviceSnapshotDigest:device.snapshotDigest,points,passed,errorCode:error?.code||'unknown'})});}
    }
    return Object.freeze({sampleCount:24,passedSampleCount:24,reasonCode:null,samplePointsPercent:Object.freeze(points),
      passedSamplePointsPercent:Object.freeze(passed),preflightDigest:canonicalDigest({schema:'libra.transcode-preflight@1',
        sourceHandleDigest:canonicalDigest(request.sourceHandle),intentDigest:intent.intentDigest,deviceSnapshotDigest:device.snapshotDigest,points,passed})});
  }

  async function verifyPlayback(request){
    const handle=request.workspaceMediaHandle?.workspaceMaterialHandle||request.workspaceMaterialHandle||request,
      source=sourceLocation(handle),durationMs=Math.max(1,Number(request.outputProbeEvidence?.durationMs||1)),points=[5,50,95],passed=[];
    for(const point of points){const seconds=Math.max(0,durationMs/1000*point/100);
      try{await runProcess(ffmpegPath,['-hide_banner','-nostdin','-loglevel','error','-ss',seconds.toFixed(3),'-i',source,
        '-map','0:v:0','-frames:v','1','-f','null',process.platform==='win32'?'NUL':'/dev/null'],30_000);passed.push(point);}
      catch(error){if(error?.code==='LIBRA_MEDIA_FFMPEG_TIMEOUT'||error?.code==='ENOENT'||error?.code==='EACCES')throw error;}
    }
    return Object.freeze({samplePointsPercent:Object.freeze(points),passedSamplePointsPercent:Object.freeze(passed),
      decodeDigest:canonicalDigest({schema:'libra.product-playback-decode@1',handleDigest:canonicalDigest(handle),points,passed})});
  }

  async function executeRemux(request) {
    const target = request.outputTarget;
    return options.workspaceProductPort.materializeMedia({ libraRunId:target.libraRunId, workspaceId:target.workspaceId,
      relativePath:target.targetRelativePath, intentDigest:request.productionIntent.intentDigest,
      idempotencyKey:request.idempotencyKey, effectScopeDigest:target.effectScopeDigest,
      outputTargetId:target.targetId, outputTargetDigest:target.targetDigest,
      runtimeEffectAuthority:request.runtimeEffectAuthority,
      async produce(temporaryTarget) {
        const input = inputArguments(request.source, temporaryTarget);
        try {
          await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-fflags', '+genpts', ...input.argv, '-map', '0', '-c', 'copy', '-f', 'matroska', temporaryTarget], timeoutMs);
        } finally { input.cleanup?.(); }
      } });
  }

  async function executeTranscode(request) {
    const target = request.outputTarget;
    return options.workspaceProductPort.materializeMedia({ libraRunId:target.libraRunId, workspaceId:target.workspaceId,
      relativePath:target.targetRelativePath, intentDigest:request.productionIntent.intentDigest,
      idempotencyKey:request.idempotencyKey, effectScopeDigest:target.effectScopeDigest,
      outputTargetId:target.targetId, outputTargetDigest:target.targetDigest,
      runtimeEffectAuthority:request.runtimeEffectAuthority,
      async produce(temporaryTarget) {
        const source=sourceLocation(request.sourceHandle),encoding=encoderArguments(request.productionIntent, request.deviceSnapshot),
          profile=videoProfileArguments(request.productionIntent),
          normalizeDolbyVision=request.productionIntent.video.dynamicRangeOperation==='tone_map_to_sdr_bt709',
          normalizedVideoTarget=temporaryTarget+'.normalized-video.ts';
        async function muxNormalizedVideo() {
          await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',normalizedVideoTarget,'-i',source,
            '-map','0:v:0','-map','1:a?','-map','1:s?','-c:v','copy','-c:a','copy','-c:s','copy',
            '-map_metadata','-1','-f','matroska',temporaryTarget],timeoutMs);
        }
        if(request.productionIntent.video.rateControlMode==='two_pass_abr'){
          const passlog=temporaryTarget+'.passlog',nullTarget=process.platform==='win32'?'NUL':'/dev/null';
          try {
            await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,'-map','0:v:0',...profile,...encoding,
              '-pass','1','-passlogfile',passlog,'-an','-sn','-f','null',nullTarget],timeoutMs);
            if(normalizeDolbyVision){
              // FFmpeg 6.x Matroska propagation can copy the source DOVI
              // configuration side-data even after a full pixel encode. A
              // video-only MPEG-TS boundary preserves timestamps and the new
              // HEVC bytes while deliberately severing that source metadata.
              // The final mux then carries audio/subtitles from the source,
              // never the source video stream or its DOVI configuration.
              await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,'-map','0:v:0',...profile,...encoding,
                '-pass','2','-passlogfile',passlog,'-an','-sn','-f','mpegts',normalizedVideoTarget],timeoutMs);
              await muxNormalizedVideo();
            }else{
              await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,...productStreamMap(),...profile,...encoding,
                '-pass','2','-passlogfile',passlog,'-c:a','copy','-c:s','copy','-f','matroska',temporaryTarget],timeoutMs);
            }
          } finally {
            for(const suffix of ['', '.log', '.log.mbtree', '-0.log', '-0.log.mbtree']){
              const candidate=passlog+suffix;if(fs.existsSync(candidate))fs.rmSync(candidate,{force:true});
            }
            if(fs.existsSync(normalizedVideoTarget))fs.rmSync(normalizedVideoTarget,{force:true});
          }
          return;
        }
        if(normalizeDolbyVision){
          try{
            await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,'-map','0:v:0',...profile,...encoding,
              '-an','-sn','-f','mpegts',normalizedVideoTarget],timeoutMs);
            await muxNormalizedVideo();
          }finally{if(fs.existsSync(normalizedVideoTarget))fs.rmSync(normalizedVideoTarget,{force:true});}
        }else{
          await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', source,
            ...productStreamMap(), ...profile,...encoding, '-c:a', 'copy', '-c:s', 'copy', '-f', 'matroska', temporaryTarget], timeoutMs);
        }
      } });
  }

  return Object.freeze({ executeRemux, executeTranscode,verifyTranscodeInput,verifyPlayback });
}

module.exports = Object.freeze({ CleanMediaProductionEffectPortError, createCleanMediaProductionEffectPort });
