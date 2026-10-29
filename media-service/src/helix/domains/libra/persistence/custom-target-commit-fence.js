'use strict';

const {currentTargetMatches}=require('../model/custom-target-commit-fence');
const customTargetHeadStatement=Object.freeze({kind:'select-one',tableId:'libra_custom_target_heads',
  columns:['subject_id','product_scope_digest','current_revision','intent_id','record_digest'],keyColumns:['subject_id','product_scope_digest']});
function readTargetCommitFence(repo,{subjectId,productScopeDigest,specJson,executionBasisRecordJson}){
  let spec;try{spec=JSON.parse(specJson);}catch{throw Object.assign(new Error('Custom target Spec is unreadable.'),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});}
  if(!spec||typeof spec!=='object'||Array.isArray(spec))throw Object.assign(new Error('Custom target Spec is invalid.'),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});
  let basis;try{basis=JSON.parse(executionBasisRecordJson);}catch{throw Object.assign(new Error('Collection target Run basis is unreadable.'),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});}
  if(!basis||typeof basis!=='object'||Array.isArray(basis))throw Object.assign(new Error('Collection target Run basis is invalid.'),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});
  const head=repo.invoke('find_custom_target_head',{subject_id:subjectId,product_scope_digest:productScopeDigest});
  return currentTargetMatches({subjectId,productScopeDigest,targetKind:spec.targetKind,customTargetRef:spec.customTargetRef,
    collectionTargetRef:basis.collectionTargetRef,head});
}

module.exports=Object.freeze({customTargetHeadStatement,readTargetCommitFence});
