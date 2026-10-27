'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createLocationRegistryRepository } = require('../src/helix/platform/persistence/location-registry-repository');
const { createCleanPeopleImagePort } = require('../src/clean-people-image-port');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const { verifyRetainedCollections } = require('../scripts/formation-reset-verify');
const { preparePeopleReferenceRecovery, publishPeopleReferenceRecovery } = require('../scripts/formation-reset-people-recovery');
const { describePeopleReferenceRetention } = require('../scripts/formation-reset-people-references');
const { fileDigest } = require('../scripts/formation-reset-generation');
const { runPeopleReferenceRecovery } = require('../scripts/formation-reset-people-recovery-run');
const { inventoryBackupSources, createVerifiedBackup } = require('../scripts/formation-reset-backup');
const { createDeploymentBackup } = require('../scripts/formation-reset-deployment-backup');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');

function port(kernel, rootPath) {
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  return createCleanPeopleImagePort({ schemaManifest, unitOfWork, rootPath,
    locationRegistryRepository: createLocationRegistryRepository({ schemaManifest, unitOfWork }), now: () => 1000 });
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-people-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'target.db'), rootPath = path.join(root, 'people');
  const kernel = openSqliteKernel({ Database, databasePath: sourcePath, schemaManifest, schemaDdl });
  const imagePort = port(kernel, rootPath);
  function materialize(kind, bytes) {
    const id = 'prepare-' + kind;
    kernel.runPrimitive(({ prepare }) => {
      prepare('INSERT INTO fx_event_attempts(event_attempt_id) VALUES(?)').run(id);
      prepare('INSERT INTO fx_effect_journal(effect_id,effect_class,idempotency_key,event_attempt_id,state,intent_digest) VALUES(?,?,?,?,?,?)')
        .run(id, 'workspace_write', id, id, 'intended', canonicalDigest(id));
    });
    return imagePort.materialize({ context: { eventAttemptId: id, idempotencyKey: id, assertExecutionActive() {} },
      personId: 'person', operationId: 'reference', artifactKind: kind, bytes,
      provenanceRef: { objectType: 'people-image-operation', objectId: 'reference', revision: 1, digest: canonicalDigest('reference') } });
  }
  const image = materialize('reference-image', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  // This proves Artifact publication/reading, not model quality or inference.
  const bytes = Buffer.from(JSON.stringify({ fixture: 'reference feature' }));
  const feature = materialize('reference-embedding', bytes);
  kernel.close();
  const source = new Database(sourcePath);
  try {
    source.pragma('foreign_keys=ON');
    source.transaction(() => {
      source.prepare("INSERT INTO people_persons(person_id,library_kind,status) VALUES('person','us_adult','active')").run();
      source.prepare("INSERT INTO people_reference_revisions(person_id,revision,operation_kind) VALUES('person',1,'add_image')").run();
      source.prepare("INSERT INTO people_reference_assets(reference_asset_id,person_id,artifact_handle_id,artifact_digest,state,created_reference_revision) VALUES('image','person',?,?,'active',1)")
        .run(image.artifactHandleId, image.digestHex);
      source.prepare("INSERT INTO people_reference_faces(reference_face_id,person_id,reference_asset_id,embedding_handle_id,embedding_digest,model_ref,state,created_reference_revision) VALUES('face','person','image',?,?,?,'active',1)")
        .run(feature.artifactHandleId, feature.digestHex, canonicalDigest('model'));
      source.prepare("UPDATE people_persons SET current_reference_revision=1 WHERE person_id='person'").run();
      source.prepare("UPDATE people_reference_revisions SET reference_asset_id='image',reference_face_id='face' WHERE person_id='person'").run();
    })();
    assert.equal(source.prepare('SELECT COUNT(*) n FROM fx_artifact_references').get().n, 0);
  } finally { source.close(); }
  return { root, sourcePath, targetPath, rootPath, feature, bytes, Database,
    policy: buildOwnerRetentionPolicy(schemaManifest), targetSchema: { schemaManifest, schemaDdl } };
}
function verify(f) { return verifyRetainedCollections({ ...f, schemaManifest, schemaDdl }); }

test('fresh Reset retains both native People image and embedding Handles without Foundation consumer references', t => {
  const f = fixture(t);
  createRetainedDatabase(f);
  assert.equal(verify(f).peopleReferences.artifacts, 2);
  const kernel = openSqliteKernel({ Database, databasePath: f.targetPath, schemaManifest, schemaDdl });
  try { assert.deepEqual(port(kernel, f.rootPath).readReferenceEmbedding({ personId: 'person',
    artifactHandleId: f.feature.artifactHandleId, artifactDigest: f.feature.digestHex }), f.bytes); }
  finally { kernel.close(); }
});

