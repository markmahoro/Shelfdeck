'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  createCleanWorkspaceProductPort,
} = require('../../src/clean-workspace-product-port');

const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-workspace-product-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const workspaceRoot = path.join(root, 'workspace');
  let now = 1_700_000_000_000;
  const kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now: () => now++,
  });
  try {
    const workspaceId = request().workspaceId;
    const seed = new Database(databasePath);
    seed.prepare(`INSERT INTO fx_workspace_registry
      (workspace_id,owner_domain,process_type,process_id,root_handle_ref,state,created_at_ms)
      VALUES(?,?,?,?,?,?,?)`).run(
      workspaceId, 'libra', 'libra_run', 'run-1',
      canonicalDigest({ schema: 'fixture-workspace-root@1' }), 'active', 1,
    );
    seed.close();
    return run({
      databasePath,
      workspaceRoot,
      dependencies: {
        schemaManifest,
        unitOfWork: createSqliteUnitOfWork({ kernel }),
      },
    });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function request(bytes = Buffer.from('<movie><title>Example Movie</title></movie>')) {
  return Object.freeze({
    libraRunId: 'run-1',
    workspaceId: canonicalDigest({ schema: 'libra.workspace-id@1', libraRunId: 'run-1' }),
    relativePath: 'artifacts/movie.nfo',
    artifactKind: 'nfo',
    mediaType: 'application/xml',
    bytes,
    provenanceRef: Object.freeze({
      objectType: 'libra_run',
      objectId: 'run-1',
      revision: 1,
      digest: canonicalDigest({ schema: 'movie-metadata-render@1', libraRunId: 'run-1' }),
    }),
  });
}

function frameRequest() {
  const base = request();
  return Object.freeze({
    libraRunId: base.libraRunId,
    workspaceId: base.workspaceId,
    relativePath: 'analysis/frames/frame-set.json',
    artifactKind: 'western_frame_set',
    mediaType: 'application/vnd.shelfdeck.western-frame-set+json',
    provenanceRef: Object.freeze({
      objectType: 'western_frame_extract',
      objectId: 'frame-target-1',
      revision: 1,
      digest: canonicalDigest('frame-target-1'),
    }),
    maxFrames: 4,
  });
}

test('materializes one service-owned Workspace Artifact and replays exact handles', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const first = port.materializeArtifact(request());
    const replay = port.materializeArtifact(request());
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.workspaceMaterialHandle, first.workspaceMaterialHandle);
    assert.deepEqual(replay.artifactHandle, first.artifactHandle);
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    assert.deepEqual(fs.readFileSync(target), request().bytes);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare(
        "SELECT count(*) count FROM fx_effect_journal WHERE state='committed'"
      ).get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM fx_workspace_materials').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM fx_artifact_registry').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM platform_workspace_roots').get().count, 1);
    } finally {
      database.close();
    }
  }));

test('recovers the same physical bytes after crash before journal/handle commit', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    let crash = true;
    const crashing = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
      afterPhysicalEffect() {
        if (!crash) return;
        crash = false;
        throw new Error('fault-after-physical-workspace-effect');
      },
    });
    assert.throws(
      () => crashing.materializeArtifact(request()),
      /fault-after-physical-workspace-effect/,
    );
    const interrupted = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(interrupted.prepare(
        'SELECT state FROM fx_effect_journal'
      ).get(), { state: 'intended' });
      assert.equal(interrupted.prepare('SELECT count(*) count FROM fx_workspace_materials').get().count, 0);
      assert.equal(interrupted.prepare('SELECT count(*) count FROM fx_artifact_registry').get().count, 0);
    } finally {
      interrupted.close();
    }
    const recovered = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
    }).materializeArtifact(request());
    assert.equal(recovered.replayed, false);
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    assert.deepEqual(fs.readFileSync(target), request().bytes);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare(
        'SELECT state,output_digest FROM fx_effect_journal'
      ).get(), {
        state: 'committed',
        output_digest: recovered.artifactHandle.digestHex,
      });
      assert.equal(database.prepare('SELECT count(*) count FROM fx_workspace_materials').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM fx_artifact_registry').get().count, 1);
    } finally {
      database.close();
    }
  }));

test('same stable target identity with different bytes fails without a second effect', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    port.materializeArtifact(request());
    assert.throws(
      () => port.materializeArtifact(request(Buffer.from('<movie><title>Changed</title></movie>'))),
      (error) => error.code === 'CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT',
    );
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare(
        'SELECT count(*) count FROM fx_effect_journal'
      ).get().count, 1);
    } finally {
      database.close();
    }
  }));

