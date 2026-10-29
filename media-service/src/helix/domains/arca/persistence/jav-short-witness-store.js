'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');

const TABLE='arca_jav_short_stage_witnesses';
const COLUMNS=['witness_id','on_deck_run_id','work_id','event_id','event_attempt_id','effect_id','target_commit_slot_id',
  'decision_digest','member_key','kind','state','revision','witness_schema_ref','witness_json','witness_digest','updated_at_ms'];
const STATES=['intent','created','copied','linked'];
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_JAV_SHORT_WITNESS_INVALID'});};

function unpack(row,base) {
  if(!row)return null;
  let value;try{value=JSON.parse(row.witness_json);}catch{fail('The stored short-path witness is invalid JSON.');}
  const {state,revision,inode,sizeBytes,contentFingerprint,...saved}=value;
  if(row.witness_schema_ref!=='helix://implementation/arca/JavShortStageWitness/v1'||canonicalJson(saved)!==canonicalJson(base)||canonicalDigest(value)!==row.witness_digest||
      canonicalJson(value)!==row.witness_json||row.witness_id!==base.witnessId||row.on_deck_run_id!==base.onDeckRunId||
      row.work_id!==base.workId||row.event_id!==base.eventId||row.event_attempt_id!==base.eventAttemptId||
      row.effect_id!==base.effectId||row.target_commit_slot_id!==base.slotId||row.decision_digest!==base.decisionDigest||
      row.member_key!==base.memberKey||row.kind!==base.kind||row.state!==state||Number(row.revision)!==revision||
      !STATES.includes(state)||!Number.isSafeInteger(revision)||revision<1||
      (state==='intent'?(inode!==null||sizeBytes!==null||contentFingerprint!==null):typeof inode!=='string'||!inode)||
      (['copied','linked'].includes(state)&&(!Number.isSafeInteger(sizeBytes)||sizeBytes<0||typeof contentFingerprint!=='string'||!contentFingerprint)))
    fail('The stored short-path witness or frozen scope drifted.');
  return Object.freeze(value);
}

