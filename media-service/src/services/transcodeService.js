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
const os = require('os');
const { spawn } = require('child_process');

function log(...args) {
  console.log('[transcode]', new Date().toISOString(), ...args);
}

/** @type {Map<string, import('child_process').ChildProcess>} */
const encodeJobs = new Map();

// ── Device pool ─────────────────────────────────────────────────────────────

/** @type {Map<string, { inUse: number, waiters: Array<() => void> }>} */
const encodeDevicePools = new Map();
/** @type {Map<string, { deviceId: string, released: boolean }>} */
const encodeDeviceLeases = new Map();
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

function assignEncodeDeviceSlot(taskId, deviceId) {
  const tid = String(taskId || '');
  if (!tid || !deviceId) return;
  encodeDeviceLeases.set(tid, { deviceId, released: false });
}

function releaseEncodeDeviceSlotForTask(taskId, expectedDeviceId) {
  const tid = String(taskId || '');
  const lease = encodeDeviceLeases.get(tid);
  if (!lease) {
    if (expectedDeviceId) releaseEncodeDeviceSlot(expectedDeviceId);
    return;
  }
  if (expectedDeviceId && lease.deviceId !== expectedDeviceId) return;
  if (!lease.released) {
    lease.released = true;
    releaseEncodeDeviceSlot(lease.deviceId);
  }
  encodeDeviceLeases.delete(tid);
}

async function acquireFirstAvailableAmong(orderedDeviceSlots, { needsCpu, allowCpuBackup } = {}) {
  const list = Array.isArray(orderedDeviceSlots) ? orderedDeviceSlots : [];
  for (;;) {
    for (const row of list) {
      // CPU backup_only devices are skipped during normal selection so GPU is
      // preferred. allowCpuBackup lets the GPU→CPU fallback path take one.
      if (!needsCpu && !allowCpuBackup && row.cpuBackupOnly) continue;
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
    const { timeoutMs, ...spawnOpts } = opts || {};
    const child = spawn(bin, args, { windowsHide: true, ...spawnOpts });
    let out = ''; let err = '';
    let timedOut = false;
    const timeout = Number(timeoutMs) > 0
      ? setTimeout(() => {
          timedOut = true;
          try { child.kill('SIGKILL'); } catch (_) {}
        }, Number(timeoutMs))
      : null;
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (err2) => {
      if (timeout) clearTimeout(timeout);
      reject(err2);
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 0, out, err });
    });
  });
}

let _runCmd = runCmd;

async function ffprobeJson(config, filePath, opts = {}) {
  const probe = resolveFfprobeBin(config);
  const r = await _runCmd(
    probe,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    opts,
  );
  if (r.code !== 0) throw new Error(`ffprobe failed (${r.code}): ${(r.err || r.out).slice(0, 400)}`);
  return JSON.parse(r.out);
}

async function resolveSevenZipBin() {
  const explicit = String(process.env.SEVEN_Z_PATH || process.env.SEVENZIP_PATH || '').trim();
  const candidates = explicit ? [explicit] : ['7z', '7zz', '7za'];
  for (const bin of candidates) {
    try {
      const r = await _runCmd(bin, ['i']);
      const formats = `${r.out}\n${r.err}`;
      if (r.code === 0 && /\bUdf\b/i.test(formats) && /\bIso\b/i.test(formats)) return bin;
    } catch (_) {}
  }
  return null;
}

const DV_TONEMAP_LIBPLACEBO_FILTER = 'libplacebo=tonemapping=bt.2390,format=yuv420p10le';
const DV_TONEMAP_SOFTWARE_FILTER = 'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p10le';
const DV_TONEMAP_SELFTEST_LAVFI = 'testsrc2=s=64x64:d=0.1,format=yuv420p10le,setparams=colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084';
const DV_TONEMAP_CACHE_MS = 60 * 1000;
let dvTonemapCapabilityCache = null;

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ffmpegFilterExists(filterListText, filterName) {
  const name = escapeRegex(filterName);
  return new RegExp(`(^|\\s)${name}(\\s|$)`, 'im').test(String(filterListText || ''));
}

async function loadFfmpegFilterList(config) {
  const ff = resolveFfmpegBin(config);
  const r = await _runCmd(ff, ['-hide_banner', '-filters'], { timeoutMs: 10000 });
  return {
    ok: r.code === 0,
    text: `${r.out || ''}\n${r.err || ''}`,
    error: r.code === 0 ? '' : String(r.err || r.out || '').slice(-400),
  };
}

async function runTonemapFilterSelfTest(config, filterGraph) {
  const ff = resolveFfmpegBin(config);
  try {
    const r = await _runCmd(ff, [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', DV_TONEMAP_SELFTEST_LAVFI,
      '-frames:v', '1',
      '-vf', filterGraph,
      '-f', 'null',
      '-',
    ], { timeoutMs: 15000 });
    if (r.code === 0) return { ok: true, error: '' };
    return { ok: false, error: String(r.err || r.out || '').slice(-600) || `ffmpeg exit code ${r.code}` };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function tonemapPlanPayload({ mode, filterGraph, message, fallbackFrom, libplaceboError, softwareError }) {
  return {
    ok: true,
    mode,
    filterGraph,
    label: mode === 'libplacebo' ? 'FFmpeg libplacebo HDR→SDR tonemap' : 'FFmpeg software zscale/tonemap HDR→SDR fallback',
    message: message || '',
    fallbackFrom: fallbackFrom || '',
    libplaceboError: libplaceboError || '',
    softwareError: softwareError || '',
  };
}

async function resolveDolbyVisionTonemapPlan(config, opts = {}) {
  const ff = resolveFfmpegBin(config);
  const cacheKey = `${ff}`;
  const now = Date.now();
  if (!opts.forceRefresh && dvTonemapCapabilityCache && dvTonemapCapabilityCache.key === cacheKey && dvTonemapCapabilityCache.expiresAt > now) {
    return dvTonemapCapabilityCache.value;
  }

  const filters = await loadFfmpegFilterList(config);
  if (!filters.ok) {
    const value = { ok: false, mode: 'unavailable', message: `Unable to inspect FFmpeg filters: ${filters.error}` };
    dvTonemapCapabilityCache = { key: cacheKey, expiresAt: now + DV_TONEMAP_CACHE_MS, value };
    return value;
  }

  let libplaceboError = '';
  if (ffmpegFilterExists(filters.text, 'libplacebo')) {
    const libplacebo = await runTonemapFilterSelfTest(config, DV_TONEMAP_LIBPLACEBO_FILTER);
    if (libplacebo.ok) {
      const value = tonemapPlanPayload({
        mode: 'libplacebo',
        filterGraph: DV_TONEMAP_LIBPLACEBO_FILTER,
        message: 'libplacebo runtime self-test passed',
      });
      dvTonemapCapabilityCache = { key: cacheKey, expiresAt: now + DV_TONEMAP_CACHE_MS, value };
      return value;
    }
    libplaceboError = libplacebo.error || 'libplacebo self-test failed';
  } else {
    libplaceboError = 'libplacebo filter not found';
  }

  let softwareError = '';
  const hasSoftwareFilters = ffmpegFilterExists(filters.text, 'zscale') && ffmpegFilterExists(filters.text, 'tonemap');
  if (hasSoftwareFilters) {
    const software = await runTonemapFilterSelfTest(config, DV_TONEMAP_SOFTWARE_FILTER);
    if (software.ok) {
      const value = tonemapPlanPayload({
        mode: 'software',
        filterGraph: DV_TONEMAP_SOFTWARE_FILTER,
        fallbackFrom: 'libplacebo',
        libplaceboError,
        message: 'libplacebo unavailable at runtime; using software zscale/tonemap fallback',
      });
      dvTonemapCapabilityCache = { key: cacheKey, expiresAt: now + DV_TONEMAP_CACHE_MS, value };
      return value;
    }
    softwareError = software.error || 'software tonemap self-test failed';
  } else {
    softwareError = 'zscale and tonemap filters are required for software fallback';
  }

  const value = {
    ok: false,
    mode: 'unavailable',
    message: `No usable Dolby Vision tonemap path. libplacebo: ${libplaceboError}; software fallback: ${softwareError}`,
    libplaceboError,
    softwareError,
  };
  dvTonemapCapabilityCache = { key: cacheKey, expiresAt: now + DV_TONEMAP_CACHE_MS, value };
  return value;
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

function sanitizeTaskId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function partialEncodeTempFilename(sourcePath) {
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  if (!ext) return `${base}.etp.partial`;
  return `${base.slice(0, -ext.length)}.etp.partial${ext}`;
}

function pathPartsLower(p) {
  return String(p || '').replace(/\\/g, '/').split('/').map((x) => x.toLowerCase());
}

function findAncestorNamed(p, name) {
  const normalized = String(p || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  const needle = String(name || '').toLowerCase();
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].toLowerCase() === needle) {
      return parts.slice(0, i + 1).join(path.sep);
    }
  }
  return null;
}

function dirSizeSync(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      try {
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile()) total += fs.statSync(full).size;
      } catch (_) {}
    }
  };
  walk(dir);
  return total;
}

