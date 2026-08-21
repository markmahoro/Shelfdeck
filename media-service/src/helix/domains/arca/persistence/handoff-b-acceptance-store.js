'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');
const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');
const {
  createMaterialControlExactTransferParticipant,
} = require('../../../foundation/persistence/material-control');
const {
  SCHEMA_REF: EPISODE_CLAIMS_SCHEMA,
  buildArcaMaterialEpisodeClaims,
  parseArcaMaterialEpisodeClaims,
} = require('../model/material-episode-claims');
const { deriveAcceptedResponsibility } = require('../model/acceptance-responsibility');

const RECEIPT_SCHEMA = 'helix://contracts/types/CustodyAndTransferReceipt/v1';
const MESSAGE_SCHEMA = 'helix://contracts/types/ArcaProductAcceptedMessage/v1';
const REJECTION_RECEIPT_SCHEMA = 'helix://contracts/types/RejectionReceipt/v1';
const REJECTION_MESSAGE_SCHEMA = 'ArcaProductRejectedMessage@1';

class HandoffBAcceptanceStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HandoffBAcceptanceStoreError';
    this.code = code;
    this.details = details;
  }
}

class Replay extends Error {
  constructor(result) {
    super('Handoff B acceptance replay');
    this.result = result;
  }
}

function fail(code, message, details) {
  throw new HandoffBAcceptanceStoreError(code, message, details);
}

function without(value, key) {
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
}

function stable(schema, value) {
  return canonicalDigest({ schema, ...value });
}

function outboxPayloadDigest(value) {
  return canonicalDigest(value);
}

function arcaDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'arca_handoff_b_acceptance',
    owner: 'arca',
    schemaManifest,
    statements: {
      find_attempt: {
        kind: 'select-one',
        tableId: 'arca_acceptance_attempts',
        columns: [
          'acceptance_attempt_id', 'offer_id', 'on_deck_package_id',
          'package_digest', 'shelf_id', 'standard_revision',
          'placement_revision', 'state', 'created_at_ms', 'finished_at_ms',
        ],
        keyColumns: ['acceptance_attempt_id'],
        safeIntegers: true,
      },
      insert_attempt: {
        kind: 'insert',
        tableId: 'arca_acceptance_attempts',
        columns: [
          'acceptance_attempt_id', 'offer_id', 'on_deck_package_id',
          'package_digest', 'shelf_id', 'standard_revision',
          'placement_revision', 'state', 'created_at_ms', 'finished_at_ms',
        ],
      },
      advance_attempt: {
        kind: 'update',
        tableId: 'arca_acceptance_attempts',
        setColumns: ['state', 'finished_at_ms'],
        keyColumns: ['acceptance_attempt_id'],
        compareColumns: [
          { column: 'state', parameter: 'expected_state' },
          { column: 'offer_id', parameter: 'expected_offer_id' },
          {
            column: 'on_deck_package_id',
            parameter: 'expected_on_deck_package_id',
          },
          {
            column: 'package_digest',
            parameter: 'expected_package_digest',
          },
          { column: 'shelf_id', parameter: 'expected_shelf_id' },
          {
            column: 'standard_revision',
            parameter: 'expected_standard_revision',
          },
          {
            column: 'placement_revision',
            parameter: 'expected_placement_revision',
          },
        ],
      },
      list_checks: {
        kind: 'select-all',
        tableId: 'arca_acceptance_checks',
        columns: [
          'acceptance_attempt_id', 'check_kind', 'check_revision', 'result',
          'evidence_digest', 'completed_at_ms',
        ],
        keyColumns: ['acceptance_attempt_id'],
        safeIntegers: true,
      },
      insert_check: {
        kind: 'insert',
        tableId: 'arca_acceptance_checks',
        columns: [
          'acceptance_attempt_id', 'check_kind', 'check_revision', 'result',
          'evidence_digest', 'completed_at_ms',
        ],
      },
      find_decision: {
        kind: 'select-one',
        tableId: 'arca_acceptance_decisions',
        columns: [
          'acceptance_decision_id', 'acceptance_attempt_id', 'result',
          'offer_id', 'on_deck_package_id', 'package_digest', 'shelf_id',
          'standard_revision', 'placement_revision',
          'acceptance_evidence_set_digest', 'rejection_schema_ref',
          'rejection_code', 'rejection_digest', 'decision_digest', 'decided_at_ms',
        ],
        keyColumns: ['acceptance_decision_id'],
        safeIntegers: true,
      },
      find_decision_by_id: {
        kind: 'select-one',
        tableId: 'arca_acceptance_decisions',
        columns: [
          'acceptance_decision_id', 'acceptance_attempt_id', 'result',
          'offer_id', 'on_deck_package_id', 'package_digest', 'shelf_id',
          'standard_revision', 'placement_revision',
          'acceptance_evidence_set_digest', 'rejection_schema_ref',
          'rejection_code', 'rejection_digest', 'decision_digest', 'decided_at_ms',
        ],
        keyColumns: ['acceptance_decision_id'],
        safeIntegers: true,
      },
      insert_decision: {
        kind: 'insert',
        tableId: 'arca_acceptance_decisions',
        columns: [
          'acceptance_decision_id', 'acceptance_attempt_id', 'result',
          'offer_id', 'on_deck_package_id', 'package_digest', 'shelf_id',
          'standard_revision', 'placement_revision',
          'acceptance_evidence_set_digest', 'rejection_schema_ref',
          'rejection_code', 'rejection_digest', 'decision_digest',
          'decided_at_ms',
        ],
      },
      find_custody: {
        kind: 'select-one',
        tableId: 'arca_ondeck_custodies',
        columns: [
          'custody_id', 'acceptance_decision_id', 'on_deck_package_id',
          'package_digest', 'control_scope_digest', 'state', 'accepted_at_ms',
        ],
        keyColumns: ['custody_id'],
        safeIntegers: true,
      },
      insert_custody: {
        kind: 'insert',
        tableId: 'arca_ondeck_custodies',
        columns: [
          'custody_id', 'acceptance_decision_id', 'on_deck_package_id',
          'package_digest', 'control_scope_digest', 'state', 'accepted_at_ms',
        ],
      },
      list_bindings: {
        kind: 'select-all',
        tableId: 'arca_material_bindings',
        columns: [
          'owner_object_type', 'owner_object_id', 'material_key', 'role',
          'episode_claims_schema_ref', 'episode_claims_json',
          'episode_claim_set_digest', 'endpoint_id', 'location',
          'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm',
          'fingerprint_version', 'content_fingerprint',
          'binding_revision',
          'health_state', 'evidence_digest', 'current',
        ],
        keyColumns: ['owner_object_type', 'owner_object_id'],
        safeIntegers: true,
      },
      insert_binding: {
        kind: 'insert',
        tableId: 'arca_material_bindings',
        columns: [
          'owner_object_type', 'owner_object_id', 'material_key', 'role',
          'episode_claims_schema_ref', 'episode_claims_json',
          'episode_claim_set_digest', 'endpoint_id', 'location',
          'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm',
          'fingerprint_version', 'content_fingerprint',
          'binding_revision',
          'health_state', 'evidence_digest', 'current',
        ],
      },
      find_receipt: {
        kind: 'select-one',
        tableId: 'arca_handoff_b_receipts',
        columns: [
          'receipt_id', 'acceptance_decision_id', 'outcome', 'offer_id',
          'custody_id', 'on_deck_package_id', 'package_digest',
          'arca_binding_set_digest', 'control_revision_set_digest',
          'rejection_code', 'acceptance_evidence_set_digest',
          'rejection_digest', 'receipt_digest',
          'committed_at_ms',
        ],
        keyColumns: ['acceptance_decision_id'],
        safeIntegers: true,
      },
      insert_receipt: {
        kind: 'insert',
        tableId: 'arca_handoff_b_receipts',
        columns: [
          'receipt_id', 'acceptance_decision_id', 'outcome', 'offer_id',
          'custody_id', 'on_deck_package_id', 'package_digest',
          'arca_binding_set_digest', 'control_revision_set_digest',
          'rejection_code', 'acceptance_evidence_set_digest',
          'rejection_digest', 'receipt_digest', 'committed_at_ms',
        ],
      },
      find_shelf: {
        kind: 'select-one',
        tableId: 'arca_shelves',
        columns: [
          'shelf_id', 'target_endpoint_id', 'target_root_location',
          'target_mount_scope_id', 'target_mount_scope_revision', 'status',
          'current_standard_revision', 'current_placement_revision',
        ],
        keyColumns: ['shelf_id'],
        safeIntegers: true,
      },
      find_standard: {
        kind: 'select-one',
        tableId: 'arca_shelf_standard_revisions',
        columns: [
          'shelf_id', 'revision', 'standard_schema_ref', 'standard_json',
          'standard_digest',
        ],
        keyColumns: ['shelf_id', 'revision'],
        safeIntegers: true,
      },
      find_placement: {
        kind: 'select-one',
        tableId: 'arca_placement_policy_revisions',
        columns: [
          'shelf_id', 'revision', 'policy_schema_ref', 'policy_json',
          'policy_digest',
        ],
        keyColumns: ['shelf_id', 'revision'],
        safeIntegers: true,
      },
      find_run: {
        kind: 'select-one',
        tableId: 'arca_ondeck_runs',
        columns: [
          'on_deck_run_id', 'custody_id',
          'final_inventory_decision_digest', 'state', 'created_at_ms',
          'terminal_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
        safeIntegers: true,
      },
      insert_run: {
        kind: 'insert',
        tableId: 'arca_ondeck_runs',
        columns: [
          'on_deck_run_id', 'custody_id',
          'final_inventory_decision_digest', 'state', 'created_at_ms',
          'terminal_at_ms',
        ],
      },
      find_final_inventory_decision: {
        kind: 'select-one',
        tableId: 'arca_final_inventory_decisions',
        columns: [
          'final_inventory_decision_id', 'on_deck_run_id', 'shelf_id',
          'placement_revision', 'target_endpoint_id', 'target_location',
          'product_manifest_digest', 'offload_context_digest',
          'decision_schema_ref', 'decision_json', 'decision_digest',
          'decided_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
        safeIntegers: true,
      },
      insert_final_inventory_decision: {
        kind: 'insert',
        tableId: 'arca_final_inventory_decisions',
        columns: [
          'final_inventory_decision_id', 'on_deck_run_id', 'shelf_id',
          'placement_revision', 'target_endpoint_id', 'target_location',
          'product_manifest_digest', 'offload_context_digest',
          'decision_schema_ref', 'decision_json', 'decision_digest',
          'decided_at_ms',
        ],
      },
    },
  });
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'arca_handoff_b_foundation',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      find_marker: {
        kind: 'select-one',
        tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'owner_domain', 'scope_type', 'scope_id',
          'commit_digest', 'result_id', 'result_schema_ref', 'result_digest',
          'committed_at_ms',
        ],
        keyColumns: ['commit_marker'],
        safeIntegers: true,
      },
      insert_result: {
        kind: 'insert',
        tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
          'result_json', 'result_digest', 'evidence_schema_ref',
          'evidence_json', 'evidence_digest', 'effect_receipt_id',
          'committed_at_ms',
        ],
      },
      insert_marker: {
        kind: 'insert',
        tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'effect_id', 'owner_domain', 'scope_type',
          'scope_id', 'commit_digest', 'result_id', 'result_schema_ref',
          'result_digest', 'committed_at_ms',
        ],
      },
      insert_outbox: {
        kind: 'insert',
        tableId: 'fx_outbox',
        columns: [
          'message_id', 'producer_domain', 'message_kind', 'aggregate_type',
          'aggregate_id', 'aggregate_revision', 'dedup_key',
          'consumer_set_digest', 'intended_consumer_count',
          'payload_schema_ref', 'payload_json', 'payload_digest', 'state',
          'available_at_ms', 'created_at_ms', 'all_acked_at_ms',
        ],
      },
      insert_outbox_delivery: {
        kind: 'insert',
        tableId: 'fx_outbox_deliveries',
        columns: [
          'message_id', 'consumer_domain', 'state', 'attempt_count',
          'next_attempt_at_ms', 'acked_at_ms',
        ],
      },
    },
  });
}

