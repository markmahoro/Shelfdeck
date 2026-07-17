'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../src/helix/foundation/persistence/commit-foundation');
const { createDomainCommitCoordinator, createDomainCommitRegistry } = require('../../src/helix/foundation/persistence/domain-commit-registry');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPeopleStore } = require('../../src/helix/domains/people/persistence/people-store');
const {
  createPeopleCandidateCommitRegistration, createPeopleCandidateAcceptanceRegistration, createDirectPersonRegistrationCommand
} = require('../../src/helix/domains/people/capabilities/people-registration-lifecycle');
const { createPeoplePreferenceCommitRegistration } = require('../../src/helix/domains/people/capabilities/people-preference-lifecycle');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-people-registration-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 1_700_030_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createPeopleStore({ schemaManifest, unitOfWork });
  const registry = createDomainCommitRegistry({ registrations: [
    createPeopleCandidateCommitRegistration(store), createPeopleCandidateAcceptanceRegistration(store),
    createPeoplePreferenceCommitRegistration(store)
  ] });
  const coordinator = createDomainCommitCoordinator({ schemaManifest, registry, unitOfWork });
  const directRegistration = createDirectPersonRegistrationCommand(store, createCommandCommitCoordinator({ schemaManifest, unitOfWork }));
  const setup = new Database(databasePath);
  setup.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('work-1', 'people', 'registration', 'registration-1', 'candidate', hash('basis'), 'normal', 'running', 'work-key', 1, 1);
  setup.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)')
    .run('attempt-1', 'work-1', 1, hash('basis'), 'running', 1);
  setup.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('plan-1', 'attempt-1', 'people-registration@1', 1, hash('catalog'), hash('basis'), hash('graph'), 'planned', 1);
  for (const [eventId, nodeId, capabilityRef] of [
    ['event-candidate', 'node-candidate', 'people.candidate.commit@1'],
    ['event-accept', 'node-accept', 'people.person.commit@1'],
    ['event-preference', 'node-preference', 'people.preference.commit@1']
  ]) setup.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId, 'plan-1', nodeId, 'work-1', 'attempt-1', 'people', capabilityRef, 1, 'executing', 'normal', 1);
  setup.close();
  try { return run({ coordinator, databasePath, store, directRegistration }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function draft(id = 'registration-1', providerKey = id) {
  const candidatePayload = {
    proposedName: `Candidate ${id}`,
    aliases: [{ aliasDisplay: id, aliasNormalized: id.toLowerCase(), provenanceDigest: hash(`${id}:alias`) }],
    providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey, provenanceDigest: hash(`${id}:provider`) }],
    referenceHints: [{ hintKind: 'portrait', referenceValue: `artifact:${id}`, provenanceDigest: hash(`${id}:hint`) }]
  };
  return { schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1, draftId: id,
    draftKind: 'people-candidate', basisDigest: hash(`${id}:basis`), draftDigest: hash(`${id}:draft`), producedAtMs: 1_700_000_000_000,
    candidateKind: 'registration', evidenceDigest: hash(`${id}:evidence`), candidatePayload,
    candidatePayloadDigest: canonicalDigest(candidatePayload) };
}

function handle(payload, options) {
  return { schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
    handleId: options.handleId, ownerDomain: 'people', aggregateType: options.aggregateType, aggregateId: options.aggregateId,
    factType: options.factType, factSchemaRef: options.factSchemaRef, expectedRevision: options.expectedRevision || 0,
    payloadDigest: canonicalDigest(payload), resultSchemaRef: options.resultSchemaRef,
    commitIdempotencyKey: options.commitKey, eventFenceDigest: hash(`${options.commitKey}:fence`) };
}

