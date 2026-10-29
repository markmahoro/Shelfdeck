'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createMaterialControlAdmissionReadParticipant}=require('../../../foundation/persistence/material-control');
const {CAPS,PROCESS,RESULT,FILES,reference:planReference,marker,outcome}=require('../model/series-root-relocation-contract');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.series-root-relocation-commit/v1/contract.json').contract;
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_SERIES_RELOCATION_EXECUTION_FENCE'});};

function createSeriesRootRelocationExecution(options) {
  const store=options.relocationStore;
  const foundation=createRepositoryDefinition({repositoryId:'arca_series_root_execution',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state','basis_digest'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']},
    effect:{kind:'select-one',tableId:'fx_effect_journal',columns:['event_attempt_id','effect_class','idempotency_key','state','output_digest','external_receipt_ref'],keyColumns:['effect_id']},
    result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'],keyColumns:['event_id'],safeIntegers:true},
    marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'],keyColumns:['commit_marker'],safeIntegers:true},
    work_events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','work_id','capability_ref','contract_version','state'],keyColumns:['work_id']},
    event_attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','state','input_snapshot_digest','fence_snapshot_digest'],keyColumns:['event_id']},
    attempt_effects:{kind:'select-all',tableId:'fx_effect_journal',columns:['effect_id','effect_class','idempotency_key','state','intent_digest'],keyColumns:['event_attempt_id']},
    insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
    insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
  }});
  const participant=(id,execute)=>({participantId:id,owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute:c=>execute(c.repository(foundation.repositoryId),c)});
  function reference(execution) {
    const ref=execution.namedInputs?.seriesRootRelocationReference;
    if(!ref||execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!==PROCESS||execution.ownerScope.processId!==ref.relocationId||
        !Object.values(CAPS).includes(execution.capabilityRef))fail('Relocation execution has a foreign Owner or capability.');
    options.contractValidator.validate(ref.schemaRef,ref);return ref;
  }
  function executionFence(repo,execution,ref,active) {
    const work=repo.invoke('work',{work_id:execution.workId}),event=repo.invoke('event',{event_id:execution.eventId}),attempt=repo.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
    const effectClass=execution.capabilityRef===CAPS.files?'material_commit':'domain_fact_commit';
    if(work?.owner_domain!=='arca'||work.process_type!==PROCESS||work.process_id!==ref.relocationId||work.basis_digest!==ref.planDigest||
        event?.work_id!==execution.workId||event.capability_ref!==execution.capabilityRef||attempt?.event_id!==execution.eventId||
        active&&(work.state!=='running'||event.state!=='executing'||attempt.state!=='executing'))fail('Relocation lost its exact executing Work, Event or Attempt.');
    const effect=repo.invoke('effect',{effect_id:canonicalDigest([effectClass,execution.idempotencyKey])});
    if(!effect||effect.event_attempt_id!==execution.eventAttemptId||effect.effect_class!==effectClass||effect.idempotency_key!==execution.idempotencyKey||
        active&&!['intended','effect_observed','reconcile_required'].includes(effect.state))fail('Relocation has no matching Effect intent.');
  }
  function controlParticipants(plan) {
    const files=[...plan.files].sort((a,b)=>a.identity.materialKey.localeCompare(b.identity.materialKey)),parts=[];
    for(let i=0;i<files.length;i+=1024) {
      const batch=files.slice(i,i+1024),expected=new Map(batch.map(file=>[file.identity.materialKey,file]));
      parts.push(createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_series_root_control_'+i,
        materialKeys:batch.map(file=>file.identity.materialKey),accept:rows=>{
          for(const row of rows){const file=expected.get(row.materialKey);
            if(row.resultKind!=='available'||row.controlState!=='controlled'||row.ownerDomain!=='arca'||row.ownerScopeType!==file.ownerScopeType||row.ownerScopeId!==file.ownerScopeId)
              fail('Relocation material no longer belongs to its frozen Arca responsibility.');}
        }}));
    }
    return parts;
  }
  function assertExecuting(execution) {
    const ref=reference(execution),row=store.read(ref.relocationId);if(!row||row.plan_digest!==ref.planDigest)fail('Relocation plan is missing.');
    options.unitOfWork.execute([participant('arca_series_root_execution_fence',r=>executionFence(r,execution,ref,true)),store.fenceParticipant(ref),...controlParticipants(row.plan)]);
    if(execution.shouldContinue?.()===false)fail('Relocation execution was stopped.');
    return row;
  }
  function assertRecoveryContext(context,row) {
    options.unitOfWork.execute([participant('arca_series_root_recovery_fence',r=>{
      const work=r.invoke('work',{work_id:context.work?.work_id}),event=r.invoke('event',{event_id:context.event?.event_id}),
        attempt=r.invoke('attempt',{event_attempt_id:context.attempt?.event_attempt_id}),effect=r.invoke('effect',{effect_id:context.effect?.effect_id});
      if(work?.owner_domain!=='arca'||work.process_type!==PROCESS||work.process_id!==row.relocation_id||work.basis_digest!==row.plan_digest||
          event?.work_id!==context.work.work_id||event.capability_ref!==CAPS.files||event.state!=='executing'||
          attempt?.event_id!==context.event.event_id||attempt.state!=='executing'||effect?.event_attempt_id!==context.attempt.event_attempt_id||
          effect.effect_class!=='material_commit'||!['intended','effect_observed','reconcile_required'].includes(effect.state))
        fail('Relocation recovery lost its original Work, Event, Attempt or Effect.');
    })]);
  }
  function assertRetrySafe(row,works) {
    const ref=planReference(row);
    const fence=participant('arca_series_root_retry_fence',r=>{
      if(!works.length)fail('Relocation retry requires an existing terminal attempt.');
      for(const prior of works) {
        const work=r.invoke('work',{work_id:prior.work_id});
        if(work?.owner_domain!=='arca'||work.process_type!==PROCESS||work.process_id!==row.relocation_id||work.basis_digest!==row.plan_digest||
            !['failed','cancelled'].includes(work.state))fail('A relocation Work is still active or has another basis.');
        const events=r.invoke('work_events',{work_id:prior.work_id});
        if(events.length>2||new Set(events.map(event=>event.capability_ref)).size!==events.length)fail('Relocation retry found an unexpected execution graph.');
        const files=events.find(event=>event.capability_ref===CAPS.files),fileResult=files&&r.invoke('result',{event_id:files.event_id});
        for(const event of events) {
          if(!Object.values(CAPS).includes(event.capability_ref)||!['succeeded','failed','cancelled','skipped'].includes(event.state))fail('A relocation Event is still active or foreign.');
          const attempts=r.invoke('event_attempts',{event_id:event.event_id});
          for(const attempt of attempts) {
            if(attempt.state!=='completed')fail('A relocation Attempt has not stopped.');
            const inputs={seriesRootRelocationReference:ref};
            if(event.capability_ref===CAPS.commit) {
              if(files?.state!=='succeeded'||fileResult?.outcome_kind!=='succeeded'||fileResult.result_schema_ref!=='helix://contracts/capabilities/arca.series_root.files.relocate/v1/result')fail('Relocation retry lost its successful file predecessor.');
              const verified=JSON.parse(fileResult.result_json);options.contractValidator.validate(FILES,verified);
              if(canonicalDigest(verified)!==fileResult.result_digest||verified.planDigest!==row.plan_digest)fail('Relocation retry predecessor changed.');
              inputs.seriesRootRelocationFilesVerified=verified;
              if(r.invoke('result',{event_id:event.event_id})||r.invoke('marker',{commit_marker:marker(event.event_id)}))fail('A committed Inventory result cannot be retried as an active relocation.');
            }
            if(attempt.input_snapshot_digest!==canonicalDigest(inputs))fail('Relocation retry cannot change an earlier physical plan.');
            for(const effect of r.invoke('attempt_effects',{event_attempt_id:attempt.event_attempt_id})) {
              const effectClass=event.capability_ref===CAPS.files?'material_commit':'domain_fact_commit';
              if(!['intended','effect_observed','reconcile_required','committed','failed'].includes(effect.state)||effect.effect_class!==effectClass||effect.effect_id!==canonicalDigest([effectClass,effect.idempotency_key])||
                  effect.intent_digest!==canonicalDigest({eventId:event.event_id,capabilityRef:event.capability_ref,contractVersion:event.contract_version,
                    inputSnapshotDigest:attempt.input_snapshot_digest,fenceSnapshotDigest:attempt.fence_snapshot_digest})||
                  effectClass==='domain_fact_commit'&&effect.state==='committed')fail('Relocation retry lacks its exact original Effect intent.');
            }
          }
        }
      }
    });
    const inspect=()=>options.unitOfWork.execute([fence,store.fenceParticipant(ref),...controlParticipants(row.plan)]);
    inspect();options.relocationIo.observe(row.plan);inspect();
  }
  function readEvent(execution) {
    const ref=reference(execution);
    const prior=options.unitOfWork.execute([participant('arca_series_root_replay',r=>{
      const row=r.invoke('result',{event_id:execution.eventId});if(!row)return null;
      if(row.result_schema_ref!==RESULT||row.outcome_kind!=='succeeded')fail('Relocation commit has another result.');
      executionFence(r,execution,ref,false);
      const result=JSON.parse(row.result_json);options.contractValidator.validate(RESULT,result);
      const value=outcome(CAPS.commit,result,execution,'domain_fact_commit'),proof=r.invoke('marker',{commit_marker:marker(execution.eventId)});
      if(result.relocationId!==ref.relocationId||result.planDigest!==ref.planDigest||result.scopeId!==ref.scopeId||result.commitMarker!==marker(execution.eventId)||
        canonicalJson(result)!==row.result_json||canonicalDigest(result)!==row.result_digest||canonicalJson(value.evidence)!==row.evidence_json||
        canonicalDigest(value.evidence)!==row.evidence_digest||value.evidenceSchemaRef!==row.evidence_schema_ref||value.effectReceipt.effectReceiptId!==row.effect_receipt_id||
        proof?.owner_domain!=='arca'||proof.scope_type!=='series_root_relocation'||proof.scope_id!==ref.relocationId||proof.result_id!==row.result_id||
        proof.effect_id!==value.effectReceipt.effectId||proof.commit_digest!==canonicalDigest(value.evidence)||proof.result_digest!==row.result_digest||proof.result_schema_ref!==RESULT||
        Number(proof.committed_at_ms)!==result.committedAtMs||Number(row.committed_at_ms)!==result.committedAtMs)fail('Relocation result lacks its exact atomic marker.');
      return value;
    })]).arca_series_root_replay;
    if(prior){const row=store.read(ref.relocationId);if(row?.state!=='committed'||row.inventory_set_digest!==prior.result.inventorySetDigest||row.commit_marker!==prior.result.commitMarker)
      fail('Relocation replay lacks its committed Owner record.');}
    return prior;
  }
  function commit(execution) {
    const replay=readEvent(execution);if(replay)return replay;
    const ref=reference(execution),row=assertExecuting(execution),verified=execution.namedInputs.seriesRootRelocationFilesVerified;
    const predecessors=options.workResultReader.read(execution.workId).filter(item=>item.capabilityRef===CAPS.files&&item.outcomeKind==='succeeded');
    if(predecessors.length!==1||canonicalJson(predecessors[0].result)!==canonicalJson(verified))fail('Relocation requires its exact successful file-move predecessor.');
    const physical=options.relocationIo.observe(row.plan);
    if(physical.state!=='target_verified'||physical.realityDigest!==verified.realityDigest)fail('Relocated physical root changed before Inventory commit.');
    let committed,atomic;
    const write=store.commitParticipant(ref,verified,marker(execution.eventId)),original=write.execute;
    write.execute=c=>{committed=original(c);return committed;};
    const participants=[participant('arca_series_root_predecessor_fence',r=>{
      executionFence(r,execution,ref,true);const prior=predecessors[0],event=r.invoke('event',{event_id:prior.eventId}),result=r.invoke('result',{event_id:prior.eventId});
      if(event?.work_id!==execution.workId||event.capability_ref!==CAPS.files||event.state!=='succeeded'||result?.outcome_kind!=='succeeded'||
          result.result_json!==canonicalJson(verified)||result.result_digest!==canonicalDigest(verified))fail('Relocation predecessor changed before commit.');
    }),...controlParticipants(row.plan),write,participant('arca_series_root_atomic_result',(r,c)=>{
      const payload={relocationId:ref.relocationId,scopeId:ref.scopeId,planDigest:ref.planDigest,sharedVersion:committed.sharedVersion,
        manifestDigest:committed.manifestDigest,inventorySetDigest:committed.inventorySetDigest};
      const result={schemaRef:RESULT,schemaVersion:1,factId:'arca-series-root-fact-'+canonicalDigest(execution.eventId).slice(0,40),ownerDomain:'arca',
        aggregateType:'series_root_relocation',aggregateId:ref.relocationId,revision:2,factSchemaRef:RESULT,factDigest:canonicalDigest(payload),commitMarker:marker(execution.eventId),committedAtMs:c.commitTimeMs,...payload};
      options.contractValidator.validate(RESULT,result);atomic=outcome(CAPS.commit,result,execution,'domain_fact_commit');
      const resultId='arca-series-root-result-'+canonicalDigest(execution.eventId).slice(0,40),digest=canonicalDigest(result);
      r.invoke('insert_result',{result_id:resultId,event_id:execution.eventId,outcome_kind:'succeeded',result_schema_ref:RESULT,result_json:canonicalJson(result),result_digest:digest,
        evidence_schema_ref:atomic.evidenceSchemaRef,evidence_json:canonicalJson(atomic.evidence),evidence_digest:canonicalDigest(atomic.evidence),effect_receipt_id:atomic.effectReceipt.effectReceiptId,committed_at_ms:c.commitTimeMs});
      r.invoke('insert_marker',{commit_marker:marker(execution.eventId),effect_id:atomic.effectReceipt.effectId,owner_domain:'arca',scope_type:'series_root_relocation',scope_id:ref.relocationId,
        commit_digest:canonicalDigest(atomic.evidence),result_id:resultId,result_schema_ref:RESULT,result_digest:digest,committed_at_ms:c.commitTimeMs});
      options.afterAtomicWrite?.();
    })];
    const declared=new Set([...transaction.readTables,...transaction.writeTables]);
    if(participants.some(part=>part.repositories.some(repo=>repo.tableIds.some(table=>!declared.has(table)))))fail('Relocation escaped its canonical atomic transaction.');
    options.unitOfWork.execute(participants);return atomic;
  }
  return Object.freeze({assertExecuting,assertRecoveryContext,assertRetrySafe,readEvent,commit,controlParticipants});
}
module.exports=Object.freeze({createSeriesRootRelocationExecution});
