'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const PACKAGE_SCHEMA = 'helix://contracts/types/CandidatePackage/v1';
const RECEIPT_SCHEMA = 'helix://contracts/types/CandidatePublicationReceipt/v1';
const MANIFEST_SCHEMA = 'helix://contracts/types/PrimaryInputManifest/v1';
const ACCEPTANCE_BASIS_SCHEMA = 'helix://contracts/types/CandidateIntakeAcceptanceBasis/v1';
const OFFER_MESSAGE_SCHEMA = 'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1';
const HANDOFF_CONTRACT = 'helix://handoffs/procurement-to-libra/v1';
const CLAIM_KINDS = new Set(['provider_season_identity', 'triage_grouping_lineage']);
const MATERIAL_INPUT_FORMS = new Set(['stream_file', 'bdmv', 'dvd', 'iso']);
const SHA256 = /^[0-9a-f]{64}$/;

class CandidatePublicationContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CandidatePublicationContractError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new CandidatePublicationContractError(code, message, details); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function requireArray(value, field, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail('P7_CANDIDATE_COLLECTION_BOUNDS', field + ' violates its closed bounds.');
}

function compactUnitMember(manifestMember) {
  const value = {
    materialKey: manifestMember.materialKey,
    bindingRevision: manifestMember.bindingRevision,
    admittedControlRevision: manifestMember.admittedControlRevision,
    admittedControlProjectionDigest: manifestMember.admittedControlProjectionDigest,
    role: manifestMember.role,
    episodeClaims: manifestMember.episodeClaims,
  };
  return Object.freeze({ ...value, memberClaimDigest: canonicalDigest(value) });
}

function candidateUnitMembers(draft) {
  const unit = draft?.structureEvidence?.unit;
  if (Array.isArray(unit?.members)) return Object.freeze(unit.members);
  const manifestMembers = draft?.primaryInputManifestDraft?.members;
  if (!Array.isArray(manifestMembers)) {
    fail('P7_CANDIDATE_MEMBER_SOURCE_MISSING', 'Compact Unit requires the complete Candidate Manifest member source.');
  }
  return Object.freeze(manifestMembers.map(compactUnitMember));
}

function physicalIdentityFromManifestMember(member) {
  const identity = member?.physicalIdentity;
  if (!identity || identity.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v2' || identity.schemaVersion !== 2 ||
      identity.fingerprintAlgorithm !== 'middle-256k-sha256' || identity.fingerprintVersion !== 1 ||
      !Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 0 || member.sizeBytes !== identity.sizeBytes ||
      identity.materialKey !== canonicalDigest({ schema:'physical-material-identity@2', mountScopeId:identity.mountScopeId,
        inode:identity.inode, sizeBytes:identity.sizeBytes, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
        contentFingerprint:identity.contentFingerprint })) {
    fail('P7_CANDIDATE_MANIFEST_IDENTITY_INVALID', 'Primary Manifest member Identity is not the exact bounded Physical Material Identity.');
  }
  return identity;
}

