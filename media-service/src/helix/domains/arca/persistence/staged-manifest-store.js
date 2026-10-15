'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const MANIFEST='helix://contracts/types/StagedInventoryManifest/v1';
const RECORD='helix://contracts/types/StagedInventoryManifestRecord/v1';
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_STAGED_MANIFEST_INTEGRITY'});}
function validateManifest(manifest){
  const {manifestDigest,...body}=manifest;
  if(manifest.ownerDomain!=='arca'||manifest.manifestKind!=='staged_inventory'||!Array.isArray(manifest.stagedMembers)||
      manifest.memberCount!==manifest.stagedMembers.length||manifest.memberCount<1||manifest.memberCount>1024||
      manifest.membersDigest!==canonicalDigest({schema:'arca.staged-inventory-members@1',items:manifest.stagedMembers})||
      manifestDigest!==canonicalDigest(body))fail('Complete staged Manifest semantic digest is invalid.');
}
function recordFor(eventId,manifest){const body={schemaRef:RECORD,schemaVersion:1,
  recordId:canonicalDigest({schema:'arca.staged-manifest-record@1',eventId}),manifestId:manifest.manifestId,
  manifestDigest:manifest.manifestDigest,completeValueDigest:canonicalDigest(manifest),memberCount:manifest.stagedMembers.length};
  return Object.freeze({...body,recordDigest:canonicalDigest(body)});}