function fileOrDirSizeSync(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    if (st.isDirectory()) return dirSizeSync(p);
  } catch (_) {}
  return 0;
}

function isDirSync(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function isFileSync(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

function stripIsoVersion(name) {
  return String(name || '').replace(/;[0-9]+$/, '');
}

function parseIsoDirRecord(buf, off) {
  const len = buf[off];
  if (!len) return null;
  if (off + len > buf.length || len < 34) return null;
  const extent = buf.readUInt32LE(off + 2);
  const size = buf.readUInt32LE(off + 10);
  const flags = buf[off + 25];
  const nameLen = buf[off + 32];
  if (off + 33 + nameLen > buf.length) return null;
  const rawName = buf.slice(off + 33, off + 33 + nameLen);
  let name;
  if (nameLen === 1 && rawName[0] === 0) name = '.';
  else if (nameLen === 1 && rawName[0] === 1) name = '..';
  else name = stripIsoVersion(rawName.toString('ascii'));
  return { len, extent, size, isDir: !!(flags & 0x02), name };
}

function listIso9660Files(isoPath) {
  const fd = fs.openSync(isoPath, 'r');
  try {
    const sectorSize = 2048;
    const pvd = Buffer.alloc(sectorSize);
    fs.readSync(fd, pvd, 0, sectorSize, sectorSize * 16);
    if (pvd[0] !== 1 || pvd.slice(1, 6).toString('ascii') !== 'CD001') {
      throw new Error('ISO9660 primary volume descriptor not found');
    }
    const root = parseIsoDirRecord(pvd, 156);
    if (!root || !root.isDir) throw new Error('ISO9660 root directory not found');

    const files = [];
    const walk = (dir, prefix) => {
      const size = Math.max(0, dir.size || 0);
      if (size <= 0) return;
      const b = Buffer.alloc(size);
      fs.readSync(fd, b, 0, size, dir.extent * sectorSize);
      for (let off = 0; off < b.length;) {
        const len = b[off];
        if (!len) {
          off = (Math.floor(off / sectorSize) + 1) * sectorSize;
          continue;
        }
        const rec = parseIsoDirRecord(b, off);
        off += len;
        if (!rec || rec.name === '.' || rec.name === '..') continue;
        const rel = prefix ? `${prefix}/${rec.name}` : rec.name;
        if (rec.isDir) walk(rec, rel);
        else files.push({ path: rel, extent: rec.extent, size: rec.size });
      }
    };
    walk(root, '');
    return files;
  } finally {
    fs.closeSync(fd);
  }
}

function selectDvdTitleSetFromRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = String(row.name || path.basename(row.path || '')).toUpperCase();
    const m = /^VTS_(\d{2})_(\d+)\.VOB$/.exec(name);
    if (!m) continue;
    const title = m[1];
    const part = Number(m[2]);
    if (!Number.isFinite(part) || part <= 0) continue;
    const list = groups.get(title) || [];
    list.push({ ...row, title, part });
    groups.set(title, list);
  }

  const candidates = [...groups.values()]
    .map((clips) => ({
      title: clips[0].title,
      clips: clips.sort((a, b) => a.part - b.part),
      totalSize: clips.reduce((sum, c) => sum + (Number(c.size) || 0), 0),
    }))
    .filter((x) => x.clips.length > 0 && x.totalSize > 0)
    .sort((a, b) => {
      if (b.totalSize !== a.totalSize) return b.totalSize - a.totalSize;
      return a.title.localeCompare(b.title);
    });
  if (candidates.length === 0) throw new Error('No DVD title VOB set found');
  return candidates[0];
}

function extractIsoFile(isoPath, row, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const sectorSize = 2048;
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(isoPath, {
      start: row.extent * sectorSize,
      end: row.extent * sectorSize + row.size - 1,
    });
    const ws = fs.createWriteStream(outputPath);
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
}

function descriptorTagId(buf, off = 0) {
  if (off + 2 > buf.length) return -1;
  return buf.readUInt16LE(off);
}

function readExtentAd(buf, off) {
  return { length: buf.readUInt32LE(off), location: buf.readUInt32LE(off + 4) };
}

function readLongAd(buf, off) {
  const rawLength = buf.readUInt32LE(off);
  return {
    length: rawLength & 0x3fffffff,
    type: rawLength >>> 30,
    lbn: buf.readUInt32LE(off + 4),
    partition: buf.readUInt16LE(off + 8),
  };
}

function decodeUdfDstring(buf) {
  if (!buf || buf.length === 0) return '';
  const comp = buf[0];
  if (comp === 8) return buf.slice(1).toString('latin1').replace(/\0+$/g, '');
  if (comp === 16) {
    let s = '';
    for (let i = 1; i + 1 < buf.length; i += 2) {
      const code = buf.readUInt16BE(i);
      if (code) s += String.fromCharCode(code);
    }
    return s;
  }
  return buf.toString('latin1').replace(/\0+$/g, '');
}

function readIsoSectors(fd, sector, bytes, sectorSize = 2048) {
  const b = Buffer.alloc(bytes);
  fs.readSync(fd, b, 0, bytes, sector * sectorSize);
  return b;
}

function parseUdfAllocationDescriptors(entry, partitionStart, defaultPartition = 0, resolvePartitionSector = null) {
  const tag = descriptorTagId(entry);
  let infoLength;
  let lEa;
  let lAd;
  let adStart;
  let flags;

  if (tag === 261) {
    infoLength = Number(entry.readBigUInt64LE(56));
    flags = entry.readUInt16LE(34) & 0x0007;
    lEa = entry.readUInt32LE(168);
    lAd = entry.readUInt32LE(172);
    adStart = 176 + lEa;
  } else if (tag === 266) {
    infoLength = Number(entry.readBigUInt64LE(56));
    flags = entry.readUInt16LE(34) & 0x0007;
    lEa = entry.readUInt32LE(208);
    lAd = entry.readUInt32LE(212);
    adStart = 216 + lEa;
  } else {
    throw new Error(`Unsupported UDF file entry tag: ${tag}`);
  }

  const ads = [];
  if (flags === 3) {
    ads.push({ sector: -1, length: lAd, embedded: entry.slice(adStart, adStart + lAd) });
  } else if (flags === 0) {
    for (let off = adStart; off + 8 <= adStart + lAd; off += 8) {
      const rawLength = entry.readUInt32LE(off);
      const length = rawLength & 0x3fffffff;
      const type = rawLength >>> 30;
      const pos = entry.readUInt32LE(off + 4);
      if (length > 0 && type !== 1) {
        const sector = resolvePartitionSector ? resolvePartitionSector(defaultPartition, pos) : partitionStart + pos;
        ads.push({ sector, length, partition: defaultPartition, lbn: pos });
      }
    }
  } else if (flags === 1) {
    for (let off = adStart; off + 16 <= adStart + lAd; off += 16) {
      const ad = readLongAd(entry, off);
      if (ad.length > 0 && ad.type !== 1) {
        const sector = resolvePartitionSector ? resolvePartitionSector(ad.partition, ad.lbn) : partitionStart + ad.lbn;
        ads.push({ sector, length: ad.length, partition: ad.partition, lbn: ad.lbn });
      }
    }
  } else {
    throw new Error(`Unsupported UDF allocation descriptor type: ${flags}`);
  }

  return { infoLength, ads };
}

function readUdfFileBytes(fd, file, maxBytes) {
  const limit = Math.min(file.size || 0, maxBytes || file.size || 0);
  const chunks = [];
  let remaining = limit;
  for (const ad of file.ads || []) {
    if (remaining <= 0) break;
    const len = Math.min(ad.length, remaining);
    if (ad.embedded) {
      chunks.push(ad.embedded.slice(0, len));
    } else {
      chunks.push(readIsoSectors(fd, ad.sector, len));
    }
    remaining -= len;
  }
  return Buffer.concat(chunks);
}

async function extractUdfFile(isoPath, file, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const fd = fs.openSync(isoPath, 'r');
  const ws = fs.createWriteStream(outputPath);
  try {
    for (const ad of file.ads || []) {
      if (ad.embedded) {
        ws.write(ad.embedded.slice(0, ad.length));
        continue;
      }
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(isoPath, {
          start: ad.sector * 2048,
          end: ad.sector * 2048 + ad.length - 1,
        });
        rs.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(ws, { end: false });
      });
    }
  } finally {
    fs.closeSync(fd);
    await new Promise((resolve, reject) => {
      ws.end((err) => (err ? reject(err) : resolve()));
    });
  }
}

