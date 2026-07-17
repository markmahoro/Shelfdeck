'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const CANDIDATE_DRAFT_SCHEMA = 'helix://contracts/types/PeopleCandidateDraft/v1';
const ACCEPTANCE_DECISION_SCHEMA = 'helix://contracts/domain-types/PeopleCandidateAcceptanceDecision/v1';

class PeopleRegistrationLifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PeopleRegistrationLifecycleError';
    this.code = code;
  }
}

function requireStore(store, method) {
  if (!store || typeof store[method] !== 'function') {
    throw new PeopleRegistrationLifecycleError('P6_PEOPLE_REGISTRATION_STORE_REQUIRED',
      'People Store ' + method + ' participant factory is required.');
  }
}

function createPeopleCandidateCommitRegistration(store) {
  requireStore(store, 'createCandidateCommitParticipant');
  return Object.freeze({
    ownerDomain: 'people', aggregateType: 'people-candidate', factType: 'PeopleCandidateDraft',
    factSchemaRef: CANDIDATE_DRAFT_SCHEMA, effectClass: 'domain_fact_commit', revisionFence: true,
    createParticipant({ handle, payload }) { return store.createCandidateCommitParticipant(handle, payload); }
  });
}

function createPeopleCandidateAcceptanceRegistration(store) {
  requireStore(store, 'createRegistrationAcceptanceParticipant');
  requireStore(store, 'createMergeAcceptanceParticipant');
  return Object.freeze({
    ownerDomain: 'people', aggregateType: 'person', factType: 'PeopleCandidateAcceptanceDecision',
    factSchemaRef: ACCEPTANCE_DECISION_SCHEMA, effectClass: 'domain_fact_commit', revisionFence: true,
    createParticipant({ handle, payload }) {
      return payload && payload.candidateKind === 'merge'
        ? store.createMergeAcceptanceParticipant(handle, payload)
        : store.createRegistrationAcceptanceParticipant(handle, payload);
    }
  });
}

function createDirectPersonRegistrationCommand(store, commandCoordinator) {
  requireStore(store, 'createDirectRegistrationParticipant');
  if (!commandCoordinator || typeof commandCoordinator.execute !== 'function') {
    throw new PeopleRegistrationLifecycleError('P6_PEOPLE_DIRECT_COMMAND_COORDINATOR_REQUIRED',
      'Direct Person Registration requires the Foundation command coordinator.');
  }
  return Object.freeze({
    registerPerson(decision) {
      const scopeId = decision && decision.newPersonId;
      const decisionId = decision && decision.decisionId;
      return commandCoordinator.execute({
        command: { commandReceiptId: 'people-registration-' + decisionId, ownerDomain: 'people',
          commandContract: 'people.register-person@1', callerScope: decision.actorId, idempotencyKey: decisionId,
          requestDigest: decision.decisionDigest, targetType: 'person', targetId: scopeId },
        domainParticipant: store.createDirectRegistrationParticipant(decision),
        commitMarker: { commitMarker: 'people-registration-' + decisionId, effectId: null, scopeType: 'person', scopeId,
          commitDigest: canonicalDigest({ commandContract: 'people.register-person@1', decisionDigest: decision.decisionDigest, scopeId }) },
        auditRecords: [{ auditId: 'people-registration-audit-' + decisionId, actorType: 'admin', actorId: decision.actorId,
          action: 'people.person.register', scopeType: 'person', scopeId, evidenceDigest: decision.decisionDigest }],
        outboxMessages: [{ messageId: 'people-registration-message-' + decisionId, producerDomain: 'people',
          messageKind: 'people.person.registered', aggregateType: 'person', aggregateId: scopeId, aggregateRevision: 1,
          dedupKey: 'person-registered/' + decisionId, intendedConsumers: ['people-projection'],
          payloadSchemaRef: 'helix://contracts/signals/people-person-registered/v1',
          payload: { personId: scopeId, personRevision: 1 } }],
        resultEnvelope(person) {
          return { resultSchemaRef: 'helix://contracts/types/PersonRevision/v1',
            resultRef: { personId: person.personId, personRevision: person.currentRevision,
              referenceProjectionRevision: person.currentReferenceProjectionRevision,
              personFactDigest: person.revision.factDigest } };
        }
      });
    }
  });
}

module.exports = Object.freeze({
  PeopleRegistrationLifecycleError, createPeopleCandidateCommitRegistration, createPeopleCandidateAcceptanceRegistration,
  createDirectPersonRegistrationCommand
});
