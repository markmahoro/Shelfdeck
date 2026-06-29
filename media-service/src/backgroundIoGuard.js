'use strict';

const crypto = require('crypto');
const diagnosticLog = require('./diagnosticLog');

const DEFAULT_RECENT_LIMIT = 80;
const activeByLock = new Map();
const recent = [];
let skippedCount = 0;
let completedCount = 0;
let failedCount = 0;

function nowMs() {
  return Date.now();
}

function cleanText(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function cleanObject(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || typeof raw === 'function') continue;
    out[key] = raw;
  }
  return out;
}

function compactOperation(op, endedAtMs) {
  const end = Number.isFinite(endedAtMs) ? endedAtMs : null;
  return {
    operationId: op.operationId,
    operation: op.operation,
    component: op.component,
    lockKey: op.lockKey,
    resourceType: op.resourceType,
    resourceKey: op.resourceKey,
    source: op.source,
    status: op.status,
    startedAt: op.startedAt,
    endedAt: end ? new Date(end).toISOString() : null,
    durationMs: Math.max(0, (end || nowMs()) - op.startedAtMs),
    payload: cleanObject(op.payload),
  };
}

function pushRecent(op, endedAtMs) {
  recent.unshift(compactOperation(op, endedAtMs));
  if (recent.length > DEFAULT_RECENT_LIMIT) recent.splice(DEFAULT_RECENT_LIMIT);
}

function recordDiagnostic(op, status, payload = {}, endedAtMs = nowMs()) {
  diagnosticLog.record({
    category: 'background_io',
    scope: 'backgroundIoGuard.operation',
    operation: op.operation,
    component: op.component,
    resourceType: op.resourceType,
    resourceKey: op.resourceKey,
    status,
    startedAtMs: op.startedAtMs,
    endedAtMs,
    slowMs: Number(op.slowMs) > 0 ? Number(op.slowMs) : 500,
    payload: {
      operationId: op.operationId,
      lockKey: op.lockKey,
      source: op.source,
      ...cleanObject(op.payload),
      ...cleanObject(payload),
    },
  });
}

function normalizeOperation(input = {}) {
  const operation = cleanText(input.operation, 'background.operation');
  const component = cleanText(input.component, 'service');
  const lockKey = cleanText(input.lockKey, 'background_io');
  const resourceType = cleanText(input.resourceType, 'background_io');
  const resourceKey = cleanText(input.resourceKey, lockKey);
  const startedAtMs = nowMs();
  return {
    operationId: cleanText(input.operationId, crypto.randomUUID()),
    operation,
    component,
    lockKey,
    resourceType,
    resourceKey,
    source: cleanText(input.source, 'background'),
    status: 'running',
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    slowMs: input.slowMs,
    payload: cleanObject(input.payload),
  };
}

function tryStart(input = {}) {
  const op = normalizeOperation(input);
  const active = activeByLock.get(op.lockKey);
  if (active) {
    skippedCount += 1;
    const skipped = {
      ...op,
      status: 'skipped',
      payload: {
        ...op.payload,
        reason: 'lock_busy',
        activeOperationId: active.operationId,
        activeOperation: active.operation,
        activeStartedAt: active.startedAt,
      },
    };
    const endedAtMs = nowMs();
    pushRecent(skipped, endedAtMs);
    recordDiagnostic(skipped, 'skipped', skipped.payload, endedAtMs);
    return {
      started: false,
      reason: 'lock_busy',
      activeOperation: compactOperation(active),
      skippedOperation: compactOperation(skipped, endedAtMs),
    };
  }

  activeByLock.set(op.lockKey, op);
  return {
    started: true,
    operation: compactOperation(op),
    finish(status = 'done', payload = {}) {
      if (activeByLock.get(op.lockKey) === op) activeByLock.delete(op.lockKey);
      const finalStatus = cleanText(status, 'done');
      if (finalStatus === 'failed') failedCount += 1;
      else completedCount += 1;
      op.status = finalStatus;
      op.payload = { ...op.payload, ...cleanObject(payload) };
      const endedAtMs = nowMs();
      pushRecent(op, endedAtMs);
      recordDiagnostic(op, finalStatus, payload, endedAtMs);
      return compactOperation(op, endedAtMs);
    },
  };
}

function runExclusive(input = {}, fn, opts = {}) {
  const started = tryStart(input);
  if (!started.started) {
    if (typeof opts.onSkipped === 'function') return opts.onSkipped(started);
    return opts.skippedValue;
  }

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then((value) => {
        started.finish('done', typeof opts.successPayload === 'function' ? opts.successPayload(value) : {});
        return value;
      }).catch((err) => {
        started.finish('failed', { error: err && err.message ? err.message : String(err) });
        throw err;
      });
    }
    started.finish('done', typeof opts.successPayload === 'function' ? opts.successPayload(result) : {});
    return result;
  } catch (err) {
    started.finish('failed', { error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

function getState(opts = {}) {
  const limit = Number(opts.recentLimit) >= 0 ? Number(opts.recentLimit) : 20;
  const active = [...activeByLock.values()].map((op) => compactOperation(op));
  return {
    kind: 'metric',
    category: 'background_io',
    generatedAt: new Date().toISOString(),
    active,
    recent: recent.slice(0, limit),
    summary: {
      activeCount: active.length,
      runningHeavyIo: active.length > 0,
      skippedCount,
      completedCount,
      failedCount,
    },
  };
}

function resetForTests() {
  activeByLock.clear();
  recent.splice(0);
  skippedCount = 0;
  completedCount = 0;
  failedCount = 0;
}

module.exports = {
  getState,
  resetForTests,
  runExclusive,
  tryStart,
};
