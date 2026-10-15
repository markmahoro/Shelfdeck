'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createJavCorrectionCleanupStore}=require('../persistence/jav-correction-cleanup-store');
const {CAPABILITY:FORMAL_CAPABILITY,retirementWorkId}=require('../model/jav-correction-retirement-contract');
const {CAPABILITY:WORKSPACE_CAPABILITY,workspaceReclaimWorkId}=require('../model/jav-correction-workspace-reclaim-contract');
const fail=()=>{throw Object.assign(new Error('Cleanup completion needs both exact successful cleanup Works.'),{code:'ARCA_JAV_CORRECTION_CLEANUP_NOT_READY'});};
function createJavCorrectionCleanupCompletion(options){
  const store=createJavCorrectionCleanupStore(options);
  function result(correctionId,workId,basisDigest,capabilityRef){const work=options.workResultReader.status(workId),
    rows=options.workResultReader.read(workId).filter(row=>row.capabilityRef===capabilityRef&&row.state==='succeeded'&&row.outcomeKind==='succeeded');
    if(work?.state!=='succeeded'||work.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==correctionId||
        work.basis_digest!==basisDigest||rows.length!==1||rows[0].resultDigest!==canonicalDigest(rows[0].result))fail();return rows[0];}
  return Object.freeze({read:store.read,async complete(correctionId){
    const previous=store.read(correctionId);if(previous)return {kind:'cleanup_completed',correctionId,receipt:previous};
    try{
      const record=options.correctionStore.get(correctionId);if(record?.state!=='committed'||record.cleanupState!=='active')fail();
      const formal=options.retirementPreparation.readScope(correctionId),workspace=options.workspaceReclaimPreparation.readScope(correctionId),
        prepared={record,formalPlan:formal.plan,workspacePlan:workspace.plan,
          formal:result(correctionId,retirementWorkId(formal.scope,record),formal.scope.digest,FORMAL_CAPABILITY),
          workspace:result(correctionId,workspaceReclaimWorkId(workspace.scope,record),workspace.scope.digest,WORKSPACE_CAPABILITY)};
      const receipt=store.complete(prepared);options.onCorrectionCleanupCompleted?.({correctionId});return {kind:'cleanup_completed',correctionId,receipt};
    }catch(error){
      const completed=store.read(correctionId);if(completed){options.onError?.(error);return {kind:'cleanup_completed',correctionId,receipt:completed};}
      if(error.code==='ARCA_JAV_CORRECTION_CLEANUP_INTEGRITY')throw error;
      const current=options.correctionStore.get(correctionId);
      if(current?.cleanupState==='active'&&/^ARCA_JAV_CORRECTION_/.test(error.code||'')){
        options.correctionStore.updateCleanupState(correctionId,{expectedState:'active',nextState:'attention_required',contextDigest:current.committedContext.contextDigest});
        return {kind:'cleanup_attention_required',correctionId,reasonCode:error.code};
      }
      throw error;
    }
  }});
}
module.exports=Object.freeze({createJavCorrectionCleanupCompletion});
