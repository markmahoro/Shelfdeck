'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { createCleanLocalFilesystemMountProbe } = require('../src/clean-local-filesystem-mount-probe');
const { computeBoundedMaterialFingerprintSync } = require('../src/helix/integrations/bounded-material-fingerprint');

const ROOT_ID = 'service-arca-aftercare-workspace';
const CONFIRM = 'APPLY_WORKSPACE_DISK_MIGRATION_V1';
const RECEIPT_SCHEMA = 'platform.workspace-disk-migration@1';

class WorkspaceDiskMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceDiskMigrationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkspaceDiskMigrationError(code, message, details);
}

function capabilityDigest() {
  return canonicalDigest({
    schema: 'platform.local-aftercare-workspace-capability@1',
    operations: ['atomic_replace', 'read', 'stat', 'bounded_member_reclaim'],
  });
}

function rootHandle(rootId, endpointId, mountScopeId, mountScopeRevision, configRevision, digest = capabilityDigest()) {
  return canonicalDigest({
    schema: 'platform.workspace-root-handle@1',
    rootId, endpointId, mountScopeId, mountScopeRevision, configRevision, capabilityDigest: digest,
  });
}

function rootSnapshotDigest(root, endpointId, mountScopeId, mountScopeRevision, configRevision, handle) {
  return canonicalDigest({
    rootId: root.root_id, ownerScope: root.owner_scope, rootKind: root.root_kind, endpointId,
    mountScopeId, mountScopeRevision, configRevision, capabilityDigest: capabilityDigest(),
    state: 'active', rootHandleRef: handle,
  });
}

function explainAftercareRootAdmission(stored, live) {
  const rootChanged = stored.resolved_root !== live.resolvedRoot;
  const configRevision = Number(stored.config_revision) + (rootChanged ? 1 : 0);
  const handle = rootHandle(stored.root_id, live.endpointId, live.mountScopeId, live.mountScopeRevision, configRevision);
  const snapshotDigest = rootSnapshotDigest(stored, live.endpointId, live.mountScopeId, live.mountScopeRevision, configRevision, handle);
  const conflict = stored.owner_scope !== 'arca' || stored.root_kind !== 'aftercare-workspace' ||
    stored.resolved_root !== live.resolvedRoot || stored.endpoint_id !== live.endpointId ||
    stored.mount_scope_id !== live.mountScopeId || Number(stored.mount_scope_revision) !== Number(live.mountScopeRevision) ||
    stored.root_handle_ref !== handle || stored.snapshot_digest !== snapshotDigest || stored.state !== 'active';
  return Object.freeze({ conflict, configRevision, rootHandleRef: handle, snapshotDigest });
}

function assertNotFrozen(dataDir) {
  const resolved = path.resolve(dataDir);
  const parts = resolved.split(path.sep);
  if (parts.includes('frozen') || parts.includes('coldbackup') || resolved.includes(`${path.sep}frozen${path.sep}`)) {
    fail('WORKSPACE_DISK_MIGRATION_FROZEN_PATH', 'Workspace disk migration refuses a frozen or cold-backup database path.');
  }
}

function assertSafeRelative(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    fail('WORKSPACE_DISK_MIGRATION_UNSAFE_PATH', 'Workspace member path is not a relative path.');
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail('WORKSPACE_DISK_MIGRATION_UNSAFE_PATH', 'Workspace member path is not contained by its workspace.');
  }
  return parts;
}

function memberLocation(root, workspaceId, relativePath) {
  const parts = assertSafeRelative(relativePath);
  const workspaceRoot = path.resolve(root, workspaceId);
  const target = path.resolve(workspaceRoot, ...parts);
  const suffix = path.relative(workspaceRoot, target);
  if (suffix === '' || suffix.startsWith(`..${path.sep}`) || suffix === '..' || path.isAbsolute(suffix)) {
    fail('WORKSPACE_DISK_MIGRATION_UNSAFE_PATH', 'Workspace member path escaped its workspace.');
  }
  return { workspaceRoot, target };
}

