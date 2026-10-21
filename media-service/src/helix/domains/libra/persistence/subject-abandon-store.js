'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {continuityHeadDigest,CONTINUITY_HEAD_ID}=require('../model/libra-intake-contracts');
const {createMaterialControlProjectionPort,createMaterialControlParticipant,controlScopeDigest}=
  require('../../../foundation/persistence/material-control');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const RESULT_SCHEMA='helix://contracts/application-types/LibraSubjectAbandonReceipt/v1';

function createSubjectAbandonStore(options) {
  const repository=createRepositoryDefinition({repositoryId:'libra_subject_abandon',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','status','intake_revision',
      'routing_anchor_intake_decision_id','current_continuity_set_digest','current_episode_scope_digest'],keyColumns:['subject_id'],safeIntegers:true},
    runs:{kind:'select-all',tableId:'libra_runs',columns:['libra_run_id','state'],keyColumns:['subject_id']},
    bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['material_key','role','authority_kind','mount_scope_id',
      'inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','size_bytes','binding_revision','evidence_digest'],
      keyColumns:['subject_id','current'],safeIntegers:true},
    decision:{kind:'select-one',tableId:'libra_subject_abandon_decisions',columns:['abandon_decision_id','decision_digest'],keyColumns:['subject_id']},
    receipt:{kind:'select-one',tableId:'libra_subject_abandon_receipts',columns:['receipt_id','abandon_decision_id','subject_id','commit_digest'],keyColumns:['subject_id']},
    insert_decision:{kind:'insert',tableId:'libra_subject_abandon_decisions',columns:['abandon_decision_id','subject_id',
      'subject_scope_digest','input_control_scope_digest','actor_id','idempotency_key','decision_digest','decided_at_ms']},
    terminal:{kind:'update',tableId:'libra_subjects',setColumns:['status','terminal_at_ms','updated_at_ms'],keyColumns:['subject_id'],
      compareColumns:[{column:'status',parameter:'expected_status'},{column:'intake_revision',parameter:'expected_revision'}]},
    insert_receipt:{kind:'insert',tableId:'libra_subject_abandon_receipts',columns:['receipt_id','abandon_decision_id','subject_id',
      'released_control_set_digest','terminal_fact_digest','commit_digest','committed_at_ms']},
    continuity_head:{kind:'select-one',tableId:'libra_subject_continuity_heads',columns:['current_revision'],keyColumns:['head_id'],safeIntegers:true},
    continuity_advance:{kind:'update',tableId:'libra_subject_continuity_heads',setColumns:['current_revision','head_digest','updated_at_ms'],
      keyColumns:['head_id'],compareColumns:[{column:'current_revision',parameter:'expected_revision'}]},
  }});
  const foundation=createRepositoryDefinition({repositoryId:'libra_subject_abandon_execution',owner:'execution-foundation',
    readOnly:true,schemaManifest:options.schemaManifest,statements:{
      works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','state'],keyColumns:['owner_domain','process_type','process_id']},
      events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id'],keyColumns:['work_id']},
      attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id'],keyColumns:['event_id']},
      effects:{kind:'select-all',tableId:'fx_effect_journal',columns:['state'],keyColumns:['event_attempt_id']},
      marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['owner_domain','scope_type','scope_id','commit_digest'],keyColumns:['commit_marker']},
    }});
  const controls=createMaterialControlProjectionPort(options),commands=createCommandCommitCoordinator(options);
  const normalize=row=>row&&Object.fromEntries(Object.entries(row).map(([k,v])=>[k,k==='inode'?String(v):typeof v==='bigint'?Number(v):v]));
  const snapshotFrom=(repo,subjectId)=>({subject:normalize(repo.invoke('subject',{subject_id:subjectId})),
    runs:repo.invoke('runs',{subject_id:subjectId}),bindings:repo.invoke('bindings',{subject_id:subjectId,current:1})
      .map(normalize)
      .sort((a,b)=>a.material_key.localeCompare(b.material_key)||a.role.localeCompare(b.role))});
  function inspect(subjectId) {
    const value=options.unitOfWork.execute([{participantId:'subject_abandon_snapshot',owner:'libra',repositories:[repository],
      execute:context=>snapshotFrom(context.repository(repository.repositoryId),subjectId)}]).subject_abandon_snapshot;
    if(!value.subject)fail('LIBRA_SUBJECT_NOT_FOUND','Subject was not found.');
    if(value.runs.length)fail('LIBRA_SUBJECT_HAS_RUN','A Subject with Run history must use its Run cancellation command.');
    if(value.subject.status!=='active')fail('LIBRA_SUBJECT_NOT_ACTIVE','Subject is no longer active.');
    return value;
  }
  function commit(subjectId,intent) {
    const value=inspect(subjectId),subjectDigest=canonicalDigest(value),scope={ownerDomain:'libra',scopeType:'subject',scopeId:subjectId};
    const controlSet=controls.readScope(scope),byKey=new Map(controlSet.items.filter(item=>item.controlState==='controlled').map(item=>[item.materialKey,item]));
    const primary=value.bindings.filter(row=>row.authority_kind==='primary_control');
    if(!primary.length||primary.length>1024||primary.length!==byKey.size||primary.some(row=>!byKey.has(row.material_key)))
      fail('LIBRA_SUBJECT_CONTROL_MISMATCH','Subject Primary bindings do not exactly cover its controlled material.');
    const changes=primary.map(row=>({action:'release',identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
      materialKey:row.material_key,mountScopeId:row.mount_scope_id,inode:String(row.inode),sizeBytes:Number(row.size_bytes),
      fingerprintAlgorithm:row.fingerprint_algorithm,fingerprintVersion:Number(row.fingerprint_version),contentFingerprint:row.content_fingerprint},
      expectedRevision:byKey.get(row.material_key).controlRevision,expectedProjectionDigest:byKey.get(row.material_key).projectionDigest,fromScope:scope,toScope:null}));
    const controlDigest=controlScopeDigest(changes),decisionDigest=canonicalDigest({subjectDigest,controlDigest,cancellationId:intent.cancellationId}),
      marker='libra-subject-abandon-'+decisionDigest,decisionId=intent.cancellationId,receiptId=marker+'-receipt';
    const handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:marker,
      ownerDomain:'libra',processType:'libra_subject',processId:subjectId,operationKind:'release',
      basisRef:{objectType:'libra_subject',objectId:subjectId,revision:Number(value.subject.intake_revision),digest:subjectDigest},
      basisDigest:subjectDigest,canonicalFactSetDigest:subjectDigest,bindingSetDigest:canonicalDigest(value.bindings),controlScopeDigest:controlDigest,
      expectedControlRevisions:changes.map(change=>({materialKey:change.identity.materialKey,revision:change.expectedRevision})),
      eventFenceDigest:decisionDigest,receiptContract:{receiptSchemaRef:RESULT_SCHEMA,controlRevisionSetSchemaRef:'libra.subject-abandon-control-set@1'}};
    const result={resultKind:'abandoned',subjectId,receiptId,decisionDigest,releasedControlSetDigest:controlDigest};
    return commands.execute({
      command:{commandReceiptId:receiptId,ownerDomain:'libra',commandContract:'libra.subject-abandon@1',callerScope:'admin',
        idempotencyKey:intent.cancellationId,requestDigest:decisionDigest,targetType:'subject',targetId:subjectId},
      validationParticipants:[{participantId:'subject_abandon_execution_guard',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],
        execute(context){const repo=context.repository(foundation.repositoryId);
          for(const processType of ['libra_routing','libra_acceptance_spec'])
            for(const work of repo.invoke('works',{owner_domain:'libra',process_type:processType,process_id:subjectId})){
              if(!['succeeded','failed','cancelled'].includes(work.state))fail('LIBRA_SUBJECT_EXECUTION_PENDING','Subject preparation is still draining.');
              for(const event of repo.invoke('events',{work_id:work.work_id}))
                for(const attempt of repo.invoke('attempts',{event_id:event.event_id}))
                  if(repo.invoke('effects',{event_attempt_id:attempt.event_attempt_id}).some(effect=>!['committed','failed'].includes(effect.state)))
                    fail('LIBRA_SUBJECT_EXECUTION_PENDING','Subject has an unresolved Effect.');
            }
        }}],
      domainParticipant:{participantId:'subject_abandon_commit',owner:'libra',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId);
        if(canonicalDigest(snapshotFrom(repo,subjectId))!==subjectDigest)fail('LIBRA_SUBJECT_STALE','Subject changed before cancellation.');
        repo.invoke('insert_decision',{abandon_decision_id:decisionId,subject_id:subjectId,subject_scope_digest:subjectDigest,
          input_control_scope_digest:controlDigest,actor_id:'admin',idempotency_key:intent.request.body.idempotencyKey,decision_digest:decisionDigest,decided_at_ms:context.commitTimeMs});
        if(repo.invoke('terminal',{subject_id:subjectId,status:'abandoned',terminal_at_ms:context.commitTimeMs,updated_at_ms:context.commitTimeMs,
          expected_status:'active',expected_revision:Number(value.subject.intake_revision)}).changes!==1)fail('LIBRA_SUBJECT_STALE','Subject terminal CAS failed.');
        const head=repo.invoke('continuity_head',{head_id:CONTINUITY_HEAD_ID});
        if(head){const revision=Number(head.current_revision)+1;
          if(repo.invoke('continuity_advance',{head_id:CONTINUITY_HEAD_ID,current_revision:revision,head_digest:continuityHeadDigest(revision),
            updated_at_ms:context.commitTimeMs,expected_revision:Number(head.current_revision)}).changes!==1)
            fail('LIBRA_SUBJECT_STALE','Subject continuity CAS failed.');}
        repo.invoke('insert_receipt',{receipt_id:receiptId,abandon_decision_id:decisionId,subject_id:subjectId,released_control_set_digest:controlDigest,
          terminal_fact_digest:canonicalDigest({subjectId,status:'abandoned'}),commit_digest:decisionDigest,committed_at_ms:context.commitTimeMs});
        return result;
      }},
      controlParticipant:createMaterialControlParticipant({schemaManifest:options.schemaManifest,handle,changes,commitMarker:marker}),
      commitMarker:{commitMarker:marker,scopeType:'subject',scopeId:subjectId,commitDigest:decisionDigest},
      auditRecords:[{auditId:marker+'-audit',actorType:'admin',actorId:'admin',action:'cancel_subject',scopeType:'subject',scopeId:subjectId,evidenceDigest:decisionDigest}],
      outboxMessages:[{messageId:marker+'-message',producerDomain:'libra',messageKind:'libra.subject-abandoned@1',aggregateType:'subject',aggregateId:subjectId,
        aggregateRevision:Number(value.subject.intake_revision),dedupKey:marker,intendedConsumers:['libra'],
        payloadSchemaRef:'LibraSubjectAbandonedMessage@1',payload:{messageKind:'libra.subject-abandoned@1',subjectId,decisionDigest}}],
      resultEnvelope:()=>({resultSchemaRef:RESULT_SCHEMA,resultRef:result}),
    }).receipt.resultRef;
  }
  function completed(subjectId){
    let decision;
    options.unitOfWork.execute([{participantId:'subject_abandon_completed',owner:'libra',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);decision=repo.invoke('decision',{subject_id:subjectId});
      if(!decision)return;
      const receipt=repo.invoke('receipt',{subject_id:subjectId}),subject=repo.invoke('subject',{subject_id:subjectId});
      if(!receipt||receipt.abandon_decision_id!==decision.abandon_decision_id||receipt.commit_digest!==decision.decision_digest||subject?.status!=='abandoned')
        fail('LIBRA_SUBJECT_ABANDON_CORRUPT','Subject cancellation receipt does not match its terminal decision.');
    }},{participantId:'subject_abandon_marker',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){
      if(!decision)return;
      const marker=context.repository(foundation.repositoryId).invoke('marker',{commit_marker:'libra-subject-abandon-'+decision.decision_digest});
      if(!marker||marker.owner_domain!=='libra'||marker.scope_type!=='subject'||marker.scope_id!==subjectId||marker.commit_digest!==decision.decision_digest)
        fail('LIBRA_SUBJECT_ABANDON_CORRUPT','Subject cancellation commit marker is missing or inconsistent.');
    }}]);
    return decision;
  }
  return Object.freeze({inspect,commit,completed});
}
module.exports=Object.freeze({createSubjectAbandonStore});
