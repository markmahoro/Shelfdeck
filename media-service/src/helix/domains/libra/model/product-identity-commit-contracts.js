'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildProductFactHandle, buildResolvedProductIdentity } = require('./product-fact-contracts');

function fail(message) { throw new TypeError(message); }

const SOURCE_EDITION_TOKEN = /(?:2160p|1080p|720p|480p|4k|uhd|hevc|h\.?265|h\.?264|x265|x264|atmos|truehd|ddp|bluray|blu-ray|bdmv|remux|web-?dl)/i;

function editionFromSourceDisplay(sourceDisplay, title, year) {
  const raw = String(sourceDisplay || '').trim();
  const cleanedTitle = String(title || '').trim();
  if (!raw || !cleanedTitle) return null;
  const yearText = year === null || year === undefined || year === '' ? '' : String(year);
  const titleYear = yearText ? cleanedTitle + ' (' + yearText + ')' : cleanedTitle;
  let rest = raw;
  if (rest.startsWith(titleYear)) rest = rest.slice(titleYear.length);
  else if (rest.startsWith(cleanedTitle)) rest = rest.slice(cleanedTitle.length);
  else return null;
  rest = rest.replace(/^\s*[\(\uff08]\d{4}[\)\uff09]/, '').replace(/^\s*[-–—]\s*/, '').trim();
  if (!rest || rest === raw || !SOURCE_EDITION_TOKEN.test(rest)) return null;
  return rest;
}

function providerFact(decisionEvidence,sourceResultItem) {
  const query=decisionEvidence?.queryResults?.[0],observation=sourceResultItem?.result;
  if(!query||decisionEvidence.queryResults.length!==1||!sourceResultItem||
      sourceResultItem.capabilityRef!=='libra.product_identity.evidence.observe@1'||
      sourceResultItem.resultSchemaRef!=='helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result'||
      query.queryContract!==sourceResultItem.capabilityRef||query.resultDigest!==sourceResultItem.resultDigest||
      query.evidenceId!==observation?.observationId||query.inputDigest!==canonicalDigest(observation?.intentId)||
      query.payloadDigest!==observation?.observationDigest||observation.result!=='resolved'||
      observation.subjectId!==decisionEvidence.subjectId)fail('Product Identity Decision Evidence does not resolve to its exact provider Observation.');
  const identity=observation.verifiedIdentity;
  if(!identity||identity.provider!=='tmdb'||identity.namespace!=='tmdb_movie')
    fail('Movie Product Identity requires one exact TMDB movie identity.');
  return identity;
}

function buildProductIdentityCommitBundle(value) {
  const {snapshot,identityClaim,decisionEvidence,productStructure,sourceResultItem,eventFenceDigest}=value;
  if(!snapshot?.run||snapshot.run.libraRunId!==value.libraRunId||snapshot.run.subjectId!==decisionEvidence?.subjectId||
      identityClaim?.contentProfile!=='movie'||identityClaim.claimKind!=='movie_title'||
      productStructure?.subjectId!==snapshot.run.subjectId||productStructure.structureKind!=='single'||
      decisionEvidence.digest!==canonicalDigest(Object.fromEntries(Object.entries(decisionEvidence).filter(([key])=>key!=='digest'))))
    fail('Product Identity immutable input scope is invalid.');
  const fact=providerFact(decisionEvidence,sourceResultItem);
  const displayTitle=String(fact.displayTitle||'').trim();
  if(!displayTitle)fail('Resolved Product Identity does not carry a provider display title.');
  const displayEntries=[{key:'title',value:displayTitle},
    {key:'tmdb_movie_id',value:fact.providerKey}];
  if(Number.isSafeInteger(fact.releaseYear))displayEntries.push({key:'year',value:String(fact.releaseYear)});
  else if(identityClaim.claimedYear)displayEntries.push({key:'year',value:identityClaim.claimedYear});
  const editionYear=Number.isSafeInteger(fact.releaseYear)?fact.releaseYear:identityClaim.claimedYear;
  const edition=editionFromSourceDisplay(identityClaim.displayIdentity||identityClaim.claimedTitle,displayTitle,editionYear);
  if(edition)displayEntries.push({key:'edition',value:edition});
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
    item.capabilityRef==='libra.product_identity.evidence.observe@1'&&item.resultDigest===query?.resultDigest&&
    item.result?.observationId===query?.evidenceId);
  if(matches.length!==1)fail('Product Identity provider Observation cannot be dereferenced uniquely.');
  return matches[0];
}

module.exports=Object.freeze({buildProductIdentityCommitBundle,editionFromSourceDisplay,findProductIdentitySourceResult,providerFact});