function validateManifestMemberSource(draft, unitMembers) {
  const manifestDraft = draft.primaryInputManifestDraft;
  requireArray(manifestDraft.members, 'primaryInputManifestDraft.members', 1024, 1);
  if (manifestDraft.memberCount !== manifestDraft.members.length || manifestDraft.membersDigest !==
      canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:manifestDraft.members })) {
    fail('P7_CANDIDATE_MANIFEST_MEMBER_DIGEST', 'Primary Manifest Draft members are not canonical.');
  }
  let previous = null;
  const byKey = new Map();
  for (const [ordinal, member] of manifestDraft.members.entries()) {
    if (member.ordinal !== ordinal || (previous !== null && compareUtf8(previous, member.materialKey) >= 0) || byKey.has(member.materialKey) ||
        !digestString(member.materialKey) || !Number.isSafeInteger(member.bindingRevision) || member.bindingRevision < 1 ||
        !Number.isSafeInteger(member.admittedControlRevision) || member.admittedControlRevision < 1 ||
        !SHA256.test(member.admittedControlProjectionDigest || '')) {
      fail('P7_CANDIDATE_MANIFEST_MEMBER_CANONICAL', 'Primary Manifest Draft members must be ordered and uniquely keyed.');
    }
    physicalIdentityFromManifestMember(member);
    validateEpisodeClaims(member.episodeClaims);
    previous = member.materialKey;
    byKey.set(member.materialKey, member);
  }
  if (byKey.size !== unitMembers.length || unitMembers.some((member) => {
    const manifestMember = byKey.get(member.materialKey);
    return !manifestMember || manifestMember.role !== member.role ||
      manifestMember.bindingRevision !== member.bindingRevision ||
      manifestMember.admittedControlRevision !== member.admittedControlRevision ||
      manifestMember.admittedControlProjectionDigest !== member.admittedControlProjectionDigest ||
      !same(manifestMember.episodeClaims, member.episodeClaims);
  })) {
    fail('P7_CANDIDATE_MANIFEST_MEMBER_MISMATCH', 'Primary Manifest Draft members do not preserve Candidate Context.');
  }
  return byKey;
}

function digestString(value) { return typeof value === 'string' && SHA256.test(value); }

function validateRelatedScope(scope) {
  if (!scope || !['ordinary_parent', 'bdmv_external_parent'].includes(scope.scopeKind) ||
      typeof scope.parentRelativeLocation !== 'string' || !scope.parentRelativeLocation || typeof scope.stemKey !== 'string' || !scope.stemKey ||
      !['standalone_same_stem', 'single_movie_directory', 'multi_movie_directory', 'bdmv_external'].includes(scope.associationMode) ||
      !Number.isSafeInteger(scope.observationProjectionRevision) || scope.observationProjectionRevision < 1 ||
      !Number.isSafeInteger(scope.relatedRuleRevision) || scope.relatedRuleRevision < 1 ||
      !digestString(scope.scopeDigest) || scope.scopeDigest !== canonicalDigest({ schema:'procurement.related-scope@1',
        scopeKind:scope.scopeKind, parentRelativeLocation:scope.parentRelativeLocation, stemKey:scope.stemKey,
        associationMode:scope.associationMode,
        observationProjectionRevision:scope.observationProjectionRevision, relatedRuleRevision:scope.relatedRuleRevision })) {
    fail('P7_CANDIDATE_RELATED_SCOPE_INVALID', 'Candidate Unit Related Scope is invalid.');
  }
}

function validateEpisodeClaims(claims) {
  requireArray(claims, 'episodeClaims', 32);
  let previous = null;
  for (const episode of claims) {
    if (typeof episode.episodeKey !== 'string' || !episode.episodeKey || !digestString(episode.seasonClaimDigest) ||
        episode.claimDigest !== canonicalDigest(without(episode, 'claimDigest')) ||
        (previous !== null && compareUtf8(previous, episode.episodeKey) >= 0)) {
      fail('P7_CANDIDATE_EPISODE_CANONICAL', 'Episode Claims must be uniquely sorted with exact digests.');
    }
    previous = episode.episodeKey;
  }
}

function validateContinuity(claims, setDigest) {
  requireArray(claims, 'seasonContinuityClaims', 64);
  let previous = null;
  for (const claim of claims) {
    const tuple = [claim.claimKind, claim.claimNamespace, claim.claimKey];
    if (!CLAIM_KINDS.has(claim.claimKind) || tuple.some((item) => typeof item !== 'string' || !item) ||
        claim.claimDigest !== canonicalDigest({ schema:'season-continuity-claim@1', claimKind:claim.claimKind,
          claimNamespace:claim.claimNamespace, claimKey:claim.claimKey })) {
      fail('P7_CANDIDATE_CONTINUITY_INVALID', 'Season Continuity Claim is not canonical.');
    }
    const key = tuple.join('\0');
    if (previous !== null && compareUtf8(previous, key) >= 0) fail('P7_CANDIDATE_CONTINUITY_ORDER', 'Season Continuity Claims must be uniquely sorted.');
    previous = key;
  }
  const expected = canonicalDigest({ schema:'season-continuity-claim-set@1', items:claims });
  if (setDigest !== expected) fail('P7_CANDIDATE_CONTINUITY_DIGEST', 'Season Continuity Claim set digest is invalid.');
}