function listUdfFiles(isoPath) {
  const fd = fs.openSync(isoPath, 'r');
  try {
    const avdp = readIsoSectors(fd, 256, 2048);
    if (descriptorTagId(avdp) !== 2) throw new Error('UDF anchor volume descriptor not found');
    const main = readExtentAd(avdp, 16);

    let partitionStart = null;
    let logicalBlockSize = 2048;
    let fileSetAd = null;
    let metadataPartitionNumber = null;
    let metadataFileLocation = null;
    const mainSectors = Math.ceil(main.length / 2048);
    for (let i = 0; i < mainSectors; i++) {
      const sec = readIsoSectors(fd, main.location + i, 2048);
      const tag = descriptorTagId(sec);
      if (tag === 8) break;
      if (tag === 5) partitionStart = sec.readUInt32LE(188);
      if (tag === 6) {
        logicalBlockSize = sec.readUInt32LE(212) || 2048;
        fileSetAd = readLongAd(sec, 248);
        const mapTableLength = sec.readUInt32LE(264);
        const partitionMapCount = sec.readUInt32LE(268);
        let mapOff = 440;
        const mapEnd = Math.min(sec.length, mapOff + mapTableLength);
        for (let mapIndex = 0; mapIndex < partitionMapCount && mapOff + 2 <= mapEnd;) {
          const mapType = sec[mapOff];
          const mapLen = sec[mapOff + 1];
          if (mapLen <= 0 || mapOff + mapLen > mapEnd) break;
          if (mapType === 2 && mapLen >= 64) {
            const id = sec.slice(mapOff + 6, mapOff + 30).toString('latin1').replace(/\0+$/g, '');
            if (id.includes('UDF Metadata Partition')) {
              metadataPartitionNumber = sec.readUInt16LE(mapOff + 36);
              metadataFileLocation = sec.readUInt32LE(mapOff + 44);
            }
          }
          mapOff += mapLen;
        }
      }
    }
    if (partitionStart == null || !fileSetAd) throw new Error('UDF volume descriptors incomplete');
    if (logicalBlockSize !== 2048) throw new Error(`Unsupported UDF block size: ${logicalBlockSize}`);

    let metadataAds = null;
    if (metadataPartitionNumber != null && metadataFileLocation != null && metadataFileLocation !== 0xffffffff) {
      const metadataEntry = readIsoSectors(fd, partitionStart + metadataFileLocation, 2048);
      if (descriptorTagId(metadataEntry) === 261 || descriptorTagId(metadataEntry) === 266) {
        metadataAds = parseUdfAllocationDescriptors(metadataEntry, partitionStart).ads || [];
      }
    }

    const readPartitionBytes = (partition, lbn, bytes) => {
      if (partition !== metadataPartitionNumber || !metadataAds || metadataAds.length === 0) {
        return readIsoSectors(fd, partitionStart + lbn, bytes);
      }

      let offset = lbn * 2048;
      let remaining = bytes;
      const chunks = [];
      for (const ad of metadataAds) {
        if (remaining <= 0) break;
        if (offset >= ad.length) {
          offset -= ad.length;
          continue;
        }
        const len = Math.min(remaining, ad.length - offset);
        chunks.push(readIsoSectors(fd, ad.sector + Math.floor(offset / 2048), len));
        remaining -= len;
        offset = 0;
      }
      if (chunks.length === 0 || remaining > 0) {
        throw new Error('UDF metadata partition read out of range');
      }
      return Buffer.concat(chunks);
    };

    const resolvePartitionSector = (partition, lbn) => {
      if (partition !== metadataPartitionNumber || !metadataAds || metadataAds.length === 0) {
        return partitionStart + lbn;
      }
      let offset = lbn * 2048;
      for (const ad of metadataAds) {
        if (offset < ad.length) return ad.sector + Math.floor(offset / 2048);
        offset -= ad.length;
      }
      throw new Error('UDF metadata partition sector out of range');
    };

    const readEntryByLongAd = (ad) => {
      const first = readPartitionBytes(ad.partition, ad.lbn, 2048);
      let entrySize = 2048;
      const tag = descriptorTagId(first);
      if (tag === 261) entrySize = 176 + first.readUInt32LE(168) + first.readUInt32LE(172);
      else if (tag === 266) entrySize = 216 + first.readUInt32LE(208) + first.readUInt32LE(212);
      if (entrySize <= 2048) return first;
      return readPartitionBytes(ad.partition, ad.lbn, Math.ceil(entrySize / 2048) * 2048);
    };

    const fsd = readPartitionBytes(fileSetAd.partition, fileSetAd.lbn, 2048);
    if (descriptorTagId(fsd) !== 256) throw new Error('UDF file set descriptor not found');
    const rootAd = readLongAd(fsd, 400);

    const files = [];
    const walk = (entryAd, prefix) => {
      const entry = readEntryByLongAd(entryAd);
      const parsed = parseUdfAllocationDescriptors(entry, partitionStart, entryAd.partition, resolvePartitionSector);
      const dirBytes = Buffer.concat((parsed.ads || []).map((ad) => (
        ad.embedded ? ad.embedded : readIsoSectors(fd, ad.sector, ad.length)
      ))).slice(0, parsed.infoLength);

      for (let off = 0; off + 38 <= dirBytes.length;) {
        const tag = descriptorTagId(dirBytes, off);
        if (tag !== 257) break;
        const fileCharacteristics = dirBytes[off + 18];
        const lFi = dirBytes[off + 19];
        const icb = readLongAd(dirBytes, off + 20);
        const lIu = dirBytes.readUInt16LE(off + 36);
        const nameStart = off + 38 + lIu;
        const name = decodeUdfDstring(dirBytes.slice(nameStart, nameStart + lFi));
        const recLen = Math.ceil((38 + lIu + lFi) / 4) * 4;
        off += recLen;
        if (!name || (fileCharacteristics & 0x08)) continue;

        const childEntry = readEntryByLongAd(icb);
        const childParsed = parseUdfAllocationDescriptors(childEntry, partitionStart, icb.partition, resolvePartitionSector);
        const rel = prefix ? `${prefix}/${name}` : name;
        if (fileCharacteristics & 0x02) {
          walk(icb, rel);
        } else {
          files.push({ path: rel, size: childParsed.infoLength, ads: childParsed.ads });
        }
      }
    };

    walk(rootAd, '');
    return files;
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeDiscRelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').toUpperCase();
}

function archiveRelPathToLocal(root, relPath) {
  return path.join(root, ...String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean));
}

async function extractArchivePaths(archiveBin, isoPath, outputDir, relPaths) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const relPath of relPaths) {
    const r = await _runCmd(archiveBin, ['x', '-y', `-o${outputDir}`, isoPath, relPath]);
    if (r.code !== 0) {
      throw new Error(`7z extract failed (${r.code}): ${(r.err || r.out).slice(0, 400)}`);
    }
  }
}

async function listArchiveEntries(archiveBin, isoPath, relPaths) {
  const r = await _runCmd(archiveBin, ['l', '-slt', isoPath, ...relPaths]);
  if (r.code !== 0) throw new Error(`7z list failed (${r.code}): ${(r.err || r.out).slice(0, 400)}`);
  const entries = [];
  let cur = null;
  for (const line of String(r.out || '').split(/\r?\n/)) {
    const idx = line.indexOf(' = ');
    if (idx < 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 3);
    if (key === 'Path') {
      if (cur && cur.path) entries.push(cur);
      cur = { path: value };
    } else if (cur && key === 'Size') {
      cur.size = Number(value) || 0;
    } else if (cur && key === 'Folder') {
      cur.isDir = value === '+';
    }
  }
  if (cur && cur.path) entries.push(cur);
  return entries.filter((e) => e.path && !e.isDir);
}

function scoreBluRayPlaylist(row, sizeByPath) {
  const seen = new Set();
  let uniqueClipSize = 0;
  for (const clip of row.clips || []) {
    const key = normalizeDiscRelPath(clip.path);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueClipSize += Number(sizeByPath && sizeByPath.get(key)) || fileOrDirSizeSync(clip.path);
  }
  return { ...row, uniqueClipSize };
}

function sortBluRayPlaylistCandidates(candidates) {
  candidates.sort((a, b) => {
    const sizeDiff = (b.uniqueClipSize || 0) - (a.uniqueClipSize || 0);
    if (sizeDiff !== 0) return sizeDiff;
    if (b.durationSec !== a.durationSec) return b.durationSec - a.durationSec;
    return b.clips.length - a.clips.length;
  });
}

function readUdfFileBuffer(isoPath, file, maxBytes) {
  const fd = fs.openSync(isoPath, 'r');
  try {
    return readUdfFileBytes(fd, file, maxBytes);
  } finally {
    fs.closeSync(fd);
  }
}

