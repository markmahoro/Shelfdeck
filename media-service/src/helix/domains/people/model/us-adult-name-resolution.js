'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {compare,normalizeName:name,queryNames,bestNameMatch,bestCandidates}=require('./us-adult-name-matching');
const {POLICY}=require('../../../contracts/us-adult-name-query');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function resolveUsAdultName({name:queryName,aliases=[],people}){
  if(!Array.isArray(aliases)||aliases.length>16||!Array.isArray(people)||people.length>10000)
    fail('PEOPLE_NAME_QUERY_LIMIT','Actor name resolution requires bounded complete input.');
  const names=queryNames(queryName,aliases),query={policyRef:POLICY,names},
    seen=new Set(),snapshot=people.map(person=>{
      if(!person||person.libraryKind!=='us_adult'||person.status!=='active'||typeof person.personId!=='string'||!person.personId||
          !Number.isSafeInteger(person.personRevision)||person.personRevision<1||!/^[a-f0-9]{64}$/.test(person.personFactDigest||'')||
          !Array.isArray(person.aliases)||person.aliases.length>64||seen.has(person.personId))
        fail('PEOPLE_NAME_QUERY_SNAPSHOT','Actor name resolution requires unique current US Adult Person facts.');
      seen.add(person.personId);
      const values=[person.canonicalName,...person.aliases];values.forEach(name);
      return {personId:person.personId,personRevision:person.personRevision,personFactDigest:person.personFactDigest,
        canonicalName:person.canonicalName,aliases:[...person.aliases].sort(compare)};
    }).sort((a,b)=>compare(a.personId,b.personId));
  if(Buffer.byteLength(canonicalJson(snapshot))>8*1024*1024)
    fail('PEOPLE_NAME_QUERY_LIMIT','Complete actor name snapshot exceeds its byte bound.');
  const matches=[];let comparisonSteps=0;
  const consume=()=>{if(++comparisonSteps>2_000_000)fail('PEOPLE_NAME_QUERY_LIMIT','Complete actor name comparison exceeds its work bound.');};
  for(const person of snapshot){
    const best=bestNameMatch(names,[person.canonicalName,...person.aliases],consume);
    if(best)matches.push({personId:person.personId,personRevision:person.personRevision,personFactDigest:person.personFactDigest,...best});
  }
  const candidates=bestCandidates(matches).sort((a,b)=>compare(a.personId,b.personId));
  if(candidates.length>32)fail('PEOPLE_NAME_QUERY_LIMIT','Ambiguous actor name candidates exceed their response bound.');
  const body={schema:'people.us-adult-name-resolution@1',policyRef:POLICY,kind:candidates.length===1?'resolved':candidates.length?'ambiguous':'not_found',
    nameQueryDigest:canonicalDigest(query),libraryNamesDigest:canonicalDigest({schema:'people.us-adult-name-snapshot@1',people:snapshot}),candidates};
  return freeze({...body,resolutionDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({POLICY,resolveUsAdultName});
