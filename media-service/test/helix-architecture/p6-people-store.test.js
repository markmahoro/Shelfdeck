'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPeopleStore } = require('../../src/helix/domains/people/persistence/people-store');
const { createPeopleAdminQuery } = require('../../src/helix/domains/people/application/admin-query');
const { initialReference } = require('./fixtures/us-adult-initial-reference');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('initial US reference fixture satisfies the nominal production DTO graph', () => {
  const root = '../../src/helix/contracts/';
  const validator = createCapabilityContractValidator({ schemas: [
    require(root + 'types/ArtifactHandle/v1/schema.json'), require(root + 'types/FaceEmbeddingSetHandle/v1/schema.json'),
    require(root + 'domain-types/PeopleReferenceMaintenanceDecision/v1/schema.json'),
  ] });
  validator.validate('helix://contracts/domain-types/PeopleReferenceMaintenanceDecision/v1', initialReference('qualified-person'));
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-people-store-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_020_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const preparedSql = [];
  const actualUnitOfWork = createSqliteUnitOfWork({ kernel: {
    runPrimitive: (operation) => kernel.runPrimitive((transaction) => operation({ ...transaction, prepare(sql) {
      preparedSql.push(sql);
      return transaction.prepare(sql);
    } })),
  } });
  const reads = [];
  const unitOfWork = { execute: (participants) => actualUnitOfWork.execute(participants.map((participant) => ({
    ...participant,
    execute: (context) => participant.execute({ ...context, repository(repositoryId) {
      const repository = context.repository(repositoryId);
      return { ...repository, invoke(statementId, parameters) {
        const result = repository.invoke(statementId, parameters);
        reads.push({ statementId, parameters, rows: Array.isArray(result) ? result.length : result ? 1 : 0 });
        return result;
      } };
    } }),
  }))) };
  const store = createPeopleStore({ schemaManifest, unitOfWork });
  try { return run({ databasePath, store, unitOfWork, reads, preparedSql }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function personInput(personId, key = personId) {
  return {
    personId, canonicalName: `Person ${personId}`, factDigest: hash(`${personId}:fact:1`),
    aliases: [{ aliasNormalized: personId.toLowerCase(), aliasDisplay: personId, provenanceDigest: hash(`${personId}:alias`) }],
    providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: key, provenanceDigest: hash(`${personId}:provider`) }]
  };
}
function directDecision(personId, key = personId, libraryKind = 'normal') {
  const person = personInput(personId, key);
  const decision = { decisionId: `register-${personId}`, newPersonId: personId, libraryKind, canonicalName: person.canonicalName,
    aliases: person.aliases, providerIdentities: person.providerIdentities, actorId: 'admin-1',
    ...(libraryKind === 'us_adult' ? { initialReference: initialReference(personId) } : {}) };
  return { ...decision, decisionDigest: canonicalDigest(decision) };
}

test('isolates the same provider identity in three libraries and rejects duplicates within each library', () => {
  fixture(({ store }) => {
    for (const libraryKind of ['normal', 'jav', 'us_adult']) {
      const personId = `person-${libraryKind}`;
      store.registerDirectPerson(directDecision(personId, 'same-physical-person', libraryKind));
      const identity = { libraryKind, provider: 'tmdb', namespace: 'person', providerKey: 'same-physical-person' };
      assert.equal(store.findActivePersonByProviderIdentity(identity).personId, personId);
      assert.throws(() => store.registerDirectPerson(directDecision(`${personId}-duplicate`, 'same-physical-person', libraryKind)),
        /UNIQUE constraint/);
      const page = store.listPeoplePage({ cursor: '', limit: 10, status: 'active', search: '', libraryKind });
      assert.deepEqual(page.map(item => item.personId), [personId]);
      assert.equal(page[0].libraryKind, libraryKind);
    }
    assert.equal(store.listPeople().length, 3);
    assert.throws(() => store.findActivePersonByProviderIdentity({ provider: 'tmdb', namespace: 'person', providerKey: 'same-physical-person' }),
      { code: 'P6_PEOPLE_PROVIDER_IDENTITY_LOOKUP_INPUT' });
  });
});

test('pages the complete US reference library beyond 256 people under one immutable head digest',()=>{
  fixture(({store})=>{
    for(let index=0;index<270;index++)store.registerDirectPerson(directDecision('us-'+String(index).padStart(4,'0'),'actor-'+index,'us_adult'));
    store.registerDirectPerson(directDecision('ordinary-only','ordinary-only','normal'));
    const schemaRoot='../../src/helix/contracts/domain-types/',validator=createCapabilityContractValidator({schemas:
      ['PeopleReferenceLibraryPage','UsAdultPersonSnapshot','PersonReferenceProjection'].map(type=>require(schemaRoot+type+'/v1/schema.json'))});
    let cursor=null,libraryDigest=null;const ids=[];
    do{
      const page=store.readUsAdultReferencePage({cursor,limit:256,expectedLibraryDigest:libraryDigest});
      validator.validate('helix://contracts/domain-types/PeopleReferenceLibraryPage/v1',page);
      assert.equal(page.totalPersonCount,270);assert.ok(page.items.length<=256);
      libraryDigest??=page.libraryDigest;assert.equal(page.libraryDigest,libraryDigest);
      ids.push(...page.items.map(item=>item.personId));cursor=page.nextCursor;
    }while(cursor);
    assert.equal(ids.length,270);assert.equal(new Set(ids).size,270);assert.ok(!ids.includes('ordinary-only'));
    store.registerDirectPerson(directDecision('us-new','new','us_adult'));
    assert.throws(()=>store.readUsAdultReferencePage({cursor:null,limit:20,expectedLibraryDigest:libraryDigest}),{code:'PEOPLE_REFERENCE_LIBRARY_CHANGED'});
  });
});

test('publishes a US Adult Person and its initial image atomically, with no selectable identity on invalid reference evidence', () => {
  fixture(({ store }) => {
    const decision = directDecision('actor-valid', 'actor-valid', 'us_adult');
    const person = store.registerDirectPerson(decision);
    assert.equal(person.currentReferenceRevision, 1);
    assert.equal(store.getReferenceAsset('asset-actor-valid').state, 'active');
    assert.equal(store.listPersonReferenceProjections().length, 1);
    const { initialReference: omitted, decisionDigest: oldDigest, ...missing } = directDecision('actor-missing', 'actor-missing', 'us_adult');
    assert.throws(() => store.registerDirectPerson({ ...missing, decisionDigest: canonicalDigest(missing) }), { code: 'P6_PEOPLE_DIRECT_REGISTRATION_INPUT' });
    assert.equal(store.getPerson('actor-missing'), undefined);
    const reference = initialReference('actor-wrong');
    const badReference = { ...reference, faceEmbeddingSetHandle: { ...reference.faceEmbeddingSetHandle, detectedFaceCount: 2, vectorCount: 2 } };
    badReference.decisionDigest = canonicalDigest(Object.fromEntries(Object.entries(badReference).filter(([key]) => key !== 'decisionDigest')));
    const bad = { ...directDecision('actor-wrong', 'actor-wrong', 'us_adult'), initialReference: badReference };
    bad.decisionDigest = canonicalDigest(Object.fromEntries(Object.entries(bad).filter(([key]) => key !== 'decisionDigest')));
    assert.throws(() => store.registerDirectPerson(bad), { code: 'P6_PEOPLE_REFERENCE_ADD_EVIDENCE' });
    assert.equal(store.getPerson('actor-wrong'), undefined);
  });
});

test('rejects cross-library merge before creating any candidate', () => {
  fixture(({ store }) => {
    const left = store.registerDirectPerson(directDecision('person-a', 'normal-person', 'normal'));
    const right = store.registerDirectPerson(directDecision('person-b', 'jav-person', 'jav'));
    assert.throws(() => store.openCandidate({ candidateId: 'cross-library', draft: mergeDraft('cross-library', left, right) }),
      { code: 'PEOPLE_CROSS_LIBRARY_MERGE_FORBIDDEN' });
    assert.equal(store.listMergeCandidates().length, 0);
    assert.equal(store.getPerson('person-a').currentRevision, 1);
    assert.equal(store.getPerson('person-b').currentRevision, 1);
  });
});

test('keeps weak normal evidence internal and rejects user mutations of system libraries', () => {
  fixture(({ store, unitOfWork }) => {
    const { createPeopleProcessServices } = require('../../src/helix/domains/people/application/people-process-services');
    const service = createPeopleProcessServices({ schemaManifest, unitOfWork, peopleStore: store });
    const evidence = { contentProfile: 'movie', shelfEntryId: 'entry-a', inventoryRevision: 1,
      displayName: 'Same Name', providerIdentities: [], identityStrength: 'weak', evidenceDigest: hash('weak-a') };
    assert.equal(service.reconcile(evidence).kind, 'internal_evidence');
    assert.equal(service.reconcile(evidence).kind, 'known');
    assert.equal(store.listPeople().length, 0);
    assert.throws(() => service.acceptRegistration({}), { code: 'PEOPLE_LIBRARY_READ_ONLY' });
    assert.throws(() => service.dismissRegistration({}), { code: 'PEOPLE_LIBRARY_READ_ONLY' });
    assert.throws(() => service.registerPerson({ libraryKind: 'normal', canonicalName: 'Name' }), { code: 'PEOPLE_LIBRARY_READ_ONLY' });
    assert.equal(service.reconcile({ ...evidence, contentProfile: 'western_adult' }).kind, 'user_owned_library');
    assert.equal(store.listRegistrationCandidates().length, 1);
  });
});

function registrationDraft(id, overrides = {}) {
  const candidatePayload = overrides.candidatePayload || {
    libraryKind: 'normal', proposedName: `Candidate ${id}`,
    aliases: [{ aliasDisplay: id, aliasNormalized: id.toLowerCase(), provenanceDigest: hash(`${id}:alias`) }],
    providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: id, provenanceDigest: hash(`${id}:provider`) }],
    referenceHints: [{ hintKind: 'portrait', referenceValue: `artifact:${id}`, provenanceDigest: hash(`${id}:hint`) }]
  };
  return {
    schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1, draftId: id, draftKind: 'people-candidate',
    basisDigest: hash(`${id}:basis`), draftDigest: hash(`${id}:draft`), producedAtMs: 1_700_000_000_000,
    candidateKind: 'registration', evidenceDigest: hash(`${id}:evidence`), candidatePayload,
    candidatePayloadDigest: canonicalDigest(candidatePayload), ...overrides, candidatePayload
  };
}

