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
const { createCifsMountProbeCorrection } = require('../../src/helix/platform/application/cifs-mount-probe-correction');

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

function cifsProbe(state) {
  return createCleanLocalFilesystemMountProbe({ platform:'linux', pathApi:path.posix, fsApi: {
    realpathSync: (root) => root,
    statSync: () => ({ isDirectory: () => true, dev:81n, ino:100n, mtimeNs:1n, ctimeNs:1n }),
    readFileSync: () => `10 9 ${state.device} ${state.mountRoot || '/'} /media rw - ${state.type || 'cifs'} ${state.source || '//nas/Media'} rw,serverino`,
  } });
}

test('CIFS remount changes transient device number without changing stable mount identity', () => {
  const state = { device:'0:93' }, probe = cifsProbe(state);
  const before = probe.inspectRoot('/media/Film');
  state.device = '0:81';
  assert.deepEqual(probe.inspectRoot('/media/Film'), before);
  for (const replacement of [{ source:'//nas/Other' }, { source:'//other/Media' }, { mountRoot:'/subtree' }, { type:'ext4' }]) {
    Object.assign(state, replacement);
    assert.notEqual(probe.inspectRoot('/media/Film').stableMountFingerprint, before.stableMountFingerprint);
    delete state.source; delete state.mountRoot; delete state.type;
  }
});

test('Explicit CIFS correction preserves all Scope references and survives the next remount', (t) => {
  const value = fixture(t), state = { device:'0:93' }, probe = cifsProbe(state);
  const legacy = probe.inspectLegacyCifsRoot('/media/Film', '0:93');
  const mountScopeId = 'local-mount-' + legacy.stableMountFingerprint.slice(0, 32);
  const original = { mountScopeId, revision:1, endpointId:legacy.endpointId, mountBoundary:legacy.mountBoundary,
    filesystemType:legacy.filesystemType, stableMountFingerprint:legacy.stableMountFingerprint,
    inodeCapabilityDigest:legacy.inodeCapabilityDigest, probeEvidenceDigest:legacy.probeEvidenceDigest, effectiveAtMs:1001 };
  value.repository.publishMountScope(original, () => {});
  const reference = { endpointId:legacy.endpointId, rootLocation:'/media/Film', mountScopeId, mountScopeRevision:1 };
  const resolver = createLocalFilesystemMountScopeResolver({ repository:value.repository, inspectRoot:probe.inspectRoot });
  const service = createCifsMountProbeCorrection({ repository:value.repository, probe });
  const request = { mountScopeId, revision:1, rootLocation:'/media/Film', legacyDeviceIdentity:'0:93' };
  state.device = '0:81';
  assert.throws(() => resolver.validateReference(reference), { code:'HELIX_MOUNT_SCOPE_UNSAFE' });
  service.inspect(request);
  assert.deepEqual(value.repository.getMountScope(mountScopeId), original, 'dry run must not write');
  assert.throws(() => service.apply({ ...request, legacyDeviceIdentity:'0:92' }), { code:'HELIX_CIFS_PROBE_CORRECTION_INVALID' });
  assert.throws(() => service.apply({ ...request, revision:2 }), { code:'HELIX_CIFS_PROBE_CORRECTION_INVALID' });
  state.source = '//nas/Other';
  assert.throws(() => service.apply(request), { code:'HELIX_CIFS_PROBE_CORRECTION_INVALID' });
  delete state.source;
  state.mountRoot = '/subtree';
  assert.throws(() => service.apply(request), { code:'HELIX_CIFS_PROBE_CORRECTION_INVALID' });
  delete state.mountRoot;
  assert.deepEqual(value.repository.getMountScope(mountScopeId), original, 'invalid repair must not change evidence');
  const corrected = service.apply(request);
  assert.equal(corrected.after.mountScopeId, original.mountScopeId);
  assert.equal(corrected.after.revision, 1);
  assert.equal(corrected.after.effectiveAtMs, original.effectiveAtMs);
  assert.deepEqual(resolver.validateReference(reference), reference);
  assert.deepEqual(resolver.resolveRoot({ rootLocation:'/media/Film' }), reference);
  assert.deepEqual(service.apply(request).after, corrected.after, 'explicit repair is idempotent');
  state.device = '0:121';
  assert.deepEqual(resolver.validateReference(reference), reference);
  assert.deepEqual(resolver.resolveRoot({ rootLocation:'/media/Film' }), reference);
  state.source = '//nas/Other';
  assert.throws(() => resolver.validateReference(reference), { code:'HELIX_MOUNT_SCOPE_UNSAFE' });
  assert.throws(() => service.apply(request), { code:'HELIX_CIFS_PROBE_CORRECTION_INVALID' });
  const db = new Database(value.databasePath, { readonly:true });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM platform_mount_scopes').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM platform_mount_scope_revisions').get().count, 1);
  db.close();
});
