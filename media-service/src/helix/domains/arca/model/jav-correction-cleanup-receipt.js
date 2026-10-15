'use strict';
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionCleanupReceipt/v1';
function javCorrectionCleanupReceiptSchema(){
  const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
    result=()=>object({workId:text(),eventId:text(),resultSchemaRef:text(),resultDigest:digest()});
  return object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},correctionId:text(),shelfEntryId:text(),committedContextDigest:digest(),
    identityCommitReceiptDigest:digest(),formalRetirementResult:result(),workspaceReclaimResult:result(),completedAtMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},receiptDigest:digest()});
}
module.exports=Object.freeze({SCHEMA,javCorrectionCleanupReceiptSchema});
