'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createMaterialControlAdmissionReadParticipant}=require('../../../foundation/persistence/material-control');
const {SCHEMA}=require('../model/jav-correction-cleanup-receipt');
const {RESULT_SCHEMA:FORMAL_SCHEMA,CAPABILITY:FORMAL_CAPABILITY}=require('../model/jav-correction-retirement-contract');
const {RESULT_SCHEMA:WORKSPACE_SCHEMA,CAPABILITY:WORKSPACE_CAPABILITY,workspaceReclaimOutcome}=require('../model/jav-correction-workspace-reclaim-contract');
const COMMIT_SCHEMA='helix://contracts/types/JavCorrectionCommitReceipt/v1',COMMIT_CAPABILITY='arca.jav_correction.inventory.commit@1';
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_JAV_CORRECTION_CLEANUP_INTEGRITY'});};
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function createJavCorrectionCleanupStore(options){
  const define=(repositoryId,owner,statements)=>createRepositoryDefinition({repositoryId,owner,schemaManifest:options.schemaManifest,statements}),
    arca=define('arca_jav_cleanup_owner','arca',{
      seed_directory:require('./jav-correction-directory-store').seedStatement,
      directory:{kind:'select-one',tableId:'arca_jav_correction_directory_checks',columns:['shelf_entry_id','committed_context_digest','cleanup_receipt_digest','created_at_ms'],keyColumns:['correction_id'],safeIntegers:true},
      correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns:['correction_id','shelf_entry_id','state','state_revision','admission_digest','committed_context_schema_ref',
        'committed_context_json','committed_context_digest','cleanup_state','cleanup_receipt_schema_ref','cleanup_receipt_json','cleanup_receipt_digest'],keyColumns:['correction_id'],safeIntegers:true},
      entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_id','status','canonical_identity_revision','current_inventory_revision'],keyColumns:['shelf_entry_id'],safeIntegers:true},
      shelf:{kind:'select-one',tableId:'arca_shelves',columns:['status'],keyColumns:['shelf_id']},
      identity:{kind:'select-one',tableId:'arca_canonical_identity_revisions',columns:['identity_digest'],keyColumns:['shelf_entry_id','revision']},
      inventory:{kind:'select-one',tableId:'arca_inventory_representations',columns:['representation_digest'],keyColumns:['shelf_entry_id','revision']},
      original_commit:require('./inventory-context-statements').find_ondeck_commit,
      complete:{kind:'update',tableId:'arca_jav_identity_corrections',setColumns:['cleanup_state','cleanup_receipt_schema_ref','cleanup_receipt_json','cleanup_receipt_digest','updated_at_ms'],
        keyColumns:['correction_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'cleanup_state',parameter:'expected_cleanup_state'},
          {column:'state_revision',parameter:'expected_state_revision'},{column:'committed_context_digest',parameter:'expected_context_digest'}]},
    }),foundation=define('arca_jav_cleanup_execution','execution-foundation',{
      work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','work_kind','basis_digest','state'],keyColumns:['work_id']},
      event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state','result_id'],keyColumns:['event_id']},
      attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id'],keyColumns:['event_attempt_id']},
      effect:{kind:'select-one',tableId:'fx_effect_journal',columns:['event_attempt_id','effect_class','idempotency_key','state','output_digest'],keyColumns:['effect_id']},
      result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref',
        'evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'],keyColumns:['event_id'],safeIntegers:true},
      marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'],keyColumns:['commit_marker'],safeIntegers:true},
      registry:{kind:'select-one',tableId:'fx_workspace_registry',columns:['owner_domain','process_type','process_id','root_handle_ref','state','reclaimed_at_ms'],keyColumns:['workspace_id'],safeIntegers:true},
      materials:{kind:'select-all',tableId:'fx_workspace_materials',columns:['material_handle_id','owner_domain','process_id','handle_json','handle_digest','fence_digest','state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'],keyColumns:['workspace_id'],safeIntegers:true},
      artifacts:{kind:'select-all',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm',
        'digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state'],
        keyColumns:['owner_domain','owner_scope_type','owner_scope_id'],safeIntegers:true},
    });
  function proof(repo,ref,capability,record){
    const schemas={[COMMIT_CAPABILITY]:COMMIT_SCHEMA,[FORMAL_CAPABILITY]:FORMAL_SCHEMA,[WORKSPACE_CAPABILITY]:WORKSPACE_SCHEMA},schema=schemas[capability],
      row=repo.invoke('result',{event_id:ref.eventId}),work=repo.invoke('work',{work_id:ref.workId}),event=repo.invoke('event',{event_id:ref.eventId});
    const kinds={[COMMIT_CAPABILITY]:'jav_correction_commit',[FORMAL_CAPABILITY]:'jav_correction_formal_retirement',[WORKSPACE_CAPABILITY]:'jav_correction_workspace_reclaim'};
    if(!schema||row?.outcome_kind!=='succeeded'||row.result_schema_ref!==schema||ref.resultSchemaRef!==schema||row.result_digest!==ref.resultDigest||
        work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==record.correctionId||work.work_kind!==kinds[capability]||work.state!=='succeeded'||
        event?.work_id!==ref.workId||event.capability_ref!==capability||event.state!=='succeeded'||event.result_id!==row.result_id)fail('Cleanup requires the exact succeeded Work and Result set.');
    const value=JSON.parse(row.result_json),evidence=JSON.parse(row.evidence_json);options.contractValidator.validate(schema,value);
    if(canonicalJson(value)!==row.result_json||canonicalDigest(value)!==ref.resultDigest||canonicalDigest(evidence)!==row.evidence_digest||
        value.correctionId!==record.correctionId||value.scopeId!==record.correctionId||value.shelfEntryId!==record.shelfEntryId||value.ownerDomain!=='arca'||
        value.scopeType!=='jav_identity_correction'||work.basis_digest!==value.scopeDigest||row.effect_receipt_id!==value.effectReceiptRef||
        (capability===FORMAL_CAPABILITY?row.committed_at_ms<BigInt(value.committedAtMs):row.committed_at_ms!==BigInt(value.committedAtMs))||evidence.producerRef!==capability||evidence.basisDigest!==value.scopeDigest||
        evidence.payloadDigest!==ref.resultDigest||row.evidence_schema_ref!=='helix://contracts/capabilities/'+capability.replace('@1','/v1/evidence'))fail('Cleanup Result provenance changed.');
    const prefix=capability===COMMIT_CAPABILITY?'arca-correction-commit-marker-':capability===FORMAL_CAPABILITY?'arca-jav-retirement-marker-':'arca-jav-reclaim-marker-',
      marker=repo.invoke('marker',{commit_marker:stable(prefix,{eventId:ref.eventId})}),effect=marker&&repo.invoke('effect',{effect_id:marker.effect_id}),
      attempt=effect&&repo.invoke('attempt',{event_attempt_id:effect.event_attempt_id}),
      commitDigest=capability===COMMIT_CAPABILITY?canonicalDigest({schema:'arca.jav-correction-inventory-commit@1',changeDigest:value.changeDigest,
        controlChangeDigest:value.controlChangeDigest,receiptDigest:ref.resultDigest}):row.evidence_digest,
      effectClass=capability===COMMIT_CAPABILITY?'responsibility_control_commit':capability===FORMAL_CAPABILITY?'material_commit':'workspace_write';
    const markerBinding=capability===FORMAL_CAPABILITY?marker?.scope_type==='arca_jav_identity_correction'&&marker.result_id===null&&marker.result_schema_ref===null&&marker.result_digest===null:
      marker?.scope_type==='jav_identity_correction'&&marker.result_id===row.result_id&&marker.result_schema_ref===schema&&marker.result_digest===ref.resultDigest;
    if(marker?.owner_domain!=='arca'||!markerBinding||marker.scope_id!==record.correctionId||marker.commit_digest!==commitDigest||marker.committed_at_ms!==BigInt(value.committedAtMs)||
        effect?.state!=='committed'||effect.output_digest!==ref.resultDigest||effect.effect_class!==effectClass||marker.effect_id!==canonicalDigest([effectClass,effect.idempotency_key])||attempt?.event_id!==ref.eventId)
      fail('Cleanup Result has no exact committed Effect and marker.');
    if(capability!==COMMIT_CAPABILITY&&(value.committedContextDigest!==record.committedContext.contextDigest||value.commitReceiptDigest!==record.committedContext.receiptDigest))
      fail('Cleanup Result belongs to another committed correction context.');
    if(capability===WORKSPACE_CAPABILITY&&(value.executionReference.workId!==ref.workId||value.executionReference.eventId!==ref.eventId||value.executionReference.idempotencyKey!==effect.idempotency_key))
      fail('Reclaim execution reference changed.');
    return value;
  }
  function registry(repo,record,result){
    const workspaceId=record.correctionId+'-assets',row=repo.invoke('registry',{workspace_id:workspaceId}),members=repo.invoke('materials',{workspace_id:workspaceId}),
      artifacts=repo.invoke('artifacts',{owner_domain:'arca',owner_scope_type:'jav_identity_correction',owner_scope_id:record.correctionId}),
      effect=workspaceReclaimOutcome(result).effectReceipt;
    if(row?.owner_domain!=='arca'||row.process_type!=='jav_identity_correction'||row.process_id!==record.correctionId||row.state!=='reclaimed'||
        row.reclaimed_at_ms!==BigInt(result.committedAtMs)||members.length!==4||artifacts.length!==3)fail('Cleanup requires the complete reclaimed Registry.');
    const handles=members.map(member=>{const handle=JSON.parse(member.handle_json);options.contractValidator.validate(handle.schemaRef,handle);
      const {fenceDigest,...unsigned}=handle;
      if(handle.ownerDomain!=='arca'||handle.processId!==record.correctionId||handle.workspaceId!==workspaceId||handle.rootHandleRef!==row.root_handle_ref||
          member.owner_domain!=='arca'||member.process_id!==record.correctionId||member.material_handle_id!==handle.handleId||member.handle_digest!==canonicalDigest(handle)||
          canonicalJson(handle)!==member.handle_json||member.fence_digest!==handle.fenceDigest||fenceDigest!==canonicalDigest(unsigned)||
          handle.materialKey!==canonicalDigest({schema:'physical-material-identity@2',...handle.physicalIdentity})||member.state!=='reclaimed'||member.reclaimed_effect_id!==effect.effectId||
          member.reclaimed_effect_receipt_digest!==canonicalDigest(result)||member.reclaimed_at_ms!==BigInt(result.committedAtMs))fail('Cleanup material lifecycle proof changed.');
      return handle;
    });
    if([...handles].sort((a,b)=>a.relativePath.localeCompare(b.relativePath)).map(item=>item.relativePath).join(',')!=='fanart/fanart.jpg,metadata/metadata.json,nfo/movie.nfo,poster/poster.jpg')
      fail('Cleanup material set is not the exact four declared members.');
    const originalArtifacts=artifacts.map(artifact=>{const handle=handles.find(item=>item.relativePath.split('/')[0]===artifact.artifact_kind);
      if(!handle||artifact.state!=='deleted'||artifact.reference_revision!==BigInt(handle.referenceRevision+1)||artifact.digest_hex!==handle.digestHex||
          artifact.size_bytes!==BigInt(handle.sizeBytes))fail('Cleanup Artifact lifecycle proof changed.');
      const value={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:artifact.artifact_handle_id,artifactKind:artifact.artifact_kind,
        ownerDomain:artifact.owner_domain,ownerScope:{scopeType:artifact.owner_scope_type,scopeId:artifact.owner_scope_id},storageRef:artifact.storage_ref,
        digestAlgorithm:artifact.digest_algorithm,digestHex:artifact.digest_hex,sizeBytes:handle.sizeBytes,mediaType:artifact.media_type,
        provenanceRef:JSON.parse(artifact.provenance_ref),referenceRevision:handle.referenceRevision};
      options.contractValidator.validate(value.schemaRef,value);return value;
    });
    if(new Set(artifacts.map(item=>item.artifact_kind)).size!==3)fail('Cleanup Artifact set is not exact.');
    handles.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));originalArtifacts.sort((a,b)=>a.artifactKind.localeCompare(b.artifactKind));
    if(canonicalDigest({members:handles,artifacts:originalArtifacts})!==result.handleSetDigest)fail('Cleanup complete Handle set differs from the original reclaim Receipt.');
  }
  function refs(record,receipt){const context=record.committedContext;
    return [{ref:{workId:context.commitReference.workId,eventId:context.commitReference.eventId,resultSchemaRef:COMMIT_SCHEMA,resultDigest:context.receiptDigest},cap:COMMIT_CAPABILITY},
      {ref:receipt.formalRetirementResult,cap:FORMAL_CAPABILITY},{ref:receipt.workspaceReclaimResult,cap:WORKSPACE_CAPABILITY}];}
  function verifyReceipt(value,record){options.contractValidator.validate(SCHEMA,value);const {receiptDigest,...body}=value;
    if(receiptDigest!==canonicalDigest(body)||value.correctionId!==record.correctionId||value.shelfEntryId!==record.shelfEntryId||
        value.committedContextDigest!==record.committedContext.contextDigest||value.identityCommitReceiptDigest!==record.committedContext.receiptDigest)
      fail('Cleanup Receipt does not conserve committed provenance.');return value;}
  function read(correctionId){const record=options.correctionStore.get(correctionId);if(record?.cleanupState!=='completed')return null;
    const receipt=verifyReceipt(record.cleanupReceipt,record);let identityCommit;
    return options.unitOfWork.execute([{participantId:'arca_jav_cleanup_replay_owner',owner:'arca',repositories:[arca],execute(c){
      const row=c.repository(arca.repositoryId).invoke('correction',{correction_id:correctionId});
      if(row?.state!=='committed'||row.cleanup_state!=='completed'||row.committed_context_digest!==record.committedContext.contextDigest||
          row.committed_context_schema_ref!==record.committedContext.schemaRef||row.committed_context_json!==canonicalJson(record.committedContext)||
          row.cleanup_receipt_schema_ref!==SCHEMA||row.cleanup_receipt_json!==canonicalJson(receipt)||row.cleanup_receipt_digest!==receipt.receiptDigest)
        fail('Cleanup Receipt is not backed by its completed Owner row.');
      const directory=c.repository(arca.repositoryId).invoke('directory',{correction_id:correctionId});
      if(directory?.shelf_entry_id!==record.shelfEntryId||directory.committed_context_digest!==record.committedContext.contextDigest||directory.cleanup_receipt_digest!==receipt.receiptDigest||directory.created_at_ms!==BigInt(receipt.completedAtMs))
        fail('Cleanup has no exact atomic directory responsibility.');
    }},{participantId:'arca_jav_cleanup_replay_execution',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(c){
      const repo=c.repository(foundation.repositoryId),values=refs(record,receipt).map(item=>proof(repo,item.ref,item.cap,record));registry(repo,record,values[2]);identityCommit=values[0];return receipt;
    }},{participantId:'arca_jav_cleanup_replay_history',owner:'arca',repositories:[arca],execute(c){
      const repo=c.repository(arca.repositoryId);
      if(repo.invoke('identity',{shelf_entry_id:record.shelfEntryId,revision:identityCommit.newCanonicalIdentityRevision})?.identity_digest!==identityCommit.canonicalIdentityDigest||
          repo.invoke('inventory',{shelf_entry_id:record.shelfEntryId,revision:identityCommit.newInventoryRevision})?.representation_digest!==identityCommit.inventoryDigest)
        fail('Cleanup Receipt no longer has its immutable committed identity and Inventory revisions.');
    }}]).arca_jav_cleanup_replay_execution;
  }
  function complete(prepared){const {record,formal,workspace,formalPlan}=prepared,projections=[];let existing=null,receipt=null;
    if(record?.state!=='committed'||record.cleanupState!=='active'||!formalPlan?.guard?.controls.length)fail('Cleanup completion requires the active committed cleanup responsibility.');
    const reference=row=>({workId:row.workId,eventId:row.eventId,resultSchemaRef:row.resultSchemaRef,resultDigest:row.resultDigest}),
      provisional={formalRetirementResult:reference(formal),workspaceReclaimResult:reference(workspace)},keys=formalPlan.guard.controls.map(item=>item.materialKey).sort(),
      participants=[{participantId:'arca_jav_cleanup_owner_fence',owner:'arca',repositories:[arca],execute(c){
        const repo=c.repository(arca.repositoryId),row=repo.invoke('correction',{correction_id:record.correctionId});
        if(row?.state!=='committed'||row.shelf_entry_id!==record.shelfEntryId||row.state_revision!==BigInt(record.stateRevision)||row.admission_digest!==record.admissionDigest||
            row.committed_context_digest!==record.committedContext.contextDigest||row.committed_context_json!==canonicalJson(record.committedContext))fail('Cleanup committed context changed.');
        if(row.cleanup_state==='completed'){existing=verifyReceipt(JSON.parse(row.cleanup_receipt_json),record);return;}
        if(row.cleanup_state!=='active'||[row.cleanup_receipt_schema_ref,row.cleanup_receipt_json,row.cleanup_receipt_digest].some(value=>value!==null))fail('Cleanup responsibility changed.');
        const entry=repo.invoke('entry',{shelf_entry_id:record.shelfEntryId}),guard=formalPlan.guard,shelf=entry&&repo.invoke('shelf',{shelf_id:entry.shelf_id});
        if(entry?.status!=='active'||shelf?.status!=='active'||entry.canonical_identity_revision!==BigInt(guard.canonicalIdentityRevision)||entry.current_inventory_revision!==BigInt(guard.inventoryRevision)||
            repo.invoke('identity',{shelf_entry_id:record.shelfEntryId,revision:guard.canonicalIdentityRevision})?.identity_digest!==guard.canonicalIdentityDigest||
            repo.invoke('inventory',{shelf_entry_id:record.shelfEntryId,revision:guard.inventoryRevision})?.representation_digest!==guard.inventoryDigest||
            canonicalDigest(Object.fromEntries(Object.entries(repo.invoke('original_commit',{shelf_entry_id:record.shelfEntryId})||{}).map(([key,value])=>
              [key,typeof value==='bigint'?String(value):value])))!==record.proof.basis.originalCommitDigest)fail('Cleanup current collection head or original Commit changed.');
      }},{participantId:'arca_jav_cleanup_execution_fence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(c){
        const repo=c.repository(foundation.repositoryId),values=refs(record,existing||provisional).map(item=>proof(repo,item.ref,item.cap,record));registry(repo,record,values[2]);
        if(!existing&&(values[1].retirementPlanDigest!==formalPlan.planDigest||values[1].guardDigest!==formalPlan.guardDigest||
            values[2].reclaimPlanDigest!==prepared.workspacePlan.planDigest||values[2].guardDigest!==prepared.workspacePlan.guardDigest))fail('Cleanup succeeded Result scope changed.');
      }}];
    for(let offset=0;offset<keys.length;offset+=1024)participants.push(createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_jav_cleanup_control_'+offset,
      materialKeys:keys.slice(offset,offset+1024),accept:values=>projections.push(...values)}));
    participants.push({participantId:'arca_jav_cleanup_commit',owner:'arca',repositories:[arca],execute(c){
      if(existing){receipt=existing;return receipt;}
      if(projections.length!==formalPlan.guard.controls.length||formalPlan.guard.controls.some(expected=>{const actual=projections.find(item=>item.materialKey===expected.materialKey);
        return !actual||actual.controlRevision!==expected.controlRevision||actual.projectionDigest!==expected.projectionDigest;}))fail('Cleanup Material Control guard changed.');
      const body={schemaRef:SCHEMA,schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,committedContextDigest:record.committedContext.contextDigest,
        identityCommitReceiptDigest:record.committedContext.receiptDigest,...provisional,completedAtMs:c.commitTimeMs};receipt={...body,receiptDigest:canonicalDigest(body)};verifyReceipt(receipt,record);
      const changed=c.repository(arca.repositoryId).invoke('complete',{cleanup_state:'completed',cleanup_receipt_schema_ref:SCHEMA,cleanup_receipt_json:canonicalJson(receipt),
        cleanup_receipt_digest:receipt.receiptDigest,updated_at_ms:c.commitTimeMs,correction_id:record.correctionId,expected_state:'committed',expected_cleanup_state:'active',
        expected_state_revision:record.stateRevision,expected_context_digest:record.committedContext.contextDigest});
      if(changed.changes!==1)fail('Cleanup completion CAS failed.');
      c.repository(arca.repositoryId).invoke('seed_directory',{correction_id:record.correctionId,shelf_entry_id:record.shelfEntryId,
        committed_context_digest:record.committedContext.contextDigest,cleanup_receipt_digest:receipt.receiptDigest,state:'pending',check_revision:1,
        checks_schema_ref:require('../model/jav-correction-directory-scope').CHECKS_SCHEMA,checks_json:'[]',checks_scope_digest:null,last_error_code:null,
        created_at_ms:c.commitTimeMs,updated_at_ms:c.commitTimeMs,next_check_at_ms:c.commitTimeMs});return receipt;
    }});
    const transaction=require('../../../contracts/transaction-contracts/helix.transaction.jav-correction-cleanup-commit/v1/contract.json').contract,declared=new Set([...transaction.readTables,...transaction.writeTables]);
    if(participants.some(participant=>participant.repositories.some(repo=>repo.tableIds.some(table=>!declared.has(table)))))fail('Cleanup participants escape the exact canonical transaction.');
    options.unitOfWork.execute(participants);return read(record.correctionId);
  }
  return Object.freeze({read,complete});
}
module.exports=Object.freeze({createJavCorrectionCleanupStore});
