'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { compileFfmpegPipeline } = require('./clean-ffmpeg-pipeline');
const { createFfmpegProcessRegistry } = require('./clean-ffmpeg-process-registry');
const { inspectIso, listIsoImageFiles } = require('./helix/integrations/disc-topology');

const ISO_SECTOR_BYTES = 2048;
// BDAV/MPEG-TS often splits one HEVC access unit across PES packets and only
// timestamps the first PES. Matroska copy-mux rejects the untimed packets.
// Inherit the previous video timestamp; do not invent wall-clock time.
const VIDEO_TIMESTAMP_FILL_BSF =
  "setts=pts='if(eq(PTS\\,NOPTS)\\,PREV_OUTPTS\\,PTS)':dts='if(eq(DTS\\,NOPTS)\\,PREV_OUTDTS\\,DTS)'";
const MATROSKA_UNCOPYABLE_AUDIO = new Set(['pcm_bluray', 'pcm_dvd']);

function productStreamMap(intent, audioInput = '0') {
  const indexes = intent?.audio?.streamIndexes;
  const maps = ['-map', '0:v:0'];
  if (Array.isArray(indexes) && indexes.length) {
    for (const index of indexes) maps.push('-map', `${audioInput}:${index}`);
    maps.push('-map', `${audioInput}:s?`);
    return maps;
  }
  maps.push('-map', `${audioInput}:a?`, '-map', `${audioInput}:s?`);
  return maps;
}

function matroskaCopyMapsFromProbe(stderr) {
  const maps = [];
  const pattern = /^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\([^)]*\))?: (Video|Audio|Subtitle): ([A-Za-z0-9_]+)/gm;
  let match;
  while ((match = pattern.exec(String(stderr || '')))) {
    const index = match[1];
    const kind = match[2].toLowerCase();
    const codec = match[3].toLowerCase();
    if (kind === 'audio' && MATROSKA_UNCOPYABLE_AUDIO.has(codec)) continue;
    if (kind === 'video' || kind === 'audio' || kind === 'subtitle') maps.push('-map', '0:' + index);
  }
  return maps.length ? maps : ['-map', '0:v:0', '-map', '0:a?', '-map', '0:s?'];
}

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

function progressGroup(report, phaseCount = 1, progressFloor = null) {
  const floor=progressFloor?.mode==='determinate'&&progressFloor.unit==='percent'&&
    Number(progressFloor.totalValue)===100&&Number.isFinite(progressFloor.currentValue)
    ?Math.max(0,Math.min(100,Number(progressFloor.currentValue))):0;
  return { report, phaseCount, durationUs:null, lastCurrentValue:floor };
}

function progressPhase(group, prefix, phaseIndex = 0, terminalAtEnd = true) {
  return { group, prefix, phaseIndex, terminalAtEnd };
}

function durationUsFromFfmpeg(value) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/u.exec(value);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000_000) : null;
}

function reportProcessProgress(progress, outTimeUs, speed, atEnd) {
  const group = progress.group;
  const durationUs = group.durationUs;
  let mode = 'indeterminate', currentValue = null, totalValue = null, unit = null, etaMs = null;
  if (durationUs) {
    const phaseRatio = Math.min(Math.max((Number(outTimeUs) || 0) / durationUs, 0), 1);
    const overallRatio = Math.min((progress.phaseIndex + phaseRatio) / group.phaseCount, 1);
    mode = 'determinate';
    totalValue = 100;
    const observedCurrentValue = Math.round(overallRatio * 1000) / 10;
    if (!atEnd && observedCurrentValue < group.lastCurrentValue) return Object.freeze({
      sampled:false, replayed:false, reasonCode:'RECOVERY_CATCHUP', currentValue:group.lastCurrentValue,
    });
    currentValue = Math.max(group.lastCurrentValue, observedCurrentValue);
    if (atEnd) currentValue = Math.max(currentValue, Math.round(((progress.phaseIndex + 1) / group.phaseCount) * 1000) / 10);
    if (atEnd && progress.terminalAtEnd) currentValue = 100;
    group.lastCurrentValue = currentValue;
    unit = 'percent';
    if (speed && speed > 0) etaMs = Math.max(0, Math.round((group.phaseCount * durationUs * (1 - currentValue / 100)) / speed / 1000));
  }
  const terminal = Boolean(atEnd && progress.terminalAtEnd);
  const sample={ mode, currentValue, totalValue, unit, rate:speed, etaMs,
    progressBucket:terminal?'complete':mode==='determinate'?'percent-'+Math.floor(currentValue):progress.prefix+'-running',
    terminal };
  return group.report(Object.freeze({ ...sample,
    sourceSequence:progress.prefix+':'+canonicalDigest({ schema:'ffmpeg-progress-source-sequence@1',
      prefix:progress.prefix,outTimeUs:String(outTimeUs),speed:speed??null,...sample }),
  }));
}

