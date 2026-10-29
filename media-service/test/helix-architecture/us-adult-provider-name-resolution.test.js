'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {OBSERVATION,resolveUsAdultProviderName}=require('../../src/helix/domains/people/model/us-adult-provider-name-resolution');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const person=(providerKey,canonicalName,aliases=[],images=[])=>({providerKey,canonicalName,aliases,images});
const query=(term,candidates=[],completion='complete',limit=10)=>({term,limit,completion,responseDigest:D({term,candidates}),candidates});
const observation=(queries)=>{const body={schema:OBSERVATION,provider:'theporndb',queries};return {...body,observationDigest:D(body)};};
const resolve=(name,queries,aliases=[])=>resolveUsAdultProviderName({name,aliases,observation:observation(queries)});

test('exact provider name wins over fuzzy, including a person without any image',()=>{
  const value=resolve('Example Performer',[query('Example Performer',[person('p-fuzzy','Example Performar'),person('p-exact','Example Performer')])]);
  assert.equal(value.kind,'resolved');assert.equal(value.candidates[0].providerKey,'p-exact');
  assert.equal(value.candidates[0].matchKind,'exact_name_or_alias');
  assert.equal(Object.hasOwn(value.candidates[0],'personId'),false);
});

test('provider and local People use identical bounded normalization and spelling comparisons',()=>{
  for(const [source,actual] of [['Example Perfromer','Example Performer'],['Ａｎｎａ‐Ｍａｒｉｅ','Anna Marie'],['Zoë Baker','Zoe Baker']]){
    const provider=resolve(source,[query(source,[person('p-1',actual)])]);
    const local=resolveUsAdultName({name:source,people:[{personId:'local-1',libraryKind:'us_adult',status:'active',personRevision:1,
      personFactDigest:D('person'),canonicalName:actual,aliases:[]}]});
    assert.equal(provider.kind,local.kind);assert.equal(provider.candidates[0].distance,local.candidates[0].distance);
    assert.equal(provider.candidates[0].matchKind,local.candidates[0].matchKind);
  }
});

test('a saturated Provider response cannot claim a unique candidate or no match',()=>{
  const candidates=Array.from({length:10},(_,index)=>person('p-'+index,index===0?'Example Performer':'Other '+index));
  const value=resolve('Example Performer',[query('Example Performer',candidates,'saturated')]);
  assert.equal(value.kind,'incomplete');assert.deepEqual(value.candidates,[]);
});

test('duplicate exact or equally close provider candidates remain ambiguous independently of image availability',()=>{
  const image={imageId:'img',urlDigest:D('https://example.test/image'),width:400,height:600};
  const value=resolve('Example Performer',[query('Example Performer',[person('p-2','Example Performer',[],[image]),person('p-1','Example Performer')])]);
  assert.equal(value.kind,'ambiguous');assert.deepEqual(value.candidates.map(item=>item.providerKey),['p-1','p-2']);
});

test('only complete observations for every requested name can report not_found',()=>{
  const value=resolve('Example Performer',[query('Example Performer',[person('p-1','Unrelated Person')]),query('Example Alias',[])],['Example Alias']);
  assert.equal(value.kind,'not_found');assert.deepEqual(value.candidates,[]);
  assert.throws(()=>resolve('Example Performer',[query('Example Performer',[])],['Example Alias']),{code:'PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID'});
  assert.throws(()=>resolveUsAdultProviderName({name:'Example Performer',observation:{error:'timeout'}}),{code:'PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID'});
});

test('a changed response, duplicate provider identity with conflicting facts or false completeness is rejected',()=>{
  const saved=observation([query('Example Performer',[])]);saved.queries[0].term='Other';
  assert.throws(()=>resolveUsAdultProviderName({name:'Example Performer',observation:saved}),{code:'PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID'});
  assert.throws(()=>resolve('Example Performer',[query('Example Performer',[person('p','Example Performer')]),
    query('Example Alias',[person('p','Different Name')])],['Example Alias']),{code:'PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID'});
  assert.throws(()=>resolve('Example Performer',[query('Example Performer',Array.from({length:10},(_,i)=>person('p-'+i,'Name '+i)),'complete')]),
    {code:'PEOPLE_PROVIDER_NAME_OBSERVATION_INVALID'});
});