function validateDraft(draft, runBasisMembers) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) ||
      !draft.structureEvidence || !draft.structureEvidence.unit || !draft.primaryInputManifestDraft) {
    fail('P7_CANDIDATE_DRAFT_INVALID', 'Candidate Draft is incomplete.');
  }
  const unit = draft.structureEvidence.unit;
  const unitMembers = candidateUnitMembers(draft);
  const compact = !Array.isArray(unit.members);
  if (compact && (!unit.memberScope || unit.memberScope.scopeKind !== 'bdmv_container')) {
    fail('P7_CANDIDATE_UNIT_SCOPE_INVALID', 'Compact Candidate Unit must carry a BDMV Scope Reference.');
  }
  validateRelatedScope(unit.relatedScope);
  if (!MATERIAL_INPUT_FORMS.has(unit.materialInputForm) || draft.materialInputForm !== unit.materialInputForm) {
    fail('P7_CANDIDATE_INPUT_FORM_INVALID', 'Candidate materialInputForm is missing or inconsistent with the Unit.');
  }
  requireArray(unitMembers, compact ? 'primaryInputManifestDraft.members' : 'structureEvidence.unit.members', 1024, 1);
  let previousMember = null;
  const memberKeys = new Set();
  for (const member of unitMembers) {
    if (previousMember !== null && compareUtf8(previousMember, member.materialKey) >= 0 || memberKeys.has(member.materialKey) ||
        (!compact && member.memberClaimDigest !== canonicalDigest(without(member, 'memberClaimDigest')))) {
      fail('P7_CANDIDATE_MEMBER_CANONICAL', 'Triage Unit members must be uniquely sorted with exact digests.');
    }
    previousMember = member.materialKey; memberKeys.add(member.materialKey);
    validateEpisodeClaims(member.episodeClaims);
    if (unit.contentProfile === 'series' && member.role === 'primary_payload' && member.episodeClaims.length < 1) {
      fail('P7_CANDIDATE_EPISODE_REQUIRED', 'Series primary members require an Episode Claim.');
    }
  }
  const expectedUnitId = compact
    ? canonicalDigest({ schema:'procurement.triage-unit-id@2', mediaType:unit.mediaType, contentProfile:unit.contentProfile,
      structureKind:unit.structureKind, scope:unit.memberScope, materialInputForm:unit.materialInputForm, relatedScope:unit.relatedScope })
    : canonicalDigest({ schema:'procurement.triage-unit-id@1', mediaType:unit.mediaType,
      contentProfile:unit.contentProfile, structureKind:unit.structureKind, materialInputForm:unit.materialInputForm, relatedScope:unit.relatedScope,
      members:unitMembers.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  if (unit.unitId !== expectedUnitId || draft.identityMetadata.metadataDigest !== canonicalDigest(without(draft.identityMetadata, 'metadataDigest'))) {
    fail('P7_CANDIDATE_UNIT_CANONICAL', 'Triage Unit identity or metadata digest is invalid.');
  }
  requireArray(draft.relatedReferences, 'relatedReferences', 1024);
  const manifestByKey = validateManifestMemberSource(draft, unitMembers);
  let previousReference = null;
  for (const reference of draft.relatedReferences) {
    const identity = reference.identity;
    const identityMaterialKey = identity && canonicalDigest({ schema:'physical-material-identity@2', mountScopeId:identity.mountScopeId,
      inode:identity.inode, sizeBytes:identity.sizeBytes, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
      contentFingerprint:identity.contentFingerprint });
    const referenceId = identity && canonicalDigest({ schema:'procurement.related-material-reference-id@1',
      primaryMaterialKey:reference.primaryMaterialKey, role:reference.role, relatedMaterialKey:identity.materialKey,
      endpointId:reference.endpointId, location:reference.location });
    if (previousReference !== null && compareUtf8(previousReference, reference.referenceId) >= 0 ||
        !memberKeys.has(reference.primaryMaterialKey) || !identity || identity.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v2' ||
        identity.schemaVersion !== 2 || identity.fingerprintAlgorithm !== 'middle-256k-sha256' || identity.fingerprintVersion !== 1 ||
        !Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 0 || identity.materialKey !== identityMaterialKey ||
        reference.fingerprintAlgorithm !== identity.fingerprintAlgorithm || reference.fingerprintVersion !== identity.fingerprintVersion ||
        reference.contentFingerprint !== identity.contentFingerprint || reference.referenceId !== referenceId ||
        reference.associationKind !== 'exclusive' || reference.dispositionRequired !== true ||
        reference.dispositionBasisDigest !== canonicalDigest({ schema:'procurement.related-disposition-basis@1',
          referenceId:reference.referenceId,primaryMaterialKey:reference.primaryMaterialKey,role:reference.role,
          identity:reference.identity,associationEvidenceDigest:reference.associationEvidenceDigest }) ||
        reference.referenceDigest !== canonicalDigest(without(reference, 'referenceDigest'))) {
      fail('P7_CANDIDATE_RELATED_CANONICAL', 'Related References must be sorted, digested, and point into the Unit.');
    }
    previousReference = reference.referenceId;
  }
  validateContinuity(draft.seasonContinuityClaims, draft.seasonContinuityClaimSetDigest);
  validateContinuity(unit.seasonContinuityClaims, unit.seasonContinuityClaimSetDigest);
  if (!same(draft.seasonContinuityClaims, unit.seasonContinuityClaims) ||
      draft.seasonContinuityClaimSetDigest !== unit.seasonContinuityClaimSetDigest ||
      draft.mediaType !== unit.mediaType ||
      draft.contentProfile !== unit.contentProfile || draft.displayIdentity !== unit.displayIdentity ||
      !same(draft.identityMetadata, unit.identityMetadata) || draft.identityClaim.mediaType !== unit.mediaType ||
      draft.identityClaim.contentProfile !== unit.contentProfile || draft.identityClaim.structureUnitDigest !== unit.unitDigest) {
    fail('P7_CANDIDATE_DRAFT_CONTINUITY', 'Candidate Draft does not preserve Unit, Identity, Profile, or relation continuity.');
  }
  const claimPayload = Object.fromEntries(Object.entries(draft.identityClaim).filter(([key]) =>
    !['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs','claimDigest'].includes(key)));
  if (draft.identityClaim.claimDigest !== canonicalDigest(claimPayload) || draft.identityClaim.draftDigest !== draft.identityClaim.claimDigest) {
    fail('P7_CANDIDATE_IDENTITY_DIGEST', 'Identity Claim digest is invalid.');
  }
  const related = [...draft.relatedReferences].sort((a, b) => compareUtf8(a.referenceId, b.referenceId));
  if (!same(related, draft.relatedReferences) || draft.relatedReferenceSetDigest !==
      canonicalDigest({ schema:'procurement.related-reference-set@1', items:related })) {
    fail('P7_CANDIDATE_RELATED_DIGEST', 'Related Reference set is not canonical.');
  }
  const relatedDispositionItems=related.map((reference)=>({referenceId:reference.referenceId,
    primaryMaterialKey:reference.primaryMaterialKey,role:reference.role,materialKey:reference.identity.materialKey,
    dispositionBasisDigest:reference.dispositionBasisDigest}));
  if(draft.relatedDispositionScopeDigest!==canonicalDigest({schema:'procurement.related-disposition-scope@1',items:relatedDispositionItems})){
    fail('P7_CANDIDATE_RELATED_DISPOSITION_DIGEST','Related disposition scope is not canonical.');
  }
  const controls = [...unitMembers].sort((a, b) => compareUtf8(a.materialKey, b.materialKey)).map((member) => ({
    materialKey:member.materialKey, admittedControlRevision:member.admittedControlRevision,
    admittedControlProjectionDigest:member.admittedControlProjectionDigest
  }));
  if (draft.memberControlEvidenceSetDigest !== canonicalDigest({ schema:'procurement.candidate-member-control-evidence@1', items:controls })) {
    fail('P7_CANDIDATE_CONTROL_DIGEST', 'Candidate member Control Evidence set digest is invalid.');
  }
  const basisByKey = new Map((runBasisMembers || []).map((item) => [item.materialKey, item]));
  if (basisByKey.size !== unitMembers.length) fail('P7_CANDIDATE_RUN_BASIS_REQUIRED', 'Candidate Publication requires the exact immutable Run member basis.');
  const manifestDraft = draft.primaryInputManifestDraft;
  const draftMembers = [...unitMembers].sort((a, b) => compareUtf8(a.materialKey, b.materialKey)).map((member, ordinal) => ({
    ordinal, materialKey:member.materialKey, role:member.role, physicalIdentity:basisByKey.get(member.materialKey).physicalIdentity,
    sizeBytes:basisByKey.get(member.materialKey).sizeBytes,
    bindingRevision:member.bindingRevision,
    admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
    episodeClaims:member.episodeClaims
  }));
  const membersDigest = canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:draftMembers });
  if (manifestDraft.procurementRunId !== draft.procurementRunId || manifestDraft.runBasisDigest !== draft.runBasisDigest ||
      manifestDraft.structureEvidencePayloadDigest !== draft.structureEvidence.payloadDigest || manifestDraft.unitId !== unit.unitId ||
      manifestDraft.structureKind !== unit.structureKind || manifestDraft.memberCount !== draftMembers.length ||
      manifestDraft.membersDigest !== membersDigest || manifestDraft.memberSourceDigest !== unit.unitDigest) {
    fail('P7_CANDIDATE_MANIFEST_DRAFT_MISMATCH', 'Primary Input Manifest Draft does not describe the exact Unit.');
  }
  const manifestPayload = Object.fromEntries(Object.entries(manifestDraft).filter(([key]) =>
    !['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs','manifestDraftDigest'].includes(key)));
  if (manifestDraft.manifestDraftDigest !== canonicalDigest(manifestPayload) || manifestDraft.draftDigest !== manifestDraft.manifestDraftDigest) {
    fail('P7_CANDIDATE_MANIFEST_DRAFT_DIGEST', 'Primary Input Manifest Draft digest is invalid.');
  }
  if (unit.unitDigest !== canonicalDigest(without(unit, 'unitDigest'))) fail('P7_CANDIDATE_UNIT_DIGEST', 'Triage Unit digest is invalid.');
  const expectedDraftDigest = canonicalDigest(without(draft, 'draftDigest', 'candidateDraftDigest'));
  if (draft.candidateDraftDigest !== expectedDraftDigest || draft.draftDigest !== expectedDraftDigest) {
    fail('P7_CANDIDATE_DRAFT_DIGEST', 'Candidate Draft digest is invalid.');
  }
  return draft;
}

