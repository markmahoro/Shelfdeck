'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PERIOD_MS,
  MIN_PERIOD_MS,
  createPerceptionAcquisitionAutomation,
} = require('../../src/helix/domains/perception/application/perception-acquisition-automation');

function acquisition(overrides = {}) {
  return Object.freeze({
    perceptionAcquisitionId: overrides.perceptionAcquisitionId || 'acq-1',
    perceptionSourceId: overrides.perceptionSourceId || 'douban-user',
    state: overrides.state || 'completed',
    createdAtMs: overrides.createdAtMs || 1,
    terminalAtMs: Object.hasOwn(overrides, 'terminalAtMs') ? overrides.terminalAtMs : 1,
  });
}

function createHarness(overrides = {}) {
  let nowMs = overrides.nowMs || 1_800_000_000_000;
  const issued = [];
  const automation = createPerceptionAcquisitionAutomation({
    now: () => nowMs,
    periodMs: overrides.periodMs,
    readDoubanSourceConfiguration: () => (Object.hasOwn(overrides, 'config') ? overrides.config : Object.freeze({
      sourceId: 'douban-user',
      integrationId: 'douban',
      configRevision: 1,
    })),
    listAcquisitions: () => overrides.acquisitions || [],
    requestAcquisition(command) {
      issued.push(command);
      return Object.freeze({ operationRef: 'acq-new', state: 'accepted', sourceKind: 'douban' });
    },
  });
  return Object.freeze({
    automation,
    issued,
    advance(ms) { nowMs += ms; },
  });
}

test('issues a due Douban Acquisition immediately, then waits 24 hours', () => {
  const harness = createHarness({
    acquisitions: [acquisition({ terminalAtMs: 1 })],
  });
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['douban-user']);
  assert.equal(harness.automation.reconcile({ sourceId: 'douban-user' }).kind, 'issued');
  assert.match(harness.issued[0].idempotencyKey, /^periodic-douban-acquisition:/);
  assert.equal(PERIOD_MS, 24 * 60 * 60 * 1000);
  assert.equal(MIN_PERIOD_MS, 6 * 60 * 60 * 1000);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }), []);
  harness.advance(PERIOD_MS - 1);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }), []);
  harness.advance(1);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['douban-user']);
});

test('does not re-issue while an Acquisition is active or the last completed round is still fresh', () => {
  const active = createHarness({
    acquisitions: [acquisition({ state: 'active', terminalAtMs: null })],
  });
  assert.equal(active.automation.reconcile({ sourceId: 'douban-user' }).kind, 'in_progress');
  assert.equal(active.issued.length, 0);

  const recent = createHarness({
    nowMs: 1_800_000_000_000,
    acquisitions: [acquisition({ terminalAtMs: 1_800_000_000_000 - 60 * 60 * 1000 })],
  });
  assert.equal(recent.automation.reconcile({ sourceId: 'douban-user' }).kind, 'not_due');
  assert.equal(recent.issued.length, 0);
});

test('a failed round advances periodic idempotency lineage instead of replaying the failed Acquisition', () => {
  const failed = acquisition({ perceptionAcquisitionId:'acq-failed', state:'failed', terminalAtMs:1 });
  const harness = createHarness({ acquisitions:[failed] });
  assert.equal(harness.automation.reconcile({ sourceId:'douban-user' }).kind, 'issued');
  assert.match(harness.issued[0].idempotencyKey, /:after-acq-failed$/);
});

test('never-acquired Douban connections still enter the first sweep while the 24-hour gate is closed', () => {
  const harness = createHarness();
  harness.automation.listPage({ cursor: null, limit: 100 });
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['douban-user']);
});

test('unconfigured Douban connections are skipped', () => {
  const harness = createHarness({ config: null });
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }), []);
  assert.equal(harness.automation.reconcile({ sourceId: 'douban-user' }).kind, 'not_configured');
});

test('period cannot be shortened below the 6-hour Beta floor', () => {
  const harness = createHarness({ periodMs: 60 * 1000 });
  assert.equal(harness.automation.periodMs, MIN_PERIOD_MS);
});

test('Acquisition provider failures use the bounded 30-second and 2-minute retry policy', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js',
  ), 'utf8');
  assert.match(source, /perception-provider-observation\/v1'[\s\S]*?maxFailureAttempts:\s*3[\s\S]*?backoffMs:\s*\[30_000,\s*120_000\]/);
  assert.match(source, /capabilityRef === 'perception\.source\.acquire@1'\s*\? retryPolicies\[1\]\.ref/);
});
