'use strict';

const { digest } = require('./ddl-compiler');
const { createRepositoryDefinition } = require('./owner-repository');

const SHA256 = /^[0-9a-f]{64}$/;
const OPERATIONS = new Set(['acquire', 'transfer', 'release', 'replace_control_set']);

class MaterialControlError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MaterialControlError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MaterialControlError(code, message, details);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha(value, field) {
  if (!SHA256.test(value || '')) fail('P3_CONTROL_INVALID_DIGEST', 'Material Control digest must be lowercase SHA-256.', { field });
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P3_CONTROL_INVALID_FIELD', 'Material Control field is required.', { field });
  return value;
}

function materialKey(identity) {
  if (!identity || identity.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v1' || identity.schemaVersion !== 1 ||
      identity.contentHashAlgorithm !== 'sha256') fail('P3_CONTROL_INVALID_IDENTITY', 'Physical Material Identity contract is invalid.');
  text(identity.mountScopeId, 'mountScopeId');
  text(identity.inode, 'inode');
  sha(identity.contentHash, 'contentHash');
  return digest(canonicalJson({
    mountScopeId: identity.mountScopeId,
    inode: identity.inode,
    contentHashAlgorithm: identity.contentHashAlgorithm,
    contentHash: identity.contentHash
  }));
}

function scopeProjection(change) {
  return {
    action: change.action,
    materialKey: change.identity.materialKey,
    expectedRevision: change.expectedRevision,
    fromOwnerDomain: change.fromScope && change.fromScope.ownerDomain || null,
    fromScopeType: change.fromScope && change.fromScope.scopeType || null,
    fromScopeId: change.fromScope && change.fromScope.scopeId || null,
    toOwnerDomain: change.toScope && change.toScope.ownerDomain || null,
    toScopeType: change.toScope && change.toScope.scopeType || null,
    toScopeId: change.toScope && change.toScope.scopeId || null
  };
}

function controlScopeDigest(changes) {
  return digest(canonicalJson(changes.map(scopeProjection).sort((left, right) => left.materialKey.localeCompare(right.materialKey))));
}

function repository(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'material_control', owner: 'material-control-authority', schemaManifest,
    statements: {
      find_current: {
        kind: 'select-one', tableId: 'fx_material_controls',
        columns: ['material_key', 'mount_scope_id', 'inode', 'content_hash_algorithm', 'content_hash', 'owner_domain',
          'owner_scope_type', 'owner_scope_id', 'control_revision', 'state', 'updated_at_ms'],
        keyColumns: ['material_key']
      },
      insert_current: {
        kind: 'insert', tableId: 'fx_material_controls',
        columns: ['material_key', 'mount_scope_id', 'inode', 'content_hash_algorithm', 'content_hash', 'owner_domain',
          'owner_scope_type', 'owner_scope_id', 'control_revision', 'state', 'updated_at_ms']
      },
      cas_current: {
        kind: 'update', tableId: 'fx_material_controls',
        setColumns: ['owner_domain', 'owner_scope_type', 'owner_scope_id', 'control_revision', 'state', 'updated_at_ms'],
        keyColumns: ['material_key'],
        compareColumns: [{ column: 'control_revision', parameter: 'expected_control_revision' }]
      },
      insert_revision: {
        kind: 'insert', tableId: 'fx_material_control_revisions',
        columns: ['material_key', 'revision', 'operation_kind', 'from_owner_domain', 'from_scope_type', 'from_scope_id',
          'to_owner_domain', 'to_scope_type', 'to_scope_id', 'basis_digest', 'commit_marker', 'committed_at_ms']
      }
    }
  });
}

function assertScope(scope, field) {
  if (!scope) fail('P3_CONTROL_SCOPE_REQUIRED', 'Material Control scope is required.', { field });
  text(scope.ownerDomain, field + '.ownerDomain');
  text(scope.scopeType, field + '.scopeType');
  text(scope.scopeId, field + '.scopeId');
}

