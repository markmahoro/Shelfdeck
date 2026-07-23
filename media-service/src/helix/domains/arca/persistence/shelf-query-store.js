'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

class ArcaShelfStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ArcaShelfStoreError'; this.code = code; this.details = details; }
}
class ShelfDeregistrationReplay extends Error {
  constructor(receipt) { super('Shelf Deregistration replay'); this.receipt = receipt; }
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
    deregister_shelf: { kind: 'update', tableId: 'arca_shelves', setColumns: ['status','routing_projection_revision','routing_projection_digest','updated_at_ms'], keyColumns: ['shelf_id'], compareColumns: [{ column: 'updated_at_ms', parameter: 'expected_updated_at_ms' }, { column: 'routing_projection_revision', parameter: 'expected_projection_revision' }, { column: 'status', parameter: 'expected_status' }] },
    advance_standard_head: { kind: 'update', tableId: 'arca_shelves', setColumns: ['current_standard_revision','routing_projection_revision','routing_projection_digest','updated_at_ms'], keyColumns: ['shelf_id'], compareColumns: [{ column: 'current_standard_revision', parameter: 'expected_standard_revision' }, { column: 'routing_projection_revision', parameter: 'expected_projection_revision' }, { column: 'status', parameter: 'expected_status' }] },
    advance_placement_head: { kind: 'update', tableId: 'arca_shelves', setColumns: ['current_placement_revision','updated_at_ms'], keyColumns: ['shelf_id'], compareColumns: [{ column: 'current_placement_revision', parameter: 'expected_placement_revision' }, { column: 'status', parameter: 'expected_status' }] },
    insert_standard: { kind: 'insert', tableId: 'arca_shelf_standard_revisions', columns: ['shelf_id','revision','rule_template_id','rule_template_revision','standard_schema_ref','standard_json','standard_digest','effective_at_ms'] },
    find_standard: { kind: 'select-one', tableId: 'arca_shelf_standard_revisions', columns: ['shelf_id','revision','rule_template_id','rule_template_revision','standard_schema_ref','standard_json','standard_digest','effective_at_ms'], keyColumns: ['shelf_id','revision'] },
    insert_placement: { kind: 'insert', tableId: 'arca_placement_policy_revisions', columns: ['shelf_id','revision','policy_schema_ref','policy_json','policy_digest','effective_at_ms'] },
    find_placement: { kind: 'select-one', tableId: 'arca_placement_policy_revisions', columns: ['shelf_id','revision','policy_schema_ref','policy_json','policy_digest','effective_at_ms'], keyColumns: ['shelf_id','revision'] },
    list_shelf_entries: { kind: 'select-all', tableId: 'arca_shelf_entries', columns: ['shelf_entry_id','status'], keyColumns: ['shelf_id'] },
    insert_deregistration: { kind: 'insert', tableId: 'arca_deregistrations', columns: ['deregistration_id','shelf_id','release_manifest_digest','state','created_at_ms','committed_at_ms'] },
    insert_deregistration_receipt: { kind: 'insert', tableId: 'arca_deregistration_receipts', columns: ['receipt_id','deregistration_id','shelf_id','released_control_set_digest','terminal_fact_digest','committed_at_ms'] },
  } });
  const commandEvidence = createRepositoryDefinition({ repositoryId: 'arca_shelf_command_evidence', owner: 'execution-foundation', schemaManifest: options.schemaManifest, statements: {
    find_receipt_by_id: { kind: 'select-one', tableId: 'fx_command_receipts', columns: ['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_id','result_ref_json','result_digest'], keyColumns: ['command_receipt_id'] },
    find_receipt_by_key: { kind: 'select-one', tableId: 'fx_command_receipts', columns: ['command_receipt_id','request_digest'], keyColumns: ['owner_domain','command_contract','caller_scope','idempotency_key'] },
  } });
  const deregistrationFoundation = createRepositoryDefinition({ repositoryId: 'arca_shelf_deregistration_foundation', owner: 'execution-foundation', schemaManifest: options.schemaManifest, statements: {
    find_marker: { kind: 'select-one', tableId: 'fx_commit_markers', columns: ['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'], keyColumns: ['commit_marker'] },
    insert_marker: { kind: 'insert', tableId: 'fx_commit_markers', columns: ['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'] },
    find_result: { kind: 'select-one', tableId: 'fx_event_result_bindings', columns: ['result_id','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'], keyColumns: ['result_id'] },
    insert_result: { kind: 'insert', tableId: 'fx_event_result_bindings', columns: ['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'] },
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
    exact(input, ['shelfId','name','target','standard','placement'], 'P14_SHELF_CREATE_INPUT');
    exact(input.target, ['endpointId','rootLocation','mountScopeId','mountScopeRevision'], 'P14_SHELF_TARGET_INPUT');
    exact(input.standard, ['ruleTemplateId','ruleTemplateRevision','schemaRef','value','digest'], 'P14_SHELF_STANDARD_INPUT');
    exact(input.placement, ['schemaRef','value','digest'], 'P14_SHELF_PLACEMENT_INPUT');
    text(input.shelfId, 'shelfId'); text(input.name, 'name'); text(input.target.endpointId, 'target.endpointId'); text(input.target.rootLocation, 'target.rootLocation'); text(input.target.mountScopeId, 'target.mountScopeId');
    if (!Number.isSafeInteger(input.target.mountScopeRevision) || input.target.mountScopeRevision < 1 ||
        !Number.isSafeInteger(input.standard.ruleTemplateRevision) || input.standard.ruleTemplateRevision < 1) fail('P14_SHELF_INITIAL_REVISION', 'Shelf initial revisions must be positive integers.');
    if (input.standard.digest !== canonicalDigest(input.standard.value) || input.placement.digest !== canonicalDigest(input.placement.value)) fail('P14_SHELF_DIGEST_MISMATCH', 'Shelf Standard or Placement digest is invalid.');
    const repo = context.repository(repository.repositoryId);
    if (repo.invoke('find_shelf', { shelf_id: input.shelfId })) fail('P14_SHELF_EXISTS', 'Shelf already exists.');
    const projectionDigest = canonicalDigest({ schema: 'arca.shelf-routing-target-projection@1', shelfId: input.shelfId, status: 'active', currentStandardRevision: 1, currentStandardDigest: input.standard.digest, routingProjectionRevision: 1 });
    repo.invoke('insert_shelf', { shelf_id: input.shelfId, name: input.name, target_endpoint_id: input.target.endpointId, target_root_location: input.target.rootLocation, target_mount_scope_id: input.target.mountScopeId, target_mount_scope_revision: input.target.mountScopeRevision, status: 'active', current_standard_revision: 1, current_placement_revision: 1, routing_projection_revision: 1, routing_projection_digest: projectionDigest, created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs });
    repo.invoke('insert_standard', { shelf_id: input.shelfId, revision: 1, rule_template_id: text(input.standard.ruleTemplateId, 'standard.ruleTemplateId'), rule_template_revision: input.standard.ruleTemplateRevision, standard_schema_ref: text(input.standard.schemaRef, 'standard.schemaRef'), standard_json: canonicalJson(input.standard.value), standard_digest: input.standard.digest, effective_at_ms: context.commitTimeMs });
    repo.invoke('insert_placement', { shelf_id: input.shelfId, revision: 1, policy_schema_ref: text(input.placement.schemaRef, 'placement.schemaRef'), policy_json: canonicalJson(input.placement.value), policy_digest: input.placement.digest, effective_at_ms: context.commitTimeMs });
    return readShelf(repo, input.shelfId);
  }
  function createShelf(request) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf create requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.create@1'; const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, shelfId: request.input?.shelfId });
    const committed = commandCommit.execute({
      command: { commandReceiptId: 'arca-shelf-receipt-' + keyDigest.slice(0, 32), ownerDomain: 'arca', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'shelf', targetId: request.input?.shelfId },
      domainParticipant: { participantId: 'arca_shelf_create', owner: 'arca', repositories: [repository], execute: (context) => create(request.input, context) },
      commitMarker: { commitMarker: 'arca-shelf-create-' + keyDigest, scopeType: 'shelf', scopeId: request.input?.shelfId, commitDigest: canonicalDigest({ commandContract, requestDigest }) },
      auditRecords: [{ auditId: 'arca-shelf-audit-' + keyDigest.slice(0, 32), actorType: 'admin', action: 'create_shelf', scopeType: 'shelf', scopeId: request.input?.shelfId, evidenceDigest: requestDigest }],
      resultEnvelope: (shelf) => ({ resultSchemaRef: 'helix://contracts/application-results/ArcaShelfAdminResult/v1', resultRef: { shelf } }),
    });
    return Object.freeze({ shelf: committed.receipt.resultRef.shelf, replayed: committed.replayed });
  }

  function commitMutation(request, operation, apply) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf mutation requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.' + operation + '@1'; const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, shelfId: request.input?.shelfId });
    const committed = commandCommit.execute({
      command: { commandReceiptId: 'arca-shelf-receipt-' + keyDigest.slice(0, 32), ownerDomain: 'arca', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'shelf', targetId: request.input?.shelfId },
      domainParticipant: { participantId: 'arca_shelf_mutation', owner: 'arca', repositories: [repository], execute: (context) => apply(request.input, context) },
      commitMarker: { commitMarker: 'arca-shelf-' + operation + '-' + keyDigest, scopeType: 'shelf', scopeId: request.input?.shelfId, commitDigest: canonicalDigest({ commandContract, requestDigest }) },
      auditRecords: [{ auditId: 'arca-shelf-audit-' + keyDigest.slice(0, 32), actorType: 'admin', action: operation, scopeType: 'shelf', scopeId: request.input?.shelfId, evidenceDigest: requestDigest }],
      resultEnvelope: (shelf) => ({ resultSchemaRef: 'helix://contracts/application-results/ArcaShelfAdminResult/v1', resultRef: { shelf } }),
    });
    return Object.freeze({ shelf: committed.receipt.resultRef.shelf, replayed: committed.replayed });
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

  function previewPlacement(request) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf Placement preview requires idempotencyKey.');
    const commandContract = 'arca.admin.shelf.placement_preview@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey, shelfId: request.input?.shelfId });
    const previewId = 'arca-placement-preview-' + keyDigest.slice(0, 32);
    const committed = commandCommit.execute({
      command: { commandReceiptId: previewId, ownerDomain: 'arca', commandContract, callerScope: 'admin', idempotencyKey: request.idempotencyKey, requestDigest, targetType: 'shelf', targetId: request.input?.shelfId },
      domainParticipant: { participantId: 'arca_shelf_placement_preview', owner: 'arca', repositories: [repository], execute(context) {
        const input = request.input;
        exact(input, ['shelfId','expectedPlacementRevision','placement'], 'P14_SHELF_PLACEMENT_PREVIEW_INPUT');
        validatePlacement(input);
        const repo = context.repository(repository.repositoryId);
        const shelf = readShelf(repo, input.shelfId);
        if (!shelf) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
        if (shelf.status !== 'active' || shelf.currentPlacementRevision !== input.expectedPlacementRevision) fail('P14_SHELF_PLACEMENT_CAS', 'Shelf Placement head is stale.');
        const affectedActiveEntryCount = repo.invoke('list_shelf_entries', { shelf_id: input.shelfId }).filter((entry) =>
          entry.status === 'active' || entry.status === 'offdeck_in_progress').length;
        const result = {
          previewId,
          shelfId: input.shelfId,
          expectedPlacementRevision: input.expectedPlacementRevision,
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

  function existingPlacementCommand(request) {
    const commandContract = 'arca.admin.shelf.revise_placement@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const row = readCommandEvidence((context) => context.repository(commandEvidence.repositoryId).invoke('find_receipt_by_key', {
      owner_domain: 'arca',
      command_contract: commandContract,
      caller_scope: 'admin',
      idempotency_key: request.idempotencyKey,
    }));
    if (row && row.request_digest !== requestDigest) fail('P3_COMMAND_IDEMPOTENCY_CONFLICT', 'Idempotency key already belongs to another Placement request.');
    return row;
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
    exact(input, ['shelfId','expectedPlacementRevision','previewId','previewDigest','placement'], 'P14_SHELF_PLACEMENT_REVISION_INPUT');
    validatePlacement(input);
    const repo = context.repository(repository.repositoryId); const current = repo.invoke('find_shelf', { shelf_id: input.shelfId });
    if (!current) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
    if (current.status !== 'active' || current.current_placement_revision !== input.expectedPlacementRevision) fail('P14_SHELF_PLACEMENT_CAS', 'Shelf Placement head is stale.');
    const revision = input.expectedPlacementRevision + 1;
    repo.invoke('insert_placement', { shelf_id: input.shelfId, revision, policy_schema_ref: text(input.placement.schemaRef, 'placement.schemaRef'), policy_json: canonicalJson(input.placement.value), policy_digest: input.placement.digest, effective_at_ms: context.commitTimeMs });
    const changed = repo.invoke('advance_placement_head', { current_placement_revision: revision, updated_at_ms: context.commitTimeMs, shelf_id: input.shelfId, expected_placement_revision: input.expectedPlacementRevision, expected_status: 'active' });
    if (changed.changes !== 1) fail('P14_SHELF_PLACEMENT_CAS', 'Shelf Placement head CAS failed.');
    return readShelf(repo, input.shelfId);
  }

  function decodeDeregistrationReceipt(marker, row) {
    if (!row || marker.result_schema_ref !== 'helix://contracts/types/DeregistrationReceipt/v1' ||
        row.result_schema_ref !== marker.result_schema_ref || row.result_digest !== marker.result_digest) {
      fail('P14_SHELF_DEREGISTRATION_RESULT_CORRUPT', 'Shelf Deregistration marker does not resolve to its exact typed Receipt.');
    }
    let receipt;
    try { receipt = JSON.parse(row.result_json); } catch (_error) {
      fail('P14_SHELF_DEREGISTRATION_RESULT_CORRUPT', 'Shelf Deregistration Receipt is not valid JSON.');
    }
    if (!receipt || receipt.schemaRef !== row.result_schema_ref || canonicalDigest(receipt) !== row.result_digest) {
      fail('P14_SHELF_DEREGISTRATION_RESULT_CORRUPT', 'Shelf Deregistration Receipt digest is invalid.');
    }
    return Object.freeze(receipt);
  }

  function deregisterShelf(request) {
    if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey) {
      fail('IDEMPOTENCY_KEY_REQUIRED', 'Shelf Deregistration requires idempotencyKey.');
    }
    const input = request.input;
    const commandContract = 'arca.admin.shelf.deregister@1';
    const requestDigest = canonicalDigest({ commandContract, input });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey: request.idempotencyKey });
    const commitMarker = 'arca-shelf-deregister-' + keyDigest;
    let typedReceipt;
    let replayed = false;
    try {
      options.unitOfWork.execute([
        {
          participantId: 'arca_shelf_deregistration_preflight',
          owner: 'execution-foundation',
          boundBusinessOwner: 'arca',
          repositories: [deregistrationFoundation],
          execute(context) {
            const foundation = context.repository(deregistrationFoundation.repositoryId);
            const marker = foundation.invoke('find_marker', { commit_marker: commitMarker });
            if (!marker) return null;
            if (marker.owner_domain !== 'arca' || marker.scope_type !== 'shelf' ||
                marker.scope_id !== input?.shelfId || marker.commit_digest !== requestDigest) {
              fail('P3_COMMAND_IDEMPOTENCY_CONFLICT', 'Shelf Deregistration idempotency key belongs to another request.');
            }
            throw new ShelfDeregistrationReplay(decodeDeregistrationReceipt(
              marker,
              foundation.invoke('find_result', { result_id: marker.result_id }),
            ));
          },
        },
        {
          participantId: 'arca_shelf_deregistration_commit',
          owner: 'arca',
          repositories: [repository],
          execute(context) {
            exact(input, ['shelfId','expectedStatus','expectedUpdatedAtMs','expectedRoutingProjectionRevision','authorization'], 'P14_SHELF_DEREGISTRATION_INPUT');
            exact(input.authorization, ['authorizationId','decision','shelfId'], 'P14_SHELF_DEREGISTRATION_AUTHORIZATION');
            text(input.shelfId, 'shelfId');
            text(input.authorization.authorizationId, 'authorization.authorizationId');
            if (input.expectedStatus !== 'active' || input.authorization.decision !== 'deregister_shelf' ||
                input.authorization.shelfId !== input.shelfId) {
              fail('P14_SHELF_DEREGISTRATION_AUTHORIZATION', 'Shelf Deregistration requires explicit exact-Shelf authorization.');
            }
            if (!Number.isSafeInteger(input.expectedUpdatedAtMs) || input.expectedUpdatedAtMs < 0 ||
                !Number.isSafeInteger(input.expectedRoutingProjectionRevision) || input.expectedRoutingProjectionRevision < 1) {
              fail('P14_SHELF_DEREGISTRATION_FENCE', 'Shelf Deregistration expected state/revision fence is invalid.');
            }
            const repo = context.repository(repository.repositoryId);
            const current = repo.invoke('find_shelf', { shelf_id: input.shelfId });
            if (!current) fail('P14_SHELF_NOT_FOUND', 'Shelf does not exist.');
            if (current.status !== input.expectedStatus || current.updated_at_ms !== input.expectedUpdatedAtMs ||
                current.routing_projection_revision !== input.expectedRoutingProjectionRevision) {
              fail('P14_SHELF_DEREGISTRATION_FENCE', 'Shelf Deregistration expected state/revision fence is stale.');
            }
            const nonTerminalEntries = repo.invoke('list_shelf_entries', { shelf_id: input.shelfId })
              .filter((entry) => entry.status === 'active' || entry.status === 'offdeck_in_progress');
            if (nonTerminalEntries.length !== 0) {
              fail('P14_SHELF_DEREGISTRATION_NON_EMPTY_UNWIRED', 'Non-empty Shelf Deregistration remains unavailable until exact Entry/Inventory/Control release wiring is present.');
            }
            const releasedControlSetDigest = canonicalDigest({ schema: 'arca.shelf-deregistration-released-control-set@1', entries: [] });
            const releaseManifestDigest = canonicalDigest({
              schema: 'arca.shelf-deregistration-release-manifest@1',
              shelfId: input.shelfId,
              entries: [],
              controls: [],
              releasedControlSetDigest,
            });
            const deregistrationId = 'arca-deregistration-' + canonicalDigest({
              schema: 'arca.shelf-deregistration-id@1',
              authorizationId: input.authorization.authorizationId,
              releaseManifestDigest,
            }).slice(0, 32);
            const receiptId = 'arca-deregistration-receipt-' + canonicalDigest({
              schema: 'arca.shelf-deregistration-receipt-id@1',
              deregistrationId,
            }).slice(0, 32);
            const routingProjectionRevision = input.expectedRoutingProjectionRevision + 1;
            const routingProjectionDigest = canonicalDigest({
              schema: 'arca.shelf-routing-target-projection@1',
              shelfId: input.shelfId,
              status: 'deregistered',
              currentStandardRevision: current.current_standard_revision,
              currentStandardDigest: repo.invoke('find_standard', {
                shelf_id: input.shelfId,
                revision: current.current_standard_revision,
              }).standard_digest,
              routingProjectionRevision,
            });
            const terminalFactDigest = canonicalDigest({
              schema: 'arca.shelf-deregistration-terminal-fact@1',
              shelfId: input.shelfId,
              shelfStatus: 'deregistered',
              routingProjectionRevision,
              terminalEntries: [],
            });
            const updatedAtMs = Math.max(context.commitTimeMs, current.updated_at_ms + 1);
            repo.invoke('insert_deregistration', {
              deregistration_id: deregistrationId,
              shelf_id: input.shelfId,
              release_manifest_digest: releaseManifestDigest,
              state: 'committed',
              created_at_ms: context.commitTimeMs,
              committed_at_ms: context.commitTimeMs,
            });
            const changed = repo.invoke('deregister_shelf', {
              status: 'deregistered',
              routing_projection_revision: routingProjectionRevision,
              routing_projection_digest: routingProjectionDigest,
              updated_at_ms: updatedAtMs,
              shelf_id: input.shelfId,
              expected_updated_at_ms: input.expectedUpdatedAtMs,
              expected_projection_revision: input.expectedRoutingProjectionRevision,
              expected_status: input.expectedStatus,
            });
            if (changed.changes !== 1) fail('P14_SHELF_DEREGISTRATION_FENCE', 'Shelf Deregistration CAS failed.');
            repo.invoke('insert_deregistration_receipt', {
              receipt_id: receiptId,
              deregistration_id: deregistrationId,
              shelf_id: input.shelfId,
              released_control_set_digest: releasedControlSetDigest,
              terminal_fact_digest: terminalFactDigest,
              committed_at_ms: context.commitTimeMs,
            });
            typedReceipt = Object.freeze({
              schemaRef: 'helix://contracts/types/DeregistrationReceipt/v1',
              schemaVersion: 1,
              receiptId,
              receiptKind: 'shelf_deregistration',
              ownerDomain: 'arca',
              scopeType: 'shelf',
              scopeId: input.shelfId,
              scopeDigest: releaseManifestDigest,
              effectReceiptRef: null,
              committedAtMs: context.commitTimeMs,
              deregistrationId,
              shelfId: input.shelfId,
              releasedControlSetDigest,
              terminalFactDigest,
            });
            return typedReceipt;
          },
        },
        {
          participantId: 'arca_shelf_deregistration_result',
          owner: 'execution-foundation',
          boundBusinessOwner: 'arca',
          repositories: [deregistrationFoundation],
          execute(context) {
            const foundation = context.repository(deregistrationFoundation.repositoryId);
            const evidence = {
              evidenceId: 'arca-shelf-deregistration-evidence-' + keyDigest.slice(0, 32),
              evidenceKind: 'shelf_deregistration_commit',
              producerRef: 'arca.shelf_deregistration.commit@1',
              basisDigest: requestDigest,
              payloadDigest: typedReceipt.scopeDigest,
              observedAtMs: context.commitTimeMs,
            };
            foundation.invoke('insert_result', {
              result_id: typedReceipt.receiptId,
              event_id: null,
              outcome_kind: 'succeeded',
              result_schema_ref: typedReceipt.schemaRef,
              result_json: canonicalJson(typedReceipt),
              result_digest: canonicalDigest(typedReceipt),
              evidence_schema_ref: 'helix://contracts/capabilities/arca.shelf_deregistration.commit/v1/evidence',
              evidence_json: canonicalJson(evidence),
              evidence_digest: canonicalDigest(evidence),
              effect_receipt_id: typedReceipt.receiptId,
              committed_at_ms: context.commitTimeMs,
            });
          },
        },
        {
          participantId: 'arca_shelf_deregistration_marker',
          owner: 'execution-foundation',
          boundBusinessOwner: 'arca',
          repositories: [deregistrationFoundation],
          execute(context) {
            context.repository(deregistrationFoundation.repositoryId).invoke('insert_marker', {
              commit_marker: commitMarker,
              effect_id: null,
              owner_domain: 'arca',
              scope_type: 'shelf',
              scope_id: input.shelfId,
              commit_digest: requestDigest,
              result_id: typedReceipt.receiptId,
              result_schema_ref: typedReceipt.schemaRef,
              result_digest: canonicalDigest(typedReceipt),
              committed_at_ms: context.commitTimeMs,
            });
          },
        },
      ]);
    } catch (error) {
      if (error instanceof ShelfDeregistrationReplay) {
        typedReceipt = error.receipt;
        replayed = true;
      }
      else throw error;
    }
    return Object.freeze({ receipt: typedReceipt, shelf: getShelf(input.shelfId), replayed });
  }

  function getShelf(shelfId) {
    return execute((context) => readShelf(context.repository(repository.repositoryId), shelfId));
  }
  return Object.freeze({
    repositoryManifest: Object.freeze({ component: 'ArcaShelfRepository', repositoryId: repository.repositoryId, tableIds: repository.tableIds }),
    createShelf,
    renameShelf: (request) => commitMutation(request, 'rename', renameShelf),
    reviseStandard: (request) => commitMutation(request, 'revise_standard', reviseStandard),
    previewPlacement,
    revisePlacement: (request) => {
      const existing = existingPlacementCommand(request);
      if (!existing) verifyPlacementPreview(request.input);
      return commitMutation(request, 'revise_placement', revisePlacement);
    },
    deregisterShelf,
    listShelves: () => execute((context) => context.repository(repository.repositoryId).invoke('list_shelves').map((row) => readShelf(context.repository(repository.repositoryId), row.shelf_id))),
    getShelf,
  });
}

module.exports = Object.freeze({ ArcaShelfStoreError, createShelfQueryStore });
