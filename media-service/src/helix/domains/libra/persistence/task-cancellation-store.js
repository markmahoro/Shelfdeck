'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {continuityHeadDigest,CONTINUITY_HEAD_ID}=require('../model/libra-intake-contracts');
const {createMaterialControlProjectionPort}=require('../../../foundation/persistence/material-control');

const REQUEST_SCHEMA = 'helix://contracts/application-types/LibraTaskCancellationRequest/v1';
const COLUMNS = ['cancellation_id', 'subject_id', 'libra_run_id', 'actor_id', 'idempotency_key',
  'request_schema_ref', 'request_json', 'request_digest', 'state', 'state_revision', 'requested_at_ms', 'completed_at_ms'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function createTaskCancellationStore(options) {
  const repository = createRepositoryDefinition({ repositoryId:'libra_task_cancellation', owner:'libra',
    schemaManifest:options.schemaManifest, statements:{
      subject:{kind:'select-all',tableId:'libra_task_cancellations',columns:COLUMNS,keyColumns:['subject_id'],safeIntegers:true},
      run:{kind:'select-one',tableId:'libra_task_cancellations',columns:COLUMNS,keyColumns:['libra_run_id'],safeIntegers:true},
      key:{kind:'select-one',tableId:'libra_task_cancellations',columns:COLUMNS,keyColumns:['actor_id','idempotency_key'],safeIntegers:true},
      insert:{kind:'insert',tableId:'libra_task_cancellations',columns:COLUMNS},
      complete:{kind:'update',tableId:'libra_task_cancellations',setColumns:['state','state_revision','completed_at_ms'],
        keyColumns:['cancellation_id'],compareColumns:[{column:'state',parameter:'expected_state'},
          {column:'state_revision',parameter:'expected_revision'}]},
      pending:{kind:'select-page-after',tableId:'libra_task_cancellations',columns:COLUMNS,
        fixedKeyColumns:['state'],keyColumn:'subject_id',maxItems:100,safeIntegers:true},
      subject_head:{kind:'select-one',tableId:'libra_subjects',columns:['status'],keyColumns:['subject_id']},
      runs:{kind:'select-all',tableId:'libra_runs',columns:['state'],keyColumns:['subject_id']},
      terminal_subject:{kind:'update',tableId:'libra_subjects',setColumns:['status','terminal_at_ms','updated_at_ms'],
        keyColumns:['subject_id'],compareColumns:[{column:'status',parameter:'expected_status'}]},
      continuity_head:{kind:'select-one',tableId:'libra_subject_continuity_heads',columns:['current_revision'],keyColumns:['head_id'],safeIntegers:true},
      continuity_advance:{kind:'update',tableId:'libra_subject_continuity_heads',setColumns:['current_revision','head_digest','updated_at_ms'],
        keyColumns:['head_id'],compareColumns:[{column:'current_revision',parameter:'expected_revision'}]},
      bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['material_key','origin_intake_decision_id'],keyColumns:['subject_id','current']},
      intake:{kind:'select-one',tableId:'libra_intake_decisions',columns:['source_field_id'],keyColumns:['intake_decision_id']},
      run_manifest:{kind:'select-one',tableId:'libra_runs',columns:['run_material_manifest_id'],keyColumns:['libra_run_id']},
      run_sources:{kind:'select-all',tableId:'libra_run_material_members',columns:['material_key','origin_intake_decision_id'],keyColumns:['run_material_manifest_id']},
    }});
  const execute = (body,readFence=null) => options.unitOfWork.execute([{participantId:'libra_task_cancellation',owner:'libra',
    repositories:[repository],execute:context=>body(context.repository(repository.repositoryId),context)}],{readFence}).libra_task_cancellation;
  function decode(row) {
    if (!row) return null;
    const request = JSON.parse(row.request_json);
    if (canonicalDigest(request) !== row.request_digest || row.request_schema_ref !== REQUEST_SCHEMA)
      fail('LIBRA_CANCELLATION_CORRUPT','Cancellation request failed its immutable digest check.');
    return Object.freeze({cancellationId:row.cancellation_id,subjectId:row.subject_id,libraRunId:row.libra_run_id,
      state:row.state,stateRevision:Number(row.state_revision),request,requestedAtMs:Number(row.requested_at_ms)});
  }
  const latest=(repo,subjectId)=>repo.invoke('subject',{subject_id:subjectId}).sort((a,b)=>
    Number(b.state==='pending')-Number(a.state==='pending')||Number(b.requested_at_ms)-Number(a.requested_at_ms))[0];
  const get = subjectId => execute(repo=>decode(latest(repo,subjectId)));
  const controls=createMaterialControlProjectionPort(options);
  const getForRun = libraRunId => execute(repo=>decode(repo.invoke('run',{libra_run_id:libraRunId})));
  function sources(repo,subjectId,libraRunId){
    const bindings=libraRunId?repo.invoke('run_sources',{run_material_manifest_id:repo.invoke('run_manifest',{libra_run_id:libraRunId}).run_material_manifest_id}):repo.invoke('bindings',{subject_id:subjectId,current:1});
    const items=new Map();
    for(const binding of bindings){const fieldId=repo.invoke('intake',{intake_decision_id:binding.origin_intake_decision_id})?.source_field_id;
      if(!fieldId)fail('LIBRA_CANCELLATION_SOURCE_MISSING','Source provenance is unavailable.');
      items.set(fieldId+':'+binding.material_key,{fieldId,materialKey:binding.material_key});}
    return [...items.values()].sort((a,b)=>a.fieldId.localeCompare(b.fieldId)||a.materialKey.localeCompare(b.materialKey));
  }
  return Object.freeze({get,getForRun,sourceMaterials:(subjectId,libraRunId)=>execute(repo=>sources(repo,subjectId,libraRunId)),
    handoffAccepted(subjectId){return execute((repo,context)=>{
      const row=decode(latest(repo,subjectId));if(!row||row.state!=='pending')return row;
      if(repo.invoke('complete',{cancellation_id:row.cancellationId,state:'handoff_accepted',state_revision:row.stateRevision+1,
        completed_at_ms:context.commitTimeMs,expected_state:'pending',expected_revision:row.stateRevision}).changes!==1)
        fail('LIBRA_CANCELLATION_STALE','Cancellation changed before Handoff resolution.');
      return decode(latest(repo,subjectId));
    });},
    request(subjectId,libraRunId,body,readFence=null) {
      if (!subjectId || !body?.idempotencyKey || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length>256)
        fail('LIBRA_CANCELLATION_INPUT','Cancellation requires a Subject and an idempotency key.');
      if(body.excludeSourceFiles!==undefined&&typeof body.excludeSourceFiles!=='boolean')
        fail('LIBRA_CANCELLATION_INPUT','Source exclusion must be an explicit boolean.');
      if(Object.keys(body).some(key=>!['idempotencyKey','excludeSourceFiles','expectedRunStateRevision','expectedRunStateDigest'].includes(key)))
        fail('LIBRA_CANCELLATION_INPUT','Cancellation contains unsupported fields.');
      return execute((repo,context)=>{
        const existing=repo.invoke('key',{actor_id:'admin',idempotency_key:body.idempotencyKey});
        if(existing){
          const original=decode(existing);
          if(original.subjectId!==subjectId||original.libraRunId!==libraRunId||canonicalDigest(original.request.body)!==canonicalDigest(body))
            fail('LIBRA_CANCELLATION_CONFLICT','Idempotency key binds another cancellation.');
          return decode(existing);
        }
        const prior=decode(libraRunId?repo.invoke('run',{libra_run_id:libraRunId}):latest(repo,subjectId));
        if(prior){
          if(prior.libraRunId!==libraRunId || Boolean(prior.request.body.excludeSourceFiles)!==Boolean(body.excludeSourceFiles))
            fail('LIBRA_CANCELLATION_CONFLICT','Another cancellation with a different scope or exclusion intent already exists.');
          return prior;
        }
        if(latest(repo,subjectId)?.state==='pending')fail('LIBRA_CANCELLATION_CONFLICT','Another task cancellation is still draining for this Subject.');
        const sourceMaterials=body.excludeSourceFiles?sources(repo,subjectId,libraRunId):[];
        if(sourceMaterials.length>1024)fail('LIBRA_CANCELLATION_INPUT','Cancellation source scope exceeds its physical member limit.');
        const request={schemaRef:REQUEST_SCHEMA,subjectId,libraRunId,body,sourceMaterials};
        const requestDigest=canonicalDigest(request),requestJson=canonicalJson(request);
        if(Buffer.byteLength(requestJson)>1048576)fail('LIBRA_CANCELLATION_INPUT','Cancellation request exceeds its size limit.');
        const row={cancellation_id:'libra-cancel-'+requestDigest.slice(0,40),subject_id:subjectId,libra_run_id:libraRunId,
          actor_id:'admin',idempotency_key:body.idempotencyKey,request_schema_ref:REQUEST_SCHEMA,request_json:requestJson,
          request_digest:requestDigest,state:'pending',state_revision:1,requested_at_ms:context.commitTimeMs,completed_at_ms:null};
        repo.invoke('insert',row);
        return decode(row);
      },readFence);
    },
    complete(subjectId) {
      const readFence=options.unitOfWork.captureReadFence();
      const hasControl=controls.readScope({ownerDomain:'libra',scopeType:'subject',scopeId:subjectId}).items.some(item=>item.controlState==='controlled');
      return execute((repo,context)=>{
      const row=decode(latest(repo,subjectId));
      if(!row || row.state!=='pending')return row;
      if(row.libraRunId && !hasControl && repo.invoke('subject_head',{subject_id:subjectId})?.status==='active' &&
          repo.invoke('runs',{subject_id:subjectId}).every(run=>['discarded','superseded'].includes(run.state))){
        repo.invoke('terminal_subject',{subject_id:subjectId,status:'abandoned',expected_status:'active',
          terminal_at_ms:context.commitTimeMs,updated_at_ms:context.commitTimeMs});
        const head=repo.invoke('continuity_head',{head_id:CONTINUITY_HEAD_ID});
        if(head){const revision=Number(head.current_revision)+1;
          if(repo.invoke('continuity_advance',{head_id:CONTINUITY_HEAD_ID,current_revision:revision,
            head_digest:continuityHeadDigest(revision),updated_at_ms:context.commitTimeMs,expected_revision:Number(head.current_revision)}).changes!==1)
            fail('LIBRA_CANCELLATION_STALE','Subject continuity changed before terminal commit.');}
      }
      if(repo.invoke('complete',{cancellation_id:row.cancellationId,state:'completed',state_revision:row.stateRevision+1,
        completed_at_ms:context.commitTimeMs,expected_state:'pending',expected_revision:row.stateRevision}).changes!==1)
        fail('LIBRA_CANCELLATION_STALE','Cancellation changed before completion.');
      return decode(latest(repo,subjectId));
    },readFence);},
    listPendingPage({cursor=null,limit=32}) {return execute(repo=>repo.invoke('pending',{
      state:'pending',cursor:cursor||'',limit:Math.min(limit,100)}).map(row=>({cursor:row.subject_id,
        scope:{subjectId:row.subject_id}})));},
  });
}
module.exports=Object.freeze({createTaskCancellationStore,REQUEST_SCHEMA});
