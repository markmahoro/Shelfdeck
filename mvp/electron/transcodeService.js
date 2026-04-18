'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const embyService = require('./embyService');

function log(...args) {
  console.log('[transcode]', new Date().toISOString(), ...args);
}

/** @type {Map<string, import('child_process').ChildProcess>} */
const encodeJobs = new Map();

/** §2.4.10 编码资源池 Gate：限制同时压制的 FFmpeg 进程数 */
let encodePoolInUse = 0;
let encodePoolMaxConfigured = 1;
/** @type {Array<() => void>} */
const encodePoolWaiters = [];

function acquireEncodePoolSlot(maxSlots) {
  encodePoolMaxConfigured = Math.max(1, maxSlots | 0);
  return new Promise((resolve) => {
    if (encodePoolInUse < encodePoolMaxConfigured) {
      encodePoolInUse += 1;
      log('encode pool slot acquired', encodePoolInUse, '/', encodePoolMaxConfigured);
      resolve();
    } else {
      encodePoolWaiters.push(() => {
        encodePoolInUse += 1;
        log('encode pool slot acquired (after wait)', encodePoolInUse, '/', encodePoolMaxConfigured);
        resolve();
      });
    }
  });
}

function releaseEncodePoolSlot() {
  encodePoolInUse = Math.max(0, encodePoolInUse - 1);
  log('encode pool slot released', encodePoolInUse, '/', encodePoolMaxConfigured);
  const next = encodePoolWaiters.shift();
  if (next) next();
}

/** Electron 打包后可执行文件在 app.asar.unpacked，路径需修正（与 @ffprobe-installer 文档一致） */
function fixAsarUnpackedPath(binPath) {
  if (!binPath || typeof binPath !== 'string') return binPath;
  return binPath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
}

/** @type {string | null | undefined} */
let cachedBundledFfmpeg;
/** @type {string | null | undefined} */
let cachedBundledFfprobe;

function getBundledFfmpegPath() {
  if (cachedBundledFfmpeg !== undefined) return cachedBundledFfmpeg;
  try {
    const mod = require('ffmpeg-static');
    const raw = typeof mod === 'string' ? mod : null;
    const p = raw ? fixAsarUnpackedPath(raw) : null;
    if (p && fs.existsSync(p)) {
      cachedBundledFfmpeg = p;
      log('using bundled ffmpeg', p);
      return p;
    }
  } catch (e) {
    log('bundled ffmpeg unavailable', e?.message || e);
  }
  cachedBundledFfmpeg = null;
  return null;
}

function getBundledFfprobePath() {
  if (cachedBundledFfprobe !== undefined) return cachedBundledFfprobe;
  try {
    const mod = require('@ffprobe-installer/ffprobe');
    const raw = mod && typeof mod.path === 'string' ? mod.path : null;
    const p = raw ? fixAsarUnpackedPath(raw) : null;
    if (p && fs.existsSync(p)) {
      cachedBundledFfprobe = p;
      log('using bundled ffprobe', p);
      return p;
    }
  } catch (e) {
    log('bundled ffprobe unavailable', e?.message || e);
  }
  cachedBundledFfprobe = null;
  return null;
}

function resolveFfmpegBin(config) {
  const p = config && String(config.ffmpegPath || '').trim();
  if (p && fs.existsSync(p)) return p;
  const env = String(process.env.FFMPEG_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = getBundledFfmpegPath();
  if (bundled) return bundled;
  return 'ffmpeg';
}

function resolveFfprobeBin(config) {
  const p = config && String(config.ffprobePath || '').trim();
  if (p && fs.existsSync(p)) return p;
  const env = String(process.env.FFPROBE_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = getBundledFfprobePath();
  if (bundled) return bundled;
  return 'ffprobe';
}

function runCmd(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, ...opts });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, out, err }));
  });
}

