'use strict';

const { digest } = require('./ddl-compiler');
const { createMaterialControlParticipant } = require('./material-control');
const { createRepositoryDefinition } = require('./owner-repository');
const { createOutboxParticipant } = require('./outbox-inbox');

const BUSINESS_OWNERS = new Set(['procurement', 'libra', 'arca', 'perception', 'people']);
const DOMAIN_FACT_EFFECT_CLASS = 'domain_fact_commit';
const SHA256 = /^[0-9a-f]{64}$/;

class DomainCommitRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainCommitRegistryError';
    this.code = code;
    this.details = details;
  }
}

class DomainCommitReplay extends Error {
  constructor(marker) {
    super('Domain Commit replay');
    this.marker = marker;
  }
}

function fail(code, message, details) {
  throw new DomainCommitRegistryError(code, message, details);
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

function key(value) {
  return [value.ownerDomain, value.aggregateType, value.factType, value.factSchemaRef].join('|');
}

function text(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P3_DOMAIN_COMMIT_INVALID_FIELD', 'Domain Commit field is required.', { field });
  return value;
}

function validateHandle(handle) {
  if (!handle || handle.schemaRef !== 'helix://contracts/types/DomainFactCommitHandle/v1' || handle.schemaVersion !== 1 ||
      !BUSINESS_OWNERS.has(handle.ownerDomain) || !Number.isSafeInteger(handle.expectedRevision) || handle.expectedRevision < 0) {
    fail('P3_DOMAIN_COMMIT_INVALID_HANDLE', 'Domain Fact Commit Handle is invalid.');
  }
  for (const field of ['handleId', 'aggregateType', 'aggregateId', 'factType', 'factSchemaRef', 'commitIdempotencyKey']) text(handle[field], field);
  for (const field of ['payloadDigest', 'eventFenceDigest']) {
    if (!SHA256.test(handle[field] || '')) fail('P3_DOMAIN_COMMIT_INVALID_DIGEST', 'Domain Commit digest must be lowercase SHA-256.', { field });
  }
}

function createDomainCommitRegistry(options) {
  if (!options || !Array.isArray(options.registrations) || options.registrations.length === 0) {
    fail('P3_DOMAIN_COMMIT_EMPTY_REGISTRY', 'At least one typed Domain fact registration is required.');
  }
  const entries = new Map();
  const manifest = [];
  for (const registration of options.registrations) {
    if (!registration || !BUSINESS_OWNERS.has(registration.ownerDomain) || typeof registration.createParticipant !== 'function') {
      fail('P3_DOMAIN_COMMIT_INVALID_REGISTRATION', 'Typed registration Owner and participant factory are required.');
    }
    for (const field of ['aggregateType', 'factType', 'factSchemaRef']) text(registration[field], field);
    if (!registration.factSchemaRef.startsWith('helix://')) fail('P3_DOMAIN_COMMIT_INVALID_SCHEMA_REF', 'Fact schema ref must be nominal.');
    if (registration.effectClass !== DOMAIN_FACT_EFFECT_CLASS) fail(
      'P3_DOMAIN_COMMIT_EFFECT_CLASS_REQUIRED', 'Typed Domain fact registration requires the domain_fact_commit Effect Class.'
    );
    const registrationKey = key(registration);
    if (entries.has(registrationKey)) fail('P3_DOMAIN_COMMIT_DUPLICATE_REGISTRATION', 'Typed registration identity must be unique.', { registrationKey });
    const metadata = Object.freeze({
      ownerDomain: registration.ownerDomain,
      aggregateType: registration.aggregateType,
      factType: registration.factType,
      factSchemaRef: registration.factSchemaRef,
      effectClass: registration.effectClass,
      revisionFence: registration.revisionFence === true
    });
    if (!metadata.revisionFence) fail('P3_DOMAIN_COMMIT_REVISION_FENCE_REQUIRED', 'Every Domain fact registration requires a revision fence.');
    entries.set(registrationKey, { metadata, createParticipant: registration.createParticipant });
    manifest.push(metadata);
  }
  manifest.sort((left, right) => key(left).localeCompare(key(right)));
  const registryDigest = digest(canonicalJson(manifest));
  return Object.freeze({
    manifest: Object.freeze({ entryCount: manifest.length, registryDigest, entries: Object.freeze(manifest) }),
    resolve(handle, payload) {
      validateHandle(handle);
      const payloadJson = canonicalJson(payload);
      if (typeof payloadJson !== 'string' || digest(payloadJson) !== handle.payloadDigest) fail(
        'P3_DOMAIN_COMMIT_PAYLOAD_DIGEST_MISMATCH', 'Handle payload digest does not match the typed fact payload.'
      );
      const registration = entries.get(key(handle));
      if (!registration) fail('P3_DOMAIN_COMMIT_UNREGISTERED_FACT', 'No exact Owner/fact schema registration exists.', {
        ownerDomain: handle.ownerDomain, factSchemaRef: handle.factSchemaRef
      });
      const participant = registration.createParticipant(Object.freeze({ handle, payload }));
      if (!participant || participant.owner !== handle.ownerDomain || participant.boundBusinessOwner !== undefined && participant.boundBusinessOwner !== handle.ownerDomain) {
        fail('P3_DOMAIN_COMMIT_PARTICIPANT_OWNER_MISMATCH', 'Typed participant does not preserve the registered Domain Owner.');
      }
      return participant;
    }
  });
}

function markerRepository(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'domain_commit_marker', owner: 'execution-foundation', schemaManifest,
    statements: {
      find: {
        kind: 'select-one', tableId: 'fx_commit_markers',
        columns: ['commit_marker', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms'],
        keyColumns: ['commit_marker']
      },
      insert: {
        kind: 'insert', tableId: 'fx_commit_markers',
        columns: ['commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms']
      }
    }
  });
}