function buildAcceptanceBasis(candidatePackage) {
  const value = { schemaRef:ACCEPTANCE_BASIS_SCHEMA, schemaVersion:1, handoffContractRef:HANDOFF_CONTRACT,
    acceptanceOwnerDomain:'libra', targetContext:'libra_intake', candidatePackageId:candidatePackage.candidatePackageId,
    packageRevision:candidatePackage.packageRevision, packageDigest:candidatePackage.packageDigest,
    primaryInputManifestDigest:candidatePackage.primaryInputManifestRef.manifestDigest,
    seasonContinuityClaimSetDigest:candidatePackage.seasonContinuityClaimSetDigest,
    relatedReferenceSetDigest:candidatePackage.relatedReferenceSetDigest,
    relatedDispositionScopeDigest:candidatePackage.relatedDispositionScopeDigest,
    memberControlEvidenceSetDigest:candidatePackage.memberControlEvidenceSetDigest, acceptanceBasisDigest:'' };
  value.acceptanceBasisDigest = canonicalDigest(without(value, 'acceptanceBasisDigest'));
  return freeze(value);
}

function buildOffer(candidatePackage, acceptanceBasis = buildAcceptanceBasis(candidatePackage)) {
  const offerId = canonicalDigest({ schema:'procurement.handoff-a-offer-id@1', handoffContractRef:HANDOFF_CONTRACT,
    candidatePackageId:candidatePackage.candidatePackageId, packageRevision:candidatePackage.packageRevision,
    packageDigest:candidatePackage.packageDigest, acceptanceBasisDigest:acceptanceBasis.acceptanceBasisDigest });
  const message = { schemaRef:OFFER_MESSAGE_SCHEMA, schemaVersion:1, messageKind:'procurement_candidate_offer_available', offerId,
    candidatePackageId:candidatePackage.candidatePackageId, packageRevision:candidatePackage.packageRevision,
    packageDigest:candidatePackage.packageDigest, acceptanceBasisDigest:acceptanceBasis.acceptanceBasisDigest,
    acceptanceOwnerDomain:'libra', targetContext:'libra_intake' };
  const dedupKey = 'procurement_candidate_offer_available:' + offerId;
  const messageId = canonicalDigest({ schema:'foundation.outbox-message-id@1', producerDomain:'procurement', dedupKey });
  return freeze({ message, offerId, dedupKey, messageId });
}