function request(payload, domainHandle, id, eventId, revision = 1) {
  return { handle: domainHandle, payload,
    commitMarker: { commitMarker: `marker-${id}`, effectId: null, commitDigest: hash(`${id}:commit`) },
    resultBinding: { resultId: `result-${id}`, eventId, evidenceSchemaRef: 'helix://fixtures/PeopleLifecycleEvidence/v1',
      evidence: { schemaRef: 'helix://fixtures/PeopleLifecycleEvidence/v1', schemaVersion: 1, evidenceId: `evidence-${id}` } },
    outboxMessages: [{ messageId: `message-${id}`, producerDomain: 'people', messageKind: `people.${id}`,
      aggregateType: domainHandle.aggregateType, aggregateId: domainHandle.aggregateId, aggregateRevision: revision,
      dedupKey: `${id}/committed`, intendedConsumers: ['people-projection'], payloadSchemaRef: 'helix://fixtures/PeopleCommittedSignal/v1',
      payload: { [`${domainHandle.aggregateType.replace(/-([a-z])/g, (_, value) => value.toUpperCase())}Id`]: domainHandle.aggregateId,
        aggregateRevision: revision } }] };
}

function candidateRequest(value = draft()) {
  const domainHandle = handle(value, { handleId: 'candidate-handle', aggregateType: 'people-candidate', aggregateId: value.draftId,
    factType: 'PeopleCandidateDraft', factSchemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1',
    resultSchemaRef: 'helix://contracts/types/PeopleCandidateRevision/v1', commitKey: 'candidate-key' });
  return request(value, domainHandle, 'candidate', 'event-candidate');
}

function registrationDecision(candidate, overrides = {}) {
  const value = { decisionId: 'decision-1', candidateKind: 'registration', candidateId: candidate.candidateId,
    expectedCandidateRevision: candidate.currentRevision, candidatePayloadDigest: candidate.candidatePayloadDigest,
    decisionOrigin: 'user', actorId: 'user-1', newPersonId: 'person-new', ...overrides };
  return { ...value, decisionDigest: canonicalDigest(value) };
}

function acceptanceRequest(value) {
  const domainHandle = handle(value, { handleId: 'accept-handle', aggregateType: 'person', aggregateId: value.newPersonId,
    factType: 'PeopleCandidateAcceptanceDecision', factSchemaRef: 'helix://contracts/domain-types/PeopleCandidateAcceptanceDecision/v1',
    resultSchemaRef: 'helix://contracts/types/PersonRevision/v1', commitKey: 'accept-key' });
  return request(value, domainHandle, 'accept', 'event-accept');
}

function mergeDraft(store, id = 'merge-1') {
  const left = store.getPerson('person-left');
  const right = store.getPerson('person-right');
  const candidatePayload = {
    leftPersonRef: { personId: left.personId, revision: left.currentRevision, factDigest: left.revision.factDigest,
      preferenceRevision: left.currentPreferenceRevision },
    rightPersonRef: { personId: right.personId, revision: right.currentRevision, factDigest: right.revision.factDigest,
      preferenceRevision: right.currentPreferenceRevision },
    matchSignals: [{ objectId: 'signal-1', revision: 1, schemaRef: 'helix://fixtures/PersonMatchSignal/v1',
      snapshotDigest: hash('signal'), objectKind: 'person-match-signal' }],
    conflictSummary: { schemaRef: 'helix://fixtures/MergeConflictSummary/v1', schemaVersion: 1,
      recordKind: 'merge-conflict-summary', recordDigest: hash('conflicts'), entries: [] },
    evidenceRefs: ['evidence-1']
  };
  return { schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1, draftId: id,
    draftKind: 'people-candidate', basisDigest: hash(`${id}:basis`), draftDigest: hash(`${id}:draft`), producedAtMs: 1_700_000_000_000,
    candidateKind: 'merge', evidenceDigest: hash(`${id}:evidence`), candidatePayload,
    candidatePayloadDigest: canonicalDigest(candidatePayload) };
}

