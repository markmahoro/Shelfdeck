'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const KINDS=Object.freeze({libra_intake:['evidence','acceptance','rejection'],
  libra_routing:['routing_nfo_facts','routing_provider_facts','routing_basis'],libra_acceptance_spec:['acceptance_spec_basis']});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const successorId=workId=>'libra-preparation-recovery-'+canonicalDigest({schema:'libra.preparation-recovery@1',failedWorkId:workId}).slice(0,40);

function createPreparationWorkRecovery(options){
  const reader=options.workResultReader;
  const repository=createRepositoryDefinition({repositoryId:'libra_preparation_recovery_execution',owner:'execution-foundation',readOnly:true,
    schemaManifest:options.schemaManifest,statements:{
      events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id'],keyColumns:['work_id']},
      attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id'],keyColumns:['event_id']},
      effects:{kind:'select-all',tableId:'fx_effect_journal',columns:['state'],keyColumns:['event_attempt_id']},
    }});
  const admission=createWorkAdmission({...options,limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256,reservedOpenWorks:16},
    eligibilityProvider:{check:request=>({eligible:request.ownerDomain==='libra'&&Object.hasOwn(KINDS,request.processType),basisDigest:request.executionBasisDigest})}});
  function current(base){
    if(!base)return null;
    let work=base;
    for(;;){const next=reader.readDefinition?.(successorId(work.workId));if(!next)return work;
      if(next.definition.executionBasisDigest!==base.executionBasisDigest || next.definition.processId!==base.processId ||
          next.definition.processType!==base.processType || next.definition.workKind!==base.workKind)
        fail('LIBRA_PREPARATION_RECOVERY_CORRUPT','Preparation recovery changed its frozen basis or scope.');
      work=next.definition;
    }
  }
  function retry(workId){
    const original=reader.readDefinition(workId)?.definition;
    if(original?.ownerDomain!=='libra'||!KINDS[original.processType]?.includes(original.workKind))
      fail('LIBRA_PREPARATION_RETRY_SCOPE','Work is outside Libra preparation recovery.');
    const work={...original,workId:successorId(workId),idempotencyKey:successorId(workId)};
    const replay=admission.replay(work);if(replay)return {...replay,workId:work.workId};
    if(reader.status(workId)?.state!=='failed')fail('LIBRA_PREPARATION_RETRY_STATE','Only a failed preparation can be retried.');
    options.unitOfWork.execute([{participantId:'libra_preparation_recovery_guard',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[repository],
      execute(context){const repo=context.repository(repository.repositoryId);
        for(const event of repo.invoke('events',{work_id:workId}))for(const attempt of repo.invoke('attempts',{event_id:event.event_id}))
          if(repo.invoke('effects',{event_attempt_id:attempt.event_attempt_id}).some(effect=>!['committed','failed'].includes(effect.state)))
            fail('LIBRA_PREPARATION_EFFECT_PENDING','Preparation has an unresolved Effect.');
      }}]);
    const result=admission.submit(work);
    if(result.kind==='invalid_contract')fail(result.reasonCode||'LIBRA_PREPARATION_RETRY_INVALID','Preparation recovery failed admission.');
    return {...result,workId:work.workId};
  }
  function failure(work,status){
    return status?.state==='failed'?Object.freeze({kind:'preparation_failed',processId:work.processId,
      subjectId:work.processType==='libra_intake'?null:work.processId,workId:work.workId,
      failureCode:status.latestAttempt?.failure_code||'PREPARATION_FAILED'}):null;
  }
  return Object.freeze({current,retry,failure});
}
module.exports=Object.freeze({createPreparationWorkRecovery,KINDS});
