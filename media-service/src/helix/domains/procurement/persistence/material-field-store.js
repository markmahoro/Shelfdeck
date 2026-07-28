'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createExtractionPolicy, createFieldAccess, createMaterialField, validateExtractionPolicyValue } = require('../model/material-field-contracts');
const {
  PROFILE_HINT_SCHEMA,
  assertProfileHint,
  createProfileHintSnapshot,
  hintDigest,
} = require('../model/field-profile-hint-contracts');

class MaterialFieldStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'MaterialFieldStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new MaterialFieldStoreError(code, message, details); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Material Field input does not match its closed contract.');
}

function definition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId: 'material_field_repository', owner: 'procurement', schemaManifest, statements: {
    insert_policy: { kind: 'insert', tableId: 'proc_extraction_policy_revisions', columns: [
      'extraction_policy_id','revision','policy_schema_ref','policy_json','policy_digest','effective_at_ms'
    ] },
    find_policy: { kind: 'select-one', tableId: 'proc_extraction_policy_revisions', columns: [
      'extraction_policy_id','revision','policy_schema_ref','policy_json','policy_digest','effective_at_ms'
    ], keyColumns: ['extraction_policy_id','revision'] },
    insert_field: { kind: 'insert', tableId: 'proc_material_fields', columns: [
      'field_id','name','status','extraction_policy_id','extraction_policy_revision','current_access_revision','current_profile_hint_revision','current_observation_revision','created_at_ms','updated_at_ms'
    ] },
    find_field: { kind: 'select-one', tableId: 'proc_material_fields', columns: [
      'field_id','name','status','extraction_policy_id','extraction_policy_revision','current_access_revision','current_profile_hint_revision','current_observation_revision','created_at_ms','updated_at_ms'
    ], keyColumns: ['field_id'] },
    list_fields: { kind: 'select-all', tableId: 'proc_material_fields', columns: [
      'field_id','name','status','extraction_policy_id','extraction_policy_revision','current_access_revision','current_profile_hint_revision','current_observation_revision','created_at_ms','updated_at_ms'
    ], keyColumns: [] },
    initialize_access_head: { kind: 'update', tableId: 'proc_material_fields', setColumns: ['current_access_revision','updated_at_ms'], keyColumns: ['field_id'] },
    advance_access_head: { kind: 'update', tableId: 'proc_material_fields', setColumns: ['current_access_revision','updated_at_ms'], keyColumns: ['field_id'],
      compareColumns: [{ column: 'current_access_revision', parameter: 'expected_access_revision' }, { column: 'status', parameter: 'expected_status' }] },
    advance_policy_head: { kind: 'update', tableId: 'proc_material_fields', setColumns: ['extraction_policy_id','extraction_policy_revision','updated_at_ms'], keyColumns: ['field_id'],
      compareColumns: [{ column: 'extraction_policy_id', parameter: 'expected_policy_id' }, { column: 'extraction_policy_revision', parameter: 'expected_policy_revision' },
        { column: 'status', parameter: 'expected_status' }] },
    advance_profile_hint_head: { kind: 'update', tableId: 'proc_material_fields', setColumns: ['current_profile_hint_revision','updated_at_ms'], keyColumns: ['field_id'],
      compareColumns: [{ column: 'current_profile_hint_revision', parameter: 'expected_profile_hint_revision' },
        { column: 'status', parameter: 'expected_status' }] },
    revise_field: { kind: 'update', tableId: 'proc_material_fields', setColumns: ['name','status','updated_at_ms'], keyColumns: ['field_id'],
      compareColumns: [{ column: 'current_access_revision', parameter: 'expected_access_revision' },
        { column: 'extraction_policy_revision', parameter: 'expected_policy_revision' }, { column: 'status', parameter: 'expected_status' }] },
    insert_access: { kind: 'insert', tableId: 'proc_field_access_revisions', columns: [
      'field_id','revision','endpoint_id','root_location','mount_scope_id','mount_scope_revision','access_schema_ref','access_digest','effective_at_ms'
    ] },
    find_access: { kind: 'select-one', tableId: 'proc_field_access_revisions', columns: [
      'field_id','revision','endpoint_id','root_location','mount_scope_id','mount_scope_revision','access_schema_ref','access_digest','effective_at_ms'
    ], keyColumns: ['field_id','revision'] },
    insert_profile_hint: { kind: 'insert', tableId: 'proc_field_profile_hint_revisions', columns: [
      'field_id','revision','content_profile_hint','hint_schema_ref','hint_digest','effective_at_ms','actor_id'
    ] },
    find_profile_hint: { kind: 'select-one', tableId: 'proc_field_profile_hint_revisions', columns: [
      'field_id','revision','content_profile_hint','hint_schema_ref','hint_digest','effective_at_ms','actor_id'
    ], keyColumns: ['field_id','revision'] }
  }});
}

