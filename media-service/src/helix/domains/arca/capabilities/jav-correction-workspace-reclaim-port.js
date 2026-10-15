'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {CAPABILITY,SCOPE_SCHEMA,RESULT_SCHEMA}=require('../model/jav-correction-workspace-reclaim-contract');
const fail=()=>{throw Object.assign(new Error('Workspace reclaim execution lost its exact committed cleanup scope.'),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_SCOPE_STALE'});};
function createJavCorrectionWorkspaceReclaimPort(options){
  function current(correctionId){return options.workspaceReclaimPreparation.readScope(correctionId);}
  function context(execution){const input=execution.namedInputs?.javCorrectionWorkspaceReclaimScope;options.contractValidator.validate(SCOPE_SCHEMA,input);
    const c=current(input.correctionId);
    if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||execution.ownerScope.processId!==input.correctionId||
        canonicalDigest(input)!==canonicalDigest(c.scope))fail();return c;
  }
  function ioOptions(execution,c){return {shouldContinue:()=>{execution.assertExecutionActive?.();context(execution);return true;},
    readCurrentGuardDigest:()=>current(c.record.correctionId).plan.guardDigest,recoveryDecision:execution.recoveryDecision};}
  return Object.freeze({validateInputs:context,execute(execution){
    const c=context(execution),prior=options.workspaceStore.readReclamation(execution);
    if(prior){options.workspaceReclaimIo.verifyReclaimed(c.plan,ioOptions(execution,c));return prior;}
    options.workspaceReclaimIo.reclaim(c.plan,ioOptions(execution,c));context(execution);execution.assertExecutionActive?.();
    return options.workspaceStore.commitReclamation(execution,c,()=>options.workspaceReclaimIo.verifyReclaimed(c.plan,
      {shouldContinue:()=>true,readCurrentGuardDigest:()=>c.plan.guardDigest}));
  },validateResult(execution,value){const c=context(execution);options.contractValidator.validate(RESULT_SCHEMA,value.result);
    const saved=options.workspaceStore.readReclamation(execution),reality=options.workspaceReclaimIo.verifyReclaimed(c.plan,ioOptions(execution,c));
    if(!saved||canonicalDigest(saved.result)!==canonicalDigest(value.result)||value.result.realityDigest!==reality.realityDigest||
        value.result.scopeDigest!==c.scope.digest||value.result.reclaimPlanDigest!==c.plan.planDigest||value.result.guardDigest!==c.plan.guardDigest)fail();
  },observeEffectReality(value){
    try{const c=current(value.work.process_id),work=options.workResultReader.status(value.work.work_id);
      if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==c.record.correctionId||
          work.work_kind!=='jav_correction_workspace_reclaim'||work.basis_digest!==c.scope.digest||value.event.work_id!==value.work.work_id||value.event.capability_ref!==CAPABILITY)fail();
      const observed=options.workspaceReclaimIo.preflight(c.plan,{shouldContinue:()=>true,readCurrentGuardDigest:()=>current(c.record.correctionId).plan.guardDigest,recoveryDecision:'continue_forward'});
      return {status:'matching',cleanupDeclared:false,evidenceDigest:canonicalDigest({scopeDigest:c.scope.digest,present:observed.members.map(row=>row.stat!==null)})};
    }catch(error){return {status:'conflict',cleanupDeclared:false,evidenceDigest:canonicalDigest({schema:'arca.workspace-reclaim-recovery-conflict@1',reasonCode:error.code||'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_INVALID'})};}
  }});
}
module.exports=Object.freeze({createJavCorrectionWorkspaceReclaimPort});
