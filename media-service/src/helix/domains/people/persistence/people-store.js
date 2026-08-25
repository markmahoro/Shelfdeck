'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const {
  PEOPLE_CANDIDATE_DRAFT_SCHEMA, createCandidate, createCandidateDraft, createCandidateRevision, createPerson,
  createPersonRevision, createPreference, createReferenceAsset, createReferenceFace
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
function boundedJson(value) {
  const json = canonicalJson(value);
  if (new TextEncoder().encode(json).byteLength > 16384) fail('P6_PEOPLE_CANDIDATE_PAYLOAD_TOO_LARGE', 'Candidate payload exceeds 16 KiB.');
  return json;
}
const REFERENCE_PROJECTION_CONTRACT = 'people.person-reference-projection@1';
function utf8Compare(left, right) { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')); }
function without(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function initialProjectionDigest(personId, personRevision = 1) {
  return canonicalDigest({ projectionContract: REFERENCE_PROJECTION_CONTRACT, personId, personRevision,
    currentReferenceRevision: null, contributions: [] });
}

function personRegistryDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'person_registry_repository', owner: 'people', schemaManifest,
    statements: {
      insert_person: { kind: 'insert', tableId: 'people_persons', columns: [
        'person_id', 'status', 'current_revision', 'current_preference_revision', 'current_reference_revision',
        'current_reference_projection_revision', 'current_reference_projection_digest', 'created_at_ms', 'terminal_at_ms'
      ] },
      find_person: { kind: 'select-one', tableId: 'people_persons', columns: [
        'person_id', 'status', 'current_revision', 'current_preference_revision', 'current_reference_revision',
        'current_reference_projection_revision', 'current_reference_projection_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: ['person_id'] },
      list_people: { kind: 'select-all', tableId: 'people_persons', columns: [
        'person_id', 'status', 'current_revision', 'current_preference_revision', 'current_reference_revision',
        'current_reference_projection_revision', 'current_reference_projection_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: [] },
      advance_person_head: { kind: 'update', tableId: 'people_persons', setColumns: ['status', 'current_revision', 'terminal_at_ms'],
        keyColumns: ['person_id'], compareColumns: [
          { column: 'current_revision', parameter: 'expected_current_revision' }, { column: 'status', parameter: 'expected_status' }
        ] },
      initialize_preference_head: { kind: 'update', tableId: 'people_persons', setColumns: ['current_preference_revision'], keyColumns: ['person_id'] },
      advance_preference_head: { kind: 'update', tableId: 'people_persons', setColumns: ['current_preference_revision'], keyColumns: ['person_id'],
        compareColumns: [{ column: 'current_preference_revision', parameter: 'expected_preference_revision' }] },
      initialize_reference_head: { kind: 'update', tableId: 'people_persons', setColumns: ['current_reference_revision'], keyColumns: ['person_id'] },
      advance_reference_head: { kind: 'update', tableId: 'people_persons', setColumns: ['current_reference_revision'], keyColumns: ['person_id'],
        compareColumns: [{ column: 'current_reference_revision', parameter: 'expected_reference_revision' }] },
      advance_reference_projection: { kind: 'update', tableId: 'people_persons',
        setColumns: ['current_reference_projection_revision', 'current_reference_projection_digest'], keyColumns: ['person_id'],
        compareColumns: [{ column: 'current_reference_projection_revision', parameter: 'expected_projection_revision' },
          { column: 'current_reference_projection_digest', parameter: 'expected_projection_digest' }] },
      insert_person_revision: { kind: 'insert', tableId: 'people_person_revisions', columns: [
        'person_id', 'revision', 'person_status', 'canonical_name', 'merged_into_person_id', 'origin_kind', 'origin_decision_id', 'origin_decision_digest', 'origin_candidate_kind', 'origin_candidate_id',
        'origin_candidate_revision', 'origin_candidate_payload_digest', 'fact_digest', 'committed_at_ms'
      ] },
      find_person_revision: { kind: 'select-one', tableId: 'people_person_revisions', columns: [
        'person_id', 'revision', 'person_status', 'canonical_name', 'merged_into_person_id', 'origin_kind', 'origin_decision_id', 'origin_decision_digest', 'origin_candidate_kind', 'origin_candidate_id',
        'origin_candidate_revision', 'origin_candidate_payload_digest', 'fact_digest', 'committed_at_ms'
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
      find_active_provider_identity: { kind: 'select-one', tableId: 'people_provider_identities', columns: [
        'person_id', 'revision', 'provider', 'namespace', 'provider_key', 'provenance_digest', 'active_guard'
      ], keyColumns: ['provider', 'namespace', 'provider_key', 'active_guard'] },
      insert_preference: { kind: 'insert', tableId: 'people_preference_revisions', columns: [
        'person_id', 'revision', 'preference_level', 'reason', 'origin_kind', 'origin_ref', 'committed_at_ms'
      ] },
      find_preference: { kind: 'select-one', tableId: 'people_preference_revisions', columns: [
        'person_id', 'revision', 'preference_level', 'reason', 'origin_kind', 'origin_ref', 'committed_at_ms'
      ], keyColumns: ['person_id', 'revision'] },
      insert_reference_asset: { kind: 'insert', tableId: 'people_reference_assets', columns: [
        'reference_asset_id', 'person_id', 'artifact_handle_id', 'artifact_digest', 'state', 'created_reference_revision',
        'released_reference_revision', 'created_at_ms', 'released_at_ms'
      ] },
      find_reference_asset: { kind: 'select-one', tableId: 'people_reference_assets', columns: [
        'reference_asset_id', 'person_id', 'artifact_handle_id', 'artifact_digest', 'state', 'created_reference_revision',
        'released_reference_revision', 'created_at_ms', 'released_at_ms'
      ], keyColumns: ['reference_asset_id'] },
      find_reference_assets: { kind: 'select-all', tableId: 'people_reference_assets', columns: [
        'reference_asset_id', 'person_id', 'artifact_handle_id', 'artifact_digest', 'state', 'created_reference_revision',
        'released_reference_revision', 'created_at_ms', 'released_at_ms'
      ], keyColumns: ['person_id'] },
      release_reference_asset: { kind: 'update', tableId: 'people_reference_assets',
        setColumns: ['state', 'released_reference_revision', 'released_at_ms'], keyColumns: ['reference_asset_id'],
        compareColumns: [{ column: 'person_id', parameter: 'expected_person_id' }, { column: 'state', parameter: 'expected_state' }] },
      insert_reference_face: { kind: 'insert', tableId: 'people_reference_faces', columns: [
        'reference_face_id', 'person_id', 'reference_asset_id', 'embedding_handle_id', 'embedding_digest', 'model_ref', 'state',
        'created_reference_revision', 'released_reference_revision', 'created_at_ms', 'released_at_ms'
      ] },
      find_reference_face: { kind: 'select-one', tableId: 'people_reference_faces', columns: [
        'reference_face_id', 'person_id', 'reference_asset_id', 'embedding_handle_id', 'embedding_digest', 'model_ref', 'state',
        'created_reference_revision', 'released_reference_revision', 'created_at_ms', 'released_at_ms'
      ], keyColumns: ['reference_face_id'] }
      ,find_reference_faces: { kind: 'select-all', tableId: 'people_reference_faces', columns: [
        'reference_face_id', 'person_id', 'reference_asset_id', 'embedding_handle_id', 'embedding_digest', 'model_ref', 'state',
        'created_reference_revision', 'released_reference_revision', 'created_at_ms', 'released_at_ms'
      ], keyColumns: ['person_id'] },
      release_reference_face: { kind: 'update', tableId: 'people_reference_faces',
        setColumns: ['state', 'released_reference_revision', 'released_at_ms'], keyColumns: ['reference_face_id'],
        compareColumns: [{ column: 'person_id', parameter: 'expected_person_id' }, { column: 'reference_asset_id', parameter: 'expected_reference_asset_id' },
          { column: 'state', parameter: 'expected_state' }] },
      insert_reference_revision: { kind: 'insert', tableId: 'people_reference_revisions', columns: [
        'person_id', 'revision', 'operation_kind', 'reference_asset_id', 'reference_face_id', 'active_asset_set_digest',
        'active_face_set_digest', 'reference_set_digest', 'decision_digest', 'fact_digest', 'committed_at_ms'
      ] },
      find_reference_revision: { kind: 'select-one', tableId: 'people_reference_revisions', columns: [
        'person_id', 'revision', 'operation_kind', 'reference_asset_id', 'reference_face_id', 'active_asset_set_digest',
        'active_face_set_digest', 'reference_set_digest', 'decision_digest', 'fact_digest', 'committed_at_ms'
      ], keyColumns: ['person_id', 'revision'] },
      find_merge_sources: { kind: 'select-all', tableId: 'people_merge_records', columns: [
        'source_person_id', 'target_person_id', 'committed_at_ms'
      ], keyColumns: ['target_person_id'] },
      find_merge_target: { kind: 'select-one', tableId: 'people_merge_records', columns: [
        'source_person_id', 'target_person_id', 'committed_at_ms'
      ], keyColumns: ['source_person_id'] },
      insert_merge_record: { kind: 'insert', tableId: 'people_merge_records', columns: [
        'merge_record_id', 'merge_candidate_id', 'merge_candidate_revision', 'source_person_id', 'previous_source_person_revision',
        'committed_source_person_revision', 'target_person_id', 'previous_target_person_revision', 'committed_target_person_revision',
        'preference_resolution_digest', 'decision_digest', 'committed_at_ms'
      ] }
    }
  });
}

function candidateDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'people_candidate_repository', owner: 'people', schemaManifest,
    statements: {
      insert_registration_candidate: { kind: 'insert', tableId: 'people_registration_candidates', columns: [
        'registration_candidate_id', 'current_revision', 'current_state', 'proposed_name', 'evidence_digest', 'candidate_schema_ref',
        'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ] },
      find_registration_candidate: { kind: 'select-one', tableId: 'people_registration_candidates', columns: [
        'registration_candidate_id', 'current_revision', 'current_state', 'proposed_name', 'evidence_digest', 'candidate_schema_ref',
        'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: ['registration_candidate_id'] },
      find_registration_candidate_by_evidence: { kind: 'select-one', tableId: 'people_registration_candidates', columns: [
        'registration_candidate_id', 'current_revision', 'current_state', 'proposed_name', 'evidence_digest', 'candidate_schema_ref',
        'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: ['evidence_digest'] },
      list_registration_candidates: { kind: 'select-all', tableId: 'people_registration_candidates', columns: [
        'registration_candidate_id', 'current_revision', 'current_state', 'proposed_name', 'evidence_digest', 'candidate_schema_ref',
        'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: [] },
      advance_registration_candidate: { kind: 'update', tableId: 'people_registration_candidates',
        setColumns: ['current_revision', 'current_state', 'terminal_at_ms'], keyColumns: ['registration_candidate_id'], compareColumns: [
          { column: 'current_revision', parameter: 'expected_current_revision' }, { column: 'current_state', parameter: 'expected_current_state' }
        ] },
      insert_registration_revision: { kind: 'insert', tableId: 'people_registration_candidate_revisions', columns: [
        'registration_candidate_id', 'revision', 'state', 'decision_origin', 'decision_ref', 'decision_digest', 'committed_at_ms'
      ] },
      find_registration_revision: { kind: 'select-one', tableId: 'people_registration_candidate_revisions', columns: [
        'registration_candidate_id', 'revision', 'state', 'decision_origin', 'decision_ref', 'decision_digest', 'committed_at_ms'
      ], keyColumns: ['registration_candidate_id', 'revision'] },
      insert_merge_candidate: { kind: 'insert', tableId: 'people_merge_candidates', columns: [
        'merge_candidate_id', 'current_revision', 'current_state', 'left_person_id', 'left_person_revision', 'right_person_id',
        'right_person_revision', 'evidence_digest', 'candidate_schema_ref', 'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ] },
      find_merge_candidate: { kind: 'select-one', tableId: 'people_merge_candidates', columns: [
        'merge_candidate_id', 'current_revision', 'current_state', 'left_person_id', 'left_person_revision', 'right_person_id',
        'right_person_revision', 'evidence_digest', 'candidate_schema_ref', 'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: ['merge_candidate_id'] },
      list_merge_candidates: { kind: 'select-all', tableId: 'people_merge_candidates', columns: [
        'merge_candidate_id', 'current_revision', 'current_state', 'left_person_id', 'left_person_revision', 'right_person_id',
        'right_person_revision', 'evidence_digest', 'candidate_schema_ref', 'candidate_json', 'candidate_payload_digest', 'created_at_ms', 'terminal_at_ms'
      ], keyColumns: [] },
      advance_merge_candidate: { kind: 'update', tableId: 'people_merge_candidates',
        setColumns: ['current_revision', 'current_state', 'terminal_at_ms'], keyColumns: ['merge_candidate_id'], compareColumns: [
          { column: 'current_revision', parameter: 'expected_current_revision' }, { column: 'current_state', parameter: 'expected_current_state' }
        ] },
      insert_merge_revision: { kind: 'insert', tableId: 'people_merge_candidate_revisions', columns: [
        'merge_candidate_id', 'revision', 'state', 'decision_origin', 'decision_ref', 'decision_digest', 'committed_at_ms'
      ] },
      find_merge_revision: { kind: 'select-one', tableId: 'people_merge_candidate_revisions', columns: [
        'merge_candidate_id', 'revision', 'state', 'decision_origin', 'decision_ref', 'decision_digest', 'committed_at_ms'
      ], keyColumns: ['merge_candidate_id', 'revision'] }
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
  function writePersonRevision(repository, input, committedAtMs, deactivateCurrent) {
    const next = createPersonRevision({ ...input, committedAtMs });
    if (deactivateCurrent) repository.invoke('deactivate_provider_identities', { active_guard: 0, person_id: next.personId });
    repository.invoke('insert_person_revision', personRevisionRow(next));
    for (const alias of next.aliases) repository.invoke('insert_alias', { person_id: next.personId, revision: next.revision,
      alias_normalized: alias.aliasNormalized, alias_display: alias.aliasDisplay, provenance_digest: alias.provenanceDigest });
    for (const identity of next.providerIdentities) repository.invoke('insert_provider_identity', { person_id: next.personId, revision: next.revision,
      provider: identity.provider, namespace: identity.namespace, provider_key: identity.providerKey,
      provenance_digest: identity.provenanceDigest, active_guard: next.personStatus === 'active' ? 1 : 0 });
    return next;
  }
  function appendPreference(repository, input, committedAtMs) {
    const person = repository.invoke('find_person', { person_id: input.personId });
    if (!person || person.status !== 'active') fail('P6_PEOPLE_PERSON_NOT_ACTIVE', 'Preference requires an active Person.');
    const expected = person.current_preference_revision;
    const nextRevision = expected === null ? 1 : expected + 1;
    if (input.revision !== nextRevision) fail('P6_PEOPLE_PREFERENCE_REVISION_CONFLICT', 'Preference revision is stale or skipped.');
    const item = createPreference({ ...input, committedAtMs });
    repository.invoke('insert_preference', preferenceRow(item));
    const result = expected === null
      ? repository.invoke('initialize_preference_head', { current_preference_revision: item.revision, person_id: item.personId })
      : repository.invoke('advance_preference_head', { current_preference_revision: item.revision, person_id: item.personId,
        expected_preference_revision: expected });
    if (result.changes !== 1) fail('P6_PEOPLE_PREFERENCE_REVISION_CONFLICT', 'Preference head changed concurrently.');
    return item;
  }
  function ownerIdsForProjection(repository, personId) {
    const result = [];
    const pending = [personId];
    const visited = new Set();
    while (pending.length) {
      const ownerPersonId = pending.shift();
      if (visited.has(ownerPersonId)) fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Merge correlation contains a cycle.');
      visited.add(ownerPersonId);
      result.push(ownerPersonId);
      for (const row of repository.invoke('find_merge_sources', { target_person_id: ownerPersonId })) pending.push(row.source_person_id);
    }
    return result.sort(utf8Compare);
  }
  function buildReferenceProjection(repository, personId) {
    const person = repository.invoke('find_person', { person_id: personId });
    if (!person) return undefined;
    const contributions = [];
    for (const ownerPersonId of ownerIdsForProjection(repository, personId)) {
      const owner = repository.invoke('find_person', { person_id: ownerPersonId });
      if (!owner) fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Merge correlation references a missing Person.');
      if (owner.current_reference_revision === null) continue;
      const revisionRow = repository.invoke('find_reference_revision', {
        person_id: ownerPersonId, revision: owner.current_reference_revision
      });
      if (!revisionRow) fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Reference head has no immutable revision.');
      const activeAssets = repository.invoke('find_reference_assets', { person_id: ownerPersonId })
        .filter((row) => row.state === 'active').map((row) => ({ referenceAssetId: row.reference_asset_id,
          artifactHandleId: row.artifact_handle_id, artifactDigest: row.artifact_digest })).sort((a, b) => utf8Compare(a.referenceAssetId, b.referenceAssetId));
      const activeFaces = repository.invoke('find_reference_faces', { person_id: ownerPersonId })
        .filter((row) => row.state === 'active').map((row) => ({ referenceFaceId: row.reference_face_id,
          referenceAssetId: row.reference_asset_id, embeddingHandleId: row.embedding_handle_id,
          embeddingDigest: row.embedding_digest, modelRef: row.model_ref })).sort((a, b) => utf8Compare(a.referenceFaceId, b.referenceFaceId));
      const activeAssetSetDigest = canonicalDigest({ schema: 'people.reference-active-assets@1', items: activeAssets });
      const activeFaceSetDigest = canonicalDigest({ schema: 'people.reference-active-faces@1', items: activeFaces });
      const referenceSetDigest = canonicalDigest({ schema: 'people.reference-set@1', personId: ownerPersonId,
        activeAssetSetDigest, activeFaceSetDigest });
      if (referenceSetDigest !== revisionRow.reference_set_digest) {
        fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Current Reference set digest does not match canonical facts.');
      }
      contributions.push({ ownerPersonId, ownerReferenceRevision: owner.current_reference_revision, referenceSetDigest,
        inheritedReadOnly: ownerPersonId !== personId, activeAssets, activeFaces });
    }
    const basis = { projectionContract: REFERENCE_PROJECTION_CONTRACT, personId, personRevision: person.current_revision,
      currentReferenceRevision: person.current_reference_revision, contributions };
    return { ...basis, projectionRevision: person.current_reference_projection_revision,
      projectionDigest: canonicalDigest(basis) };
  }
  function checkpointProjection(repository, personId) {
    const current = repository.invoke('find_person', { person_id: personId });
    const projection = buildReferenceProjection(repository, personId);
    if (!current || !projection) fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Projection checkpoint Person is missing.');
    if (projection.projectionDigest === current.current_reference_projection_digest) return projection;
    const advanced = repository.invoke('advance_reference_projection', {
      current_reference_projection_revision: current.current_reference_projection_revision + 1,
      current_reference_projection_digest: projection.projectionDigest, person_id: personId,
      expected_projection_revision: current.current_reference_projection_revision,
      expected_projection_digest: current.current_reference_projection_digest
    });
    if (advanced.changes !== 1) fail('PEOPLE_REFERENCE_PROJECTION_REVISION_CONFLICT', 'Projection checkpoint changed concurrently.');
    return { ...projection, projectionRevision: current.current_reference_projection_revision + 1 };
  }
  function affectedProjectionIds(repository, ownerPersonId) {
    const result = [];
    const visited = new Set();
    let current = ownerPersonId;
    while (current) {
      if (visited.has(current)) fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Merge correlation contains a cycle.');
      visited.add(current); result.push(current);
      const parent = repository.invoke('find_merge_target', { source_person_id: current });
      current = parent ? parent.target_person_id : null;
    }
    return result;
  }
  function commitDirectRegistration(context, decision) {
    const repository = context.repository(registry.repositoryId);
    const personFact = { personStatus: 'active', canonicalName: decision.canonicalName, mergedIntoPersonId: null,
      originKind: 'direct', originDecisionRef: { decisionId: decision.decisionId, decisionDigest: decision.decisionDigest },
      originCandidateRef: null, aliases: decision.aliases, providerIdentities: decision.providerIdentities };
    const factDigest = canonicalDigest(personFact);
    repository.invoke('insert_person', { person_id: decision.newPersonId, status: 'active', current_revision: 1,
      current_preference_revision: null, current_reference_revision: null, current_reference_projection_revision: 1,
      current_reference_projection_digest: initialProjectionDigest(decision.newPersonId), created_at_ms: context.commitTimeMs, terminal_at_ms: null });
    writePersonRevision(repository, { personId: decision.newPersonId, revision: 1, ...personFact, factDigest }, context.commitTimeMs, false);
    return mapPerson(repository, repository.invoke('find_person', { person_id: decision.newPersonId }));
  }
  const repositoryManifest = Object.freeze({ components: Object.freeze([
    Object.freeze({ component: 'PersonRegistryRepository', repositoryId: registry.repositoryId, tableIds: registry.tableIds }),
    Object.freeze({ component: 'PeopleCandidateRepository', repositoryId: candidates.repositoryId, tableIds: candidates.tableIds })
  ]) });
  function commitCandidate(context, input) {
    const draft = createCandidateDraft(input.draft);
    const repository = context.repository(candidates.repositoryId);
    const revisionItem = createCandidateRevision({ candidateId: input.candidateId, revision: 1, state: 'open', decisionOrigin: null,
      decisionRef: null, decisionDigest: null, committedAtMs: context.commitTimeMs });
    const candidateJson = boundedJson(draft.candidatePayload);
    if (draft.candidateKind === 'registration') {
      repository.invoke('insert_registration_candidate', { registration_candidate_id: input.candidateId, current_revision: 1,
        current_state: 'open', proposed_name: draft.candidatePayload.proposedName, evidence_digest: draft.evidenceDigest,
        candidate_schema_ref: PEOPLE_CANDIDATE_DRAFT_SCHEMA, candidate_json: candidateJson,
        candidate_payload_digest: draft.candidatePayloadDigest, created_at_ms: context.commitTimeMs, terminal_at_ms: null });
      repository.invoke('insert_registration_revision', candidateRevisionRow('registration', revisionItem));
      return mapRegistrationCandidate(repository, repository.invoke('find_registration_candidate', { registration_candidate_id: input.candidateId }));
    }
    verifyMergeRefs(context.repository(registry.repositoryId), draft.candidatePayload);
    repository.invoke('insert_merge_candidate', { merge_candidate_id: input.candidateId, current_revision: 1, current_state: 'open',
      left_person_id: draft.candidatePayload.leftPersonRef.personId, left_person_revision: draft.candidatePayload.leftPersonRef.revision,
      right_person_id: draft.candidatePayload.rightPersonRef.personId, right_person_revision: draft.candidatePayload.rightPersonRef.revision,
      evidence_digest: draft.evidenceDigest, candidate_schema_ref: PEOPLE_CANDIDATE_DRAFT_SCHEMA, candidate_json: candidateJson,
      candidate_payload_digest: draft.candidatePayloadDigest, created_at_ms: context.commitTimeMs, terminal_at_ms: null });
    repository.invoke('insert_merge_revision', candidateRevisionRow('merge', revisionItem));
    return mapMergeCandidate(repository, repository.invoke('find_merge_candidate', { merge_candidate_id: input.candidateId }));
  }

  return Object.freeze({
    repositoryManifest,
    registerDirectPerson(input) {
      const decision = validateDirectRegistrationDecision(input);
      return execute([registry], (context) => commitDirectRegistration(context, decision));
    },
    createDirectRegistrationParticipant(input) {
      const decision = validateDirectRegistrationDecision(input);
      return Object.freeze({ participantId: 'people_direct_registration', owner: 'people', repositories: [registry],
        execute(context) { return commitDirectRegistration(context, decision); } });
    },
    revisePerson(input, expectedRevision) {
      exactInput(input, ['personId', 'revision', 'canonicalName', 'factDigest', 'aliases', 'providerIdentities'], 'P6_PEOPLE_PERSON_INPUT');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const current = repository.invoke('find_person', { person_id: input.personId });
        if (!current || current.status !== 'active') fail('P6_PEOPLE_PERSON_NOT_ACTIVE', 'Only an active Person can be revised.');
        if (current.current_revision !== expectedRevision || input.revision !== expectedRevision + 1) {
          fail('P6_PEOPLE_PERSON_REVISION_CONFLICT', 'Person revision is stale or skipped.');
        }
        const previous = mapPerson(repository, current).revision;
        writePersonRevision(repository, { ...input, personStatus: 'active', mergedIntoPersonId: null,
          originKind: previous.originKind, originDecisionRef: previous.originDecisionRef, originCandidateRef: previous.originCandidateRef },
          context.commitTimeMs, true);
        const advanced = repository.invoke('advance_person_head', { status: 'active', current_revision: input.revision, terminal_at_ms: null,
          person_id: input.personId, expected_current_revision: expectedRevision, expected_status: 'active' });
        if (advanced.changes !== 1) fail('P6_PEOPLE_PERSON_REVISION_CONFLICT', 'Person head changed concurrently.');
        checkpointProjection(repository, input.personId);
        return mapPerson(repository, repository.invoke('find_person', { person_id: input.personId }));
      });
    },
    getPerson(personId) {
      return execute([registry], (context) => mapPerson(context.repository(registry.repositoryId),
        context.repository(registry.repositoryId).invoke('find_person', { person_id: personId })));
    },
    listPeople() {
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        return Object.freeze(repository.invoke('list_people').map((row) => mapPerson(repository, row)));
      });
    },
    findActivePersonByProviderIdentity(identity) {
      exactInput(identity, ['provider', 'namespace', 'providerKey'], 'P6_PEOPLE_PROVIDER_IDENTITY_LOOKUP_INPUT');
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const row = repository.invoke('find_active_provider_identity', { provider:identity.provider,
          namespace:identity.namespace,provider_key:identity.providerKey,active_guard:1 });
        return row ? mapPerson(repository, repository.invoke('find_person', { person_id:row.person_id })) : undefined;
      });
    },
    appendPreference(input) {
      exactInput(input, ['personId', 'revision', 'preferenceLevel', 'reason', 'originKind', 'originRef'], 'P6_PEOPLE_PREFERENCE_INPUT');
      return execute([registry], (context) => appendPreference(context.repository(registry.repositoryId), input, context.commitTimeMs));
    },
    getCurrentPreference(personId) {
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const person = repository.invoke('find_person', { person_id: personId });
        if (!person || person.current_preference_revision === null) return undefined;
        return mapPreference(repository.invoke('find_preference', { person_id: personId, revision: person.current_preference_revision }));
      });
    },
    createPreferenceCommitParticipant(handle, intent) {
      const resultSchemaRef = 'helix://contracts/types/PersonPreferenceRevision/v1';
      if (!handle || !intent || intent.schemaRef !== 'helix://contracts/domain-types/PreferenceIntent/v1' || intent.schemaVersion !== 1 ||
          handle.ownerDomain !== 'people' || handle.aggregateType !== 'person-preference' || handle.aggregateId !== intent.personId ||
          handle.expectedRevision !== intent.revision - 1 || handle.resultSchemaRef !== resultSchemaRef) {
        fail('P6_PEOPLE_PREFERENCE_COMMIT_FENCE', 'Preference Commit Handle does not fence the exact Preference Intent.');
      }
      const digestBasis = Object.fromEntries(Object.entries(intent).filter(([key]) => key !== 'digest'));
      if (canonicalDigest(digestBasis) !== intent.digest || intent.typedParameters.some((item) =>
        canonicalDigest(item.value) !== item.valueDigest)) {
        fail('P6_PEOPLE_PREFERENCE_INTENT_DIGEST', 'Preference Intent or one typed parameter has an invalid digest.');
      }
      return Object.freeze({ participantId: 'people_preference_commit', owner: 'people', repositories: [registry], execute(context) {
        const item = appendPreference(context.repository(registry.repositoryId), { personId: intent.personId, revision: intent.revision,
          preferenceLevel: intent.preferenceLevel, reason: intent.reason, originKind: 'preference_intent', originRef: intent.intentId }, context.commitTimeMs);
        const fact = { personId: item.personId, preferenceLevel: item.preferenceLevel, reason: item.reason };
        return Object.freeze({ schemaRef: resultSchemaRef, schemaVersion: 1, factId: handle.handleId, ownerDomain: 'people',
          aggregateType: 'person-preference', aggregateId: item.personId, revision: item.revision, factSchemaRef: resultSchemaRef,
          factDigest: canonicalDigest(fact), commitMarker: handle.commitIdempotencyKey, committedAtMs: item.committedAtMs, ...fact });
      } });
    },
    createReferenceCommitParticipant(handle, decisionInput) {
      const decision = validateReferenceDecision(decisionInput);
      const resultSchemaRef = 'helix://contracts/types/PersonReferenceRevision/v1';
      if (!handle || handle.ownerDomain !== 'people' || handle.aggregateType !== 'person-reference' ||
          handle.aggregateId !== decision.personId || handle.expectedRevision !== decision.expectedReferenceRevision ||
          handle.resultSchemaRef !== resultSchemaRef) {
        fail('P6_PEOPLE_REFERENCE_COMMIT_FENCE', 'Reference Commit Handle does not fence the exact Person Reference revision.');
      }
      return Object.freeze({ participantId: 'people_reference_commit', owner: 'people', repositories: [registry], execute(context) {
        const repository = context.repository(registry.repositoryId);
        const person = repository.invoke('find_person', { person_id: decision.personId });
        const expectedPointer = decision.expectedReferenceRevision === 0 ? null : decision.expectedReferenceRevision;
        if (!person || person.current_revision !== decision.expectedPersonRevision || person.current_reference_revision !== expectedPointer ||
            decision.operationKind === 'add_image' && person.status !== 'active') {
          fail('P6_PEOPLE_REFERENCE_REVISION_CONFLICT', 'Person or Reference head is stale or not eligible for this operation.');
        }
        const nextRevision = decision.expectedReferenceRevision + 1;
        if (decision.operationKind === 'add_image') {
          const asset = createReferenceAsset({ referenceAssetId: decision.referenceAssetId, personId: decision.personId,
            artifactHandleId: decision.artifactHandle.artifactHandleId, artifactDigest: decision.artifactDigest, state: 'active',
            createdReferenceRevision: nextRevision, releasedReferenceRevision: null, createdAtMs: context.commitTimeMs, releasedAtMs: null });
          const face = createReferenceFace({ referenceFaceId: decision.referenceFaceId, personId: decision.personId,
            referenceAssetId: decision.referenceAssetId, embeddingHandleId: decision.faceEmbeddingSetHandle.artifactHandleId,
            embeddingDigest: decision.faceEmbeddingSetHandle.digestHex, modelRef: decision.modelRef, state: 'active',
            createdReferenceRevision: nextRevision, releasedReferenceRevision: null, createdAtMs: context.commitTimeMs, releasedAtMs: null });
          repository.invoke('insert_reference_asset', assetRow(asset));
          repository.invoke('insert_reference_face', faceRow(face));
        } else {
          const asset = repository.invoke('find_reference_asset', { reference_asset_id: decision.referenceAssetId });
          const face = repository.invoke('find_reference_face', { reference_face_id: decision.referenceFaceId });
          if (!asset || !face || asset.person_id !== decision.personId || face.person_id !== decision.personId ||
              face.reference_asset_id !== decision.referenceAssetId || asset.state !== 'active' || face.state !== 'active' ||
              asset.artifact_digest !== decision.artifactDigest || face.embedding_digest !== decision.embeddingDigest ||
              face.model_ref !== decision.modelRef) {
            fail('P6_PEOPLE_REFERENCE_RELEASE_FENCE', 'Reference release target, ownership, state, digest, or model does not match.');
          }
          const assetReleased = repository.invoke('release_reference_asset', { state: 'released', released_reference_revision: nextRevision,
            released_at_ms: context.commitTimeMs, reference_asset_id: decision.referenceAssetId,
            expected_person_id: decision.personId, expected_state: 'active' });
          const faceReleased = repository.invoke('release_reference_face', { state: 'released', released_reference_revision: nextRevision,
            released_at_ms: context.commitTimeMs, reference_face_id: decision.referenceFaceId, expected_person_id: decision.personId,
            expected_reference_asset_id: decision.referenceAssetId, expected_state: 'active' });
          if (assetReleased.changes !== 1 || faceReleased.changes !== 1) {
            fail('P6_PEOPLE_REFERENCE_RELEASE_FENCE', 'Reference release target changed concurrently.');
          }
        }
        const activeReferenceAssets = repository.invoke('find_reference_assets', { person_id: decision.personId })
          .filter((row) => row.state === 'active').map((row) => ({ referenceAssetId: row.reference_asset_id,
            artifactHandleId: row.artifact_handle_id, artifactDigest: row.artifact_digest })).sort((a, b) => utf8Compare(a.referenceAssetId, b.referenceAssetId));
        const activeReferenceFaces = repository.invoke('find_reference_faces', { person_id: decision.personId })
          .filter((row) => row.state === 'active').map((row) => ({ referenceFaceId: row.reference_face_id,
            referenceAssetId: row.reference_asset_id, embeddingHandleId: row.embedding_handle_id,
            embeddingDigest: row.embedding_digest, modelRef: row.model_ref })).sort((a, b) => utf8Compare(a.referenceFaceId, b.referenceFaceId));
        const activeAssetSetDigest = canonicalDigest({ schema: 'people.reference-active-assets@1', items: activeReferenceAssets });
        const activeFaceSetDigest = canonicalDigest({ schema: 'people.reference-active-faces@1', items: activeReferenceFaces });
        const referenceSetDigest = canonicalDigest({ schema: 'people.reference-set@1', personId: decision.personId,
          activeAssetSetDigest, activeFaceSetDigest });
        const factWithoutDigest = { schemaRef: resultSchemaRef, schemaVersion: 1, factId: handle.handleId, ownerDomain: 'people',
          aggregateType: 'person-reference', aggregateId: decision.personId, revision: nextRevision, factSchemaRef: resultSchemaRef,
          commitMarker: handle.commitIdempotencyKey, committedAtMs: context.commitTimeMs, personId: decision.personId,
          referenceRevision: nextRevision, operationKind: decision.operationKind, affectedReferenceAssetId: decision.referenceAssetId,
          affectedReferenceFaceId: decision.referenceFaceId, activeReferenceAssets, activeReferenceFaces,
          activeAssetSetDigest, activeFaceSetDigest, referenceSetDigest };
        const fact = Object.freeze({ ...factWithoutDigest, factDigest: canonicalDigest(factWithoutDigest) });
        repository.invoke('insert_reference_revision', { person_id: decision.personId, revision: nextRevision,
          operation_kind: decision.operationKind, reference_asset_id: decision.referenceAssetId, reference_face_id: decision.referenceFaceId,
          active_asset_set_digest: activeAssetSetDigest, active_face_set_digest: activeFaceSetDigest, reference_set_digest: referenceSetDigest,
          decision_digest: decision.decisionDigest, fact_digest: fact.factDigest, committed_at_ms: context.commitTimeMs });
        const head = expectedPointer === null
          ? repository.invoke('initialize_reference_head', { current_reference_revision: nextRevision, person_id: decision.personId })
          : repository.invoke('advance_reference_head', { current_reference_revision: nextRevision, person_id: decision.personId,
            expected_reference_revision: expectedPointer });
        if (head.changes !== 1) fail('P6_PEOPLE_REFERENCE_REVISION_CONFLICT', 'Reference head changed concurrently.');
        for (const affectedPersonId of affectedProjectionIds(repository, decision.personId)) checkpointProjection(repository, affectedPersonId);
        return fact;
      } });
    },
    getReferenceAsset(referenceAssetId) {
      return execute([registry], (context) => mapAsset(context.repository(registry.repositoryId).invoke('find_reference_asset', { reference_asset_id: referenceAssetId })));
    },
    getReferenceFace(referenceFaceId) {
      return execute([registry], (context) => mapFace(context.repository(registry.repositoryId).invoke('find_reference_face', { reference_face_id: referenceFaceId })));
    },
    getPersonReferenceProjection(personId) {
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const projection = buildReferenceProjection(repository, personId);
        if (!projection) return undefined;
        const person = repository.invoke('find_person', { person_id: personId });
        if (projection.projectionDigest !== person.current_reference_projection_digest ||
            projection.projectionRevision !== person.current_reference_projection_revision) {
          fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION', 'Projection payload does not match its persisted checkpoint.');
        }
        return Object.freeze(projection);
      });
    },
    listPersonReferenceProjections(limit = 256) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
        fail('P6_PEOPLE_REFERENCE_QUERY_LIMIT',
          'Reference projection query limit must be 1..256.');
      }
      return execute([registry], (context) => {
        const repository = context.repository(registry.repositoryId);
        const people = repository.invoke('list_people', {})
          .filter((row) => row.status === 'active')
          .sort((left, right) => utf8Compare(
            left.person_id,
            right.person_id,
          ));
        if (people.length > limit) {
          fail('P6_PEOPLE_REFERENCE_PROJECTION_SET_TOO_LARGE',
            'Active Person Reference Projection set exceeds the formal bound.',
            { count:people.length, limit });
        }
        return Object.freeze(people.map((person) => {
          const projection = buildReferenceProjection(
            repository,
            person.person_id,
          );
          if (!projection ||
              projection.projectionDigest !==
                person.current_reference_projection_digest ||
              projection.projectionRevision !==
                person.current_reference_projection_revision) {
            fail('PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION',
              'Projection payload does not match its persisted checkpoint.');
          }
          return Object.freeze(projection);
        }));
      });
    },
    openCandidate(input) {
      exactInput(input, ['candidateId', 'draft'], 'P6_PEOPLE_CANDIDATE_INPUT');
      const draft = createCandidateDraft(input.draft);
      return execute([candidates, ...(draft.candidateKind === 'merge' ? [registry] : [])],
        (context) => commitCandidate(context, { candidateId: input.candidateId, draft }), 'people_candidate_store');
    },
    createCandidateCommitParticipant(handle, draftInput) {
      const resultSchemaRef = 'helix://contracts/types/PeopleCandidateRevision/v1';
      const draft = createCandidateDraft(draftInput);
      if (!handle || handle.ownerDomain !== 'people' || handle.aggregateType !== 'people-candidate' ||
          typeof handle.aggregateId !== 'string' || handle.aggregateId.length < 1 || handle.expectedRevision !== 0 || handle.resultSchemaRef !== resultSchemaRef) {
        fail('P6_PEOPLE_CANDIDATE_COMMIT_FENCE', 'Candidate Commit Handle does not fence a new People Candidate.');
      }
      return Object.freeze({ participantId: 'people_candidate_commit', owner: 'people',
        repositories: [candidates, ...(draft.candidateKind === 'merge' ? [registry] : [])], execute(context) {
          const item = commitCandidate(context, { candidateId: handle.aggregateId, draft });
          const fact = { candidateKind: draft.candidateKind, candidateId: item.candidateId, candidateRevision: item.currentRevision,
            candidateSchemaRef: PEOPLE_CANDIDATE_DRAFT_SCHEMA, candidatePayloadDigest: item.candidatePayloadDigest,
            evidenceDigest: item.evidenceDigest, state: item.currentState };
          return Object.freeze({ schemaRef: resultSchemaRef, schemaVersion: 1, factId: handle.handleId, ownerDomain: 'people',
            aggregateType: handle.aggregateType, aggregateId: handle.aggregateId, revision: item.currentRevision,
            factSchemaRef: resultSchemaRef, factDigest: canonicalDigest(fact), commitMarker: handle.commitIdempotencyKey,
            committedAtMs: context.commitTimeMs, ...fact });
        } });
    },
    createRegistrationAcceptanceParticipant(handle, decisionInput) {
      const resultSchemaRef = 'helix://contracts/types/PersonRevision/v1';
      const decision = validateRegistrationDecision(decisionInput);
      if (!handle || handle.ownerDomain !== 'people' || handle.aggregateType !== 'person' || handle.aggregateId !== decision.newPersonId ||
          handle.expectedRevision !== 0 || handle.resultSchemaRef !== resultSchemaRef) {
        fail('P6_PEOPLE_REGISTRATION_ACCEPTANCE_FENCE', 'Registration Handle does not fence the exact new Person.');
      }
      return Object.freeze({ participantId: 'people_registration_acceptance', owner: 'people', repositories: [candidates, registry], execute(context) {
        const candidateRepository = context.repository(candidates.repositoryId);
        const personRepository = context.repository(registry.repositoryId);
        const row = candidateRepository.invoke('find_registration_candidate', { registration_candidate_id: decision.candidateId });
        if (!row || row.current_state !== 'open' || row.current_revision !== decision.expectedCandidateRevision ||
            row.candidate_payload_digest !== decision.candidatePayloadDigest) {
          fail('P6_PEOPLE_REGISTRATION_CANDIDATE_FENCE', 'Registration Candidate revision or payload changed before acceptance.');
        }
        const candidate = mapRegistrationCandidate(candidateRepository, row);
        const nextCandidateRevision = createCandidateRevision({ candidateId: decision.candidateId,
          revision: decision.expectedCandidateRevision + 1, state: 'accepted', decisionOrigin: decision.decisionOrigin,
          decisionRef: decision.decisionId, decisionDigest: decision.decisionDigest, committedAtMs: context.commitTimeMs });
        candidateRepository.invoke('insert_registration_revision', candidateRevisionRow('registration', nextCandidateRevision));
        const advanced = candidateRepository.invoke('advance_registration_candidate', { current_revision: nextCandidateRevision.revision,
          current_state: 'accepted', terminal_at_ms: context.commitTimeMs, registration_candidate_id: decision.candidateId,
          expected_current_revision: decision.expectedCandidateRevision, expected_current_state: 'open' });
        if (advanced.changes !== 1) fail('P6_PEOPLE_REGISTRATION_CANDIDATE_FENCE', 'Registration Candidate head changed concurrently.');

        const originCandidateRef = { candidateKind: 'registration', candidateId: candidate.candidateId,
          candidateRevision: decision.expectedCandidateRevision, candidatePayloadDigest: candidate.candidatePayloadDigest };
        const personFact = { personStatus: 'active', canonicalName: candidate.candidatePayload.proposedName, mergedIntoPersonId: null,
          originCandidateRef, aliases: candidate.candidatePayload.aliases, providerIdentities: candidate.candidatePayload.providerIdentities };
        const factDigest = canonicalDigest(personFact);
        personRepository.invoke('insert_person', { person_id: decision.newPersonId, status: 'active', current_revision: 1,
          current_preference_revision: null, current_reference_revision: null, current_reference_projection_revision: 1,
          current_reference_projection_digest: initialProjectionDigest(decision.newPersonId), created_at_ms: context.commitTimeMs, terminal_at_ms: null });
        writePersonRevision(personRepository, { personId: decision.newPersonId, revision: 1, ...personFact,
          originKind: 'candidate', originDecisionRef: null, factDigest }, context.commitTimeMs, false);
        const acceptedCandidateRef = { candidateKind: 'registration', candidateId: candidate.candidateId,
          candidateRevision: decision.expectedCandidateRevision, candidatePayloadDigest: candidate.candidatePayloadDigest };
        const resultFact = { operationKind: 'registration', personId: decision.newPersonId,
          canonicalName: candidate.candidatePayload.proposedName, aliasSetDigest: canonicalDigest(candidate.candidatePayload.aliases),
          providerIdentitySetDigest: canonicalDigest(candidate.candidatePayload.providerIdentities), acceptedCandidateRef,
          affectedPersonRevisions: [{ personId: decision.newPersonId, revision: 1, status: 'active', factDigest }] };
        return Object.freeze({ schemaRef: resultSchemaRef, schemaVersion: 1, factId: handle.handleId, ownerDomain: 'people',
          aggregateType: handle.aggregateType, aggregateId: handle.aggregateId, revision: 1, factSchemaRef: resultSchemaRef,
          factDigest: canonicalDigest(resultFact), commitMarker: handle.commitIdempotencyKey, committedAtMs: context.commitTimeMs, ...resultFact });
      } });
    },
    createMergeAcceptanceParticipant(handle, decisionInput) {
      const resultSchemaRef = 'helix://contracts/types/PersonRevision/v1';
      const decision = validateMergeDecision(decisionInput);
      if (!handle || handle.ownerDomain !== 'people' || handle.aggregateType !== 'person' ||
          handle.aggregateId !== decision.targetPersonId || handle.expectedRevision !== decision.expectedTargetPersonRevision ||
          handle.resultSchemaRef !== resultSchemaRef) {
        fail('P6_PEOPLE_MERGE_ACCEPTANCE_FENCE', 'Merge Handle does not fence the exact target Person revision.');
      }
      return Object.freeze({ participantId: 'people_merge_acceptance', owner: 'people', repositories: [candidates, registry], execute(context) {
        const candidateRepository = context.repository(candidates.repositoryId);
        const personRepository = context.repository(registry.repositoryId);
        const row = candidateRepository.invoke('find_merge_candidate', { merge_candidate_id: decision.candidateId });
        if (!row || row.current_state !== 'open' || row.current_revision !== decision.expectedCandidateRevision ||
            row.candidate_payload_digest !== decision.candidatePayloadDigest) {
          fail('P6_PEOPLE_MERGE_CANDIDATE_FENCE', 'Merge Candidate revision or payload changed before acceptance.');
        }
        const candidate = mapMergeCandidate(candidateRepository, row);
        const refs = [candidate.candidatePayload.leftPersonRef, candidate.candidatePayload.rightPersonRef];
        const sourceRef = refs.find((item) => item.personId === decision.sourcePersonId);
        const targetRef = refs.find((item) => item.personId === decision.targetPersonId);
        if (!sourceRef || !targetRef || sourceRef === targetRef ||
            sourceRef.revision !== decision.expectedSourcePersonRevision || targetRef.revision !== decision.expectedTargetPersonRevision ||
            sourceRef.preferenceRevision !== decision.expectedSourcePreferenceRevision ||
            targetRef.preferenceRevision !== decision.expectedTargetPreferenceRevision) {
          fail('P6_PEOPLE_MERGE_DECISION_CANDIDATE_MISMATCH', 'Merge Decision does not identify the exact frozen Candidate pair.');
        }
        const sourceHead = personRepository.invoke('find_person', { person_id: decision.sourcePersonId });
        const targetHead = personRepository.invoke('find_person', { person_id: decision.targetPersonId });
        if (!sourceHead || !targetHead || sourceHead.status !== 'active' || targetHead.status !== 'active' ||
            sourceHead.current_revision !== sourceRef.revision || targetHead.current_revision !== targetRef.revision ||
            sourceHead.current_preference_revision !== sourceRef.preferenceRevision ||
            targetHead.current_preference_revision !== targetRef.preferenceRevision) {
          fail('P6_PEOPLE_MERGE_PERSON_FENCE', 'Merge Person or Preference head changed before acceptance.');
        }
        const source = mapPerson(personRepository, sourceHead);
        const target = mapPerson(personRepository, targetHead);
        if (source.revision.factDigest !== sourceRef.factDigest || target.revision.factDigest !== targetRef.factDigest) {
          fail('P6_PEOPLE_MERGE_PERSON_FENCE', 'Merge Person fact no longer matches the frozen Candidate.');
        }
        const sourcePreference = currentPreference(personRepository, sourceHead);
        const targetPreference = currentPreference(personRepository, targetHead);
        const sourcePreferenceLevel = sourcePreference ? sourcePreference.preferenceLevel : null;
        const targetPreferenceLevel = targetPreference ? targetPreference.preferenceLevel : null;
        if (decision.decisionOrigin === 'strong_identity_rule' &&
            (sourcePreferenceLevel !== targetPreferenceLevel || decision.preferenceResolution === 'set_explicit')) {
          fail('P6_PEOPLE_MERGE_PREFERENCE_USER_REQUIRED', 'A strong identity rule cannot resolve a Preference conflict.');
        }

        const nextCandidateRevision = createCandidateRevision({ candidateId: decision.candidateId,
          revision: decision.expectedCandidateRevision + 1, state: 'accepted', decisionOrigin: decision.decisionOrigin,
          decisionRef: decision.decisionId, decisionDigest: decision.decisionDigest, committedAtMs: context.commitTimeMs });
        candidateRepository.invoke('insert_merge_revision', candidateRevisionRow('merge', nextCandidateRevision));
        const candidateAdvanced = candidateRepository.invoke('advance_merge_candidate', { current_revision: nextCandidateRevision.revision,
          current_state: 'accepted', terminal_at_ms: context.commitTimeMs, merge_candidate_id: decision.candidateId,
          expected_current_revision: decision.expectedCandidateRevision, expected_current_state: 'open' });
        if (candidateAdvanced.changes !== 1) fail('P6_PEOPLE_MERGE_CANDIDATE_FENCE', 'Merge Candidate head changed concurrently.');

        const preference = resolveMergePreference(personRepository, decision, sourcePreference, targetPreference, context.commitTimeMs);
        const aliases = mergeByKey(target.revision.aliases, source.revision.aliases, (item) => item.aliasNormalized);
        const providerIdentities = mergeByKey(target.revision.providerIdentities, source.revision.providerIdentities,
          (item) => [item.provider, item.namespace, item.providerKey].join('\u0000'));
        const originCandidateRef = { candidateKind: 'merge', candidateId: candidate.candidateId,
          candidateRevision: decision.expectedCandidateRevision, candidatePayloadDigest: candidate.candidatePayloadDigest };
        const targetFact = { personStatus: 'active', canonicalName: target.revision.canonicalName, mergedIntoPersonId: null,
          originKind: 'candidate', originDecisionRef: null, originCandidateRef, aliases, providerIdentities };
        const sourceFact = { personStatus: 'merged', canonicalName: source.revision.canonicalName,
          mergedIntoPersonId: target.personId, originKind: 'candidate', originDecisionRef: null, originCandidateRef, aliases: source.revision.aliases,
          providerIdentities: source.revision.providerIdentities };
        const targetDigest = canonicalDigest(targetFact);
        const sourceDigest = canonicalDigest(sourceFact);
        personRepository.invoke('deactivate_provider_identities', { active_guard: 0, person_id: source.personId });
        personRepository.invoke('deactivate_provider_identities', { active_guard: 0, person_id: target.personId });
        writePersonRevision(personRepository, { personId: source.personId, revision: source.currentRevision + 1,
          ...sourceFact, factDigest: sourceDigest }, context.commitTimeMs, false);
        writePersonRevision(personRepository, { personId: target.personId, revision: target.currentRevision + 1,
          ...targetFact, factDigest: targetDigest }, context.commitTimeMs, false);
        const sourceAdvanced = personRepository.invoke('advance_person_head', { status: 'merged', current_revision: source.currentRevision + 1,
          terminal_at_ms: context.commitTimeMs, person_id: source.personId, expected_current_revision: source.currentRevision,
          expected_status: 'active' });
        const targetAdvanced = personRepository.invoke('advance_person_head', { status: 'active', current_revision: target.currentRevision + 1,
          terminal_at_ms: null, person_id: target.personId, expected_current_revision: target.currentRevision, expected_status: 'active' });
        if (sourceAdvanced.changes !== 1 || targetAdvanced.changes !== 1) {
          fail('P6_PEOPLE_MERGE_PERSON_FENCE', 'Merge Person head changed concurrently.');
        }
        const preferenceResolution = { resolution: decision.preferenceResolution,
          sourcePreferenceRevision: decision.expectedSourcePreferenceRevision,
          targetPreferenceRevision: decision.expectedTargetPreferenceRevision,
          committedTargetPreferenceRevision: preference ? preference.revision : null,
          committedPreferenceLevel: preference ? preference.preferenceLevel : null };
        personRepository.invoke('insert_merge_record', { merge_record_id: decision.decisionId,
          merge_candidate_id: decision.candidateId, merge_candidate_revision: nextCandidateRevision.revision,
          source_person_id: source.personId, previous_source_person_revision: source.currentRevision,
          committed_source_person_revision: source.currentRevision + 1, target_person_id: target.personId,
          previous_target_person_revision: target.currentRevision, committed_target_person_revision: target.currentRevision + 1,
          preference_resolution_digest: canonicalDigest(preferenceResolution), decision_digest: decision.decisionDigest,
          committed_at_ms: context.commitTimeMs });
        for (const affectedPersonId of affectedProjectionIds(personRepository, source.personId)) {
          checkpointProjection(personRepository, affectedPersonId);
        }
        const acceptedCandidateRef = { candidateKind: 'merge', candidateId: candidate.candidateId,
          candidateRevision: decision.expectedCandidateRevision, candidatePayloadDigest: candidate.candidatePayloadDigest };
        const resultFact = { operationKind: 'merge', personId: target.personId, canonicalName: target.revision.canonicalName,
          aliasSetDigest: canonicalDigest(aliases), providerIdentitySetDigest: canonicalDigest(providerIdentities), acceptedCandidateRef,
          affectedPersonRevisions: [
            { personId: target.personId, revision: target.currentRevision + 1, status: 'active', factDigest: targetDigest },
            { personId: source.personId, revision: source.currentRevision + 1, status: 'merged', factDigest: sourceDigest }
          ], mergeRecordRef: decision.decisionId,
          preferenceRevisionRef: preference ? target.personId + '@' + preference.revision : null };
        return Object.freeze({ schemaRef: resultSchemaRef, schemaVersion: 1, factId: handle.handleId, ownerDomain: 'people',
          aggregateType: handle.aggregateType, aggregateId: target.personId, revision: target.currentRevision + 1,
          factSchemaRef: resultSchemaRef, factDigest: canonicalDigest(resultFact), commitMarker: handle.commitIdempotencyKey,
          committedAtMs: context.commitTimeMs, ...resultFact });
      } });
    },
    getRegistrationCandidate(candidateId) {
      return execute([candidates], (context) => mapRegistrationCandidate(context.repository(candidates.repositoryId),
        context.repository(candidates.repositoryId).invoke('find_registration_candidate', { registration_candidate_id: candidateId })), 'people_candidate_store');
    },
    findRegistrationCandidateByEvidence(evidenceDigest) {
      return execute([candidates], (context) => {
        const repository=context.repository(candidates.repositoryId);
        return mapRegistrationCandidate(repository,
          repository.invoke('find_registration_candidate_by_evidence', { evidence_digest:evidenceDigest }));
      }, 'people_candidate_store');
    },
    listRegistrationCandidates() {
      return execute([candidates], (context) => {
        const repository = context.repository(candidates.repositoryId);
        return Object.freeze(repository.invoke('list_registration_candidates')
          .map((row) => mapRegistrationCandidate(repository, row)));
      }, 'people_candidate_store');
    },
    getMergeCandidate(candidateId) {
      return execute([candidates], (context) => mapMergeCandidate(context.repository(candidates.repositoryId),
        context.repository(candidates.repositoryId).invoke('find_merge_candidate', { merge_candidate_id: candidateId })), 'people_candidate_store');
    },
    listMergeCandidates() {
      return execute([candidates], (context) => {
        const repository = context.repository(candidates.repositoryId);
        return Object.freeze(repository.invoke('list_merge_candidates')
          .map((row) => mapMergeCandidate(repository, row)));
      }, 'people_candidate_store');
    },
    acceptRegistrationCandidate(input) {
      const decision = validateRegistrationDecision(input);
      return execute([candidates, registry], (context) => {
        const candidateRepository = context.repository(candidates.repositoryId);
        const personRepository = context.repository(registry.repositoryId);
        const row = candidateRepository.invoke('find_registration_candidate', { registration_candidate_id: decision.candidateId });
        if (!row || row.current_state !== 'open' || row.current_revision !== decision.expectedCandidateRevision ||
            row.candidate_payload_digest !== decision.candidatePayloadDigest) {
          fail('P6_PEOPLE_REGISTRATION_CANDIDATE_FENCE', 'Registration Candidate revision or payload changed before acceptance.');
        }
        const candidate = mapRegistrationCandidate(candidateRepository, row);
        const nextCandidateRevision = createCandidateRevision({ candidateId: decision.candidateId,
          revision: decision.expectedCandidateRevision + 1, state: 'accepted', decisionOrigin: decision.decisionOrigin,
          decisionRef: decision.decisionId, decisionDigest: decision.decisionDigest, committedAtMs: context.commitTimeMs });
        candidateRepository.invoke('insert_registration_revision', candidateRevisionRow('registration', nextCandidateRevision));
        const advanced = candidateRepository.invoke('advance_registration_candidate', { current_revision: nextCandidateRevision.revision,
          current_state: 'accepted', terminal_at_ms: context.commitTimeMs, registration_candidate_id: decision.candidateId,
          expected_current_revision: decision.expectedCandidateRevision, expected_current_state: 'open' });
        if (advanced.changes !== 1) fail('P6_PEOPLE_REGISTRATION_CANDIDATE_FENCE', 'Registration Candidate head changed concurrently.');
        const originCandidateRef = { candidateKind: 'registration', candidateId: candidate.candidateId,
          candidateRevision: decision.expectedCandidateRevision, candidatePayloadDigest: candidate.candidatePayloadDigest };
        const personFact = { personStatus: 'active', canonicalName: candidate.candidatePayload.proposedName, mergedIntoPersonId: null,
          originCandidateRef, aliases: candidate.candidatePayload.aliases, providerIdentities: candidate.candidatePayload.providerIdentities };
        const factDigest = canonicalDigest(personFact);
        personRepository.invoke('insert_person', { person_id: decision.newPersonId, status: 'active', current_revision: 1,
          current_preference_revision: null, current_reference_revision: null, current_reference_projection_revision: 1,
          current_reference_projection_digest: initialProjectionDigest(decision.newPersonId), created_at_ms: context.commitTimeMs, terminal_at_ms: null });
        writePersonRevision(personRepository, { personId: decision.newPersonId, revision: 1, ...personFact,
          originKind: 'candidate', originDecisionRef: null, factDigest }, context.commitTimeMs, false);
        return mapPerson(personRepository, personRepository.invoke('find_person', { person_id: decision.newPersonId }));
      }, 'people_registration_acceptance');
    },
    dismissCandidate(input) {
      exactInput(input, ['candidateKind', 'candidateId', 'expectedRevision', 'decisionId', 'actorId', 'decisionDigest'],
        'P6_PEOPLE_DISMISS_CANDIDATE_INPUT');
      if (!['registration', 'merge'].includes(input.candidateKind) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
          typeof input.decisionId !== 'string' || input.decisionId.length < 1 || typeof input.actorId !== 'string' || input.actorId.length < 1 ||
          canonicalDigest(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'decisionDigest'))) !== input.decisionDigest) {
        fail('P6_PEOPLE_DISMISS_CANDIDATE_DECISION', 'Dismiss Candidate Decision is invalid.');
      }
      return execute([candidates], (context) => {
        const repository = context.repository(candidates.repositoryId);
        const registration = input.candidateKind === 'registration';
        const findStatement = registration ? 'find_registration_candidate' : 'find_merge_candidate';
        const idColumn = registration ? 'registration_candidate_id' : 'merge_candidate_id';
        const row = repository.invoke(findStatement, { [idColumn]: input.candidateId });
        if (!row || row.current_state !== 'open' || row.current_revision !== input.expectedRevision) {
          fail('P6_PEOPLE_CANDIDATE_STATE_CONFLICT', 'Candidate is missing, stale, or no longer open.');
        }
        const item = createCandidateRevision({ candidateId: input.candidateId, revision: input.expectedRevision + 1, state: 'dismissed',
          decisionOrigin: 'user', decisionRef: input.decisionId, decisionDigest: input.decisionDigest, committedAtMs: context.commitTimeMs });
        repository.invoke(registration ? 'insert_registration_revision' : 'insert_merge_revision',
          candidateRevisionRow(input.candidateKind, item));
        const parameters = { current_revision: item.revision, current_state: 'dismissed', terminal_at_ms: context.commitTimeMs,
          [idColumn]: input.candidateId, expected_current_revision: input.expectedRevision, expected_current_state: 'open' };
        const advanced = repository.invoke(registration ? 'advance_registration_candidate' : 'advance_merge_candidate', parameters);
        if (advanced.changes !== 1) fail('P6_PEOPLE_CANDIDATE_STATE_CONFLICT', 'Candidate head changed concurrently.');
        return registration
          ? mapRegistrationCandidate(repository, repository.invoke(findStatement, { [idColumn]: input.candidateId }))
          : mapMergeCandidate(repository, repository.invoke(findStatement, { [idColumn]: input.candidateId }));
      }, 'people_candidate_store');
    }
  });
}

function verifyMergeRefs(repository, payload) {
  for (const ref of [payload.leftPersonRef, payload.rightPersonRef]) {
    const person = repository.invoke('find_person', { person_id: ref.personId });
    const fact = repository.invoke('find_person_revision', { person_id: ref.personId, revision: ref.revision });
    if (!person || person.status !== 'active' || person.current_revision !== ref.revision ||
        person.current_preference_revision !== ref.preferenceRevision || !fact || fact.fact_digest !== ref.factDigest) {
      fail('P6_PEOPLE_MERGE_PERSON_FENCE', 'Merge Candidate Person reference is stale or does not match the exact current fact.');
    }
  }
}
function validateReferenceDecision(value) {
  const common = ['decisionId', 'operationKind', 'personId', 'expectedPersonRevision', 'expectedReferenceRevision', 'actorId', 'decisionDigest'];
  const add = ['referenceAssetId', 'referenceFaceId', 'artifactHandle', 'artifactDigest', 'faceEmbeddingSetHandle', 'modelRef', 'initialState'];
  const release = ['referenceAssetId', 'referenceFaceId', 'expectedAssetState', 'expectedFaceState', 'terminalState',
    'artifactDigest', 'embeddingDigest', 'modelRef'];
  exactInput(value, [...common, ...(value && value.operationKind === 'add_image' ? add : release)], 'P6_PEOPLE_REFERENCE_DECISION_INPUT');
  if (!['add_image', 'release_image'].includes(value.operationKind) || !Number.isSafeInteger(value.expectedPersonRevision) ||
      value.expectedPersonRevision < 1 || !Number.isSafeInteger(value.expectedReferenceRevision) || value.expectedReferenceRevision < 0 ||
      canonicalDigest(without(value, 'decisionDigest')) !== value.decisionDigest) {
    fail('P6_PEOPLE_REFERENCE_DECISION_CONTRACT', 'Reference Maintenance Decision is invalid.');
  }
  if (value.operationKind === 'add_image') {
    const artifact = value.artifactHandle;
    const embedding = value.faceEmbeddingSetHandle;
    if (value.initialState !== 'active' || !artifact || artifact.artifactHandleId === undefined ||
        artifact.digestHex !== value.artifactDigest || !embedding || embedding.artifactHandleId === undefined ||
        embedding.modelRef !== value.modelRef || embedding.detectedFaceCount !== 1 || embedding.vectorCount !== 1 ||
        embedding.sourceArtifactSetDigest !== value.artifactDigest || typeof embedding.digestHex !== 'string') {
      fail('P6_PEOPLE_REFERENCE_ADD_EVIDENCE', 'Reference add requires one face and exact Artifact/Embedding/model bindings.');
    }
  } else if (value.expectedAssetState !== 'active' || value.expectedFaceState !== 'active' || value.terminalState !== 'released') {
    fail('P6_PEOPLE_REFERENCE_RELEASE_STATE', 'Reference release state transition is invalid.');
  }
  return Object.freeze({ ...value });
}
function validateDirectRegistrationDecision(value) {
  exactInput(value, ['decisionId', 'newPersonId', 'canonicalName', 'aliases', 'providerIdentities', 'actorId', 'decisionDigest'],
    'P6_PEOPLE_DIRECT_REGISTRATION_INPUT');
  if (canonicalDigest(without(value, 'decisionDigest')) !== value.decisionDigest) {
    fail('P6_PEOPLE_DIRECT_REGISTRATION_DIGEST', 'Direct Person Registration Decision digest is invalid.');
  }
  return Object.freeze({ ...value });
}
function validateRegistrationDecision(value) {
  const common = ['decisionId', 'candidateKind', 'candidateId', 'expectedCandidateRevision', 'candidatePayloadDigest',
    'decisionOrigin', 'decisionDigest', 'newPersonId'];
  const originField = value && value.decisionOrigin === 'user' ? 'actorId' : 'ruleRevision';
  exactInput(value, [...common, originField], 'P6_PEOPLE_REGISTRATION_DECISION_INPUT');
  if (value.candidateKind !== 'registration' || !['user', 'strong_identity_rule'].includes(value.decisionOrigin) ||
      !Number.isSafeInteger(value.expectedCandidateRevision) || value.expectedCandidateRevision < 1 ||
      value.decisionOrigin === 'user' && (typeof value.actorId !== 'string' || value.actorId.length < 1) ||
      value.decisionOrigin === 'strong_identity_rule' && (!Number.isSafeInteger(value.ruleRevision) || value.ruleRevision < 1)) {
    fail('P6_PEOPLE_REGISTRATION_DECISION_CONTRACT', 'Registration acceptance Decision is invalid.');
  }
  const basis = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'decisionDigest'));
  if (canonicalDigest(basis) !== value.decisionDigest) fail('P6_PEOPLE_REGISTRATION_DECISION_DIGEST', 'Registration Decision digest is invalid.');
  return Object.freeze({ ...value });
}
function validateMergeDecision(value) {
  const common = ['decisionId', 'candidateKind', 'candidateId', 'expectedCandidateRevision', 'candidatePayloadDigest',
    'decisionOrigin', 'decisionDigest', 'sourcePersonId', 'targetPersonId', 'expectedSourcePersonRevision',
    'expectedTargetPersonRevision', 'expectedSourcePreferenceRevision', 'expectedTargetPreferenceRevision', 'preferenceResolution'];
  const originField = value && value.decisionOrigin === 'user' ? 'actorId' : 'ruleRevision';
  const explicit = value && value.preferenceResolution === 'set_explicit' ? ['explicitPreferenceLevel'] : [];
  exactInput(value, [...common, originField, ...explicit], 'P6_PEOPLE_MERGE_DECISION_INPUT');
  const nullableRevision = (item) => item === null || Number.isSafeInteger(item) && item >= 1;
  if (value.candidateKind !== 'merge' || !['user', 'strong_identity_rule'].includes(value.decisionOrigin) ||
      typeof value.sourcePersonId !== 'string' || value.sourcePersonId.length < 1 ||
      typeof value.targetPersonId !== 'string' || value.targetPersonId.length < 1 || value.sourcePersonId === value.targetPersonId ||
      !Number.isSafeInteger(value.expectedCandidateRevision) || value.expectedCandidateRevision < 1 ||
      !Number.isSafeInteger(value.expectedSourcePersonRevision) || value.expectedSourcePersonRevision < 1 ||
      !Number.isSafeInteger(value.expectedTargetPersonRevision) || value.expectedTargetPersonRevision < 1 ||
      !nullableRevision(value.expectedSourcePreferenceRevision) || !nullableRevision(value.expectedTargetPreferenceRevision) ||
      !['keep_source', 'keep_target', 'set_explicit'].includes(value.preferenceResolution) ||
      value.preferenceResolution === 'set_explicit' && (!Number.isInteger(value.explicitPreferenceLevel) ||
        value.explicitPreferenceLevel < -2 || value.explicitPreferenceLevel > 2) ||
      value.decisionOrigin === 'user' && (typeof value.actorId !== 'string' || value.actorId.length < 1) ||
      value.decisionOrigin === 'strong_identity_rule' && (!Number.isSafeInteger(value.ruleRevision) || value.ruleRevision < 1)) {
    fail('P6_PEOPLE_MERGE_DECISION_CONTRACT', 'Merge acceptance Decision is invalid.');
  }
  const basis = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'decisionDigest'));
  if (canonicalDigest(basis) !== value.decisionDigest) fail('P6_PEOPLE_MERGE_DECISION_DIGEST', 'Merge Decision digest is invalid.');
  return Object.freeze({ ...value });
}
function currentPreference(repository, personRow) {
  return personRow.current_preference_revision === null ? undefined : mapPreference(repository.invoke('find_preference', {
    person_id: personRow.person_id, revision: personRow.current_preference_revision
  }));
}
function resolveMergePreference(repository, decision, sourcePreference, targetPreference, committedAtMs) {
  if (decision.preferenceResolution === 'keep_target') return targetPreference;
  if (decision.preferenceResolution === 'keep_source' && !sourcePreference) {
    fail('P6_PEOPLE_MERGE_SOURCE_PREFERENCE_REQUIRED', 'keep_source requires an exact source Preference revision.');
  }
  const preferenceLevel = decision.preferenceResolution === 'keep_source'
    ? sourcePreference.preferenceLevel : decision.explicitPreferenceLevel;
  const reason = decision.preferenceResolution === 'keep_source'
    ? 'Merge ' + decision.decisionId + ' kept source Preference: ' + sourcePreference.reason
    : 'Merge ' + decision.decisionId + ' set an explicit Preference.';
  const revision = targetPreference ? targetPreference.revision + 1 : 1;
  const person = repository.invoke('find_person', { person_id: decision.targetPersonId });
  const item = createPreference({ personId: decision.targetPersonId, revision, preferenceLevel, reason,
    originKind: 'merge_decision', originRef: decision.decisionId, committedAtMs });
  repository.invoke('insert_preference', preferenceRow(item));
  const advanced = person.current_preference_revision === null
    ? repository.invoke('initialize_preference_head', { current_preference_revision: revision, person_id: decision.targetPersonId })
    : repository.invoke('advance_preference_head', { current_preference_revision: revision, person_id: decision.targetPersonId,
      expected_preference_revision: person.current_preference_revision });
  if (advanced.changes !== 1) fail('P6_PEOPLE_MERGE_PERSON_FENCE', 'Target Preference head changed concurrently.');
  return item;
}
function mergeByKey(preferred, fallback, key) {
  const items = new Map(fallback.map((item) => [key(item), item]));
  for (const item of preferred) items.set(key(item), item);
  return [...items.values()].sort((left, right) => key(left).localeCompare(key(right)));
}
function personRevisionRow(item) {
  const origin = item.originCandidateRef;
  const direct = item.originDecisionRef;
  return { person_id: item.personId, revision: item.revision, person_status: item.personStatus, canonical_name: item.canonicalName,
    merged_into_person_id: item.mergedIntoPersonId, origin_kind: item.originKind, origin_decision_id: direct && direct.decisionId,
    origin_decision_digest: direct && direct.decisionDigest, origin_candidate_kind: origin && origin.candidateKind,
    origin_candidate_id: origin && origin.candidateId, origin_candidate_revision: origin && origin.candidateRevision,
    origin_candidate_payload_digest: origin && origin.candidatePayloadDigest, fact_digest: item.factDigest, committed_at_ms: item.committedAtMs };
}
function mapPerson(repository, row) {
  if (!row) return undefined;
  const fact = repository.invoke('find_person_revision', { person_id: row.person_id, revision: row.current_revision });
  if (!fact) fail('P6_PEOPLE_PERSON_HEAD_CORRUPT', 'Person head does not point to an immutable revision.');
  const hasOrigin = fact.origin_candidate_kind !== null || fact.origin_candidate_id !== null || fact.origin_candidate_revision !== null ||
    fact.origin_candidate_payload_digest !== null;
  if (hasOrigin && [fact.origin_candidate_kind, fact.origin_candidate_id, fact.origin_candidate_revision,
    fact.origin_candidate_payload_digest].some((item) => item === null)) fail('P6_PEOPLE_PERSON_ORIGIN_CORRUPT', 'Person Candidate origin is only partially stored.');
  return createPerson({ personId: row.person_id, status: row.status, currentRevision: row.current_revision,
    currentPreferenceRevision: row.current_preference_revision, currentReferenceRevision: row.current_reference_revision,
    currentReferenceProjectionRevision: row.current_reference_projection_revision,
    currentReferenceProjectionDigest: row.current_reference_projection_digest, createdAtMs: row.created_at_ms, terminalAtMs: row.terminal_at_ms,
    revision: { personId: fact.person_id, revision: fact.revision, personStatus: fact.person_status, canonicalName: fact.canonical_name,
      mergedIntoPersonId: fact.merged_into_person_id, originKind: fact.origin_kind,
      originDecisionRef: fact.origin_kind === 'direct' ? { decisionId: fact.origin_decision_id, decisionDigest: fact.origin_decision_digest } : null,
      originCandidateRef: hasOrigin ? { candidateKind: fact.origin_candidate_kind,
        candidateId: fact.origin_candidate_id, candidateRevision: fact.origin_candidate_revision,
        candidatePayloadDigest: fact.origin_candidate_payload_digest } : null, factDigest: fact.fact_digest,
      committedAtMs: fact.committed_at_ms,
      aliases: repository.invoke('find_aliases', { person_id: row.person_id, revision: row.current_revision }).map((item) => ({
        aliasNormalized: item.alias_normalized, aliasDisplay: item.alias_display, provenanceDigest: item.provenance_digest
      })).sort((a, b) => a.aliasNormalized.localeCompare(b.aliasNormalized)),
      providerIdentities: repository.invoke('find_provider_identities', { person_id: row.person_id, revision: row.current_revision }).map((item) => ({
        provider: item.provider, namespace: item.namespace, providerKey: item.provider_key, provenanceDigest: item.provenance_digest
      })).sort((a, b) => [a.provider, a.namespace, a.providerKey].join('\u0000').localeCompare([b.provider, b.namespace, b.providerKey].join('\u0000'))) } });
}
function preferenceRow(item) { return { person_id: item.personId, revision: item.revision, preference_level: item.preferenceLevel,
  reason: item.reason, origin_kind: item.originKind, origin_ref: item.originRef, committed_at_ms: item.committedAtMs }; }
