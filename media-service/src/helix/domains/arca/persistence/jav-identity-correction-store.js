'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {createMaterialControlAdmissionReadParticipant}=require('../../../foundation/persistence/material-control');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../model/jav-identity-correction');
const inventoryContextStatements=require('./inventory-context-statements');
const COMMAND='arca.jav-identity-correction.admit@1';
const PROOF_SCHEMA='helix://contracts/application-types/ArcaJavCorrectionPreviewProof/v1';
const RECEIPT_SCHEMA='helix://contracts/application-types/ArcaJavCorrectionAdmissionReceipt/v1';
const {SCHEMA:CONTEXT_SCHEMA,assertJavCorrectionCommittedContext}=require('../model/jav-correction-committed-context');
const {pendingJavCorrection}=require('./jav-correction-gate');
const {SCHEMA:RECOVERY_SCHEMA,OBSERVATION_SCHEMA,assertJavCorrectionRecoveryReceipt,buildJavCorrectionRecoveryReceipt,recoveryMode}=require('../model/jav-correction-recovery');
const {createJavCorrectionRecoveryReader}=require('./jav-correction-recovery-reader');
const columns=['correction_id','shelf_entry_id','preview_id','preview_proof_schema_ref','preview_proof_json','basis_digest','proposal_digest','placement_preview_digest',
  'actor_id','idempotency_key','admission_digest','state','state_revision','terminal_evidence_digest','committed_context_schema_ref','committed_context_json','committed_context_digest',
  'cleanup_state','cleanup_receipt_schema_ref','cleanup_receipt_json','cleanup_receipt_digest',
  'recovery_intent_schema_ref','recovery_intent_json','recovery_intent_digest','created_at_ms','updated_at_ms','terminal_at_ms'];
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const intentColumns=['recovery_id','correction_id','shelf_entry_id','previous_intent_digest','receipt_schema_ref','receipt_json','receipt_digest',
  'observation_schema_ref','observation_json','observation_digest','created_at_ms'];
const intentReads={find_recovery_intent:{kind:'select-one',tableId:'arca_jav_correction_recovery_intents',columns:intentColumns,keyColumns:['recovery_id'],safeIntegers:true},
  list_recovery_receipts:{kind:'select-filtered-page',tableId:'arca_jav_correction_recovery_intents',columns:['recovery_id','correction_id','shelf_entry_id','previous_intent_digest','receipt_schema_ref','receipt_json','receipt_digest'],
    fixedKeyColumns:['correction_id'],orderBy:[{column:'recovery_id',direction:'asc'}],maxItems:64,safeIntegers:true}};

