'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const compare=(a,b)=>Buffer.from(a).compare(Buffer.from(b));
const sorted=items=>[...items].sort(compare);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256;
function freeze(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function keys(value,maximum,label) {
  if(!Array.isArray(value)||!value.length||value.length>maximum||value.some(item=>!text(item))||
      new Set(value).size!==value.length)throw new TypeError('Invalid unique '+label+'.');
  return sorted(value);
}
function members(value,episodeKeys) {
  if(!Array.isArray(value)||!value.length||value.length>1024)throw new TypeError('Invalid replacement member count.');
  const result=value.map(item=>{
    if(!item||!text(item.materialKey)||!digest(item.memberDigest))throw new TypeError('Replacement member lacks its frozen identity.');
    const claims=keys(item.episodeKeys,32,'member Episode claims');
    if(claims.some(key=>!episodeKeys.includes(key)))throw new TypeError('Replacement member claims an out-of-scope Episode.');
    return {materialKey:item.materialKey,memberDigest:item.memberDigest,episodeKeys:claims};
  }).sort((a,b)=>compare(a.materialKey,b.materialKey));
  if(new Set(result.map(item=>item.materialKey)).size!==result.length||
      episodeKeys.some(key=>!result.some(item=>item.episodeKeys.includes(key))))
    throw new TypeError('Replacement members are duplicated or omit a Delivery Episode.');
  return result;
}

// Only Libra can supply this complete frozen Run projection. This pure value
// grants no physical access, candidate eligibility, or settlement authorization.
function buildSeriesReplacementBasis(value) {
  if(!value||!text(value.libraRunId)||!digest(value.runExecutionBasisDigest)||!digest(value.acceptanceSpecRecordDigest))
    throw new TypeError('Replacement requires its frozen Run and Acceptance Spec.');
  const episodeKeys=keys(value.episodeKeys,1024,'Delivery Episode scope');
  const body={schema:'libra.series-external-replacement-basis@1',libraRunId:value.libraRunId,
    runExecutionBasisDigest:value.runExecutionBasisDigest,acceptanceSpecRecordDigest:value.acceptanceSpecRecordDigest,
    episodeKeys,members:members(value.members,episodeKeys)};
  return freeze({...body,basisDigest:canonicalDigest(body)});
}
function assertBasis(basis) {
  if(canonicalJson(buildSeriesReplacementBasis(basis))!==canonicalJson(basis))
    throw new TypeError('Replacement basis is not the exact canonical frozen snapshot.');
}
function component(basis,seed) {
  const selected=new Set([seed]),episodes=new Set();
  let changed=true;
  while(changed){
    changed=false;
    for(const member of basis.members){
      if(selected.has(member.materialKey))for(const key of member.episodeKeys)if(!episodes.has(key)){episodes.add(key);changed=true;}
      if(!selected.has(member.materialKey)&&member.episodeKeys.some(key=>episodes.has(key))){selected.add(member.materialKey);changed=true;}
    }
  }
  const body={schema:'libra.series-external-replacement-scope@1',libraRunId:basis.libraRunId,basisDigest:basis.basisDigest,
    episodeKeys:sorted(episodes),members:basis.members.filter(item=>selected.has(item.materialKey))};
  return freeze({...body,scopeDigest:canonicalDigest(body)});
}
function buildSeriesReplacementScopes({basis,materialKeys}) {
  assertBasis(basis);
  const seeds=keys(materialKeys,1024,'replacement seed members');
  if(seeds.some(key=>!basis.members.some(item=>item.materialKey===key)))throw new TypeError('Replacement seed is outside the frozen Run.');
  const covered=new Set(),scopes=[];
  for(const seed of seeds){
    if(covered.has(seed))continue;
    const scope=component(basis,seed);scopes.push(scope);
    scope.members.forEach(item=>covered.add(item.materialKey));
  }
  return freeze(scopes.sort((a,b)=>compare(a.members[0].materialKey,b.members[0].materialKey)));
}

function buildSeriesReplacementMapping({basis,scope,finalMembers}) {
  assertBasis(basis);
  const seeds=scope?.members?.map(item=>item.materialKey),expected=buildSeriesReplacementScopes({basis,materialKeys:seeds});
  if(expected.length!==1||canonicalJson(expected[0])!==canonicalJson(scope))
    throw new TypeError('Replacement scope is not one complete frozen connected component.');
  const outputs=members(finalMembers,scope.episodeKeys);
  if(outputs.some(item=>basis.members.some(source=>source.materialKey===item.materialKey)))
    throw new TypeError('External replacement must use distinct final Workspace materials.');
  const mapping=scope.members.map(source=>{
    const targets=outputs.filter(item=>item.episodeKeys.some(key=>source.episodeKeys.includes(key)));
    if(source.episodeKeys.some(key=>!targets.some(item=>item.episodeKeys.includes(key))))
      throw new TypeError('Replacement mapping does not cover the complete source Episode claims.');
    return {sourceMaterialKey:source.materialKey,sourceMemberDigest:source.memberDigest,
      finalProductMaterialKeys:targets.map(item=>item.materialKey)};
  });
  const body={schema:'libra.series-external-replacement-mapping@1',scopeDigest:scope.scopeDigest,
    finalMembers:outputs,members:mapping};
  return freeze({...body,mappingDigest:canonicalDigest(body)});
}

module.exports=Object.freeze({buildSeriesReplacementBasis,buildSeriesReplacementScopes,buildSeriesReplacementMapping});
