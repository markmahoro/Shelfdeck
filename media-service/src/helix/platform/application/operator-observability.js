'use strict';

const { monitorEventLoopDelay } = require('node:perf_hooks');

/**
 * Low-overhead Operator Maintenance Suite observability.
 *
 * Always-on: one compact structured HTTP access event per Admin/API request
 * (method, route, status, durationMs, correlationId). No body dumps.
 *
 * Optional: threshold-only event-loop lag samples (rate-limited). Deeper debug
 * is switchable and must not be required to catch basic stalls.
 */

const DEFAULT_LAG_THRESHOLD_MS = 500;
const DEFAULT_LAG_CHECK_MS = 2000;
const DEFAULT_LAG_MIN_EMIT_INTERVAL_MS = 10_000;
const DEBUG_LAG_THRESHOLD_MS = 100;
const DEBUG_LAG_CHECK_MS = 1000;
const MAX_ERROR_MESSAGE_CHARS = 200;

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function truncateMessage(value) {
  const text = String(value == null ? '' : value);
  if (text.length <= MAX_ERROR_MESSAGE_CHARS) return text;
  return text.slice(0, MAX_ERROR_MESSAGE_CHARS);
}

function defaultEmit(level, payload) {
  const writer = level === 'error' ? console.error : console.log;
  // Single short structured emit; logger (when loaded) already owns disk append.
  writer('[shelfdeck]', payload.kind, payload);
}

function resolveConfig(options = {}, env = process.env) {
  const debug = options.debug === true
    || String(env.SHELFDECK_OPERATOR_OBSERVABILITY_DEBUG || '').trim() === '1';
  const requestMetricsEnabled = options.requestMetricsEnabled !== false;
  const eventLoopLagEnabled = options.eventLoopLagEnabled !== false;
  const lagThresholdMs = positiveNumber(
    options.eventLoopLagThresholdMs ?? env.SHELFDECK_OPERATOR_OBSERVABILITY_EVENT_LOOP_THRESHOLD_MS,
    debug ? DEBUG_LAG_THRESHOLD_MS : DEFAULT_LAG_THRESHOLD_MS,
  );
  const lagCheckMs = positiveNumber(
    options.eventLoopLagCheckMs,
    debug ? DEBUG_LAG_CHECK_MS : DEFAULT_LAG_CHECK_MS,
  );
  const lagMinEmitIntervalMs = positiveNumber(
    options.eventLoopLagMinEmitIntervalMs,
    DEFAULT_LAG_MIN_EMIT_INTERVAL_MS,
  );
  return Object.freeze({
    debug,
    requestMetricsEnabled,
    eventLoopLagEnabled,
    lagThresholdMs,
    lagCheckMs,
    lagMinEmitIntervalMs,
  });
}

function createOperatorObservability(options = {}) {
  const env = options.env || process.env;
  const config = resolveConfig(options, env);
  const emit = typeof options.emit === 'function' ? options.emit : defaultEmit;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const createMonitor = typeof options.createEventLoopMonitor === 'function'
    ? options.createEventLoopMonitor
    : () => monitorEventLoopDelay({ resolution: 20 });

  let closed = false;
  let lagMonitor = null;
  let lagTimer = null;
  let lastLagEmitAtMs = 0;
  let lagEmitCount = 0;
  let requestEmitCount = 0;
  let errorEmitCount = 0;

  function recordRequest(input = {}) {
    if (closed || !config.requestMetricsEnabled) return;
    const durationMs = Number(input.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    // O(1) hot path: fixed small object, no JSON.stringify of request bodies.
    const payload = {
      kind: 'operator.http',
      method: String(input.method || ''),
      route: String(input.route || input.path || ''),
      status: Number(input.status) || 0,
      durationMs: Math.round(durationMs),
      correlationId: String(input.correlationId || ''),
    };
    if (input.errorCode) payload.errorCode = String(input.errorCode);
    if (config.debug) payload.debug = true;
    requestEmitCount += 1;
    emit('info', payload);
  }

  function onRequestError(error, meta = {}) {
    if (closed) return;
    const payload = {
      kind: 'operator.http.error',
      method: String(meta.method || ''),
      route: String(meta.route || meta.path || ''),
      correlationId: String(meta.correlationId || ''),
      errorCode: String(error?.code || 'CLEAN_SERVICE_INTERNAL_ERROR'),
      message: truncateMessage(error?.message || 'request failed'),
    };
    if (config.debug) payload.debug = true;
    errorEmitCount += 1;
    emit('error', payload);
  }

  function sampleEventLoopLag() {
    if (closed || !lagMonitor) return;
    const maxMs = Number(lagMonitor.max) / 1e6;
    const meanMs = Number(lagMonitor.mean) / 1e6;
    lagMonitor.reset();
    if (!Number.isFinite(maxMs) || maxMs < config.lagThresholdMs) return;
    const at = now();
    if (at - lastLagEmitAtMs < config.lagMinEmitIntervalMs) return;
    lastLagEmitAtMs = at;
    lagEmitCount += 1;
    const payload = {
      kind: 'operator.event_loop_lag',
      maxMs: Math.round(maxMs),
      meanMs: Math.round(meanMs),
      thresholdMs: config.lagThresholdMs,
    };
    if (config.debug) payload.debug = true;
    emit('warn', payload);
  }

  if (config.eventLoopLagEnabled) {
    lagMonitor = createMonitor();
    if (lagMonitor && typeof lagMonitor.enable === 'function') lagMonitor.enable();
    lagTimer = setInterval(sampleEventLoopLag, config.lagCheckMs);
    if (typeof lagTimer.unref === 'function') lagTimer.unref();
  }

  function status() {
    return Object.freeze({
      schemaRef: 'platform.operator-observability-status@1',
      requestMetrics: Object.freeze({
        enabled: config.requestMetricsEnabled,
        mode: 'always-on',
        emitted: requestEmitCount,
        errorsEmitted: errorEmitCount,
      }),
      eventLoopLag: Object.freeze({
        enabled: config.eventLoopLagEnabled,
        thresholdMs: config.lagThresholdMs,
        checkIntervalMs: config.lagCheckMs,
        minEmitIntervalMs: config.lagMinEmitIntervalMs,
        emitted: lagEmitCount,
      }),
      debug: Object.freeze({
        enabled: config.debug,
        env: 'SHELFDECK_OPERATOR_OBSERVABILITY_DEBUG',
        enableValue: '1',
      }),
    });
  }

  function close() {
    closed = true;
    if (lagTimer) {
      clearInterval(lagTimer);
      lagTimer = null;
    }
    if (lagMonitor && typeof lagMonitor.disable === 'function') {
      try { lagMonitor.disable(); } catch { /* ignore */ }
    }
    lagMonitor = null;
  }

  return Object.freeze({
    recordRequest,
    onRequestError,
    status,
    close,
    config,
  });
}

module.exports = Object.freeze({
  createOperatorObservability,
  resolveConfig,
  DEFAULT_LAG_THRESHOLD_MS,
  DEFAULT_LAG_CHECK_MS,
  DEFAULT_LAG_MIN_EMIT_INTERVAL_MS,
});