test('the previous image-only selection has valid FKs but is rejected by People dependency verification', t => {
  const f = fixture(t);
  f.policy = { ...f.policy, edges: f.policy.edges.filter(edge => !(edge.parent === 'people_reference_faces' && edge.child === 'fx_artifact_registry')) };
  createRetainedDatabase(f);
  const target = new Database(f.targetPath, { readonly: true });
  try { assert.deepEqual(target.pragma('foreign_key_check'), []); }
  finally { target.close(); }
  assert.throws(() => verify(f), { code: 'RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_INVALID' });
});

test('a missing source embedding cannot be approved as a valid preserved People configuration', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.prepare('DELETE FROM fx_artifact_registry WHERE artifact_handle_id=?').run(f.feature.artifactHandleId); source.close();
  assert.throws(() => createRetainedDatabase(f), { code: 'RESET_COPY_OWNER_REFERENCE_MISSING' });
});

test('a registered active reference with missing physical bytes cannot pass Reset preflight verification', t => {
  const f = fixture(t); createRetainedDatabase(f);
  fs.unlinkSync(path.join(f.rootPath, f.feature.artifactHandleId));
  assert.throws(() => verify(f), { code: 'RESET_VERIFY_PEOPLE_REFERENCE_STORAGE_INVALID' });
});

test('a foreign, changed or inactive feature is rejected even when all SQLite references are valid', t => {
  for (const [column, value] of [['owner_scope_id', 'another-person'], ['digest_hex', '1'.repeat(64)], ['state', 'deleted']]) {
    const f = fixture(t), source = new Database(f.sourcePath);
    source.prepare('UPDATE fx_artifact_registry SET ' + column + '=? WHERE artifact_handle_id=?').run(value, f.feature.artifactHandleId); source.close();
    createRetainedDatabase(f);
    assert.throws(() => verify(f), { code: 'RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_INVALID' });
  }
});

function recovery(t) {
  const f = fixture(t);
  f.policy = { ...f.policy, edges: f.policy.edges.filter(edge => !(edge.parent === 'people_reference_faces' && edge.child === 'fx_artifact_registry')) };
  createRetainedDatabase(f);
  const current = new Database(f.targetPath);
  // A relational post-Resume fact must survive the recovery even though it
  // was absent from the older, authoritative reference-Artifact backup.
  current.prepare("INSERT INTO proc_candidate_packages(candidate_package_id,state,content_profile) VALUES('new-after-resume','published','movie')").run();
  current.close();
  const read = new Database(f.targetPath, { readonly: true }); read.exec('BEGIN');
  let reference;
  try { reference = describePeopleReferenceRetention(read).referenceDigest; }
  finally { read.exec('ROLLBACK'); read.close(); }
  const input = { Database, originalPrivatePath: f.sourcePath, currentPrivatePath: f.targetPath,
    candidatePath: path.join(f.root, 'recovered.db'), originalDigest: fileDigest(f.sourcePath), currentDigest: fileDigest(f.targetPath),
    expectedCount: 1, expectedHandlesDigest: canonicalDigest([f.feature.artifactHandleId]), expectedReferenceDigest: reference,
    schemaManifest, schemaDdl, assertClosed() {} };
  return { ...f, input };
}

test('dependency recovery copies only the missing original registration and preserves all post-Resume facts', t => {
  const f = recovery(t), proof = preparePeopleReferenceRecovery(f.input);
  assert.equal(proof.recoveredCount, 1); assert.equal(proof.unchangedTables, schemaManifest.tables.length - 1);
  assert.equal(proof.peopleReferences.artifacts, 2);
  const target = new Database(f.input.candidatePath, { readonly: true });
  try { assert.equal(target.prepare('SELECT COUNT(*) n FROM proc_candidate_packages WHERE candidate_package_id=?').get('new-after-resume').n, 1); }
  finally { target.close(); }
  const kernel = openSqliteKernel({ Database, databasePath: f.input.candidatePath, schemaManifest, schemaDdl });
  try { assert.deepEqual(port(kernel, f.rootPath).readReferenceEmbedding({ personId: 'person',
    artifactHandleId: f.feature.artifactHandleId, artifactDigest: f.feature.digestHex }), f.bytes); }
  finally { kernel.close(); }
});

