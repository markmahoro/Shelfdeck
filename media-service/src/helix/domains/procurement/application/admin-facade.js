'use strict';

const procurementPublic = require('../public');
const { createMaterialFieldStore } = require('../persistence/material-field-store');

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
  throw new ProcurementAdminApplicationError(
    'ADMIN_FIELD_COMMAND_REJECTED',
    'Material Field请求未通过Owner-local合同校验。',
    { reasonCode: error.code || 'MATERIAL_FIELD_CONTRACT_REJECTED' },
  );
}

function commandPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { idempotencyKey, ...payload } = body;
  return payload;
}

function createProcurementAdminApplication(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Procurement Admin application requires clean persistence dependencies.');
  }
  const store = createMaterialFieldStore(options);
  const commands = procurementPublic.ProcurementCommandFacade({
    registerMaterialField: (input) => store.registerMaterialField(input),
    updateMaterialField: unavailable('updateMaterialField'),
    publishExtractionPolicy: (input) => store.publishExtractionPolicy(input),
    requestFieldObservation: unavailable('requestFieldObservation'),
    retryFailedPreparation: unavailable('retryFailedPreparation'),
    deregisterMaterialField: (input) => store.deregisterMaterialField(input),
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
    registerMaterialField(body) {
      try {
        return Object.freeze({ materialField: commands.registerMaterialField(commandPayload(body)) });
      } catch (error) {
        rejected(error);
      }
    },
  });
}

module.exports = Object.freeze({ ProcurementAdminApplicationError, createProcurementAdminApplication });