function accessBasis(input) {
  return { fieldId: input.fieldId, revision: input.revision, endpointId: input.endpointId, rootLocation: input.rootLocation,
    mountScopeId: input.mountScopeId, mountScopeRevision: input.mountScopeRevision, accessSchemaRef: input.accessSchemaRef };
}
function validateAccess(input) {
  exact(input, ['fieldId','revision','endpointId','rootLocation','mountScopeId','mountScopeRevision','accessSchemaRef','accessDigest'], 'P7_FIELD_ACCESS_INPUT');
  if (canonicalDigest(accessBasis(input)) !== input.accessDigest) fail('P7_FIELD_ACCESS_DIGEST_MISMATCH', 'Field Access digest does not match its exact basis.');
}
function validatePolicy(input) {
  exact(input, ['extractionPolicyId','revision','policySchemaRef','policy','policyDigest'], 'P7_EXTRACTION_POLICY_INPUT');
  validateExtractionPolicyValue(input.policy);
  const json = canonicalJson(input.policy);
  if (Buffer.byteLength(json, 'utf8') > 16384) fail('P7_EXTRACTION_POLICY_TOO_LARGE', 'Extraction Policy exceeds 16 KiB.');
  if (canonicalDigest({ extractionPolicyId:input.extractionPolicyId, revision:input.revision, ...input.policy }) !== input.policyDigest) fail('P7_EXTRACTION_POLICY_DIGEST_MISMATCH', 'Extraction Policy digest does not match its complete typed value.');
  return json;
}

function createMaterialFieldStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P7_FIELD_STORE_DEPENDENCIES', 'Schema manifest and Unit of Work are required.');
  }
  const fields = definition(options.schemaManifest);
  const execute = (body) => options.unitOfWork.execute([{ participantId: 'material_field_store', owner: 'procurement', repositories: [fields], execute: body }]).material_field_store;
  const commandCommit = createCommandCommitCoordinator({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork });
  const repositoryManifest = Object.freeze({ component: 'MaterialFieldRepository', repositoryId: fields.repositoryId, tableIds: fields.tableIds });
  const write = Object.freeze({
    register(input, context, actorId) {
      exact(input, ['fieldId','name','policy','access','contentProfileHint'], 'P7_MATERIAL_FIELD_REGISTRATION_INPUT'); validatePolicy(input.policy); validateAccess(input.access);
      assertProfileHint(input.contentProfileHint);
      if (input.access.fieldId !== input.fieldId || input.policy.revision !== 1 || input.access.revision !== 1) fail('P7_MATERIAL_FIELD_INITIAL_BASIS', 'Material Field registration requires matching Field ID and revision 1 Policy/Access.');
      const repo = context.repository(fields.repositoryId); if (repo.invoke('find_field', { field_id: input.fieldId })) fail('P7_MATERIAL_FIELD_EXISTS', 'Material Field already exists.');
      repo.invoke('insert_policy', policyRow(input.policy, canonicalJson(input.policy.policy), context.commitTimeMs));
      repo.invoke('insert_field', { field_id: input.fieldId, name: input.name, status: 'active', extraction_policy_id: input.policy.extractionPolicyId, extraction_policy_revision: 1, current_access_revision: null, current_profile_hint_revision: 1, current_observation_revision: null, created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs });
      repo.invoke('insert_access', accessRow(input.access, context.commitTimeMs));
      repo.invoke('insert_profile_hint', profileHintRow({
        fieldId: input.fieldId,
        revision: 1,
        contentProfileHint: input.contentProfileHint,
      }, context.commitTimeMs, actorId));
      if (repo.invoke('initialize_access_head', { current_access_revision: 1, updated_at_ms: context.commitTimeMs, field_id: input.fieldId }).changes !== 1) fail('P7_MATERIAL_FIELD_INITIALIZATION_FAILED', 'Material Field Access head initialization failed.');
      return readField(repo, input.fieldId);
    },
    revise_access(input, context) {
      validateAccess(input.access); exact(input, ['fieldId','expectedAccessRevision','access'], 'P7_FIELD_ACCESS_REVISION_INPUT');
      if (input.fieldId !== input.access.fieldId || input.access.revision !== input.expectedAccessRevision + 1) fail('P7_FIELD_ACCESS_REVISION_CONFLICT', 'Access revision is stale or skipped.');
      const repo = context.repository(fields.repositoryId); const current = repo.invoke('find_field', { field_id: input.fieldId }); requireActive(current);
      if (current.current_access_revision !== input.expectedAccessRevision) fail('P7_FIELD_ACCESS_REVISION_CONFLICT', 'Access head is stale.');
      repo.invoke('insert_access', accessRow(input.access, context.commitTimeMs));
      if (repo.invoke('advance_access_head', { current_access_revision: input.access.revision, updated_at_ms: context.commitTimeMs, field_id: input.fieldId, expected_access_revision: input.expectedAccessRevision, expected_status: 'active' }).changes !== 1) fail('P7_FIELD_ACCESS_REVISION_CONFLICT', 'Access head CAS failed.');
      return readField(repo, input.fieldId);
    },
    publish_policy(input, context) {
      exact(input, ['fieldId','expectedPolicyId','expectedPolicyRevision','policy'], 'P7_EXTRACTION_POLICY_REVISION_INPUT'); validatePolicy(input.policy);
      if (input.policy.extractionPolicyId !== input.expectedPolicyId || input.policy.revision !== input.expectedPolicyRevision + 1) fail('P7_EXTRACTION_POLICY_REVISION_CONFLICT', 'Policy revision is stale or skipped.');
      const repo = context.repository(fields.repositoryId); const current = repo.invoke('find_field', { field_id: input.fieldId }); requireActive(current);
      if (current.extraction_policy_id !== input.expectedPolicyId || current.extraction_policy_revision !== input.expectedPolicyRevision) fail('P7_EXTRACTION_POLICY_REVISION_CONFLICT', 'Policy head is stale.');
      repo.invoke('insert_policy', policyRow(input.policy, canonicalJson(input.policy.policy), context.commitTimeMs));
      if (repo.invoke('advance_policy_head', { extraction_policy_id: input.policy.extractionPolicyId, extraction_policy_revision: input.policy.revision, updated_at_ms: context.commitTimeMs, field_id: input.fieldId, expected_policy_id: input.expectedPolicyId, expected_policy_revision: input.expectedPolicyRevision, expected_status: 'active' }).changes !== 1) fail('P7_EXTRACTION_POLICY_REVISION_CONFLICT', 'Policy head CAS failed.');
      return readField(repo, input.fieldId);
    },
    revise_profile_hint(input, context, actorId) {
      exact(input, ['fieldId','expectedProfileHintRevision','newContentProfileHint','requestDigest'], 'PBF22_FIELD_PROFILE_HINT_REVISION_INPUT');
      assertProfileHint(input.newContentProfileHint, 'newContentProfileHint');
      const expectedDigest = canonicalDigest({
        schema: 'procurement.material-field-profile-hint-revision-command@1',
        operation: 'revise_profile_hint',
        fieldId: input.fieldId,
        expectedProfileHintRevision: input.expectedProfileHintRevision,
        newContentProfileHint: input.newContentProfileHint,
      });
      if (input.requestDigest !== expectedDigest) fail('PBF22_FIELD_PROFILE_HINT_COMMAND_DIGEST_MISMATCH', 'Profile Hint command digest is invalid.');
      const repo = context.repository(fields.repositoryId);
      const current = repo.invoke('find_field', { field_id: input.fieldId });
      requireActive(current);
      if (current.current_profile_hint_revision !== input.expectedProfileHintRevision) {
        fail('PBF22_FIELD_PROFILE_HINT_REVISION_CONFLICT', 'Profile Hint head is stale.');
      }
      const currentHint = mapProfileHint(repo.invoke('find_profile_hint', {
        field_id: input.fieldId,
        revision: input.expectedProfileHintRevision,
      }));
      if (!currentHint) fail('P7_MATERIAL_FIELD_POINTER_BROKEN', 'Profile Hint current pointer does not resolve.');
      if (currentHint.contentProfileHint === input.newContentProfileHint) {
        return readField(repo, input.fieldId);
      }
      const next = {
        fieldId: input.fieldId,
        revision: input.expectedProfileHintRevision + 1,
        contentProfileHint: input.newContentProfileHint,
      };
      repo.invoke('insert_profile_hint', profileHintRow(next, context.commitTimeMs, actorId));
      const changed = repo.invoke('advance_profile_hint_head', {
        current_profile_hint_revision: next.revision,
        updated_at_ms: context.commitTimeMs,
        field_id: input.fieldId,
        expected_profile_hint_revision: input.expectedProfileHintRevision,
        expected_status: 'active',
      });
      if (changed.changes !== 1) fail('PBF22_FIELD_PROFILE_HINT_REVISION_CONFLICT', 'Profile Hint head CAS failed.');
      return readField(repo, input.fieldId);
    },
    deregister(input, context) {
      exact(input, ['fieldId','expectedAccessRevision','expectedPolicyRevision'], 'P7_MATERIAL_FIELD_DISABLE_INPUT'); const repo = context.repository(fields.repositoryId); const current = repo.invoke('find_field', { field_id: input.fieldId }); requireActive(current);
      if (repo.invoke('revise_field', { name: current.name, status: 'deregistered', updated_at_ms: context.commitTimeMs, field_id: input.fieldId, expected_access_revision: input.expectedAccessRevision, expected_policy_revision: input.expectedPolicyRevision, expected_status: 'active' }).changes !== 1) fail('P7_MATERIAL_FIELD_DISABLE_CONFLICT', 'Material Field disable CAS failed.');
      return readField(repo, input.fieldId);
    },
  });

  function commitAdminCommand(request) {
    if (!request || !write[request.operation] || typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0 || !request.input || typeof request.input.fieldId !== 'string' || request.input.fieldId.length === 0) fail('P14_FIELD_COMMAND_ENVELOPE_INVALID', 'Material Field administrative command envelope is invalid.');
    const commandContract = 'procurement.admin.material-field.' + request.operation + '@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, targetId: request.input.fieldId });
    const actorId = typeof request.actorId === 'string' && request.actorId.length > 0
      ? request.actorId
      : 'system:material-field';
    const commandReceiptId = 'proc-field-receipt-' + keyDigest.slice(0, 32);
    const committed = commandCommit.execute({
      command: { commandReceiptId, ownerDomain: 'procurement', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'material_field', targetId: request.input.fieldId },
      domainParticipant: { participantId: 'procurement_material_field_command', owner: 'procurement', repositories: [fields], execute: (context) => write[request.operation](request.input, context, actorId) },
      commitMarker: { commitMarker: 'proc-field-command-' + keyDigest, effectId: null, scopeType: 'material_field', scopeId: request.input.fieldId, commitDigest: canonicalDigest({ commandContract, requestDigest, targetId: request.input.fieldId }) },
      auditRecords: [{ auditId: 'proc-field-audit-' + keyDigest.slice(0, 32), actorType: 'admin', actorId, action: request.operation, scopeType: 'material_field', scopeId: request.input.fieldId, evidenceDigest: requestDigest }],
      resultEnvelope: (materialField) => {
        const basis = { materialField, commandReceiptId };
        return {
          resultSchemaRef: 'helix://contracts/application-types/ProcurementMaterialFieldAdminResult/v1',
          resultRef: { ...basis, resultDigest: canonicalDigest(basis) },
        };
      },
    });
    return Object.freeze({ ...committed.receipt.resultRef, replayed: committed.replayed });
  }

  return Object.freeze({ repositoryManifest,
    registerMaterialField(input) { return execute((context) => write.register(input, context, 'system:material-field-store')); },
    reviseFieldAccess(input) { return execute((context) => write.revise_access(input, context)); },
    reviseFieldProfileHint(input) { return execute((context) => write.revise_profile_hint(input, context, 'system:material-field-store')); },
    publishExtractionPolicy(input) { return execute((context) => write.publish_policy(input, context)); },
    deregisterMaterialField(input) { return execute((context) => write.deregister(input, context)); },
    commitAdminCommand,
    getMaterialField(fieldId) { return execute((context) => readField(context.repository(fields.repositoryId), fieldId)); },
    listMaterialFields() { return execute((context) => context.repository(fields.repositoryId).invoke('list_fields').map((row) => readField(context.repository(fields.repositoryId), row.field_id))); },
    getExtractionPolicy(extractionPolicyId, revision) { return execute((context) => mapPolicy(context.repository(fields.repositoryId).invoke('find_policy', { extraction_policy_id: extractionPolicyId, revision }))); }
  });
}

