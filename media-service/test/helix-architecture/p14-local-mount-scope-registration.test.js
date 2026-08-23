'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createLocationRegistryRepository } = require('../../src/helix/platform/persistence/location-registry-repository');
const {
  createLocalFilesystemMountScopeResolver,
} = require('../../src/helix/platform/application/local-filesystem-mount-scope-resolver');
const {
  createCleanLocalFilesystemMountProbe,
} = require('../../src/clean-local-filesystem-mount-probe');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-local-mount-scope-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1000 });
  t.after(() => {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repository = createLocationRegistryRepository({
    schemaManifest,
    unitOfWork: createSqliteUnitOfWork({ kernel }),
  });
  return { root, databasePath, repository };
}

test('Platform resolves every local root on one physical mount to one persisted Mount Scope', (t) => {
  const value = fixture(t);
  const fieldRoot = path.join(value.root, 'field');
  const shelfRoot = path.join(value.root, 'shelf');
  fs.mkdirSync(fieldRoot);
  fs.mkdirSync(shelfRoot);
  const probe = createCleanLocalFilesystemMountProbe();
  const first = createLocalFilesystemMountScopeResolver({ repository:value.repository,
    inspectRoot:(rootLocation) => probe.inspectRoot(rootLocation), now:() => 1001 });
  const field = first.resolveRoot({ rootLocation:fieldRoot });
  const shelf = first.resolveRoot({ rootLocation:shelfRoot });
  assert.equal(field.mountScopeId, shelf.mountScopeId);
  assert.equal(field.mountScopeRevision, 1);
  assert.equal(field.endpointId, shelf.endpointId);

  const restarted = createLocalFilesystemMountScopeResolver({ repository:value.repository,
    inspectRoot:(rootLocation) => probe.inspectRoot(rootLocation), now:() => 2000 });
  assert.deepEqual(restarted.resolveRoot({ rootLocation:fieldRoot }), field);
  assert.deepEqual(restarted.validateReference(field), field);

  const db = new Database(value.databasePath, { readonly:true });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM platform_mount_scopes').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM platform_mount_scope_revisions').get().count, 1);
  db.close();
});

test('Platform fail-closes an unregistered or mismatched configured Mount Scope', (t) => {
  const value = fixture(t);
  const mediaRoot = path.join(value.root, 'media');
  fs.mkdirSync(mediaRoot);
  const probe = createCleanLocalFilesystemMountProbe();
  const resolver = createLocalFilesystemMountScopeResolver({ repository:value.repository,
    inspectRoot:(rootLocation) => probe.inspectRoot(rootLocation), now:() => 1001 });
  const current = resolver.resolveRoot({ rootLocation:mediaRoot });
  assert.throws(() => resolver.validateReference({
    ...current,
    mountScopeId: 'local-mount-forged',
  }), (error) => error.code === 'HELIX_MOUNT_SCOPE_UNSAFE');
  assert.throws(() => resolver.validateReference({
    ...current,
    mountScopeRevision: 2,
  }), (error) => error.code === 'HELIX_MOUNT_SCOPE_UNSAFE');
});
