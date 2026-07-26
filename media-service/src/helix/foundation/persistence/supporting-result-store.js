'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('./owner-repository');

class SupportingResultStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SupportingResultStoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SupportingResultStoreError(code, message);
}

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'foundation_supporting_result',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      find_event: {
        kind: 'select-one',
        tableId: 'fx_workflow_events',
        columns: [
          'event_id', 'owner_domain', 'capability_ref', 'state', 'result_id',
        ],
        keyColumns: ['event_id'],
      },
      find_result: {
        kind: 'select-one',
        tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'event_id', 'result_schema_ref', 'result_json',
          'result_digest', 'evidence_digest',
        ],
        keyColumns: ['result_id'],
      },
      insert_result: {
        kind: 'insert',
        tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
          'result_json', 'result_digest', 'evidence_schema_ref',
          'evidence_json', 'evidence_digest', 'effect_receipt_id',
          'committed_at_ms',
        ],
      },
    },
  });
}

function createSupportingResultStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('SUPPORTING_RESULT_DEPENDENCIES',
      'Supporting Result persistence requires Foundation storage.');
  }
  const repository = definition(options.schemaManifest);
  function commit(request) {
    if (!request || typeof request.resultId !== 'string' || !request.resultId ||
        typeof request.eventId !== 'string' || !request.eventId ||
        typeof request.ownerDomain !== 'string' || !request.ownerDomain ||
        typeof request.capabilityRef !== 'string' || !request.capabilityRef ||
        typeof request.resultSchemaRef !== 'string' || !request.resultSchemaRef ||
        !request.result || typeof request.result !== 'object') {
      fail('SUPPORTING_RESULT_INPUT', 'Supporting Result input is incomplete.');
    }
    const resultJson = canonicalJson(request.result);
    const resultDigest = canonicalDigest(request.result);
    const evidence = request.evidence || request.result;
    const evidenceSchemaRef = request.evidenceSchemaRef || request.resultSchemaRef;
    const evidenceJson = canonicalJson(evidence);
    const evidenceDigest = request.evidenceDigest || canonicalDigest(evidence);
    return options.unitOfWork.execute([{
      participantId: 'foundation_supporting_result_commit',
      owner: 'execution-foundation',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const event = repo.invoke('find_event', { event_id: request.eventId });
        if (!event || event.owner_domain !== request.ownerDomain ||
            event.capability_ref !== request.capabilityRef ||
            !['executing', 'succeeded'].includes(event.state)) {
          fail('SUPPORTING_RESULT_EVENT_FENCE',
            'Supporting Result event is absent or outside its typed capability.');
        }
        const existing = repo.invoke('find_result', {
          result_id: request.resultId,
        });
        if (existing) {
          if (existing.event_id !== request.eventId ||
              existing.result_schema_ref !== request.resultSchemaRef ||
              existing.result_digest !== resultDigest ||
              existing.evidence_digest !== evidenceDigest ||
              existing.result_json !== resultJson) {
            fail('SUPPORTING_RESULT_REPLAY_CONFLICT',
              'Supporting Result identity already binds another typed value.');
          }
          return Object.freeze({ replayed: true, resultId: request.resultId, resultDigest });
        }
        repo.invoke('insert_result', {
          result_id: request.resultId,
          event_id: request.eventId,
          outcome_kind: 'succeeded',
          result_schema_ref: request.resultSchemaRef,
          result_json: resultJson,
          result_digest: resultDigest,
          evidence_schema_ref: evidenceSchemaRef,
          evidence_json: evidenceJson,
          evidence_digest: evidenceDigest,
          effect_receipt_id: request.effectReceiptId || null,
          committed_at_ms: context.commitTimeMs,
        });
        return Object.freeze({ replayed: false, resultId: request.resultId, resultDigest });
      },
    }]).foundation_supporting_result_commit;
  }
  function readEventResult(eventId) {
    if (typeof eventId !== 'string' || !eventId) {
      fail('SUPPORTING_RESULT_INPUT', 'Supporting Result event identity is required.');
    }
    return options.unitOfWork.execute([{
      participantId: 'foundation_supporting_result_read',
      owner: 'execution-foundation',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const event = repo.invoke('find_event', { event_id: eventId });
        if (!event || event.state !== 'succeeded' || !event.result_id) return null;
        const existing = repo.invoke('find_result', {
          result_id: event.result_id,
        });
        if (!existing || existing.event_id !== eventId) {
          fail('SUPPORTING_RESULT_REPLAY_CORRUPT',
            'Succeeded Event lacks its exact typed Result.');
        }
        let result;
        try {
          result = JSON.parse(existing.result_json);
        } catch {
          fail('SUPPORTING_RESULT_REPLAY_CORRUPT',
            'Stored Supporting Result JSON is corrupt.');
        }
        if (canonicalDigest(result) !== existing.result_digest) {
          fail('SUPPORTING_RESULT_REPLAY_CORRUPT',
            'Stored Supporting Result digest is corrupt.');
        }
        return Object.freeze({
          resultId: existing.result_id,
          resultSchemaRef: existing.result_schema_ref,
          result: Object.freeze(result),
          resultDigest: existing.result_digest,
          evidenceDigest: existing.evidence_digest,
        });
      },
    }]).foundation_supporting_result_read;
  }
  function recoverCommittedEventResult(request) {
    if (!request || typeof request.eventId !== 'string' || !request.eventId ||
        typeof request.resultId !== 'string' || !request.resultId ||
        typeof request.ownerDomain !== 'string' || !request.ownerDomain ||
        typeof request.capabilityRef !== 'string' || !request.capabilityRef ||
        typeof request.resultSchemaRef !== 'string' || !request.resultSchemaRef) {
      fail('SUPPORTING_RESULT_INPUT',
        'Supporting Result recovery requires one exact Event and Result identity.');
    }
    return options.unitOfWork.execute([{
      participantId: 'foundation_supporting_result_recover',
      owner: 'execution-foundation',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const event = repo.invoke('find_event', { event_id: request.eventId });
        if (!event || event.owner_domain !== request.ownerDomain ||
            event.capability_ref !== request.capabilityRef ||
            !['executing', 'succeeded'].includes(event.state)) {
          fail('SUPPORTING_RESULT_EVENT_FENCE',
            'Recoverable Supporting Result is outside its exact Event fence.');
        }
        const existing = repo.invoke('find_result', { result_id: request.resultId });
        if (!existing) return null;
        if (existing.event_id !== request.eventId ||
            existing.result_schema_ref !== request.resultSchemaRef ||
            (event.result_id !== null && event.result_id !== request.resultId)) {
          fail('SUPPORTING_RESULT_REPLAY_CORRUPT',
            'Recoverable Supporting Result violates its stable typed identity.');
        }
        let result;
        try {
          result = JSON.parse(existing.result_json);
        } catch {
          fail('SUPPORTING_RESULT_REPLAY_CORRUPT',
            'Recoverable Supporting Result JSON is corrupt.');
        }
        if (canonicalDigest(result) !== existing.result_digest) {
          fail('SUPPORTING_RESULT_REPLAY_CORRUPT',
            'Recoverable Supporting Result digest is corrupt.');
        }
        return Object.freeze({
          resultId: existing.result_id,
          resultSchemaRef: existing.result_schema_ref,
          result: Object.freeze(result),
          resultDigest: existing.result_digest,
          evidenceDigest: existing.evidence_digest,
          eventState: event.state,
        });
      },
    }]).foundation_supporting_result_recover;
  }
  return Object.freeze({ commit, readEventResult, recoverCommittedEventResult });
}

module.exports = Object.freeze({
  SupportingResultStoreError,
  createSupportingResultStore,
});