function completeProcessProgress(group, prefix) {
  group.lastCurrentValue = 100;
  return group.report(Object.freeze({ mode:'determinate', currentValue:100, totalValue:100, unit:'percent', rate:null, etaMs:0,
    sourceSequence:prefix+':complete', progressBucket:'complete', terminal:true }));
}

function runProcess(executable, argv, timeoutMs, progress = null, control = {}) {
  return new Promise((resolve, reject) => {
    if (progress && !progress.group) progress = progressPhase(progressGroup(progress.report), progress.prefix);
    const progressArgv=progress?[...argv.slice(0,-1),'-progress','pipe:1','-nostats',argv.at(-1)]:argv;
    const child = spawn(executable, progressArgv, { windowsHide:true, stdio:['ignore', progress?'pipe':'ignore', 'pipe'] });
    const chunks = []; let retained = 0; let total = 0; let timedOut = false; let cancelled = false; let settled = false;
    let progressBuffer='',durationBuffer='',lastReportedAt=0,lastOutTime='0';
    const boundedTimeout=Number.isSafeInteger(control.deadlineAtMs)
      ?Math.max(1,Math.min(timeoutMs,control.deadlineAtMs-Date.now())):timeoutMs;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, boundedTimeout);
    const fence=typeof control.shouldContinue==='function'?setInterval(()=>{try{if(control.shouldContinue()===false){cancelled=true;child.kill('SIGKILL');}}catch{cancelled=true;child.kill('SIGKILL');}},1000):null;
    control.processRegistry?.register(child);
    const cleanup=()=>{clearTimeout(timer);if(fence)clearInterval(fence);control.processRegistry?.unregister(child);};
    child.stderr.on('data', (chunk) => {
      total += chunk.length;
      chunks.push(Buffer.from(chunk));retained+=chunk.length;
      while(retained>256*1024&&chunks.length){const first=chunks[0],excess=retained-256*1024;if(first.length<=excess){chunks.shift();retained-=first.length;}else{chunks[0]=first.subarray(excess);retained-=excess;}}
      if (progress && !progress.group.durationUs && durationBuffer.length < 16 * 1024) {
        durationBuffer += chunk.toString('utf8');
        progress.group.durationUs = durationUsFromFfmpeg(durationBuffer);
      }
    });
    if(progress)child.stdout.on('data',(chunk)=>{progressBuffer+=chunk.toString('utf8');const lines=progressBuffer.split(/\r?\n/u);progressBuffer=lines.pop()||'';let speed=null,terminal=false;
      for(const line of lines){const at=line.indexOf('=');if(at<1)continue;const key=line.slice(0,at),value=line.slice(at+1);if(key==='out_time_us')lastOutTime=value;if(key==='speed')speed=Number.parseFloat(value)||null;if(key==='progress'&&value==='end')terminal=true;}
      const observedAt=Date.now();if(terminal||observedAt-lastReportedAt>=5000){lastReportedAt=observedAt;try{reportProcessProgress(progress,lastOutTime,speed,terminal);}catch(error){if(!settled){settled=true;cleanup();child.kill('SIGKILL');reject(error);}}}});
    child.once('error', (error) => { if(settled)return;settled=true;cleanup();reject(error); });
    child.once('close', (code) => {
      if(settled)return;
      settled=true;
      cleanup();
      const stderr = Buffer.concat(chunks).toString('utf8');
      if (timedOut) return reject(Object.assign(new Error('FFmpeg timed out.'), { code:'LIBRA_MEDIA_FFMPEG_TIMEOUT' }));
      if (cancelled) return reject(Object.assign(new Error('FFmpeg stopped because its execution authority changed.'), { code:'LIBRA_MEDIA_FFMPEG_CANCELLED' }));
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
  const processRegistry = options.ffmpegProcessRegistry || createFfmpegProcessRegistry();
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

  function isoVolumeIdentifier(isoLocation) {
    try {
      const fd = fs.openSync(isoLocation, 'r');
      try {
        const bytes = Buffer.alloc(5);
        const read = fs.readSync(fd, bytes, 0, 5, 16 * ISO_SECTOR_BYTES + 1);
        if (read !== 5) return null;
        const ident = bytes.toString('ascii');
        return ident === 'CD001' || ident === 'BEA01' ? ident : null;
      } finally { fs.closeSync(fd); }
    } catch (_) {
      return null;
    }
  }

  async function copyIsoPayload(isoLocation, file, dest) {
    const extents = Array.isArray(file?.extents) && file.extents.length
      ? file.extents
      : (Number.isSafeInteger(file?.extent) && Number.isSafeInteger(file?.sizeBytes)
        ? [{ sector: file.extent, length: file.sizeBytes }] : null);
    if (!extents || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) {
      fail('LIBRA_MEDIA_ISO_PAYLOAD_INVALID', 'ISO topology payload extent is incomplete.');
    }
    await fs.promises.mkdir(path.dirname(dest), { recursive:true });
    const source = await fs.promises.open(isoLocation, 'r');
    let output;
    try {
      output = await fs.promises.open(dest, 'w');
      try {
        let remaining = file.sizeBytes;
        const buffer = Buffer.alloc(Math.min(1024 * 1024, remaining));
        for (const extent of extents) {
          if (remaining <= 0) break;
          if (!Number.isSafeInteger(extent.sector) || extent.sector < 0 ||
              !Number.isSafeInteger(extent.length) || extent.length < 1) {
            fail('LIBRA_MEDIA_ISO_PAYLOAD_INVALID', 'ISO topology payload extent is incomplete.');
          }
          let position = extent.sector * ISO_SECTOR_BYTES;
          let extentRemaining = Math.min(extent.length, remaining);
          while (extentRemaining > 0) {
            const want = Math.min(buffer.length, extentRemaining);
            const {bytesRead} = await source.read(buffer, 0, want, position);
            if (bytesRead !== want) fail('LIBRA_MEDIA_ISO_PAYLOAD_READ', 'ISO payload could not be read exactly.');
            let written = 0;
            while (written < bytesRead) {
              const result = await output.write(buffer, written, bytesRead - written);
              if (result.bytesWritten < 1) fail('LIBRA_MEDIA_ISO_PAYLOAD_READ', 'ISO payload could not be written exactly.');
              written += result.bytesWritten;
            }
            remaining -= bytesRead;
            extentRemaining -= bytesRead;
            position += bytesRead;
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
        if (remaining !== 0) fail('LIBRA_MEDIA_ISO_PAYLOAD_READ', 'ISO payload extents do not cover the file size.');
      } finally { await output.close(); }
    } catch (error) {
      await fs.promises.rm(dest, { force:true }).catch(() => undefined);
      throw error;
    } finally { await source.close(); }
  }

  async function isoRemuxArguments(source, temporaryTarget) {
    const primaries = source.primaryMembers || [];
    if (primaries.length !== 1) return null;
    const isoLocation = location(primaries[0].readHandle);
    let topology;
    try { topology = inspectIso(isoLocation); } catch (error) {
      fail('LIBRA_MEDIA_ISO_TOPOLOGY_UNPROVEN', error.message, { causeCode: error.code });
    }
    if (!topology || topology.discKind !== 'iso') {
      if (isoVolumeIdentifier(isoLocation)) {
        fail('LIBRA_MEDIA_ISO_TOPOLOGY_UNPROVEN', 'ISO volume has no proven Blu-ray topology.');
      }
      return null;
    }
    let listing;
    try { listing = listIsoImageFiles(isoLocation); } catch (error) {
      fail('LIBRA_MEDIA_ISO_PAYLOAD_INVALID', error.message, { causeCode: error.code });
    }
    if (!listing) fail('LIBRA_MEDIA_ISO_PAYLOAD_INVALID', 'ISO payload listing could not be read.');
    const byPath = new Map(listing.map((file) => [String(file.relativeLocation).replace(/\\/g, '/').toUpperCase(), file]));
    const clips = (topology.members || []).filter((member) => member.role === 'primary_payload');
    if (!clips.length) fail('LIBRA_MEDIA_ISO_PAYLOAD_INVALID', 'ISO topology has no selected primary payload.');
    const extracted = [];
    try {
      for (const [index, clip] of clips.entries()) {
        const listed = byPath.get(String(clip.relativeLocation).replace(/\\/g, '/').toUpperCase());
        if (!listed) fail('LIBRA_MEDIA_ISO_PAYLOAD_INVALID', 'ISO selected clip is absent from the image listing.');
        const dest = temporaryTarget + '.iso-clip-' + String(index).padStart(5, '0') + '.m2ts';
        await copyIsoPayload(isoLocation, listed, dest);
        extracted.push(dest);
      }
    } catch (error) {
      await Promise.all(extracted.map((file) => fs.promises.rm(file, { force:true })));
      throw error;
    }
    const cleanupExtracted = () => Promise.all(extracted.map((file) => fs.promises.rm(file, { force:true })));
    if (extracted.length === 1) {
      return Object.freeze({ argv:['-i', extracted[0]], cleanup: cleanupExtracted });
    }
    const listPath = temporaryTarget + '.iso-concat.txt';
    await fs.promises.writeFile(listPath, extracted.map((file) => "file '" + escapeConcat(file.replace(/\\/g, '/')) + "'").join('\n') + '\n', 'utf8');
    return Object.freeze({
      argv:['-f', 'concat', '-safe', '0', '-i', listPath],
      cleanup:async () => { await cleanupExtracted(); await fs.promises.rm(listPath, { force:true }); },
    });
  }

  async function inputArguments(source, temporaryTarget) {
    const isoInput = await isoRemuxArguments(source, temporaryTarget);
    if (isoInput) return isoInput;
    const primaries = source.primaryMembers || [];
    if (primaries.length === 1) return Object.freeze({ argv:['-i', location(primaries[0].readHandle)], cleanup:null });
    const listPath = temporaryTarget + '.concat.txt';
    fs.writeFileSync(listPath, primaries.map((item) => "file '" + escapeConcat(location(item.readHandle).replace(/\\/g, '/')) + "'").join('\n') + '\n', 'utf8');
    return Object.freeze({ argv:['-f', 'concat', '-safe', '0', '-i', listPath], cleanup:() => {
      if (fs.existsSync(listPath)) fs.rmSync(listPath, { force:true });
    } });
  }

  function ffmpegPipeline(intent, device) {
    try { return compileFfmpegPipeline({ deviceClass:device.deviceClass, video:intent.video }); }
    catch (error) {
      fail(error?.code || 'LIBRA_MEDIA_DEVICE_UNSUPPORTED', error?.message || 'Selected compute device has no local FFmpeg pipeline.',
        { ...(error?.details || {}), deviceClass:device.deviceClass });
    }
  }

  async function verifyTranscodeInput(request){
    const source=sourceLocation(request.sourceHandle),intent=request.productionIntent,device=request.deviceSnapshot,
      durationMs=Math.max(1,Number(request.sourceProbeEvidence.durationMs||1)),points=[5,50,95],pipeline=ffmpegPipeline(intent,device),passed=[];
    for(const point of points){const seconds=Math.max(0,durationMs/1000*point/100);
      try{await runProcess(ffmpegPath,['-hide_banner','-nostdin','-loglevel','error','-y','-ss',seconds.toFixed(3),...pipeline.inputArgs,'-i',source,
        ...productStreamMap(intent),'-frames:v','8',...pipeline.videoArgs,'-c:a','copy','-c:s','copy','-f','matroska',
        process.platform==='win32'?'NUL':'/dev/null'],30_000,null,
        {processRegistry,deadlineAtMs:request.deadlineAtMs,shouldContinue:request.shouldContinue});
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
        '-map','0:v:0','-frames:v','1','-f','null',process.platform==='win32'?'NUL':'/dev/null'],30_000,null,
        {processRegistry,deadlineAtMs:request.deadlineAtMs,shouldContinue:request.shouldContinue});passed.push(point);}
      catch(error){if(error?.code==='LIBRA_MEDIA_FFMPEG_TIMEOUT'||error?.code==='ENOENT'||error?.code==='EACCES')throw error;}
    }
    return Object.freeze({samplePointsPercent:Object.freeze(points),passedSamplePointsPercent:Object.freeze(passed),
      decodeDigest:canonicalDigest({schema:'libra.product-playback-decode@1',handleDigest:canonicalDigest(handle),points,passed})});
  }

  async function executeRemux(request) {
    const target = request.outputTarget;
    const progress=request.reportProgress?progressGroup(request.reportProgress,1,request.progressFloor):null;
    const run=(args,limit,processProgress=null)=>runProcess(ffmpegPath,args,limit,processProgress,
      {processRegistry,deadlineAtMs:request.deadlineAtMs,shouldContinue:request.shouldContinue});
    return options.workspaceProductPort.materializeMedia({ libraRunId:target.libraRunId, workspaceId:target.workspaceId,
      relativePath:target.targetRelativePath, intentDigest:request.productionIntent.intentDigest,
      idempotencyKey:request.idempotencyKey, effectScopeDigest:target.effectScopeDigest,
      outputTargetId:target.targetId, outputTargetDigest:target.targetDigest,
      runtimeEffectAuthority:request.runtimeEffectAuthority,
      async produce(temporaryTarget) {
        const input = await inputArguments(request.source, temporaryTarget);
        try {
          let identify = '';
          try {
            await run(['-hide_banner', '-nostdin', ...input.argv], 60_000);
          } catch (error) {
            identify = String(error?.details?.stderr || '');
          }
          const maps = matroskaCopyMapsFromProbe(identify);
          await run([
            '-hide_banner', '-nostdin', '-y', '-fflags', '+genpts', ...input.argv,
            ...maps, '-c', 'copy', '-bsf:v', VIDEO_TIMESTAMP_FILL_BSF, '-f', 'matroska', temporaryTarget,
          ], timeoutMs, progress?progressPhase(progress,'remux'):null);
        } finally { await input.cleanup?.(); }
      } });
  }

  async function executeTranscode(request) {
    const target = request.outputTarget;
    const phaseCount=request.productionIntent.video.rateControlMode==='two_pass_abr'?2:1,
      progress=request.reportProgress?progressGroup(request.reportProgress,phaseCount,request.progressFloor):null;
    const run=(args,limit,processProgress=null)=>runProcess(ffmpegPath,args,limit,processProgress,
      {processRegistry,deadlineAtMs:request.deadlineAtMs,shouldContinue:request.shouldContinue});
    return options.workspaceProductPort.materializeMedia({ libraRunId:target.libraRunId, workspaceId:target.workspaceId,
      relativePath:target.targetRelativePath, intentDigest:request.productionIntent.intentDigest,
      idempotencyKey:request.idempotencyKey, effectScopeDigest:target.effectScopeDigest,
      outputTargetId:target.targetId, outputTargetDigest:target.targetDigest,
      runtimeEffectAuthority:request.runtimeEffectAuthority,
      async produce(temporaryTarget) {
        const source=sourceLocation(request.sourceHandle),pipeline=ffmpegPipeline(request.productionIntent, request.deviceSnapshot),
          normalizeDolbyVision=request.productionIntent.video.dynamicRangeOperation==='tone_map_to_sdr_bt709',
          normalizedVideoTarget=temporaryTarget+'.normalized-video.ts';
        async function muxNormalizedVideo() {
          await run(['-hide_banner','-nostdin','-y','-i',normalizedVideoTarget,'-i',source,
            ...productStreamMap(request.productionIntent,'1'),'-c:v','copy','-c:a','copy','-c:s','copy',
            '-map_metadata','-1','-f','matroska',temporaryTarget],timeoutMs);
        }
        if(request.productionIntent.video.rateControlMode==='two_pass_abr'){
          const passlog=temporaryTarget+'.passlog',nullTarget=process.platform==='win32'?'NUL':'/dev/null';
          try {
            await run(['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0',...pipeline.videoArgs,
              '-pass','1','-passlogfile',passlog,'-an','-sn','-f','null',nullTarget],timeoutMs,progress?progressPhase(progress,'transcode-pass1',0,false):null);
            if(normalizeDolbyVision){
              // FFmpeg 6.x Matroska propagation can copy the source DOVI
              // configuration side-data even after a full pixel encode. A
              // video-only MPEG-TS boundary preserves timestamps and the new
              // HEVC bytes while deliberately severing that source metadata.
              // The final mux then carries audio/subtitles from the source,
              // never the source video stream or its DOVI configuration.
              await run(['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0',...pipeline.videoArgs,
                '-pass','2','-passlogfile',passlog,'-an','-sn','-f','mpegts',normalizedVideoTarget],timeoutMs,progress?progressPhase(progress,'transcode-pass2',1,false):null);
              await muxNormalizedVideo();
              if(progress)completeProcessProgress(progress,'transcode-pass2-mux');
            }else{
              await run(['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,...productStreamMap(request.productionIntent),...pipeline.videoArgs,
                '-pass','2','-passlogfile',passlog,'-c:a','copy','-c:s','copy','-f','matroska',temporaryTarget],timeoutMs,progress?progressPhase(progress,'transcode-pass2',1,true):null);
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
          await run(['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0',...pipeline.videoArgs,
              '-an','-sn','-f','mpegts',normalizedVideoTarget],timeoutMs,progress?progressPhase(progress,'transcode',0,false):null);
            await muxNormalizedVideo();
            if(progress)completeProcessProgress(progress,'transcode-mux');
          }finally{if(fs.existsSync(normalizedVideoTarget))fs.rmSync(normalizedVideoTarget,{force:true});}
        }else{
          await run(['-hide_banner', '-nostdin', '-y', ...pipeline.inputArgs, '-i', source,
            ...productStreamMap(request.productionIntent), ...pipeline.videoArgs, '-c:a', 'copy', '-c:s', 'copy', '-f', 'matroska', temporaryTarget], timeoutMs,
            progress?progressPhase(progress,'transcode',0,true):null);
        }
      } });
  }

  async function close(){await processRegistry.close();}

  return Object.freeze({ executeRemux, executeTranscode,verifyTranscodeInput,verifyPlayback,close });
}

module.exports = Object.freeze({
  CleanMediaProductionEffectPortError,
  createCleanMediaProductionEffectPort,
  runProcess,
  durationUsFromFfmpeg,
  progressGroup,
  progressPhase,
  reportProcessProgress,
  matroskaCopyMapsFromProbe,
  productStreamMap,
});