test('intended physical reality rejects recomputed bytes under the same stable effect', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const original = request();
    const crashing = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
      afterPhysicalEffect() {
        throw new Error('fault-after-stable-effect-bytes');
      },
    });
    assert.throws(
      () => crashing.materializeArtifact(original),
      /fault-after-stable-effect-bytes/,
    );
    const restarted = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
    });
    assert.throws(
      () => restarted.materializeArtifact(request(
        Buffer.from('<movie><title>Different recomputation</title></movie>'),
      )),
      (error) => error.code === 'CLEAN_WORKSPACE_EFFECT_OUTPUT_DRIFT',
    );
    const target = path.join(
      workspaceRoot,
      original.workspaceId,
      'artifacts',
      'movie.nfo',
    );
    assert.deepEqual(fs.readFileSync(target), original.bytes);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare(
        'SELECT count(*) count,min(state) state FROM fx_effect_journal'
      ).get(), { count: 1, state: 'intended' });
    } finally {
      database.close();
    }
  }));

test('frame sink journals stable target identity before accepting real member bytes', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
    });
    const sink = port.openFrameCompositeSink(frameRequest());
    const before = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(before.prepare(
        'SELECT state,output_digest FROM fx_effect_journal'
      ).get(), { state: 'intended', output_digest: null });
    } finally {
      before.close();
    }
    const frame0 = Buffer.from('actual-frame-zero');
    const frame1 = Buffer.from('actual-frame-one');
    sink.writeFrame({ timestampMs: 0, bytes: frame0 });
    sink.writeFrame({ timestampMs: 10_000, bytes: frame1 });
    const committed = sink.commit();
    const recovered = port.readArtifactBytes(
      committed.materialized.artifactHandle,
    );
    const composite = JSON.parse(recovered.bytes.toString('utf8'));
    assert.equal(composite.members.length, 2);
    assert.deepEqual(
      composite.memberPayloads.map((item) =>
        Buffer.from(item.bytesBase64, 'base64')),
      [frame0, frame1],
    );
    assert.equal(
      committed.materialized.artifactHandle.digestHex,
      require('node:crypto').createHash('sha256')
        .update(recovered.bytes).digest('hex'),
    );
    assert.equal(
      composite.frameMemberSetDigest,
      canonicalDigest({
        schema: 'libra.western-frame-member-set@1',
        items: composite.members,
      }),
    );
  }));

function durableRootAfterRevision(first, configRevision) {
  const rootHandleRef = canonicalDigest({
    schema: 'platform.workspace-root-handle@1',
    rootId: first.rootId,
    endpointId: first.endpointId,
    mountScopeId: first.mountScopeId,
    mountScopeRevision: first.mountScopeRevision,
    configRevision,
    capabilityDigest: first.capabilityDigest,
  });
  const snapshotDigest = canonicalDigest({
    rootId: first.rootId,
    ownerScope: 'libra',
    rootKind: 'production-workspace',
    endpointId: first.endpointId,
    mountScopeId: first.mountScopeId,
    mountScopeRevision: first.mountScopeRevision,
    configRevision,
    capabilityDigest: first.capabilityDigest,
    state: 'active',
    rootHandleRef,
  });
  return { rootHandleRef, snapshotDigest };
}

test('durable config revision 2 stamps and losslessly restamps Workspace material handles', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const firstRoot = port.rootSnapshot();
    const first = port.materializeArtifact(request());
    assert.equal(first.workspaceMaterialHandle.rootHandleRef, firstRoot.rootHandleRef);
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    const originalBytes = fs.readFileSync(target);
    const originalHandleId = first.workspaceMaterialHandle.handleId;
    const originalDigest = first.workspaceMaterialHandle.digestHex;
    const bumped = durableRootAfterRevision(firstRoot, 2);
    const seed = new Database(databasePath);
    seed.prepare(`UPDATE platform_workspace_roots
      SET config_revision=2, root_handle_ref=?, snapshot_digest=?
      WHERE root_id=?`).run(bumped.rootHandleRef, bumped.snapshotDigest, firstRoot.rootId);
    seed.close();
    const restarted = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const durable = restarted.rootSnapshot();
    assert.equal(durable.configRevision, 2);
    assert.equal(durable.rootHandleRef, bumped.rootHandleRef);
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database.prepare(
        'SELECT root_handle_ref, handle_digest, material_handle_id, digest_hex FROM fx_workspace_materials',
      ).get();
      assert.equal(row.root_handle_ref, durable.rootHandleRef);
      assert.equal(row.material_handle_id, originalHandleId);
      assert.equal(row.digest_hex, originalDigest);
    } finally {
      database.close();
    }
    assert.deepEqual(fs.readFileSync(target), originalBytes);
    const replay = restarted.materializeArtifact(request());
    assert.equal(replay.replayed, true);
    assert.equal(replay.workspaceMaterialHandle.rootHandleRef, durable.rootHandleRef);
    assert.equal(replay.workspaceMaterialHandle.handleId, originalHandleId);
    const extra = restarted.materializeArtifact({
      ...request(),
      relativePath: 'artifacts/poster.jpg',
      artifactKind: 'poster',
      mediaType: 'image/jpeg',
      bytes: Buffer.from('poster-bytes'),
    });
    assert.equal(extra.replayed, false);
    assert.equal(extra.workspaceMaterialHandle.rootHandleRef, durable.rootHandleRef);
  }));

