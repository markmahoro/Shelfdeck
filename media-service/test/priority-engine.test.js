'use strict';

// Tests for PriorityEngine — initial task priority computation.
// Lower number = runs first. The business dimension is targetGate; flowKind
// only participates after a flow plan exists.

const test = require('node:test');
const assert = require('node:assert');
const pe = require('../src/priorityEngine');

function config({ manualTaskPriority, autoTaskPriorityBase, rulesByTargetGate, subLibraries } = {}) {
  return {
    taskPriority: {
      manualTaskPriority: manualTaskPriority ?? 0,
      autoTaskPriorityBase: autoTaskPriorityBase ?? 100,
      targetGateWeights: {
        basedata: 60,
        metadata: 80,
        optimize: 110,
      },
      optimizeOperationHints: {
        transcode: 20,
        upgrade: 0,
      },
      rulesByTargetGate: rulesByTargetGate || { basedata: [], metadata: [], optimize: [] },
    },
    subLibraries: subLibraries || [],
  };
}

function targetGate(targetGate) {
  return { targetGate };
}

function taskContext(targetGateValue, flowKind = '') {
  return {
    taskTarget: targetGate(targetGateValue),
    flowKind,
  };
}

test('manual tasks add source, target gate, flow kind, and library dimensions when planned flow is known', () => {
  const c = config();
  const explained = pe.explainPriority({ source: 'manual', ...taskContext('optimize', 'transcode'), itemInfo: {}, config: c });
  assert.strictEqual(explained.priority, 230);
  assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['source', 'targetGate', 'flowKind', 'subLibrary']);
});

test('optimize target-gate tasks do not need a flow kind at creation time', () => {
  const c = config();
  const explained = pe.explainPriority({ source: 'manual', taskTarget: targetGate('optimize'), itemInfo: {}, config: c });
  assert.strictEqual(explained.priority, 210);
  assert.strictEqual(explained.flowKind, '');
  assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['source', 'targetGate', 'subLibrary']);
});

test('auto tasks add source and default library dimensions', () => {
  const c = config();
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: {}, config: c }), 330);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('metadata', 'scrape'), itemInfo: { scraped: true, adultMetadata: { scrapeStatus: 'done' } }, config: c }), 280);
});

test('targetGateWeights order target gates without treating flows as task targets', () => {
  const c = config();
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('basedata', 'basedata'), itemInfo: {}, config: c }), 260);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('metadata', 'scrape'), itemInfo: { scraped: true, adultMetadata: { scrapeStatus: 'done' } }, config: c }), 280);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: {}, config: c }), 330);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'upgrade'), itemInfo: {}, config: c }), 310);
});

test('library weight is added as an independent dimension', () => {
  const subLibraries = [{ uuid: 'film', priorityWeight: 10 }, { uuid: 'series', priorityWeight: 50 }];
  const c = config({ subLibraries });

  const filmAuto = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { subLibraryId: 'film' }, config: c });
  const seriesAuto = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { subLibraryId: 'series' }, config: c });
  assert.strictEqual(filmAuto, 240);
  assert.strictEqual(seriesAuto, 280);
  assert.ok(filmAuto < seriesAuto);

  const filmManual = pe.computePriority({ source: 'manual', ...taskContext('optimize', 'transcode'), itemInfo: { subLibraryId: 'film' }, config: c });
  assert.strictEqual(filmManual, 140);
});

test('rulesByTargetGate applies by lifecycle target gate', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 25 } }],
    },
  });

  const transcode = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { subLibraryId: 'film' }, config: c });
  const upgrade = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'upgrade'), itemInfo: { subLibraryId: 'film' }, config: c });
  const scrape = pe.computePriority({ source: 'auto', ...taskContext('metadata', 'scrape'), itemInfo: { subLibraryId: 'film', scraped: true, adultMetadata: { scrapeStatus: 'done' } }, config: c });
  assert.strictEqual(transcode, 305);
  assert.strictEqual(upgrade, 285);
  assert.strictEqual(scrape, 280);
});

