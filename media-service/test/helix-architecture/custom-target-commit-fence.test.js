'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {currentTargetMatches}=require('../../src/helix/domains/libra/model/custom-target-commit-fence');
function fixture(){const customTargetRef={schemaRef:'libra.custom-target-reference@1',intentId:D('intent'),intentDigest:D('record'),targetRevision:1,
  previewDigest:D('preview'),targetRequirementsDigest:D('requirements')},head={subject_id:'subject',product_scope_digest:D('scope'),current_revision:1,
    intent_id:customTargetRef.intentId,record_digest:customTargetRef.intentDigest};
  return {subjectId:'subject',productScopeDigest:D('scope'),targetKind:'user_custom',customTargetRef,head};}
test('a confirmed head immediately fences the old standard and permits only its exact custom target',()=>{
  const value=fixture();assert.equal(currentTargetMatches({...value,targetKind:undefined,customTargetRef:undefined,head:null}),true);
  assert.equal(currentTargetMatches({...value,targetKind:undefined,customTargetRef:undefined}),false);
  assert.equal(currentTargetMatches(value),true);
  for(const head of [{...value.head,current_revision:2},{...value.head,intent_id:D('another')},{...value.head,record_digest:D('other-record')}])
    assert.equal(currentTargetMatches({...value,head}),false);
});
test('missing or corrupt authority cannot be treated as ordinary eligibility',()=>{
  const value=fixture();for(const head of [null,false,0,{}, {...value.head,subject_id:'other'}, {...value.head,product_scope_digest:D('other-scope')},
    {...value.head,current_revision:'1'},{...value.head,record_digest:'invalid'}])
    assert.throws(()=>currentTargetMatches({...value,head}),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});
  for(const customTargetRef of [{...value.customTargetRef,targetRevision:0},{...value.customTargetRef,extra:true},{...value.customTargetRef,intentId:'invalid'}])
    assert.throws(()=>currentTargetMatches({...value,customTargetRef}),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});
});
