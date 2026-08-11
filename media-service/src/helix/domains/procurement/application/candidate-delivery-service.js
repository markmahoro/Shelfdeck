'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { ACCEPTANCE_BASIS_SCHEMA, MANIFEST_SCHEMA, OFFER_MESSAGE_SCHEMA, PACKAGE_SCHEMA, buildAcceptanceBasis, buildOffer } =
  require('../model/candidate-publication-contracts');

const QUERY_SCHEMA = 'helix://contracts/domain-types/CandidateDeliveryQuery/v1';
const RESULT_SCHEMA = 'helix://contracts/domain-types/CandidateDeliveryReadResult/v1';
const SNAPSHOT_SCHEMA = 'helix://contracts/domain-types/CandidateDeliverySnapshot/v1';
const IDENTITY_SCHEMA = 'helix://contracts/types/PhysicalMaterialIdentity/v2';

class CandidateDeliveryServiceError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CandidateDeliveryServiceError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new CandidateDeliveryServiceError(code, message, details); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}
function parse(json, digest, digestField, code) {
  let value;
  try { value = JSON.parse(json); } catch { fail(code, 'Candidate Delivery owner JSON is corrupt.'); }
  if (!value || value[digestField] !== digest) fail(code, 'Candidate Delivery owner JSON digest reference is invalid.');
  return value;
}
function requireBytes(value, maximum, code) {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) fail(code, 'Candidate Delivery value exceeds its canonical byte bound.');
}

function buildQuery(message) {
  const value = { queryContract:'procurement.candidate-delivery@1', offerId:message.offerId,
    candidatePackageId:message.candidatePackageId, packageRevision:message.packageRevision, packageDigest:message.packageDigest,
    acceptanceBasisDigest:message.acceptanceBasisDigest, queryDigest:'' };
  value.queryDigest = canonicalDigest(without(value, 'queryDigest'));
  requireBytes(value, 16 * 1024, 'P8_CANDIDATE_DELIVERY_QUERY_TOO_LARGE');
  return freeze(value);
}

function result(query, value) {
  const output = value ? { queryDigest:query.queryDigest, resultKind:'found', snapshot:value, resultDigest:'' } :
    { queryDigest:query.queryDigest, resultKind:'not_found', reasonCode:'offer_not_found', resultDigest:'' };
  output.resultDigest = canonicalDigest(without(output, 'resultDigest'));
  return freeze(output);
}

