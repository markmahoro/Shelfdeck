'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {policy,assessCatalogueActors}=require('../../src/helix/domains/libra/model/us-adult-catalogue-assessment');
const parameters={maximumDistance:0.5,minimumDistanceMargin:0.05,minimumRepresentativeStrata:2,minimumCoverageStrata:3},frozen=policy(parameters);
function group(id,identity,start=0,coverage=3,distance=0.3,gender='FEMALE'){
  const keys=Array.from({length:coverage},(_,i)=>(start+i)+':0');
  return {clusterId:id,memberKeys:keys,representativeKeys:keys.slice(0,3),coverageStrata:Array.from({length:coverage},(_,i)=>start+i),
    candidates:[{identity,observations:keys.slice(0,3).map((faceKey,i)=>({faceKey,stratum:start+i,imageDigest:canonicalDigest(faceKey),
      uid:identity,name:identity,distance,gender}))}]};
}
const assess=groups=>assessCatalogueActors({groups,policy:frozen});
test('explicit male identity remains eligible and larger temporal coverage wins over a closer single actor',()=>{
  const value=assess([group('f','female',0,3,0.1),group('m','male',4,5,0.3,'MALE')]);
  assert.equal(value.status,'qualified_candidate');assert.equal(value.winner.identity,'male');
  assert.equal(Object.hasOwn(value.winner,'personId'),false,'An assessment does not create or choose an internal Person.');
});
test('gender values, absence and contradictory metadata do not change the complete assessment',()=>{
  const input=[group('a','actor',0,5)],expected=assess(input);
  for(const gender of ['MALE','FEMALE','TRANSGENDER_FEMALE','NON_BINARY',null,undefined]){
    const changed=structuredClone(input);changed[0].candidates[0].observations.forEach((x,i)=>{
      if(gender===undefined)delete x.gender;else x.gender=i===1?'conflicting provider value':gender;
    });
    assert.deepEqual(assess(changed),expected);
  }
});
test('two reliable identities use a deterministic single winner, while per-face ambiguity stays unresolved',()=>{
  const input=[group('b','beta',4),group('a','alpha')];
  assert.equal(assess(input).winner.identity,'alpha');assert.equal(assess([...input].reverse()).winner.identity,'alpha');
  const ambiguous=group('c','first');ambiguous.candidates.push({identity:'second',observations:ambiguous.candidates[0].observations.map(x=>({...x,uid:'second',name:'second',distance:0.31}))});
  assert.equal(assess([ambiguous]).status,'ambiguous_identity');assert.equal(assess([ambiguous]).winner,null);
});
test('one strong frame or repeated image cannot substitute for independent evidence',()=>{
  const sparse=group('a','actor');sparse.candidates[0].observations=sparse.candidates[0].observations.slice(0,1);
  assert.equal(assess([sparse]).status,'insufficient_evidence');
  const repeated=group('b','actor');repeated.candidates[0].observations.forEach(x=>x.imageDigest=canonicalDigest('same image'));
  assert.equal(assess([repeated]).winner,null);
});
test('conflicting strong identities in a single geometric group never become an automatic winner',()=>{
  const mixed=group('a','first');const other=mixed.candidates[0].observations.pop();
  mixed.candidates.push({identity:'second',observations:[{...other,uid:'second',name:'second',distance:0.2}]});
  assert.equal(assess([mixed]).status,'ambiguous_identity');assert.equal(assess([mixed]).winner,null);
});
test('the same identity supported by two co-occurring faces remains ambiguous',()=>{
  const a=group('a','actor'),b=group('b','actor');b.memberKeys=b.memberKeys.map(x=>x.replace(':0',':1'));
  b.representativeKeys=[...b.memberKeys];b.candidates[0].observations.forEach((x,i)=>x.faceKey=b.memberKeys[i]);
  assert.equal(assess([a,b]).status,'ambiguous_identity');assert.equal(assess([a,b]).winner,null);
});
test('no faces and no valid match stay distinct, and broken evidence or policies fail closed',()=>{
  assert.equal(assess([]).status,'no_faces');const empty=group('a','actor');empty.candidates=[];assert.equal(assess([empty]).status,'no_match');
  const bad=group('a','actor');bad.candidates[0].observations[0].stratum=19;
  assert.throws(()=>assess([bad]),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
  assert.throws(()=>assess([group('a','first'),group('b','second')]),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
  assert.throws(()=>policy({...parameters,genderFilter:'FEMALE'}),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
  assert.throws(()=>policy({...parameters,minimumDistanceMargin:0}),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
  const large=group('x','x');large.candidates[0].observations[0].name='x'.repeat(257);
  assert.throws(()=>assess([large]),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
  assert.throws(()=>assessCatalogueActors({groups:[],policy:{...frozen,maximumDistance:0.9}}),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
});
test('input order and gender changes cannot alter an aggregated identity assessment',()=>{
  const a=group('a','actor',0,3,0.3),b=group('b','actor',4,3,0.4,'MALE'),c=group('c','actor',8,3,0.2,null),expected=assess([a,b,c]);
  assert.deepEqual(assess([c,a,b]),expected);assert.equal(Object.isFrozen(expected.winner.coverageStrata),true);
  assert.throws(()=>expected.winner.coverageStrata.push(19),TypeError);
});
test('different candidates cannot assign contradictory images to the same face',()=>{
  const input=group('a','actor');input.candidates.push({identity:'other',observations:input.candidates[0].observations.map(x=>({...x,uid:'other',name:'other',imageDigest:canonicalDigest('substituted')}))});
  assert.throws(()=>assess([input]),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});
});
test('co-occurrence in a nonrepresentative member still prevents one catalogue identity from hiding two faces',()=>{
  const a=group('a','actor',0,6),b=group('b','actor',6,3);b.memberKeys.push('4:1');
  assert.equal(assess([a,b]).status,'ambiguous_identity');
});
