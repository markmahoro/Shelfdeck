'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const SNAPSHOT_SCHEMA = 'helix://implementation/libra/DecisionIdentityEvidenceSnapshot/v1';
const QUERY_SCHEMA = 'helix://contracts/domain-types/PerceptionResolutionQuery/v1';
const QUERY_HANDLE_SCHEMA = 'helix://contracts/types/CanonicalQueryHandle/v1';
const MAPPING_REF = 'libra.candidate-claim-title-anchor@1';
const NORMALIZATION_REF = 'unicode_nfkc_casefold';
const MAX_SNAPSHOT_BYTES = 16 * 1024;

class DecisionIdentityEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DecisionIdentityEvidenceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new DecisionIdentityEvidenceError(code, message, details);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freeze(item)]),
    ));
  }
  return value;
}

function without(value, ...fields) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !fields.includes(key)),
  );
}

function normalizeTitle(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('LIBRA_DECISION_IDENTITY_TITLE_REQUIRED',
      'Accepted Identity Claim must contain one non-empty claimed title.');
  }
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

function validateDigest(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('LIBRA_DECISION_IDENTITY_DIGEST_INVALID',
      'Decision Identity Evidence contains an invalid digest.', { field });
  }
}

function validateSnapshotSource(snapshot, intakeDecision) {
  const candidatePackage = snapshot?.candidatePackage;
  const identityClaim = candidatePackage?.identityClaim;
  if (!candidatePackage || !identityClaim ||
      candidatePackage.candidatePackageId !== intakeDecision.candidatePackageId ||
      candidatePackage.packageRevision !== intakeDecision.packageRevision ||
      candidatePackage.packageDigest !== intakeDecision.packageDigest ||
      snapshot.deliverySnapshotDigest !==
        intakeDecision.candidateDeliverySnapshotDigest ||
      identityClaim.claimDigest !==
        candidatePackage.identityClaim.claimDigest ||
      identityClaim.claimDigest !==
        intakeDecision.candidateIdentityClaimDigest ||
      canonicalDigest(without(identityClaim,
        'schemaRef', 'schemaVersion', 'draftId', 'draftKind',
        'basisDigest', 'draftDigest', 'producedAtMs', 'claimDigest')) !==
        identityClaim.claimDigest) {
    fail('LIBRA_DECISION_IDENTITY_SOURCE_MISMATCH',
      'Accepted Candidate snapshot does not conserve its exact Identity Claim.');
  }
  return { candidatePackage, identityClaim };
}

function buildDecisionIdentityEvidenceSnapshot(deliverySnapshot, intakeDecision) {
  const { candidatePackage, identityClaim } =
    validateSnapshotSource(deliverySnapshot, intakeDecision);
  const anchorValue = normalizeTitle(identityClaim.claimedTitle);
  const evidenceBody = {
    anchorKind: 'title',
    anchorValue,
    confidenceClass: 'medium',
    mappingRef: MAPPING_REF,
    normalizationProfileRef: NORMALIZATION_REF,
    sourceClaimId: identityClaim.draftId,
    sourceClaimDigest: identityClaim.claimDigest,
    sourceValue: identityClaim.claimedTitle,
  };
  const identityEvidence = [Object.freeze({
    ...evidenceBody,
    evidenceDigest: canonicalDigest(evidenceBody),
  })];
  const body = {
    schemaRef: SNAPSHOT_SCHEMA,
    schemaVersion: 1,
    mappingRef: MAPPING_REF,
    evidenceRevision: 1,
    intakeDecisionId: intakeDecision.intakeDecisionId,
    candidatePackageId: candidatePackage.candidatePackageId,
    packageRevision: candidatePackage.packageRevision,
    packageDigest: candidatePackage.packageDigest,
    candidateDeliverySnapshotDigest: deliverySnapshot.deliverySnapshotDigest,
    identityClaimSchemaRef: identityClaim.schemaRef,
    identityClaimId: identityClaim.draftId,
    identityClaimDigest: identityClaim.claimDigest,
    identityEvidence,
  };
  const result = freeze({
    ...body,
    snapshotDigest: canonicalDigest(body),
  });
  if (Buffer.byteLength(canonicalJson(result), 'utf8') > MAX_SNAPSHOT_BYTES) {
    fail('LIBRA_DECISION_IDENTITY_SNAPSHOT_TOO_LARGE',
      'Decision Identity Evidence Snapshot exceeds 16 KiB.');
  }
  return result;
}