function reconstruct(rows) {
  const pkg = rows.candidatePackage;
  const primaries = [...rows.primaries].sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
  if (primaries.length < 1 || primaries.length > 1024 || primaries.some((row, index) => Number(row.ordinal) !== index)) {
    fail('P8_CANDIDATE_DELIVERY_PRIMARY_SET', 'Primary Material ordinals are incomplete or out of bounds.');
  }
  const episodes = new Map();
  for (const row of rows.episodes) {
    const ordinal = Number(row.primary_ordinal);
    if (!episodes.has(ordinal)) episodes.set(ordinal, []);
    episodes.get(ordinal).push({ episodeKey:row.episode_key, seasonClaimDigest:row.season_claim_digest, claimDigest:row.claim_digest });
  }
  for (const values of episodes.values()) values.sort((a, b) => compareUtf8(a.episodeKey, b.episodeKey));
  const manifestMembers = primaries.map((row) => {
    const physicalIdentity = { schemaRef:IDENTITY_SCHEMA, schemaVersion:2, materialKey:row.material_key,
      mountScopeId:row.mount_scope_id, inode:String(row.inode), sizeBytes:Number(row.size_bytes),
      fingerprintAlgorithm:row.fingerprint_algorithm, fingerprintVersion:Number(row.fingerprint_version), contentFingerprint:row.content_fingerprint };
    const value = { ordinal:Number(row.ordinal), materialKey:row.material_key, role:row.role, physicalIdentity,
      sizeBytes:Number(row.size_bytes),
      bindingRevision:Number(row.binding_revision), admittedControlRevision:Number(row.admitted_control_revision),
      admittedControlProjectionDigest:row.admitted_control_projection_digest, episodeClaims:episodes.get(Number(row.ordinal)) || [] };
    const memberDigest = canonicalDigest(value);
    if (memberDigest !== row.member_digest) fail('P8_CANDIDATE_DELIVERY_MANIFEST_MEMBER', 'Manifest member digest is invalid.');
    return { ...value, memberDigest };
  });
  const membersDigest = canonicalDigest({ schema:'procurement.primary-input-manifest-members@1',
    items:manifestMembers.map(({ memberDigest, ...member }) => member) });
  const manifest = { schemaRef:MANIFEST_SCHEMA, schemaVersion:1, manifestId:pkg.primary_input_manifest_id,
    manifestKind:'primary_input_manifest', ownerDomain:'procurement', memberCount:manifestMembers.length, membersDigest,
    manifestDigest:'', publishedAtMs:Number(pkg.published_at_ms), structureKind:pkg.structure_kind, members:manifestMembers };
  manifest.manifestDigest = canonicalDigest(without(manifest, 'manifestDigest'));
  if (manifest.manifestDigest !== pkg.manifest_digest) fail('P8_CANDIDATE_DELIVERY_MANIFEST', 'Primary Input Manifest digest is invalid.');

  const primaryByOrdinal = new Map(primaries.map((row) => [Number(row.ordinal), row]));
  const related = [...rows.related].sort((a, b) => compareUtf8(a.reference_id, b.reference_id)).map((row) => {
    const primary = primaryByOrdinal.get(Number(row.primary_ordinal));
    if (!primary) fail('P8_CANDIDATE_DELIVERY_RELATED_PRIMARY', 'Related Reference points outside the Manifest.');
    const identity = { schemaRef:IDENTITY_SCHEMA, schemaVersion:2, materialKey:row.material_key, mountScopeId:row.mount_scope_id,
      inode:String(row.inode), sizeBytes:Number(row.size_bytes), fingerprintAlgorithm:row.fingerprint_algorithm,
      fingerprintVersion:Number(row.fingerprint_version), contentFingerprint:row.content_fingerprint };
    const materialKey = canonicalDigest({ schema:'physical-material-identity@2', mountScopeId:identity.mountScopeId, inode:identity.inode,
      sizeBytes:identity.sizeBytes, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
      contentFingerprint:identity.contentFingerprint });
    const referenceId = canonicalDigest({ schema:'procurement.related-material-reference-id@1', primaryMaterialKey:primary.material_key,
      role:row.role, relatedMaterialKey:identity.materialKey, endpointId:row.endpoint_id, location:row.location });
    const reference = { referenceId:row.reference_id, primaryMaterialKey:primary.material_key, role:row.role, identity,
      endpointId:row.endpoint_id, location:row.location, fingerprintAlgorithm:identity.fingerprintAlgorithm,
      fingerprintVersion:identity.fingerprintVersion, contentFingerprint:identity.contentFingerprint,
      associationKind:row.association_kind,dispositionRequired:Number(row.disposition_required)===1,
      associationEvidenceDigest:row.association_evidence_digest,dispositionBasisDigest:row.disposition_basis_digest,
      referenceDigest:row.reference_digest };
    if (identity.fingerprintAlgorithm !== 'middle-256k-sha256' || identity.fingerprintVersion !== 1 || identity.materialKey !== materialKey ||
        row.reference_id !== referenceId || reference.associationKind!=='exclusive'||reference.dispositionRequired!==true||
        reference.dispositionBasisDigest!==canonicalDigest({schema:'procurement.related-disposition-basis@1',
          referenceId:reference.referenceId,primaryMaterialKey:reference.primaryMaterialKey,role:reference.role,
          identity:reference.identity,associationEvidenceDigest:reference.associationEvidenceDigest})||
        row.reference_digest !== canonicalDigest(without(reference, 'referenceDigest'))) {
      fail('P8_CANDIDATE_DELIVERY_RELATED', 'Related Reference identity or digest is invalid.');
    }
    return reference;
  });
  const relatedReferenceSetDigest = canonicalDigest({ schema:'procurement.related-reference-set@1', items:related });
  if (relatedReferenceSetDigest !== pkg.related_reference_set_digest) fail('P8_CANDIDATE_DELIVERY_RELATED_SET', 'Related set digest is invalid.');
  const relatedDispositionScopeDigest=canonicalDigest({schema:'procurement.related-disposition-scope@1',items:related.map((reference)=>({
    referenceId:reference.referenceId,primaryMaterialKey:reference.primaryMaterialKey,role:reference.role,
    materialKey:reference.identity.materialKey,dispositionBasisDigest:reference.dispositionBasisDigest}))});
  if(relatedDispositionScopeDigest!==pkg.related_disposition_scope_digest)fail('P8_CANDIDATE_DELIVERY_RELATED_DISPOSITION','Related disposition scope digest is invalid.');
  const continuity = [...rows.continuity].map((row) => ({ claimKind:row.claim_kind, claimNamespace:row.claim_namespace,
    claimKey:row.claim_key, claimDigest:row.claim_digest, evidenceDigest:row.evidence_digest }))
    .sort((a, b) => compareUtf8([a.claimKind,a.claimNamespace,a.claimKey].join('\0'), [b.claimKind,b.claimNamespace,b.claimKey].join('\0')));
  const continuityDigest = canonicalDigest({ schema:'season-continuity-claim-set@1', items:continuity });
  const identityMetadata = parse(pkg.identity_metadata_json, pkg.identity_metadata_digest, 'metadataDigest', 'P8_CANDIDATE_DELIVERY_METADATA');
  const identityClaim = parse(pkg.identity_claim_json, pkg.identity_claim_digest, 'claimDigest', 'P8_CANDIDATE_DELIVERY_IDENTITY_CLAIM');
  const candidatePackage = { schemaRef:PACKAGE_SCHEMA, schemaVersion:1, manifestId:pkg.candidate_package_id,
    manifestKind:'candidate_package', ownerDomain:'procurement', memberCount:manifestMembers.length, membersDigest,
    manifestDigest:pkg.package_digest, publishedAtMs:Number(pkg.published_at_ms), candidatePackageId:pkg.candidate_package_id,
    packageRevision:Number(pkg.package_revision), procurementRunId:pkg.procurement_run_id, runBasisDigest:rows.run.run_basis_digest,
    triageRule:{ ruleRef:pkg.triage_rule_ref, revision:Number(pkg.triage_rule_revision), authorityDigest:pkg.triage_rule_authority_digest },
    materialFieldContextRef:{ fieldId:pkg.field_id, accessRevision:Number(pkg.field_access_revision), contextDigest:pkg.field_context_digest },
    mediaType:pkg.media_type, contentProfile:pkg.content_profile, materialInputForm:pkg.material_input_form, displayIdentity:pkg.display_identity, identityMetadata, identityClaim,
    structureEvidenceRef:{ evidenceId:pkg.structure_evidence_id, payloadDigest:pkg.structure_evidence_payload_digest,
      unitId:pkg.structure_unit_id, unitDigest:pkg.structure_unit_digest }, seasonContinuityClaims:continuity,
    seasonContinuityClaimSetDigest:continuityDigest,
    primaryInputManifestRef:{ manifestId:manifest.manifestId, manifestDigest:manifest.manifestDigest, memberCount:manifest.memberCount },
    relatedReferences:related, relatedReferenceSetDigest,relatedDispositionScopeDigest, memberControlEvidenceSetDigest:pkg.member_control_evidence_set_digest,
    packageDigest:pkg.package_digest };
  if (canonicalDigest(without(candidatePackage, 'manifestDigest', 'packageDigest')) !== candidatePackage.packageDigest) {
    fail('P8_CANDIDATE_DELIVERY_PACKAGE', 'Candidate Package cannot be reconstructed to its published digest.');
  }
  const acceptanceBasis = buildAcceptanceBasis(candidatePackage);
  const offer = buildOffer(candidatePackage, acceptanceBasis).message;
  const delivery = rows.delivery;
  if (delivery.candidate_package_id !== candidatePackage.candidatePackageId || delivery.package_digest !== candidatePackage.packageDigest ||
      delivery.acceptance_basis_digest !== acceptanceBasis.acceptanceBasisDigest || delivery.offer_id !== offer.offerId) {
    fail('P8_CANDIDATE_DELIVERY_OFFER', 'Offer row does not match its immutable Package and Acceptance Basis.');
  }
  const runMembers = new Map(rows.runMembers.filter((row) => row.candidate_package_id === candidatePackage.candidatePackageId)
    .map((row) => [row.material_key, row]));
  const deliveries = manifestMembers.map((member) => {
    const row = runMembers.get(member.materialKey);
    if (!row || Number(row.binding_revision) !== member.bindingRevision || Number(row.admitted_control_revision) !== member.admittedControlRevision ||
        row.admitted_control_projection_digest !== member.admittedControlProjectionDigest || row.mount_scope_id !== member.physicalIdentity.mountScopeId ||
        String(row.inode) !== member.physicalIdentity.inode || Number(row.size_bytes) !== member.physicalIdentity.sizeBytes ||
        row.fingerprint_algorithm !== member.physicalIdentity.fingerprintAlgorithm ||
        Number(row.fingerprint_version) !== member.physicalIdentity.fingerprintVersion ||
        row.content_fingerprint !== member.physicalIdentity.contentFingerprint || Number(row.size_bytes) !== member.sizeBytes) {
      fail('P8_CANDIDATE_DELIVERY_RUN_BASIS', 'Manifest member does not match its immutable Run Basis row.');
    }
    const value = { ordinal:member.ordinal, materialKey:member.materialKey, role:member.role,
      physicalIdentity:member.physicalIdentity, sizeBytes:member.sizeBytes, bindingRevision:member.bindingRevision,
      admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
      endpointId:row.endpoint_id, location:row.location, lastSnapshotDigest:row.last_snapshot_digest, realityDigest:row.reality_digest,
      provenanceDigest:row.provenance_digest, manifestMemberDigest:member.memberDigest, episodeClaims:member.episodeClaims };
    const item = { ...value, deliveryMemberDigest:canonicalDigest(value) };
    requireBytes(item, 8 * 1024, 'P8_CANDIDATE_DELIVERY_MEMBER_TOO_LARGE');
    return item;
  });
  const deliveryMemberSetDigest = canonicalDigest({ schema:'procurement.candidate-delivery-members@1', items:deliveries });
  if (!['stream_file', 'bdmv', 'dvd', 'iso'].includes(candidatePackage.materialInputForm)) {
    fail('P8_CANDIDATE_DELIVERY_INPUT_FORM', 'Candidate Package materialInputForm is missing or invalid.');
  }
  const snapshot = { snapshotContract:'procurement.candidate-delivery@1', offer, acceptanceBasis, candidatePackage,
    materialInputForm:candidatePackage.materialInputForm,
    primaryInputManifest:manifest, primaryMaterialDeliveries:deliveries, deliveryMemberSetDigest, deliverySnapshotDigest:'' };
  snapshot.deliverySnapshotDigest = canonicalDigest(without(snapshot, 'deliverySnapshotDigest'));
  requireBytes(snapshot, 8 * 1024 * 1024, 'P8_CANDIDATE_DELIVERY_SNAPSHOT_TOO_LARGE');
  return freeze(snapshot);
}

