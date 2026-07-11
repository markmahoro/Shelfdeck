'use strict';

// Tests for PriorityEngine — initial task priority computation.
// Lower number = runs first. Task creation is ordered before workflow planning,
// so only targetGate and item facts may participate.

const test = require('node:test');
const assert = require('node:assert');
const pe = require('../src/priorityEngine');

function config({ basePriority, rulesByTargetGate, subLibraries } = {}) {
  return {
    taskPriority: {
      basePriority: basePriority ?? 100,
      targetGateWeights: {
        basedata: 60,
        metadata: 80,
        optimize: 110,
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

test('Run origin does not change task-local gate and library priority', () => {
  const c = config();
  const explained = pe.explainPriority({ source: 'manual', ...taskContext('optimize', 'transcode'), subjectInfo: {}, config: c });
  assert.strictEqual(explained.priority, 310);
  assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['base', 'targetGate', 'subLibrary']);
});

test('optimize target-gate tasks do not need a flow kind at creation time', () => {
  const c = config();
  const explained = pe.explainPriority({ source: 'manual', taskTarget: targetGate('optimize'), subjectInfo: {}, config: c });
  assert.strictEqual(explained.priority, 310);
  assert.strictEqual(explained.flowKind, undefined);
  assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['base', 'targetGate', 'subLibrary']);
});

test('tasks add the common base and default library dimensions', () => {
  const c = config();
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: {}, config: c }), 310);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('metadata', 'scrape'), subjectInfo: { scraped: true, adultMetadata: { scrapeStatus: 'done' } }, config: c }), 280);
});

test('targetGateWeights order target gates without treating flows as task targets', () => {
  const c = config();
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('basedata', 'basedata'), subjectInfo: {}, config: c }), 260);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('metadata', 'scrape'), subjectInfo: { scraped: true, adultMetadata: { scrapeStatus: 'done' } }, config: c }), 280);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: {}, config: c }), 310);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'upgrade'), subjectInfo: {}, config: c }), 310);
});

test('library weight is added as an independent dimension', () => {
  const subLibraries = [{ uuid: 'film', priorityWeight: 10 }, { uuid: 'series', priorityWeight: 50 }];
  const c = config({ subLibraries });

  const filmAuto = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { subLibraryId: 'film' }, config: c });
  const seriesAuto = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { subLibraryId: 'series' }, config: c });
  assert.strictEqual(filmAuto, 220);
  assert.strictEqual(seriesAuto, 260);
  assert.ok(filmAuto < seriesAuto);

  const filmManual = pe.computePriority({ source: 'manual', ...taskContext('optimize', 'transcode'), subjectInfo: { subLibraryId: 'film' }, config: c });
  assert.strictEqual(filmManual, 220);
});

test('rulesByTargetGate applies by lifecycle target gate', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: { subLibraryId: 'film' }, adjust: { op: 'subtract', value: 25 } }],
    },
  });

  const transcode = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { subLibraryId: 'film' }, config: c });
  const upgrade = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'upgrade'), subjectInfo: { subLibraryId: 'film' }, config: c });
  const scrape = pe.computePriority({ source: 'auto', ...taskContext('metadata', 'scrape'), subjectInfo: { subLibraryId: 'film', scraped: true, adultMetadata: { scrapeStatus: 'done' } }, config: c });
  assert.strictEqual(transcode, 285);
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
    subjectInfo: { subLibraryId: 'film', type: 'season', isDolbyVision: false },
    config: c,
  });
  assert.strictEqual(p, 280);
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
    subjectInfo: { subLibraryId: 'film' },
    config: c,
  });

  assert.strictEqual(explained.modelVersion, 'kairox-task-creator-v2');
  assert.strictEqual(explained.formula, 'base + targetGate + subLibrary + businessSignal + queueAge + retry + matchedRules');
  assert.strictEqual(explained.priority, 195);
  assert.deepStrictEqual(explained.dimensions.map((d) => d.value), [100, 110, 10, -25]);
});

test('metadata business signal keeps enrichment ahead of transcode', () => {
  const c = config();
  c.taskPriority.businessSignalWeights = { adultWorkflowBonus: 20, maxTranscodeSavingBonus: 30 };

  const scrape = pe.explainPriority({
    source: 'auto',
    ...taskContext('metadata', 'scrape'),
    subjectInfo: { scraped: false, adultMetadata: { scrapeStatus: 'pending' } },
    config: c,
  });
  const transcode = pe.explainPriority({
    source: 'auto',
    ...taskContext('optimize', 'transcode'),
    subjectInfo: { equivalentBitrate: 12000, targetBitrate: 8000 },
    config: c,
  });

  assert.strictEqual(scrape.priority, 260);
  assert.strictEqual(transcode.priority, 295);
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
      subjectInfo: {},
      task: { createdAt: '2026-06-29T07:30:00.000Z', retryCount: 2 },
      config: c,
    });
    assert.strictEqual(explained.priority, 342);
    assert.deepStrictEqual(explained.dimensions.map((d) => d.key), ['base', 'targetGate', 'subLibrary', 'queueAge', 'retry']);
    assert.deepStrictEqual(explained.dimensions.map((d) => d.value), [100, 110, 100, -8, 40]);
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
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { subLibraryId: 'film', type: 'movie' }, config: c }), 280);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { subLibraryId: 'film', type: 'season' }, config: c }), 310);
});

test('resolution match uses prefix semantics', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: { resolution: '3840' }, adjust: { op: 'add', value: 40 } }],
    },
  });
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { resolution: '3840x2160' }, config: c }), 350);
  assert.strictEqual(pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: { resolution: '1920x1080' }, config: c }), 310);
});

test('result is clamped to >= 0 and rounded', () => {
  const c = config({
    rulesByTargetGate: {
      basedata: [],
      metadata: [],
      optimize: [{ match: {}, adjust: { op: 'subtract', value: 500 } }],
    },
  });
  const p = pe.computePriority({ source: 'auto', ...taskContext('optimize', 'transcode'), subjectInfo: {}, config: c });
  assert.strictEqual(p, 0);
});

test('missing taskPriority config falls back to target gate defaults', () => {
  const c = { subLibraries: [] };
  assert.strictEqual(pe.computePriority({ source: 'manual', taskTarget: targetGate('optimize'), subjectInfo: {}, config: c }), 310);
  assert.strictEqual(pe.computePriority({ source: 'auto', taskTarget: targetGate('optimize'), subjectInfo: {}, config: c }), 310);
});

test('_applyAdjust handles subtract / add and ignores invalid or legacy set', () => {
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: 30 }), 70);
  assert.strictEqual(pe._applyAdjust(100, { op: 'add', value: 30 }), 130);
  assert.strictEqual(pe._applyAdjust(100, { op: 'set', value: 50 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'unknown', value: 30 }), 100);
  assert.strictEqual(pe._applyAdjust(100, { op: 'subtract', value: NaN }), 100);
  assert.strictEqual(pe._applyAdjust(100, null), 100);
});
