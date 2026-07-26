'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');
const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');
const { digest } = require('../../../foundation/persistence/ddl-compiler');
const {
  createMaterialControlExactTransferParticipant,
} = require('../../../foundation/persistence/material-control');

const RECEIPT_SCHEMA = 'helix://contracts/types/CustodyAndTransferReceipt/v1';
const MESSAGE_SCHEMA = 'helix://contracts/types/ArcaProductAcceptedMessage/v1';

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
  return digest(JSON.stringify(value, Object.keys(value).sort()));
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
          'acceptance_evidence_set_digest', 'decision_digest', 'decided_at_ms',
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
          'episode_key', 'endpoint_id', 'location', 'binding_revision',
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
          'episode_key', 'endpoint_id', 'location', 'binding_revision',
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
          'acceptance_evidence_set_digest', 'receipt_digest',
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
              existing.state !== 'accepted' ||
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
          state: 'accepted',
          created_at_ms: context.commitTimeMs,
          finished_at_ms: context.commitTimeMs,
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
        if (row.state !== 'accepted' || row.finished_at_ms === null) {
          fail('P14_HANDOFF_B_ASSESSMENT_INCOMPLETE',
            'Existing Acceptance Attempt is not terminal.');
        }
        return assessment;
      },
    }]).arca_acceptance_assessment_read;
  }

  function accept(request) {
    const assessment = exactAttempt(request.assessment);
    const decisionId = stable('arca.acceptance-decision-id@1', {
      acceptanceAttemptId: assessment.acceptanceAttemptId,
    });
    const custodyId = stable('arca.on-deck-material-custody-id@1', {
      acceptanceDecisionId: decisionId,
      onDeckPackageId: assessment.onDeckPackageId,
      packageDigest: assessment.packageDigest,
    });
    const bindings = request.bindings.map((item) => Object.freeze({
      ...item,
      bindingRevision: 1,
      evidenceDigest: canonicalDigest({
        schema: 'arca.handoff-b-material-binding@1',
        custodyId,
        materialKey: item.materialKey,
        role: item.role,
        episodeKey: item.episodeKey,
        endpointId: item.endpointId,
        location: item.location,
      }),
    })).sort((left, right) =>
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
        if (!storedReceipt || !custody ||
            current.decision_digest !== decision.decisionDigest ||
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
          receipt: replayReceipt,
          acceptedMessage: acceptedMessage(request.offerMessage, decision,
            replayReceipt, request.libraRunId),
        }));
      },
    };
    const domain = {
      participantId: 'arca_handoff_b_domain',
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
          acceptance_evidence_set_digest: assessment.acceptanceEvidenceSetDigest,
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
            episode_key: item.episodeKey,
            endpoint_id: item.endpointId,
            location: item.location,
            binding_revision: item.bindingRevision,
            health_state: 'active',
            evidence_digest: item.evidenceDigest,
            current: 1,
          });
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
      },
    };
    try {
      options.unitOfWork.execute([
        replay, domain, control, finishDomain, foundationWrite,
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
        receipt,
        acceptedMessage: message,
      });
    } catch (error) {
      if (error instanceof Replay) return error.result;
      throw error;
    }
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
    const decisionId = stable('arca.acceptance-decision-id@1', {
      acceptanceAttemptId: request.acceptanceAttemptId,
    });
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
        if (!custody || row.result !== 'accepted' ||
            row.offer_id !== request.offerMessage.offerId ||
            row.on_deck_package_id !==
              request.offerMessage.onDeckPackageId ||
            row.package_digest !== request.offerMessage.packageDigest ||
            row.decision_digest !== decision.decisionDigest ||
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

  return Object.freeze({
    recordAssessment,
    readAssessment,
    accept,
    readAccepted,
    offerDeliveryParticipant,
  });
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
});
