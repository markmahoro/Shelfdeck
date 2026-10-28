'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const POLICY='people.us-adult-name-resolution@1';
const compare=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function name(value){
  if(typeof value!=='string'||!value.trim()||value.length>256)fail('PEOPLE_NAME_QUERY_INVALID','A bounded non-empty actor name is required.');
  const normalized=value.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  if(!normalized)fail('PEOPLE_NAME_QUERY_INVALID','Actor names must contain letters or numbers.');return normalized;
}
function editDistance(a,b,limit,consume){
  function visit(i,j,remaining){
    consume();
    while(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;consume();}
    if(i===a.length||j===b.length)return a.length-i+b.length-j;
    if(!remaining||Math.abs(a.length-i-b.length+j)>remaining)return limit+1;
    let rest=Math.min(visit(i+1,j+1,remaining-1),visit(i+1,j,remaining-1),visit(i,j+1,remaining-1));
    if(i+1<a.length&&j+1<b.length&&a[i]===b[j+1]&&a[i+1]===b[j])rest=Math.min(rest,visit(i+2,j+2,remaining-1));
    return rest+1;
  }
  return visit(0,0,limit);
}
function resolveUsAdultName({name:queryName,aliases=[],people}){
  if(!Array.isArray(aliases)||aliases.length>16||!Array.isArray(people)||people.length>10000)
    fail('PEOPLE_NAME_QUERY_LIMIT','Actor name resolution requires bounded complete input.');
  const names=[...new Set([queryName,...aliases].map(name))].sort(compare),query={policyRef:POLICY,names},
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
  const exact=[],fuzzy=[];let comparisonSteps=0;
  const consume=()=>{if(++comparisonSteps>2_000_000)fail('PEOPLE_NAME_QUERY_LIMIT','Complete actor name comparison exceeds its work bound.');};
  for(const person of snapshot){
    let best=null;
    for(const display of [person.canonicalName,...person.aliases])for(const queryValue of names){
      const actual=name(display),left=Array.from(actual),right=Array.from(queryValue),length=Math.max(left.length,right.length),
        limit=Math.min(left.length,right.length)<6?0:length>=12?2:1;
      consume();if(Math.abs(left.length-right.length)>limit)continue;
      const distance=actual===queryValue?0:editDistance(left,right,limit,consume);
      if(distance>limit)continue;
      const item={personId:person.personId,personRevision:person.personRevision,personFactDigest:person.personFactDigest,
        matchedName:display,matchKind:distance===0?'exact_name_or_alias':'light_spelling',distance};
      if(!best||distance<best.distance||distance===best.distance&&compare(display,best.matchedName)<0)best=item;
    }
    if(best)(best.distance===0?exact:fuzzy).push(best);
  }
  const minimum=fuzzy.length?Math.min(...fuzzy.map(item=>item.distance)):null,
    candidates=(exact.length?exact:fuzzy.filter(item=>item.distance===minimum)).sort((a,b)=>compare(a.personId,b.personId));
  if(candidates.length>32)fail('PEOPLE_NAME_QUERY_LIMIT','Ambiguous actor name candidates exceed their response bound.');
  const body={schema:'people.us-adult-name-resolution@1',policyRef:POLICY,kind:candidates.length===1?'resolved':candidates.length?'ambiguous':'not_found',
    nameQueryDigest:canonicalDigest(query),libraryNamesDigest:canonicalDigest({schema:'people.us-adult-name-snapshot@1',people:snapshot}),candidates};
  return freeze({...body,resolutionDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({POLICY,resolveUsAdultName});
