'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { utf8Compare } = require('../model/libra-intake-contracts');

class SubjectContinuityResolverError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'SubjectContinuityResolverError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new SubjectContinuityResolverError(code, message, details); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Value does not match its closed continuity resolution input.');
}
function claimKey(claim) { return [claim.claimKind,claim.claimNamespace,claim.claimKey].join('\0'); }
function episodeScope(snapshot) {
  const structureKind=snapshot.primaryInputManifest.structureKind;
  const keys=structureKind === 'single' ? [] : [...new Set(snapshot.primaryMaterialDeliveries
    .filter((item) => item.role === 'primary_payload').flatMap((item) => item.episodeClaims.map((claim) => claim.episodeKey)))].sort(utf8Compare);
  if (structureKind === 'season' && keys.length === 0) fail('P8_CONTINUITY_EPISODE_SCOPE', 'Season Candidate requires a non-empty Episode scope.');
  return Object.freeze({ structureKind,episodeKeys:Object.freeze(keys),episodeScopeDigest:canonicalDigest({
    schema:'libra.candidate-episode-scope@1',structureKind,episodeKeys:keys }) });
}
function witness(subject, candidateClaims) {
  if (subject.status !== 'active' || !Number.isSafeInteger(subject.intakeRevision) || subject.intakeRevision < 1 ||
      !Array.isArray(subject.continuityClaims) || !Array.isArray(subject.episodeKeys)) {
    fail('P8_CONTINUITY_SUBJECT_SNAPSHOT', 'Matched Subject snapshot is incomplete or inactive.');
  }
  const candidates=new Map(candidateClaims.map((claim) => [claimKey(claim),claim]));
  const exactMatches=subject.continuityClaims.filter((claim) => candidates.has(claimKey(claim)))
    .sort((a,b) => utf8Compare(claimKey(a),claimKey(b)) || utf8Compare(a.provenanceRef,b.provenanceRef));
  if (exactMatches.length === 0) fail('P8_CONTINUITY_FALSE_MATCH', 'Subject snapshot has no exact Candidate continuity match.');
  const subjectClaim=exactMatches[0], candidateClaim=candidates.get(claimKey(subjectClaim));
  const value={ subjectId:subject.subjectId,expectedSubjectStatus:'active',expectedSubjectIntakeRevision:subject.intakeRevision,
    expectedSubjectContinuitySetDigest:subject.continuitySetDigest,expectedSubjectEpisodeScopeDigest:subject.episodeScopeDigest,
    claimKind:candidateClaim.claimKind,claimNamespace:candidateClaim.claimNamespace,claimKey:candidateClaim.claimKey,
    candidateClaimDigest:candidateClaim.claimDigest,subjectClaimDigest:subjectClaim.claimDigest,
    subjectClaimProvenanceKind:subjectClaim.provenanceKind,subjectClaimProvenanceRef:subjectClaim.provenanceRef };
  return { ...value,witnessDigest:canonicalDigest({ schema:'libra.subject-match-witness@1',...value }) };
}