function resolveDiscRoot(sourcePath) {
  const src = String(sourcePath || '').trim();
  if (!src) return null;
  const ext = path.extname(src).toLowerCase();
  if (ext === '.iso') {
    return {
      type: 'iso',
      rootPath: src,
      originalPath: src,
      replacementTargetPath: path.join(path.dirname(src), `${path.basename(src, path.extname(src))}.mkv`),
    };
  }

  const bdmvAncestor = findAncestorNamed(src, 'BDMV');
  if (bdmvAncestor && isDirSync(bdmvAncestor)) {
    const root = path.dirname(bdmvAncestor);
    return {
      type: 'bluray',
      rootPath: root,
      bdmvPath: bdmvAncestor,
      originalPath: root,
      replacementTargetPath: `${root}.mkv`,
    };
  }

  const videoTsAncestor = findAncestorNamed(src, 'VIDEO_TS');
  if (videoTsAncestor && isDirSync(videoTsAncestor)) {
    const root = path.dirname(videoTsAncestor);
    return {
      type: 'dvd',
      rootPath: root,
      videoTsPath: videoTsAncestor,
      originalPath: root,
      replacementTargetPath: `${root}.mkv`,
    };
  }

  if (isDirSync(src)) {
    const bdmv = path.join(src, 'BDMV');
    if (isDirSync(bdmv)) {
      return {
        type: 'bluray',
        rootPath: src,
        bdmvPath: bdmv,
        originalPath: src,
        replacementTargetPath: `${src}.mkv`,
      };
    }
    const videoTs = path.join(src, 'VIDEO_TS');
    if (isDirSync(videoTs)) {
      return {
        type: 'dvd',
        rootPath: src,
        videoTsPath: videoTs,
        originalPath: src,
        replacementTargetPath: `${src}.mkv`,
      };
    }
  }

  const parts = pathPartsLower(src);
  if (parts.includes('bdmv')) {
    const bdmv = findAncestorNamed(src, 'BDMV');
    const root = bdmv ? path.dirname(bdmv) : path.dirname(src);
    return {
      type: 'bluray',
      rootPath: root,
      bdmvPath: bdmv || path.join(root, 'BDMV'),
      originalPath: root,
      replacementTargetPath: `${root}.mkv`,
    };
  }

  return null;
}

function parseMplsPlaylistBytes(b, playlistName, resolveClipPath) {
  if (b.length < 20 || !b.slice(0, 4).toString('ascii').startsWith('MPL')) {
    throw new Error('Invalid MPLS file');
  }
  const playlistStart = b.readUInt32BE(8);
  if (playlistStart <= 0 || playlistStart + 10 > b.length) {
    throw new Error('Invalid MPLS playlist offset');
  }
  const itemCount = b.readUInt16BE(playlistStart + 6);
  let off = playlistStart + 10;
  const clips = [];
  let durationTicks = 0;
  for (let i = 0; i < itemCount; i++) {
    if (off + 22 > b.length) break;
    const len = b.readUInt16BE(off);
    if (len <= 0 || off + 2 + len > b.length) break;
    const clipId = b.slice(off + 2, off + 7).toString('ascii');
    const codec = b.slice(off + 7, off + 11).toString('ascii');
    const inTime = b.readUInt32BE(off + 14);
    const outTime = b.readUInt32BE(off + 18);
    if (/^\d{5}$/.test(clipId) && codec === 'M2TS') {
      const clipPath = resolveClipPath(clipId);
      if (clipPath) {
        clips.push({ clipId, path: clipPath, inTime, outTime });
        durationTicks += Math.max(0, outTime - inTime);
      }
    }
    off += 2 + len;
  }
  return {
    playlistPath: null,
    playlistName,
    clips,
    durationSec: durationTicks > 0 ? durationTicks / 45000 : 0,
  };
}

function readMplsPlaylist(filePath, bdmvPath) {
  const row = parseMplsPlaylistBytes(
    fs.readFileSync(filePath),
    path.basename(filePath),
    (clipId) => {
      const clipPath = path.join(bdmvPath, 'STREAM', `${clipId}.m2ts`);
      return isFileSync(clipPath) ? clipPath : null;
    },
  );
  row.playlistPath = filePath;
  return row;
}

function resolveBluRayInput(disc) {
  const bdmvPath = disc.bdmvPath || path.join(disc.rootPath, 'BDMV');
  const playlistDir = path.join(bdmvPath, 'PLAYLIST');
  const candidates = [];
  if (isDirSync(playlistDir)) {
    for (const ent of fs.readdirSync(playlistDir, { withFileTypes: true })) {
      if (!ent.isFile() || path.extname(ent.name).toLowerCase() !== '.mpls') continue;
      try {
        const row = readMplsPlaylist(path.join(playlistDir, ent.name), bdmvPath);
        if (row.clips.length > 0 && row.durationSec > 0) candidates.push(scoreBluRayPlaylist(row));
      } catch (_) {}
    }
  }

  sortBluRayPlaylistCandidates(candidates);

  if (candidates.length > 0) {
    return { kind: 'bluray_playlist', ...candidates[0] };
  }

  throw new Error('No valid Blu-ray playlist found');
}

function resolveDvdInput(disc) {
  const videoTsPath = disc.videoTsPath || path.join(disc.rootPath, 'VIDEO_TS');
  if (!isDirSync(videoTsPath)) throw new Error('DVD VIDEO_TS directory not found');
  const rows = fs.readdirSync(videoTsPath, { withFileTypes: true })
    .filter((ent) => ent.isFile() && /^VTS_\d+_\d+\.VOB$/i.test(ent.name))
    .map((ent) => {
      const full = path.join(videoTsPath, ent.name);
      return { name: ent.name, path: full, size: fileOrDirSizeSync(full) };
    });
  const selected = selectDvdTitleSetFromRows(rows);
  return {
    kind: 'dvd_vobset',
    playlistName: `VTS_${selected.title}`,
    clips: selected.clips.map((clip) => ({ clipId: path.basename(clip.path, '.VOB'), path: clip.path, size: clip.size })),
    durationSec: 0,
  };
}

async function resolveDvdIsoInput(disc, workDir) {
  const files = listIso9660Files(disc.rootPath);
  const rows = files
    .map((f) => {
      const normalized = String(f.path || '').replace(/\\/g, '/');
      const parts = normalized.split('/');
      const name = parts[parts.length - 1] || '';
      const parent = parts.length > 1 ? parts[parts.length - 2].toUpperCase() : '';
      return { ...f, name, parent };
    })
    .filter((f) => f.parent === 'VIDEO_TS' && /^VTS_\d+_\d+\.VOB$/i.test(f.name));
  const selected = selectDvdTitleSetFromRows(rows);
  const extractDir = path.join(workDir || path.dirname(disc.rootPath), 'dvd-iso-main-title');
  fs.mkdirSync(extractDir, { recursive: true });
  const clips = [];
  for (const clip of selected.clips) {
    const out = path.join(extractDir, clip.name.toUpperCase());
    await extractIsoFile(disc.rootPath, clip, out);
    clips.push({ clipId: path.basename(out, '.VOB'), path: out, size: clip.size });
  }
  return {
    kind: 'dvd_iso_vobset',
    playlistName: `VTS_${selected.title}`,
    clips,
    durationSec: 0,
  };
}

async function resolveBluRayIsoInput(disc, workDir, udfFiles) {
  const archiveInput = await resolveBluRayIsoInputViaArchive(disc, workDir);
  if (archiveInput) return archiveInput;

  const files = Array.isArray(udfFiles) ? udfFiles : listUdfFiles(disc.rootPath);
  const byPath = new Map(files.map((f) => [normalizeDiscRelPath(f.path), f]));
  const playlistFiles = files
    .filter((f) => /^BDMV\/PLAYLIST\/[^/]+\.MPLS$/i.test(normalizeDiscRelPath(f.path)))
    .sort((a, b) => normalizeDiscRelPath(a.path).localeCompare(normalizeDiscRelPath(b.path)));
  if (playlistFiles.length === 0) throw new Error('No Blu-ray playlist found in ISO');

  const candidates = [];
  for (const file of playlistFiles) {
    try {
      const playlistName = path.basename(String(file.path || ''));
      const row = parseMplsPlaylistBytes(
        readUdfFileBuffer(disc.rootPath, file, Math.min(file.size || 0, 1024 * 1024)),
        playlistName,
        (clipId) => {
          const key = `BDMV/STREAM/${clipId}.M2TS`;
          return byPath.has(key) ? key : null;
        },
      );
      if (row.clips.length > 0 && row.durationSec > 0) candidates.push(row);
    } catch (_) {}
  }

  candidates.sort((a, b) => {
    if (b.durationSec !== a.durationSec) return b.durationSec - a.durationSec;
    return b.clips.length - a.clips.length;
  });
  if (candidates.length === 0) throw new Error('No valid Blu-ray playlist found in ISO');

  const selected = candidates[0];
  const extractDir = path.join(workDir || path.dirname(disc.rootPath), 'bluray-iso-main-title');
  fs.mkdirSync(extractDir, { recursive: true });
  const clips = [];
  for (const clip of selected.clips) {
    const file = byPath.get(normalizeDiscRelPath(clip.path));
    if (!file) throw new Error(`Blu-ray ISO clip missing: ${clip.path}`);
    const out = path.join(extractDir, path.basename(clip.path));
    await extractUdfFile(disc.rootPath, file, out);
    clips.push({ ...clip, path: out, size: file.size });
  }

  return {
    kind: 'bluray_iso_playlist',
    playlistName: selected.playlistName,
    clips,
    durationSec: selected.durationSec || 0,
  };
}

