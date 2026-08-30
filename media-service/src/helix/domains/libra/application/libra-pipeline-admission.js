'use strict';

const {
  DEFAULT_PREDECK_PIPELINE_SEATS,
  createPredeckPipelineAdmissionStore,
} = require('../persistence/predeck-pipeline-admission-store');

function fieldIdFromOfferSource(source) {
  return source?.snapshot?.candidatePackage?.materialFieldContextRef?.fieldId || null;
}

function createLibraPipelineAdmission(options) {
  const store = options.store || createPredeckPipelineAdmissionStore(options);
  const subjectResolver = options.subjectResolver;
  if (typeof subjectResolver?.subjectIdForProcess !== 'function') {
    throw new TypeError('Libra pipeline admission requires subjectResolver.subjectIdForProcess.');
  }

  function resolveFieldId(processId) {
    if (typeof options.fieldIdForProcess === 'function') {
      return options.fieldIdForProcess(processId);
    }
    return null;
  }

  return Object.freeze({
    defaultSeats: DEFAULT_PREDECK_PIPELINE_SEATS,
    readPolicy(fieldId) { return store.readPolicy(fieldId); },
    revisePolicy(fieldId, predeckPipelineSeats) { return store.revisePolicy(fieldId, predeckPipelineSeats); },
    hasToken(subjectId) { return store.hasToken(subjectId); },
    listTokens() { return store.listTokens(); },
    tokenSubjectIds() { return new Set(store.listTokens().map((item) => item.subjectId)); },
    freeSeats(fieldId) { return store.readPolicy(fieldId).free; },
    fieldIdFromOfferSource,
    tryAcquireForProcess(processId) {
      const fieldId = resolveFieldId(processId);
      const subjectId = subjectResolver.subjectIdForProcess(processId);
      if (!fieldId || !subjectId) return Object.freeze({ kind: 'unavailable', processId, fieldId, subjectId });
      try {
        const result = store.acquire({ fieldId, subjectId, sourceProcessId: processId });
        return Object.freeze({ kind: 'acquired', processId, fieldId, subjectId, replayed: result.replayed });
      } catch (error) {
        if (error?.code === 'PREDECK_PIPELINE_FULL') {
          return Object.freeze({ kind: 'seat_wait', processId, fieldId, subjectId, reasonCode: error.code, seats: error.details?.seats });
        }
        throw error;
      }
    },
    releaseForSubject(subjectId) { return store.release(subjectId); },
  });
}

module.exports = Object.freeze({
  DEFAULT_PREDECK_PIPELINE_SEATS,
  fieldIdFromOfferSource,
  createLibraPipelineAdmission,
});
