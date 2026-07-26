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

test('same path with different bytes is a separate fenced intent and fails on occupied reality', () =>
  fixture(({ workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    port.materializeArtifact(request());
    assert.throws(
      () => port.materializeArtifact(request(Buffer.from('<movie><title>Changed</title></movie>'))),
      (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        error.code === 'CLEAN_WORKSPACE_EFFECT_STATE_CONFLICT',
    );
  }));
