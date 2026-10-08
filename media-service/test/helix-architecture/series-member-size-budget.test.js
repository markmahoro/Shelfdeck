'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildSeriesMediaSpaceBasis,deriveSeriesMemberSizeBudget}=require('../../src/helix/domains/libra/model/series-media-space');
const {evaluateSeriesEpisodeSpace}=require('../../src/helix/contracts/episode-byte-allocation');
const D=value=>canonicalDigest({value});
function basis(members) {
  return buildSeriesMediaSpaceBasis({libraRunId:'run',runExecutionBasisDigest:D('run'),
    episodeKeys:[...new Set(members.flatMap(item=>item.episodeKeys))],members:members.map((item,index)=>({...item,
      materialKey:'member-'+index,memberDigest:D('member-'+index),handleDigest:D('handle-'+index),probeDigest:D('probe-'+index)}))});
}
function budgets(value,maxSizeBytes) {return value.members.map(member=>deriveSeriesMemberSizeBudget({basis:value,materialKey:member.materialKey,maxSizeBytes}));}
test('A shared file receives the physical budget of all covered Episodes',()=>{
  const value=basis([{sizeBytes:100,episodeKeys:['E001','E002']}]);
  assert.deepEqual(budgets(value,50),[100]);assert.deepEqual(budgets(value,null),[null]);
});

test('Large Season allocation includes a shared file and a distant part beyond the former 32-member boundary',()=>{
  const members=Array.from({length:46},(_,index)=>({sizeBytes:10,episodeKeys:['E'+String(index+1).padStart(3,'0')]}));
  members[0]={sizeBytes:20,episodeKeys:['E001','E002']};
  members[1]={sizeBytes:1,episodeKeys:['E001']};
  members.push({sizeBytes:5,episodeKeys:['E001']});
  const value=basis(members);
  const allocations=evaluateSeriesEpisodeSpace({members:value.members.map(item=>({...item,role:'primary_payload',episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))})),episodeKeys:value.episodeKeys,maxSizeBytes:15});
  assert.deepEqual(allocations[0].allocatedBytes,{numerator:'16',denominator:'1'});
  assert.equal(allocations[0].withinLimit,false);
  assert.equal(allocations[1].withinLimit,true);
  const bounded=basis(Array.from({length:1024},(_,index)=>({sizeBytes:1,episodeKeys:['E'+index]})));
  assert.equal(bounded.members.length,1024);
  assert.throws(()=>basis(Array.from({length:1025},(_,index)=>({sizeBytes:1,episodeKeys:['E'+index]}))));
});
test('Multiple parts use exact proportions and the tightest covered Episode constraint',()=>{
  const value=basis([{sizeBytes:9,episodeKeys:['E001','E002']},{sizeBytes:3,episodeKeys:['E001']}]);
  assert.deepEqual(budgets(value,7),[8,2]);
  assert.deepEqual(budgets(value,8),[9,3]);
});
test('Byte arithmetic stays exact above Number aggregate precision and yields safe bounded files',()=>{
  const value=basis([{sizeBytes:Number.MAX_SAFE_INTEGER,episodeKeys:['E001']},
    {sizeBytes:Number.MAX_SAFE_INTEGER,episodeKeys:['E001']}]);
  assert.deepEqual(budgets(value,Number.MAX_SAFE_INTEGER),[4503599627370495,4503599627370495]);
  assert.deepEqual(budgets(basis([{sizeBytes:Number.MAX_SAFE_INTEGER,episodeKeys:['E001','E002']}]),Number.MAX_SAFE_INTEGER),[Number.MAX_SAFE_INTEGER]);
});
test('Zero-byte members have no feasible bounded media budget and malformed bases are rejected',()=>{
  const value=basis([{sizeBytes:0,episodeKeys:['E001']}]);assert.deepEqual(budgets(value,5),[0]);
  assert.throws(()=>deriveSeriesMemberSizeBudget({basis:value,materialKey:'foreign',maxSizeBytes:5}));
  assert.throws(()=>budgets({...value,basisDigest:D('wrong')},5));
  assert.throws(()=>budgets(value,0));
});
test('Budget allocation conserves every Episode cap across deterministic irregular N:M maps',()=>{
  for(let seed=1;seed<=128;seed++) {
    const members=Array.from({length:1+seed%12},(_,i)=>({sizeBytes:1+(seed*97+i*131)%10000,
      episodeKeys:Array.from({length:1+(seed+i)%4},(_,j)=>'E00'+(1+(i+j)%4))})),value=basis(members),limit=1+seed*13,
      limits=budgets(value,limit);
    const final=value.members.map((member,i)=>({...member,sizeBytes:limits[i],role:'primary_payload',
      episodeClaims:member.episodeKeys.map(episodeKey=>({episodeKey}))}));
    assert.ok(evaluateSeriesEpisodeSpace({members:final,episodeKeys:value.episodeKeys,maxSizeBytes:limit}).every(item=>item.withinLimit),String(seed));
  }
});
