'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');

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

  async function executeRemux(request) {
    const target = request.outputTarget;
    return options.workspaceProductPort.materializeMedia({ libraRunId:target.libraRunId, workspaceId:target.workspaceId,
      relativePath:target.targetRelativePath, intentDigest:request.productionIntent.intentDigest,
      idempotencyKey:request.idempotencyKey, effectScopeDigest:target.effectScopeDigest,
      outputTargetId:target.targetId, outputTargetDigest:target.targetDigest,
      async produce(temporaryTarget) {
        const input = inputArguments(request.source, temporaryTarget);
        try {
          await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...input.argv, '-map', '0', '-c', 'copy', '-f', 'matroska', temporaryTarget], timeoutMs);
        } finally { input.cleanup?.(); }
      } });
  }

  async function executeTranscode(request) {
    const target = request.outputTarget;
    return options.workspaceProductPort.materializeMedia({ libraRunId:target.libraRunId, workspaceId:target.workspaceId,
      relativePath:target.targetRelativePath, intentDigest:request.productionIntent.intentDigest,
      idempotencyKey:request.idempotencyKey, effectScopeDigest:target.effectScopeDigest,
      outputTargetId:target.targetId, outputTargetDigest:target.targetDigest,
      async produce(temporaryTarget) {
        const source=sourceLocation(request.sourceHandle),encoding=encoderArguments(request.productionIntent, request.deviceSnapshot);
        if(request.productionIntent.video.rateControlMode==='two_pass_abr'){
          const passlog=temporaryTarget+'.passlog',nullTarget=process.platform==='win32'?'NUL':'/dev/null';
          try {
            await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,'-map','0:v:0',...encoding,
              '-pass','1','-passlogfile',passlog,'-an','-sn','-f','null',nullTarget],timeoutMs);
            await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,'-map','0',...encoding,
              '-pass','2','-passlogfile',passlog,'-c:a','copy','-c:s','copy','-f','matroska',temporaryTarget],timeoutMs);
          } finally {
            for(const suffix of ['', '.log', '.log.mbtree', '-0.log', '-0.log.mbtree']){
              const candidate=passlog+suffix;if(fs.existsSync(candidate))fs.rmSync(candidate,{force:true});
            }
          }
          return;
        }
        await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', source,
          '-map', '0', ...encoding, '-c:a', 'copy', '-c:s', 'copy', '-f', 'matroska', temporaryTarget], timeoutMs);
      } });
  }

  return Object.freeze({ executeRemux, executeTranscode });
}

module.exports = Object.freeze({ CleanMediaProductionEffectPortError, createCleanMediaProductionEffectPort });
