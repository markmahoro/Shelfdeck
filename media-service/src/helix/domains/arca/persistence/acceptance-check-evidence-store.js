'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createDomainCommitCoordinator,createDomainCommitRegistry,createCanonicalTransactionRegistry}=require('../../../foundation/persistence/domain-commit-registry');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const CHECK='helix://contracts/types/AcceptanceCheck/v1';
const RECORD='helix://contracts/types/AcceptanceCheckRecord/v1';
const columns=['acceptance_attempt_id','check_kind','check_revision','offer_id','package_digest','work_id','event_id',
  'evidence_schema_ref','evidence_json','evidence_digest','record_schema_ref','record_json','record_digest','commit_marker','committed_at_ms'];
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});}
function recordFor(check,revision){const value={schemaRef:RECORD,schemaVersion:1,acceptanceAttemptId:check.acceptanceAttemptId,
  checkKind:check.checkKind,checkRevision:revision,checkDigest:canonicalDigest(check)};
  return Object.freeze({...value,recordDigest:canonicalDigest(value)});}
function unpack(row,expected){
  if(!row||row.evidence_schema_ref!==CHECK||row.record_schema_ref!==RECORD)fail('Exact Acceptance Evidence is absent.');
  const check=JSON.parse(row.evidence_json),record=JSON.parse(row.record_json);
  if(Buffer.byteLength(row.evidence_json)>2*1024*1024||Buffer.byteLength(row.record_json)>65536||
      check.schemaRef!==CHECK||check.acceptanceAttemptId!==row.acceptance_attempt_id||check.checkKind!==row.check_kind||
      check.packageDigest!==row.package_digest||canonicalDigest(check)!==row.evidence_digest||
      canonicalJson(recordFor(check,Number(row.check_revision)))!==canonicalJson(record)||canonicalDigest(record)!==row.record_digest||
      expected&&canonicalJson(expected)!==canonicalJson(record))fail('Acceptance Evidence reference or complete digest drifted.');
  return Object.freeze({check:Object.freeze(check),record:Object.freeze(record),committedAtMs:Number(row.committed_at_ms)});
}