function mergeDraft(id, left, right, overrides = {}) {
  const candidatePayload = {
    leftPersonRef: { personId: left.personId, revision: left.currentRevision, factDigest: left.revision.factDigest,
      preferenceRevision: left.currentPreferenceRevision },
    rightPersonRef: { personId: right.personId, revision: right.currentRevision, factDigest: right.revision.factDigest,
      preferenceRevision: right.currentPreferenceRevision },
    matchSignals: [{ objectId: `${id}:signal`, revision: 1, schemaRef: 'helix://fixtures/person-match-signal/v1',
      snapshotDigest: hash(`${id}:signal`), objectKind: 'person-match-signal' }],
    conflictSummary: { schemaRef: 'helix://fixtures/merge-conflict-summary/v1', schemaVersion: 1,
      recordKind: 'merge-conflict-summary', recordDigest: hash(`${id}:conflicts`), entries: [] },
    evidenceRefs: [`${id}:evidence`]
  };
  return {
    schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1, draftId: id, draftKind: 'people-candidate',
    basisDigest: hash(`${id}:basis`), draftDigest: hash(`${id}:draft`), producedAtMs: 1_700_000_000_000,
    candidateKind: 'merge', evidenceDigest: hash(`${id}:evidence`), candidatePayload,
    candidatePayloadDigest: canonicalDigest(candidatePayload), ...overrides
  };
}

