'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createInboxCoordinator } = require('../../../foundation/persistence/outbox-inbox');
const { createSubjectContinuityResolver } = require('./subject-continuity-resolver');
const { createLibraIntakeStore } = require('../persistence/libra-intake-store');
const { createIntakeAcceptanceStore } = require('../persistence/intake-acceptance-store');
const {
  buildAcceptedIntakePayload,
  buildLibraBindingDraft,
} = require('../model/intake-acceptance-contracts');

class IntakeAcceptanceCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntakeAcceptanceCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntakeAcceptanceCoordinatorError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function candidateDeliveryQuery(offer) {
  const value = {
    queryContract: 'procurement.candidate-delivery@1', offerId: offer.offerId,
    candidatePackageId: offer.candidatePackageId, packageRevision: offer.packageRevision,
    packageDigest: offer.packageDigest, acceptanceBasisDigest: offer.acceptanceBasisDigest,
    queryDigest: '',
  };
  value.queryDigest = canonicalDigest(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'queryDigest'),
  ));
  return Object.freeze(value);
}

function candidateOfferEnvelope(offer) {
  if (!offer || offer.schemaRef !== 'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1' ||
      offer.schemaVersion !== 1 || offer.messageKind !== 'procurement_candidate_offer_available' ||
      offer.acceptanceOwnerDomain !== 'libra' || offer.targetContext !== 'libra_intake' ||
      typeof offer.offerId !== 'string' || !offer.offerId || typeof offer.candidatePackageId !== 'string' ||
      !offer.candidatePackageId || !Number.isSafeInteger(offer.packageRevision) || offer.packageRevision < 1 ||
      typeof offer.packageDigest !== 'string' || !/^[0-9a-f]{64}$/.test(offer.packageDigest) ||
      typeof offer.acceptanceBasisDigest !== 'string' || !/^[0-9a-f]{64}$/.test(offer.acceptanceBasisDigest)) {
    fail('P14_INTAKE_OFFER_MESSAGE_INVALID', 'Candidate Offer message is not a closed Handoff A input.');
  }
  const dedupKey = 'procurement_candidate_offer_available:' + offer.offerId;
  return Object.freeze({
    messageId: canonicalDigest({ schema: 'foundation.outbox-message-id@1', producerDomain: 'procurement', dedupKey }),
    dedupKey,
  });
}

function claimFromRow(row) {
  return Object.freeze({
    claimKind: row.claim_kind,
    claimNamespace: row.claim_namespace,
    claimKey: row.claim_key,
    claimDigest: row.claim_digest,
    provenanceKind: row.provenance_kind,
    provenanceRef: row.provenance_ref,
  });
}

function subjectSnapshot(store, subjectId) {
  const subject = store.getSubject(subjectId);
  if (!subject) return null;
  return Object.freeze({
    subjectId: subject.subject_id,
    status: subject.status,
    intakeRevision: Number(subject.intake_revision),
    continuitySetDigest: subject.current_continuity_set_digest,
    episodeScopeDigest: subject.current_episode_scope_digest,
    continuityClaims: Object.freeze(store.listSubjectClaims(subjectId).map(claimFromRow)),
    episodeKeys: Object.freeze(store.listSubjectEpisodes(subjectId)
      .map((row) => row.episode_key)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))),
  });
}

function exactCandidateVerification(snapshot) {
  return Object.freeze({
    result: 'passed',
    reasonCodes: Object.freeze([]),
    offerId: snapshot.offer.offerId,
    candidatePackageId: snapshot.candidatePackage.candidatePackageId,
    packageRevision: snapshot.candidatePackage.packageRevision,
    packageDigest: snapshot.candidatePackage.packageDigest,
    acceptanceBasisDigest: snapshot.acceptanceBasis.acceptanceBasisDigest,
    primaryInputManifestDigest: snapshot.primaryInputManifest.manifestDigest,
    candidateDeliverySnapshotDigest: snapshot.deliverySnapshotDigest,
  });
}

function exactMaterialVerification(snapshot) {
  return Object.freeze({
    result: 'passed',
    reasonCodes: Object.freeze([]),
    candidatePackageId: snapshot.candidatePackage.candidatePackageId,
    packageDigest: snapshot.candidatePackage.packageDigest,
    candidateDeliverySnapshotDigest: snapshot.deliverySnapshotDigest,
  });
}

