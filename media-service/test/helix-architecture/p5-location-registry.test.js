'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createLocationRegistryService } = require('../../src/helix/platform/application/location-registry');
const { createPathAuthority } = require('../../src/helix/platform/model/path-authority');
const { createLocationRegistryRepository } = require('../../src/helix/platform/persistence/location-registry-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(run, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-location-registry-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_000_100_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const repository = createLocationRegistryRepository({
    schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel })
  });
  const pathAuthority = createPathAuthority(path.posix);
  const reserved = overrides.reserved || [];
  const mountProbe = overrides.mountProbe || { inspect: (request) => ({
    resolvedBoundary: request.mountBoundary, endpointId: request.endpointId, filesystemType: 'ext4',
    stableMountFingerprint: `fingerprint:${request.mountScopeId}`,
    inodeCapabilityDigest: hash(`inode:${request.mountScopeId}`),
    probeEvidenceDigest: hash(`mount-probe:${request.mountScopeId}`)
  }) };
  const defaultWorkspaceProbe = { inspect: (request) => ({
    resolvedRoot: request.resolvedRoot, created: true, writable: true, atomicRename: true, readable: true,
    deletable: true, availableBytes: 1_000_000, capabilityDigest: hash(`capability:${request.resolvedRoot}`),
    probeEvidenceDigest: hash(`root-probe:${request.resolvedRoot}`)
  }), assessSpace: () => ({ availableBytes: 10_000_000_000 }) };
  const workspaceProbe = { ...defaultWorkspaceProbe, ...(overrides.workspaceProbe || {}) };
  const service = createLocationRegistryService({
    repository, pathAuthority, mountProbe, workspaceProbe,
    reservedRootQuery: { list: () => reserved }, clock: { now: () => now++ }
  });
  try {
    return run({ databasePath, repository, service });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function mountRequest(mountScopeId, revision, mountBoundary) {
  return {
    mountScopeId, revision, endpointId: `endpoint:${mountScopeId}`, mountBoundary, filesystemType: 'ext4',
    stableMountFingerprint: `fingerprint:${mountScopeId}`, inodeCapabilityDigest: hash(`inode:${mountScopeId}`),
    probeEvidenceDigest: hash(`mount-probe:${mountScopeId}`), effectiveAtMs: 1_700_000_100_000 + revision
  };
}

function rootRequest(rootId, rootKind, requestedRoot, expectedConfigRevision = null) {
  return { rootId, rootKind, endpointId: 'endpoint:workspace', mountScopeId: 'mount:workspace', mountScopeRevision: 1,
    requestedRoot, expectedConfigRevision, updatedAtMs: 1_700_000_200_000 };
}
function rootQuery(rootId, expectedConfigRevision) {
  const value = expectedConfigRevision === undefined ? { rootId } : { rootId, expectedConfigRevision };
  return { ...value, queryDigest: canonicalDigest(value) };
}

test('atomically bootstraps Mount Scope head and advances immutable revisions', () => {
  fixture(({ databasePath, service }) => {
    service.publishMountScope(mountRequest('mount-1', 1, '/mnt/media'));
    service.publishMountScope(mountRequest('mount-1', 2, '/mnt/media'));
    const resolved = service.resolveMountScope({ mountScopeId: 'mount-1', expectedRevision: 2 });
    assert.equal(resolved.mountScopeRevision, 2);
    assert.equal(resolved.mountBoundary, '/mnt/media');
    assert.throws(() => service.resolveMountScope({ mountScopeId: 'mount-1', expectedRevision: 1 }),
      (error) => error.code === 'P5_MOUNT_SCOPE_STALE');

    const inspected = new Database(databasePath, { readonly: true });
    const head = inspected.prepare('SELECT * FROM platform_mount_scopes WHERE mount_scope_id=?').get('mount-1');
    const revisions = inspected.prepare('SELECT revision FROM platform_mount_scope_revisions WHERE mount_scope_id=? ORDER BY revision').all('mount-1');
    inspected.close();
    assert.equal(head.current_revision, 2);
    assert.deepEqual(revisions.map((item) => item.revision), [1, 2]);
  });
});

test('rejects skipped Mount revisions, duplicate active fingerprint, and probe drift', () => {
  fixture(({ service }) => {
    service.publishMountScope(mountRequest('mount-1', 1, '/mnt/one'));
    assert.throws(() => service.publishMountScope(mountRequest('mount-1', 3, '/mnt/one')),
      (error) => error.code === 'P5_MOUNT_SCOPE_REVISION_CONFLICT');
  });

  fixture(({ service }) => {
    const first = { ...mountRequest('mount-1', 1, '/mnt/one'), stableMountFingerprint: 'fingerprint:shared' };
    const second = { ...mountRequest('mount-2', 1, '/mnt/two'), stableMountFingerprint: 'fingerprint:shared' };
    service.publishMountScope(first);
    assert.throws(() => service.publishMountScope(second),
      (error) => error.code === 'P5_MOUNT_SCOPE_FINGERPRINT_CONFLICT');
  }, { mountProbe: { inspect: (request) => ({
    resolvedBoundary: request.mountBoundary, endpointId: request.endpointId, filesystemType: 'ext4',
    stableMountFingerprint: 'fingerprint:shared', inodeCapabilityDigest: hash(`inode:${request.mountScopeId}`),
    probeEvidenceDigest: hash(`mount-probe:${request.mountScopeId}`)
  }) } });

  fixture(({ service }) => {
    assert.throws(() => service.publishMountScope(mountRequest('mount-1', 1, '/mnt/escape')),
      (error) => error.code === 'P5_MOUNT_SCOPE_PROBE_MISMATCH');
  }, { mountProbe: { inspect: (request) => ({
    resolvedBoundary: '/outside', endpointId: request.endpointId, filesystemType: 'ext4',
    stableMountFingerprint: `fingerprint:${request.mountScopeId}`,
    inodeCapabilityDigest: hash(`inode:${request.mountScopeId}`), probeEvidenceDigest: hash(`mount-probe:${request.mountScopeId}`)
  }) } });
});

test('publishes non-overlapping Workspace Roots with exact CAS revisions and owner mapping', () => {
  fixture(({ service }) => {
    const first = service.publishWorkspaceRoot(rootRequest('root-production', 'production-workspace', '/srv/work/production'));
    const second = service.publishWorkspaceRoot(rootRequest('root-aftercare', 'aftercare-workspace', '/srv/work/aftercare'));
    assert.equal(first.ownerScope, 'libra');
    assert.equal(second.ownerScope, 'arca');
    const updated = service.publishWorkspaceRoot(rootRequest(
      'root-production', 'production-workspace', '/srv/new/production', 1
    ));
    assert.equal(updated.configRevision, 2);
    assert.throws(() => service.publishWorkspaceRoot(rootRequest(
      'root-production', 'production-workspace', '/srv/stale', 1
    )), (error) => error.code === 'P5_WORKSPACE_ROOT_REVISION_CONFLICT');
    const resolved = service.resolveWorkspaceRoot(rootQuery('root-production', 2));
    assert.equal(resolved.resultKind, 'found');
    assert.equal(resolved.snapshot.ownerScope, 'libra');
    assert.equal(resolved.snapshot.resolvedRoot, undefined);
    assert.equal(resolved.resultDigest, canonicalDigest(Object.fromEntries(Object.entries(resolved).filter(([key]) => key !== 'resultDigest'))));
    const stale = service.resolveWorkspaceRoot(rootQuery('root-production', 1));
    assert.equal(stale.resultKind, 'stale');
    assert.equal(stale.snapshot, undefined);
  });
});

test('rejects Workspace overlap, traversal, symlink-style resolution escape, and incomplete capability probe', () => {
  fixture(({ service }) => {
    service.publishWorkspaceRoot(rootRequest('root-1', 'production-workspace', '/srv/work'));
    assert.throws(() => service.publishWorkspaceRoot(rootRequest('root-2', 'aftercare-workspace', '/srv/work/child')),
      (error) => error.code === 'P5_WORKSPACE_ROOT_OVERLAP');
    assert.throws(() => service.publishWorkspaceRoot(rootRequest('root-3', 'internal-artifact', '/srv/../escape')),
      (error) => error.code === 'P5_PATH_TRAVERSAL');
  });

  fixture(({ service }) => {
    assert.throws(() => service.publishWorkspaceRoot(rootRequest('root-1', 'production-workspace', '/srv/work')),
      (error) => error.code === 'P5_WORKSPACE_ROOT_PROBE_FAILED');
  }, { workspaceProbe: { inspect: (request) => ({
    resolvedRoot: '/escaped-realpath', created: true, writable: true, atomicRename: true, readable: true,
    deletable: true, availableBytes: 1, capabilityDigest: hash('cap'), probeEvidenceDigest: hash('probe')
  }) } });

  fixture(({ service }) => {
    assert.throws(() => service.publishWorkspaceRoot(rootRequest('root-1', 'production-workspace', '/srv/work')),
      (error) => error.code === 'P5_WORKSPACE_ROOT_PROBE_FAILED');
  }, { workspaceProbe: { inspect: (request) => ({
    resolvedRoot: request.resolvedRoot, created: true, writable: true, atomicRename: false, readable: true,
    deletable: true, availableBytes: 1, capabilityDigest: hash('cap'), probeEvidenceDigest: hash('probe')
  }) } });
});

test('assesses Workspace space from internal path without leaking it to typed evidence', () => {
  fixture(({ service }) => {
    const root = service.publishWorkspaceRoot(rootRequest('root-production', 'production-workspace', '/srv/work/production'));
    const inputPrimaryTotalBytes = 1_000_000_000;
    const value = { workspaceId: hash('workspace'), libraRunId: hash('run'), executionBasisDigest: hash('basis'),
      rootId: root.rootId, rootSnapshotDigest: root.snapshotDigest, inputPrimaryTotalBytes,
      requiredFreeBytes: Math.ceil(inputPrimaryTotalBytes * 120 / 100) + 5368709120 };
    const evidence = service.assessWorkspaceSpace({ ...value, requestDigest: canonicalDigest(value) });
    assert.equal(evidence.result, 'admitted');
    assert.equal(evidence.reasonCode, undefined);
    assert.equal(evidence.availableBytes, 10_000_000_000);
    assert.equal(evidence.expiresAtMs, evidence.observedAtMs + 30000);
    assert.equal(evidence.resolvedRoot, undefined);
    assert.equal(evidence.evidenceDigest, canonicalDigest(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'evidenceDigest'))));
  });
});

