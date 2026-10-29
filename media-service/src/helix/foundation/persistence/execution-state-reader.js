'use strict';
const {createRepositoryDefinition}=require('./owner-repository');

function createExecutionStateReader(options){
  const repository=createRepositoryDefinition({repositoryId:'execution_state_reader',owner:'execution-foundation',schemaManifest:options.schemaManifest,readOnly:true,statements:{
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
  }});
  return Object.freeze({
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
module.exports=Object.freeze({createExecutionStateReader});