function exactAttempt(input) {
  const value = {
    acceptanceAttemptId: input.acceptanceAttemptId,
    offerId: input.offerId,
    onDeckPackageId: input.onDeckPackageId,
    packageDigest: input.packageDigest,
    shelfId: input.shelfId,
    standardRevision: input.standardRevision,
    placementRevision: input.placementRevision,
    checks: input.checks,
  };
  value.acceptanceEvidenceSetDigest = canonicalDigest({
    schema: 'arca.acceptance-evidence-set@1',
    acceptanceAttemptId: value.acceptanceAttemptId,
    checks: value.checks,
  });
  return Object.freeze(value);
}

function mapReceipt(row) {
  if (!row) return null;
  return Object.freeze({
    schemaRef: RECEIPT_SCHEMA,
    schemaVersion: 1,
    receiptId: row.receipt_id,
    receiptKind: 'handoff_b_accepted',
    ownerDomain: 'arca',
    scopeType: 'acceptance_decision',
    scopeId: row.acceptance_decision_id,
    scopeDigest: row.acceptance_evidence_set_digest,
    effectReceiptRef: null,
    committedAtMs: Number(row.committed_at_ms),
    acceptanceDecisionId: row.acceptance_decision_id,
    custodyId: row.custody_id,
    arcaBindingSetDigest: row.arca_binding_set_digest,
    controlRevisionSetDigest: row.control_revision_set_digest,
    receiptDigest: row.receipt_digest,
  });
}

function createHandoffBAcceptanceStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P14_HANDOFF_B_STORE_DEPENDENCIES',
      'Handoff B acceptance requires clean Arca persistence.');
  }
  const arca = arcaDefinition(options.schemaManifest);
  const foundation = foundationDefinition(options.schemaManifest);

  function reconstructBindingSetDigest(repo, custodyId) {
    const items = repo.invoke('list_bindings', {
      owner_object_type: 'on_deck_custody',
      owner_object_id: custodyId,
    }).map((row) => {
      const episodeClaims = parseArcaMaterialEpisodeClaims(row);
      const item = {
        materialKey: row.material_key,
        role: row.role,
        physicalIdentity:Object.freeze({
          schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
          materialKey:row.material_key, mountScopeId:row.mount_scope_id, inode:row.inode,
          sizeBytes:Number(row.size_bytes), fingerprintAlgorithm:row.fingerprint_algorithm,
          fingerprintVersion:Number(row.fingerprint_version), contentFingerprint:row.content_fingerprint,
        }),
        episodeClaims,
        endpointId: row.endpoint_id,
        location: row.location,
        bindingRevision: Number(row.binding_revision),
        evidenceDigest: row.evidence_digest,
      };
      const expectedEvidence = canonicalDigest({
        schema: 'arca.handoff-b-material-binding@1',
        custodyId,
        materialKey: item.materialKey,
        role: item.role,
        physicalIdentity:item.physicalIdentity,
        episodeClaims,
        endpointId: item.endpointId,
        location: item.location,
      });
      if (item.evidenceDigest !== expectedEvidence) {
        fail('P14_HANDOFF_B_BINDING_HISTORY',
          'Arca Binding Evidence cannot be reconstructed.');
      }
      return Object.freeze(item);
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.materialKey),
        Buffer.from(right.materialKey)) ||
      Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)));
    return canonicalDigest({
      schema: 'arca.handoff-b-binding-set@1',
      custodyId,
      items,
    });
  }

  function recordAssessment(input) {
    const assessment = exactAttempt(input);
    return options.unitOfWork.execute([{
      participantId: 'arca_acceptance_assessment',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const existing = repo.invoke('find_attempt', {
          acceptance_attempt_id: assessment.acceptanceAttemptId,
        });
        if (existing) {
          const checks = repo.invoke('list_checks', {
            acceptance_attempt_id: assessment.acceptanceAttemptId,
          }).sort((left, right) =>
            Buffer.compare(Buffer.from(left.check_kind), Buffer.from(right.check_kind)));
          const observed = checks.map((item) => ({
            kind: item.check_kind,
            outcome: item.result,
            evidenceDigest: item.evidence_digest,
          }));
          if (existing.offer_id !== assessment.offerId ||
              existing.on_deck_package_id !== assessment.onDeckPackageId ||
              existing.package_digest !== assessment.packageDigest ||
              existing.shelf_id !== assessment.shelfId ||
              Number(existing.standard_revision) !== assessment.standardRevision ||
              Number(existing.placement_revision) !== assessment.placementRevision ||
              !['active', 'accepted'].includes(existing.state) ||
              canonicalJson(observed) !== canonicalJson(assessment.checks)) {
            fail('P14_HANDOFF_B_ASSESSMENT_CONFLICT',
              'Acceptance Attempt replay conflicts with immutable evidence.');
          }
          return Object.freeze({ ...assessment, replayed: true });
        }
        repo.invoke('insert_attempt', {
          acceptance_attempt_id: assessment.acceptanceAttemptId,
          offer_id: assessment.offerId,
          on_deck_package_id: assessment.onDeckPackageId,
          package_digest: assessment.packageDigest,
          shelf_id: assessment.shelfId,
          standard_revision: assessment.standardRevision,
          placement_revision: assessment.placementRevision,
          state: 'active',
          created_at_ms: context.commitTimeMs,
          finished_at_ms: null,
        });
        for (const check of assessment.checks) {
          repo.invoke('insert_check', {
            acceptance_attempt_id: assessment.acceptanceAttemptId,
            check_kind: check.kind,
            check_revision: 1,
            result: check.outcome,
            evidence_digest: check.evidenceDigest,
            completed_at_ms: context.commitTimeMs,
          });
        }
        return Object.freeze({ ...assessment, replayed: false });
      },
    }]).arca_acceptance_assessment;
  }

  function readAssessment(acceptanceAttemptId) {
    return options.unitOfWork.execute([{
      participantId: 'arca_acceptance_assessment_read',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const row = repo.invoke('find_attempt', {
          acceptance_attempt_id: acceptanceAttemptId,
        });
        if (!row) return null;
        const checks = repo.invoke('list_checks', {
          acceptance_attempt_id: acceptanceAttemptId,
        }).sort((left, right) =>
          Buffer.compare(Buffer.from(left.check_kind),
            Buffer.from(right.check_kind)))
          .map((item) => Object.freeze({
            kind: item.check_kind,
            outcome: item.result,
            evidenceDigest: item.evidence_digest,
          }));
        const assessment = exactAttempt({
          acceptanceAttemptId,
          offerId: row.offer_id,
          onDeckPackageId: row.on_deck_package_id,
          packageDigest: row.package_digest,
          shelfId: row.shelf_id,
          standardRevision: Number(row.standard_revision),
          placementRevision: Number(row.placement_revision),
          checks,
        });
        if (!['active', 'accepted'].includes(row.state) ||
            (row.state === 'active' && row.finished_at_ms !== null) ||
            (row.state === 'accepted' && row.finished_at_ms === null)) {
          fail('P14_HANDOFF_B_ASSESSMENT_INCOMPLETE',
            'Existing Acceptance Attempt state does not match its completion fence.');
        }
        return Object.freeze({
          ...assessment,
          attemptState: row.state,
        });
      },
    }]).arca_acceptance_assessment_read;
  }

  function accept(request) {
    const assessment = exactAttempt(request.assessment);
    const responsibilityIdentity =
      deriveAcceptedResponsibility(assessment);
    const decisionId = responsibilityIdentity.acceptanceDecisionId;
    const custodyId = responsibilityIdentity.custodyId;
    const onDeckRunId = responsibilityIdentity.onDeckRunId;
    const finalInventoryDecision = request.finalInventoryDecision;
    const finalInventoryBasis = {
      schema: 'arca.final-inventory-decision@1',
      ...Object.fromEntries(Object.entries(finalInventoryDecision || {})
        .filter(([name]) =>
          !['digest', 'decisionDigest'].includes(name))),
      targetEndpointId: request.shelf?.target?.endpointId,
      targetLocation: request.targetLocation,
      productManifestDigest:
        request.package?.productMaterialManifest?.manifestDigest,
      offloadContextDigest:
        request.package?.offloadContextManifest?.manifestDigest,
    };
    if (!finalInventoryDecision ||
        request.onDeckRunId !== onDeckRunId ||
        finalInventoryDecision.onDeckRunId !== onDeckRunId ||
        finalInventoryDecision.shelfId !== assessment.shelfId ||
        finalInventoryDecision.placementRevision !==
          assessment.placementRevision ||
        finalInventoryDecision.decisionDigest !==
          canonicalDigest(finalInventoryBasis) ||
        finalInventoryDecision.digest !==
          finalInventoryDecision.decisionDigest) {
      fail('P14_HANDOFF_B_ONDECK_RESPONSIBILITY',
        'Accepted Handoff B requires its exact immutable Final Inventory Decision and On-deck Run identity.');
    }
    const productMembers = new Map(
      (request.package?.productMaterialManifest?.members || [])
        .map((member) => [member.materialKey, member]),
    );
    const series =
      request.package?.productStructureSnapshot?.structureKind === 'season';
    const bindings = request.bindings.map((item) => {
      const physicalIdentity=item.physicalIdentity;
      if(!physicalIdentity||physicalIdentity.schemaRef!=='helix://contracts/types/PhysicalMaterialIdentity/v2'||
          physicalIdentity.schemaVersion!==2||physicalIdentity.materialKey!==item.materialKey||
          canonicalDigest({schema:'physical-material-identity@2',mountScopeId:physicalIdentity.mountScopeId,
            inode:physicalIdentity.inode,sizeBytes:physicalIdentity.sizeBytes,
            fingerprintAlgorithm:physicalIdentity.fingerprintAlgorithm,fingerprintVersion:physicalIdentity.fingerprintVersion,
            contentFingerprint:physicalIdentity.contentFingerprint})!==item.materialKey)
        fail('P14_HANDOFF_B_BINDING_IDENTITY','Handoff B Binding lost its exact Physical Material Identity.');
      const episodeClaims = buildArcaMaterialEpisodeClaims(
        item.episodeClaims,
        {
          requireNonEmpty: series && item.role === 'product:primary_payload',
          requireEmpty: item.role !== 'product:primary_payload' || !series,
        },
      );
      const source = productMembers.get(item.materialKey);
      if (item.role.startsWith('product:') &&
          (!source || item.role !== 'product:' + source.role ||
           canonicalJson(episodeClaims.items) !==
             canonicalJson(source.episodeClaims || []) ||
           episodeClaims.episodeClaimSetDigest !==
             source.episodeClaimSetDigest)) {
        fail('P14_HANDOFF_B_EPISODE_CLAIMS',
          'Handoff B Binding Episode Claims do not match the Product member.');
      }
      const binding = {
        ...item,
        episodeClaims,
        bindingRevision: 1,
      };
      return Object.freeze({
        ...binding,
        evidenceDigest: canonicalDigest({
          schema: 'arca.handoff-b-material-binding@1',
          custodyId,
          materialKey: binding.materialKey,
          role: binding.role,
          physicalIdentity:binding.physicalIdentity,
          episodeClaims,
          endpointId: binding.endpointId,
          location: binding.location,
        }),
      });
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)) ||
      Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)));
    const arcaBindingSetDigest = canonicalDigest({
      schema: 'arca.handoff-b-binding-set@1',
      custodyId,
      items: bindings,
    });
    const transferChanges = request.controlTransfers.map((item) =>
      Object.freeze({
        materialKey: item.materialKey,
        expectedRevision: item.expectedRevision,
        expectedProjectionDigest: item.expectedProjectionDigest,
        fromScope: item.fromScope,
        toScope: Object.freeze({
          ownerDomain: 'arca',
          scopeType: 'on_deck_custody',
          scopeId: custodyId,
        }),
      })).sort((left, right) =>
      Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
    const controlScopeDigest = canonicalDigest({
      schema: 'arca.handoff-b-control-scope@1',
      acceptanceDecisionId: decisionId,
      custodyId,
      items: transferChanges,
    });
    const decisionBase = {
      schemaRef: 'helix://contracts/domain-types/ArcaAcceptanceDecision/v1',
      schemaVersion: 1,
      acceptanceDecisionId: decisionId,
      acceptanceAttemptId: assessment.acceptanceAttemptId,
      result: 'accepted',
      offerId: assessment.offerId,
      onDeckPackageId: assessment.onDeckPackageId,
      packageDigest: assessment.packageDigest,
      shelfId: assessment.shelfId,
      standardRevision: assessment.standardRevision,
      placementRevision: assessment.placementRevision,
      acceptanceEvidenceSetDigest: assessment.acceptanceEvidenceSetDigest,
      arcaBindingSetDigest,
      controlScopeDigest,
    };
    const decision = Object.freeze({
      ...decisionBase,
      decisionDigest: canonicalDigest(decisionBase),
    });
    const markerId = stable('arca.handoff-b-accepted-marker@1', {
      acceptanceDecisionId: decisionId,
      decisionDigest: decision.decisionDigest,
    });
    const resultId = stable('arca.handoff-b-accepted-result@1', {
      acceptanceDecisionId: decisionId,
    });
    const controlHandle = Object.freeze({
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
      schemaVersion: 1,
      handleId: stable('arca.handoff-b-control-handle@1', {
        acceptanceDecisionId: decisionId,
        controlScopeDigest,
      }),
      operationKind: 'transfer',
      ownerDomain: 'arca',
      receivingDomain: 'arca',
      transferPoint: 'handoff_b_accepted',
      processType: 'arca_shelf_acceptance',
      processId: decisionId,
      basisRef: Object.freeze({
        objectType: 'arca_acceptance_decision',
        objectId: decisionId,
        revision: 1,
        digest: decision.decisionDigest,
      }),
      basisDigest: decision.decisionDigest,
      canonicalFactSetDigest: assessment.acceptanceEvidenceSetDigest,
      bindingSetDigest: arcaBindingSetDigest,
      controlScopeDigest,
      expectedControlRevisions: Object.freeze(transferChanges.map((item) =>
        Object.freeze({
          materialKey: item.materialKey,
          revision: item.expectedRevision,
        }))),
      receiptContract: Object.freeze({
        receiptSchemaRef: 'CustodyAndTransferReceipt@1',
        controlRevisionSetSchemaRef: 'arca.handoff-b-transferred-control-set@1',
      }),
      eventFenceDigest: canonicalDigest({
        schema: 'arca.handoff-b-event-fence@1',
        offerId: assessment.offerId,
        acceptanceDecisionId: decisionId,
        packageDigest: assessment.packageDigest,
      }),
    });
    let receipt;
    let message;
    let controlOutputs;
    const replay = {
      participantId: 'arca_handoff_b_replay',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const current = repo.invoke('find_decision', {
          acceptance_decision_id: decisionId,
        });
        if (!current) return;
        const storedReceipt = repo.invoke('find_receipt', {
          acceptance_decision_id: decisionId,
        });
        const custody = repo.invoke('find_custody', { custody_id: custodyId });
        const attempt = repo.invoke('find_attempt', {
          acceptance_attempt_id: assessment.acceptanceAttemptId,
        });
        const run = repo.invoke('find_run', {
          on_deck_run_id: onDeckRunId,
        });
        const storedFinalDecision =
          repo.invoke('find_final_inventory_decision', {
            on_deck_run_id: onDeckRunId,
          });
        if (!storedReceipt || !custody || !attempt || !run ||
            !storedFinalDecision || attempt.state !== 'accepted' ||
            attempt.finished_at_ms === null ||
            run.custody_id !== custodyId ||
            run.final_inventory_decision_digest !==
              finalInventoryDecision.decisionDigest ||
            canonicalJson(JSON.parse(storedFinalDecision.decision_json)) !==
              canonicalJson(finalInventoryDecision) ||
            storedFinalDecision.decision_digest !==
              finalInventoryDecision.decisionDigest ||
            current.decision_digest !== decision.decisionDigest ||
            reconstructBindingSetDigest(repo, custodyId) !==
              storedReceipt.arca_binding_set_digest ||
            storedReceipt.receipt_digest !==
              canonicalDigest(without(mapReceipt(storedReceipt), 'receiptDigest'))) {
          fail('P14_HANDOFF_B_REPLAY_CORRUPT',
            'Accepted Handoff B facts cannot reconstruct their typed Receipt.');
        }
        const replayReceipt = mapReceipt(storedReceipt);
        throw new Replay(Object.freeze({
          replayed: true,
          decision,
          custody: Object.freeze({
            custodyId,
            acceptanceDecisionId: decisionId,
            onDeckPackageId: assessment.onDeckPackageId,
            packageDigest: assessment.packageDigest,
            controlScopeDigest,
            state: custody.state,
          }),
          onDeckRunId,
          finalInventoryDecision,
          receipt: replayReceipt,
          acceptedMessage: acceptedMessage(request.offerMessage, decision,
            replayReceipt, request.libraRunId),
        }));
      },
    };
    const attemptTransition = {
      participantId: 'arca_handoff_b_attempt_terminal',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const attempt = repo.invoke('find_attempt', {
          acceptance_attempt_id: assessment.acceptanceAttemptId,
        });
        const checks = repo.invoke('list_checks', {
          acceptance_attempt_id: assessment.acceptanceAttemptId,
        }).sort((left, right) =>
          Buffer.compare(Buffer.from(left.check_kind),
            Buffer.from(right.check_kind)));
        const observedChecks = checks.map((item) => ({
          kind: item.check_kind,
          outcome: item.result,
          evidenceDigest: item.evidence_digest,
        }));
        const shelf = repo.invoke('find_shelf', {
          shelf_id: assessment.shelfId,
        });
        const standard = repo.invoke('find_standard', {
          shelf_id: assessment.shelfId,
          revision: assessment.standardRevision,
        });
        const placement = repo.invoke('find_placement', {
          shelf_id: assessment.shelfId,
          revision: assessment.placementRevision,
        });
        if (!attempt || attempt.state !== 'active' ||
            attempt.finished_at_ms !== null ||
            attempt.offer_id !== assessment.offerId ||
            attempt.on_deck_package_id !== assessment.onDeckPackageId ||
            attempt.package_digest !== assessment.packageDigest ||
            attempt.shelf_id !== assessment.shelfId ||
            Number(attempt.standard_revision) !==
              assessment.standardRevision ||
            Number(attempt.placement_revision) !==
              assessment.placementRevision ||
            canonicalJson(observedChecks) !==
              canonicalJson(assessment.checks) ||
            checks.some((item) => item.result !== 'passed') ||
            !shelf || shelf.status !== 'active' ||
            Number(shelf.current_standard_revision) !==
              assessment.standardRevision ||
            Number(shelf.current_placement_revision) !==
              assessment.placementRevision ||
            shelf.target_endpoint_id !== request.shelf.target.endpointId ||
            shelf.target_root_location !== request.shelf.target.rootLocation ||
            shelf.target_mount_scope_id !==
              request.shelf.target.mountScopeId ||
            Number(shelf.target_mount_scope_revision) !==
              request.shelf.target.mountScopeRevision ||
            !standard || !placement) {
          fail('P14_HANDOFF_B_TRANSFER_POINT_FENCE',
            'Handoff B responsibility transfer point is stale.');
        }
        const changed = repo.invoke('advance_attempt', {
          state: 'accepted',
          finished_at_ms: context.commitTimeMs,
          acceptance_attempt_id: assessment.acceptanceAttemptId,
          expected_state: 'active',
          expected_offer_id: assessment.offerId,
          expected_on_deck_package_id: assessment.onDeckPackageId,
          expected_package_digest: assessment.packageDigest,
          expected_shelf_id: assessment.shelfId,
          expected_standard_revision: assessment.standardRevision,
          expected_placement_revision: assessment.placementRevision,
        });
        if (changed.changes !== 1) {
          fail('P14_HANDOFF_B_ATTEMPT_CAS',
            'Acceptance Attempt lost its active terminal CAS.');
        }
        if (typeof options.afterAttemptAcceptedCas === 'function') {
          options.afterAttemptAcceptedCas(Object.freeze({
            acceptanceAttemptId: assessment.acceptanceAttemptId,
            onDeckRunId,
          }));
        }
      },
    };
    const responsibility = {
      participantId: 'arca_handoff_b_responsibility',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        repo.invoke('insert_decision', {
          acceptance_decision_id: decisionId,
          acceptance_attempt_id: assessment.acceptanceAttemptId,
          result: 'accepted',
          offer_id: assessment.offerId,
          on_deck_package_id: assessment.onDeckPackageId,
          package_digest: assessment.packageDigest,
          shelf_id: assessment.shelfId,
          standard_revision: assessment.standardRevision,
          placement_revision: assessment.placementRevision,
          acceptance_evidence_set_digest:
            assessment.acceptanceEvidenceSetDigest,
          rejection_schema_ref: null,
          rejection_code: null,
          rejection_digest: null,
          decision_digest: decision.decisionDigest,
          decided_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_custody', {
          custody_id: custodyId,
          acceptance_decision_id: decisionId,
          on_deck_package_id: assessment.onDeckPackageId,
          package_digest: assessment.packageDigest,
          control_scope_digest: controlScopeDigest,
          state: 'active',
          accepted_at_ms: context.commitTimeMs,
        });
        for (const item of bindings) {
          repo.invoke('insert_binding', {
            owner_object_type: 'on_deck_custody',
            owner_object_id: custodyId,
            material_key: item.materialKey,
            role: item.role,
            episode_claims_schema_ref: EPISODE_CLAIMS_SCHEMA,
            episode_claims_json: canonicalJson(item.episodeClaims),
            episode_claim_set_digest:
              item.episodeClaims.episodeClaimSetDigest,
            endpoint_id: item.endpointId,
            location: item.location,
            mount_scope_id:item.physicalIdentity.mountScopeId,
            inode:item.physicalIdentity.inode,
            size_bytes:item.physicalIdentity.sizeBytes,
            fingerprint_algorithm:item.physicalIdentity.fingerprintAlgorithm,
            fingerprint_version:item.physicalIdentity.fingerprintVersion,
            content_fingerprint:item.physicalIdentity.contentFingerprint,
            binding_revision: item.bindingRevision,
            health_state: 'active',
            evidence_digest: item.evidenceDigest,
            current: 1,
          });
        }
        repo.invoke('insert_run', {
          on_deck_run_id: onDeckRunId,
          custody_id: custodyId,
          final_inventory_decision_digest:
            finalInventoryDecision.decisionDigest,
          state: 'ready',
          created_at_ms: context.commitTimeMs,
          terminal_at_ms: null,
        });
        repo.invoke('insert_final_inventory_decision', {
          final_inventory_decision_id: finalInventoryDecision.objectId,
          on_deck_run_id: onDeckRunId,
          shelf_id: assessment.shelfId,
          placement_revision: assessment.placementRevision,
          target_endpoint_id: request.shelf.target.endpointId,
          target_location: request.targetLocation,
          product_manifest_digest:
            request.package.productMaterialManifest.manifestDigest,
          offload_context_digest:
            request.package.offloadContextManifest.manifestDigest,
          decision_schema_ref: finalInventoryDecision.schemaRef,
          decision_json: canonicalJson(finalInventoryDecision),
          decision_digest: finalInventoryDecision.decisionDigest,
          decided_at_ms: context.commitTimeMs,
        });
        if (typeof options.afterAcceptedResponsibilityInsert === 'function') {
          options.afterAcceptedResponsibilityInsert(Object.freeze({
            acceptanceAttemptId: assessment.acceptanceAttemptId,
            acceptanceDecisionId: decisionId,
            custodyId,
            onDeckRunId,
          }));
        }
      },
    };
    const rawControl = createMaterialControlExactTransferParticipant({
      schemaManifest: options.schemaManifest,
      handle: controlHandle,
      changes: transferChanges,
      authorizedScopeDigest: controlScopeDigest,
      commitMarker: markerId,
      participantId: 'arca_handoff_b_control',
    });
    const control = Object.freeze({
      ...rawControl,
      execute(context) {
        controlOutputs = rawControl.execute(context);
        if (typeof options.afterHandoffBControlTransfer === 'function') {
          options.afterHandoffBControlTransfer(Object.freeze({
            acceptanceAttemptId: assessment.acceptanceAttemptId,
            acceptanceDecisionId: decisionId,
            custodyId,
            onDeckRunId,
          }));
        }
        return controlOutputs;
      },
    });
    const finishDomain = {
      participantId: 'arca_handoff_b_receipt',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const items = controlOutputs.map((item) => Object.freeze({
          materialKey: item.materialKey,
          committedControlRevision: item.revision,
          committedControlProjectionDigest: item.projection.projectionDigest,
        })).sort((left, right) =>
          Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
        const controlRevisionSetDigest = canonicalDigest({
          schema: 'arca.handoff-b-transferred-control-set@1',
          acceptanceDecisionId: decisionId,
          custodyId,
          controlScopeDigest,
          items,
        });
        const receiptValue = {
          schemaRef: RECEIPT_SCHEMA,
          schemaVersion: 1,
          receiptId: stable('arca.handoff-b-accepted-receipt-id@1', {
            acceptanceDecisionId: decisionId,
          }),
          receiptKind: 'handoff_b_accepted',
          ownerDomain: 'arca',
          scopeType: 'acceptance_decision',
          scopeId: decisionId,
          scopeDigest: assessment.acceptanceEvidenceSetDigest,
          effectReceiptRef: null,
          committedAtMs: context.commitTimeMs,
          acceptanceDecisionId: decisionId,
          custodyId,
          arcaBindingSetDigest,
          controlRevisionSetDigest,
        };
        receipt = Object.freeze({
          ...receiptValue,
          receiptDigest: canonicalDigest(receiptValue),
        });
        message = acceptedMessage(request.offerMessage, decision, receipt,
          request.libraRunId);
        context.repository(arca.repositoryId).invoke('insert_receipt', {
          receipt_id: receipt.receiptId,
          acceptance_decision_id: decisionId,
          outcome: 'accepted',
          offer_id: assessment.offerId,
          custody_id: custodyId,
          on_deck_package_id: assessment.onDeckPackageId,
          package_digest: assessment.packageDigest,
          arca_binding_set_digest: arcaBindingSetDigest,
          control_revision_set_digest: controlRevisionSetDigest,
          rejection_code: null,
          acceptance_evidence_set_digest:
            assessment.acceptanceEvidenceSetDigest,
          rejection_digest: null,
          receipt_digest: receipt.receiptDigest,
          committed_at_ms: context.commitTimeMs,
        });
        if (typeof options.afterHandoffBReceiptInsert === 'function') {
          options.afterHandoffBReceiptInsert(Object.freeze({
            acceptanceAttemptId: assessment.acceptanceAttemptId,
            acceptanceDecisionId: decisionId,
            receiptId: receipt.receiptId,
            onDeckRunId,
          }));
        }
        return receipt;
      },
    };
    const foundationWrite = {
      participantId: 'arca_handoff_b_foundation',
      owner: 'execution-foundation',
      boundBusinessOwner: 'arca',
      repositories: [foundation],
      execute(context) {
        const repo = context.repository(foundation.repositoryId);
        repo.invoke('insert_result', {
          result_id: resultId,
          event_id: null,
          outcome_kind: 'succeeded',
          result_schema_ref: RECEIPT_SCHEMA,
          result_json: canonicalJson(receipt),
          result_digest: receipt.receiptDigest,
          evidence_schema_ref: decision.schemaRef,
          evidence_json: canonicalJson(decision),
          evidence_digest: decision.decisionDigest,
          effect_receipt_id: receipt.receiptId,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_marker', {
          commit_marker: markerId,
          effect_id: null,
          owner_domain: 'arca',
          scope_type: 'acceptance_decision',
          scope_id: decisionId,
          commit_digest: decision.decisionDigest,
          result_id: resultId,
          result_schema_ref: RECEIPT_SCHEMA,
          result_digest: receipt.receiptDigest,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_outbox', {
          message_id: message.messageId,
          producer_domain: 'arca',
          message_kind: message.messageKind,
          aggregate_type: 'acceptance_decision',
          aggregate_id: decisionId,
          aggregate_revision: 1,
          dedup_key: message.dedupKey,
          consumer_set_digest: canonicalDigest(['libra']),
          intended_consumer_count: 1,
          payload_schema_ref: MESSAGE_SCHEMA,
          payload_json: canonicalJson(message),
          payload_digest: outboxPayloadDigest(message),
          state: 'pending',
          available_at_ms: context.commitTimeMs,
          created_at_ms: context.commitTimeMs,
          all_acked_at_ms: null,
        });
        repo.invoke('insert_outbox_delivery', {
          message_id: message.messageId,
          consumer_domain: 'libra',
          state: 'pending',
          attempt_count: 0,
          next_attempt_at_ms: context.commitTimeMs,
          acked_at_ms: null,
        });
        if (typeof options.afterHandoffBOutboxInsert === 'function') {
          options.afterHandoffBOutboxInsert(Object.freeze({
            acceptanceAttemptId: assessment.acceptanceAttemptId,
            acceptanceDecisionId: decisionId,
            messageId: message.messageId,
            onDeckRunId,
          }));
        }
      },
    };
    try {
      options.unitOfWork.execute([
        replay,
        attemptTransition,
        responsibility,
        control,
        finishDomain,
        foundationWrite,
      ]);
      return Object.freeze({
        replayed: false,
        decision,
        custody: Object.freeze({
          custodyId,
          acceptanceDecisionId: decisionId,
          onDeckPackageId: assessment.onDeckPackageId,
          packageDigest: assessment.packageDigest,
          controlScopeDigest,
          state: 'active',
        }),
        onDeckRunId,
        finalInventoryDecision,
        receipt,
        acceptedMessage: message,
      });
    } catch (error) {
      if (error instanceof Replay) return error.result;
      throw error;
    }
  }

  function reject(request) {
    const assessment=exactAttempt(request.assessment),decision=request.decision;
    if (!decision || decision.acceptanceAttemptId!==assessment.acceptanceAttemptId ||
        decision.offerId!==assessment.offerId || decision.onDeckPackageId!==assessment.onDeckPackageId ||
        decision.packageDigest!==assessment.packageDigest || decision.shelfId!==assessment.shelfId ||
        decision.standardRevision!==assessment.standardRevision || decision.placementRevision!==assessment.placementRevision ||
        decision.structuredRejection?.acceptanceEvidenceSetDigest!==assessment.acceptanceEvidenceSetDigest ||
        assessment.checks.every((item)=>item.outcome==='passed') ||
        decision.structuredRejection?.rejectionDigest!==canonicalDigest(without(decision.structuredRejection,'rejectionDigest')) ||
        decision.decisionDigest!==canonicalDigest(without(decision,'decisionDigest'))) {
      fail('P14_HANDOFF_B_REJECTION_CONTRACT','Handoff B Rejection Decision does not match its terminal Assessment.');
    }
    const responsibility=deriveAcceptedResponsibility(assessment);
    if(decision.acceptanceDecisionId!==responsibility.acceptanceDecisionId)fail('P14_HANDOFF_B_REJECTION_ID','Handoff B Rejection Decision identity is invalid.');
    const receiptBase={schemaRef:REJECTION_RECEIPT_SCHEMA,schemaVersion:1,
      receiptId:stable('arca.handoff-b-rejected-receipt-id@1',{acceptanceDecisionId:decision.acceptanceDecisionId}),
      receiptKind:'handoff_b_rejected',ownerDomain:'arca',scopeType:'acceptance_decision',scopeId:decision.acceptanceDecisionId,
      scopeDigest:assessment.acceptanceEvidenceSetDigest,effectReceiptRef:null,committedAtMs:0,
      acceptanceDecisionId:decision.acceptanceDecisionId,handoffKind:'libra_to_arca',offerId:assessment.offerId,
      deliverableId:assessment.onDeckPackageId,rejectionCode:decision.structuredRejection.rejectionCode,
      acceptanceEvidenceSetDigest:assessment.acceptanceEvidenceSetDigest,rejectionDigest:decision.structuredRejection.rejectionDigest};
    const markerId=stable('arca.handoff-b-rejected-marker@1',{acceptanceDecisionId:decision.acceptanceDecisionId}),
      resultId=stable('arca.handoff-b-rejected-result@1',{acceptanceDecisionId:decision.acceptanceDecisionId});
    let receipt,message;
    const replay={participantId:'arca_handoff_b_rejection_replay',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId),
      current=repo.invoke('find_decision',{acceptance_decision_id:decision.acceptanceDecisionId});if(!current)return;
      const stored=repo.invoke('find_receipt',{acceptance_decision_id:decision.acceptanceDecisionId});
      if(!stored||current.result!=='rejected'||current.decision_digest!==decision.decisionDigest||stored.outcome!=='rejected'||
        stored.rejection_digest!==decision.structuredRejection.rejectionDigest)fail('P14_HANDOFF_B_REJECTION_REPLAY_CORRUPT','Rejected Handoff B facts cannot be replayed.');
      const base={...receiptBase,committedAtMs:Number(stored.committed_at_ms)};receipt=Object.freeze({...base,receiptDigest:stored.receipt_digest});
      if(receipt.receiptDigest!==canonicalDigest(without(receipt,'receiptDigest')))fail('P14_HANDOFF_B_REJECTION_REPLAY_CORRUPT','Rejected Receipt digest is corrupt.');
      throw new Replay(Object.freeze({replayed:true,decision,receipt,rejectedMessage:rejectedMessage(request.offerMessage,decision,receipt)}));}};
    const terminal={participantId:'arca_handoff_b_rejection_terminal',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId),
      attempt=repo.invoke('find_attempt',{acceptance_attempt_id:assessment.acceptanceAttemptId}),checks=repo.invoke('list_checks',{acceptance_attempt_id:assessment.acceptanceAttemptId})
        .sort((a,b)=>Buffer.compare(Buffer.from(a.check_kind),Buffer.from(b.check_kind))),shelf=repo.invoke('find_shelf',{shelf_id:assessment.shelfId});
      if(!attempt||attempt.state!=='active'||attempt.finished_at_ms!==null||checks.length!==assessment.checks.length||
        checks.every((item)=>item.result==='passed')||canonicalJson(checks.map((item)=>({kind:item.check_kind,outcome:item.result,evidenceDigest:item.evidence_digest})))!==canonicalJson(assessment.checks)||
        !shelf||shelf.status!=='active'||Number(shelf.current_standard_revision)!==assessment.standardRevision||Number(shelf.current_placement_revision)!==assessment.placementRevision)
        fail('P14_HANDOFF_B_REJECTION_FENCE','Handoff B Rejection lost its active Assessment fence.');
      const changed=repo.invoke('advance_attempt',{state:'rejected',finished_at_ms:context.commitTimeMs,acceptance_attempt_id:assessment.acceptanceAttemptId,
        expected_state:'active',expected_offer_id:assessment.offerId,expected_on_deck_package_id:assessment.onDeckPackageId,expected_package_digest:assessment.packageDigest,
        expected_shelf_id:assessment.shelfId,expected_standard_revision:assessment.standardRevision,expected_placement_revision:assessment.placementRevision});
      if(changed.changes!==1)fail('P14_HANDOFF_B_REJECTION_CAS','Handoff B Rejection lost its terminal Attempt CAS.');}};
    const domain={participantId:'arca_handoff_b_rejection_domain',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId);
      repo.invoke('insert_decision',{acceptance_decision_id:decision.acceptanceDecisionId,acceptance_attempt_id:assessment.acceptanceAttemptId,result:'rejected',offer_id:assessment.offerId,
        on_deck_package_id:assessment.onDeckPackageId,package_digest:assessment.packageDigest,shelf_id:assessment.shelfId,standard_revision:assessment.standardRevision,
        placement_revision:assessment.placementRevision,acceptance_evidence_set_digest:assessment.acceptanceEvidenceSetDigest,
        rejection_schema_ref:'helix://contracts/domain-types/StructuredRejection/v1',rejection_code:decision.structuredRejection.rejectionCode,
        rejection_digest:decision.structuredRejection.rejectionDigest,decision_digest:decision.decisionDigest,decided_at_ms:decision.decidedAtMs});
      const base={...receiptBase,committedAtMs:context.commitTimeMs};receipt=Object.freeze({...base,receiptDigest:canonicalDigest(base)});
      repo.invoke('insert_receipt',{receipt_id:receipt.receiptId,acceptance_decision_id:decision.acceptanceDecisionId,outcome:'rejected',offer_id:assessment.offerId,
        custody_id:null,on_deck_package_id:assessment.onDeckPackageId,package_digest:assessment.packageDigest,arca_binding_set_digest:null,control_revision_set_digest:null,
        rejection_code:receipt.rejectionCode,acceptance_evidence_set_digest:assessment.acceptanceEvidenceSetDigest,rejection_digest:receipt.rejectionDigest,
        receipt_digest:receipt.receiptDigest,committed_at_ms:context.commitTimeMs});message=rejectedMessage(request.offerMessage,decision,receipt);}};
    const foundationWrite={participantId:'arca_handoff_b_rejection_foundation',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId);
      repo.invoke('insert_result',{result_id:resultId,event_id:null,outcome_kind:'succeeded',result_schema_ref:REJECTION_RECEIPT_SCHEMA,result_json:canonicalJson(receipt),
        result_digest:receipt.receiptDigest,evidence_schema_ref:'helix://contracts/domain-types/ArcaAcceptanceRejectionDecision/v1',evidence_json:canonicalJson(decision),
        evidence_digest:decision.decisionDigest,effect_receipt_id:receipt.receiptId,committed_at_ms:context.commitTimeMs});
      repo.invoke('insert_marker',{commit_marker:markerId,effect_id:null,owner_domain:'arca',scope_type:'acceptance_decision',scope_id:decision.acceptanceDecisionId,
        commit_digest:decision.decisionDigest,result_id:resultId,result_schema_ref:REJECTION_RECEIPT_SCHEMA,result_digest:receipt.receiptDigest,committed_at_ms:context.commitTimeMs});
      repo.invoke('insert_outbox',{message_id:message.messageId,producer_domain:'arca',message_kind:message.messageKind,aggregate_type:'acceptance_decision',
        aggregate_id:decision.acceptanceDecisionId,aggregate_revision:1,dedup_key:message.dedupKey,consumer_set_digest:canonicalDigest(['libra']),
        intended_consumer_count:1,payload_schema_ref:REJECTION_MESSAGE_SCHEMA,payload_json:canonicalJson(message),payload_digest:canonicalDigest(message),state:'pending',
        available_at_ms:context.commitTimeMs,created_at_ms:context.commitTimeMs,all_acked_at_ms:null});
      repo.invoke('insert_outbox_delivery',{message_id:message.messageId,consumer_domain:'libra',state:'pending',attempt_count:0,next_attempt_at_ms:context.commitTimeMs,acked_at_ms:null});}};
    try{options.unitOfWork.execute([replay,terminal,domain,foundationWrite]);return Object.freeze({replayed:false,decision,receipt,rejectedMessage:message});}
    catch(error){if(error instanceof Replay)return error.result;throw error;}
  }

  function offerDeliveryParticipant(value) {
    return Object.freeze({
      participantId: 'arca_offer_delivery_receipt',
      owner: 'arca',
      repositories: Object.freeze([arca]),
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const decision = repo.invoke('find_decision', {
          acceptance_decision_id: value.acceptanceDecisionId,
        });
        const receipt = repo.invoke('find_receipt', {
          acceptance_decision_id: value.acceptanceDecisionId,
        });
        if (!decision || !receipt ||
            decision.offer_id !== value.offerId ||
            receipt.receipt_digest !== value.receiptDigest) {
          fail('P14_HANDOFF_B_DELIVERY_RECEIPT_FENCE',
            'Offer delivery acknowledgement cannot resolve its Arca acceptance facts.');
        }
        return Object.freeze({
          offerId: value.offerId,
          receiptDigest: value.receiptDigest,
        });
      },
    });
  }

  function readAccepted(request) {
    const responsibility = deriveAcceptedResponsibility({
      acceptanceAttemptId: request.acceptanceAttemptId,
      onDeckPackageId: request.offerMessage.onDeckPackageId,
      packageDigest: request.offerMessage.packageDigest,
    });
    const decisionId = responsibility.acceptanceDecisionId;
    return options.unitOfWork.execute([{
      participantId: 'arca_handoff_b_accepted_read',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const row = repo.invoke('find_decision', {
          acceptance_decision_id: decisionId,
        });
        if (!row) return null;
        const receiptRow = repo.invoke('find_receipt', {
          acceptance_decision_id: decisionId,
        });
        if (!receiptRow) {
          fail('P14_HANDOFF_B_REPLAY_CORRUPT',
            'Accepted Decision has no Handoff B Receipt.');
        }
        const receipt = mapReceipt(receiptRow);
        const custody = repo.invoke('find_custody', {
          custody_id: receipt.custodyId,
        });
        const attempt = repo.invoke('find_attempt', {
          acceptance_attempt_id: request.acceptanceAttemptId,
        });
        const run = repo.invoke('find_run', {
          on_deck_run_id: responsibility.onDeckRunId,
        });
        const finalDecision = repo.invoke('find_final_inventory_decision', {
          on_deck_run_id: responsibility.onDeckRunId,
        });
        let persistedFinalInventoryDecision = null;
        try {
          persistedFinalInventoryDecision = finalDecision &&
            Object.freeze(JSON.parse(finalDecision.decision_json));
        } catch {
          fail('P14_HANDOFF_B_REPLAY_CORRUPT',
            'Accepted Final Inventory Decision JSON is corrupt.');
        }
        const expectedFinalInventoryDecision =
          request.finalInventoryDecision || persistedFinalInventoryDecision;
        const expectedOnDeckRunId = request.onDeckRunId ||
          responsibility.onDeckRunId;
        const decisionBase = {
          schemaRef:
            'helix://contracts/domain-types/ArcaAcceptanceDecision/v1',
          schemaVersion: 1,
          acceptanceDecisionId: decisionId,
          acceptanceAttemptId: request.acceptanceAttemptId,
          result: 'accepted',
          offerId: row.offer_id,
          onDeckPackageId: row.on_deck_package_id,
          packageDigest: row.package_digest,
          shelfId: row.shelf_id,
          standardRevision: Number(row.standard_revision),
          placementRevision: Number(row.placement_revision),
          acceptanceEvidenceSetDigest:
            row.acceptance_evidence_set_digest,
          arcaBindingSetDigest: receipt.arcaBindingSetDigest,
          controlScopeDigest: custody?.control_scope_digest,
        };
        const decision = Object.freeze({
          ...decisionBase,
          decisionDigest: canonicalDigest(decisionBase),
        });
        if (!custody || !attempt || !run || !finalDecision ||
            attempt.state !== 'accepted' ||
            attempt.finished_at_ms === null ||
            run.custody_id !== custody.custody_id ||
            run.final_inventory_decision_digest !==
              finalDecision.decision_digest ||
            canonicalJson(persistedFinalInventoryDecision) !==
              canonicalJson(expectedFinalInventoryDecision) ||
            finalDecision.decision_digest !==
              expectedFinalInventoryDecision.decisionDigest ||
            responsibility.onDeckRunId !== expectedOnDeckRunId ||
            row.result !== 'accepted' ||
            row.offer_id !== request.offerMessage.offerId ||
            row.on_deck_package_id !==
              request.offerMessage.onDeckPackageId ||
            row.package_digest !== request.offerMessage.packageDigest ||
            row.decision_digest !== decision.decisionDigest ||
            reconstructBindingSetDigest(repo, custody.custody_id) !==
              receipt.arcaBindingSetDigest ||
            receipt.receiptDigest !==
              canonicalDigest(without(receipt, 'receiptDigest'))) {
          fail('P14_HANDOFF_B_REPLAY_CORRUPT',
            'Accepted Handoff B cannot be reconstructed from Arca rows.');
        }
        return Object.freeze({
          replayed: true,
          decision,
          custody: Object.freeze({
            custodyId: custody.custody_id,
            acceptanceDecisionId: decisionId,
            onDeckPackageId: custody.on_deck_package_id,
            packageDigest: custody.package_digest,
            controlScopeDigest: custody.control_scope_digest,
            state: custody.state,
          }),
          onDeckRunId: responsibility.onDeckRunId,
          finalInventoryDecision: expectedFinalInventoryDecision,
          receipt,
          acceptedMessage: acceptedMessage(
            request.offerMessage,
            decision,
            receipt,
            request.libraRunId,
          ),
        });
      },
    }]).arca_handoff_b_accepted_read;
  }

  function readRunResponsibility(onDeckRunId) {
    return options.unitOfWork.execute([{
      participantId: 'arca_handoff_b_run_responsibility_read',
      owner: 'arca', repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const run = repo.invoke('find_run', { on_deck_run_id: onDeckRunId });
        if (!run) return null;
        const custody = repo.invoke('find_custody', { custody_id: run.custody_id });
        if (!custody) fail('P14_HANDOFF_B_RUN_HISTORY', 'On-deck Run lost its accepted Custody.');
        const decision = repo.invoke('find_decision_by_id', {
          acceptance_decision_id: custody.acceptance_decision_id,
        });
        if (!decision || decision.result !== 'accepted') {
          fail('P14_HANDOFF_B_RUN_HISTORY', 'On-deck Run lost its accepted Decision.');
        }
        const attempt = repo.invoke('find_attempt', {
          acceptance_attempt_id: decision.acceptance_attempt_id,
        });
        const finalRow = repo.invoke('find_final_inventory_decision', {
          on_deck_run_id: onDeckRunId,
        });
        if (!attempt || !finalRow) {
          fail('P14_HANDOFF_B_RUN_HISTORY', 'On-deck Run responsibility facts are incomplete.');
        }
        let finalInventoryDecision;
        try { finalInventoryDecision = JSON.parse(finalRow.decision_json); }
        catch { fail('P14_FINAL_INVENTORY_DECISION_CORRUPT', 'Final Inventory Decision JSON is corrupt.'); }
        return Object.freeze({
          onDeckRunId,
          custodyId: custody.custody_id,
          acceptanceDecisionId: decision.acceptance_decision_id,
          acceptanceAttemptId: decision.acceptance_attempt_id,
          offerId: decision.offer_id,
          onDeckPackageId: decision.on_deck_package_id,
          packageDigest: decision.package_digest,
          shelfId: decision.shelf_id,
          standardRevision: Number(decision.standard_revision),
          placementRevision: Number(decision.placement_revision),
          finalInventoryDecision: Object.freeze(finalInventoryDecision),
          runState: run.state,
        });
      },
    }]).arca_handoff_b_run_responsibility_read;
  }

  return Object.freeze({
    deriveAcceptedResponsibility: (assessment) =>
      deriveAcceptedResponsibility(exactAttempt(assessment)),
    recordAssessment,
    readAssessment,
    accept,
    reject,
    readAccepted,
    readRunResponsibility,
    offerDeliveryParticipant,
  });
}

