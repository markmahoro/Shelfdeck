'use strict';
const {recoveryMode}=require('../model/jav-correction-recovery');
function createJavCorrectionAdmin({correction}) {
  const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
  const exact=(body,keys)=>{if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).sort().join(',')!==[...keys].sort().join(','))
    fail('ARCA_JAV_CORRECTION_INPUT_INVALID','JAV correction input contains missing or unsupported fields.');};
  return Object.freeze({
    async preview(shelfEntryId,body){exact(body,body?.siteRef!==undefined?['javCode','siteRef','resourceKey']:['javCode']);if(typeof body.javCode!=='string'||body.javCode.length>64)
      fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Enter one complete JAV code.');return correction.preview.preview(shelfEntryId,body);},
    confirm(shelfEntryId,body,actorId){exact(body,['previewId','basisDigest','proposalDigest','placementPreviewDigest','idempotencyKey']);
      let accepted;
      try{accepted=correction.correctionStore.admit({...body,shelfEntryId,actorId},()=>correction.preview.readPreview(shelfEntryId,body.previewId));}
      catch(error){if(error.code==='P3_COMMAND_IDEMPOTENCY_CONFLICT')fail('ARCA_JAV_CORRECTION_COMMAND_CONFLICT','Correction retry does not match the original confirmation.');throw error;}
      const result=accepted.receipt.resultRef;return Object.freeze({correctionId:result.correctionId,shelfEntryId,state:'admitted',stateRevision:result.stateRevision,admissionDigest:result.admissionDigest,updatedAtMs:result.admittedAtMs,replayed:accepted.replayed});},
    cancel(shelfEntryId,correctionId,body,actorId){exact(body,['expectedStateRevision','expectedAdmissionDigest','idempotencyKey']);
      try{const accepted=correction.correctionStore.cancelNoEffect({...body,shelfEntryId,correctionId,actorId});return {...accepted.receipt.resultRef,replayed:accepted.replayed};}
      catch(error){if(error.code==='P3_COMMAND_IDEMPOTENCY_CONFLICT')fail('ARCA_JAV_CORRECTION_COMMAND_CONFLICT','Cancellation retry differs from the original request.');throw error;}},
    async recover(shelfEntryId,correctionId,body,actorId){
      exact(body,['expectedStateRevision','expectedAdmissionDigest','expectedCleanupState','expectedRecoveryIntentDigest','idempotencyKey']);
      const command={...body,shelfEntryId,correctionId,actorId};let accepted;
      try{
        try{accepted=correction.correctionStore.admitRecovery(command,null);}
        catch(error){if(error.code!=='ARCA_JAV_CORRECTION_RECOVERY_PREPARATION_REQUIRED')throw error;
          const record=correction.correctionStore.get(correctionId);
          if(!record||record.shelfEntryId!==shelfEntryId)fail('ARCA_JAV_CORRECTION_NOT_FOUND','Correction was not found for this collection Entry.');
          if(record.stateRevision!==body.expectedStateRevision||record.admissionDigest!==body.expectedAdmissionDigest||record.cleanupState!==body.expectedCleanupState||
              (record.recoveryIntent?.receiptDigest||null)!==body.expectedRecoveryIntentDigest||!recoveryMode(record))
            fail('ARCA_JAV_CORRECTION_RECOVERY_STALE','Correction state changed before recovery.');
          const preparation=await correction.recoveryPreparation.prepare(shelfEntryId,correctionId);
          accepted=correction.correctionStore.admitRecovery(command,preparation);
        }
      }catch(error){if(error.code==='P3_COMMAND_IDEMPOTENCY_CONFLICT')fail('ARCA_JAV_CORRECTION_COMMAND_CONFLICT','Recovery retry differs from the original request.');throw error;}
      const receipt=accepted.receipt.resultRef;
      return Object.freeze({correctionId,shelfEntryId,state:receipt.mode==='continue_cleanup'?'committed':'active',stateRevision:receipt.acceptedStateRevision,
        admissionDigest:receipt.admissionDigest,cleanupState:receipt.mode==='continue_cleanup'?'active':null,recoveryIntentDigest:receipt.receiptDigest,updatedAtMs:receipt.admittedAtMs,replayed:accepted.replayed});
    },
    status(shelfEntryId,correctionId){const record=correction.correctionStore.get(correctionId);
      if(!record||record.shelfEntryId!==shelfEntryId)fail('ARCA_JAV_CORRECTION_NOT_FOUND','JAV correction was not found for this collection Entry.');
      return Object.freeze({correctionId,shelfEntryId,state:record.state,stateRevision:record.stateRevision,admissionDigest:record.admissionDigest,cleanupState:record.cleanupState,
        cancellation:correction.correctionStore.cancellationAvailability(record),
        recovery:{available:recoveryMode(record)!==null,mode:recoveryMode(record),previousIntentDigest:record.recoveryIntent?.receiptDigest||null},
        oldJavCode:record.proof.proposal.oldJavCode,newJavCode:record.proof.proposal.newJavCode,updatedAtMs:record.updatedAtMs});},
    latest(shelfEntryId){const record=correction.correctionStore.latest(shelfEntryId);return {correction:record?this.status(shelfEntryId,record.correctionId):null};},
  });
}
module.exports=Object.freeze({createJavCorrectionAdmin});
