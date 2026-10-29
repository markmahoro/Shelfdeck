'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const RESOURCE_FAILURE_CLASSES = new Set(['integration','network','resource','storage','io','compute','timeout']);
const PROCESS_FAILURE_CLASSES = new Set([...RESOURCE_FAILURE_CLASSES,'executor','observation']);

function definitions(schemaManifest) {
  return Object.freeze({
    works:createRepositoryDefinition({repositoryId:'incident_observer_works',owner:'execution-foundation',schemaManifest,statements:{
      page:{kind:'select-page-after',tableId:'fx_supporting_works',columns:['work_id','state'],
        fixedKeyColumns:['owner_domain','process_type','work_kind'],keyColumn:'work_id',maxItems:500},
      process_page:{kind:'select-page-after',tableId:'fx_supporting_works',columns:['work_id','state'],
        fixedKeyColumns:['owner_domain','process_type','work_kind','process_id'],keyColumn:'work_id',maxItems:500},
    }}),
    workAttempts:createRepositoryDefinition({repositoryId:'incident_observer_work_attempts',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_work_attempts',columns:['attempt_id','state'],keyColumns:['work_id']},
    }}),
    effects:createRepositoryDefinition({repositoryId:'incident_observer_effects',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_effect_journal',columns:['state'],keyColumns:['event_attempt_id']},
    }}),
    defers:createRepositoryDefinition({repositoryId:'incident_observer_defers',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_resource_defer',columns:['state'],keyColumns:['event_id','state']},
    }}),
    events:createRepositoryDefinition({repositoryId:'incident_observer_events',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','work_id','attempt_id','capability_ref','state'],keyColumns:['work_id']},
    }}),
    attempts:createRepositoryDefinition({repositoryId:'incident_observer_attempts',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','ordinal','state','outcome_kind','failure_class','failure_code','evidence_digest'],keyColumns:['event_id'],safeIntegers:true},
    }}),
    timings:createRepositoryDefinition({repositoryId:'incident_observer_timings',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_event_resource_timings',columns:['event_attempt_id','resource_key','outcome'],keyColumns:['event_attempt_id']},
    }}),
  });
}

