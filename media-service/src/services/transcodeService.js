'use strict';

/**
 * TranscodeService — execution layer for FFmpeg encoding.
 * v2: Clean interface for TranscodeFlowExecutor (TRANSCODE.md §3).
 *
 * Core interface:
 *   precheck(config, sourcePath) → { ok, needsDvConfirm?, ... }
 *   startEncode(onProgress, params) → { ok, ... }
 *   probeSummary(config, filePath) → { durationSec, videoCodec, width, height }
 *   replaceWithRetries(params) → { preReplaceHash, resultSizeBytes }
 *
 * Encode jobs are tracked in memory (encodeJobs Map), lost on process exit.
 * Restarted tasks recovered by TaskScheduler.recoverInterruptedTasks().
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function log(...args) {
  console.log('[transcode]', new Date().toISOString(), ...args);
}

/** @type {Map<string, import('child_process').ChildProcess>} */
const encodeJobs = new Map();

// ── Device pool ─────────────────────────────────────────────────────────────

/** @type {Map<string, { inUse: number, waiters: Array<() => void> }>} */
const encodeDevicePools = new Map();
/** @type {Array<() => void>} */
const globalDeviceWaiters = [];

function getOrCreateDevicePool(deviceId) {
  let p = encodeDevicePools.get(deviceId);
  if (!p) { p = { inUse: 0, waiters: [] }; encodeDevicePools.set(deviceId, p); }
  return p;
}

function notifyGlobalDeviceWaiters() {
  const q = globalDeviceWaiters.splice(0, globalDeviceWaiters.length);
  for (const fn of q) { try { fn(); } catch (e) { log('global waiter err', e); } }
}

function tryTakeDeviceSlot(deviceId, maxSlots) {
  const p = getOrCreateDevicePool(deviceId);
  const cap = Math.max(1, maxSlots | 0);
  if (p.inUse < cap) { p.inUse += 1; return true; }
  return false;
}

function releaseEncodeDeviceSlot(deviceId) {
  const p = encodeDevicePools.get(deviceId);
  if (!p) return;
  p.inUse = Math.max(0, p.inUse - 1);
  const next = p.waiters.shift();
  if (next) next();
  else notifyGlobalDeviceWaiters();
}

async function acquireFirstAvailableAmong(orderedDeviceSlots, { needsCpu } = {}) {
  const list = Array.isArray(orderedDeviceSlots) ? orderedDeviceSlots : [];
  for (;;) {
    for (const row of list) {
      if (!needsCpu && row.cpuBackupOnly) continue;
      const id = String(row.deviceId || '').trim();
      if (!id) continue;
      const maxSlots = Math.max(1, Number(row.maxSlots) || 1);
      if (tryTakeDeviceSlot(id, maxSlots)) return id;
    }
    await new Promise((resolve) => globalDeviceWaiters.push(resolve));
  }
}

function parseStableKey(stableKey) {
  const s = String(stableKey || '');
  if (s.startsWith('cpu:')) return { backend: 'cpu', gpuIndex: -1 };
  if (s.startsWith('nvenc:')) { const n = Number(s.slice(7)); return { backend: 'nvenc', gpuIndex: Number.isFinite(n) ? n : 0 }; }
  if (s.startsWith('qsv:')) { const n = Number(s.slice(4)); return { backend: 'qsv', gpuIndex: Number.isFinite(n) ? n : 0 }; }
  if (s.startsWith('amf:')) { const n = Number(s.slice(4)); return { backend: 'amf', gpuIndex: Number.isFinite(n) ? n : 0 }; }
  throw new Error(`Unknown encode device key: ${stableKey}`);
}

// ── Tool resolution ─────────────────────────────────────────────────────────

function fixAsarUnpackedPath(binPath) {
  if (!binPath || typeof binPath !== 'string') return binPath;
  return binPath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
}

let cachedBundledFfmpeg;
let cachedBundledFfprobe;

function getBundledFfmpegPath() {
  if (cachedBundledFfmpeg !== undefined) return cachedBundledFfmpeg;
  try {
    const mod = require('ffmpeg-static');
    const p = fixAsarUnpackedPath(typeof mod === 'string' ? mod : null);
    if (p && fs.existsSync(p)) { cachedBundledFfmpeg = p; return p; }
  } catch (_) {}
  cachedBundledFfmpeg = null; return null;
}

