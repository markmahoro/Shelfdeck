'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');

const MAX_HTTP_SAMPLES = 20000;
const WINDOW_MS = 5 * 60 * 1000;
const EVENT_LOOP_SAMPLE_MS = 1000;
const httpSamples = [];
const eventLoopSamples = [];
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

function eventLoopValue(value) {
  const milliseconds = Number(value) / 1e6;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
}

function nowMs() {
  return Date.now();
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1))];
}

function pruneHttpSamples(now = nowMs()) {
  const cutoff = now - WINDOW_MS;
  while (httpSamples.length && httpSamples[0].at < cutoff) httpSamples.shift();
  if (httpSamples.length > MAX_HTTP_SAMPLES) httpSamples.splice(0, httpSamples.length - MAX_HTTP_SAMPLES);
}

function pruneEventLoopSamples(now = nowMs()) {
  const cutoff = now - WINDOW_MS;
  while (eventLoopSamples.length && eventLoopSamples[0].at < cutoff) eventLoopSamples.shift();
}

function sampleEventLoop() {
  eventLoopSamples.push({
    at: nowMs(),
    p95Ms: eventLoopValue(eventLoop.percentile(95)),
    p99Ms: eventLoopValue(eventLoop.percentile(99)),
    maxMs: eventLoopValue(eventLoop.max),
  });
  eventLoop.reset();
  pruneEventLoopSamples();
}

const eventLoopSampler = setInterval(sampleEventLoop, EVENT_LOOP_SAMPLE_MS);
eventLoopSampler.unref();

function recordHttp(input = {}) {
  const durationMs = Number(input.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  httpSamples.push({
    at: nowMs(),
    durationMs,
    method: String(input.method || ''),
    route: String(input.route || ''),
    statusCode: Number(input.statusCode) || 0,
  });
  pruneHttpSamples();
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch (_) { return 0; }
}

function storageSnapshot() {
  const dataDir = process.env.CONTROL_PLANE_DATA_DIR || process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data');
  return {
    dataDir,
    libraryDbBytes: fileSize(path.join(dataDir, 'library.db')),
    libraryWalBytes: fileSize(path.join(dataDir, 'library.db-wal')),
    tasksDbBytes: fileSize(path.join(dataDir, 'tasks.db')),
    tasksWalBytes: fileSize(path.join(dataDir, 'tasks.db-wal')),
  };
}

function snapshot() {
  pruneHttpSamples();
  pruneEventLoopSamples();
  const durations = httpSamples.map((sample) => sample.durationMs);
  const memory = process.memoryUsage();
  return {
    sampledAt: new Date().toISOString(),
    processUptimeSeconds: process.uptime(),
    http: {
      windowSeconds: WINDOW_MS / 1000,
      samples: durations.length,
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      maxMs: durations.length ? Math.max(...durations) : 0,
      errors: httpSamples.filter((sample) => sample.statusCode >= 500).length,
    },
    eventLoop: {
      windowSeconds: WINDOW_MS / 1000,
      samples: eventLoopSamples.length,
      p95Ms: percentile(eventLoopSamples.map((sample) => sample.p95Ms), 0.95),
      p99Ms: percentile(eventLoopSamples.map((sample) => sample.p99Ms), 0.99),
      maxMs: eventLoopSamples.length ? Math.max(...eventLoopSamples.map((sample) => sample.maxMs)) : 0,
    },
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    storage: storageSnapshot(),
  };
}

function resetForTests() {
  httpSamples.splice(0, httpSamples.length);
  eventLoopSamples.splice(0, eventLoopSamples.length);
  eventLoop.reset();
}

module.exports = { recordHttp, snapshot, resetForTests };