function mergeDecision(candidate, overrides = {}) {
  const value = { decisionId: 'merge-decision-1', candidateKind: 'merge', candidateId: candidate.candidateId,
    expectedCandidateRevision: candidate.currentRevision, candidatePayloadDigest: candidate.candidatePayloadDigest,
    decisionOrigin: 'user', actorId: 'user-1', sourcePersonId: 'person-left', targetPersonId: 'person-right',
    expectedSourcePersonRevision: candidate.candidatePayload.leftPersonRef.revision,
    expectedTargetPersonRevision: candidate.candidatePayload.rightPersonRef.revision,
    expectedSourcePreferenceRevision: candidate.candidatePayload.leftPersonRef.preferenceRevision,
    expectedTargetPreferenceRevision: candidate.candidatePayload.rightPersonRef.preferenceRevision,
    preferenceResolution: 'keep_source', ...overrides };
  return { ...value, decisionDigest: canonicalDigest(value) };
}

function mergeAcceptanceRequest(value) {
  const domainHandle = handle(value, { handleId: 'merge-accept-handle', aggregateType: 'person', aggregateId: value.targetPersonId,
    expectedRevision: value.expectedTargetPersonRevision, factType: 'PeopleCandidateAcceptanceDecision',
    factSchemaRef: 'helix://contracts/domain-types/PeopleCandidateAcceptanceDecision/v1',
    resultSchemaRef: 'helix://contracts/types/PersonRevision/v1', commitKey: 'merge-accept-key' });
  return request(value, domainHandle, 'accept', 'event-accept', value.expectedTargetPersonRevision + 1);
}

function registerDirect(store, personId, canonicalName, alias, provider, providerKey) {
  const value = { decisionId: `register-${personId}`, newPersonId: personId, canonicalName,
    aliases: [{ aliasDisplay: alias, aliasNormalized: alias.toLowerCase(), provenanceDigest: hash(`${personId}:alias`) }],
    providerIdentities: [{ provider, namespace: 'person', providerKey, provenanceDigest: hash(`${personId}:provider`) }], actorId: 'admin-1' };
  return store.registerDirectPerson({ ...value, decisionDigest: canonicalDigest(value) });
}

function seedMergePeople(store, preferences = true) {
  registerDirect(store, 'person-left', 'Source Person', 'Source Alias', 'tmdb', 'left');
  registerDirect(store, 'person-right', 'Target Person', 'Target Alias', 'imdb', 'right');
  if (preferences) {
    store.appendPreference({ personId: 'person-left', revision: 1, preferenceLevel: 2, reason: 'source choice',
      originKind: 'user', originRef: 'user-1' });
    store.appendPreference({ personId: 'person-right', revision: 1, preferenceLevel: -1, reason: 'target choice',
      originKind: 'user', originRef: 'user-1' });
  }
}

function preferenceIntent(personId = 'person-right', revision = 1) {
  const value = { schemaRef: 'helix://contracts/domain-types/PreferenceIntent/v1', schemaVersion: 1,
    intentId: `preference-${personId}-${revision}`, revision, personId, preferenceLevel: 1, reason: 'user preference',
    typedParameters: [{ parameter: 'confidence', valueType: 'integer', value: 2, valueDigest: canonicalDigest(2) }] };
  return { ...value, digest: canonicalDigest(value) };
}

function preferenceRequest(value) {
  const domainHandle = handle(value, { handleId: `preference-handle-${value.revision}`, aggregateType: 'person-preference',
    aggregateId: value.personId, expectedRevision: value.revision - 1, factType: 'PreferenceIntent',
    factSchemaRef: 'helix://contracts/domain-types/PreferenceIntent/v1',
    resultSchemaRef: 'helix://contracts/types/PersonPreferenceRevision/v1', commitKey: `preference-key-${value.revision}` });
  return request(value, domainHandle, 'preference', 'event-preference', value.revision);
}

test('commits complete Candidate head, open revision, typed Result, marker and Outbox with stable replay', () => {
  fixture(({ coordinator, databasePath, store }) => {
    const commit = candidateRequest();
    const first = coordinator.execute(commit);
    assert.equal(first.replayed, false);
    assert.equal(first.typedResult.schemaRef, 'helix://contracts/types/PeopleCandidateRevision/v1');
    assert.equal(first.typedResult.state, 'open');
    assert.equal(store.getRegistrationCandidate('registration-1').candidatePayload.proposedName, 'Candidate registration-1');
    assert.deepEqual(coordinator.execute(commit).typedResult, first.typedResult);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count, 1);
    inspected.close();
  });
});

