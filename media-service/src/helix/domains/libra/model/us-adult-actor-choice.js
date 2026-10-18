'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const SCHEMA='helix://contracts/domain-types/UsAdultActorChoiceRecord/v1';
const DECISION_SCHEMA='helix://contracts/domain-types/UsAdultActorChoiceDecision/v1';
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_ACTOR_CHOICE_INVALID'});}
function intentId({libraRunId,actorId,idempotencyKey}){
  return canonicalDigest({schema:'libra.us-adult-actor-choice-id@1',libraRunId,actorId,idempotencyKey});
}
function assertRecord(record){
  const {recordDigest,...body}=record||{},snapshot=record?.personSnapshot,{snapshotDigest,...person}=snapshot||{};
  if(record?.schemaRef!==SCHEMA||record.schemaVersion!==1||record.intentId!==intentId(record)||record.recordDigest!==canonicalDigest(body)||
    record.revision!==record.expectedChoiceRevision+1||!Number.isSafeInteger(record.revision)||record.revision<1||
    snapshot?.libraryKind!=='us_adult'||snapshot.schemaRef!=='helix://contracts/domain-types/UsAdultPersonSnapshot/v1'||
    canonicalDigest(person)!==snapshotDigest||snapshot.referenceProjection.personId!==snapshot.personId||
    snapshot.referenceProjection.personRevision!==snapshot.personRevision||!snapshot.referenceProjection.currentReferenceRevision||
    Buffer.byteLength(canonicalJson(record),'utf8')>256*1024)fail('The actor choice must freeze one exact usable US Person and both expected revisions.');
  return record;
}
function buildRecord({snapshot,personSnapshot,body,actorId}){
  if(personSnapshot?.personId!==body.personId||personSnapshot.personRevision!==body.expectedPersonRevision||
    personSnapshot.referenceProjection?.currentReferenceRevision!==body.expectedReferenceRevision)
    fail('The formal People snapshot differs from the explicit actor and revision request.');
  const requestDigest=canonicalDigest({libraRunId:snapshot.run.libraRunId,...body}),value={schemaRef:SCHEMA,schemaVersion:1,
    intentId:intentId({libraRunId:snapshot.run.libraRunId,actorId,idempotencyKey:body.idempotencyKey}),libraRunId:snapshot.run.libraRunId,
    subjectId:snapshot.run.subjectId,revision:body.expectedChoiceRevision+1,expectedChoiceRevision:body.expectedChoiceRevision,
    expectedRunStateRevision:body.expectedRunStateRevision,runExecutionBasisDigest:snapshot.run.executionBasisDigest,actorId,
    idempotencyKey:body.idempotencyKey,requestDigest,personSnapshot};
  return Object.freeze(assertRecord({...value,recordDigest:canonicalDigest(value)}));
}
function decision(record){assertRecord(record);const value={decisionId:record.intentId,record};return Object.freeze({...value,decisionDigest:canonicalDigest(value)});}
module.exports=Object.freeze({SCHEMA,DECISION_SCHEMA,intentId,assertRecord,buildRecord,decision});
