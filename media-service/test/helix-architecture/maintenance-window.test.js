'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMaintenanceWindow, DEFAULT_CONFIG, currentWindow } = require('../../src/clean-maintenance-window');

const at = time => Date.parse(time + '+08:00');
function fixture(time = '2026-10-24T02:59:59') {
  let now = at(time), desiredMode = 'running', drained = true, saved = null;
  const modes = [], store = { load: () => structuredClone(saved), save: value => { saved = structuredClone(value); } };
  const options = { store, now: () => now, desiredMode: () => desiredMode, isDrained: () => drained, setAdmission: mode => modes.push(mode) };
  return { create: () => createMaintenanceWindow(options), modes, now: time => { now = at(time); },
    stopped: value => { desiredMode = value ? 'stopped' : 'running'; }, drained: value => { drained = value; },
    record: () => structuredClone(saved), store };
}

test('uses the fixed Saturday 03:00–09:00 window and skips after a long normal operation instead of extending it', async () => {
  const f = fixture(), window = f.create();
  await window.tick(); assert.equal(window.normalSupplyAllowed(), true);
  f.drained(false); f.now('2026-10-24T03:00:00'); await window.tick();
  assert.equal(window.snapshot().phase, 'entering'); assert.equal(window.normalSupplyAllowed(), false);
  assert.equal(window.allows('maintenance'), false); assert.equal(window.allows('safety'), true);
  f.now('2026-10-24T03:15:00'); await window.tick();
  assert.equal(window.snapshot().maintenanceActive, false); assert.equal(window.normalSupplyAllowed(), true);
  f.drained(true); f.now('2026-10-24T04:00:00'); await window.tick();
  assert.equal(window.snapshot().maintenanceActive, false);
  f.now('2026-10-31T03:00:00'); await window.tick();
  assert.equal(window.snapshot().phase, 'maintaining');
});

test('stops new maintenance batches five minutes before the deadline and waits safely for the current scope', async () => {
  const f = fixture('2026-10-24T03:00:00'), window = f.create();
  await window.tick(); assert.equal(window.allows('maintenance'), true); assert.equal(window.allows('normal'), false);
  const finish = window.beginScope('维护人物资料');
  assert.equal(window.snapshot().currentTask, '维护人物资料');
  f.now('2026-10-24T08:55:00'); await window.tick();
  assert.equal(window.snapshot().phase, 'settling'); assert.equal(window.allows('maintenance'), false);
  f.now('2026-10-24T09:00:00'); await window.tick(); assert.equal(window.normalSupplyAllowed(), false);
  finish(); finish(); await window.tick();
  assert.equal(window.normalSupplyAllowed(), true);
  assert.deepEqual(Object.keys(window.snapshot()).sort(), ['currentTask', 'maintenanceActive', 'phase', 'windowEndAtMs']);
});

test('retains the fixed end time across restart and resumes only the remaining part of a maintenance window', async () => {
  const f = fixture('2026-10-24T03:00:00');
  await f.create().tick();
  f.now('2026-10-24T06:00:00'); f.drained(false);
  const restarted = f.create(); await restarted.tick();
  assert.equal(restarted.snapshot().phase, 'recovering');
  f.drained(true); await restarted.tick();
  assert.equal(restarted.snapshot().phase, 'maintaining');
  assert.equal(restarted.snapshot().windowEndAtMs, at('2026-10-24T09:00:00'));
  f.now('2026-10-24T09:10:00'); const outside = f.create(); await outside.tick(); await outside.tick();
  assert.equal(outside.snapshot().maintenanceActive, false); assert.equal(outside.normalSupplyAllowed(), true);
});

test('never resumes an operator stop and never reruns an interrupted window after the operator resumes', async () => {
  const f = fixture('2026-10-24T03:00:00'), window = f.create(); await window.tick();
  f.stopped(true); await window.tick(); assert.equal(window.normalSupplyAllowed(), false);
  const restarted = f.create(); await restarted.tick(); assert.equal(restarted.normalSupplyAllowed(), false);
  f.stopped(false); f.now('2026-10-24T04:00:00'); await restarted.tick();
  assert.equal(restarted.normalSupplyAllowed(), true); assert.equal(restarted.snapshot().maintenanceActive, false);
});

test('applies configuration at the next chosen window and persists idempotent results across later configuration and restart', async () => {
  const f = fixture('2026-10-24T03:00:00'), window = f.create(); await window.tick();
  const body = { expectedRevision: window.configuration().revision, idempotencyKey: 'change-1',
    settings: { weekday: 2, startTime: '10:00', endTime: '16:00', timeZone: 'Asia/Shanghai' } };
  const result = window.configure(body, 'admin');
  assert.deepEqual(window.configuration().settings, DEFAULT_CONFIG);
  assert.equal(window.snapshot().windowEndAtMs, at('2026-10-24T09:00:00'));
  assert.deepEqual(window.configure(body, 'admin'), result);
  assert.throws(() => window.configure({ ...body, settings: DEFAULT_CONFIG }, 'admin'), { code: 'MAINTENANCE_COMMAND_CONFLICT' });
  f.now('2026-10-24T09:00:00'); await window.tick(); await window.tick();
  f.now('2026-10-27T10:00:00'); const next = f.create(); await next.tick();
  assert.equal(next.snapshot().phase, 'maintaining'); assert.equal(next.snapshot().windowEndAtMs, at('2026-10-27T16:00:00'));
  next.configure({ expectedRevision: next.configuration().revision, idempotencyKey: 'change-2', settings: DEFAULT_CONFIG }, 'admin');
  assert.deepEqual(f.create().configure(body, 'admin'), result);
  assert.throws(() => next.configure({ ...body, idempotencyKey: 'stale' }, 'admin'), { code: 'MAINTENANCE_REVISION_CONFLICT' });
});

test('calculates overnight windows in the configured timezone independently of host timezone', () => {
  const settings = { ...DEFAULT_CONFIG, startTime: '23:00', endTime: '05:00' };
  const value = currentWindow(at('2026-10-25T02:00:00'), settings);
  assert.equal(value.startAtMs, at('2026-10-24T23:00:00'));
  assert.equal(value.endAtMs, at('2026-10-25T05:00:00'));
});

test('does not admit another batch when a deadline checkpoint fails', async () => {
  const f = fixture('2026-10-24T03:00:00'), window = f.create(); await window.tick();
  f.store.save = () => { throw new Error('disk full'); };
  f.now('2026-10-24T08:55:00'); await assert.rejects(window.tick(), /disk full/);
  assert.equal(window.allows('maintenance'), false);
});