function parseDecisionIdentityEvidenceSnapshot(row) {
  if (!row?.decision_identity_evidence_schema_ref ||
      !row.decision_identity_evidence_json ||
      !row.decision_identity_evidence_digest) {
    fail('LIBRA_DECISION_IDENTITY_SNAPSHOT_MISSING',
      'Accepted Intake Decision has no immutable Decision Identity Evidence.');
  }
  let value;
  try {
    value = JSON.parse(row.decision_identity_evidence_json);
  } catch {
    fail('LIBRA_DECISION_IDENTITY_SNAPSHOT_CORRUPT',
      'Decision Identity Evidence Snapshot is not valid JSON.');
  }
  if (row.decision_identity_evidence_schema_ref !== SNAPSHOT_SCHEMA ||
      value.schemaRef !== SNAPSHOT_SCHEMA ||
      value.schemaVersion !== 1 ||
      value.mappingRef !== MAPPING_REF ||
      value.evidenceRevision !== 1 ||
      value.intakeDecisionId !== row.intake_decision_id ||
      value.candidatePackageId !== row.candidate_package_id ||
      value.packageRevision !== Number(row.package_revision) ||
      value.packageDigest !== row.package_digest ||
      value.candidateDeliverySnapshotDigest !==
        row.candidate_delivery_snapshot_digest ||
      value.identityClaimDigest !== row.candidate_identity_claim_digest ||
      !Array.isArray(value.identityEvidence) ||
      value.identityEvidence.length < 1 ||
      value.identityEvidence.length > 16 ||
      value.identityEvidence.some((item) =>
        item.anchorKind !== 'title' ||
        item.mappingRef !== MAPPING_REF ||
        item.normalizationProfileRef !== NORMALIZATION_REF ||
        item.anchorValue !== normalizeTitle(item.sourceValue) ||
        item.evidenceDigest !== canonicalDigest(without(item, 'evidenceDigest'))) ||
      value.snapshotDigest !== canonicalDigest(without(value, 'snapshotDigest')) ||
      row.decision_identity_evidence_digest !== value.snapshotDigest ||
      canonicalJson(value) !== row.decision_identity_evidence_json) {
    fail('LIBRA_DECISION_IDENTITY_SNAPSHOT_CORRUPT',
      'Decision Identity Evidence Snapshot failed source or digest continuity.');
  }
  return freeze(value);
}

function buildPerceptionResolutionQuery(identitySnapshot, factKind) {
  if (!identitySnapshot || identitySnapshot.schemaRef !== SNAPSHOT_SCHEMA ||
      !['rating', 'watched'].includes(factKind)) {
    fail('LIBRA_PERCEPTION_QUERY_INPUT_INVALID',
      'Perception query requires one persisted Decision Identity Evidence Snapshot.');
  }
  const body = {
    queryContract: 'perception.' + factKind + '.resolve@1',
    queryVersion: 1,
    querySchemaRef: QUERY_SCHEMA,
    factKind,
    identityEvidence: identitySnapshot.identityEvidence.map((item) => ({
      anchorKind: item.anchorKind,
      anchorValue: item.anchorValue,
      confidenceClass: item.confidenceClass,
      evidenceDigest: item.evidenceDigest,
    })),
  };
  return freeze({
    ...body,
    queryInputDigest: canonicalDigest(body),
  });
}

function buildCanonicalQueryHandle(identitySnapshot, factKind) {
  const typedInput = buildPerceptionResolutionQuery(identitySnapshot, factKind);
  const identity = {
    providerDomain: 'perception',
    consumerDomain: 'libra',
    queryContract: typedInput.queryContract,
    queryVersion: typedInput.queryVersion,
    inputDigest: typedInput.queryInputDigest,
  };
  const handleId = 'perception-query-' + canonicalDigest({
    schema: 'libra.perception-query-handle-id@1',
    intakeDecisionId: identitySnapshot.intakeDecisionId,
    ...identity,
  }).slice(0, 40);
  const value = {
    schemaRef: QUERY_HANDLE_SCHEMA,
    schemaVersion: 1,
    handleId,
    ...identity,
    typedInputSchemaRef: typedInput.querySchemaRef,
    typedInput,
    correlationId: 'libra-spec-' + canonicalDigest({
      intakeDecisionId: identitySnapshot.intakeDecisionId,
      inputDigest: typedInput.queryInputDigest,
    }).slice(0, 40),
    expiresAtMs: Number.MAX_SAFE_INTEGER,
  };
  return freeze({
    ...value,
    fenceDigest: canonicalDigest(value),
  });
}

module.exports = Object.freeze({
  DecisionIdentityEvidenceError,
  MAPPING_REF,
  NORMALIZATION_REF,
  QUERY_SCHEMA,
  SNAPSHOT_SCHEMA,
  buildCanonicalQueryHandle,
  buildDecisionIdentityEvidenceSnapshot,
  buildPerceptionResolutionQuery,
  normalizeTitle,
  parseDecisionIdentityEvidenceSnapshot,
});