async function ffprobeJson(config, filePath) {
  const probe = resolveFfprobeBin(config);
  const r = await runCmd(probe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
  if (r.code !== 0) throw new Error(`ffprobe 失败 (${r.code}): ${(r.err || r.out).slice(0, 400)}`);
  return JSON.parse(r.out);
}

function detectDolbyVision(j) {
  const streams = j.streams || [];
  for (const s of streams) {
    const tag = String(s.codec_tag_string || '').toLowerCase();
    if (tag.includes('dvh') || tag.includes('dvhe')) return true;
    const side = s.side_data_list || [];
    for (const sd of side) {
      const t = String(sd.side_data_type || '');
      if (/dovi|dolby.?vision/i.test(t)) return true;
    }
  }
  return false;
}

async function hasLibplaceboFilter(config) {
  const ff = resolveFfmpegBin(config);
  const r = await runCmd(ff, ['-hide_banner', '-filters']);
  if (r.code !== 0) return false;
  return /libplacebo/i.test(r.out + r.err);
}

function sanitizeTaskId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function fileHashSha256(fp) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(fp);
    rs.on('error', reject);
    rs.on('data', (d) => h.update(d));
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

async function resolveEncoderMode(config, requested) {
  const req = String(requested || 'auto').toLowerCase();
  if (req !== 'auto') return req;
  const ff = resolveFfmpegBin(config);
  const tryEnc = async (args) => {
    const r = await runCmd(ff, args);
    return r.code === 0;
  };
  if (
    await tryEnc([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:r=1',
      '-frames:v',
      '1',
      '-c:v',
      'hevc_nvenc',
      '-f',
      'null',
      '-',
    ])
  ) {
    return 'nvenc';
  }
  if (
    await tryEnc([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:r=1',
      '-frames:v',
      '1',
      '-c:v',
      'hevc_qsv',
      '-f',
      'null',
      '-',
    ])
  ) {
    return 'qsv';
  }
  if (
    await tryEnc([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:r=1',
      '-frames:v',
      '1',
      '-c:v',
      'hevc_amf',
      '-f',
      'null',
      '-',
    ])
  ) {
    return 'amf';
  }
  return 'cpu';
}

function buildEncodeArgs({ config, sourcePath, partialPath, encoderMode, isDolbyVision, dvAcknowledged }) {
  const ff = resolveFfmpegBin(config);
  const args = ['-hide_banner', '-y', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a?', '-sn', '-dn'];
  let enc = String(encoderMode || 'cpu').toLowerCase();
  if (isDolbyVision && dvAcknowledged) {
    enc = 'cpu';
    args.push('-vf', 'libplacebo=tonemapping=bt.2390,format=yuv420p10le');
  }

  if (enc === 'nvenc') {
    args.push('-c:v', 'hevc_nvenc', '-rc', 'vbr', '-cq', '24', '-preset', 'p5');
  } else if (enc === 'qsv') {
    args.push('-c:v', 'hevc_qsv', '-global_quality', '24');
  } else if (enc === 'amf') {
    args.push('-c:v', 'hevc_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '24', '-qp_p', '24');
  } else {
    args.push('-c:v', 'libx265', '-crf', '22', '-preset', 'medium');
  }

  args.push('-c:a', 'copy', partialPath);
  return { ffmpegBin: ff, args };
}

function parseFfmpegTimeMs(line) {
  const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h + min + sec)) return null;
  return ((h * 60 + min) * 60 + sec) * 1000;
}

async function validateTranscodeTools(config, encoderPreference) {
  const ff = resolveFfmpegBin(config);
  const probe = resolveFfprobeBin(config);
  const rProbe = await runCmd(probe, ['-hide_banner', '-version']);
  if (rProbe.code !== 0) throw new Error(`ffprobe 不可用（请配置路径或 PATH）：${probe}`);
  const rFf = await runCmd(ff, ['-hide_banner', '-version']);
  if (rFf.code !== 0) throw new Error(`ffmpeg 不可用（请配置路径或 PATH）：${ff}`);
  const mode = await resolveEncoderMode(config, encoderPreference);
  const vargs =
    mode === 'nvenc'
      ? ['-c:v', 'hevc_nvenc', '-frames:v', '1', '-f', 'null', '-']
      : mode === 'qsv'
        ? ['-c:v', 'hevc_qsv', '-frames:v', '1', '-f', 'null', '-']
        : mode === 'amf'
          ? ['-c:v', 'hevc_amf', '-frames:v', '1', '-f', 'null', '-']
          : ['-c:v', 'libx265', '-frames:v', '1', '-f', 'null', '-'];
  const rTest = await runCmd(ff, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=64x64:r=1',
    ...vargs,
  ]);
  if (rTest.code !== 0) {
    throw new Error(`编码器探测失败（${mode}）：${(rTest.err || '').slice(0, 320)}`);
  }
  const lp = await hasLibplaceboFilter(config);
  return { ffmpeg: ff, ffprobe: probe, resolvedEncoder: mode, libplacebo: lp };
}

