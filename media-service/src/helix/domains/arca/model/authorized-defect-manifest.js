'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const SCHEMA_REF = 'helix://contracts/application-types/AuthorizedDefectManifest/v1';
const CODES = new Set(['actor_unavailable', 'external_source_exhausted']);
const DIGEST = /^[a-f0-9]{64}$/;

function ordered(values) {
  return [...new Set(values || [])].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)));
}

function exactSet(values) {
  return Array.isArray(values) && values.every((value) => typeof value === 'string') &&
    ordered(values).length === values.length;
}

function validManifest(value) {
  if (!value || value.schemaRef !== SCHEMA_REF || value.schemaVersion !== 1 ||
      value.manifestId !== value.defectDecisionId ||
      !Array.isArray(value.defects) || value.defects.length < 1 || value.defects.length > 2 ||
      value.defectCount !== value.defects.length ||
      !exactSet(value.waivedRequirementCodes) ||
      value.defects.some((item) => !CODES.has(item.defectCode) ||
        !exactSet(item.waivedRequirementCodes) || item.waivedRequirementCodes.length < 1) ||
      value.acknowledgement !== 'accept_listed_defects') return false;
  const body = Object.fromEntries(Object.entries(value)
    .filter(([name]) => name !== 'manifestDigest'));
  const waived = ordered(value.defects.flatMap((item) => item.waivedRequirementCodes || []));
  return value.manifestDigest === canonicalDigest(body) &&
    canonicalJson(ordered(value.waivedRequirementCodes)) === canonicalJson(waived);
}

function packageContentDigest(packageValue) {
  if (!packageValue || !DIGEST.test(packageValue.runStateDigest || '') ||
      !DIGEST.test(packageValue.runExecutionBasisDigest || '')) return null;
  const body = Object.fromEntries(Object.entries(packageValue)
    .filter(([name]) => !['manifestDigest', 'publishedAtMs', 'packageDigest']
      .includes(name)));
  const expected = canonicalDigest(body);
  return packageValue.manifestDigest === expected &&
    packageValue.packageDigest === expected ? expected : null;
}

function validAttestationIdentity(attestation, packageValue) {
  if (!packageValue) return true;
  const expectedRunId = packageValue.libraRunId;
  const expectedPackageId = packageValue.onDeckPackageId;
  const acceptanceSpec = packageValue.acceptanceSpecRef;
  const provenance = packageValue.productionProvenance;
  const manifest = attestation.authorizedDefectManifest;
  if (!expectedRunId || !expectedPackageId ||
      !packageContentDigest(packageValue) ||
      !Number.isSafeInteger(packageValue.runStateRevision) ||
      !acceptanceSpec || !provenance ||
      attestation.libraRunId !== expectedRunId ||
      attestation.onDeckPackageId !== expectedPackageId ||
      attestation.acceptanceSpecId !== acceptanceSpec.id ||
      attestation.acceptanceSpecRecordDigest !== acceptanceSpec.recordDigest ||
      provenance.libraRunId !== expectedRunId ||
      provenance.runExecutionBasisDigest !== packageValue.runExecutionBasisDigest ||
      provenance.acceptanceSpecRecordDigest !== acceptanceSpec.recordDigest ||
      (manifest && manifest.libraRunId !== expectedRunId)) return false;
  if (manifest && (manifest.frozenRunRef?.stateRevision + 1 !==
      packageValue.runStateRevision || manifest.decidedAtMs > attestation.attestedAtMs)) return false;
  const evidenceRefs = provenance.productVerificationRefs;
  const provenanceBody = Object.fromEntries(Object.entries(provenance)
    .filter(([name]) => name !== 'provenanceDigest'));
  if (provenance.provenanceDigest !== canonicalDigest(provenanceBody) ||
      !Array.isArray(evidenceRefs) || evidenceRefs.filter((item) =>
    item?.verificationId === attestation.productConformanceEvidenceId &&
    item?.verificationDigest === attestation.productConformanceEvidenceDigest)
    .length !== 1) return false;
  const body = Object.fromEntries(Object.entries(attestation)
    .filter(([name]) => name !== 'attestationDigest'));
  const expectedAttestationId = canonicalDigest({
    schema: 'libra.production-attestation-id@1',
    libraRunId: expectedRunId,
    onDeckPackageId: expectedPackageId,
    productConformanceEvidenceId: attestation.productConformanceEvidenceId,
    productConformanceEvidenceDigest: attestation.productConformanceEvidenceDigest,
  });
  return attestation.attestationId === expectedAttestationId &&
    attestation.attestationDigest === canonicalDigest(body);
}

function acceptsProductionAttestation(attestation, packageValue = null) {
  if (!attestation || !Array.isArray(attestation.unmetRequirementCodes) ||
      !exactSet(attestation.unmetRequirementCodes) ||
      attestation.unmetRequirementCount !== attestation.unmetRequirementCodes.length ||
      !validAttestationIdentity(attestation, packageValue)) return false;
  if (attestation.unmetRequirementCount === 0) {
    return attestation.acceptanceKind === 'accepted' &&
      attestation.authorizedDefectManifest === null;
  }
  const manifest = attestation.authorizedDefectManifest;
  return attestation.acceptanceKind === 'accepted_with_defects' && validManifest(manifest) &&
    canonicalJson(ordered(attestation.unmetRequirementCodes)) ===
      canonicalJson(ordered(manifest.waivedRequirementCodes));
}

function actionableAftercareFindings(manifest, findings) {
  if (!validManifest(manifest)) return Object.freeze([...(findings || [])]);
  const waived = new Set(manifest.waivedRequirementCodes);
  return Object.freeze((findings || []).filter((finding) => {
    const [dimension, code] = String(finding.findingKind || '').split(':');
    return dimension !== 'conformance' || !waived.has(code);
  }));
}

module.exports = Object.freeze({
  SCHEMA_REF,
  acceptsProductionAttestation,
  actionableAftercareFindings,
  validManifest,
});
