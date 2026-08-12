'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildProductFactHandle, buildResolvedProductIdentity } = require('./product-fact-contracts');

function fail(message) { throw new TypeError(message); }

function providerFact(decisionEvidence,sourceResultItem) {
  const query=decisionEvidence?.queryResults?.[0],observation=sourceResultItem?.result;
  if(!query||decisionEvidence.queryResults.length!==1||!sourceResultItem||
      sourceResultItem.capabilityRef!=='libra.routing.fact.observe@1'||
      sourceResultItem.resultSchemaRef!=='helix://contracts/capabilities/libra.routing.fact.observe/v1/result'||
      query.queryContract!==sourceResultItem.capabilityRef||query.resultDigest!==sourceResultItem.resultDigest||
      query.evidenceId!==observation?.observationId||query.inputDigest!==observation?.intentId||
      query.payloadDigest!==observation?.observationDigest||observation.result!=='observed'||
      observation.subjectId!==decisionEvidence.subjectId)fail('Product Identity Decision Evidence does not resolve to its exact provider Observation.');
  const facts=observation.facts.filter((item)=>item.factKind==='resolved_provider_identity');
  if(facts.length!==1||facts[0].provider!=='tmdb'||facts[0].namespace!=='tmdb_movie')
    fail('Movie Product Identity requires one exact TMDB movie identity.');
  return facts[0];
}

function buildProductIdentityCommitBundle(value) {
  const {snapshot,identityClaim,decisionEvidence,productStructure,sourceResultItem,eventFenceDigest}=value;
  if(!snapshot?.run||snapshot.run.libraRunId!==value.libraRunId||snapshot.run.subjectId!==decisionEvidence?.subjectId||
      identityClaim?.contentProfile!=='movie'||identityClaim.claimKind!=='movie_title'||
      productStructure?.subjectId!==snapshot.run.subjectId||productStructure.structureKind!=='single'||
      decisionEvidence.digest!==canonicalDigest(Object.fromEntries(Object.entries(decisionEvidence).filter(([key])=>key!=='digest'))))
    fail('Product Identity immutable input scope is invalid.');
  const fact=providerFact(decisionEvidence,sourceResultItem);
  const displayEntries=[{key:'title',value:identityClaim.displayIdentity||identityClaim.claimedTitle},
    {key:'tmdb_movie_id',value:fact.providerKey}];
  if(identityClaim.claimedYear)displayEntries.push({key:'year',value:identityClaim.claimedYear});
  const resolvedProductIdentity=buildResolvedProductIdentity({producerRef:'libra.product_identity.resolve@1',
    basisDigest:decisionEvidence.digest,observedAtMs:0,subjectId:snapshot.run.subjectId,structureKind:'single',contentProfile:'movie',
    identityKind:'tmdb_movie',providerIdentities:[{provider:'tmdb',namespace:'tmdb_movie',providerKey:fact.providerKey,seasonNumber:null}],
    exactSeasonContinuityClaims:[],displayEntries});
  const expectedRevision=value.expectedRevision??0;
  const productFactId=canonicalDigest({schema:'libra.product-fact-id@1',libraRunId:value.libraRunId,
    factKind:'resolved_identity',factRevision:expectedRevision+1});
  if(!sourceResultItem.evidence||sourceResultItem.evidence.payloadDigest!==sourceResultItem.resultDigest)
    fail('Product Identity source Event Evidence does not bind its complete Result.');
  const sourceReference={schema:'libra.product-fact-source-ref@1',productFactId,ordinal:0,
    sourceBasisKind:'decision_evidence',workId:sourceResultItem.workId,attemptId:sourceResultItem.attemptId,
    planId:sourceResultItem.planId,eventId:sourceResultItem.eventId,resultId:sourceResultItem.resultId,
    capabilityRef:sourceResultItem.capabilityRef,resultSchemaRef:sourceResultItem.resultSchemaRef,
    resultDigest:sourceResultItem.resultDigest,sourceRef:decisionEvidence.objectId,sourceOrder:0,
    evidenceId:sourceResultItem.evidence.evidenceId,evidenceDigest:sourceResultItem.evidence.payloadDigest,
    inputBindingDigest:sourceResultItem.inputBindingDigest};
  const resolutionRef={workId:sourceReference.workId,attemptId:sourceReference.attemptId,planId:sourceReference.planId,
    eventId:sourceReference.eventId,resultId:sourceReference.resultId,resultDigest:sourceReference.resultDigest,
    inputBindingDigest:sourceReference.inputBindingDigest,evidenceId:sourceReference.evidenceId,
    evidenceDigest:sourceReference.evidenceDigest,observationId:sourceResultItem.result.observationId,
    decisionEvidenceId:decisionEvidence.objectId,decisionEvidenceDigest:decisionEvidence.digest,
    sourceReferenceDigest:canonicalDigest(sourceReference)};
  const sourceBasis=Object.freeze({sourceBasisKind:'decision_evidence',libraRunId:value.libraRunId,
    decisionEvidenceId:decisionEvidence.objectId,decisionEvidenceDigest:decisionEvidence.digest,
    resolutionRef:Object.freeze(resolutionRef),sourceBasisDigest:resolvedProductIdentity.basisDigest});
  const payload=Object.freeze({schema:'libra.resolved-product-identity-commit-payload@1',sourceBasis,
    resolvedProductIdentity});
  const handle=buildProductFactHandle({libraRunId:value.libraRunId,factKind:'resolved_identity',expectedRevision,
    payloadDigest:canonicalDigest(payload),eventFenceDigest});
  return Object.freeze({providerFact:Object.freeze(fact),resolvedProductIdentity,sourceBasis,payload,handle,
    bundleDigest:canonicalDigest({identityDigest:resolvedProductIdentity.identityDigest,sourceBasisDigest:sourceBasis.sourceBasisDigest,
      payloadDigest:handle.payloadDigest,handleId:handle.handleId})});
}

function findProductIdentitySourceResult(workResultReader,workId,decisionEvidence,processScope=null) {
  const query=decisionEvidence?.queryResults?.[0];
  const workIds=new Set([workId]);
  if(processScope&&typeof workResultReader.listWorks==='function')for(const work of workResultReader.listWorks({
    ownerDomain:'libra',processType:'libra_run',processId:processScope.processId,workKind:'product_identity'}))workIds.add(work.work_id);
  const matches=[...workIds].flatMap((candidateWorkId)=>workResultReader.read(candidateWorkId)).filter((item)=>item.outcomeKind==='succeeded'&&
    item.capabilityRef==='libra.routing.fact.observe@1'&&item.resultDigest===query?.resultDigest&&
    item.result?.observationId===query?.evidenceId);
  if(matches.length!==1)fail('Product Identity provider Observation cannot be dereferenced uniquely.');
  return matches[0];
}

module.exports=Object.freeze({buildProductIdentityCommitBundle,findProductIdentitySourceResult,providerFact});