async function resolveBluRayIsoInputViaArchive(disc, workDir) {
  const archiveBin = await resolveSevenZipBin();
  if (!archiveBin) return null;

  const extractRoot = path.join(workDir || path.dirname(disc.rootPath), 'bluray-iso-main-title');
  const playlistRoot = path.join(extractRoot, 'playlists');
  await extractArchivePaths(archiveBin, disc.rootPath, playlistRoot, ['BDMV/PLAYLIST/*.mpls']);
  const streamEntries = await listArchiveEntries(archiveBin, disc.rootPath, ['BDMV/STREAM/*.m2ts']);
  const sizeByPath = new Map(streamEntries.map((entry) => [normalizeDiscRelPath(entry.path), Number(entry.size) || 0]));

  const playlistDir = archiveRelPathToLocal(playlistRoot, 'BDMV/PLAYLIST');
  if (!isDirSync(playlistDir)) throw new Error('No Blu-ray playlist found in ISO');

  const candidates = [];
  for (const ent of fs.readdirSync(playlistDir, { withFileTypes: true })) {
    if (!ent.isFile() || path.extname(ent.name).toLowerCase() !== '.mpls') continue;
    try {
      const row = parseMplsPlaylistBytes(
        fs.readFileSync(path.join(playlistDir, ent.name)),
        ent.name,
        (clipId) => `BDMV/STREAM/${clipId}.m2ts`,
      );
      if (row.clips.length > 0 && row.durationSec > 0) candidates.push(scoreBluRayPlaylist(row, sizeByPath));
    } catch (_) {}
  }
  sortBluRayPlaylistCandidates(candidates);
  if (candidates.length === 0) throw new Error('No valid Blu-ray playlist found in ISO');

  const selected = candidates[0];
  await extractArchivePaths(archiveBin, disc.rootPath, extractRoot, selected.clips.map((clip) => clip.path));
  const clips = selected.clips.map((clip) => {
    const localPath = archiveRelPathToLocal(extractRoot, clip.path);
    if (!isFileSync(localPath)) throw new Error(`Blu-ray ISO clip extract failed: ${clip.path}`);
    return { ...clip, path: localPath, size: fileOrDirSizeSync(localPath) };
  });
  return {
    kind: 'bluray_iso_playlist',
    playlistName: selected.playlistName,
    clips,
    durationSec: selected.durationSec || 0,
  };
}

async function resolveBluRayIsoMetadataViaArchive(disc, workDir) {
  const archiveBin = await resolveSevenZipBin();
  if (!archiveBin) return null;

  const extractRoot = path.join(workDir || path.dirname(disc.rootPath), 'bluray-iso-metadata');
  const playlistRoot = path.join(extractRoot, 'playlists');
  await extractArchivePaths(archiveBin, disc.rootPath, playlistRoot, ['BDMV/PLAYLIST/*.mpls']);
  const streamEntries = await listArchiveEntries(archiveBin, disc.rootPath, ['BDMV/STREAM/*.m2ts']);
  const sizeByPath = new Map(streamEntries.map((entry) => [normalizeDiscRelPath(entry.path), Number(entry.size) || 0]));

  const playlistDir = archiveRelPathToLocal(playlistRoot, 'BDMV/PLAYLIST');
  if (!isDirSync(playlistDir)) throw new Error('No Blu-ray playlist found in ISO');

  const candidates = [];
  for (const ent of fs.readdirSync(playlistDir, { withFileTypes: true })) {
    if (!ent.isFile() || path.extname(ent.name).toLowerCase() !== '.mpls') continue;
    try {
      const row = parseMplsPlaylistBytes(
        fs.readFileSync(path.join(playlistDir, ent.name)),
        ent.name,
        (clipId) => `BDMV/STREAM/${clipId}.m2ts`,
      );
      if (row.clips.length > 0 && row.durationSec > 0) candidates.push(scoreBluRayPlaylist(row, sizeByPath));
    } catch (_) {}
  }
  sortBluRayPlaylistCandidates(candidates);
  if (candidates.length === 0) throw new Error('No valid Blu-ray playlist found in ISO');

  const selected = candidates[0];
  return {
    kind: 'bluray_iso_playlist',
    playlistName: selected.playlistName,
    clips: selected.clips.map((clip) => ({
      ...clip,
      size: sizeByPath.get(normalizeDiscRelPath(clip.path)) || 0,
    })),
    durationSec: selected.durationSec || 0,
    uniqueClipSize: selected.uniqueClipSize || 0,
  };
}

function resolveBluRayIsoMetadataViaUdf(disc, udfFiles) {
  const files = Array.isArray(udfFiles) ? udfFiles : listUdfFiles(disc.rootPath);
  const byPath = new Map(files.map((f) => [normalizeDiscRelPath(f.path), f]));
  const playlistFiles = files
    .filter((f) => /^BDMV\/PLAYLIST\/[^/]+\.MPLS$/i.test(normalizeDiscRelPath(f.path)))
    .sort((a, b) => normalizeDiscRelPath(a.path).localeCompare(normalizeDiscRelPath(b.path)));
  if (playlistFiles.length === 0) throw new Error('No Blu-ray playlist found in ISO');

  const candidates = [];
  for (const file of playlistFiles) {
    try {
      const playlistName = path.basename(String(file.path || ''));
      const row = parseMplsPlaylistBytes(
        readUdfFileBuffer(disc.rootPath, file, Math.min(file.size || 0, 1024 * 1024)),
        playlistName,
        (clipId) => {
          const key = `BDMV/STREAM/${clipId}.M2TS`;
          return byPath.has(key) ? key : null;
        },
      );
      if (row.clips.length > 0 && row.durationSec > 0) candidates.push(scoreBluRayPlaylist(row, new Map(files.map((f) => [normalizeDiscRelPath(f.path), Number(f.size) || 0]))));
    } catch (_) {}
  }

  sortBluRayPlaylistCandidates(candidates);
  if (candidates.length === 0) throw new Error('No valid Blu-ray playlist found in ISO');

  const selected = candidates[0];
  return {
    kind: 'bluray_iso_playlist',
    playlistName: selected.playlistName,
    clips: selected.clips.map((clip) => {
      const file = byPath.get(normalizeDiscRelPath(clip.path));
      return { ...clip, size: file ? Number(file.size) || 0 : 0 };
    }),
    durationSec: selected.durationSec || 0,
    uniqueClipSize: selected.uniqueClipSize || 0,
  };
}

async function resolveIsoMetadataInput(disc, workDir) {
  try {
    const archiveInput = await resolveBluRayIsoMetadataViaArchive(disc, workDir);
    if (archiveInput) return archiveInput;
  } catch (_) {}
  try {
    const udfFiles = listUdfFiles(disc.rootPath);
    if (udfFiles.some((f) => normalizeDiscRelPath(f.path).startsWith('BDMV/'))) {
      return resolveBluRayIsoMetadataViaUdf(disc, udfFiles);
    }
  } catch (_) {}

  const files = listIso9660Files(disc.rootPath);
  const rows = files
    .map((f) => {
      const normalized = String(f.path || '').replace(/\\/g, '/');
      const parts = normalized.split('/');
      const name = parts[parts.length - 1] || '';
      const parent = parts.length > 1 ? parts[parts.length - 2].toUpperCase() : '';
      return { ...f, name, parent };
    })
    .filter((f) => f.parent === 'VIDEO_TS' && /^VTS_\d+_\d+\.VOB$/i.test(f.name));
  const selected = selectDvdTitleSetFromRows(rows);
  return {
    kind: 'dvd_iso_vobset',
    playlistName: `VTS_${selected.title}`,
    clips: selected.clips.map((clip) => ({ clipId: clip.name, path: clip.path, size: clip.size })),
    durationSec: 0,
    uniqueClipSize: selected.totalSize || 0,
  };
}

async function resolveIsoInput(disc, workDir) {
  try {
    const archiveInput = await resolveBluRayIsoInputViaArchive(disc, workDir);
    if (archiveInput) return archiveInput;
  } catch (_) {}
  try {
    const udfFiles = listUdfFiles(disc.rootPath);
    if (udfFiles.some((f) => normalizeDiscRelPath(f.path).startsWith('BDMV/'))) {
      return await resolveBluRayIsoInput(disc, workDir, udfFiles);
    }
  } catch (_) {}
  return resolveDvdIsoInput(disc, workDir);
}

async function resolveDiscInput(sourcePath, options = {}) {
  const disc = resolveDiscRoot(sourcePath);
  if (!disc) return null;
  if (disc.type === 'bluray') return { disc, input: resolveBluRayInput(disc) };
  if (disc.type === 'dvd') return { disc, input: resolveDvdInput(disc) };
  if (disc.type === 'iso') {
    return { disc, input: await resolveIsoInput(disc, options.workDir) };
  }
  return null;
}

function uniqueClipSize(clips) {
  const seen = new Set();
  let total = 0;
  for (const clip of clips || []) {
    const key = normalizeDiscRelPath(clip.path || clip.clipId);
    if (seen.has(key)) continue;
    seen.add(key);
    total += Number(clip.size) || fileOrDirSizeSync(clip.path);
  }
  return total;
}

