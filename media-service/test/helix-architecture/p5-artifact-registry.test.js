'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createArtifactRegistry } = require('../../src/helix/foundation/effects/artifact-registry');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { createArtifactRepository } = require('../../src/helix/foundation/persistence/artifact-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPathAuthority } = require('../../src/helix/platform/model/path-authority');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-artifacts-'));
  const databasePath = path.join(tempRoot, 'shelfdeck.db');
  let clock = 1700000000000;
  let intentSequence = 0;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const repository = createArtifactRepository({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) });
  const locations = new Map();
  const realities = new Map();
  const root = { rootId: 'root-artifacts', configRevision: 1, resolvedRoot: '/controlled/artifacts' };
  const rootResolver = {
    resolve(request) {
      if (request.rootId !== root.rootId || request.expectedConfigRevision !== root.configRevision ||
          request.ownerScope !== 'platform-settings' || request.rootKind !== 'internal-artifact') {
        const error = new Error('stale controlled root');
        error.code = 'P5_WORKSPACE_ROOT_STALE';
        throw error;
      }
      return Object.freeze({ ...root, ownerScope: 'platform-settings', rootKind: 'internal-artifact' });
    }
  };
  const storageResolver = {
    resolveNew(request) {
      const storageRef = 'artifact:' + digest(request.relativePath).slice(0, 24);
      const resolvedPath = path.posix.resolve(request.resolvedRoot, request.relativePath);
      locations.set(storageRef, Object.freeze({
        rootId: request.rootId, rootConfigRevision: request.rootConfigRevision,
        resolvedRoot: request.resolvedRoot, resolvedPath
      }));
      return Object.freeze({ storageRef, resolvedPath });
    },
    resolveStored(storageRef) { return locations.get(storageRef); }
  };
  const storageProbe = {
    inspect(request) {
      return realities.get(request.resolvedPath) || Object.freeze({
        exists: false, digestAlgorithm: 'sha256', digestHex: digest('missing'), sizeBytes: 0,
        mediaType: 'application/octet-stream'
      });
    }
  };
  const registry = createArtifactRegistry({
    repository, rootResolver, storageResolver, pathAuthority: createPathAuthority(path.posix), storageProbe,
    gcAuthorityVerifier: { verify: ({ authority }) => authority.scopeDigest === digest('gc-scope') || authority.scopeDigest === digest('orphan-scan') },
    createIntentId: () => 'gc-intent-' + (++intentSequence)
  });
  try {
    return run({ databasePath, kernel, locations, realities, registry, repository, root });
  } finally {
    kernel.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function request(overrides = {}) {
  const relativePath = overrides.relativePath || 'provider/payload.bin';
  return {
    artifactHandleId: 'artifact-1', artifactKind: 'provider-payload', ownerDomain: 'libra',
    ownerScopeType: 'libra-run', ownerScopeId: 'run-1', rootId: 'root-artifacts', rootConfigRevision: 1,
    relativePath, digestHex: digest('artifact-bytes'), sizeBytes: 14, mediaType: 'application/octet-stream',
    provenanceRef: { objectType: 'event-result', objectId: 'result-1', revision: 1, digest: digest('provenance') },
    createdAtMs: 1700000000100, ...overrides
  };
}

function seedReality(realities, item = request()) {
  realities.set(path.posix.resolve('/controlled/artifacts', item.relativePath), Object.freeze({
    exists: true, digestAlgorithm: 'sha256', digestHex: item.digestHex,
    sizeBytes: item.sizeBytes, mediaType: item.mediaType
  }));
}

function ownerQuery(handle, overrides = {}) {
  return {
    artifactHandleId: handle.artifactHandleId, expectedReferenceRevision: handle.referenceRevision,
    requesterDomain: 'libra', requesterScopeType: 'libra-run', requesterScopeId: 'run-1',
    purpose: 'owner-read', ...overrides
  };
}

test('registers a typed immutable handle and persists only bounded metadata', () => {
  fixture(({ databasePath, realities, registry }) => {
    seedReality(realities);
    const handle = registry.register(request());
    assert.equal(Object.isFrozen(handle), true);
    assert.deepEqual(handle.ownerScope, { scopeType: 'libra-run', scopeId: 'run-1' });
    assert.deepEqual(handle.provenanceRef, request().provenanceRef);
    assert.equal(Object.prototype.hasOwnProperty.call(handle, 'payload'), false);
    assert.deepEqual(registry.query(ownerQuery(handle)), handle);
    const database = new Database(databasePath, { readonly: true });
    const row = database.prepare('SELECT owner_domain,storage_ref,digest_hex,size_bytes,provenance_ref,state FROM fx_artifact_registry').get();
    assert.equal(row.owner_domain, 'libra');
    assert.match(row.storage_ref, /^artifact:/);
    assert.equal(row.digest_hex, handle.digestHex);
    assert.equal(row.size_bytes, 14);
    assert.deepEqual(JSON.parse(row.provenance_ref), request().provenanceRef);
    assert.equal(row.state, 'active');
    database.close();
  });
});

test('rejects containment escape, stale controlled root, malformed provenance, and release outside containment', () => {
  fixture(({ locations, realities, registry }) => {
    seedReality(realities, request({ relativePath: '../escape.bin' }));
    assert.throws(() => registry.register(request({ relativePath: '../escape.bin' })),
      (error) => error.code === 'P5_ARTIFACT_REGISTER_INVALID');
    assert.throws(() => registry.register(request({ rootConfigRevision: 2 })),
      (error) => error.code === 'P5_WORKSPACE_ROOT_STALE');
    seedReality(realities);
    assert.throws(() => registry.register(request({ provenanceRef: 'legacy-string-ref' })),
      (error) => error.code === 'P5_ARTIFACT_PROVENANCE_SHAPE');
    const handle = registry.register(request());
    registry.addReference({
      artifactHandleId: handle.artifactHandleId, expectedReferenceRevision: 1, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input', createdAtMs: 2
    });
    locations.set(handle.storageRef, Object.freeze({
      ...locations.get(handle.storageRef), resolvedPath: '/outside/artifact.bin'
    }));
    assert.throws(() => registry.releaseReference({
      artifactHandleId: handle.artifactHandleId, expectedArtifactRevision: 2, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input',
      referenceRevision: 2, releasedAtMs: 3
    }), (error) => error.code === 'P5_ARTIFACT_CONTAINMENT');
  });
});

test('fails closed when stored reality is missing or checksum, size, or media type drifts', () => {
  fixture(({ realities, registry }) => {
    seedReality(realities);
    const handle = registry.register(request());
    const location = path.posix.resolve('/controlled/artifacts', request().relativePath);
    for (const changed of [
      { exists: false }, { digestHex: digest('changed') }, { sizeBytes: 99 }, { mediaType: 'text/plain' }
    ]) {
      seedReality(realities);
      realities.set(location, Object.freeze({ ...realities.get(location), ...changed }));
      assert.throws(() => registry.query(ownerQuery(handle)), (error) => error.code === 'P5_ARTIFACT_REALITY_DRIFT');
    }
  });
});

test('grants consumer reads only for the exact active reference and purpose', () => {
  fixture(({ realities, registry }) => {
    seedReality(realities);
    const handle = registry.register(request());
    const added = registry.addReference({
      artifactHandleId: handle.artifactHandleId, expectedReferenceRevision: 1, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input',
      createdAtMs: 1700000000200
    });
    const consumerQuery = {
      artifactHandleId: handle.artifactHandleId, expectedReferenceRevision: added.referenceRevision,
      requesterDomain: 'arca', requesterScopeType: 'acceptance-run', requesterScopeId: 'accept-1',
      purpose: 'acceptance-input'
    };
    const consumed = registry.query(consumerQuery);
    assert.equal(consumed.ownerDomain, 'libra');
    assert.deepEqual(consumed.ownerScope, handle.ownerScope);
    assert.throws(() => registry.query({ ...consumerQuery, purpose: 'other-purpose' }),
      (error) => error.code === 'P5_ARTIFACT_SCOPE_DENIED');
    assert.throws(() => registry.query({ ...consumerQuery, requesterScopeId: 'accept-2' }),
      (error) => error.code === 'P5_ARTIFACT_SCOPE_DENIED');
    const released = registry.releaseReference({
      artifactHandleId: handle.artifactHandleId, expectedArtifactRevision: 2, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input',
      referenceRevision: 2, releasedAtMs: 1700000000300
    });
    assert.equal(released.referenceRevision, 3);
    assert.throws(() => registry.query({ ...consumerQuery, expectedReferenceRevision: 3 }),
      (error) => error.code === 'P5_ARTIFACT_SCOPE_DENIED');
  });
});

test('rejects stale revision fences and duplicate active references', () => {
  fixture(({ realities, registry }) => {
    seedReality(realities);
    registry.register(request());
    const reference = {
      artifactHandleId: 'artifact-1', expectedReferenceRevision: 1, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input',
      createdAtMs: 1700000000200
    };
    registry.addReference(reference);
    assert.throws(() => registry.addReference(reference), (error) => error.code === 'P5_ARTIFACT_REVISION_CONFLICT');
    assert.throws(() => registry.addReference({ ...reference, expectedReferenceRevision: 2, createdAtMs: 1700000000201 }),
      (error) => error.code === 'P5_ARTIFACT_REFERENCE_ALREADY_ACTIVE');
    assert.throws(() => registry.releaseReference({
      artifactHandleId: 'artifact-1', expectedArtifactRevision: 1, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input',
      referenceRevision: 2, releasedAtMs: 1700000000300
    }), (error) => error.code === 'P5_ARTIFACT_REVISION_CONFLICT');
  });
});

test('GC requires no active reference, exact authority, and the exact issued intent', () => {
  fixture(({ realities, registry }) => {
    seedReality(realities);
    registry.register(request());
    registry.addReference({
      artifactHandleId: 'artifact-1', expectedReferenceRevision: 1, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input', createdAtMs: 2
    });
    const authority = { authorityKind: 'artifact-gc', artifactHandleId: 'artifact-1', digestHex: digest('artifact-bytes'), scopeDigest: digest('gc-scope') };
    assert.throws(() => registry.authorizeDeletion({ artifactHandleId: 'artifact-1', expectedReferenceRevision: 2, authority }),
      (error) => error.code === 'P5_ARTIFACT_ACTIVE_REFERENCES');
    registry.releaseReference({
      artifactHandleId: 'artifact-1', expectedArtifactRevision: 2, consumerDomain: 'arca',
      consumerScopeType: 'acceptance-run', consumerScopeId: 'accept-1', referenceKind: 'acceptance-input',
      referenceRevision: 2, releasedAtMs: 3
    });
    assert.throws(() => registry.authorizeDeletion({
      artifactHandleId: 'artifact-1', expectedReferenceRevision: 3,
      authority: { ...authority, authorityKind: 'domain-delete' }
    }), (error) => error.code === 'P5_ARTIFACT_DELETE_AUTHORITY_INVALID');
    assert.throws(() => registry.authorizeDeletion({
      artifactHandleId: 'artifact-1', expectedReferenceRevision: 3,
      authority: { ...authority, scopeDigest: digest('fabricated-scope') }
    }), (error) => error.code === 'P5_ARTIFACT_DELETE_AUTHORITY_INVALID');
    const intent = registry.authorizeDeletion({ artifactHandleId: 'artifact-1', expectedReferenceRevision: 3, authority });
    assert.equal(intent.referenceRevision, 4);
    assert.throws(() => registry.assertDeletionIntent({ ...intent }),
      (error) => error.code === 'P5_ARTIFACT_DELETE_INTENT_INVALID');
    assert.equal(registry.assertDeletionIntent(intent), intent);
  });
});

test('an orphan becomes GC eligible only through exact Artifact GC authority', () => {
  fixture(({ databasePath, realities, registry }) => {
    seedReality(realities);
    registry.register(request());
    const intent = registry.authorizeDeletion({
      artifactHandleId: 'artifact-1', expectedReferenceRevision: 1,
      authority: { authorityKind: 'artifact-gc', artifactHandleId: 'artifact-1', digestHex: digest('artifact-bytes'), scopeDigest: digest('orphan-scan') }
    });
    assert.equal(registry.assertDeletionIntent(intent).artifactHandleId, 'artifact-1');
    const database = new Database(databasePath, { readonly: true });
    assert.deepEqual(database.prepare('SELECT state,reference_revision FROM fx_artifact_registry').get(),
      { state: 'gc_eligible', reference_revision: 2 });
    database.close();
  });
});

test('same owner scope, digest, and kind deduplicates without creating a second registry row', () => {
  fixture(({ databasePath, realities, registry }) => {
    seedReality(realities);
    const first = registry.register(request());
    const second = registry.register(request({ artifactHandleId: 'artifact-duplicate' }));
    assert.deepEqual(second, first);
    const alternate = request({ artifactHandleId: 'artifact-other-location', relativePath: 'provider/duplicate.bin' });
    seedReality(realities, alternate);
    assert.throws(() => registry.register(alternate), (error) => error.code === 'P5_ARTIFACT_DUPLICATE_STORAGE');
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_artifact_registry').get().count, 1);
    database.close();
  });
});

test('P5-05 Artifact code has no direct filesystem, network, process, Domain Store, or deletion effect', () => {
  const source = [
    '../../src/helix/foundation/effects/artifact-registry.js',
    '../../src/helix/foundation/persistence/artifact-repository.js'
  ].map((file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').toLowerCase()).join('\n');
  for (const forbidden of ['node:' + 'fs', 'node:' + 'http', 'child_' + 'process', 'process.' + 'env', '/domains/', 'unlink' + 'sync', 'rm' + 'sync']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