function buildPublication(draft, publishedAtMs, runBasisMembers, packageRevision) {
  validateDraft(draft, runBasisMembers);
  if (!Number.isSafeInteger(publishedAtMs) || publishedAtMs < 0) fail('P7_CANDIDATE_PUBLISH_TIME', 'Publication time is invalid.');
  if (!Number.isSafeInteger(packageRevision) || packageRevision < 1) fail('P7_CANDIDATE_PACKAGE_REVISION', 'Publication requires a transaction-allocated Package revision.');
  const unit = draft.structureEvidence.unit;
  const unitMembers = candidateUnitMembers(draft);
  const basisByKey = new Map(runBasisMembers.map((item) => [item.materialKey, item]));
  const members = [...unitMembers].sort((a, b) => compareUtf8(a.materialKey, b.materialKey)).map((member, ordinal) => {
    const basis = basisByKey.get(member.materialKey);
    const value = { ordinal, materialKey:member.materialKey, role:member.role, physicalIdentity:basis.physicalIdentity,
      sizeBytes:basis.sizeBytes, bindingRevision:member.bindingRevision,
      admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
      episodeClaims:member.episodeClaims };
    return { ...value, memberDigest:canonicalDigest(value) };
  });
  const draftMembers = members.map(({ memberDigest, ...member }) => member);
  const membersDigest = canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:draftMembers });
  const manifest = { schemaRef:MANIFEST_SCHEMA, schemaVersion:1, manifestId:draft.primaryInputManifestDraft.preallocatedManifestId,
    manifestKind:'primary_input_manifest', ownerDomain:'procurement', memberCount:members.length, membersDigest, manifestDigest:'',
    publishedAtMs, structureKind:unit.structureKind, members };
  manifest.manifestDigest = canonicalDigest(without(manifest, 'manifestDigest'));
  const packageValue = { schemaRef:PACKAGE_SCHEMA, schemaVersion:1, manifestId:draft.candidatePackageId,
    manifestKind:'candidate_package', ownerDomain:'procurement', memberCount:members.length, membersDigest,
    manifestDigest:'', publishedAtMs, candidatePackageId:draft.candidatePackageId, packageRevision,
    procurementRunId:draft.procurementRunId, runBasisDigest:draft.runBasisDigest, triageRule:draft.triageRule,
    materialFieldContextRef:draft.materialFieldContextRef, mediaType:draft.mediaType, contentProfile:draft.contentProfile, materialInputForm:draft.materialInputForm,
    displayIdentity:draft.displayIdentity, identityMetadata:draft.identityMetadata, identityClaim:draft.identityClaim,
    structureEvidenceRef:{ evidenceId:draft.structureEvidence.evidenceId, payloadDigest:draft.structureEvidence.payloadDigest,
      unitId:unit.unitId, unitDigest:unit.unitDigest }, seasonContinuityClaims:draft.seasonContinuityClaims,
    seasonContinuityClaimSetDigest:draft.seasonContinuityClaimSetDigest,
    primaryInputManifestRef:{ manifestId:manifest.manifestId, manifestDigest:manifest.manifestDigest, memberCount:members.length },
    relatedReferences:draft.relatedReferences, relatedReferenceSetDigest:draft.relatedReferenceSetDigest,
    relatedDispositionScopeDigest:draft.relatedDispositionScopeDigest,
    memberControlEvidenceSetDigest:draft.memberControlEvidenceSetDigest, packageDigest:'' };
  packageValue.packageDigest = canonicalDigest(without(packageValue, 'manifestDigest', 'packageDigest'));
  packageValue.manifestDigest = packageValue.packageDigest;
  const basis = buildAcceptanceBasis(packageValue);
  const offer = buildOffer(packageValue, basis);
  return freeze({ manifest, candidatePackage:packageValue, acceptanceBasis:basis, offerMessage:offer.message,
    offerId:offer.offerId, dedupKey:offer.dedupKey, messageId:offer.messageId });
}

