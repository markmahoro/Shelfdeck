'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PERIOD_MS,
  STARTUP_FIRST_SWEEP_DEADLINE_MS,
  createFieldObservationAutomation,
} = require('../../src/helix/domains/procurement/application/field-observation-automation');

function field(overrides = {}) {
  return Object.freeze({
    fieldId: overrides.fieldId || 'field-a',
    status: overrides.status || 'active',
    currentAccessRevision: overrides.currentAccessRevision || 1,
    currentObservationRevision: Object.hasOwn(overrides, 'currentObservationRevision')
      ? overrides.currentObservationRevision
      : null,
    currentProfileHintSnapshot: Object.freeze({
      contentProfileHint: overrides.contentProfileHint || 'movie',
    }),
  });
}

function createHarness(overrides = {}) {
  let nowMs = overrides.nowMs || 1_700_000_000_000;
  const fields = new Map((overrides.fields || [field()]).map((item) => [item.fieldId, item]));
  const works = new Map((overrides.works || []).map(([fieldId, rows]) => [fieldId,
    rows.map(row => ({ created_at_ms:nowMs - PERIOD_MS, ...row }))]));
  const progress = new Map(overrides.progress || []);
  const issued = [];
  const automation = createFieldObservationAutomation({
    now: () => nowMs,
    materialFieldStore: {
      getResetBarrier: () => overrides.resetBarrier || null,
      listMaterialFields: () => [...fields.values()],
      getMaterialField: (fieldId) => fields.get(fieldId) || null,
    },
    observationAdmin: {
      observe(input) {
        if (overrides.observeError) throw overrides.observeError;
        issued.push(input);
        return Object.freeze({
          observationWorkId: 'work-' + input.fieldId,
          replayed: false,
        });
      },
    },
    workResultReader: {
      listWorks({ processId }) {
        return Object.freeze(works.get(processId) || []);
      },
    },
    progressReader: {
      read(workId) {
        return progress.get(workId) || Object.freeze({ workId, pageCount: 0, completed: false });
      },
    },
  });
  return Object.freeze({
    automation,
    issued,
    works,
    advance(ms) { nowMs += ms; },
    now: () => nowMs,
  });
}

test('Reset ignores retained old failed scan TTL and old open Work for the first fresh sweep', () => {
  const resetBarrier = { reset_id: 'a'.repeat(64), minimum_observation_revision: 7 };
  const h = createHarness({ resetBarrier, fields: [field({ currentObservationRevision: 7 })],
    works: [['field-a', [{ work_id: 'old-open', state: 'running' }, { work_id: 'old-failed', state: 'failed', created_at_ms: 1_700_000_000_000 }]]] });
  assert.equal(h.automation.reconcile({ fieldId: 'field-a' }).kind, 'issued');
  assert.equal(h.issued[0].expectedObservationRevision, 7);
  h.works.set('field-a', [{ work_id: 'field-observation-work-' + resetBarrier.reset_id + '-new', state: 'running', created_at_ms: h.now() }]);
  assert.equal(h.automation.reconcile({ fieldId: 'field-a' }).kind, 'in_progress');
});

for (const contentProfileHint of ['movie', 'series']) test(`first sweep issues Observation for active ${contentProfileHint} Fields immediately, then waits 12 hours`, () => {
  const harness = createHarness({
    fields: [field({ currentObservationRevision: 1, contentProfileHint })],
  });
  const first = harness.automation.listPage({ cursor: null, limit: 100 });
  assert.deepEqual(first.map((item) => item.cursor), ['field-a']);
  assert.equal(harness.automation.reconcile({ fieldId: 'field-a' }).kind, 'issued');
  assert.equal(harness.issued[0].expectedObservationRevision, 1);
  assert.match(harness.issued[0].idempotencyKey, /^periodic-field-observation:/);
  assert.equal(harness.issued[0].pageBudget, 256);

  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }), []);
  harness.advance(PERIOD_MS - 1);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }), []);
  harness.advance(1);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['field-a']);
  assert.equal(STARTUP_FIRST_SWEEP_DEADLINE_MS, 2 * 60 * 1000);
});

test('never-observed Fields still enter the first sweep while the 12-hour gate is closed', () => {
  const observed = field({ fieldId: 'field-old', currentObservationRevision: 2 });
  const fresh = field({ fieldId: 'field-new', contentProfileHint: 'series' });
  const harness = createHarness({ fields: [observed, fresh] });
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['field-new', 'field-old']);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['field-new']);
  assert.equal(harness.automation.reconcile({ fieldId: 'field-new' }).kind, 'issued');
  assert.equal(harness.issued[0].expectedObservationRevision, 0);
});

