'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { createCleanPeopleImagePort } = require('../../src/clean-people-image-port');
const { createPeopleReferencePreparation } = require('../../src/helix/integrations/people-reference-preparation');
const { createLocalFaceModel } = require('../../src/helix/integrations/local-face-model');
const { createPeopleStore } = require('../../src/helix/domains/people/persistence/people-store');
const { createCommandCommitCoordinator } = require('../../src/helix/foundation/persistence/commit-foundation');
const { createDirectPersonRegistrationCommand } = require('../../src/helix/domains/people/capabilities/people-registration-lifecycle');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createLocationRegistryRepository } = require('../../src/helix/platform/persistence/location-registry-repository');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'people-image-port-'));
  const kernel = openSqliteKernel({ Database, databasePath: path.join(root, 'db'), schemaManifest, schemaDdl, now: () => 1000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel }), locationRegistryRepository = createLocationRegistryRepository({ unitOfWork, schemaManifest });
  let crash = false;
  const port = createCleanPeopleImagePort({ unitOfWork, schemaManifest, locationRegistryRepository, rootPath: path.join(root, 'people'), now: () => 1000,
    afterPhysicalEffect() { if (crash) throw new Error('fixture crash after file publication'); } });
  t.after(() => { kernel.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#123456' } }).png().toBuffer();
  function authorize(suffix = 'image') {
    kernel.runPrimitive(({ prepare }) => {
      prepare('INSERT INTO fx_event_attempts(event_attempt_id) VALUES(?)').run(suffix + '-attempt');
      prepare('INSERT INTO fx_effect_journal(effect_id,effect_class,idempotency_key,event_attempt_id,state,intent_digest) VALUES(?,?,?,?,?,?)')
        .run(suffix + '-effect', 'workspace_write', suffix + '-key', suffix + '-attempt', 'intended', canonicalDigest(suffix + '-intent'));
    });
    return { eventAttemptId: suffix + '-attempt', idempotencyKey: suffix + '-key', recoveryDecision: null, assertExecutionActive() {} };
  }
  const context = { eventAttemptId: 'image-attempt', idempotencyKey: 'image-key', recoveryDecision: null, assertExecutionActive() {} };
  const request = { context, personId: 'future-person', operationId: 'registration-1', artifactKind: 'reference-image', bytes,
    provenanceRef: { objectType: 'people-image-operation', objectId: 'registration-1', revision: 1, digest: canonicalDigest('selected image') } };
  return { root, kernel, unitOfWork, port, bytes, authorize, request, crash: value => { crash = value; } };
}

test('stages selected user bytes without publishing a Person and rejects changed upload content', async t => {
  const f = await fixture(t), input = { bytes: f.bytes, actorId: 'admin', idempotencyKey: 'upload-1' };
  const handle = f.port.stageUpload(input);
  assert.deepEqual(f.port.stageUpload(input), handle); assert.deepEqual(f.port.readUpload(handle), f.bytes);
  assert.equal(f.kernel.runPrimitive(({ prepare }) => prepare('SELECT count(*) n FROM people_persons').get().n), 0);
  assert.throws(() => f.port.readUpload({ ...handle, sizeBytes: 1 }), { code: 'PEOPLE_IMAGE_UPLOAD_INVALID' });
  fs.writeFileSync(path.join(f.root, 'people', 'uploads', handle.uploadId), Buffer.alloc(f.bytes.length, 0));
  assert.throws(() => f.port.readUpload(handle), { code: 'PEOPLE_IMAGE_STORAGE_CHANGED' });
});

test('real CPU preparation produces nominal image/embedding Handles before atomic US Person publication', {
  skip: !process.env.SHELFDECK_FACE_MODEL_ROOT || !process.env.SHELFDECK_FACE_TEST_IMAGE ? 'Explicit pinned model pack and non-production sample are required.' : false,
}, async t => {
  const f = await fixture(t), model = createLocalFaceModel({ modelRoot: process.env.SHELFDECK_FACE_MODEL_ROOT });
  t.after(() => model.close());
  const preparation = createPeopleReferencePreparation({ imagePort: f.port, faceModel: model });
  const store = createPeopleStore({ schemaManifest, unitOfWork: f.unitOfWork });
  const command = createDirectPersonRegistrationCommand(store, createCommandCommitCoordinator({ schemaManifest, unitOfWork: f.unitOfWork }));
  const validator = createCapabilityContractValidator({ schemas: ['types/ArtifactHandle', 'types/FaceEmbeddingSetHandle',
    'domain-types/FaceModelRef', 'domain-types/PeopleReferenceMaintenanceDecision', 'domain-types/DirectPersonRegistrationDecision']
    .map(value => require('../../src/helix/contracts/' + value + '/v1/schema.json')) });
  validator.validate(preparation.modelReference().schemaRef, preparation.modelReference());
  const selectedImage = f.port.stageUpload({ bytes: fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE), actorId: 'admin', idempotencyKey: 'real-reference' });
  const artifactHandle = preparation.importImage({ context: f.authorize(), personId: 'real-model-person', operationId: 'real-registration', selectedImage });
  const computeRequest = { context: f.authorize('embedding'), personId: 'real-model-person', operationId: 'real-registration', referenceRevision: 1,
    artifactHandle, faceModelRef: preparation.modelReference() };
  const embedding = await preparation.computeEmbedding(computeRequest);
  assert.deepEqual(await preparation.computeEmbedding(computeRequest), embedding, 'Frozen preparation reuses the same reference feature version.');
  validator.validate(embedding.schemaRef, embedding);
  const frozenFeature={personId:'real-model-person',artifactHandleId:embedding.artifactHandleId,artifactDigest:embedding.embeddingDigest};
  assert.deepEqual(f.port.readReferenceEmbedding(frozenFeature),f.port.readArtifact(embedding.artifactHandle));
  assert.throws(()=>f.port.readReferenceEmbedding({...frozenFeature,personId:'other-person'}),{code:'PEOPLE_IMAGE_ARTIFACT_CHANGED'});
  assert.throws(()=>f.port.readReferenceEmbedding({...frozenFeature,artifactDigest:canonicalDigest('substituted-feature')}),{code:'PEOPLE_IMAGE_ARTIFACT_CHANGED'});
  assert.equal(store.getPerson('real-model-person'), undefined);
  const reference = { decisionId: 'real-reference-commit', operationKind: 'add_image', personId: 'real-model-person',
    expectedPersonRevision: 1, expectedReferenceRevision: 0, actorId: 'admin', referenceAssetId: 'real-reference-asset', referenceFaceId: 'real-reference-face',
    artifactHandle, artifactDigest: artifactHandle.digestHex, faceEmbeddingSetHandle: embedding, modelRef: preparation.modelReference().digest, initialState: 'active' };
  const decision = { decisionId: 'real-registration', newPersonId: 'real-model-person', libraryKind: 'us_adult',
    canonicalName: 'Test Actor', aliases: [], providerIdentities: [], actorId: 'admin', initialReference: { ...reference, decisionDigest: canonicalDigest(reference) } };
  const frozen = { ...decision, decisionDigest: canonicalDigest(decision) };
  validator.validate('helix://contracts/domain-types/DirectPersonRegistrationDecision/v1', frozen);
  const committed = command.registerPerson(frozen);
  assert.equal(committed.replayed, false); assert.equal(command.registerPerson(frozen).replayed, true);
  assert.equal(store.getPerson('real-model-person').currentReferenceRevision, 1);
  assert.equal(store.getPersonReferenceProjection('real-model-person').contributions[0].activeFaces.length, 1);
  const invalidImage = f.port.stageUpload({ bytes: f.bytes, actorId: 'admin', idempotencyKey: 'blank-reference' });
  const invalidArtifact = preparation.importImage({ context: f.authorize('invalid-image'), personId: 'invalid-model-person', operationId: 'invalid-registration', selectedImage: invalidImage });
  await assert.rejects(preparation.computeEmbedding({ ...computeRequest, context: f.authorize('invalid-embedding'), personId: 'invalid-model-person',
    operationId: 'invalid-registration', artifactHandle: invalidArtifact }), { code: 'FACE_REFERENCE_SINGLE_FACE_REQUIRED' });
  assert.equal(store.getPerson('invalid-model-person'), undefined);
});

test('requires formal Effect authority and recovers no-overwrite image publication after interruption', async t => {
  const f = await fixture(t);
  assert.throws(() => f.port.materialize(f.request), { code: 'PEOPLE_IMAGE_EFFECT_AUTHORITY_REQUIRED' });
  f.authorize(); f.crash(true);
  assert.throws(() => f.port.materialize(f.request), /fixture crash/);
  f.crash(false);
  const handle = f.port.materialize(f.request);
  assert.equal(handle.ownerDomain, 'people'); assert.equal(handle.ownerScope.scopeId, 'future-person');
  assert.deepEqual(f.port.materialize(f.request), handle); assert.deepEqual(f.port.readArtifact(handle), f.bytes);
  assert.throws(() => f.port.materialize({ ...f.request, bytes: Buffer.concat([f.bytes, Buffer.from('changed')]) }), { code: 'PEOPLE_IMAGE_STORAGE_CHANGED' });
  assert.deepEqual(f.port.readArtifact(handle), f.bytes);
  assert.equal(f.kernel.runPrimitive(({ prepare }) => prepare('SELECT count(*) n FROM people_persons').get().n), 0);
});