function assertHandle(handle, changes) {
  if (!handle || handle.schemaRef !== 'helix://contracts/types/ResponsibilityControlCommitHandle/v1' || handle.schemaVersion !== 1 ||
      !OPERATIONS.has(handle.operationKind) || !Array.isArray(handle.expectedControlRevisions) || !Array.isArray(changes) || changes.length === 0) {
    fail('P3_CONTROL_INVALID_HANDLE', 'Responsibility Control Commit Handle is invalid.');
  }
  for (const field of ['handleId', 'ownerDomain', 'processType', 'processId', 'receiptContract', 'eventFenceDigest']) text(handle[field], field);
  for (const field of ['basisDigest', 'canonicalFactSetDigest', 'bindingSetDigest', 'controlScopeDigest', 'eventFenceDigest']) sha(handle[field], field);
  if (!handle.basisRef || !Number.isSafeInteger(handle.basisRef.revision) || handle.basisRef.revision < 1) fail(
    'P3_CONTROL_INVALID_BASIS_REF', 'Control Handle requires a revisioned Basis reference.'
  );
  text(handle.basisRef.objectType, 'basisRef.objectType');
  text(handle.basisRef.objectId, 'basisRef.objectId');
  sha(handle.basisRef.digest, 'basisRef.digest');
  if (handle.operationKind === 'transfer') {
    text(handle.receivingDomain, 'receivingDomain');
    text(handle.transferPoint, 'transferPoint');
  } else if (handle.receivingDomain !== undefined || handle.transferPoint !== undefined) {
    fail('P3_CONTROL_ILLEGAL_TRANSFER_FIELDS', 'Only cross-Domain transfer may carry receivingDomain and transferPoint.');
  }
  for (const change of changes) {
    if (!change || !change.identity || !SHA256.test(change.identity.materialKey || '') ||
        !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0 || !['acquire', 'transfer', 'release'].includes(change.action)) {
      fail('P3_CONTROL_INVALID_CHANGE', 'Control change identity, action, and expected revision are required.');
    }
  }
  for (const item of handle.expectedControlRevisions) {
    if (!item || !SHA256.test(item.materialKey || '') || !Number.isSafeInteger(item.revision) || item.revision < 0) fail(
      'P3_CONTROL_INVALID_EXPECTED_REVISION', 'Expected Control revision entry is invalid.'
    );
  }
  const expected = [...handle.expectedControlRevisions].sort((left, right) => left.materialKey.localeCompare(right.materialKey));
  const projected = changes.map((change) => ({ materialKey: change.identity && change.identity.materialKey, revision: change.expectedRevision }))
    .sort((left, right) => left.materialKey.localeCompare(right.materialKey));
  if (expected.length !== changes.length || new Set(expected.map((item) => item.materialKey)).size !== expected.length ||
      canonicalJson(expected) !== canonicalJson(projected)) fail('P3_CONTROL_EXPECTED_SET_MISMATCH', 'Expected Control revisions do not exactly cover the change set.');
  if (controlScopeDigest(changes) !== handle.controlScopeDigest) fail('P3_CONTROL_SCOPE_DIGEST_MISMATCH', 'Control scope digest does not match the exact change set.');
}