function requireActive(row) { if (!row) fail('P7_MATERIAL_FIELD_NOT_FOUND', 'Material Field does not exist.'); if (row.status !== 'active') fail('P7_MATERIAL_FIELD_DEREGISTERED', 'Deregistered Material Field cannot be revised.'); }
function policyRow(input, json, now) { return { extraction_policy_id: input.extractionPolicyId, revision: input.revision, policy_schema_ref: input.policySchemaRef,
  policy_json: json, policy_digest: input.policyDigest, effective_at_ms: now }; }
function accessRow(input, now) { return { field_id: input.fieldId, revision: input.revision, endpoint_id: input.endpointId, root_location: input.rootLocation,
  mount_scope_id: input.mountScopeId, mount_scope_revision: input.mountScopeRevision, access_schema_ref: input.accessSchemaRef,
  access_digest: input.accessDigest, effective_at_ms: now }; }
function mapPolicy(row) { if (!row) return null; return createExtractionPolicy({ extractionPolicyId: row.extraction_policy_id, revision: row.revision,
  policySchemaRef: row.policy_schema_ref, policy: JSON.parse(row.policy_json), policyDigest: row.policy_digest, effectiveAtMs: row.effective_at_ms }); }
function mapAccess(row) { if (!row) return null; return createFieldAccess({ fieldId: row.field_id, revision: row.revision, endpointId: row.endpoint_id,
  rootLocation: row.root_location, mountScopeId: row.mount_scope_id, mountScopeRevision: row.mount_scope_revision,
  accessSchemaRef: row.access_schema_ref, accessDigest: row.access_digest, effectiveAtMs: row.effective_at_ms }); }
