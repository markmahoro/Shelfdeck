'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const SCHEMA_REF = 'helix://contracts/application-types/AuthorizedDefectManifest/v1';
const ACTOR_FAILURE = 'product_metadata_required_cast_missing';
const EXTERNAL_FAILURES = new Set([
  'no_available_candidate',
  'no_requirement_eligible_candidate',
  'download_attempt_limit_exhausted',
  'identity_verification_failed',
  'structure_mismatch',
  'episode_coverage_mismatch',
  'package_integrity_failure',
  'no_passed_candidate',
  'external_package_rejected',
  'external_output_rejected',
]);
const EXTERNAL_TERMINAL_CAPABILITIES = new Set([
  'libra.external_material.candidate.select@1',
  'libra.external_material.package.verify@1',
  'libra.product_output.select@1',
]);
const WAIVABLE_MEDIA_CODES = new Set([
  'video_codec_unmet',
  'container_unmet',
  'file_extension_unmet',
  'minimum_raster_unmet',
  'system_upscale_forbidden',
  'primary_audio_unmet',
  'max_size_exceeded',
  'dynamic_range_conversion_unmet',
  'output_color_profile_unmet',
  'dolby_vision_metadata_not_removed',
]);
const DEFECT_CODES = new Set(['actor_unavailable', 'external_source_exhausted']);
const DIGEST = /^[a-f0-9]{64}$/;

class DefectAdmissionContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DefectAdmissionContractError';
    this.code = code;
    this.details = details;
  }
}
function fail(code, message, details) {
  throw new DefectAdmissionContractError(code, message, details);
}
function text(value, field) {
  if (typeof value !== 'string' || !value || value.length > 256) {
    fail('P9_DEFECT_ADMISSION_TEXT', 'A bounded non-empty string is required.', { field });
  }
  return value;
}
function digest(value, field) {
  if (!DIGEST.test(value || '')) {
    fail('P9_DEFECT_ADMISSION_DIGEST', 'A lowercase SHA-256 digest is required.', { field });
  }
  return value;
}
function positive(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('P9_DEFECT_ADMISSION_REVISION', 'A positive revision is required.', { field });
  }
  return value;
}
function ordered(values) {
  return [...new Set(values)].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
function blocker(terminalEvidence) {
  const values = terminalEvidence?.blockedWorks;
  if (!Array.isArray(values) || values.length !== 1) {
    fail('P9_DEFECT_ADMISSION_TERMINAL', 'Defect admission requires one exact terminal blocker.');
  }
  const item = values[0];
  text(item.workId, 'blockedWork.workId');
  text(item.failureCode, 'blockedWork.failureCode');
  digest(item.terminalEvidenceDigest, 'blockedWork.terminalEvidenceDigest');
  return item;
}
function actorDefect(item) {
  if (item.failureCode !== ACTOR_FAILURE ||
      item.capabilityRef !== 'libra.product_metadata.fetch@1' ||
      item.failureClass !== 'business_unachievable') return null;
  return Object.freeze({
    defectCode: 'actor_unavailable',
    sourceFailureCode: item.failureCode,
    sourceWorkId: item.workId,
    sourceEvidenceDigest: item.terminalEvidenceDigest,
    waivedRequirementCodes: Object.freeze(['metadata_field_unmet']),
  });
}
function externalDefect(item, verification, run) {
  if (!EXTERNAL_FAILURES.has(item.failureCode) ||
      !EXTERNAL_TERMINAL_CAPABILITIES.has(item.capabilityRef) ||
      item.failureClass !== 'business_unachievable') return null;
  if (!verification || verification.candidateKind !== 'direct_input' ||
      verification.result !== 'failed' || verification.libraRunId !== run.libraRunId ||
      !Array.isArray(verification.reasonCodes) || !verification.reasonCodes.length) {
    fail('P9_DEFECT_ADMISSION_ORIGINAL_MEDIA',
      'External exhaustion admission requires one failed direct-input verification.');
  }
  const reasons = ordered(verification.reasonCodes);
  if (reasons.some((code) => !WAIVABLE_MEDIA_CODES.has(code))) {
    fail('P9_DEFECT_ADMISSION_NONWAIVABLE',
      'Original media has a non-waivable safety or integrity gap.', { reasonCodes: reasons });
  }
  digest(verification.verificationId, 'verification.verificationId');
  return Object.freeze({
    defectCode: 'external_source_exhausted',
    sourceFailureCode: item.failureCode,
    sourceWorkId: item.workId,
    sourceEvidenceDigest: item.terminalEvidenceDigest,
    originalMediaVerificationId: verification.verificationId,
    originalMediaVerificationDigest: canonicalDigest(verification),
    waivedRequirementCodes: Object.freeze(reasons),
  });
}

function buildDefectAdmissionCandidate(value) {
  const run = value?.run;
  if (!run || run.state !== 'frozen') {
    fail('P9_DEFECT_ADMISSION_STATE', 'Only the current frozen Run can form a defect candidate.');
  }
  const item = blocker(value.terminalEvidence);
  const defect = actorDefect(item) || externalDefect(item, value.directMediaVerification, run);
  if (!defect) {
    fail('P9_DEFECT_ADMISSION_INELIGIBLE',
      'The frozen terminal reason is outside the V1 defect-admission closed set.',
      { failureCode: item.failureCode });
  }
  const prior = value.priorAuthorizedManifest?.defects || [];
  const defects = [...prior, defect]
    .filter((entry, index, items) => items.findIndex((itemValue) =>
      itemValue.defectCode === entry.defectCode) === index)
    .sort((left, right) => Buffer.from(left.defectCode).compare(Buffer.from(right.defectCode)));
  if (!defects.length || defects.length > 2 ||
      defects.some((entry) => !DEFECT_CODES.has(entry.defectCode))) {
    fail('P9_DEFECT_ADMISSION_SCOPE', 'Defect candidate exceeds the V1 closed set.');
  }
  const body = {
    candidateRevision: positive(run.stateRevision, 'run.stateRevision'),
    libraRunId: text(run.libraRunId, 'run.libraRunId'),
    frozenRunStateRevision: run.stateRevision,
    frozenRunStateDigest: digest(run.stateDigest, 'run.stateDigest'),
    terminalEvidenceDigest: digest(value.terminalEvidence.evidenceDigest,
      'terminalEvidence.evidenceDigest'),
    defects: Object.freeze(defects),
    waivedRequirementCodes: Object.freeze(ordered(defects.flatMap((entry) =>
      entry.waivedRequirementCodes))),
  };
  return Object.freeze({ ...body, candidateDigest: canonicalDigest(body) });
}

function buildAuthorizedDefectManifest(value) {
  const candidate = value?.candidate;
  if (!candidate || candidate.candidateDigest !== canonicalDigest(
    Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== 'candidateDigest')))) {
    fail('P9_DEFECT_ADMISSION_CANDIDATE', 'Defect candidate identity is invalid.');
  }
  if (value.acknowledged !== true) {
    fail('P9_DEFECT_ADMISSION_ACKNOWLEDGEMENT',
      'The user must explicitly acknowledge every admitted defect.');
  }
  const actorId = text(value.actorId, 'actorId');
  const idempotencyKey = text(value.idempotencyKey, 'idempotencyKey');
  const decidedAtMs = value.decidedAtMs;
  if (!Number.isSafeInteger(decidedAtMs) || decidedAtMs < 0) {
    fail('P9_DEFECT_ADMISSION_TIME', 'Decision time is invalid.');
  }
  const decisionId = canonicalDigest({
    schema: 'libra.defect-admission-decision-id@1',
    libraRunId: candidate.libraRunId,
    actorId,
    idempotencyKey,
  });
  const body = {
    schemaRef: SCHEMA_REF,
    schemaVersion: 1,
    manifestId: decisionId,
    defectDecisionId: decisionId,
    libraRunId: candidate.libraRunId,
    frozenRunRef: Object.freeze({
      stateRevision: candidate.frozenRunStateRevision,
      stateDigest: candidate.frozenRunStateDigest,
    }),
    candidateRevision: candidate.candidateRevision,
    candidateDigest: candidate.candidateDigest,
    terminalEvidenceDigest: candidate.terminalEvidenceDigest,
    defects: candidate.defects,
    defectCount: candidate.defects.length,
    waivedRequirementCodes: candidate.waivedRequirementCodes,
    actorId,
    acknowledgement: 'accept_listed_defects',
    idempotencyKey,
    decidedAtMs,
  };
  return Object.freeze({ ...body, manifestDigest: canonicalDigest(body) });
}

function assertAuthorizedDefectManifest(value) {
  if (!value || value.schemaRef !== SCHEMA_REF || value.schemaVersion !== 1 ||
      value.manifestId !== value.defectDecisionId ||
      value.manifestDigest !== canonicalDigest(
        Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'manifestDigest')))) {
    fail('P9_DEFECT_ADMISSION_MANIFEST', 'Authorized Defect Manifest is invalid.');
  }
  const rebuilt = buildAuthorizedDefectManifest({
    candidate: Object.freeze({
      candidateRevision: value.candidateRevision,
      libraRunId: value.libraRunId,
      frozenRunStateRevision: value.frozenRunRef?.stateRevision,
      frozenRunStateDigest: value.frozenRunRef?.stateDigest,
      terminalEvidenceDigest: value.terminalEvidenceDigest,
      defects: value.defects,
      waivedRequirementCodes: value.waivedRequirementCodes,
      candidateDigest: value.candidateDigest,
    }),
    actorId: value.actorId,
    idempotencyKey: value.idempotencyKey,
    acknowledged: value.acknowledgement === 'accept_listed_defects',
    decidedAtMs: value.decidedAtMs,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail('P9_DEFECT_ADMISSION_MANIFEST', 'Authorized Defect Manifest is not canonical.');
  }
  return rebuilt;
}