function createCandidateDeliveryService(options) {
  if (!options || !options.candidateDeliveryReader || typeof options.candidateDeliveryReader.readRows !== 'function' ||
      !options.contractValidator || typeof options.contractValidator.validate !== 'function') {
    fail('P8_CANDIDATE_DELIVERY_DEPENDENCIES', 'A read-only Candidate Delivery reader and contract validator are required.');
  }
  return Object.freeze({ readSnapshot(query) {
    options.contractValidator.validate(QUERY_SCHEMA, query);
    if (!query || query.queryContract !== 'procurement.candidate-delivery@1' ||
        query.queryDigest !== canonicalDigest(without(query, 'queryDigest'))) fail('P8_CANDIDATE_DELIVERY_QUERY', 'Candidate Delivery Query is invalid.');
    requireBytes(query, 16 * 1024, 'P8_CANDIDATE_DELIVERY_QUERY_TOO_LARGE');
    const rows = options.candidateDeliveryReader.readRows(query);
    if (!rows) { const output=result(query, null); options.contractValidator.validate(RESULT_SCHEMA, output); return output; }
    const snapshot = reconstruct(rows);
    if (!same(buildQuery(snapshot.offer), query)) fail('P8_CANDIDATE_DELIVERY_QUERY_MISMATCH', 'Query does not identify the reconstructed Offer.');
    for (const [schema, value] of [[OFFER_MESSAGE_SCHEMA,snapshot.offer],[ACCEPTANCE_BASIS_SCHEMA,snapshot.acceptanceBasis],
      [PACKAGE_SCHEMA,snapshot.candidatePackage],[MANIFEST_SCHEMA,snapshot.primaryInputManifest],[SNAPSHOT_SCHEMA,snapshot]]) {
      options.contractValidator.validate(schema, value);
    }
    const output=result(query, snapshot); options.contractValidator.validate(RESULT_SCHEMA, output); return output;
  } });
}

module.exports = Object.freeze({ CandidateDeliveryServiceError, QUERY_SCHEMA, RESULT_SCHEMA, SNAPSHOT_SCHEMA,
  buildQuery, createCandidateDeliveryService, reconstruct });
