'use strict';

const OPEN_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);
const PAGE_BUDGET = 256;
const PERIOD_MS = 30 * 60 * 1000;
const STARTUP_FIRST_SWEEP_DEADLINE_MS = 2 * 60 * 1000;

class FieldObservationAutomationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationAutomationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationAutomationError(code, message, details);
}

function createFieldObservationAutomation(options) {
  if (!options?.materialFieldStore || typeof options.materialFieldStore.listMaterialFields !== 'function' ||
      typeof options.materialFieldStore.getMaterialField !== 'function' ||
      !options.observationAdmin || typeof options.observationAdmin.observe !== 'function' ||
      !options.workResultReader || typeof options.workResultReader.listWorks !== 'function' ||
      !options.progressReader || typeof options.progressReader.read !== 'function' ||
      typeof options.now !== 'function') {
    fail('FIELD_OBSERVATION_AUTOMATION_DEPENDENCIES',
      'Field Observation automation requires Field Store, Observation Admin, Work Result Reader, progress reader, and clock.');
  }

  let sweepNotBeforeMs = 0;

  function activeFields() {
    return options.materialFieldStore.listMaterialFields()
      .filter((field) => field.status === 'active')
      .sort((left, right) => left.fieldId.localeCompare(right.fieldId));
  }

  function listPage({ cursor, limit }) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      fail('FIELD_OBSERVATION_AUTOMATION_PAGE_INVALID', 'Field Observation reconcile page limit is invalid.');
    }
    const gated = cursor === null && options.now() < sweepNotBeforeMs;
    const selected = [];
    for (const field of activeFields()) {
      if (cursor !== null && field.fieldId <= cursor) continue;
      if (gated && field.currentObservationRevision != null) continue;
      selected.push(field);
      if (selected.length >= limit) break;
    }
    if (!gated && selected.length < limit) sweepNotBeforeMs = options.now() + PERIOD_MS;
    return selected.map((field) => Object.freeze({
      cursor: field.fieldId,
      scope: Object.freeze({ fieldId: field.fieldId }),
    }));
  }

  function observationWorks(fieldId) {
    return options.workResultReader.listWorks({
      ownerDomain: 'procurement',
      processType: 'material_field',
      processId: fieldId,
      workKind: 'field_observation',
    });
  }

  function reconcile({ fieldId }) {
    const field = options.materialFieldStore.getMaterialField(fieldId);
    if (!field || field.status !== 'active') return Object.freeze({ kind: 'not_active', fieldId });
    if (field.currentProfileHintSnapshot?.contentProfileHint !== 'movie') {
      return Object.freeze({ kind: 'unsupported_profile', fieldId });
    }
    const works = observationWorks(fieldId);
    const open = works.find((work) => OPEN_WORK_STATES.has(work.state));
    if (open) return Object.freeze({ kind: 'in_progress', fieldId, observationWorkId: open.work_id });
    const incomplete = works.find((work) => {
      const progress = options.progressReader.read(work.work_id);
      return progress.pageCount > 0 && !progress.completed;
    });
    if (incomplete) {
      return Object.freeze({ kind: 'incomplete', fieldId, observationWorkId: incomplete.work_id });
    }
    const expectedObservationRevision = field.currentObservationRevision || 0;
    try {
      const observed = options.observationAdmin.observe({
        fieldId: field.fieldId,
        idempotencyKey: 'periodic-field-observation:' + field.fieldId + ':access-' + field.currentAccessRevision
          + ':observation-' + expectedObservationRevision,
        expectedAccessRevision: field.currentAccessRevision,
        expectedObservationRevision,
        pageBudget: PAGE_BUDGET,
      });
      return Object.freeze({
        kind: 'issued',
        fieldId,
        observationWorkId: observed.observationWorkId,
        replayed: observed.replayed === true,
      });
    } catch (error) {
      if (error.code === 'FIELD_OBSERVATION_WORK_DEFERRED') {
        return Object.freeze({ kind: 'in_progress', fieldId, reasonCode: error.code });
      }
      if (error.code === 'FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT') {
        return Object.freeze({ kind: 'stale', fieldId, reasonCode: error.code });
      }
      throw error;
    }
  }

  return Object.freeze({
    PERIOD_MS,
    STARTUP_FIRST_SWEEP_DEADLINE_MS,
    PAGE_BUDGET,
    listPage,
    reconcile,
  });
}

module.exports = Object.freeze({
  FieldObservationAutomationError,
  PERIOD_MS,
  STARTUP_FIRST_SWEEP_DEADLINE_MS,
  createFieldObservationAutomation,
});
