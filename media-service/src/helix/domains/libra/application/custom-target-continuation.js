'use strict';

const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createRunAdmissionStore}=require('../persistence/run-admission-store');

const pending=(reasonCode)=>Object.freeze({kind:'pending',reasonCode});
function createCustomTargetContinuation(options){
  if(!options?.schemaManifest||typeof options.unitOfWork?.captureReadFence!=='function'||
      typeof options.unitOfWork.execute!=='function'||typeof options.customTargetStore?.current!=='function'||
      typeof options.customTargetStore.intentEvidence!=='function'||typeof options.customSpecPublicationStore?.publish!=='function'||
      typeof options.customSpecPublicationStore.read!=='function'||typeof options.libraRunCreator?.replaceConfirmedCustomTarget!=='function')
    throw new TypeError('Custom continuation requires exact Owner stores and a read fence.');
  const repository=createRepositoryDefinition({repositoryId:'libra_custom_continuation',owner:'libra',schemaManifest:options.schemaManifest,
    readOnly:true,statements:{run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision',
      'state_digest'],keyColumns:['libra_run_id'],safeIntegers:true}}}),admissions=createRunAdmissionStore(options),now=options.now||Date.now;
  function verifyFence(readFence){
    options.unitOfWork.execute([{participantId:'custom_continuation_fence',owner:'libra',repositories:[repository],execute(){return null;}}],{readFence});
  }
  function current(scope,readFence){
    const intent=options.customTargetStore.current(scope);
    const evidence=intent?options.customTargetStore.intentEvidence(intent.intentId):null;
    verifyFence(readFence);
    if(!intent)return null;
    if(evidence.intent.intentDigest!==intent.intentDigest||intent.subjectId!==scope.subjectId||
        intent.basis.productScopeDigest!==scope.productScopeDigest)throw new Error('Current Custom Target evidence is inconsistent.');
    return evidence;
  }
  function currentBasis(intent,readFence){
    const row=options.unitOfWork.execute([{participantId:'custom_continuation_run',owner:'libra',repositories:[repository],execute(context){
      return context.repository(repository.repositoryId).invoke('run',{libra_run_id:intent.basis.libraRunId});
    }}],{readFence}).custom_continuation_run;
    if(!row||row.subject_id!==intent.subjectId)throw new Error('Confirmed Custom Target lost its exact Run.');
    if(!['active','suspended','frozen'].includes(row.state))return null;
    return Object.freeze({...intent.basis,customTargetRevision:intent.revision,runState:row.state,
      runStateRevision:Number(row.state_revision),runStateDigest:row.state_digest});
  }
  function verifyCurrent(scope,intent,readFence){
    const evidence=current(scope,readFence);
    return evidence&&evidence.intent.intentId===intent.intentId&&evidence.intent.intentDigest===intent.intentDigest;
  }
  return Object.freeze({reconcile(scope){
    if(!scope||typeof scope.subjectId!=='string'||!scope.subjectId||!/^[a-f0-9]{64}$/.test(scope.productScopeDigest||''))
      throw new TypeError('Custom continuation requires an exact Subject and product scope.');
    try{
      let fence=options.unitOfWork.captureReadFence(),evidence=current(scope,fence);
      if(!evidence)return Object.freeze({kind:'no_custom_target'});
      const intent=evidence.intent;
      if(intent.basis.contentProfile!=='movie'||intent.basis.structureKind!=='single')return Object.freeze({kind:'not_applicable'});
      const admitted=admissions.readConfirmedTargetReplacement(evidence);
      verifyFence(fence);
      if(!admitted){
        const basis=currentBasis(intent,fence);
        if(!basis)return pending('original_run_not_eligible');
        const publication=options.customSpecPublicationStore.publish({intentId:intent.intentId,intentDigest:intent.intentDigest,
          currentBasis:basis,readFence:fence,producedAtMs:now()});
        const ref=publication?.receipt?.resultRef,spec=ref&&options.customSpecPublicationStore.read(ref.acceptanceSpecId);
        if(!spec||spec.subjectId!==intent.subjectId||spec.customTargetRef?.intentId!==intent.intentId||
            spec.customTargetRef.intentDigest!==intent.intentDigest||spec.recordDigest!==ref.recordDigest||spec.specDigest!==ref.specDigest)
          throw new Error('Published Custom Spec does not match its exact Intent and receipt.');
      }
      fence=options.unitOfWork.captureReadFence();
      if(!verifyCurrent(scope,intent,fence))return pending('target_not_current');
      const result=options.libraRunCreator.replaceConfirmedCustomTarget(intent,fence);
      if(result.kind==='delivered')return pending('arca_responsibility');
      return result;
    }catch(error){
      if(error?.code==='P3_UOW_READ_FENCE_CHANGED')return pending('owner_view_changed');
      if(error?.code==='LIBRA_CUSTOM_TARGET_BASELINE_UNAVAILABLE')return pending('custom_target_baseline_unavailable');
      if(error?.code==='LIBRA_CUSTOM_TARGET_BASELINE_CHANGED')return pending('custom_target_baseline_changed');
      if(error?.code==='LIBRA_CUSTOM_TARGET_PREVIEW_STALE'||error?.code==='LIBRA_COLLECTION_TARGET_NOT_CURRENT')
        return pending('target_requires_review');
      throw error;
    }
  }});
}

module.exports=Object.freeze({createCustomTargetContinuation});
