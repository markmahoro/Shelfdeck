'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const DECISION_SCHEMA = 'helix://contracts/domain-types/IntakeRejectionDecision/v1';
const RECEIPT_SCHEMA = 'helix://contracts/types/IntakeRejectionReceipt/v1';
const MESSAGE_SCHEMA = 'helix://contracts/types/LibraCandidateRejectedMessage/v1';
const CLOSURE_SCHEMA = 'helix://contracts/types/ProcurementCandidateRejectionClosureResult/v1';
const REJECTION_SCHEMA = 'helix://contracts/domain-types/IntakeRejectionDecision/v1#/properties/structuredRejection';
const REASON_PRECEDENCE = Object.freeze([
  'candidate_contract_invalid',
  'candidate_material_identity_changed',
  'candidate_material_unavailable',
  'candidate_material_unreadable',
  'candidate_control_scope_unavailable'
]);
const EVIDENCE_SCHEMAS = Object.freeze({
  candidate_contract_invalid: new Set(['helix://contracts/types/CandidateContractVerification/v1']),
  candidate_material_identity_changed: new Set(['helix://contracts/types/IntakeMaterialVerification/v1']),
  candidate_material_unavailable: new Set(['helix://contracts/types/IntakeMaterialVerification/v1']),
  candidate_material_unreadable: new Set(['helix://contracts/types/IntakeMaterialVerification/v1']),
  candidate_control_scope_unavailable: new Set(['helix://contracts/types/MaterialControlProjectionSnapshot/v1'])
});

class IntakeRejectionContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'IntakeRejectionContractError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new IntakeRejectionContractError(code, message, details); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')); }
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}
function bounded(value, maximum, code) {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) fail(code, 'Canonical value exceeds its SSOT byte bound.');
}

function normalizeReasons(reasonInputs) {
  if (!Array.isArray(reasonInputs) || reasonInputs.length < 1 || reasonInputs.length > 32) {
    fail('P8_REJECTION_REASON_COUNT', 'A rejection requires between one and 32 closed reasons.');
  }
  const byCode = new Map();
  for (const input of reasonInputs) {
    if (!input || !EVIDENCE_SCHEMAS[input.reasonCode] || !Array.isArray(input.evidenceRefs) ||
        input.evidenceRefs.length < 1 || input.evidenceRefs.length > 32 || byCode.has(input.reasonCode)) {
      fail('P8_REJECTION_REASON_SHAPE', 'Rejection reasons must be unique, closed, and evidence-backed.');
    }
    const seen = new Set();
    const evidenceRefs = input.evidenceRefs.map((item) => {
      if (!item || !EVIDENCE_SCHEMAS[input.reasonCode].has(item.evidenceSchemaRef) ||
          typeof item.evidenceId !== 'string' || !item.evidenceId || !/^[a-f0-9]{64}$/.test(item.evidenceDigest || '')) {
        fail('P8_REJECTION_EVIDENCE', 'Reason Evidence must use the exact SSOT schema and digest.');
      }
      const key = [item.evidenceSchemaRef,item.evidenceId,item.evidenceDigest].join('\0');
      if (seen.has(key)) fail('P8_REJECTION_EVIDENCE_DUPLICATE', 'Reason Evidence must be unique.');
      seen.add(key);
      return { evidenceSchemaRef:item.evidenceSchemaRef, evidenceId:item.evidenceId, evidenceDigest:item.evidenceDigest };
    }).sort((left, right) => compareUtf8([left.evidenceSchemaRef,left.evidenceId,left.evidenceDigest].join('\0'),
      [right.evidenceSchemaRef,right.evidenceId,right.evidenceDigest].join('\0')));
    const reason = { reasonCode:input.reasonCode, evidenceRefs };
    reason.reasonDigest = canonicalDigest({ schema:'handoff-a-rejection-reason@1', reasonCode:reason.reasonCode, evidenceRefs });
    byCode.set(input.reasonCode, reason);
  }
  return REASON_PRECEDENCE.filter((code) => byCode.has(code)).map((code) => byCode.get(code));
}

