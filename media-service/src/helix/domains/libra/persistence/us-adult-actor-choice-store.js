'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {SCHEMA,DECISION_SCHEMA,assertRecord}=require('../model/us-adult-actor-choice');
const columns=['intent_id','libra_run_id','subject_id','choice_revision','person_id','person_revision','reference_revision','actor_id','idempotency_key',
  'request_digest','record_schema_ref','record_json','record_digest','created_at_ms'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createUsAdultActorChoiceStore(options){
  const repository=createRepositoryDefinition({repositoryId:'libra_us_adult_actor_choice',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    find_command:{kind:'select-one',tableId:'libra_us_adult_actor_choice_intents',columns,keyColumns:['actor_id','idempotency_key']},
    find_intent:{kind:'select-one',tableId:'libra_us_adult_actor_choice_intents',columns,keyColumns:['intent_id']},
    insert_intent:{kind:'insert',tableId:'libra_us_adult_actor_choice_intents',columns},
    find_head:{kind:'select-one',tableId:'libra_us_adult_actor_choice_heads',columns:['subject_id','current_revision','intent_id','record_digest'],keyColumns:['subject_id']},
    insert_head:{kind:'insert',tableId:'libra_us_adult_actor_choice_heads',columns:['subject_id','current_revision','intent_id','record_digest']},
    advance_head:{kind:'update',tableId:'libra_us_adult_actor_choice_heads',setColumns:['current_revision','intent_id','record_digest'],
      keyColumns:['subject_id'],compareColumns:[{column:'current_revision',parameter:'expected_current_revision'},
        {column:'intent_id',parameter:'expected_intent_id'},{column:'record_digest',parameter:'expected_record_digest'}]},
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','execution_basis_digest','package_revision_head'],keyColumns:['libra_run_id']},
    list_runs:{kind:'select-all',tableId:'libra_runs',columns:['libra_run_id','state'],keyColumns:['subject_id']},
    find_subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','structure_kind','content_profile','status'],keyColumns:['subject_id']},
  }});
  const read=callback=>options.unitOfWork.execute([{participantId:'us_actor_choice_read',owner:'libra',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId))}]).us_actor_choice_read;
  function decode(row){
    if(!row)return null;let value;try{value=JSON.parse(row.record_json);}catch{fail('US_ADULT_ACTOR_CHOICE_CORRUPT','Actor choice JSON is invalid.');}
    options.contractValidator.validate(SCHEMA,value);assertRecord(value);
    if(row.record_schema_ref!==SCHEMA||canonicalJson(value)!==row.record_json||value.intentId!==row.intent_id||value.libraRunId!==row.libra_run_id||
      value.subjectId!==row.subject_id||value.revision!==row.choice_revision||value.personSnapshot.personId!==row.person_id||
      value.personSnapshot.personRevision!==row.person_revision||value.personSnapshot.referenceProjection.currentReferenceRevision!==row.reference_revision||
      value.actorId!==row.actor_id||value.idempotencyKey!==row.idempotency_key||value.requestDigest!==row.request_digest||value.recordDigest!==row.record_digest)
      fail('US_ADULT_ACTOR_CHOICE_CORRUPT','Actor choice index differs from the immutable record.');
    return freeze(value);
  }
  return Object.freeze({
    findCommand:(actorId,idempotencyKey)=>read(repo=>decode(repo.invoke('find_command',{actor_id:actorId,idempotency_key:idempotencyKey}))),
    get:intentId=>read(repo=>decode(repo.invoke('find_intent',{intent_id:intentId}))),
    current(subjectId){return read(repo=>{
      const head=repo.invoke('find_head',{subject_id:subjectId});if(!head)return null;
      const value=decode(repo.invoke('find_intent',{intent_id:head.intent_id}));
      if(!value||value.subjectId!==subjectId||value.revision!==head.current_revision||value.recordDigest!==head.record_digest)
        fail('US_ADULT_ACTOR_CHOICE_CORRUPT','Actor choice head differs from its immutable record.');
      return value;
    });},
    participant(decision){
      options.contractValidator.validate(DECISION_SCHEMA,decision);assertRecord(decision.record);
      const {decisionDigest,...body}=decision;
      if(decision.decisionId!==decision.record.intentId||canonicalDigest(body)!==decisionDigest)fail('US_ADULT_ACTOR_CHOICE_INVALID','Actor choice Decision digest changed.');
      return Object.freeze({participantId:'us_actor_choice_commit',owner:'libra',repositories:[repository],execute(context){
        const record=decision.record,repo=context.repository(repository.repositoryId),run=repo.invoke('find_run',{libra_run_id:record.libraRunId}),
          subject=repo.invoke('find_subject',{subject_id:record.subjectId}),head=repo.invoke('find_head',{subject_id:record.subjectId}),
          active=repo.invoke('list_runs',{subject_id:record.subjectId}).filter(item=>['active','suspended','frozen'].includes(item.state));
        if(!run||!subject||subject.status!=='active'||subject.content_profile!=='western_adult'||subject.structure_kind!=='single'||
          run.subject_id!==record.subjectId||!['active','suspended','frozen'].includes(run.state)||run.state_revision!==record.expectedRunStateRevision||
          run.execution_basis_digest!==record.runExecutionBasisDigest||active.length!==1||active[0].libra_run_id!==record.libraRunId)
          fail('US_ADULT_ACTOR_CHOICE_STALE','The current US Adult Subject or Run changed before actor confirmation.');
        if(run.package_revision_head>0)fail('US_ADULT_ACTOR_HANDOFF_CONFLICT','The film has entered delivery; re-read its current owner before changing the actor.');
        if((head?.current_revision||0)!==record.expectedChoiceRevision)fail('US_ADULT_ACTOR_CHOICE_STALE','Another actor choice changed the Subject choice version.');
        const person=record.personSnapshot;
        repo.invoke('insert_intent',{intent_id:record.intentId,libra_run_id:record.libraRunId,subject_id:record.subjectId,choice_revision:record.revision,
          person_id:person.personId,person_revision:person.personRevision,reference_revision:person.referenceProjection.currentReferenceRevision,
          actor_id:record.actorId,idempotency_key:record.idempotencyKey,request_digest:record.requestDigest,record_schema_ref:SCHEMA,
          record_json:canonicalJson(record),record_digest:record.recordDigest,created_at_ms:context.commitTimeMs});
        options.afterIntentInsert?.();
        const next={subject_id:record.subjectId,current_revision:record.revision,intent_id:record.intentId,record_digest:record.recordDigest};
        if(head){
          if(repo.invoke('advance_head',{...next,expected_current_revision:head.current_revision,expected_intent_id:head.intent_id,
            expected_record_digest:head.record_digest}).changes!==1)fail('US_ADULT_ACTOR_CHOICE_STALE','Actor choice head changed concurrently.');
        }else repo.invoke('insert_head',next);
        return {intentId:record.intentId,subjectId:record.subjectId,libraRunId:record.libraRunId,choiceRevision:record.revision,
          personId:person.personId,personRevision:person.personRevision,referenceRevision:person.referenceProjection.currentReferenceRevision,recordDigest:record.recordDigest};
      }});
    },
  });
}
module.exports=Object.freeze({createUsAdultActorChoiceStore});
