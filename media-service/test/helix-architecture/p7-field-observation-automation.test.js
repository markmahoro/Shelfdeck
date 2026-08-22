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
  const works = new Map(overrides.works || []);
  const progress = new Map(overrides.progress || []);
  const issued = [];
  const automation = createFieldObservationAutomation({
    now: () => nowMs,
    materialFieldStore: {
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
    advance(ms) { nowMs += ms; },
    now: () => nowMs,
  });
}

test('first sweep issues Observation for active Movie Fields immediately, then waits 30 minutes', () => {
  const harness = createHarness({
    fields: [field({ currentObservationRevision: 1 })],
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

test('never-observed Fields still enter the first sweep while the 30-minute gate is closed', () => {
  const observed = field({ fieldId: 'field-old', currentObservationRevision: 2 });
  const fresh = field({ fieldId: 'field-new' });
  const harness = createHarness({ fields: [observed, fresh] });
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['field-new', 'field-old']);
  assert.deepEqual(harness.automation.listPage({ cursor: null, limit: 100 }).map((item) => item.cursor), ['field-new']);
  assert.equal(harness.automation.reconcile({ fieldId: 'field-new' }).kind, 'issued');
  assert.equal(harness.issued[0].expectedObservationRevision, 0);
});

test('open or incomplete Observation Work is not re-issued', () => {
  const running = createHarness({
    works: [['field-a', [Object.freeze({ work_id: 'work-open', state: 'running' })]]],
  });
  assert.equal(running.automation.reconcile({ fieldId: 'field-a' }).kind, 'in_progress');
  assert.equal(running.issued.length, 0);

  const incomplete = createHarness({
    works: [['field-a', [Object.freeze({ work_id: 'work-partial', state: 'failed' })]]],
    progress: [['work-partial', Object.freeze({ workId: 'work-partial', pageCount: 2, completed: false })]],
  });
  assert.equal(incomplete.automation.reconcile({ fieldId: 'field-a' }).kind, 'incomplete');
  assert.equal(incomplete.issued.length, 0);
});

test('deregistered and non-movie Fields are skipped', () => {
  const harness = createHarness({
    fields: [
      field({ fieldId: 'gone', status: 'deregistered' }),
      field({ fieldId: 'series', contentProfileHint: 'series' }),
    ],
  });
  assert.equal(harness.automation.reconcile({ fieldId: 'gone' }).kind, 'not_active');
  assert.equal(harness.automation.reconcile({ fieldId: 'series' }).kind, 'unsupported_profile');
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
