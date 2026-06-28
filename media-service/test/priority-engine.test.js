'use strict';

// Tests for PriorityEngine — initial task priority computation.
// Lower number = runs first. See priorityEngine.js for the evaluation contract.

const test = require('node:test');
const assert = require('node:assert');
const pe = require('../src/priorityEngine');

function config({ manualTaskPriority, autoTaskPriorityBase, rules, subLibraries } = {}) {
  return {
    taskPriority: {
      manualTaskPriority: manualTaskPriority ?? 0,
      autoTaskPriorityBase: autoTaskPriorityBase ?? 100,
      rules: rules || { transcode: [], upgrade: [], delete: [], scrape: [] },
    },
    subLibraries: subLibraries || [],
  };
}

test('manual tasks add source, action, and library dimensions', () => {
  const c = config();
  c.taskPriority.actionTypeWeights = { transcode: 130 };
  const p = pe.computePriority({ source: 'manual', actionType: 'transcode', itemInfo: {}, config: c });
  assert.strictEqual(p, 230);
});

test('auto tasks add source and default library dimensions when no action weight exists', () => {
  const c = config();
  const p = pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: {}, config: c });
  assert.strictEqual(p, 200);
});

test('actionTypeWeights add per-action dimensions', () => {
  const c = config();
  c.taskPriority.actionTypeWeights = { ingest: 60, scrape: 80, transcode: 130 };
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'ingest', itemInfo: {}, config: c }), 260);
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'scrape', itemInfo: {}, config: c }), 280);
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: {}, config: c }), 330);
});

test('neutral library weight is still additive and does not erase actionType order', () => {
  const c = config({ subLibraries: [{ uuid: 'movie-lib', priorityWeight: 100 }] });
  c.taskPriority.actionTypeWeights = { ingest: 60, scrape: 80, transcode: 130 };

  assert.strictEqual(pe.computePriority({
    source: 'auto',
    actionType: 'transcode',
    itemInfo: { subLibraryId: 'movie-lib' },
    config: c,
  }), 330);
});

test('library weight is added as an independent dimension', () => {
  const subLibs = [{ uuid: 'film', priorityWeight: 10 }, { uuid: 'series', priorityWeight: 50 }];
  const c = config({ subLibraries: subLibs });
  c.taskPriority.actionTypeWeights = { transcode: 130 };

  const filmAuto = pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { subLibraryId: 'film' }, config: c });
  const seriesAuto = pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { subLibraryId: 'series' }, config: c });
  assert.strictEqual(filmAuto, 240, 'film library (weight 10) should outrank series (weight 50)');
  assert.strictEqual(seriesAuto, 280);
  assert.ok(filmAuto < seriesAuto, 'film auto task should have smaller priority value');

  const filmManual = pe.computePriority({ source: 'manual', actionType: 'transcode', itemInfo: { subLibraryId: 'film' }, config: c });
  assert.strictEqual(filmManual, 140, 'manual source weight still participates in the same additive formula');
});

test('library weight larger than default can defer a lower-priority library', () => {
  const subLibs = [{ uuid: 'low', priorityWeight: 999 }];
  const c = config({ autoTaskPriorityBase: 100, subLibraries: subLibs });
  const p = pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { subLibraryId: 'low' }, config: c });
  assert.strictEqual(p, 1099, 'a larger library weight adds delay instead of being ignored');
});

test('rules are actionType-isolated', () => {
  const c = config({
    rules: {
      transcode: [{ match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 5 } }],
      upgrade: [],
    },
    subLibraries: [],
  });
  // A film transcode gets the subtract rule; a film upgrade does not.
  const tc = pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { subLibraryId: 'film' }, config: c });
  const up = pe.computePriority({ source: 'auto', actionType: 'upgrade', itemInfo: { subLibraryId: 'film' }, config: c });
  assert.strictEqual(tc, 195, 'transcode rule subtracts from the additive score');
  assert.strictEqual(up, 200, 'upgrade has no rules -> source + default library');
});

test('multiple rules apply in order, each adjusting the running value', () => {
  const c = config({
    rules: {
      transcode: [
        { match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 50 } }, // 200 - 50 = 150
        { match: { type: 'season' }, adjust: { op: 'add', value: 20 } },           // 150 + 20 = 170
        { match: { isDiscLike: true }, adjust: { op: 'set', value: 200 } },        // 200 (absolute)
        { match: { isDolbyVision: true }, adjust: { op: 'subtract', value: 10 } }, // does NOT match -> 200
      ],
    },
    subLibraries: [],
  });
  const p = pe.computePriority({
    source: 'auto', actionType: 'transcode',
    itemInfo: { subLibraryId: 'film', type: 'season', isDiscLike: true, isDolbyVision: false },
    config: c,
  });
  assert.strictEqual(p, 200);
});

test('match is AND-combined; undefined fields do not constrain', () => {
  const c = config({
    rules: { transcode: [{ match: { subLibraryId: 'film', type: 'movie' }, adjust: { op: 'subtract', value: 30 } }] },
    subLibraries: [],
  });
  // Both match -> apply
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { subLibraryId: 'film', type: 'movie' }, config: c }), 170);
  // Only one matches -> no apply
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { subLibraryId: 'film', type: 'season' }, config: c }), 200);
});

test('resolution match uses prefix semantics (4K deferral rule)', () => {
  const c = config({
    rules: { transcode: [{ match: { resolution: '3840' }, adjust: { op: 'add', value: 40 } }] },
    subLibraries: [],
  });
  // 4K (3840x2160) is deferred
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { resolution: '3840x2160' }, config: c }), 240);
  // 1080p unaffected
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: { resolution: '1920x1080' }, config: c }), 200);
});

test('result is clamped to >= 0 and rounded', () => {
  const c = config({
    rules: { transcode: [{ match: {}, adjust: { op: 'subtract', value: 250 } }] },
    subLibraries: [],
  });
  const p = pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: {}, config: c });
  assert.strictEqual(p, 0, 'priority never goes negative');
});

test('missing taskPriority config falls back to safe defaults', () => {
  // No taskPriority key at all
  const c = { subLibraries: [] };
  assert.strictEqual(pe.computePriority({ source: 'manual', actionType: 'transcode', itemInfo: {}, config: c }), 100);
  assert.strictEqual(pe.computePriority({ source: 'auto', actionType: 'transcode', itemInfo: {}, config: c }), 200);
});

test('_applyAdjust handles subtract / add / set and ignores invalid', () => {
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: 30 }), 70);
  assert.strictEqual(pe._applyAdjust(100, { op: 'add', value: 30 }), 130);
  assert.strictEqual(pe._applyAdjust(100, { op: 'set', value: 50 }), 50);
  assert.strictEqual(pe._applyAdjust(100, { op: 'unknown', value: 30 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: NaN }), 100);
  assert.strictEqual(pe._applyAdjust(100, null), 100);
});