function materialIdentityKey(identity) {
  return canonicalDigest({
    schema: 'physical-material-identity@2',
    mountScopeId: identity.mountScopeId,
    inode: identity.inode,
    sizeBytes: identity.sizeBytes,
    fingerprintAlgorithm: identity.fingerprintAlgorithm,
    fingerprintVersion: identity.fingerprintVersion,
    contentFingerprint: identity.contentFingerprint,
  });
}

function rewriteHandle(handle, { rootHandleRef, endpointId, mountScopeId, inode }) {
  const next = {
    ...handle,
    endpointId,
    rootHandleRef,
    materialKey: materialIdentityKey({ ...handle.physicalIdentity, mountScopeId, inode }),
    physicalIdentity: { ...handle.physicalIdentity, mountScopeId, inode },
  };
  delete next.fenceDigest;
  const fenceDigest = canonicalDigest(next);
  const withFence = { ...next, fenceDigest };
  return { handle: withFence, handleJson: canonicalJson(withFence), handleDigest: canonicalDigest(withFence), fenceDigest };
}

function fullContentSha256(location) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(location, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      position += read;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function inspectMember(root, row, fingerprint) {
  const { target } = memberLocation(root, row.workspace_id, row.relative_path);
  let listed;
  try { listed = fs.lstatSync(target); }
  catch (error) {
    if (error.code === 'ENOENT') fail('WORKSPACE_DISK_MIGRATION_MISSING_FILE', 'Workspace member file is missing.', { handleId: row.material_handle_id });
    throw error;
  }
  if (listed.isSymbolicLink() || !listed.isFile()) {
    fail('WORKSPACE_DISK_MIGRATION_UNSAFE_PATH', 'Workspace member is not a regular file.', { handleId: row.material_handle_id });
  }
  if (fs.realpathSync(target) !== path.resolve(target)) {
    fail('WORKSPACE_DISK_MIGRATION_UNSAFE_PATH', 'Workspace member resolves through another path.', { handleId: row.material_handle_id });
  }
  const observed = fingerprint(target);
  const sizeBytes = Number(observed.stat.size);
  if (sizeBytes !== Number(row.size_bytes)) {
    fail('WORKSPACE_DISK_MIGRATION_CONTENT_MISMATCH', 'Workspace member size does not match its durable record.', { handleId: row.material_handle_id });
  }
  if (observed.contentFingerprint !== row.content_fingerprint || observed.fingerprintAlgorithm !== 'middle-256k-sha256') {
    fail('WORKSPACE_DISK_MIGRATION_CONTENT_MISMATCH', 'Workspace member content fingerprint does not match its durable record.', { handleId: row.material_handle_id });
  }
  const fullSha256 = fullContentSha256(target);
  if (sizeBytes <= 262144 && observed.contentFingerprint !== fullSha256) {
    fail('WORKSPACE_DISK_MIGRATION_CONTENT_MISMATCH', 'A workspace member small enough to be fully sampled does not match its full-file SHA-256.', { handleId: row.material_handle_id });
  }
  if (row.digest_algorithm === 'sha256' && /^[0-9a-f]{64}$/.test(row.digest_hex || '') && row.digest_hex !== fullSha256) {
    fail('WORKSPACE_DISK_MIGRATION_CONTENT_MISMATCH', 'Workspace member full-file SHA-256 does not match its stored digest.', { handleId: row.material_handle_id });
  }
  return { inode: String(observed.stat.ino), sizeBytes, contentFingerprint: observed.contentFingerprint, fullContentSha256: fullSha256 };
}

function scopeIdFor(probe) {
  return `local-mount-${probe.stableMountFingerprint.slice(0, 32)}`;
}

function readScope(database, mountScopeId) {
  return database.prepare(`SELECT r.* FROM platform_mount_scopes h
    JOIN platform_mount_scope_revisions r ON r.mount_scope_id=h.mount_scope_id AND r.revision=h.current_revision
    WHERE h.mount_scope_id=? AND h.status='active'`).get(mountScopeId);
}

function sameProbe(scope, probe) {
  return scope && scope.endpoint_id === probe.endpointId && scope.mount_boundary === probe.mountBoundary &&
    scope.filesystem_type === probe.filesystemType && scope.stable_mount_fingerprint === probe.stableMountFingerprint &&
    scope.inode_capability_digest === probe.inodeCapabilityDigest && scope.probe_evidence_digest === probe.probeEvidenceDigest &&
    Number(scope.revision) === 1;
}

function otherMaterialKeyHits(database, keys) {
  if (!keys.length) return [];
  const hits = [];
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const table of tables) {
    if (table.name === 'fx_workspace_materials') continue;
    const columns = database.prepare(`PRAGMA table_info(${table.name})`).all();
    if (!columns.some((column) => column.name === 'material_key')) continue;
    const found = database.prepare(`SELECT COUNT(*) AS n FROM ${table.name} WHERE material_key IN (${keys.map(() => '?').join(',')})`).get(...keys).n;
    if (found) hits.push({ table: table.name, count: found });
  }
  return hits;
}

