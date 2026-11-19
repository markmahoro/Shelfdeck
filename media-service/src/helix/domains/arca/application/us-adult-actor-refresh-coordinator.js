'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const PREP_WORK_KINDS=Object.freeze(['us_adult_actor_source','us_adult_actor_match','us_adult_actor_assets']);
const FORMAL_WORK_KINDS=Object.freeze([
  'us_adult_actor_stage','us_adult_actor_publish','us_adult_actor_verify',
  'us_adult_actor_commit','us_adult_actor_retire','us_adult_actor_close','us_adult_actor_discard',
]);
const OPEN_STATES=new Set(['admitted','ready','running','blocked']);
const DRIFT_CODES=new Set(['ARCA_US_ADULT_REFRESH_EXECUTION_STALE','ARCA_US_ADULT_PHASE_PROOF_INVALID']);
function modificationBlocked(context){
  return context.raw?.shelf?.status!=='active'||(context.raw?.reservations||[]).some(item=>item.state==='active');
}
function createUsAdultActorRefreshCoordinator(options){
  const query=options.actorPipelineQuery,reader=options.aftercareContextReader,
    admission=createWorkAdmission({...options,limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256},
      eligibilityProvider:{check:request=>({eligible:request.ownerDomain==='arca'&&request.processType==='arca_shelf_entry',
        basisDigest:request.executionBasisDigest,reasonCode:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'})}});
  function worksForCase(entryId,caseId,kinds){
    const matched=[];
    for(const workKind of kinds){
      for(const row of options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_shelf_entry',processId:entryId,workKind})){
        const def=options.workResultReader.readDefinition(row.work_id)?.definition;
        if(def?.dependencyRefs?.some(ref=>ref.ownerDomain==='arca'&&ref.objectType==='aftercare_case'&&ref.objectId===caseId))matched.push(row);
      }
    }
    return matched;
  }
  function hasFormalStageOrCommit(entryId,caseId){
    return worksForCase(entryId,caseId,FORMAL_WORK_KINDS).length>0||
      reader.store.history(entryId).commits.some(item=>item.aftercareCaseId===caseId);
  }
  function closeUnresolvedFailure(snapshot,binding,evidenceDigest){
    reader.store.terminateCase(snapshot.care.aftercareCaseId,'unresolved',binding.failure.code,evidenceDigest,null,binding);
    return {kind:'actor_refresh_failed',aftercareCaseId:snapshot.care.aftercareCaseId,
      shelfEntryId:snapshot.intent.shelfEntryId,reasonCode:binding.failure.code};
  }
  function invalidateOrContain(context,care,reasonCode,rawErrorCode){
    if(care.state==='active'&&hasFormalStageOrCommit(context.shelfEntryId,care.aftercareCaseId)){
      return Object.freeze({kind:'actor_refresh_attention_required',shelfEntryId:context.shelfEntryId,
        aftercareCaseId:care.aftercareCaseId,reasonCode:rawErrorCode||reasonCode});
    }
    if(care.state==='active'){
      reader.store.staleSettlementApprovals?.(care.aftercareCaseId);
      const cancellation=typeof options.cancelProcessWorks==='function'?options.cancelProcessWorks({
        ownerDomain:'arca',processType:'arca_shelf_entry',processId:context.shelfEntryId,
        reasonCode:reasonCode==='modification_fenced'?'ARCA_AFTERCARE_MODIFICATION_FENCED':'ARCA_AFTERCARE_CASE_BASIS_STALE',
      }):{drainingWorks:0};
      if(Number(cancellation?.drainingWorks||0)>0||worksForCase(context.shelfEntryId,care.aftercareCaseId,PREP_WORK_KINDS).some(row=>OPEN_STATES.has(row.state))){
        return Object.freeze({kind:'case_fence_draining',shelfEntryId:context.shelfEntryId,
          aftercareCaseId:care.aftercareCaseId,reasonCode});
      }
    }
    const evidenceDigest=canonicalDigest({schema:'arca.actor-case-invalidated@1',aftercareCaseId:care.aftercareCaseId,
      reasonCode,careBasisDigest:care.careBasisDigest,currentBasisDigest:context.basis?.digest||null});
    reader.store.terminateCase(care.aftercareCaseId,'invalidated',reasonCode,evidenceDigest);
    return Object.freeze({kind:'case_invalidated',shelfEntryId:context.shelfEntryId,aftercareCaseId:care.aftercareCaseId,reasonCode});
  }
  function pending(snapshot,work,phase){
    const submitted=admission.replay(work)||admission.submit(work);
    if(submitted?.kind==='invalid_contract')throw Object.assign(new Error('Actor Supporting Work violates the Foundation contract.'),{code:submitted.reasonCode});
    const status=options.workResultReader.status(work.workId),failed=['failed','cancelled','timed_out'].includes(status?.state);
    if(failed&&phase==='stage'&&snapshot.stageFailure){
      const evidenceDigest=canonicalDigest({schema:'arca.actor-prestage-terminal@1',workId:work.workId,
        aftercareCaseId:snapshot.care.aftercareCaseId,intentDigest:snapshot.intent.intentDigest,
        failureEvidenceDigest:snapshot.stageFailure.failure.evidenceDigest});
      return closeUnresolvedFailure(snapshot,snapshot.stageFailure,evidenceDigest);
    }
    if(failed&&phase==='publish'&&snapshot.publicationFailure){
      const discard=snapshot.stages.discard;
      if(!discard?.record)return pending(snapshot,discard.work,'discard');
      const binding={...snapshot.publicationFailure,discardWork:discard.work,discardRecord:discard.record},
        evidenceDigest=canonicalDigest({schema:'arca.actor-prepublication-terminal@1',workId:work.workId,
          aftercareCaseId:snapshot.care.aftercareCaseId,intentDigest:snapshot.intent.intentDigest,
          failureEvidenceDigest:binding.failure.evidenceDigest,discardResultDigest:discard.record.resultDigest});
      return closeUnresolvedFailure(snapshot,binding,evidenceDigest);
    }
    return Object.freeze({kind:failed?'actor_refresh_attention_required':'actor_refresh_pending',shelfEntryId:snapshot.intent.shelfEntryId,
      aftercareCaseId:snapshot.care.aftercareCaseId,phase,workId:work.workId,
      ...(failed?{reasonCode:status.latestAttempt?.failureCode||status.latestAttempt?.failure_code||'actor_phase_failed'}:{})});
  }
  return Object.freeze({reconcile(context,care){
    if(modificationBlocked(context))return invalidateOrContain(context,care,'modification_fenced','ARCA_AFTERCARE_MODIFICATION_FENCED');
    let snapshot;
    try{
      if(care.state==='queued'){
        query.base(context.shelfEntryId,care.aftercareCaseId);
        care=reader.store.admitCase(care.aftercareCaseId);
        if(care.state!=='active')return Object.freeze({kind:'actor_refresh_queued',aftercareCaseId:care.aftercareCaseId});
      }
      snapshot=query.inspect(context.shelfEntryId,care.aftercareCaseId);
    }catch(error){
      if(DRIFT_CODES.has(error?.code))return invalidateOrContain(context,care,'care_basis_changed',error.code);
      throw error;
    }
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
