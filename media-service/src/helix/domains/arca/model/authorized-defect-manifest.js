'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const SCHEMA_REF = 'helix://contracts/application-types/AuthorizedDefectManifest/v1';
const CODES = new Set(['actor_unavailable', 'external_source_exhausted']);

function ordered(values) {
  return [...new Set(values || [])].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)));
}

function validManifest(value) {
  if (!value || value.schemaRef !== SCHEMA_REF || value.schemaVersion !== 1 ||
      value.manifestId !== value.defectDecisionId ||
      !Array.isArray(value.defects) || value.defects.length < 1 || value.defects.length > 2 ||
      value.defectCount !== value.defects.length ||
      value.defects.some((item) => !CODES.has(item.defectCode)) ||
      value.acknowledgement !== 'accept_listed_defects') return false;
  const body = Object.fromEntries(Object.entries(value)
    .filter(([name]) => name !== 'manifestDigest'));
  const waived = ordered(value.defects.flatMap((item) => item.waivedRequirementCodes || []));
  return value.manifestDigest === canonicalDigest(body) &&
    canonicalJson(ordered(value.waivedRequirementCodes)) === canonicalJson(waived);
}

function acceptsProductionAttestation(attestation) {
  if (!attestation || !Array.isArray(attestation.unmetRequirementCodes) ||
      attestation.unmetRequirementCount !== attestation.unmetRequirementCodes.length) return false;
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
