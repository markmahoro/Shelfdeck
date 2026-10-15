'use strict';
const {createRepositoryDefinition}=require('../persistence/owner-repository');

function summaryInteger(value) {
  if(value===null)return null;
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<0)throw new Error('Execution summary integer is outside its safe range.');
  return number;
}

function definition(schemaManifest){return createRepositoryDefinition({repositoryId:'execution_summary_reader',owner:'execution-foundation',schemaManifest,statements:{
  execution_summary_page:{kind:'select-joined-page',tableId:'fx_workflow_events',
    columns:['event_id','work_id','capability_ref','state','ready_at_ms','retry_at_ms'],
    joins:[{tableId:'fx_supporting_works',alias:'work',on:[{column:'work_id',otherAlias:'base',otherColumn:'work_id'}]}],
    filters:[...['owner_domain','process_type','process_id'].map(column=>({alias:'work',column,kind:'equals',parameter:column})),
      {column:'event_id',kind:'greater_than',parameter:'after_event_id'}],
    orderBy:[{column:'event_id',direction:'asc'}],maxItems:100,safeIntegers:true},
  execution_summary_exact:{kind:'select-joined-page',tableId:'fx_workflow_events',
    columns:['event_id','work_id','capability_ref','state','ready_at_ms','retry_at_ms'],
    joins:[{tableId:'fx_supporting_works',alias:'work',on:[{column:'work_id',otherAlias:'base',otherColumn:'work_id'}]}],
    filters:[...['owner_domain','process_type','process_id'].map(column=>({alias:'work',column,kind:'equals',parameter:column})),
      {column:'event_id',kind:'equals',parameter:'event_id'}],
    orderBy:[{column:'event_id',direction:'asc'}],maxItems:1,safeIntegers:true},
  execution_summary_attempt:{kind:'select-filtered-page',tableId:'fx_event_attempts',
    columns:['event_attempt_id','ordinal','state','outcome_kind','failure_class','failure_code','started_at_ms','finished_at_ms'],
    fixedKeyColumns:['event_id'],orderBy:[{column:'ordinal',direction:'desc'}],maxItems:1,safeIntegers:true},
  execution_summary_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_kind'],keyColumns:['work_id']},
  execution_summary_resource_wait:{kind:'select-filtered-page',tableId:'fx_resource_defer',columns:['priority_revision'],
    fixedKeyColumns:['event_id','state'],orderBy:[{column:'resource_key',direction:'asc'}],maxItems:1,safeIntegers:true},
  execution_open_work:{kind:'select-joined-page',tableId:'fx_supporting_works',columns:['work_id'],joins:[],
    filters:['owner_domain','process_type','process_id','state'].map(column=>({column,kind:'equals',parameter:column})),
    orderBy:[{column:'work_id',direction:'asc'}],maxItems:1},
  execution_open_event:{kind:'select-joined-page',tableId:'fx_workflow_events',columns:['event_id'],
    joins:[{tableId:'fx_supporting_works',alias:'work',on:[{column:'work_id',otherAlias:'base',otherColumn:'work_id'}]}],
    filters:[...['owner_domain','process_type','process_id'].map(column=>({alias:'work',column,kind:'equals',parameter:column})),
      {column:'state',kind:'equals',parameter:'state'}],orderBy:[{column:'event_id',direction:'asc'}],maxItems:1},
  execution_unsettled_effect:{kind:'select-joined-page',tableId:'fx_effect_journal',columns:['effect_id'],
    joins:[{tableId:'fx_event_attempts',alias:'attempt',on:[{column:'event_attempt_id',otherAlias:'base',otherColumn:'event_attempt_id'}]},
      {tableId:'fx_workflow_events',alias:'event',on:[{column:'event_id',otherAlias:'attempt',otherColumn:'event_id'}]},
      {tableId:'fx_supporting_works',alias:'work',on:[{column:'work_id',otherAlias:'event',otherColumn:'work_id'}]}],
    filters:[...['owner_domain','process_type','process_id'].map(column=>({alias:'work',column,kind:'equals',parameter:column})),
      {column:'state',kind:'equals',parameter:'state'}],
    orderBy:[{column:'effect_id',direction:'asc'}],maxItems:1},
}});}
function createExecutionSummaryReader(options){
 const repository=definition(options.schemaManifest);return Object.freeze({
    // A bounded read model, not an execution notification or a progress verdict.
    // Consumers must sweep again from null to discover newly inserted lower IDs.
    readExecutionSummaryPage(scope,afterEventId=null,limit=100,eventId=null){
      if(!scope||Object.keys(scope).length!==3||['ownerDomain','processType','processId'].some(key=>
        typeof scope[key]!=='string'||!scope[key]||scope[key].length>256)||
        (afterEventId!==null&&(typeof afterEventId!=='string'||!afterEventId||afterEventId.length>256))||
        (eventId!==null&&(typeof eventId!=='string'||!eventId||eventId.length>256||afterEventId!==null||limit!==1))||
        !Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('Execution summary requires an exact bounded process scope and cursor.');
      return options.unitOfWork.execute([{participantId:'execution_summary_read',owner:'execution-foundation',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId);
        const rows=repo.invoke(eventId===null?'execution_summary_page':'execution_summary_exact',{owner_domain:scope.ownerDomain,process_type:scope.processType,
          process_id:scope.processId,...(eventId===null?{after_event_id:afterEventId||''}:{event_id:eventId}),offset:0,limit});
        const workKinds=new Map();
        const items=rows.map(row=>{
          if(!workKinds.has(row.work_id))workKinds.set(row.work_id,repo.invoke('execution_summary_work',{work_id:row.work_id})?.work_kind||null);
          const resourceWait=row.state==='waiting_for_resource'?repo.invoke('execution_summary_resource_wait',{event_id:row.event_id,state:'waiting',offset:0,limit:1})[0]:null;
          const attempt=repo.invoke('execution_summary_attempt',{event_id:row.event_id,offset:0,limit:1})[0]||null;
          return Object.freeze({eventId:row.event_id,workId:row.work_id,workKind:workKinds.get(row.work_id),capabilityRef:row.capability_ref,
            resourcePriorityRevision:resourceWait?summaryInteger(resourceWait.priority_revision):null,
            state:row.state,readyAtMs:summaryInteger(row.ready_at_ms),retryAtMs:summaryInteger(row.retry_at_ms),
            latestAttempt:attempt?Object.freeze({eventAttemptId:attempt.event_attempt_id,ordinal:summaryInteger(attempt.ordinal),
              state:attempt.state,outcomeKind:attempt.outcome_kind,failureClass:attempt.failure_class,
              failureCode:attempt.failure_code,startedAtMs:summaryInteger(attempt.started_at_ms),finishedAtMs:summaryInteger(attempt.finished_at_ms)}):null});
        });
        return Object.freeze({items:Object.freeze(items),nextCursor:eventId===null&&rows.length===limit?rows.at(-1).event_id:null});
      }}]).execution_summary_read;
    },
    createExecutionStateReadParticipant(scopes,onRead){
      if(!Array.isArray(scopes)||scopes.length>1000||typeof onRead!=='function'||scopes.some(scope=>
        !scope||Object.keys(scope).length!==3||['ownerDomain','processType','processId'].some(key=>typeof scope[key]!=='string'||!scope[key])))
        throw new TypeError('Execution state read requires bounded exact process scopes.');
      return Object.freeze({participantId:'execution_state_summary_read',owner:'execution-foundation',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId);
        const summaries=scopes.map(scope=>{
          const parameters={owner_domain:scope.ownerDomain,process_type:scope.processType,process_id:scope.processId,offset:0,limit:1};
          const hasOpenWork=['admitted','ready','running','blocked'].some(state=>repo.invoke('execution_open_work',{...parameters,state}).length>0);
          const hasOpenEvent=['pending','ready','executing','waiting_for_resource','waiting_for_external','waiting_for_approval'].some(state=>repo.invoke('execution_open_event',{...parameters,state}).length>0);
          const hasUnsettledEffect=['intended','effect_observed','reconcile_required'].some(state=>repo.invoke('execution_unsettled_effect',{...parameters,state}).length>0);
          return Object.freeze({...scope,hasOpenWork,hasOpenEvent,hasUnsettledEffect});
        });
        const result=Object.freeze(summaries);onRead(result);return result;
      }});
    },
 });
}
module.exports=Object.freeze({createExecutionSummaryReader});
