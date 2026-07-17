'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  PEOPLE_CANDIDATE_DRAFT_SCHEMA, createMergeCandidate, createMergeRecord, createPerson, createPersonRevision,
  createPreference, createReferenceAsset, createReferenceFace, createRegistrationCandidate
} = require('../model/people-store-contracts');

class PeopleStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PeopleStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new PeopleStoreError(code, message, details); }
function exactInput(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail(code, 'People Store input does not match its closed contract.');
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }

function personRegistryDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'person_registry_repository', owner: 'people', schemaManifest,
    statements: {
      insert_person: { kind: 'insert', tableId: 'people_persons', columns: ['person_id', 'status', 'current_revision', 'created_at_ms', 'terminal_at_ms'] },
      find_person: { kind: 'select-one', tableId: 'people_persons', columns: ['person_id', 'status', 'current_revision', 'created_at_ms', 'terminal_at_ms'], keyColumns: ['person_id'] },
      advance_person_head: { kind: 'update', tableId: 'people_persons', setColumns: ['current_revision'], keyColumns: ['person_id'],
        compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] },
      initialize_person_head: { kind: 'update', tableId: 'people_persons', setColumns: ['current_revision'], keyColumns: ['person_id'] },
      terminal_person: { kind: 'update', tableId: 'people_persons', setColumns: ['status', 'terminal_at_ms'], keyColumns: ['person_id'],
        compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }, { column: 'status', parameter: 'expected_status' }] },
      insert_person_revision: { kind: 'insert', tableId: 'people_person_revisions', columns: [
        'person_id', 'revision', 'canonical_name', 'content_scope', 'fact_digest', 'committed_at_ms'
      ] },
      find_person_revision: { kind: 'select-one', tableId: 'people_person_revisions', columns: [
        'person_id', 'revision', 'canonical_name', 'content_scope', 'fact_digest', 'committed_at_ms'
      ], keyColumns: ['person_id', 'revision'] },
      insert_alias: { kind: 'insert', tableId: 'people_aliases', columns: [
        'person_id', 'revision', 'alias_normalized', 'alias_display', 'provenance_digest'
      ] },
      find_aliases: { kind: 'select-all', tableId: 'people_aliases', columns: [
        'person_id', 'revision', 'alias_normalized', 'alias_display', 'provenance_digest'
      ], keyColumns: ['person_id', 'revision'] },
      deactivate_provider_identities: { kind: 'update', tableId: 'people_provider_identities', setColumns: ['active_guard'], keyColumns: ['person_id'] },
      insert_provider_identity: { kind: 'insert', tableId: 'people_provider_identities', columns: [
        'person_id', 'revision', 'provider', 'namespace', 'provider_key', 'provenance_digest', 'active_guard'
      ] },
      find_provider_identities: { kind: 'select-all', tableId: 'people_provider_identities', columns: [
        'person_id', 'revision', 'provider', 'namespace', 'provider_key', 'provenance_digest', 'active_guard'
      ], keyColumns: ['person_id', 'revision'] },
      insert_preference: { kind: 'insert', tableId: 'people_preference_revisions', columns: [
        'person_id', 'revision', 'preference_level', 'reason', 'committed_at_ms'
      ] },
      find_preference: { kind: 'select-one', tableId: 'people_preference_revisions', columns: [
        'person_id', 'revision', 'preference_level', 'reason', 'committed_at_ms'
      ], keyColumns: ['person_id', 'revision'] },
      insert_reference_asset: { kind: 'insert', tableId: 'people_reference_assets', columns: [
        'reference_asset_id', 'person_id', 'artifact_handle_id', 'artifact_digest', 'state', 'created_at_ms'
      ] },
      find_reference_asset: { kind: 'select-one', tableId: 'people_reference_assets', columns: [
        'reference_asset_id', 'person_id', 'artifact_handle_id', 'artifact_digest', 'state', 'created_at_ms'
      ], keyColumns: ['reference_asset_id'] },
      insert_reference_face: { kind: 'insert', tableId: 'people_reference_faces', columns: [
        'reference_face_id', 'person_id', 'reference_asset_id', 'embedding_handle_id', 'model_ref', 'state', 'created_at_ms'
      ] },
      find_reference_face: { kind: 'select-one', tableId: 'people_reference_faces', columns: [
        'reference_face_id', 'person_id', 'reference_asset_id', 'embedding_handle_id', 'model_ref', 'state', 'created_at_ms'
      ], keyColumns: ['reference_face_id'] }
    }
  });
}

function candidateDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'people_candidate_repository', owner: 'people', schemaManifest,
    statements: {
      insert_registration_candidate: { kind: 'insert', tableId: 'people_registration_candidates', columns: [
        'registration_candidate_id', 'proposed_name', 'evidence_digest', 'candidate_schema_ref', 'candidate_json', 'state', 'created_at_ms', 'terminal_at_ms'
      ] },
      find_registration_candidate: { kind: 'select-one', tableId: 'people_registration_candidates', columns: [
        'registration_candidate_id', 'proposed_name', 'evidence_digest', 'candidate_schema_ref', 'candidate_json', 'state', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: ['registration_candidate_id'] },
      transition_registration_candidate: { kind: 'update', tableId: 'people_registration_candidates', setColumns: ['state', 'terminal_at_ms'],
        keyColumns: ['registration_candidate_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      insert_merge_candidate: { kind: 'insert', tableId: 'people_merge_candidates', columns: [
        'merge_candidate_id', 'left_person_id', 'right_person_id', 'evidence_digest', 'state', 'created_at_ms', 'terminal_at_ms'
      ] },
      find_merge_candidate: { kind: 'select-one', tableId: 'people_merge_candidates', columns: [
        'merge_candidate_id', 'left_person_id', 'right_person_id', 'evidence_digest', 'state', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: ['merge_candidate_id'] },
      transition_merge_candidate: { kind: 'update', tableId: 'people_merge_candidates', setColumns: ['state', 'terminal_at_ms'],
        keyColumns: ['merge_candidate_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      insert_merge_record: { kind: 'insert', tableId: 'people_merge_records', columns: [
        'merge_record_id', 'source_person_id', 'target_person_id', 'decision_digest', 'committed_at_ms'
      ] },
      find_merge_record: { kind: 'select-one', tableId: 'people_merge_records', columns: [
        'merge_record_id', 'source_person_id', 'target_person_id', 'decision_digest', 'committed_at_ms'
      ], keyColumns: ['merge_record_id'] },
      find_merge_record_by_source: { kind: 'select-one', tableId: 'people_merge_records', columns: [
        'merge_record_id', 'source_person_id', 'target_person_id', 'decision_digest', 'committed_at_ms'
      ], keyColumns: ['source_person_id'] }
    }
  });
}

function createPeopleStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P6_PEOPLE_STORE_DEPENDENCIES', 'Schema manifest and People unit of work are required.');
  }
  const registry = personRegistryDefinition(options.schemaManifest);
  const candidates = candidateDefinition(options.schemaManifest);
  function execute(repositories, body, participantId = 'people_store') {
    return options.unitOfWork.execute([{ participantId, owner: 'people', repositories, execute: body }])[participantId];
  }
  function writeRevision(repository, input, committedAtMs, initialize) {
    const next = createPersonRevision({ ...input, committedAtMs });
    if (!initialize) repository.invoke('deactivate_provider_identities', { active_guard: 0, person_id: next.personId });
    repository.invoke('insert_person_revision', revisionRow(next));
    for (const alias of next.aliases) repository.invoke('insert_alias', {
      person_id: next.personId, revision: next.revision, alias_normalized: alias.aliasNormalized,
      alias_display: alias.aliasDisplay, provenance_digest: alias.provenanceDigest
    });
    for (const identity of next.providerIdentities) repository.invoke('insert_provider_identity', {
      person_id: next.personId, revision: next.revision, provider: identity.provider, namespace: identity.namespace,
      provider_key: identity.providerKey, provenance_digest: identity.provenanceDigest, active_guard: 1
    });
    return next;
  }
  const repositoryManifest = Object.freeze({ components: Object.freeze([
    Object.freeze({ component: 'PersonRegistryRepository', repositoryId: registry.repositoryId, tableIds: registry.tableIds }),
    Object.freeze({ component: 'PeopleCandidateRepository', repositoryId: candidates.repositoryId, tableIds: candidates.tableIds })
  ]) });

  return Object.freeze({
    repositoryManifest,
    registerPerson(input) {
      exactInput(input, ['personId', 'canonicalName', 'contentScope', 'factDigest', 'aliases', 'providerIdentities'], 'P6_PEOPLE_PERSON_INPUT');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        repository.invoke('insert_person', {
          person_id: input.personId, status: 'active', current_revision: null, created_at_ms: context.commitTimeMs, terminal_at_ms: null
        });
        const next = writeRevision(repository, { ...input, revision: 1 }, context.commitTimeMs, true);
        const advanced = repository.invoke('initialize_person_head', { current_revision: 1, person_id: input.personId });
        if (advanced.changes !== 1) fail('P6_PEOPLE_PERSON_HEAD_INITIALIZE', 'Person head initialization failed.');
        return mapPerson(repository, repository.invoke('find_person', { person_id: next.personId }));
      });
    },
    revisePerson(input, expectedRevision) {
      exactInput(input, ['personId', 'revision', 'canonicalName', 'contentScope', 'factDigest', 'aliases', 'providerIdentities'], 'P6_PEOPLE_PERSON_INPUT');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const current = repository.invoke('find_person', { person_id: input.personId });
        if (!current) fail('P6_PEOPLE_PERSON_NOT_FOUND', 'Person does not exist.');
        if (current.status !== 'active') fail('P6_PEOPLE_PERSON_TERMINAL', 'A terminal Person cannot receive a new revision.');
        if (current.current_revision !== expectedRevision || input.revision !== expectedRevision + 1) {
          fail('P6_PEOPLE_PERSON_REVISION_CONFLICT', 'Person revision is stale or skipped.');
        }
        writeRevision(repository, input, context.commitTimeMs, false);
        const advanced = repository.invoke('advance_person_head', {
          current_revision: input.revision, person_id: input.personId, expected_current_revision: expectedRevision
        });
        if (advanced.changes !== 1) fail('P6_PEOPLE_PERSON_REVISION_CONFLICT', 'Person head changed concurrently.');
        return mapPerson(repository, repository.invoke('find_person', { person_id: input.personId }));
      });
    },
    terminalPerson(personId, expectedRevision, state) {
      if (!['merged', 'archived'].includes(state)) fail('P6_PEOPLE_PERSON_TERMINAL_STATE', 'Person terminal state must be merged or archived.');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const result = repository.invoke('terminal_person', {
          status: state, terminal_at_ms: context.commitTimeMs, person_id: personId,
          expected_current_revision: expectedRevision, expected_status: 'active'
        });
        if (result.changes !== 1) fail('P6_PEOPLE_PERSON_REVISION_CONFLICT', 'Person terminal fence failed.');
        return mapPerson(repository, repository.invoke('find_person', { person_id: personId }));
      });
    },
    getPerson(personId) {
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        return mapPerson(repository, repository.invoke('find_person', { person_id: personId }));
      });
    },
    appendPreference(input) {
      exactInput(input, ['personId', 'revision', 'preferenceLevel', 'reason'], 'P6_PEOPLE_PREFERENCE_INPUT');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        if (!repository.invoke('find_person', { person_id: input.personId })) fail('P6_PEOPLE_PERSON_NOT_FOUND', 'Person does not exist.');
        const item = createPreference({ ...input, committedAtMs: context.commitTimeMs });
        repository.invoke('insert_preference', preferenceRow(item));
        return item;
      });
    },
    getPreference(personId, revision) {
      return execute([registry], (context) => mapPreference(context.repository(registry.repositoryId).invoke('find_preference', {
        person_id: personId, revision
      })));
    },
    addReferenceAsset(input) {
      exactInput(input, ['referenceAssetId', 'personId', 'artifactHandleId', 'artifactDigest', 'state'], 'P6_PEOPLE_REFERENCE_ASSET_INPUT');
      return execute([registry], (context) => {
        const item = createReferenceAsset({ ...input, createdAtMs: context.commitTimeMs });
        context.repository(registry.repositoryId).invoke('insert_reference_asset', assetRow(item));
        return item;
      });
    },
    addReferenceFace(input) {
      exactInput(input, ['referenceFaceId', 'personId', 'referenceAssetId', 'embeddingHandleId', 'modelRef', 'state'], 'P6_PEOPLE_REFERENCE_FACE_INPUT');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const asset = repository.invoke('find_reference_asset', { reference_asset_id: input.referenceAssetId });
        if (!asset || asset.person_id !== input.personId) fail('P6_PEOPLE_REFERENCE_ASSET_OWNER_MISMATCH', 'Reference Face requires an Asset owned by the same Person.');
        const item = createReferenceFace({ ...input, createdAtMs: context.commitTimeMs });
        repository.invoke('insert_reference_face', faceRow(item));
        return item;
      });
    },
    getReferenceAsset(referenceAssetId) {
      return execute([registry], (context) => mapAsset(context.repository(registry.repositoryId).invoke('find_reference_asset', { reference_asset_id: referenceAssetId })));
    },
    getReferenceFace(referenceFaceId) {
      return execute([registry], (context) => mapFace(context.repository(registry.repositoryId).invoke('find_reference_face', { reference_face_id: referenceFaceId })));
    },
    openRegistrationCandidate(input) {
      exactInput(input, ['registrationCandidateId', 'proposedName', 'evidenceDigest', 'candidatePayload'], 'P6_PEOPLE_REGISTRATION_CANDIDATE_INPUT');
      return execute([candidates], (context) => {
        const item = createRegistrationCandidate({
          ...input, candidateSchemaRef: PEOPLE_CANDIDATE_DRAFT_SCHEMA, state: 'open', createdAtMs: context.commitTimeMs, terminalAtMs: null
        });
        const candidateJson = canonicalJson(item.candidatePayload);
        if (new TextEncoder().encode(candidateJson).byteLength > 16384) fail('P6_PEOPLE_CANDIDATE_PAYLOAD_TOO_LARGE', 'Candidate payload exceeds 16 KiB.');
        context.repository(candidates.repositoryId).invoke('insert_registration_candidate', registrationCandidateRow(item, candidateJson));
        return item;
      }, 'people_candidate_store');
    },
    terminalRegistrationCandidate(candidateId, state) {
      if (!['accepted', 'dismissed', 'superseded'].includes(state)) fail('P6_PEOPLE_CANDIDATE_TERMINAL_STATE', 'Candidate terminal state is invalid.');
      return execute([candidates], (context) => {
        const repository = context.repository(candidates.repositoryId);
        const result = repository.invoke('transition_registration_candidate', {
          state, terminal_at_ms: context.commitTimeMs, registration_candidate_id: candidateId, expected_state: 'open'
        });
        if (result.changes !== 1) fail('P6_PEOPLE_CANDIDATE_STATE_CONFLICT', 'Registration Candidate is missing or no longer open.');
        return mapRegistrationCandidate(repository.invoke('find_registration_candidate', { registration_candidate_id: candidateId }));
      }, 'people_candidate_store');
    },
    getRegistrationCandidate(candidateId) {
      return execute([candidates], (context) => mapRegistrationCandidate(context.repository(candidates.repositoryId).invoke(
        'find_registration_candidate', { registration_candidate_id: candidateId }
      )), 'people_candidate_store');
    },
    openMergeCandidate(input) {
      exactInput(input, ['mergeCandidateId', 'leftPersonId', 'rightPersonId', 'evidenceDigest'], 'P6_PEOPLE_MERGE_CANDIDATE_INPUT');
      return execute([candidates, registry], (context) => {
        const people = context.repository(registry.repositoryId);
        const item = createMergeCandidate({ ...input, state: 'open', createdAtMs: context.commitTimeMs, terminalAtMs: null });
        if (!people.invoke('find_person', { person_id: item.leftPersonId }) || !people.invoke('find_person', { person_id: item.rightPersonId })) {
          fail('P6_PEOPLE_MERGE_PERSON_MISSING', 'Merge Candidate requires two existing Persons.');
        }
        context.repository(candidates.repositoryId).invoke('insert_merge_candidate', mergeCandidateRow(item));
        return item;
      }, 'people_candidate_store');
    },
    terminalMergeCandidate(candidateId, state) {
      if (!['accepted', 'dismissed', 'superseded'].includes(state)) fail('P6_PEOPLE_CANDIDATE_TERMINAL_STATE', 'Candidate terminal state is invalid.');
      return execute([candidates], (context) => {
        const repository = context.repository(candidates.repositoryId);
        const result = repository.invoke('transition_merge_candidate', {
          state, terminal_at_ms: context.commitTimeMs, merge_candidate_id: candidateId, expected_state: 'open'
        });
        if (result.changes !== 1) fail('P6_PEOPLE_CANDIDATE_STATE_CONFLICT', 'Merge Candidate is missing or no longer open.');
        return mapMergeCandidate(repository.invoke('find_merge_candidate', { merge_candidate_id: candidateId }));
      }, 'people_candidate_store');
    },
    getMergeCandidate(candidateId) {
      return execute([candidates], (context) => mapMergeCandidate(context.repository(candidates.repositoryId).invoke(
        'find_merge_candidate', { merge_candidate_id: candidateId }
      )), 'people_candidate_store');
    },
    appendMergeRecord(input) {
      exactInput(input, ['mergeRecordId', 'sourcePersonId', 'targetPersonId', 'decisionDigest'], 'P6_PEOPLE_MERGE_RECORD_INPUT');
      return execute([candidates, registry], (context) => {
        const repository = context.repository(candidates.repositoryId);
        if (repository.invoke('find_merge_record_by_source', { source_person_id: input.sourcePersonId })) {
          fail('P6_PEOPLE_MERGE_SOURCE_ALREADY_TERMINAL', 'Source Person already has a terminal Merge Record.');
        }
        const people = context.repository(registry.repositoryId);
        if (!people.invoke('find_person', { person_id: input.sourcePersonId }) || !people.invoke('find_person', { person_id: input.targetPersonId })) {
          fail('P6_PEOPLE_MERGE_PERSON_MISSING', 'Merge Record requires two existing Persons.');
        }
        const item = createMergeRecord({ ...input, committedAtMs: context.commitTimeMs });
        repository.invoke('insert_merge_record', mergeRecordRow(item));
        return item;
      }, 'people_candidate_store');
    }
  });
}