test('binds the thirteen canonical Person and Candidate tables to their two Owner repositories', () => {
  fixture(({ store }) => assert.deepEqual(store.repositoryManifest.components, [
    {
      component: 'PersonRegistryRepository', repositoryId: 'person_registry_repository',
      tableIds: ['people_aliases', 'people_merge_records', 'people_person_revisions', 'people_persons', 'people_preference_revisions',
        'people_provider_identities', 'people_reference_assets', 'people_reference_faces', 'people_reference_revisions']
    },
    {
      component: 'PeopleCandidateRepository', repositoryId: 'people_candidate_repository',
      tableIds: ['people_merge_candidate_revisions', 'people_merge_candidates',
        'people_registration_candidate_revisions', 'people_registration_candidates']
    }
  ]));
});

test('creates and revises a library-scoped Person through an immutable state-matched head with no content scope', () => {
  fixture(({ databasePath, store }) => {
    const first = store.registerDirectPerson(directDecision('person-1'));
    assert.equal(first.status, 'active');
    assert.equal(first.currentRevision, 1);
    assert.equal(first.currentPreferenceRevision, null);
    assert.equal(Object.hasOwn(first.revision, 'contentScope'), false);
    const second = store.revisePerson({ ...personInput('person-1', 'provider-key-2'), revision: 2,
      canonicalName: 'Current Name', factDigest: hash('person-1:fact:2') }, 1);
    assert.equal(second.revision.canonicalName, 'Current Name');
    assert.equal(second.revision.personStatus, 'active');
    assert.equal(second.revision.originCandidateRef, null);
    assert.throws(() => store.revisePerson({ ...personInput('person-1'), revision: 3 }, 1),
      (error) => error.code === 'P6_PEOPLE_PERSON_REVISION_CONFLICT');

    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT revision,person_status FROM people_person_revisions ORDER BY revision').all(), [
      { revision: 1, person_status: 'active' }, { revision: 2, person_status: 'active' }
    ]);
    assert.deepEqual(inspected.prepare('SELECT revision,active_guard FROM people_provider_identities ORDER BY revision').all(), [
      { revision: 1, active_guard: 0 }, { revision: 2, active_guard: 1 }
    ]);
    inspected.close();
  });
});

