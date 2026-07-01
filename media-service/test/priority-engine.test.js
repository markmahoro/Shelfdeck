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
  c.taskPriority.operationKindWeights = { transcode: 130 };
  const p = pe.computePriority({ source: 'manual', operationKind: 'transcode', itemInfo: {}, config: c });
  assert.strictEqual(p, 230);
});

test('auto tasks add source and default library dimensions when no action weight exists', () => {
  const c = config();
  const p = pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: {}, config: c });
  assert.strictEqual(p, 200);
});

test('operationKindWeights add per-operation dimensions', () => {
  const c = config();
  c.taskPriority.operationKindWeights = { ingest: 60, scrape: 80, transcode: 130 };
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'ingest', itemInfo: {}, config: c }), 260);
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'scrape', itemInfo: {}, config: c }), 260);
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: {}, config: c }), 330);
});

test('neutral library weight is still additive and does not erase operationKind order', () => {
  const c = config({ subLibraries: [{ uuid: 'movie-lib', priorityWeight: 100 }] });
  c.taskPriority.operationKindWeights = { ingest: 60, scrape: 80, transcode: 130 };

  assert.strictEqual(pe.computePriority({
    source: 'auto',
    operationKind: 'transcode',
    itemInfo: { subLibraryId: 'movie-lib' },
    config: c,
  }), 330);
});

test('library weight is added as an independent dimension', () => {
  const subLibs = [{ uuid: 'film', priorityWeight: 10 }, { uuid: 'series', priorityWeight: 50 }];
  const c = config({ subLibraries: subLibs });
  c.taskPriority.operationKindWeights = { transcode: 130 };

  const filmAuto = pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { subLibraryId: 'film' }, config: c });
  const seriesAuto = pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { subLibraryId: 'series' }, config: c });
  assert.strictEqual(filmAuto, 240, 'film library (weight 10) should outrank series (weight 50)');
  assert.strictEqual(seriesAuto, 280);
  assert.ok(filmAuto < seriesAuto, 'film auto task should have smaller priority value');

  const filmManual = pe.computePriority({ source: 'manual', operationKind: 'transcode', itemInfo: { subLibraryId: 'film' }, config: c });
  assert.strictEqual(filmManual, 140, 'manual source weight still participates in the same additive formula');
});

test('library weight larger than default can defer a lower-priority library', () => {
  const subLibs = [{ uuid: 'low', priorityWeight: 999 }];
  const c = config({ autoTaskPriorityBase: 100, subLibraries: subLibs });
  const p = pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { subLibraryId: 'low' }, config: c });
  assert.strictEqual(p, 1099, 'a larger library weight adds delay instead of being ignored');
});

test('rules are operationKind-isolated', () => {
  const c = config({
    rules: {
      transcode: [{ match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 5 } }],
      upgrade: [],
    },
    subLibraries: [],
  });
  // A film transcode gets the subtract rule; a film upgrade does not.
  const tc = pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { subLibraryId: 'film' }, config: c });
  const up = pe.computePriority({ source: 'auto', operationKind: 'upgrade', itemInfo: { subLibraryId: 'film' }, config: c });
  assert.strictEqual(tc, 195, 'transcode rule subtracts from the additive score');
  assert.strictEqual(up, 200, 'upgrade has no rules -> source + default library');
});

test('multiple rules apply in order, each adjusting the running value', () => {
  const c = config({
    rules: {
      transcode: [
        { match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 50 } }, // 200 - 50 = 150
        { match: { type: 'season' }, adjust: { op: 'add', value: 20 } },           // 150 + 20 = 170
        { match: { isDolbyVision: true }, adjust: { op: 'subtract', value: 10 } }, // does NOT match -> 170
      ],
    },
    subLibraries: [],
  });
  const p = pe.computePriority({
    source: 'auto', operationKind: 'transcode',
    itemInfo: { subLibraryId: 'film', type: 'season', isDiscLike: true, isDolbyVision: false },
    config: c,
  });
  assert.strictEqual(p, 170);
});

