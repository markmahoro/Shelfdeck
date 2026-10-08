'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const {productDispositionMembers,assertDispositionFinalReality}=require('../../src/helix/domains/arca/model/product-disposition');
const keys=[d('first'),d('second')].sort();
function fixture(){return {productStructureSnapshot:{structureKind:'season'},
  productMaterialManifest:{members:keys.map(materialKey=>({materialKey,role:'primary_payload',
    controlOperation:'acquire_workspace_product',episodeClaims:[{episodeKey:'E1'}]}))},
  offloadContextManifest:{members:[{materialKey:d('old'),contextRole:'original_input',sourceRelatedReferenceId:null,
    finalProductMaterialKeys:keys,dispositionKind:'replaced_and_settled',settlementExpectation:'remove_after_place'}]}};}
test('Arca preserves all targets in one source disposition and verifies every placed member',()=>{
  const p=fixture(),members=productDispositionMembers(p),reality={members:keys.map(sourceMaterialKey=>({sourceMaterialKey}))};
  assert.equal(members.length,1);assert.deepEqual(members[0].finalMaterialKeys,keys);
  assert.equal(Object.hasOwn(members[0],'finalMaterialKey'),false);
  assert.equal(members[0].sourceToFinalMappingDigest,d(p.offloadContextManifest.members[0]));
  assertDispositionFinalReality({members},reality);
  for(const key of keys)assert.throws(()=>assertDispositionFinalReality({members},{members:reality.members.filter(row=>row.sourceMaterialKey!==key)}),/every disposition target/);
  assert.throws(()=>assertDispositionFinalReality({members},{members:[...reality.members,reality.members[0]]}),/every disposition target/);
});
test('Arca rejects missing, duplicate, unclaimed and non-Series multi-target Package members',()=>{
  for(const mutate of [p=>p.productMaterialManifest.members.pop(),p=>p.productMaterialManifest.members.push(p.productMaterialManifest.members[0]),
    p=>p.productMaterialManifest.members[1].episodeClaims=[],p=>p.productMaterialManifest.members[1].role='artifact',
    p=>p.productMaterialManifest.members[1].controlOperation='transfer_input_control',p=>p.productStructureSnapshot.structureKind='single',
    p=>p.offloadContextManifest.members[0].finalProductMaterialKeys=[...keys].reverse(),
    p=>p.offloadContextManifest.members[0].finalProductMaterialKey=keys[0]]){
    const p=fixture();mutate(p);assert.throws(()=>productDispositionMembers(p));
  }
});
test('Single-target Movie and Related dispositions keep their exact scalar representation',()=>{
  for(const related of [false,true]){
    const p=fixture(),source=p.offloadContextManifest.members[0];p.productStructureSnapshot.structureKind='single';
    delete source.finalProductMaterialKeys;source.finalProductMaterialKey=keys[0];
    if(related){source.contextRole='related_input';source.sourceRelatedReferenceId='reference';source.derivedAuthorityDigest=d('authority');p.productMaterialManifest.members[0].controlOperation='assert_related_input';}
    const members=productDispositionMembers(p);assert.equal(members[0].finalMaterialKey,keys[0]);assert.equal(Object.hasOwn(members[0],'finalMaterialKeys'),false);
    assert.equal(members[0].finalRole,related?'related':'primary_payload');
    assertDispositionFinalReality({members},{members:[{sourceMaterialKey:keys[0]}]});
  }
});
test('Final Reality cannot accept malformed or truncated cardinality variants',()=>{
  const member=productDispositionMembers(fixture())[0],reality={members:keys.map(sourceMaterialKey=>({sourceMaterialKey}))};
  for(const change of [{finalMaterialKey:keys[0]},{finalMaterialKeys:[keys[0]]},{finalMaterialKeys:[...keys].reverse()},
    {finalMaterialKeys:[keys[0],keys[0]]},{finalRole:'related'},{dispositionKind:'carried_forward'},{sourceRelatedReferenceId:'related'}])
    assert.throws(()=>assertDispositionFinalReality({members:[{...member,...change}]},reality));
});
