'use strict';

const { createRepositoryDefinition } = require('./owner-repository');

class ArtifactRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new ArtifactRepositoryError(code, message, details); }

function createArtifactRepository(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P5_ARTIFACT_REPOSITORY_DEPENDENCIES', 'Schema manifest and Foundation unit of work are required.');
  }
  const definition = createRepositoryDefinition({
    repositoryId: 'foundation_artifacts', owner: 'execution-foundation', schemaManifest: options.schemaManifest,
    statements: {
      insert_artifact: { kind: 'insert', tableId: 'fx_artifact_registry', columns: [
        'artifact_handle_id', 'artifact_kind', 'owner_domain', 'owner_scope_type', 'owner_scope_id', 'storage_ref',
        'digest_algorithm', 'digest_hex', 'size_bytes', 'media_type', 'provenance_ref', 'reference_revision', 'state', 'created_at_ms'
      ] },
      find_artifact: { kind: 'select-one', tableId: 'fx_artifact_registry', columns: [
        'artifact_handle_id', 'artifact_kind', 'owner_domain', 'owner_scope_type', 'owner_scope_id', 'storage_ref',
        'digest_algorithm', 'digest_hex', 'size_bytes', 'media_type', 'provenance_ref', 'reference_revision', 'state', 'created_at_ms'
      ], keyColumns: ['artifact_handle_id'] },
      find_artifact_identity: { kind: 'select-one', tableId: 'fx_artifact_registry', columns: [
        'artifact_handle_id', 'artifact_kind', 'owner_domain', 'owner_scope_type', 'owner_scope_id', 'storage_ref',
        'digest_algorithm', 'digest_hex', 'size_bytes', 'media_type', 'provenance_ref', 'reference_revision', 'state', 'created_at_ms'
      ], keyColumns: ['owner_domain', 'owner_scope_type', 'owner_scope_id', 'digest_algorithm', 'digest_hex', 'artifact_kind'] },
      cas_artifact: { kind: 'update', tableId: 'fx_artifact_registry',
        setColumns: ['reference_revision', 'state'], keyColumns: ['artifact_handle_id'],
        compareColumns: [{ column: 'reference_revision', parameter: 'expected_reference_revision' }] },
      revival_effect:{kind:'select-one',tableId:'fx_effect_journal',columns:['effect_id','event_attempt_id','state'],keyColumns:['effect_class','idempotency_key']},
      revival_attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','state'],keyColumns:['event_attempt_id']},
      revival_event:{kind:'select-one',tableId:'fx_workflow_events',columns:['event_id','work_id','capability_ref','state'],keyColumns:['event_id']},
      revival_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','state'],keyColumns:['work_id']},
      insert_reference: { kind: 'insert', tableId: 'fx_artifact_references', columns: [
        'artifact_handle_id', 'consumer_domain', 'consumer_scope_type', 'consumer_scope_id', 'reference_kind',
        'reference_revision', 'state', 'created_at_ms'
      ] },
      list_references: { kind: 'select-all', tableId: 'fx_artifact_references', columns: [
        'artifact_handle_id', 'consumer_domain', 'consumer_scope_type', 'consumer_scope_id', 'reference_kind',
        'reference_revision', 'state', 'created_at_ms', 'released_at_ms'
      ], keyColumns: ['artifact_handle_id'] },
      release_reference: { kind: 'update', tableId: 'fx_artifact_references', setColumns: ['state', 'released_at_ms'],
        keyColumns: ['artifact_handle_id', 'consumer_domain', 'consumer_scope_type', 'consumer_scope_id', 'reference_kind', 'reference_revision'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
    }
  });

  function execute(body,readParticipants=[],boundBusinessOwner=null) {
    return options.unitOfWork.execute([...readParticipants,{
      participantId: 'foundation_artifacts', owner: 'execution-foundation',...(boundBusinessOwner?{boundBusinessOwner}:{}), repositories: [definition], execute: body
    }]).foundation_artifacts;
  }

  return Object.freeze({
    register(record) {
      return execute((context) => {
        const repository = context.repository(definition.repositoryId);
        const existing = repository.invoke('find_artifact_identity', identityParameters(record));
        if (existing) return mapArtifact(existing);
        repository.invoke('insert_artifact', artifactParameters(record));
        return Object.freeze({ ...record });
      });
    },
    reactivateVerified({artifactHandleId,expectedReferenceRevision,context,verifyReality,readParticipants=[]}){
      return execute(tx=>{const repo=tx.repository(definition.repositoryId),row=repo.invoke('find_artifact',{artifact_handle_id:artifactHandleId}),
        effect=repo.invoke('revival_effect',{effect_class:'workspace_write',idempotency_key:context?.idempotencyKey}),
        original=effect&&repo.invoke('revival_attempt',{event_attempt_id:effect.event_attempt_id}),attempt=context?.eventAttemptId&&repo.invoke('revival_attempt',{event_attempt_id:context.eventAttemptId}),
        event=context?.eventId&&repo.invoke('revival_event',{event_id:context.eventId}),work=event&&repo.invoke('revival_work',{work_id:event.work_id});
        if(!row||row.state!=='deleted'||row.reference_revision!==expectedReferenceRevision||row.owner_domain!=='people'||row.owner_scope_type!=='person'||
          work?.owner_domain!=='people'||work.work_id!==context.workId||work.process_type!=='people_image_preparation'||work.state!=='running'||event?.state!=='executing'||
          event.capability_ref!==(row.artifact_kind==='reference-image'?'people.reference_asset.import@1':row.artifact_kind==='reference-embedding'?'shared.face.embedding.compute@1':null)||original?.event_id!==event.event_id||
          attempt?.event_id!==event.event_id||attempt.state!=='executing'||!['intended','reconcile_required'].includes(effect?.state)||typeof verifyReality!=='function'||verifyReality(mapArtifact(row))!==true)
          fail('P5_ARTIFACT_REPUBLICATION_FENCED','Reactivation requires exact deleted bytes and their actual People preparation Effect.');
        advance(repo,mapArtifact(row),'active');return mapArtifact(repo.invoke('find_artifact',{artifact_handle_id:artifactHandleId}));
      },readParticipants,'people');
    },
    get(artifactHandleId) {
      return execute((context) => mapArtifact(context.repository(definition.repositoryId).invoke('find_artifact', {
        artifact_handle_id: artifactHandleId
      })));
    },
    inspect(artifactHandleId, expectedReferenceRevision, body) {
      return execute((context) => {
        const repository = context.repository(definition.repositoryId);
        const row = repository.invoke('find_artifact', { artifact_handle_id: artifactHandleId });
        if (!row) fail('P5_ARTIFACT_NOT_FOUND', 'Artifact was not found.');
        if (row.reference_revision !== expectedReferenceRevision) fail('P5_ARTIFACT_REVISION_CONFLICT', 'Artifact reference revision is stale.');
        const references = repository.invoke('list_references', { artifact_handle_id: artifactHandleId }).map(mapReference);
        return body(Object.freeze({ artifact: mapArtifact(row), references: Object.freeze(references) }));
      });
    },
    mutate(artifactHandleId, expectedReferenceRevision, body) {
      return execute((context) => {
        const repository = context.repository(definition.repositoryId);
        const row = repository.invoke('find_artifact', { artifact_handle_id: artifactHandleId });
        if (!row) fail('P5_ARTIFACT_NOT_FOUND', 'Artifact was not found.');
        if (row.reference_revision !== expectedReferenceRevision) fail('P5_ARTIFACT_REVISION_CONFLICT', 'Artifact reference revision is stale.');
        const references = repository.invoke('list_references', { artifact_handle_id: artifactHandleId }).map(mapReference);
        return body(Object.freeze({ artifact: mapArtifact(row), references: Object.freeze(references), repository, commitTimeMs: context.commitTimeMs }));
      });
    },
    definition
  });
}

function advance(repository, artifact, nextState) {
  const nextRevision = artifact.referenceRevision + 1;
  const result = repository.invoke('cas_artifact', {
    reference_revision: nextRevision, state: nextState, artifact_handle_id: artifact.artifactHandleId,
    expected_reference_revision: artifact.referenceRevision
  });
  if (result.changes !== 1) fail('P5_ARTIFACT_REVISION_CONFLICT', 'Artifact reference revision changed concurrently.');
  return nextRevision;
}

function artifactParameters(item) {
  return {
    artifact_handle_id: item.artifactHandleId, artifact_kind: item.artifactKind, owner_domain: item.ownerDomain,
    owner_scope_type: item.ownerScopeType, owner_scope_id: item.ownerScopeId, storage_ref: item.storageRef,
    digest_algorithm: item.digestAlgorithm, digest_hex: item.digestHex, size_bytes: item.sizeBytes,
    media_type: item.mediaType, provenance_ref: JSON.stringify(item.provenanceRef), reference_revision: item.referenceRevision,
    state: item.state, created_at_ms: item.createdAtMs
  };
}
function identityParameters(item) {
  const row = artifactParameters(item);
  return {
    owner_domain: row.owner_domain, owner_scope_type: row.owner_scope_type, owner_scope_id: row.owner_scope_id,
    digest_algorithm: row.digest_algorithm, digest_hex: row.digest_hex, artifact_kind: row.artifact_kind
  };
}
function mapArtifact(row) {
  return row && Object.freeze({
    artifactHandleId: row.artifact_handle_id, artifactKind: row.artifact_kind, ownerDomain: row.owner_domain,
    ownerScopeType: row.owner_scope_type, ownerScopeId: row.owner_scope_id, storageRef: row.storage_ref,
    digestAlgorithm: row.digest_algorithm, digestHex: row.digest_hex, sizeBytes: row.size_bytes,
    mediaType: row.media_type, provenanceRef: parseProvenance(row.provenance_ref), referenceRevision: row.reference_revision,
    state: row.state, createdAtMs: row.created_at_ms
  });
}

function parseProvenance(value) {
  try {
    const parsed = JSON.parse(value);
    return Object.freeze(parsed);
  } catch (error) {
    fail('P5_ARTIFACT_PROVENANCE_CORRUPT', 'Stored Artifact provenance is not valid JSON.');
  }
}
function mapReference(row) {
  return Object.freeze({
    artifactHandleId: row.artifact_handle_id, consumerDomain: row.consumer_domain,
    consumerScopeType: row.consumer_scope_type, consumerScopeId: row.consumer_scope_id,
    referenceKind: row.reference_kind, referenceRevision: row.reference_revision,
    state: row.state, createdAtMs: row.created_at_ms, releasedAtMs: row.released_at_ms
  });
}

module.exports = Object.freeze({ ArtifactRepositoryError, advance, createArtifactRepository });
