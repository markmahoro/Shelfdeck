'use strict';

const SHA=/^[a-f0-9]{64}$/;
function fail(){throw Object.assign(new Error('Custom target commit fence is invalid.'),{code:'LIBRA_CUSTOM_TARGET_FENCE_INVALID'});}
function currentTargetMatches({subjectId,productScopeDigest,targetKind,customTargetRef,head}){
  if(typeof subjectId!=='string'||!subjectId||!SHA.test(productScopeDigest||'')||
      targetKind!==undefined&&targetKind!=='user_custom'||targetKind===undefined&&customTargetRef!==undefined)fail();
  if(targetKind==='user_custom'){
    if(!customTargetRef||typeof customTargetRef!=='object'||Array.isArray(customTargetRef)||
        Object.keys(customTargetRef).sort().join(',')!=='intentDigest,intentId,previewDigest,schemaRef,targetRequirementsDigest,targetRevision'||
        customTargetRef.schemaRef!=='libra.custom-target-reference@1'||!Number.isSafeInteger(customTargetRef.targetRevision)||customTargetRef.targetRevision<1||
        ['intentId','intentDigest','previewDigest','targetRequirementsDigest'].some(key=>!SHA.test(customTargetRef[key]||'')))fail();
  }
  if(head===null||head===undefined){if(targetKind==='user_custom')fail();return true;}
  if(!head||typeof head!=='object'||Array.isArray(head)||head.subject_id!==subjectId||head.product_scope_digest!==productScopeDigest||
      !Number.isSafeInteger(head.current_revision)||head.current_revision<1||!SHA.test(head.intent_id||'')||!SHA.test(head.record_digest||''))fail();
  return targetKind==='user_custom'&&head.intent_id===customTargetRef.intentId&&head.record_digest===customTargetRef.intentDigest&&
    Number(head.current_revision)===customTargetRef.targetRevision;
}

module.exports=Object.freeze({currentTargetMatches});
