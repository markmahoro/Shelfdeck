'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionCommittedContext/v1';
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_COMMITTED_CONTEXT_INVALID'});};
function buildJavCorrectionCommittedContext({record,execution,receipt,filePlan,stagedRecord}){
  const {planDigest,...planBody}=filePlan||{};
  if(record?.state!=='active'||!receipt||filePlan?.correctionId!==record.correctionId||filePlan.shelfEntryId!==record.shelfEntryId||
      filePlan.admissionDigest!==record.admissionDigest||planDigest!==canonicalDigest(planBody)||
      execution?.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||execution.ownerScope.processId!==record.correctionId||
      execution.capabilityRef!=='arca.jav_correction.inventory.commit@1'||execution.namedInputs?.javCorrectionScope?.digest!==filePlan.scopeDigest||
      receipt.correctionId!==record.correctionId||receipt.shelfEntryId!==record.shelfEntryId||receipt.scopeDigest!==filePlan.scopeDigest||
      !Array.isArray(filePlan.members)||filePlan.members.length<4||
      stagedRecord?.schemaRef!=='helix://contracts/types/StagedInventoryManifestRecord/v1'||stagedRecord.memberCount!==filePlan.members.length)
    fail('Committed context must bind the actual commit execution, Receipt, File Plan and staged Record.');
  const body={schemaRef:SCHEMA,schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,
    receiptDigest:canonicalDigest(receipt),commitReference:{workId:execution.workId,eventId:execution.eventId,eventAttemptId:execution.eventAttemptId,
      idempotencyKey:execution.idempotencyKey,scopeDigest:receipt.scopeDigest},filePlan,stagedRecord};
  if(Buffer.byteLength(canonicalJson(body))>4*1024*1024)fail('Complete committed context exceeds its bounded cleanup provenance budget.');
  return Object.freeze({...body,contextDigest:canonicalDigest(body)});
}
function assertJavCorrectionCommittedContext(value,record){
  const {contextDigest,...body}=value||{},plan=value?.filePlan;
  const {planDigest,...planBody}=plan||{};
  if(!record||record.state!=='committed'||contextDigest!==canonicalDigest(body)||value.schemaRef!==SCHEMA||
      value.correctionId!==record.correctionId||value.shelfEntryId!==record.shelfEntryId||value.admissionDigest!==record.admissionDigest||
      plan?.correctionId!==record.correctionId||plan.shelfEntryId!==record.shelfEntryId||plan.admissionDigest!==record.admissionDigest||
      plan.scopeDigest!==value.commitReference?.scopeDigest||plan.basisDigest!==record.proof.basis.basisDigest||
      plan.placementPreviewDigest!==record.proof.placementPreviewDigest||planDigest!==canonicalDigest(planBody))
    fail('Committed context does not conserve its immutable actual correction and approved scope.');
  return value;
}
function javCorrectionCommittedContextSchema(){
  const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
  return object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},correctionId:text(),shelfEntryId:text(),admissionDigest:digest(),receiptDigest:digest(),contextDigest:digest(),
    commitReference:object({workId:text(),eventId:text(),eventAttemptId:text(),idempotencyKey:text(),scopeDigest:digest()}),
    filePlan:{$ref:'helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1'},stagedRecord:{$ref:'helix://contracts/types/StagedInventoryManifestRecord/v1'}});
}
module.exports=Object.freeze({SCHEMA,buildJavCorrectionCommittedContext,assertJavCorrectionCommittedContext,javCorrectionCommittedContextSchema});
