'use strict';

/**
 * NodeService — HTTP client for communicating with worker nodes.
 *
 * Uses Node.js native http.request for streaming file transfers (upload/download)
 * to avoid fetch's internal buffering. Small JSON operations still use fetch.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const { Transform, Readable } = require('stream');
const { pipeline } = require('stream/promises');

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(...args) {
  console.log('[nodeService]', new Date().toISOString(), ...args);
}

function nodeUrl(node, subPath) {
  const addr = String(node.address || '').trim();
  if (!addr) throw new Error('Node address is empty');
  const base = addr.includes('://') ? addr : `http://${addr}`;
  return `${base}${subPath}`;
}

function authHeaders(node) {
  const key = String(node.apiKey || '').trim();
  const headers = {};
  if (key) headers['X-Api-Key'] = key;
  return headers;
}

/**
 * Utility: create a timeout AbortController, or null.
 * Node 20 AbortSignal.timeout() is convenient but triggers for every request
 * once set; manual clearTimeout avoids leaving dangling timers.
 */
function createTimeout(ms) {
  if (typeof AbortSignal !== 'function' || typeof AbortSignal.timeout !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { controller: ctrl, timer };
}

function clearTimeoutObj(obj) {
  if (obj && obj.timer) clearTimeout(obj.timer);
}

// ── Worker API calls ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/jobs — create a job with metadata and ffmpeg args.
 */
async function createJob(node, params) {
  const { jobId, ffmpegArgs, sourceFileSize, sourceFileName, durationSec, gpuIndex } = params;
  const url = nodeUrl(node, '/api/v1/jobs');

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(node), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      ffmpegArgs,
      sourceFileSize: sourceFileSize || 0,
      sourceFileName: sourceFileName || 'source.mkv',
      durationSec: durationSec || 3600,
      gpuIndex: typeof gpuIndex === 'number' ? gpuIndex : -1,
    }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`Worker createJob failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

/**
 * PUT /api/v1/jobs/:id/source — upload source file with progress.
 *
 * Uses native http.request + stream.pipeline instead of fetch so the
 * file is streamed in 64 KB chunks with full backpressure — the entire
 * file is never buffered into memory regardless of Node version.
 */
async function uploadSource(node, jobId, sourcePath, onProgress) {
  const fullUrl = nodeUrl(node, `/api/v1/jobs/${encodeURIComponent(jobId)}/source`);
  const parsed = new URL(fullUrl);
  const stat = fs.statSync(sourcePath);
  let bytesSent = 0;

  const mod = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(result);
    };

    const req = mod.request({
      method: 'PUT',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      headers: {
        ...authHeaders(node),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
      },
      timeout: 10 * 60 * 1000, // 10 min
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += String(d); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          req.destroy();
          let msg = `HTTP ${res.statusCode}`;
          try { msg = JSON.parse(body).error?.message || msg; } catch (_) { /* keep raw status */ }
          done(new Error(`Worker uploadSource failed (${res.statusCode}): ${msg}`));
        } else {
          try { done(null, JSON.parse(body)); } catch (_) { done(null, { ok: true }); }
        }
      });
      res.on('error', (e) => done(e));
    });

    req.on('timeout', () => {
      req.destroy();
      done(new Error('Upload timed out after 10 minutes'));
    });

    // 64 KB chunks — small enough to keep memory flat,
    // large enough to be efficient over LAN
    const readStream = fs.createReadStream(sourcePath, { highWaterMark: 64 * 1024 });

    const progressStream = new Transform({
      transform(chunk, _encoding, callback) {
        bytesSent += chunk.length;
        if (typeof onProgress === 'function') {
          try { onProgress(bytesSent); } catch (_) { /* fire-and-forget */ }
        }
        callback(null, chunk);
      },
    });

    pipeline(readStream, progressStream, req).then(
      () => { /* pipeline done — response 'end' will resolve/reject */ },
      (err) => {
        readStream.destroy();
        progressStream.destroy();
        done(err);
      },
    );
  });
}

async function createAsset(node, params) {
  const url = nodeUrl(node, '/api/v1/assets');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(node), 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Worker createAsset failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

async function uploadAssetSource(node, assetId, sourcePath, onProgress, options = {}) {
  const fullUrl = nodeUrl(node, `/api/v1/assets/${encodeURIComponent(assetId)}/source`);
  const parsed = new URL(fullUrl);
  const stat = fs.statSync(sourcePath);
  let bytesSent = 0;
  const mod = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(result);
    };
    const req = mod.request({
      method: 'PUT',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      headers: {
        ...authHeaders(node),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
      },
      timeout: 30 * 60 * 1000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += String(d); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          let msg = `HTTP ${res.statusCode}`;
          try { msg = JSON.parse(body).error?.message || msg; } catch (_) {}
          done(new Error(`Worker uploadAssetSource failed (${res.statusCode}): ${msg}`));
        } else {
          try { done(null, JSON.parse(body)); } catch (_) { done(null, { ok: true }); }
        }
      });
      res.on('error', (e) => done(e));
    });
    req.on('timeout', () => {
      req.destroy();
      done(new Error('Asset upload timed out after 30 minutes'));
    });
    const readStream = fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 });
    const progressStream = new Transform({
      transform(chunk, _encoding, callback) {
        bytesSent += chunk.length;
        if (typeof onProgress === 'function') {
          try { onProgress(bytesSent, stat.size); } catch (_) {}
        }
        callback(null, chunk);
      },
    });
    const abort = () => {
      const error = Object.assign(new Error('Asset upload aborted'), { code: 'WORKER_ASSET_UPLOAD_ABORTED' });
      readStream.destroy(error); progressStream.destroy(error); req.destroy(error); done(error);
    };
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    pipeline(readStream, progressStream, req).then(
      () => {},
      (err) => {
        readStream.destroy();
        progressStream.destroy();
        done(err);
      },
    );
  });
}

async function createAiJob(node, params) {
  const url = nodeUrl(node, '/api/v1/ai/jobs');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(node), 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Worker createAiJob failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

async function getAiJobStatus(node, jobId) {
  const url = nodeUrl(node, `/api/v1/ai/jobs/${encodeURIComponent(jobId)}`);
  const res = await fetch(url, { method: 'GET', headers: authHeaders(node) });
  const body = await res.json();
  if (!res.ok) throw new Error(`Worker getAiJobStatus failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

async function createReferenceFace(node, params) {
  const url = nodeUrl(node, '/api/v1/ai/reference-face');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(node), 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Worker createReferenceFace failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

/**
 * GET /api/v1/jobs/:id — get job status and progress.
 */
async function getJobStatus(node, jobId) {
  const url = nodeUrl(node, `/api/v1/jobs/${encodeURIComponent(jobId)}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(node),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`Worker getJobStatus failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

/**
 * GET /api/v1/jobs/:id/output — download output file to destPath with progress.
 *
 * Uses Readable.fromWeb + pipeline so the network stream is piped to disk
 * with proper backpressure — memory stays flat regardless of file size.
 */
async function downloadOutput(node, jobId, destPath, onProgress) {
  const url = nodeUrl(node, `/api/v1/jobs/${encodeURIComponent(jobId)}/output`);

  const t = createTimeout(10 * 60 * 1000); // 10 min download timeout

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(node),
      signal: t ? t.controller.signal : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Download timed out after 10 minutes');
    throw err;
  } finally {
    clearTimeoutObj(t);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`Worker downloadOutput failed (${res.status}): ${errBody.error?.message || 'unknown'}`);
  }

  const contentLength = parseInt(String(res.headers.get('content-length') || '0'), 10);
  let bytesRead = 0;

  // Convert Web ReadableStream (fetch body) to Node.js Readable for pipeline
  const nodeStream = Readable.fromWeb(res.body);
  const ws = fs.createWriteStream(destPath);

  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      bytesRead += chunk.length;
      if (typeof onProgress === 'function' && contentLength > 0) {
        try { onProgress(bytesRead, contentLength); } catch (_) { /* fire-and-forget */ }
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(nodeStream, progressStream, ws);
  } catch (err) {
    await fs.promises.unlink(destPath).catch(() => {});
    throw err;
  }

  if (contentLength > 0 && bytesRead !== contentLength) {
    await fs.promises.unlink(destPath).catch(() => {});
    throw new Error(`Incomplete download: received ${bytesRead}, expected ${contentLength}`);
  }

  return { bytesReceived: bytesRead };
}

/**
 * DELETE /api/v1/jobs/:id — cancel job and cleanup worker temp files.
 */
async function deleteJob(node, jobId) {
  const url = nodeUrl(node, `/api/v1/jobs/${encodeURIComponent(jobId)}`);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(node),
  });

  // 404 means already cleaned up — not an error
  if (res.status === 404) return { ok: true };

  const body = await res.json();
  if (!res.ok) throw new Error(`Worker deleteJob failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

/**
 * GET /api/v1/capabilities — probe worker GPU devices.
 */
async function getCapabilities(node) {
  const url = nodeUrl(node, '/api/v1/capabilities');

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(node),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`Worker getCapabilities failed (${res.status}): ${body.error?.message || 'unknown'}`);
  return body;
}

/**
 * GET /api/v1/health — check worker health.
 */
async function checkHealth(node) {
  const url = nodeUrl(node, '/api/v1/health');

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(node),
  });

  const body = await res.json();
  return { ok: res.ok && body.ok, ...body };
}

module.exports = {
  createJob, uploadSource, getJobStatus, downloadOutput, deleteJob,
  createAsset, uploadAssetSource, createAiJob, getAiJobStatus, createReferenceFace,
  getCapabilities, checkHealth,
};
