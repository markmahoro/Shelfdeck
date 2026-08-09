'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const catalog = require('../../src/helix/contracts/ports/p5-media-tool-operation-contracts.json');
const { createMaterialAccessAuthority } = require('../../src/helix/foundation/execution/material-access-authority');
const { createWorkspaceFileEffectAdapter } = require('../../src/helix/integrations/media-tool-protocol');
const { createPathAuthority } = require('../../src/helix/platform/model/path-authority');

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const eventFenceDigest = hash('event-fence');
const scope = Object.freeze({ scopeType: 'subject', scopeId: 'subject-1' });
const identityValue = {
  schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion: 2,
  mountScopeId: 'mount-1', inode: '1', sizeBytes: 100,
  fingerprintAlgorithm: 'middle-256k-sha256', fingerprintVersion: 1, contentFingerprint: hash('content-1')
};
identityValue.materialKey = hash(canonical({ schema:'physical-material-identity@2', mountScopeId:identityValue.mountScopeId,
  inode:identityValue.inode, sizeBytes:identityValue.sizeBytes, fingerprintAlgorithm:identityValue.fingerprintAlgorithm,
  fingerprintVersion:identityValue.fingerprintVersion, contentFingerprint:identityValue.contentFingerprint }));
const identity = Object.freeze(identityValue);

function fixture(overrides = {}) {
  let now = 1_000;
  let handleOrdinal = 0;
  let grantOrdinal = 0;
  let controlCalls = 0;
  const state = {
    fenceCurrent: true,
    realityCurrent: true,
    binding: {
      basisDigest: hash('basis'), basisRevision: 4, bindingId: 'binding-1', bindingKind: 'primary', bindingRevision: 3,
      containmentRoot: '/media/field', endpointId: 'endpoint-1', expectedCtimeNs: 90, expectedMtimeNs: 100,
      expectedSizeBytes: 10, fingerprintVerifiedAtMs: 900, identity, location: '/media/field/movie.mkv',
      mountScopeRevision: 2, ownerDomain: 'libra', ownerScope: scope
    },
    control: { controlRevision: 7, materialKey: identity.materialKey, ownerDomain: 'libra', ownerScope: scope, state: 'active' },
    workspace: {
      digestAlgorithm: 'sha256', digestHex: hash('workspace-content'), materialHandleId: 'workspace-material-1',
      ownerDomain: 'libra', processId: 'run-1', referenceRevision: 5, relativePath: 'products/movie.mkv',
      rootPath: '/work/libra', rootRevision: 2, sizeBytes: 20, state: 'active', workspaceId: 'workspace-1'
    },
    workspaceScope: { ownerDomain: 'libra', processId: 'run-1', rootPath: '/work/libra', rootRevision: 2,
      state: 'active', workspaceId: 'workspace-1' },
    commitAuthority: { authorityDigest: hash('commit-authority'), controlRevision: 11,
      materialHandleId: 'workspace-material-1', ownerDomain: 'arca' }
  };
  Object.assign(state, overrides.state || {});
  const authority = createMaterialAccessAuthority({
    now: () => now,
    nextHandleId: () => `handle-${++handleOrdinal}`,
    nextGrantId: () => `grant-${++grantOrdinal}`,
    digest: hash,
    pathAuthority: createPathAuthority(path.posix),
    bindingResolver: { resolve: () => state.binding },
    workspaceResolver: {
      resolveMaterial: () => state.workspace,
      resolveScope: () => state.workspaceScope,
      resolveCommitAuthority: () => state.commitAuthority
    },
    controlAuthority: { resolveCurrent: () => { controlCalls += 1; return state.control; } },
    fenceAuthority: { assertCurrent: () => state.fenceCurrent },
    realityVerifier: {
      verifyPhysical: () => state.realityCurrent,
      verifyWorkspace: () => state.realityCurrent,
      verifyOperation: () => state.realityCurrent
    },
    approvalAuthority: { assertCurrent: () => overrides.approvalCurrent !== false },
    authorizationAuthority: { assertCurrent: () => overrides.authorizationCurrent !== false },
    targetAuthority: { assertCurrent: () => overrides.targetCurrent !== false }
  });
  return { authority, state, setNow: (value) => { now = value; }, controlCalls: () => controlCalls };
}

function physicalRequest(changes = {}) {
  return {
    basisRef: { objectType: 'libra-run', objectId: 'run-1', revision: 4, digest: hash('basis') },
    bindingRef: { bindingId: 'binding-1', bindingRevision: 3, materialKey: identity.materialKey },
    eventFenceDigest, eventId: 'event-1', expiresAtMs: 20_000, ownerDomain: 'libra', ownerScope: scope,
    readScope: 'read', ...changes
  };
}

