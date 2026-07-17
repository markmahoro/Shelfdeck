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
const { createPersonReferenceQuery } = require('../../src/helix/domains/people/capabilities/people-reference-lifecycle');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-people-reference-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_040_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createPeopleStore({ schemaManifest, unitOfWork });
  try { return run({ databasePath, store, unitOfWork }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function register(store, personId) {
  const value = { decisionId: `register-${personId}`, newPersonId: personId, canonicalName: `Person ${personId}`,
    aliases: [], providerIdentities: [], actorId: 'admin-1' };
  return store.registerDirectPerson({ ...value, decisionDigest: canonicalDigest(value) });
}

function referenceHandle(decision, revision = decision.expectedReferenceRevision) {
  return { handleId: `reference-${decision.decisionId}`, ownerDomain: 'people', aggregateType: 'person-reference',
    aggregateId: decision.personId, expectedRevision: revision,
    resultSchemaRef: 'helix://contracts/types/PersonReferenceRevision/v1', commitIdempotencyKey: `commit-${decision.decisionId}` };
}

function addDecision(personId, expectedPersonRevision, expectedReferenceRevision, suffix) {
  const artifactDigest = hash(`artifact-${suffix}`);
  const embeddingDigest = hash(`embedding-${suffix}`);
  const value = { decisionId: `add-${suffix}`, operationKind: 'add_image', personId, expectedPersonRevision,
    expectedReferenceRevision, actorId: 'admin-1', referenceAssetId: `asset-${suffix}`, referenceFaceId: `face-${suffix}`,
    artifactHandle: { schemaRef: 'helix://contracts/types/ArtifactHandle/v1', schemaVersion: 1,
      artifactHandleId: `artifact-handle-${suffix}`, artifactKind: 'reference-image', ownerDomain: 'people',
      ownerScope: { scopeType: 'person', scopeId: personId }, storageRef: `workspace:${suffix}`, digestAlgorithm: 'sha256',
      digestHex: artifactDigest, sizeBytes: 100, mediaType: 'image/jpeg',
      provenanceRef: { objectType: 'user-upload', objectId: `upload-${suffix}`, revision: 1, digest: hash(`upload-${suffix}`) }, referenceRevision: 1 },
    artifactDigest, faceEmbeddingSetHandle: { schemaRef: 'helix://contracts/types/FaceEmbeddingSetHandle/v1', schemaVersion: 1,
      artifactHandleId: `embedding-handle-${suffix}`, modelRef: 'face-model@1', sourceArtifactSetDigest: artifactDigest,
      detectedFaceCount: 1, vectorCount: 1, dimension: 512, digestHex: embeddingDigest }, modelRef: 'face-model@1', initialState: 'active' };
  return { ...value, decisionDigest: canonicalDigest(value) };
}

function releaseDecision(add, expectedReferenceRevision) {
  const value = { decisionId: `release-${add.referenceAssetId}`, operationKind: 'release_image', personId: add.personId,
    expectedPersonRevision: add.expectedPersonRevision, expectedReferenceRevision, actorId: 'admin-1',
    referenceAssetId: add.referenceAssetId, referenceFaceId: add.referenceFaceId, expectedAssetState: 'active',
    expectedFaceState: 'active', terminalState: 'released', artifactDigest: add.artifactDigest,
    embeddingDigest: add.faceEmbeddingSetHandle.digestHex, modelRef: add.modelRef };
  return { ...value, decisionDigest: canonicalDigest(value) };
}

function commit(unitOfWork, store, decision) {
  const participant = store.createReferenceCommitParticipant(referenceHandle(decision), decision);
  return unitOfWork.execute([participant]).people_reference_commit;
}

function mergeDraft(store) {
  const left = store.getPerson('person-source');
  const right = store.getPerson('person-target');
  const candidatePayload = {
    leftPersonRef: { personId: left.personId, revision: left.currentRevision, factDigest: left.revision.factDigest, preferenceRevision: null },
    rightPersonRef: { personId: right.personId, revision: right.currentRevision, factDigest: right.revision.factDigest, preferenceRevision: null },
    matchSignals: [{ objectId: 'signal-1', revision: 1, schemaRef: 'helix://fixtures/person-match/v1',
      snapshotDigest: hash('signal-1'), objectKind: 'person-match-signal' }],
    conflictSummary: { schemaRef: 'helix://fixtures/merge-conflicts/v1', schemaVersion: 1,
      recordKind: 'merge-conflict-summary', recordDigest: hash('conflicts'), entries: [] }, evidenceRefs: ['evidence-1']
  };
  return { schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1, draftId: 'merge-reference',
    draftKind: 'people-candidate', basisDigest: hash('merge-basis'), draftDigest: hash('merge-draft'), producedAtMs: 1,
    candidateKind: 'merge', evidenceDigest: hash('merge-evidence'), candidatePayload,
    candidatePayloadDigest: canonicalDigest(candidatePayload) };
}

function mergePeople(unitOfWork, store) {
  const candidate = store.openCandidate({ candidateId: 'merge-reference', draft: mergeDraft(store) });
  const value = { decisionId: 'merge-reference-decision', candidateKind: 'merge', candidateId: candidate.candidateId,
    expectedCandidateRevision: 1, candidatePayloadDigest: candidate.candidatePayloadDigest, decisionOrigin: 'user', actorId: 'admin-1',
    sourcePersonId: 'person-source', targetPersonId: 'person-target', expectedSourcePersonRevision: 1,
    expectedTargetPersonRevision: 1, expectedSourcePreferenceRevision: null, expectedTargetPreferenceRevision: null,
    preferenceResolution: 'keep_target' };
  const decision = { ...value, decisionDigest: canonicalDigest(value) };
  const handle = { handleId: 'merge-reference-handle', ownerDomain: 'people', aggregateType: 'person', aggregateId: 'person-target',
    expectedRevision: 1, resultSchemaRef: 'helix://contracts/types/PersonRevision/v1', commitIdempotencyKey: 'merge-reference-key' };
  return unitOfWork.execute([store.createMergeAcceptanceParticipant(handle, decision)]).people_merge_acceptance;
}

test('keeps never-referenced Person at JSON null with a persisted revision-1 checkpoint and read-only GET', () => {
  fixture(({ databasePath, store }) => {
    register(store, 'person-1');
    const beforeDatabase = new Database(databasePath, { readonly: true });
    const before = beforeDatabase.prepare(
      'SELECT current_reference_revision,current_reference_projection_revision,current_reference_projection_digest FROM people_persons WHERE person_id=?'
    ).get('person-1');
    beforeDatabase.close();
    const projection = createPersonReferenceQuery(store).getPersonReferenceProjection({ personId: 'person-1' });
    assert.equal(projection.currentReferenceRevision, null);
    assert.equal(projection.projectionRevision, 1);
    assert.deepEqual(projection.contributions, []);
    assert.equal(projection.projectionDigest, before.current_reference_projection_digest);
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare(
      'SELECT current_reference_revision,current_reference_projection_revision,current_reference_projection_digest FROM people_persons WHERE person_id=?'
    ).get('person-1'), before);
    inspected.close();
  });
});

test('commits Asset, unique Face, Reference revision and Projection checkpoint atomically with UTF-8 byte sorting', () => {
  fixture(({ databasePath, store, unitOfWork }) => {
    register(store, 'person-1');
    const umlaut = addDecision('person-1', 1, 0, 'ä');
    const ascii = addDecision('person-1', 1, 1, 'z');
    const first = commit(unitOfWork, store, umlaut);
    const second = commit(unitOfWork, store, ascii);
    assert.equal(first.referenceRevision, 1);
    assert.equal(second.referenceRevision, 2);
    assert.deepEqual(second.activeReferenceAssets.map((item) => item.referenceAssetId), ['asset-z', 'asset-ä']);
    assert.equal(second.activeAssetSetDigest, canonicalDigest({ schema: 'people.reference-active-assets@1', items: second.activeReferenceAssets }));
    assert.equal(second.activeFaceSetDigest, canonicalDigest({ schema: 'people.reference-active-faces@1', items: second.activeReferenceFaces }));
    assert.equal(second.referenceSetDigest, canonicalDigest({ schema: 'people.reference-set@1', personId: 'person-1',
      activeAssetSetDigest: second.activeAssetSetDigest, activeFaceSetDigest: second.activeFaceSetDigest }));
    assert.equal(second.factDigest, canonicalDigest(Object.fromEntries(Object.entries(second).filter(([key]) => key !== 'factDigest'))));
    const projection = store.getPersonReferenceProjection('person-1');
    assert.equal(projection.projectionRevision, 3);
    assert.deepEqual(projection.contributions[0].activeAssets, second.activeReferenceAssets);
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_reference_assets').get().count, 2);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_reference_faces').get().count, 2);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM people_reference_revisions').get().count, 2);
    inspected.close();
  });
});