function controlHandle(payload, decision) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
    schemaVersion: 1,
    handleId: stableId('libra-handoff-a-control-', {
      intakeDecisionId: decision.decisionId,
      payloadDigest: payload.payloadDigest,
    }),
    operationKind: 'transfer',
    ownerDomain: 'libra',
    receivingDomain: 'libra',
    transferPoint: 'handoff_a_accepted',
    processType: 'libra_intake',
    processId: decision.decisionId,
    basisRef: Object.freeze({
      objectType: 'accepted_intake_payload',
      objectId: decision.decisionId,
      revision: 1,
      digest: payload.payloadDigest,
    }),
    basisDigest: payload.payloadDigest,
    canonicalFactSetDigest: decision.decisionDigest,
    bindingSetDigest: payload.bindingDraft.bindingSetDigest,
    controlScopeDigest: payload.controlTransferScope.controlScopeDigest,
    expectedControlRevisions: Object.freeze(payload.controlTransferScope.items.map((item) =>
      Object.freeze({ materialKey: item.materialKey, revision: item.expectedControlRevision }))),
    receiptContract: Object.freeze({
      receiptSchemaRef: 'SubjectAndTransferReceipt@1',
      controlRevisionSetSchemaRef: 'libra.handoff-a-transferred-control-set@1',
    }),
    eventFenceDigest: canonicalDigest({
      schema: 'libra.handoff-a-intake-event-fence@1',
      intakeDecisionId: decision.decisionId,
      payloadDigest: payload.payloadDigest,
    }),
  });
}

function createIntakeAcceptanceCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.candidateDeliveryPort ||
      typeof options.candidateDeliveryPort.readSnapshot !== 'function') {
    fail('P14_INTAKE_COORDINATOR_DEPENDENCIES',
      'Libra Intake requires its Owner persistence and the formal Candidate Delivery Port.');
  }
  const intake = createLibraIntakeStore(options);
  const acceptance = createIntakeAcceptanceStore(options);
  const inbox = createInboxCoordinator(options);

  function resolvedMatches(snapshot) {
    const ids = new Set();
    for (const claim of snapshot.candidatePackage.seasonContinuityClaims) {
      for (const match of intake.findActiveContinuityMatches(claim)) ids.add(match.subject_id);
    }
    return Object.freeze([...ids]
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((subjectId) => subjectSnapshot(intake, subjectId))
      .filter(Boolean));
  }

  function offerCandidate(offer) {
    const envelope = candidateOfferEnvelope(offer);
    const delivery = options.candidateDeliveryPort.readSnapshot(candidateDeliveryQuery(offer));
    if (!delivery || delivery.resultKind !== 'found' || !delivery.snapshot) {
      fail('P14_INTAKE_DELIVERY_UNAVAILABLE',
        'Candidate Delivery Port did not return the immutable Offer Snapshot.');
    }
    const snapshot = delivery.snapshot;
    if (snapshot.offer.offerId !== offer.offerId ||
        snapshot.offer.candidatePackageId !== offer.candidatePackageId ||
        snapshot.offer.packageRevision !== offer.packageRevision ||
        snapshot.offer.packageDigest !== offer.packageDigest ||
        snapshot.offer.acceptanceBasisDigest !== offer.acceptanceBasisDigest) {
      fail('P14_INTAKE_OFFER_SNAPSHOT_MISMATCH',
        'Candidate Delivery Snapshot does not conserve the offered immutable identity.');
    }
    const head = intake.ensureContinuityHead();
    const resolver = createSubjectContinuityResolver({
      allocateDecisionId: () => canonicalDigest({
        schema: 'libra.intake-decision-id@1', offerId: snapshot.offer.offerId,
      }),
      allocateSubjectId: () => stableId('libra-subject-', {
        offerId: snapshot.offer.offerId,
        packageDigest: snapshot.candidatePackage.packageDigest,
      }),
    });
    const decision = resolver.resolve({
      snapshot,
      expectedContinuityHead: Object.freeze({
        revision: Number(head.current_revision),
        digest: head.head_digest,
      }),
      matchedSubjects: resolvedMatches(snapshot),
    });
    const candidateVerification = exactCandidateVerification(snapshot);
    const materialVerification = exactMaterialVerification(snapshot);
    // Transaction commit time records acceptance. Wall-clock time must not perturb
    // the immutable Offer-derived binding draft during retry or restart replay.
    const bindingDraft = buildLibraBindingDraft(snapshot, decision, 0);
    const payload = buildAcceptedIntakePayload({
      snapshot,
      decision,
      bindingDraft,
      candidateVerification,
      materialVerification,
    });
    const marker = stableId('libra-handoff-a-marker-', {
      intakeDecisionId: decision.decisionId,
      payloadDigest: payload.payloadDigest,
    });
    const accepted = acceptance.accept({
      deliverySnapshot: snapshot,
      payload,
      responsibilityControlCommitHandle: controlHandle(payload, decision),
      commitMarker: Object.freeze({
        commitMarker: marker,
        commitDigest: canonicalDigest({
          schema: 'libra.handoff-a-accepted-commit@1',
          intakeDecisionId: decision.decisionId,
          payloadDigest: payload.payloadDigest,
        }),
      }),
      resultBinding: Object.freeze({
        resultId: stableId('libra-handoff-a-result-', {
          intakeDecisionId: decision.decisionId,
          payloadDigest: payload.payloadDigest,
        }),
        eventId: null,
      }),
    });
    const acceptedMessage = accepted.outbox?.message || Object.freeze({
      schemaRef: 'helix://contracts/types/LibraCandidateAcceptedMessage/v1',
      schemaVersion: 1,
      messageKind: 'libra_candidate_accepted',
      offerId: accepted.receipt.offerId,
      candidatePackageId: accepted.receipt.candidatePackageId,
      packageRevision: accepted.receipt.packageRevision,
      packageDigest: accepted.receipt.packageDigest,
      intakeDecisionId: accepted.receipt.intakeDecisionId,
      subjectId: accepted.receipt.subjectId,
      subjectIntakeRevision: accepted.receipt.subjectIntakeRevision,
      receiptId: accepted.receipt.receiptId,
      receiptDigest: accepted.receipt.receiptDigest,
    });
    // Handoff A business facts commit before the transport acknowledgement. If the
    // process stops between them, exact Offer replay re-enters this idempotent
    // Foundation-only step without re-running Libra's acceptance transaction.
    const consumed = inbox.consume({
      message: Object.freeze({
        messageId: envelope.messageId,
        dedupKey: envelope.dedupKey,
        consumerDomain: 'libra',
      }),
      resultDigest: accepted.receipt.receiptDigest,
      domainParticipant: Object.freeze({
        participantId: 'libra_offer_delivery_receipt', owner: 'libra',
        repositories: Object.freeze([intake.repositories.subjects]),
        execute: () => Object.freeze({ offerId: offer.offerId, receiptDigest: accepted.receipt.receiptDigest }),
      }),
    });
    const acknowledgement = inbox.acknowledge({ messageId: envelope.messageId, consumerDomain: 'libra' });
    return Object.freeze({
      replayed: accepted.replayed,
      decision,
      receipt: accepted.receipt,
      acceptedMessage,
      offerDelivery: Object.freeze({ replayed: consumed.replayed, acknowledgement }),
    });
  }

  function resumeAcceptedOffer(offer) {
    candidateOfferEnvelope(offer);
    const decision = intake.getOfferDecision(offer.offerId);
    const receipt = decision && intake.getReceipt(decision.intake_decision_id);
    if (!decision || !receipt || receipt.outcome !== 'accepted' ||
        decision.candidate_package_id !== offer.candidatePackageId ||
        Number(decision.package_revision) !== offer.packageRevision ||
        decision.package_digest !== offer.packageDigest ||
        decision.acceptance_basis_digest !== offer.acceptanceBasisDigest ||
        receipt.candidate_package_id !== offer.candidatePackageId ||
        Number(receipt.package_revision) !== offer.packageRevision ||
        receipt.package_digest !== offer.packageDigest ||
        receipt.intake_decision_id !== decision.intake_decision_id ||
        receipt.receipt_digest !== canonicalDigest(Object.fromEntries(
          Object.entries({
            schemaRef: 'helix://contracts/types/SubjectAndTransferReceipt/v1',
            schemaVersion: 1,
            receiptId: receipt.receipt_id,
            receiptKind: 'handoff_a_accepted',
            ownerDomain: 'libra',
            scopeType: 'intake_decision',
            scopeId: receipt.intake_decision_id,
            scopeDigest: receipt.accepted_payload_digest,
            effectReceiptRef: null,
            committedAtMs: Number(receipt.committed_at_ms),
            intakeDecisionId: receipt.intake_decision_id,
            offerId: receipt.offer_id,
            candidatePackageId: receipt.candidate_package_id,
            packageRevision: Number(receipt.package_revision),
            packageDigest: receipt.package_digest,
            candidateDeliverySnapshotDigest: receipt.candidate_delivery_snapshot_digest,
            subjectId: receipt.subject_id,
            subjectIntakeRevision: Number(receipt.subject_intake_revision),
            subjectContinuityHeadRevision: Number(receipt.subject_continuity_head_revision),
            subjectContinuitySetDigest: receipt.subject_continuity_set_digest,
            subjectEpisodeScopeDigest: receipt.subject_episode_scope_digest,
            libraBindingSetDigest: receipt.libra_binding_set_digest,
            controlRevisionSetDigest: receipt.control_revision_set_digest,
          }),
        ))) {
      fail('P14_INTAKE_ACCEPTED_REPLAY_UNAVAILABLE',
        'Accepted Offer does not resolve to one exact Libra Intake Receipt.');
    }
    return Object.freeze({
      replayed: true,
      receipt: Object.freeze({
        receiptId: receipt.receipt_id,
        intakeDecisionId: receipt.intake_decision_id,
        offerId: receipt.offer_id,
        candidatePackageId: receipt.candidate_package_id,
        packageRevision: Number(receipt.package_revision),
        packageDigest: receipt.package_digest,
        subjectId: receipt.subject_id,
        subjectIntakeRevision: Number(receipt.subject_intake_revision),
        receiptDigest: receipt.receipt_digest,
      }),
    });
  }

  return Object.freeze({ offerCandidate, resumeAcceptedOffer });
}

module.exports = Object.freeze({
  IntakeAcceptanceCoordinatorError,
  createIntakeAcceptanceCoordinator,
});