async function precheck({ config, task }) {
  const tempRoot = String(config.transcodeTempRoot || '').trim();
  if (!tempRoot) throw new Error('未配置转码临时根目录（配置中心 → 转码与工具链）');
  let stRoot;
  try {
    stRoot = fs.statSync(tempRoot);
  } catch {
    throw new Error(`临时根目录不存在或不可访问：${tempRoot}`);
  }
  if (!stRoot.isDirectory()) throw new Error('临时根路径不是目录');
  try {
    fs.accessSync(tempRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error('临时根目录无读写权限');
  }

  const rawPath = await embyService.fetchPlaybackPath(config, task.itemId);
  if (!rawPath) throw new Error('PlaybackInfo 未返回可转码源路径（Path）');
  const sourcePath = embyService.applyPathMap(rawPath, config.pathMapFrom, config.pathMapTo).trim();
  if (!sourcePath) throw new Error('路径映射结果为空');
  let st;
  try {
    st = fs.statSync(sourcePath);
  } catch {
    throw new Error(`源文件不可读：${sourcePath}`);
  }
  if (!st.isFile()) throw new Error('源路径不是文件');
  const originalSizeGb = Number((st.size / (1024 * 1024 * 1024)).toFixed(4));

  const j = await ffprobeJson(config, sourcePath);
  const isDv = detectDolbyVision(j);
  const durationSec = Number(j.format?.duration || 0) || 3600;
  if (isDv && !task.transcodeDvAcknowledged) {
    const taskWorkDir = path.join(tempRoot, `etp-task-${sanitizeTaskId(task.id)}`);
    fs.mkdirSync(taskWorkDir, { recursive: true });
    const base = path.basename(sourcePath);
    const partialPath = path.join(taskWorkDir, `${base}.etp.partial`);
    return {
      ok: true,
      needsDvConfirm: true,
      sourcePath,
      targetPath: sourcePath,
      partialPath,
      tempDir: taskWorkDir,
      originalSizeGb,
      isDolbyVision: true,
      durationSec,
    };
  }
  if (isDv && task.transcodeDvAcknowledged) {
    const okLp = await hasLibplaceboFilter(config);
    if (!okLp) {
      throw new Error('杜比视界片源需要带 libplacebo 滤镜的 FFmpeg（请更换构建或关闭该片 DV 路径）');
    }
  }

  const taskWorkDir = path.join(tempRoot, `etp-task-${sanitizeTaskId(task.id)}`);
  fs.mkdirSync(taskWorkDir, { recursive: true });
  const base = path.basename(sourcePath);
  const partialPath = path.join(taskWorkDir, `${base}.etp.partial`);
  const targetPath = sourcePath;

  return {
    ok: true,
    needsDvConfirm: false,
    sourcePath,
    targetPath,
    partialPath,
    tempDir: taskWorkDir,
    originalSizeGb,
    isDolbyVision: isDv,
    durationSec,
  };
}

async function startEncode(sender, payload) {
  const {
    config,
    taskId,
    sourcePath,
    partialPath,
    encoderPreference,
    isDolbyVision,
    dvAcknowledged,
    durationSec,
    encodePoolMax,
  } = payload;
  const tid = String(taskId || '');
  if (encodeJobs.has(tid)) throw new Error('该任务已有进行中的压制进程');
  await acquireEncodePoolSlot(encodePoolMax);
  try {
    try {
      if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
    } catch {
      /* ignore */
    }
    const encoderMode = await resolveEncoderMode(config, encoderPreference || 'auto');
    const { ffmpegBin, args } = buildEncodeArgs({
      config,
      sourcePath,
      partialPath,
      encoderMode,
      isDolbyVision: !!isDolbyVision,
      dvAcknowledged: !!dvAcknowledged,
    });
    log('startEncode', tid, ffmpegBin, args.join(' '));

    const spawnEnv = { ...process.env };
    const gpuIdx =
      config && typeof config.transcodeGpuDeviceIndex === 'number' && Number.isFinite(config.transcodeGpuDeviceIndex)
        ? Math.floor(config.transcodeGpuDeviceIndex)
        : -1;
    if (gpuIdx >= 0 && encoderMode === 'nvenc') {
      spawnEnv.CUDA_VISIBLE_DEVICES = String(gpuIdx);
      log('NVENC CUDA_VISIBLE_DEVICES=', gpuIdx);
    }

    const child = spawn(ffmpegBin, args, { windowsHide: true, env: spawnEnv });
    encodeJobs.set(tid, child);

    const totalMs =
      typeof durationSec === 'number' && durationSec > 0 ? Math.max(1000, durationSec * 1000) : 3600 * 1000 * 2;
    let lastPct = 0;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const lines = String(chunk).split(/\r?\n/);
      for (const line of lines) {
        const tms = parseFfmpegTimeMs(line);
        if (tms != null && sender && !sender.isDestroyed()) {
          const pct = Math.min(99, Math.floor((tms / totalMs) * 100));
          if (pct > lastPct) {
            lastPct = pct;
            sender.send('transcode:progress', { taskId: tid, progress: pct, line: line.slice(0, 200) });
          }
        }
      }
    });

    return await new Promise((resolve, reject) => {
      child.on('error', (e) => {
        encodeJobs.delete(tid);
        reject(e);
      });
      child.on('close', (code) => {
        encodeJobs.delete(tid);
        if (code === 0) resolve({ ok: true, encoderUsed: encoderMode });
        else reject(new Error(`ffmpeg 退出码 ${code}`));
      });
    });
  } finally {
    releaseEncodePoolSlot();
  }
}

