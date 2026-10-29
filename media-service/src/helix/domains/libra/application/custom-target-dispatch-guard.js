'use strict';

const {assertCurrentTargetBaseline}=require('../persistence/custom-target-store');
const pending=reasonCode=>Object.freeze({kind:'pending',reasonCode});

// This composition is deliberately unwired: current production projections
// and all Runtime admission boundaries must be connected and verified before it
// can govern production dispatch.
function createLibraCustomTargetDispatchGuard(options){
  if(typeof options?.targetReader?.read!=='function'||typeof options.replacementReadiness?.check!=='function'||
      typeof options.customTargetStore?.current!=='function'||typeof options.readCurrentCustomTargetBaseline!=='function'||
      typeof options.inputControlReader?.check!=='function')
    throw new TypeError('Custom dispatch requires target, drain, Owner baseline and input Control readers.');
  return Object.freeze({check(scope){
    if(!scope||typeof scope!=='object')throw new TypeError('Exact dispatch scope is required.');
    if(scope.ownerDomain!=='libra'||scope.processType!=='libra_run')return Object.freeze({kind:'not_applicable'});
    if(typeof scope.processId!=='string'||!scope.processId)throw new TypeError('Exact Libra Run is required.');
    try{
      const initial=options.targetReader.read(scope.processId);
      if(initial.kind==='run_not_active')return pending('run_not_active');
      if(initial.kind==='target_not_current')return pending('target_not_current');
      if(initial.kind!=='target_current'||!initial.readFence)throw new Error('Run target projection is invalid.');
      if(scope.executionBasisDigest!==undefined&&scope.executionBasisDigest!==initial.executionBasisDigest)return pending('run_basis_changed');
      if(initial.targetKind==='standard')return Object.freeze({kind:'ready',readFence:initial.readFence});
      if(initial.targetKind!=='user_custom')throw new Error('Run target kind is invalid.');
      const drained=options.replacementReadiness.check(scope.processId);
      if(drained.kind==='pending')return pending(drained.reasonCode);
      if(drained.kind!=='ready'||!drained.readFence)throw new Error('Custom replacement drain proof is invalid.');
      const target=options.targetReader.read(scope.processId,{readFence:drained.readFence});
      if(target.kind!=='target_current'||target.targetKind!=='user_custom')return pending('target_not_current');
      if(target.executionBasisDigest!==initial.executionBasisDigest)return pending('run_basis_changed');
      const intent=options.customTargetStore.current({subjectId:target.subjectId,productScopeDigest:target.productScopeDigest});
      if(!intent||intent.subjectId!==target.subjectId||intent.basis.productScopeDigest!==target.productScopeDigest)
        throw new Error('Current custom target Intent is invalid.');
      const baseline=options.readCurrentCustomTargetBaseline(Object.freeze({subjectId:target.subjectId,
        libraRunId:intent.basis.libraRunId,productScopeDigest:target.productScopeDigest}),{readFence:drained.readFence});
      assertCurrentTargetBaseline(intent,baseline);
      const inputControl=options.inputControlReader.check(Object.freeze({subjectId:target.subjectId,libraRunId:scope.processId}),
        {readFence:drained.readFence});
      if(inputControl.kind==='pending')return pending(inputControl.reasonCode);
      if(inputControl.kind!=='ready'||inputControl.readFence!==drained.readFence)throw new Error('Run input Control projection is invalid.');
      options.targetReader.read(scope.processId,{readFence:drained.readFence});
      return Object.freeze({kind:'ready',readFence:drained.readFence});
    }catch(error){
      if(error?.code==='P3_UOW_READ_FENCE_CHANGED')return pending('owner_view_changed');
      if(error?.code==='LIBRA_COLLECTION_TARGET_NOT_CURRENT')return pending('target_not_current');
      if(error?.code==='LIBRA_CUSTOM_TARGET_BASELINE_UNAVAILABLE')return pending('custom_target_baseline_unavailable');
      if(error?.code==='LIBRA_CUSTOM_TARGET_BASELINE_CHANGED')return pending('custom_target_baseline_changed');
      throw error;
    }
  }});
}
module.exports=Object.freeze({createLibraCustomTargetDispatchGuard});