function workspaceRequest(changes = {}) {
  return { accessScope: 'read', eventFenceDigest, eventId: 'event-1', expiresAtMs: 20_000,
    expectedReferenceRevision: 5, materialHandleId: 'workspace-material-1', ownerDomain: 'libra',
    processId: 'run-1', workspaceId: 'workspace-1', ...changes };
}

function grantRequest(operationId, sourceHandleIds, changes = {}) {
  return {
    approvalHandle: null, authorizationHandle: null, eventId: 'event-1', expiresAtMs: 19_000,
    fenceSnapshotDigest: eventFenceDigest, operationId, ownerDomain: 'libra', sourceHandleIds,
    targetCommitSlotHandle: null, targetRelativePaths: [], workspaceScopeRef: null, ...changes
  };
}

function approval() {
  return { schemaRef: 'helix://contracts/types/ApprovalHandle/v1', schemaVersion: 1, approvalId: 'approval-1',
    ownerDomain: 'arca', processType: 'on-deck', processId: 'ondeck-1', eventId: 'event-1',
    exactEffectScopeDigest: hash('settlement-scope'), approvalRevision: 2, actorId: 'user-1',
    invalidatingFactDigests: [hash('inventory')], approvedAtMs: 900 };
}

function authorization() {
  return { schemaRef: 'helix://contracts/types/AuthorizationHandle/v1', schemaVersion: 1,
    authorizationId: 'authorization-1', authorizationKind: 'offdeck-destruction', ownerDomain: 'arca',
    immutableScopeDigest: hash('destruction-scope'), authorizationRevision: 3, actorId: 'user-1', batchId: null,
    invalidatingFactDigests: [hash('inventory')], authorizedAtMs: 900 };
}

function targetSlot() {
  return { schemaRef: 'helix://contracts/types/TargetCommitSlotHandle/v1', schemaVersion: 1, slotId: 'slot-1',
    onDeckRunId: 'ondeck-1', targetEndpointId: 'target-1', targetDirectory: '/shelf/target',
    slotDirectory: '/shelf/target/.slot-1', finalInventoryDecisionDigest: hash('decision'), transactionRevision: 2,
    containmentDigest: hash('containment') };
}

function verify(authority, operationId, grant) {
  const operation = catalog.operations.find((item) => item.operationId === operationId);
  const request = { eventId: 'event-1', operationGrant: grant };
  return authority.verify({ request, operation, grant });
}

test('issues exact Physical and Workspace handles from Owner projections without taking fact ownership', () => {
  const fx = fixture();
  const physical = fx.authority.issuePhysicalRead(physicalRequest());
  const workspace = fx.authority.issueWorkspace(workspaceRequest());
  assert.deepEqual(Object.keys(physical).sort(), [
    'bindingRevision', 'endpointId', 'expectedCtimeNs', 'expectedMtimeNs', 'expectedSizeBytes', 'expiresAtMs',
    'fenceDigest', 'handleId', 'fingerprintVerifiedAtMs', 'identity', 'location', 'mountScopeRevision', 'ownerDomain',
    'ownerScope', 'readScope', 'schemaRef', 'schemaVersion'
  ].sort());
  assert.equal(physical.bindingRevision, 3);
  assert.equal(physical.readScope, 'read');
  assert.deepEqual(Object.keys(workspace).sort(), [
    'accessScope', 'digestAlgorithm', 'digestHex', 'fenceDigest', 'handleId', 'ownerDomain', 'processId',
    'referenceRevision', 'relativePath', 'schemaRef', 'schemaVersion', 'sizeBytes', 'workspaceId'
  ].sort());
  assert.equal(workspace.referenceRevision, 5);
  assert.equal(fx.controlCalls(), 1);
});

test('Related references may receive read handles but never synthesize Material Control', () => {
  const fx = fixture();
  fx.state.binding = { ...fx.state.binding, bindingKind: 'related' };
  const handle = fx.authority.issuePhysicalRead(physicalRequest());
  assert.equal(handle.readScope, 'read');
  assert.equal(fx.controlCalls(), 0);
  assert.throws(() => fx.authority.issueOperationGrant(grantRequest('offdeck.primary.delete@1', [handle.handleId], {
    ownerDomain: 'arca', authorizationHandle: authorization()
  })), (error) => error.code === 'P5_MATERIAL_ACCESS_HANDLE_SCOPE');
});

test('pure observation grant is exact, current, and consumable only once', () => {
  const fx = fixture();
  const handle = fx.authority.issuePhysicalRead(physicalRequest());
  const grant = fx.authority.issueOperationGrant(grantRequest('media.ffprobe.observe@1', [handle.handleId]));
  assert.deepEqual(grant.sourcePaths, ['/media/field/movie.mkv']);
  assert.deepEqual(grant.targetPaths, []);
  assert.equal(verify(fx.authority, 'media.ffprobe.observe@1', grant), true);
  assert.throws(() => verify(fx.authority, 'media.ffprobe.observe@1', grant),
    (error) => error.code === 'P5_MATERIAL_ACCESS_GRANT_REPLAY');
});

