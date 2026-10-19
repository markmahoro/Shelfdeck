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
    return {evidenceDigest:failure.evidenceDigest};
  }};
}
module.exports=Object.freeze({assertProof,failureParticipant});
