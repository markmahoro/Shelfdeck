'use strict';

// The existing ready-Subject reconciler resumes a persisted target first.
// A pending confirmed decision cannot fall through into a standard Run.
function reconcileReadyLibraSubject({subjectId,contextReader,customTargetStore,continuation,libraRunCreator,reconcileRun}){
  const context=contextReader.read(subjectId);
  if(context.kind==='ready'&&context.spec?.productScopeDigest){
    const scope={subjectId,productScopeDigest:context.spec.productScopeDigest},target=customTargetStore.current(scope);
    if(target){const result=continuation.reconcile(scope);
      if(!['no_custom_target','not_applicable'].includes(result.kind))
        return result.kind==='admitted'&&result.libraRunId?reconcileRun(result.libraRunId):result;}
  }
  const run=libraRunCreator.reconcile(subjectId);
  return run.libraRunId?reconcileRun(run.libraRunId):run;
}

// Frozen and suspended Runs may no longer occupy a pipeline token. Reuse the
// existing Run reconciliation paths to resume their already-confirmed intent.
function reconcileConfirmedTargetForRun({libraRunId,targetReader,customTargetStore,continuation}){
  try{
    const target=targetReader.read(libraRunId,{allowSuspended:true,allowFrozen:true});
    if(target.kind!=='target_not_current')return null;
    const scope={subjectId:target.subjectId,productScopeDigest:target.productScopeDigest},intent=customTargetStore.current(scope);
    if(!intent||intent.basis.libraRunId!==libraRunId)return {kind:'pending',reasonCode:'target_not_current'};
    const result=continuation.reconcile(scope);
    return ['no_custom_target','not_applicable'].includes(result.kind)?{kind:'pending',reasonCode:'target_not_current'}:result;
  }catch(error){
    if(error?.code==='P3_UOW_READ_FENCE_CHANGED')return {kind:'pending',reasonCode:'owner_view_changed'};
    throw error;
  }
}

function runnableLibraRunPage(contextReader,cursor,limit){
  const active=contextReader.listActiveRunPage(cursor,limit,'active').items,
    suspended=contextReader.listActiveRunPage(cursor,limit,'suspended').items;
  return [...active,...suspended].sort((left,right)=>Buffer.compare(Buffer.from(left.libraRunId),Buffer.from(right.libraRunId)))
    .slice(0,limit).map(item=>Object.freeze({cursor:item.libraRunId,scope:item}));
}
module.exports=Object.freeze({reconcileReadyLibraSubject,reconcileConfirmedTargetForRun,runnableLibraRunPage});
