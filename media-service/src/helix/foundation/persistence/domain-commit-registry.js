'use strict';

const { digest } = require('./ddl-compiler');
const { createMaterialControlParticipant } = require('./material-control');
const { createRepositoryDefinition } = require('./owner-repository');
const { createOutboxParticipant } = require('./outbox-inbox');
const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');

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
  for (const field of ['handleId', 'aggregateType', 'aggregateId', 'factType', 'factSchemaRef', 'resultSchemaRef', 'commitIdempotencyKey']) text(handle[field], field);
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
    resolve(handle, payload, commitContext = {}) {
      validateHandle(handle);
      const payloadJson = canonicalJson(payload);
      if (typeof payloadJson !== 'string' || digest(payloadJson) !== handle.payloadDigest) fail(
        'P3_DOMAIN_COMMIT_PAYLOAD_DIGEST_MISMATCH', 'Handle payload digest does not match the typed fact payload.'
      );
      const registration = entries.get(key(handle));
      if (!registration) fail('P3_DOMAIN_COMMIT_UNREGISTERED_FACT', 'No exact Owner/fact schema registration exists.', {
        ownerDomain: handle.ownerDomain, factSchemaRef: handle.factSchemaRef
      });
      const participant = registration.createParticipant(Object.freeze({ handle, payload, ...commitContext }));
      if (!participant || participant.owner !== handle.ownerDomain || participant.boundBusinessOwner !== undefined && participant.boundBusinessOwner !== handle.ownerDomain) {
        fail('P3_DOMAIN_COMMIT_PARTICIPANT_OWNER_MISMATCH', 'Typed participant does not preserve the registered Domain Owner.');
      }
      return participant;
    }
  });
}

function createCanonicalTransactionRegistry(options) {
  if (!options || !Array.isArray(options.contracts) || options.contracts.length === 0) {
    fail('P3_DOMAIN_COMMIT_TRANSACTION_REGISTRY_REQUIRED', 'Canonical transaction contracts are required.');
  }
  const entries = new Map();
  for (const document of options.contracts) {
    const contract = document && document.contract;
    if (!contract || document.schemaVersion !== 1 || document.contractVersion !== 1 ||
        document.contractId !== 'helix://contracts/transactions/' + contract.transactionId + '/v1' ||
        typeof contract.transactionId !== 'string' || contract.commitClass !== DOMAIN_FACT_EFFECT_CLASS ||
        !contract.fenceContract || contract.fenceContract.domainRevisionFenceRequired !== true ||
        contract.fenceContract.commitMarkerRequired !== true || typeof contract.fenceContract.outboxRequired !== 'boolean' ||
        !Array.isArray(contract.writeTables) || contract.fenceContract.outboxRequired !== contract.writeTables.includes('fx_outbox')) {
      fail('P3_DOMAIN_COMMIT_INVALID_TRANSACTION_CONTRACT', 'Exact domain fact transaction contract is invalid.');
    }
    if (entries.has(contract.transactionId)) fail('P3_DOMAIN_COMMIT_DUPLICATE_TRANSACTION', 'Transaction identity must be unique.');
    const exactSelectors = new Set();
    for (const variant of contract.variants || []) {
      if (!variant.selector) continue;
      const selector = variant.selector;
      const selectorKey = [selector.factType, selector.factSchemaRef, selector.resultSchemaRef].join('|');
      if (selector.selectorKind !== 'domain_fact_handle_exact' || !selector.factType || !selector.factSchemaRef ||
          !selector.resultSchemaRef || exactSelectors.has(selectorKey) || !Array.isArray(variant.participants) ||
          !Array.isArray(variant.writeTables) || !Array.isArray(variant.readTables) ||
          !Array.isArray(variant.dynamicTableRequirements) || !variant.fenceContract ||
          variant.fenceContract.outboxRequired !== variant.writeTables.includes('fx_outbox')) {
        fail('P3_DOMAIN_COMMIT_INVALID_TRANSACTION_VARIANT', 'Exact transaction variant contract is invalid.', {
          transactionId: contract.transactionId, variantId: variant.variantId
        });
      }
      exactSelectors.add(selectorKey);
    }
    entries.set(contract.transactionId, Object.freeze(contract));
  }
  return Object.freeze({
    resolveVariant(transactionId, handle) {
      const contract = entries.get(transactionId);
      if (!contract) fail('P3_DOMAIN_COMMIT_UNKNOWN_TRANSACTION', 'Domain commit must name an exact canonical transaction.', { transactionId });
      validateHandle(handle);
      const variants = (contract.variants || []).filter((variant) => variant.selector);
      const matches = variants.filter((variant) => variant.selector.factType === handle.factType &&
        variant.selector.factSchemaRef === handle.factSchemaRef && variant.selector.resultSchemaRef === handle.resultSchemaRef);
      if (matches.length > 1) fail('P3_TRANSACTION_VARIANT_REGISTRY_INTEGRITY', 'More than one exact transaction variant matched the Handle.');
      if (matches.length === 1) return Object.freeze({ ...contract, ...matches[0], variants: contract.variants });
      const namespaces = {
        factType: new Set(variants.map((variant) => variant.selector.factType)),
        factSchemaRef: new Set(variants.map((variant) => variant.selector.factSchemaRef)),
        resultSchemaRef: new Set(variants.map((variant) => variant.selector.resultSchemaRef))
      };
      if (namespaces.factType.has(handle.factType) || namespaces.factSchemaRef.has(handle.factSchemaRef) ||
          namespaces.resultSchemaRef.has(handle.resultSchemaRef)) fail(
        'P3_TRANSACTION_VARIANT_SELECTOR_MISMATCH', 'Product Fact selector namespace requires an exact three-field match.'
      );
      return contract;
    }
  });
}