test('recovery refuses changed scope, missing physical bytes and changed input instead of manufacturing a feature', t => {
  for (const mutation of ['scope', 'physical', 'source']) {
    const f = recovery(t);
    if (mutation === 'scope') f.input.expectedHandlesDigest = canonicalDigest([]);
    if (mutation === 'physical') fs.writeFileSync(path.join(f.rootPath, f.feature.artifactHandleId), 'changed');
    if (mutation === 'source') f.input.currentDigest = '0'.repeat(64);
    assert.throws(() => preparePeopleReferenceRecovery(f.input), { code: {
      scope: 'PEOPLE_RECOVERY_SCOPE_CHANGED', physical: 'PEOPLE_RECOVERY_PHYSICAL_REFERENCE_INVALID', source: 'PEOPLE_RECOVERY_SOURCE_CHANGED',
    }[mutation] });
    assert.equal(fs.existsSync(f.input.candidatePath), false);
  }
});

test('recovery never overwrites an existing foreign registration', t => {
  const f = recovery(t), source = new Database(f.sourcePath), current = new Database(f.targetPath);
  try {
    const record = source.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id=?').get(f.feature.artifactHandleId);
    record.owner_scope_id = 'another-person';
    const columns = Object.keys(record);
    current.prepare('INSERT INTO fx_artifact_registry (' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')')
      .run(...columns.map(column => record[column]));
  } finally { source.close(); current.close(); }
  f.input.currentDigest = fileDigest(f.targetPath);
  assert.throws(() => preparePeopleReferenceRecovery(f.input), { code: 'RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_INVALID' });
  assert.equal(fs.existsSync(f.input.candidatePath), false);
});

test('cold publication recovers each interrupted rename without changing the original Reset marker', t => {
  for (const interrupted of ['publication_prepared', 'previous_database_preserved', 'recovered_database_published', 'publication_complete']) {
    const f = recovery(t), activePath = path.join(f.root, 'active.db');
    fs.copyFileSync(f.targetPath, activePath);
    const proof = preparePeopleReferenceRecovery(f.input), stagedPath = path.join(f.root, 'staged.db');
    fs.copyFileSync(f.input.candidatePath, stagedPath);
    const marker = path.join(f.root, 'database-generation.json'); fs.writeFileSync(marker, 'unchanged original Reset marker');
    const options = { activePath, stagedPath, previousPath: path.join(f.root, 'previous.db'), journalPath: path.join(f.root, 'publication.json'),
      proof, assertClosed() {}, checkpoint(phase) { if (phase === interrupted) throw new Error('injected interruption'); } };
    assert.throws(() => publishPeopleReferenceRecovery(options), /injected interruption/);
    assert.equal(publishPeopleReferenceRecovery({ ...options, checkpoint() {} }).complete, true);
    assert.equal(publishPeopleReferenceRecovery({ ...options, checkpoint() {} }).complete, true);
    assert.equal(fileDigest(activePath), proof.candidateDigest);
    assert.equal(fileDigest(options.previousPath), proof.currentDigest);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'unchanged original Reset marker');
  }
});

