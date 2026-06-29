'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_LIMIT = 300;
const DEFAULT_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_SLOW_MS = 250;

const logs = [];

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value == null ? '' : value);
}

function cleanObject(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    if (typeof raw === 'function') continue;
    out[key] = raw;
  }
  return out;
}

function prune(opts = {}) {
  const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : DEFAULT_WINDOW_MS;
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : DEFAULT_LIMIT;
  const cutoff = nowMs() - maxAgeMs;
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entryTime = logs[i].endedAtMs || logs[i].startedAtMs || Date.parse(logs[i].endedAt || logs[i].startedAt || '');
    if (entryTime && entryTime < cutoff) logs.splice(i, 1);
  }
  if (logs.length > limit) logs.splice(limit);
}

function compact(entry) {
  return {
    id: entry.id,
    logId: entry.id,
    kind: 'diagnostic_log',
    category: entry.category,
    scope: entry.scope,
    operation: entry.operation,
    component: entry.component,
    resourceType: entry.resourceType,
    resourceKey: entry.resourceKey,
    status: entry.status,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    durationMs: entry.durationMs,
    payload: cleanObject(entry.payload),
  };
}

function statusForDuration(durationMs, slowMs) {
  return durationMs >= slowMs ? 'slow' : 'done';
}

function record(input = {}) {
  prune();
  const endedAtMs = Number.isFinite(input.endedAtMs) ? input.endedAtMs : nowMs();
  const startedAtMs = Number.isFinite(input.startedAtMs) ? input.startedAtMs : endedAtMs;
  const durationMs = Math.max(0, Number.isFinite(input.durationMs) ? input.durationMs : endedAtMs - startedAtMs);
  const slowMs = Number(input.slowMs) > 0 ? Number(input.slowMs) : DEFAULT_SLOW_MS;
  const status = cleanText(input.status || statusForDuration(durationMs, slowMs));
  const entry = {
    id: cleanText(input.id || input.logId || crypto.randomUUID()),
    category: cleanText(input.category || 'system'),
    scope: cleanText(input.scope || input.name || 'diagnostic.operation'),
    operation: cleanText(input.operation || input.scope || input.name || 'operation'),
    component: cleanText(input.component || 'service'),
    resourceType: cleanText(input.resourceType || 'system'),
    resourceKey: cleanText(input.resourceKey || input.resourceType || 'system'),
    status,
    startedAt: input.startedAt || new Date(startedAtMs).toISOString(),
    startedAtMs,
    endedAt: input.endedAt || new Date(endedAtMs).toISOString(),
    endedAtMs,
    durationMs,
    payload: cleanObject(input.payload),
  };
  logs.unshift(compact(entry));
  prune();
  return logs[0];
}

function track(input = {}, fn) {
  const startedAtMs = nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  const slowMs = Number(input.slowMs) > 0 ? Number(input.slowMs) : DEFAULT_SLOW_MS;
  const successPayload = typeof input.successPayload === 'function'
    ? input.successPayload
    : (() => cleanObject(input.successPayload));

  const finish = (status, payload) => {
    const endedAtMs = nowMs();
    return record({
      ...input,
      status,
      startedAt,
      startedAtMs,
      endedAtMs,
      durationMs: endedAtMs - startedAtMs,
      slowMs,
      payload: {
        ...cleanObject(input.payload),
        ...cleanObject(payload),
      },
    });
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then((value) => {
        const durationMs = nowMs() - startedAtMs;
        finish(statusForDuration(durationMs, slowMs), successPayload(value));
        return value;
      }).catch((err) => {
        finish('failed', { error: err && err.message ? err.message : String(err) });
        throw err;
      });
    }
    const durationMs = nowMs() - startedAtMs;
    finish(statusForDuration(durationMs, slowMs), successPayload(result));
    return result;
  } catch (err) {
    finish('failed', { error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

function fileMetric(filePath, label) {
  const metric = {
    name: label || path.basename(filePath),
    path: filePath,
    exists: false,
    sizeBytes: 0,
    mtime: null,
  };
  try {
    const stat = fs.statSync(filePath);
    metric.exists = true;
    metric.sizeBytes = stat.size;
    metric.mtime = stat.mtime.toISOString();
  } catch (_) {}
  return metric;
}

function storageSnapshot(input = {}) {
  const dbPath = String(input.dbPath || '');
  const files = dbPath ? [
    fileMetric(dbPath, input.dbName || path.basename(dbPath)),
    fileMetric(`${dbPath}-wal`, `${input.dbName || path.basename(dbPath)}-wal`),
  ] : [];
  const dbFile = files[0] || { sizeBytes: 0 };
  const walFile = files[1] || { sizeBytes: 0 };
  return {
    kind: 'metric',
    category: 'storage',
    store: cleanText(input.store || input.dbName || 'store'),
    resourceType: 'sqlite',
    resourceKey: cleanText(input.resourceKey || input.dbName || path.basename(dbPath) || 'sqlite'),
    generatedAt: nowIso(),
    dbSizeBytes: dbFile.sizeBytes || 0,
    walSizeBytes: walFile.sizeBytes || 0,
    totalSizeBytes: files.reduce((sum, file) => sum + (file.sizeBytes || 0), 0),
    files,
  };
}

function list(opts = {}) {
  prune(opts);
  const limit = Number(opts.limit) >= 0 ? Number(opts.limit) : DEFAULT_LIMIT;
  const selected = logs.slice(0, limit);
  const byStatus = {};
  const byCategory = {};
  for (const entry of selected) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }
  return {
    logs: selected,
    summary: {
      totalLogs: selected.length,
      slowLogs: selected.filter((entry) => entry.status === 'slow').length,
      failedLogs: selected.filter((entry) => entry.status === 'failed').length,
      byStatus,
      byCategory,
      generatedAt: nowIso(),
    },
  };
}

function resetForTests() {
  logs.splice(0);
}

module.exports = {
  list,
  record,
  resetForTests,
  storageSnapshot,
  track,
};
