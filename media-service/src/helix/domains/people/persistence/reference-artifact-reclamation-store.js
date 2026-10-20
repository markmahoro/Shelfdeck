'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalDigest:D,canonicalJson:J}=require('../../../contracts/canonical-json');
const {AUDIT,RECLAIM,EVIDENCE,RECEIPT,POLICY,assertEvidence}=require('../../../contracts/people-artifact-reclamation');
const columns=['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state','created_at_ms'];
function fail(message){throw Object.assign(new Error(message),{code:'PEOPLE_ARTIFACT_RECLAMATION_FENCED'});}
function handle(row){return {schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:row.artifact_handle_id,
  artifactKind:row.artifact_kind,ownerDomain:row.owner_domain,ownerScope:{scopeType:row.owner_scope_type,scopeId:row.owner_scope_id},
  storageRef:row.storage_ref,digestAlgorithm:row.digest_algorithm,digestHex:row.digest_hex,sizeBytes:row.size_bytes,mediaType:row.media_type,
  provenanceRef:JSON.parse(row.provenance_ref),referenceRevision:row.reference_revision};}
function outcome(result,execution){const digest=D(result),effectId=D(['workspace_write',execution.idempotencyKey]);return {kind:'succeeded',resultSchemaRef:RECEIPT,result,
  evidenceSchemaRef:'helix://contracts/capabilities/people.workspace.reclaim/v1/evidence',evidence:{evidenceId:'people-gc-evidence-'+digest,
    evidenceKind:'people_artifact_reclamation',producerRef:RECLAIM,basisDigest:result.scopeDigest,payloadDigest:digest,observedAtMs:result.committedAtMs},
  effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:result.effectReceiptRef,effectId,effectClass:'workspace_write',
    idempotencyKey:execution.idempotencyKey,commitMarker:'people-gc-marker-'+digest,externalReceiptRef:null,outputDigest:digest,verificationEvidenceDigest:digest,committedAtMs:result.committedAtMs}};}