test('stale Binding, Control revision, Fence, Reality, and expiry fail before an operation grant', () => {
  for (const mutate of [
    (fx) => { fx.state.binding = { ...fx.state.binding, bindingRevision: 4 }; },
    (fx) => { fx.state.control = { ...fx.state.control, controlRevision: 8 }; },
    (fx) => { fx.state.fenceCurrent = false; },
    (fx) => { fx.state.realityCurrent = false; },
    (fx) => { fx.setNow(20_000); }
  ]) {
    const fx = fixture();
    const handle = fx.authority.issuePhysicalRead(physicalRequest());
    mutate(fx);
    assert.throws(() => fx.authority.issueOperationGrant(grantRequest('media.ffprobe.observe@1', [handle.handleId])),
      (error) => /^P5_MATERIAL_ACCESS_/.test(error.code));
  }
});

test('workspace write stays inside one active Workspace and cannot borrow read scope for cleanup', () => {
  const fx = fixture();
  const physical = fx.authority.issuePhysicalRead(physicalRequest());
  const grant = fx.authority.issueOperationGrant(grantRequest('workspace.material.import@1', [physical.handleId], {
    workspaceScopeRef: { workspaceId: 'workspace-1', ownerDomain: 'libra', processId: 'run-1', rootRevision: 2 },
    targetRelativePaths: ['imports/movie.mkv']
  }));
  assert.deepEqual(grant.targetPaths, ['/work/libra/imports/movie.mkv']);
  assert.equal(grant.controlledRoots.includes('/media/field'), true);
  assert.equal(grant.controlledRoots.includes('/work/libra'), true);

  const readHandle = fx.authority.issueWorkspace(workspaceRequest());
  assert.throws(() => fx.authority.issueOperationGrant(grantRequest('libra.workspace.reclaim@1', [readHandle.handleId], {
    workspaceScopeRef: { workspaceId: 'workspace-1', ownerDomain: 'libra', processId: 'run-1', rootRevision: 2 }
  })), (error) => error.code === 'P5_MATERIAL_ACCESS_PERMISSION_ESCALATION');
  assert.throws(() => fx.authority.issueOperationGrant(grantRequest('workspace.material.import@1', [physical.handleId], {
    workspaceScopeRef: { workspaceId: 'workspace-1', ownerDomain: 'libra', processId: 'run-1', rootRevision: 2 },
    targetRelativePaths: ['../escape.mkv']
  })), (error) => error.code === 'P5_PATH_RELATIVE_INVALID');
});

test('issued Workspace import grant plugs into the P5-07 nominal adapter without broader path authority', async () => {
  const fx = fixture();
  const physical = fx.authority.issuePhysicalRead(physicalRequest());
  const grant = fx.authority.issueOperationGrant(grantRequest('workspace.material.import@1', [physical.handleId], {
    workspaceScopeRef: { workspaceId: 'workspace-1', ownerDomain: 'libra', processId: 'run-1', rootRevision: 2 },
    targetRelativePaths: ['imports/movie.mkv']
  }));
  const profile = { overwrite: false };
  const effectBinding = { effectId: 'effect-1', idempotencyKey: 'idem-1', intentDigest: hash(canonical({
    operationId: 'workspace.material.import@1', capabilityRef: 'libra.workspace.material.import@1',
    effectClass: 'workspace_write', eventId: 'event-1', grantId: grant.grantId, authorityDigest: grant.authorityDigest,
    sourcePaths: grant.sourcePaths, targetPaths: grant.targetPaths, profile
  })) };
  let calls = 0;
  const adapter = createWorkspaceFileEffectAdapter({
    now: () => 1_000, digest: hash, pathAuthority: createPathAuthority(path.posix), grantVerifier: fx.authority,
    filesystemAdapter: { execute: async () => { calls += 1; const evidence = { atomId: 'filesystem.workspace.stage-copy@1' };
      return { outputDigest: hash('output'), verificationEvidenceDigest: hash(canonical(evidence)),
        bytesAffected: 10, itemCount: 1, evidence }; } }
  });
  const result = await adapter.execute({ operationId: 'workspace.material.import@1',
    capabilityRef: 'libra.workspace.material.import@1', effectClass: 'workspace_write', eventId: 'event-1',
    effectBinding, operationGrant: grant, profile });
  assert.equal(result.effectClass, 'workspace_write');
  assert.equal(calls, 1);
});

