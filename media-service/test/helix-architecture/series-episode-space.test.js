'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {evaluateSeriesEpisodeSpace}=require('../../src/helix/contracts/episode-byte-allocation');
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


const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildSeriesMediaSpaceBasis,evaluateSeriesMediaSpace,withSeriesMediaSpaceEvaluation}=require('../../src/helix/domains/libra/model/series-media-space');
function spaceFixture(){
 const handles=[{handleId:'one',sizeBytes:9},{handleId:'two',sizeBytes:3}],probes=handles.map(handle=>({sourceHandleDigest:canonicalDigest(handle)}));
 const basis=buildSeriesMediaSpaceBasis({libraRunId:'run',runExecutionBasisDigest:canonicalDigest('run'),episodeKeys:['E001','E002'],members:handles.map((handle,i)=>({materialKey:handle.handleId,memberDigest:canonicalDigest(i),handleDigest:canonicalDigest(handle),probeDigest:canonicalDigest(probes[i]),sizeBytes:handle.sizeBytes,episodeKeys:i===0?['E001','E002']:['E001']}))});
 return {handles,probes,basis};
}
test('scoped Series allocation preserves exact fractions, limits and member evidence',()=>{
 const {basis,handles,probes}=spaceFixture();let escaped;
 withSeriesMediaSpaceEvaluation(scope=>{
  escaped=scope;
  for(const maxSizeBytes of [null,7,8])for(let i=0;i<handles.length;i++){
   const input={basis,libraRunId:'run',handle:handles[i],probe:probes[i],maxSizeBytes};
   assert.deepEqual(evaluateSeriesMediaSpace(input,scope),evaluateSeriesMediaSpace(input));
  }
  const input={basis,libraRunId:'run',handle:handles[0],probe:probes[0],maxSizeBytes:null};
  evaluateSeriesMediaSpace(input,scope);
  for(const maxSizeBytes of [undefined,NaN,Infinity,0])assert.throws(()=>evaluateSeriesMediaSpace({...input,maxSizeBytes},scope));
  assert.throws(()=>evaluateSeriesMediaSpace({...input,probe:{...probes[0],tampered:true}},scope));
  assert.throws(()=>evaluateSeriesMediaSpace({...input,handle:{...handles[0],sizeBytes:10}},scope));
  assert.throws(()=>evaluateSeriesMediaSpace({...input,libraRunId:'other'},scope));
 });
 assert.throws(()=>evaluateSeriesMediaSpace({basis,libraRunId:'run',handle:handles[0],probe:probes[0],maxSizeBytes:null},escaped));
});
test('Series scope cannot reuse mutable bases or retain a failed/asynchronous scope',()=>{
 const {basis,handles,probes}=spaceFixture(),mutable=JSON.parse(JSON.stringify(basis));let escaped;
 withSeriesMediaSpaceEvaluation(scope=>{
  const input={basis:mutable,libraRunId:'run',handle:handles[0],probe:probes[0],maxSizeBytes:8};
  evaluateSeriesMediaSpace(input,scope);mutable.members[0].sizeBytes++;
  assert.throws(()=>evaluateSeriesMediaSpace(input,scope));
 });
 assert.throws(()=>withSeriesMediaSpaceEvaluation(scope=>{escaped=scope;throw new Error('read failed');}));
 assert.throws(()=>evaluateSeriesMediaSpace({basis,libraRunId:'run',handle:handles[0],probe:probes[0],maxSizeBytes:8},escaped));
 assert.throws(()=>withSeriesMediaSpaceEvaluation(()=>Promise.resolve()));
});


test('a frozen foreign accessor cannot retain another basis inside a Series scope',()=>{
 const {basis,handles,probes}=spaceFixture();let members=basis.members;
 const foreign=Object.freeze({...basis,get members(){return members;}});
 withSeriesMediaSpaceEvaluation(scope=>{
  const input={basis:foreign,libraRunId:'run',handle:handles[0],probe:probes[0],maxSizeBytes:8};
  evaluateSeriesMediaSpace(input,scope);
  members=Object.freeze(basis.members.map((m,i)=>i===0?Object.freeze({...m,sizeBytes:m.sizeBytes+1}):m));
  assert.throws(()=>evaluateSeriesMediaSpace(input,scope));
 });
});
