'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');

class FieldObservationAdminServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationAdminServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationAdminServiceError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function validateInput(input) {
  const keys = ['fieldId', 'idempotencyKey', 'expectedAccessRevision', 'expectedObservationRevision', 'pageBudget'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(keys.sort()) ||
      typeof input.fieldId !== 'string' || !input.fieldId || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey ||
      !Number.isSafeInteger(input.expectedAccessRevision) || input.expectedAccessRevision < 1 ||
      !Number.isSafeInteger(input.expectedObservationRevision) || input.expectedObservationRevision < 0 ||
      !Number.isSafeInteger(input.pageBudget) || input.pageBudget < 1 || input.pageBudget > 256) {
    fail('FIELD_OBSERVATION_ADMIN_INPUT_INVALID', '显式观察请求不符合closed input合同。');
  }
}

function workDefinition(field, input, workId, basisDigest) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1, workId,
    ownerDomain: 'procurement', processType: 'material_field', processId: field.fieldId, workKind: 'field_observation',
    workObjectiveTypeRef: 'helix://procurement/work/FieldObservation/v1', workObjectiveVersion: 1,
    executionBasisId: stableId('field-observation-basis-', { fieldId: field.fieldId,
      accessRevision: field.access.revision, expectedObservationRevision: input.expectedObservationRevision }),
    executionBasisDigest: basisDigest, dependencyRefs: Object.freeze([]), priorityClass: 'background_observation',
    priorityRevision: 1, capabilityCatalogScope: 'procurement', workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: input.idempotencyKey, concurrencyScope: field.fieldId + '/field-observation',
    outputContractRef: 'helix://contracts/types/ObservationPageCommitResult/v1',
  });
}

function createFieldObservationAdminService(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.materialFieldStore ||
      !options.executionRuntimeHost || typeof options.executionRuntimeHost.wake !== 'function') {
    fail('FIELD_OBSERVATION_ADMIN_DEPENDENCIES', 'Field Observation Admin service requires persistence and Execution Runtime Host.');
  }

  function observe(input) {
    validateInput(input);
    const field = options.materialFieldStore.getMaterialField(input.fieldId);
    if (!field) fail('P7_MATERIAL_FIELD_NOT_FOUND', 'Material Field does not exist.');
    if (field.status !== 'active') fail('P7_MATERIAL_FIELD_DEREGISTERED', 'Deregistered Material Field cannot be observed.');
    const workId = stableId('field-observation-work-', { fieldId: input.fieldId, idempotencyKey: input.idempotencyKey });
    const basisDigest = canonicalDigest({ schema: 'procurement.admin-field-observation-basis@2', fieldId: field.fieldId,
      access: field.access, profileHintSnapshot: field.currentProfileHintSnapshot,
      expectedObservationRevision: input.expectedObservationRevision, pageBudget: input.pageBudget });
    const admission = createWorkAdmission({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
      eligibilityProvider: { check: (request) => Object.freeze({
        eligible: request.ownerDomain === 'procurement' && request.processId === field.fieldId &&
          request.executionBasisDigest === basisDigest, basisDigest, reasonCode: 'FIELD_OBSERVATION_BASIS_STALE',
      }) }, limits: Object.freeze({ globalOpenWorks: 1_000, ownerOpenWorks: 500, openEvents: 100_000 }) });
    const definition = workDefinition(field, input, workId, basisDigest);
    const replayed = admission.replay(definition);
    if (!replayed && (field.currentAccessRevision !== input.expectedAccessRevision ||
        (field.currentObservationRevision || 0) !== input.expectedObservationRevision)) {
      fail('FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT', 'Field Access or Observation revision is stale.', {
        currentAccessRevision: field.currentAccessRevision,
        currentObservationRevision: field.currentObservationRevision || 0,
      });
    }
    const admitted = replayed || admission.submit(definition);
    if (admitted.kind === 'deferred') fail('FIELD_OBSERVATION_WORK_DEFERRED', 'Material Field已有未终结的Observation Work。', {
      reasonCode: admitted.reasonCode,
    });
    if (admitted.kind !== 'admitted') fail('FIELD_OBSERVATION_WORK_REJECTED', 'Field Observation Supporting Work未通过准入。', {
      reasonCode: admitted.reasonCode,
    });
    options.executionRuntimeHost.wake();
    return Object.freeze({
      operationRef: Object.freeze({ operationType: 'field_observation', operationId: workId }),
      observationWorkId: workId, fieldId: field.fieldId, state: admitted.state, replayed: admitted.replayed,
    });
  }

  return Object.freeze({ observe });
}

module.exports = Object.freeze({ FieldObservationAdminServiceError, createFieldObservationAdminService });