test('multiple target-gate rules apply in order', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [
        { match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 50 } },
        { match: { type: 'season' }, adjust: { op: 'add', value: 20 } },
        { match: { isDolbyVision: true }, adjust: { op: 'subtract', value: 10 } },
      ],
    },
  });
  const p = pe.computePriority({
    source: 'auto',
    ...taskContext('optimize', 'transcode'),
    itemInfo: { subLibraryId: 'film', type: 'season', isDolbyVision: false },
    config: c,
  });
  assert.strictEqual(p, 300);
});

test('explainPriority returns the Kairox additive breakdown', () => {
  const c = config({
    subLibraries: [{ uuid: 'film', priorityWeight: 10 }],
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 25 } }],
    },
  });

  const explained = pe.explainPriority({
    source: 'auto',
    ...taskContext('optimize', 'transcode'),
    itemInfo: { subLibraryId: 'film' },
    config: c,
  });

  assert.strictEqual(explained.modelVersion, 'kairox-task-creator-v1');
  assert.strictEqual(explained.formula, 'source + targetGate + flowKind + subLibrary + businessSignal + queueAge + retry + matchedRules');
  assert.strictEqual(explained.priority, 215);
  assert.deepStrictEqual(explained.dimensions.map((d) => d.value), [100, 110, 20, 10, -25]);
});

test('metadata business signal keeps enrichment ahead of transcode', () => {
  const c = config();
  c.taskPriority.businessSignalWeights = { adultWorkflowBonus: 20, maxTranscodeSavingBonus: 30 };

  const scrape = pe.explainPriority({
    source: 'auto',
    ...taskContext('metadata', 'scrape'),
    itemInfo: { scraped: false, adultMetadata: { scrapeStatus: 'pending' } },
    config: c,
  });
  const transcode = pe.explainPriority({
    source: 'auto',
    ...taskContext('optimize', 'transcode'),
    itemInfo: { equivalentBitrate: 12000, targetBitrate: 8000 },
    config: c,
  });

  assert.strictEqual(scrape.priority, 260);
  assert.strictEqual(transcode.priority, 315);
  assert.ok(scrape.priority < transcode.priority);
});

test('queue age and retry are additive dynamic dimensions', () => {
  const c = config();
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
      ...taskContext('optimize', 'transcode'),
      itemInfo: {},
      task: { createdAt: '2026-06-29T07:30:00.000Z', retryCount: 2 },
      config: c,
    });
    assert.strictEqual(explained.priority, 362);
    assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['source', 'targetGate', 'flowKind', 'subLibrary', 'queueAge', 'retry']);
    assert.deepStrictEqual(explained.dimensions.map((d) => d.value), [100, 110, 20, 100, -8, 40]);
  } finally {
    Date.now = realNow;
  }
});

test('match is AND-combined; undefined fields do not constrain', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: { subLibraryId: 'film', type: 'movie' }, adjust: { op: 'subtract', value: 30 } }],
    },
  });
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { subLibraryId: 'film', type: 'movie' }, config: c }), 300);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { subLibraryId: 'film', type: 'season' }, config: c }), 330);
});

test('resolution match uses prefix semantics', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: { resolution: '3840' }, adjust: { op: 'add', value: 40 } }],
    },
  });
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { resolution: '3840x2160' }, config: c }), 370);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: { resolution: '1920x1080' }, config: c }), 330);
});

test('result is clamped to >= 0 and rounded', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: {}, adjust: { op: 'subtract', value: 500 } }],
    },
  });
  const p = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), itemInfo: {}, config: c });
  assert.strictEqual(p, 0);
});

test('missing taskPriority config falls back to target gate defaults', () => {
  const c = { subLibraries: [] };
  assert.strictEqual(pe.computePriority({ source: 'manual', taskTarget: targetGate('optimize'), itemInfo: {}, config: c }), 210);
  assert.strictEqual(pe.computePriority({ source: 'auto', taskTarget: targetGate('optimize'), itemInfo: {}, config: c }), 310);
});

test('_applyAdjust handles subtract / add and ignores invalid or legacy set', () => {
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: 30 }), 70);
  assert.strictEqual(pe._applyAdjust(100, { op: 'add', value: 30 }), 130);
  assert.strictEqual(pe._applyAdjust(100, { op: 'set', value: 50 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'unknown', value: 30 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: NaN }), 100);
  assert.strictEqual(pe._applyAdjust(100, null), 100);
});
