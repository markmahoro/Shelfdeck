'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('./helix/contracts/canonical-json');
const { createRepositoryDefinition } = require('./helix/foundation/persistence/owner-repository');

class CleanWorkspaceProductPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanWorkspaceProductPortError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanWorkspaceProductPortError(code, message, details);
}

function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value) ||
      value.split('/').some((item) => !item || item === '.' || item === '..')) {
    fail('CLEAN_WORKSPACE_PATH_INVALID', 'Workspace Product path must be canonical and root-relative.');
  }
  return value;
}

function digestBytes(bytes) {
  return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
}

function definitions(schemaManifest) {
  return Object.freeze({
    platform: createRepositoryDefinition({
      repositoryId: 'clean_workspace_product_platform',
      owner: 'platform-settings',
      schemaManifest,
      statements: {
        find_root: {
          kind: 'select-one',
          tableId: 'platform_workspace_roots',
          columns: [
            'root_id', 'owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id',
            'mount_scope_revision', 'resolved_root', 'config_revision', 'capability_digest',
            'state', 'root_handle_ref', 'snapshot_digest',
          ],
          keyColumns: ['root_id'],
          safeIntegers: true,
        },
        insert_root: {
          kind: 'insert',
          tableId: 'platform_workspace_roots',
          columns: [
            'root_id', 'owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id',
            'mount_scope_revision', 'resolved_root', 'config_revision', 'capability_digest',
            'state', 'root_handle_ref', 'snapshot_digest', 'updated_at_ms',
          ],
        },
      },
    }),
    foundation: createRepositoryDefinition({
      repositoryId: 'clean_workspace_product_foundation',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        find_effect: {
          kind: 'select-one',
          tableId: 'fx_effect_journal',
          columns: [
            'effect_id', 'effect_class', 'idempotency_key', 'intent_digest', 'state',
            'external_receipt_ref', 'output_digest', 'verified_at_ms', 'updated_at_ms',
          ],
          keyColumns: ['effect_class', 'idempotency_key'],
          safeIntegers: true,
        },
        insert_effect: {
          kind: 'insert',
          tableId: 'fx_effect_journal',
          columns: [
            'effect_id', 'event_attempt_id', 'effect_class', 'idempotency_key',
            'intent_digest', 'state', 'external_receipt_ref', 'output_digest',
            'verified_at_ms', 'updated_at_ms',
          ],
        },
        commit_effect: {
          kind: 'update',
          tableId: 'fx_effect_journal',
          setColumns: [
            'state', 'external_receipt_ref', 'output_digest', 'verified_at_ms', 'updated_at_ms',
          ],
          keyColumns: ['effect_id'],
          compareColumns: [
            { column: 'state', parameter: 'expected_state' },
            { column: 'intent_digest', parameter: 'expected_intent_digest' },
          ],
        },
        reclaim_material: {
          kind: 'update',
          tableId: 'fx_workspace_materials',
          setColumns: [
            'state', 'reclaimed_effect_id', 'reclaimed_effect_receipt_digest',
            'reclaimed_at_ms',
          ],
          keyColumns: ['workspace_id', 'material_handle_id'],
          compareColumns: [
            { column: 'state', parameter: 'expected_state' },
            { column: 'handle_digest', parameter: 'expected_handle_digest' },
            { column: 'fence_digest', parameter: 'expected_fence_digest' },
          ],
        },
        find_material: {
          kind: 'select-one',
          tableId: 'fx_workspace_materials',
          columns: [
            'workspace_id', 'material_handle_id', 'material_key', 'endpoint_id',
            'mount_scope_id', 'inode', 'content_hash_algorithm', 'content_hash',
            'relative_path', 'digest_algorithm', 'digest_hex', 'size_bytes',
            'reference_revision', 'owner_domain', 'process_id', 'root_handle_ref',
            'access_scope', 'handle_schema_ref', 'handle_json', 'handle_digest',
            'fence_digest', 'state',
          ],
          keyColumns: ['workspace_id', 'material_handle_id'],
          safeIntegers: true,
        },
        insert_material: {
          kind: 'insert',
          tableId: 'fx_workspace_materials',
          columns: [
            'workspace_id', 'material_handle_id', 'material_key', 'endpoint_id',
            'mount_scope_id', 'inode', 'content_hash_algorithm', 'content_hash',
            'relative_path', 'digest_algorithm', 'digest_hex', 'size_bytes',
            'reference_revision', 'owner_domain', 'process_id', 'root_handle_ref',
            'access_scope', 'handle_schema_ref', 'handle_json', 'handle_digest',
            'fence_digest', 'state',
          ],
        },
        find_artifact: {
          kind: 'select-one',
          tableId: 'fx_artifact_registry',
          columns: [
            'artifact_handle_id', 'artifact_kind', 'owner_domain', 'owner_scope_type',
            'owner_scope_id', 'storage_ref', 'digest_algorithm', 'digest_hex',
            'size_bytes', 'media_type', 'provenance_ref', 'reference_revision', 'state',
          ],
          keyColumns: ['artifact_handle_id'],
          safeIntegers: true,
        },
        insert_artifact: {
          kind: 'insert',
          tableId: 'fx_artifact_registry',
          columns: [
            'artifact_handle_id', 'artifact_kind', 'owner_domain', 'owner_scope_type',
            'owner_scope_id', 'storage_ref', 'digest_algorithm', 'digest_hex',
            'size_bytes', 'media_type', 'provenance_ref', 'reference_revision',
            'state', 'created_at_ms',
          ],
        },
      },
    }),
  });
}

