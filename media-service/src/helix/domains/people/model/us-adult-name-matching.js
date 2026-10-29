'use strict';
// The same bounded name comparison is used for internal People and external
// provider candidates. A match alone is neither a Person nor merge authority.
const compare=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function fail(code,message){throw Object.assign(new Error(message),{code});}
function normalizeName(value){
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
function queryNames(name,aliases){return [...new Set([name,...aliases].map(normalizeName))].sort(compare);}
function bestNameMatch(names,displays,consume){
  let best=null;
  for(const display of displays)for(const queryValue of names){
    const actual=normalizeName(display),left=Array.from(actual),right=Array.from(queryValue),length=Math.max(left.length,right.length),
      limit=Math.min(left.length,right.length)<6?0:length>=12?2:1;
    consume();if(Math.abs(left.length-right.length)>limit)continue;
    const distance=actual===queryValue?0:editDistance(left,right,limit,consume);
    if(distance>limit)continue;
    const item={matchedName:display,matchKind:distance===0?'exact_name_or_alias':'light_spelling',distance};
    if(!best||distance<best.distance||distance===best.distance&&compare(display,best.matchedName)<0)best=item;
  }
  return best;
}
function bestCandidates(matches){
  const exact=matches.filter(item=>item.distance===0);
  if(exact.length)return exact;
  const minimum=matches.length?Math.min(...matches.map(item=>item.distance)):null;
  return matches.filter(item=>item.distance===minimum);
}
module.exports=Object.freeze({compare,normalizeName,queryNames,bestNameMatch,bestCandidates});
