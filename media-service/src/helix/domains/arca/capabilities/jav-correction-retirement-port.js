'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {CAPABILITY,SCOPE_SCHEMA,RESULT_SCHEMA,buildRetirementScope}=require('../model/jav-correction-retirement-contract');
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const fail=()=>{throw Object.assign(new Error('Retirement execution lost its exact committed cleanup scope.'),{code:'ARCA_JAV_CORRECTION_RETIREMENT_SCOPE_STALE'});};
function createJavCorrectionRetirementPort(options){
  const validator=options.contractValidator,now=options.now||Date.now;
  function current(correctionId){const record=options.correctionStore.get(correctionId),plan=options.retirementPreparation.prepare(correctionId),scope=buildRetirementScope(record,plan);return {record,plan,scope};}
  function context(execution){const input=execution.namedInputs?.javCorrectionRetirementScope;validator.validate(SCOPE_SCHEMA,input);
    const value=current(input.correctionId);
    if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||execution.ownerScope.processId!==input.correctionId||
        canonicalDigest(input)!==canonicalDigest(value.scope))fail();return value;}
  function ioOptions(execution,c){return {shouldContinue:()=>{execution.assertExecutionActive?.();context(execution);return true;},
    readCurrentGuardDigest:()=>current(c.record.correctionId).plan.guardDigest,recoveryDecision:execution.recoveryDecision};}
  return Object.freeze({validateInputs:context,async execute(execution){
    const c=context(execution),reality=await options.retirementIo.retire(c.plan,ioOptions(execution,c)),at=execution.effectOccurredAtMs??now(),
      result={schemaRef:RESULT_SCHEMA,schemaVersion:1,receiptId:stable('arca-jav-retirement-receipt-',{eventId:execution.eventId}),receiptKind:'jav_correction_formal_retirement',
        ownerDomain:'arca',scopeType:'jav_identity_correction',scopeId:c.record.correctionId,scopeDigest:c.scope.digest,
        effectReceiptRef:stable('arca-jav-retirement-effect-',{eventId:execution.eventId}),committedAtMs:at,correctionId:c.record.correctionId,shelfEntryId:c.record.shelfEntryId,
        committedContextDigest:c.scope.committedContextDigest,commitReceiptDigest:c.scope.commitReceiptDigest,retirementPlanDigest:c.plan.planDigest,guardDigest:c.plan.guardDigest,
        finalMaterialSetDigest:reality.finalMaterialSetDigest,retiredAliasSetDigest:reality.retiredAliasSetDigest,retiredAliasCount:reality.retiredAliasCount,stageDisposition:'absent',realityDigest:reality.realityDigest};
    validator.validate(RESULT_SCHEMA,result);context(execution);
    const evidence={evidenceId:stable('arca-jav-retirement-evidence-',{result}),evidenceKind:'jav_identity_correction',producerRef:CAPABILITY,basisDigest:c.scope.digest,
      payloadDigest:canonicalDigest(result),observedAtMs:at};
    return {kind:'succeeded',resultSchemaRef:RESULT_SCHEMA,result,evidenceSchemaRef:'helix://contracts/capabilities/arca.jav_correction.formal_retirement.execute/v1/evidence',evidence,
      effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:result.effectReceiptRef,effectId:canonicalDigest(['material_commit',execution.idempotencyKey]),
        effectClass:'material_commit',idempotencyKey:execution.idempotencyKey,commitMarker:stable('arca-jav-retirement-marker-',{eventId:execution.eventId}),externalReceiptRef:null,
        outputDigest:canonicalDigest(result),verificationEvidenceDigest:canonicalDigest(evidence),committedAtMs:at}};
  },async validateResult(execution,value){
    const c=context(execution);validator.validate(RESULT_SCHEMA,value.result);const reality=await options.retirementIo.verifyRetired(c.plan,ioOptions(execution,c)),result=value.result;
    if(result.scopeDigest!==c.scope.digest||result.correctionId!==c.record.correctionId||result.shelfEntryId!==c.record.shelfEntryId||
        result.committedContextDigest!==c.scope.committedContextDigest||result.commitReceiptDigest!==c.scope.commitReceiptDigest||result.retirementPlanDigest!==c.plan.planDigest||
        result.guardDigest!==c.plan.guardDigest||result.realityDigest!==reality.realityDigest||result.finalMaterialSetDigest!==reality.finalMaterialSetDigest||
        result.retiredAliasSetDigest!==reality.retiredAliasSetDigest||result.retiredAliasCount!==reality.retiredAliasCount)fail();
  },async observeEffectReality(value){
    try{const c=current(value.work.process_id),work=options.workResultReader.status(value.work.work_id);
      if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==c.record.correctionId||
        work.basis_digest!==c.scope.digest||value.event.work_id!==value.work.work_id||value.event.capability_ref!==CAPABILITY)fail();
      const inspected=await options.retirementIo.preflight(c.plan,{shouldContinue:()=>true,readCurrentGuardDigest:()=>current(c.record.correctionId).plan.guardDigest,recoveryDecision:'continue_forward'});
      return {status:'forward_required',rollbackDeclared:false,evidenceDigest:canonicalDigest({scopeDigest:c.scope.digest,present:inspected.members.map(row=>row.stat!==null)})};
    }catch(error){return {status:'conflict',rollbackDeclared:false,evidenceDigest:canonicalDigest({schema:'arca.retirement-recovery-conflict@1',reasonCode:error.code||'ARCA_JAV_CORRECTION_RETIREMENT_INVALID'})};}
  }});
}
module.exports=Object.freeze({createJavCorrectionRetirementPort});
