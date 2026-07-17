'use strict';

const { advance } = require('../persistence/artifact-repository');

const SHA256 = /^[0-9a-f]{64}$/;
const DOMAINS = new Set(['procurement', 'libra', 'arca', 'perception', 'people']);
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

class ArtifactRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactRegistryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new ArtifactRegistryError(code, message, details); }
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    fail(code, 'Artifact operation must match the exact contract.');
  }
}
function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_ARTIFACT_FIELD', 'Artifact field is invalid.', { field });
  return value;
}
function boundedText(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) {
    fail('P5_ARTIFACT_FIELD', 'Artifact field is invalid.', { field });
  }
  return value;
}
function positive(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P5_ARTIFACT_REVISION', 'Artifact revision must be positive.', { field });
  return value;
}
function provenance(value) {
  exact(value, ['objectType', 'objectId', 'revision', 'digest'], 'P5_ARTIFACT_PROVENANCE_SHAPE');
  return Object.freeze({
    objectType: token(value.objectType, 'provenanceRef.objectType'),
    objectId: token(value.objectId, 'provenanceRef.objectId'),
    revision: positive(value.revision, 'provenanceRef.revision'),
    digest: SHA256.test(value.digest || '') ? value.digest : fail('P5_ARTIFACT_PROVENANCE_DIGEST', 'Artifact provenance digest is invalid.')
  });
}

