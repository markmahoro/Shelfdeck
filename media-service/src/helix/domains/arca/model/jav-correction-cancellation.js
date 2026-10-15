'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionCancellationReceipt/v1';
function javCorrectionCancellationReceiptSchema(){
  const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    integer=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER});
  const properties={schemaRef:{const:SCHEMA},schemaVersion:{const:1},correctionId:text(),shelfEntryId:text(),state:{const:'cancelled'},
    admissionDigest:digest(),expectedStateRevision:integer(),stateRevision:integer(),basisDigest:digest(),noEffectObservationDigest:digest(),
    failedSourceAttemptsDigest:digest(),workId:text(),sourceEventId:text(),cancelledAtMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},receiptDigest:digest()};
  return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}
function buildJavCorrectionCancellationReceipt(record,observation,at){
  const {observationDigest,...body}=observation||{};
  if(record?.state!=='attention_required'||observation?.schema!=='arca.jav-correction-no-effect-observation@1'||observationDigest!==canonicalDigest(body)||observation.correctionId!==record.correctionId||
      observation.shelfEntryId!==record.shelfEntryId||observation.admissionDigest!==record.admissionDigest||
      observation.expectedStateRevision!==record.stateRevision||observation.basisDigest!==record.proof.basis.basisDigest||
      !Number.isSafeInteger(at)||at<0)throw Object.assign(new Error('Cancellation Receipt requires the exact current no-effect observation.'),{code:'ARCA_JAV_CORRECTION_CANCEL_STALE'});
  const receipt={schemaRef:SCHEMA,schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,state:'cancelled',admissionDigest:record.admissionDigest,
    expectedStateRevision:record.stateRevision,stateRevision:record.stateRevision+1,basisDigest:observation.basisDigest,noEffectObservationDigest:observationDigest,
    failedSourceAttemptsDigest:canonicalDigest(observation.failures),workId:observation.workId,sourceEventId:observation.sourceEventId,cancelledAtMs:at};
  return Object.freeze({...receipt,receiptDigest:canonicalDigest(receipt)});
}
module.exports=Object.freeze({SCHEMA,javCorrectionCancellationReceiptSchema,buildJavCorrectionCancellationReceipt});