function migrateWorkspaceDisk(database, options = {}) {
  const dataDir = options.dataDir;
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
    fail('WORKSPACE_DISK_MIGRATION_DATA_DIR', 'An absolute data directory is required.');
  }
  assertNotFrozen(dataDir);
  const now = options.now || Date.now;
  const probeRoot = options.probe || ((location) => createCleanLocalFilesystemMountProbe().inspectRoot(location));
  const fingerprint = options.fingerprint || computeBoundedMaterialFingerprintSync;
  const root = database.prepare('SELECT * FROM platform_workspace_roots WHERE root_id=?').get(ROOT_ID);
  if (!root || root.state !== 'active') fail('WORKSPACE_DISK_MIGRATION_ROOT_MISSING', 'Active Aftercare workspace root is missing.');
  if (root.capability_digest !== capabilityDigest()) {
    fail('WORKSPACE_DISK_MIGRATION_CAPABILITY_MISMATCH', 'Stored Aftercare capability digest is not the runtime constant.');
  }
  if (root.resolved_root !== path.resolve(root.resolved_root) || !root.resolved_root.startsWith(`${path.resolve(dataDir)}${path.sep}`)) {
    fail('WORKSPACE_DISK_MIGRATION_ROOT_OUTSIDE_DATA', 'Aftercare root is not inside the supplied data directory.');
  }
  const probed = probeRoot(root.resolved_root);
  const targetScopeId = scopeIdFor(probed);
  const existingTarget = readScope(database, targetScopeId);
  if (existingTarget && !sameProbe(existingTarget, probed)) {
    fail('WORKSPACE_DISK_MIGRATION_TARGET_SCOPE_CONFLICT', 'The probed mount id already belongs to different evidence.');
  }
  const alignedHandle = rootHandle(root.root_id, probed.endpointId, targetScopeId, 1, Number(root.config_revision));
  const workspaces = database.prepare(`SELECT workspace_id, process_id, state, reclaim_after_ms, reclaimed_at_ms, root_handle_ref
    FROM fx_workspace_registry WHERE owner_domain='arca' AND process_type='aftercare_case' AND state='active' AND root_handle_ref=?
    ORDER BY workspace_id`).all(root.root_handle_ref);
  const materials = database.prepare(`SELECT m.* FROM fx_workspace_materials m
    JOIN fx_workspace_registry r ON r.workspace_id=m.workspace_id
    WHERE r.owner_domain='arca' AND r.process_type='aftercare_case' AND r.state='active' AND r.root_handle_ref=? AND m.state='active'
    ORDER BY m.workspace_id, m.material_handle_id`).all(root.root_handle_ref);
  const historical = database.prepare(`SELECT process_type, state, COUNT(*) AS n FROM fx_workspace_registry
    WHERE root_handle_ref=? AND NOT (owner_domain='arca' AND process_type='aftercare_case' AND state='active')
    GROUP BY process_type, state ORDER BY process_type, state`).all(root.root_handle_ref);
  const checked = materials.map((row) => {
    const handle = JSON.parse(row.handle_json);
    if (canonicalDigest(handle) !== row.handle_digest || handle.fenceDigest !== row.fence_digest) {
      fail('WORKSPACE_DISK_MIGRATION_HANDLE_CORRUPT', 'Workspace material handle digest does not match its row.', { handleId: row.material_handle_id });
    }
    if (materialIdentityKey(handle.physicalIdentity) !== row.material_key) {
      fail('WORKSPACE_DISK_MIGRATION_MATERIAL_KEY_UNKNOWN', 'Workspace material key does not match the physical identity formula.', { handleId: row.material_handle_id });
    }
    const observed = inspectMember(root.resolved_root, row, fingerprint);
    return { row, handle, observed };
  });
  const keyHits = otherMaterialKeyHits(database, checked.map((item) => item.row.material_key));
  if (keyHits.length) {
    fail('WORKSPACE_DISK_MIGRATION_UNKNOWN_DEPENDENCY', 'Active workspace material keys are referenced outside the workspace closure.', { hits: keyHits });
  }
  const desiredRevision = Number(root.config_revision) + (root.mount_scope_id === targetScopeId && root.root_handle_ref === alignedHandle ? 0 : 1);
  const usingCurrent = desiredRevision === Number(root.config_revision);
  const nextHandle = usingCurrent ? alignedHandle : rootHandle(root.root_id, probed.endpointId, targetScopeId, 1, desiredRevision);
  const nextSnapshot = rootSnapshotDigest(root, probed.endpointId, targetScopeId, 1, desiredRevision, nextHandle);
  const rewritten = checked.map(({ row, handle, observed }) => {
    const next = rewriteHandle(handle, {
      rootHandleRef: nextHandle, endpointId: probed.endpointId, mountScopeId: targetScopeId, inode: observed.inode,
    });
    return {
      handleId: row.material_handle_id,
      workspaceId: row.workspace_id,
      previousMountScopeId: row.mount_scope_id,
      nextMountScopeId: targetScopeId,
      previousInode: row.inode,
      nextInode: observed.inode,
      previousMaterialKey: row.material_key,
      sizeBytes: observed.sizeBytes,
      contentFingerprint: observed.contentFingerprint,
      fullContentSha256: observed.fullContentSha256,
      previousRootHandleRef: row.root_handle_ref,
      state: row.state,
      changed: row.mount_scope_id !== targetScopeId || row.inode !== observed.inode || row.root_handle_ref !== nextHandle ||
        row.material_key !== next.handle.materialKey,
      next,
    };
  });
  const already = usingCurrent && root.snapshot_digest === nextSnapshot && rewritten.every((item) => !item.changed);
  const cases = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='arca_aftercare_cases'").get()
    ? database.prepare('SELECT aftercare_case_id, state, case_generation FROM arca_aftercare_cases WHERE aftercare_case_id=?')
    : null;
  const receipt = {
    schema: RECEIPT_SCHEMA,
    mode: already ? 'already-applied' : (options.apply ? 'applied' : 'dry-run'),
    rootId: ROOT_ID,
    resolvedRoot: root.resolved_root,
    previous: {
      configRevision: Number(root.config_revision), mountScopeId: root.mount_scope_id, endpointId: root.endpoint_id,
      rootHandleRef: root.root_handle_ref, snapshotDigest: root.snapshot_digest, state: root.state,
    },
    next: {
      configRevision: desiredRevision, mountScopeId: targetScopeId, endpointId: probed.endpointId,
      rootHandleRef: nextHandle, snapshotDigest: nextSnapshot, state: 'active',
      filesystemType: probed.filesystemType, mountBoundary: probed.mountBoundary,
      stableMountFingerprint: probed.stableMountFingerprint, reusedExistingScope: Boolean(existingTarget),
    },
    admissionBefore: explainAftercareRootAdmission(root, {
      resolvedRoot: root.resolved_root, endpointId: probed.endpointId, mountScopeId: targetScopeId, mountScopeRevision: 1,
    }),
    workspaces: workspaces.map((item) => ({
      workspaceId: item.workspace_id, processId: item.process_id, state: item.state,
      reclaimScheduled: item.reclaim_after_ms !== null, reclaimed: item.reclaimed_at_ms !== null,
      case: cases ? cases.get(item.process_id) || null : null,
    })),
    historicalReferences: historical.map((item) => ({ processType: item.process_type, state: item.state, count: item.n, updated: false })),
    materials: rewritten.map(({ next, previousMaterialKey, ...item }) => item),
    contentVerification: { checked: rewritten.length, missing: 0, digestMismatch: 0, unsafePath: 0 },
  };
  if (!options.apply || already) return Object.freeze({ ...receipt, changed: false });
  if (options.confirm !== CONFIRM) fail('WORKSPACE_DISK_MIGRATION_CONFIRMATION_REQUIRED', 'Explicit migration confirmation is required.');
  const write = database.transaction(() => {
    if (!existingTarget) {
      const createdAtMs = now();
      database.prepare(`INSERT INTO platform_mount_scopes
        (mount_scope_id, status, current_revision, created_at_ms, terminal_at_ms) VALUES (?, 'active', NULL, ?, NULL)`).run(targetScopeId, createdAtMs);
      database.prepare(`INSERT INTO platform_mount_scope_revisions
        (mount_scope_id, revision, endpoint_id, mount_boundary, filesystem_type, stable_mount_fingerprint,
         inode_capability_digest, probe_evidence_digest, effective_at_ms)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(targetScopeId, probed.endpointId, probed.mountBoundary, probed.filesystemType,
        probed.stableMountFingerprint, probed.inodeCapabilityDigest, probed.probeEvidenceDigest, createdAtMs);
      database.prepare('UPDATE platform_mount_scopes SET current_revision = 1 WHERE mount_scope_id = ?').run(targetScopeId);
    }
    const rootUpdated = database.prepare(`UPDATE platform_workspace_roots
      SET endpoint_id=?, mount_scope_id=?, mount_scope_revision=1, config_revision=?, root_handle_ref=?, snapshot_digest=?, updated_at_ms=?
      WHERE root_id=? AND config_revision=? AND root_handle_ref=? AND state='active'`).run(
      probed.endpointId, targetScopeId, desiredRevision, nextHandle, nextSnapshot, now(), ROOT_ID, root.config_revision, root.root_handle_ref);
    if (rootUpdated.changes !== 1) fail('WORKSPACE_DISK_MIGRATION_ROOT_CONFLICT', 'Aftercare root changed before migration commit.');
    const registry = database.prepare(`UPDATE fx_workspace_registry SET root_handle_ref=?
      WHERE owner_domain='arca' AND process_type='aftercare_case' AND state='active' AND root_handle_ref=?`).run(nextHandle, root.root_handle_ref);
    if (registry.changes !== workspaces.length) fail('WORKSPACE_DISK_MIGRATION_REGISTRY_CONFLICT', 'Active workspace registry changed before migration commit.');
    const updateMaterial = database.prepare(`UPDATE fx_workspace_materials SET material_key=?, endpoint_id=?, mount_scope_id=?, inode=?,
      root_handle_ref=?, handle_json=?, handle_digest=?, fence_digest=?
      WHERE workspace_id=? AND material_handle_id=? AND state='active' AND material_key=?`);
    for (const item of rewritten) {
      const changed = updateMaterial.run(item.next.handle.materialKey, probed.endpointId, targetScopeId, item.nextInode, nextHandle,
        item.next.handleJson, item.next.handleDigest, item.next.fenceDigest, item.workspaceId, item.handleId, item.previousMaterialKey);
      if (changed.changes !== 1) fail('WORKSPACE_DISK_MIGRATION_MATERIAL_CONFLICT', 'Workspace material changed before migration commit.', { handleId: item.handleId });
    }
    if (typeof options.beforeCommit === 'function') options.beforeCommit(database);
  });
  write();
  return Object.freeze({ ...receipt, mode: 'applied', changed: true });
}

module.exports = Object.freeze({
  CONFIRM, RECEIPT_SCHEMA, ROOT_ID, WorkspaceDiskMigrationError, explainAftercareRootAdmission, migrateWorkspaceDisk,
});