test('material commit is Arca-only, target-slot-bound, and rechecks a frozen Control authority slice', () => {
  const fx = fixture();
  fx.state.workspace = { ...fx.state.workspace, ownerDomain: 'arca', processId: 'ondeck-1' };
  const handle = fx.authority.issueWorkspace(workspaceRequest({ ownerDomain: 'arca', processId: 'ondeck-1' }));
  const request = grantRequest('inventory.product.stage@1', [handle.handleId], {
    ownerDomain: 'arca', targetCommitSlotHandle: targetSlot(), targetRelativePaths: ['movie.mkv']
  });
  const grant = fx.authority.issueOperationGrant(request);
  fx.state.commitAuthority = { ...fx.state.commitAuthority, controlRevision: 12, authorityDigest: hash('changed') };
  assert.throws(() => verify(fx.authority, 'inventory.product.stage@1', grant),
    (error) => error.code === 'P5_MATERIAL_ACCESS_GRANT_STALE');
});

test('destructive permissions distinguish Input Settlement Approval, Primary Authorization, and Related scope', () => {
  const fx = fixture();
  fx.state.binding = { ...fx.state.binding, ownerDomain: 'arca', ownerScope: { scopeType: 'shelf-entry', scopeId: 'entry-1' } };
  fx.state.control = { ...fx.state.control, ownerDomain: 'arca', ownerScope: fx.state.binding.ownerScope };
  const primary = fx.authority.issuePhysicalRead(physicalRequest({ ownerDomain: 'arca', ownerScope: fx.state.binding.ownerScope }));
  assert.throws(() => fx.authority.issueOperationGrant(grantRequest('offdeck.primary.delete@1', [primary.handleId], {
    ownerDomain: 'arca', approvalHandle: approval()
  })), (error) => error.code === 'P5_MATERIAL_ACCESS_AUTHORIZATION_REQUIRED');
  const offdeck = fx.authority.issueOperationGrant(grantRequest('offdeck.primary.delete@1', [primary.handleId], {
    ownerDomain: 'arca', authorizationHandle: authorization()
  }));
  assert.equal(offdeck.effectClass, 'destructive_commit');

  const fx2 = fixture();
  fx2.state.binding = { ...fx2.state.binding, ownerDomain: 'arca', ownerScope: { scopeType: 'on-deck-run', scopeId: 'ondeck-1' } };
  fx2.state.control = { ...fx2.state.control, ownerDomain: 'arca', ownerScope: fx2.state.binding.ownerScope };
  const settlement = fx2.authority.issuePhysicalRead(physicalRequest({ ownerDomain: 'arca', ownerScope: fx2.state.binding.ownerScope }));
  assert.doesNotThrow(() => fx2.authority.issueOperationGrant(grantRequest('ondeck.input-settlement.delete@1', [settlement.handleId], {
    ownerDomain: 'arca', approvalHandle: approval()
  })));

  const fx3 = fixture();
  fx3.state.binding = { ...fx3.state.binding, bindingKind: 'related', ownerDomain: 'arca',
    ownerScope: { scopeType: 'destruction-scope', scopeId: 'scope-1' } };
  const related = fx3.authority.issuePhysicalRead(physicalRequest({ ownerDomain: 'arca', ownerScope: fx3.state.binding.ownerScope }));
  assert.doesNotThrow(() => fx3.authority.issueOperationGrant(grantRequest('offdeck.related.delete@1', [related.handleId], {
    ownerDomain: 'arca', authorizationHandle: authorization()
  })));
  assert.equal(fx3.controlCalls(), 0);
});

test('wrong Owner, broad physical permission, stale authorization, and malformed target paths fail closed', () => {
  const fx = fixture({ authorizationCurrent: false });
  assert.throws(() => fx.authority.issuePhysicalRead(physicalRequest({ readScope: 'write' })),
    (error) => error.code === 'P5_MATERIAL_ACCESS_PERMISSION');
  const handle = fx.authority.issuePhysicalRead(physicalRequest());
  assert.throws(() => fx.authority.issueOperationGrant(grantRequest('media.ffprobe.observe@1', [handle.handleId], { ownerDomain: 'arca' })),
    (error) => error.code === 'P5_MATERIAL_ACCESS_HANDLE_SCOPE');
  assert.throws(() => fx.authority.issueOperationGrant(grantRequest('offdeck.primary.delete@1', [handle.handleId], {
    authorizationHandle: authorization()
  })), (error) => /^P5_MATERIAL_ACCESS_/.test(error.code));
});

test('implementation has no Domain Store, filesystem, process, legacy Task, or compatibility dependency', () => {
  const files = [
    '../../src/helix/foundation/execution/material-access-authority.js',
    '../../src/helix/platform/model/path-authority.js'
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').toLowerCase()).join('\n');
  for (const forbidden of ['require(\'node:fs\')', 'child_process', 'process.env', '/domains/', 'sourcebinding', 'legacy task', 'fallback']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
