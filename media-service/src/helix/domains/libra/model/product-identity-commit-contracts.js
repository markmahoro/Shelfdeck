'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildProductFactHandle, buildResolvedProductIdentity } = require('./product-fact-contracts');
const { buildProviderSeasonContinuityClaim, frozenSeriesSeasonNumber } = require('./series-identity-contracts');

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

function providerFact(decisionEvidence,sourceResultItem,contentProfile='movie',seasonNumber=null) {
  const query=decisionEvidence?.queryResults?.[0],observation=sourceResultItem?.result;
  if(!query||decisionEvidence.queryResults.length!==1||!sourceResultItem||
      sourceResultItem.capabilityRef!=='libra.product_identity.evidence.observe@1'||
      sourceResultItem.resultSchemaRef!=='helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result'||
      query.queryContract!==sourceResultItem.capabilityRef||query.resultDigest!==sourceResultItem.resultDigest||
      query.evidenceId!==observation?.observationId||query.inputDigest!==canonicalDigest(observation?.intentId)||
      query.payloadDigest!==observation?.observationDigest||observation.result!=='resolved'||
      observation.subjectId!==decisionEvidence.subjectId)fail('Product Identity Decision Evidence does not resolve to its exact provider Observation.');
  const identity=observation.verifiedIdentity;
  const series=contentProfile==='series';
  if(contentProfile==='western_adult'){
    if(!identity||identity.provider!=='internal'||identity.namespace!=='internal_identity'||observation.contentProfile!=='western_adult'||observation.sourceKind!=='internal_source'||
      canonicalDigest(observation)!==sourceResultItem.resultDigest||identity.identityDigest!==canonicalDigest(Object.fromEntries(Object.entries(identity).filter(([key])=>key!=='identityDigest'))))
      fail('US Adult identity requires its exact internal source Observation.');
    const original=require('../../../contracts/us-adult-presentation').originalNameProvenance(observation.originalName?.originalFileName);
    if(original.provenanceDigest!==observation.originalName.provenanceDigest)fail('US Adult original name provenance is invalid.');
    return identity;
  }
  if(contentProfile==='jav') {
    const qualification=observation.qualificationObservation,source=observation.sourceSnapshot?.sources?.[observation.sourceOrdinal];
    if(!identity || identity.provider!=='jav' || identity.namespace!=='jav_code' || observation.contentProfile!=='jav' ||
        !source || qualification?.result!=='qualified' || qualification.siteRef!==source.siteRef ||
        identity.providerKey!==observation.sourceSnapshot.queryAnchor.javCode || identity.providerKey!==qualification.resolvedProviderIdentity?.providerKey ||
        identity.displayTitle!==qualification.descriptiveEntries.find(entry=>entry.key==='title')?.value ||
        canonicalDigest(observation)!==sourceResultItem.resultDigest ||
        identity.identityDigest!==canonicalDigest(Object.fromEntries(Object.entries(identity).filter(([key])=>key!=='identityDigest'))))
      fail('JAV Product Identity requires its exact qualified source Observation.');
    return identity;
  }
  if(!identity||identity.provider!=='tmdb'||identity.namespace!==(series?'tmdb_series':'tmdb_movie')||
      (series&&(identity.seasonNumber!==seasonNumber||observation.sourceKind==='related_nfo'||
        canonicalDigest(observation)!==sourceResultItem.resultDigest||
        identity.identityDigest!==canonicalDigest(Object.fromEntries(Object.entries(identity).filter(([key])=>key!=='identityDigest'))))))
    fail('Product Identity requires one exact Provider identity in the frozen profile and Season.');
  return identity;
}

function buildProductIdentityCommitBundle(value) {
  const {snapshot,identityClaim,decisionEvidence,productStructure,sourceResultItem,eventFenceDigest}=value;
  const series=identityClaim?.contentProfile==='series';
  const usAdult=identityClaim?.contentProfile==='western_adult',jav=identityClaim?.contentProfile==='jav',profile=usAdult?'western_adult':jav?'jav':series?'series':'movie';
  const seasonNumber=series?frozenSeriesSeasonNumber(snapshot):null;
  if(!snapshot?.run||snapshot.run.libraRunId!==value.libraRunId||snapshot.run.subjectId!==decisionEvidence?.subjectId||
      identityClaim?.contentProfile!==profile||identityClaim.claimKind!==(usAdult?'western_temporary':jav?'jav_code':series?'series_season':'movie_title')||
      (series&&canonicalDigest(identityClaim)!==canonicalDigest(snapshot.candidateIdentityClaim))||
      productStructure?.subjectId!==snapshot.run.subjectId||productStructure.structureKind!==(series?'season':'single')||
      (series&&canonicalDigest(productStructure.episodeClaims)!==canonicalDigest(snapshot.episodeClaims))||
      decisionEvidence.digest!==canonicalDigest(Object.fromEntries(Object.entries(decisionEvidence).filter(([key])=>key!=='digest'))))
    fail('Product Identity immutable input scope is invalid.');
  const fact=providerFact(decisionEvidence,sourceResultItem,profile,seasonNumber);
  const displayTitle=String(fact.displayTitle||'').trim();
  if(!displayTitle)fail('Resolved Product Identity does not carry a provider display title.');
  const displayEntries=[{key:'title',value:displayTitle},
    {key:usAdult?'internal_identity':jav?'jav_code':series?'tmdb_series_id':'tmdb_movie_id',value:fact.providerKey}];
  if(usAdult){displayEntries.push({key:'original_file_name',value:sourceResultItem.result.originalName.originalFileName},{key:'original_file_name_digest',value:sourceResultItem.result.originalName.provenanceDigest});}
  if(series)displayEntries.push({key:'season_number',value:seasonNumber});
  const originalTitle=typeof fact.originalTitle==='string'?fact.originalTitle.trim():'';
  if(originalTitle&&originalTitle!==displayTitle)displayEntries.push({key:'original_title',value:originalTitle});
  if(Number.isSafeInteger(fact.releaseYear))displayEntries.push({key:'year',value:String(fact.releaseYear)});
  else if(identityClaim.claimedYear)displayEntries.push({key:'year',value:identityClaim.claimedYear});
  const editionYear=Number.isSafeInteger(fact.releaseYear)?fact.releaseYear:identityClaim.claimedYear;
  const edition=editionFromSourceDisplay(identityClaim.displayIdentity||identityClaim.claimedTitle,displayTitle,editionYear);
  if(edition)displayEntries.push({key:'edition',value:edition});
  const resolvedProductIdentity=buildResolvedProductIdentity({producerRef:'libra.product_identity.resolve@1',
    basisDigest:decisionEvidence.digest,observedAtMs:0,subjectId:snapshot.run.subjectId,structureKind:series?'season':'single',contentProfile:profile,
    identityKind:usAdult?'internal_identity':jav?'jav_code':series?'tmdb_series_season':'tmdb_movie',providerIdentities:[{provider:usAdult?'internal':jav?'jav':'tmdb',namespace:usAdult?'internal_identity':jav?'jav_code':series?'tmdb_series':'tmdb_movie',providerKey:fact.providerKey,seasonNumber}],
    exactSeasonContinuityClaims:series?[buildProviderSeasonContinuityClaim(fact,sourceResultItem.result.observationDigest)]:[],displayEntries,
    ...(jav?{javSelectionFence:sourceResultItem.result.javSelectionFence,javSourceQualification:{sourceSnapshot:sourceResultItem.result.sourceSnapshot,
      sourceOrdinal:sourceResultItem.result.sourceOrdinal,observation:sourceResultItem.result.qualificationObservation}}:{})});
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