test('keeps stable provider identity active-unique and rolls back the complete conflicting Person', () => {
  fixture(({ databasePath, store }) => {
    store.registerDirectPerson(directDecision('person-1', 'stable-key'));
    assert.throws(() => store.registerDirectPerson(directDecision('person-2', 'stable-key')),
      (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.equal(store.getPerson('person-2'), undefined);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_persons').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_person_revisions').get().count, 1);
    inspected.close();
  });
});

test('admin projection sorts a frozen multi-Person result without mutating the Owner store value', () => {
  fixture(({ store }) => {
    store.registerDirectPerson(directDecision('person-z'));
    store.registerDirectPerson(directDecision('person-a'));
    const query = createPeopleAdminQuery({ store });
    const result = query.list({ limit: 50 });
    assert.deepEqual(result.items.map((person) => person.personId), ['person-a', 'person-z']);
    assert.equal(result.summary.activePersonCount, 2);
  });
});

test('admin page expands only its bounded current People and uses aggregate summary counts', () => {
  fixture(({ store, reads, preparedSql, databasePath }) => {
    for (let index = 0; index < 310; index++) store.registerDirectPerson(directDecision(`person-${String(index).padStart(3, '0')}`));
    for (let index = 0; index < 3; index++) {
      const id = `registration-${index}`;
      store.openCandidate({ candidateId: id, draft: registrationDraft(id) });
    }
    const query = createPeopleAdminQuery({ store: { ...store,
      listPeople() { assert.fail('A page cannot expand all People.'); },
      listRegistrationCandidates() { assert.fail('Summary cannot expand Registration payloads.'); },
      listMergeCandidates() { assert.fail('Summary cannot expand Merge payloads.'); },
    } });
    reads.length = 0;
    preparedSql.length = 0;
    const result = query.list({ limit: 25 });
    assert.equal(result.items.length, 25);
    assert.equal(result.nextCursor, 'person-024');
    assert.deepEqual(result.summary, { activePersonCount: 310, mergedPersonCount: 0,
      openRegistrationCandidateCount: 0, openMergeCandidateCount: 0 });
    assert.equal(reads.filter((read) => read.statementId === 'find_person_revision').length, 26);
    assert.deepEqual(reads.filter((read) => read.statementId === 'page_people').map((read) => read.rows), [26]);
    assert.equal(reads.filter((read) => read.statementId.startsWith('overview_')).length, 1);
    assert.ok(Object.isFrozen(result.items));
    assert.ok(Object.isFrozen(result.summary));
    assert.ok(Object.isFrozen(result.items[0].providerIdentities[0]));
    const sql = preparedSql.find((statement) => statement.includes('"base"."person_id">@cursor'));
    assert.ok(sql, 'A later page must seek its cursor instead of rescanning all earlier heads.');
    const inspected = new Database(databasePath, { readonly: true });
    try {
      const plan = inspected.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ cursor: 'person-250', status: '', library_kind: 'normal', offset: 0, limit: 26 });
      assert.ok(plan.some((row) => /SEARCH base USING INDEX.*\(person_id>\?\)/.test(row.detail)), JSON.stringify(plan));
    } finally { inspected.close(); }
  });
});