test('rejects non-single-face and stale operations with zero partial fact, then preserves an empty local contribution after release', () => {
  fixture(({ databasePath, store, unitOfWork }) => {
    register(store, 'person-1');
    const invalid = addDecision('person-1', 1, 0, 'invalid');
    invalid.faceEmbeddingSetHandle.detectedFaceCount = 0;
    invalid.decisionDigest = canonicalDigest(Object.fromEntries(Object.entries(invalid).filter(([key]) => key !== 'decisionDigest')));
    assert.throws(() => commit(unitOfWork, store, invalid), (error) => error.code === 'P6_PEOPLE_REFERENCE_ADD_EVIDENCE');
    const add = addDecision('person-1', 1, 0, 'one');
    commit(unitOfWork, store, add);
    assert.throws(() => commit(unitOfWork, store, add), (error) => error.code === 'P6_PEOPLE_REFERENCE_REVISION_CONFLICT');
    const released = commit(unitOfWork, store, releaseDecision(add, 1));
    assert.deepEqual(released.activeReferenceAssets, []);
    assert.deepEqual(released.activeReferenceFaces, []);
    const projection = store.getPersonReferenceProjection('person-1');
    assert.equal(projection.currentReferenceRevision, 2);
    assert.equal(projection.contributions.length, 1);
    assert.deepEqual(projection.contributions[0].activeAssets, []);
    const inspected = new Database(databasePath, { readonly: true });
    assert.deepEqual(inspected.prepare('SELECT state,released_reference_revision FROM people_reference_assets').get(),
      { state: 'released', released_reference_revision: 2 });
    inspected.close();
  });
});

