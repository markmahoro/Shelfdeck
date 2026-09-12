'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const {artifactGapCodes}=require('../../../contracts/artifact-requirement-gaps');

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
const DEFECT_CODES = new Set(['actor_unavailable', 'metadata_fields_unavailable', 'artifacts_unavailable', 'external_source_exhausted', 'media_requirements_unmet', 'size_cap_exceeded']);
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
function ordered(values = []) {
  return [...new Set(values)].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
function blockers(terminalEvidence, candidateGapSources) {
  const values = candidateGapSources || terminalEvidence?.blockedWorks;
  if (!Array.isArray(values) || values.length < 1) {
    fail('P9_DEFECT_ADMISSION_TERMINAL', 'Defect admission requires exact terminal blockers.');
  }
  for(const item of values) {
  text(item.workId, 'blockedWork.workId');
  text(item.failureCode, 'blockedWork.failureCode');
  digest(item.terminalEvidenceDigest, 'blockedWork.terminalEvidenceDigest');
  }
  return values;
}
function sizeCapDefect(item, verification, run) {
  if (item.failureCode !== 'size_cap_requires_admission' ||
      item.failureClass !== 'business_unachievable') return null;
  const capabilityRef = item.capabilityRef;
  if (capabilityRef !== 'libra.product_media.verify@1') return null;
  if (!verification || verification.libraRunId !== run.libraRunId ||
      verification.candidateKind !== 'workspace_output' ||
      verification.result !== 'failed' ||
      canonicalJson(ordered(verification.reasonCodes || [])) !==
        canonicalJson(['max_size_exceeded'])) {
    fail('P9_DEFECT_ADMISSION_SIZE_VERIFICATION',
      'Size-cap admission requires the exact failed Workspace verification.');
  }
  return Object.freeze({
    defectCode: 'size_cap_exceeded',
    sourceFailureCode: item.failureCode,
    sourceWorkId: item.workId,
    sourceEvidenceDigest: item.terminalEvidenceDigest,
    workspaceMediaVerificationId:digest(verification.verificationId,'sizeVerification.verificationId'),
    workspaceMediaVerificationDigest:canonicalDigest(verification),
    candidateBasisDigest:digest(verification.candidateBasisDigest,'sizeVerification.candidateBasisDigest'),
    productMaterialHandleId:text(verification.productMaterialHandleId,'sizeVerification.productMaterialHandleId'),
    productMaterialHandleDigest:digest(verification.productMaterialHandleDigest,'sizeVerification.productMaterialHandleDigest'),
    productMaterialFenceDigest:digest(verification.productMaterialFenceDigest,'sizeVerification.productMaterialFenceDigest'),
    workspaceMediaHandleId:text(verification.workspaceMediaHandleId,'sizeVerification.workspaceMediaHandleId'),
    waivedRequirementCodes: Object.freeze(['max_size_exceeded']),
  });
}
function metadataDefect(item, missingFields, productGapPath) {
  if (productGapPath !== 'metadata' && (![ACTOR_FAILURE,'product_metadata_required_fields_missing'].includes(item.failureCode) ||
      item.capabilityRef !== 'libra.product_metadata.fetch@1' ||
      item.failureClass !== 'business_unachievable')) return null;
  const fields=ordered(missingFields || (item.failureCode===ACTOR_FAILURE?['actor']:[]));
  if(!fields.length)fail('P9_DEFECT_ADMISSION_EVIDENCE_PENDING','Exact missing metadata fields are unavailable.');
  if(fields.some(code=>['tmdb_movie_id','tmdb_series_id','jav_code','internal_identity','season_number','episode_number'].includes(code)))
    fail('P9_DEFECT_ADMISSION_NONWAIVABLE','Identity and structure requirements cannot be accepted as metadata defects.');
  return Object.freeze({
    defectCode: fields.length===1&&fields[0]==='actor'?'actor_unavailable':'metadata_fields_unavailable',
    metadataFieldCodes:Object.freeze(fields),
    sourceFailureCode: item.failureCode,
    sourceWorkId: item.workId,
    sourceEvidenceDigest: item.terminalEvidenceDigest,
    waivedRequirementCodes: Object.freeze(['metadata_field_unmet']),
  });
}
function externalDefect(item, verification, run, productGapPath) {
  const exhaustion = EXTERNAL_FAILURES.has(item.failureCode) &&
      EXTERNAL_TERMINAL_CAPABILITIES.has(item.capabilityRef) &&
      item.failureClass === 'business_unachievable';
  if (productGapPath !== 'media' && (!EXTERNAL_FAILURES.has(item.failureCode) ||
      !EXTERNAL_TERMINAL_CAPABILITIES.has(item.capabilityRef) ||
      item.failureClass !== 'business_unachievable')) return null;
  if (!verification || verification.candidateKind !== 'direct_input' ||
      verification.result !== 'failed' || verification.libraRunId !== run.libraRunId ||
      !Array.isArray(verification.reasonCodes) || !verification.reasonCodes.length) {
    fail('P9_DEFECT_ADMISSION_INELIGIBLE',
      'Media defect admission requires a verified direct product with concrete requirement gaps.');
  }
  const reasons = ordered(verification.reasonCodes);
  if (reasons.some((code) => !WAIVABLE_MEDIA_CODES.has(code))) {
    fail('P9_DEFECT_ADMISSION_NONWAIVABLE',
      'Original media has a non-waivable safety or integrity gap.', { reasonCodes: reasons });
  }
  digest(verification.verificationId, 'verification.verificationId');
  return Object.freeze({
    defectCode: exhaustion ? 'external_source_exhausted' : 'media_requirements_unmet',
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
  const additions=blockers(value.terminalEvidence,value.candidateGapSources).map(item=>{
    const productGapPath = value.productGapPaths?.[item.workId];
    const artifactKinds=value.missingArtifactKindsByWork?.[item.workId];
    const artifact=artifactKinds?.length?Object.freeze({defectCode:'artifacts_unavailable',artifactKindCodes:Object.freeze(ordered(artifactKinds)),
      sourceFailureCode:item.failureCode,sourceWorkId:item.workId,sourceEvidenceDigest:item.terminalEvidenceDigest,
      waivedRequirementCodes:Object.freeze(artifactGapCodes(value.requirements,artifactKinds))}):null;
    const defect = artifact || metadataDefect(item,value.missingMetadataFields,productGapPath) || sizeCapDefect(item,value.sizeCapVerification,run) ||
      externalDefect(item, value.directMediaVerification, run,productGapPath);
    if (!defect) {
    fail('P9_DEFECT_ADMISSION_INELIGIBLE',
      'The terminal blocker is not an evidenced acceptable product gap.',
      { failureCode: item.failureCode });
    }
    return defect;
  });
  const prior = value.priorAuthorizedManifest?.defects || [];
  const defects = [...prior, ...additions]
    .filter((entry, index, items) => items.findIndex((itemValue) =>
      canonicalDigest(itemValue) === canonicalDigest(entry)) === index)
    .sort((left, right) => Buffer.from(canonicalJson(left)).compare(Buffer.from(canonicalJson(right))));
  if (!defects.length ||
      defects.some((entry) => !DEFECT_CODES.has(entry.defectCode))) {
    fail('P9_DEFECT_ADMISSION_SCOPE', 'Defect candidate contains an unsupported gap.');
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
  if(value.gapScope)body.gapScope=value.gapScope;
  if(Buffer.byteLength(canonicalJson(body))>65536)fail('P9_DEFECT_ADMISSION_TOO_LARGE','Exact gap evidence exceeds 64 KiB; it cannot be truncated.');
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
    authorizationSource:value.standingAuthorization?'standing':'manual',
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
  if (value.standingAuthorization) {
    body.standingAuthorization = Object.freeze({
      authorizationId: text(value.standingAuthorization.authorizationId, 'authorizationId'),
      revision: positive(value.standingAuthorization.revision, 'authorizationRevision'),
      authorizationDigest: digest(value.standingAuthorization.authorizationDigest, 'authorizationDigest'),
    });
  }
  if(candidate.gapScope)body.gapScope=candidate.gapScope;
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
      ...(value.gapScope?{gapScope:value.gapScope}:{}),
    }),
    actorId: value.actorId,
    idempotencyKey: value.idempotencyKey,
    acknowledged: value.acknowledgement === 'accept_listed_defects',
    decidedAtMs: value.decidedAtMs,
    standingAuthorization: value.standingAuthorization,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail('P9_DEFECT_ADMISSION_MANIFEST', 'Authorized Defect Manifest is not canonical.');
  }
  return rebuilt;
}

function coversRequirementGaps(manifestValue, unmetRequirementCodes, evidence = null) {
  const manifest = assertAuthorizedDefectManifest(manifestValue);
  if(manifest.gapScope) {
    if(!evidence || evidence.acceptanceSpecId!==manifest.gapScope.acceptanceSpecId ||
      evidence.acceptanceSpecRecordDigest!==manifest.gapScope.acceptanceSpecRecordDigest)return false;
    const fields=manifest.gapScope.gaps.filter(gap=>gap.targetKind==='metadata_field').map(gap=>gap.targetId);
    if(canonicalJson(ordered(fields))!==canonicalJson(ordered(evidence.missingMetadataFields)))return false;
    const artifacts=manifest.gapScope.gaps.filter(gap=>gap.targetKind==='artifact').map(gap=>gap.targetId);
    if(canonicalJson(ordered(artifacts))!==canonicalJson(ordered(evidence.missingArtifactKinds)))return false;
  }
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
        attestation.unmetRequirementCodes,attestation);
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

function resolveProductSelection(results, manifestValue, context = {}) {
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
  const sizeDefect = manifest.defects.find((item) =>
    item.defectCode === 'size_cap_exceeded');
  if (sizeDefect) {
    if (context.workId !== sizeDefect.sourceWorkId) {
      return Object.freeze({ selection, effectiveSelection:null,
        verification:null, admittedDefect:null });
    }
    const verification = (results || []).find((item) =>
      item.outcomeKind === 'succeeded' &&
      item.capabilityRef === 'libra.product_media.verify@1' &&
      item.result?.candidateKind === 'workspace_output' &&
      item.result?.result === 'failed' &&
      item.result?.verificationId === sizeDefect.workspaceMediaVerificationId &&
      canonicalDigest(item.result) === sizeDefect.workspaceMediaVerificationDigest)?.result || null;
    const reasons = ordered(verification?.reasonCodes || []);
    const waived = ordered(sizeDefect.waivedRequirementCodes || []);
    if (!verification || canonicalJson(reasons) !== canonicalJson(waived) ||
        verification.candidateBasisDigest !== sizeDefect.candidateBasisDigest ||
        verification.productMaterialHandleId !== sizeDefect.productMaterialHandleId ||
        verification.productMaterialHandleDigest !== sizeDefect.productMaterialHandleDigest ||
        verification.productMaterialFenceDigest !== sizeDefect.productMaterialFenceDigest ||
        verification.workspaceMediaHandleId !== sizeDefect.workspaceMediaHandleId) {
      fail('P9_DEFECT_ADMISSION_SIZE_STALE',
        'Authorized size-cap verification is absent or changed.');
    }
    const effectiveSelection = Object.freeze({
      selectionKind: 'authorized_defect_workspace_output',
      selectedCandidateKind: 'workspace_output',
      selectedHandleId: verification.productMaterialHandleId,
      selectedWorkspaceMediaHandleId: verification.workspaceMediaHandleId,
      selectedVerificationId: verification.verificationId,
      selectedVerificationDigest: canonicalDigest(verification),
    });
    return Object.freeze({ selection, effectiveSelection, verification,
      admittedDefect:sizeDefect });
  }
  const defect = manifest.defects.find((item) =>
    Boolean(item.originalMediaVerificationId));
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