function createPeopleArtifactReclamationStore(options){
  const now=options.now||Date.now;
  const definition=createRepositoryDefinition({repositoryId:'people_artifact_reclamation',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    page:{kind:'select-page-after',tableId:'fx_artifact_registry',keyColumn:'artifact_handle_id',fixedKeyColumns:['owner_domain','owner_scope_type'],columns,maxItems:100},
    artifact:{kind:'select-one',tableId:'fx_artifact_registry',keyColumns:['artifact_handle_id'],columns},
    references:{kind:'select-summary',tableId:'fx_artifact_references',keyColumns:['artifact_handle_id','state'],summaries:[{operator:'count',output:'rows'}]},
    open_effects:{kind:'select-summary',tableId:'fx_effect_journal',keyColumns:['state'],summaries:[{operator:'count',output:'rows'}]},
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','state','basis_digest','definition_json','definition_digest'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['event_id','work_id','state','capability_ref'],keyColumns:['event_id']},
    work_events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','state','capability_ref'],keyColumns:['work_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','state'],keyColumns:['event_attempt_id']},
    effect:{kind:'select-one',tableId:'fx_effect_journal',columns:['effect_id','event_attempt_id','effect_class','idempotency_key','state'],keyColumns:['effect_id']},
    result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest'],keyColumns:['event_id']},
    marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','result_id','result_digest','commit_digest'],keyColumns:['commit_marker']},
    cas:{kind:'update',tableId:'fx_artifact_registry',setColumns:['state','reference_revision'],keyColumns:['artifact_handle_id'],
      compareColumns:[{column:'state',parameter:'expected_state'},{column:'reference_revision',parameter:'expected_reference_revision'}]},
    insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest',
      'evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
    insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']}
  }});
  function execute(body,guards=[],readFence=null){return options.unitOfWork.execute([...guards,{participantId:'people_artifact_reclamation',owner:'execution-foundation',boundBusinessOwner:'people',
    repositories:[definition],execute:tx=>body(tx.repository(definition.repositoryId),tx.commitTimeMs)}],{readFence}).people_artifact_reclamation;}
  function inspect(repo,artifactHandle){const row=repo.invoke('artifact',{artifact_handle_id:artifactHandle.artifactHandleId});
    if(!row||row.owner_domain!=='people'||row.owner_scope_type!=='person'||!['reference-image','reference-embedding'].includes(row.artifact_kind)||
      D({...handle(row),referenceRevision:artifactHandle.referenceRevision})!==D(artifactHandle))fail('Artifact no longer matches its exact registered Handle.');return row;}
  function requireExecution(repo,execution,evidence){assertEvidence(evidence,options.contractValidator);
    const work=repo.invoke('work',{work_id:execution.workId}),event=repo.invoke('event',{event_id:execution.eventId}),attempt=repo.invoke('attempt',{event_attempt_id:execution.eventAttemptId}),
      effect=repo.invoke('effect',{effect_id:D(['workspace_write',execution.idempotencyKey])}),originalAttempt=effect&&repo.invoke('attempt',{event_attempt_id:effect.event_attempt_id});
    if(work?.owner_domain!=='people'||work.process_type!=='people_artifact_reclamation'||work.work_kind!=='reference_artifact_reclaim'||work.state!=='running'||
      event?.work_id!==execution.workId||event.capability_ref!==RECLAIM||event.state!=='executing'||attempt?.event_id!==execution.eventId||attempt.state!=='executing'||
      effect?.effect_class!=='workspace_write'||effect.idempotency_key!==execution.idempotencyKey||!['intended','reconcile_required'].includes(effect.state)||originalAttempt?.event_id!==execution.eventId)
      fail('Reclamation requires its actual current Work/Event/Attempt and original Effect.');
    const frozen=JSON.parse(work.definition_json);if(D(frozen)!==work.definition_digest||frozen.executionBasisDigest!==work.basis_digest)fail('Frozen Work Definition changed.');
    const previous=frozen.dependencyRefs.filter(item=>item.objectType==='reference_audit_predecessor');if(previous.length!==1)fail('Reclamation has no exact audit predecessor.');
    const sourceWork=repo.invoke('work',{work_id:previous[0].objectId}),events=repo.invoke('work_events',{work_id:previous[0].objectId}).filter(item=>item.state==='succeeded'&&item.capability_ref===AUDIT);
    if(sourceWork?.owner_domain!=='people'||sourceWork.process_type!=='people_artifact_reclamation'||sourceWork.state!=='succeeded'||events.length!==1)fail('Audit predecessor is not the exact completed Work.');
    const result=repo.invoke('result',{event_id:events[0].event_id});
    if(result?.outcome_kind!=='succeeded'||result.result_schema_ref!==EVIDENCE||result.result_digest!==previous[0].digest||D(JSON.parse(result.result_json))!==result.result_digest||
      D(evidence)!==result.result_digest||evidence.basisDigest!==sourceWork.basis_digest||evidence.status!=='eligible')fail('Successful audit Result changed or is not eligible.');
    return {work,effect,auditResultDigest:result.result_digest};
  }
  function currentReferences(repo,artifactHandle,ownEffectId=null){if(repo.invoke('references',{artifact_handle_id:artifactHandle.artifactHandleId,state:'active'}).rows>0n)return false;
    const open=repo.invoke('open_effects',{state:'intended'}).rows+repo.invoke('open_effects',{state:'reconcile_required'}).rows;
    return open===(ownEffectId?1n:0n);}
  function readReceipt(repo,execution){const row=repo.invoke('result',{event_id:execution.eventId});if(!row)return null;
    const result=JSON.parse(row.result_json);options.contractValidator.validate(RECEIPT,result);const value=outcome(result,execution),marker=repo.invoke('marker',{commit_marker:value.effectReceipt.commitMarker});
    if(row.result_schema_ref!==RECEIPT||row.outcome_kind!=='succeeded'||D(result)!==row.result_digest||
      D(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='receiptDigest')))!==result.receiptDigest||
      result.executionReference.workId!==execution.workId||result.executionReference.idempotencyKey!==execution.idempotencyKey||
      marker?.effect_id!==value.effectReceipt.effectId||marker.result_id!==row.result_id||marker.result_digest!==row.result_digest||marker.commit_digest!==row.result_digest)
      fail('Persisted Reclamation Receipt or marker changed.');return value;}
  function cas(repo,row,state){if(repo.invoke('cas',{artifact_handle_id:row.artifact_handle_id,state,reference_revision:row.reference_revision+1,
    expected_state:row.state,expected_reference_revision:row.reference_revision}).changes!==1)fail('Artifact lifecycle revision changed concurrently.');}
  return Object.freeze({
    listPage:({cursor,limit})=>execute(repo=>repo.invoke('page',{owner_domain:'people',owner_scope_type:'person',cursor,limit:Math.min(limit,100)})
      .map(row=>({cursor:row.artifact_handle_id,scope:{artifactHandleId:row.artifact_handle_id}}))),
    artifact:id=>execute(repo=>{const row=repo.invoke('artifact',{artifact_handle_id:id});return row?{handle:handle(row),state:row.state,createdAtMs:row.created_at_ms}:null;}),
    currentReferences:(artifactHandle,ownEffectId=null)=>execute(repo=>currentReferences(repo,artifactHandle,ownEffectId)),
    replay:execution=>execute(repo=>readReceipt(repo,execution)),
    claim({execution,evidence,guards,verifyIntent,readFence}){return execute(repo=>{
      const prior=readReceipt(repo,execution);if(prior)return prior;options.unitOfWork.assertReadFence(readFence);
      const {effect}=requireExecution(repo,execution,evidence),row=inspect(repo,evidence.artifactHandle);
      if(row.created_at_ms>now()-POLICY.artifactAgeMs||!currentReferences(repo,evidence.artifactHandle,effect.effect_id)||verifyIntent()!==true)
        fail('Artifact references, retention or exact physical deletion intent changed.');
      if(row.state==='gc_eligible'&&row.reference_revision===evidence.artifactHandle.referenceRevision+1)return {claimed:true};
      if(row.state!=='active'||row.reference_revision!==evidence.artifactHandle.referenceRevision)fail('Artifact is not the audited active revision.');
      cas(repo,row,'gc_eligible');return {claimed:true};
    },guards,readFence);},
    settle({execution,evidence,disposition,physicalEvidenceDigest,verifyReality,guards=[]}){return execute((repo,at)=>{
      const prior=readReceipt(repo,execution);if(prior)return prior;
      const {work,auditResultDigest}=requireExecution(repo,execution,evidence),row=inspect(repo,evidence.artifactHandle);
      const claimed=row.state==='gc_eligible'&&row.reference_revision===evidence.artifactHandle.referenceRevision+1,
        unclaimedRetained=disposition==='retained'&&row.state==='active'&&row.reference_revision===evidence.artifactHandle.referenceRevision;
      if(!claimed&&!unclaimedRetained||verifyReality()!==true)fail('Reclamation has no exact claimed lifecycle or physical proof.');
      const nextRevision=row.reference_revision+(claimed?1:0);if(claimed)cas(repo,row,disposition==='deleted'?'deleted':'active');
      const body={schemaRef:RECEIPT,schemaVersion:1,receiptId:'people-gc-receipt-'+D(execution.eventId),receiptKind:'people_artifact_reclamation',ownerDomain:'people',
        scopeType:'people_artifact_reclamation',scopeId:work.process_id,scopeDigest:work.basis_digest,effectReceiptRef:'people-gc-effect-'+D(execution.idempotencyKey),committedAtMs:at,
        artifactHandleId:row.artifact_handle_id,artifactDigest:row.digest_hex,previousReferenceRevision:evidence.artifactHandle.referenceRevision,referenceRevision:nextRevision,
        disposition,reasonCode:disposition==='deleted'?'unreferenced':'authority_changed',reclaimedBytes:disposition==='deleted'?row.size_bytes:0,
        auditResultDigest,physicalEvidenceDigest,executionReference:{workId:execution.workId,eventId:execution.eventId,eventAttemptId:execution.eventAttemptId,idempotencyKey:execution.idempotencyKey}},
        result={...body,receiptDigest:D(body)};options.contractValidator.validate(RECEIPT,result);const value=outcome(result,execution),resultId='people-gc-result-'+D(execution.eventId),resultDigest=D(result);
      repo.invoke('insert_result',{result_id:resultId,event_id:execution.eventId,outcome_kind:'succeeded',result_schema_ref:RECEIPT,result_json:J(result),result_digest:resultDigest,
        evidence_schema_ref:value.evidenceSchemaRef,evidence_json:J(value.evidence),evidence_digest:D(value.evidence),effect_receipt_id:result.effectReceiptRef,committed_at_ms:at});
      repo.invoke('insert_marker',{commit_marker:value.effectReceipt.commitMarker,effect_id:value.effectReceipt.effectId,owner_domain:'people',scope_type:'people_artifact_reclamation',scope_id:work.process_id,
        commit_digest:resultDigest,result_id:resultId,result_schema_ref:RECEIPT,result_digest:resultDigest,committed_at_ms:at});return value;
    },guards);},definition
  });
}
module.exports=Object.freeze({createPeopleArtifactReclamationStore,outcome});
