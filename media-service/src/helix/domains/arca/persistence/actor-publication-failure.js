'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const CODES=Object.freeze(['ARCA_US_ADULT_TARGET_CONFLICT','ARCA_US_ADULT_FILE_CHANGED','ARCA_US_ADULT_FILE_ESCAPE']);
function fail(){throw Object.assign(new Error('Actor publication failure lacks its exact closed no-write execution proof.'),{code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});}
function assertProof(binding,{caseId,intentDigest,shelfEntryId}){
  const {work,failure}=binding||{},evidence=failure?.evidence,proof=evidence?.diagnostics;
  if(!work||work.ownerDomain!=='arca'||work.processType!=='arca_shelf_entry'||work.processId!==shelfEntryId||
      work.workKind!=='us_adult_actor_publish'||work.executionBasisDigest!==intentDigest||
      !work.dependencyRefs.some(ref=>ref.ownerDomain==='arca'&&ref.objectType==='aftercare_case'&&ref.objectId===caseId)||
      !evidence||D(evidence)!==failure.evidenceDigest||!CODES.includes(failure.code)||
      proof?.schema!=='arca.actor-publication-precondition@1'||proof.aftercareCaseId!==caseId||proof.intentDigest!==intentDigest||
      proof.workId!==work.workId||proof.eventId!==failure.eventId||proof.errorCode!==failure.code||proof.effectWriteStarted!==false||
      proof.boundary!=='before_publication'||!(/^[a-f0-9]{64}$/).test(proof.planDigest))fail();
  return proof;
}
function failureParticipant(options,binding,scope){
  assertProof(binding,scope);
  const repository=createRepositoryDefinition({repositoryId:'arca_actor_failed_publication',owner:'execution-foundation',readOnly:true,
    schemaManifest:options.schemaManifest,statements:{
      work:{kind:'select-one',tableId:'fx_supporting_works',keyColumns:['work_id'],columns:['state','definition_json','definition_digest']},
      events:{kind:'select-all',tableId:'fx_workflow_events',keyColumns:['work_id'],columns:['event_id','capability_ref','state','result_id']},
      attempts:{kind:'select-all',tableId:'fx_event_attempts',keyColumns:['event_id'],columns:['event_attempt_id','ordinal','state','outcome_kind','failure_class','failure_code','evidence_digest']},
      result:{kind:'select-one',tableId:'fx_event_result_bindings',keyColumns:['event_id'],columns:['result_id','outcome_kind','result_schema_ref','result_json','result_digest']},
      effects:{kind:'select-all',tableId:'fx_effect_journal',keyColumns:['event_attempt_id'],columns:['effect_id','effect_class','state']},
    }});
  return {participantId:'arca_actor_failed_publication_proof',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repository],execute(context){
    const repo=context.repository(repository.repositoryId),{work,failure}=binding,row=repo.invoke('work',{work_id:work.workId}),
      events=repo.invoke('events',{work_id:work.workId});
    if(row?.state!=='failed'||row.definition_digest!==D(work)||row.definition_json!==canonicalJson(work)||events.length!==1)fail();
    const event=events[0],attempts=repo.invoke('attempts',{event_id:event.event_id});
    if(event.event_id!==failure.eventId||event.state!=='failed'||event.capability_ref!=='arca.us_adult.files.publish@1'||event.result_id!==null||attempts.length!==1)fail();
    const attempt=attempts[0],effects=repo.invoke('effects',{event_attempt_id:attempt.event_attempt_id});
    if(Number(attempt.ordinal)!==1||attempt.state!=='completed'||attempt.outcome_kind!=='failed'||attempt.failure_class!=='placement_precondition'||
        attempt.failure_code!==failure.code||attempt.evidence_digest!==failure.evidenceDigest||effects.length!==1||
        effects[0].effect_class!=='material_commit'||effects[0].state!=='failed')fail();
    const discard=binding.discardWork,record=binding.discardRecord,value=record?.result,
      actual=discard&&repo.invoke('work',{work_id:discard.workId}),discardEvents=discard?repo.invoke('events',{work_id:discard.workId}):[];
    if(discard?.workKind!=='us_adult_actor_discard'||discard.ownerDomain!=='arca'||discard.processType!=='arca_shelf_entry'||
        discard.processId!==scope.shelfEntryId||discard.executionBasisDigest!==scope.intentDigest||actual?.state!=='succeeded'||
        actual.definition_digest!==D(discard)||actual.definition_json!==canonicalJson(discard)||discardEvents.length!==1||
        !discard.dependencyRefs.some(ref=>ref.objectType==='failed_actor_publication'&&ref.objectId===work.workId&&ref.digest===failure.evidenceDigest)||
        !discard.dependencyRefs.some(ref=>ref.objectType==='aftercare_case'&&ref.objectId===scope.caseId)||
        record?.workId!==discard.workId||record.outcomeKind!=='succeeded'||record.capabilityRef!=='arca.us_adult.files.retire@1'||
        record.resultSchemaRef!=='helix://contracts/capabilities/arca.us_adult.files.retire/v1/result'||
        value?.aftercareCaseId!==scope.caseId||value.intentDigest!==scope.intentDigest||value.action!=='discard'||
        value.producerRef!==record.capabilityRef||value.planDigest!==failure.evidence.diagnostics.planDigest||
        value.receipt?.schema!=='arca.us-adult-discarded-stage@1'||value.receipt.aftercareCaseId!==scope.caseId||
        value.receipt.planDigest!==value.planDigest||value.receiptDigest!==D(value.receipt)||record.resultDigest!==D(value))fail();
    const discardEvent=discardEvents[0],stored=repo.invoke('result',{event_id:discardEvent.event_id}),
      discardedAttempts=repo.invoke('attempts',{event_id:discardEvent.event_id}),successful=discardedAttempts.filter(item=>item.state==='completed'&&item.outcome_kind==='succeeded');
    if(discardEvent.event_id!==record.eventId||discardEvent.state!=='succeeded'||discardEvent.capability_ref!==record.capabilityRef||
        discardEvent.result_id!==record.resultId||stored?.result_id!==record.resultId||stored.outcome_kind!=='succeeded'||
        stored.result_schema_ref!==record.resultSchemaRef||stored.result_digest!==record.resultDigest||D(JSON.parse(stored.result_json))!==record.resultDigest||
        successful.length!==1||discardedAttempts.some(item=>item.state!=='completed'||!['failed','succeeded'].includes(item.outcome_kind)))fail();
    for(const item of discardedAttempts){const effects=repo.invoke('effects',{event_attempt_id:item.event_attempt_id});
      if(effects.length!==1||effects[0].effect_class!=='material_commit'||!['committed','failed'].includes(effects[0].state)||
          item.outcome_kind==='succeeded'&&effects[0].state!=='committed')fail();
    }
    return {evidenceDigest:failure.evidenceDigest,discardResultDigest:record.resultDigest};
  }};
}
module.exports=Object.freeze({assertProof,failureParticipant});