test('fails closed on Projection checkpoint tampering instead of repairing it from GET', () => {
  fixture(({ databasePath, store }) => {
    register(store, 'person-1');
    const database = new Database(databasePath);
    database.prepare('UPDATE people_persons SET current_reference_projection_digest=? WHERE person_id=?').run(hash('tampered'), 'person-1');
    database.close();
    assert.throws(() => store.getPersonReferenceProjection('person-1'),
      (error) => error.code === 'PEOPLE_REFERENCE_PROJECTION_INVARIANT_VIOLATION');
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT current_reference_projection_digest digest FROM people_persons WHERE person_id=?').get('person-1').digest,
      hash('tampered'));
    inspected.close();
  });
});

test('keeps Reference ownership on merged source and atomically expands a read-only target Projection', () => {
  fixture(({ store, unitOfWork }) => {
    register(store, 'person-source');
    register(store, 'person-target');
    const add = addDecision('person-source', 1, 0, 'source');
    commit(unitOfWork, store, add);
    mergePeople(unitOfWork, store);
    const source = store.getPersonReferenceProjection('person-source');
    const target = store.getPersonReferenceProjection('person-target');
    assert.equal(source.contributions[0].ownerPersonId, 'person-source');
    assert.equal(source.contributions[0].inheritedReadOnly, false);
    assert.equal(target.currentReferenceRevision, null);
    assert.equal(target.contributions.length, 1);
    assert.equal(target.contributions[0].ownerPersonId, 'person-source');
    assert.equal(target.contributions[0].inheritedReadOnly, true);
    assert.equal(store.getReferenceAsset(add.referenceAssetId).personId, 'person-source');
    assert.equal(target.projectionRevision, 2);
  });
});