function createSubjectContinuityResolver(options) {
  if (!options || typeof options.allocateDecisionId !== 'function' || typeof options.allocateSubjectId !== 'function') {
    fail('P8_CONTINUITY_RESOLVER_DEPENDENCIES', 'Libra-owned Decision and Subject allocators are required.');
  }
  return Object.freeze({ resolve(input) {
    exact(input,['snapshot','expectedContinuityHead','matchedSubjects'],'P8_CONTINUITY_INPUT_SHAPE');
    const { snapshot,expectedContinuityHead }=input;
    if (!snapshot || snapshot.snapshotContract !== 'procurement.candidate-delivery@1' ||
        !expectedContinuityHead || !Number.isSafeInteger(expectedContinuityHead.revision) || expectedContinuityHead.revision < 0) {
      fail('P8_CONTINUITY_INPUT', 'Candidate Delivery Snapshot and global continuity head are required.');
    }
    const candidateClaims=snapshot.candidatePackage.seasonContinuityClaims;
    if (!Array.isArray(candidateClaims) || snapshot.candidatePackage.seasonContinuityClaimSetDigest !==
        canonicalDigest({ schema:'season-continuity-claim-set@1',items:candidateClaims })) {
      fail('P8_CONTINUITY_CANDIDATE_CLAIMS', 'Candidate continuity set is not canonical.');
    }
    const subjectMap=new Map();
    for (const subject of input.matchedSubjects) {
      if (subjectMap.has(subject.subjectId)) fail('P8_CONTINUITY_DUPLICATE_SUBJECT', 'Matched Subject IDs must be unique.');
      subjectMap.set(subject.subjectId,subject);
    }
    const ordered=[...subjectMap.values()].sort((a,b) => utf8Compare(a.subjectId,b.subjectId));
    const cardinality=ordered.length === 0 ? 'none' : ordered.length === 1 ? 'one' : 'multiple';
    const witnesses=ordered.slice(0,2).map((subject,ordinal) => Object.freeze({ ordinal,...witness(subject,candidateClaims) }));
    const matchedSubjectSetDigest=canonicalDigest({ schema:'libra.subject-match-witness-set@1',matchCardinality:cardinality,items:witnesses });
    const candidateEpisodeScope=episodeScope(snapshot);
    let overlapEvaluation='not_applicable_no_match',targetSubjectId,overlapping=[];
    if (cardinality === 'multiple') overlapEvaluation='not_applicable_multiple';
    if (cardinality === 'one') {
      overlapEvaluation='evaluated'; targetSubjectId=ordered[0].subjectId;
      const existing=new Set(ordered[0].episodeKeys); overlapping=candidateEpisodeScope.episodeKeys.filter((key) => existing.has(key));
    }
    const episodeOverlapDigest=canonicalDigest({ schema:'libra.episode-overlap@1',
      targetSubjectId:targetSubjectId || null,overlapEvaluation,episodeKeys:overlapping });
    const resolution=cardinality === 'one' && overlapping.length === 0 ? 'season_extension' : 'new_subject';
    const value={ decisionId:options.allocateDecisionId(),offerId:snapshot.offer.offerId,
      candidatePackageId:snapshot.candidatePackage.candidatePackageId,packageRevision:snapshot.candidatePackage.packageRevision,
      packageDigest:snapshot.candidatePackage.packageDigest,candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,
      expectedContinuityHead:Object.freeze({ ...expectedContinuityHead }),candidateContinuityClaims:Object.freeze([...candidateClaims]),
      candidateContinuitySetDigest:snapshot.candidatePackage.seasonContinuityClaimSetDigest,candidateEpisodeScope,
      matchCardinality:cardinality,matchWitnesses:Object.freeze(witnesses),matchedSubjectSetDigest,overlapEvaluation,
      overlappingEpisodeKeys:Object.freeze(overlapping),episodeOverlapDigest,result:resolution };
    if (resolution === 'season_extension') {
      const subject=ordered[0]; Object.assign(value,{ targetSubjectId:subject.subjectId,expectedTargetStatus:'active',
        expectedTargetIntakeRevision:subject.intakeRevision,expectedTargetContinuitySetDigest:subject.continuitySetDigest,
        expectedTargetEpisodeScopeDigest:subject.episodeScopeDigest });
    } else value.allocatedSubjectId=options.allocateSubjectId();
    value.decisionDigest=canonicalDigest(value);
    if (Buffer.byteLength(canonicalJson(value),'utf8') > 128 * 1024) fail('P8_CONTINUITY_DECISION_TOO_LARGE', 'Continuity Decision exceeds 128 KiB.');
    return Object.freeze(value);
  } });
}

module.exports=Object.freeze({ SubjectContinuityResolverError, createSubjectContinuityResolver, episodeScope });