function createDomainCommitCoordinator(options) {
  if (!options || !options.schemaManifest || !options.registry || typeof options.registry.resolve !== 'function' ||
      !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P3_DOMAIN_COMMIT_INVALID_COORDINATOR', 'Schema manifest, typed registry, and SqliteUnitOfWork are required.');
  }
  const marker = markerRepository(options.schemaManifest);
  return Object.freeze({
    execute(request) {
      if (!request || !request.handle || !request.commitMarker || !Array.isArray(request.outboxMessages) || request.outboxMessages.length === 0) {
        fail('P3_DOMAIN_COMMIT_INVALID_REQUEST', 'Handle, commit marker, and Outbox messages are required.');
      }
      const handle = request.handle;
      const domainParticipant = options.registry.resolve(handle, request.payload);
      const commitMarkerId = text(request.commitMarker.commitMarker, 'commitMarker');
      const commitDigest = SHA256.test(request.commitMarker.commitDigest || '')
        ? request.commitMarker.commitDigest
        : fail('P3_DOMAIN_COMMIT_INVALID_DIGEST', 'Commit Marker digest must be lowercase SHA-256.');
      const participants = [{
        participantId: 'domain_commit_preflight',
        owner: 'execution-foundation',
        boundBusinessOwner: handle.ownerDomain,
        repositories: [marker],
        execute(context) {
          const existing = context.repository('domain_commit_marker').invoke('find', { commit_marker: commitMarkerId });
          if (!existing) return;
          if (existing.owner_domain !== handle.ownerDomain || existing.scope_type !== handle.aggregateType ||
              existing.scope_id !== handle.aggregateId || existing.commit_digest !== commitDigest) {
            fail('P3_DOMAIN_COMMIT_MARKER_CONFLICT', 'Commit Marker already exists with a different signed commit.');
          }
          throw new DomainCommitReplay(Object.freeze({ ...existing }));
        }
      }, domainParticipant];
      if (request.control) participants.push(createMaterialControlParticipant({
        schemaManifest: options.schemaManifest,
        handle: request.control.handle,
        changes: request.control.changes,
        commitMarker: request.commitMarker.commitMarker,
        participantId: 'material_control'
      }));
      participants.push({
        participantId: 'domain_commit_marker',
        owner: 'execution-foundation',
        boundBusinessOwner: handle.ownerDomain,
        repositories: [marker],
        execute(context) {
          context.repository('domain_commit_marker').invoke('insert', {
            commit_marker: commitMarkerId,
            effect_id: request.commitMarker.effectId || null,
            owner_domain: handle.ownerDomain,
            scope_type: handle.aggregateType,
            scope_id: handle.aggregateId,
            commit_digest: commitDigest,
            committed_at_ms: context.commitTimeMs
          });
        }
      });
      participants.push(createOutboxParticipant({
        schemaManifest: options.schemaManifest,
        participantId: 'domain_commit_outbox',
        producerDomain: handle.ownerDomain,
        messages: request.outboxMessages
      }));
      try {
        const results = options.unitOfWork.execute(participants);
        return Object.freeze({
          replayed: false,
          domainResult: results[domainParticipant.participantId],
          controlResult: results.material_control,
          outboxResult: results.domain_commit_outbox,
          commitMarker: commitMarkerId
        });
      } catch (error) {
        if (error instanceof DomainCommitReplay) return Object.freeze({
          replayed: true, domainResult: undefined, controlResult: undefined, outboxResult: undefined, commitMarker: error.marker.commit_marker
        });
        throw error;
      }
    }
  });
}

module.exports = Object.freeze({ DomainCommitRegistryError, createDomainCommitCoordinator, createDomainCommitRegistry });
