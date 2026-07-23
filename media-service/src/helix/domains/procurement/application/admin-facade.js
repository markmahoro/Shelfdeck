'use strict';

const procurementPublic = require('../public');
const { createMaterialFieldStore } = require('../persistence/material-field-store');
const {
  createFieldObservationAdminService,
} = require('./field-observation-admin-service');

class ProcurementAdminApplicationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProcurementAdminApplicationError';
    this.code = code;
    this.details = details;
  }
}

function unavailable(method) {
  return () => {
    throw new ProcurementAdminApplicationError(
      'CLEAN_FACADE_NOT_IMPLEMENTED',
      '该Procurement Product Facade尚未完成当前操作。',
      { method },
    );
  };
}

function rejected(error) {
  if (error instanceof ProcurementAdminApplicationError) throw error;
  if (error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT') {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_IDEMPOTENCY_CONFLICT',
      '同一幂等键不能用于不同的Material Field请求。',
    );
  }
  if (error.code === 'P4_WORK_ADMISSION_IDEMPOTENCY_CONFLICT') {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_IDEMPOTENCY_CONFLICT',
      '同一幂等键不能用于不同的Field Observation请求。',
    );
  }
  if (
    error.code === 'FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT' ||
    error.code === 'FIELD_OBSERVATION_WORK_DEFERRED'
  ) {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_CONFLICT',
      'Material Field当前revision或Observation Work状态已变化。',
      { reasonCode: error.code },
    );
  }
  throw new ProcurementAdminApplicationError(
    'ADMIN_FIELD_COMMAND_REJECTED',
    'Material Field请求未通过Owner-local合同校验。',
    { reasonCode: error.code || 'MATERIAL_FIELD_CONTRACT_REJECTED' },
  );
}

function commandEnvelope(body, fieldId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProcurementAdminApplicationError('ADMIN_FIELD_COMMAND_REJECTED', 'Material Field请求体无效。');
  }
  const { idempotencyKey, ...payload } = body;
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new ProcurementAdminApplicationError('IDEMPOTENCY_KEY_REQUIRED', 'Material Field写操作必须提供幂等键。');
  }
  if (fieldId !== undefined && payload.fieldId !== fieldId) {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_TARGET_MISMATCH',
      'URL中的Material Field与请求体目标必须一致。',
      { pathFieldId: fieldId, bodyFieldId: payload.fieldId },
    );
  }
  return Object.freeze({ idempotencyKey, input: payload });
}

function invokeCommand(operation) {
  try {
    return operation();
  } catch (error) {
    rejected(error);
  }
}

function createProcurementAdminApplication(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Procurement Admin application requires clean persistence dependencies.');
  }
  const store = createMaterialFieldStore(options);
  const observation = createFieldObservationAdminService({
    ...options,
    materialFieldStore: store,
    now: options.now || Date.now,
  });
  const commands = procurementPublic.ProcurementCommandFacade({
    registerMaterialField: (envelope) => store.commitAdminCommand({ operation: 'register', ...envelope }),
    updateMaterialField: (envelope) => {
      if (envelope?.input?.operation !== 'revise_access') return unavailable('updateMaterialField')();
      const { operation, ...revision } = envelope.input;
      return store.commitAdminCommand({ operation: 'revise_access', idempotencyKey: envelope.idempotencyKey, input: revision });
    },
    publishExtractionPolicy: (envelope) => store.commitAdminCommand({ operation: 'publish_policy', ...envelope }),
    requestFieldObservation: (envelope) => observation.observe({
      ...envelope.input,
      idempotencyKey: envelope.idempotencyKey,
    }),
    retryFailedPreparation: unavailable('retryFailedPreparation'),
    deregisterMaterialField: (envelope) => store.commitAdminCommand({ operation: 'deregister', ...envelope }),
  });
  const queries = procurementPublic.ProcurementQueryFacade({
    listMaterialFields: () => store.listMaterialFields(),
    getMaterialField: ({ fieldId }) => store.getMaterialField(fieldId),
    getExtractionPolicy: ({ extractionPolicyId, revision }) => store.getExtractionPolicy(extractionPolicyId, revision),
    getCandidatePackage: unavailable('getCandidatePackage'),
  });

  return Object.freeze({
    listMaterialFields() {
      return Object.freeze({ items: queries.listMaterialFields() });
    },
    getMaterialField(fieldId) {
      const materialField = queries.getMaterialField({ fieldId });
      if (!materialField) {
        throw new ProcurementAdminApplicationError('ADMIN_FIELD_NOT_FOUND', 'Material Field不存在。', { fieldId });
      }
      return Object.freeze({ materialField });
    },
    getExtractionPolicy(fieldId) {
      const field = queries.getMaterialField({ fieldId });
      if (!field) {
        throw new ProcurementAdminApplicationError('ADMIN_FIELD_NOT_FOUND', 'Material Field不存在。', { fieldId });
      }
      return Object.freeze({ extractionPolicy: queries.getExtractionPolicy({
        extractionPolicyId: field.extractionPolicyId,
        revision: field.extractionPolicyRevision,
      }) });
    },
    registerMaterialField(body) {
      return Object.freeze({ materialField: invokeCommand(() => commands.registerMaterialField(commandEnvelope(body))).materialField });
    },
    reviseMaterialFieldAccess(fieldId, body) {
      return Object.freeze({ materialField: invokeCommand(() => commands.updateMaterialField(commandEnvelope(body, fieldId))).materialField });
    },
    publishExtractionPolicy(fieldId, body) {
      return Object.freeze({ materialField: invokeCommand(() => commands.publishExtractionPolicy(commandEnvelope(body, fieldId))).materialField });
    },
    deregisterMaterialField(fieldId, body) {
      return Object.freeze({ materialField: invokeCommand(() => commands.deregisterMaterialField(commandEnvelope(body, fieldId))).materialField });
    },
    async requestFieldObservation(fieldId, body) {
      try {
        return Object.freeze({
          observation: await commands.requestFieldObservation(commandEnvelope(body, fieldId)),
        });
      } catch (error) {
        rejected(error);
      }
    },
  });
}

module.exports = Object.freeze({ ProcurementAdminApplicationError, createProcurementAdminApplication });
