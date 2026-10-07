'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {evaluateSeriesEpisodeSpace}=require('../../src/helix/domains/libra/model/series-episode-space');
const member=(materialKey,sizeBytes,keys)=>({materialKey,role:'primary_payload',sizeBytes,episodeClaims:keys.map(episodeKey=>({episodeKey}))});
const evaluate=(members,limit,keys=['E001','E002'])=>evaluateSeriesEpisodeSpace({members,episodeKeys:keys,maxSizeBytes:limit});
test('A shared Primary is split equally and each Episode adds all of its parts',()=>{
  const result=evaluate([member('shared',9,['E001','E002']),member('part',3,['E001'])],7);
  assert.deepEqual(result,[
    {episodeKey:'E001',allocatedBytes:{numerator:'15',denominator:'2'},maxSizeBytes:7,withinLimit:false},
    {episodeKey:'E002',allocatedBytes:{numerator:'9',denominator:'2'},maxSizeBytes:7,withinLimit:true}]);
});
test('Fractional shares never round down to authorize an oversized Episode',()=>{
  const result=evaluate([member('a',1,['E001','E002']),member('b',2,['E001','E002'])],1);
  assert.ok(result.every(item=>item.withinLimit===false&&item.allocatedBytes.numerator==='3'&&item.allocatedBytes.denominator==='2'));
});
test('Per-Episode equality passes even when Season total exceeds the limit',()=>{
  const parts=[member('a',100,['E001']),member('b',100,['E002'])];
  assert.ok(evaluate(parts,100).every(item=>item.withinLimit));
  assert.deepEqual(evaluate(parts,100),evaluate(parts.reverse(),100));
});
test('Exact rational addition remains safe above Number aggregate precision',()=>{
  const size=Number.MAX_SAFE_INTEGER;
  const result=evaluate([member('a',size,['E001']),member('b',size,['E001'])],size,['E001']);
  assert.equal(result[0].allocatedBytes.numerator,(BigInt(size)*2n).toString());
  assert.equal(result[0].withinLimit,false);
});
for(const kind of ['duplicate_material','duplicate_claim','foreign_claim','missing_episode','negative_size','unsafe_size'])
test('Episode allocation rejects '+kind,()=>{
  const parts=[member('a',100,['E001']),member('b',100,['E002'])];
  if(kind==='duplicate_material')parts[1].materialKey='a';
  if(kind==='duplicate_claim')parts[0].episodeClaims.push({episodeKey:'E001'});
  if(kind==='foreign_claim')parts[0].episodeClaims=[{episodeKey:'E003'}];
  if(kind==='missing_episode')parts.pop();
  if(kind==='negative_size')parts[0].sizeBytes=-1;
  if(kind==='unsafe_size')parts[0].sizeBytes=Number.MAX_SAFE_INTEGER+1;
  assert.throws(()=>evaluate(parts,100));
});
