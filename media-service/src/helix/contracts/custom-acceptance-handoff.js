'use strict';

const {canonicalDigest,canonicalJson}=require('./canonical-json');
const SCHEMA='libra.custom-acceptance-handoff@1';
const SHA=/^[a-f0-9]{64}$/;
const SPEC_KEYS=['acceptanceSpecId','specRevision','recordDigest','specDigest'];
const REF_KEYS=['schemaRef','intentId','intentDigest','targetRevision','previewDigest','targetRequirementsDigest'];
const KEYS=['schemaRef','subjectId','productScopeDigest','originalSpec','customSpec','customTargetRef','referenceDigest'];
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function validSpec(value){return exact(value,SPEC_KEYS)&&typeof value.acceptanceSpecId==='string'&&
  value.acceptanceSpecId.length>0&&value.acceptanceSpecId.length<=256&&Number.isSafeInteger(value.specRevision)&&
  value.specRevision>0&&SHA.test(value.recordDigest||'')&&SHA.test(value.specDigest||'');}
function assertCustomAcceptanceHandoff(value){
  const body=value&&Object.fromEntries(Object.entries(value).filter(([key])=>key!=='referenceDigest'));
  if(!exact(value,KEYS)||value.schemaRef!==SCHEMA||typeof value.subjectId!=='string'||!value.subjectId.trim()||
      value.subjectId.length>256||!SHA.test(value.productScopeDigest||'')||!validSpec(value.originalSpec)||
      !validSpec(value.customSpec)||!exact(value.customTargetRef,REF_KEYS)||
      value.customTargetRef.schemaRef!=='libra.custom-target-reference@1'||
      !['intentId','intentDigest','previewDigest','targetRequirementsDigest'].every(key=>SHA.test(value.customTargetRef[key]||''))||
      !Number.isSafeInteger(value.customTargetRef.targetRevision)||value.customTargetRef.targetRevision<1||
      value.referenceDigest!==canonicalDigest(body))
    throw Object.assign(new TypeError('Custom Acceptance Handoff reference is invalid.'),{code:'CUSTOM_ACCEPTANCE_HANDOFF_INVALID'});
  return value;
}
function buildCustomAcceptanceHandoff(spec){
  const source=spec?.originalTarget,ref=spec?.customTargetRef;
  const body={schemaRef:SCHEMA,subjectId:spec?.subjectId,productScopeDigest:spec?.productScope?.scopeDigest,
    originalSpec:{acceptanceSpecId:source?.acceptanceSpecId,specRevision:source?.specRevision,
      recordDigest:source?.recordDigest,specDigest:source?.specDigest},
    customSpec:{acceptanceSpecId:spec?.acceptanceSpecId,specRevision:spec?.specRevision,
      recordDigest:spec?.recordDigest,specDigest:spec?.specDigest},customTargetRef:ref};
  return Object.freeze(assertCustomAcceptanceHandoff({...body,referenceDigest:canonicalDigest(body)}));
}
function customAcceptanceHandoffSchema(){
  const digest={type:'string',pattern:'^[a-f0-9]{64}$'},id={type:'string',minLength:1,maxLength:256},
    positive={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
    spec=()=>object({acceptanceSpecId:id,specRevision:positive,recordDigest:digest,specDigest:digest});
  return object({schemaRef:{const:SCHEMA},subjectId:id,productScopeDigest:digest,originalSpec:spec(),customSpec:spec(),
    customTargetRef:object({schemaRef:{const:'libra.custom-target-reference@1'},intentId:digest,intentDigest:digest,
      targetRevision:positive,previewDigest:digest,targetRequirementsDigest:digest}),referenceDigest:digest});
}
module.exports=Object.freeze({SCHEMA,assertCustomAcceptanceHandoff,buildCustomAcceptanceHandoff,customAcceptanceHandoffSchema});
