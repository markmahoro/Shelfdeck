'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const PACKAGE_SCHEMA = 'helix://contracts/types/CandidatePackage/v1';
const MANIFEST_SCHEMA = 'helix://contracts/types/PrimaryInputManifest/v1';
const ACCEPTANCE_BASIS_SCHEMA = 'helix://contracts/types/CandidateIntakeAcceptanceBasis/v1';
const OFFER_MESSAGE_SCHEMA = 'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1';
const HANDOFF_CONTRACT = 'helix://handoffs/procurement-to-libra/v1';
const CLAIM_KINDS = new Set(['provider_season_identity', 'triage_grouping_lineage']);

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

function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !Number.isSafeInteger(draft.expectedPackageRevision) ||
      draft.expectedPackageRevision < 1 || !draft.structureEvidence || !draft.structureEvidence.unit || !draft.primaryInputManifestDraft) {
    fail('P7_CANDIDATE_DRAFT_INVALID', 'Candidate Draft is incomplete.');
  }
  const unit = draft.structureEvidence.unit;
  requireArray(unit.members, 'structureEvidence.unit.members', 1024, 1);
  requireArray(unit.relatedReferences, 'structureEvidence.unit.relatedReferences', 1024);
  let previousMember = null;
  const memberKeys = new Set();
  for (const member of unit.members) {
    if (previousMember !== null && compareUtf8(previousMember, member.materialKey) >= 0 || memberKeys.has(member.materialKey) ||
        member.memberClaimDigest !== canonicalDigest(without(member, 'memberClaimDigest'))) {
      fail('P7_CANDIDATE_MEMBER_CANONICAL', 'Triage Unit members must be uniquely sorted with exact digests.');
    }
    previousMember = member.materialKey; memberKeys.add(member.materialKey);
    requireArray(member.episodeClaims, 'member.episodeClaims', 32, unit.contentProfile === 'series' && member.role === 'primary_payload' ? 1 : 0);
    let previousEpisode = null;
    for (const episode of member.episodeClaims) {
      if (previousEpisode !== null && compareUtf8(previousEpisode, episode.episodeKey) >= 0 ||
          episode.claimDigest !== canonicalDigest(without(episode, 'claimDigest'))) {
        fail('P7_CANDIDATE_EPISODE_CANONICAL', 'Episode Claims must be uniquely sorted with exact digests.');
      }
      previousEpisode = episode.episodeKey;
    }
  }
  const expectedUnitId = canonicalDigest({ schema:'procurement.triage-unit-id@1', mediaType:unit.mediaType,
    contentProfile:unit.contentProfile, structureKind:unit.structureKind,
    members:unit.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  if (unit.unitId !== expectedUnitId || draft.identityMetadata.metadataDigest !== canonicalDigest(without(draft.identityMetadata, 'metadataDigest'))) {
    fail('P7_CANDIDATE_UNIT_CANONICAL', 'Triage Unit identity or metadata digest is invalid.');
  }
  let previousReference = null;
  for (const reference of unit.relatedReferences) {
    if (previousReference !== null && compareUtf8(previousReference, reference.referenceId) >= 0 ||
        !memberKeys.has(reference.primaryMaterialKey) || reference.referenceDigest !== canonicalDigest(without(reference, 'referenceDigest'))) {
      fail('P7_CANDIDATE_RELATED_CANONICAL', 'Related References must be sorted, digested, and point into the Unit.');
    }
    previousReference = reference.referenceId;
  }
  validateContinuity(draft.seasonContinuityClaims, draft.seasonContinuityClaimSetDigest);
  validateContinuity(unit.seasonContinuityClaims, unit.seasonContinuityClaimSetDigest);
  if (!same(draft.seasonContinuityClaims, unit.seasonContinuityClaims) ||
      draft.seasonContinuityClaimSetDigest !== unit.seasonContinuityClaimSetDigest ||
      !same(draft.relatedReferences, unit.relatedReferences) || draft.mediaType !== unit.mediaType ||
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
  const controls = [...unit.members].sort((a, b) => compareUtf8(a.materialKey, b.materialKey)).map((member) => ({
    materialKey:member.materialKey, admittedControlRevision:member.admittedControlRevision,
    admittedControlProjectionDigest:member.admittedControlProjectionDigest
  }));
  if (draft.memberControlEvidenceSetDigest !== canonicalDigest({ schema:'procurement.candidate-member-control-evidence@1', items:controls })) {
    fail('P7_CANDIDATE_CONTROL_DIGEST', 'Candidate member Control Evidence set digest is invalid.');
  }
  const manifestDraft = draft.primaryInputManifestDraft;
  const draftMembers = [...unit.members].sort((a, b) => compareUtf8(a.materialKey, b.materialKey)).map((member, ordinal) => ({
    ordinal, materialKey:member.materialKey, role:member.role, bindingRevision:member.bindingRevision,
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

function buildPublication(draft, publishedAtMs) {
  validateDraft(draft);
  if (!Number.isSafeInteger(publishedAtMs) || publishedAtMs < 0) fail('P7_CANDIDATE_PUBLISH_TIME', 'Publication time is invalid.');
  const unit = draft.structureEvidence.unit;
  const members = [...unit.members].sort((a, b) => compareUtf8(a.materialKey, b.materialKey)).map((member, ordinal) => {
    const value = { ordinal, materialKey:member.materialKey, role:member.role, bindingRevision:member.bindingRevision,
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
    manifestDigest:'', publishedAtMs, candidatePackageId:draft.candidatePackageId, packageRevision:draft.expectedPackageRevision,
    procurementRunId:draft.procurementRunId, runBasisDigest:draft.runBasisDigest, triageRule:draft.triageRule,
    materialFieldContextRef:draft.materialFieldContextRef, mediaType:draft.mediaType, contentProfile:draft.contentProfile,
    displayIdentity:draft.displayIdentity, identityMetadata:draft.identityMetadata, identityClaim:draft.identityClaim,
    structureEvidenceRef:{ evidenceId:draft.structureEvidence.evidenceId, payloadDigest:draft.structureEvidence.payloadDigest,
      unitId:unit.unitId, unitDigest:unit.unitDigest }, seasonContinuityClaims:draft.seasonContinuityClaims,
    seasonContinuityClaimSetDigest:draft.seasonContinuityClaimSetDigest,
    primaryInputManifestRef:{ manifestId:manifest.manifestId, manifestDigest:manifest.manifestDigest, memberCount:members.length },
    relatedReferences:draft.relatedReferences, relatedReferenceSetDigest:draft.relatedReferenceSetDigest,
    memberControlEvidenceSetDigest:draft.memberControlEvidenceSetDigest, packageDigest:'' };
  packageValue.packageDigest = canonicalDigest(without(packageValue, 'manifestDigest', 'packageDigest'));
  packageValue.manifestDigest = packageValue.packageDigest;
  const basis = { schemaRef:ACCEPTANCE_BASIS_SCHEMA, schemaVersion:1, handoffContractRef:HANDOFF_CONTRACT,
    acceptanceOwnerDomain:'libra', targetContext:'libra_intake', candidatePackageId:packageValue.candidatePackageId,
    packageRevision:packageValue.packageRevision, packageDigest:packageValue.packageDigest,
    primaryInputManifestDigest:manifest.manifestDigest, seasonContinuityClaimSetDigest:packageValue.seasonContinuityClaimSetDigest,
    relatedReferenceSetDigest:packageValue.relatedReferenceSetDigest,
    memberControlEvidenceSetDigest:packageValue.memberControlEvidenceSetDigest, acceptanceBasisDigest:'' };
  basis.acceptanceBasisDigest = canonicalDigest(without(basis, 'acceptanceBasisDigest'));
  const offerId = canonicalDigest({ schema:'procurement.handoff-a-offer-id@1', handoffContractRef:HANDOFF_CONTRACT,
    candidatePackageId:packageValue.candidatePackageId, packageRevision:packageValue.packageRevision,
    packageDigest:packageValue.packageDigest, acceptanceBasisDigest:basis.acceptanceBasisDigest });
  const message = { schemaRef:OFFER_MESSAGE_SCHEMA, schemaVersion:1, messageKind:'procurement_candidate_offer_available', offerId,
    candidatePackageId:packageValue.candidatePackageId, packageRevision:packageValue.packageRevision,
    packageDigest:packageValue.packageDigest, acceptanceBasisDigest:basis.acceptanceBasisDigest,
    acceptanceOwnerDomain:'libra', targetContext:'libra_intake' };
  const dedupKey = 'procurement_candidate_offer_available:' + offerId;
  const messageId = canonicalDigest({ schema:'foundation.outbox-message-id@1', producerDomain:'procurement', dedupKey });
  return freeze({ manifest, candidatePackage:packageValue, acceptanceBasis:basis, offerMessage:message, offerId, dedupKey, messageId });
}

module.exports = Object.freeze({ ACCEPTANCE_BASIS_SCHEMA, CandidatePublicationContractError, MANIFEST_SCHEMA,
  OFFER_MESSAGE_SCHEMA, PACKAGE_SCHEMA, buildPublication, validateDraft });
