'use strict';

/**
 * ShelfDeck Transcode Worker — pure compute node.
 *
 * Receives ffmpeg args + source file from the management service,
 * executes ffmpeg with local GPU, returns the encoded output.
 * Completely passive — no knowledge of Emby, NAS paths, or service location.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const config = require('./config');

// ── Logging ──────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(`[worker] ${new Date().toISOString()}`, ...args);
}

// ── FFmpeg resolution ────────────────────────────────────────────────────────

let cachedBundledFfmpeg;
let cachedBundledFfprobe;

function getBundledFfmpegPath() {
  if (cachedBundledFfmpeg !== undefined) return cachedBundledFfmpeg;
  try {
    const mod = require('ffmpeg-static');
    const p = typeof mod === 'string' ? mod : null;
    if (p && fs.existsSync(p)) { cachedBundledFfmpeg = p; return p; }
  } catch (_) {}
  cachedBundledFfmpeg = null; return null;
}

function getBundledFfprobePath() {
  if (cachedBundledFfprobe !== undefined) return cachedBundledFfprobe;
  try {
    const mod = require('@ffprobe-installer/ffprobe');
    const p = mod && typeof mod.path === 'string' ? mod.path : null;
    if (p && fs.existsSync(p)) { cachedBundledFfprobe = p; return p; }
  } catch (_) {}
  cachedBundledFfprobe = null; return null;
}

function resolveFfmpegBin(cfg) {
  const p = (cfg && String(cfg.ffmpegPath || '').trim()) || '';
  if (p && fs.existsSync(p)) return p;
  const env = String(process.env.FFMPEG_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = getBundledFfmpegPath();
  return bundled || 'ffmpeg';
}

function resolveFfprobeBin(cfg) {
  const p = (cfg && String(cfg.ffprobePath || '').trim()) || '';
  if (p && fs.existsSync(p)) return p;
  const env = String(process.env.FFPROBE_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = getBundledFfprobePath();
  return bundled || 'ffprobe';
}

// ── Command helpers ───────────────────────────────────────────────────────────

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

// ── Device probing ────────────────────────────────────────────────────────────

const ENCODER_SELFTEST_LAVFI = 'color=c=black:s=256x256:r=1';

async function encoderSelfTest(ff, encArgs, env) {
  const r = await runCmd(ff, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', ENCODER_SELFTEST_LAVFI,
    '-frames:v', '1',
    ...encArgs,
    '-f', 'null', '-',
  ], { env: env || process.env });
  return r.code === 0;
}

async function probeEncodeDevices(cfg) {
  const ff = resolveFfmpegBin(cfg);
  const devices = [];

  if (await encoderSelfTest(ff, ['-c:v', 'libx265'])) {
    devices.push({ stableKey: 'cpu:libx265', label: 'CPU · libx265', backend: 'cpu', gpuIndex: -1 });
  }
  for (let i = 0; i < 8; i++) {
    const env = { ...process.env, CUDA_VISIBLE_DEVICES: String(i) };
    if (await encoderSelfTest(ff, ['-c:v', 'hevc_nvenc'], env)) {
      devices.push({ stableKey: `nvenc:${i}`, label: `NVIDIA NVENC (CUDA ${i})`, backend: 'nvenc', gpuIndex: i });
    }
  }
  if (await encoderSelfTest(ff, ['-c:v', 'hevc_qsv'])) {
    devices.push({ stableKey: 'qsv:0', label: 'Intel Quick Sync (QSV)', backend: 'qsv', gpuIndex: 0 });
  }
  if (await encoderSelfTest(ff, ['-c:v', 'hevc_amf'])) {
    devices.push({ stableKey: 'amf:0', label: 'AMD AMF', backend: 'amf', gpuIndex: 0 });
  }
  return { devices };
}

// ── Progress parsing ─────────────────────────────────────────────────────────

function parseFfmpegTimeMs(line) {
  const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]), sec = Number(m[3]);
  if (!Number.isFinite(h + min + sec)) return null;
  return ((h * 60 + min) * 60 + sec) * 1000;
}

// ── Job store ─────────────────────────────────────────────────────────────────

/** @type {Map<string, {
 *   status: 'pending_upload'|'encoding'|'done'|'error',
 *   progress: number,
 *   error: string|null,
 *   tempDir: string,
 *   sourceFileName: string,
 *   sourceFile: string,
 *   outputFile: string,
 *   ffmpegProcess: import('child_process').ChildProcess|null,
 *   ffmpegArgs: string[],
 *   sourceFileSize: number,
 *   outputSizeBytes: number,
 *   durationSec: number,
 *   createdAt: string,
 * }>} */
