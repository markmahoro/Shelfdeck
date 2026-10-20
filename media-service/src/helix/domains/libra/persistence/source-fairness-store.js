'use strict';

const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');

function createSourceFairnessStore(options) {
  const columns={
    clock:['clock_id','turn_sequence','priority_revision'],
    source:['source_field_id','last_turn_sequence','updated_at_ms'],
    run:['libra_run_id','source_field_id','last_turn_sequence','scan_cursor','updated_at_ms'],
    event:['foundation_event_id','libra_run_id','last_attempt_ordinal','last_event_attempt_id','updated_at_ms'],
  };
  const tables={clock:'libra_fairness_clocks',source:'libra_fairness_sources',run:'libra_fairness_runs',event:'libra_fairness_events'};
  const statements={};
  for(const [name,fields] of Object.entries(columns)) {
    statements['get_'+name]={kind:'select-one',tableId:tables[name],columns:fields,keyColumns:[fields[0]]};
    statements['insert_'+name]={kind:'insert',tableId:tables[name],columns:fields};
    statements['update_'+name]={kind:'update',tableId:tables[name],setColumns:fields.slice(1),keyColumns:[fields[0]]};
  }
  statements.runs={kind:'select-all',tableId:tables.run,columns:columns.run,keyColumns:[]};
  statements.runs_by_id={kind:'select-in',tableId:tables.run,columns:columns.run,keyColumn:'libra_run_id',maxItems:500};
  statements.sources_by_id={kind:'select-in',tableId:tables.source,columns:columns.source,keyColumn:'source_field_id',maxItems:500};
  statements.sources={kind:'select-all',tableId:tables.source,columns:columns.source,keyColumns:[]};
  statements.owner_run={kind:'select-one',tableId:'libra_runs',columns:['subject_id'],keyColumns:['libra_run_id']};
  statements.owner_subject={kind:'select-one',tableId:'libra_subjects',columns:['routing_anchor_intake_decision_id'],keyColumns:['subject_id']};
  statements.intake_snapshot={kind:'select-one',tableId:'libra_intake_decisions',columns:['candidate_delivery_snapshot_json'],keyColumns:['intake_decision_id']};
  statements.token={kind:'select-one',tableId:'libra_predeck_pipeline_tokens',columns:['source_field_id'],keyColumns:['subject_id']};
  const repository=createRepositoryDefinition({repositoryId:'libra_source_fairness',owner:'libra',schemaManifest:options.schemaManifest,statements});
  function execute(body){return options.unitOfWork.execute([{participantId:'libra_source_fairness',owner:'libra',repositories:[repository],
    execute:context=>body(context.repository(repository.repositoryId))}]).libra_source_fairness;}
  function clock(repo){return repo.invoke('get_clock',{clock_id:'production'})||{clock_id:'production',turn_sequence:1,priority_revision:1};}
  function put(repo,name,row){repo.invoke(repo.invoke('get_'+name,{[columns[name][0]]:row[columns[name][0]]})?'update_'+name:'insert_'+name,row);}
  function registered(repo,runId){
    const row=repo.invoke('get_run',{libra_run_id:runId});
    if(!row)throw new Error('Fairness requires a registered Libra Run.');
    return row;
  }
  return Object.freeze({
    registerRun(runId){return execute(repo=>{
      const run=repo.invoke('owner_run',{libra_run_id:runId});
      const subject=run&&repo.invoke('owner_subject',{subject_id:run.subject_id});
      const decision=subject&&repo.invoke('intake_snapshot',{intake_decision_id:subject.routing_anchor_intake_decision_id});
      const candidatePublishedAtMs=decision&&JSON.parse(decision.candidate_delivery_snapshot_json).candidatePackage?.publishedAtMs;
      if(!Number.isSafeInteger(candidatePublishedAtMs)||candidatePublishedAtMs<0)
        throw new Error('Fairness Run lacks its immutable Candidate publication time.');
      const current=repo.invoke('get_run',{libra_run_id:runId});
      if(current)return Object.freeze({...current,candidatePublishedAtMs});
      const token=run&&repo.invoke('token',{subject_id:run.subject_id});
      if(!token)throw new Error('Fairness Run lacks its original source responsibility.');
      // Join the current round instead of claiming an unserved historical turn.
      const row={libra_run_id:runId,source_field_id:token.source_field_id,last_turn_sequence:Number(clock(repo).turn_sequence),scan_cursor:null,updated_at_ms:options.now()};
      put(repo,'run',row);
      if(!repo.invoke('get_source',{source_field_id:row.source_field_id}))put(repo,'source',{
        source_field_id:row.source_field_id,last_turn_sequence:0,updated_at_ms:options.now()});
      return Object.freeze({...row,candidatePublishedAtMs});
    });},
    advancePriorityRevision(){return execute(repo=>{
      const current=clock(repo),revision=Number(current.priority_revision)+1;
      if(!Number.isSafeInteger(revision))throw new Error('Fairness revision exhausted.');
      put(repo,'clock',{...current,priority_revision:revision});return revision;
    });},
    readCursor(runId){return execute(repo=>registered(repo,runId).scan_cursor);},
    // Classification belongs to the application. This method accepts only its
    // qualified durable Attempt identity, never a poll, submit, or permit signal.
    recordOpportunity({runId,eventId,eventAttemptId,ordinal}){
      if(!runId||!eventId||!eventAttemptId||!Number.isSafeInteger(ordinal)||ordinal<1)throw new TypeError('Invalid execution opportunity identity.');
      return execute(repo=>{
        const run=registered(repo,runId),prior=repo.invoke('get_event',{foundation_event_id:eventId});
        if(prior&&prior.libra_run_id!==runId)throw new Error('Execution opportunity changed Libra Run.');
        if(prior&&Number(prior.last_attempt_ordinal)===ordinal&&prior.last_event_attempt_id!==eventAttemptId)
          throw new Error('Execution opportunity ordinal has conflicting identity.');
        if(prior&&Number(prior.last_attempt_ordinal)>=ordinal)return Object.freeze({recorded:false,priorityRevision:Number(clock(repo).priority_revision)});
        const previous=clock(repo),sequence=Number(previous.turn_sequence)+1,revision=Number(previous.priority_revision)+1;
        if(!Number.isSafeInteger(sequence)||!Number.isSafeInteger(revision))throw new Error('Fairness sequence exhausted.');
        const now=options.now();
        put(repo,'clock',{clock_id:'production',turn_sequence:sequence,priority_revision:revision});
        put(repo,'event',{foundation_event_id:eventId,libra_run_id:runId,last_attempt_ordinal:ordinal,last_event_attempt_id:eventAttemptId,updated_at_ms:now});
        put(repo,'source',{source_field_id:run.source_field_id,last_turn_sequence:sequence,updated_at_ms:now});
        put(repo,'run',{...run,last_turn_sequence:sequence,updated_at_ms:now});
        return Object.freeze({recorded:true,priorityRevision:revision});
      });
    },
    saveCursor(runId,cursor){
      if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>256))throw new TypeError('Invalid summary cursor.');
      return execute(repo=>{const run=registered(repo,runId);if(run.scan_cursor!==cursor)put(repo,'run',{...run,scan_cursor:cursor,updated_at_ms:options.now()});});
    },
    snapshot(runIds=null){return execute(repo=>{
      function chunks(name,ids){const rows=[];for(let i=0;i<ids.length;i+=500)rows.push(...repo.invoke(name,{values:ids.slice(i,i+500)}));return rows;}
      const runs=runIds===null?repo.invoke('runs',{}):chunks('runs_by_id',[...new Set(runIds)]);
      const sources=runIds===null?repo.invoke('sources',{}):chunks('sources_by_id',[...new Set(runs.map(row=>row.source_field_id))]);
      return Object.freeze({priorityRevision:Number(clock(repo).priority_revision),
        sources:Object.freeze(sources.map(row=>Object.freeze({sourceFieldId:row.source_field_id,lastTurn:Number(row.last_turn_sequence)}))),
        runs:Object.freeze(runs.map(row=>Object.freeze({runId:row.libra_run_id,sourceFieldId:row.source_field_id,lastTurn:Number(row.last_turn_sequence)})))});
    });},
  });
}
module.exports=Object.freeze({createSourceFairnessStore});