function mapPerson(repository, row) {
  if (!row) return undefined;
  const revision = repository.invoke('find_person_revision', { person_id: row.person_id, revision: row.current_revision });
  if (!revision) fail('P6_PEOPLE_PERSON_HEAD_CORRUPT', 'Person head does not point to an immutable revision.');
  return createPerson({
    personId: row.person_id, status: row.status, currentRevision: row.current_revision, createdAtMs: row.created_at_ms, terminalAtMs: row.terminal_at_ms,
    revision: {
      personId: revision.person_id, revision: revision.revision, canonicalName: revision.canonical_name, contentScope: revision.content_scope,
      factDigest: revision.fact_digest, committedAtMs: revision.committed_at_ms,
      aliases: repository.invoke('find_aliases', { person_id: row.person_id, revision: row.current_revision }).map((item) => ({
        aliasNormalized: item.alias_normalized, aliasDisplay: item.alias_display, provenanceDigest: item.provenance_digest
      })).sort((a, b) => a.aliasNormalized.localeCompare(b.aliasNormalized)),
      providerIdentities: repository.invoke('find_provider_identities', { person_id: row.person_id, revision: row.current_revision }).map((item) => ({
        provider: item.provider, namespace: item.namespace, providerKey: item.provider_key, provenanceDigest: item.provenance_digest
      })).sort((a, b) => [a.provider, a.namespace, a.providerKey].join('\u0000').localeCompare([b.provider, b.namespace, b.providerKey].join('\u0000')))
    }
  });
}
function revisionRow(item) { return { person_id: item.personId, revision: item.revision, canonical_name: item.canonicalName,
  content_scope: item.contentScope, fact_digest: item.factDigest, committed_at_ms: item.committedAtMs }; }