test('accepts exact Registration Candidate and atomically creates global Person with full Candidate origin', () => {
  fixture(({ coordinator, databasePath, store }) => {
    coordinator.execute(candidateRequest());
    const candidate = store.getRegistrationCandidate('registration-1');
    const acceptance = acceptanceRequest(registrationDecision(candidate));
    const first = coordinator.execute(acceptance);
    assert.equal(first.typedResult.operationKind, 'registration');
    assert.equal(first.typedResult.personId, 'person-new');
    assert.deepEqual(coordinator.execute(acceptance).typedResult, first.typedResult);
    const person = store.getPerson('person-new');
    assert.equal(person.revision.canonicalName, candidate.candidatePayload.proposedName);
    assert.deepEqual(person.revision.originCandidateRef, {
      candidateKind: 'registration', candidateId: 'registration-1', candidateRevision: 1,
      candidatePayloadDigest: candidate.candidatePayloadDigest
    });
    assert.equal(store.getRegistrationCandidate('registration-1').currentState, 'accepted');
    assert.equal(store.getRegistrationCandidate('registration-1').currentRevision, 2);
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT revision,state FROM people_registration_candidate_revisions ORDER BY revision').all(),
      [{ revision: 1, state: 'open' }, { revision: 2, state: 'accepted' }]);
    inspected.close();
  });
});

test('stale Candidate revision or payload digest leaves Candidate open and creates no Person or durable acceptance residue', () => {
  fixture(({ coordinator, databasePath, store }) => {
    coordinator.execute(candidateRequest());
    const candidate = store.getRegistrationCandidate('registration-1');
    const stale = registrationDecision(candidate, { expectedCandidateRevision: 2 });
    assert.throws(() => coordinator.execute(acceptanceRequest(stale)),
      (error) => error.code === 'P6_PEOPLE_REGISTRATION_CANDIDATE_FENCE');
    assert.equal(store.getRegistrationCandidate('registration-1').currentState, 'open');
    assert.equal(store.getPerson('person-new'), undefined);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM fx_commit_markers WHERE owner_domain='people' AND scope_type='person'").get().count, 0);
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM fx_outbox WHERE aggregate_type='person'").get().count, 0);
    inspected.close();
  });
});

