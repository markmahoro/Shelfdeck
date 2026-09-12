'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const SCHEMA_REF = 'helix://contracts/application-types/AuthorizedDefectManifest/v1';
const CODES = new Set(['actor_unavailable', 'metadata_fields_unavailable', 'artifacts_unavailable', 'external_source_exhausted', 'media_requirements_unmet', 'size_cap_exceeded']);
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
      !Array.isArray(value.defects) || value.defects.length < 1 || Buffer.byteLength(canonicalJson(value))>65536 ||
      value.defectCount !== value.defects.length ||
      !exactSet(value.waivedRequirementCodes) ||
      value.defects.some((item) => !CODES.has(item.defectCode) ||
        !exactSet(item.waivedRequirementCodes) || item.waivedRequirementCodes.length < 1) ||
      value.acknowledgement !== 'accept_listed_defects') return false;
  if(value.gapScope && (value.gapScope.ownerDomain!=='libra'||value.gapScope.processId!==value.libraRunId||
    value.gapScope.productRevision!==value.frozenRunRef?.stateRevision||!Array.isArray(value.gapScope.gaps)||!value.gapScope.gaps.length||
    value.gapScope.gaps.some(gap=>!value.waivedRequirementCodes.includes(gap.requirementCode)||!gap.targetId||!DIGEST.test(gap.evidenceDigest||''))))return false;
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
  if(manifest?.gapScope && (manifest.gapScope.acceptanceSpecId!==attestation.acceptanceSpecId||
    manifest.gapScope.acceptanceSpecRecordDigest!==attestation.acceptanceSpecRecordDigest||
    !acceptsMetadataFields(manifest,attestation.missingMetadataFields)||!acceptsArtifactKinds(manifest,attestation.missingArtifactKinds)))return false;
  return attestation.acceptanceKind === 'accepted_with_defects' && validManifest(manifest) &&
    canonicalJson(ordered(attestation.unmetRequirementCodes)) ===
      canonicalJson(ordered(manifest.waivedRequirementCodes));
}

function acceptsMetadataFields(manifest,fields) {
  if(!manifest?.gapScope)return true;
  return Array.isArray(fields)&&canonicalJson(ordered(fields))===canonicalJson(ordered(manifest.gapScope.gaps
    .filter(gap=>gap.targetKind==='metadata_field').map(gap=>gap.targetId)));
}

function acceptsArtifactKinds(manifest,kinds) {
  if(!manifest?.gapScope)return true;
  return canonicalJson(ordered(kinds))===canonicalJson(ordered(manifest.gapScope.gaps
    .filter(gap=>gap.targetKind==='artifact').map(gap=>gap.targetId)));
}
function packageMissingArtifactKinds(packageValue,requirements) {
  return require('../../../contracts/artifact-requirement-gaps').missingArtifactKinds(requirements,
    (packageValue.artifactManifest?.items||[]).map(item=>item.artifactKind));
}

function missingMetadataFields(packageValue,requirement) {
  const facts=packageValue.productFactManifest?.items||[],metadata=facts.find(item=>item.factKind==='product_metadata')?.factValue||{};
  const identity=packageValue.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||packageValue.resolvedIdentitySnapshot?.factValue||{};
  const providers=identity.providerIdentities||[],cast=packageValue.mediaCastSnapshot?.relations||[];
  const descriptive=new Map((metadata.descriptiveFacts?.entries||[]).map(item=>[item.key,item.value]));
  return Object.freeze((requirement.requiredFieldCodes||[]).filter(code=>{
    if(code==='actor')return cast.length===0;
    const namespace={tmdb_movie_id:'tmdb_movie',tmdb_series_id:'tmdb_series',jav_code:'jav_code',internal_identity:'internal_identity'}[code];
    if(namespace)return !providers.some(item=>item.namespace===namespace);
    if(code==='season_number')return !providers.some(item=>item.namespace==='tmdb_series'&&item.seasonNumber!=null);
    if(code==='episode_number')return !(packageValue.productMaterialManifest?.members||[]).some(item=>item.episodeClaims?.length);
    const value=descriptive.get(code);
    return value==null||(typeof value==='string'&&!value.trim())||(Array.isArray(value)&&value.length===0);
  }).sort());
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
  acceptsMetadataFields,
  acceptsArtifactKinds,
  packageMissingArtifactKinds,
  missingMetadataFields,
});