test('rejects overlap with formal Material Field and Shelf target projections', () => {
  const reserved = [
    { kind: 'material-field', rootId: 'field-1', resolvedRoot: '/media/source', revision: 4 },
    { kind: 'shelf-target', rootId: 'shelf-1', resolvedRoot: '/media/library', revision: 2 }
  ];
  fixture(({ service }) => {
    assert.throws(() => service.publishWorkspaceRoot(rootRequest('root-1', 'production-workspace', '/media/source/work')),
      (error) => error.code === 'P5_WORKSPACE_ROOT_RESERVED_OVERLAP');
    assert.throws(() => service.publishWorkspaceRoot(rootRequest('root-2', 'aftercare-workspace', '/media')),
      (error) => error.code === 'P5_WORKSPACE_ROOT_RESERVED_OVERLAP');
  }, { reserved });
});

test('path authority is deterministic for POSIX and Windows without filesystem access', () => {
  const posix = createPathAuthority(path.posix);
  const windows = createPathAuthority(path.win32);
  assert.equal(posix.contains('/srv/root', '/srv/root/child'), true);
  assert.equal(posix.contains('/srv/root', '/srv/other'), false);
  assert.equal(windows.contains('C:\\ShelfDeck\\work', 'c:\\ShelfDeck\\work\\child'), true);
  assert.equal(windows.overlaps('C:\\ShelfDeck\\work', 'C:\\ShelfDeck\\work2'), false);
  assert.equal(posix.resolveContained('/srv/root', 'child/file.mkv'), '/srv/root/child/file.mkv');
  assert.throws(() => posix.resolveContained('/srv/root', '../escape'), (error) => error.code === 'P5_PATH_RELATIVE_INVALID');
  assert.throws(() => windows.canonicalize('relative\\path'), (error) => error.code === 'P5_PATH_ABSOLUTE_REQUIRED');
});

test('P5-03 implementation has no direct filesystem, Domain Store, or product startup dependency', () => {
  const files = [
    '../../src/helix/platform/application/location-registry.js',
    '../../src/helix/platform/model/path-authority.js',
    '../../src/helix/platform/persistence/location-registry-repository.js'
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8')).join('\n').toLowerCase();
  for (const parts of [['node:', 'fs'], ['server', '.js'], ['/domains/'], ['child_', 'process'], ['process.', 'env']]) {
    assert.equal(source.includes(parts.join('').toLowerCase()), false, parts.join(''));
  }
});
