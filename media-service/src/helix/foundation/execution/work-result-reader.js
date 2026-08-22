'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

function definition(schemaManifest){return createRepositoryDefinition({repositoryId:'work_result_reader',owner:'execution-foundation',schemaManifest,statements:{
  find_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','basis_digest','state'],keyColumns:['work_id']},
  find_definition:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','definition_json','definition_digest'],keyColumns:['work_id']},
  list_process_works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','state','created_at_ms','updated_at_ms'],keyColumns:['owner_domain','process_type','process_id','work_kind'],safeIntegers:true},
  list_owner_works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','state'],keyColumns:['owner_domain','work_kind']},
  list_attempts:{kind:'select-all',tableId:'fx_work_attempts',columns:['attempt_id','work_id','ordinal','state','failure_code'],keyColumns:['work_id'],safeIntegers:true},
  list_events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','plan_id','node_id','work_id','attempt_id','owner_domain',
    'capability_ref','state','result_id'],keyColumns:['work_id']},
  find_plan:{kind:'select-one',tableId:'fx_workflow_plans',columns:['plan_id','planner_version','graph_digest','state'],keyColumns:['plan_id'],safeIntegers:true},
  list_event_attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','ordinal',
    'input_snapshot_digest','state','outcome_kind'],keyColumns:['event_id'],safeIntegers:true},
  find_node:{kind:'select-one',tableId:'fx_plan_nodes',columns:['plan_id','node_id','capability_ref','input_bindings_json'],
    keyColumns:['plan_id','node_id']},
  find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest',
    'evidence_schema_ref','evidence_json','evidence_digest'],keyColumns:['event_id']},
}});}