function rootSnapshot(value) {
  const basis = {
    rootId: value.rootId,
    ownerScope: 'libra',
    rootKind: 'production-workspace',
    endpointId: value.endpointId,
    mountScopeId: value.mountScopeId,
    mountScopeRevision: 1,
    configRevision: 1,
    capabilityDigest: value.capabilityDigest,
    state: 'active',
    rootHandleRef: value.rootHandleRef,
  };
  return Object.freeze({ ...basis, snapshotDigest: canonicalDigest(basis) });
}

function mapMaterial(row) {
  if (!row) return null;
  let handle;
  try {
    handle = JSON.parse(row.handle_json);
  } catch {
    fail('CLEAN_WORKSPACE_MATERIAL_CORRUPT', 'Stored Workspace Material Handle is corrupt.');
  }
  if (canonicalDigest(handle) !== row.handle_digest || handle.fenceDigest !== row.fence_digest) {
    fail('CLEAN_WORKSPACE_MATERIAL_CORRUPT', 'Stored Workspace Material Handle digest drifted.');
  }
  return Object.freeze(handle);
}

function mapArtifact(row) {
  if (!row) return null;
  let provenanceRef;
  try {
    provenanceRef = JSON.parse(row.provenance_ref);
  } catch {
    fail('CLEAN_WORKSPACE_ARTIFACT_CORRUPT', 'Stored Artifact provenance is corrupt.');
  }
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ArtifactHandle/v1',
    schemaVersion: 1,
    artifactHandleId: row.artifact_handle_id,
    artifactKind: row.artifact_kind,
    ownerDomain: row.owner_domain,
    ownerScope: Object.freeze({
      scopeType: row.owner_scope_type,
      scopeId: row.owner_scope_id,
    }),
    storageRef: row.storage_ref,
    digestAlgorithm: row.digest_algorithm,
    digestHex: row.digest_hex,
    sizeBytes: Number(row.size_bytes),
    mediaType: row.media_type,
    provenanceRef,
    referenceRevision: Number(row.reference_revision),
  });
}