function unpack(row,expected){
  if(!row||row.manifest_schema_ref!==MANIFEST||row.record_schema_ref!==RECORD)fail('Exact staged Manifest record is absent.');
  const manifest=JSON.parse(row.manifest_json),record=JSON.parse(row.record_json);
  validateManifest(manifest);
  if(Buffer.byteLength(row.manifest_json)>8*1024*1024||Buffer.byteLength(row.record_json)>65536||
      manifest.schemaRef!==MANIFEST||manifest.targetCommitSlotId!==row.target_commit_slot_id||
      manifest.manifestDigest!==row.manifest_digest||canonicalDigest(manifest)!==row.complete_value_digest||
      !Array.isArray(manifest.stagedMembers)||manifest.stagedMembers.length<1||manifest.stagedMembers.length>1024||
      canonicalJson(recordFor(row.event_id,manifest))!==canonicalJson(record)||record.recordId!==row.record_id||
      canonicalDigest(record)!==row.record_digest||expected&&canonicalJson(record)!==canonicalJson(expected))
    fail('Complete staged Manifest or reference digest drifted.');
  return Object.freeze({manifest:Object.freeze(manifest),record:Object.freeze(record)});
}
function createStagedManifestStore(options){
  const columns=['record_id','work_id','event_id','process_type','process_id','target_commit_slot_id','manifest_schema_ref','manifest_json',
    'manifest_digest','complete_value_digest','record_schema_ref','record_json','record_digest','created_at_ms'];
  const repo=createRepositoryDefinition({repositoryId:'arca_staged_manifest_records',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'arca_staged_manifest_records',columns,keyColumns:['record_id']},
    event:{kind:'select-one',tableId:'arca_staged_manifest_records',columns,keyColumns:['event_id']},
    correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns:['correction_id','shelf_entry_id','state','state_revision','admission_digest','basis_digest','terminal_at_ms',
      'recovery_intent_schema_ref','recovery_intent_json','recovery_intent_digest'],keyColumns:['correction_id'],safeIntegers:true},
    insert:{kind:'insert',tableId:'arca_staged_manifest_records',columns}}});
  const fence=createRepositoryDefinition({repositoryId:'arca_stage_record_execution',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']}}});
  function resolve(record){const row=options.unitOfWork.execute([{participantId:'arca_stage_read',owner:'arca',repositories:[repo],
    execute:c=>c.repository(repo.repositoryId).invoke('find',{record_id:record.recordId})}]).arca_stage_read;
    return unpack(row,record).manifest;}
  function save(execution,manifest,correctionPlan=null){
    options.contractValidator.validate(MANIFEST,manifest);
    validateManifest(manifest);
    const correction=execution.ownerScope.processType==='arca_jav_identity_correction'&&execution.capabilityRef==='arca.jav_correction.files.stage@1';
    if(Buffer.byteLength(canonicalJson(manifest))>8*1024*1024||manifest.stagedMembers.length<1||manifest.stagedMembers.length>1024||
        !correction&&(!['arca_ondeck_run','arca_shelf_entry'].includes(execution.ownerScope.processType)||execution.capabilityRef!=='arca.inventory.product.stage@1'))
      fail('Stage Manifest exceeds the exact execution scope or bound.');
    if(correction) {
      const {planDigest,...body}=correctionPlan||{};
      if(!correctionPlan||planDigest!==canonicalDigest(body)||correctionPlan.correctionId!==execution.ownerScope.processId||
          execution.namedInputs?.javCorrectionScope?.correctionId!==correctionPlan.correctionId||execution.namedInputs.javCorrectionScope.digest!==correctionPlan.scopeDigest||
          manifest.sourceProductManifestDigest!==planDigest||manifest.memberCount!==correctionPlan.members.length||
          manifest.targetCommitSlotId!=='arca-jav-correction-slot-'+canonicalDigest({correctionId:correctionPlan.correctionId,planDigest}).slice(0,40))
        fail('Correction staged Manifest differs from its exact Scope and File Plan.');
      if(manifest.stagedMembers.some((member,index)=>{
        const planned=correctionPlan.members[index],replacement=planned.source.kind==='correction_artifact',
          sourceKey=replacement?planned.source.workspaceMaterialHandle.materialKey:planned.original.physicalIdentity.materialKey;
        return member.sourceMaterialKey!==sourceKey||member.role!==planned.role||member.endpointId!==correctionPlan.target.endpointId||
          !/^[a-f0-9]{64}$/.test(member.fullByteDigest||'')||member.physicalIdentity.sizeBytes!==(replacement?planned.source.workspaceMaterialHandle.sizeBytes:planned.original.physicalIdentity.sizeBytes)||
          replacement&&member.fullByteDigest!==planned.source.workspaceMaterialHandle.digestHex;
      }))fail('Correction stage must retain complete ordered source and full-byte proof.');
    } else if(execution.namedInputs?.targetCommitSlotHandle?.slotId!==manifest.targetCommitSlotId)
      fail('Stage Manifest does not match the frozen Target Slot input.');
    const record=recordFor(execution.eventId,manifest);
    return options.unitOfWork.execute([{participantId:'arca_stage_record_fence',owner:'execution-foundation',repositories:[fence],execute(c){
      const r=c.repository(fence.repositoryId),work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),
        attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
      if(work?.owner_domain!=='arca'||work.process_type!==execution.ownerScope.processType||work.process_id!==execution.ownerScope.processId||
          work.state!=='running'||event?.work_id!==execution.workId||event.capability_ref!==execution.capabilityRef||event.state!=='executing'||
          attempt?.event_id!==execution.eventId||attempt.state!=='executing')fail('Stage Manifest execution fence changed.');
    }},{participantId:'arca_stage_record_save',owner:'arca',repositories:[repo],execute(c){
      const r=c.repository(repo.repositoryId),old=r.invoke('event',{event_id:execution.eventId});
      if(correction) {
        const current=r.invoke('correction',{correction_id:correctionPlan.correctionId}),scope=execution.namedInputs.javCorrectionScope;
        if(!current||current.state!=='active'||current.terminal_at_ms!==null||require('../model/jav-correction-recovery').executionRevisionForRow(current,options.contractValidator)!==scope.expectedStateRevision||
            current.admission_digest!==correctionPlan.admissionDigest||current.basis_digest!==correctionPlan.basisDigest)
          fail('Correction stage lost its active admission before durable Manifest recording.');
      }
      if(old){if(old.work_id!==execution.workId||old.process_type!==execution.ownerScope.processType||old.process_id!==execution.ownerScope.processId)
        fail('Stage replay scope changed.');unpack(old,record);return record;}
      r.invoke('insert',{record_id:record.recordId,work_id:execution.workId,event_id:execution.eventId,process_type:execution.ownerScope.processType,
        process_id:execution.ownerScope.processId,target_commit_slot_id:manifest.targetCommitSlotId,manifest_schema_ref:MANIFEST,
        manifest_json:canonicalJson(manifest),manifest_digest:manifest.manifestDigest,complete_value_digest:canonicalDigest(manifest),
        record_schema_ref:RECORD,record_json:canonicalJson(record),record_digest:canonicalDigest(record),created_at_ms:c.commitTimeMs});return record;
    }}]).arca_stage_record_save;
  }
  return Object.freeze({resolve,save});
}
function resolveStagedResult(options,value){return value?.schemaRef===RECORD?createStagedManifestStore(options).resolve(value):value;}
function stagedResultReader(options){return Object.freeze({...options.workResultReader,read(workId){return options.workResultReader.read(workId)
  .map(row=>({...row,result:resolveStagedResult(options,row.result)}));}});}
module.exports=Object.freeze({MANIFEST,RECORD,recordFor,unpack,createStagedManifestStore,resolveStagedResult,stagedResultReader});