function markerRepository(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'domain_commit_marker', owner: 'execution-foundation', schemaManifest,
    statements: {
      find: {
        kind: 'select-one', tableId: 'fx_commit_markers',
        columns: ['commit_marker', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'result_id', 'result_schema_ref', 'result_digest', 'committed_at_ms'],
        keyColumns: ['commit_marker']
      },
      insert: {
        kind: 'insert', tableId: 'fx_commit_markers',
        columns: ['commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'result_id', 'result_schema_ref', 'result_digest', 'committed_at_ms']
      }
    }
  });
}

function resultRepository(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'domain_commit_result', owner: 'execution-foundation', schemaManifest,
    statements: {
      find: { kind: 'select-one', tableId: 'fx_event_result_bindings', columns: [
        'result_id', 'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'result_digest',
        'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id', 'committed_at_ms'
      ], keyColumns: ['result_id'] },
      insert: { kind: 'insert', tableId: 'fx_event_result_bindings', columns: [
        'result_id', 'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'result_digest',
        'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id', 'committed_at_ms'
      ] }
    }
  });
}

function parseStoredBinding(row, marker) {
  if (!row || row.result_schema_ref !== marker.result_schema_ref || row.result_digest !== marker.result_digest) {
    fail('P3_DOMAIN_COMMIT_RESULT_BINDING_CORRUPT', 'Commit Marker does not resolve to its exact durable typed Result.');
  }
  let result;
  try { result = JSON.parse(row.result_json); } catch { fail('P3_DOMAIN_COMMIT_RESULT_BINDING_CORRUPT', 'Stored typed Result is not JSON.'); }
  if (canonicalDigest(result) !== row.result_digest || result.schemaRef !== row.result_schema_ref) {
    fail('P3_DOMAIN_COMMIT_RESULT_BINDING_CORRUPT', 'Stored typed Result digest or nominal schema is invalid.');
  }
  let evidence;
  try { evidence = JSON.parse(row.evidence_json); } catch { fail('P3_DOMAIN_COMMIT_RESULT_BINDING_CORRUPT', 'Stored typed Evidence is not JSON.'); }
  if (canonicalDigest(evidence) !== row.evidence_digest || evidence.schemaRef !== row.evidence_schema_ref) {
    fail('P3_DOMAIN_COMMIT_RESULT_BINDING_CORRUPT', 'Stored typed Evidence digest or nominal schema is invalid.');
  }
  return Object.freeze({ typedResult: Object.freeze(result), typedEvidence: Object.freeze(evidence) });
}