test('durable filesystem bind restamps endpoint and mount without rewriting bytes', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const firstRoot = port.rootSnapshot();
    const first = port.materializeArtifact(request());
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    const originalBytes = fs.readFileSync(target);
    const reboundEndpoint = 'local-filesystem-linux';
    const reboundMount = 'local-mount-test-bind';
    const rootHandleRef = canonicalDigest({
      schema: 'platform.workspace-root-handle@1',
      rootId: firstRoot.rootId,
      endpointId: reboundEndpoint,
      mountScopeId: reboundMount,
      mountScopeRevision: firstRoot.mountScopeRevision,
      configRevision: 2,
      capabilityDigest: firstRoot.capabilityDigest,
    });
    const snapshotDigest = canonicalDigest({
      rootId: firstRoot.rootId,
      ownerScope: 'libra',
      rootKind: 'production-workspace',
      endpointId: reboundEndpoint,
      mountScopeId: reboundMount,
      mountScopeRevision: firstRoot.mountScopeRevision,
      configRevision: 2,
      capabilityDigest: firstRoot.capabilityDigest,
      state: 'active',
      rootHandleRef,
    });
    const seed = new Database(databasePath);
    seed.prepare(`UPDATE platform_workspace_roots
      SET config_revision=2, endpoint_id=?, mount_scope_id=?, root_handle_ref=?, snapshot_digest=?
      WHERE root_id=?`).run(
      reboundEndpoint, reboundMount, rootHandleRef, snapshotDigest, firstRoot.rootId,
    );
    seed.close();
    const restarted = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const durable = restarted.rootSnapshot();
    assert.equal(durable.endpointId, reboundEndpoint);
    assert.equal(durable.mountScopeId, reboundMount);
    const row = new Database(databasePath, { readonly: true });
    try {
      const material = row.prepare(
        'SELECT endpoint_id, mount_scope_id, digest_hex FROM fx_workspace_materials',
      ).get();
      assert.equal(material.endpoint_id, reboundEndpoint);
      assert.equal(material.mount_scope_id, reboundMount);
      assert.equal(material.digest_hex, first.workspaceMaterialHandle.digestHex);
    } finally {
      row.close();
    }
    assert.deepEqual(fs.readFileSync(target), originalBytes);
    const replay = restarted.materializeArtifact(request());
    assert.equal(replay.replayed, true);
    assert.equal(replay.workspaceMaterialHandle.endpointId, reboundEndpoint);
    assert.equal(replay.workspaceMaterialHandle.physicalIdentity.mountScopeId, reboundMount);
  }));

test('unreferenced leftover Workspace materials are deleted and marked reclaimed', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({
      ...dependencies, rootPath: workspaceRoot, now: () => 1_700_000_100_000,
    });
    const first = port.materializeArtifact(request());
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    assert.equal(fs.existsSync(target), true);
    const result = port.reclaimUnreferencedWorkspace(request().workspaceId);
    assert.equal(result.reclaimedCount, 1);
    assert.equal(result.directoryRemoved, true);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, request().workspaceId)), false);
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database.prepare(
        'SELECT state, reclaimed_at_ms FROM fx_workspace_materials WHERE material_handle_id=?',
      ).get(first.workspaceMaterialHandle.handleId);
      assert.equal(row.state, 'reclaimed');
      assert.equal(Number(row.reclaimed_at_ms), 1_700_000_100_000);
    } finally {
      database.close();
    }
    const replay = port.reclaimUnreferencedWorkspace(request().workspaceId);
    assert.equal(replay.reclaimedCount, 0);
    assert.equal(replay.directoryRemoved, false);
  }));