function rejectedMessage(offer, decision, receipt) {
  const dedupKey='arca_product_rejected:'+offer.offerId,messageId=stable('foundation.outbox-message-id@1',{producerDomain:'arca',dedupKey});
  return Object.freeze({schemaRef:REJECTION_MESSAGE_SCHEMA,schemaVersion:1,messageKind:'arca_product_rejected',messageId,dedupKey,
    offerId:offer.offerId,onDeckPackageId:offer.onDeckPackageId,packageDigest:offer.packageDigest,acceptanceAttemptId:decision.acceptanceAttemptId,
    acceptanceDecisionId:decision.acceptanceDecisionId,decisionDigest:decision.decisionDigest,rejectionCode:decision.structuredRejection.rejectionCode,
    acceptanceEvidenceSetDigest:decision.structuredRejection.acceptanceEvidenceSetDigest,rejectionDigest:decision.structuredRejection.rejectionDigest,
    receiptId:receipt.receiptId,receiptDigest:receipt.receiptDigest});
}

function acceptedMessage(offer, decision, receipt, libraRunId) {
  const messageId = stable('arca.product-accepted-message-id@1', {
    offerId: offer.offerId,
    acceptanceDecisionId: decision.acceptanceDecisionId,
    receiptDigest: receipt.receiptDigest,
  });
  return Object.freeze({
    messageKind: 'arca.product.accepted@1',
    messageId,
    offerId: offer.offerId,
    onDeckPackageId: offer.onDeckPackageId,
    packageDigest: offer.packageDigest,
    libraRunId,
    acceptanceDecisionId: decision.acceptanceDecisionId,
    acceptanceDecisionDigest: decision.decisionDigest,
    handoffReceipt: Object.freeze({
      receiptId: receipt.receiptId,
      custodyId: receipt.custodyId,
      arcaBindingSetDigest: receipt.arcaBindingSetDigest,
      controlRevisionSetDigest: receipt.controlRevisionSetDigest,
      receiptDigest: receipt.receiptDigest,
    }),
    dedupKey: messageId,
  });
}

module.exports = Object.freeze({
  HandoffBAcceptanceStoreError,
  createHandoffBAcceptanceStore,
  deriveAcceptedResponsibility,
});
