'use strict';

const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { describeFreshResetReferenceRetention } = require('../src/helix/domains/people/public');
const fs = require('node:fs');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createLocationRegistryRepository } = require('../src/helix/platform/persistence/location-registry-repository');
const { createCleanPeopleImagePort } = require('../src/clean-people-image-port');
function fail(code, artifactHandleId) { throw Object.assign(new Error(code), { code, details: { artifactHandleId } }); }
function describe(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_VERIFY_READONLY_REQUIRED');
  return describeFreshResetReferenceRetention({
    assets: database.prepare('SELECT * FROM people_reference_assets ORDER BY reference_asset_id').all(),
    faces: database.prepare('SELECT * FROM people_reference_faces ORDER BY reference_face_id').all(),
  });
}
function assertArtifact(record, dependency) {
  if (!record || record.artifact_handle_id !== dependency.artifactHandleId || record.owner_domain !== 'people' ||
      record.owner_scope_type !== 'person' || record.owner_scope_id !== dependency.personId ||
      record.artifact_kind !== dependency.artifactKind || record.digest_hex !== dependency.artifactDigest ||
      dependency.active && record.state !== 'active' ||
      record.storage_ref !== 'people-artifact:' + dependency.artifactHandleId ||
      record.digest_algorithm !== 'sha256' || !Number.isSafeInteger(record.size_bytes) || record.size_bytes <= 0 ||
      dependency.artifactKind === 'reference-embedding' && (record.media_type !== 'application/vnd.shelfdeck.face-embedding+json' || record.size_bytes > 65536))
    fail('RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_INVALID', dependency.artifactHandleId);
}
function readActivePeopleReferenceArtifacts(database) {
  const active = describe(database).artifacts.filter(row => row.active);
  if (!active.length) return { readableImages: 0, readableEmbeddings: 0 };
  const root = database.prepare("SELECT * FROM platform_workspace_roots WHERE root_id='service-people-reference-artifacts'").get();
  if (!root || root.state !== 'active' || root.owner_scope !== 'platform-settings' || root.root_kind !== 'internal-artifact')
    fail('RESET_VERIFY_PEOPLE_REFERENCE_ROOT_INVALID');
  const stat = fs.lstatSync(root.resolved_root, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(root.resolved_root) !== root.resolved_root)
    fail('RESET_VERIFY_PEOPLE_REFERENCE_STORAGE_INVALID');
  const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const unitOfWork = createSqliteUnitOfWork({ kernel: { runPrimitive(operation) {
    return operation(Object.freeze({ commitTimeMs: 0, prepare: statement => database.prepare(statement) }));
  } } });
  const imagePort = createCleanPeopleImagePort({ schemaManifest, unitOfWork, rootPath: root.resolved_root,
    locationRegistryRepository: createLocationRegistryRepository({ schemaManifest, unitOfWork }) });
  let readableImages = 0, readableEmbeddings = 0;
  for (const dependency of active) {
    const input = { personId: dependency.personId, artifactHandleId: dependency.artifactHandleId, artifactDigest: dependency.artifactDigest };
    try {
      if (dependency.artifactKind === 'reference-embedding') { imagePort.readReferenceEmbedding(input); readableEmbeddings++; }
      else { imagePort.readReferenceImage(input); readableImages++; }
    } catch { fail('RESET_VERIFY_PEOPLE_REFERENCE_STORAGE_INVALID', dependency.artifactHandleId); }
  }
  return { readableImages, readableEmbeddings };
}
function verifyRetainedPeopleReferences(source, target) {
  const before = describe(source), after = describe(target);
  if (before.digest !== after.digest) fail('RESET_VERIFY_PEOPLE_REFERENCE_CHANGED');
  const sourceRecord = source.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id=?');
  const targetRecord = target.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id=?');
  const verified = [];
  for (const dependency of before.artifacts) {
    const original = sourceRecord.get(dependency.artifactHandleId), copied = targetRecord.get(dependency.artifactHandleId);
    assertArtifact(original, dependency); assertArtifact(copied, dependency);
    if (canonicalDigest(original) !== canonicalDigest(copied)) fail('RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_CHANGED', dependency.artifactHandleId);
    verified.push({ artifactHandleId: dependency.artifactHandleId, digest: canonicalDigest(copied) });
  }
  return { referenceDigest: before.referenceDigest, artifacts: verified.length, digest: canonicalDigest(verified),
    ...readActivePeopleReferenceArtifacts(target) };
}
module.exports = Object.freeze({ describePeopleReferenceRetention: describe, assertPeopleReferenceArtifact: assertArtifact,
  readActivePeopleReferenceArtifacts, verifyRetainedPeopleReferences });