function mapPreference(row) { return row && createPreference({ personId: row.person_id, revision: row.revision,
  preferenceLevel: row.preference_level, reason: row.reason, originKind: row.origin_kind, originRef: row.origin_ref, committedAtMs: row.committed_at_ms }); }
function assetRow(item) { return { reference_asset_id: item.referenceAssetId, person_id: item.personId, artifact_handle_id: item.artifactHandleId,
  artifact_digest: item.artifactDigest, state: item.state, created_reference_revision: item.createdReferenceRevision,
  released_reference_revision: item.releasedReferenceRevision, created_at_ms: item.createdAtMs, released_at_ms: item.releasedAtMs }; }
function mapAsset(row) { return row && createReferenceAsset({ referenceAssetId: row.reference_asset_id, personId: row.person_id,
  artifactHandleId: row.artifact_handle_id, artifactDigest: row.artifact_digest, state: row.state,
  createdReferenceRevision: row.created_reference_revision, releasedReferenceRevision: row.released_reference_revision,
  createdAtMs: row.created_at_ms, releasedAtMs: row.released_at_ms }); }
function faceRow(item) { return { reference_face_id: item.referenceFaceId, person_id: item.personId, reference_asset_id: item.referenceAssetId,
  embedding_handle_id: item.embeddingHandleId, embedding_digest: item.embeddingDigest, model_ref: item.modelRef, state: item.state,
  created_reference_revision: item.createdReferenceRevision, released_reference_revision: item.releasedReferenceRevision,
  created_at_ms: item.createdAtMs, released_at_ms: item.releasedAtMs }; }
