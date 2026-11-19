'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } = require('../src/helix/integrations/bounded-material-fingerprint');
const {
  CONFIRM, explainAftercareRootAdmission, migrateWorkspaceDisk,
} = require('../scripts/workspace-disk-migration');

function schema(database) {
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE platform_mount_scope_revisions (
      mount_scope_id TEXT,
      revision INTEGER CHECK (revision >= 1),
      endpoint_id TEXT,
      mount_boundary TEXT,
      filesystem_type TEXT,
      stable_mount_fingerprint TEXT,
      inode_capability_digest TEXT,
      probe_evidence_digest TEXT,
      effective_at_ms INTEGER,
      PRIMARY KEY (mount_scope_id, revision),
      FOREIGN KEY (mount_scope_id) REFERENCES platform_mount_scopes (mount_scope_id) ON DELETE RESTRICT
    );
    CREATE TABLE platform_mount_scopes (
      mount_scope_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      current_revision INTEGER CHECK (current_revision >= 1),
      created_at_ms INTEGER NOT NULL,
      terminal_at_ms INTEGER,
      FOREIGN KEY (mount_scope_id, current_revision) REFERENCES platform_mount_scope_revisions (mount_scope_id, revision) ON DELETE RESTRICT
    );
    CREATE TABLE platform_workspace_roots (root_id TEXT PRIMARY KEY, owner_scope TEXT, root_kind TEXT, endpoint_id TEXT, mount_scope_id TEXT, mount_scope_revision INTEGER, resolved_root TEXT, config_revision INTEGER, capability_digest TEXT, state TEXT, root_handle_ref TEXT, snapshot_digest TEXT, updated_at_ms INTEGER);
    CREATE TABLE fx_workspace_registry (workspace_id TEXT PRIMARY KEY, owner_domain TEXT, process_type TEXT, process_id TEXT, root_handle_ref TEXT, state TEXT, created_at_ms INTEGER, reclaim_after_ms INTEGER, reclaimed_at_ms INTEGER);
    CREATE TABLE fx_workspace_materials (
      workspace_id TEXT, material_handle_id TEXT, material_key TEXT, endpoint_id TEXT, mount_scope_id TEXT, inode TEXT, fingerprint_algorithm TEXT, fingerprint_version TEXT, content_fingerprint TEXT, relative_path TEXT, digest_algorithm TEXT, digest_hex TEXT, size_bytes INTEGER, reference_revision INTEGER, owner_domain TEXT, process_id TEXT, root_handle_ref TEXT, access_scope TEXT, handle_schema_ref TEXT, handle_json TEXT, handle_digest TEXT, fence_digest TEXT, state TEXT,
      PRIMARY KEY (workspace_id, material_handle_id),
      FOREIGN KEY (workspace_id) REFERENCES fx_workspace_registry (workspace_id) ON DELETE RESTRICT
    );
    CREATE TABLE arca_aftercare_cases (aftercare_case_id TEXT PRIMARY KEY, state TEXT, case_generation INTEGER);
  `);
}

function identityKey(identity) {
  return canonicalDigest({ schema: 'physical-material-identity@2', ...identity });
}

function handleFor({ workspaceId, relativePath, identity, rootHandleRef, endpointId }) {
  const body = {
    schemaRef: 'helix://contracts/types/WorkspaceMaterialHandle/v1', schemaVersion: 1,
    handleId: `handle-${workspaceId}-${relativePath}`, workspaceId, ownerDomain: 'arca', processId: workspaceId,
    endpointId, rootHandleRef, materialKey: identityKey(identity), physicalIdentity: identity,
    relativePath, digestAlgorithm: 'sha256', digestHex: identity.contentFingerprint, sizeBytes: identity.sizeBytes,
    referenceRevision: 1, accessScope: 'workspace',
  };
  const fenceDigest = canonicalDigest(body);
  const handle = { ...body, fenceDigest };
  return { handle, handleJson: canonicalJson(handle), handleDigest: canonicalDigest(handle), fenceDigest };
}

function seed(t, { missing = false, badDigest = false, extraKey = false } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-disk-migration-'));
  const dataDir = path.join(rootDir, 'data');
  const aftercare = path.join(dataDir, 'workspaces', 'aftercare');
  const activeId = 'arca-care-active';
  const libraId = 'arca-care-libra';
  const reclaimedId = 'arca-care-reclaimed';
  fs.mkdirSync(path.join(aftercare, activeId), { recursive: true });
  fs.mkdirSync(path.join(aftercare, libraId), { recursive: true });
  fs.mkdirSync(path.join(aftercare, reclaimedId), { recursive: true });
  const activeFile = path.join(aftercare, activeId, 'note.txt');
  const libraFile = path.join(aftercare, libraId, 'other.txt');
  fs.writeFileSync(activeFile, 'aftercare-bytes');
  fs.writeFileSync(libraFile, 'libra-scope-bytes');
  const activeObserved = computeBoundedMaterialFingerprintSync(activeFile);
  const libraObserved = computeBoundedMaterialFingerprintSync(libraFile);
  const database = new Database(path.join(dataDir, 'shelfdeck.db'));
  schema(database);
  const capability = canonicalDigest({ schema: 'platform.local-aftercare-workspace-capability@1', operations: ['atomic_replace', 'read', 'stat', 'bounded_member_reclaim'] });
  const oldScope = 'local-mount-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const libraScope = 'local-mount-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const oldHandle = canonicalDigest({ schema: 'platform.workspace-root-handle@1', rootId: 'service-arca-aftercare-workspace', endpointId: 'local-filesystem-linux', mountScopeId: oldScope, mountScopeRevision: 1, configRevision: 1, capabilityDigest: capability });
  const snapshot = canonicalDigest({ rootId: 'service-arca-aftercare-workspace', ownerScope: 'arca', rootKind: 'aftercare-workspace', endpointId: 'local-filesystem-linux', mountScopeId: oldScope, mountScopeRevision: 1, configRevision: 1, capabilityDigest: capability, state: 'active', rootHandleRef: oldHandle });
  database.prepare('INSERT INTO platform_mount_scopes VALUES (?, ?, NULL, ?, NULL)').run(oldScope, 'active', 1);
  database.prepare('INSERT INTO platform_mount_scopes VALUES (?, ?, NULL, ?, NULL)').run(libraScope, 'active', 1);
  database.prepare(`INSERT INTO platform_mount_scope_revisions VALUES (?, 1, 'local-filesystem-linux', '/old/btrfs', 'btrfs', ?, 'inode', 'probe', 1)`).run(oldScope, 'b'.repeat(64));
  database.prepare(`INSERT INTO platform_mount_scope_revisions VALUES (?, 1, 'local-filesystem-linux', '/old/libra', 'btrfs', ?, 'inode', 'probe', 1)`).run(libraScope, 'a'.repeat(64));
  database.prepare('UPDATE platform_mount_scopes SET current_revision = 1 WHERE mount_scope_id IN (?, ?)').run(oldScope, libraScope);
  database.prepare(`INSERT INTO platform_workspace_roots VALUES ('service-arca-aftercare-workspace', 'arca', 'aftercare-workspace', 'local-filesystem-linux', ?, 1, ?, 1, ?, 'active', ?, ?, 1)`).run(oldScope, aftercare, capability, oldHandle, snapshot);
  const insertRegistry = database.prepare('INSERT INTO fx_workspace_registry VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertRegistry.run(activeId, 'arca', 'aftercare_case', activeId, oldHandle, 'active', 10, null, null);
  insertRegistry.run(libraId, 'arca', 'aftercare_case', libraId, oldHandle, 'active', 11, 99, null);
  insertRegistry.run(reclaimedId, 'arca', 'aftercare_case', reclaimedId, oldHandle, 'reclaimed', 12, 50, 60);
  insertRegistry.run('series-old', 'arca', 'series_presentation', 'series-old', oldHandle, 'reclaimed', 13, null, 70);
  database.prepare('INSERT INTO arca_aftercare_cases VALUES (?, ?, 1)').run(activeId, 'active');
  database.prepare('INSERT INTO arca_aftercare_cases VALUES (?, ?, 1)').run(libraId, 'unresolved');
  function addMaterial(workspaceId, relativePath, observed, mountScopeId, digestOverride) {
    const identity = {
      mountScopeId, inode: '111', sizeBytes: Number(observed.stat.size), fingerprintAlgorithm: 'middle-256k-sha256',
      fingerprintVersion: 1, contentFingerprint: digestOverride || observed.contentFingerprint,
    };
    const built = handleFor({ workspaceId, relativePath, identity, rootHandleRef: oldHandle, endpointId: 'local-filesystem-linux' });
    database.prepare(`INSERT INTO fx_workspace_materials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(
      workspaceId, built.handle.handleId, built.handle.materialKey, 'local-filesystem-linux', mountScopeId, '111',
      'middle-256k-sha256', '1', identity.contentFingerprint, relativePath, 'sha256', identity.contentFingerprint,
      identity.sizeBytes, 1, 'arca', workspaceId, oldHandle, 'workspace', built.handle.schemaRef, built.handleJson,
      built.handleDigest, built.fenceDigest);
    return built.handle.materialKey;
  }
  const activeKey = addMaterial(activeId, 'note.txt', activeObserved, oldScope, badDigest ? '0'.repeat(64) : null);
  addMaterial(libraId, missing ? 'absent.txt' : 'other.txt', libraObserved, libraScope);
  if (extraKey) {
    database.exec('CREATE TABLE other_domain_materials (material_key TEXT)');
    database.prepare('INSERT INTO other_domain_materials VALUES (?)').run(activeKey);
  }
  t.after(() => { database.close(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  return { database, dataDir, aftercare, oldScope, libraScope, oldHandle, activeId, libraId, reclaimedId };
}

test('current image admission conflicts when the probed mount is not the stored btrfs scope', (t) => {
  const fixture = seed(t);
  const stored = fixture.database.prepare('SELECT * FROM platform_workspace_roots').get();
  const admission = explainAftercareRootAdmission(stored, {
    resolvedRoot: stored.resolved_root, endpointId: 'local-filesystem-linux', mountScopeId: 'local-mount-new', mountScopeRevision: 1,
  });
  assert.equal(admission.conflict, true);
});

test('dry-run lists the active closure and does not write business rows', (t) => {
  const fixture = seed(t);
  const before = fixture.database.prepare('SELECT COUNT(*) AS n FROM platform_mount_scopes').get().n;
  const receipt = migrateWorkspaceDisk(fixture.database, { dataDir: fixture.dataDir });
  assert.equal(receipt.mode, 'dry-run');
  assert.equal(receipt.changed, false);
  assert.equal(receipt.materials.length, 2);
  assert.equal(receipt.materials.some((item) => item.previousMountScopeId === fixture.libraScope), true);
  assert.equal(receipt.historicalReferences.some((item) => item.processType === 'series_presentation' && item.updated === false), true);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS n FROM platform_mount_scopes').get().n, before);
  assert.equal(fixture.database.prepare('SELECT root_handle_ref FROM platform_workspace_roots').get().root_handle_ref, fixture.oldHandle);
});

test('apply rebinds active workspace references to the probed mount and preserves business state', (t) => {
  const fixture = seed(t);
  const receipt = migrateWorkspaceDisk(fixture.database, { dataDir: fixture.dataDir, apply: true, confirm: CONFIRM, now: () => 500 });
  assert.equal(receipt.mode, 'applied');
  const stored = fixture.database.prepare('SELECT * FROM platform_workspace_roots').get();
  const live = { resolvedRoot: stored.resolved_root, endpointId: stored.endpoint_id, mountScopeId: stored.mount_scope_id, mountScopeRevision: stored.mount_scope_revision };
  assert.equal(explainAftercareRootAdmission(stored, live).conflict, false);
  assert.notEqual(stored.mount_scope_id, fixture.oldScope);
  assert.equal(fixture.database.prepare('SELECT filesystem_type FROM platform_mount_scope_revisions WHERE mount_scope_id=?').get(fixture.oldScope).filesystem_type, 'btrfs');
  const libraMaterial = fixture.database.prepare('SELECT mount_scope_id, content_fingerprint, state, handle_json FROM fx_workspace_materials WHERE workspace_id=?').get(fixture.libraId);
  const rebound = JSON.parse(libraMaterial.handle_json);
  const unsigned = { ...rebound };
  delete unsigned.fenceDigest;
  assert.equal(rebound.fenceDigest, canonicalDigest(unsigned));
  assert.equal(rebound.physicalIdentity.mountScopeId, stored.mount_scope_id);
  assert.equal(libraMaterial.mount_scope_id, stored.mount_scope_id);
  assert.equal(libraMaterial.state, 'active');
  assert.equal(fixture.database.prepare('SELECT state, reclaim_after_ms FROM fx_workspace_registry WHERE workspace_id=?').get(fixture.libraId).reclaim_after_ms, 99);
  assert.equal(fixture.database.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(fixture.libraId).state, 'unresolved');
  assert.equal(fixture.database.prepare('SELECT state, root_handle_ref FROM fx_workspace_registry WHERE workspace_id=?').get(fixture.reclaimedId).state, 'reclaimed');
  assert.equal(fixture.database.prepare('SELECT root_handle_ref FROM fx_workspace_registry WHERE workspace_id=?').get(fixture.reclaimedId).root_handle_ref, fixture.oldHandle);
  const again = migrateWorkspaceDisk(fixture.database, { dataDir: fixture.dataDir, apply: true, confirm: CONFIRM, now: () => 900 });
  assert.equal(again.mode, 'already-applied');
  assert.equal(fixture.database.prepare('SELECT config_revision FROM platform_workspace_roots').get().config_revision, stored.config_revision);
});

test('a commit failure leaves the database unchanged', (t) => {
  const fixture = seed(t);
  assert.throws(() => migrateWorkspaceDisk(fixture.database, {
    dataDir: fixture.dataDir, apply: true, confirm: CONFIRM, now: () => 5,
    beforeCommit() { throw new Error('injected'); },
  }), /injected/);
  assert.equal(fixture.database.prepare('SELECT root_handle_ref FROM platform_workspace_roots').get().root_handle_ref, fixture.oldHandle);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS n FROM platform_mount_scopes').get().n, 2);
});

test('missing file, content mismatch, unknown dependency, frozen path, and busy database fail closed', (t) => {
  const missing = seed(t, { missing: true });
  assert.throws(() => migrateWorkspaceDisk(missing.database, { dataDir: missing.dataDir }), { code: 'WORKSPACE_DISK_MIGRATION_MISSING_FILE' });
  const mismatch = seed(t, { badDigest: true });
  assert.throws(() => migrateWorkspaceDisk(mismatch.database, { dataDir: mismatch.dataDir }), { code: 'WORKSPACE_DISK_MIGRATION_CONTENT_MISMATCH' });
  const extra = seed(t, { extraKey: true });
  assert.throws(() => migrateWorkspaceDisk(extra.database, { dataDir: extra.dataDir }), { code: 'WORKSPACE_DISK_MIGRATION_UNKNOWN_DEPENDENCY' });
  assert.throws(() => migrateWorkspaceDisk(extra.database, { dataDir: path.join(extra.dataDir, 'frozen'), apply: true, confirm: CONFIRM }), { code: 'WORKSPACE_DISK_MIGRATION_FROZEN_PATH' });
  const held = seed(t);
  held.database.pragma('busy_timeout = 0');
  const lock = new Database(path.join(held.dataDir, 'shelfdeck.db'));
  lock.pragma('busy_timeout = 0');
  lock.exec('BEGIN IMMEDIATE');
  t.after(() => lock.close());
  assert.throws(() => migrateWorkspaceDisk(held.database, { dataDir: held.dataDir, apply: true, confirm: CONFIRM, now: () => 5 }), /locked|busy/i);
});

test('full-file SHA-256 rejects bytes outside the middle sample', (t) => {
  const fixture = seed(t);
  const relative = 'wide.bin';
  const file = path.join(fixture.aftercare, fixture.activeId, relative);
  const bytes = Buffer.alloc(300000, 7);
  fs.writeFileSync(file, bytes);
  const observed = computeBoundedMaterialFingerprintSync(file);
  const full = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.notEqual(observed.contentFingerprint, full);
  const identity = {
    mountScopeId: fixture.oldScope, inode: '111', sizeBytes: bytes.length, fingerprintAlgorithm: 'middle-256k-sha256',
    fingerprintVersion: 1, contentFingerprint: observed.contentFingerprint,
  };
  const built = handleFor({ workspaceId: fixture.activeId, relativePath: relative, identity, rootHandleRef: fixture.oldHandle, endpointId: 'local-filesystem-linux' });
  fixture.database.prepare(`INSERT INTO fx_workspace_materials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(
    fixture.activeId, built.handle.handleId, built.handle.materialKey, 'local-filesystem-linux', fixture.oldScope, '111',
    'middle-256k-sha256', '1', identity.contentFingerprint, relative, 'sha256', full, bytes.length, 1, 'arca', fixture.activeId,
    fixture.oldHandle, 'workspace', built.handle.schemaRef, built.handleJson, built.handleDigest, built.fenceDigest);
  bytes[0] = 9;
  fs.writeFileSync(file, bytes);
  assert.equal(computeBoundedMaterialFingerprintSync(file).contentFingerprint, observed.contentFingerprint);
  assert.throws(() => migrateWorkspaceDisk(fixture.database, { dataDir: fixture.dataDir }), { code: 'WORKSPACE_DISK_MIGRATION_CONTENT_MISMATCH' });
});
