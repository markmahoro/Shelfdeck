'use strict';
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
// Owner-state setup for Arca proof/rollback tests, not a People execution
// adapter. Formal Work, maintenance and transport qualification use real Hosts.
function seedCandidate(store,input){
  const libraryKind=input.contentProfile==='jav'?'jav':'normal',evidenceDigest=input.evidenceDigest||D(input),
    candidatePayload={libraryKind,proposedName:input.displayName,aliases:[],referenceHints:[],providerIdentities:(input.providerIdentities||[]).map(identity=>({
      ...identity,provenanceDigest:identity.provenanceDigest||D({evidenceDigest,identity})}))},
    body={schemaRef:'helix://contracts/types/PeopleCandidateDraft/v1',schemaVersion:1,draftId:'fixture-candidate-'+evidenceDigest,
      draftKind:'people-candidate',basisDigest:evidenceDigest,producedAtMs:1,candidateKind:'registration',evidenceDigest,candidatePayload,candidatePayloadDigest:D(candidatePayload)};
  return store.openCandidate({candidateId:body.draftId,draft:{...body,draftDigest:D(body)}});
}
function seedPerson(store,input,{historical=false}={}){
  const candidate=seedCandidate(store,input);
  if(!historical&&!candidate.candidatePayload.providerIdentities.length)throw new Error('Strong fixture Person requires explicit Provider identity.');
  const body={decisionId:'fixture-accept-'+candidate.candidateId,candidateKind:'registration',candidateId:candidate.candidateId,
    expectedCandidateRevision:candidate.currentRevision,candidatePayloadDigest:candidate.candidatePayloadDigest,newPersonId:'fixture-person-'+D(candidate.candidateId),
    decisionOrigin:historical?'user':'strong_identity_rule',...(historical?{actorId:'historical-fixture-admin'}:{ruleRevision:1})};
  return store.acceptRegistrationCandidate({...body,decisionDigest:D(body)});
}
module.exports=Object.freeze({seedCandidate,seedPerson});
