'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPeopleStore } = require('../../src/helix/domains/people/persistence/people-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-people-store-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_020_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const store = createPeopleStore({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) });
  try { return run({ databasePath, store }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function personInput(personId, key = personId) {
  return {
    personId, canonicalName: `Person ${personId}`, contentScope: 'performer', factDigest: hash(`${personId}:fact:1`),
    aliases: [{ aliasNormalized: personId.toLowerCase(), aliasDisplay: personId, provenanceDigest: hash(`${personId}:alias`) }],
    providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: key, provenanceDigest: hash(`${personId}:provider`) }]
  };
}

function candidateDraft(id, kind = 'registration', overrides = {}) {
  return {
    schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1,
    draftId: id, draftKind: 'people-candidate', basisDigest: hash(`${id}:basis`), draftDigest: hash(`${id}:draft`),
    producedAtMs: 1_700_000_000_000, candidateKind: kind, candidatePayloadDigest: hash(`${id}:payload`),
    evidenceDigest: hash(`${id}:evidence`), ...overrides
  };
}

test('exposes exactly the two SSOT People repositories over all ten owned tables', () => {
  fixture(({ store }) => assert.deepEqual(store.repositoryManifest.components, [
    {
      component: 'PersonRegistryRepository', repositoryId: 'person_registry_repository',
      tableIds: ['people_aliases', 'people_person_revisions', 'people_persons', 'people_preference_revisions',
        'people_provider_identities', 'people_reference_assets', 'people_reference_faces']
    },
    {
      component: 'PeopleCandidateRepository', repositoryId: 'people_candidate_repository',
      tableIds: ['people_merge_candidates', 'people_merge_records', 'people_registration_candidates']
    }
  ]));
});

test('creates and revises a Person through an explicit immutable head and active identity set', () => {
  fixture(({ databasePath, store }) => {
    const first = store.registerPerson(personInput('person-1'));
    assert.equal(first.currentRevision, 1);
    assert.equal(Object.isFrozen(first.revision.providerIdentities), true);
    const second = store.revisePerson({
      ...personInput('person-1', 'provider-key-2'), revision: 2, canonicalName: 'Current Name', factDigest: hash('person-1:fact:2')
    }, 1);
    assert.equal(second.currentRevision, 2);
    assert.equal(second.revision.canonicalName, 'Current Name');
    assert.equal(second.revision.providerIdentities[0].providerKey, 'provider-key-2');
    assert.throws(() => store.revisePerson({
      ...personInput('person-1', 'provider-key-3'), revision: 3, factDigest: hash('person-1:fact:3')
    }, 1), (error) => error.code === 'P6_PEOPLE_PERSON_REVISION_CONFLICT');

    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT revision FROM people_person_revisions ORDER BY revision').all(), [{ revision: 1 }, { revision: 2 }]);
    assert.deepEqual(inspected.prepare('SELECT revision,active_guard FROM people_provider_identities ORDER BY revision').all(), [
      { revision: 1, active_guard: 0 }, { revision: 2, active_guard: 1 }
    ]);
    inspected.close();
  });
});

test('stable provider identity is active-unique across Persons and conflict rolls back the complete Person', () => {
  fixture(({ databasePath, store }) => {
    store.registerPerson(personInput('person-1', 'stable-key'));
    assert.throws(() => store.registerPerson(personInput('person-2', 'stable-key')),
      (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.equal(store.getPerson('person-2'), undefined);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_persons').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_person_revisions').get().count, 1);
    inspected.close();
  });
});

test('enforces Preference -2..2 in the People model even when a SQLite numeric column is permissive', () => {
  fixture(({ store }) => {
    store.registerPerson(personInput('person-1'));
    assert.equal(store.appendPreference({ personId: 'person-1', revision: 1, preferenceLevel: -2, reason: 'explicit' }).preferenceLevel, -2);
    assert.equal(store.getPreference('person-1', 1).reason, 'explicit');
    assert.throws(() => store.appendPreference({ personId: 'person-1', revision: 2, preferenceLevel: 3, reason: 'invalid' }),
      (error) => error.code === 'P6_PEOPLE_PREFERENCE_LEVEL_INVALID');
    assert.throws(() => store.appendPreference({ personId: 'person-1', revision: 2, preferenceLevel: 1.5, reason: 'invalid' }),
      (error) => error.code === 'P6_PEOPLE_PREFERENCE_LEVEL_INVALID');
  });
});

