'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const RESOURCE_FAILURE_CLASSES = new Set(['integration','network','resource','storage','io','compute','timeout']);
const PROCESS_FAILURE_CLASSES = new Set([...RESOURCE_FAILURE_CLASSES,'executor','observation']);

function definitions(schemaManifest) {
  return Object.freeze({
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
  return Object.freeze({
    observeTerminalWork,
    prepareExecution(request){const scopes=[{ownerDomain:request.ownerDomain,processType:request.processType,workKind:request.workKind},
      ...request.resourceKeys.map((resourceKey)=>({ownerDomain:request.ownerDomain,processType:request.processType,workKind:request.workKind,resourceKey}))];
      return options.registry.prepareExecution(scopes,request.workId);},
    projectionForWork(request){return Object.freeze(failureRequests(request).map((failure)=>options.registry.read(options.registry.incidentKey(failure))).filter(Boolean));},
  });
}

module.exports=Object.freeze({createExecutorIncidentObserver});
