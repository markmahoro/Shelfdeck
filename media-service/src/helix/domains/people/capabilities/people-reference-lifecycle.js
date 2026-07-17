'use strict';

const REFERENCE_DECISION_SCHEMA = 'helix://contracts/domain-types/PeopleReferenceMaintenanceDecision/v1';
const REFERENCE_RESULT_SCHEMA = 'helix://contracts/types/PersonReferenceRevision/v1';

class PeopleReferenceLifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PeopleReferenceLifecycleError';
    this.code = code;
  }
}

function requireMethod(target, method, code) {
  if (!target || typeof target[method] !== 'function') throw new PeopleReferenceLifecycleError(code, method + ' is required.');
}

function createPeopleReferenceCommitRegistration(store) {
  requireMethod(store, 'createReferenceCommitParticipant', 'P6_PEOPLE_REFERENCE_STORE_REQUIRED');
  return Object.freeze({
    ownerDomain: 'people', aggregateType: 'person-reference', factType: 'PeopleReferenceMaintenanceDecision',
    factSchemaRef: REFERENCE_DECISION_SCHEMA, resultSchemaRef: REFERENCE_RESULT_SCHEMA,
    effectClass: 'domain_fact_commit', revisionFence: true,
    createParticipant({ handle, payload }) { return store.createReferenceCommitParticipant(handle, payload); }
  });
}

function createPersonReferenceQuery(store) {
  requireMethod(store, 'getPersonReferenceProjection', 'P6_PEOPLE_REFERENCE_QUERY_STORE_REQUIRED');
  return Object.freeze({
    getPersonReferenceProjection(input) {
      if (!input || Object.keys(input).length !== 1 || typeof input.personId !== 'string' || input.personId.length < 1) {
        throw new PeopleReferenceLifecycleError('P6_PEOPLE_REFERENCE_QUERY_INPUT', 'Reference query requires exactly one personId.');
      }
      return store.getPersonReferenceProjection(input.personId);
    }
  });
}

function createReferenceImageCommands(coordinator) {
  requireMethod(coordinator, 'addReferenceImage', 'P6_PEOPLE_REFERENCE_COORDINATOR_REQUIRED');
  requireMethod(coordinator, 'releaseReferenceImage', 'P6_PEOPLE_REFERENCE_COORDINATOR_REQUIRED');
  return Object.freeze({
    addReferenceImage(command) { return coordinator.addReferenceImage(command); },
    releaseReferenceImage(command) { return coordinator.releaseReferenceImage(command); }
  });
}

module.exports = Object.freeze({
  PeopleReferenceLifecycleError, createPeopleReferenceCommitRegistration, createPersonReferenceQuery, createReferenceImageCommands
});
