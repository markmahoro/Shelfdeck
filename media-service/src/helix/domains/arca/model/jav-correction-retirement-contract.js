'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const CAPABILITY='arca.jav_correction.formal_retirement.execute@1',SCOPE_SCHEMA='helix://contracts/domain-types/JavCorrectionRetirementScope/v1',
  RESULT_SCHEMA='helix://contracts/types/JavCorrectionFormalRetirementReceipt/v1';
const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),revision=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER});
function retirementScopeSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCOPE_SCHEMA,title:'JavCorrectionRetirementScope@1',
  'x-helix-ssotRefs':['8.6.19'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':4096,
  ...object({schemaRef:{const:SCOPE_SCHEMA},schemaVersion:{const:1},objectId:text(),revision:revision(),objectKind:{const:'jav-correction-retirement-scope'},
    correctionId:text(),shelfEntryId:text(),committedContextDigest:digest(),commitReceiptDigest:digest(),retirementPlanDigest:digest(),guardDigest:digest(),digest:digest()})};}
function buildRetirementScope(record,plan){
  if(record?.state!=='committed'||!['pending','active','attention_required'].includes(record.cleanupState)||!record.committedContext||
      plan?.correctionId!==record.correctionId||plan.shelfEntryId!==record.shelfEntryId||plan.commitReceiptDigest!==record.committedContext.receiptDigest)
    throw Object.assign(new Error('Retirement requires this committed correction and its unfinished cleanup responsibility.'),{code:'ARCA_JAV_CORRECTION_RETIREMENT_SCOPE_STALE'});
  const body={schemaRef:SCOPE_SCHEMA,schemaVersion:1,objectId:record.correctionId,revision:record.stateRevision,objectKind:'jav-correction-retirement-scope',
    correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,committedContextDigest:record.committedContext.contextDigest,commitReceiptDigest:plan.commitReceiptDigest,
    retirementPlanDigest:plan.planDigest,guardDigest:plan.guardDigest};return Object.freeze({...body,digest:canonicalDigest(body)});
}
function retirementReceiptSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:RESULT_SCHEMA,title:'JavCorrectionFormalRetirementReceipt@1',
  'x-helix-ssotRefs':['8.6.19'],'x-helix-envelopeRef':'helix://contracts/types/ReceiptEnvelope/v1','x-helix-maxCanonicalBytes':16384,
  ...object({schemaRef:{const:RESULT_SCHEMA},schemaVersion:{const:1},receiptId:text(),receiptKind:{const:'jav_correction_formal_retirement'},ownerDomain:{const:'arca'},
    scopeType:{const:'jav_identity_correction'},scopeId:text(),scopeDigest:digest(),effectReceiptRef:text(),committedAtMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
    correctionId:text(),shelfEntryId:text(),committedContextDigest:digest(),commitReceiptDigest:digest(),retirementPlanDigest:digest(),guardDigest:digest(),
    finalMaterialSetDigest:digest(),retiredAliasSetDigest:digest(),retiredAliasCount:{type:'integer',minimum:8,maximum:3072},stageDisposition:{const:'absent'},realityDigest:digest()})};}
function retirementWorkId(scope,record=null){const base='arca-jav-retirement-work-'+scope.digest.slice(0,40);
  return record?require('./jav-correction-recovery').recoveryWorkId(record,'jav_correction_formal_retirement',base):base;}
module.exports=Object.freeze({CAPABILITY,SCOPE_SCHEMA,RESULT_SCHEMA,retirementScopeSchema,retirementReceiptSchema,buildRetirementScope,retirementWorkId});