function createMaterialControlParticipant(options) {
  if (!options || !options.schemaManifest) fail('P3_CONTROL_INVALID_PARTICIPANT', 'Schema manifest is required.');
  assertHandle(options.handle, options.changes);
  const handle = options.handle;
  const changes = options.changes;
  const definition = repository(options.schemaManifest);
  const boundBusinessOwner = handle.operationKind === 'transfer' ? handle.receivingDomain : handle.ownerDomain;
  return Object.freeze({
    participantId: options.participantId || 'material_control',
    owner: 'material-control-authority',
    boundBusinessOwner,
    repositories: [definition],
    execute(context) {
      const control = context.repository('material_control');
      const results = [];
      for (const change of [...changes].sort((left, right) => left.identity.materialKey.localeCompare(right.identity.materialKey))) {
        if (materialKey(change.identity) !== change.identity.materialKey) fail('P3_CONTROL_MATERIAL_KEY_MISMATCH', 'materialKey does not match the canonical Physical Material tuple.');
        if (!['acquire', 'transfer', 'release'].includes(change.action) ||
            (handle.operationKind !== 'replace_control_set' && change.action !== handle.operationKind)) {
          fail('P3_CONTROL_OPERATION_MISMATCH', 'Control change action is incompatible with the Handle operation.');
        }
        const current = control.invoke('find_current', { material_key: change.identity.materialKey });
        if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0 ||
            (current ? current.control_revision : 0) !== change.expectedRevision) {
          fail('P3_CONTROL_CAS_CONFLICT', 'Material Control expected revision is stale.', { materialKey: change.identity.materialKey });
        }
        let from = change.fromScope || null;
        let to = change.toScope || null;
        if (change.action === 'acquire') {
          assertScope(to, 'toScope');
          if (from || to.ownerDomain !== handle.ownerDomain || current && current.state !== 'released') fail(
            'P3_CONTROL_ACQUIRE_PRECONDITION', 'Acquire requires no active Control and a target owned by the Handle Domain.'
          );
        } else {
          assertScope(from, 'fromScope');
          if (!current || current.state !== 'active' || current.owner_domain !== from.ownerDomain ||
              current.owner_scope_type !== from.scopeType || current.owner_scope_id !== from.scopeId || from.ownerDomain !== handle.ownerDomain) {
            fail('P3_CONTROL_FROM_SCOPE_MISMATCH', 'Current Control does not match the exact signed source scope.');
          }
          if (change.action === 'transfer') {
            assertScope(to, 'toScope');
            const expectedTarget = handle.operationKind === 'transfer' ? handle.receivingDomain : handle.ownerDomain;
            if (to.ownerDomain !== expectedTarget) fail('P3_CONTROL_TRANSFER_TARGET_MISMATCH', 'Transfer target is outside the signed receiving scope.');
          } else if (to) fail('P3_CONTROL_RELEASE_TARGET_FORBIDDEN', 'Release cannot carry a target scope.');
        }
        const revision = change.expectedRevision + 1;
        if (!current) {
          control.invoke('insert_current', {
            material_key: change.identity.materialKey,
            mount_scope_id: change.identity.mountScopeId,
            inode: change.identity.inode,
            content_hash_algorithm: change.identity.contentHashAlgorithm,
            content_hash: change.identity.contentHash,
            owner_domain: to.ownerDomain,
            owner_scope_type: to.scopeType,
            owner_scope_id: to.scopeId,
            control_revision: revision,
            state: 'active',
            updated_at_ms: context.commitTimeMs
          });
        } else {
          const update = control.invoke('cas_current', {
            owner_domain: to && to.ownerDomain || null,
            owner_scope_type: to && to.scopeType || null,
            owner_scope_id: to && to.scopeId || null,
            control_revision: revision,
            state: change.action === 'release' ? 'released' : 'active',
            updated_at_ms: context.commitTimeMs,
            material_key: change.identity.materialKey,
            expected_control_revision: change.expectedRevision
          });
          if (update.changes !== 1) fail('P3_CONTROL_CAS_CONFLICT', 'Material Control CAS update lost its expected revision.');
        }
        control.invoke('insert_revision', {
          material_key: change.identity.materialKey,
          revision,
          operation_kind: change.action,
          from_owner_domain: from && from.ownerDomain || null,
          from_scope_type: from && from.scopeType || null,
          from_scope_id: from && from.scopeId || null,
          to_owner_domain: to && to.ownerDomain || null,
          to_scope_type: to && to.scopeType || null,
          to_scope_id: to && to.scopeId || null,
          basis_digest: handle.basisDigest,
          commit_marker: text(options.commitMarker, 'commitMarker'),
          committed_at_ms: context.commitTimeMs
        });
        results.push(Object.freeze({ materialKey: change.identity.materialKey, revision, state: change.action === 'release' ? 'released' : 'active' }));
      }
      return Object.freeze(results);
    }
  });
}

module.exports = Object.freeze({ MaterialControlError, controlScopeDigest, createMaterialControlParticipant, materialKey });
