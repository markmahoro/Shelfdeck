'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

function definition(schemaManifest){return createRepositoryDefinition({repositoryId:'work_result_reader',owner:'execution-foundation',schemaManifest,statements:{
  find_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','state'],keyColumns:['work_id']},
  list_process_works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','state'],keyColumns:['owner_domain','process_type','process_id','work_kind']},
  list_events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','work_id','state'],keyColumns:['work_id']},
  find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest',
    'evidence_schema_ref','evidence_json','evidence_digest'],keyColumns:['event_id']},
}});}

function createWorkResultReader(options){if(!options?.schemaManifest||!options.unitOfWork)throw new TypeError('Work Result Reader requires Foundation persistence.');
  const repository=definition(options.schemaManifest);return Object.freeze({
    status(workId){return options.unitOfWork.execute([{participantId:'work_status_read',owner:'execution-foundation',repositories:[repository],execute(context){
      const row=context.repository(repository.repositoryId).invoke('find_work',{work_id:workId});return row?Object.freeze(row):null;
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
    read(workId){return options.unitOfWork.execute([{participantId:'work_result_read',owner:'execution-foundation',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);return Object.freeze(repo.invoke('list_events',{work_id:workId}).map((event)=>{
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
        return Object.freeze({eventId:event.event_id,state:event.state,resultId:row.result_id,outcomeKind:row.outcome_kind,
          resultSchemaRef:row.result_schema_ref,resultDigest:row.result_digest,result:Object.freeze(result),
          evidenceSchemaRef:row.evidence_schema_ref,evidenceDigest:row.evidence_digest,
          evidence:evidence?Object.freeze(evidence):null});
      }));}}]).work_result_read;
    },
  });}

module.exports=Object.freeze({createWorkResultReader});
