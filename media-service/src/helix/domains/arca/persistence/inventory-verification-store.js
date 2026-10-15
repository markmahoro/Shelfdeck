'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createDomainCommitCoordinator,createDomainCommitRegistry,createCanonicalTransactionRegistry}=require('../../../foundation/persistence/domain-commit-registry');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const types=Object.freeze([
  {kind:'final_product',name:'FinalProductVerification',capability:'arca.inventory.final_product.verify@1'},
  {kind:'on_deck_fulfillment',name:'FulfillmentVerification',capability:'arca.ondeck.fulfillment.verify@1'},
].map(type=>Object.freeze({...type,schema:'helix://contracts/types/'+type.name+'/v1',record:'helix://contracts/types/'+type.name+'Record/v1'})));
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});}
function recordFor(execution,value){
  const type=types.find(item=>item.schema===value.schemaRef);if(!type)fail('Inventory Verification type is not registered.');
  const body={schemaRef:type.record,schemaVersion:1,recordId:canonicalDigest({schema:'arca.inventory-verification-record@1',eventId:execution.eventId}),
    processType:execution.ownerScope.processType,processId:execution.ownerScope.processId,verificationId:value.verificationId,
    verificationDigest:canonicalDigest(value),memberCount:value.memberEvidence.length};
  return Object.freeze({...body,recordDigest:canonicalDigest(body)});
}
function unpack(row,expected){
  const type=types.find(item=>item.schema===row?.verification_schema_ref&&item.record===row?.record_schema_ref);
  if(!type)fail('Exact Inventory Verification is absent.');
  const value=JSON.parse(row.verification_json),record=JSON.parse(row.record_json),execution={eventId:row.event_id,
    ownerScope:{processType:row.process_type,processId:row.process_id}};
  if(Buffer.byteLength(row.verification_json)>8*1024*1024||Buffer.byteLength(row.record_json)>65536||
      value.schemaRef!==type.schema||value.verificationKind!==type.kind||row.verification_kind!==type.kind||
      !Array.isArray(value.memberEvidence)||value.memberEvidence.length<1||value.memberEvidence.length>1024||
      canonicalDigest(value)!==row.verification_digest||canonicalJson(recordFor(execution,value))!==canonicalJson(record)||
      record.recordId!==row.record_id||canonicalDigest(record)!==row.record_digest||expected&&canonicalJson(record)!==canonicalJson(expected))
    fail('Complete Inventory Verification or reference digest drifted.');
  return Object.freeze({value:Object.freeze(value),record:Object.freeze(record),committedAtMs:Number(row.committed_at_ms)});
}
function createInventoryVerificationStore(options){
  const columns=['record_id','work_id','event_id','process_type','process_id','verification_kind','verification_schema_ref','verification_json',
    'verification_digest','record_schema_ref','record_json','record_digest','commit_marker','committed_at_ms'];
  const repo=createRepositoryDefinition({repositoryId:'arca_inventory_verification_records',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'arca_inventory_verification_records',columns,keyColumns:['record_id']},
    event:{kind:'select-one',tableId:'arca_inventory_verification_records',columns,keyColumns:['event_id']},
    insert:{kind:'insert',tableId:'arca_inventory_verification_records',columns}}});
  const correctionFence=createRepositoryDefinition({repositoryId:'arca_verification_correction_fence',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns:['correction_id','shelf_entry_id','state','state_revision','admission_digest','basis_digest','terminal_at_ms',
      'recovery_intent_schema_ref','recovery_intent_json','recovery_intent_digest'],keyColumns:['correction_id'],safeIntegers:true}}});
  const fence=createRepositoryDefinition({repositoryId:'arca_verification_execution',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']}}});
  const read=(op,args)=>options.unitOfWork.execute([{participantId:'arca_verification_read',owner:'arca',repositories:[repo],
    execute:c=>c.repository(repo.repositoryId).invoke(op,args)}]).arca_verification_read;
  const readEvent=eventId=>{const row=read('event',{event_id:eventId});return row?unpack(row):null;};
  const resolve=record=>unpack(read('find',{record_id:record.recordId}),record).value;
  function commit(execution,value){
    const correction=execution.capabilityRef==='arca.jav_correction.files.verify@1'&&execution.ownerScope.processType==='arca_jav_identity_correction',
      type=types.find(item=>item.schema===value.schemaRef&&(item.capability===execution.capabilityRef||correction&&item.kind==='final_product'));
    if(!type||type.kind!==value.verificationKind||!correction&&!['arca_ondeck_run','arca_shelf_entry'].includes(execution.ownerScope.processType))
      fail('Inventory Verification is outside its executing Owner scope.');
    options.contractValidator.validate(type.schema,value);
    if(Buffer.byteLength(canonicalJson(value))>8*1024*1024||value.memberEvidence.length<1||value.memberEvidence.length>1024)
      fail('Complete Inventory Verification exceeds its byte or member bound.');
    const record=recordFor(execution,value);options.contractValidator.validate(type.record,record);
    const prior=readEvent(execution.eventId);
    if(prior){if(canonicalJson(prior.record)!==canonicalJson(record))fail('Event already committed another Inventory Verification.');return prior;}
    const payload={value,workId:execution.workId,eventId:execution.eventId,eventAttemptId:execution.eventAttemptId},
      handle={schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,ownerDomain:'arca',aggregateType:'arca_inventory_verification',
        aggregateId:record.recordId,factType:'inventory_verification',factSchemaRef:type.schema,resultSchemaRef:type.record,expectedRevision:0,
        payloadDigest:canonicalDigest(payload),eventFenceDigest:canonicalDigest({workId:execution.workId,eventId:execution.eventId}),
        commitIdempotencyKey:execution.idempotencyKey,handleId:record.recordId},marker=stable('arca-effect-marker-',{eventId:execution.eventId});
    const registration={ownerDomain:'arca',aggregateType:handle.aggregateType,factType:handle.factType,factSchemaRef:type.schema,
      effectClass:'domain_fact_commit',revisionFence:true,createParticipant(){
        const participant={participantId:'arca_verification_prepare',owner:'arca',boundBusinessOwner:'arca',repositories:[repo],execute(c){
          const r=c.repository(repo.repositoryId);
          if(r.invoke('event',{event_id:execution.eventId}))fail('Inventory Verification Event already committed.');
          return record;}};
        participant.readParticipants=[{participantId:'arca_verification_fence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[fence],execute(c){
          const r=c.repository(fence.repositoryId),work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),
            attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
          if(work?.owner_domain!=='arca'||work.process_type!==execution.ownerScope.processType||work.process_id!==execution.ownerScope.processId||
              work.state!=='running'||event?.work_id!==execution.workId||event.capability_ref!==execution.capabilityRef||event.state!=='executing'||
              attempt?.event_id!==execution.eventId||attempt.state!=='executing')fail('Inventory Verification execution fence changed.');
        }},...(correction?[{participantId:'arca_verification_correction_fence',owner:'arca',boundBusinessOwner:'arca',repositories:[correctionFence],execute(c){
          const scope=execution.namedInputs?.javCorrectionScope,current=c.repository(correctionFence.repositoryId).invoke('correction',{correction_id:execution.ownerScope.processId});
          if(!scope||scope.correctionId!==execution.ownerScope.processId||!current||current.state!=='active'||current.terminal_at_ms!==null||
              require('../model/jav-correction-recovery').executionRevisionForRow(current,options.contractValidator)!==scope.expectedStateRevision||current.admission_digest!==scope.admissionDigest||current.basis_digest!==scope.basisDigest||value.basisDigest!==scope.digest)
            fail('Correction final Verification lost its actual active admission.');
        }}]:[])];
        participant.postMarkerParticipants=[{participantId:'arca_verification_write',owner:'arca',boundBusinessOwner:'arca',repositories:[repo],execute(c){
          c.repository(repo.repositoryId).invoke('insert',{record_id:record.recordId,work_id:execution.workId,event_id:execution.eventId,
            process_type:execution.ownerScope.processType,process_id:execution.ownerScope.processId,verification_kind:type.kind,
            verification_schema_ref:type.schema,verification_json:canonicalJson(value),verification_digest:canonicalDigest(value),
            record_schema_ref:type.record,record_json:canonicalJson(record),record_digest:canonicalDigest(record),commit_marker:marker,committed_at_ms:c.commitTimeMs});
        }}];return participant;
      }};
    createDomainCommitCoordinator({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,
      registry:createDomainCommitRegistry({registrations:[registration]}),transactionRegistry:createCanonicalTransactionRegistry({contracts:[transaction]})}).execute({
      transactionId:'helix.transaction.domain-fact-commit',handle,payload,supportingWorkId:execution.workId,outboxMessages:[],
      commitMarker:{commitMarker:marker,effectId:canonicalDigest(['domain_fact_commit',execution.idempotencyKey]),commitDigest:canonicalDigest(record)},
      resultBinding:{resultId:stable('arca-verification-result-',{eventId:execution.eventId}),eventId:execution.eventId,
        evidenceSchemaRef:type.record,evidence:record,effectReceiptId:stable('arca-effect-receipt-',{eventId:execution.eventId})}});
    return readEvent(execution.eventId);
  }
  return Object.freeze({readEvent,resolve,commit});
}
function resolveInventoryVerification(options,value){return types.some(type=>type.record===value?.schemaRef)?createInventoryVerificationStore(options).resolve(value):value;}
module.exports=Object.freeze({types,recordFor,unpack,createInventoryVerificationStore,resolveInventoryVerification});