async function probeDiscMetadata(config, sourcePath, options = {}) {
  const disc = resolveDiscRoot(sourcePath);
  if (!disc) return null;

  const ownWorkDir = !options.workDir;
  const workDir = options.workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-disc-probe-'));
  try {
    let input;
    if (disc.type === 'bluray') input = resolveBluRayInput(disc);
    else if (disc.type === 'dvd') input = resolveDvdInput(disc);
    else if (disc.type === 'iso') input = await resolveIsoMetadataInput(disc, workDir);
    else return null;

    const mainSizeBytes = Number(input.uniqueClipSize) || uniqueClipSize(input.clips);
    const durationSec = Number(input.durationSec) || 0;
    const bitrate = durationSec > 0 && mainSizeBytes > 0
      ? Math.round((mainSizeBytes * 8) / durationSec)
      : 0;

    let summary = null;
    const firstLocalClip = (input.clips || []).find((clip) => clip.path && fs.existsSync(clip.path));
    if (firstLocalClip) {
      try { summary = await probeSummary(config, firstLocalClip.path); } catch (_) {}
    }

    return {
      isDiscLike: true,
      sourceKind: input.kind,
      selectedPlaylist: input.playlistName || '',
      clipPaths: (input.clips || []).map((clip) => clip.path),
      durationSec,
      sizeBytes: mainSizeBytes || fileOrDirSizeSync(disc.rootPath),
      bitrate,
      videoCodec: summary && summary.videoCodec || '',
      width: summary && summary.width || 0,
      height: summary && summary.height || 0,
      audioCodec: summary && summary.audioCodec || '',
    };
  } finally {
    if (ownWorkDir) {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function writeConcatList(filePath, clips) {
  const body = clips.map((clip) => {
    const escaped = String(clip.path).replace(/\\/g, '/').replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  }).join('\n') + '\n';
  fs.writeFileSync(filePath, body, 'utf8');
}

async function buildMkvRemuxCodecArgs(config, sampleInputPath) {
  const args = [];
  const codecOverrides = [];
  let j = null;
  try { j = await ffprobeJson(config, sampleInputPath); } catch (_) {}
  let mappedAudioIndex = 0;
  let audioIndex = 0;
  for (const stream of (j && j.streams || [])) {
    const type = String(stream.codec_type || '');
    const index = stream.index;
    if (typeof index !== 'number') continue;

    if (type === 'video') {
      args.push('-map', `0:${index}`);
      continue;
    }

    if (type === 'audio') {
      const sampleRate = Number(stream.sample_rate) || 0;
      const channels = Number(stream.channels) || 0;
      if (sampleRate <= 0 || channels <= 0) {
        audioIndex++;
        continue;
      }
      args.push('-map', `0:${index}`);
      if (String(stream.codec_name || '').toLowerCase() === 'pcm_bluray') {
        codecOverrides.push(`-c:a:${mappedAudioIndex}`, 'pcm_s16le');
      }
      mappedAudioIndex++;
      audioIndex++;
      continue;
    }

    if (type === 'subtitle') {
      args.push('-map', `0:${index}`);
    }
  }
  if (!args.some((arg) => arg === '-map')) {
    throw new Error('No valid media streams found for MKV remux');
  }
  args.push('-dn', '-c', 'copy', ...codecOverrides);
  return args;
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
  const r = await _runCmd(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', ENCODER_SELFTEST_LAVFI, '-frames:v', '1', ...encArgs, '-f', 'null', '-'], { env: env || process.env });
  return r.code === 0;
}

function resolveTonemapFilterGraph(dolbyVisionTonemap, explicitFilter) {
  if (explicitFilter) return String(explicitFilter);
  if (dolbyVisionTonemap && dolbyVisionTonemap.filterGraph) return String(dolbyVisionTonemap.filterGraph);
  return DV_TONEMAP_LIBPLACEBO_FILTER;
}

function buildEncodeArgs({ config, sourcePath, partialPath, encoderMode, isDolbyVision, dvAcknowledged, targetBitrate, dolbyVisionTonemap, dvTonemapFilter }) {
  const ff = resolveFfmpegBin(config);
  let enc = String(encoderMode || 'cpu').toLowerCase();
  if (isDolbyVision && dvAcknowledged) {
    enc = 'cpu';
  }

  // Hardware decode acceleration (before -i)
  const preInput = ['-hide_banner', '-nostats', '-loglevel', 'error', '-y'];
  if (enc === 'qsv') {
    preInput.push('-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv');
  } else if (enc === 'amf') {
    preInput.push('-hwaccel', process.platform === 'win32' ? 'd3d11va' : 'vaapi');
  }

  const args = [...preInput, '-i', sourcePath, '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?', '-dn'];
  if (isDolbyVision && dvAcknowledged) {
    args.push('-vf', resolveTonemapFilterGraph(dolbyVisionTonemap, dvTonemapFilter));
  }
  const bitrate = typeof targetBitrate === 'number' && targetBitrate > 0 ? String(targetBitrate) + 'M' : null;
  // Cap peak bitrate at 2x target so the output never exceeds the source
  const maxrate = bitrate ? String(Math.round(targetBitrate * 1.3)) + 'M' : null;
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
  const outTimeMs = /^out_time_ms=(\d+)/.exec(String(line || '').trim());
  if (outTimeMs) {
    const value = Number(outTimeMs[1]);
    return Number.isFinite(value) ? Math.max(0, value / 1000) : null;
  }
  const outTime = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(line || '').trim());
  if (outTime) {
    const h = Number(outTime[1]), min = Number(outTime[2]), sec = Number(outTime[3]);
    if (!Number.isFinite(h + min + sec)) return null;
    return ((h * 60 + min) * 60 + sec) * 1000;
  }
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
  const rFf = await _runCmd(ff, ['-hide_banner', '-version']);
  if (rFf.code !== 0) throw new Error('ffmpeg not available');

  const probe = resolveFfprobeBin(config);
  const rProbe = await _runCmd(probe, ['-hide_banner', '-version']);
  if (rProbe.code !== 0) throw new Error('ffprobe not available');

  let dolbyVisionTonemap = null;
  if (isDv) {
    dolbyVisionTonemap = await resolveDolbyVisionTonemapPlan(config);
    if (!dolbyVisionTonemap.ok) {
      throw new Error(`Dolby Vision source requires a usable FFmpeg tonemap path: ${dolbyVisionTonemap.message}`);
    }
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
    dolbyVisionTonemap,
  };
}

async function remuxDiscToMkv({ config, taskId, sourcePath, outputPath, workDir, onProgress }) {
  const resolved = await resolveDiscInput(sourcePath, { workDir });
  if (!resolved) throw new Error('Source is not a supported disc structure');

  const { disc, input } = resolved;
  const ff = resolveFfmpegBin(config);
  const tid = String(taskId || '');
  const clips = input.clips || [];
  if (clips.length === 0) throw new Error('No disc clips selected for remux');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) await fs.promises.unlink(outputPath).catch(() => {});

  let args;
  let concatListPath = null;
  const codecArgs = await buildMkvRemuxCodecArgs(config, clips[0].path);
  const inputTimingArgs = ['-fflags', '+genpts'];
  if (clips.length > 1) {
    concatListPath = path.join(workDir || path.dirname(outputPath), 'disc-remux-concat.txt');
    writeConcatList(concatListPath, clips);
    args = ['-hide_banner', '-y', ...inputTimingArgs, '-f', 'concat', '-safe', '0', '-i', concatListPath, ...codecArgs, outputPath];
  } else {
    args = ['-hide_banner', '-y', ...inputTimingArgs, '-i', clips[0].path, ...codecArgs, outputPath];
  }

  log('remuxDiscToMkv', tid, input.kind, input.playlistName || clips.map((c) => c.clipId).join(','), '->', outputPath);

  const child = spawn(ff, args, { windowsHide: true });
  if (tid) encodeJobs.set(tid, child);
  const totalMs = input.durationSec > 0 ? Math.max(1000, input.durationSec * 1000) : 0;
  let lastPct = 0;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (!totalMs) return;
    for (const line of String(chunk).split(/\r?\n/)) {
      const tms = parseFfmpegTimeMs(line);
      if (tms != null) {
        const pct = Math.min(99, Math.floor((tms / totalMs) * 100));
        if (pct > lastPct) {
          lastPct = pct;
          try { onProgress && onProgress(pct); } catch (_) {}
        }
      }
    }
  });

  await new Promise((resolve, reject) => {
    child.on('error', (e) => {
      if (tid) encodeJobs.delete(tid);
      reject(e);
    });
    child.on('close', (code) => {
      if (tid) encodeJobs.delete(tid);
      if (code === 0) resolve();
      else reject(new Error(`disc remux ffmpeg exit code ${code}`));
    });
  });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error('disc remux produced empty output');
  }
  await ffprobeJson(config, outputPath);

  if (concatListPath) await fs.promises.unlink(concatListPath).catch(() => {});

  return {
    ok: true,
    sourceKind: input.kind,
    selectedPlaylist: input.playlistName || null,
    clipPaths: clips.map((c) => c.path),
    durationSec: input.durationSec || 0,
    remuxPath: outputPath,
    originalDiscPath: disc.originalPath,
    replacementTargetPath: disc.replacementTargetPath,
    originalSizeBytes: fileOrDirSizeSync(disc.originalPath),
  };
}

// ── Remote encode support ─────────────────────────────────────────────────────

/** @type {Set<string>} */
const abortedRemoteTasks = new Set();