function profileHintRow(input, now, actorId) {
  return {
    field_id: input.fieldId,
    revision: input.revision,
    content_profile_hint: input.contentProfileHint,
    hint_schema_ref: PROFILE_HINT_SCHEMA,
    hint_digest: hintDigest(input.fieldId, input.revision, input.contentProfileHint),
    effective_at_ms: now,
    actor_id: actorId,
  };
}
function mapProfileHint(row) {
  if (!row) return null;
  if (row.hint_schema_ref !== PROFILE_HINT_SCHEMA) fail('PBF22_FIELD_PROFILE_HINT_SCHEMA_MISMATCH', 'Profile Hint row schema is invalid.');
  return createProfileHintSnapshot({
    fieldId: row.field_id,
    revision: row.revision,
    contentProfileHint: row.content_profile_hint,
    hintDigest: row.hint_digest,
  });
}
function mapField(row) { if (!row) return null; return createMaterialField({ fieldId: row.field_id, name: row.name, status: row.status,
  extractionPolicyId: row.extraction_policy_id, extractionPolicyRevision: row.extraction_policy_revision,
  currentAccessRevision: row.current_access_revision, currentProfileHintRevision: row.current_profile_hint_revision,
  currentObservationRevision: row.current_observation_revision,
  createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms }); }
function readField(repo, fieldId) { const field = mapField(repo.invoke('find_field', { field_id: fieldId })); if (!field) return null;
  const policy = mapPolicy(repo.invoke('find_policy', { extraction_policy_id: field.extractionPolicyId, revision: field.extractionPolicyRevision }));
  const access = mapAccess(repo.invoke('find_access', { field_id: field.fieldId, revision: field.currentAccessRevision }));
  const currentProfileHintSnapshot = mapProfileHint(repo.invoke('find_profile_hint', {
    field_id: field.fieldId,
    revision: field.currentProfileHintRevision,
  }));
  if (!policy || !access || !currentProfileHintSnapshot) fail('P7_MATERIAL_FIELD_POINTER_BROKEN', 'Material Field current pointers do not resolve.');
  const basis = {
    fieldId: field.fieldId,
    name: field.name,
    status: field.status,
    extractionPolicyId: field.extractionPolicyId,
    extractionPolicyRevision: field.extractionPolicyRevision,
    currentAccessRevision: field.currentAccessRevision,
    currentProfileHintSnapshot,
    ...(field.currentObservationRevision === null
      ? {}
      : { currentObservationRevision: field.currentObservationRevision }),
    createdAtMs: field.createdAtMs,
    updatedAtMs: field.updatedAtMs,
    policy,
    access,
  };
  return Object.freeze({ ...basis, projectionDigest: canonicalDigest(basis) }); }

module.exports = Object.freeze({ MaterialFieldStoreError, createMaterialFieldStore });
