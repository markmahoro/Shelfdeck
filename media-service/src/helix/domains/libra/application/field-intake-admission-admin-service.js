'use strict';

const { createLibraPipelineAdmission } = require('./libra-pipeline-admission');
const { createPredeckPipelineAdmissionStore } = require('../persistence/predeck-pipeline-admission-store');

class FieldIntakeAdmissionAdminError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldIntakeAdmissionAdminError';
    this.code = code;
    this.details = details;
  }
}

function createFieldIntakeAdmissionAdminService(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Field intake admission admin requires persistence dependencies.');
  }
  const store = createPredeckPipelineAdmissionStore(options);
  const pipelineAdmission = createLibraPipelineAdmission({
    ...options,
    store,
    subjectResolver: { subjectIdForProcess: () => null },
    fieldIdForProcess: () => null,
  });

  return Object.freeze({
    getFieldIntakeAdmission(fieldId) {
      if (!fieldId) {
        throw new FieldIntakeAdmissionAdminError('ADMIN_FIELD_ID_REQUIRED', 'Material Field id is required.');
      }
      const policy = pipelineAdmission.readPolicy(fieldId);
      return Object.freeze({
        fieldId: policy.fieldId,
        predeckPipelineSeats: policy.predeckPipelineSeats,
        policyRevision: policy.policyRevision,
        updatedAtMs: policy.updatedAtMs,
        pipelineTokensHeld: policy.held,
        pipelineSeatsFree: policy.free,
      });
    },
    reviseFieldIntakeAdmission(fieldId, body) {
      if (!fieldId) {
        throw new FieldIntakeAdmissionAdminError('ADMIN_FIELD_ID_REQUIRED', 'Material Field id is required.');
      }
      if (!body || !Number.isSafeInteger(body.predeckPipelineSeats)) {
        throw new FieldIntakeAdmissionAdminError('ADMIN_INTAKE_ADMISSION_INVALID', 'predeckPipelineSeats must be an integer from 0 to 8.');
      }
      const policy = pipelineAdmission.revisePolicy(fieldId, body.predeckPipelineSeats);
      return Object.freeze({
        fieldId: policy.fieldId,
        predeckPipelineSeats: policy.predeckPipelineSeats,
        policyRevision: policy.policyRevision,
        updatedAtMs: policy.updatedAtMs,
        pipelineTokensHeld: policy.held,
        pipelineSeatsFree: policy.free,
      });
    },
  });
}

module.exports = Object.freeze({
  FieldIntakeAdmissionAdminError,
  createFieldIntakeAdmissionAdminService,
});