test('provider identity conflict rolls back Candidate acceptance and the entire new Person fact set', () => {
  fixture(({ coordinator, databasePath, store }) => {
    registerDirect(store, 'existing', 'Existing', 'Existing', 'tmdb', 'registration-1');
    coordinator.execute(candidateRequest());
    const candidate = store.getRegistrationCandidate('registration-1');
    assert.throws(() => coordinator.execute(acceptanceRequest(registrationDecision(candidate))),
      (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.equal(store.getRegistrationCandidate('registration-1').currentState, 'open');
    assert.equal(store.getPerson('person-new'), undefined);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_registration_candidate_revisions').get().count, 1);
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM fx_commit_markers WHERE scope_type='person'").get().count, 0);
    inspected.close();
  });
});

test('rejects malformed or tampered acceptance Decision before any Store write', () => {
  fixture(({ coordinator, store }) => {
    coordinator.execute(candidateRequest());
    const candidate = store.getRegistrationCandidate('registration-1');
    const valid = registrationDecision(candidate);
    const tampered = { ...valid, newPersonId: 'person-tampered' };
    assert.throws(() => coordinator.execute(acceptanceRequest(tampered)),
      (error) => error.code === 'P6_PEOPLE_REGISTRATION_DECISION_DIGEST');
    const wrongOrigin = { ...valid, decisionOrigin: 'strong_identity_rule', ruleRevision: 1 };
    delete wrongOrigin.actorId;
    assert.throws(() => coordinator.execute(acceptanceRequest(wrongOrigin)),
      (error) => error.code === 'P6_PEOPLE_REGISTRATION_DECISION_DIGEST');
    assert.equal(store.getRegistrationCandidate('registration-1').currentState, 'open');
  });
});

test('dismisses an exact open Candidate by appending one terminal revision without creating a Person', () => {
  fixture(({ coordinator, databasePath, store }) => {
    coordinator.execute(candidateRequest());
    const basis = { candidateKind: 'registration', candidateId: 'registration-1', expectedRevision: 1,
      decisionId: 'dismiss-1', actorId: 'user-1' };
    const dismissed = store.dismissCandidate({ ...basis, decisionDigest: canonicalDigest(basis) });
    assert.equal(dismissed.currentState, 'dismissed');
    assert.equal(dismissed.currentRevision, 2);
    assert.equal(store.getPerson('person-new'), undefined);
    assert.throws(() => store.dismissCandidate({ ...basis, decisionDigest: canonicalDigest(basis) }),
      (error) => error.code === 'P6_PEOPLE_CANDIDATE_STATE_CONFLICT');
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT revision,state FROM people_registration_candidate_revisions ORDER BY revision').all(),
      [{ revision: 1, state: 'open' }, { revision: 2, state: 'dismissed' }]);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_persons').get().count, 0);
    inspected.close();
  });
});

test('accepts Merge atomically, preserves target identity and resolves Preference', () => {
  fixture(({ coordinator, databasePath, store }) => {
    seedMergePeople(store);
    coordinator.execute(candidateRequest(mergeDraft(store)));
    const candidate = store.getMergeCandidate('merge-1');
    const commit = mergeAcceptanceRequest(mergeDecision(candidate));
    const first = coordinator.execute(commit);
    assert.equal(first.typedResult.operationKind, 'merge');
    assert.equal(first.typedResult.personId, 'person-right');
    assert.equal(first.typedResult.revision, 2);
    assert.deepEqual(coordinator.execute(commit).typedResult, first.typedResult);
    const source = store.getPerson('person-left');
    const target = store.getPerson('person-right');
    assert.equal(source.status, 'merged');
    assert.equal(source.revision.mergedIntoPersonId, 'person-right');
    assert.equal(target.status, 'active');
    assert.equal(target.revision.canonicalName, 'Target Person');
    assert.deepEqual(target.revision.aliases.map((item) => item.aliasNormalized), ['source alias', 'target alias']);
    assert.equal(store.getCurrentPreference('person-right').preferenceLevel, 2);
    assert.equal(store.getMergeCandidate('merge-1').currentState, 'accepted');
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT source_person_id,target_person_id,previous_source_person_revision,committed_source_person_revision,previous_target_person_revision,committed_target_person_revision FROM people_merge_records').get(), {
      source_person_id: 'person-left', target_person_id: 'person-right', previous_source_person_revision: 1,
      committed_source_person_revision: 2, previous_target_person_revision: 1, committed_target_person_revision: 2
    });
    inspected.close();
  });
});

test('stale Person or Preference fence rolls back the complete Merge acceptance', () => {
  fixture(({ coordinator, databasePath, store }) => {
    seedMergePeople(store);
    coordinator.execute(candidateRequest(mergeDraft(store)));
    const candidate = store.getMergeCandidate('merge-1');
    store.appendPreference({ personId: 'person-left', revision: 2, preferenceLevel: 1, reason: 'changed',
      originKind: 'user', originRef: 'user-2' });
    assert.throws(() => coordinator.execute(mergeAcceptanceRequest(mergeDecision(candidate))),
      (error) => error.code === 'P6_PEOPLE_MERGE_PERSON_FENCE');
    assert.equal(store.getMergeCandidate('merge-1').currentState, 'open');
    assert.equal(store.getPerson('person-left').status, 'active');
    assert.equal(store.getPerson('person-right').currentRevision, 1);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_merge_records').get().count, 0);
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM fx_commit_markers WHERE scope_type='person'").get().count, 0);
    inspected.close();
  });
});