test('open Observation Work prevents concurrent admission but terminal partial history does not', () => {
  const running = createHarness({
    works: [['field-a', [Object.freeze({ work_id: 'work-open', state: 'running' })]]],
  });
  assert.equal(running.automation.reconcile({ fieldId: 'field-a' }).kind, 'in_progress');
  assert.equal(running.issued.length, 0);

  const incomplete = createHarness({
    works: [['field-a', [Object.freeze({ work_id: 'work-partial', state: 'failed' })]]],
    progress: [['work-partial', Object.freeze({ workId: 'work-partial', pageCount: 2, completed: false })]],
  });
  assert.equal(incomplete.automation.reconcile({ fieldId: 'field-a' }).kind, 'issued');
  assert.equal(incomplete.issued.length, 1);
});

test('a later successful round is not blocked by an older partial failure', () => {
  const nowMs=1_700_000_000_000;
  const harness = createHarness({nowMs, works:[['field-a', [
    {work_id:'old-partial',state:'failed',created_at_ms:nowMs-1000},
    {work_id:'new-success',state:'succeeded',created_at_ms:nowMs},
  ]]], progress:[['old-partial',{pageCount:60,completed:false}],['new-success',{pageCount:73,completed:true}]] });
  assert.equal(harness.automation.reconcile({fieldId:'field-a'}).kind,'issued');
  assert.equal(harness.issued.length,1);
});

test('zero-page failure survives restart without immediate retry and gets a new key next period', () => {
  const first = createHarness();
  first.automation.reconcile({fieldId:'field-a'});
  const restarted = createHarness({ nowMs:first.now()+1000,
    works:[['field-a',[{work_id:'failed-empty',state:'failed',created_at_ms:first.now()}]]] });
  assert.equal(restarted.automation.listPage({cursor:null,limit:100}).length,1);
  assert.deepEqual(restarted.automation.reconcile({fieldId:'field-a'}),
    {kind:'not_due',fieldId:'field-a',nextDueAtMs:first.now()+PERIOD_MS});
  assert.equal(restarted.issued.length,0);
  restarted.advance(PERIOD_MS-1000);
  assert.equal(restarted.automation.listPage({cursor:null,limit:100}).length,1);
  assert.equal(restarted.automation.reconcile({fieldId:'field-a'}).kind,'issued');
  assert.notEqual(restarted.issued[0].idempotencyKey,first.issued[0].idempotencyKey);
});

test('repeated due checks bind one key even without an Observation revision change', () => {
  const harness=createHarness();
  harness.automation.reconcile({fieldId:'field-a'});
  harness.automation.reconcile({fieldId:'field-a'});
  assert.equal(harness.issued[0].idempotencyKey,harness.issued[1].idempotencyKey);
  harness.advance(PERIOD_MS);
  harness.automation.reconcile({fieldId:'field-a'});
  assert.notEqual(harness.issued[2].idempotencyKey,harness.issued[0].idempotencyKey);
});

test('a recent failed manual round also prevents automatic restart churn', () => {
  const nowMs=1_700_000_000_000;
  const harness=createHarness({nowMs,works:[['field-a',[
    {work_id:'recent-manual',state:'failed',created_at_ms:nowMs-1},
  ]]]});
  assert.equal(harness.automation.reconcile({fieldId:'field-a'}).kind,'not_due');
  assert.equal(harness.issued.length,0);
});

test('deregistered and unsupported-profile Fields are skipped', () => {
  const harness = createHarness({
    fields: [
      field({ fieldId: 'gone', status: 'deregistered' }),
      field({ fieldId: 'unsupported', contentProfileHint: 'unknown_profile' }),
    ],
  });
  assert.equal(harness.automation.reconcile({ fieldId: 'gone' }).kind, 'not_active');
  assert.equal(harness.automation.reconcile({ fieldId: 'unsupported' }).kind, 'unsupported_profile');
  assert.equal(harness.issued.length, 0);
});

test('deferred Observation Work is treated as in progress, not thrown', () => {
  const error = Object.assign(new Error('deferred'), { code: 'FIELD_OBSERVATION_WORK_DEFERRED' });
  const harness = createHarness({ observeError: error });
  assert.deepEqual(harness.automation.reconcile({ fieldId: 'field-a' }), Object.freeze({
    kind: 'in_progress',
    fieldId: 'field-a',
    reasonCode: 'FIELD_OBSERVATION_WORK_DEFERRED',
  }));
});


test('US Adult Material Fields issue their own Observation Work like the other supported profiles',()=>{
  const harness=createHarness({fields:[field({fieldId:'us-adult',contentProfileHint:'western_adult'})]});
  assert.equal(harness.automation.reconcile({fieldId:'us-adult'}).kind,'issued');assert.equal(harness.issued.length,1);
});
