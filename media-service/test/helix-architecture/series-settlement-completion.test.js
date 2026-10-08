'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const {settlementTargetEntries,dispositionCompletions}=require('../../src/helix/domains/arca/model/settlement-completion');
function fixture(){
  const keys=[d('a'),d('b')].sort(),source={materialKey:d('old'),contextRole:'original_input',dispositionKind:'replaced_and_settled',
    settlementExpectation:'remove_after_place',finalProductMaterialKeys:keys},
    finalTargets=keys.map((materialKey,index)=>({materialKey,targetLocation:'/season/'+index+'.mkv',finalRealityDigest:d('observation'+index)})),
    member={finalTargets:finalTargets.map(({materialKey,targetLocation})=>({materialKey,targetLocation})),sourceToFinalMappingDigest:d(source)},
    settled={finalTargets,sourceToFinalMappingDigest:d(source),absent:true,disposition:'settled_to_final',finalVerified:true,
      finalRealityDigest:d({schema:'arca.settlement-final-targets@1',members:finalTargets})};
  const recordBody={schemaRef:'arca://types/PostDeleteReality/v1',schemaVersion:1,recordKind:'post-delete-reality',entries:[
    ...settlementTargetEntries(member,settled),...['absent','disposition'].map(key=>({key,value:settled[key]})),
    {key:'source_to_final_mapping_digest',value:d(source)},{key:'final_verified',value:true},{key:'final_reality_digest',value:settled.finalRealityDigest}]};
  const body={materialKey:source.materialKey,postDeleteReality:{...recordBody,recordDigest:d(recordBody)}},evidence={...body,payloadDigest:d(body)};
  return {member,settled,evidence,packageValue:{offloadContextManifest:{members:[source]}},
    staged:{members:finalTargets.map(row=>({sourceMaterialKey:row.materialKey,location:row.targetLocation,digestHex:row.finalRealityDigest}))}};
}
const complete=f=>dispositionCompletions(f.packageValue,f.staged,[f.evidence]);
test('Series completion binds every successor into one source completion',()=>{
  const f=fixture(),rows=complete(f);assert.equal(rows.length,1);
  assert.deepEqual(rows[0].finalMaterialKeys,f.member.finalTargets.map(item=>item.materialKey));
  assert.equal(rows[0].evidenceDigest,f.evidence.payloadDigest);
});
test('Series completion rejects omitted targets, stale reality, altered evidence and duplicate success',()=>{
  for(const mutate of [f=>f.staged.members.pop(),f=>f.staged.members.push(f.staged.members[0]),
    f=>f.staged.members[1].location+='wrong',f=>f.staged.members[1].digestHex=d('changed'),
    f=>f.evidence.postDeleteReality.entries[0].value.pop(),f=>f.evidence.payloadDigest=d('wrong'),
    f=>f.evidence.postDeleteReality.entries.push(f.evidence.postDeleteReality.entries[0])]){
    const f=fixture();mutate(f);assert.throws(()=>complete(f));
  }
  const f=fixture();assert.throws(()=>dispositionCompletions(f.packageValue,f.staged,[f.evidence,f.evidence]));
});
test('Series port result cannot silently truncate the approved target set',()=>{
  const f=fixture();assert.throws(()=>settlementTargetEntries(f.member,{...f.settled,finalTargets:f.settled.finalTargets.slice(0,1)}));
  assert.throws(()=>settlementTargetEntries(f.member,{...f.settled,absent:false}));
  assert.throws(()=>settlementTargetEntries(f.member,{...f.settled,sourceToFinalMappingDigest:d('wrong')}));
});
