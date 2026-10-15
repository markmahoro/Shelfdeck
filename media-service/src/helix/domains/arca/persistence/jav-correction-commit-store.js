'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createMaterialControlParticipant,createMaterialControlAdmissionReadParticipant,controlScopeDigest}=require('../../../foundation/persistence/material-control');
const {appendInventoryRevision}=require('./inventory-revision-writer');
const contextStatements=require('./inventory-context-statements');
const {buildJavCorrectionInventoryChange,buildJavCorrectionControlChanges}=require('../model/jav-correction-inventory-change');
const {buildJavCorrectionFilePlan}=require('../model/jav-correction-file-plan');
const {isPinnedJavCorrectionSource}=require('../model/jav-correction-source-result');
const {CAPABILITY,SCHEMA}=require('../model/jav-correction-commit-contract');
const {SCHEMA:CONTEXT_SCHEMA,buildJavCorrectionCommittedContext,assertJavCorrectionCommittedContext}=require('../model/jav-correction-committed-context');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.jav-correction-inventory-commit/v1/contract.json').contract;
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_JAV_CORRECTION_COMMIT_INTEGRITY'});};
function createJavCorrectionCommitStore(options) {
  const define=(repositoryId,owner,statements)=>createRepositoryDefinition({repositoryId,owner,schemaManifest:options.schemaManifest,statements}),
    arcaRead=define('arca_jav_commit_read','arca',{...contextStatements,
      correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns:['correction_id','shelf_entry_id','state','state_revision','admission_digest',
        'preview_proof_json','terminal_evidence_digest','terminal_at_ms','committed_context_schema_ref','committed_context_json','committed_context_digest'],keyColumns:['correction_id'],safeIntegers:true},
      stage:{kind:'select-one',tableId:'arca_staged_manifest_records',columns:['record_id','process_type','process_id','manifest_json','complete_value_digest'],keyColumns:['record_id']},
      verification:{kind:'select-one',tableId:'arca_inventory_verification_records',columns:['record_id','process_type','process_id','verification_json','verification_digest'],keyColumns:['record_id']}}),
    writer=define('arca_jav_commit_write','arca',{
      insert_representation:{kind:'insert',tableId:'arca_inventory_representations',columns:['shelf_entry_id','revision','representation_digest','source_package_id','committed_at_ms']},
      clear_active_material_guards:{kind:'update',tableId:'arca_inventory_materials',setColumns:['active_guard'],keyColumns:['shelf_entry_id','inventory_revision']},
      insert_material:{kind:'insert',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','episode_claims_schema_ref',
        'episode_claims_json','episode_claim_set_digest','endpoint_id','location','binding_revision','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version',
        'content_fingerprint','digest_hex','size_bytes','artifact_scope_schema_ref','artifact_scope_json','active_guard']},
      insert_related:{kind:'insert',tableId:'arca_inventory_related_references',columns:['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role',
        'reference_kind','material_identity_hint','endpoint_id','location','checksum_hex']},
      insert_fact:{kind:'insert',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json',
        'episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms']},
      insert_person:{kind:'insert',tableId:'arca_inventory_person_relations',columns:['relation_id','shelf_entry_id','inventory_revision','person_id','display_name',
        'display_name_normalized','role','relation_source','provider_identity_schema_ref','provider_identity_json','provider_identity_digest','origin_evidence_digest','confidence_class','relation_digest']},
      advance_inventory:{kind:'update',tableId:'arca_shelf_entries',setColumns:['current_inventory_revision'],keyColumns:['shelf_entry_id'],
        compareColumns:[{column:'current_inventory_revision',parameter:'expected_current_inventory_revision'}]},
      insert_identity:{kind:'insert',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','identity_kind','provider','provider_key','identity_digest','committed_at_ms']},
      advance_identity:{kind:'update',tableId:'arca_shelf_entries',setColumns:['canonical_identity_revision','canonical_identity_key'],keyColumns:['shelf_entry_id'],
        compareColumns:[{column:'canonical_identity_revision',parameter:'expected_identity_revision'},{column:'current_inventory_revision',parameter:'expected_inventory_revision'}]},
      finish:{kind:'update',tableId:'arca_jav_identity_corrections',setColumns:['state','state_revision','terminal_evidence_digest','committed_context_schema_ref','committed_context_json','committed_context_digest','cleanup_state','updated_at_ms','terminal_at_ms'],keyColumns:['correction_id'],
        compareColumns:[{column:'state',parameter:'expected_state'},{column:'state_revision',parameter:'expected_state_revision'}]}}),
    foundation=define('arca_jav_commit_foundation','execution-foundation',{
      work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state','basis_digest'],keyColumns:['work_id']},
      event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
      attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']},
      result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest',
        'evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'],keyColumns:['event_id'],safeIntegers:true},
      marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'],keyColumns:['commit_marker'],safeIntegers:true},
      insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest',
        'evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
      insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']}});
  function digestFor(result) {return canonicalDigest({schema:'arca.jav-correction-inventory-commit@1',changeDigest:result.changeDigest,
    controlChangeDigest:result.controlChangeDigest,receiptDigest:canonicalDigest(result)});}
  function outcome(execution,result,commitDigest) {
    const evidence={evidenceId:stable('arca-correction-evidence-',{capabilityRef:CAPABILITY,result}),evidenceKind:'jav_identity_correction',producerRef:CAPABILITY,
      basisDigest:result.scopeDigest,payloadDigest:canonicalDigest(result),observedAtMs:result.committedAtMs};
    return {kind:'succeeded',resultSchemaRef:SCHEMA,result,evidenceSchemaRef:'helix://contracts/capabilities/arca.jav_correction.inventory.commit/v1/evidence',evidence,
      effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:result.effectReceiptRef,
        effectId:canonicalDigest(['responsibility_control_commit',execution.idempotencyKey]),effectClass:'responsibility_control_commit',idempotencyKey:execution.idempotencyKey,
        commitMarker:stable('arca-correction-commit-marker-',{eventId:execution.eventId}),externalReceiptRef:null,outputDigest:canonicalDigest(result),
        verificationEvidenceDigest:commitDigest,committedAtMs:result.committedAtMs}};
  }
  function contextFromRow(row){
    let value,proof;
    try{value=JSON.parse(row.committed_context_json);proof=JSON.parse(row.preview_proof_json);}catch{fail('Committed context JSON is corrupt.');}
    options.contractValidator.validate(CONTEXT_SCHEMA,value);
    options.contractValidator.validate('helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1',value.filePlan);
    assertJavCorrectionCommittedContext(value,{correctionId:row.correction_id,shelfEntryId:row.shelf_entry_id,state:row.state,
      admissionDigest:row.admission_digest,proof});
    if(row.committed_context_schema_ref!==CONTEXT_SCHEMA||row.committed_context_digest!==value.contextDigest||canonicalJson(value)!==row.committed_context_json)
      fail('Committed context is not backed by its exact canonical row.');
    return value;
  }
  function readEvent(execution) {
    let found;
    return options.unitOfWork.execute([{participantId:'arca_jav_commit_replay_foundation',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(c){
      const r=c.repository(foundation.repositoryId),row=r.invoke('result',{event_id:execution.eventId});if(!row)return null;
      if(row.outcome_kind!=='succeeded'||row.result_schema_ref!==SCHEMA)fail('Correction Event is already bound to another Result.');
      const result=JSON.parse(row.result_json);options.contractValidator.validate(SCHEMA,result);
      const work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
      if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==result.correctionId||work.basis_digest!==result.scopeDigest||
          event?.work_id!==execution.workId||event.capability_ref!==CAPABILITY||attempt?.event_id!==execution.eventId)
        fail('Correction Receipt is not bound to the actual referenced Work Event and Attempt.');
      const value=outcome(execution,result,digestFor(result)),marker=r.invoke('marker',{commit_marker:value.effectReceipt.commitMarker});
      if(row.result_digest!==canonicalDigest(result)||row.result_json!==canonicalJson(result)||row.effect_receipt_id!==result.effectReceiptRef||
          row.evidence_json!==canonicalJson(value.evidence)||row.evidence_digest!==canonicalDigest(value.evidence)||row.evidence_schema_ref!==value.evidenceSchemaRef||
          marker?.effect_id!==value.effectReceipt.effectId||marker.owner_domain!=='arca'||marker.scope_type!==result.scopeType||marker.scope_id!==result.scopeId||
          marker.commit_digest!==value.effectReceipt.verificationEvidenceDigest||marker.result_id!==row.result_id||marker.result_schema_ref!==SCHEMA||
          marker.result_digest!==row.result_digest||Number(marker.committed_at_ms)!==result.committedAtMs)fail('Correction Receipt lacks its exact atomic Result and Commit Marker.');
      found=Object.freeze(value);return found;
    }},{participantId:'arca_jav_commit_replay',owner:'arca',repositories:[arcaRead],execute(c){
      if(!found)return null;
      const r=c.repository(arcaRead.repositoryId),result=found.result,correction=r.invoke('correction',{correction_id:result.correctionId}),
        identity=r.invoke('find_identity',{shelf_entry_id:result.shelfEntryId,revision:result.newCanonicalIdentityRevision}),
        inventory=r.invoke('find_inventory',{shelf_entry_id:result.shelfEntryId,revision:result.newInventoryRevision});
      if(correction?.state!=='committed'||correction.shelf_entry_id!==result.shelfEntryId||correction.terminal_evidence_digest!==found.effectReceipt.verificationEvidenceDigest||
          Number(correction.terminal_at_ms)!==result.committedAtMs||identity?.identity_digest!==result.canonicalIdentityDigest||inventory?.representation_digest!==result.inventoryDigest)
        fail('Correction Receipt is not backed by its terminal Evidence and immutable committed revisions.');
      const context=contextFromRow(correction),ref=context.commitReference;
      if(context.receiptDigest!==canonicalDigest(result)||ref.eventId!==execution.eventId||ref.workId!==execution.workId||ref.idempotencyKey!==execution.idempotencyKey||ref.scopeDigest!==result.scopeDigest)
        fail('Committed context does not reference this exact bound commit.');
    }}]).arca_jav_commit_replay_foundation;
  }
  function readCommitted(correctionId){
    const context=options.unitOfWork.execute([{participantId:'arca_jav_committed_context_read',owner:'arca',repositories:[arcaRead],execute(c){
      const row=c.repository(arcaRead.repositoryId).invoke('correction',{correction_id:correctionId});
      if(!row)return null;if(row.state!=='committed')fail('Correction is not committed.');return contextFromRow(row);
    }}]).arca_jav_committed_context_read;
    if(!context)return null;
    const commit=readEvent({...context.commitReference,ownerScope:{domain:'arca',processType:'arca_jav_identity_correction',processId:correctionId}});
    if(!commit||commit.result.correctionId!==correctionId||canonicalDigest(commit.result)!==context.receiptDigest)
      fail('Committed context has no exact bound Result and Commit Marker.');
    return Object.freeze({committedContext:context,commit});
  }
  function currentRaw(repo,entryId) {
    const entry=repo.invoke('find_entry',{shelf_entry_id:entryId}),shelf=entry&&repo.invoke('find_shelf',{shelf_id:entry.shelf_id});if(!entry||!shelf)fail('Current correction Entry is absent.');
    const key={shelf_entry_id:entryId,inventory_revision:Number(entry.current_inventory_revision)};
    return {entry,shelf,identity:repo.invoke('find_identity',{shelf_entry_id:entryId,revision:Number(entry.canonical_identity_revision)}),
      inventory:repo.invoke('find_inventory',{shelf_entry_id:entryId,revision:key.inventory_revision}),standard:repo.invoke('find_standard',{shelf_id:shelf.shelf_id,revision:Number(shelf.current_standard_revision)}),
      placement:repo.invoke('find_placement',{shelf_id:shelf.shelf_id,revision:Number(shelf.current_placement_revision)}),onDeckCommit:repo.invoke('find_ondeck_commit',{shelf_entry_id:entryId}),
      materials:repo.invoke('list_materials',key),related:repo.invoke('list_related',key),facts:repo.invoke('list_facts',key),people:repo.invoke('list_people',key),
      reservations:repo.invoke('list_reservations',{shelf_entry_id:entryId})};
  }
  function commit(execution,prepared) {
    if(execution.capabilityRef!==CAPABILITY||execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||
        execution.ownerScope.processId!==execution.namedInputs?.javCorrectionScope?.correctionId)fail('Correction commit is outside its exact executing Owner.');
    const prior=readEvent(execution);if(prior){if(prior.result.scopeId!==execution.ownerScope.processId||prior.result.scopeDigest!==execution.namedInputs.javCorrectionScope.digest)
      fail('Correction Receipt replay belongs to another admission scope.');return prior;}
    const {record,scope,change,controlChanges}=prepared;
    if(execution.capabilityRef!==CAPABILITY||execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||
        execution.ownerScope.processId!==record.correctionId||canonicalDigest(execution.namedInputs?.javCorrectionScope)!==canonicalDigest(scope))fail('Correction commit execution scope is foreign.');
    const marker=stable('arca-correction-commit-marker-',{eventId:execution.eventId}),keys=[...new Set([...record.proof.basis.materials.map(row=>row.physicalIdentity.materialKey),...change.materials.map(row=>row.material_key)])].sort(),
      controlDigest=controlScopeDigest(controlChanges),projections=[],participants=[];let raw,cases,currentRecord,derived,atomic;
    participants.push({participantId:'arca_jav_commit_execution_fence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(c){
      const r=c.repository(foundation.repositoryId),work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
      if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==record.correctionId||work.state!=='running'||work.basis_digest!==scope.digest||
          event?.work_id!==execution.workId||event.capability_ref!==CAPABILITY||event.state!=='executing'||attempt?.event_id!==execution.eventId||attempt.state!=='executing')fail('Correction commit lost its exact execution fence.');
      if(prepared.predecessors.length!==5||new Set(prepared.predecessors.map(ref=>ref.eventId)).size!==5)fail('Correction commit predecessor set is incomplete.');
      for(const ref of prepared.predecessors) {
        const w=r.invoke('work',{work_id:ref.workId}),e=r.invoke('event',{event_id:ref.eventId}),value=r.invoke('result',{event_id:ref.eventId});
        if((w?.state!=='succeeded'&&!(w?.state==='failed'&&isPinnedJavCorrectionSource(record,ref)))||w.owner_domain!=='arca'||w.process_type!=='arca_jav_identity_correction'||w.process_id!==record.correctionId||w.basis_digest!==scope.digest||
            e?.state!=='succeeded'||e.work_id!==ref.workId||e.capability_ref!==ref.capabilityRef||value?.outcome_kind!=='succeeded'||
            value.result_digest!==ref.resultDigest||canonicalDigest(JSON.parse(value.result_json))!==ref.resultDigest)fail('Correction commit predecessor Work or complete Result changed.');
      }
    }});
    participants.push({participantId:'arca_jav_commit_basis',owner:'arca',repositories:[arcaRead],execute(c){
      const r=c.repository(arcaRead.repositoryId),row=r.invoke('correction',{correction_id:record.correctionId});
      if(!row||row.state!=='active'||row.terminal_at_ms!==null||Number(row.state_revision)!==record.stateRevision||row.admission_digest!==record.admissionDigest||
          row.shelf_entry_id!==record.shelfEntryId||row.preview_proof_json!==canonicalJson(record.proof))fail('Correction commit admission or immutable proof changed.');
      currentRecord={...record,state:row.state,stateRevision:Number(row.state_revision)};raw=currentRaw(r,record.shelfEntryId);cases=r.invoke('list_cases',{shelf_entry_id:record.shelfEntryId});
      const stage=r.invoke('stage',{record_id:prepared.stageRecord.recordId}),verification=r.invoke('verification',{record_id:prepared.verificationRecord.recordId});
      if(stage?.process_type!=='arca_jav_identity_correction'||stage.process_id!==record.correctionId||stage.complete_value_digest!==canonicalDigest(prepared.manifest)||stage.manifest_json!==canonicalJson(prepared.manifest)||
          verification?.process_type!=='arca_jav_identity_correction'||verification.process_id!==record.correctionId||verification.verification_digest!==canonicalDigest(prepared.verification)||verification.verification_json!==canonicalJson(prepared.verification))
        fail('Correction commit complete Manifest or Verification is missing or changed.');
      const plan=buildJavCorrectionFilePlan({record:currentRecord,scope,verified:prepared.verified,prepared:prepared.preparedAssets,target:prepared.plan.target});
      if(canonicalDigest(plan)!==canonicalDigest(prepared.plan))fail('Correction commit File Plan differs from its exact approved source and assets.');
    }});
    for(let offset=0;offset<keys.length;offset+=1024)participants.push(createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',
      participantId:'arca_jav_commit_control_read_'+offset,materialKeys:keys.slice(offset,offset+1024),accept:items=>projections.push(...items)}));
    participants.push({participantId:'arca_jav_commit_reconstruct',owner:'arca',repositories:[arcaRead],execute(){
      const oldKeys=new Set(raw.materials.map(row=>row.material_key));
      derived=buildJavCorrectionInventoryChange({...prepared,record:currentRecord,raw,activeCases:cases,controlProjections:projections.filter(row=>oldKeys.has(row.materialKey)),committedAtMs:change.committedAtMs});
      if(derived.changeDigest!==change.changeDigest||canonicalDigest(buildJavCorrectionControlChanges(derived,record.proof.basis,projections))!==canonicalDigest(controlChanges))
        fail('Correction commit no longer matches its frozen complete Inventory and Control changes.');
      for(const row of derived.facts.filter(row=>['resolved_identity','product_metadata','media_cast'].includes(row.fact_kind)))options.contractValidator.validate(row.fact_schema_ref,JSON.parse(row.fact_json));
    }});
    for(let offset=0;offset<controlChanges.length;offset+=1024) {
      const page=controlChanges.slice(offset,offset+1024),handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
        handleId:stable('arca-jav-correction-control-',{eventId:execution.eventId,offset}),operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:record.correctionId,
        basisRef:{objectType:'jav_identity_correction',objectId:record.correctionId,revision:record.stateRevision,digest:scope.digest},basisDigest:scope.digest,
        canonicalFactSetDigest:change.changeDigest,bindingSetDigest:prepared.verification.finalBindingSetDigest,controlScopeDigest:controlScopeDigest(page),
        expectedControlRevisions:page.map(item=>({materialKey:item.identity.materialKey,revision:item.expectedRevision})),
        receiptContract:{receiptSchemaRef:SCHEMA,controlRevisionSetSchemaRef:'arca.control-revision-set@1'},eventFenceDigest:canonicalDigest({workId:execution.workId,eventId:execution.eventId})};
      options.contractValidator.validate(handle.schemaRef,handle);participants.push(createMaterialControlParticipant({...options,participantId:'arca_jav_commit_control_'+offset,
        handle,changes:page,authorizedScopeDigest:handle.controlScopeDigest,commitMarker:marker}));
    }
    participants.push({participantId:'arca_jav_commit_write',owner:'arca',repositories:[writer],execute(c){
      const r=c.repository(writer.repositoryId),at=c.commitTimeMs,result={schemaRef:SCHEMA,schemaVersion:1,receiptId:stable('arca-jav-correction-receipt-',{eventId:execution.eventId}),
        receiptKind:'jav_identity_correction_committed',ownerDomain:'arca',scopeType:'jav_identity_correction',scopeId:record.correctionId,scopeDigest:scope.digest,
        effectReceiptRef:stable('arca-correction-commit-effect-receipt-',{eventId:execution.eventId}),committedAtMs:at,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,
        previousCanonicalIdentityRevision:derived.previousCanonicalIdentityRevision,newCanonicalIdentityRevision:derived.newCanonicalIdentityRevision,
        previousInventoryRevision:derived.previousInventoryRevision,newInventoryRevision:derived.newInventoryRevision,canonicalIdentityDigest:derived.newIdentity.identityDigest,
        canonicalIdentityKey:derived.newCanonicalIdentityKey,inventoryDigest:derived.representationDigest,verificationDigest:derived.verificationDigest,
        controlChangeDigest:controlDigest,changeDigest:derived.changeDigest,originalCommitDigest:derived.originalCommitDigest};
      options.contractValidator.validate(SCHEMA,result);atomic=outcome(execution,result,digestFor(result));
      const committedContext=buildJavCorrectionCommittedContext({record:currentRecord,execution,receipt:result,filePlan:prepared.plan,stagedRecord:prepared.stageRecord});
      options.contractValidator.validate(CONTEXT_SCHEMA,committedContext);
      appendInventoryRevision(r,derived,raw.inventory,derived.previousInventoryRevision,derived.newInventoryRevision,at);
      r.invoke('insert_identity',{shelf_entry_id:record.shelfEntryId,revision:derived.newCanonicalIdentityRevision,identity_kind:'jav_code',provider:'jav',
        provider_key:derived.newIdentity.providerIdentities[0].providerKey,identity_digest:derived.newIdentity.identityDigest,committed_at_ms:at});
      if(r.invoke('advance_identity',{shelf_entry_id:record.shelfEntryId,canonical_identity_revision:derived.newCanonicalIdentityRevision,canonical_identity_key:derived.newCanonicalIdentityKey,
          expected_identity_revision:derived.previousCanonicalIdentityRevision,expected_inventory_revision:derived.newInventoryRevision}).changes!==1)fail('Correction identity head CAS failed.');
      if(r.invoke('finish',{correction_id:record.correctionId,state:'committed',state_revision:record.stateRevision+1,terminal_evidence_digest:atomic.effectReceipt.verificationEvidenceDigest,
          committed_context_schema_ref:CONTEXT_SCHEMA,committed_context_json:canonicalJson(committedContext),committed_context_digest:committedContext.contextDigest,cleanup_state:'pending',
          updated_at_ms:at,terminal_at_ms:at,expected_state:'active',expected_state_revision:record.stateRevision}).changes!==1)fail('Correction terminal CAS failed.');
    }});
    participants.push({participantId:'arca_jav_commit_result',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(c){
      const r=c.repository(foundation.repositoryId),resultId=stable('arca-jav-correction-result-',{eventId:execution.eventId}),digest=canonicalDigest(atomic.result);
      r.invoke('insert_result',{result_id:resultId,event_id:execution.eventId,outcome_kind:'succeeded',result_schema_ref:SCHEMA,result_json:canonicalJson(atomic.result),result_digest:digest,
        evidence_schema_ref:atomic.evidenceSchemaRef,evidence_json:canonicalJson(atomic.evidence),evidence_digest:canonicalDigest(atomic.evidence),
        effect_receipt_id:atomic.effectReceipt.effectReceiptId,committed_at_ms:c.commitTimeMs});
      r.invoke('insert_marker',{commit_marker:marker,effect_id:atomic.effectReceipt.effectId,owner_domain:'arca',scope_type:'jav_identity_correction',scope_id:record.correctionId,
        commit_digest:atomic.effectReceipt.verificationEvidenceDigest,result_id:resultId,result_schema_ref:SCHEMA,result_digest:digest,committed_at_ms:c.commitTimeMs});
    }});
    const declared=new Set([...transaction.readTables,...transaction.writeTables]);
    if(participants.some(participant=>participant.repositories.some(repo=>repo.tableIds.some(table=>!declared.has(table)))))fail('Correction participant escapes its exact canonical transaction.');
    options.unitOfWork.execute(participants);return readEvent(execution);
  }
  return Object.freeze({readEvent,readCommitted,commit});
}
module.exports=Object.freeze({createJavCorrectionCommitStore});