function createJavShortWitnessStore(options){
  const repo=createRepositoryDefinition({repositoryId:'arca_jav_short_witness',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:TABLE,columns:COLUMNS,keyColumns:['witness_id']},
    event:{kind:'select-all',tableId:TABLE,columns:COLUMNS,keyColumns:['event_id']},
    insert:{kind:'insert',tableId:TABLE,columns:COLUMNS},
    advance:{kind:'update',tableId:TABLE,setColumns:['state','revision','witness_json','witness_digest','updated_at_ms'],
      keyColumns:['witness_id'],compareColumns:[{column:'revision',parameter:'expected_revision'},{column:'witness_digest',parameter:'expected_digest'}]},
  }});
  const fence=createRepositoryDefinition({repositoryId:'arca_jav_short_witness_execution',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']},
    effect:{kind:'select-one',tableId:'fx_effect_journal',columns:['event_attempt_id','effect_class','idempotency_key','state'],keyColumns:['effect_id']},
  }});
  function participant(execution,effectId){return {participantId:'arca_jav_short_execution_fence',owner:'execution-foundation',repositories:[fence],execute(c){
    const r=c.repository(fence.repositoryId),work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),
      attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId}),effect=r.invoke('effect',{effect_id:effectId});
    if(execution.ownerScope?.processType!=='arca_ondeck_run'||work?.owner_domain!=='arca'||work.process_type!=='arca_ondeck_run'||
        work.process_id!==execution.ownerScope.processId||work.state!=='running'||event?.work_id!==execution.workId||
        event.capability_ref!==execution.capabilityRef||event.state!=='executing'||attempt?.event_id!==execution.eventId||attempt.state!=='executing'||
        effect?.event_attempt_id!==execution.eventAttemptId||effect.effect_class!=='material_commit'||
        effectId!==canonicalDigest(['material_commit',effect.idempotency_key])||
        (execution.idempotencyKey&&effect.idempotency_key!==execution.idempotencyKey)||
        !['intended','effect_observed','reconcile_required'].includes(effect.state))fail('The original short-path Effect execution fence changed.');
  }};}
  function bind(execution,request){
    const effectId=execution.effectId||canonicalDigest(['material_commit',execution.idempotencyKey]),slotId=request.targetCommitSlotHandle.slotId,
      decisionDigest=request.finalInventoryDecision.decisionDigest;
    if(execution.ownerScope?.processId!==request.onDeckRunId||!['arca.inventory.product.stage@1','arca.inventory.placement.switch@1'].includes(execution.capabilityRef))
      fail('Short-path witness scope does not match its original On-deck Effect.');
    function basis(spec){
      if(!spec||!['stage_member','target_directory'].includes(spec.kind)||typeof spec.memberKey!=='string'||!spec.memberKey||
          typeof spec.targetPath!=='string'||typeof spec.temporaryPath!=='string'||typeof spec.stagedPath!=='string')fail('Short-path witness basis is incomplete.');
      return Object.freeze({schema:'arca.jav-short-stage-witness@1',witnessId:canonicalDigest({schema:'arca.jav-short-witness-id@1',eventId:execution.eventId,memberKey:spec.memberKey}),
        onDeckRunId:request.onDeckRunId,workId:execution.workId,eventId:execution.eventId,eventAttemptId:execution.eventAttemptId,effectId,
        slotId,decisionDigest,memberKey:spec.memberKey,kind:spec.kind,endpointId:request.shelf.target.endpointId,mountScopeId:request.shelf.target.mountScopeId,
        targetPath:spec.targetPath,temporaryPath:spec.temporaryPath,stagedPath:spec.stagedPath,
        sourceIdentityDigest:spec.sourceIdentityDigest||null,expectedSizeBytes:spec.expectedSizeBytes??null,expectedFingerprint:spec.expectedFingerprint||null});
    }
    function transact(spec,mutate){
      const base=basis(spec);
      return options.unitOfWork.execute([participant(execution,effectId),{participantId:'arca_jav_short_witness_write',owner:'arca',repositories:[repo],execute(c){
        const r=c.repository(repo.repositoryId),row=r.invoke('find',{witness_id:base.witnessId}),old=unpack(row,base),next=mutate(old,base);
        if(!next)return old;
        const json=canonicalJson(next),digest=canonicalDigest(next);
        if(Buffer.byteLength(json)>65536)fail('Short-path witness exceeded its bound.');
        if(!old)r.invoke('insert',{witness_id:base.witnessId,on_deck_run_id:base.onDeckRunId,work_id:base.workId,event_id:base.eventId,
          event_attempt_id:base.eventAttemptId,effect_id:base.effectId,target_commit_slot_id:base.slotId,decision_digest:base.decisionDigest,
          member_key:base.memberKey,kind:base.kind,state:next.state,revision:next.revision,witness_schema_ref:'helix://implementation/arca/JavShortStageWitness/v1',
          witness_json:json,witness_digest:digest,updated_at_ms:c.commitTimeMs});
        else {const result=r.invoke('advance',{witness_id:base.witnessId,state:next.state,revision:next.revision,witness_json:json,witness_digest:digest,
          updated_at_ms:c.commitTimeMs,expected_revision:old.revision,expected_digest:row.witness_digest});
          if(result.changes!==1)fail('Short-path witness CAS failed.');}
        return Object.freeze(next);
      }}]).arca_jav_short_witness_write;
    }
    function peek(spec){return transact(spec,()=>null);}
    function begin(spec){return transact(spec,(old,base)=>old?null:{...base,state:'intent',revision:1,inode:null,sizeBytes:null,contentFingerprint:null});}
    function advance(spec,state,details={}){return transact(spec,(old,base)=>{
      if(!old)fail('Short-path witness intent is absent.');
      const current=STATES.indexOf(old.state),requested=STATES.indexOf(state);
      if(requested<1||requested>current+1)fail('Short-path witness transition is invalid.');
      if(requested<=current){
        if(details.inode!==undefined&&String(details.inode)!==old.inode ||
            details.sizeBytes!==undefined&&details.sizeBytes!==old.sizeBytes ||
            details.contentFingerprint!==undefined&&details.contentFingerprint!==old.contentFingerprint)fail('Short-path witness replay identity changed.');
        return null;
      }
      const next={...base,state,revision:old.revision+1,inode:details.inode===undefined?old.inode:String(details.inode),
        sizeBytes:details.sizeBytes===undefined?old.sizeBytes:details.sizeBytes,
        contentFingerprint:details.contentFingerprint===undefined?old.contentFingerprint:details.contentFingerprint};
      if(!next.inode||(['copied','linked'].includes(state)&&(!Number.isSafeInteger(next.sizeBytes)||!next.contentFingerprint)))
        fail('Short-path witness transition lacks physical evidence.');
      return next;
    });}
    return Object.freeze({peek,begin,advance});
  }
  function readEvent(onDeckRunId,eventId){
    const rows=options.unitOfWork.execute([{participantId:'arca_jav_short_witness_event_read',owner:'arca',repositories:[repo],
      execute:c=>c.repository(repo.repositoryId).invoke('event',{event_id:eventId})}]).arca_jav_short_witness_event_read;
    return Object.freeze(rows.map(row=>{
      let value;try{value=JSON.parse(row.witness_json);}catch{fail('The stored short-path witness is invalid JSON.');}
      const {state,revision,inode,sizeBytes,contentFingerprint,...base}=value;
      if(base.onDeckRunId!==onDeckRunId||base.eventId!==eventId||
          base.witnessId!==canonicalDigest({schema:'arca.jav-short-witness-id@1',eventId,memberKey:base.memberKey}))
        fail('The short-path witness Event scope changed.');
      return unpack(row,base);
    }));
  }
  return Object.freeze({bind,readEvent});
}

module.exports=Object.freeze({createJavShortWitnessStore});