function buildPublicationReceipt(publication, draft, committedAtMs) {
  const candidatePackage = publication.candidatePackage;
  const value = { schemaRef:RECEIPT_SCHEMA, schemaVersion:1,
    receiptId:canonicalDigest({ schema:'procurement.candidate-publication-receipt-id@1',
      candidatePackageId:candidatePackage.candidatePackageId, packageRevision:candidatePackage.packageRevision }),
    receiptKind:'procurement_candidate_published', ownerDomain:'procurement', scopeType:'candidate_package',
    scopeId:candidatePackage.candidatePackageId, scopeDigest:draft.candidateDraftDigest, effectReceiptRef:null, committedAtMs,
    candidateDraftDigest:draft.candidateDraftDigest, candidatePackageId:candidatePackage.candidatePackageId,
    packageRevision:candidatePackage.packageRevision, packageDigest:candidatePackage.packageDigest,
    primaryInputManifestDigest:candidatePackage.primaryInputManifestRef.manifestDigest,
    relatedReferenceSetDigest:candidatePackage.relatedReferenceSetDigest,
    relatedDispositionScopeDigest:candidatePackage.relatedDispositionScopeDigest,
    memberControlEvidenceSetDigest:candidatePackage.memberControlEvidenceSetDigest,
    acceptanceBasisDigest:publication.acceptanceBasis.acceptanceBasisDigest, offerId:publication.offerId, receiptDigest:'' };
  value.receiptDigest = canonicalDigest(without(value, 'receiptDigest'));
  return freeze(value);
}

module.exports = Object.freeze({ ACCEPTANCE_BASIS_SCHEMA, CandidatePublicationContractError, MANIFEST_SCHEMA,
  OFFER_MESSAGE_SCHEMA, PACKAGE_SCHEMA, RECEIPT_SCHEMA, buildAcceptanceBasis, buildOffer, buildPublication,
  buildPublicationReceipt, validateDraft });
