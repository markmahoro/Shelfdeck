'use strict';

const RESOLUTION_DRAFT_SCHEMA = 'helix://contracts/types/PerceptionResolutionDraft/v1';

class PerceptionResolutionLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionResolutionLifecycleError';
    this.code = code;
    this.details = details;
  }
}

function createPerceptionResolutionCommitRegistration(store) {
  if (!store || typeof store.createResolutionCommitParticipant !== 'function') {
    throw new PerceptionResolutionLifecycleError(
      'P6_PERCEPTION_RESOLUTION_STORE_REQUIRED',
      'Perception Resolution commit participant factory is required.'
    );
  }
  return Object.freeze({
    ownerDomain: 'perception',
    aggregateType: 'perception-resolution',
    factType: 'PerceptionResolutionDraft',
    factSchemaRef: RESOLUTION_DRAFT_SCHEMA,
    effectClass: 'domain_fact_commit',
    revisionFence: true,
    createParticipant({ handle, payload }) {
      return store.createResolutionCommitParticipant(handle, payload);
    }
  });
}

module.exports = Object.freeze({
  PerceptionResolutionLifecycleError,
  createPerceptionResolutionCommitRegistration
});