function getBundledFfprobePath() {
  if (cachedBundledFfprobe !== undefined) return cachedBundledFfprobe;
  try {
    const mod = require('@ffprobe-installer/ffprobe');
    const p = fixAsarUnpackedPath(mod && typeof mod.path === 'string' ? mod.path : null);
    if (p && fs.existsSync(p)) { cachedBundledFfprobe = p; return p; }
  } catch (_) {}
  cachedBundledFfprobe = null; return null;
}

function resolveFfmpegBin(config) {
  const p = config && String(config.ffmpegPath || '').trim();
  if (p && fs.existsSync(p)) return p;
  const env = String(process.env.FFMPEG_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = getBundledFfmpegPath();
  return bundled || 'ffmpeg';
}

function resolveFfprobeBin(config) {
  const p = config && String(config.ffprobePath || '').trim();
  if (p && fs.existsSync(p)) return p;
  const env = String(process.env.FFPROBE_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = getBundledFfprobePath();
  return bundled || 'ffprobe';
}

// ── Command helpers ─────────────────────────────────────────────────────────

function runCmd(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, ...opts });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, out, err }));
  });
}

async function ffprobeJson(config, filePath) {
  const probe = resolveFfprobeBin(config);
  const r = await runCmd(probe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
  if (r.code !== 0) throw new Error(`ffprobe failed (${r.code}): ${(r.err || r.out).slice(0, 400)}`);
  return JSON.parse(r.out);
}

function detectDolbyVision(j) {
  for (const s of j.streams || []) {
    const tag = String(s.codec_tag_string || '').toLowerCase();
    if (tag.includes('dvh') || tag.includes('dvhe')) return true;
    for (const sd of s.side_data_list || []) {
      if (/dovi|dolby.?vision/i.test(String(sd.side_data_type || ''))) return true;
    }
  }
  return false;
}

async function hasLibplaceboFilter(config) {
  const ff = resolveFfmpegBin(config);
  const r = await runCmd(ff, ['-hide_banner', '-filters']);
  return r.code === 0 && /libplacebo/i.test(r.out + r.err);
}

function sanitizeTaskId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function partialEncodeTempFilename(sourcePath) {
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  if (!ext) return `${base}.etp.partial`;
  return `${base.slice(0, -ext.length)}.etp.partial${ext}`;
}

function fileHashSha256(fp) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(fp).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

// ── Encode args ─────────────────────────────────────────────────────────────

const ENCODER_SELFTEST_LAVFI = 'color=c=black:s=256x256:r=1';

async function encoderSelfTest(ff, encArgs, env) {
  const r = await runCmd(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', ENCODER_SELFTEST_LAVFI, '-frames:v', '1', ...encArgs, '-f', 'null', '-'], { env: env || process.env });
  return r.code === 0;
}

function buildEncodeArgs({ config, sourcePath, partialPath, encoderMode, isDolbyVision, dvAcknowledged, targetBitrate }) {
  const ff = resolveFfmpegBin(config);
  const args = ['-hide_banner', '-y', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?', '-dn'];
  let enc = String(encoderMode || 'cpu').toLowerCase();
  if (isDolbyVision && dvAcknowledged) {
    enc = 'cpu';
    args.push('-vf', 'libplacebo=tonemapping=bt.2390,format=yuv420p10le');
  }
  const bitrate = typeof targetBitrate === 'number' && targetBitrate > 0 ? String(targetBitrate) + 'M' : null;
  // Cap peak bitrate at 2x target so the output never exceeds the source
  const maxrate = bitrate ? String(targetBitrate * 2) + 'M' : null;
  const bufsize = maxrate;
  if (enc === 'nvenc') {
    args.push('-c:v', 'hevc_nvenc', '-rc', 'vbr', '-preset', 'p5');
    if (bitrate) args.push('-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize);
    else args.push('-cq', '24');
  } else if (enc === 'qsv') {
    args.push('-c:v', 'hevc_qsv', '-preset', 'medium');
    if (bitrate) { args.push('-rc', 'vbr', '-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize); }
    else args.push('-global_quality', '24');
  } else if (enc === 'amf') {
    args.push('-c:v', 'hevc_amf', '-quality', 'balanced');
    if (bitrate) args.push('-rc', 'vbr', '-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize);
    else args.push('-rc', 'cqp', '-qp_i', '24', '-qp_p', '24');
  } else {
    args.push('-c:v', 'libx265', '-preset', 'medium');
    if (bitrate) args.push('-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize);
    else args.push('-crf', '22');
  }
  args.push('-c:a', 'copy', '-c:s', 'copy', partialPath);
  return { ffmpegBin: ff, args };
}

function parseFfmpegTimeMs(line) {
  const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]), sec = Number(m[3]);
  if (!Number.isFinite(h + min + sec)) return null;
  return ((h * 60 + min) * 60 + sec) * 1000;
}

// ── Core API ────────────────────────────────────────────────────────────────

async function probeEncodeDevices(config) {
  const ff = resolveFfmpegBin(config);
  const devices = [];
  if (await encoderSelfTest(ff, ['-c:v', 'libx265'])) {
    devices.push({ stableKey: 'cpu:libx265', label: 'CPU · libx265（软件）', backend: 'cpu', gpuIndex: -1 });
  }
  for (let i = 0; i < 8; i++) {
    const env = { ...process.env, CUDA_VISIBLE_DEVICES: String(i) };
    if (await encoderSelfTest(ff, ['-c:v', 'hevc_nvenc'], env)) {
      devices.push({ stableKey: `nvenc:${i}`, label: `NVIDIA NVENC（CUDA ${i}）`, backend: 'nvenc', gpuIndex: i });
    }
  }
  if (await encoderSelfTest(ff, ['-c:v', 'hevc_qsv'])) {
    devices.push({ stableKey: 'qsv:0', label: 'Intel Quick Sync（QSV）', backend: 'qsv', gpuIndex: 0 });
  }
  if (await encoderSelfTest(ff, ['-c:v', 'hevc_amf'])) {
    devices.push({ stableKey: 'amf:0', label: 'AMD AMF', backend: 'amf', gpuIndex: 0 });
  }
  return { devices };
}

async function precheck(config, sourcePath) {
  const tempRoot = String(config.transcodeTempRoot || '').trim();
  if (!tempRoot) throw new Error('transcodeTempRoot not configured');

  let stRoot;
  try { stRoot = fs.statSync(tempRoot); } catch { throw new Error(`Temp root not accessible: ${tempRoot}`); }
  if (!stRoot.isDirectory()) throw new Error('Temp root is not a directory');
  try { fs.accessSync(tempRoot, fs.constants.R_OK | fs.constants.W_OK); } catch { throw new Error('Temp root not writable'); }

  let st;
  try { st = fs.statSync(sourcePath); } catch { throw new Error(`Source file not readable: ${sourcePath}`); }
  if (!st.isFile()) throw new Error('Source path is not a file');

  const j = await ffprobeJson(config, sourcePath);
  const isDv = detectDolbyVision(j);
  const durationSec = Number(j.format && j.format.duration) || 3600;
  const originalSizeBytes = st.size;

  const vStream = (j.streams || []).find((s) => s.codec_type === 'video');
  const aStream = (j.streams || []).find((s) => s.codec_type === 'audio');
  const originalVideoCodec = vStream ? String(vStream.codec_name || '') : '';
  const originalWidth = vStream && typeof vStream.width === 'number' ? vStream.width : 0;
  const originalHeight = vStream && typeof vStream.height === 'number' ? vStream.height : 0;
  const originalAudioCodec = aStream ? String(aStream.codec_name || '') : '';
  const rawBitrate = Number(j.format && j.format.bit_rate) || 0;
  const originalBitrate = rawBitrate > 0
    ? Math.round(rawBitrate / 1000)
    : (durationSec > 0 ? Math.round((originalSizeBytes * 8) / (durationSec * 1000)) : 0);

  const ff = resolveFfmpegBin(config);
  const rFf = await runCmd(ff, ['-hide_banner', '-version']);
  if (rFf.code !== 0) throw new Error('ffmpeg not available');

  const probe = resolveFfprobeBin(config);
  const rProbe = await runCmd(probe, ['-hide_banner', '-version']);
  if (rProbe.code !== 0) throw new Error('ffprobe not available');

  if (isDv) {
    const okLp = await hasLibplaceboFilter(config);
    if (!okLp) throw new Error('Dolby Vision source requires FFmpeg with libplacebo filter');
  }

  return {
    ok: true,
    needsDvConfirm: isDv,
    sourcePath,
    isDolbyVision: isDv,
    durationSec,
    originalSizeBytes,
    originalVideoCodec,
    originalWidth,
    originalHeight,
    originalAudioCodec,
    originalBitrate,
  };
}

async function startEncode(onProgress, params) {
  const { config, taskId, sourcePath, partialPath, orderedDeviceSlots, isDolbyVision, dvAcknowledged, durationSec, targetBitrate } = params;
  const tid = String(taskId || '');
  if (encodeJobs.has(tid)) throw new Error('Task already has an active encode process');

  const slots = Array.isArray(orderedDeviceSlots) ? orderedDeviceSlots : [];
  if (slots.length === 0) throw new Error('No encode devices in pool');

  const needsCpu = !!(isDolbyVision && dvAcknowledged);
  const deviceId = await acquireFirstAvailableAmong(slots, { needsCpu });
  try {
    try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch (_) {}

    const { backend: devBack, gpuIndex: devGpu } = parseStableKey(deviceId);

    const { ffmpegBin, args } = buildEncodeArgs({ config, sourcePath, partialPath, encoderMode: devBack, isDolbyVision: !!isDolbyVision, dvAcknowledged: !!dvAcknowledged, targetBitrate });
    log('startEncode', tid, deviceId, devBack);

    const spawnEnv = { ...process.env };
    if (devBack === 'nvenc' && devGpu >= 0) spawnEnv.CUDA_VISIBLE_DEVICES = String(devGpu);

    const child = spawn(ffmpegBin, args, { windowsHide: true, env: spawnEnv });
    encodeJobs.set(tid, child);

    const totalMs = typeof durationSec === 'number' && durationSec > 0 ? Math.max(1000, durationSec * 1000) : 3600 * 1000 * 2;
    let lastPct = 0;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const tms = parseFfmpegTimeMs(line);
        if (tms != null) {
          const pct = Math.min(99, Math.floor((tms / totalMs) * 100));
          if (pct > lastPct) {
            lastPct = pct;
            try { onProgress(pct); } catch (_) {}
          }
        }
      }
    });

    return await new Promise((resolve, reject) => {
      child.on('error', (e) => { encodeJobs.delete(tid); reject(e); });
      child.on('close', (code) => {
        encodeJobs.delete(tid);
        if (code === 0) resolve({ ok: true, encoderUsed: devBack, resolvedDeviceId: deviceId });
        else reject(new Error(`ffmpeg exit code ${code}`));
      });
    });
  } finally {
    releaseEncodeDeviceSlot(deviceId);
  }
}

function abortTask(taskId) {
  const tid = String(taskId || '');
  const ch = encodeJobs.get(tid);
  if (ch) { try { ch.kill('SIGKILL'); } catch (_) {} encodeJobs.delete(tid); return true; }
  return false;
}

function abortAllEncodes() {
  for (const [tid, ch] of encodeJobs) { try { ch.kill('SIGKILL'); } catch (_) {} encodeJobs.delete(tid); }
}

async function probeSummary(config, filePath) {
  const j = await ffprobeJson(config, filePath);
  const dur = Number(j.format && j.format.duration || 0);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return {
    durationSec: Number.isFinite(dur) ? dur : 0,
    videoCodec: v ? String(v.codec_name || '') : '',
    width: v && typeof v.width === 'number' ? v.width : 0,
    height: v && typeof v.height === 'number' ? v.height : 0,
    audioCodec: a ? String(a.codec_name || '') : '',
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
    try { await fs.promises.rename(targetPath, bak); } catch (e) { await fs.promises.unlink(staging).catch(() => {}); throw e; }
  }
  try {
    await fs.promises.rename(staging, targetPath);
  } catch (e) {
    if (targetExists && fs.existsSync(bak) && !fs.existsSync(targetPath)) await fs.promises.rename(bak, targetPath).catch(() => {});
    await fs.promises.unlink(staging).catch(() => {});
    throw e;
  }

  const st = await fs.promises.stat(targetPath);
  await fs.promises.unlink(partialPath).catch(() => {});
  await fs.promises.unlink(bak).catch(() => {});
  return { preReplaceHash: preHash, resultSizeBytes: st.size };
}

async function replaceWithRetries(params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await replaceSwapOnce(params); } catch (e) {
      lastErr = e;
      const dir = path.dirname(params.targetPath);
      const base = path.basename(params.targetPath);
      await fs.promises.unlink(path.join(dir, `${base}.etp.new`)).catch(() => {});
      await fs.promises.unlink(path.join(dir, `${base}.etp.bak`)).catch(() => {});
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function cleanupTaskWorkdir(tempDir) {
  const d = String(tempDir || '').trim();
  if (!d) return;
  try {
    const entries = await fs.promises.readdir(d);
    for (const name of entries) await fs.promises.unlink(path.join(d, name)).catch(() => {});
    await fs.promises.rmdir(d).catch(() => {});
  } catch (_) {}
}

async function extractPreviewClip(config, sourcePath, outputPath) {
  const ff = resolveFfmpegBin(config);
  const dur = Number.isFinite(config && config.transcodePreviewDuration) && config.transcodePreviewDuration > 0
    ? config.transcodePreviewDuration : 30;
  const startPct = Number.isFinite(config && config.transcodePreviewStartPct) ? config.transcodePreviewStartPct : 0.25;
  const j = await ffprobeJson(config, sourcePath);
  const totalSec = Number(j.format && j.format.duration) || 0;
  const startSec = totalSec > dur ? Math.floor(totalSec * startPct) : 0;

  // Try copy first (fast, no quality loss)
  const copyArgs = [ff, ['-hide_banner', '-loglevel', 'error', '-ss', String(startSec), '-i', sourcePath, '-t', String(dur), '-c', 'copy', '-movflags', '+faststart', '-y', outputPath]];
  const r1 = await runCmd(ff, ['-hide_banner', '-loglevel', 'error', '-ss', String(startSec), '-i', sourcePath, '-t', String(dur), '-c', 'copy', '-movflags', '+faststart', '-y', outputPath]);
  if (r1.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return { previewPath: outputPath, method: 'copy', startSec, duration: dur };

  // Fallback: fast software encode
  const r2 = await runCmd(ff, ['-hide_banner', '-loglevel', 'error', '-ss', String(startSec), '-i', sourcePath, '-t', String(dur), '-c:v', 'libx265', '-crf', '28', '-preset', 'veryfast', '-an', '-movflags', '+faststart', '-y', outputPath]);
  if (r2.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return { previewPath: outputPath, method: 'encode', startSec, duration: dur };

  throw new Error('Failed to extract preview clip');
}

async function scanOrphans(tempRoot) {
  const root = String(tempRoot || '').trim();
  if (!root || !fs.existsSync(root)) return { entries: [] };
  const out = [];
  const ORPHAN_SUFFIXES = ['.etp.partial', '.etp.new', '.etp.bak'];
  const walk = async (dir, depth) => {
    if (depth > 8) return;
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name.startsWith('etp-task-')) await walk(full, depth + 1); continue; }
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      if (ORPHAN_SUFFIXES.some((s) => lower.endsWith(s)) || lower.includes('.etp.partial.')) {
        let sz = 0;
        try { sz = (await fs.promises.stat(full)).size; } catch (_) {}
        out.push({ path: full, size: sz });
      }
    }
  };
  await walk(root, 0);
  return { entries: out };
}

function getDeviceSlotUsage() {
  const usage = {};
  for (const [deviceId, pool] of encodeDevicePools) {
    usage[deviceId] = pool.inUse;
  }
  return usage;
}

// ── Startup orphan cleanup ───────────────────────────────────────────────────

/**
 * Kill ffmpeg processes launched from our bundled ffmpeg binary.
 * Called on startup — any such process from a previous run is orphaned.
 */
function killOrphanFfmpegProcesses() {
  const bundled = getBundledFfmpegPath();
  if (!bundled) return 0;

  try {
    const output = execFileSync('powershell', [
      '-NoProfile', '-Command',
      'Get-CimInstance Win32_Process -Filter "name=\'ffmpeg.exe\'" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });

    if (!output || !output.trim()) return 0;

    let procs;
    try { procs = JSON.parse(output); } catch { return 0; }
    if (!Array.isArray(procs)) procs = [procs].filter(Boolean);

    let killed = 0;
    for (const proc of procs) {
      if (!proc || !proc.ProcessId) continue;
      if (!String(proc.CommandLine || '').includes(bundled)) continue;
      try {
        execFileSync('taskkill', ['/F', '/PID', String(proc.ProcessId)], { windowsHide: true, timeout: 5000 });
        killed++;
      } catch (_) {}
    }

    if (killed > 0) log('startup: killed', killed, 'orphan ffmpeg process(es)');
    return killed;
  } catch (err) {
    log('killOrphanFfmpegProcesses error:', err.message);
    return 0;
  }
}

/**
 * Clean up orphan temp directories on startup.
 * An orphan is an etp-task-* dir whose task no longer exists in the task store.
 * Called before the scheduler starts — kills orphan ffmpeg first (releases file locks),
 * then deletes orphan directories.
 */
async function cleanupOrphans(config) {
  const tempRoot = String(config.transcodeTempRoot || '').trim();
  if (!tempRoot || !fs.existsSync(tempRoot)) return { dirsCleaned: 0, bytesFreed: 0 };

  // Step 1: kill orphan ffmpeg first (releases file locks)
  killOrphanFfmpegProcesses();

  // Brief pause to let OS release file handles
  await new Promise((r) => setTimeout(r, 500));

  // Step 2: scan and delete orphan etp-task-* dirs
  const taskStore = require('../taskStore');
  const tasks = taskStore.loadTasks();
  const taskIds = new Set(tasks.map((t) => t.id));

  let entries;
  try {
    entries = await fs.promises.readdir(tempRoot, { withFileTypes: true });
  } catch {
    return { dirsCleaned: 0, bytesFreed: 0 };
  }

  let dirsCleaned = 0;
  let bytesFreed = 0;

  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.startsWith('etp-task-')) continue;

    const dirTaskId = ent.name.slice('etp-task-'.length);
    if (taskIds.has(dirTaskId)) continue; // task still exists, skip

    const dirPath = path.join(tempRoot, ent.name);

    // Calculate size before cleanup
    try {
      const files = await fs.promises.readdir(dirPath);
      for (const f of files) {
        try {
          const st = await fs.promises.stat(path.join(dirPath, f));
          bytesFreed += st.size;
        } catch (_) {}
      }
    } catch (_) {}

    await cleanupTaskWorkdir(dirPath);
    dirsCleaned++;
    log('startup: cleaned orphan dir', dirPath);
  }

  if (dirsCleaned > 0) {
    log(`startup: ${dirsCleaned} orphan dirs cleaned, ${(bytesFreed / 1024 / 1024 / 1024).toFixed(1)} GB freed`);
  }

  return { dirsCleaned, bytesFreed };
}

module.exports = {
  precheck,
  startEncode,
  abortTask,
  abortAllEncodes,
  probeSummary,
  replaceWithRetries,
  cleanupTaskWorkdir,
  scanOrphans,
  extractPreviewClip,
  probeEncodeDevices,
  parseStableKey,
  resolveFfmpegBin,
  resolveFfprobeBin,
  getDeviceSlotUsage,
  getHealth,
  cleanupOrphans,
};

const { execFileSync } = require('child_process');

async function getHealth(config) {
  const ff = resolveFfmpegBin(config);
  let ffmpegOk = false;
  try {
    execFileSync(ff, ['-version'], { timeout: 5000, windowsHide: true });
    ffmpegOk = true;
  } catch (_) {}

  const tempRoot = (config && config.transcodeTempRoot || '').trim();
  let tempOk = false;
  if (tempRoot) {
    try { tempOk = fs.existsSync(tempRoot); } catch (_) {}
  }

  if (!ffmpegOk) {
    return { status: 'red', ffmpegOk: false, deviceCount: 0, message: 'ffmpeg 不可用' };
  }
  if (!tempOk) {
    return { status: 'red', ffmpegOk: true, deviceCount: 0, message: 'transcodeTempRoot 不可写' };
  }

  const devices = (config && config.transcodeEncodingDevices || []).filter((d) => d.inPool);
  if (devices.length === 0) {
    return { status: 'yellow', ffmpegOk: true, deviceCount: 0, message: '未配置编码设备' };
  }

  return { status: 'green', ffmpegOk: true, deviceCount: devices.length };
}
