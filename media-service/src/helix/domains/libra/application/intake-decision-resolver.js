'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createLibraIntakeStore } = require('../persistence/libra-intake-store');
const { createSubjectContinuityResolver } = require('./subject-continuity-resolver');

function stableId(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function claim(row) { return Object.freeze({ claimKind:row.claim_kind, claimNamespace:row.claim_namespace,
  claimKey:row.claim_key, claimDigest:row.claim_digest, provenanceKind:row.provenance_kind, provenanceRef:row.provenance_ref }); }

function createIntakeDecisionResolver(options) {
  const store = createLibraIntakeStore(options);
  function subject(subjectId) {
    const row = store.getSubject(subjectId);
    if (!row) return null;
    return Object.freeze({ subjectId:row.subject_id, status:row.status, intakeRevision:Number(row.intake_revision),
      continuitySetDigest:row.current_continuity_set_digest, episodeScopeDigest:row.current_episode_scope_digest,
      continuityClaims:Object.freeze(store.listSubjectClaims(subjectId).map(claim)),
      episodeKeys:Object.freeze(store.listSubjectEpisodes(subjectId).map((item) => item.episode_key).sort()) });
  }
  return Object.freeze({
    resolve(snapshot) {
      const ids = new Set();
      for (const item of snapshot.candidatePackage.seasonContinuityClaims) {
        for (const row of store.findActiveContinuityMatches(item)) ids.add(row.subject_id);
      }
      const head = store.ensureContinuityHead();
      return createSubjectContinuityResolver({
        allocateDecisionId:() => canonicalDigest({ schema:'libra.intake-decision-id@1', offerId:snapshot.offer.offerId }),
        allocateSubjectId:() => stableId('libra-subject-', { offerId:snapshot.offer.offerId,
          packageDigest:snapshot.candidatePackage.packageDigest })
      }).resolve({ snapshot, expectedContinuityHead:Object.freeze({ revision:Number(head.current_revision), digest:head.head_digest }),
        matchedSubjects:Object.freeze([...ids].sort().map(subject).filter(Boolean)) });
    }
  });
}

module.exports = Object.freeze({ createIntakeDecisionResolver });