function buildIntakeRejectionDecision({ deliverySnapshot, reasons:reasonInputs, decidedAtMs }) {
  if (!deliverySnapshot || !Number.isSafeInteger(decidedAtMs) || decidedAtMs < 0 ||
      deliverySnapshot.deliverySnapshotDigest !== canonicalDigest(without(deliverySnapshot, 'deliverySnapshotDigest'))) {
    fail('P8_REJECTION_SNAPSHOT', 'A complete digest-valid Candidate Delivery Snapshot is required.');
  }
  const { offer, acceptanceBasis, candidatePackage } = deliverySnapshot;
  if (!offer || !acceptanceBasis || !candidatePackage ||
      acceptanceBasis.offerId !== undefined && offer.offerId !== acceptanceBasis.offerId ||
      offer.candidatePackageId !== candidatePackage.candidatePackageId || offer.packageRevision !== candidatePackage.packageRevision ||
      offer.packageDigest !== candidatePackage.packageDigest || offer.acceptanceBasisDigest !== acceptanceBasis.acceptanceBasisDigest) {
    fail('P8_REJECTION_DELIVERY_LINK', 'Offer, Acceptance Basis, and Candidate Package do not identify one delivery.');
  }
  const reasons = normalizeReasons(reasonInputs);
  const rejectionReasonSetDigest = canonicalDigest({ schema:'handoff-a-rejection-reason-set@1', items:reasons });
  const rejectionId = canonicalDigest({ schema:'handoff-a-rejection-id@1', offerId:offer.offerId,
    deliverableId:candidatePackage.candidatePackageId, deliverableRevision:candidatePackage.packageRevision,
    deliverableDigest:candidatePackage.packageDigest, decisionBasisDigest:acceptanceBasis.acceptanceBasisDigest,
    rejectionReasonSetDigest });
  const structuredRejection = { rejectionId, handoffKind:'procurement_to_libra', offerId:offer.offerId,
    deliverableId:candidatePackage.candidatePackageId, deliverableRevision:candidatePackage.packageRevision,
    deliverableDigest:candidatePackage.packageDigest, decisionBasisDigest:acceptanceBasis.acceptanceBasisDigest,
    observedSnapshotDigest:deliverySnapshot.deliverySnapshotDigest, reasonCodes:reasons.map((item) => item.reasonCode),
    primaryRejectionCode:reasons[0].reasonCode, reasons, rejectionReasonSetDigest, rejectionDigest:'', decidedAtMs };
  structuredRejection.rejectionDigest = canonicalDigest(without(structuredRejection, 'rejectionDigest'));
  bounded(structuredRejection, 64 * 1024, 'P8_REJECTION_TOO_LARGE');
  const decision = { intakeDecisionId:canonicalDigest({ schema:'libra.intake-decision-id@1', offerId:offer.offerId }),
    decisionRevision:1, offerId:offer.offerId, candidatePackageId:candidatePackage.candidatePackageId,
    packageRevision:candidatePackage.packageRevision, packageDigest:candidatePackage.packageDigest,
    acceptanceBasisDigest:acceptanceBasis.acceptanceBasisDigest,
    candidateDeliverySnapshotDigest:deliverySnapshot.deliverySnapshotDigest, structuredRejection, decisionDigest:'' };
  decision.decisionDigest = canonicalDigest(without(decision, 'decisionDigest'));
  bounded(decision, 128 * 1024, 'P8_REJECTION_DECISION_TOO_LARGE');
  return freeze(decision);
}

function buildIntakeRejectionReceipt(decision, committedAtMs) {
  if (!decision || decision.decisionDigest !== canonicalDigest(without(decision, 'decisionDigest')) ||
      !Number.isSafeInteger(committedAtMs) || committedAtMs < 0) fail('P8_REJECTION_DECISION', 'A digest-valid rejection Decision is required.');
  const rejection = decision.structuredRejection;
  if (!rejection || rejection.rejectionDigest !== canonicalDigest(without(rejection, 'rejectionDigest')) ||
      rejection.offerId !== decision.offerId || rejection.deliverableId !== decision.candidatePackageId ||
      rejection.deliverableRevision !== decision.packageRevision || rejection.deliverableDigest !== decision.packageDigest ||
      rejection.decisionBasisDigest !== decision.acceptanceBasisDigest ||
      rejection.observedSnapshotDigest !== decision.candidateDeliverySnapshotDigest) {
    fail('P8_REJECTION_DECISION_LINK', 'Decision and Structured Rejection links must be complete and digest-valid.');
  }
  const receiptId = canonicalDigest({ schema:'handoff-a-rejection-receipt-id@1', offerId:decision.offerId,
    deliverableId:decision.candidatePackageId, rejectionId:rejection.rejectionId });
  const receipt = { schemaRef:RECEIPT_SCHEMA, schemaVersion:1, receiptId, receiptKind:'handoff_a_rejected', ownerDomain:'libra',
    scopeType:'intake_decision', scopeId:decision.intakeDecisionId, scopeDigest:decision.decisionDigest, effectReceiptRef:null,
    committedAtMs, intakeDecisionId:decision.intakeDecisionId, handoffKind:'procurement_to_libra', offerId:decision.offerId,
    deliverableId:decision.candidatePackageId, deliverableRevision:decision.packageRevision, deliverableDigest:decision.packageDigest,
    rejectionId:rejection.rejectionId, primaryRejectionCode:rejection.primaryRejectionCode,
    rejectionReasonSetDigest:rejection.rejectionReasonSetDigest, rejectionDigest:rejection.rejectionDigest, receiptDigest:'' };
  receipt.receiptDigest = canonicalDigest(without(receipt, 'receiptDigest'));
  bounded(receipt, 64 * 1024, 'P8_REJECTION_RECEIPT_TOO_LARGE');
  return freeze(receipt);
}

