'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('./helix/contracts/canonical-json');
const { createRepositoryDefinition } = require('./helix/foundation/persistence/owner-repository');
const { fingerprintBuffer } = require('./helix/integrations/bounded-material-fingerprint');

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
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const ARTIFACT_KINDS = Object.freeze([
  'nfo',
  'poster',
  'fanart',
  'western_frame_set',
  'face_embedding_set',
  'face_cluster_set',
  'western_analysis',
]);

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
            'effect_id', 'event_attempt_id', 'effect_class', 'idempotency_key', 'intent_digest', 'state',
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
            'mount_scope_id', 'inode', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
            'relative_path', 'digest_algorithm', 'digest_hex', 'size_bytes',
            'reference_revision', 'owner_domain', 'process_id', 'root_handle_ref',
            'access_scope', 'handle_schema_ref', 'handle_json', 'handle_digest',
            'fence_digest', 'state',
          ],
          keyColumns: ['workspace_id', 'material_handle_id'],
          safeIntegers: true,
        },
        find_material_by_path: {
          kind: 'select-one',
          tableId: 'fx_workspace_materials',
          columns: [
            'workspace_id', 'material_handle_id', 'material_key', 'endpoint_id',
            'mount_scope_id', 'inode', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
            'relative_path', 'digest_algorithm', 'digest_hex', 'size_bytes',
            'reference_revision', 'owner_domain', 'process_id', 'root_handle_ref',
            'access_scope', 'handle_schema_ref', 'handle_json', 'handle_digest',
            'fence_digest', 'state',
          ],
          keyColumns: ['workspace_id', 'relative_path'],
          safeIntegers: true,
        },
        insert_material: {
          kind: 'insert',
          tableId: 'fx_workspace_materials',
          columns: [
            'workspace_id', 'material_handle_id', 'material_key', 'endpoint_id',
            'mount_scope_id', 'inode', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
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
    mountScopeRevision: value.mountScopeRevision || 1,
    configRevision: value.configRevision || 1,
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
  const externalLandingResolver = options.externalLandingResolver;
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
    rootId, endpointId, mountScopeId, mountScopeRevision:1,configRevision:1,capabilityDigest, rootHandleRef,
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
        const current=rootSnapshot({rootId:existing.root_id,endpointId:existing.endpoint_id,
          mountScopeId:existing.mount_scope_id,mountScopeRevision:Number(existing.mount_scope_revision),
          configRevision:Number(existing.config_revision),capabilityDigest:existing.capability_digest,
          rootHandleRef:existing.root_handle_ref});
        if (path.resolve(existing.resolved_root) !== absoluteRoot ||
            existing.snapshot_digest !== current.snapshotDigest || existing.state !== 'active') {
          fail('CLEAN_WORKSPACE_ROOT_CONFLICT',
            'Configured Workspace root conflicts with its durable Platform snapshot.');
        }
        return current;
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
    const statistics = (options.statfsSync || fs.statfsSync)(
      absoluteRoot,
      { bigint: true },
    );
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

  function recordIntent(effectClass, effectId, idempotencyKey, intentDigest) {
    return execute('clean_workspace_effect_intent', 'execution-foundation', repositories.foundation, (context) => {
      const repo = context.repository(repositories.foundation.repositoryId);
        const existing = repo.invoke('find_effect', {
        effect_class: effectClass,
        idempotency_key: idempotencyKey,
      });
      if (existing) {
        if (existing.effect_id !== effectId || existing.intent_digest !== intentDigest) {
          fail('CLEAN_WORKSPACE_EFFECT_CONFLICT', 'Effect idempotency key binds another intent.');
        }
        return Object.freeze({
          replayed: true,
          state: existing.state,
          outputDigest: existing.output_digest,
          externalReceiptRef: existing.external_receipt_ref,
        });
      }
      repo.invoke('insert_effect', {
        effect_id: effectId,
        event_attempt_id: null,
        effect_class: effectClass,
        idempotency_key: idempotencyKey,
        intent_digest: intentDigest,
        state: 'intended',
        external_receipt_ref: null,
        output_digest: null,
        verified_at_ms: null,
        updated_at_ms: context.commitTimeMs,
      });
      return Object.freeze({
        replayed: false,
        state: 'intended',
        outputDigest: null,
        externalReceiptRef: null,
      });
    });
  }

  function artifactEffectIdentity(request) {
    const root = ensureRoot();
    const relativePath = relative(request?.relativePath);
    if (!ARTIFACT_KINDS.includes(request?.artifactKind) ||
        typeof request.libraRunId !== 'string' || !request.libraRunId ||
        typeof request.workspaceId !== 'string' || !request.workspaceId ||
        typeof request.mediaType !== 'string' || !request.mediaType ||
        !request.provenanceRef || typeof request.provenanceRef !== 'object') {
      fail('CLEAN_WORKSPACE_EFFECT_INPUT',
        'Workspace Artifact effect input is incomplete.');
    }
    const intent = {
      schema: 'libra.workspace-artifact-materialize-intent@1',
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      rootSnapshotDigest: root.snapshotDigest,
      relativePath,
      artifactKind: request.artifactKind,
      mediaType: request.mediaType,
      provenanceRef: request.provenanceRef,
    };
    const intentDigest = canonicalDigest(intent);
    const idempotencyKey = canonicalDigest({
      schema: 'libra.workspace-artifact-materialize-idempotency@1',
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      relativePath,
      artifactKind: request.artifactKind,
      intentDigest,
    });
    const effectClass = 'libra_workspace_product_materialize';
    const effectId = canonicalDigest({
      schema: 'foundation.effect-id@1',
      effectClass,
      idempotencyKey,
    });
    const target = path.resolve(
      absoluteRoot,
      request.workspaceId,
      ...relativePath.split('/'),
    );
    const workspaceRoot = path.resolve(absoluteRoot, request.workspaceId);
    if (target !== workspaceRoot &&
        !target.startsWith(workspaceRoot + path.sep)) {
      fail('CLEAN_WORKSPACE_PATH_ESCAPE',
        'Workspace Artifact escaped its controlled root.');
    }
    return Object.freeze({
      effectClass,
      effectId,
      idempotencyKey,
      intentDigest,
      relativePath,
      target,
    });
  }

  function readArtifactEffect(identity) {
    return execute(
      'clean_workspace_effect_recover_read',
      'execution-foundation',
      repositories.foundation,
      (context) => context.repository(
        repositories.foundation.repositoryId,
      ).invoke('find_effect', {
        effect_class: identity.effectClass,
        idempotency_key: identity.idempotencyKey,
      }),
    );
  }

  function runtimeEffectAuthority(request) {
    const authority = request?.runtimeEffectAuthority;
    if (authority === undefined) return null;
    if (!authority || authority.effectClass !== 'workspace_write' ||
        typeof authority.eventAttemptId !== 'string' || !authority.eventAttemptId ||
        typeof authority.idempotencyKey !== 'string' || !authority.idempotencyKey) {
      fail('CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_INVALID',
        'Runtime-managed Workspace effects require the exact Event Attempt authority.');
    }
    const effect = execute(
      'clean_workspace_runtime_effect_read',
      'execution-foundation',
      repositories.foundation,
      (context) => context.repository(
        repositories.foundation.repositoryId,
      ).invoke('find_effect', {
        effect_class: authority.effectClass,
        idempotency_key: authority.idempotencyKey,
      }),
    );
    if (!effect || effect.event_attempt_id !== authority.eventAttemptId ||
        effect.state !== 'intended') {
      fail('CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING',
        'Workspace effect is not bound to the active Event Attempt intent.');
    }
    return Object.freeze({ authority:Object.freeze({ ...authority }), effect:Object.freeze(effect) });
  }

  function materializeArtifact(request) {
    const identity = artifactEffectIdentity(request);
    const runtimeAuthority = runtimeEffectAuthority(request);
    const bytes = Buffer.isBuffer(request?.bytes)
      ? request.bytes
      : Buffer.from(request?.bytes || '');
    if (!bytes.length) {
      fail('CLEAN_WORKSPACE_EFFECT_INPUT',
        'Workspace Artifact output bytes are required.');
    }
    const digestHex = digestBytes(bytes);
    const prior = runtimeAuthority
      ? Object.freeze({ replayed:false, state:'intended', outputDigest:null, externalReceiptRef:null })
      : recordIntent(
        identity.effectClass,
        identity.effectId,
        identity.idempotencyKey,
        identity.intentDigest,
      );
    if (prior.state === 'committed') {
      if (prior.outputDigest !== digestHex ||
          !exactReality(identity.target, digestHex, bytes.length)) {
        fail('CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT',
          'Committed Workspace Artifact reality drifted.');
      }
    } else {
      fs.mkdirSync(path.dirname(identity.target), { recursive: true });
      if (fs.existsSync(identity.target) &&
          !exactReality(identity.target, digestHex, bytes.length)) {
        fail('CLEAN_WORKSPACE_EFFECT_OUTPUT_DRIFT',
          'Stable Workspace Artifact effect identity produced different bytes.');
      }
      let wrotePhysical = false;
      if (!fs.existsSync(identity.target)) {
        const temporary = identity.target + '.tmp-' +
          identity.effectId.slice(0, 16);
        fs.writeFileSync(temporary, bytes, { flag: 'w' });
        fs.renameSync(temporary, identity.target);
        wrotePhysical = true;
      }
      if (wrotePhysical && !request.skipPhysicalHook &&
          typeof options.afterPhysicalEffect === 'function') {
        options.afterPhysicalEffect(Object.freeze({
          effectId: identity.effectId,
          target: identity.target,
          intentDigest: identity.intentDigest,
        }));
      }
    }
    const stat = fs.statSync(identity.target, { bigint: true });
    const inode = stat.ino.toString();
    const bounded = fingerprintBuffer(bytes);
    const physicalIdentity = Object.freeze({
      mountScopeId,
      inode,
      sizeBytes: bytes.length,
      fingerprintAlgorithm: bounded.fingerprintAlgorithm,
      fingerprintVersion: bounded.fingerprintVersion,
      contentFingerprint: bounded.contentFingerprint,
    });
    const materialKey = canonicalDigest({
      schema: 'physical-material-identity@2', mountScopeId, inode, sizeBytes:bytes.length,
      fingerprintAlgorithm:bounded.fingerprintAlgorithm, fingerprintVersion:bounded.fingerprintVersion,
      contentFingerprint:bounded.contentFingerprint,
    });
    const handleId = canonicalDigest({
      schema: 'foundation.workspace-material-handle-id@1',
      workspaceId: request.workspaceId,
      materialKey,
      relativePath: identity.relativePath,
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
      relativePath: identity.relativePath,
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
      relativePath: identity.relativePath,
      digestAlgorithm: 'sha256',
      digestHex,
      sizeBytes: bytes.length,
      referenceRevision: 1,
      accessScope: 'workspace_material_read',
    });
    const workspaceMaterialHandle = Object.freeze({
      ...handleBasis,
      fenceDigest,
    });
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
      storageRef: 'workspace://' + request.workspaceId + '/' +
        identity.relativePath,
      digestAlgorithm: 'sha256',
      digestHex,
      sizeBytes: bytes.length,
      mediaType: request.mediaType,
      provenanceRef: request.provenanceRef,
      referenceRevision: 1,
    });
    return execute(
      'clean_workspace_effect_commit',
      'execution-foundation',
      repositories.foundation,
      (context) => {
        const repo = context.repository(repositories.foundation.repositoryId);
        const effect = runtimeAuthority
          ? repo.invoke('find_effect', {
            effect_class: runtimeAuthority.authority.effectClass,
            idempotency_key: runtimeAuthority.authority.idempotencyKey,
          })
          : repo.invoke('find_effect', {
            effect_class: identity.effectClass,
            idempotency_key: identity.idempotencyKey,
          });
        if (!effect || (runtimeAuthority
          ? effect.event_attempt_id !== runtimeAuthority.authority.eventAttemptId || effect.state !== 'intended'
          : effect.effect_id !== identity.effectId || effect.intent_digest !== identity.intentDigest)) {
          fail('CLEAN_WORKSPACE_EFFECT_MISSING',
            'Workspace Artifact intent is absent.');
        }
        const existingMaterial = repo.invoke('find_material', {
          workspace_id: request.workspaceId,
          material_handle_id: handleId,
        });
        const existingArtifact = repo.invoke('find_artifact', {
          artifact_handle_id: artifactHandleId,
        });
        if (!runtimeAuthority && effect.state === 'committed') {
          const storedMaterial = mapMaterial(existingMaterial);
          const storedArtifact = mapArtifact(existingArtifact);
          if (canonicalJson(storedMaterial) !==
                canonicalJson(workspaceMaterialHandle) ||
              canonicalJson(storedArtifact) !== canonicalJson(artifactHandle)) {
            fail('CLEAN_WORKSPACE_EFFECT_REPLAY_CORRUPT',
              'Committed Workspace Artifact rows cannot reconstruct the same handles.');
          }
          return Object.freeze({
            replayed: true,
            effectId: identity.effectId,
            intentDigest: identity.intentDigest,
            workspaceMaterialHandle: storedMaterial,
            artifactHandle: storedArtifact,
          });
        }
        if (effect.state !== 'intended' ||
            (existingMaterial && !existingArtifact) || (!existingMaterial && existingArtifact)) {
          fail('CLEAN_WORKSPACE_EFFECT_STATE_CONFLICT',
            'Workspace Artifact effect state is inconsistent.');
        }
        if (existingMaterial && existingArtifact) {
          const storedMaterial = mapMaterial(existingMaterial);
          const storedArtifact = mapArtifact(existingArtifact);
          if (canonicalJson(storedMaterial) !== canonicalJson(workspaceMaterialHandle) ||
              canonicalJson(storedArtifact) !== canonicalJson(artifactHandle)) {
            fail('CLEAN_WORKSPACE_EFFECT_REPLAY_CORRUPT',
              'Workspace Artifact rows cannot reconstruct the same handles.');
          }
          return Object.freeze({
            replayed: true,
            effectId: runtimeAuthority ? effect.effect_id : identity.effectId,
            intentDigest: runtimeAuthority ? effect.intent_digest : identity.intentDigest,
            workspaceMaterialHandle: storedMaterial,
            artifactHandle: storedArtifact,
          });
        }
        repo.invoke('insert_material', {
          workspace_id: request.workspaceId,
          material_handle_id: handleId,
          material_key: materialKey,
          endpoint_id: endpointId,
          mount_scope_id: mountScopeId,
          inode,
          fingerprint_algorithm: bounded.fingerprintAlgorithm,
          fingerprint_version: bounded.fingerprintVersion,
          content_fingerprint: bounded.contentFingerprint,
          relative_path: identity.relativePath,
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
        if (!runtimeAuthority && repo.invoke('commit_effect', {
          state: 'committed',
          external_receipt_ref: artifactHandle.storageRef,
          output_digest: digestHex,
          verified_at_ms: context.commitTimeMs,
          updated_at_ms: context.commitTimeMs,
          effect_id: identity.effectId,
          expected_state: 'intended',
          expected_intent_digest: identity.intentDigest,
        }).changes !== 1) {
          fail('CLEAN_WORKSPACE_EFFECT_CAS',
            'Workspace Artifact journal CAS failed.');
        }
        return Object.freeze({
          replayed: false,
          effectId: runtimeAuthority ? effect.effect_id : identity.effectId,
          intentDigest: runtimeAuthority ? effect.intent_digest : identity.intentDigest,
          workspaceMaterialHandle,
          artifactHandle,
        });
      },
    );
  }

  function recoverMaterializedArtifact(request) {
    const identity = artifactEffectIdentity(request);
    const existing = readArtifactEffect(identity);
    if (!existing) return null;
    if (existing.effect_id !== identity.effectId ||
        existing.intent_digest !== identity.intentDigest) {
      fail('CLEAN_WORKSPACE_EFFECT_CONFLICT',
        'Workspace Artifact recovery journal intent drifted.');
    }
    if (!fs.existsSync(identity.target)) {
      if (existing.state === 'committed') {
        fail('CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT',
          'Committed Workspace Artifact physical reality is absent.');
      }
      if (existing.state !== 'intended') {
        fail('CLEAN_WORKSPACE_EFFECT_STATE_CONFLICT',
          'Workspace Artifact recovery state is invalid.');
      }
      return null;
    }
    if (!fs.statSync(identity.target).isFile()) {
      fail('CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT',
        'Workspace Artifact target is not one immutable file.');
    }
    return materializeArtifact({
      ...request,
      relativePath: identity.relativePath,
      bytes: fs.readFileSync(identity.target),
      skipPhysicalHook: true,
    });
  }

  function openFrameCompositeSink(request) {
    const identity = artifactEffectIdentity(request);
    if (request.artifactKind !== 'western_frame_set' ||
        !Number.isSafeInteger(request.maxFrames) ||
        request.maxFrames < 1 || request.maxFrames > 1024) {
      fail('CLEAN_WORKSPACE_FRAME_SINK_INPUT',
        'Frame composite sink requires one bounded Western frame target.');
    }
    const prior = recordIntent(
      identity.effectClass,
      identity.effectId,
      identity.idempotencyKey,
      identity.intentDigest,
    );
    if (prior.state === 'committed' || fs.existsSync(identity.target)) {
      fail('CLEAN_WORKSPACE_FRAME_SINK_RECOVERY_REQUIRED',
        'Frame composite sink must recover existing reality before execution.');
    }
    const members = [];
    let totalBytes = 0;
    const maxMemberBytes = 16 * 1024 * 1024;
    const maxTotalBytes = 256 * 1024 * 1024;
    const contract = Object.freeze({
      schemaRef:
        'helix://implementation-contracts/workspace-frame-composite-sink/v1',
      effectId: identity.effectId,
      intentDigest: identity.intentDigest,
      workspaceId: request.workspaceId,
      artifactKind: request.artifactKind,
      targetRefDigest: canonicalDigest({
        workspaceId: request.workspaceId,
        relativePath: identity.relativePath,
        provenanceRef: request.provenanceRef,
      }),
      maxFrames: request.maxFrames,
      maxMemberBytes,
      maxTotalBytes,
    });
    const writeFrame = (value) => {
      if (!value || !Number.isSafeInteger(value.timestampMs) ||
          value.timestampMs < 0 || !Buffer.isBuffer(value.bytes) ||
          value.bytes.length < 1 || value.bytes.length > maxMemberBytes ||
          members.length >= request.maxFrames ||
          totalBytes + value.bytes.length > maxTotalBytes) {
        fail('CLEAN_WORKSPACE_FRAME_SINK_MEMBER',
          'Frame sink member violates its closed byte/count bounds.');
      }
      const ordinal = members.length;
      const bytes = Buffer.from(value.bytes);
      totalBytes += bytes.length;
      const contentDigest = digestBytes(bytes);
      members.push(Object.freeze({
        ordinal,
        timestampMs: value.timestampMs,
        locator: 'composite-member:' + ordinal,
        contentDigest,
        bytes,
      }));
      return Object.freeze({ ordinal, contentDigest });
    };
    const commit = () => {
      if (members.length < 1) {
        fail('CLEAN_WORKSPACE_FRAME_SINK_EMPTY',
          'Frame composite sink cannot commit an empty Artifact.');
      }
      const index = members.map((item) => Object.freeze({
        ordinal: item.ordinal,
        timestampMs: item.timestampMs,
        contentDigest: item.contentDigest,
        locator: item.locator,
      }));
      const memberPayloads = members.map((item) => Object.freeze({
        ordinal: item.ordinal,
        encoding: 'base64',
        contentDigest: item.contentDigest,
        bytesBase64: item.bytes.toString('base64'),
      }));
      const frameMemberSetDigest = canonicalDigest({
        schema: 'libra.western-frame-member-set@1',
        items: index,
      });
      const composite = Object.freeze({
        schema: 'libra.western-frame-composite@1',
        members: Object.freeze(index),
        memberPayloads: Object.freeze(memberPayloads),
        frameMemberSetDigest,
      });
      const materialized = materializeArtifact({
        ...request,
        bytes: Buffer.from(canonicalJson(composite), 'utf8'),
      });
      return Object.freeze({ composite, materialized });
    };
    return Object.freeze({ contract, writeFrame, commit });
  }

  async function acquireArtifact(request) {
    const root = ensureRoot();
    const relativePath = relative(request?.relativePath);
    if (!request || typeof request.acquireBytes !== 'function' ||
        !['poster', 'fanart'].includes(request.artifactKind) ||
        typeof request.libraRunId !== 'string' || !request.libraRunId ||
        typeof request.workspaceId !== 'string' || !request.workspaceId ||
        !request.acquisitionBasis ||
        typeof request.acquisitionBasis !== 'object') {
      fail('CLEAN_WORKSPACE_ACQUIRE_INPUT',
        'Provider Artifact acquisition input is incomplete.');
    }
    const intent = {
      schema: 'libra.provider-artifact-acquire-effect@1',
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      rootSnapshotDigest: root.snapshotDigest,
      relativePath,
      artifactKind: request.artifactKind,
      mediaType: request.mediaType,
      acquisitionBasis: request.acquisitionBasis,
    };
    const intentDigest = canonicalDigest(intent);
    const idempotencyKey = canonicalDigest({
      schema: 'libra.provider-artifact-acquire-idempotency@1',
      workspaceId: request.workspaceId,
      relativePath,
      intentDigest,
    });
    const effectClass = 'libra_provider_artifact_acquire';
    const effectId = canonicalDigest({
      schema: 'foundation.effect-id@1',
      effectClass,
      idempotencyKey,
    });
    const target = path.resolve(
      absoluteRoot,
      request.workspaceId,
      ...relativePath.split('/'),
    );
    const workspaceRoot = path.resolve(absoluteRoot, request.workspaceId);
    if (target !== workspaceRoot &&
        !target.startsWith(workspaceRoot + path.sep)) {
      fail('CLEAN_WORKSPACE_PATH_ESCAPE',
        'Provider Artifact escaped its controlled Workspace root.');
    }
    const runtimeAuthority = runtimeEffectAuthority(request);
    if (runtimeAuthority) {
      const outcome = await request.acquireBytes();
      if (outcome?.resultKind === 'not_available') {
        if (typeof outcome.reasonCode !== 'string' || !outcome.reasonCode) {
          fail('CLEAN_WORKSPACE_ACQUIRE_BYTES',
            'Unavailable Provider Artifact lacks a reason code.');
        }
        return Object.freeze({ resultKind:'not_available', reasonCode:outcome.reasonCode });
      }
      if (outcome?.resultKind !== 'acquired' ||
          !Buffer.isBuffer(outcome.bytes) || !outcome.bytes.length) {
        fail('CLEAN_WORKSPACE_ACQUIRE_BYTES',
          'Provider Artifact acquisition returned no bytes.');
      }
      return Object.freeze({
        resultKind:'acquired',
        materialized:materializeArtifact({
          ...request,
          relativePath,
          bytes:outcome.bytes,
          provenanceRef:request.provenanceRef,
        }),
      });
    }
    const prior = recordIntent(
      effectClass,
      effectId,
      idempotencyKey,
      intentDigest,
    );
    if (prior.state === 'committed' &&
        prior.externalReceiptRef?.startsWith('not_available:')) {
      return Object.freeze({
        resultKind: 'not_available',
        reasonCode: decodeURIComponent(
          prior.externalReceiptRef.slice('not_available:'.length),
        ),
      });
    }
    if (prior.state === 'committed' && !fs.existsSync(target)) {
      fail('CLEAN_WORKSPACE_ACQUIRE_EFFECT_REALITY_DRIFT',
        'Committed Provider Artifact reality is missing.');
    }
    let bytes;
    if (prior.replayed && fs.existsSync(target)) {
      bytes = fs.readFileSync(target);
    } else {
      const outcome = await request.acquireBytes();
      if (outcome?.resultKind === 'not_available') {
        if (typeof outcome.reasonCode !== 'string' ||
            !outcome.reasonCode) {
          fail('CLEAN_WORKSPACE_ACQUIRE_BYTES',
            'Unavailable Provider Artifact lacks a reason code.');
        }
        const outputDigest = canonicalDigest({
          resultKind: 'not_available',
          reasonCode: outcome.reasonCode,
        });
        execute(
          'clean_workspace_artifact_acquire_unavailable',
          'execution-foundation',
          repositories.foundation,
          (context) => {
            const repo = context.repository(
              repositories.foundation.repositoryId,
            );
            if (repo.invoke('commit_effect', {
              state: 'committed',
              external_receipt_ref:
                'not_available:' + encodeURIComponent(outcome.reasonCode),
              output_digest: outputDigest,
              verified_at_ms: context.commitTimeMs,
              updated_at_ms: context.commitTimeMs,
              effect_id: effectId,
              expected_state: 'intended',
              expected_intent_digest: intentDigest,
            }).changes !== 1) {
              fail('CLEAN_WORKSPACE_ACQUIRE_EFFECT_CAS',
                'Unavailable Provider Artifact effect commit failed.');
            }
          },
        );
        return Object.freeze({
          resultKind: 'not_available',
          reasonCode: outcome.reasonCode,
        });
      }
      bytes = outcome?.bytes;
      if (outcome?.resultKind !== 'acquired' ||
          !Buffer.isBuffer(bytes) || !bytes.length) {
        fail('CLEAN_WORKSPACE_ACQUIRE_BYTES',
          'Provider Artifact acquisition returned no bytes.');
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = target + '.tmp-' + effectId.slice(0, 16);
      fs.writeFileSync(temporary, bytes, { flag: 'w' });
      fs.renameSync(temporary, target);
      if (typeof options.afterPhysicalEffect === 'function') {
        options.afterPhysicalEffect(Object.freeze({
          effectId,
          target,
          intentDigest,
        }));
      }
    }
    const digestHex = digestBytes(bytes);
    execute(
      'clean_workspace_artifact_acquire_commit',
      'execution-foundation',
      repositories.foundation,
      (context) => {
        const repo = context.repository(repositories.foundation.repositoryId);
        const effect = repo.invoke('find_effect', {
          effect_class: effectClass,
          idempotency_key: idempotencyKey,
        });
        if (!effect || effect.effect_id !== effectId ||
            effect.intent_digest !== intentDigest) {
          fail('CLEAN_WORKSPACE_ACQUIRE_EFFECT_MISSING',
            'Provider Artifact acquisition effect intent is absent.');
        }
        if (effect.state === 'committed') {
          if (effect.output_digest !== digestHex) {
            fail('CLEAN_WORKSPACE_ACQUIRE_EFFECT_DRIFT',
              'Provider Artifact acquisition output digest drifted.');
          }
          return;
        }
        if (effect.state !== 'intended' ||
            repo.invoke('commit_effect', {
              state: 'committed',
              external_receipt_ref:
                'workspace://' + request.workspaceId + '/' + relativePath,
              output_digest: digestHex,
              verified_at_ms: context.commitTimeMs,
              updated_at_ms: context.commitTimeMs,
              effect_id: effectId,
              expected_state: 'intended',
              expected_intent_digest: intentDigest,
            }).changes !== 1) {
          fail('CLEAN_WORKSPACE_ACQUIRE_EFFECT_CAS',
            'Provider Artifact acquisition effect commit failed.');
        }
      },
    );
    return Object.freeze({
      resultKind: 'acquired',
      materialized: materializeArtifact({
        ...request,
        relativePath,
        bytes,
        skipPhysicalHook: true,
        provenanceRef: request.provenanceRef,
      }),
    });
  }

  function readMaterializedArtifact(artifactHandle) {
    if (!artifactHandle ||
        artifactHandle.schemaRef !==
          'helix://contracts/types/ArtifactHandle/v1' ||
        artifactHandle.ownerDomain !== 'libra' ||
        artifactHandle.ownerScope?.scopeType !== 'libra_run' ||
        typeof artifactHandle.storageRef !== 'string' ||
        !artifactHandle.storageRef.startsWith('workspace://')) {
      fail('CLEAN_WORKSPACE_ARTIFACT_HANDLE_INVALID',
        'Artifact recovery requires one exact Libra Workspace Artifact Handle.');
    }
    const location = artifactHandle.storageRef.slice('workspace://'.length);
    const separator = location.indexOf('/');
    if (separator < 1) {
      fail('CLEAN_WORKSPACE_ARTIFACT_HANDLE_INVALID',
        'Artifact storage reference does not identify a Workspace material.');
    }
    const workspaceId = location.slice(0, separator);
    const relativePath = relative(location.slice(separator + 1));
    return execute(
      'clean_workspace_artifact_recover',
      'execution-foundation',
      repositories.foundation,
      (context) => {
        const repo = context.repository(repositories.foundation.repositoryId);
        const artifactRow = repo.invoke('find_artifact', {
          artifact_handle_id: artifactHandle.artifactHandleId,
        });
        const materialRow = repo.invoke('find_material_by_path', {
          workspace_id: workspaceId,
          relative_path: relativePath,
        });
        const storedArtifact = mapArtifact(artifactRow);
        const workspaceMaterialHandle = mapMaterial(materialRow);
        if (!storedArtifact || !workspaceMaterialHandle ||
            canonicalJson(storedArtifact) !== canonicalJson(artifactHandle) ||
            workspaceMaterialHandle.workspaceId !== workspaceId ||
            workspaceMaterialHandle.relativePath !== relativePath ||
            workspaceMaterialHandle.digestHex !== artifactHandle.digestHex ||
            workspaceMaterialHandle.sizeBytes !== artifactHandle.sizeBytes ||
            workspaceMaterialHandle.ownerDomain !== artifactHandle.ownerDomain ||
            workspaceMaterialHandle.processId !==
              artifactHandle.ownerScope.scopeId) {
          fail('CLEAN_WORKSPACE_ARTIFACT_RECOVERY_DRIFT',
            'Artifact Handle cannot reconstruct its exact Workspace material.');
        }
        return Object.freeze({
          replayed: true,
          workspaceMaterialHandle,
          artifactHandle: storedArtifact,
        });
      },
    );
  }

  function readArtifactBytes(artifactHandle) {
    const materialized = readMaterializedArtifact(artifactHandle);
    const location = artifactHandle.storageRef.slice('workspace://'.length);
    const separator = location.indexOf('/');
    const workspaceId = location.slice(0, separator);
    const relativePath = relative(location.slice(separator + 1));
    const target = path.resolve(
      absoluteRoot,
      workspaceId,
      ...relativePath.split('/'),
    );
    const workspaceRoot = path.resolve(absoluteRoot, workspaceId);
    if (target !== workspaceRoot &&
        !target.startsWith(workspaceRoot + path.sep)) {
      fail('CLEAN_WORKSPACE_PATH_ESCAPE',
        'Workspace Artifact read escaped its controlled root.');
    }
    const bytes = fs.readFileSync(target);
    if (bytes.length !== artifactHandle.sizeBytes ||
        digestBytes(bytes) !== artifactHandle.digestHex) {
      fail('CLEAN_WORKSPACE_ARTIFACT_REALITY_DRIFT',
        'Artifact bytes no longer match the immutable Artifact Handle.');
    }
    return Object.freeze({
      ...materialized,
      bytes,
    });
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
      const stat=fs.statSync(target);
      let realityMatches=stat.isFile()&&Number(stat.size)===handle.sizeBytes;
      if(realityMatches&&handle.digestAlgorithm==='middle-256k-sha256'){
        const bounded=require('./helix/integrations/bounded-material-fingerprint').computeBoundedMaterialFingerprintSync(target);
        realityMatches=bounded.contentFingerprint===handle.digestHex;
      }else if(realityMatches&&handle.digestAlgorithm==='sha256'){
        const bytes=fs.readFileSync(target);
        realityMatches=digestBytes(bytes)===handle.digestHex;
      }else realityMatches=false;
      if (!realityMatches) {
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

  function reclaimEmptyWorkspace(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId) {
      fail('CLEAN_WORKSPACE_RECLAIM_WORKSPACE_ID', 'Workspace identity is required for empty-directory cleanup.');
    }
    const workspaceRoot=path.resolve(absoluteRoot,workspaceId);
    if(workspaceRoot===absoluteRoot||!workspaceRoot.startsWith(absoluteRoot+path.sep)){
      fail('CLEAN_WORKSPACE_RECLAIM_ESCAPE','Workspace directory cleanup escaped the configured root.');
    }
    if(!fs.existsSync(workspaceRoot))return Object.freeze({workspaceId,removed:false,reason:'already_absent'});
    if(!fs.statSync(workspaceRoot).isDirectory()){
      fail('CLEAN_WORKSPACE_RECLAIM_REALITY','Workspace root is not a directory.');
    }
    function removeEmpty(directory){
      for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
        if(entry.isDirectory()&&!entry.isSymbolicLink())removeEmpty(path.join(directory,entry.name));
      }
      if(fs.readdirSync(directory).length===0)fs.rmdirSync(directory);
    }
    removeEmpty(workspaceRoot);
    if(fs.existsSync(workspaceRoot)){
      fail('CLEAN_WORKSPACE_RECLAIM_UNKNOWN_MEMBER',
        'Workspace contains material outside the admitted cleanup Scope.');
    }
    return Object.freeze({workspaceId,removed:true,reason:'empty'});
  }

  async function materializeMedia(request) {
    const root = ensureRoot();
    const runtimeAuthority = runtimeEffectAuthority(request);
    if (!runtimeAuthority) fail('CLEAN_WORKSPACE_MEDIA_RUNTIME_AUTHORITY_REQUIRED',
      'Workspace media materialization requires the Event Runtime workspace_write authority.');
    const relativePath = relative(request?.relativePath);
    if (typeof request?.libraRunId !== 'string' || !request.libraRunId ||
        typeof request.workspaceId !== 'string' || !request.workspaceId ||
        typeof request.intentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(request.intentDigest) ||
        typeof request.idempotencyKey !== 'string' || !request.idempotencyKey ||
        typeof request.produce !== 'function') {
      fail('CLEAN_WORKSPACE_MEDIA_INPUT', 'Workspace media Effect input is incomplete.');
    }
    const effectId = runtimeAuthority.effect.effect_id;
    const intent = { schema:'libra.workspace-media-materialize-intent@1', libraRunId:request.libraRunId,
      workspaceId:request.workspaceId, rootSnapshotDigest:root.snapshotDigest, relativePath,
      productionIntentDigest:request.intentDigest };
    const journalIntentDigest = canonicalDigest(intent);
    const target = path.resolve(absoluteRoot, request.workspaceId, ...relativePath.split('/'));
    const workspaceRoot = path.resolve(absoluteRoot, request.workspaceId);
    if (target !== workspaceRoot && !target.startsWith(workspaceRoot + path.sep)) {
      fail('CLEAN_WORKSPACE_PATH_ESCAPE', 'Workspace media output escaped its controlled root.');
    }
    const existingBefore = execute('clean_workspace_media_effect_read', 'execution-foundation', repositories.foundation, (context) =>
      mapMaterial(context.repository(repositories.foundation.repositoryId).invoke('find_material_by_path', {
        workspace_id:request.workspaceId, relative_path:relativePath,
      })));
    fs.mkdirSync(path.dirname(target), { recursive:true });
    if (!existingBefore && !fs.existsSync(target)) {
      const temporary = target + '.partial-' + effectId.slice(0, 16);
      await request.produce(temporary);
      if (!fs.existsSync(temporary) || !fs.statSync(temporary).isFile()) {
        fail('CLEAN_WORKSPACE_MEDIA_OUTPUT_MISSING', 'Media Effect did not produce its bounded target.');
      }
      fs.renameSync(temporary, target);
      if (typeof options.afterPhysicalEffect === 'function') options.afterPhysicalEffect(Object.freeze({
        effectId, target, intentDigest:journalIntentDigest,
      }));
      if (typeof options.afterMediaPhysicalEffect === 'function') options.afterMediaPhysicalEffect(Object.freeze({
        effectId, target, intentDigest:journalIntentDigest,
      }));
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      fail('CLEAN_WORKSPACE_MEDIA_REALITY_DRIFT', 'Workspace media output is absent.');
    }
    const bounded = require('./helix/integrations/bounded-material-fingerprint')
      .computeBoundedMaterialFingerprintSync(target);
    const stat = bounded.stat;
    const sizeBytes = Number(stat.size);
    if (!Number.isSafeInteger(sizeBytes)) fail('CLEAN_WORKSPACE_MEDIA_SIZE', 'Workspace media output is too large.');
    const digestHex = bounded.contentFingerprint;
    if (existingBefore && (existingBefore.digestAlgorithm !== 'middle-256k-sha256' || existingBefore.digestHex !== digestHex)) {
      fail('CLEAN_WORKSPACE_MEDIA_REALITY_DRIFT', 'Committed Workspace media bytes drifted.');
    }
    const physicalIdentity = Object.freeze({
      mountScopeId, inode:String(stat.ino), sizeBytes,
      fingerprintAlgorithm:bounded.fingerprintAlgorithm, fingerprintVersion:bounded.fingerprintVersion,
      contentFingerprint:bounded.contentFingerprint,
    });
    const materialKey = canonicalDigest({ schema:'physical-material-identity@2', mountScopeId,
      inode:physicalIdentity.inode, sizeBytes, fingerprintAlgorithm:bounded.fingerprintAlgorithm,
      fingerprintVersion:bounded.fingerprintVersion, contentFingerprint:bounded.contentFingerprint });
    const handleId = canonicalDigest({ schema:'foundation.workspace-material-handle-id@1',
      workspaceId:request.workspaceId, materialKey, relativePath, referenceRevision:1 });
    const handleBasis = { schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1', schemaVersion:1,
      handleId, workspaceId:request.workspaceId, ownerDomain:'libra', processId:request.libraRunId,
      endpointId, materialKey, physicalIdentity, rootHandleRef, relativePath,
      digestAlgorithm:'middle-256k-sha256', digestHex, sizeBytes, referenceRevision:1,
      accessScope:'workspace_material_read' };
    const workspaceMaterialHandle = Object.freeze({ ...handleBasis,
      fenceDigest:canonicalDigest({ schema:'foundation.workspace-material-handle-fence@1',
        handleId, workspaceId:request.workspaceId, ownerDomain:'libra', processId:request.libraRunId,
        endpointId, materialKey, physicalIdentity, rootHandleRef, relativePath,
        digestAlgorithm:'middle-256k-sha256', digestHex, sizeBytes, referenceRevision:1,
        accessScope:'workspace_material_read' }) });
    const committed = execute('clean_workspace_media_effect_commit', 'execution-foundation', repositories.foundation, (context) => {
      const repo = context.repository(repositories.foundation.repositoryId);
      const effect = repo.invoke('find_effect', { effect_class:'workspace_write', idempotency_key:request.idempotencyKey });
      if (!effect || effect.effect_id !== effectId || effect.event_attempt_id !== runtimeAuthority.authority.eventAttemptId ||
          effect.state !== 'intended') {
        fail('CLEAN_WORKSPACE_MEDIA_JOURNAL', 'Workspace media Effect journal is absent.');
      }
      const existing = repo.invoke('find_material', { workspace_id:request.workspaceId, material_handle_id:handleId });
      const byPath = repo.invoke('find_material_by_path', { workspace_id:request.workspaceId, relative_path:relativePath });
      if (existing || byPath) {
        if (!existing || byPath.material_handle_id !== handleId) fail(
          'CLEAN_WORKSPACE_MEDIA_REPLAY_CORRUPT', 'Workspace media path is bound to another immutable Material Handle.');
        const stored = mapMaterial(existing);
        if (canonicalJson(stored) !== canonicalJson(workspaceMaterialHandle)) {
          fail('CLEAN_WORKSPACE_MEDIA_REPLAY_CORRUPT', 'Committed media Handle cannot be reconstructed.');
        }
        return Object.freeze({ replayed:true, workspaceMaterialHandle:stored });
      }
      repo.invoke('insert_material', { workspace_id:request.workspaceId, material_handle_id:handleId,
        material_key:materialKey, endpoint_id:endpointId, mount_scope_id:mountScopeId, inode:physicalIdentity.inode,
        fingerprint_algorithm:bounded.fingerprintAlgorithm, fingerprint_version:bounded.fingerprintVersion,
        content_fingerprint:bounded.contentFingerprint, relative_path:relativePath, digest_algorithm:'middle-256k-sha256',
        digest_hex:digestHex, size_bytes:sizeBytes, reference_revision:1, owner_domain:'libra',
        process_id:request.libraRunId, root_handle_ref:rootHandleRef, access_scope:'workspace_material_read',
        handle_schema_ref:workspaceMaterialHandle.schemaRef, handle_json:canonicalJson(workspaceMaterialHandle),
        handle_digest:canonicalDigest(workspaceMaterialHandle), fence_digest:workspaceMaterialHandle.fenceDigest,
        state:'active' });
      return Object.freeze({ replayed:false, workspaceMaterialHandle });
    });
    if (!committed.replayed && typeof options.afterMediaEffectCommit === 'function') {
      options.afterMediaEffectCommit(Object.freeze({
        effectId,
        target,
        intentDigest:journalIntentDigest,
        workspaceMaterialHandle:committed.workspaceMaterialHandle,
      }));
    }
    const receipt = { effectId, effectReceiptId:stableMediaReceipt(effectId),
      effectScopeDigest:request.effectScopeDigest, outputTargetId:request.outputTargetId,
      outputTargetDigest:request.outputTargetDigest, workspaceMaterialHandle:committed.workspaceMaterialHandle,
      effectReceiptDigest:'' };
    receipt.effectReceiptDigest = canonicalDigest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'effectReceiptDigest')));
    return Object.freeze(receipt);
  }

  async function importExternalMaterial(request) {
    const stable = request?.stableEvidence;
    const verified = request?.verifiedExternalPackage;
    const contract = request?.workspaceDeliveryContract;
    const externalHandle = stable?.stableExternalMaterialHandle;
    if (!externalHandle || verified?.result !== 'passed' || !contract ||
        contract.libraRunId === undefined ||
        contract.stableExternalMaterialHandleId !== externalHandle.handleId ||
        contract.verifiedPackageDigest !== canonicalDigest(verified) ||
        !verified.verifiedMemberIds.includes(contract.externalMemberId)) {
      fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_FENCE',
        'External Workspace import does not bind one verified member and Run.');
    }
    const member = externalHandle.outputSnapshot.members.find((item) =>
      item.externalMemberId === contract.externalMemberId);
    if (!member || member.relativePath.includes('\\')) {
      fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_MEMBER',
        'External Workspace import member is absent or not canonical.');
    }
    if (typeof externalLandingResolver !== 'function' ||
        !externalHandle.landingBinding) {
      fail('CLEAN_WORKSPACE_EXTERNAL_LANDING_RESOLVER',
        'External Workspace import requires the frozen Platform Landing resolver.');
    }
    const landing = externalLandingResolver({
      integrationId: externalHandle.integrationId,
      configRevision: externalHandle.configRevision,
      bindingId: externalHandle.landingBinding.bindingId,
      bindingRevision: externalHandle.landingBinding.bindingRevision,
      bindingDigest: externalHandle.landingBinding.bindingDigest,
      endpointId: externalHandle.endpointId,
      mountScopeId: externalHandle.landingBinding.mountScopeId,
      mountScopeRevision: externalHandle.landingBinding.mountScopeRevision,
      location: externalHandle.location,
    });
    const location = path.resolve(landing.absolutePath);
    let source = location;
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      source = path.resolve(location, ...relative(member.relativePath).split('/'));
    }
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_CONTAINMENT',
        'External Workspace import source is outside the frozen Landing handle.');
    }
    const sourceFingerprint = require('./helix/integrations/bounded-material-fingerprint')
      .computeBoundedMaterialFingerprintSync(source);
    const sourceStat = sourceFingerprint.stat;
    if (Number(sourceStat.size) !== member.sizeBytes) {
      fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_IDENTITY',
        'External Workspace import source differs from its verified Provider snapshot.');
    }
    const effectScopeDigest = canonicalDigest({
      schema: 'libra.external-workspace-import-scope@1',
      contractId: contract.contractId,
      contractDigest: contract.digest,
      stableExternalMaterialHandleId: externalHandle.handleId,
      externalMemberId: member.externalMemberId,
    });
    const receipt = await materializeMedia({
      libraRunId: contract.libraRunId,
      workspaceId: contract.workspaceId,
      relativePath: contract.targetRelativePath,
      intentDigest: contract.digest,
      idempotencyKey: request.idempotencyKey,
      effectScopeDigest,
      outputTargetId: contract.contractId,
      outputTargetDigest: contract.digest,
      runtimeEffectAuthority: request.runtimeEffectAuthority,
      produce: async (temporary) => {
        await pipeline(
          fs.createReadStream(source),
          fs.createWriteStream(temporary, { flags:'wx' }),
        );
        const afterFingerprint = require('./helix/integrations/bounded-material-fingerprint')
          .computeBoundedMaterialFingerprintSync(source);
        const after = afterFingerprint.stat;
        if (after.dev !== sourceStat.dev || after.ino !== sourceStat.ino ||
            after.size !== sourceStat.size || after.mtimeNs !== sourceStat.mtimeNs ||
            after.ctimeNs !== sourceStat.ctimeNs || afterFingerprint.contentFingerprint !== sourceFingerprint.contentFingerprint) {
          fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_SOURCE_CHANGED',
            'External Landing source changed during Workspace import.');
        }
      },
    });
    if (receipt.workspaceMaterialHandle.sizeBytes !== member.sizeBytes ||
        receipt.workspaceMaterialHandle.digestAlgorithm !== 'middle-256k-sha256') {
      fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_RESULT',
        'Imported Workspace material does not preserve the verified external member.');
    }
    const importedPath = resolveMaterialLocation(receipt.workspaceMaterialHandle);
    const importedStat = fs.statSync(importedPath, { bigint:true });
    if (importedStat.dev === sourceStat.dev && importedStat.ino === sourceStat.ino) {
      fail('CLEAN_WORKSPACE_EXTERNAL_IMPORT_NOT_INDEPENDENT',
        'Workspace import must create an independent Physical Material.');
    }
    return receipt.workspaceMaterialHandle;
  }

  function stableMediaReceipt(effectId) {
    return 'libra-workspace-media-receipt-' + effectId.slice(0, 40);
  }

  function resolveMaterialLocation(handle) {
    const root = ensureRoot();
    if (!handle || handle.schemaRef !== 'helix://contracts/types/WorkspaceMaterialHandle/v1' ||
        handle.schemaVersion !== 1 || handle.ownerDomain !== 'libra' || handle.rootHandleRef !== root.rootHandleRef ||
        typeof handle.workspaceId !== 'string' || typeof handle.handleId !== 'string' || typeof handle.relativePath !== 'string') {
      fail('CLEAN_WORKSPACE_MEDIA_HANDLE_INVALID', 'Workspace media read requires an exact typed Material Handle.');
    }
    const stored = execute('clean_workspace_media_read_handle', 'execution-foundation', repositories.foundation, (context) =>
      mapMaterial(context.repository(repositories.foundation.repositoryId).invoke('find_material', {
        workspace_id:handle.workspaceId, material_handle_id:handle.handleId,
      })));
    if (!stored || canonicalJson(stored) !== canonicalJson(handle)) {
      fail('CLEAN_WORKSPACE_MEDIA_HANDLE_STALE', 'Workspace media Handle is absent or no longer exact.');
    }
    const target = path.resolve(absoluteRoot, handle.workspaceId, ...relative(handle.relativePath).split('/'));
    const workspaceRoot = path.resolve(absoluteRoot, handle.workspaceId);
    if (!target.startsWith(workspaceRoot + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      fail('CLEAN_WORKSPACE_MEDIA_REALITY_DRIFT', 'Workspace media Reality is absent or escaped its root.');
    }
    const bounded = require('./helix/integrations/bounded-material-fingerprint').computeBoundedMaterialFingerprintSync(target);
    if (bounded.contentFingerprint !== handle.physicalIdentity.contentFingerprint ||
        bounded.fingerprintAlgorithm !== handle.physicalIdentity.fingerprintAlgorithm ||
        bounded.fingerprintVersion !== handle.physicalIdentity.fingerprintVersion ||
        Number(bounded.stat.size) !== handle.sizeBytes || String(bounded.stat.ino) !== handle.physicalIdentity.inode) {
      fail('CLEAN_WORKSPACE_MEDIA_REALITY_DRIFT', 'Workspace media Reality no longer matches its bounded identity.');
    }
    return target;
  }

  return Object.freeze({
    acquireArtifact,
    rootPath: absoluteRoot,
    rootSnapshot: ensureRoot,
    materializeArtifact,
    materializeMedia,
    importExternalMaterial,
    openFrameCompositeSink,
    recoverMaterializedArtifact,
    readArtifactBytes,
    readMaterializedArtifact,
    resolveMaterialLocation,
    observeSpace,
    reclaimEmptyWorkspace,
    reclaimMaterial,
  });
}

module.exports = Object.freeze({
  CleanWorkspaceProductPortError,
  createCleanWorkspaceProductPort,
});