async function coldRecovery(t) {
  const f = recovery(t);
  const folders = Object.fromEntries(['live-data', 'original-data', 'original-archive', 'repair-operations', 'repair-archives', 'transcode']
    .map(name => [name, path.join(f.root, name)]));
  for (const folder of Object.values(folders)) fs.mkdirSync(folder);
  const dataDir = folders['live-data'], operationRoot = folders['repair-operations'];
  fs.copyFileSync(f.sourcePath, path.join(folders['original-data'], 'shelfdeck.db'));
  fs.copyFileSync(f.targetPath, path.join(dataDir, 'shelfdeck.db'));
  const sourceOptions = { roots: [{ id: 'data', path: folders['original-data'] }] };
  const manifest = inventoryBackupSources(sourceOptions);
  const originalBackupRoot = path.join(folders['original-archive'], 'complete');
  await createVerifiedBackup({ sourceOptions, manifest, targetRoot: originalBackupRoot, assertStopped() {} });
  const originalManifestFile = path.join(f.root, 'original-manifest.json'); fs.writeFileSync(originalManifestFile, JSON.stringify(manifest));
  const generation = 'a'.repeat(64), stopId = 'b'.repeat(64), candidateDigest = canonicalDigest('initial Reset database');
  const reset = { phase: 'complete', desiredMode: 'stopped', generationId: generation, databaseGeneration: generation,
    sourceDigest: f.input.originalDigest, candidateDigest, backupDigest: canonicalDigest({ manifest, backupRoot: originalBackupRoot }) };
  const runtime = path.join(dataDir, 'operator-runtime'); fs.mkdirSync(runtime);
  const intent = { schema: 'shelfdeck.runtime-intent@1', desiredMode: 'stopped', revision: 34, pendingReset: null };
  const stop = { operationId: stopId, kind: 'stop', state: 'completed', result: { mode: 'stopped' } };
  const fence = { schema: 'shelfdeck.cold-reset-fence@1', generationId: generation, runtimeRevision: 31,
    runtimeIntentDigest: canonicalDigest('initial Reset intent'), phase: 'complete', candidateDigest, receiptDigest: canonicalDigest(reset) };
  const marker = { generationId: generation, candidateDigest };
  for (const [file, value] of [['intent.json', intent], [stopId + '.json', stop], ['generation-' + generation + '-result.json', reset],
    ['generation-fence.json', { ...fence, recordDigest: canonicalDigest(fence) }]]) fs.writeFileSync(path.join(runtime, file), JSON.stringify(value));
  fs.writeFileSync(path.join(dataDir, 'database-generation.json'), JSON.stringify({ ...marker, receiptDigest: canonicalDigest(marker) }));
  const closure = { schema: 'shelfdeck.deployment-closure@1', oldContainerRemoved: true, oldContainerId: 'c'.repeat(64),
    oldImageId: 'sha256:' + 'd'.repeat(64), remainingDataMounts: [], runtimeRevision: 34,
    intentDigest: canonicalDigest(intent), stopOperationId: stopId, stopReceiptDigest: canonicalDigest(stop) };
  const compose = path.join(f.root, 'compose.yml'), secret = path.join(f.root, 'secret.env');
  fs.writeFileSync(compose, 'fixture compose'); fs.writeFileSync(secret, 'test-only secret');
  await createDeploymentBackup({ dataDir, operationRoot, backupParent: folders['repair-archives'], closure,
    sourceOptions: { roots: [{ id: 'data', path: dataDir }, { id: 'workspace', path: folders.transcode }] },
    configFiles: [{ name: 'compose.yml', path: compose }, { name: 'secret.env', path: secret }] });
  return { ...f, dataDir, request: { schema: 'shelfdeck.people-reference-recovery-request@1', dataDir, operationRoot, closure,
    deploymentBackupReceiptFile: path.join(operationRoot, 'deployment-backup-receipt.json'), scope: {
      schema: 'shelfdeck.people-reference-recovery@1', resetGeneration: generation, originalManifestFile, originalBackupRoot,
      originalSourceDigest: f.input.originalDigest, expectedCount: 1, expectedHandlesDigest: f.input.expectedHandlesDigest,
      expectedReferenceDigest: f.input.expectedReferenceDigest } } };
}

test('the cold recovery entrypoint binds both verified backups, the completed Reset, Stop revision and native lifecycle lease', async t => {
  const f = await coldRecovery(t), active = path.join(f.dataDir, 'shelfdeck.db');
  const result = await runPeopleReferenceRecovery(f.request);
  assert.equal(result.state, 'completed'); assert.equal(result.recoveredCount, 1);
  assert.deepEqual(await runPeopleReferenceRecovery(f.request), result);
  const read = new Database(active, { readonly: true });
  try {
    assert.equal(read.prepare('SELECT COUNT(*) n FROM fx_artifact_registry WHERE artifact_handle_id=?').get(f.feature.artifactHandleId).n, 1);
    assert.equal(read.prepare("SELECT COUNT(*) n FROM proc_candidate_packages WHERE candidate_package_id='new-after-resume'").get().n, 1);
  } finally { read.close(); }
});

test('the cold entrypoint refuses stale Stop authority, a forged original backup and an active Supervisor', async t => {
  for (const mutation of ['stop', 'original', 'lease']) {
    const f = await coldRecovery(t), before = fileDigest(path.join(f.dataDir, 'shelfdeck.db'));
    let lease;
    if (mutation === 'stop') f.request.closure.runtimeRevision++;
    if (mutation === 'original') f.request.scope.originalSourceDigest = '0'.repeat(64);
    if (mutation === 'lease') lease = require('../src/clean-generation-lease').acquireGenerationLease({ dataDir: f.dataDir });
    try { await assert.rejects(runPeopleReferenceRecovery(f.request), { code: {
      stop: 'PEOPLE_RECOVERY_STOP_CHANGED', original: 'PEOPLE_RECOVERY_ORIGINAL_BACKUP_INVALID', lease: 'RESET_SUPERVISOR_ALREADY_ACTIVE',
    }[mutation] }); }
    finally { lease?.close(); }
    assert.equal(fileDigest(path.join(f.dataDir, 'shelfdeck.db')), before);
  }
});
