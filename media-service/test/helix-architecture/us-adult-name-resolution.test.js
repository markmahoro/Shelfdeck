'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const person=(id,canonicalName,aliases=[])=>({personId:id,canonicalName,aliases,libraryKind:'us_adult',status:'active',
  personRevision:1,personFactDigest:canonicalDigest({id,canonicalName,aliases})});

test('actor names reuse the internal Person through spelling, separators, Unicode and exact aliases',()=>{
  const people=[person('internal-person','Skin Diamond',['Skin D.']),person('other','Corinne Harrison')];
  for(const name of ['Skin Diamond','Ｓｋｉｎ Ｄｉａｍｏｎｄ','skin-diamond','SkinDiamond','Skin D.','Skin Diamnod']){
    const result=resolveUsAdultName({name,people});assert.equal(result.kind,'resolved',name);
    assert.equal(result.candidates[0].personId,'internal-person');assert.ok(result.resolutionDigest);
  }
});

test('exact names and aliases precede fuzzy results but multiple exact identities remain ambiguous',()=>{
  const exact=person('a','Skin Diamond'),near=person('b','Skim Diamond'),alias=person('c','Other Person',['Skin Diamond']);
  assert.deepEqual(resolveUsAdultName({name:'Skin Diamond',people:[near,exact]}).candidates.map(p=>p.personId),['a']);
  assert.equal(resolveUsAdultName({name:'Skin Diamond',people:[alias,exact]}).kind,'ambiguous');
  assert.equal(resolveUsAdultName({name:'Skit Diamond',people:[near,exact]}).kind,'ambiguous');
});

test('first names, arbitrary containment and broad spelling differences do not create identity matches',()=>{
  const people=[person('a','Skin Diamond'),person('b','Amy Lee'),person('c','Alex Blake')];
  for(const name of ['Skin','Diamond','Amy','Ami','Alex','Unknown Performer'])
    assert.equal(resolveUsAdultName({name,people}).kind,'not_found',name);
  assert.equal(resolveUsAdultName({name:'Amy Lee',people}).kind,'resolved');
  assert.equal(resolveUsAdultName({name:'Ami Lee',people}).candidates[0].personId,'b');
});

test('name resolution is stable across input ordering and changes with actual current Person facts',()=>{
  const a=person('a','Skin Diamond',['Skin D.','Diamond Skin']),b=person('b','Corinne Harrison'),
    first=resolveUsAdultName({name:'Skin Diamond',aliases:['Skin D.'],people:[a,b]}),
    second=resolveUsAdultName({name:'Skin D.',aliases:['Skin Diamond'],people:[b,{...a,aliases:[...a.aliases].reverse()}]});
  assert.deepEqual(second,first);
  const changed=resolveUsAdultName({name:'Skin Diamond',aliases:['Skin D.'],people:[{...a,personRevision:2,personFactDigest:'f'.repeat(64)},b]});
  assert.notEqual(changed.libraryNamesDigest,first.libraryNamesDigest);assert.notEqual(changed.resolutionDigest,first.resolutionDigest);
});

test('cross-library, merged, duplicate and incomplete name snapshots fail rather than authorizing a new Person',()=>{
  const a=person('a','Skin Diamond');
  for(const people of [[{...a,libraryKind:'normal'}],[{...a,status:'merged'}],[a,a],[{...a,personFactDigest:null}]])
    assert.throws(()=>resolveUsAdultName({name:'Skin Diamond',people}),{code:'PEOPLE_NAME_QUERY_SNAPSHOT'});
  assert.throws(()=>resolveUsAdultName({name:'',people:[]}),{code:'PEOPLE_NAME_QUERY_INVALID'});
  assert.throws(()=>resolveUsAdultName({name:'Skin Diamond',people:new Array(10001)}),{code:'PEOPLE_NAME_QUERY_LIMIT'});
});