function abortTask(taskId) {
  const tid = String(taskId || '');
  const ch = encodeJobs.get(tid);
  if (ch) {
    try {
      ch.kill('SIGKILL');
    } catch (e) {
      log('abort kill err', e);
    }
    encodeJobs.delete(tid);
    return true;
  }
  return false;
}

function abortAllEncodes() {
  for (const [tid, ch] of encodeJobs) {
    try {
      ch.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    encodeJobs.delete(tid);
  }
}

async function probeSummary(config, filePath) {
  const j = await ffprobeJson(config, filePath);
  const dur = Number(j.format?.duration || 0);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  return {
    durationSec: Number.isFinite(dur) ? dur : 0,
    videoCodec: v ? String(v.codec_name || '') : '',
    width: v && typeof v.width === 'number' ? v.width : 0,
    height: v && typeof v.height === 'number' ? v.height : 0,
  };
}

async function replaceSwapOnce({ config, targetPath, partialPath }) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const staging = path.join(dir, `${base}.etp.new`);
  const bak = path.join(dir, `${base}.etp.bak`);

  await fs.promises.copyFile(partialPath, staging);
  await ffprobeJson(config, staging);

  let preHash = '';
  const targetExists = fs.existsSync(targetPath);
  if (targetExists) {
    preHash = await fileHashSha256(targetPath);
    try {
      await fs.promises.rename(targetPath, bak);
    } catch (e) {
      await fs.promises.unlink(staging).catch(() => {});
      throw e;
    }
  }
  try {
    await fs.promises.rename(staging, targetPath);
  } catch (e) {
    if (targetExists && fs.existsSync(bak) && !fs.existsSync(targetPath)) {
      await fs.promises.rename(bak, targetPath).catch(() => {});
    }
    await fs.promises.unlink(staging).catch(() => {});
    throw e;
  }

  const st = await fs.promises.stat(targetPath);
  await fs.promises.unlink(partialPath).catch(() => {});
  return { preReplaceHash: preHash, resultSizeBytes: st.size };
}

async function replaceWithRetries(payload) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await replaceSwapOnce(payload);
    } catch (e) {
      lastErr = e;
      const dir = path.dirname(payload.targetPath);
      const base = path.basename(payload.targetPath);
      const staging = path.join(dir, `${base}.etp.new`);
      await fs.promises.unlink(staging).catch(() => {});
      log('replace attempt fail', attempt, e?.message || e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function cleanupTaskWorkdir(tempDir) {
  const d = String(tempDir || '').trim();
  if (!d) return;
  try {
    const entries = await fs.promises.readdir(d);
    for (const name of entries) {
      await fs.promises.unlink(path.join(d, name)).catch(() => {});
    }
    await fs.promises.rmdir(d).catch(() => {});
  } catch {
    /* ignore */
  }
}

const ORPHAN_SUFFIXES = ['.etp.partial', '.etp.new', '.etp.bak'];

async function scanOrphans(tempRoot) {
  const root = String(tempRoot || '').trim();
  if (!root || !fs.existsSync(root)) return { entries: [] };
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 8) return;
    let ents;
    try {
      ents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.startsWith('etp-task-')) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      if (ORPHAN_SUFFIXES.some((s) => lower.endsWith(s))) {
        let sz = 0;
        try {
          sz = (await fs.promises.stat(full)).size;
        } catch {
          /* ignore */
        }
        out.push({ path: full, size: sz });
      }
    }
  };
  await walk(root, 0);
  return { entries: out };
}

async function deletePaths(paths) {
  for (const p of paths) {
    try {
      await fs.promises.unlink(String(p));
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  validateTranscodeTools,
  precheck,
  startEncode,
  abortTask,
  abortAllEncodes,
  probeSummary,
  replaceWithRetries,
  cleanupTaskWorkdir,
  scanOrphans,
  deletePaths,
  resolveEncoderMode,
  hasLibplaceboFilter,
};