function preferenceRow(item) { return { person_id: item.personId, revision: item.revision, preference_level: item.preferenceLevel,
  reason: item.reason, committed_at_ms: item.committedAtMs }; }
function mapPreference(row) { return row && createPreference({ personId: row.person_id, revision: row.revision,
  preferenceLevel: row.preference_level, reason: row.reason, committedAtMs: row.committed_at_ms }); }
function assetRow(item) { return { reference_asset_id: item.referenceAssetId, person_id: item.personId, artifact_handle_id: item.artifactHandleId,
  artifact_digest: item.artifactDigest, state: item.state, created_at_ms: item.createdAtMs }; }
function mapAsset(row) { return row && createReferenceAsset({ referenceAssetId: row.reference_asset_id, personId: row.person_id,
  artifactHandleId: row.artifact_handle_id, artifactDigest: row.artifact_digest, state: row.state, createdAtMs: row.created_at_ms }); }
function faceRow(item) { return { reference_face_id: item.referenceFaceId, person_id: item.personId, reference_asset_id: item.referenceAssetId,
  embedding_handle_id: item.embeddingHandleId, model_ref: item.modelRef, state: item.state, created_at_ms: item.createdAtMs }; }
function mapFace(row) { return row && createReferenceFace({ referenceFaceId: row.reference_face_id, personId: row.person_id,
  referenceAssetId: row.reference_asset_id, embeddingHandleId: row.embedding_handle_id, modelRef: row.model_ref,
  state: row.state, createdAtMs: row.created_at_ms }); }
