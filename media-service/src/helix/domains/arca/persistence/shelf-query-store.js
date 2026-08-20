'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  EVIDENCE_SCHEMA_REF,
  targetDigest,
} = require('../model/shelf-target-folder-contracts');
const {
  buildShelfStandard,
  validateRuleTemplateRules,
} = require('../model/rule-template-contracts');

const STANDARD_SCHEMA_REF = 'helix://contracts/types/ShelfStandard/v1';

class ArcaShelfStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ArcaShelfStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new ArcaShelfStoreError(code, message, details); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, 'Shelf input does not match its closed contract.');
  }
}
function text(value, field) { if (typeof value !== 'string' || value.length === 0) fail('P14_SHELF_FIELD_REQUIRED', 'Shelf field is required.', { field }); return value; }

function createShelfQueryStore(options) {
  if (!options?.schemaManifest || !options?.unitOfWork) throw new TypeError('Arca Shelf store requires clean persistence dependencies.');
  const repository = createRepositoryDefinition({ repositoryId: 'arca_shelf_repository', owner: 'arca', schemaManifest: options.schemaManifest, statements: {
    list_shelves: { kind: 'select-all', tableId: 'arca_shelves', columns: ['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','routing_projection_revision','routing_projection_digest','created_at_ms','updated_at_ms'], keyColumns: [] },
    find_shelf: { kind: 'select-one', tableId: 'arca_shelves', columns: ['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','routing_projection_revision','routing_projection_digest','created_at_ms','updated_at_ms'], keyColumns: ['shelf_id'] },
    insert_shelf: { kind: 'insert', tableId: 'arca_shelves', columns: ['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','routing_projection_revision','routing_projection_digest','created_at_ms','updated_at_ms'] },
    rename_shelf: { kind: 'update', tableId: 'arca_shelves', setColumns: ['name','updated_at_ms'], keyColumns: ['shelf_id'], compareColumns: [{ column: 'updated_at_ms', parameter: 'expected_updated_at_ms' }, { column: 'status', parameter: 'expected_status' }] },
    advance_standard_head: { kind: 'update', tableId: 'arca_shelves', setColumns: ['current_standard_revision','routing_projection_revision','routing_projection_digest','updated_at_ms'], keyColumns: ['shelf_id'], compareColumns: [{ column: 'current_standard_revision', parameter: 'expected_standard_revision' }, { column: 'routing_projection_revision', parameter: 'expected_projection_revision' }, { column: 'status', parameter: 'expected_status' }] },
    advance_placement_head: { kind: 'update', tableId: 'arca_shelves', setColumns: ['target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','current_placement_revision','updated_at_ms'], keyColumns: ['shelf_id'], compareColumns: [{ column: 'target_endpoint_id', parameter: 'expected_target_endpoint_id' }, { column: 'target_root_location', parameter: 'expected_target_root_location' }, { column: 'target_mount_scope_id', parameter: 'expected_target_mount_scope_id' }, { column: 'target_mount_scope_revision', parameter: 'expected_target_mount_scope_revision' }, { column: 'current_placement_revision', parameter: 'expected_placement_revision' }, { column: 'status', parameter: 'expected_status' }] },
    insert_standard: { kind: 'insert', tableId: 'arca_shelf_standard_revisions', columns: ['shelf_id','revision','rule_template_id','rule_template_revision','standard_schema_ref','standard_json','standard_digest','effective_at_ms'] },
    find_standard: { kind: 'select-one', tableId: 'arca_shelf_standard_revisions', columns: ['shelf_id','revision','rule_template_id','rule_template_revision','standard_schema_ref','standard_json','standard_digest','effective_at_ms'], keyColumns: ['shelf_id','revision'] },
    insert_placement: { kind: 'insert', tableId: 'arca_placement_policy_revisions', columns: ['shelf_id','revision','policy_schema_ref','policy_json','policy_digest','effective_at_ms'] },
    find_placement: { kind: 'select-one', tableId: 'arca_placement_policy_revisions', columns: ['shelf_id','revision','policy_schema_ref','policy_json','policy_digest','effective_at_ms'], keyColumns: ['shelf_id','revision'] },
    find_rule_template: { kind: 'select-one', tableId: 'arca_rule_templates', columns: ['rule_template_id','status','current_revision'], keyColumns: ['rule_template_id'] },
    find_rule_template_revision: { kind: 'select-one', tableId: 'arca_rule_template_revisions', columns: ['rule_template_id','revision','rules_schema_ref','rules_json','rules_digest','published_at_ms'], keyColumns: ['rule_template_id','revision'] },
    list_shelf_entries: { kind: 'select-all', tableId: 'arca_shelf_entries', columns: ['shelf_entry_id','shelf_id','status','current_inventory_revision'], keyColumns: ['shelf_id'], safeIntegers: true },
  } });
  const commandEvidence = createRepositoryDefinition({ repositoryId: 'arca_shelf_command_evidence', owner: 'execution-foundation', schemaManifest: options.schemaManifest, statements: {
    find_receipt_by_id: { kind: 'select-one', tableId: 'fx_command_receipts', columns: ['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_id','result_ref_json','result_digest'], keyColumns: ['command_receipt_id'] },
    find_receipt_by_key: { kind: 'select-one', tableId: 'fx_command_receipts', columns: ['command_receipt_id','request_digest','target_id','result_ref_json','result_digest'], keyColumns: ['owner_domain','command_contract','caller_scope','idempotency_key'] },
  } });
  const commandCommit = createCommandCommitCoordinator({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork });
  const execute = (body) => options.unitOfWork.execute([{ participantId: 'arca_shelf_query', owner: 'arca', repositories: [repository], execute: body }]).arca_shelf_query;
  const readCommandEvidence = (body) => options.unitOfWork.execute([{ participantId: 'arca_shelf_command_evidence_read', owner: 'execution-foundation', repositories: [commandEvidence], execute: body }]).arca_shelf_command_evidence_read;

  function mapShelf(row) {
    return row && Object.freeze({ shelfId: row.shelf_id, name: row.name, target: Object.freeze({ endpointId: row.target_endpoint_id, rootLocation: row.target_root_location, mountScopeId: row.target_mount_scope_id, mountScopeRevision: row.target_mount_scope_revision }), status: row.status, currentStandardRevision: row.current_standard_revision, currentPlacementRevision: row.current_placement_revision, routingProjection: Object.freeze({ revision: row.routing_projection_revision, digest: row.routing_projection_digest }), createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms });
  }
  function readShelf(repo, shelfId) {
    const shelf = mapShelf(repo.invoke('find_shelf', { shelf_id: shelfId })); if (!shelf) return null;
    const standard = repo.invoke('find_standard', { shelf_id: shelfId, revision: shelf.currentStandardRevision });
    const placement = repo.invoke('find_placement', { shelf_id: shelfId, revision: shelf.currentPlacementRevision });
    if (!standard || !placement) fail('P14_SHELF_POINTER_BROKEN', 'Shelf current pointers do not resolve.');
    return Object.freeze({ ...shelf,
      standard: Object.freeze({ shelfId, revision: standard.revision, ruleTemplateId: standard.rule_template_id, ruleTemplateRevision: standard.rule_template_revision, schemaRef: standard.standard_schema_ref, value: JSON.parse(standard.standard_json), digest: standard.standard_digest, effectiveAtMs: standard.effective_at_ms }),
      placement: Object.freeze({ shelfId, revision: placement.revision, schemaRef: placement.policy_schema_ref, value: JSON.parse(placement.policy_json), digest: placement.policy_digest, effectiveAtMs: placement.effective_at_ms }),
    });
  }
  function create(input, context) {
    exact(input, ['shelfId','name','target','targetReadiness','ruleTemplateId','expectedTemplateRevision','placement'], 'P14_SHELF_CREATE_INPUT');
    text(input.shelfId, 'shelfId'); text(input.name, 'name'); text(input.target.endpointId, 'target.endpointId'); text(input.target.rootLocation, 'target.rootLocation'); text(input.target.mountScopeId, 'target.mountScopeId');
    text(input.ruleTemplateId, 'ruleTemplateId');
    if (!Number.isSafeInteger(input.expectedTemplateRevision) || input.expectedTemplateRevision < 1) fail('P14_SHELF_INITIAL_REVISION', 'Shelf initial revisions must be positive integers.');
    validateTargetBundle(input);
    validatePlacement(input);
    const repo = context.repository(repository.repositoryId);
    if (repo.invoke('find_shelf', { shelf_id: input.shelfId })) fail('P14_SHELF_EXISTS', 'Shelf already exists.');
    const template = repo.invoke('find_rule_template', { rule_template_id: input.ruleTemplateId });
    if (!template) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
    if (template.status !== 'active' || template.current_revision !== input.expectedTemplateRevision) {
      fail('P14_RULE_TEMPLATE_BIND_TEMPLATE_CAS', 'Rule Template binding head is stale.');
    }
    const templateRevision = repo.invoke('find_rule_template_revision', {
      rule_template_id: input.ruleTemplateId,
      revision: input.expectedTemplateRevision,
    });
    if (!templateRevision) fail('P14_RULE_TEMPLATE_REVISION_NOT_FOUND', 'Rule Template revision does not exist.');
    let rules;
    try { rules = JSON.parse(templateRevision.rules_json); } catch (_error) {
      fail('P14_RULE_TEMPLATE_REVISION_CORRUPT', 'Rule Template revision is not valid JSON.');
    }
    validateRuleTemplateRules(templateRevision.rules_schema_ref, rules, templateRevision.rules_digest);
    const standard = buildShelfStandard({
      shelfId: input.shelfId,
      standardRevision: 1,
      ruleTemplateId: input.ruleTemplateId,
      ruleTemplateRevision: input.expectedTemplateRevision,
      rules,
    });
    const projectionDigest = canonicalDigest({ schema: 'arca.shelf-routing-target-projection@1', shelfId: input.shelfId, status: 'active', currentStandardRevision: 1, currentStandardDigest: standard.standardDigest, routingProjectionRevision: 1 });
    repo.invoke('insert_shelf', { shelf_id: input.shelfId, name: input.name, target_endpoint_id: input.target.endpointId, target_root_location: input.target.rootLocation, target_mount_scope_id: input.target.mountScopeId, target_mount_scope_revision: input.target.mountScopeRevision, status: 'active', current_standard_revision: 1, current_placement_revision: 1, routing_projection_revision: 1, routing_projection_digest: projectionDigest, created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs });
    repo.invoke('insert_standard', { shelf_id: input.shelfId, revision: 1, rule_template_id: input.ruleTemplateId, rule_template_revision: input.expectedTemplateRevision, standard_schema_ref: STANDARD_SCHEMA_REF, standard_json: canonicalJson(standard), standard_digest: standard.standardDigest, effective_at_ms: context.commitTimeMs });
    repo.invoke('insert_placement', { shelf_id: input.shelfId, revision: 1, policy_schema_ref: text(input.placement.schemaRef, 'placement.schemaRef'), policy_json: canonicalJson(input.placement.value), policy_digest: input.placement.digest, effective_at_ms: context.commitTimeMs });
    return readShelf(repo, input.shelfId);
  }
  function preflightCreateCommand(request) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf create requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.create@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.requestInput });
    const row = readCommandEvidence((context) => context.repository(commandEvidence.repositoryId).invoke('find_receipt_by_key', {
      owner_domain: 'arca',
      command_contract: commandContract,
      caller_scope: 'admin',
      idempotency_key: request.idempotencyKey,
    }));
    if (row && row.request_digest !== requestDigest) fail('P3_COMMAND_IDEMPOTENCY_CONFLICT', 'Idempotency key already belongs to another Shelf create request.');
    if (!row) return null;
    let resultRef;
    try { resultRef = JSON.parse(row.result_ref_json); } catch (_error) {
      fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Shelf create Result is invalid JSON.');
    }
    if (!resultRef || Object.keys(resultRef).length !== 1 ||
        resultRef.shelfId !== request.requestInput?.shelfId ||
        canonicalDigest(resultRef) !== row.result_digest ||
        row.target_id !== request.requestInput?.shelfId) {
      fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Shelf create Result digest or target is invalid.');
    }
    const shelf = getShelf(resultRef.shelfId);
    if (!shelf) fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Shelf create Result does not resolve to a Shelf.');
    return Object.freeze({ shelf, replayed: true });
  }
  function createShelf(request) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf create requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.create@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.requestInput });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, shelfId: request.input?.shelfId });
    const committed = commandCommit.execute({
      command: { commandReceiptId: 'arca-shelf-receipt-' + keyDigest.slice(0, 32), ownerDomain: 'arca', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'shelf', targetId: request.input?.shelfId },
      domainParticipant: { participantId: 'arca_shelf_create', owner: 'arca', repositories: [repository], execute: (context) => create(request.input, context) },
      commitMarker: { commitMarker: 'arca-shelf-create-' + keyDigest, scopeType: 'shelf', scopeId: request.input?.shelfId, commitDigest: canonicalDigest({ commandContract, requestDigest }) },
      auditRecords: [{ auditId: 'arca-shelf-audit-' + keyDigest.slice(0, 32), actorType: 'admin', action: 'create_shelf', scopeType: 'shelf', scopeId: request.input?.shelfId, evidenceDigest: requestDigest }],
      resultEnvelope: (shelf) => ({ resultSchemaRef: 'helix://contracts/application-results/ArcaShelfAdminResult/v1', resultRef: { shelfId: shelf.shelfId } }),
    });
    const shelf = getShelf(committed.receipt.resultRef.shelfId);
    if (!shelf) fail('P3_COMMAND_RECEIPT_CORRUPT', 'Committed Shelf Result does not resolve to a Shelf.');
    return Object.freeze({ shelf, replayed: committed.replayed });
  }

  function commitMutation(request, operation, apply) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf mutation requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.' + operation + '@1';
    const requestDigest = operation === 'revise_placement'
      ? placementCommandDigest(commandContract, request.input)
      : canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, shelfId: request.input?.shelfId });
    const committed = commandCommit.execute({
      command: { commandReceiptId: 'arca-shelf-receipt-' + keyDigest.slice(0, 32), ownerDomain: 'arca', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'shelf', targetId: request.input?.shelfId },
      domainParticipant: { participantId: 'arca_shelf_mutation', owner: 'arca', repositories: [repository], execute: (context) => apply(request.input, context) },
      commitMarker: { commitMarker: 'arca-shelf-' + operation + '-' + keyDigest, scopeType: 'shelf', scopeId: request.input?.shelfId, commitDigest: canonicalDigest({ commandContract, requestDigest }) },
      auditRecords: [{ auditId: 'arca-shelf-audit-' + keyDigest.slice(0, 32), actorType: 'admin', action: operation, scopeType: 'shelf', scopeId: request.input?.shelfId, evidenceDigest: requestDigest }],
      resultEnvelope: (shelf) => ({ resultSchemaRef: 'helix://contracts/application-results/ArcaShelfAdminResult/v1', resultRef: { shelfId: shelf.shelfId } }),
    });
    const shelf = getShelf(committed.receipt.resultRef.shelfId);
    if (!shelf) fail('P3_COMMAND_RECEIPT_CORRUPT', 'Committed Shelf Result does not resolve to a Shelf.');
    return Object.freeze({ shelf, replayed: committed.replayed });
  }

  function renameShelf(input, context) {
    exact(input, ['shelfId','expectedUpdatedAtMs','name'], 'P14_SHELF_RENAME_INPUT');
    text(input.shelfId, 'shelfId'); text(input.name, 'name');
    if (!Number.isSafeInteger(input.expectedUpdatedAtMs) || input.expectedUpdatedAtMs < 0) fail('P14_SHELF_RENAME_CAS', 'Shelf update fence is invalid.');
    const repo = context.repository(repository.repositoryId);
    const current = repo.invoke('find_shelf', { shelf_id: input.shelfId });
    if (!current) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
    if (current.status !== 'active' || current.updated_at_ms !== input.expectedUpdatedAtMs) fail('P14_SHELF_RENAME_CAS', 'Shelf update fence is stale.');
    const updatedAtMs = Math.max(context.commitTimeMs, current.updated_at_ms + 1);
    const changed = repo.invoke('rename_shelf', {
      name: input.name,
      updated_at_ms: updatedAtMs,
      shelf_id: input.shelfId,
      expected_updated_at_ms: input.expectedUpdatedAtMs,
      expected_status: 'active',
    });
    if (changed.changes !== 1) fail('P14_SHELF_RENAME_CAS', 'Shelf rename CAS failed.');
    return readShelf(repo, input.shelfId);
  }

  function validatePlacement(input) {
    exact(input.placement, ['schemaRef','value','digest'], 'P14_SHELF_PLACEMENT_INPUT');
    text(input.placement.schemaRef, 'placement.schemaRef');
    if (input.placement.digest !== canonicalDigest(input.placement.value)) fail('P14_SHELF_DIGEST_MISMATCH', 'Shelf Placement digest is invalid.');
  }

  function validateTargetBundle(input) {
    exact(input.target, ['endpointId','rootLocation','mountScopeId','mountScopeRevision'], 'P14_SHELF_TARGET_INPUT');
    text(input.target.endpointId, 'target.endpointId');
    text(input.target.rootLocation, 'target.rootLocation');
    text(input.target.mountScopeId, 'target.mountScopeId');
    if (!Number.isSafeInteger(input.target.mountScopeRevision) ||
        input.target.mountScopeRevision < 1) {
      fail('P14_SHELF_TARGET_MOUNT_REVISION', 'Shelf Target Mount Scope revision is invalid.');
    }
    exact(input.targetReadiness, [
      'schemaRef',
      'shelfId',
      'targetDigest',
      'endpointId',
      'rootLocation',
      'mountScopeId',
      'mountScopeRevision',
      'directoryReadable',
      'directoryWritable',
      'safeMaterialCommit',
      'commitProtocol',
      'observationMode',
      'filesystemType',
      'physicalEffect',
      'probeDigest',
    ], 'P14_SHELF_TARGET_READINESS_INPUT');
    const evidence = input.targetReadiness;
    const evidenceBase = Object.fromEntries(
      Object.entries(evidence).filter(([key]) => key !== 'probeDigest'),
    );
    if (evidence.schemaRef !== EVIDENCE_SCHEMA_REF ||
        evidence.shelfId !== input.shelfId ||
        evidence.targetDigest !== targetDigest(input.shelfId, input.target) ||
        evidence.endpointId !== input.target.endpointId ||
        evidence.rootLocation !== input.target.rootLocation ||
        evidence.mountScopeId !== input.target.mountScopeId ||
        evidence.mountScopeRevision !== input.target.mountScopeRevision ||
        evidence.directoryReadable !== true ||
        evidence.directoryWritable !== true ||
        evidence.safeMaterialCommit !== true ||
        evidence.commitProtocol !== 'target_local_slot_then_atomic_switch' ||
        evidence.observationMode !== 'read_only' ||
        typeof evidence.filesystemType !== 'string' ||
        evidence.physicalEffect !== 'none' ||
        evidence.probeDigest !== canonicalDigest(evidenceBase)) {
      fail(
        'P14_SHELF_TARGET_READINESS_MISMATCH',
        'Shelf Target readiness evidence does not match the proposed Target.',
      );
    }
  }

  function previewPlacement(request) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf Placement preview requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.placement_preview@1';
    const requestDigest = placementCommandDigest(commandContract, request.input);
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, shelfId: request.input?.shelfId });
    const previewId = 'arca-placement-preview-' + keyDigest.slice(0, 32);
    const committed = commandCommit.execute({
      command: { commandReceiptId: previewId, ownerDomain: 'arca', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'shelf', targetId: request.input?.shelfId },
      domainParticipant: { participantId: 'arca_shelf_placement_preview', owner: 'arca', repositories: [repository], execute(context) {
        const input = request.input;
        exact(input, ['shelfId','expectedPlacementRevision','target','placement','targetReadiness'], 'P14_SHELF_PLACEMENT_PREVIEW_INPUT');
        validatePlacement(input);
        validateTargetBundle(input);
        const repo = context.repository(repository.repositoryId);
        const shelf = readShelf(repo, input.shelfId);
        if (!shelf) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
        if (shelf.status !== 'active' || shelf.currentPlacementRevision !== input.expectedPlacementRevision) fail('P14_SHELF_PLACEMENT_CAS', 'Shelf Placement head is stale.');
        const currentTargetDigest = targetDigest(input.shelfId, shelf.target);
        const affectedActiveEntryCount = repo.invoke('list_shelf_entries', { shelf_id: input.shelfId }).filter((entry) =>
          entry.status === 'active' || entry.status === 'offdeck_in_progress').length;
        const result = {
          previewId,
          shelfId: input.shelfId,
          expectedPlacementRevision: input.expectedPlacementRevision,
          currentTargetDigest,
          proposedTarget: input.target,
          proposedTargetDigest: input.targetReadiness.targetDigest,
          targetReadinessEvidence: input.targetReadiness,
          currentPlacementDigest: shelf.placement.digest,
          proposedPlacementDigest: input.placement.digest,
          affectedActiveEntryCount,
          physicalEffect: 'none',
        };
        return Object.freeze({ ...result, previewDigest: canonicalDigest(result) });
      } },
      commitMarker: { commitMarker: 'arca-shelf-placement-preview-' + keyDigest, scopeType: 'shelf', scopeId: request.input?.shelfId, commitDigest: requestDigest },
      auditRecords: [{ auditId: 'arca-shelf-placement-preview-audit-' + keyDigest.slice(0, 32), actorType: 'admin', action: 'preview_placement', scopeType: 'shelf', scopeId: request.input?.shelfId, evidenceDigest: requestDigest }],
      resultEnvelope: (result) => ({ resultSchemaRef: 'helix://contracts/application-results/ArcaShelfPlacementPreviewResult/v1', resultRef: result }),
    });
    return Object.freeze({ ...committed.receipt.resultRef, replayed: committed.replayed });
  }

  function placementCommandDigest(commandContract, input) {
    const { targetReadiness: _targetReadiness, ...semanticInput } = input || {};
    return canonicalDigest({ commandContract, input: semanticInput });
  }

  function existingPlacementCommand(request, operation = 'revise_placement') {
    const commandContract = 'arca.admin.shelf.' + operation + '@1';
    const requestDigest = placementCommandDigest(commandContract, request.input);
    const row = readCommandEvidence((context) => context.repository(commandEvidence.repositoryId).invoke('find_receipt_by_key', {
      owner_domain: 'arca',
      command_contract: commandContract,
      caller_scope: 'admin',
      idempotency_key: request.idempotencyKey,
    }));
    if (row && row.request_digest !== requestDigest) fail('P3_COMMAND_IDEMPOTENCY_CONFLICT', 'Idempotency key already belongs to another Placement request.');
    if (!row) return null;
    let resultRef;
    try { resultRef = JSON.parse(row.result_ref_json); } catch (_error) {
      fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Placement command Result is invalid JSON.');
    }
    if (!resultRef || canonicalDigest(resultRef) !== row.result_digest || row.target_id !== request.input?.shelfId) {
      fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Placement command Result digest or target is invalid.');
    }
    if (operation === 'revise_placement') {
      if (Object.keys(resultRef).length !== 1 || resultRef.shelfId !== request.input?.shelfId) {
        fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Placement command does not identify the exact Shelf.');
      }
      const shelf = getShelf(resultRef.shelfId);
      if (!shelf) fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored Placement command does not resolve to a Shelf.');
      return Object.freeze({ shelf, replayed: true });
    }
    return Object.freeze({ ...resultRef, replayed: true });
  }

  function verifyPlacementPreview(input) {
    const row = readCommandEvidence((context) => context.repository(commandEvidence.repositoryId).invoke('find_receipt_by_id', {
      command_receipt_id: input.previewId,
    }));
    if (!row || row.owner_domain !== 'arca' || row.command_contract !== 'arca.admin.shelf.placement_preview@1' ||
        row.caller_scope !== 'admin' || row.target_id !== input.shelfId) fail('P14_SHELF_PLACEMENT_PREVIEW_REQUIRED', 'Placement publish requires its exact durable preview.');
    let result;
    try { result = JSON.parse(row.result_ref_json); } catch (_error) { fail('P14_SHELF_PLACEMENT_PREVIEW_CORRUPT', 'Placement preview receipt is corrupt.'); }
    if (!result || canonicalDigest(result) !== row.result_digest || result.previewId !== input.previewId ||
        result.shelfId !== input.shelfId || result.expectedPlacementRevision !== input.expectedPlacementRevision ||
        result.currentTargetDigest !== input.expectedCurrentTargetDigest ||
        result.proposedTargetDigest !== input.targetReadiness.targetDigest ||
        canonicalDigest(result.proposedTarget) !== canonicalDigest(input.target) ||
        canonicalDigest(result.targetReadinessEvidence) !== canonicalDigest(input.targetReadiness) ||
        result.proposedPlacementDigest !== input.placement.digest || result.previewDigest !== input.previewDigest ||
        result.physicalEffect !== 'none') fail('P14_SHELF_PLACEMENT_PREVIEW_MISMATCH', 'Placement publish does not match its durable preview.');
  }

  function reviseStandard(input, context) {
    exact(input, ['shelfId','expectedStandardRevision','expectedRoutingProjectionRevision','standard'], 'P14_SHELF_STANDARD_REVISION_INPUT');
    exact(input.standard, ['ruleTemplateId','ruleTemplateRevision','schemaRef','value','digest'], 'P14_SHELF_STANDARD_INPUT');
    const repo = context.repository(repository.repositoryId); const current = repo.invoke('find_shelf', { shelf_id: input.shelfId });
    if (!current) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
    if (current.status !== 'active' || current.current_standard_revision !== input.expectedStandardRevision ||
        current.routing_projection_revision !== input.expectedRoutingProjectionRevision) fail('P14_SHELF_STANDARD_CAS', 'Shelf Standard head is stale.');
    if (input.standard.digest !== canonicalDigest(input.standard.value)) fail('P14_SHELF_DIGEST_MISMATCH', 'Shelf Standard digest is invalid.');
    const revision = input.expectedStandardRevision + 1; const projectionRevision = input.expectedRoutingProjectionRevision + 1;
    const projectionDigest = canonicalDigest({ schema: 'arca.shelf-routing-target-projection@1', shelfId: input.shelfId, status: 'active', currentStandardRevision: revision, currentStandardDigest: input.standard.digest, routingProjectionRevision: projectionRevision });
    repo.invoke('insert_standard', { shelf_id: input.shelfId, revision, rule_template_id: text(input.standard.ruleTemplateId, 'standard.ruleTemplateId'), rule_template_revision: input.standard.ruleTemplateRevision, standard_schema_ref: text(input.standard.schemaRef, 'standard.schemaRef'), standard_json: canonicalJson(input.standard.value), standard_digest: input.standard.digest, effective_at_ms: context.commitTimeMs });
    const changed = repo.invoke('advance_standard_head', { current_standard_revision: revision, routing_projection_revision: projectionRevision, routing_projection_digest: projectionDigest, updated_at_ms: context.commitTimeMs, shelf_id: input.shelfId, expected_standard_revision: input.expectedStandardRevision, expected_projection_revision: input.expectedRoutingProjectionRevision, expected_status: 'active' });
    if (changed.changes !== 1) fail('P14_SHELF_STANDARD_CAS', 'Shelf Standard head CAS failed.');
    return readShelf(repo, input.shelfId);
  }

  function revisePlacement(input, context) {
    exact(input, ['shelfId','expectedPlacementRevision','expectedCurrentTargetDigest','target','previewId','previewDigest','placement','targetReadiness'], 'P14_SHELF_PLACEMENT_REVISION_INPUT');
    validatePlacement(input);
    validateTargetBundle(input);
    const repo = context.repository(repository.repositoryId); const current = repo.invoke('find_shelf', { shelf_id: input.shelfId });
    if (!current) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
    const currentTarget = {
      endpointId: current.target_endpoint_id,
      rootLocation: current.target_root_location,
      mountScopeId: current.target_mount_scope_id,
      mountScopeRevision: current.target_mount_scope_revision,
    };
    if (current.status !== 'active' ||
        current.current_placement_revision !== input.expectedPlacementRevision ||
        targetDigest(input.shelfId, currentTarget) !== input.expectedCurrentTargetDigest) {
      fail('P14_SHELF_PLACEMENT_CAS', 'Shelf Target Folder or Placement head is stale.');
    }
    const revision = input.expectedPlacementRevision + 1;
    repo.invoke('insert_placement', { shelf_id: input.shelfId, revision, policy_schema_ref: text(input.placement.schemaRef, 'placement.schemaRef'), policy_json: canonicalJson(input.placement.value), policy_digest: input.placement.digest, effective_at_ms: context.commitTimeMs });
    const changed = repo.invoke('advance_placement_head', {
      target_endpoint_id: input.target.endpointId,
      target_root_location: input.target.rootLocation,
      target_mount_scope_id: input.target.mountScopeId,
      target_mount_scope_revision: input.target.mountScopeRevision,
      current_placement_revision: revision,
      updated_at_ms: context.commitTimeMs,
      shelf_id: input.shelfId,
      expected_target_endpoint_id: currentTarget.endpointId,
      expected_target_root_location: currentTarget.rootLocation,
      expected_target_mount_scope_id: currentTarget.mountScopeId,
      expected_target_mount_scope_revision: currentTarget.mountScopeRevision,
      expected_placement_revision: input.expectedPlacementRevision,
      expected_status: 'active',
    });
    if (changed.changes !== 1) fail('P14_SHELF_PLACEMENT_CAS', 'Shelf Placement head CAS failed.');
    return readShelf(repo, input.shelfId);
  }

  function getShelf(shelfId) {
    return execute((context) => readShelf(context.repository(repository.repositoryId), shelfId));
  }
  return Object.freeze({
    repositoryManifest: Object.freeze({ component: 'ArcaShelfRepository', repositoryId: repository.repositoryId, tableIds: repository.tableIds }),
    createShelf,
    preflightCreateCommand,
    renameShelf: (request) => commitMutation(request, 'rename', renameShelf),
    reviseStandard: (request) => commitMutation(request, 'revise_standard', reviseStandard),
    previewPlacement,
    revisePlacement: (request) => {
      const existing = existingPlacementCommand(request);
      if (existing) return existing;
      verifyPlacementPreview(request.input);
      return commitMutation(request, 'revise_placement', revisePlacement);
    },
    preflightPlacementCommand: (request, operation) => existingPlacementCommand(request, operation),
    listShelves: () => execute((context) => context.repository(repository.repositoryId).invoke('list_shelves').map((row) => readShelf(context.repository(repository.repositoryId), row.shelf_id))),
    getShelf,
  });
}

module.exports = Object.freeze({ ArcaShelfStoreError, createShelfQueryStore });