function createWorkResultReader(options){if(!options?.schemaManifest||!options.unitOfWork)throw new TypeError('Work Result Reader requires Foundation persistence.');
  const repository=definition(options.schemaManifest);return Object.freeze({
    readDefinition(workId){return options.unitOfWork.execute([{participantId:'work_definition_read',owner:'execution-foundation',repositories:[repository],execute(context){
      const row=context.repository(repository.repositoryId).invoke('find_definition',{work_id:workId});
      if(!row)return null;
      let value;try{value=JSON.parse(row.definition_json);}catch{throw new Error('Persisted Work Definition JSON is corrupt.');}
      if(canonicalDigest(value)!==row.definition_digest)throw new Error('Persisted Work Definition digest is corrupt.');
      return Object.freeze({workId:row.work_id,definition:Object.freeze(value),definitionDigest:row.definition_digest});
    }}]).work_definition_read;},
    status(workId){return options.unitOfWork.execute([{participantId:'work_status_read',owner:'execution-foundation',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);const row=repo.invoke('find_work',{work_id:workId});
      if(!row)return null;
      const latest=repo.invoke('list_attempts',{work_id:workId}).sort((left,right)=>Number(right.ordinal)-Number(left.ordinal))[0]||null;
      return Object.freeze({...row,latestAttempt:latest?Object.freeze(latest):null});
    }}]).work_status_read;},
    listWorks(scope){
      if(!scope||typeof scope.ownerDomain!=='string'||typeof scope.processType!=='string'||typeof scope.processId!=='string'||typeof scope.workKind!=='string'){
        throw new TypeError('Work Result Reader listWorks requires an exact owner/process/work scope.');
      }
      return options.unitOfWork.execute([{participantId:'work_scope_read',owner:'execution-foundation',repositories:[repository],execute(context){
        return Object.freeze(context.repository(repository.repositoryId).invoke('list_process_works',{owner_domain:scope.ownerDomain,
          process_type:scope.processType,process_id:scope.processId,work_kind:scope.workKind}).map((row)=>Object.freeze(row)));
      }}]).work_scope_read;
    },
    listOwnerWorks(scope){
      if(!scope||typeof scope.ownerDomain!=='string'||typeof scope.workKind!=='string'){
        throw new TypeError('Work Result Reader listOwnerWorks requires an exact Owner and Work kind.');
      }
      return options.unitOfWork.execute([{participantId:'work_owner_scope_read',owner:'execution-foundation',repositories:[repository],execute(context){
        return Object.freeze(context.repository(repository.repositoryId).invoke('list_owner_works',{
          owner_domain:scope.ownerDomain,work_kind:scope.workKind}).map((row)=>Object.freeze(row)));
      }}]).work_owner_scope_read;
    },
    readBindings(workId){return options.unitOfWork.execute([{participantId:'work_bindings_read',owner:'execution-foundation',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),events=repo.invoke('list_events',{work_id:workId});
      return Object.freeze(events.map((event)=>{const node=repo.invoke('find_node',{plan_id:event.plan_id,node_id:event.node_id});
        if(!node||node.capability_ref!==event.capability_ref)throw new Error('Persisted Event Plan node is absent or corrupt.');
        let inputBindings;try{inputBindings=JSON.parse(node.input_bindings_json);}catch{throw new Error('Persisted Event input bindings JSON is corrupt.');}
        return Object.freeze({eventId:event.event_id,capabilityRef:event.capability_ref,inputBindings:Object.freeze(inputBindings)});
      }));
    }}]).work_bindings_read;},
    read(workId){return options.unitOfWork.execute([{participantId:'work_result_read',owner:'execution-foundation',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);return Object.freeze(repo.invoke('list_events',{work_id:workId}).map((event)=>{
        const node=repo.invoke('find_node',{plan_id:event.plan_id,node_id:event.node_id});
        if(!node||node.capability_ref!==event.capability_ref)throw new Error('Persisted Event Plan node is absent or corrupt.');
        const plan=repo.invoke('find_plan',{plan_id:event.plan_id});
        if(!plan||plan.state!=='planned')throw new Error('Persisted Event Plan envelope is absent or not executable.');
        let inputBindings;try{inputBindings=JSON.parse(node.input_bindings_json);}catch{throw new Error('Persisted Event input bindings JSON is corrupt.');}
        const inputBindingDigest=canonicalDigest(inputBindings);
        const executionAttempt=repo.invoke('list_event_attempts',{event_id:event.event_id})
          .filter((item)=>item.state==='completed'&&item.outcome_kind==='succeeded')
          .sort((left,right)=>Number(right.ordinal)-Number(left.ordinal))[0]||null;
        const row=repo.invoke('find_result',{event_id:event.event_id});if(!row)return Object.freeze({eventId:event.event_id,state:event.state,result:null});
        let result;try{result=JSON.parse(row.result_json);}catch{throw new Error('Persisted Event Result JSON is corrupt.');}
        if(canonicalDigest(result)!==row.result_digest)throw new Error('Persisted Event Result digest is corrupt.');
        let evidence=null;
        if(row.evidence_json!==null&&row.evidence_json!==undefined){
          try{evidence=JSON.parse(row.evidence_json);}catch{throw new Error('Persisted Event Evidence JSON is corrupt.');}
          // The schema reference is a separate binding column; the typed payload
          // is not required to repeat it as a schemaRef member.
          if(canonicalDigest(evidence)!==row.evidence_digest){
            throw new Error('Persisted Event Evidence digest is corrupt.');
          }
        }
        return Object.freeze({workId:event.work_id,eventId:event.event_id,attemptId:event.attempt_id,planId:event.plan_id,nodeId:event.node_id,
          capabilityRef:event.capability_ref,state:event.state,resultId:row.result_id,outcomeKind:row.outcome_kind,
          planRevision:Number(plan.planner_version),planDigest:plan.graph_digest,
          resultSchemaRef:row.result_schema_ref,resultDigest:row.result_digest,result:Object.freeze(result),
          evidenceSchemaRef:row.evidence_schema_ref,evidenceDigest:row.evidence_digest,
          evidence:evidence?Object.freeze(evidence):null,inputBindings:Object.freeze(inputBindings),inputBindingDigest,
          eventAttemptId:executionAttempt?.event_attempt_id||null,inputSnapshotDigest:executionAttempt?.input_snapshot_digest||null});
      }));}}]).work_result_read;
    },
  });}

module.exports=Object.freeze({createWorkResultReader});
