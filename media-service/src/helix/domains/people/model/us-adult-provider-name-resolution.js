'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {POLICY}=require('./us-adult-name-resolution');
const {compare,normalizeName,queryNames,bestNameMatch,bestCandidates}=require('./us-adult-name-matching');
const SCHEMA='people.us-adult-provider-name-resolution@1',OBSERVATION='people.us-adult-provider-search-observation@1',HASH=/^[a-f0-9]{64}$/;
function fail(code,message){throw Object.assign(new Error(message),{code});}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

// Pure People-owned interpretation of a complete, bounded Provider
// Observation. It cannot send requests, create Person facts or choose images.
function resolveUsAdultProviderName({name,aliases=[],observation}){
  if(!Array.isArray(aliases)||aliases.length>16)fail('PEOPLE_PROVIDER_NAME_INPUT_INVALID','Provider name aliases exceed their bound.');
  const names=queryNames(name,aliases),queryDigest=canonicalDigest({policyRef:POLICY,names});
  if(!exact(observation,['schema','provider','queries','observationDigest'])||observation.schema!==OBSERVATION||observation.provider!=='theporndb'||
    !Array.isArray(observation.queries)||observation.queries.length!==names.length||observation.queries.length>17||
    !HASH.test(observation.observationDigest||'')||Buffer.byteLength(canonicalJson(observation),'utf8')>512*1024)
    fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider name lookup requires the exact bounded Observation.');
  const {observationDigest,...observationBody}=observation;
  if(canonicalDigest(observationBody)!==observationDigest)fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider Observation digest changed.');
  const seenTerms=new Set(),people=new Map();let saturated=false;
  for(const query of observation.queries){
    if(!exact(query,['term','limit','completion','responseDigest','candidates'])||!text(query.term)||!Number.isSafeInteger(query.limit)||
      query.limit<1||query.limit>100||!['complete','saturated'].includes(query.completion)||!HASH.test(query.responseDigest||'')||
      !Array.isArray(query.candidates)||query.candidates.length>query.limit||
      (query.completion==='complete'&&query.candidates.length>=query.limit)||
      (query.completion==='saturated'&&query.candidates.length!==query.limit))
      fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider response is incomplete, oversized or internally inconsistent.');
    const term=normalizeName(query.term);
    if(seenTerms.has(term)||!names.includes(term))fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider queries do not exactly cover the frozen requested names.');
    seenTerms.add(term);if(query.completion==='saturated')saturated=true;
    for(const item of query.candidates){
      if(!exact(item,['providerKey','canonicalName','aliases','images'])||!text(item.providerKey)||!text(item.canonicalName)||
        !Array.isArray(item.aliases)||item.aliases.length>128||item.aliases.some(value=>!text(value))||
        !Array.isArray(item.images)||item.images.length>128)
        fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider person projection exceeds its closed bound.');
      normalizeName(item.canonicalName);item.aliases.forEach(normalizeName);
      const aliases=[...new Set(item.aliases)].sort(compare),seenImages=new Set(),images=item.images.map(image=>{
        if(!exact(image,['imageId','urlDigest','width','height'])||!text(image.imageId)||!HASH.test(image.urlDigest||'')||
          !Number.isSafeInteger(image.width)||image.width<1||!Number.isSafeInteger(image.height)||image.height<1||seenImages.has(image.imageId))
          fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider image projection is invalid or duplicated.');
        seenImages.add(image.imageId);return {...image};
      }).sort((a,b)=>compare(a.imageId,b.imageId));
      const candidate={providerKey:item.providerKey,canonicalName:item.canonicalName,aliases,images},previous=people.get(candidate.providerKey);
      if(previous&&canonicalJson(previous)!==canonicalJson(candidate))
        fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','The same provider result changed between query terms.');
      people.set(candidate.providerKey,candidate);
    }
  }
  if(seenTerms.size!==names.length||people.size>1700)fail('PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID','Provider queries do not cover their frozen names.');
  const snapshot=[...people.values()].sort((a,b)=>compare(a.providerKey,b.providerKey));
  let steps=0;const consume=()=>{if(++steps>2_000_000)fail('PEOPLE_PROVIDER_NAME_LIMIT','Provider comparison exceeds its work bound.');};
  const matches=[];
  for(const candidate of snapshot){
    const best=bestNameMatch(names,[candidate.canonicalName,...candidate.aliases],consume);
    if(best)matches.push({providerKey:candidate.providerKey,candidateDigest:canonicalDigest(candidate),...best});
  }
  const candidates=bestCandidates(matches).sort((a,b)=>compare(a.providerKey,b.providerKey));
  if(candidates.length>32)fail('PEOPLE_PROVIDER_NAME_LIMIT','Ambiguous Provider candidates exceed their response bound.');
  const body={schema:SCHEMA,policyRef:POLICY,kind:saturated?'incomplete':candidates.length===1?'resolved':candidates.length?'ambiguous':'not_found',
    nameQueryDigest:queryDigest,providerObservationDigest:observationDigest,
    providerCandidateSetDigest:canonicalDigest({schema:'people.us-adult-provider-candidate-set@1',people:snapshot}),
    candidates:saturated?[]:candidates};
  return freeze({...body,resolutionDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({SCHEMA,OBSERVATION,resolveUsAdultProviderName});
