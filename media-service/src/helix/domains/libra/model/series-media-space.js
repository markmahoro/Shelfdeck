'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {evaluateSeriesEpisodeSpace}=require('../../../contracts/episode-byte-allocation');
const sorted=values=>[...values].sort((a,b)=>Buffer.from(a).compare(Buffer.from(b)));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// The Owner supplies the complete frozen candidate set. This value never grants
// physical access and does not replace final Product or Arca space acceptance.
function buildSeriesMediaSpaceBasis({libraRunId,runExecutionBasisDigest,episodeKeys,members}) {
  if(typeof libraRunId!=='string'||!libraRunId||!digest(runExecutionBasisDigest)||
      !Array.isArray(members)||!members.length||members.length>32)
    throw new TypeError('Series media space requires one bounded frozen Run member set.');
  const items=members.map(member=>({materialKey:member.materialKey,memberDigest:member.memberDigest,
    handleDigest:member.handleDigest,probeDigest:member.probeDigest,sizeBytes:member.sizeBytes,
    episodeKeys:sorted(member.episodeKeys)})).sort((a,b)=>Buffer.from(a.materialKey).compare(Buffer.from(b.materialKey)));
  if(items.some(item=>!digest(item.memberDigest)||!digest(item.handleDigest)||!digest(item.probeDigest))||
      new Set(items.map(item=>item.handleDigest)).size!==items.length)
    throw new TypeError('Series media space members require distinct frozen Handles and exact Evidence digests.');
  const body={schema:'libra.series-media-space-basis@1',libraRunId,runExecutionBasisDigest,
    episodeKeys:sorted(episodeKeys),members:items};
  evaluateSeriesEpisodeSpace({members:items.map(item=>({...item,role:'primary_payload',
    episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))})),episodeKeys:body.episodeKeys,maxSizeBytes:null});
  return Object.freeze({...body,basisDigest:canonicalDigest(body)});
}

function evaluateSeriesMediaSpace({basis,libraRunId,handle,probe,maxSizeBytes}) {
  if(!basis||canonicalJson(buildSeriesMediaSpaceBasis(basis))!==canonicalJson(basis)||basis.libraRunId!==libraRunId)
    throw new TypeError('Series media space basis is not a canonical exact Run snapshot.');
  const selected=basis.members.filter(item=>item.handleDigest===canonicalDigest(handle));
  if(selected.length!==1||probe.sourceHandleDigest!==canonicalDigest(handle)||selected[0].probeDigest!==canonicalDigest(probe)||
      selected[0].sizeBytes!==(handle.sizeBytes??handle.expectedSizeBytes))
    throw new TypeError('Series media space basis does not bind the actual Candidate Handle and Probe.');
  const all=evaluateSeriesEpisodeSpace({members:basis.members.map(item=>({...item,role:'primary_payload',
    episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))})),episodeKeys:basis.episodeKeys,maxSizeBytes});
  const allocations=all.filter(item=>selected[0].episodeKeys.includes(item.episodeKey));
  return Object.freeze({basisDigest:basis.basisDigest,allocations,
    withinLimit:allocations.every(item=>item.withinLimit)});
}

module.exports=Object.freeze({buildSeriesMediaSpaceBasis,evaluateSeriesMediaSpace});