test('stores only Artifact and Embedding handles and rejects a cross-Person Reference Face', () => {
  fixture(({ store }) => {
    store.registerPerson(personInput('person-1'));
    store.registerPerson(personInput('person-2'));
    const asset = store.addReferenceAsset({
      referenceAssetId: 'asset-1', personId: 'person-1', artifactHandleId: 'artifact-handle-1', artifactDigest: hash('artifact-1'), state: 'active'
    });
    assert.equal(store.getReferenceAsset('asset-1').artifactHandleId, asset.artifactHandleId);
    const face = store.addReferenceFace({
      referenceFaceId: 'face-1', personId: 'person-1', referenceAssetId: 'asset-1',
      embeddingHandleId: 'embedding-handle-1', modelRef: 'face-model@1', state: 'active'
    });
    assert.equal(store.getReferenceFace('face-1').embeddingHandleId, face.embeddingHandleId);
    assert.throws(() => store.addReferenceFace({
      referenceFaceId: 'face-2', personId: 'person-2', referenceAssetId: 'asset-1',
      embeddingHandleId: 'embedding-handle-2', modelRef: 'face-model@1', state: 'active'
    }), (error) => error.code === 'P6_PEOPLE_REFERENCE_ASSET_OWNER_MISMATCH');
  });
});

test('persists a People-owned Registration Candidate, not a Foundation Event Result', () => {
  fixture(({ store }) => {
    const first = store.openRegistrationCandidate({
      registrationCandidateId: 'registration-1', proposedName: 'Proposed', evidenceDigest: hash('registration:evidence'),
      candidatePayload: candidateDraft('registration-1')
    });
    assert.equal(first.state, 'open');
    assert.throws(() => store.openRegistrationCandidate({
      registrationCandidateId: 'registration-2', proposedName: 'Duplicate', evidenceDigest: hash('registration:evidence'),
      candidatePayload: candidateDraft('registration-2')
    }), (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.throws(() => store.openRegistrationCandidate({
      registrationCandidateId: 'foundation-result', proposedName: 'Invalid', evidenceDigest: hash('foundation:evidence'),
      candidatePayload: {
        schemaRef: 'helix://contracts/types/CapabilityOutcome/v1', schemaVersion: 1, kind: 'succeeded'
      }
    }), (error) => error.code === 'P6_PEOPLE_VALUE_SHAPE');
    assert.equal(store.terminalRegistrationCandidate('registration-1', 'dismissed').state, 'dismissed');
    assert.throws(() => store.terminalRegistrationCandidate('registration-1', 'accepted'),
      (error) => error.code === 'P6_PEOPLE_CANDIDATE_STATE_CONFLICT');
    assert.equal(store.openRegistrationCandidate({
      registrationCandidateId: 'registration-3', proposedName: 'Reopened Evidence', evidenceDigest: hash('registration:evidence'),
      candidatePayload: candidateDraft('registration-3')
    }).state, 'open');
  });
});

test('normalizes an open Merge Candidate pair and dismissal never mutates either Person', () => {
  fixture(({ store }) => {
    store.registerPerson(personInput('person-a'));
    store.registerPerson(personInput('person-b'));
    const first = store.openMergeCandidate({
      mergeCandidateId: 'merge-1', leftPersonId: 'person-b', rightPersonId: 'person-a', evidenceDigest: hash('merge-1')
    });
    assert.equal(first.leftPersonId, 'person-a');
    assert.equal(first.rightPersonId, 'person-b');
    assert.throws(() => store.openMergeCandidate({
      mergeCandidateId: 'merge-2', leftPersonId: 'person-a', rightPersonId: 'person-b', evidenceDigest: hash('merge-2')
    }), (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.equal(store.terminalMergeCandidate('merge-1', 'dismissed').state, 'dismissed');
    assert.equal(store.getPerson('person-a').status, 'active');
    assert.equal(store.getPerson('person-b').status, 'active');
    assert.equal(store.openMergeCandidate({
      mergeCandidateId: 'merge-3', leftPersonId: 'person-a', rightPersonId: 'person-b', evidenceDigest: hash('merge-3')
    }).state, 'open');
  });
});

test('allows only one terminal Merge Record for a source Person', () => {
  fixture(({ store }) => {
    store.registerPerson(personInput('person-a'));
    store.registerPerson(personInput('person-b'));
    store.registerPerson(personInput('person-c'));
    assert.equal(store.appendMergeRecord({
      mergeRecordId: 'record-1', sourcePersonId: 'person-a', targetPersonId: 'person-b', decisionDigest: hash('decision-1')
    }).targetPersonId, 'person-b');
    assert.throws(() => store.appendMergeRecord({
      mergeRecordId: 'record-2', sourcePersonId: 'person-a', targetPersonId: 'person-c', decisionDigest: hash('decision-2')
    }), (error) => error.code === 'P6_PEOPLE_MERGE_SOURCE_ALREADY_TERMINAL');
  });
});

test('People persistence exposes no raw SQL, cross-Owner tables, Media-Cast, Work, or Event repository', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/people/persistence/people-store.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:proc_|libra_|arca_|perception_|platform_|fx_)\w*/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+/i);
  assert.doesNotMatch(source, /MAX\s*\(/i);
  assert.doesNotMatch(source, /media.?cast|workflow|event.?result/i);
});