function coversRequirementGaps(manifestValue, unmetRequirementCodes) {
  const manifest = assertAuthorizedDefectManifest(manifestValue);
  return canonicalJson(ordered(unmetRequirementCodes || [])) ===
    canonicalJson(manifest.waivedRequirementCodes);
}

function acceptsProductionAttestation(attestation, expected = null) {
  if (!attestation || !Array.isArray(attestation.unmetRequirementCodes) ||
      canonicalJson(attestation.unmetRequirementCodes) !==
        canonicalJson(ordered(attestation.unmetRequirementCodes)) ||
      attestation.unmetRequirementCount !== attestation.unmetRequirementCodes.length) return false;
  if (expected && (attestation.libraRunId !== expected.libraRunId ||
      attestation.onDeckPackageId !== expected.onDeckPackageId ||
      attestation.acceptanceSpecId !== expected.acceptanceSpecId ||
      attestation.acceptanceSpecRecordDigest !== expected.acceptanceSpecRecordDigest ||
      (attestation.authorizedDefectManifest &&
        attestation.authorizedDefectManifest.libraRunId !== expected.libraRunId))) return false;
  if (attestation.unmetRequirementCount === 0) {
    return attestation.acceptanceKind === 'accepted' &&
      attestation.authorizedDefectManifest === null;
  }
  try {
    return attestation.acceptanceKind === 'accepted_with_defects' &&
      coversRequirementGaps(attestation.authorizedDefectManifest,
        attestation.unmetRequirementCodes);
  } catch { return false; }
}

function actionableAftercareFindings(manifestValue, findings) {
  if (!manifestValue) return Object.freeze([...(findings || [])]);
  const manifest = assertAuthorizedDefectManifest(manifestValue);
  const waived = new Set(manifest.waivedRequirementCodes);
  return Object.freeze((findings || []).filter((finding) => {
    const [dimension, code] = String(finding.findingKind || '').split(':');
    return dimension !== 'conformance' || !waived.has(code);
  }));
}

function resolveProductSelection(results, manifestValue) {
  const selection = (results || []).find((item) =>
    item.capabilityRef === 'libra.product_output.select@1')?.result || null;
  if (selection?.result === 'selected') {
    const verification = (results || []).find((item) =>
      item.capabilityRef === 'libra.product_media.verify@1' &&
      item.result?.verificationId === selection.selectedVerificationId)?.result || null;
    const effectiveSelection = verification ? Object.freeze({
      selectionKind: 'ordinary_selected',
      selectedCandidateKind: selection.selectedCandidateKind,
      selectedHandleId: selection.selectedHandleId,
      selectedWorkspaceMediaHandleId: selection.selectedWorkspaceMediaHandleId,
      selectedVerificationId: selection.selectedVerificationId,
      selectedVerificationDigest: selection.selectedVerificationDigest,
    }) : null;
    return Object.freeze({ selection, effectiveSelection, verification,
      admittedDefect:null });
  }
  if (!manifestValue) return Object.freeze({ selection, effectiveSelection:null,
    verification:null, admittedDefect:null });
  const manifest = assertAuthorizedDefectManifest(manifestValue);
  const defect = manifest.defects.find((item) =>
    item.defectCode === 'external_source_exhausted');
  if (!defect) return Object.freeze({ selection, effectiveSelection:null,
    verification:null, admittedDefect:null });
  const verification = (results || []).find((item) =>
    item.capabilityRef === 'libra.product_media.verify@1' &&
    item.result?.candidateKind === 'direct_input' &&
    item.result?.verificationId === defect.originalMediaVerificationId &&
    canonicalDigest(item.result) === defect.originalMediaVerificationDigest)?.result || null;
  if (!verification || verification.result !== 'failed' ||
      canonicalJson(ordered(verification.reasonCodes || [])) !==
        canonicalJson(ordered(defect.waivedRequirementCodes || []))) {
    fail('P9_DEFECT_ADMISSION_ORIGINAL_MEDIA_STALE',
      'Authorized original-media verification is absent or changed.');
  }
  const effectiveSelection = Object.freeze({
    selectionKind: 'authorized_defect_direct_input',
    selectedCandidateKind: 'direct_input',
    selectedHandleId: verification.productMaterialHandleId,
    selectedWorkspaceMediaHandleId: null,
    selectedVerificationId: verification.verificationId,
    selectedVerificationDigest: canonicalDigest(verification),
  });
  return Object.freeze({ selection, effectiveSelection, verification,
    admittedDefect:defect });
}

module.exports = Object.freeze({
  ACTOR_FAILURE,
  DEFECT_CODES,
  EXTERNAL_FAILURES,
  SCHEMA_REF,
  WAIVABLE_MEDIA_CODES,
  DefectAdmissionContractError,
  actionableAftercareFindings,
  acceptsProductionAttestation,
  assertAuthorizedDefectManifest,
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
  coversRequirementGaps,
  resolveProductSelection,
});
