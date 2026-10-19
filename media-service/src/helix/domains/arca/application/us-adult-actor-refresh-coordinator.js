'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
function createUsAdultActorRefreshCoordinator(options){
  const query=options.actorPipelineQuery,reader=options.aftercareContextReader,
    admission=createWorkAdmission({...options,limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256},
      eligibilityProvider:{check:request=>({eligible:request.ownerDomain==='arca'&&request.processType==='arca_shelf_entry',
        basisDigest:request.executionBasisDigest,reasonCode:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'})}});
  function pending(snapshot,work,phase){
    const submitted=admission.replay(work)||admission.submit(work);
    if(submitted?.kind==='invalid_contract')throw Object.assign(new Error('Actor Supporting Work violates the Foundation contract.'),{code:submitted.reasonCode});
    const status=options.workResultReader.status(work.workId),failed=['failed','cancelled','timed_out'].includes(status?.state);
    if(failed&&phase==='publish'){
      const failures=options.workResultReader.readFailures(work.workId,{includeEvidence:true});
      if(failures.length===1&&failures[0].evidence?.diagnostics?.schema==='arca.actor-publication-precondition@1'){
        const binding={work,failure:failures[0]},evidenceDigest=canonicalDigest({schema:'arca.actor-prepublication-terminal@1',workId:work.workId,
          aftercareCaseId:snapshot.care.aftercareCaseId,intentDigest:snapshot.intent.intentDigest,failureEvidenceDigest:failures[0].evidenceDigest});
        reader.store.terminateCase(snapshot.care.aftercareCaseId,'unresolved',failures[0].code,evidenceDigest,null,binding);
        return {kind:'actor_refresh_failed',aftercareCaseId:snapshot.care.aftercareCaseId,shelfEntryId:snapshot.intent.shelfEntryId,reasonCode:failures[0].code};
      }
    }
    return Object.freeze({kind:failed?'actor_refresh_attention_required':'actor_refresh_pending',shelfEntryId:snapshot.intent.shelfEntryId,
      aftercareCaseId:snapshot.care.aftercareCaseId,phase,workId:work.workId,
      ...(failed?{reasonCode:status.latestAttempt?.failureCode||status.latestAttempt?.failure_code||'actor_phase_failed'}:{})});
  }
  return Object.freeze({reconcile(context,care){
    if(care.state==='queued'){
      query.base(context.shelfEntryId,care.aftercareCaseId);
      care=reader.store.admitCase(care.aftercareCaseId);
      if(care.state!=='active')return Object.freeze({kind:'actor_refresh_queued',aftercareCaseId:care.aftercareCaseId});
    }
    const snapshot=query.inspect(context.shelfEntryId,care.aftercareCaseId);
    if(!snapshot.source.record)return pending(snapshot,snapshot.source.work,'source');
    const match=snapshot.matching.find(item=>item.status?.state!=='succeeded');
    if(match)return pending(snapshot,match.work,'matching');
    for(const action of ['unchanged','assets','stage','publish','verify','commit','retire','close']){
      const phase=snapshot.stages[action];if(phase&&!phase.record)return pending(snapshot,phase.work,action);
    }
    return Object.freeze({kind:'case_resolved',aftercareCaseId:care.aftercareCaseId,shelfEntryId:context.shelfEntryId});
  }});
}
module.exports=Object.freeze({createUsAdultActorRefreshCoordinator});