function createAcceptanceCheckEvidenceStore(options){
  const repository=createRepositoryDefinition({repositoryId:'arca_acceptance_check_evidence',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'arca_acceptance_check_evidence',columns,keyColumns:['acceptance_attempt_id','check_kind','check_revision']},
    event:{kind:'select-one',tableId:'arca_acceptance_check_evidence',columns,keyColumns:['event_id']},
    revisions:{kind:'select-all',tableId:'arca_acceptance_check_evidence',columns:['check_revision'],keyColumns:['acceptance_attempt_id','check_kind']},
    insert:{kind:'insert',tableId:'arca_acceptance_check_evidence',columns}}});
  const foundation=createRepositoryDefinition({repositoryId:'arca_check_event_fence',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','state'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['event_id','work_id','owner_domain','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','state'],keyColumns:['event_attempt_id']}}});
  const read=(operation,args)=>options.unitOfWork.execute([{participantId:'arca_check_evidence_read',owner:'arca',repositories:[repository],
    execute:ctx=>ctx.repository(repository.repositoryId).invoke(operation,args)}]).arca_check_evidence_read;
  function readEvent(eventId){const row=read('event',{event_id:eventId});return row?unpack(row):null;}
  function resolve(record){return unpack(read('find',{acceptance_attempt_id:record.acceptanceAttemptId,check_kind:record.checkKind,
    check_revision:record.checkRevision}),record).check;}
  function commit(execution,offer,check){
    options.contractValidator.validate(CHECK,check);
    if(execution.capabilityRef!=='arca.acceptance.'+check.checkKind+'.verify@1')
      fail('Acceptance Evidence kind does not match the executing Capability.');
    if(Buffer.byteLength(canonicalJson(check))>2*1024*1024||check.packageDigest!==offer.packageDigest||
        execution.ownerScope.processType!=='arca_acceptance'||execution.ownerScope.processId!==offer.offerId)
      fail('Acceptance Evidence exceeds its scope or byte bound.');
    const prior=readEvent(execution.eventId);
    if(prior){if(canonicalJson(prior.check)!==canonicalJson(check))fail('Event already committed different Acceptance Evidence.');return prior;}
    const args={acceptance_attempt_id:check.acceptanceAttemptId,check_kind:check.checkKind};
    const current=Math.max(0,...read('revisions',args).map(row=>Number(row.check_revision))),record=recordFor(check,current+1);
    const payload={check,offerId:offer.offerId,workId:execution.workId,eventId:execution.eventId,eventAttemptId:execution.eventAttemptId};
    const aggregateId=canonicalDigest(args),fence=canonicalDigest({workId:execution.workId,eventId:execution.eventId});
    const handle={schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,ownerDomain:'arca',
      aggregateType:'arca_acceptance_check',aggregateId,factType:'acceptance_check_evidence',factSchemaRef:CHECK,resultSchemaRef:RECORD,
      expectedRevision:current,payloadDigest:canonicalDigest(payload),eventFenceDigest:fence,
      commitIdempotencyKey:execution.idempotencyKey,handleId:canonicalDigest({aggregateId,eventId:execution.eventId,current})};
    const marker=stable('arca-effect-marker-',{eventId:execution.eventId});
    const registration={ownerDomain:'arca',aggregateType:handle.aggregateType,factType:handle.factType,factSchemaRef:CHECK,
      effectClass:'domain_fact_commit',revisionFence:true,createParticipant(){
        const participant={participantId:'arca_check_evidence_prepare',owner:'arca',boundBusinessOwner:'arca',repositories:[repository],execute(ctx){
          const r=ctx.repository(repository.repositoryId),latest=Math.max(0,...r.invoke('revisions',args).map(row=>Number(row.check_revision)));
          if(latest!==current||r.invoke('event',{event_id:execution.eventId}))fail('Acceptance Evidence revision changed concurrently.');
          return record;
        }};
        participant.readParticipants=[{participantId:'arca_check_evidence_event_fence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(ctx){
          const r=ctx.repository(foundation.repositoryId),work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),
            attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
          if(work?.owner_domain!=='arca'||work.process_type!=='arca_acceptance'||work.process_id!==offer.offerId||work.state!=='running'||
              event?.owner_domain!=='arca'||event.work_id!==execution.workId||event.state!=='executing'||event.capability_ref!==execution.capabilityRef||
              attempt?.event_id!==execution.eventId||attempt.state!=='executing')fail('Acceptance Evidence execution fence is invalid.');
        }}];
        participant.postMarkerParticipants=[{participantId:'arca_check_evidence_write',owner:'arca',boundBusinessOwner:'arca',repositories:[repository],execute(ctx){
          ctx.repository(repository.repositoryId).invoke('insert',{...args,check_revision:current+1,offer_id:offer.offerId,package_digest:offer.packageDigest,
            work_id:execution.workId,event_id:execution.eventId,evidence_schema_ref:CHECK,evidence_json:canonicalJson(check),evidence_digest:canonicalDigest(check),
            record_schema_ref:RECORD,record_json:canonicalJson(record),record_digest:canonicalDigest(record),commit_marker:marker,committed_at_ms:ctx.commitTimeMs});
        }}];return participant;
      }};
    createDomainCommitCoordinator({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,
      registry:createDomainCommitRegistry({registrations:[registration]}),transactionRegistry:createCanonicalTransactionRegistry({contracts:[transaction]})}).execute({
      transactionId:'helix.transaction.domain-fact-commit',handle,payload,supportingWorkId:execution.workId,outboxMessages:[],
      commitMarker:{commitMarker:marker,effectId:canonicalDigest(['domain_fact_commit',execution.idempotencyKey]),commitDigest:canonicalDigest(record)},
      resultBinding:{resultId:stable('arca-check-result-',{eventId:execution.eventId}),eventId:execution.eventId,
        evidenceSchemaRef:RECORD,evidence:record,effectReceiptId:stable('arca-effect-receipt-',{eventId:execution.eventId})}});
    return readEvent(execution.eventId);
  }
  return Object.freeze({readEvent,resolve,commit});
}

function resolveAcceptanceResult(options,value){
  if(value?.schemaRef===RECORD)return createAcceptanceCheckEvidenceStore(options).resolve(value);
  if(value?.schemaRef===CHECK)fail('Acceptance execution requires an immutable Owner Evidence reference.');
  return value;
}
module.exports=Object.freeze({CHECK,RECORD,recordFor,unpack,createAcceptanceCheckEvidenceStore,resolveAcceptanceResult});