test('People pages preserve binary cursors, current Unicode names and aliases, status filters and global counts', () => {
  fixture(({ store, unitOfWork, reads }) => {
    for (let index = 0; index < 130; index++) store.registerDirectPerson(directDecision(`person-${String(index).padStart(3, '0')}`));
    for (const id of ['person-É', 'person-中文', 'person-😀', 'person-\uE000']) store.registerDirectPerson(directDecision(id));
    store.revisePerson({ ...personInput('person-120'), revision: 2, canonicalName: 'ÉTOILE 中文',
      factDigest: hash('person-120:fact:2'), aliases: [
        { aliasDisplay: 'İSTANBUL', aliasNormalized: 'istanbul', provenanceDigest: hash('istanbul') },
      ] }, 1);
    const candidate = store.openCandidate({ candidateId: 'merge-page',
      draft: mergeDraft('merge-page', store.getPerson('person-000'), store.getPerson('person-129')) });
    const decision = { decisionId: 'merge-page-decision', candidateKind: 'merge', candidateId: candidate.candidateId,
      expectedCandidateRevision: 1, candidatePayloadDigest: candidate.candidatePayloadDigest, decisionOrigin: 'user', actorId: 'admin-1',
      sourcePersonId: 'person-000', targetPersonId: 'person-129', expectedSourcePersonRevision: 1, expectedTargetPersonRevision: 1,
      expectedSourcePreferenceRevision: null, expectedTargetPreferenceRevision: null, preferenceResolution: 'keep_target' };
    const handle = { handleId: 'merge-page-handle', ownerDomain: 'people', aggregateType: 'person', aggregateId: 'person-129',
      expectedRevision: 1, resultSchemaRef: 'helix://contracts/types/PersonRevision/v1', commitIdempotencyKey: 'merge-page-key' };
    unitOfWork.execute([store.createMergeAcceptanceParticipant(handle, { ...decision, decisionDigest: canonicalDigest(decision) })]);
    const allPeople = [...store.listPeople()].sort((left, right) => Buffer.compare(Buffer.from(left.personId), Buffer.from(right.personId)));
    const query = createPeopleAdminQuery({ store });
    const cases = [
      { limit: 100 }, { cursor: 'person-099', limit: 100 }, { cursor: 'person-110', status: 'active', limit: 25 },
      { status: 'merged', limit: 1 }, { search: ' ÉTOILE ' }, { search: 'İSTANBUL' }, { search: '中文' },
      { search: 'person-120' }, { search: 'not found' }, { cursor: 'person-\uE000', limit: 1 },
      { limit: 0 }, { limit: 101 }, { status: 'unknown' },
    ];
    for (const input of cases) {
      const search = String(input.search || '').trim().toLocaleLowerCase();
      const limit = Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 100 ? input.limit : 50;
      const filtered = allPeople.filter((person) =>
        (!['active', 'merged'].includes(input.status) || person.status === input.status) &&
        (!input.cursor || Buffer.compare(Buffer.from(person.personId), Buffer.from(input.cursor)) > 0) &&
        (!search || [person.revision.canonicalName, ...person.revision.aliases.map((alias) => alias.aliasDisplay)]
          .some((name) => name.toLocaleLowerCase().includes(search))));
      reads.length = 0;
      const result = query.list(input);
      assert.deepEqual(result.items.map((person) => person.personId), filtered.slice(0, limit).map((person) => person.personId), JSON.stringify(input));
      assert.equal(result.nextCursor, filtered.length > limit ? filtered[limit - 1].personId : null);
      assert.deepEqual(result.summary, { activePersonCount: 133, mergedPersonCount: 1,
        openRegistrationCandidateCount: 0, openMergeCandidateCount: 0 });
      assert.equal(reads.filter((read) => read.statementId === 'find_person_revision').length,
        Math.min(filtered.length, limit + 1), 'Only matching page facts and the continuation probe may expand.');
      for (const item of result.items) {
        const person = allPeople.find((entry) => entry.personId === item.personId);
        assert.equal(item.currentRevision, person.currentRevision);
        assert.equal(item.canonicalName, person.revision.canonicalName);
        assert.deepEqual(item.aliases, person.revision.aliases.map((alias) => alias.aliasDisplay));
        assert.deepEqual(item.providerIdentities, person.revision.providerIdentities.map(({ provider, namespace, providerKey }) =>
          ({ provider, namespace, providerKey })));
      }
    }
  });
});