test('strong identity rule cannot choose across conflicting Preferences', () => {
  fixture(({ coordinator, store }) => {
    seedMergePeople(store);
    coordinator.execute(candidateRequest(mergeDraft(store)));
    const candidate = store.getMergeCandidate('merge-1');
    const decision = mergeDecision(candidate, { decisionOrigin: 'strong_identity_rule', ruleRevision: 7,
      preferenceResolution: 'keep_target' });
    delete decision.actorId;
    decision.decisionDigest = canonicalDigest(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'decisionDigest')));
    assert.throws(() => coordinator.execute(mergeAcceptanceRequest(decision)),
      (error) => error.code === 'P6_PEOPLE_MERGE_PREFERENCE_USER_REQUIRED');
    assert.equal(store.getMergeCandidate('merge-1').currentState, 'open');
  });
});

test('explicit Merge Preference is committed on target and malformed decision is rejected before writes', () => {
  fixture(({ coordinator, store }) => {
    seedMergePeople(store, false);
    coordinator.execute(candidateRequest(mergeDraft(store)));
    const candidate = store.getMergeCandidate('merge-1');
    const invalid = mergeDecision(candidate, { preferenceResolution: 'set_explicit', explicitPreferenceLevel: 9 });
    assert.throws(() => coordinator.execute(mergeAcceptanceRequest(invalid)),
      (error) => error.code === 'P6_PEOPLE_MERGE_DECISION_CONTRACT');
    const valid = mergeDecision(candidate, { preferenceResolution: 'set_explicit', explicitPreferenceLevel: -2 });
    const result = coordinator.execute(mergeAcceptanceRequest(valid));
    assert.equal(result.typedResult.preferenceRevisionRef, 'person-right@1');
    assert.equal(store.getCurrentPreference('person-right').preferenceLevel, -2);
  });
});

test('commits a closed Preference Intent with stable replay and rejects digest tampering before writes', () => {
  fixture(({ coordinator, store }) => {
    seedMergePeople(store, false);
    const tampered = { ...preferenceIntent('person-left'), preferenceLevel: -2 };
    assert.throws(() => coordinator.execute(preferenceRequest(tampered)),
      (error) => error.code === 'P6_PEOPLE_PREFERENCE_INTENT_DIGEST');
    assert.equal(store.getCurrentPreference('person-left'), undefined);
    const intent = preferenceIntent();
    const first = coordinator.execute(preferenceRequest(intent));
    assert.equal(first.typedResult.schemaRef, 'helix://contracts/types/PersonPreferenceRevision/v1');
    assert.deepEqual(Object.keys(first.typedResult).sort(), [
      'aggregateId', 'aggregateType', 'commitMarker', 'committedAtMs', 'factDigest', 'factId', 'factSchemaRef', 'ownerDomain',
      'personId', 'preferenceLevel', 'reason', 'revision', 'schemaRef', 'schemaVersion'
    ]);
    assert.deepEqual(coordinator.execute(preferenceRequest(intent)).typedResult, first.typedResult);
    assert.equal(store.getCurrentPreference('person-right').originKind, 'preference_intent');
    assert.equal(store.getCurrentPreference('person-right').originRef, intent.intentId);
  });
});

test('direct registration atomically creates Person, initial Projection checkpoint, command receipt and People-internal Outbox', () => {
  fixture(({ databasePath, directRegistration, store }) => {
    const value = { decisionId: 'direct-1', newPersonId: 'person-direct', canonicalName: 'Direct Person', aliases: [],
      providerIdentities: [], actorId: 'admin-1' };
    const decision = { ...value, decisionDigest: canonicalDigest(value) };
    const first = directRegistration.registerPerson(decision);
    const replay = directRegistration.registerPerson(decision);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt.resultRef, first.receipt.resultRef);
    const person = store.getPerson('person-direct');
    assert.equal(person.currentReferenceRevision, null);
    assert.equal(person.currentReferenceProjectionRevision, 1);
    assert.equal(person.revision.originKind, 'direct');
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM fx_command_receipts WHERE command_contract='people.register-person@1'").get().count, 1);
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM fx_outbox WHERE message_kind='people.person.registered'").get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_registration_candidates').get().count, 0);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_reference_revisions').get().count, 0);
    inspected.close();
  });
});
