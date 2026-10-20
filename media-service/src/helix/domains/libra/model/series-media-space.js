'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {evaluateSeriesEpisodeSpace,deriveSeriesMemberSizeBudgets}=require('../../../contracts/episode-byte-allocation');
const sorted=values=>[...values].sort((a,b)=>Buffer.from(a).compare(Buffer.from(b)));
const evaluationScopes=new WeakMap(),ownedBases=new WeakSet();
function withSeriesMediaSpaceEvaluation(operation) {
  const scope=Object.freeze({});evaluationScopes.set(scope,new WeakMap());
  try {const value=operation(scope);if(value&&typeof value.then==='function')throw new TypeError('Series evaluation scope must complete synchronously.');return value;}
  finally {evaluationScopes.delete(scope);}
}
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// The Owner supplies the complete frozen candidate set. This value never grants
// physical access and does not replace final Product or Arca space acceptance.
function buildSeriesMediaSpaceBasis({libraRunId,runExecutionBasisDigest,episodeKeys,members}) {
  if(typeof libraRunId!=='string'||!libraRunId||!digest(runExecutionBasisDigest)||
      !Array.isArray(members)||!members.length||members.length>1024)
    throw new TypeError('Series media space requires one bounded frozen Run member set.');
  const items=members.map(member=>({materialKey:member.materialKey,memberDigest:member.memberDigest,
    handleDigest:member.handleDigest,probeDigest:member.probeDigest,sizeBytes:member.sizeBytes,
    episodeKeys:Object.freeze(sorted(member.episodeKeys))})).sort((a,b)=>Buffer.from(a.materialKey).compare(Buffer.from(b.materialKey)));
  if(items.some(item=>!digest(item.memberDigest)||!digest(item.handleDigest)||!digest(item.probeDigest))||
      new Set(items.map(item=>item.handleDigest)).size!==items.length)
    throw new TypeError('Series media space members require distinct frozen Handles and exact Evidence digests.');
  const body={schema:'libra.series-media-space-basis@1',libraRunId,runExecutionBasisDigest,
    episodeKeys:Object.freeze(sorted(episodeKeys)),members:Object.freeze(items.map(Object.freeze))};
  evaluateSeriesEpisodeSpace({members:items.map(item=>({...item,role:'primary_payload',
    episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))})),episodeKeys:body.episodeKeys,maxSizeBytes:null});
  const basis=Object.freeze({...body,basisDigest:canonicalDigest(body)});ownedBases.add(basis);return basis;
}

// Reuse pure allocation arithmetic only inside one explicit synchronous read.
// Mutable or foreign inputs are fully revalidated on every call.
function evaluateSeriesMediaSpace({basis,libraRunId,handle,probe,maxSizeBytes},scope=null) {
  const scoped=scope===null?null:evaluationScopes.get(scope);
  if(scope!==null&&!scoped)throw new TypeError('Series evaluation scope is expired or foreign.');
  if(maxSizeBytes!==null&&(!Number.isSafeInteger(maxSizeBytes)||maxSizeBytes<1))throw new TypeError('Series byte limit is invalid.');
  const key=JSON.stringify([libraRunId,maxSizeBytes]);
  let prepared=basis&&scoped?.get(basis)?.get(key);
  if(!prepared) {
    if(!basis||canonicalJson(buildSeriesMediaSpaceBasis(basis))!==canonicalJson(basis)||basis.libraRunId!==libraRunId)
      throw new TypeError('Series media space basis is not a canonical exact Run snapshot.');
    const all=evaluateSeriesEpisodeSpace({members:basis.members.map(item=>({...item,role:'primary_payload',
      episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))})),episodeKeys:basis.episodeKeys,maxSizeBytes});
    prepared={members:new Map(basis.members.map(item=>[item.handleDigest,item])),allocations:new Map(all.map(item=>[item.episodeKey,item]))};
    if(scoped&&ownedBases.has(basis)){if(!scoped.has(basis))scoped.set(basis,new Map());scoped.get(basis).set(key,prepared);}
  }
  const handleDigest=canonicalDigest(handle),selected=prepared.members.get(handleDigest);
  if(!selected||probe.sourceHandleDigest!==handleDigest||selected.probeDigest!==canonicalDigest(probe)||
      selected.sizeBytes!==(handle.sizeBytes??handle.expectedSizeBytes))
    throw new TypeError('Series media space basis does not bind the actual Candidate Handle and Probe.');
  const allocations=Object.freeze(selected.episodeKeys.map(key=>prepared.allocations.get(key)));
  return Object.freeze({basisDigest:basis.basisDigest,allocations,withinLimit:allocations.every(item=>item.withinLimit)});
}

// Allocate a conservative physical-file budget without changing the Episode
// Acceptance Spec. For each covered Episode: B_i <= cap * size_i / total_e.
// Summing B_i / claimCount_i therefore cannot exceed that Episode's cap.
function deriveSeriesMemberSizeBudget({basis,materialKey,maxSizeBytes}) {
  if(!basis||canonicalJson(buildSeriesMediaSpaceBasis(basis))!==canonicalJson(basis))
    throw new TypeError('Series size planning requires a complete canonical space basis.');
  const member=basis.members.find(item=>item.materialKey===materialKey);
  if(!member)throw new TypeError('Series size planning member is outside the frozen basis.');
  const budgets=deriveSeriesMemberSizeBudgets({members:basis.members.map(item=>({...item,role:'primary_payload',
    episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))})),episodeKeys:basis.episodeKeys,maxSizeBytes});
  return budgets.find(item=>item.materialKey===materialKey).maxOutputBytes;
}

module.exports=Object.freeze({withSeriesMediaSpaceEvaluation,buildSeriesMediaSpaceBasis,evaluateSeriesMediaSpace,deriveSeriesMemberSizeBudget});