function createJavIdentityCorrectionStore(options) {
  if(!options.contractValidator)throw new TypeError('Correction admission requires exact nominal validation.');
  const coordinator=createCommandCommitCoordinator(options),definition=createRepositoryDefinition({repositoryId:'arca_jav_correction_store',owner:'arca',
    schemaManifest:options.schemaManifest,statements:{...inventoryContextStatements,...intentReads,
      insert_recovery_intent:{kind:'insert',tableId:'arca_jav_correction_recovery_intents',columns:intentColumns},
      list_corrections:{kind:'select-all',tableId:'arca_jav_identity_corrections',columns,keyColumns:['shelf_entry_id'],safeIntegers:true},
      find_correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns,keyColumns:['correction_id'],safeIntegers:true},
      latest_correction:{kind:'select-filtered-page',tableId:'arca_jav_identity_corrections',columns,fixedKeyColumns:['shelf_entry_id'],
        orderBy:[{column:'created_at_ms',direction:'desc'},{column:'correction_id',direction:'desc'}],maxItems:1,safeIntegers:true},
      page_corrections:{kind:'select-range',tableId:'arca_jav_identity_corrections',columns:['correction_id','state','state_revision'],keyColumn:'correction_id',maxItems:100,safeIntegers:true},
      insert_correction:{kind:'insert',tableId:'arca_jav_identity_corrections',columns},
      advance_correction:{kind:'update',tableId:'arca_jav_identity_corrections',setColumns:['state','state_revision','updated_at_ms'],keyColumns:['correction_id'],
        compareColumns:[{column:'state',parameter:'expected_state'},{column:'state_revision',parameter:'expected_state_revision'}]},
      cancel_correction:{kind:'update',tableId:'arca_jav_identity_corrections',setColumns:['state','state_revision','terminal_evidence_digest','terminal_at_ms','updated_at_ms'],
        keyColumns:['correction_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'state_revision',parameter:'expected_state_revision'},
          {column:'admission_digest',parameter:'expected_admission_digest'}]},
      advance_cleanup:{kind:'update',tableId:'arca_jav_identity_corrections',setColumns:['cleanup_state','updated_at_ms'],keyColumns:['correction_id'],
        compareColumns:[{column:'state',parameter:'expected_state'},{column:'cleanup_state',parameter:'expected_cleanup_state'},{column:'committed_context_digest',parameter:'expected_context_digest'}]},
      admit_recovery:{kind:'update',tableId:'arca_jav_identity_corrections',setColumns:['state','state_revision','cleanup_state','recovery_intent_schema_ref','recovery_intent_json','recovery_intent_digest','updated_at_ms'],
        keyColumns:['correction_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'state_revision',parameter:'expected_state_revision'},
          {column:'admission_digest',parameter:'expected_admission_digest'},{column:'cleanup_state',parameter:'expected_cleanup_state',nullSafe:true},
          {column:'recovery_intent_digest',parameter:'expected_recovery_intent_digest',nullSafe:true}]},
    }});
  function currentContext(repo,entryId) {
    const entry=repo.invoke('find_entry',{shelf_entry_id:entryId}),shelf=entry&&repo.invoke('find_shelf',{shelf_id:entry.shelf_id});
    if(!entry||!shelf)fail('ARCA_SHELF_ENTRY_NOT_FOUND','Shelf Entry was not found.');
    const scope={shelf_entry_id:entryId,inventory_revision:Number(entry.current_inventory_revision)};
    return {entry,shelf,identity:repo.invoke('find_identity',{shelf_entry_id:entryId,revision:Number(entry.canonical_identity_revision)}),
      inventory:repo.invoke('find_inventory',{shelf_entry_id:entryId,revision:scope.inventory_revision}),
      standard:repo.invoke('find_standard',{shelf_id:shelf.shelf_id,revision:Number(shelf.current_standard_revision)}),
      placement:repo.invoke('find_placement',{shelf_id:shelf.shelf_id,revision:Number(shelf.current_placement_revision)}),
      onDeckCommit:repo.invoke('find_ondeck_commit',{shelf_entry_id:entryId}),materials:repo.invoke('list_materials',scope),
      related:repo.invoke('list_related',scope),facts:repo.invoke('list_facts',scope),people:repo.invoke('list_people',scope),
      reservations:repo.invoke('list_reservations',{shelf_entry_id:entryId})};
  }
  function decode(row,repo) {
    if(!row)return null;
    let proof;try{proof=JSON.parse(row.preview_proof_json);}catch{fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Stored correction proof is invalid.');}
    options.contractValidator.validate(PROOF_SCHEMA,proof);
    const input={shelfEntryId:row.shelf_entry_id,actorId:row.actor_id,idempotencyKey:row.idempotency_key,previewId:row.preview_id,
      basisDigest:row.basis_digest,proposalDigest:row.proposal_digest,placementPreviewDigest:row.placement_preview_digest},
      requestDigest=canonicalDigest({schema:'arca.jav-correction-admission-command@1',...input}),
      expectedId='arca-jav-correction-'+canonicalDigest({shelfEntryId:input.shelfEntryId,actorId:input.actorId,idempotencyKey:input.idempotencyKey}).slice(0,40);
    if(row.preview_proof_schema_ref!==PROOF_SCHEMA||canonicalJson(proof)!==row.preview_proof_json||row.correction_id!==expectedId||
        proof.basis.shelfEntryId!==row.shelf_entry_id||proof.basis.basisDigest!==row.basis_digest||proof.proposal.proposalDigest!==row.proposal_digest||
        proof.placementPreviewDigest!==row.placement_preview_digest||row.admission_digest!==canonicalDigest({schema:'arca.jav-correction-admission@1',correctionId:expectedId,requestDigest,proof}))
      fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Stored correction does not conserve its immutable admission.');
    const record={correctionId:row.correction_id,shelfEntryId:row.shelf_entry_id,actorId:row.actor_id,admissionDigest:row.admission_digest,
      state:row.state,stateRevision:Number(row.state_revision),proof,createdAtMs:Number(row.created_at_ms),updatedAtMs:Number(row.updated_at_ms),
      terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms),terminalEvidenceDigest:row.terminal_evidence_digest};
    let committedContext=null;
    if(record.state==='committed'){
      try{committedContext=JSON.parse(row.committed_context_json);}catch{fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Committed correction context is invalid.');}
      options.contractValidator.validate(CONTEXT_SCHEMA,committedContext);
      if(row.committed_context_schema_ref!==CONTEXT_SCHEMA||canonicalJson(committedContext)!==row.committed_context_json||committedContext.contextDigest!==row.committed_context_digest)
        fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Committed correction context lost its exact schema and canonical digest.');
      assertJavCorrectionCommittedContext(committedContext,record);
    }else if([row.committed_context_schema_ref,row.committed_context_json,row.committed_context_digest].some(value=>value!==null))
      fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Uncommitted correction cannot carry committed cleanup provenance.');
    let cleanupReceipt=null;
    if(record.state==='committed'&&!['pending','active','attention_required','completed'].includes(row.cleanup_state))fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Committed correction has no valid cleanup responsibility.');
    if(row.cleanup_state==='completed'){
      try{cleanupReceipt=JSON.parse(row.cleanup_receipt_json);}catch{fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Cleanup Receipt JSON is corrupt.');}
      const schema='helix://contracts/application-types/ArcaJavCorrectionCleanupReceipt/v1';options.contractValidator.validate(schema,cleanupReceipt);
      const {receiptDigest,...body}=cleanupReceipt;
      if(row.cleanup_receipt_schema_ref!==schema||canonicalJson(cleanupReceipt)!==row.cleanup_receipt_json||receiptDigest!==canonicalDigest(body)||receiptDigest!==row.cleanup_receipt_digest||
          cleanupReceipt.correctionId!==record.correctionId||cleanupReceipt.shelfEntryId!==record.shelfEntryId||cleanupReceipt.committedContextDigest!==committedContext.contextDigest||
          cleanupReceipt.identityCommitReceiptDigest!==committedContext.receiptDigest)fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Cleanup Receipt does not conserve its exact committed provenance.');
    }else if([row.cleanup_receipt_schema_ref,row.cleanup_receipt_json,row.cleanup_receipt_digest].some(value=>value!==null))
      fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Unfinished cleanup cannot carry a completed Receipt.');
    let recoveryIntent=null;
    if(row.recovery_intent_json!==null){
      try{recoveryIntent=JSON.parse(row.recovery_intent_json);}catch{fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery Intent JSON is corrupt.');}
      options.contractValidator.validate(RECOVERY_SCHEMA,recoveryIntent);assertJavCorrectionRecoveryReceipt(recoveryIntent,record);
      if(row.recovery_intent_schema_ref!==RECOVERY_SCHEMA||canonicalJson(recoveryIntent)!==row.recovery_intent_json||recoveryIntent.receiptDigest!==row.recovery_intent_digest)
        fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery Intent lost its exact nominal schema or receipt digest.');
      const history=repo.invoke('find_recovery_intent',{recovery_id:recoveryIntent.recoveryId});
      let observation;try{observation=JSON.parse(history?.observation_json);}catch{fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery observation history is missing or corrupt.');}
      options.contractValidator.validate(OBSERVATION_SCHEMA,observation);
      const {observationDigest,...body}=observation;
      if(history.receipt_schema_ref!==RECOVERY_SCHEMA||history.receipt_json!==row.recovery_intent_json||history.receipt_digest!==recoveryIntent.receiptDigest||
          history.observation_schema_ref!==OBSERVATION_SCHEMA||canonicalJson(observation)!==history.observation_json||canonicalDigest(body)!==observationDigest||
          history.observation_digest!==observationDigest||observationDigest!==recoveryIntent.observationDigest||history.correction_id!==record.correctionId||
          history.shelf_entry_id!==record.shelfEntryId||history.previous_intent_digest!==recoveryIntent.previousIntentDigest||
          Number(history.created_at_ms)!==recoveryIntent.admittedAtMs||canonicalDigest(observation.realityObservation)!==recoveryIntent.realityDigest)
        fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery Intent does not conserve its immutable observation and execution evidence.');
    }else if(row.recovery_intent_schema_ref!==null||row.recovery_intent_digest!==null)
      fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery Intent columns must be all present or all absent.');
    return Object.freeze({...record,committedContext,cleanupState:row.cleanup_state,cleanupReceipt,recoveryIntent});
  }
  function read(body) {return options.unitOfWork.execute([{participantId:'arca_jav_correction_read',owner:'arca',repositories:[definition],
    execute:context=>body(context.repository(definition.repositoryId))}]).arca_jav_correction_read;}
  function get(correctionId){return read(repo=>decode(repo.invoke('find_correction',{correction_id:correctionId}),repo));}
  function cancellationValidation(input){
    const reads=createRepositoryDefinition({repositoryId:'arca_jav_cancel_basis_read',owner:'arca',schemaManifest:options.schemaManifest,
        statements:{...inventoryContextStatements,...intentReads,find_correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns,keyColumns:['correction_id'],safeIntegers:true}}});
    let record,raw,cases,basis,observation,recoveryHistory;
    const assertCurrent=current=>{
      if(!current||current.shelfEntryId!==input.shelfEntryId)fail('ARCA_JAV_CORRECTION_NOT_FOUND','Correction does not belong to this Entry.');
      if(current.state!=='attention_required'||current.stateRevision!==input.expectedStateRevision||current.admissionDigest!==input.expectedAdmissionDigest||
          current.terminalAtMs!==null)fail('ARCA_JAV_CORRECTION_CANCEL_STALE','Correction cancellation no longer matches its expected state.');
    },ownerRead={participantId:'arca_jav_cancel_basis_read',owner:'arca',repositories:[reads],execute(context){const repo=context.repository(reads.repositoryId);
      record=decode(repo.invoke('find_correction',{correction_id:input.correctionId}),repo);assertCurrent(record);
      const rows=repo.invoke('list_recovery_receipts',{correction_id:record.correctionId,offset:0,limit:64});
      if(rows.length>63)fail('ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN','Source-only recovery lineage exceeds its observation bound.');
      recoveryHistory=rows.map(row=>{
        let receipt;try{receipt=JSON.parse(row.receipt_json);}catch{fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery history Receipt is invalid.');}
        options.contractValidator.validate(RECOVERY_SCHEMA,receipt);assertJavCorrectionRecoveryReceipt(receipt,record);
        if(row.receipt_schema_ref!==RECOVERY_SCHEMA||canonicalJson(receipt)!==row.receipt_json||receipt.receiptDigest!==row.receipt_digest||
            receipt.recoveryId!==row.recovery_id||receipt.correctionId!==row.correction_id||receipt.shelfEntryId!==row.shelf_entry_id||receipt.previousIntentDigest!==row.previous_intent_digest)
          fail('ARCA_JAV_CORRECTION_RECORD_CORRUPT','Recovery history Receipt lost its exact owner and digest.');return receipt;
      });
      raw=currentContext(repo,input.shelfEntryId);cases=repo.invoke('list_cases',{shelf_entry_id:input.shelfEntryId});
      if(pendingJavCorrection(repo.invoke('list_jav_correction_gates',{shelf_entry_id:input.shelfEntryId}))?.correction_id!==input.correctionId)
        fail('ARCA_JAV_CORRECTION_CANCEL_STALE','Correction no longer owns its Entry gate.');
    }},controlRead=createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_jav_cancel_control_read',
      materialKeys:()=>record.proof.basis.materials.map(row=>row.physicalIdentity.materialKey).sort(),accept:projections=>{
        basis=buildJavCorrectionBasis({raw,controlProjections:projections,activeCases:cases});
        if(basis.basisDigest!==record.proof.basis.basisDigest)fail('ARCA_JAV_CORRECTION_CANCEL_STALE','Owned collection or Control changed after admission.');
      }}),noEffect=require('./jav-correction-no-effect-reader').createJavCorrectionNoEffectReader(options).participant({record:()=>record,
        currentBasisDigest:()=>basis.basisDigest,recoveryHistory:()=>recoveryHistory,accept:value=>{observation=value;}});
    return {participants:[ownerRead,controlRead,noEffect],assertCurrent,observation:()=>observation};
  }
  function cancellationAvailability(record){
    if(record.state!=='attention_required')return Object.freeze({available:false,reasonCode:'not_attention_required'});
    const validation=cancellationValidation({shelfEntryId:record.shelfEntryId,correctionId:record.correctionId,
      expectedStateRevision:record.stateRevision,expectedAdmissionDigest:record.admissionDigest});
    try{options.unitOfWork.execute(validation.participants);return Object.freeze({available:true,reasonCode:null});}
    catch(error){
      if(error.code==='ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN')return Object.freeze({available:false,reasonCode:'no_effect_unproven'});
      if(['ARCA_JAV_CORRECTION_CANCEL_STALE','ARCA_JAV_CORRECTION_BUSY','ARCA_JAV_CORRECTION_INELIGIBLE','ARCA_JAV_CORRECTION_CONTROL_INVALID'].includes(error.code))
        return Object.freeze({available:false,reasonCode:'collection_basis_changed'});
      throw error;
    }
  }
  function admitRecovery(input,preparation){
    const fields=['shelfEntryId','correctionId','actorId','idempotencyKey','expectedStateRevision','expectedAdmissionDigest','expectedCleanupState','expectedRecoveryIntentDigest'];
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).length!==fields.length||fields.some(key=>!Object.hasOwn(input,key))||
        fields.slice(0,4).some(key=>!text(input[key]))||!Number.isSafeInteger(input.expectedStateRevision)||input.expectedStateRevision<1||!hex(input.expectedAdmissionDigest)||
        ![null,'attention_required'].includes(input.expectedCleanupState)||input.expectedRecoveryIntentDigest!==null&&!hex(input.expectedRecoveryIntentDigest))
      fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Recovery requires the exact current correction and previous Intent.');
    const commandId='arca-jav-recovery-'+canonicalDigest({correctionId:input.correctionId,actorId:input.actorId,idempotencyKey:input.idempotencyKey}).slice(0,40),
      requestDigest=canonicalDigest({schema:'arca.jav-correction-recovery-command@1',...input}),
      reads=createRepositoryDefinition({repositoryId:'arca_jav_recovery_owner_read',owner:'arca',readOnly:true,schemaManifest:options.schemaManifest,
        statements:{...inventoryContextStatements,...intentReads,correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns,keyColumns:['correction_id'],safeIntegers:true}}}),
      rootRead=createRepositoryDefinition({repositoryId:'arca_jav_recovery_root_read',owner:'platform-settings',readOnly:true,schemaManifest:options.schemaManifest,
        statements:{root:{kind:'select-one',tableId:'platform_workspace_roots',columns:['root_id','owner_scope','state','root_handle_ref','config_revision','endpoint_id','mount_scope_id','resolved_root','snapshot_digest'],keyColumns:['root_id']}}});
    let record,raw,cases,basis,execution;
    const validations=[{participantId:'arca_jav_recovery_owner_validation',owner:'arca',repositories:[reads],execute(context){
      if(!preparation)fail('ARCA_JAV_CORRECTION_RECOVERY_PREPARATION_REQUIRED','A new recovery command requires a current server observation.');
      const repo=context.repository(reads.repositoryId);record=decode(repo.invoke('correction',{correction_id:input.correctionId}),repo);
      if(!record||record.shelfEntryId!==input.shelfEntryId)fail('ARCA_JAV_CORRECTION_NOT_FOUND','Correction was not found for this Entry.');
      if(!recoveryMode(record)||record.stateRevision!==input.expectedStateRevision||record.admissionDigest!==input.expectedAdmissionDigest||
          record.cleanupState!==input.expectedCleanupState||(record.recoveryIntent?.receiptDigest||null)!==input.expectedRecoveryIntentDigest)
        fail('ARCA_JAV_CORRECTION_RECOVERY_STALE','Correction recovery state changed.');
      if(pendingJavCorrection(repo.invoke('list_jav_correction_gates',{shelf_entry_id:input.shelfEntryId}))?.correction_id!==input.correctionId)
        fail('ARCA_JAV_CORRECTION_RECOVERY_STALE','Correction no longer holds its Entry gate.');
      raw=currentContext(repo,input.shelfEntryId);cases=repo.invoke('list_cases',{shelf_entry_id:input.shelfEntryId});
    }}];
    if(preparation){
      if(!hex(preparation.executionSnapshotDigest)||!hex(preparation.currentBasisDigest))fail('ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN','Recovery observation is incomplete.');
      validations.push(createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_jav_recovery_control_validation',
        materialKeys:()=>[...new Set(raw.materials.map(item=>item.material_key))].sort(),accept:projections=>{
          basis=buildJavCorrectionBasis({raw,controlProjections:projections,activeCases:cases});
          if(basis.basisDigest!==preparation.currentBasisDigest||record.state!=='committed'&&basis.basisDigest!==record.proof.basis.basisDigest)
            fail('ARCA_JAV_CORRECTION_RECOVERY_STALE','Current Entry Basis or Material Control changed.');
        }}));
      validations.push(createJavCorrectionRecoveryReader(options).participant({record:()=>record,expectedDigest:preparation.executionSnapshotDigest,accept:value=>{execution=value;}}));
      validations.push({participantId:'arca_jav_recovery_root_validation',owner:'platform-settings',boundBusinessOwner:'arca',repositories:[rootRead],execute(context){
        const expected=options.rootSnapshot,row=context.repository(rootRead.repositoryId).invoke('root',{root_id:expected.rootId});
        if(!row||row.owner_scope!=='arca'||row.state!=='active'||row.root_handle_ref!==expected.rootHandleRef||Number(row.config_revision)!==expected.configRevision||
            row.endpoint_id!==expected.endpointId||row.mount_scope_id!==expected.mountScopeId||row.resolved_root!==expected.resolvedRoot||row.snapshot_digest!==expected.snapshotDigest)
          fail('ARCA_JAV_CORRECTION_RECOVERY_STALE','Correction Workspace root changed.');
      }});
    }
    return coordinator.execute({command:{commandReceiptId:commandId,ownerDomain:'arca',commandContract:'arca.jav-identity-correction.recover@1',callerScope:input.actorId,
      idempotencyKey:canonicalDigest({correctionId:input.correctionId,idempotencyKey:input.idempotencyKey}),requestDigest,targetType:'jav_identity_correction',targetId:input.correctionId},
      validationParticipants:validations,domainParticipant:{participantId:'arca_jav_recovery_admission',owner:'arca',repositories:[definition],execute(context){
        if(!basis||!execution)fail('ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN','Recovery command has no current Owner and execution proof.');
        options.contractValidator.validate(OBSERVATION_SCHEMA,preparation.observation);
        if(canonicalJson(preparation.observation.executionSnapshot)!==canonicalJson(execution.snapshot))
          fail('ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN','Recovery observation must retain the exact freshly verified execution snapshot.');
        const receipt=buildJavCorrectionRecoveryReceipt({record,command:input,observation:preparation.observation,admittedAtMs:context.commitTimeMs});
        options.contractValidator.validate(RECOVERY_SCHEMA,receipt);
        const failed=execution.snapshot.works.find(work=>work.work_id===receipt.failedWorkId),replacement=receipt.workLineage.find(item=>item.previousWorkId===receipt.failedWorkId);
        if(!failed||failed.state!=='failed'||failed.work_kind!==replacement?.workKind||failed.basis_digest!==receipt.scopeDigest||
            failed.definition_digest!==receipt.failedWorkDefinitionDigest||receipt.failedExecutionEvidenceDigest!==execution.workEvidence(receipt.failedWorkId))
          fail('ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN','Failed execution proof changed.');
        if(receipt.sourceResultReference)execution.source(receipt.sourceResultReference);
        const repo=context.repository(definition.repositoryId);
        repo.invoke('insert_recovery_intent',{recovery_id:receipt.recoveryId,correction_id:record.correctionId,shelf_entry_id:record.shelfEntryId,
          previous_intent_digest:receipt.previousIntentDigest,receipt_schema_ref:RECOVERY_SCHEMA,receipt_json:canonicalJson(receipt),receipt_digest:receipt.receiptDigest,
          observation_schema_ref:OBSERVATION_SCHEMA,observation_json:canonicalJson(preparation.observation),observation_digest:receipt.observationDigest,created_at_ms:context.commitTimeMs});
        const changed=repo.invoke('admit_recovery',{correction_id:record.correctionId,
          state:receipt.mode==='continue_correction'?'active':'committed',state_revision:receipt.acceptedStateRevision,
          cleanup_state:receipt.mode==='continue_cleanup'?'active':null,recovery_intent_schema_ref:RECOVERY_SCHEMA,recovery_intent_json:canonicalJson(receipt),recovery_intent_digest:receipt.receiptDigest,
          updated_at_ms:context.commitTimeMs,expected_state:record.state,expected_state_revision:record.stateRevision,expected_admission_digest:record.admissionDigest,
          expected_cleanup_state:record.cleanupState,expected_recovery_intent_digest:record.recoveryIntent?.receiptDigest||null});
        if(changed.changes!==1)fail('ARCA_JAV_CORRECTION_RECOVERY_STALE','Correction recovery CAS lost its current state.');return receipt;
      }},commitMarker:{commitMarker:commandId,scopeType:'jav_identity_correction',scopeId:input.correctionId,commitDigest:requestDigest},
      auditRecords:[{auditId:commandId+'-audit',actorType:'user',actorId:input.actorId,action:'recover_jav_identity_correction',scopeType:'shelf_entry',scopeId:input.shelfEntryId,evidenceDigest:input.expectedAdmissionDigest}],
      resultEnvelope:receipt=>({resultSchemaRef:RECOVERY_SCHEMA,resultRef:receipt})});
  }
  function cancelNoEffect(input){
    const fields=['shelfEntryId','correctionId','actorId','idempotencyKey','expectedStateRevision','expectedAdmissionDigest'];
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).length!==fields.length||fields.some(key=>!Object.hasOwn(input,key))||
        fields.slice(0,4).some(key=>!text(input[key]))||!Number.isSafeInteger(input.expectedStateRevision)||input.expectedStateRevision<1||!hex(input.expectedAdmissionDigest))
      fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Cancellation requires the exact Entry, correction, expected revision, admission and command key.');
    const {SCHEMA,buildJavCorrectionCancellationReceipt}=require('../model/jav-correction-cancellation'),validation=cancellationValidation(input),
      requestDigest=canonicalDigest({schema:'arca.jav-correction-cancel-command@1',...input}),
      commandId='arca-jav-cancel-'+canonicalDigest({correctionId:input.correctionId,actorId:input.actorId,idempotencyKey:input.idempotencyKey}).slice(0,40);
    return coordinator.execute({command:{commandReceiptId:commandId,ownerDomain:'arca',commandContract:'arca.jav-identity-correction.cancel-no-effect@1',
      callerScope:input.actorId,idempotencyKey:canonicalDigest({correctionId:input.correctionId,idempotencyKey:input.idempotencyKey}),requestDigest,
      targetType:'shelf_entry',targetId:input.shelfEntryId},validationParticipants:validation.participants,
      domainParticipant:{participantId:'arca_jav_cancel_commit',owner:'arca',repositories:[definition],execute(context){const repo=context.repository(definition.repositoryId),
        current=decode(repo.invoke('find_correction',{correction_id:input.correctionId}),repo);validation.assertCurrent(current);
        const receipt=buildJavCorrectionCancellationReceipt(current,validation.observation(),context.commitTimeMs);options.contractValidator.validate(SCHEMA,receipt);
        if(repo.invoke('cancel_correction',{correction_id:input.correctionId,state:'cancelled',state_revision:receipt.stateRevision,
          terminal_evidence_digest:receipt.receiptDigest,terminal_at_ms:context.commitTimeMs,updated_at_ms:context.commitTimeMs,expected_state:'attention_required',
          expected_state_revision:input.expectedStateRevision,expected_admission_digest:input.expectedAdmissionDigest}).changes!==1)
          fail('ARCA_JAV_CORRECTION_CANCEL_STALE','Correction cancellation CAS lost its current revision.');
        return receipt;
      }},commitMarker:{commitMarker:commandId,scopeType:'jav_identity_correction',scopeId:input.correctionId,commitDigest:requestDigest},
      auditRecords:[{auditId:commandId+'-audit',actorType:'user',actorId:input.actorId,action:'cancel_jav_correction_no_effect',scopeType:'shelf_entry',
        scopeId:input.shelfEntryId,evidenceDigest:input.expectedAdmissionDigest}],resultEnvelope:receipt=>({resultSchemaRef:SCHEMA,resultRef:receipt})});
  }
  function latest(shelfEntryId){return read(repo=>{if(!repo.invoke('find_entry',{shelf_entry_id:shelfEntryId}))fail('ARCA_SHELF_ENTRY_NOT_FOUND','Shelf Entry was not found.');
    return decode(repo.invoke('latest_correction',{shelf_entry_id:shelfEntryId,offset:0,limit:1})[0],repo);});}
  function listActivePage(cursor='',limit=100) {
    if(typeof cursor!=='string'||cursor.length>256||!Number.isSafeInteger(limit)||limit<1||limit>100)
      fail('ARCA_JAV_CORRECTION_PAGE_INVALID','Correction pagination requires a bounded cursor and limit.');
    return read(repo=>{const rows=repo.invoke('page_corrections',{rangeStart:'',rangeEnd:'\uffff',cursor,limit});
      return {items:rows.filter(row=>['admitted','active','attention_required'].includes(row.state)).map(row=>({correctionId:row.correction_id,state:row.state,stateRevision:Number(row.state_revision)})),
        nextCursor:rows.length===limit?rows.at(-1).correction_id:null};});
  }
  function listReconcilePage(cursor,limit=100) {
    if(cursor!==null&&typeof cursor!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100)
      fail('ARCA_JAV_CORRECTION_PAGE_INVALID','Correction reconciliation requires a bounded cursor and limit.');
    return read(repo=>repo.invoke('page_corrections',{rangeStart:'',rangeEnd:'\uffff',cursor:cursor||'',limit})
      .map(row=>({cursor:row.correction_id,scope:{correctionId:row.correction_id}})));
  }
  function transition(correctionId,{expectedState,expectedStateRevision,expectedAdmissionDigest,nextState}) {
    const allowed={admitted:['active'],active:['attention_required']};
    if(!allowed[expectedState]?.includes(nextState)||!Number.isSafeInteger(expectedStateRevision)||expectedStateRevision<1||!hex(expectedAdmissionDigest))
      fail('ARCA_JAV_CORRECTION_TRANSITION_INVALID','Correction lifecycle cannot publish success or cancel through an ordinary state update.');
    return options.unitOfWork.execute([{participantId:'arca_jav_correction_transition',owner:'arca',repositories:[definition],execute(context){
      const repo=context.repository(definition.repositoryId),current=decode(repo.invoke('find_correction',{correction_id:correctionId}),repo);
      if(!current||current.admissionDigest!==expectedAdmissionDigest)fail('ARCA_JAV_CORRECTION_TRANSITION_STALE','Correction admission changed.');
      if(current.state===nextState&&current.stateRevision===expectedStateRevision+1)return current;
      if(current.state!==expectedState||current.stateRevision!==expectedStateRevision||current.terminalAtMs!==null)
        fail('ARCA_JAV_CORRECTION_TRANSITION_STALE','Correction state changed concurrently.');
      const changed=repo.invoke('advance_correction',{correction_id:correctionId,state:nextState,state_revision:expectedStateRevision+1,updated_at_ms:context.commitTimeMs,
        expected_state:expectedState,expected_state_revision:expectedStateRevision});
      if(changed.changes!==1)fail('ARCA_JAV_CORRECTION_TRANSITION_STALE','Correction lifecycle CAS failed.');
      return decode(repo.invoke('find_correction',{correction_id:correctionId}),repo);
    }}]).arca_jav_correction_transition;
  }
  function admit(input,previewProof) {
    const fields=['shelfEntryId','actorId','idempotencyKey','previewId','basisDigest','proposalDigest','placementPreviewDigest'];
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).length!==fields.length||fields.some(key=>!Object.hasOwn(input,key))||
        fields.slice(0,4).some(key=>!text(input[key]))||fields.slice(4).some(key=>!hex(input[key])))
      fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Correction admission requires its exact bounded user preview references.');
    const requestDigest=canonicalDigest({schema:'arca.jav-correction-admission-command@1',...input}),
      correctionId='arca-jav-correction-'+canonicalDigest({shelfEntryId:input.shelfEntryId,actorId:input.actorId,idempotencyKey:input.idempotencyKey}).slice(0,40);
    // Preview reads use their own read transactions. The atomic coordinator still
    // decides replay and revalidates the current Entry and Control before commit.
    const currentPreview=typeof previewProof==='function'?(get(correctionId)?null:previewProof()):previewProof;
    let proof,raw,cases;
    const controlParticipant=createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_jav_correction_control_read',
      materialKeys:()=>proof.basis.materials.map(row=>row.physicalIdentity.materialKey).sort(),accept:projections=>{
        const current=buildJavCorrectionBasis({raw,controlProjections:projections,activeCases:cases});
        if(current.basisDigest!==proof.basis.basisDigest)fail('ARCA_JAV_CORRECTION_PREVIEW_STALE','Current Entry or Control changed after correction preview.');
      }});
    return coordinator.execute({command:{commandReceiptId:correctionId+'-admission',ownerDomain:'arca',commandContract:COMMAND,
      callerScope:input.actorId,idempotencyKey:canonicalDigest({shelfEntryId:input.shelfEntryId,idempotencyKey:input.idempotencyKey}),requestDigest,targetType:'shelf_entry',targetId:input.shelfEntryId},
      controlParticipant,domainParticipant:{participantId:'arca_jav_correction_admission',owner:'arca',repositories:[definition],execute(context){
        if(!currentPreview||Object.getPrototypeOf(currentPreview)!==Object.prototype)fail('ARCA_JAV_CORRECTION_PREVIEW_EXPIRED','A new correction admission requires a current server preview.');
        proof=JSON.parse(canonicalJson(currentPreview));options.contractValidator.validate(PROOF_SCHEMA,proof);
        if(Buffer.byteLength(canonicalJson(proof))>2*1024*1024||proof.basis.shelfEntryId!==input.shelfEntryId||proof.basis.basisDigest!==input.basisDigest||
            proof.proposal.proposalDigest!==input.proposalDigest||proof.placementPreviewDigest!==input.placementPreviewDigest)
          fail('ARCA_JAV_CORRECTION_PREVIEW_STALE','Correction admission does not match its server preview.');
        const expectedProposal=buildJavCorrectionProposal({basis:proof.basis,...proof.proposal.sourceQualification});
        if(canonicalJson(expectedProposal)!==canonicalJson(proof.proposal)||proof.placementPreviewDigest!==canonicalDigest({shelfEntryId:input.shelfEntryId,
            basisDigest:proof.basis.basisDigest,proposalDigest:proof.proposal.proposalDigest,paths:proof.paths,targetRealityDigest:proof.targetRealityDigest})||
            proof.paths.length!==proof.basis.materials.length||new Set(proof.paths.map(row=>row.materialKey)).size!==proof.paths.length||
            proof.paths.some(row=>!proof.basis.materials.some(material=>material.physicalIdentity.materialKey===row.materialKey&&material.role===row.role&&material.location===row.previousLocation)))
          fail('ARCA_JAV_CORRECTION_PREVIEW_STALE','Correction proof must conserve the complete owned video and material set.');
        const repo=context.repository(definition.repositoryId);
        if(pendingJavCorrection(repo.invoke('list_corrections',{shelf_entry_id:input.shelfEntryId})))
          fail('ARCA_JAV_CORRECTION_BUSY','A correction is already pending for this Entry.');
        raw=currentContext(repo,input.shelfEntryId);cases=repo.invoke('list_cases',{shelf_entry_id:input.shelfEntryId});
        const admissionDigest=canonicalDigest({schema:'arca.jav-correction-admission@1',correctionId,requestDigest,proof}),at=context.commitTimeMs;
        repo.invoke('insert_correction',{correction_id:correctionId,shelf_entry_id:input.shelfEntryId,preview_id:input.previewId,
          preview_proof_schema_ref:PROOF_SCHEMA,preview_proof_json:canonicalJson(proof),basis_digest:input.basisDigest,proposal_digest:input.proposalDigest,
          placement_preview_digest:input.placementPreviewDigest,actor_id:input.actorId,idempotency_key:input.idempotencyKey,admission_digest:admissionDigest,
          state:'admitted',state_revision:1,terminal_evidence_digest:null,committed_context_schema_ref:null,committed_context_json:null,committed_context_digest:null,
          cleanup_state:null,cleanup_receipt_schema_ref:null,cleanup_receipt_json:null,cleanup_receipt_digest:null,
          recovery_intent_schema_ref:null,recovery_intent_json:null,recovery_intent_digest:null,created_at_ms:at,updated_at_ms:at,terminal_at_ms:null});
        const receipt={schemaRef:RECEIPT_SCHEMA,schemaVersion:1,correctionId,shelfEntryId:input.shelfEntryId,state:'admitted',stateRevision:1,
          basisDigest:input.basisDigest,proposalDigest:input.proposalDigest,placementPreviewDigest:input.placementPreviewDigest,admissionDigest,admittedAtMs:at};
        options.contractValidator.validate(RECEIPT_SCHEMA,receipt);return Object.freeze(receipt);
      }},commitMarker:{commitMarker:correctionId+'-admission',scopeType:'shelf_entry',scopeId:input.shelfEntryId,commitDigest:requestDigest},
      auditRecords:[{auditId:correctionId+'-admission-audit',actorType:'user',actorId:input.actorId,action:'admit_jav_identity_correction',
        scopeType:'shelf_entry',scopeId:input.shelfEntryId,evidenceDigest:input.proposalDigest}],resultEnvelope:receipt=>({resultSchemaRef:RECEIPT_SCHEMA,resultRef:receipt})});
  }
  function updateCleanupState(correctionId,{expectedState,nextState,contextDigest}){
    if(!({pending:['active'],active:['attention_required']})[expectedState]?.includes(nextState)||!hex(contextDigest))
      fail('ARCA_JAV_CORRECTION_TRANSITION_INVALID','Cleanup progress cannot publish completion or cancel.');
    return options.unitOfWork.execute([{participantId:'arca_jav_cleanup_progress',owner:'arca',repositories:[definition],execute(c){const r=c.repository(definition.repositoryId),
      record=decode(r.invoke('find_correction',{correction_id:correctionId}),r);
      if(record?.state!=='committed'||record.committedContext?.contextDigest!==contextDigest)fail('ARCA_JAV_CORRECTION_TRANSITION_STALE','Cleanup context changed.');
      if(record.cleanupState===nextState)return record;
      if(record.cleanupState!==expectedState||r.invoke('advance_cleanup',{correction_id:correctionId,cleanup_state:nextState,updated_at_ms:c.commitTimeMs,
          expected_state:'committed',expected_cleanup_state:expectedState,expected_context_digest:contextDigest}).changes!==1)
        fail('ARCA_JAV_CORRECTION_TRANSITION_STALE','Cleanup progress changed concurrently.');
      return decode(r.invoke('find_correction',{correction_id:correctionId}),r);
    }}]).arca_jav_cleanup_progress;
  }
  return Object.freeze({admit,get,latest,listActivePage,listReconcilePage,transition,updateCleanupState,cancelNoEffect,cancellationAvailability,admitRecovery});
}

module.exports=Object.freeze({createJavIdentityCorrectionStore});
