'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {settlementHandles}=require('../../src/helix/domains/arca/model/input-settlement-scope');
const d=value=>canonicalDigest({value});
function fixture(role='original_input'){
  const source={materialKey:d('old'),contextRole:role,finalProductMaterialKey:d('final'),
    physicalIdentity:{materialKey:d('old'),sizeBytes:12},bindingRevision:1,endpointId:'field',location:'/field/old.mkv',
    memberDigest:d('offload-member'),settlementExpectation:'remove_after_place',
    sourceRelatedReferenceId:role==='related_input'?'related-1':null,derivedAuthorityDigest:role==='related_input'?d('exclusive-authority'):null};
  return {c:{responsibility:{onDeckRunId:'run-1',custodyId:'custody-1'},
    packageValue:{offloadContextManifest:{members:[source]},productMaterialManifest:{manifestDigest:d('product')}},
    settlementFinalMember:{sourceMaterialKey:d('final'),targetLocation:'/shelf/final.mkv'}},
    verification:{schemaRef:'helix://contracts/types/FinalProductVerification/v1',result:'passed',
      productManifestDigest:d('product'),verifiedMaterialKeys:[d('final')],finalRealityDigest:d('fresh-final')},
    authorization:{authorizationId:'standing',revision:1,state:'enabled',authorizationScopeKind:'old_primary_and_exclusive_related',
      actorId:'librarian',authorizationDigest:d('grant')}};
}
function scope(f){return settlementHandles(f.c,d('old'),f.verification,f.authorization);}
for(const kind of ['absent','revoked'])test('UAT-172 '+kind+' standing authorization blocks settlement scope',()=>{
  const f=fixture();f.authorization=kind==='absent'?null:{...f.authorization,state:'revoked'};
  assert.throws(()=>scope(f),error=>error.code==='ARCA_INPUT_SETTLEMENT_AUTHORIZATION_REQUIRED');
});
for(const role of ['original_input','structural_dependency','related_input'])test('UAT-172 explicit scope covers '+role,()=>{
  const f=fixture(role),allowed=scope(f);
  assert.equal(allowed.members[0].finalProductVerificationDigest,canonicalDigest(f.verification));
  f.authorization={...f.authorization,authorizationScopeKind:role==='related_input'?'old_primary_input':'exclusive_related_input'};
  assert.throws(()=>scope(f),error=>error.code==='ARCA_INPUT_SETTLEMENT_AUTHORIZATION_REQUIRED');
});
test('UAT-172 unknown or unproven related authority cannot acquire a deletion scope',()=>{
  assert.throws(()=>scope(fixture('shared_related')));
  const f=fixture('related_input');f.c.packageValue.offloadContextManifest.members[0].derivedAuthorityDigest=null;
  assert.throws(()=>scope(f),/exclusive derived authority/);
});
test('UAT-172 failed, other-package or missing successor final evidence cannot authorize old input deletion',()=>{
  for(const change of [{result:'failed'},{productManifestDigest:d('other-package')},{verifiedMaterialKeys:[]}]){
    const f=fixture();f.verification={...f.verification,...change};assert.throws(()=>scope(f));
  }
});
test('UAT-172 new authorization or Final Verification invalidates the old exact approval scope',()=>{
  const f=fixture(),original=scope(f);
  f.authorization={...f.authorization,revision:2,authorizationDigest:d('new-grant')};
  assert.notEqual(scope(f).approvalScopeDigest,original.approvalScopeDigest);
  f.verification={...f.verification,finalRealityDigest:d('new-final')};
  assert.notEqual(scope(f).memberSetDigest,original.memberSetDigest);
});

function multipleTargets(){
  const f=fixture(),source=f.c.packageValue.offloadContextManifest.members[0],keys=[d('new-one'),d('new-two')].sort();
  delete source.finalProductMaterialKey;source.finalProductMaterialKeys=keys;source.dispositionKind='replaced_and_settled';
  delete f.c.settlementFinalMember;
  f.c.settlementFinalMembers=keys.map((sourceMaterialKey,index)=>({sourceMaterialKey,targetLocation:'/shelf/new-'+index+'.mkv'}));
  f.verification.verifiedMaterialKeys=keys;
  return f;
}
test('Series Settlement binds all target locations and final verification into one source approval',()=>{
  const f=multipleTargets(),original=scope(f),member=original.members[0];
  assert.equal(original.members.length,1);assert.equal(member.materialKey,d('old'));
  assert.equal(Object.hasOwn(member,'finalMaterialKey'),false);assert.equal(Object.hasOwn(member,'finalTargetLocation'),false);
  assert.deepEqual(member.finalTargets,f.c.settlementFinalMembers.map(row=>({materialKey:row.sourceMaterialKey,targetLocation:row.targetLocation})));
  assert.ok(Object.isFrozen(member.finalTargets));
  for(const index of [0,1]){
    const changed=multipleTargets();changed.c.settlementFinalMembers[index].targetLocation+='.changed';
    assert.notEqual(scope(changed).approvalScopeDigest,original.approvalScopeDigest);
    assert.notEqual(scope(changed).memberSetDigest,original.memberSetDigest);
  }
  f.verification.finalRealityDigest=d('changed-final');assert.notEqual(scope(f).approvalScopeDigest,original.approvalScopeDigest);
});
test('Series Settlement cannot approve partial, duplicated, reordered or malformed final targets',()=>{
  for(const change of [f=>f.c.settlementFinalMembers.pop(),f=>f.c.settlementFinalMembers.reverse(),
    f=>f.c.settlementFinalMembers.push(f.c.settlementFinalMembers[0]),f=>f.c.settlementFinalMembers[1].targetLocation='',
    f=>f.verification.verifiedMaterialKeys=f.verification.verifiedMaterialKeys.slice(0,1),
    f=>f.verification.verifiedMaterialKeys=[...f.verification.verifiedMaterialKeys,f.verification.verifiedMaterialKeys[0]],
    f=>f.c.packageValue.offloadContextManifest.members[0].sourceRelatedReferenceId='related']){
    const f=multipleTargets();change(f);assert.throws(()=>scope(f));
  }
});
