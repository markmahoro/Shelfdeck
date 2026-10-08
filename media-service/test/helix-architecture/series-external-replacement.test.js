'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildSeriesReplacementBasis:buildBasis,buildSeriesReplacementScopes:scopes,
  buildSeriesReplacementMapping:mapping}=require('../../src/helix/domains/libra/model/series-external-replacement');
const member=(materialKey,episodeKeys)=>({materialKey,episodeKeys,memberDigest:canonicalDigest({materialKey,episodeKeys})});
function input(){return {libraRunId:'run',runExecutionBasisDigest:'a'.repeat(64),acceptanceSpecRecordDigest:'b'.repeat(64),
  episodeKeys:['E1','E2','E3','E4','E5'],members:[member('a',['E1','E2']),member('b',['E2','E3']),
    member('c',['E3']),member('d',['E4']),member('e',['E5'])]};}
const outputs=()=>[member('x',['E1']),member('y',['E2']),member('z',['E3']),member('part',['E2'])];
test('Series replacement closes multi-hop shared files and parts but preserves unrelated components',()=>{
  const basis=buildBasis(input()),result=scopes({basis,materialKeys:['c','a','e']});
  assert.deepEqual(result.map(scope=>scope.members.map(item=>item.materialKey)),[['a','b','c'],['e']]);
  assert.deepEqual(result.map(scope=>scope.episodeKeys),[['E1','E2','E3'],['E5']]);
  assert.deepEqual(scopes({basis,materialKeys:['b']})[0],result[0]);
  assert.ok(Object.isFrozen(result[0].members[0].episodeKeys));
  assert.deepEqual(basis.members.map(item=>item.materialKey),['a','b','c','d','e']);
});
test('Series replacement identities are deterministic and bind the complete frozen Run and Spec',()=>{
  const value=input(),basis=buildBasis(value),scope=scopes({basis,materialKeys:['a']})[0];
  assert.deepEqual(buildBasis({...value,episodeKeys:[...value.episodeKeys].reverse(),members:[...value.members].reverse()
    .map(item=>({...item,episodeKeys:[...item.episodeKeys].reverse()}))}),basis);
  for(const changed of [{...value,libraRunId:'other-run'},{...value,runExecutionBasisDigest:'c'.repeat(64)},
    {...value,acceptanceSpecRecordDigest:'d'.repeat(64)},
    {...value,members:value.members.map(item=>item.materialKey==='d'?{...item,memberDigest:'e'.repeat(64)}:item)}]){
    const fresh=buildBasis(changed);assert.notEqual(fresh.basisDigest,basis.basisDigest);
    assert.notEqual(scopes({basis:fresh,materialKeys:['a']})[0].scopeDigest,scope.scopeDigest);
    assert.throws(()=>mapping({basis:fresh,scope,finalMembers:outputs()}),/complete frozen/);
  }
});
test('Every source maps to all intersecting final files, including new parts and shared outputs',()=>{
  const basis=buildBasis(input()),scope=scopes({basis,materialKeys:['a']})[0],result=mapping({basis,scope,finalMembers:outputs()});
  assert.deepEqual(result.members.map(item=>[item.sourceMaterialKey,item.finalProductMaterialKeys]),
    [['a',['part','x','y']],['b',['part','y','z']],['c',['z']]]);
  assert.deepEqual(mapping({basis,scope,finalMembers:outputs().reverse()}),result);
  const shared=mapping({basis,scope,finalMembers:[member('all',['E1','E2','E3'])]});
  assert.deepEqual(shared.members.map(item=>item.finalProductMaterialKeys),[['all'],['all'],['all']]);
  assert.notEqual(shared.mappingDigest,result.mappingDigest);
  assert.notEqual(mapping({basis,scope,finalMembers:outputs().map(item=>({...item,memberDigest:'f'.repeat(64)}))}).mappingDigest,
    result.mappingDigest);
});
test('Replacement rejects partial or merged components even with recomputed scope digests',()=>{
  const basis=buildBasis(input()),scope=scopes({basis,materialKeys:['a']})[0];
  for(const members of [scope.members.slice(0,1),[...scope.members,basis.members[3]]]){
    const body={...scope,members};delete body.scopeDigest;
    const forged={...body,scopeDigest:canonicalDigest(body)};
    assert.throws(()=>mapping({basis,scope:forged,finalMembers:outputs()}),/complete frozen/);
  }
  assert.throws(()=>scopes({basis:{...basis,basisDigest:'0'.repeat(64)},materialKeys:['a']}),/canonical/);
  for(const materialKeys of [[],['unknown'],['a','a']])assert.throws(()=>scopes({basis,materialKeys}));
});
test('Replacement rejects missing, extra, duplicate and reused physical outputs',()=>{
  const basis=buildBasis(input()),scope=scopes({basis,materialKeys:['a']})[0];
  for(const finalMembers of [[],outputs().filter(item=>item.materialKey!=='z'),[...outputs(),member('extra',['E4'])],
    [...outputs(),outputs()[0]],[...outputs(),member('d',['E2'])],
    outputs().map(item=>item.materialKey==='x'?{...item,episodeKeys:['E1','E1']}:item),
    outputs().map(item=>({...item,memberDigest:null}))])assert.throws(()=>mapping({basis,scope,finalMembers}));
});
test('Replacement basis rejects incomplete frozen source coverage and ambiguous claims',()=>{
  const value=input();
  for(const changed of [{...value,members:value.members.slice(0,3)},
    {...value,members:[...value.members,value.members[0]]},
    {...value,episodeKeys:['E1','E1']},
    {...value,members:value.members.map(item=>({...item,episodeKeys:[]}))},
    {...value,members:value.members.map(item=>({...item,memberDigest:'bad'}))},
    {...value,runExecutionBasisDigest:null}])assert.throws(()=>buildBasis(changed));
});
test('Replacement scope covers a long chain without truncating traversal to one hop',()=>{
  const episodeKeys=Array.from({length:65},(_,index)=>'E'+String(index).padStart(3,'0'));
  const basis=buildBasis({...input(),episodeKeys,members:episodeKeys.slice(1).map((key,index)=>
    member('m'+String(index).padStart(3,'0'),[episodeKeys[index],key]))});
  const scope=scopes({basis,materialKeys:['m000']})[0];
  assert.equal(scope.members.length,64);assert.deepEqual(scope.episodeKeys,episodeKeys);
  assert.equal(mapping({basis,scope,finalMembers:episodeKeys.map((key,index)=>member('out'+index,[key]))}).members.length,64);
});
