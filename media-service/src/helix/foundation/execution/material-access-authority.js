'use strict';

const catalog = require('../../contracts/ports/p5-media-tool-operation-contracts.json');

const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/;
const READ_SCOPES = new Set(['read']);
const WORKSPACE_SCOPES = new Set(['read', 'workspace-write']);
const operations = new Map(catalog.operations.map((operation) => [operation.operationId, Object.freeze({ ...operation })]));

class MaterialAccessAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MaterialAccessAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new MaterialAccessAuthorityError(code, message, details); }
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    fail(code, 'Material access value must match the exact contract.');
  }
}
function text(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_MATERIAL_ACCESS_TOKEN', 'Material access token is invalid.', { field });
  return value;
}
function digest(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('P5_MATERIAL_ACCESS_DIGEST', 'Material access digest is invalid.', { field });
  return value;
}
function revision(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P5_MATERIAL_ACCESS_REVISION', 'Material access revision is invalid.', { field });
  return value;
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P5_MATERIAL_ACCESS_COUNT', 'Material access count is invalid.', { field });
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function same(left, right) { return canonical(left) === canonical(right); }

function assertIdentity(value) {
  exact(value, ['contentFingerprint', 'fingerprintAlgorithm', 'fingerprintVersion', 'inode', 'materialKey', 'mountScopeId', 'schemaRef', 'schemaVersion', 'sizeBytes'], 'P5_MATERIAL_ACCESS_IDENTITY_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v2' || value.schemaVersion !== 2 ||
      value.fingerprintAlgorithm !== 'middle-256k-sha256' || value.fingerprintVersion !== 1 ||
      !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) fail('P5_MATERIAL_ACCESS_IDENTITY', 'Physical Material Identity is invalid.');
  digest(value.materialKey, 'identity.materialKey'); digest(value.contentFingerprint, 'identity.contentFingerprint');
  text(value.mountScopeId, 'identity.mountScopeId'); text(value.inode, 'identity.inode');
}

function assertScope(value, field) {
  exact(value, ['scopeId', 'scopeType'], 'P5_MATERIAL_ACCESS_SCOPE_SHAPE');
  text(value.scopeType, field + '.scopeType'); text(value.scopeId, field + '.scopeId');
}

function assertBasis(value) {
  exact(value, ['digest', 'objectId', 'objectType', 'revision'], 'P5_MATERIAL_ACCESS_BASIS_SHAPE');
  text(value.objectType, 'basisRef.objectType'); text(value.objectId, 'basisRef.objectId');
  revision(value.revision, 'basisRef.revision'); digest(value.digest, 'basisRef.digest');
}

function assertBindingSnapshot(snapshot) {
  exact(snapshot, ['basisDigest', 'basisRevision', 'bindingId', 'bindingKind', 'bindingRevision', 'containmentRoot',
    'endpointId', 'expectedCtimeNs', 'expectedMtimeNs', 'expectedSizeBytes', 'fingerprintVerifiedAtMs', 'identity', 'location',
    'mountScopeRevision', 'ownerDomain', 'ownerScope'], 'P5_MATERIAL_ACCESS_BINDING_SNAPSHOT_SHAPE');
  if (!['primary', 'related'].includes(snapshot.bindingKind)) fail('P5_MATERIAL_ACCESS_BINDING_KIND', 'Binding kind is invalid.');
  assertIdentity(snapshot.identity); assertScope(snapshot.ownerScope, 'ownerScope');
  for (const field of ['bindingRevision', 'mountScopeRevision', 'basisRevision']) revision(snapshot[field], field);
  for (const field of ['expectedSizeBytes', 'expectedMtimeNs', 'expectedCtimeNs', 'fingerprintVerifiedAtMs']) count(snapshot[field], field);
  for (const field of ['bindingId', 'endpointId', 'ownerDomain']) text(snapshot[field], field);
  for (const field of ['location', 'containmentRoot']) {
    if (typeof snapshot[field] !== 'string' || snapshot[field].length < 1) fail('P5_MATERIAL_ACCESS_PATH', 'Binding path is invalid.', { field });
  }
  digest(snapshot.basisDigest, 'basisDigest');
}

function assertWorkspaceSnapshot(snapshot, scopeOnly = false) {
  const common = ['ownerDomain', 'processId', 'rootPath', 'rootRevision', 'state', 'workspaceId'];
  const material = ['digestAlgorithm', 'digestHex', 'materialHandleId', 'referenceRevision', 'relativePath', 'sizeBytes'];
  exact(snapshot, scopeOnly ? common : [...common, ...material], 'P5_MATERIAL_ACCESS_WORKSPACE_SNAPSHOT_SHAPE');
  for (const field of ['workspaceId', 'ownerDomain', 'processId']) text(snapshot[field], field);
  if (snapshot.state !== 'active') fail('P5_MATERIAL_ACCESS_WORKSPACE_INACTIVE', 'Workspace is not active.');
  revision(snapshot.rootRevision, 'rootRevision');
  if (typeof snapshot.rootPath !== 'string' || snapshot.rootPath.length < 1) fail('P5_MATERIAL_ACCESS_PATH', 'Workspace root is invalid.');
  if (!scopeOnly) {
    text(snapshot.materialHandleId, 'materialHandleId'); revision(snapshot.referenceRevision, 'referenceRevision');
    if (snapshot.digestAlgorithm !== 'sha256') fail('P5_MATERIAL_ACCESS_WORKSPACE_DIGEST', 'Workspace material requires SHA-256.');
    digest(snapshot.digestHex, 'digestHex'); count(snapshot.sizeBytes, 'sizeBytes');
    if (typeof snapshot.relativePath !== 'string' || snapshot.relativePath.length < 1) fail('P5_MATERIAL_ACCESS_PATH', 'Workspace relative path is invalid.');
  }
}

function assertControlSnapshot(snapshot) {
  exact(snapshot, ['controlRevision', 'materialKey', 'ownerDomain', 'ownerScope', 'state'], 'P5_MATERIAL_ACCESS_CONTROL_SNAPSHOT_SHAPE');
  if (snapshot.state !== 'active') fail('P5_MATERIAL_ACCESS_CONTROL_INACTIVE', 'Material Control is not active.');
  digest(snapshot.materialKey, 'control.materialKey'); text(snapshot.ownerDomain, 'control.ownerDomain');
  assertScope(snapshot.ownerScope, 'control.ownerScope'); revision(snapshot.controlRevision, 'control.controlRevision');
}

function assertApproval(value) {
  exact(value, ['actorId', 'approvalId', 'approvalRevision', 'approvedAtMs', 'eventId', 'exactEffectScopeDigest',
    'invalidatingFactDigests', 'ownerDomain', 'processId', 'processType', 'schemaRef', 'schemaVersion'], 'P5_MATERIAL_ACCESS_APPROVAL_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ApprovalHandle/v1' || value.schemaVersion !== 1) fail('P5_MATERIAL_ACCESS_APPROVAL', 'Approval Handle is invalid.');
  revision(value.approvalRevision, 'approvalRevision'); digest(value.exactEffectScopeDigest, 'exactEffectScopeDigest');
  for (const field of ['approvalId', 'ownerDomain', 'processType', 'processId', 'eventId', 'actorId']) text(value[field], field);
  if (!Array.isArray(value.invalidatingFactDigests) || value.invalidatingFactDigests.length > 1024) fail('P5_MATERIAL_ACCESS_APPROVAL', 'Approval invalidating facts are invalid.');
  value.invalidatingFactDigests.forEach((item) => digest(item, 'invalidatingFactDigest'));
  count(value.approvedAtMs, 'approvedAtMs');
}

function assertAuthorization(value) {
  const required = ['actorId', 'authorizationId', 'authorizationKind', 'authorizationRevision', 'authorizedAtMs',
    'immutableScopeDigest', 'invalidatingFactDigests', 'ownerDomain', 'schemaRef', 'schemaVersion'];
  const keys = Object.keys(value || {}).sort();
  const withoutBatch = [...required].sort();
  const withBatch = [...required, 'batchId'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(withoutBatch) && JSON.stringify(keys) !== JSON.stringify(withBatch)) {
    fail('P5_MATERIAL_ACCESS_AUTHORIZATION_SHAPE', 'Authorization Handle must match the exact contract.');
  }
  if (value.schemaRef !== 'helix://contracts/types/AuthorizationHandle/v1' || value.schemaVersion !== 1) fail('P5_MATERIAL_ACCESS_AUTHORIZATION', 'Authorization Handle is invalid.');
  revision(value.authorizationRevision, 'authorizationRevision'); digest(value.immutableScopeDigest, 'immutableScopeDigest');
  for (const field of ['authorizationId', 'authorizationKind', 'ownerDomain', 'actorId']) text(value[field], field);
  if (value.batchId !== undefined && value.batchId !== null) text(value.batchId, 'batchId');
  if (!Array.isArray(value.invalidatingFactDigests) || value.invalidatingFactDigests.length > 1024) fail('P5_MATERIAL_ACCESS_AUTHORIZATION', 'Authorization invalidating facts are invalid.');
  value.invalidatingFactDigests.forEach((item) => digest(item, 'invalidatingFactDigest'));
  count(value.authorizedAtMs, 'authorizedAtMs');
}

function assertTargetSlot(value) {
  exact(value, ['containmentDigest', 'finalInventoryDecisionDigest', 'onDeckRunId', 'schemaRef', 'schemaVersion', 'slotDirectory',
    'slotId', 'targetDirectory', 'targetEndpointId', 'transactionRevision'], 'P5_MATERIAL_ACCESS_TARGET_SLOT_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/TargetCommitSlotHandle/v1' || value.schemaVersion !== 1) fail('P5_MATERIAL_ACCESS_TARGET_SLOT', 'Target Commit Slot Handle is invalid.');
  for (const field of ['containmentDigest', 'finalInventoryDecisionDigest']) digest(value[field], field);
  for (const field of ['slotId', 'onDeckRunId', 'targetEndpointId']) text(value[field], field);
  revision(value.transactionRevision, 'transactionRevision');
}

function createMaterialAccessAuthority(options) {
  const required = ['now', 'nextHandleId', 'nextGrantId', 'digest'];
  const dependencies = ['pathAuthority', 'bindingResolver', 'workspaceResolver', 'controlAuthority', 'fenceAuthority',
    'realityVerifier', 'approvalAuthority', 'authorizationAuthority', 'targetAuthority'];
  if (!options || required.some((name) => typeof options[name] !== 'function') || dependencies.some((name) => !options[name]) ||
      typeof options.pathAuthority.resolveContained !== 'function' || typeof options.pathAuthority.contains !== 'function' ||
      typeof options.bindingResolver.resolve !== 'function' || typeof options.workspaceResolver.resolveMaterial !== 'function' ||
      typeof options.workspaceResolver.resolveScope !== 'function' || typeof options.workspaceResolver.resolveCommitAuthority !== 'function' ||
      typeof options.controlAuthority.resolveCurrent !== 'function' ||
      typeof options.fenceAuthority.assertCurrent !== 'function' || typeof options.realityVerifier.verifyPhysical !== 'function' ||
      typeof options.realityVerifier.verifyWorkspace !== 'function' || typeof options.realityVerifier.verifyOperation !== 'function' ||
      typeof options.approvalAuthority.assertCurrent !== 'function' || typeof options.authorizationAuthority.assertCurrent !== 'function' ||
      typeof options.targetAuthority.assertCurrent !== 'function') {
    fail('P5_MATERIAL_ACCESS_DEPENDENCIES', 'Material access authority dependencies are incomplete.');
  }
  const handles = new Map();
  const grants = new Map();

  function assertLifetime(expiresAtMs) {
    const now = options.now();
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now || expiresAtMs > now + 60_000) {
      fail('P5_MATERIAL_ACCESS_EXPIRY', 'Material access lifetime must be positive and at most 60 seconds.');
    }
  }

  function currentFence(eventId, fenceDigest) {
    text(eventId, 'eventId'); digest(fenceDigest, 'fenceDigest');
    if (options.fenceAuthority.assertCurrent(freeze({ eventId, fenceDigest })) !== true) {
      fail('P5_MATERIAL_ACCESS_FENCE_STALE', 'Event Fence is stale.');
    }
  }

  function currentPhysical(record) {
    const snapshot = options.bindingResolver.resolve(record.bindingQuery);
    assertBindingSnapshot(snapshot);
    if (!same(snapshot, record.snapshot)) fail('P5_MATERIAL_ACCESS_BINDING_STALE', 'Domain Binding changed after handle issuance.');
    currentFence(record.eventId, record.eventFenceDigest);
    if (snapshot.bindingKind === 'primary') {
      const controlSnapshot = options.controlAuthority.resolveCurrent(record.controlClaim);
      assertControlSnapshot(controlSnapshot);
      if (!same(controlSnapshot, record.controlSnapshot)) fail('P5_MATERIAL_ACCESS_CONTROL_STALE', 'Material Control changed after handle issuance.');
    }
    if (options.realityVerifier.verifyPhysical(freeze({ snapshot, permission: 'read' })) !== true) {
      fail('P5_MATERIAL_ACCESS_REALITY_STALE', 'Physical filesystem Reality no longer matches the handle.');
    }
    return snapshot;
  }

  function currentWorkspace(record) {
    const snapshot = options.workspaceResolver.resolveMaterial(record.workspaceQuery);
    assertWorkspaceSnapshot(snapshot);
    if (!same(snapshot, record.snapshot)) fail('P5_MATERIAL_ACCESS_WORKSPACE_STALE', 'Workspace material changed after handle issuance.');
    currentFence(record.eventId, record.eventFenceDigest);
    if (options.realityVerifier.verifyWorkspace(freeze({ snapshot, accessScope: record.handle.accessScope })) !== true) {
      fail('P5_MATERIAL_ACCESS_REALITY_STALE', 'Workspace filesystem Reality no longer matches the handle.');
    }
    return snapshot;
  }

  function issuePhysicalRead(request) {
    exact(request, ['basisRef', 'bindingRef', 'eventFenceDigest', 'eventId', 'expiresAtMs', 'ownerDomain', 'ownerScope', 'readScope'], 'P5_MATERIAL_ACCESS_PHYSICAL_REQUEST_SHAPE');
    assertBasis(request.basisRef); assertScope(request.ownerScope, 'ownerScope'); assertLifetime(request.expiresAtMs);
    if (!READ_SCOPES.has(request.readScope)) fail('P5_MATERIAL_ACCESS_PERMISSION', 'Physical handle grants read only.');
    exact(request.bindingRef, ['bindingId', 'bindingRevision', 'materialKey'], 'P5_MATERIAL_ACCESS_BINDING_REF_SHAPE');
    const bindingQuery = freeze({ ownerDomain: request.ownerDomain, ownerScope: request.ownerScope,
      bindingId: request.bindingRef.bindingId, expectedBindingRevision: request.bindingRef.bindingRevision,
      materialKey: request.bindingRef.materialKey });
    const snapshot = options.bindingResolver.resolve(bindingQuery);
    assertBindingSnapshot(snapshot);
    if (snapshot.ownerDomain !== request.ownerDomain || !same(snapshot.ownerScope, request.ownerScope) ||
        snapshot.bindingId !== request.bindingRef.bindingId || snapshot.bindingRevision !== request.bindingRef.bindingRevision ||
        snapshot.identity.materialKey !== request.bindingRef.materialKey || snapshot.basisRevision !== request.basisRef.revision ||
        snapshot.basisDigest !== request.basisRef.digest || !options.pathAuthority.contains(snapshot.containmentRoot, snapshot.location)) {
      fail('P5_MATERIAL_ACCESS_BINDING_MISMATCH', 'Resolved Binding does not match the exact requested owner, identity, containment, or Basis.');
    }
    currentFence(request.eventId, request.eventFenceDigest);
    const controlClaim = freeze({ identity: snapshot.identity, ownerDomain: request.ownerDomain, ownerScope: request.ownerScope });
    let controlSnapshot = null;
    if (snapshot.bindingKind === 'primary') {
      controlSnapshot = options.controlAuthority.resolveCurrent(controlClaim); assertControlSnapshot(controlSnapshot);
      if (controlSnapshot.materialKey !== snapshot.identity.materialKey || controlSnapshot.ownerDomain !== request.ownerDomain ||
          !same(controlSnapshot.ownerScope, request.ownerScope)) fail('P5_MATERIAL_ACCESS_CONTROL_MISMATCH', 'Primary material lacks exact current Control.');
    }
    if (options.realityVerifier.verifyPhysical(freeze({ snapshot, permission: 'read' })) !== true) {
      fail('P5_MATERIAL_ACCESS_REALITY_MISMATCH', 'Physical filesystem Reality does not match the Binding.');
    }
    const handleId = text(options.nextHandleId(), 'handleId');
    const fenceDigest = digest(options.digest(canonical({ eventId: request.eventId, eventFenceDigest: request.eventFenceDigest,
      basisRef: request.basisRef, snapshot, permission: 'read', expiresAtMs: request.expiresAtMs })), 'fenceDigest');
    const handle = freeze({ schemaRef: 'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion: 1, handleId,
      identity: snapshot.identity, ownerDomain: snapshot.ownerDomain, ownerScope: snapshot.ownerScope,
      bindingRevision: snapshot.bindingRevision, endpointId: snapshot.endpointId, location: snapshot.location,
      mountScopeRevision: snapshot.mountScopeRevision, expectedSizeBytes: snapshot.expectedSizeBytes,
      expectedMtimeNs: snapshot.expectedMtimeNs, expectedCtimeNs: snapshot.expectedCtimeNs,
      fingerprintVerifiedAtMs: snapshot.fingerprintVerifiedAtMs, readScope: request.readScope, expiresAtMs: request.expiresAtMs, fenceDigest });
    handles.set(handleId, freeze({ kind: 'physical', handle, snapshot, bindingQuery, controlClaim, controlSnapshot,
      eventId: request.eventId, eventFenceDigest: request.eventFenceDigest, expiresAtMs: request.expiresAtMs }));
    return handle;
  }

  function issueWorkspace(request) {
    exact(request, ['accessScope', 'eventFenceDigest', 'eventId', 'expiresAtMs', 'expectedReferenceRevision', 'materialHandleId',
      'ownerDomain', 'processId', 'workspaceId'], 'P5_MATERIAL_ACCESS_WORKSPACE_REQUEST_SHAPE');
    assertLifetime(request.expiresAtMs);
    if (!WORKSPACE_SCOPES.has(request.accessScope)) fail('P5_MATERIAL_ACCESS_PERMISSION', 'Workspace access scope is invalid.');
    const workspaceQuery = freeze({ workspaceId: request.workspaceId, materialHandleId: request.materialHandleId,
      expectedReferenceRevision: request.expectedReferenceRevision });
    const snapshot = options.workspaceResolver.resolveMaterial(workspaceQuery);
    assertWorkspaceSnapshot(snapshot);
    if (snapshot.ownerDomain !== request.ownerDomain || snapshot.processId !== request.processId ||
        snapshot.workspaceId !== request.workspaceId || snapshot.materialHandleId !== request.materialHandleId ||
        snapshot.referenceRevision !== request.expectedReferenceRevision) {
      fail('P5_MATERIAL_ACCESS_WORKSPACE_MISMATCH', 'Workspace material does not match the exact Owner, Process, or revision.');
    }
    options.pathAuthority.resolveContained(snapshot.rootPath, snapshot.relativePath);
    currentFence(request.eventId, request.eventFenceDigest);
    if (options.realityVerifier.verifyWorkspace(freeze({ snapshot, accessScope: request.accessScope })) !== true) {
      fail('P5_MATERIAL_ACCESS_REALITY_MISMATCH', 'Workspace filesystem Reality does not match the material reference.');
    }
    const handleId = text(options.nextHandleId(), 'handleId');
    const fenceDigest = digest(options.digest(canonical({ eventId: request.eventId, eventFenceDigest: request.eventFenceDigest,
      snapshot, permission: request.accessScope, expiresAtMs: request.expiresAtMs })), 'fenceDigest');
    const handle = freeze({ schemaRef: 'helix://contracts/types/WorkspaceMaterialHandle/v1', schemaVersion: 1, handleId,
      workspaceId: snapshot.workspaceId, ownerDomain: snapshot.ownerDomain, processId: snapshot.processId,
      relativePath: snapshot.relativePath, digestAlgorithm: snapshot.digestAlgorithm, digestHex: snapshot.digestHex,
      sizeBytes: snapshot.sizeBytes, referenceRevision: snapshot.referenceRevision, accessScope: request.accessScope, fenceDigest });
    handles.set(handleId, freeze({ kind: 'workspace', handle, snapshot, workspaceQuery, eventId: request.eventId,
      eventFenceDigest: request.eventFenceDigest, expiresAtMs: request.expiresAtMs }));
    return handle;
  }

  function resolveHandle(handleId, eventId, ownerDomain) {
    const record = handles.get(handleId);
    if (!record || record.eventId !== eventId || record.handle.ownerDomain !== ownerDomain) {
      fail('P5_MATERIAL_ACCESS_HANDLE_SCOPE', 'Material handle is unknown or belongs to another invocation.');
    }
    if (record.expiresAtMs <= options.now()) fail('P5_MATERIAL_ACCESS_HANDLE_EXPIRED', 'Material handle expired.');
    const snapshot = record.kind === 'physical' ? currentPhysical(record) : currentWorkspace(record);
    const sourcePath = record.kind === 'physical' ? snapshot.location : options.pathAuthority.resolveContained(snapshot.rootPath, snapshot.relativePath);
    return { record, snapshot, sourcePath };
  }

  function assertGrantAuthority(operation, request, resolved) {
    const sourceRoots = resolved.map((item) => item.record.kind === 'physical' ? item.snapshot.containmentRoot : item.snapshot.rootPath);
    if (operation.effectClass === 'pure_observation') {
      if (request.workspaceScopeRef !== null || request.targetCommitSlotHandle !== null || request.targetRelativePaths.length ||
          request.approvalHandle !== null || request.authorizationHandle !== null) fail('P5_MATERIAL_ACCESS_PERMISSION_ESCALATION', 'Observation cannot carry mutation authority.');
      return { roots: sourceRoots, targets: [] };
    }
    if (operation.effectClass === 'workspace_write') {
      if (request.workspaceScopeRef === null || request.targetCommitSlotHandle !== null || request.approvalHandle !== null || request.authorizationHandle !== null) {
        fail('P5_MATERIAL_ACCESS_WORKSPACE_AUTHORITY', 'Workspace write requires only its exact Workspace scope.');
      }
      exact(request.workspaceScopeRef, ['ownerDomain', 'processId', 'rootRevision', 'workspaceId'], 'P5_MATERIAL_ACCESS_WORKSPACE_SCOPE_REF_SHAPE');
      const scope = options.workspaceResolver.resolveScope(request.workspaceScopeRef); assertWorkspaceSnapshot(scope, true);
      if (scope.ownerDomain !== request.ownerDomain || scope.processId !== request.workspaceScopeRef.processId ||
          scope.workspaceId !== request.workspaceScopeRef.workspaceId || scope.rootRevision !== request.workspaceScopeRef.rootRevision) {
        fail('P5_MATERIAL_ACCESS_WORKSPACE_SCOPE_STALE', 'Workspace write scope is stale or owned by another process.');
      }
      for (const item of resolved) {
        if (operation.atomId === 'filesystem.workspace.declared-cleanup@1' &&
            (item.record.kind !== 'workspace' || item.record.handle.accessScope !== 'workspace-write' || item.snapshot.workspaceId !== scope.workspaceId)) {
          fail('P5_MATERIAL_ACCESS_PERMISSION_ESCALATION', 'Workspace cleanup requires write handles from the exact Workspace.');
        }
      }
      return { roots: [...sourceRoots, scope.rootPath], targets: request.targetRelativePaths.map((item) => options.pathAuthority.resolveContained(scope.rootPath, item)) };
    }
    if (operation.effectClass === 'material_commit') {
      if (request.ownerDomain !== 'arca' || request.targetCommitSlotHandle === null || request.workspaceScopeRef !== null ||
          request.approvalHandle !== null || request.authorizationHandle !== null) fail('P5_MATERIAL_ACCESS_MATERIAL_COMMIT_AUTHORITY', 'Material commit requires the exact Arca Target Commit Slot.');
      assertTargetSlot(request.targetCommitSlotHandle);
      if (options.targetAuthority.assertCurrent(freeze({ ownerDomain: request.ownerDomain, handle: request.targetCommitSlotHandle })) !== true) {
        fail('P5_MATERIAL_ACCESS_TARGET_STALE', 'Target Commit Slot is stale.');
      }
      const commitAuthority = resolved.map((item) => {
        if (item.record.kind !== 'workspace') fail('P5_MATERIAL_ACCESS_CONTROL_MISMATCH', 'Material commit requires Workspace material input.');
        const snapshot = options.workspaceResolver.resolveCommitAuthority(freeze({
          ownerDomain: request.ownerDomain, handle: item.record.handle, snapshot: item.snapshot
        }));
        exact(snapshot, ['authorityDigest', 'controlRevision', 'materialHandleId', 'ownerDomain'], 'P5_MATERIAL_ACCESS_COMMIT_AUTHORITY_SHAPE');
        digest(snapshot.authorityDigest, 'commitAuthority.authorityDigest'); revision(snapshot.controlRevision, 'commitAuthority.controlRevision');
        if (snapshot.materialHandleId !== item.snapshot.materialHandleId ||
            snapshot.ownerDomain !== request.ownerDomain) fail('P5_MATERIAL_ACCESS_CONTROL_MISMATCH', 'Material commit input lacks current Arca commit authority.');
        return snapshot;
      });
      return { roots: [...sourceRoots, request.targetCommitSlotHandle.slotDirectory], targets: request.targetRelativePaths.map((item) =>
        options.pathAuthority.resolveContained(request.targetCommitSlotHandle.slotDirectory, item)), authoritySlices: commitAuthority };
    }
    if (operation.effectClass === 'destructive_commit') {
      if (request.workspaceScopeRef !== null || request.targetCommitSlotHandle !== null || request.targetRelativePaths.length) {
        fail('P5_MATERIAL_ACCESS_DESTRUCTIVE_SCOPE', 'Destructive commit cannot carry target or Workspace authority.');
      }
      const inputSettlement = operation.operationId === 'ondeck.input-settlement.delete@1';
      if (inputSettlement) {
        if (request.authorizationHandle !== null || request.approvalHandle === null) fail('P5_MATERIAL_ACCESS_APPROVAL_REQUIRED', 'Input Settlement requires its exact Approval.');
        assertApproval(request.approvalHandle);
        if (request.approvalHandle.ownerDomain !== request.ownerDomain || request.approvalHandle.eventId !== request.eventId ||
            options.approvalAuthority.assertCurrent(freeze({ operationId: operation.operationId, handle: request.approvalHandle,
              sourceHandles: resolved.map((item) => item.record.handle), sourceSnapshots: resolved.map((item) => item.snapshot) })) !== true) {
          fail('P5_MATERIAL_ACCESS_APPROVAL_STALE', 'Input Settlement Approval is stale or scoped to another Event.');
        }
      } else {
        if (request.approvalHandle !== null || request.authorizationHandle === null) fail('P5_MATERIAL_ACCESS_AUTHORIZATION_REQUIRED', 'Off-deck deletion requires exact immutable Authorization.');
        assertAuthorization(request.authorizationHandle);
        if (request.authorizationHandle.ownerDomain !== request.ownerDomain ||
            options.authorizationAuthority.assertCurrent(freeze({ operationId: operation.operationId, handle: request.authorizationHandle,
              sourceHandles: resolved.map((item) => item.record.handle), sourceSnapshots: resolved.map((item) => item.snapshot) })) !== true) {
          fail('P5_MATERIAL_ACCESS_AUTHORIZATION_STALE', 'Destructive Authorization is stale or scoped to another operation.');
        }
      }
      for (const item of resolved) {
        const expectedKind = operation.operationId === 'offdeck.related.delete@1' ? 'related' : 'primary';
        if (item.record.kind !== 'physical' || item.snapshot.bindingKind !== expectedKind) {
          fail('P5_MATERIAL_ACCESS_PERMISSION_ESCALATION', 'Destructive operation received an ineligible material kind.');
        }
      }
      return { roots: resolved.map((item) => item.snapshot.containmentRoot), targets: [], authoritySlices: [] };
    }
    fail('P5_MATERIAL_ACCESS_EFFECT_CLASS', 'Operation Effect Class is unsupported.');
  }

  function issueOperationGrant(request) {
    exact(request, ['approvalHandle', 'authorizationHandle', 'eventId', 'expiresAtMs', 'fenceSnapshotDigest', 'operationId',
      'ownerDomain', 'sourceHandleIds', 'targetCommitSlotHandle', 'targetRelativePaths', 'workspaceScopeRef'], 'P5_MATERIAL_ACCESS_GRANT_REQUEST_SHAPE');
    assertLifetime(request.expiresAtMs); currentFence(request.eventId, request.fenceSnapshotDigest);
    const operation = operations.get(request.operationId);
    if (!operation) fail('P5_MATERIAL_ACCESS_OPERATION', 'Material operation is not registered.');
    if (!Array.isArray(request.sourceHandleIds) || !Array.isArray(request.targetRelativePaths) ||
        request.sourceHandleIds.length > operation.maxSourceCount || request.targetRelativePaths.length > operation.maxTargetCount ||
        new Set(request.sourceHandleIds).size !== request.sourceHandleIds.length) fail('P5_MATERIAL_ACCESS_CARDINALITY', 'Operation material cardinality is invalid.');
    if ((operation.maxSourceCount === 1 && request.sourceHandleIds.length !== 1) ||
        (operation.maxSourceCount > 1 && request.sourceHandleIds.length < 1) ||
        (operation.maxTargetCount === 0 && request.targetRelativePaths.length !== 0) ||
        (operation.effectClass !== 'pure_observation' && operation.maxTargetCount > 0 && request.targetRelativePaths.length < 1)) {
      fail('P5_MATERIAL_ACCESS_CARDINALITY', 'Operation does not provide the exact required source/target set.');
    }
    const resolved = request.sourceHandleIds.map((handleId) => resolveHandle(handleId, request.eventId, request.ownerDomain));
    const authority = assertGrantAuthority(operation, request, resolved);
    const sourcePaths = resolved.map((item) => item.sourcePath);
    const controlledRoots = [...new Set([...authority.roots])];
    if (!controlledRoots.length) controlledRoots.push(request.targetCommitSlotHandle.slotDirectory);
    if (options.realityVerifier.verifyOperation(freeze({ operationId: operation.operationId, effectClass: operation.effectClass,
      sourcePaths, targetPaths: authority.targets, controlledRoots, sourceSnapshots: resolved.map((item) => item.snapshot),
      targetCommitSlotHandle: request.targetCommitSlotHandle })) !== true) {
      fail('P5_MATERIAL_ACCESS_REALITY_MISMATCH', 'Operation filesystem Reality failed containment, identity, overlap, or mount validation.');
    }
    const grantId = text(options.nextGrantId(), 'grantId');
    const authoritySlices = authority.authoritySlices || [];
    const authorityDigest = digest(options.digest(canonical({ request, sourceSnapshots: resolved.map((item) => item.snapshot),
      sourcePaths, targetPaths: authority.targets, controlledRoots, authoritySlices })), 'authorityDigest');
    const grant = freeze({ grantId, eventId: request.eventId, ownerDomain: request.ownerDomain, effectClass: operation.effectClass,
      operationId: operation.operationId, sourcePaths, targetPaths: authority.targets, controlledRoots, authorityDigest,
      expiresAtMs: request.expiresAtMs });
    grants.set(grantId, { grant, request: freeze({ ...request }), authoritySlices: freeze(authoritySlices), consumed: false });
    return grant;
  }

  function verify(input) {
    exact(input, ['grant', 'operation', 'request'], 'P5_MATERIAL_ACCESS_VERIFY_SHAPE');
    const record = input.grant && grants.get(input.grant.grantId);
    if (!record || record.consumed || !same(record.grant, input.grant) || record.grant.expiresAtMs <= options.now()) {
      fail('P5_MATERIAL_ACCESS_GRANT_REPLAY', 'Operation Grant is unknown, changed, consumed, or expired.');
    }
    if (input.operation.operationId !== record.grant.operationId || input.request.eventId !== record.grant.eventId ||
        input.request.operationGrant !== input.grant) fail('P5_MATERIAL_ACCESS_GRANT_BINDING', 'Operation Grant is bound to another invocation.');
    currentFence(record.request.eventId, record.request.fenceSnapshotDigest);
    const resolved = record.request.sourceHandleIds.map((handleId) => resolveHandle(handleId, record.request.eventId, record.request.ownerDomain));
    const authority = assertGrantAuthority(input.operation, record.request, resolved);
    if (!same(resolved.map((item) => item.sourcePath), record.grant.sourcePaths) || !same(authority.targets, record.grant.targetPaths) ||
        !same(authority.authoritySlices || [], record.authoritySlices) ||
        options.realityVerifier.verifyOperation(freeze({ operationId: input.operation.operationId, effectClass: input.operation.effectClass,
          sourcePaths: record.grant.sourcePaths, targetPaths: record.grant.targetPaths, controlledRoots: record.grant.controlledRoots,
          sourceSnapshots: resolved.map((item) => item.snapshot), targetCommitSlotHandle: record.request.targetCommitSlotHandle })) !== true) {
      fail('P5_MATERIAL_ACCESS_GRANT_STALE', 'Operation authority changed before the protected effect.');
    }
    record.consumed = true;
    return true;
  }

  return Object.freeze({ issueOperationGrant, issuePhysicalRead, issueWorkspace, verify });
}

module.exports = Object.freeze({ MaterialAccessAuthorityError, createMaterialAccessAuthority });