function createExecutorIncidentObserver(options) {
  if(!options?.schemaManifest||!options.unitOfWork||!options.registry)throw new TypeError('Executor Incident Observer requires Foundation persistence and Registry.');
  const repositories=definitions(options.schemaManifest);
  function snapshot(workId,workAttemptId){return options.unitOfWork.execute([{participantId:'executor_incident_observation',owner:'execution-foundation',repositories:Object.values(repositories),execute(context){
    const events=context.repository(repositories.events.repositoryId).invoke('list',{work_id:workId}).filter((event)=>event.attempt_id===workAttemptId),rows=[];
    for(const event of events){const attempt=context.repository(repositories.attempts.repositoryId).invoke('list',{event_id:event.event_id})
      .filter((item)=>item.state==='completed').sort((a,b)=>Number(b.ordinal)-Number(a.ordinal))[0];
      if(attempt)rows.push(Object.freeze({event:Object.freeze(event),attempt:Object.freeze(attempt),resources:Object.freeze(context.repository(repositories.timings.repositoryId)
        .invoke('list',{event_attempt_id:attempt.event_attempt_id}).map((item)=>item.resource_key).filter(Boolean).sort())}));}
    return Object.freeze(rows);
  }}]).executor_incident_observation;}
  function exactResource(row){const keys=[...new Set(row.resources)],failureClass=String(row.attempt.failure_class||'');if(!RESOURCE_FAILURE_CLASSES.has(failureClass))return null;
    if(failureClass==='integration'){const integrations=keys.filter((key)=>key.startsWith('integration:'));return integrations.length===1?integrations[0]:null;}
    return keys.length===1?keys[0]:null;}
  function failureRequests(request){const rows=snapshot(request.workId,request.workAttemptId).filter((row)=>row.event.state==='failed'&&row.attempt.outcome_kind==='failed'),values=[];
    for(const row of rows){const failureClass=String(row.attempt.failure_class||'');if(!PROCESS_FAILURE_CLASSES.has(failureClass))continue;const errorCode=String(row.attempt.failure_code||request.workAttemptFailureCode||'EXECUTOR_ERROR');
      values.push(Object.freeze({ownerDomain:request.ownerDomain,processType:request.processType,workKind:request.workKind,errorCode,
        resourceKey:exactResource(row),occurrenceId:request.workId+':'+request.workAttemptId}));}
    if(rows.length===0&&request.workAttemptFailureCode)values.push(Object.freeze({ownerDomain:request.ownerDomain,
      processType:request.processType,workKind:request.workKind,errorCode:String(request.workAttemptFailureCode),
      resourceKey:null,occurrenceId:request.workId+':'+request.workAttemptId}));
    const unique=new Map(values.map((value)=>[options.registry.incidentKey(value),value]));
    return Object.freeze([...unique.values()]);
  }
  function successfulScopes(request){const rows=snapshot(request.workId,request.workAttemptId).filter((row)=>row.event.state==='succeeded'&&row.attempt.outcome_kind==='succeeded'),resources=[...new Set(rows.flatMap((row)=>row.resources))].sort(),base={ownerDomain:request.ownerDomain,processType:request.processType,workKind:request.workKind};
    return Object.freeze([Object.freeze(base),...resources.map((resourceKey)=>Object.freeze({...base,resourceKey}))]);}
  function observeTerminalWork(request){if(!request||!['succeeded','failed','cancelled'].includes(request.workState))return Object.freeze({incidentRefs:Object.freeze([]),resolvedScopes:0});
    if(request.workState!=='succeeded'){
      options.registry.abandonExecution(request.workId);
      if(request.workState==='cancelled')return Object.freeze({incidentRefs:Object.freeze([]),resolvedScopes:0});
      const incidentRefs=failureRequests(request).map((failure)=>options.registry.recordFailure(failure));return Object.freeze({incidentRefs:Object.freeze(incidentRefs),resolvedScopes:0});}
    const evidenceDigest=canonicalDigest({schema:'foundation.executor-incident-success@1',workId:request.workId,workAttemptId:request.workAttemptId});let resolvedScopes=0;
    for(const scope of successfulScopes(request))resolvedScopes+=options.registry.resolveScope(scope,evidenceDigest).length;
    return Object.freeze({incidentRefs:Object.freeze([]),resolvedScopes});
  }
  function findReservationOwner(reservation, scope) {
    let cursor = null;
    while (true) {
      const page = options.unitOfWork.execute([{participantId:'incident_reservation_owner',owner:'execution-foundation',
        repositories:[repositories.works],execute(context){
          return context.repository(repositories.works.repositoryId).invoke(scope?.processId ? 'process_page' : 'page', {
            owner_domain:reservation.ownerDomain,process_type:reservation.processType,work_kind:reservation.workKind,
            ...(scope?.processId ? {process_id:scope.processId} : {}),cursor,limit:500,
          });
        }}]).incident_reservation_owner;
      for (const work of page) if (canonicalDigest({schema:'foundation.executor-incident-recovery-work@1',
        circuitKey:reservation.circuitKey,workId:work.work_id}) === reservation.evidenceDigest) return work;
      if (page.length < 500) return null;
      cursor = page.at(-1).work_id;
    }
  }
  function isExecutionClosed(work) {
    if (!work || !['succeeded','failed','cancelled'].includes(work.state)) return false;
    return options.unitOfWork.execute([{participantId:'incident_reservation_closure',owner:'execution-foundation',
      repositories:Object.values(repositories),execute(context){
        const list=(name,parameters)=>context.repository(repositories[name].repositoryId).invoke('list',parameters);
        if (list('workAttempts',{work_id:work.work_id}).some(row=>!['succeeded','failed','cancelled'].includes(row.state))) return false;
        for (const event of list('events',{work_id:work.work_id})) {
          if (!['succeeded','failed','cancelled','skipped'].includes(event.state)) return false;
          if (list('defers',{event_id:event.event_id,state:'waiting'}).length) return false;
          for (const attempt of list('attempts',{event_id:event.event_id})) {
            if (attempt.state !== 'completed') return false;
            if (list('effects',{event_attempt_id:attempt.event_attempt_id}).some(row=>!['committed','failed'].includes(row.state))) return false;
          }
        }
        return true;
      }}]).incident_reservation_closure;
  }
  function reconcileRecoveryReservations(scope) {
    const reservations=options.registry.recoveryReservations().filter(row=>!scope ||
      (row.ownerDomain===scope.ownerDomain && row.processType===scope.processType));
    let reopened=0;
    for (const reservation of reservations) {
      const work=findReservationOwner(reservation,scope);
      // Terminal Work alone is insufficient: unclosed Effects still hold responsibility.
      // Reopen the Circuit, never assert success or erase its failure evidence here.
      if (isExecutionClosed(work)) reopened+=options.registry.abandonExecution(work.work_id);
    }
    return Object.freeze({examined:reservations.length,reopened});
  }
  return Object.freeze({
    reconcileRecoveryReservations,
    observeTerminalWork,
    prepareExecution(request){const scopes=[{ownerDomain:request.ownerDomain,processType:request.processType,workKind:request.workKind},
      ...request.resourceKeys.map((resourceKey)=>({ownerDomain:request.ownerDomain,processType:request.processType,workKind:request.workKind,resourceKey}))];
      return options.registry.prepareExecution(scopes,request.workId);},
    projectionForWork(request){return Object.freeze(failureRequests(request).map((failure)=>options.registry.read(options.registry.incidentKey(failure))).filter(Boolean));},
  });
}

module.exports=Object.freeze({createExecutorIncidentObserver});