function buildLibraCandidateRejectedMessage(decision, receipt) {
  const rejection = decision && decision.structuredRejection;
  if (!rejection || !receipt || decision.decisionDigest !== canonicalDigest(without(decision, 'decisionDigest')) ||
      receipt.receiptDigest !== canonicalDigest(without(receipt, 'receiptDigest')) || receipt.scopeDigest !== decision.decisionDigest ||
      receipt.intakeDecisionId !== decision.intakeDecisionId || receipt.offerId !== decision.offerId ||
      receipt.deliverableId !== decision.candidatePackageId || receipt.deliverableRevision !== decision.packageRevision ||
      receipt.deliverableDigest !== decision.packageDigest || receipt.rejectionId !== rejection.rejectionId ||
      receipt.rejectionReasonSetDigest !== rejection.rejectionReasonSetDigest || receipt.rejectionDigest !== rejection.rejectionDigest) {
    fail('P8_REJECTION_MESSAGE_LINK', 'Rejected message requires one matching Decision and Receipt.');
  }
  const message = { schemaRef:MESSAGE_SCHEMA, schemaVersion:1, messageKind:'libra_candidate_rejected', offerId:decision.offerId,
    candidatePackageId:decision.candidatePackageId, packageRevision:decision.packageRevision, packageDigest:decision.packageDigest,
    acceptanceBasisDigest:decision.acceptanceBasisDigest, intakeDecisionId:decision.intakeDecisionId,
    decisionDigest:decision.decisionDigest, rejectionId:rejection.rejectionId, reasonCodes:[...rejection.reasonCodes],
    primaryRejectionCode:rejection.primaryRejectionCode, rejectionReasonSetDigest:rejection.rejectionReasonSetDigest,
    rejectionDigest:rejection.rejectionDigest, receiptId:receipt.receiptId, receiptDigest:receipt.receiptDigest };
  bounded(message, 16 * 1024, 'P8_REJECTION_MESSAGE_TOO_LARGE');
  return freeze(message);
}

function buildProcurementRejectionClosure(message, materialKeys) {
  if (!message || message.schemaRef !== MESSAGE_SCHEMA || message.schemaVersion !== 1 ||
      message.messageKind !== 'libra_candidate_rejected' || !Array.isArray(materialKeys) || materialKeys.length < 1) {
    fail('P8_REJECTION_CLOSURE_INPUT', 'Closure requires a rejected message and non-empty exact Reservation set.');
  }
  const keys = [...materialKeys].sort(compareUtf8);
  if (new Set(keys).size !== keys.length) fail('P8_REJECTION_CLOSURE_DUPLICATE', 'Closure Material keys must be unique.');
  const items = keys.map((materialKey) => ({ materialKey, terminalDisposition:'handoff_rejected',
    terminalEvidenceDigest:message.receiptDigest }));
  const value = { schemaRef:CLOSURE_SCHEMA, schemaVersion:1, offerId:message.offerId, candidatePackageId:message.candidatePackageId,
    packageRevision:message.packageRevision, packageDigest:message.packageDigest,
    acceptanceBasisDigest:message.acceptanceBasisDigest, terminalDeliveryState:'rejected', releasedMaterialCount:items.length,
    releasedMaterialSetDigest:canonicalDigest({ schema:'procurement.handoff-a-rejected-released-material-set@1', items }),
    rejectionReceiptDigest:message.receiptDigest, closureDigest:'' };
  value.closureDigest = canonicalDigest(without(value, 'closureDigest'));
  return freeze(value);
}

module.exports = Object.freeze({ CLOSURE_SCHEMA, DECISION_SCHEMA, IntakeRejectionContractError, MESSAGE_SCHEMA,
  REASON_PRECEDENCE, RECEIPT_SCHEMA, REJECTION_SCHEMA, buildIntakeRejectionDecision, buildIntakeRejectionReceipt,
  buildLibraCandidateRejectedMessage, buildProcurementRejectionClosure, normalizeReasons });