function createCleanWorkspaceProductPort(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      typeof options.rootPath !== 'string' || !options.rootPath) {
    fail('CLEAN_WORKSPACE_PORT_DEPENDENCIES',
      'Workspace Product Port requires clean persistence and a service-owned root.');
  }
  const repositories = definitions(options.schemaManifest);
  const absoluteRoot = path.resolve(options.rootPath);
  const rootId = 'service-libra-production-workspace';
  const endpointId = 'service-local-workspace';
  const mountScopeId = canonicalDigest({
    schema: 'platform.local-workspace-mount-scope@1',
    rootId,
  });
  const capabilityDigest = canonicalDigest({
    schema: 'platform.local-workspace-capability@1',
    operations: ['atomic_replace', 'read', 'stat'],
  });
  const rootHandleRef = canonicalDigest({
    schema: 'platform.workspace-root-handle@1',
    rootId,
    endpointId,
    mountScopeId,
    mountScopeRevision: 1,
    configRevision: 1,
    capabilityDigest,
  });
  const snapshot = rootSnapshot({
    rootId, endpointId, mountScopeId, capabilityDigest, rootHandleRef,
  });

  const execute = (participantId, owner, repository, body) =>
    options.unitOfWork.execute([{
      participantId,
      owner,
      repositories: [repository],
      execute: body,
    }])[participantId];

  function ensureRoot() {
    fs.mkdirSync(absoluteRoot, { recursive: true });
    return execute('clean_workspace_root_ensure', 'platform-settings', repositories.platform, (context) => {
      const repo = context.repository(repositories.platform.repositoryId);
      const existing = repo.invoke('find_root', { root_id: rootId });
      if (existing) {
        if (existing.resolved_root !== absoluteRoot ||
            existing.snapshot_digest !== snapshot.snapshotDigest ||
            existing.state !== 'active') {
          fail('CLEAN_WORKSPACE_ROOT_CONFLICT',
            'Configured Workspace root conflicts with its durable Platform snapshot.');
        }
        return snapshot;
      }
      repo.invoke('insert_root', {
        root_id: rootId,
        owner_scope: 'libra',
        root_kind: 'production-workspace',
        endpoint_id: endpointId,
        mount_scope_id: mountScopeId,
        mount_scope_revision: 1,
        resolved_root: absoluteRoot,
        config_revision: 1,
        capability_digest: capabilityDigest,
        state: 'active',
        root_handle_ref: rootHandleRef,
        snapshot_digest: snapshot.snapshotDigest,
        updated_at_ms: context.commitTimeMs,
      });
      return snapshot;
    });
  }

  function observeSpace(request) {
    const root = ensureRoot();
    if (!request || request.rootId !== root.rootId ||
        request.rootSnapshotDigest !== root.snapshotDigest ||
        !Number.isSafeInteger(request.requiredBytes) || request.requiredBytes < 0 ||
        !Number.isSafeInteger(request.observedAtMs) || request.observedAtMs < 0) {
      fail('CLEAN_WORKSPACE_SPACE_INPUT',
        'Workspace space observation must bind the exact Platform root and request.');
    }
    const statistics = fs.statfsSync(absoluteRoot, { bigint: true });
    const available = statistics.bavail * statistics.bsize;
    const availableBytes = available > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(available);
    const basis = {
      evidenceId: canonicalDigest({
        schema: 'platform.workspace-space-admission-evidence-id@1',
        requestDigest: request.requestDigest,
        rootSnapshotDigest: root.snapshotDigest,
        observedAtMs: request.observedAtMs,
      }),
      authorityRef: 'platform.workspace-space-admission@1',
      requestDigest: request.requestDigest,
      workspaceId: request.workspaceId,
      libraRunId: request.libraRunId,
      rootId: root.rootId,
      rootSnapshotDigest: root.snapshotDigest,
      requiredBytes: request.requiredBytes,
      availableBytes,
      observedAtMs: request.observedAtMs,
      expiresAtMs: request.observedAtMs + 30000,
      result: availableBytes >= request.requiredBytes ? 'admitted' : 'rejected',
    };
    if (basis.result !== 'admitted') {
      fail('CLEAN_WORKSPACE_SPACE_UNAVAILABLE',
        'The configured Workspace root does not have the required free space.');
    }
    return Object.freeze({ ...basis, evidenceDigest: canonicalDigest(basis) });
  }

  function exactReality(target, expectedDigest, expectedSize) {
    if (!fs.existsSync(target)) return false;
    const bytes = fs.readFileSync(target);
    return bytes.length === expectedSize && digestBytes(bytes) === expectedDigest;
  }

  function recordIntent(effectId, idempotencyKey, intentDigest) {
    return execute('clean_workspace_effect_intent', 'execution-foundation', repositories.foundation, (context) => {
      const repo = context.repository(repositories.foundation.repositoryId);
      const existing = repo.invoke('find_effect', {
        effect_class: 'libra_workspace_product_materialize',
        idempotency_key: idempotencyKey,
      });
      if (existing) {
        if (existing.effect_id !== effectId || existing.intent_digest !== intentDigest) {
          fail('CLEAN_WORKSPACE_EFFECT_CONFLICT', 'Effect idempotency key binds another intent.');
        }
        return Object.freeze({
          state: existing.state,
          outputDigest: existing.output_digest,
        });
      }
      repo.invoke('insert_effect', {
        effect_id: effectId,
        event_attempt_id: null,
        effect_class: 'libra_workspace_product_materialize',
        idempotency_key: idempotencyKey,
        intent_digest: intentDigest,
        state: 'intended',
        external_receipt_ref: null,
        output_digest: null,
        verified_at_ms: null,
        updated_at_ms: context.commitTimeMs,
      });
      return Object.freeze({ state: 'intended', outputDigest: null });
    });
  }

  function materializeArtifact(request) {
    const root = ensureRoot();
    const relativePath = relative(request?.relativePath);
    const bytes = Buffer.isBuffer(request?.bytes)
      ? request.bytes
      : Buffer.from(request?.bytes || '');
    if (!bytes.length || !['nfo', 'poster', 'fanart'].includes(request?.artifactKind) ||
        typeof request.libraRunId !== 'string' || !request.libraRunId ||
        typeof request.workspaceId !== 'string' || !request.workspaceId) {
      fail('CLEAN_WORKSPACE_EFFECT_INPUT', 'Workspace Artifact effect input is incomplete.');
    }
    const digestHex = digestBytes(bytes);
    const intent = {
      schema: 'libra.workspace-artifact-materialize-intent@1',
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      rootSnapshotDigest: root.snapshotDigest,
      relativePath,
      artifactKind: request.artifactKind,
      mediaType: request.mediaType,
      digestAlgorithm: 'sha256',
      digestHex,
      sizeBytes: bytes.length,
      provenanceRef: request.provenanceRef,
    };
    const intentDigest = canonicalDigest(intent);
    const idempotencyKey = canonicalDigest({
      schema: 'libra.workspace-artifact-materialize-idempotency@1',
      workspaceId: request.workspaceId,
      relativePath,
      intentDigest,
    });
    const effectId = canonicalDigest({
      schema: 'foundation.effect-id@1',
      effectClass: 'libra_workspace_product_materialize',
      idempotencyKey,
    });
    const target = path.resolve(absoluteRoot, request.workspaceId, ...relativePath.split('/'));
    const workspaceRoot = path.resolve(absoluteRoot, request.workspaceId);
    if (target !== workspaceRoot && !target.startsWith(workspaceRoot + path.sep)) {
      fail('CLEAN_WORKSPACE_PATH_ESCAPE', 'Workspace Artifact escaped its controlled root.');
    }
    const prior = recordIntent(effectId, idempotencyKey, intentDigest);
    if (prior.state === 'committed') {
      if (prior.outputDigest !== digestHex || !exactReality(target, digestHex, bytes.length)) {
        fail('CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT', 'Committed Workspace Artifact reality drifted.');
      }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!exactReality(target, digestHex, bytes.length)) {
        const temporary = target + '.tmp-' + effectId.slice(0, 16);
        fs.writeFileSync(temporary, bytes, { flag: 'w' });
        fs.renameSync(temporary, target);
      }
      if (typeof options.afterPhysicalEffect === 'function') {
        options.afterPhysicalEffect(Object.freeze({ effectId, target, intentDigest }));
      }
    }
    const stat = fs.statSync(target, { bigint: true });
    const inode = stat.ino.toString();
    const physicalIdentity = Object.freeze({
      mountScopeId,
      inode,
      contentHashAlgorithm: 'sha256',
      contentHash: digestHex,
    });
    const materialKey = canonicalDigest({
      schema: 'physical-material-identity@1',
      ...physicalIdentity,
    });
    const handleId = canonicalDigest({
      schema: 'foundation.workspace-material-handle-id@1',
      workspaceId: request.workspaceId,
      materialKey,
      relativePath,
      referenceRevision: 1,
    });
    const handleBasis = {
      schemaRef: 'helix://contracts/types/WorkspaceMaterialHandle/v1',
      schemaVersion: 1,
      handleId,
      workspaceId: request.workspaceId,
      ownerDomain: 'libra',
      processId: request.libraRunId,
      endpointId,
      materialKey,
      physicalIdentity,
      rootHandleRef,
      relativePath,
      digestAlgorithm: 'sha256',
      digestHex,
      sizeBytes: bytes.length,
      referenceRevision: 1,
      accessScope: 'workspace_material_read',
    };
    const fenceDigest = canonicalDigest({
      schema: 'foundation.workspace-material-handle-fence@1',
      handleId,
      workspaceId: request.workspaceId,
      ownerDomain: 'libra',
      processId: request.libraRunId,
      endpointId,
      materialKey,
      physicalIdentity,
      rootHandleRef,
      relativePath,
      digestAlgorithm: 'sha256',
      digestHex,
      sizeBytes: bytes.length,
      referenceRevision: 1,
      accessScope: 'workspace_material_read',
    });
    const workspaceMaterialHandle = Object.freeze({ ...handleBasis, fenceDigest });
    const artifactHandleId = canonicalDigest({
      schema: 'foundation.artifact-handle-id@1',
      artifactKind: request.artifactKind,
      ownerDomain: 'libra',
      ownerScopeType: 'libra_run',
      ownerScopeId: request.libraRunId,
      digestAlgorithm: 'sha256',
      digestHex,
    });
    const artifactHandle = Object.freeze({
      schemaRef: 'helix://contracts/types/ArtifactHandle/v1',
      schemaVersion: 1,
      artifactHandleId,
      artifactKind: request.artifactKind,
      ownerDomain: 'libra',
      ownerScope: Object.freeze({
        scopeType: 'libra_run',
        scopeId: request.libraRunId,
      }),
      storageRef: 'workspace://' + request.workspaceId + '/' + relativePath,
      digestAlgorithm: 'sha256',
      digestHex,
      sizeBytes: bytes.length,
      mediaType: request.mediaType,
      provenanceRef: request.provenanceRef,
      referenceRevision: 1,
    });
    const receipt = execute('clean_workspace_effect_commit', 'execution-foundation', repositories.foundation, (context) => {
      const repo = context.repository(repositories.foundation.repositoryId);
      const effect = repo.invoke('find_effect', {
        effect_class: 'libra_workspace_product_materialize',
        idempotency_key: idempotencyKey,
      });
      if (!effect || effect.effect_id !== effectId || effect.intent_digest !== intentDigest) {
        fail('CLEAN_WORKSPACE_EFFECT_MISSING', 'Workspace Artifact intent is absent.');
      }
      const existingMaterial = repo.invoke('find_material', {
        workspace_id: request.workspaceId,
        material_handle_id: handleId,
      });
      const existingArtifact = repo.invoke('find_artifact', {
        artifact_handle_id: artifactHandleId,
      });
      if (effect.state === 'committed') {
        const storedMaterial = mapMaterial(existingMaterial);
        const storedArtifact = mapArtifact(existingArtifact);
        if (canonicalJson(storedMaterial) !== canonicalJson(workspaceMaterialHandle) ||
            canonicalJson(storedArtifact) !== canonicalJson(artifactHandle)) {
          fail('CLEAN_WORKSPACE_EFFECT_REPLAY_CORRUPT',
            'Committed Workspace Artifact rows cannot reconstruct the same handles.');
        }
        return Object.freeze({
          replayed: true,
          effectId,
          intentDigest,
          workspaceMaterialHandle: storedMaterial,
          artifactHandle: storedArtifact,
        });
      }
      if (effect.state !== 'intended' || existingMaterial || existingArtifact) {
        fail('CLEAN_WORKSPACE_EFFECT_STATE_CONFLICT', 'Workspace Artifact effect state is inconsistent.');
      }
      repo.invoke('insert_material', {
        workspace_id: request.workspaceId,
        material_handle_id: handleId,
        material_key: materialKey,
        endpoint_id: endpointId,
        mount_scope_id: mountScopeId,
        inode,
        content_hash_algorithm: 'sha256',
        content_hash: digestHex,
        relative_path: relativePath,
        digest_algorithm: 'sha256',
        digest_hex: digestHex,
        size_bytes: bytes.length,
        reference_revision: 1,
        owner_domain: 'libra',
        process_id: request.libraRunId,
        root_handle_ref: rootHandleRef,
        access_scope: 'workspace_material_read',
        handle_schema_ref: workspaceMaterialHandle.schemaRef,
        handle_json: canonicalJson(workspaceMaterialHandle),
        handle_digest: canonicalDigest(workspaceMaterialHandle),
        fence_digest: workspaceMaterialHandle.fenceDigest,
        state: 'active',
      });
      repo.invoke('insert_artifact', {
        artifact_handle_id: artifactHandleId,
        artifact_kind: request.artifactKind,
        owner_domain: 'libra',
        owner_scope_type: 'libra_run',
        owner_scope_id: request.libraRunId,
        storage_ref: artifactHandle.storageRef,
        digest_algorithm: 'sha256',
        digest_hex: digestHex,
        size_bytes: bytes.length,
        media_type: request.mediaType,
        provenance_ref: canonicalJson(request.provenanceRef),
        reference_revision: 1,
        state: 'active',
        created_at_ms: context.commitTimeMs,
      });
      if (repo.invoke('commit_effect', {
        state: 'committed',
        external_receipt_ref: artifactHandle.storageRef,
        output_digest: digestHex,
        verified_at_ms: context.commitTimeMs,
        updated_at_ms: context.commitTimeMs,
        effect_id: effectId,
        expected_state: 'intended',
        expected_intent_digest: intentDigest,
      }).changes !== 1) {
        fail('CLEAN_WORKSPACE_EFFECT_CAS', 'Workspace Artifact journal CAS failed.');
      }
      return Object.freeze({
        replayed: false,
        effectId,
        intentDigest,
        workspaceMaterialHandle,
        artifactHandle,
      });
    });
    return receipt;
  }

  function reclaimMaterial(intent) {
    const row = execute(
      'clean_workspace_reclaim_read',
      'execution-foundation',
      repositories.foundation,
      (context) => context.repository(repositories.foundation.repositoryId)
        .invoke('find_material', {
          workspace_id: intent?.workspaceId,
          material_handle_id: intent?.materialHandleId,
        }),
    );
    if (!row) {
      fail('CLEAN_WORKSPACE_RECLAIM_HANDLE_MISSING',
        'Workspace cleanup requires its exact durable Handle.');
    }
    const handle = mapMaterial(row);
    if (intent.expectedWorkspaceHandleDigest !== canonicalDigest(handle) ||
        intent.materialHandleId !== handle.handleId ||
        intent.workspaceId !== handle.workspaceId ||
        intent.intentDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(intent).filter(([name]) => name !== 'intentDigest'),
        ))) {
      fail('CLEAN_WORKSPACE_RECLAIM_FENCE',
        'Workspace cleanup intent does not match the durable Handle.');
    }
    const target = path.resolve(
      absoluteRoot,
      handle.workspaceId,
      ...relative(handle.relativePath).split('/'),
    );
    const workspaceRoot = path.resolve(absoluteRoot, handle.workspaceId);
    if (target === workspaceRoot ||
        !target.startsWith(workspaceRoot + path.sep)) {
      fail('CLEAN_WORKSPACE_RECLAIM_ESCAPE',
        'Workspace cleanup target escaped its exact Workspace root.');
    }
    const effectId = canonicalDigest({
      schema: 'foundation.effect-id@1',
      effectClass: 'libra_workspace_material_reclaim',
      idempotencyKey: intent.idempotencyKey,
    });
    const prior = execute(
      'clean_workspace_reclaim_intent',
      'execution-foundation',
      repositories.foundation,
      (context) => {
        const repo = context.repository(repositories.foundation.repositoryId);
        const existing = repo.invoke('find_effect', {
          effect_class: 'libra_workspace_material_reclaim',
          idempotency_key: intent.idempotencyKey,
        });
        if (existing) {
          if (existing.effect_id !== effectId ||
              existing.intent_digest !== intent.intentDigest) {
            fail('CLEAN_WORKSPACE_RECLAIM_CONFLICT',
              'Workspace cleanup effect key binds another intent.');
          }
          return existing;
        }
        repo.invoke('insert_effect', {
          effect_id: effectId,
          event_attempt_id: null,
          effect_class: 'libra_workspace_material_reclaim',
          idempotency_key: intent.idempotencyKey,
          intent_digest: intent.intentDigest,
          state: 'intended',
          external_receipt_ref: null,
          output_digest: null,
          verified_at_ms: null,
          updated_at_ms: context.commitTimeMs,
        });
        return repo.invoke('find_effect', {
          effect_class: 'libra_workspace_material_reclaim',
          idempotency_key: intent.idempotencyKey,
        });
      },
    );
    const existed = fs.existsSync(target);
    if (intent.effectMode === 'verify_absent_only' && existed) {
      fail('CLEAN_WORKSPACE_RECLAIM_CONTROL_CONFLICT',
        'Other-owned Workspace material may only be verified absent.');
    }
    if (prior.state !== 'committed' && existed) {
      const bytes = fs.readFileSync(target);
      if (bytes.length !== handle.sizeBytes ||
          digestBytes(bytes) !== handle.digestHex) {
        fail('CLEAN_WORKSPACE_RECLAIM_IDENTITY',
          'Workspace cleanup target bytes differ from the frozen Handle.');
      }
      fs.unlinkSync(target);
      if (typeof options.afterCleanupPhysicalEffect === 'function') {
        options.afterCleanupPhysicalEffect(Object.freeze({
          effectId,
          target,
          intentDigest: intent.intentDigest,
        }));
      }
    }
    if (fs.existsSync(target)) {
      fail('CLEAN_WORKSPACE_RECLAIM_ABSENCE',
        'Workspace cleanup did not establish physical absence.');
    }
    let result = existed ? 'deleted' : 'already_absent';
    const postDeleteContainmentProbeDigest = canonicalDigest({
      schema: 'libra.workspace-cleanup-absence-probe@1',
      workspaceId: handle.workspaceId,
      materialHandleId: handle.handleId,
      targetRelativePath: handle.relativePath,
      containmentFenceDigest: intent.containmentFenceDigest,
      result: 'absent',
    });
    const effectReceiptId = canonicalDigest({
      schema: 'libra.workspace-cleanup-effect-receipt-id@1',
      effectId,
      intentDigest: intent.intentDigest,
      postDeleteContainmentProbeDigest,
    });
    const evidenceFor = (resultKind) => {
      const evidenceBase = {
      evidenceId: canonicalDigest({
        schema: 'libra.workspace-material-deletion-evidence-id@1',
        effectId,
        cleanupScopeId: intent.cleanupScopeId,
        materialHandleId: intent.materialHandleId,
      }),
      evidenceKind: 'workspace_material_deletion',
      effectId,
      cleanupScopeId: intent.cleanupScopeId,
      materialHandleId: intent.materialHandleId,
      preDeleteHandleDigest: intent.expectedWorkspaceHandleDigest,
      result: resultKind,
      postDeleteContainmentProbeDigest,
      effectReceiptId,
      };
      return Object.freeze({
        ...evidenceBase,
        evidenceDigest: canonicalDigest(evidenceBase),
      });
    };
    let deletionEvidence = evidenceFor(result);
    if (prior.state === 'committed' &&
        deletionEvidence.evidenceDigest !== prior.output_digest) {
      const alternate = result === 'deleted' ? 'already_absent' : 'deleted';
      const candidate = evidenceFor(alternate);
      if (candidate.evidenceDigest !== prior.output_digest) {
        fail('CLEAN_WORKSPACE_RECLAIM_REPLAY_CORRUPT',
          'Committed Workspace cleanup Evidence digest cannot be reconstructed.');
      }
      result = alternate;
      deletionEvidence = candidate;
    }
    execute(
      'clean_workspace_reclaim_commit',
      'execution-foundation',
      repositories.foundation,
      (context) => {
        const repo = context.repository(repositories.foundation.repositoryId);
        const current = repo.invoke('find_effect', {
          effect_class: 'libra_workspace_material_reclaim',
          idempotency_key: intent.idempotencyKey,
        });
        const material = repo.invoke('find_material', {
          workspace_id: intent.workspaceId,
          material_handle_id: intent.materialHandleId,
        });
        if (!current || current.effect_id !== effectId ||
            current.intent_digest !== intent.intentDigest || !material) {
          fail('CLEAN_WORKSPACE_RECLAIM_JOURNAL',
            'Workspace cleanup journal or material row is absent.');
        }
        if (current.state === 'committed') {
          if (material.state !== 'reclaimed' ||
              current.output_digest !== deletionEvidence.evidenceDigest) {
            fail('CLEAN_WORKSPACE_RECLAIM_REPLAY_CORRUPT',
              'Committed Workspace cleanup cannot be reconstructed.');
          }
          return;
        }
        if (material.state !== 'active' ||
            repo.invoke('reclaim_material', {
              state: 'reclaimed',
              reclaimed_effect_id: effectId,
              reclaimed_effect_receipt_digest: deletionEvidence.evidenceDigest,
              reclaimed_at_ms: context.commitTimeMs,
              workspace_id: intent.workspaceId,
              material_handle_id: intent.materialHandleId,
              expected_state: 'active',
              expected_handle_digest: intent.expectedWorkspaceHandleDigest,
              expected_fence_digest: handle.fenceDigest,
            }).changes !== 1) {
          fail('CLEAN_WORKSPACE_RECLAIM_MATERIAL_CAS',
            'Workspace material reclaim CAS failed.');
        }
        if (repo.invoke('commit_effect', {
          state: 'committed',
          external_receipt_ref: effectReceiptId,
          output_digest: deletionEvidence.evidenceDigest,
          verified_at_ms: context.commitTimeMs,
          updated_at_ms: context.commitTimeMs,
          effect_id: effectId,
          expected_state: 'intended',
          expected_intent_digest: intent.intentDigest,
        }).changes !== 1) {
          fail('CLEAN_WORKSPACE_RECLAIM_EFFECT_CAS',
            'Workspace cleanup effect journal CAS failed.');
        }
      },
    );
    return Object.freeze({
      replayed: prior.state === 'committed',
      deletionEvidence,
      workspaceMaterialHandle: handle,
    });
  }

  return Object.freeze({
    rootPath: absoluteRoot,
    rootSnapshot: ensureRoot,
    materializeArtifact,
    observeSpace,
    reclaimMaterial,
  });
}

module.exports = Object.freeze({
  CleanWorkspaceProductPortError,
  createCleanWorkspaceProductPort,
});