function registrationCandidateRow(item, candidateJson) { return { registration_candidate_id: item.registrationCandidateId,
  proposed_name: item.proposedName, evidence_digest: item.evidenceDigest, candidate_schema_ref: item.candidateSchemaRef,
  candidate_json: candidateJson, state: item.state, created_at_ms: item.createdAtMs, terminal_at_ms: item.terminalAtMs }; }
function mapRegistrationCandidate(row) { return row && createRegistrationCandidate({ registrationCandidateId: row.registration_candidate_id,
  proposedName: row.proposed_name, evidenceDigest: row.evidence_digest, candidateSchemaRef: row.candidate_schema_ref,
  candidatePayload: JSON.parse(row.candidate_json), state: row.state, createdAtMs: row.created_at_ms, terminalAtMs: row.terminal_at_ms }); }
function mergeCandidateRow(item) { return { merge_candidate_id: item.mergeCandidateId, left_person_id: item.leftPersonId,
  right_person_id: item.rightPersonId, evidence_digest: item.evidenceDigest, state: item.state,
  created_at_ms: item.createdAtMs, terminal_at_ms: item.terminalAtMs }; }
function mapMergeCandidate(row) { return row && createMergeCandidate({ mergeCandidateId: row.merge_candidate_id, leftPersonId: row.left_person_id,
  rightPersonId: row.right_person_id, evidenceDigest: row.evidence_digest, state: row.state,
  createdAtMs: row.created_at_ms, terminalAtMs: row.terminal_at_ms }); }
function mergeRecordRow(item) { return { merge_record_id: item.mergeRecordId, source_person_id: item.sourcePersonId,
  target_person_id: item.targetPersonId, decision_digest: item.decisionDigest, committed_at_ms: item.committedAtMs }; }

module.exports = Object.freeze({ PeopleStoreError, createPeopleStore });