function createArtifactRegistry(options) {
  if (!options || !options.repository || !options.rootResolver || !options.storageResolver || !options.pathAuthority ||
      !options.storageProbe || typeof options.storageProbe.inspect !== 'function' ||
      !options.gcAuthorityVerifier || typeof options.gcAuthorityVerifier.verify !== 'function' ||
      typeof options.createIntentId !== 'function') {
    fail('P5_ARTIFACT_DEPENDENCIES', 'Artifact Repository, controlled root, storage resolver, path authority, probe, and ID source are required.');
  }
  const deletionIntents = new Map();

  function resolveStoredReality(storageRef) {
    const location = options.storageResolver.resolveStored(storageRef);
    exact(location, ['rootId', 'rootConfigRevision', 'resolvedRoot', 'resolvedPath'], 'P5_ARTIFACT_STORAGE_LOCATION_SHAPE');
    const root = options.rootResolver.resolve(Object.freeze({
      rootId: location.rootId, expectedConfigRevision: location.rootConfigRevision,
      ownerScope: 'platform-settings', rootKind: 'internal-artifact'
    }));
    if (root.resolvedRoot !== location.resolvedRoot || !options.pathAuthority.contains(root.resolvedRoot, location.resolvedPath)) {
      fail('P5_ARTIFACT_CONTAINMENT', 'Artifact storage is outside the current controlled root.');
    }
    return Object.freeze({ location, root });
  }

  function inspectExact(artifact, location) {
    const reality = options.storageProbe.inspect(Object.freeze({
      storageRef: artifact.storageRef, resolvedPath: location.resolvedPath
    }));
    exact(reality, ['exists', 'digestAlgorithm', 'digestHex', 'sizeBytes', 'mediaType'], 'P5_ARTIFACT_PROBE_SHAPE');
    if (reality.exists !== true || reality.digestAlgorithm !== artifact.digestAlgorithm ||
        reality.digestHex !== artifact.digestHex || reality.sizeBytes !== artifact.sizeBytes ||
        reality.mediaType !== artifact.mediaType) {
      fail('P5_ARTIFACT_REALITY_DRIFT', 'Artifact checksum, size, media type, or existence does not match the handle.');
    }
    return reality;
  }

  function register(request) {
    exact(request, ['artifactHandleId', 'artifactKind', 'ownerDomain', 'ownerScopeType', 'ownerScopeId', 'rootId',
      'rootConfigRevision', 'relativePath', 'digestHex', 'sizeBytes', 'mediaType', 'provenanceRef', 'createdAtMs'],
    'P5_ARTIFACT_REGISTER_SHAPE');
    if (!DOMAINS.has(request.ownerDomain) || typeof request.relativePath !== 'string' || request.relativePath.length < 1 ||
        request.relativePath.length > 4096 || request.relativePath.split(/[\\/]+/).includes('..') ||
        !SHA256.test(request.digestHex || '') || !Number.isSafeInteger(request.sizeBytes) || request.sizeBytes < 0 ||
        !Number.isSafeInteger(request.createdAtMs) || request.createdAtMs < 0) {
      fail('P5_ARTIFACT_REGISTER_INVALID', 'Artifact registration identity, path, digest, size, or time is invalid.');
    }
    const root = options.rootResolver.resolve(Object.freeze({
      rootId: request.rootId, expectedConfigRevision: request.rootConfigRevision,
      ownerScope: 'platform-settings', rootKind: 'internal-artifact'
    }));
    const location = options.storageResolver.resolveNew(Object.freeze({
      rootId: request.rootId, rootConfigRevision: request.rootConfigRevision,
      resolvedRoot: root.resolvedRoot, relativePath: request.relativePath
    }));
    exact(location, ['storageRef', 'resolvedPath'], 'P5_ARTIFACT_STORAGE_LOCATION_SHAPE');
    if (!options.pathAuthority.contains(root.resolvedRoot, location.resolvedPath)) {
      fail('P5_ARTIFACT_CONTAINMENT', 'Artifact registration path escapes the controlled root.');
    }
    const record = Object.freeze({
      artifactHandleId: token(request.artifactHandleId, 'artifactHandleId'),
      artifactKind: token(request.artifactKind, 'artifactKind'), ownerDomain: request.ownerDomain,
      ownerScopeType: token(request.ownerScopeType, 'ownerScopeType'), ownerScopeId: token(request.ownerScopeId, 'ownerScopeId'),
      storageRef: token(location.storageRef, 'storageRef'), digestAlgorithm: 'sha256', digestHex: request.digestHex,
      sizeBytes: request.sizeBytes, mediaType: boundedText(request.mediaType, 'mediaType'),
      provenanceRef: provenance(request.provenanceRef), referenceRevision: 1,
      state: 'active', createdAtMs: request.createdAtMs
    });
    inspectExact(record, location);
    const registered = options.repository.register(record);
    if (registered.state !== 'active') fail('P5_ARTIFACT_NOT_ACTIVE', 'Matching Artifact is not active.');
    if (registered.storageRef !== record.storageRef) {
      fail('P5_ARTIFACT_DUPLICATE_STORAGE', 'Matching Artifact content is already registered at another controlled storage reference.');
    }
    const registeredLocation = resolveStoredReality(registered.storageRef).location;
    inspectExact(registered, registeredLocation);
    return toHandle(registered);
  }

  function addReference(request) {
    exact(request, ['artifactHandleId', 'expectedReferenceRevision', 'consumerDomain', 'consumerScopeType',
      'consumerScopeId', 'referenceKind', 'createdAtMs'], 'P5_ARTIFACT_REFERENCE_SHAPE');
    if (!DOMAINS.has(request.consumerDomain) || !Number.isSafeInteger(request.createdAtMs) || request.createdAtMs < 0) {
      fail('P5_ARTIFACT_REFERENCE_INVALID', 'Artifact reference consumer or time is invalid.');
    }
    token(request.artifactHandleId, 'artifactHandleId');
    token(request.consumerScopeType, 'consumerScopeType');
    token(request.consumerScopeId, 'consumerScopeId');
    token(request.referenceKind, 'referenceKind');
    return options.repository.mutate(request.artifactHandleId, positive(request.expectedReferenceRevision, 'expectedReferenceRevision'),
      ({ artifact, references, repository }) => {
        if (artifact.state !== 'active') fail('P5_ARTIFACT_NOT_ACTIVE', 'Only an active Artifact can receive a reference.');
        const same = references.find((item) => item.state === 'active' && item.consumerDomain === request.consumerDomain &&
          item.consumerScopeType === request.consumerScopeType && item.consumerScopeId === request.consumerScopeId &&
          item.referenceKind === request.referenceKind);
        if (same) fail('P5_ARTIFACT_REFERENCE_ALREADY_ACTIVE', 'The exact Artifact reference is already active.');
        const nextRevision = artifact.referenceRevision + 1;
        repository.invoke('insert_reference', {
          artifact_handle_id: artifact.artifactHandleId, consumer_domain: request.consumerDomain,
          consumer_scope_type: token(request.consumerScopeType, 'consumerScopeType'),
          consumer_scope_id: token(request.consumerScopeId, 'consumerScopeId'),
          reference_kind: token(request.referenceKind, 'referenceKind'), reference_revision: nextRevision,
          state: 'active', created_at_ms: request.createdAtMs
        });
        advance(repository, artifact, 'active');
        return Object.freeze({ artifactHandleId: artifact.artifactHandleId, referenceRevision: nextRevision, state: 'active' });
      });
  }

  function releaseReference(request) {
    exact(request, ['artifactHandleId', 'expectedArtifactRevision', 'consumerDomain', 'consumerScopeType',
      'consumerScopeId', 'referenceKind', 'referenceRevision', 'releasedAtMs'], 'P5_ARTIFACT_RELEASE_SHAPE');
    if (!Number.isSafeInteger(request.releasedAtMs) || request.releasedAtMs < 0) {
      fail('P5_ARTIFACT_RELEASE_TIME', 'Artifact reference release time is invalid.');
    }
    token(request.artifactHandleId, 'artifactHandleId');
    if (!DOMAINS.has(request.consumerDomain)) fail('P5_ARTIFACT_RELEASE_CONSUMER', 'Artifact reference consumer Domain is invalid.');
    const before = options.repository.get(request.artifactHandleId);
    if (!before) fail('P5_ARTIFACT_NOT_FOUND', 'Artifact was not found.');
    resolveStoredReality(before.storageRef);
    return options.repository.mutate(request.artifactHandleId, positive(request.expectedArtifactRevision, 'expectedArtifactRevision'),
      ({ artifact, references, repository }) => {
        if (artifact.state !== 'active') fail('P5_ARTIFACT_NOT_ACTIVE', 'Only an active Artifact can release a reference.');
        token(request.consumerDomain, 'consumerDomain');
        token(request.consumerScopeType, 'consumerScopeType');
        token(request.consumerScopeId, 'consumerScopeId');
        token(request.referenceKind, 'referenceKind');
        positive(request.referenceRevision, 'referenceRevision');
        const reference = references.find((item) => item.state === 'active' && item.consumerDomain === request.consumerDomain &&
          item.consumerScopeType === request.consumerScopeType && item.consumerScopeId === request.consumerScopeId &&
          item.referenceKind === request.referenceKind && item.referenceRevision === request.referenceRevision);
        if (!reference) fail('P5_ARTIFACT_REFERENCE_NOT_ACTIVE', 'Exact active Artifact reference was not found.');
        const released = repository.invoke('release_reference', {
          state: 'released', released_at_ms: request.releasedAtMs, artifact_handle_id: request.artifactHandleId,
          consumer_domain: request.consumerDomain, consumer_scope_type: request.consumerScopeType,
          consumer_scope_id: request.consumerScopeId, reference_kind: request.referenceKind,
          reference_revision: request.referenceRevision, expected_state: 'active'
        });
        if (released.changes !== 1) fail('P5_ARTIFACT_REFERENCE_NOT_ACTIVE', 'Artifact reference release lost its active fence.');
        const nextRevision = advance(repository, artifact, 'active');
        return Object.freeze({ artifactHandleId: artifact.artifactHandleId, referenceRevision: nextRevision, state: 'released' });
      });
  }

  function query(request) {
    exact(request, ['artifactHandleId', 'expectedReferenceRevision', 'requesterDomain', 'requesterScopeType',
      'requesterScopeId', 'purpose'], 'P5_ARTIFACT_QUERY_SHAPE');
    token(request.artifactHandleId, 'artifactHandleId');
    positive(request.expectedReferenceRevision, 'expectedReferenceRevision');
    if (!DOMAINS.has(request.requesterDomain)) fail('P5_ARTIFACT_QUERY_REQUESTER', 'Artifact requester Domain is invalid.');
    token(request.requesterScopeType, 'requesterScopeType');
    token(request.requesterScopeId, 'requesterScopeId');
    token(request.purpose, 'purpose');
    const artifact = options.repository.inspect(request.artifactHandleId, request.expectedReferenceRevision, ({ artifact, references }) => {
      if (artifact.state !== 'active') fail('P5_ARTIFACT_QUERY_STALE', 'Artifact is inactive.');
      const owner = artifact.ownerDomain === request.requesterDomain && artifact.ownerScopeType === request.requesterScopeType &&
        artifact.ownerScopeId === request.requesterScopeId;
      const referenced = references.some((item) => item.state === 'active' && item.consumerDomain === request.requesterDomain &&
        item.consumerScopeType === request.requesterScopeType && item.consumerScopeId === request.requesterScopeId &&
        item.referenceKind === request.purpose);
      if (!owner && !referenced) fail('P5_ARTIFACT_SCOPE_DENIED', 'Requester lacks an exact active Artifact reference.');
      return artifact;
    });
    const { location } = resolveStoredReality(artifact.storageRef);
    inspectExact(artifact, location);
    return toHandle(artifact);
  }

  function authorizeDeletion(request) {
    exact(request, ['artifactHandleId', 'expectedReferenceRevision', 'authority'], 'P5_ARTIFACT_DELETE_AUTH_SHAPE');
    const before = options.repository.get(token(request.artifactHandleId, 'artifactHandleId'));
    if (!before || before.referenceRevision !== positive(request.expectedReferenceRevision, 'expectedReferenceRevision')) {
      fail('P5_ARTIFACT_QUERY_STALE', 'Artifact is absent or stale.');
    }
    const { location } = resolveStoredReality(before.storageRef);
    inspectExact(before, location);
    return options.repository.mutate(request.artifactHandleId, request.expectedReferenceRevision,
      ({ artifact, references, repository }) => {
        exact(request.authority, ['authorityKind', 'artifactHandleId', 'digestHex', 'scopeDigest'], 'P5_ARTIFACT_DELETE_AUTHORITY_SHAPE');
        if (request.authority.authorityKind !== 'artifact-gc' || request.authority.artifactHandleId !== artifact.artifactHandleId ||
            request.authority.digestHex !== artifact.digestHex || !SHA256.test(request.authority.scopeDigest || '')) {
          fail('P5_ARTIFACT_DELETE_AUTHORITY_INVALID', 'Artifact deletion authority does not match the exact Artifact.');
        }
        if (options.gcAuthorityVerifier.verify(Object.freeze({
          authority: request.authority, artifact: toHandle(artifact), activeReferenceCount: references.filter((item) => item.state === 'active').length
        })) !== true) fail('P5_ARTIFACT_DELETE_AUTHORITY_INVALID', 'Artifact GC authority was not issued for this exact scope.');
        if (artifact.state !== 'active') fail('P5_ARTIFACT_NOT_ACTIVE', 'Only an active Artifact can become GC eligible.');
        if (references.some((item) => item.state === 'active')) fail('P5_ARTIFACT_ACTIVE_REFERENCES', 'Artifact with active references is not GC eligible.');
        const nextRevision = advance(repository, artifact, 'gc_eligible');
        const intentId = token(options.createIntentId(), 'intentId');
        const intent = Object.freeze({
          intentId, artifactHandleId: artifact.artifactHandleId, storageRef: artifact.storageRef,
          digestHex: artifact.digestHex, sizeBytes: artifact.sizeBytes, referenceRevision: nextRevision,
          authorityScopeDigest: request.authority.scopeDigest
        });
        deletionIntents.set(intentId, intent);
        return intent;
      });
  }

  function assertDeletionIntent(intent) {
    if (!intent || deletionIntents.get(intent.intentId) !== intent) {
      fail('P5_ARTIFACT_DELETE_INTENT_INVALID', 'Artifact deletion requires the exact issued GC intent.');
    }
    const artifact = options.repository.get(intent.artifactHandleId);
    if (!artifact || artifact.state !== 'gc_eligible' || artifact.referenceRevision !== intent.referenceRevision ||
        artifact.digestHex !== intent.digestHex) fail('P5_ARTIFACT_DELETE_INTENT_STALE', 'Artifact deletion intent is stale.');
    const { location } = resolveStoredReality(artifact.storageRef);
    inspectExact(artifact, location);
    return intent;
  }

  return Object.freeze({ addReference, assertDeletionIntent, authorizeDeletion, query, register, releaseReference });
}

function toHandle(item) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ArtifactHandle/v1', schemaVersion: 1,
    artifactHandleId: item.artifactHandleId, artifactKind: item.artifactKind, ownerDomain: item.ownerDomain,
    ownerScope: Object.freeze({ scopeType: item.ownerScopeType, scopeId: item.ownerScopeId }),
    storageRef: item.storageRef, digestAlgorithm: item.digestAlgorithm, digestHex: item.digestHex,
    sizeBytes: item.sizeBytes, mediaType: item.mediaType, provenanceRef: item.provenanceRef,
    referenceRevision: item.referenceRevision
  });
}

module.exports = Object.freeze({ ArtifactRegistryError, createArtifactRegistry });
