'use strict';

const { createRepositoryDefinition } = require('../../foundation/persistence/owner-repository');
const { createMountScopeRevision, createWorkspaceRoot } = require('../model/location-contracts');

class LocationRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocationRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new LocationRepositoryError(code, message, details); }

function createLocationRegistryRepository(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P5_LOCATION_REPOSITORY_DEPENDENCIES', 'Schema manifest and Platform unit of work are required.');
  }
  const definition = createRepositoryDefinition({
    repositoryId: 'platform_location_registry', owner: 'platform-settings', schemaManifest: options.schemaManifest,
    statements: {
      insert_mount_head: { kind: 'insert', tableId: 'platform_mount_scopes', columns: ['mount_scope_id', 'status', 'created_at_ms'] },
      insert_mount_revision: { kind: 'insert', tableId: 'platform_mount_scope_revisions', columns: [
        'mount_scope_id', 'revision', 'endpoint_id', 'mount_boundary', 'filesystem_type', 'stable_mount_fingerprint',
        'inode_capability_digest', 'probe_evidence_digest', 'effective_at_ms'
      ] },
      initialize_mount_head: { kind: 'update', tableId: 'platform_mount_scopes', setColumns: ['current_revision'], keyColumns: ['mount_scope_id'] },
      advance_mount_head: { kind: 'update', tableId: 'platform_mount_scopes', setColumns: ['current_revision'], keyColumns: ['mount_scope_id'],
        compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] },
      find_mount_head: { kind: 'select-one', tableId: 'platform_mount_scopes',
        columns: ['mount_scope_id', 'status', 'current_revision', 'created_at_ms', 'terminal_at_ms'], keyColumns: ['mount_scope_id'] },
      list_mount_heads: { kind: 'select-all', tableId: 'platform_mount_scopes',
        columns: ['mount_scope_id', 'status', 'current_revision', 'created_at_ms', 'terminal_at_ms'] },
      find_mount_revision: { kind: 'select-one', tableId: 'platform_mount_scope_revisions', columns: [
        'mount_scope_id', 'revision', 'endpoint_id', 'mount_boundary', 'filesystem_type', 'stable_mount_fingerprint',
        'inode_capability_digest', 'probe_evidence_digest', 'effective_at_ms'
      ], keyColumns: ['mount_scope_id', 'revision'] },
      insert_workspace_root: { kind: 'insert', tableId: 'platform_workspace_roots', columns: [
        'root_id', 'owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id', 'mount_scope_revision', 'resolved_root',
        'config_revision', 'capability_digest', 'state', 'root_handle_ref', 'snapshot_digest', 'updated_at_ms'
      ] },
      update_workspace_root: { kind: 'update', tableId: 'platform_workspace_roots',
        setColumns: ['owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id', 'mount_scope_revision', 'resolved_root',
          'config_revision', 'capability_digest', 'state', 'root_handle_ref', 'snapshot_digest', 'updated_at_ms'],
        keyColumns: ['root_id'], compareColumns: [{ column: 'config_revision', parameter: 'expected_config_revision' }] },
      find_workspace_root: { kind: 'select-one', tableId: 'platform_workspace_roots', columns: [
        'root_id', 'owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id', 'mount_scope_revision', 'resolved_root',
        'config_revision', 'capability_digest', 'state', 'root_handle_ref', 'snapshot_digest', 'updated_at_ms'
      ], keyColumns: ['root_id'] },
      list_workspace_roots: { kind: 'select-all', tableId: 'platform_workspace_roots', columns: [
        'root_id', 'owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id', 'mount_scope_revision', 'resolved_root',
        'config_revision', 'capability_digest', 'state', 'root_handle_ref', 'snapshot_digest', 'updated_at_ms'
      ] }
    }
  });

  function execute(body) {
    return options.unitOfWork.execute([{
      participantId: 'platform_location_registry', owner: 'platform-settings', repositories: [definition], execute: body
    }]).platform_location_registry;
  }
  const mapRevision = (row) => row && createMountScopeRevision({
    mountScopeId: row.mount_scope_id, revision: row.revision, endpointId: row.endpoint_id,
    mountBoundary: row.mount_boundary, filesystemType: row.filesystem_type,
    stableMountFingerprint: row.stable_mount_fingerprint, inodeCapabilityDigest: row.inode_capability_digest,
    probeEvidenceDigest: row.probe_evidence_digest, effectiveAtMs: row.effective_at_ms
  });
  const mapRoot = (row) => row && createWorkspaceRoot({
    rootId: row.root_id, ownerScope: row.owner_scope, rootKind: row.root_kind, resolvedRoot: row.resolved_root,
    endpointId: row.endpoint_id, mountScopeId: row.mount_scope_id, mountScopeRevision: row.mount_scope_revision,
    configRevision: row.config_revision, capabilityDigest: row.capability_digest, state: row.state,
    rootHandleRef: row.root_handle_ref, snapshotDigest: row.snapshot_digest, updatedAtMs: row.updated_at_ms
  });

  return Object.freeze({
    publishMountScope(revision, validateCurrentSet) {
      const item = createMountScopeRevision(revision);
      return execute((context) => {
        const repository = context.repository(definition.repositoryId);
        const head = repository.invoke('find_mount_head', { mount_scope_id: item.mountScopeId });
        const current = head && mapRevision(repository.invoke('find_mount_revision', {
          mount_scope_id: head.mount_scope_id, revision: head.current_revision
        }));
        const active = repository.invoke('list_mount_heads').filter((candidate) => candidate.status === 'active').map((candidate) =>
          mapRevision(repository.invoke('find_mount_revision', {
            mount_scope_id: candidate.mount_scope_id, revision: candidate.current_revision
          }))).filter(Boolean);
        validateCurrentSet(Object.freeze(active), current);
        if (!head) {
          if (item.revision !== 1) fail('P5_MOUNT_SCOPE_INITIAL_REVISION', 'A new Mount Scope must start at revision 1.');
          repository.invoke('insert_mount_head', {
            mount_scope_id: item.mountScopeId, status: 'active', created_at_ms: context.commitTimeMs
          });
          repository.invoke('insert_mount_revision', toRevisionRow(item));
          const initialized = repository.invoke('initialize_mount_head', {
            current_revision: item.revision, mount_scope_id: item.mountScopeId
          });
          if (initialized.changes !== 1) fail('P5_MOUNT_SCOPE_INITIALIZE_FAILED', 'Mount Scope head initialization failed.');
        } else {
          if (head.status !== 'active' || item.revision !== head.current_revision + 1) {
            fail('P5_MOUNT_SCOPE_REVISION_CONFLICT', 'Mount Scope revision does not advance the active current head.');
          }
          repository.invoke('insert_mount_revision', toRevisionRow(item));
          const advanced = repository.invoke('advance_mount_head', {
            current_revision: item.revision, mount_scope_id: item.mountScopeId,
            expected_current_revision: head.current_revision
          });
          if (advanced.changes !== 1) fail('P5_MOUNT_SCOPE_REVISION_CONFLICT', 'Mount Scope current revision changed concurrently.');
        }
        return item;
      });
    },
    getMountScope(mountScopeId) {
      return execute((context) => {
        const repository = context.repository(definition.repositoryId);
        const head = repository.invoke('find_mount_head', { mount_scope_id: mountScopeId });
        if (!head || head.status !== 'active') return undefined;
        return mapRevision(repository.invoke('find_mount_revision', {
          mount_scope_id: head.mount_scope_id, revision: head.current_revision
        }));
      });
    },
    publishWorkspaceRoot(root, expectedConfigRevision, validateCurrentSet) {
      const item = createWorkspaceRoot(root);
      return execute((context) => {
        const repository = context.repository(definition.repositoryId);
        const existing = repository.invoke('find_workspace_root', { root_id: item.rootId });
        const all = repository.invoke('list_workspace_roots').map(mapRoot);
        validateCurrentSet(Object.freeze(all), existing && mapRoot(existing));
        if (!existing) {
          if (expectedConfigRevision !== null || item.configRevision !== 1) {
            fail('P5_WORKSPACE_ROOT_INITIAL_REVISION', 'A new Workspace Root must start at revision 1 without an expected revision.');
          }
          repository.invoke('insert_workspace_root', toRootRow(item));
        } else {
          if (expectedConfigRevision !== existing.config_revision || item.configRevision !== existing.config_revision + 1) {
            fail('P5_WORKSPACE_ROOT_REVISION_CONFLICT', 'Workspace Root revision does not advance the current row.');
          }
          const updated = repository.invoke('update_workspace_root', {
            ...toRootRow(item), expected_config_revision: expectedConfigRevision
          });
          if (updated.changes !== 1) fail('P5_WORKSPACE_ROOT_REVISION_CONFLICT', 'Workspace Root changed concurrently.');
        }
        return item;
      });
    },
    getWorkspaceRoot(rootId) {
      return execute((context) => mapRoot(context.repository(definition.repositoryId).invoke('find_workspace_root', { root_id: rootId })));
    },
    listWorkspaceRoots() {
      return execute((context) => Object.freeze(context.repository(definition.repositoryId)
        .invoke('list_workspace_roots').map(mapRoot)));
    }
  });
}

function toRevisionRow(item) {
  return {
    mount_scope_id: item.mountScopeId, revision: item.revision, endpoint_id: item.endpointId,
    mount_boundary: item.mountBoundary, filesystem_type: item.filesystemType,
    stable_mount_fingerprint: item.stableMountFingerprint, inode_capability_digest: item.inodeCapabilityDigest,
    probe_evidence_digest: item.probeEvidenceDigest, effective_at_ms: item.effectiveAtMs
  };
}
function toRootRow(item) {
  return {
    root_id: item.rootId, owner_scope: item.ownerScope, root_kind: item.rootKind, resolved_root: item.resolvedRoot,
    endpoint_id: item.endpointId, mount_scope_id: item.mountScopeId, mount_scope_revision: item.mountScopeRevision,
    config_revision: item.configRevision, capability_digest: item.capabilityDigest, state: item.state,
    root_handle_ref: item.rootHandleRef, snapshot_digest: item.snapshotDigest,
    updated_at_ms: item.updatedAtMs
  };
}

module.exports = Object.freeze({ LocationRepositoryError, createLocationRegistryRepository });