const jobs = new Map();

let startTime = Date.now();

function sanitizeJobId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function getDiskFreeBytes(dir) {
  try {
    // Simple check: statfs not available on Windows, fall back to rough estimate
    return Infinity; // We'll handle disk-full via write errors
  } catch (_) { return 0; }
}

// ── Encode execution ─────────────────────────────────────────────────────────

function startEncode(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'pending_upload') return;

  const cfg = config.loadConfig();
  const ffmpegBin = resolveFfmpegBin(cfg);

  // Set GPU environment for NVENC
  const spawnEnv = { ...process.env };
  if (typeof job.gpuIndex === 'number' && job.gpuIndex >= 0) {
    spawnEnv.CUDA_VISIBLE_DEVICES = String(job.gpuIndex);
  }
  const args = job.ffmpegArgs;

  log(`encode start: jobId=${jobId} ffmpeg=${ffmpegBin}`);

  const child = spawn(ffmpegBin, args, {
    cwd: job.tempDir,
    windowsHide: true,
    env: spawnEnv,
  });

  job.ffmpegProcess = child;
  job.status = 'encoding';
  job.progress = 0;

  const totalMs = typeof job.durationSec === 'number' && job.durationSec > 0
    ? Math.max(1000, job.durationSec * 1000)
    : 3600 * 1000 * 2;
  let lastPct = 0;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const tms = parseFfmpegTimeMs(line);
      if (tms != null) {
        const pct = Math.min(99, Math.floor((tms / totalMs) * 100));
        if (pct > lastPct) {
          lastPct = pct;
          job.progress = pct;
        }
      }
    }
  });

  child.on('error', (err) => {
    log(`encode error: jobId=${jobId}`, err.message);
    job.status = 'error';
    job.error = err.message;
    job.ffmpegProcess = null;
  });

  child.on('close', (code) => {
    job.ffmpegProcess = null;
    if (job.status === 'error') return; // already handled

    if (code === 0) {
      job.status = 'done';
      job.progress = 100;
      try {
        const st = fs.statSync(job.outputFile);
        job.outputSizeBytes = st.size;
      } catch (_) {}
      log(`encode done: jobId=${jobId} outputSize=${job.outputSizeBytes}`);
    } else {
      job.status = 'error';
      job.error = `ffmpeg exit code ${code}`;
      log(`encode failed: jobId=${jobId} code=${code}`);
    }
  });
}

function abortJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.ffmpegProcess) {
    try { job.ffmpegProcess.kill('SIGKILL'); } catch (_) {}
    job.ffmpegProcess = null;
  }
}

async function cleanupJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  abortJob(jobId);
  const dir = job.tempDir;
  if (dir) {
    try {
      const entries = await fsp.readdir(dir);
      for (const name of entries) await fsp.unlink(path.join(dir, name)).catch(() => {});
      await fsp.rmdir(dir).catch(() => {});
    } catch (_) {}
  }
  jobs.delete(jobId);
}

// ── Admin page ────────────────────────────────────────────────────────────────

let adminHtml = null;

function getAdminHtml(cfg) {
  if (adminHtml) {
    // Update embedded config each time (config may have changed)
    return adminHtml.replace('__CONFIG__', JSON.stringify(configForPage(cfg)));
  }
  const raw = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
  adminHtml = raw;
  return adminHtml.replace('__CONFIG__', JSON.stringify(configForPage(cfg)));
}