test('People page rejects invalid bounds and retains selected immutable Person validation', () => {
  fixture(({ databasePath, store }) => {
    store.registerDirectPerson(directDecision('person-1'));
    const valid = { libraryKind: 'normal', cursor: '', limit: 25, status: null, search: '' };
    for (const input of [{ ...valid, limit: 102 }, { ...valid, limit: 0 }, { ...valid, limit: 1.5 },
      { ...valid, status: 'unknown' }, { ...valid, cursor: null }, { ...valid, search: [] }, { ...valid, extra: true }]) {
      assert.throws(() => store.listPeoplePage(input), (error) => error.code === 'P6_PEOPLE_PAGE_INPUT');
    }
    const inspected = new Database(databasePath);
    try {
      inspected.prepare('UPDATE people_person_revisions SET origin_decision_id=? WHERE person_id=? AND revision=1')
        .run('', 'person-1');
    } finally { inspected.close(); }
    assert.throws(() => store.listPeoplePage(valid), (error) => error.code === 'P6_PEOPLE_TEXT_INVALID');
    assert.throws(() => store.listPeoplePage({ ...valid, search: 'person' }), (error) => error.code === 'P6_PEOPLE_TEXT_INVALID');
  });
});

test('advances the explicit Preference pointer and rejects stale, skipped, fractional, or out-of-range revisions', () => {
  fixture(({ databasePath, store }) => {
    store.registerDirectPerson(directDecision('person-1'));
    const first = store.appendPreference({ personId: 'person-1', revision: 1, preferenceLevel: -2, reason: 'explicit',
      originKind: 'user', originRef: 'user-command-1' });
    assert.equal(first.preferenceLevel, -2);
    assert.equal(store.getCurrentPreference('person-1').originRef, 'user-command-1');
    store.appendPreference({ personId: 'person-1', revision: 2, preferenceLevel: 1, reason: 'changed',
      originKind: 'user', originRef: 'user-command-2' });
    assert.equal(store.getPerson('person-1').currentPreferenceRevision, 2);
    assert.throws(() => store.appendPreference({ personId: 'person-1', revision: 2, preferenceLevel: 0, reason: 'stale',
      originKind: 'user', originRef: 'stale' }), (error) => error.code === 'P6_PEOPLE_PREFERENCE_REVISION_CONFLICT');
    assert.throws(() => store.appendPreference({ personId: 'person-1', revision: 3, preferenceLevel: 1.5, reason: 'invalid',
      originKind: 'user', originRef: 'invalid' }), (error) => error.code === 'P6_PEOPLE_PREFERENCE_LEVEL_INVALID');
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT current_preference_revision FROM people_persons WHERE person_id=?').get('person-1'),
      { current_preference_revision: 2 });
    inspected.close();
  });
});

