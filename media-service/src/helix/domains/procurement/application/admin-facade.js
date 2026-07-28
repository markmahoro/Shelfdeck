'use strict';

const procurementPublic = require('../public');
const { createMaterialFieldStore } = require('../persistence/material-field-store');
const {
  createFieldObservationAdminService,
} = require('./field-observation-admin-service');
const {
  createFailedPreparationRetryAdminService,
} = require('./failed-preparation-retry-admin-service');
const {
  createProcurementAutomationService,
} = require('./procurement-automation-service');
const {
  createDefaultTriageRuleRegistry,
} = require('../model/procurement-run-contracts');
const {
  assertProfileHint,
} = require('../model/field-profile-hint-contracts');
const { canonicalDigest } = require('../../../contracts/canonical-json');

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
    error.code === 'FAILED_PREPARATION_RETRY_IDEMPOTENCY_CONFLICT' ||
    error.code === 'P7_RETRY_INTENT_IDEMPOTENCY_CONFLICT'
  ) {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_IDEMPOTENCY_CONFLICT',
      '同一幂等键不能用于不同的失败准备重试请求。',
    );
  }
  if (
    error.code === 'FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT' ||
    error.code === 'FIELD_OBSERVATION_WORK_DEFERRED' ||
    error.code === 'FAILED_PREPARATION_RETRY_SOURCE_INVALID' ||
    error.code === 'FAILED_PREPARATION_RETRY_HEAD_UNAVAILABLE' ||
    error.code === 'FAILED_PREPARATION_RETRY_MEMBER_INELIGIBLE' ||
    error.code === 'FAILED_PREPARATION_RETRY_SCOPE_INVALID' ||
    error.code === 'FAILED_PREPARATION_RETRY_ALREADY_EXISTS' ||
    error.code === 'FAILED_PREPARATION_RETRY_WORK_DEFERRED' ||
    error.code === 'P7_RETRY_ADMISSION_CAS_CONFLICT'
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
    {
      reasonCode: error.code || 'MATERIAL_FIELD_CONTRACT_REJECTED',
      ...(error.details || {}),
    },
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

function registrationBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_COMMAND_REJECTED',
      'Material Field请求体无效。',
    );
  }
  const contentProfileHint = body.contentProfileHint ?? 'mixed';
  try {
    assertProfileHint(contentProfileHint);
  } catch (error) {
    rejected(error);
  }
  return Object.freeze({ ...body, contentProfileHint });
}

function profileHintEnvelope(body, fieldId) {
  const envelope = commandEnvelope(body, fieldId);
  const input = envelope.input;
  const keys = [
    'operation',
    'fieldId',
    'expectedProfileHintRevision',
    'newContentProfileHint',
  ];
  if (Object.keys(input).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(input, key)) ||
      input.operation !== 'revise_profile_hint' ||
      !Number.isSafeInteger(input.expectedProfileHintRevision) ||
      input.expectedProfileHintRevision < 1) {
    throw new ProcurementAdminApplicationError(
      'ADMIN_FIELD_COMMAND_REJECTED',
      'Material Field Profile Hint修订不符合closed command合同。',
    );
  }
  try {
    assertProfileHint(input.newContentProfileHint, 'newContentProfileHint');
  } catch (error) {
    rejected(error);
  }
  const commandBasis = {
    schema: 'procurement.material-field-profile-hint-revision-command@1',
    ...input,
  };
  return Object.freeze({
    idempotencyKey: envelope.idempotencyKey,
    input: Object.freeze({
      operation: 'revise_profile_hint',
      fieldId: input.fieldId,
      expectedProfileHintRevision: input.expectedProfileHintRevision,
      newContentProfileHint: input.newContentProfileHint,
      requestDigest: canonicalDigest(commandBasis),
    }),
  });
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
  const triageRegistry = options.triageRegistry || createDefaultTriageRuleRegistry();
  const retry = createFailedPreparationRetryAdminService({
    ...options,
    triageRegistry,
  });
  const automation = createProcurementAutomationService({
    ...options,
    triageRegistry,
  });
  const commands = procurementPublic.ProcurementCommandFacade({
    registerMaterialField: (envelope) => store.commitAdminCommand({ operation: 'register', ...envelope }),
    updateMaterialField: (envelope) => {
      if (envelope?.input?.operation === 'revise_access') {
        const { operation, ...revision } = envelope.input;
        return store.commitAdminCommand({ operation: 'revise_access', idempotencyKey: envelope.idempotencyKey, input: revision, actorId: envelope.actorId });
      }
      if (envelope?.input?.operation === 'revise_profile_hint') {
        const { operation, ...revision } = envelope.input;
        return store.commitAdminCommand({ operation: 'revise_profile_hint', idempotencyKey: envelope.idempotencyKey, input: revision, actorId: envelope.actorId });
      }
      return unavailable('updateMaterialField')();
    },
    publishExtractionPolicy: (envelope) => store.commitAdminCommand({ operation: 'publish_policy', ...envelope }),
    requestFieldObservation: (envelope) => observation.observe({
      ...envelope.input,
      idempotencyKey: envelope.idempotencyKey,
    }),
    retryFailedPreparation: (envelope) => retry.retry({
      ...envelope.input,
      idempotencyKey: envelope.idempotencyKey,
      actorId: envelope.actorId,
    }),
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
    registerMaterialField(body, actor) {
      const envelope = commandEnvelope(registrationBody(body));
      return Object.freeze({ materialField: invokeCommand(() => commands.registerMaterialField({
        ...envelope,
        actorId: 'admin-credential-revision:' + String(actor.credentialRevision),
      })).materialField });
    },
    reviseMaterialFieldAccess(fieldId, body, actor) {
      const actorId = 'admin-credential-revision:' + String(actor.credentialRevision);
      const envelope = body?.operation === 'revise_profile_hint'
        ? profileHintEnvelope(body, fieldId)
        : commandEnvelope(body, fieldId);
      return Object.freeze({ materialField: invokeCommand(() => commands.updateMaterialField({
        ...envelope,
        actorId,
      })).materialField });
    },
    publishExtractionPolicy(fieldId, body) {
      return Object.freeze({ materialField: invokeCommand(() => commands.publishExtractionPolicy(commandEnvelope(body, fieldId))).materialField });
    },
    deregisterMaterialField(fieldId, body) {
      return Object.freeze({ materialField: invokeCommand(() => commands.deregisterMaterialField(commandEnvelope(body, fieldId))).materialField });
    },
    async requestFieldObservation(fieldId, body) {
      try {
        const observed = await commands.requestFieldObservation(
          commandEnvelope(body, fieldId),
        );
        const procurementAutomation = automation.advanceFromObservation(observed);
        const movieJourney = procurementAutomation.stage === 'procurement_run_active' &&
          options.movieRunCoordinator
          ? await options.movieRunCoordinator.advance(procurementAutomation.procurementRunId)
          : null;
        return Object.freeze({
          observation: observed,
          procurementAutomation,
          ...(movieJourney ? { movieJourney } : {}),
        });
      } catch (error) {
        rejected(error);
      }
    },
    retryFailedPreparation(fieldId, body, actor) {
      try {
        const envelope = commandEnvelope(body, fieldId);
        return Object.freeze({
          retry: commands.retryFailedPreparation({
            ...envelope,
            actorId: 'admin-credential-revision:' + String(actor.credentialRevision),
          }),
        });
      } catch (error) {
        rejected(error);
      }
    },
  });
}

module.exports = Object.freeze({ ProcurementAdminApplicationError, createProcurementAdminApplication });