function configForPage(cfg) {
  return {
    name: cfg.name || '',
    apiKey: cfg.apiKey ? '********' : '',
    port: cfg.port,
    tempRoot: cfg.tempRoot,
    ffmpegPath: cfg.ffmpegPath || '',
    ffprobePath: cfg.ffprobePath || '',
  };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

async function buildServer() {
  const Fastify = require('fastify');
  const server = Fastify({ logger: false });

  const cfg = config.loadConfig();

  // Allow raw binary upload via application/octet-stream
  server.addContentTypeParser('application/octet-stream', (req, payload, done) => {
    done(null, payload); // Pass raw stream through as req.body
  });

  // API key auth hook — always read latest config so apiKey changes take effect
  server.addHook('onRequest', async (req, reply) => {
    // Skip auth for health endpoint and admin page
    if (req.url === '/api/v1/health' || req.url === '/') return;

    const currentCfg = config.loadConfig();
    const apiKey = String(currentCfg.apiKey || '').trim();
    if (!apiKey) return; // No auth configured — allow all

    const provided = String(req.headers['x-api-key'] || '').trim();
    if (provided !== apiKey) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    }
  });

  // ── POST /api/v1/jobs — create job (metadata only, no file) ──────────────

  server.post('/api/v1/jobs', async (req, reply) => {
    const body = req.body || {};
    const rawId = String(body.jobId || '').trim();
    if (!rawId) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'jobId required' } });

    const jobId = sanitizeJobId(rawId);
    if (jobs.has(jobId)) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Job already exists' } });
    }

    const ffmpegArgs = Array.isArray(body.ffmpegArgs) ? body.ffmpegArgs.map(String) : [];
    if (ffmpegArgs.length === 0) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'ffmpegArgs required' } });
    }

    const sourceFileName = String(body.sourceFileName || 'source.mkv').trim();

    const tempDir = path.join(cfg.tempRoot, jobId);
    await fsp.mkdir(tempDir, { recursive: true });

    const job = {
      status: 'pending_upload',
      progress: 0,
      error: null,
      tempDir,
      sourceFileName,
      sourceFile: path.join(tempDir, sourceFileName),
      outputFile: path.join(tempDir, 'output.etp.partial.mkv'),
      ffmpegProcess: null,
      ffmpegArgs,
      sourceFileSize: Number(body.sourceFileSize) || 0,
      outputSizeBytes: 0,
      durationSec: Number(body.durationSec) || 3600,
      gpuIndex: typeof body.gpuIndex === 'number' ? body.gpuIndex : -1,
      createdAt: new Date().toISOString(),
    };
    jobs.set(jobId, job);

    log(`job created: jobId=${jobId} tempDir=${tempDir}`);
    return { ok: true, jobId };
  });

  // ── PUT /api/v1/jobs/:id/source — upload source file ─────────────────────

  server.put('/api/v1/jobs/:id/source', async (req, reply) => {
    const jobId = sanitizeJobId(req.params.id);
    const job = jobs.get(jobId);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    if (job.status !== 'pending_upload') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: `Job status is ${job.status}, expected pending_upload` } });
    }

    const contentLength = parseInt(String(req.headers['content-length'] || '0'), 10);
    if (job.sourceFileSize > 0 && contentLength !== job.sourceFileSize) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: `Content-Length ${contentLength} != expected ${job.sourceFileSize}` } });
    }

    const ws = fs.createWriteStream(job.sourceFile);
    try {
      await pipeline(req.body, ws);
    } catch (err) {
      await fsp.unlink(job.sourceFile).catch(() => {});
      job.status = 'error';
      job.error = `Upload failed: ${err.message}`;
      return reply.code(500).send({ error: { code: 'UPLOAD_FAILED', message: job.error } });
    }

    // Verify received bytes
    let written = 0;
    try { written = fs.statSync(job.sourceFile).size; } catch (_) {}
    if (job.sourceFileSize > 0 && written !== job.sourceFileSize) {
      await fsp.unlink(job.sourceFile).catch(() => {});
      job.status = 'error';
      job.error = `Incomplete upload: received ${written}, expected ${job.sourceFileSize}`;
      return reply.code(400).send({ error: { code: 'INCOMPLETE_UPLOAD', message: job.error } });
    }

    log(`source received: jobId=${jobId} bytes=${written}`);

    // Start ffmpeg asynchronously
    startEncode(jobId);

    return { ok: true, bytesReceived: written };
  });

  // ── GET /api/v1/jobs/:id — job status ────────────────────────────────────

  server.get('/api/v1/jobs/:id', async (req, reply) => {
    const jobId = sanitizeJobId(req.params.id);
    const job = jobs.get(jobId);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });

    return {
      jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
      outputSizeBytes: job.outputSizeBytes,
    };
  });

  // ── GET /api/v1/jobs/:id/output — download output file ───────────────────

  server.get('/api/v1/jobs/:id/output', async (req, reply) => {
    const jobId = sanitizeJobId(req.params.id);
    const job = jobs.get(jobId);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    if (job.status !== 'done') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: `Job status is ${job.status}, not done` } });
    }

    const st = fs.statSync(job.outputFile);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', st.size);
    return reply.send(fs.createReadStream(job.outputFile));
  });

  // ── DELETE /api/v1/jobs/:id — cancel and cleanup ─────────────────────────

  server.delete('/api/v1/jobs/:id', async (req, reply) => {
    const jobId = sanitizeJobId(req.params.id);
    if (!jobs.has(jobId)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });

    await cleanupJob(jobId);
    log(`job cleaned: jobId=${jobId}`);
    return { ok: true };
  });

  // ── GET /api/v1/capabilities — GPU devices ───────────────────────────────

  server.get('/api/v1/capabilities', async (_req, reply) => {
    const result = await probeEncodeDevices(cfg);
    return result;
  });

  // ── GET /api/v1/health — health check (no auth) ──────────────────────────

  server.get('/api/v1/health', async (_req, reply) => {
    let activeJobs = 0;
    for (const [, job] of jobs) {
      if (job.status === 'pending_upload' || job.status === 'encoding') activeJobs++;
    }
    return {
      ok: true,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      activeJobs,
      diskFreeBytes: getDiskFreeBytes(cfg.tempRoot),
    };
  });

  // ── GET / — admin management page (no auth) ───────────────────────────

  server.get('/', async (_req, reply) => {
    const currentCfg = config.loadConfig();
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return getAdminHtml(currentCfg);
  });

  // ── PATCH /api/v1/config — update node config (name / apiKey) ──────────

  server.patch('/api/v1/config', async (req, reply) => {
    const { name, apiKey } = req.body || {};
    const patch = {};

    if (name !== undefined) {
      if (!String(name).trim()) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name must not be empty' } });
      patch.name = String(name).trim();
    }
    if (apiKey !== undefined) {
      patch.apiKey = String(apiKey).trim();
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'At least one of name or apiKey required' } });
    }

    const updated = config.saveConfig(patch);
    return configForPage(updated);
  });

  return server;
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  const cfg = config.loadConfig();
  log(`starting on port ${cfg.port}, tempRoot=${cfg.tempRoot}`);

  // Ensure temp root exists
  await fsp.mkdir(cfg.tempRoot, { recursive: true });

  // Probe devices at startup
  try {
    const { devices } = await probeEncodeDevices(cfg);
    log(`probed ${devices.length} device(s):`, devices.map((d) => d.stableKey).join(', '));
  } catch (err) {
    log(`device probe warning: ${err.message}`);
  }

  const server = await buildServer();

  // Graceful shutdown
  const shutdown = async () => {
    log('shutting down...');
    for (const [jobId] of jobs) {
      await cleanupJob(jobId);
    }
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.listen({ port: cfg.port, host: '0.0.0.0' });
  log(`listening on http://0.0.0.0:${cfg.port}`);
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