test('removes the old split Asset/Face mutation surface', () => {
  fixture(({ store }) => {
    assert.equal(store.addReferenceAsset, undefined);
    assert.equal(store.addReferenceFace, undefined);
    assert.equal(typeof store.createReferenceCommitParticipant, 'function');
  });
});

test('opens Registration Candidate as immutable payload plus explicit open revision and rejects digest-only input', () => {
  fixture(({ databasePath, store }) => {
    const draft = registrationDraft('registration-1');
    const candidate = store.openCandidate({ candidateId: 'registration-1', draft });
    assert.equal(candidate.currentRevision, 1);
    assert.equal(candidate.currentState, 'open');
    assert.equal(candidate.proposedName, draft.candidatePayload.proposedName);
    assert.equal(candidate.revision.decisionDigest, null);
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT revision,state,decision_digest FROM people_registration_candidate_revisions').all(),
      [{ revision: 1, state: 'open', decision_digest: null }]);
    inspected.close();
    assert.throws(() => store.openCandidate({ candidateId: 'digest-only', draft: {
      ...draft, draftId: 'digest-only', candidatePayload: undefined
    } }), (error) => ['P6_PEOPLE_VALUE_SHAPE', 'P6_PEOPLE_VALUE_REQUIRED'].includes(error.code));
  });
});

test('fails closed when stored Candidate payload no longer matches its immutable digest', () => {
  fixture(({ databasePath, store }) => {
    const draft = registrationDraft('registration-1');
    store.openCandidate({ candidateId: 'registration-1', draft });
    const tampered = { ...draft.candidatePayload, referenceHints: [] };
    const inspected = new Database(databasePath);
    inspected.prepare('UPDATE people_registration_candidates SET candidate_json=? WHERE registration_candidate_id=?')
      .run(JSON.stringify(tampered), 'registration-1');
    inspected.close();
    assert.throws(() => store.getRegistrationCandidate('registration-1'),
      (error) => error.code === 'P6_PEOPLE_CANDIDATE_PAYLOAD_DIGEST');
  });
});

test('opens normalized Merge Candidate only for exact current Person and Preference revisions', () => {
  fixture(({ databasePath, store }) => {
    const left = store.registerDirectPerson(directDecision('person-a'));
    const right = store.registerDirectPerson(directDecision('person-b'));
    const draft = mergeDraft('merge-1', left, right);
    const candidate = store.openCandidate({ candidateId: 'merge-1', draft });
    assert.equal(candidate.leftPersonId, 'person-a');
    assert.equal(candidate.rightPersonId, 'person-b');
    assert.equal(candidate.leftPersonRevision, 1);
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT revision,state FROM people_merge_candidate_revisions').all(), [{ revision: 1, state: 'open' }]);
    inspected.close();

    store.appendPreference({ personId: 'person-a', revision: 1, preferenceLevel: 1, reason: 'changed after snapshot',
      originKind: 'user', originRef: 'pref-1' });
    const stale = mergeDraft('merge-stale', left, right);
    assert.throws(() => store.openCandidate({ candidateId: 'merge-stale', draft: stale }),
      (error) => error.code === 'P6_PEOPLE_MERGE_PERSON_FENCE');
  });
});

test('People persistence contains no old 10-table shape, content scope, raw SQL, cross-Owner table, or mutable Candidate state column', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/people/persistence/people-store.js'), 'utf8');
  const model = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/people/model/people-store-contracts.js'), 'utf8');
  assert.doesNotMatch(source + model, /content_?scope/i);
  assert.doesNotMatch(source, /\b(?:proc_|libra_|arca_|perception_|platform_|fx_)\w*/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+/i);
  assert.doesNotMatch(source, /MAX\s*\(/i);
  assert.doesNotMatch(source, /'state',\s*'created_at_ms',\s*'terminal_at_ms'/);
  assert.doesNotMatch(source, /\b(?:openRegistrationCandidate|terminalRegistrationCandidate|openMergeCandidate|terminalMergeCandidate)\b/);
});