test('legacy set adjustment is ignored so one rule cannot override additive dimensions', () => {
  const c = config({
    rules: {
      transcode: [
        { match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 50 } },
        { match: { type: 'season' }, adjust: { op: 'set', value: 999 } },
      ],
    },
  });
  const p = pe.computePriority({
    source: 'auto',
    operationKind: 'transcode',
    itemInfo: { subLibraryId: 'film', type: 'season' },
    config: c,
  });
  assert.strictEqual(p, 150);
});

test('explainPriority returns a stable additive breakdown', () => {
  const c = config({
    subLibraries: [{ uuid: 'film', priorityWeight: 10 }],
    rules: {
      transcode: [
        { match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 25 } },
      ],
    },
  });
  c.taskPriority.operationKindWeights = { transcode: 130 };

  const explained = pe.explainPriority({
    source: 'auto',
    operationKind: 'transcode',
    itemInfo: { subLibraryId: 'film' },
    config: c,
  });

  assert.strictEqual(explained.modelVersion, 'additive-v3');
  assert.strictEqual(explained.formula, 'source + operationKind + subLibrary + businessSignal + queueAge + retry + matchedRules');
  assert.strictEqual(explained.priority, 215);
  assert.deepStrictEqual(explained.dimensions.map((d) => d.value), [100, 130, 10, -25]);
});

test('explainTaskPriority uses Kairox target gate semantics', () => {
  const c = config({
    subLibraries: [{ uuid: 'film', priorityWeight: 10 }],
  });
  c.taskPriority.targetGateWeights = { ingest: 60, metadata: 80, optimize: 110, archive: 70 };
  c.taskPriority.optimizeOperationHints = { transcode: 20, upgrade: 0, delete: -20 };

  const explained = pe.explainTaskPriority({
    source: 'auto',
    taskTarget: {
      targetGate: 'optimize',
      gateObjective: { kind: 'reduce_bitrate' },
      operationHint: 'transcode',
    },
    itemInfo: { subLibraryId: 'film', equivalentBitrate: 12000, targetBitrate: 8000 },
    config: c,
  });

  assert.strictEqual(explained.modelVersion, 'kairox-task-creator-v1');
  assert.strictEqual(explained.formula, 'source + targetGate + optimizeOperationHint + subLibrary + businessSignal + queueAge + retry + matchedRules');
  assert.strictEqual(explained.targetGate, 'optimize');
  assert.strictEqual(explained.operationHint, 'transcode');
  assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['source', 'targetGate', 'optimizeOperationHint', 'subLibrary', 'businessSignal']);
  assert.strictEqual(explained.priority, 225);
});

test('explainTaskPriority maps operation weights without using flow plan', () => {
  const c = config();
  c.taskPriority.operationKindWeights = { scrape: 80, transcode: 130, upgrade: 110, delete: 90 };

  const explained = pe.explainTaskPriority({
    source: 'auto',
    taskTarget: {
      targetGate: 'metadata',
      gateObjective: { kind: 'metadata_complete' },
    },
    itemInfo: { scraped: false, adultMetadata: { scrapeStatus: 'pending' } },
    config: c,
    operationKind: 'scrape',
  });

  assert.strictEqual(explained.targetGate, 'metadata');
  assert.strictEqual(explained.dimensions.find((d) => d.key === 'targetGate').value, 80);
  assert.ok(!explained.dimensions.some((d) => d.key === 'operationKind'));
  assert.ok(!Object.prototype.hasOwnProperty.call(explained, 'flowPlan'));
});