function supportingWorkRepository(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'domain_commit_supporting_work', owner:'execution-foundation', schemaManifest,
    statements:{ find:{ kind:'select-one', tableId:'fx_supporting_works', columns:['work_id','owner_domain','process_type','process_id','state'], keyColumns:['work_id'] } }
  });
}

function createDomainCommitCoordinator(options) {
  if (!options || !options.schemaManifest || !options.registry || typeof options.registry.resolve !== 'function' ||
      !options.transactionRegistry || typeof options.transactionRegistry.resolveVariant !== 'function' ||
      !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P3_DOMAIN_COMMIT_INVALID_COORDINATOR', 'Schema manifest, typed registry, and SqliteUnitOfWork are required.');
  }
  const marker = markerRepository(options.schemaManifest);
  const resultBinding = resultRepository(options.schemaManifest);
  const supportingWork = supportingWorkRepository(options.schemaManifest);
  return Object.freeze({
    execute(request) {
      if (!request || !request.handle || !request.commitMarker || !request.resultBinding ||
          !Array.isArray(request.outboxMessages)) {
        fail('P3_DOMAIN_COMMIT_INVALID_REQUEST', 'Transaction, Handle, durable typed Result binding, commit marker, and Outbox declaration are required.');
      }
      const handle = request.handle;
      const transaction = options.transactionRegistry.resolveVariant(text(request.transactionId, 'transactionId'), handle);
      if (transaction.ownerScope !== 'polymorphic-domain-owner' && transaction.ownerScope !== handle.ownerDomain) {
        fail('P3_DOMAIN_COMMIT_TRANSACTION_OWNER_MISMATCH', 'Canonical transaction does not authorize this Domain Owner.');
      }
      const outboxRequired = transaction.fenceContract.outboxRequired;
      if (outboxRequired && request.outboxMessages.length === 0) {
        fail('P3_DOMAIN_COMMIT_OUTBOX_REQUIRED', 'Canonical transaction requires a non-empty Outbox fact set.');
      }
      if (!outboxRequired && request.outboxMessages.length !== 0) {
        fail('P3_DOMAIN_COMMIT_OUTBOX_FORBIDDEN', 'Canonical transaction forbids Outbox publication.');
      }
      const commitMarkerId = text(request.commitMarker.commitMarker, 'commitMarker');
      const supportingWorkRequired = transaction.readTables.includes('fx_supporting_works');
      if (supportingWorkRequired) text(request.supportingWorkId, 'supportingWorkId');
      const resolvedParticipant = options.registry.resolve(handle, request.payload, { commitMarker:commitMarkerId });
      let typedResult;
      const domainParticipant = {
        ...resolvedParticipant,
        execute(context) {
          typedResult = resolvedParticipant.execute(context);
          if (!typedResult || typeof typedResult !== 'object' || Array.isArray(typedResult) || typedResult.schemaRef !== handle.resultSchemaRef) {
            fail('P3_DOMAIN_COMMIT_RESULT_SCHEMA_MISMATCH', 'Domain participant must return the exact typed Result declared by its Handle.');
          }
          return typedResult;
        }
      };
      const binding = request.resultBinding;
      for (const field of ['resultId', 'eventId', 'evidenceSchemaRef']) text(binding[field], field);
      if (!binding.evidence || typeof binding.evidence !== 'object' || Array.isArray(binding.evidence)) {
        fail('P3_DOMAIN_COMMIT_EVIDENCE_REQUIRED', 'A typed Evidence value is required for the durable Result binding.');
      }
      const commitDigest = SHA256.test(request.commitMarker.commitDigest || '')
        ? request.commitMarker.commitDigest
        : fail('P3_DOMAIN_COMMIT_INVALID_DIGEST', 'Commit Marker digest must be lowercase SHA-256.');
      const participants = [{
        participantId: 'domain_commit_preflight',
        owner: 'execution-foundation',
        boundBusinessOwner: handle.ownerDomain,
        repositories: supportingWorkRequired ? [marker, resultBinding, supportingWork] : [marker, resultBinding],
        execute(context) {
          if (supportingWorkRequired) {
            const work = context.repository('domain_commit_supporting_work').invoke('find', { work_id:request.supportingWorkId });
            if (!work || work.owner_domain !== handle.ownerDomain || work.state !== 'running') {
              fail('P3_DOMAIN_COMMIT_SUPPORTING_WORK_INVALID', 'Canonical transaction Supporting Work is absent or not running for its Owner.');
            }
          }
          const existing = context.repository('domain_commit_marker').invoke('find', { commit_marker: commitMarkerId });
          if (!existing) return;
          if (existing.owner_domain !== handle.ownerDomain || existing.scope_type !== handle.aggregateType ||
              existing.scope_id !== handle.aggregateId || existing.commit_digest !== commitDigest) {
            fail('P3_DOMAIN_COMMIT_MARKER_CONFLICT', 'Commit Marker already exists with a different signed commit.');
          }
          const stored = parseStoredBinding(context.repository('domain_commit_result').invoke('find', { result_id: existing.result_id }), existing);
          throw new DomainCommitReplay(Object.freeze({ ...existing, ...stored }));
        }
      }, domainParticipant, {
        participantId: 'domain_commit_result', owner: 'execution-foundation', boundBusinessOwner: handle.ownerDomain,
        repositories: [resultBinding],
        execute(context) {
          const resultJson = canonicalJson(typedResult);
          const evidenceJson = canonicalJson(binding.evidence);
          if (Buffer.byteLength(resultJson, 'utf8') > 65536 || Buffer.byteLength(evidenceJson, 'utf8') > 65536) {
            fail('P3_DOMAIN_COMMIT_RESULT_TOO_LARGE', 'Typed Result and Evidence must each fit the 64 KiB storage contract.');
          }
          const resultDigest = canonicalDigest(typedResult);
          context.repository('domain_commit_result').invoke('insert', {
            result_id: binding.resultId, event_id: binding.eventId, outcome_kind: 'succeeded', result_schema_ref: handle.resultSchemaRef,
            result_json: resultJson, result_digest: resultDigest, evidence_schema_ref: binding.evidenceSchemaRef,
            evidence_json: evidenceJson, evidence_digest: canonicalDigest(binding.evidence),
            effect_receipt_id: binding.effectReceiptId || null, committed_at_ms: context.commitTimeMs
          });
          return Object.freeze({ resultId: binding.resultId, resultSchemaRef: handle.resultSchemaRef, resultDigest });
        }
      }];
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
            result_id: binding.resultId,
            result_schema_ref: handle.resultSchemaRef,
            result_digest: canonicalDigest(typedResult),
            committed_at_ms: context.commitTimeMs
          });
        }
      });
      if (outboxRequired) participants.push(createOutboxParticipant({
        schemaManifest: options.schemaManifest, participantId: 'domain_commit_outbox',
        producerDomain: handle.ownerDomain, messages: request.outboxMessages
      }));
      try {
        const results = options.unitOfWork.execute(participants);
        return Object.freeze({
          replayed: false,
          domainResult: results[domainParticipant.participantId],
          controlResult: results.material_control,
          outboxResult: results.domain_commit_outbox,
          commitMarker: commitMarkerId, typedResult: results[domainParticipant.participantId], typedEvidence: binding.evidence,
          resultBinding: results.domain_commit_result
        });
      } catch (error) {
        if (error instanceof DomainCommitReplay) return Object.freeze({
          replayed: true, domainResult: error.marker.typedResult, controlResult: undefined, outboxResult: undefined,
          commitMarker: error.marker.commit_marker, typedResult: error.marker.typedResult, typedEvidence: error.marker.typedEvidence,
          resultBinding: Object.freeze({ resultId: error.marker.result_id, resultSchemaRef: error.marker.result_schema_ref, resultDigest: error.marker.result_digest })
        });
        throw error;
      }
    }
  });
}

module.exports = Object.freeze({
  DomainCommitRegistryError, createCanonicalTransactionRegistry, createDomainCommitCoordinator, createDomainCommitRegistry
});
