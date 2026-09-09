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