test('adult workflow business signal keeps ingest and scrape ahead of transcode', () => {
  const c = config();
  c.taskPriority.operationKindWeights = { ingest: 60, scrape: 80, transcode: 130 };
  c.taskPriority.businessSignalWeights = { adultWorkflowBonus: 20, maxTranscodeSavingBonus: 30 };

  const ingest = pe.explainPriority({
    source: 'auto',
    operationKind: 'ingest',
    itemInfo: { source: 'adult_folder', mediaType: 'adult' },
    config: c,
  });
  const scrape = pe.explainPriority({
    source: 'auto',
    operationKind: 'scrape',
    itemInfo: { scraped: false, adultMetadata: { scrapeStatus: 'pending' } },
    config: c,
  });
  const transcode = pe.explainPriority({
    source: 'auto',
    operationKind: 'transcode',
    itemInfo: { equivalentBitrate: 12000, targetBitrate: 8000 },
    config: c,
  });

  assert.strictEqual(ingest.priority, 240);
  assert.strictEqual(scrape.priority, 260);
  assert.strictEqual(transcode.priority, 315);
  assert.ok(ingest.priority < scrape.priority);
  assert.ok(scrape.priority < transcode.priority);
});

test('queue age and retry are additive dynamic dimensions', () => {
  const c = config();
  c.taskPriority.operationKindWeights = { transcode: 130 };
  c.taskPriority.queueAgeStepMinutes = 60;
  c.taskPriority.queueAgeBonusPerStep = 2;
  c.taskPriority.maxQueueAgeBonus = 40;
  c.taskPriority.retryPenalty = 20;
  c.taskPriority.maxRetryPenalty = 80;

  const realNow = Date.now;
  Date.now = () => Date.parse('2026-06-29T12:00:00.000Z');
  try {
    const explained = pe.explainPriority({
      source: 'auto',
      operationKind: 'transcode',
      itemInfo: {},
      task: { createdAt: '2026-06-29T07:30:00.000Z', retryCount: 2 },
      config: c,
    });
    assert.strictEqual(explained.priority, 362);
    assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['source', 'operationKind', 'subLibrary', 'queueAge', 'retry']);
    assert.deepStrictEqual(explained.dimensions.map((d) => d.value), [100, 130, 100, -8, 40]);
  } finally {
    Date.now = realNow;
  }
});

test('match is AND-combined; undefined fields do not constrain', () => {
  const c = config({
    rules: { transcode: [{ match: { subLibraryId: 'film', type: 'movie' }, adjust: { op: 'subtract', value: 30 } }] },
    subLibraries: [],
  });
  // Both match -> apply
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { subLibraryId: 'film', type: 'movie' }, config: c }), 170);
  // Only one matches -> no apply
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { subLibraryId: 'film', type: 'season' }, config: c }), 200);
});

test('resolution match uses prefix semantics (4K deferral rule)', () => {
  const c = config({
    rules: { transcode: [{ match: { resolution: '3840' }, adjust: { op: 'add', value: 40 } }] },
    subLibraries: [],
  });
  // 4K (3840x2160) is deferred
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { resolution: '3840x2160' }, config: c }), 240);
  // 1080p unaffected
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: { resolution: '1920x1080' }, config: c }), 200);
});

test('result is clamped to >= 0 and rounded', () => {
  const c = config({
    rules: { transcode: [{ match: {}, adjust: { op: 'subtract', value: 250 } }] },
    subLibraries: [],
  });
  const p = pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: {}, config: c });
  assert.strictEqual(p, 0, 'priority never goes negative');
});

test('missing taskPriority config falls back to safe defaults', () => {
  // No taskPriority key at all
  const c = { subLibraries: [] };
  assert.strictEqual(pe.computePriority({ source: 'manual', operationKind: 'transcode', itemInfo: {}, config: c }), 100);
  assert.strictEqual(pe.computePriority({ source: 'auto', operationKind: 'transcode', itemInfo: {}, config: c }), 200);
});

test('_applyAdjust handles subtract / add and ignores invalid or legacy set', () => {
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: 30 }), 70);
  assert.strictEqual(pe._applyAdjust(100, { op: 'add', value: 30 }), 130);
  assert.strictEqual(pe._applyAdjust(100, { op: 'set', value: 50 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'unknown', value: 30 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: NaN }), 100);
  assert.strictEqual(pe._applyAdjust(100, null), 100);
});