/**
 * Parse a remote deviceId like "node:<nodeId>:nvenc:0" into { nodeId, backend, gpuIndex }.
 */
function parseRemoteDeviceId(deviceId) {
  const s = String(deviceId || '');
  if (!s.startsWith('node:')) return null;
  const parts = s.split(':');
  if (parts.length < 4) return null;
  return {
    nodeId: parts[1],
    backend: parts[2],
    gpuIndex: parseInt(parts[3], 10) || 0,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startRemoteEncode(onProgress, params) {
  const { config, taskId, sourcePath, partialPath, deviceId,
    isDolbyVision, dvAcknowledged, durationSec, targetBitrate } = params;
  const tid = String(taskId || '');

  const remote = parseRemoteDeviceId(deviceId);
  if (!remote) throw new Error('Invalid remote deviceId: ' + deviceId);

  const nodeStore = require('../nodeStore');
  const nodeService = require('../nodeService');

  const node = nodeStore.getNode(remote.nodeId);
  if (!node || node.status !== 'online') throw new Error('Node offline: ' + remote.nodeId);

  // Record node assignment on task so health monitoring and admin can track it
  const taskStore = require('../taskStore');
  taskStore.updateTask(tid, { nodeId: remote.nodeId });

  const sourceFileName = path.basename(sourcePath);
  const sourceStats = fs.statSync(sourcePath);

  // Build ffmpeg args with relative paths (worker resolves via cwd)
  const { args: ffmpegArgs } = buildEncodeArgs({
    config, sourcePath: sourceFileName, partialPath: 'output.etp.partial.mkv',
    encoderMode: remote.backend, isDolbyVision: !!isDolbyVision,
    dvAcknowledged: !!dvAcknowledged, targetBitrate,
  });

  // Phase 1: Create job + upload source (0-10%)
  try {
    await nodeService.createJob(node, {
      jobId: tid,
      ffmpegArgs,
      sourceFileSize: sourceStats.size,
      sourceFileName,
      durationSec,
      gpuIndex: remote.gpuIndex,
    });

    if (abortedRemoteTasks.has(tid)) throw new Error('Aborted');

    await nodeService.uploadSource(node, tid, sourcePath, (bytesSent) => {
      const pct = Math.floor((bytesSent / sourceStats.size) * 10);
      try { onProgress(pct); } catch (_) {}
    });
    onProgress(10);

    if (abortedRemoteTasks.has(tid)) throw new Error('Aborted');

    // Phase 2: Poll encode progress (10-90%)
    const pollInterval = (config.nodePollIntervalMs || 2000);
    let lastProgress = 10;
    let consecutiveErrors = 0;

    while (true) {
      if (abortedRemoteTasks.has(tid)) throw new Error('Aborted');
      await sleep(pollInterval);

      let status;
      try {
        status = await nodeService.getJobStatus(node, tid);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) throw new Error(`Worker unreachable after 5 retries: ${err.message}`);
        continue;
      }

      if (status.status === 'error') {
        throw new Error(status.error || 'Remote encode failed');
      }

      const overall = 10 + Math.floor((status.progress || 0) * 0.8);
      if (overall > lastProgress) {
        lastProgress = overall;
        try { onProgress(lastProgress); } catch (_) {}
      }

      if (status.status === 'done') break;
    }

    // Phase 3: Download output (90-100%)
    if (abortedRemoteTasks.has(tid)) throw new Error('Aborted');

    await nodeService.downloadOutput(node, tid, partialPath, (bytesDownloaded, totalBytes) => {
      if (totalBytes > 0) {
        const pct = 90 + Math.floor((bytesDownloaded / totalBytes) * 10);
        try { onProgress(Math.min(99, pct)); } catch (_) {}
      }
    });
    onProgress(100);

    // Phase 4: Cleanup worker
    await nodeService.deleteJob(node, tid).catch(() => {});

    return { ok: true, encoderUsed: remote.backend, resolvedDeviceId: deviceId };
  } catch (err) {
    // Cleanup on error
    await nodeService.deleteJob(node, tid).catch(() => {});
    try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch (_) {}
    throw err;
  } finally {
    abortedRemoteTasks.delete(tid);
  }
}

// Tail stderr buffer (last ~4KB) so failed encodes carry a diagnostic tail
// instead of just "ffmpeg exit code N". Used by fallback logging.
const STDERR_TAIL_BYTES = 4096;

/**
 * Spawn ffmpeg locally and resolve on exit.
 *
 * Reused by startEncode for both the first (GPU) attempt and the CPU
 * fallback. Distinguishes itself from the old inline spawn by:
 *   - accumulating the last ~4KB of stderr for diagnostics on failure
 *   - returning { code, stderrTail } instead of rejecting with a bare message
 *
 * encodeJobs Map semantics (for abortTask) are preserved: the child is
 * registered under tid for the duration of the encode.
 */
// Indirection so tests can substitute the spawn implementation without patching
// child_process. Production code uses the real spawn captured at module load.
let _spawn = spawn;

function runLocalEncode({ ffmpegBin, args, spawnEnv, tid, durationSec, onProgress }) {
  const child = _spawn(ffmpegBin, args, { windowsHide: true, env: spawnEnv });
  encodeJobs.set(tid, child);

  const totalMs = typeof durationSec === 'number' && durationSec > 0
    ? Math.max(1000, durationSec * 1000)
    : 3600 * 1000 * 2;
  let lastPct = 0;

  // Ring-ish accumulation: keep the last STDERR_TAIL_BYTES of stderr.
  let stderrBuf = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuf = (stderrBuf + chunk).slice(-STDERR_TAIL_BYTES);
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

  return new Promise((resolve, reject) => {
    child.on('error', (e) => {
      encodeJobs.delete(tid);
      reject({ code: null, message: e.message, stderrTail: stderrBuf });
    });
    child.on('close', (code) => {
      encodeJobs.delete(tid);
      resolve({ code: code ?? 0, stderrTail: stderrBuf });
    });
  });
}

/**
 * One local encode attempt on a given device. Resolves { ok, encoderUsed,
 * resolvedDeviceId } on success; rejects { code, message, stderrTail } on
 * non-zero exit (carrying stderr tail for diagnostics).
 *
 * Does NOT touch the device pool — slot acquire/release is startEncode's job.
 */
async function attemptLocalEncode({
  config, taskId, sourcePath, partialPath, deviceId, encoderMode,
  isDolbyVision, dvAcknowledged, durationSec, targetBitrate, dolbyVisionTonemap, dvTonemapFilter, onProgress,
}) {
  const tid = String(taskId || '');

  // FFmpeg cannot resume a partial; ensure a clean output target.
  try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch (_) {}

  const { ffmpegBin, args } = buildEncodeArgs({
    config, sourcePath, partialPath, encoderMode,
    isDolbyVision: !!isDolbyVision, dvAcknowledged: !!dvAcknowledged, targetBitrate,
    dolbyVisionTonemap, dvTonemapFilter,
  });

  const { backend: devBack, gpuIndex: devGpu } = parseStableKey(deviceId);
  log('attemptLocalEncode', tid, deviceId, devBack);

  const spawnEnv = { ...process.env };
  if (devBack === 'nvenc' && devGpu >= 0) spawnEnv.CUDA_VISIBLE_DEVICES = String(devGpu);

  const result = await runLocalEncode({ ffmpegBin, args, spawnEnv, tid, durationSec, onProgress });

  if (result.code === 0) {
    return { ok: true, encoderUsed: devBack, resolvedDeviceId: deviceId };
  }
  throw {
    code: result.code,
    message: `ffmpeg exit code ${result.code}`,
    stderrTail: result.stderrTail,
    encoder: devBack,
  };
}

/**
 * Find the CPU device slot from the ordered pool, if any.
 * Used to pick a fallback target when a GPU encode fails.
 * Returns a slot object (single-element consumer) or null.
 */
function findCpuSlot(orderedDeviceSlots) {
  const list = Array.isArray(orderedDeviceSlots) ? orderedDeviceSlots : [];
  for (const row of list) {
    const sk = parseStableKey(row.deviceId);
    if (sk && sk.backend === 'cpu') return row;
  }
  return null;
}

/**
 * Normalize a runLocalEncode/attemptLocalEncode rejection into a proper
 * Error whose message carries the exit code + stderr tail, so flow
 * executors log something meaningful instead of [object Object].
 * Pass-through if already an Error (e.g. spawn ENOENT wrapped elsewhere).
 */
function normalizeEncodeError(err) {
  if (err instanceof Error) return err;
  const code = err && err.code;
  const tail = String((err && err.stderrTail) || '').trim();
  const tailSnippet = tail ? `: ${tail.slice(-512)}` : '';
  const e = new Error(`ffmpeg exit code ${code}${tailSnippet}`);
  e.code = code;
  e.stderrTail = tail;
  return e;
}

async function startEncode(onProgress, params) {
  const { config, taskId, sourcePath, partialPath, orderedDeviceSlots, isDolbyVision, dvAcknowledged, durationSec, targetBitrate, dolbyVisionTonemap, dvTonemapFilter } = params;
  const onLog = typeof params.onLog === 'function' ? params.onLog : null;
  const tid = String(taskId || '');
  if (encodeJobs.has(tid)) throw new Error('Task already has an active encode process');

  const slots = Array.isArray(orderedDeviceSlots) ? orderedDeviceSlots : [];
  if (slots.length === 0) throw new Error('No encode devices in pool');

  const needsCpu = !!(isDolbyVision && dvAcknowledged);
  const deviceId = await acquireFirstAvailableAmong(slots, { needsCpu });
  assignEncodeDeviceSlot(tid, deviceId);

  // Remote encode path — not subject to local GPU→CPU fallback.
  if (deviceId.startsWith('node:')) {
    try {
      return await startRemoteEncode(onProgress, { ...params, deviceId });
    } finally {
      releaseEncodeDeviceSlotForTask(tid, deviceId);
    }
  }

  const chosen = parseStableKey(deviceId);
  const firstBackend = chosen ? chosen.backend : 'cpu';

  // First attempt on the acquired device.
  try {
    try {
      return await attemptLocalEncode({
        config, taskId, sourcePath, partialPath, deviceId, encoderMode: firstBackend,
        isDolbyVision, dvAcknowledged, durationSec, targetBitrate, dolbyVisionTonemap, dvTonemapFilter, onProgress,
      });
    } finally {
      releaseEncodeDeviceSlotForTask(tid, deviceId);
    }
  } catch (firstErr) {
    // Decide whether a GPU→CPU fallback applies:
    //  - only if the first attempt was a GPU backend
    //  - DV tasks already run on CPU (needsCpu), so no second fallback
    //  - a CPU device in the pool already (e.g. cpuStrategy 'normal') => nothing to fall back to
    const isGpuFirst = firstBackend !== 'cpu';
    const cpuSlot = isGpuFirst && !needsCpu ? findCpuSlot(slots) : null;
    if (!cpuSlot) throw normalizeEncodeError(firstErr);

    const stderrTail = String(firstErr && firstErr.stderrTail || '').trim();
    const tailSnippet = stderrTail ? `: ${stderrTail.slice(-512)}` : '';
    onLog && onLog('warn', `GPU ${deviceId} 编码失败 (exit ${firstErr && firstErr.code}${tailSnippet})，降级到 CPU 重试`);

    const cpuId = await acquireFirstAvailableAmong([cpuSlot], { needsCpu: false, allowCpuBackup: true });
    assignEncodeDeviceSlot(tid, cpuId);
    try {
      return await attemptLocalEncode({
        config, taskId, sourcePath, partialPath, deviceId: cpuId, encoderMode: 'cpu',
        isDolbyVision, dvAcknowledged, durationSec, targetBitrate, dolbyVisionTonemap, dvTonemapFilter, onProgress,
      });
    } catch (secondErr) {
      const tail2 = String(secondErr && secondErr.stderrTail || '').trim();
      const tail2Snippet = tail2 ? `: ${tail2.slice(-512)}` : '';
      onLog && onLog('error', `CPU 降级重试也失败 (exit ${secondErr && secondErr.code}${tail2Snippet})`);
      throw normalizeEncodeError(secondErr);
    } finally {
      releaseEncodeDeviceSlotForTask(tid, cpuId);
    }
  }
}

function abortTask(taskId) {
  const tid = String(taskId || '');
  // Local encode
  const ch = encodeJobs.get(tid);
  if (ch) {
    releaseEncodeDeviceSlotForTask(tid);
    try { ch.kill('SIGKILL'); } catch (_) {}
    encodeJobs.delete(tid);
    return true;
  }
  // Remote encode
  releaseEncodeDeviceSlotForTask(tid);
  abortedRemoteTasks.add(tid);
  return true;
}

function abortAllEncodes() {
  for (const [tid, ch] of encodeJobs) {
    releaseEncodeDeviceSlotForTask(tid);
    try { ch.kill('SIGKILL'); } catch (_) {}
    encodeJobs.delete(tid);
  }
  for (const tid of [...encodeDeviceLeases.keys()]) releaseEncodeDeviceSlotForTask(tid);
}

async function probeSummary(config, filePath, opts = {}) {
  const j = await ffprobeJson(config, filePath, opts);
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

async function replaceDiscSwapOnce({ config, targetPath, partialPath, originalDiscPath }) {
  const target = String(targetPath || '').trim();
  const original = String(originalDiscPath || '').trim();
  if (!target) throw new Error('targetPath missing');
  if (!original) throw new Error('originalDiscPath missing');
  if (!fs.existsSync(original)) throw new Error(`Original disc path missing: ${original}`);
  if (fs.existsSync(target)) throw new Error(`Replacement target already exists: ${target}`);

  const dir = path.dirname(target);
  const base = path.basename(target);
  const staging = path.join(dir, `${base}.etp.new`);
  const bak = `${original}.etp.bak`;

  if (fs.existsSync(staging)) await fs.promises.unlink(staging).catch(() => {});
  if (fs.existsSync(bak)) throw new Error(`Backup path already exists: ${bak}`);

  await fs.promises.copyFile(partialPath, staging);
  await ffprobeJson(config, staging);

  try {
    await fs.promises.rename(original, bak);
  } catch (e) {
    await fs.promises.unlink(staging).catch(() => {});
    throw e;
  }

  try {
    await fs.promises.rename(staging, target);
  } catch (e) {
    await fs.promises.rename(bak, original).catch(() => {});
    await fs.promises.unlink(staging).catch(() => {});
    throw e;
  }

  const st = await fs.promises.stat(target);
  await fs.promises.unlink(partialPath).catch(() => {});
  await fs.promises.rm(bak, { recursive: true, force: true }).catch(() => {});
  return { preReplaceHash: '', resultSizeBytes: st.size };
}

async function replaceWithRetries(params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (params && params.originalDiscPath) return await replaceDiscSwapOnce(params);
      return await replaceSwapOnce(params);
    } catch (e) {
      lastErr = e;
      if (params && params.targetPath) {
        const dir = path.dirname(params.targetPath);
        const base = path.basename(params.targetPath);
        await fs.promises.unlink(path.join(dir, `${base}.etp.new`)).catch(() => {});
        await fs.promises.unlink(path.join(dir, `${base}.etp.bak`)).catch(() => {});
      }
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
  const r1 = await _runCmd(ff, ['-hide_banner', '-loglevel', 'error', '-ss', String(startSec), '-i', sourcePath, '-t', String(dur), '-c', 'copy', '-movflags', '+faststart', '-y', outputPath]);
  if (r1.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return { previewPath: outputPath, method: 'copy', startSec, duration: dur };

  // Fallback: fast software encode
  const r2 = await _runCmd(ff, ['-hide_banner', '-loglevel', 'error', '-ss', String(startSec), '-i', sourcePath, '-t', String(dur), '-c:v', 'libx265', '-crf', '28', '-preset', 'veryfast', '-an', '-movflags', '+faststart', '-y', outputPath]);
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
  if (process.platform !== 'win32') return 0;

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
  const tasks = taskStore.loadTasks({ includeHistory: false });
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
  startRemoteEncode,
  abortTask,
  abortAllEncodes,
  probeSummary,
  replaceWithRetries,
  cleanupTaskWorkdir,
  scanOrphans,
  extractPreviewClip,
  remuxDiscToMkv,
  resolveDiscInput,
  probeDiscMetadata,
  probeEncodeDevices,
  parseStableKey,
  parseRemoteDeviceId,
  resolveFfmpegBin,
  resolveFfprobeBin,
  getDeviceSlotUsage,
  getHealth,
  resolveDolbyVisionTonemapPlan,
  cleanupOrphans,
  // Test surface for the GPU→CPU fallback path (TRANSCODE_FALLBACK).
  findCpuSlot,
  normalizeEncodeError,
  _buildEncodeArgsForTest: buildEncodeArgs,
  _parseFfmpegTimeMsForTest: parseFfmpegTimeMs,
  _resetDolbyVisionTonemapCacheForTest() { dvTonemapCapabilityCache = null; },
  _setRunCmdForTest(fn) {
    _runCmd = fn || runCmd;
    dvTonemapCapabilityCache = null;
  },
  _setSpawnForTest(fn) { _spawn = fn || spawn; },
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

  const dvPlan = await resolveDolbyVisionTonemapPlan(config).catch((e) => ({
    ok: false,
    mode: 'unavailable',
    message: e && e.message ? e.message : String(e),
  }));
  const dolbyVisionTonemap = {
    ok: !!(dvPlan && dvPlan.ok),
    mode: dvPlan && dvPlan.mode || 'unavailable',
    label: dvPlan && dvPlan.label || '',
    message: dvPlan && dvPlan.message || '',
  };

  if (!dolbyVisionTonemap.ok) {
    return {
      status: 'yellow',
      ffmpegOk: true,
      deviceCount: devices.length,
      dolbyVisionTonemap,
      message: `Dolby Vision tonemap 不可用：${dolbyVisionTonemap.message || 'no usable path'}`,
    };
  }

  return { status: 'green', ffmpegOk: true, deviceCount: devices.length, dolbyVisionTonemap };
}