function mapFace(row) { return row && createReferenceFace({ referenceFaceId: row.reference_face_id, personId: row.person_id,
  referenceAssetId: row.reference_asset_id, embeddingHandleId: row.embedding_handle_id, embeddingDigest: row.embedding_digest,
  modelRef: row.model_ref, state: row.state, createdReferenceRevision: row.created_reference_revision,
  releasedReferenceRevision: row.released_reference_revision, createdAtMs: row.created_at_ms, releasedAtMs: row.released_at_ms }); }
function candidateRevisionRow(kind, item) { return { [kind + '_candidate_id']: item.candidateId, revision: item.revision, state: item.state,
  decision_origin: item.decisionOrigin, decision_ref: item.decisionRef, decision_digest: item.decisionDigest, committed_at_ms: item.committedAtMs }; }
function mapCandidateRevision(row, candidateId) { return createCandidateRevision({ candidateId, revision: row.revision, state: row.state,
  decisionOrigin: row.decision_origin, decisionRef: row.decision_ref, decisionDigest: row.decision_digest, committedAtMs: row.committed_at_ms }); }
function mapRegistrationCandidate(repository, row) {
  if (!row) return undefined;
  const state = repository.invoke('find_registration_revision', { registration_candidate_id: row.registration_candidate_id, revision: row.current_revision });
  if (!state) fail('P6_PEOPLE_CANDIDATE_HEAD_CORRUPT', 'Registration Candidate head has no exact immutable revision.');
  return createCandidate({ candidateId: row.registration_candidate_id, currentRevision: row.current_revision, currentState: row.current_state,
    proposedName: row.proposed_name, evidenceDigest: row.evidence_digest, candidateSchemaRef: row.candidate_schema_ref,
    candidatePayload: JSON.parse(row.candidate_json), candidatePayloadDigest: row.candidate_payload_digest, createdAtMs: row.created_at_ms,
    terminalAtMs: row.terminal_at_ms, revision: mapCandidateRevision(state, row.registration_candidate_id) }, 'registration');
}
function mapMergeCandidate(repository, row) {
  if (!row) return undefined;
  const state = repository.invoke('find_merge_revision', { merge_candidate_id: row.merge_candidate_id, revision: row.current_revision });
  if (!state) fail('P6_PEOPLE_CANDIDATE_HEAD_CORRUPT', 'Merge Candidate head has no exact immutable revision.');
  return createCandidate({ candidateId: row.merge_candidate_id, currentRevision: row.current_revision, currentState: row.current_state,
    leftPersonId: row.left_person_id, leftPersonRevision: row.left_person_revision, rightPersonId: row.right_person_id,
    rightPersonRevision: row.right_person_revision, evidenceDigest: row.evidence_digest, candidateSchemaRef: row.candidate_schema_ref,
    candidatePayload: JSON.parse(row.candidate_json), candidatePayloadDigest: row.candidate_payload_digest, createdAtMs: row.created_at_ms,
    terminalAtMs: row.terminal_at_ms, revision: mapCandidateRevision(state, row.merge_candidate_id) }, 'merge');
}

module.exports = Object.freeze({ PeopleStoreError, createPeopleStore });
