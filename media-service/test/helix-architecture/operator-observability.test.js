'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createOperatorObservability,
  DEFAULT_LAG_THRESHOLD_MS,
  DEFAULT_LAG_MIN_EMIT_INTERVAL_MS,
} = require('../../src/helix/platform/application/operator-observability');
const { createOperatorMaintenance } = require('../../src/helix/platform/application/operator-maintenance');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');

test('always-on recordRequest emits one compact duration event without body fields', () => {
  const events = [];
  const obs = createOperatorObservability({
    emit: (_level, payload) => events.push(payload),
    eventLoopLagEnabled: false,
    env: {},
  });
  try {
    obs.recordRequest({
      method: 'GET',
      route: '/v1/admin/formation',
      status: 200,
      durationMs: 12.6,
      correlationId: 'cid-1',
      body: { huge: 'should-not-appear' },
      responseBody: { also: 'no' },
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      kind: 'operator.http',
      method: 'GET',
      route: '/v1/admin/formation',
      status: 200,
      durationMs: 13,
      correlationId: 'cid-1',
    });
    assert.equal('body' in events[0], false);
    assert.equal('responseBody' in events[0], false);
    assert.equal(obs.status().requestMetrics.emitted, 1);

    obs.onRequestError(
      Object.assign(new Error('formation history integrity'), { code: 'FORMATION_RETIREMENT_HISTORY_INTEGRITY' }),
      { method: 'GET', route: '/v1/admin/formation', correlationId: 'cid-err' },
    );
    assert.equal(events[1].kind, 'operator.http.error');
    assert.equal(events[1].errorCode, 'FORMATION_RETIREMENT_HISTORY_INTEGRITY');
    assert.equal(events[1].correlationId, 'cid-err');
    assert.equal(obs.status().requestMetrics.errorsEmitted, 1);
  } finally {
    obs.close();
  }
});

test('debug-off event-loop path does not flood below threshold', async () => {
  const events = [];
  let maxNs = 10e6; // 10ms << 500ms default
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const obs = createOperatorObservability({
    emit: (_level, payload) => events.push(payload),
    env: {},
    eventLoopLagCheckMs: 20,
    eventLoopLagMinEmitIntervalMs: 50,
    createEventLoopMonitor: () => ({
      enable() {},
      disable() {},
      reset() {},
      get max() { return maxNs; },
      get mean() { return maxNs / 2; },
    }),
  });
  try {
    assert.equal(obs.config.debug, false);
    assert.equal(obs.config.lagThresholdMs, DEFAULT_LAG_THRESHOLD_MS);
    await sleep(70);
    assert.equal(events.filter((e) => e.kind === 'operator.event_loop_lag').length, 0);

    maxNs = 800e6; // 800ms
    await sleep(90);
    const lagEvents = events.filter((e) => e.kind === 'operator.event_loop_lag');
    assert.ok(lagEvents.length >= 1);
    assert.equal(lagEvents[0].thresholdMs, DEFAULT_LAG_THRESHOLD_MS);
    assert.ok(lagEvents[0].maxMs >= 500);
    // Rate limit still applies even when over threshold.
    const before = lagEvents.length;
    await sleep(30);
    assert.ok(
      events.filter((e) => e.kind === 'operator.event_loop_lag').length === before,
      'lag emits must stay rate-limited within min interval',
    );
  } finally {
    obs.close();
  }
});

test('recordRequest hot path does not stringify large objects or touch disk', () => {
  const events = [];
  const huge = { nest: [] };
  for (let i = 0; i < 5000; i += 1) huge.nest.push({ i, blob: 'x'.repeat(200) });

  const stringifyCalls = [];
  const original = JSON.stringify;
  JSON.stringify = function patched(...args) {
    stringifyCalls.push(args[0]);
    return original.apply(this, args);
  };
  const obs = createOperatorObservability({
    emit: (_level, payload) => events.push(payload),
    eventLoopLagEnabled: false,
    env: {},
  });
  try {
    const started = process.hrtime.bigint();
    for (let i = 0; i < 200; i += 1) {
      obs.recordRequest({
        method: 'GET',
        route: '/v1/health',
        status: 200,
        durationMs: i,
        correlationId: `c-${i}`,
        // Deliberately pass a huge unused field; instrumentation must ignore it.
        unusedPayload: huge,
      });
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(events.length, 200);
    assert.equal(stringifyCalls.some((value) => value === huge || value?.unusedPayload === huge), false);
    // Loose ceiling: 200 O(1) emits must stay far below any sync-heavy budget.
    assert.ok(elapsedMs < 250, `expected cheap hot path, took ${elapsedMs}ms`);
  } finally {
    JSON.stringify = original;
    obs.close();
  }
});

test('maintenance catalog exposes read-only observability status without new actions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-obs-catalog-'));
  try {
    const events = [];
    const obs = createOperatorObservability({
      emit: (_level, payload) => events.push(payload),
      eventLoopLagEnabled: false,
      env: {},
    });
    const maintenance = createOperatorMaintenance({
      dataDir: root,
      databasePath: path.join(root, 'shelfdeck.db'),
      Database: require('better-sqlite3'),
      runtimeMode: () => 'running',
      observabilityStatus: () => obs.status(),
      actions: [],
    });
    const catalog = maintenance.list();
    assert.equal(catalog.schemaRef, 'platform.operator-maintenance-catalog@1');
    assert.equal(catalog.actions.length, 0);
    assert.equal(catalog.observability.schemaRef, 'platform.operator-observability-status@1');
    assert.equal(catalog.observability.requestMetrics.mode, 'always-on');
    assert.equal(catalog.observability.debug.enabled, false);
    assert.equal(catalog.observability.debug.env, 'SHELFDECK_OPERATOR_OBSERVABILITY_DEBUG');
    obs.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Clean Service Host always emits request duration for health and wires onRequestError', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-obs-host-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir);
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const secretRoot = 'operator-observability-host-secret-root-0123456789ab';
  const events = [];
  const requestErrors = [];
  const initialized = initializeCleanData({
    dataDir,
    secretRoot,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
  });
  const host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    operatorEventLoopLagEnabled: false,
    emitOperatorObservability: (_level, payload) => events.push(payload),
    onRequestError(error, meta) {
      requestErrors.push({ code: error.code, ...meta });
    },
  });
  try {
    const health = await host.inject({ method: 'GET', url: '/v1/health' });
    assert.equal(health.statusCode, 200);
    const httpEvents = events.filter((e) => e.kind === 'operator.http');
    assert.equal(httpEvents.length, 1);
    assert.equal(httpEvents[0].method, 'GET');
    assert.equal(httpEvents[0].route, '/v1/health');
    assert.equal(httpEvents[0].status, 200);
    assert.ok(Number.isFinite(httpEvents[0].durationMs));
    assert.ok(httpEvents[0].correlationId);

    const catalog = await host.inject({
      method: 'GET',
      url: '/v1/admin/runtime/operator-maintenance',
      headers: { 'x-api-key': initialized.adminApiKey },
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    const body = catalog.json();
    assert.equal(body.observability.schemaRef, 'platform.operator-observability-status@1');
    assert.ok(body.observability.requestMetrics.emitted >= 1);
    assert.ok(events.filter((e) => e.kind === 'operator.http').length >= 2);

    assert.equal(requestErrors.length, 0);
    assert.equal(DEFAULT_LAG_MIN_EMIT_INTERVAL_MS, 10_000);
  } finally {
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
