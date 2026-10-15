'use strict';
const path=require('node:path');

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {CAPABILITY:RECLAIM_CAPABILITY,RESULT_SCHEMA:RECLAIM_SCHEMA,workspaceReclaimOutcome}=require('../model/jav-correction-workspace-reclaim-contract');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const PROCESS='jav_identity_correction';
const registryColumns=['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state','created_at_ms','reclaim_after_ms','reclaimed_at_ms'];
const materialColumns=['workspace_id','material_handle_id','material_key','endpoint_id','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint',
  'relative_path','digest_algorithm','digest_hex','size_bytes','reference_revision','owner_domain','process_id','root_handle_ref','access_scope',
  'handle_schema_ref','handle_json','handle_digest','fence_digest','state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'];

function createJavCorrectionWorkspaceStore(options) {
  const root=options.rootSnapshot;
  if(!root?.rootId||!root.rootHandleRef||!root.endpointId||!root.mountScopeId||typeof root.resolvedRoot!=='string'||!path.isAbsolute(root.resolvedRoot)||!Number.isSafeInteger(root.configRevision)||root.configRevision<1||!options.contractValidator)
    throw new TypeError('Correction Workspace requires its registered Platform root snapshot and nominal validation.');
  const arca=createRepositoryDefinition({repositoryId:'arca_jav_correction_workspace_scope',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find_correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns:['correction_id','shelf_entry_id','state','state_revision','admission_digest','terminal_at_ms','cleanup_state','committed_context_digest'],keyColumns:['correction_id']},
  }}),platform=createRepositoryDefinition({repositoryId:'arca_jav_correction_workspace_root',owner:'platform-settings',schemaManifest:options.schemaManifest,statements:{
    find_root:{kind:'select-one',tableId:'platform_workspace_roots',columns:['root_id','owner_scope','endpoint_id','mount_scope_id','resolved_root','root_handle_ref','config_revision','snapshot_digest','state'],keyColumns:['root_id'],safeIntegers:true},
  }}),foundationStatements={
    find_registry:{kind:'select-one',tableId:'fx_workspace_registry',columns:registryColumns,keyColumns:['workspace_id'],safeIntegers:true},
    insert_registry:{kind:'insert',tableId:'fx_workspace_registry',columns:registryColumns},
    find_material:{kind:'select-one',tableId:'fx_workspace_materials',columns:materialColumns,keyColumns:['workspace_id','material_handle_id'],safeIntegers:true},
    find_path:{kind:'select-one',tableId:'fx_workspace_materials',columns:['material_handle_id','handle_digest','state'],keyColumns:['workspace_id','relative_path']},
    insert_material:{kind:'insert',tableId:'fx_workspace_materials',columns:materialColumns},
    list_materials:{kind:'select-all',tableId:'fx_workspace_materials',columns:materialColumns,keyColumns:['workspace_id'],safeIntegers:true},
    list_artifacts:{kind:'select-all',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','storage_ref','digest_hex','size_bytes','state'],keyColumns:['owner_domain','owner_scope_type','owner_scope_id'],safeIntegers:true},
    find_artifact:{kind:'select-one',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state'],keyColumns:['artifact_handle_id'],safeIntegers:true},
    insert_artifact:{kind:'insert',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state','created_at_ms']},
    reclaim_material:{kind:'update',tableId:'fx_workspace_materials',setColumns:['state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'],keyColumns:['workspace_id','material_handle_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'handle_digest',parameter:'expected_handle_digest'},{column:'fence_digest',parameter:'expected_fence_digest'}]},
    reclaim_artifact:{kind:'update',tableId:'fx_artifact_registry',setColumns:['state','reference_revision'],keyColumns:['artifact_handle_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'reference_revision',parameter:'expected_reference_revision'}]},
    reclaim_registry:{kind:'update',tableId:'fx_workspace_registry',setColumns:['state','reclaimed_at_ms'],keyColumns:['workspace_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    find_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','work_kind','basis_digest','state'],keyColumns:['work_id']},
    find_event:{kind:'select-one',tableId:'fx_workflow_events',columns:['event_id','work_id','capability_ref','state'],keyColumns:['event_id']},
    find_attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']},
    find_effect:{kind:'select-one',tableId:'fx_effect_journal',columns:['effect_id','event_attempt_id','effect_class','idempotency_key'],keyColumns:['effect_id']},
    find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'],keyColumns:['event_id'],safeIntegers:true},
    find_marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'],keyColumns:['commit_marker'],safeIntegers:true},
    insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
    insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
  };
  const foundation=createRepositoryDefinition({repositoryId:'arca_jav_correction_workspace_registry',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:foundationStatements}),
    recoveryReads=createRepositoryDefinition({repositoryId:'arca_jav_correction_workspace_recovery_read',owner:'execution-foundation',schemaManifest:options.schemaManifest,
      statements:Object.fromEntries(Object.entries(foundationStatements).filter(([,statement])=>statement.kind.startsWith('select-')))});
  function execute(correctionId,admissionDigest,body,committedContextDigest=null,commitFence=null,recoveryRead=false) {
    const access=recoveryRead?recoveryReads:foundation;
    return options.unitOfWork.execute([
      {participantId:'arca_correction_workspace_admission',owner:'arca',repositories:[arca],execute(context){
        const row=context.repository(arca.repositoryId).invoke('find_correction',{correction_id:correctionId});
        const authorized=recoveryRead?
          row?.state==='attention_required'&&row.terminal_at_ms===null&&row.admission_digest===admissionDigest:committedContextDigest===null?
          row?.state==='active'&&row.terminal_at_ms===null&&row.admission_digest===admissionDigest:
          row?.state==='committed'&&row.terminal_at_ms!==null&&['pending','active','attention_required'].includes(row.cleanup_state)&&
            /^[a-f0-9]{64}$/.test(committedContextDigest)&&row.committed_context_digest===committedContextDigest;
        if(!authorized)
          fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Correction no longer owns an active Workspace admission.');
        if(commitFence&&(row.state_revision!==commitFence.scope.revision||row.shelf_entry_id!==commitFence.scope.shelfEntryId||row.admission_digest!==commitFence.admissionDigest))
          fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Committed Workspace scope revision or admission changed.');
      }},
      {participantId:'arca_correction_workspace_root',owner:'platform-settings',boundBusinessOwner:'arca',repositories:[platform],execute(context){
        const row=context.repository(platform.repositoryId).invoke('find_root',{root_id:root.rootId});
        if(!row||row.owner_scope!=='arca'||row.state!=='active'||row.root_handle_ref!==root.rootHandleRef||Number(row.config_revision)!==root.configRevision||
            row.endpoint_id!==root.endpointId||row.mount_scope_id!==root.mountScopeId||row.resolved_root!==root.resolvedRoot||row.snapshot_digest!==root.snapshotDigest)
          fail('ARCA_JAV_CORRECTION_WORKSPACE_ROOT_STALE','Correction Workspace root changed.');
      }},
      {participantId:'arca_correction_workspace_registry',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[access],
        execute:context=>body(context.repository(access.repositoryId),context.commitTimeMs)},
    ]).arca_correction_workspace_registry;
  }
  const workspaceId=correctionId=>correctionId+'-assets';
  function ensureRegistry(repo,correctionId,at) {
    const id=workspaceId(correctionId),existing=repo.invoke('find_registry',{workspace_id:id});
    if(existing) {
      if(existing.owner_domain!=='arca'||existing.process_type!==PROCESS||existing.process_id!==correctionId||existing.root_handle_ref!==root.rootHandleRef||
          existing.state!=='active'||existing.reclaim_after_ms!==null)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_CONFLICT','Correction Workspace registry conflicts with its exact process.');
      return existing;
    }
    repo.invoke('insert_registry',{workspace_id:id,owner_domain:'arca',process_type:PROCESS,process_id:correctionId,root_handle_ref:root.rootHandleRef,
      state:'active',created_at_ms:at,reclaim_after_ms:null,reclaimed_at_ms:null});
    return repo.invoke('find_registry',{workspace_id:id});
  }
  function ensure(correctionId,admissionDigest){return execute(correctionId,admissionDigest,(repo,at)=>ensureRegistry(repo,correctionId,at));}
  function inspectUsing(correctionId,admissionDigest,recoveryRead=false) {
    return execute(correctionId,admissionDigest,repo=>{
      const registry=repo.invoke('find_registry',{workspace_id:workspaceId(correctionId)}),
        rows=repo.invoke('list_materials',{workspace_id:workspaceId(correctionId)}),
        artifacts=repo.invoke('list_artifacts',{owner_domain:'arca',owner_scope_type:PROCESS,owner_scope_id:correctionId});
      if(rows.length>4||artifacts.length>3||registry&&(registry.owner_domain!=='arca'||registry.process_type!==PROCESS||registry.process_id!==correctionId||
          registry.root_handle_ref!==root.rootHandleRef||registry.state!=='active')||!registry&&(rows.length||artifacts.length))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Recovery registry differs from this active exact correction scope.');
      const members=rows.map(row=>{
        const handle=JSON.parse(row.handle_json);options.contractValidator.validate('helix://contracts/types/WorkspaceMaterialHandle/v1',handle);
        if(row.state!=='active'||row.handle_digest!==canonicalDigest(handle)||row.fence_digest!==handle.fenceDigest||row.owner_domain!=='arca'||
            row.process_id!==correctionId||row.root_handle_ref!==root.rootHandleRef||handle.processId!==correctionId||handle.rootHandleRef!==root.rootHandleRef||
            handle.workspaceId!==workspaceId(correctionId)||handle.relativePath!==row.relative_path)
          fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Recovery material differs from its immutable registered Handle.');
        const kind=handle.relativePath.split('/')[0],artifact=artifacts.find(item=>item.artifact_kind===kind);
        if(kind!=='metadata'&&(!artifact||artifact.state!=='active'||artifact.digest_hex!==handle.digestHex||Number(artifact.size_bytes)!==handle.sizeBytes||
            artifact.storage_ref!==path.resolve(root.resolvedRoot,handle.workspaceId,...handle.relativePath.split('/')).split(path.sep).join('/')))
          fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Recovery Artifact registration differs from its Workspace material.');
        return handle;
      });
      if(artifacts.some(item=>!members.some(handle=>handle.relativePath.split('/')[0]===item.artifact_kind)))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Recovery Artifact has no registered Workspace material.');
      return {registryExists:Boolean(registry),members};
    },null,null,recoveryRead);
  }
  const inspect=(correctionId,admissionDigest)=>inspectUsing(correctionId,admissionDigest,false),inspectRecovery=(correctionId,admissionDigest)=>inspectUsing(correctionId,admissionDigest,true);
  function resolveUsing(correctionId,admissionDigest,handle,recoveryRead=false) {
    options.contractValidator.validate('helix://contracts/types/WorkspaceMaterialHandle/v1',handle);
    if(handle.workspaceId!==workspaceId(correctionId)||handle.processId!==correctionId||handle.ownerDomain!=='arca'||handle.rootHandleRef!==root.rootHandleRef)
      fail('ARCA_JAV_CORRECTION_WORKSPACE_HANDLE_INVALID','Workspace read is outside this correction scope.');
    return execute(correctionId,admissionDigest,repo=>{
      const registry=repo.invoke('find_registry',{workspace_id:handle.workspaceId}),
        row=repo.invoke('find_material',{workspace_id:handle.workspaceId,material_handle_id:handle.handleId});
      if(!registry||registry.state!=='active'||registry.owner_domain!=='arca'||registry.process_type!==PROCESS||registry.process_id!==correctionId||
          registry.root_handle_ref!==root.rootHandleRef||!row||row.state!=='active'||row.handle_digest!==canonicalDigest(handle)||row.fence_digest!==handle.fenceDigest||
          row.root_handle_ref!==root.rootHandleRef||row.owner_domain!=='arca'||row.process_id!==correctionId)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Correction Workspace read requires its exact active registered handle.');
      const location=path.resolve(root.resolvedRoot,handle.workspaceId,...handle.relativePath.split('/')),
        expected=path.resolve(root.resolvedRoot,handle.workspaceId);
      if(!location.startsWith(expected+path.sep))fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Workspace read escaped its correction root.');
      return Object.freeze({workspaceMaterialHandle:handle,location,rootHandleRef:root.rootHandleRef});
    },null,null,recoveryRead);
  }
  const resolve=(correctionId,admissionDigest,handle)=>resolveUsing(correctionId,admissionDigest,handle,false),resolveRecovery=(correctionId,admissionDigest,handle)=>resolveUsing(correctionId,admissionDigest,handle,true);
  function boundReclamation(repo,eventId,correctionId,committedContextDigest){
    const row=repo.invoke('find_result',{event_id:eventId});if(!row)return null;
    const denied=()=>fail('ARCA_JAV_CORRECTION_WORKSPACE_RECEIPT_INVALID','Workspace lifecycle lacks its exact atomic reclaim Receipt and marker.');
    if(row.outcome_kind!=='succeeded'||row.result_schema_ref!==RECLAIM_SCHEMA)denied();
    const result=JSON.parse(row.result_json);options.contractValidator.validate(RECLAIM_SCHEMA,result);
    const value=workspaceReclaimOutcome(result),ref=result.executionReference,event=repo.invoke('find_event',{event_id:eventId}),
      work=repo.invoke('find_work',{work_id:ref.workId}),attempt=repo.invoke('find_attempt',{event_attempt_id:ref.eventAttemptId}),
      marker=repo.invoke('find_marker',{commit_marker:value.effectReceipt.commitMarker}),effect=repo.invoke('find_effect',{effect_id:value.effectReceipt.effectId}),
      originalAttempt=effect&&repo.invoke('find_attempt',{event_attempt_id:effect.event_attempt_id});
    if(result.correctionId!==correctionId||result.scopeId!==correctionId||result.committedContextDigest!==committedContextDigest||ref.eventId!==eventId||
        event?.work_id!==ref.workId||event.capability_ref!==RECLAIM_CAPABILITY||attempt?.event_id!==eventId||
        work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==correctionId||work.work_kind!=='jav_correction_workspace_reclaim'||
        work.basis_digest!==result.scopeDigest||effect?.effect_class!=='workspace_write'||effect.idempotency_key!==ref.idempotencyKey||originalAttempt?.event_id!==eventId||
        row.result_json!==canonicalJson(result)||row.result_digest!==canonicalDigest(result)||row.evidence_schema_ref!==value.evidenceSchemaRef||
        row.evidence_json!==canonicalJson(value.evidence)||row.evidence_digest!==canonicalDigest(value.evidence)||row.effect_receipt_id!==result.effectReceiptRef||
        row.committed_at_ms!==BigInt(result.committedAtMs)||marker?.effect_id!==value.effectReceipt.effectId||marker.owner_domain!=='arca'||
        marker.scope_type!==result.scopeType||marker.scope_id!==correctionId||marker.result_id!==row.result_id||marker.result_schema_ref!==RECLAIM_SCHEMA||
        marker.result_digest!==row.result_digest||marker.commit_digest!==value.effectReceipt.verificationEvidenceDigest||marker.committed_at_ms!==BigInt(result.committedAtMs))denied();
    return value;
  }
  function inspectCommittedRegistry(repo,correctionId,committedContextDigest) {
      const registry=repo.invoke('find_registry',{workspace_id:workspaceId(correctionId)}),
        rows=repo.invoke('list_materials',{workspace_id:workspaceId(correctionId)}),
        artifacts=repo.invoke('list_artifacts',{owner_domain:'arca',owner_scope_type:PROCESS,owner_scope_id:correctionId});
      const denied=()=>fail('ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED','Committed correction must conserve its complete registered Workspace and Artifact set.');
      if(!registry||!['active','reclaimed'].includes(registry.state)||registry.owner_domain!=='arca'||registry.process_type!==PROCESS||registry.process_id!==correctionId||
          registry.root_handle_ref!==root.rootHandleRef||registry.reclaim_after_ms!==null||rows.length!==4||artifacts.length!==3)denied();
      let reclamation=null;
      if(registry.state==='reclaimed'){
        const effect=rows[0].reclaimed_effect_id&&repo.invoke('find_effect',{effect_id:rows[0].reclaimed_effect_id}),
          attempt=effect&&repo.invoke('find_attempt',{event_attempt_id:effect.event_attempt_id});
        reclamation=attempt&&boundReclamation(repo,attempt.event_id,correctionId,committedContextDigest);
        if(!reclamation||registry.reclaimed_at_ms!==BigInt(reclamation.result.committedAtMs))denied();
      }else if(registry.reclaimed_at_ms!==null)denied();
      const members=rows.map(row=>{
        const handle=JSON.parse(row.handle_json);options.contractValidator.validate('helix://contracts/types/WorkspaceMaterialHandle/v1',handle);
        const physical=handle.physicalIdentity,expected={workspace_id:workspaceId(correctionId),material_handle_id:handle.handleId,material_key:handle.materialKey,
          endpoint_id:root.endpointId,mount_scope_id:root.mountScopeId,inode:physical.inode,fingerprint_algorithm:physical.fingerprintAlgorithm,
          fingerprint_version:String(physical.fingerprintVersion),content_fingerprint:physical.contentFingerprint,relative_path:handle.relativePath,
          digest_algorithm:handle.digestAlgorithm,digest_hex:handle.digestHex,size_bytes:BigInt(handle.sizeBytes),reference_revision:BigInt(handle.referenceRevision),
          owner_domain:'arca',process_id:correctionId,root_handle_ref:root.rootHandleRef,access_scope:handle.accessScope,handle_schema_ref:handle.schemaRef,
          handle_json:canonicalJson(handle),handle_digest:canonicalDigest(handle),fence_digest:handle.fenceDigest,state:reclamation?'reclaimed':'active',
          reclaimed_effect_id:reclamation?.effectReceipt.effectId||null,reclaimed_effect_receipt_digest:reclamation?canonicalDigest(reclamation.result):null,
          reclaimed_at_ms:reclamation?BigInt(reclamation.result.committedAtMs):null};
        if(handle.ownerDomain!=='arca'||handle.processId!==correctionId||handle.workspaceId!==workspaceId(correctionId)||handle.rootHandleRef!==root.rootHandleRef||
            handle.endpointId!==root.endpointId||physical.mountScopeId!==root.mountScopeId||physical.sizeBytes!==handle.sizeBytes||
            handle.fenceDigest!==canonicalDigest(Object.fromEntries(Object.entries(handle).filter(([key])=>key!=='fenceDigest')))||
            handle.materialKey!==canonicalDigest({schema:'physical-material-identity@2',...physical}))denied();
        const mismatchedColumns=Object.keys(expected).filter(key=>row[key]!==expected[key]);
        if(mismatchedColumns.length)throw Object.assign(new Error('Committed Workspace row differs from its registered Handle.'),
          {code:'ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED',details:{mismatchedColumns}});
        return handle;
      }).sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
      if(members.map(item=>item.relativePath).join(',')!=='fanart/fanart.jpg,metadata/metadata.json,nfo/movie.nfo,poster/poster.jpg')denied();
      const artifactHandles=artifacts.map(item=>{
        const row=repo.invoke('find_artifact',{artifact_handle_id:item.artifact_handle_id}),handle=members.find(member=>member.relativePath.split('/')[0]===row?.artifact_kind);
        if(!handle||row.state!==(reclamation?'deleted':'active')||row.owner_domain!=='arca'||row.owner_scope_type!==PROCESS||row.owner_scope_id!==correctionId||
            row.storage_ref!==path.resolve(root.resolvedRoot,handle.workspaceId,...handle.relativePath.split('/')).split(path.sep).join('/')||
            row.digest_algorithm!==handle.digestAlgorithm||row.digest_hex!==handle.digestHex||row.size_bytes!==BigInt(handle.sizeBytes)||row.reference_revision!==BigInt(handle.referenceRevision+(reclamation?1:0)))denied();
        const value={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:row.artifact_handle_id,artifactKind:row.artifact_kind,
          ownerDomain:row.owner_domain,ownerScope:{scopeType:row.owner_scope_type,scopeId:row.owner_scope_id},storageRef:row.storage_ref,
          digestAlgorithm:row.digest_algorithm,digestHex:row.digest_hex,sizeBytes:handle.sizeBytes,mediaType:row.media_type,
          provenanceRef:JSON.parse(row.provenance_ref),referenceRevision:handle.referenceRevision};
        options.contractValidator.validate(value.schemaRef,value);return value;
      }).sort((a,b)=>a.artifactKind.localeCompare(b.artifactKind));
      if(artifactHandles.map(item=>item.artifactKind).join(',')!=='fanart,nfo,poster')denied();
      if(reclamation&&reclamation.result.handleSetDigest!==canonicalDigest({members,artifacts:artifactHandles}))denied();
      return Object.freeze({registryExists:true,members,artifacts:artifactHandles,reclamationReceipt:reclamation?.result||null});
  }
  function inspectCommitted(correctionId,committedContextDigest) {
    return execute(correctionId,null,repo=>inspectCommittedRegistry(repo,correctionId,committedContextDigest),committedContextDigest);
  }
  function readReclamation(execution){
    const scope=execution.namedInputs?.javCorrectionWorkspaceReclaimScope;
    if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||execution.ownerScope.processId!==scope?.correctionId||
        execution.capabilityRef!==RECLAIM_CAPABILITY)fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim Receipt is outside the actual execution owner.');
    return execute(scope.correctionId,null,repo=>{
      const value=boundReclamation(repo,execution.eventId,scope.correctionId,scope.committedContextDigest);if(!value)return null;
      if(value.result.scopeDigest!==scope.digest||value.result.shelfEntryId!==scope.shelfEntryId||value.result.reclaimPlanDigest!==scope.reclaimPlanDigest||
          value.result.guardDigest!==scope.guardDigest||value.result.commitReceiptDigest!==scope.commitReceiptDigest||value.result.executionReference.workId!==execution.workId||
          value.result.executionReference.idempotencyKey!==execution.idempotencyKey)fail('ARCA_JAV_CORRECTION_WORKSPACE_RECEIPT_INVALID','Reclaim Receipt belongs to another executing scope.');
      inspectCommittedRegistry(repo,scope.correctionId,scope.committedContextDigest);return value;
    },scope.committedContextDigest);
  }
  function commitReclamation(execution,{plan,scope,predecessors},verifyReality){
    options.contractValidator.validate('helix://contracts/domain-types/JavCorrectionWorkspaceReclaimScope/v1',scope);
    options.contractValidator.validate(plan.schemaRef,plan);const {digest,...scopeBody}=scope,{planDigest,...planBody}=plan,{guardDigest,...guardBody}=planBody;
    if(digest!==canonicalDigest(scopeBody)||planDigest!==canonicalDigest(planBody)||guardDigest!==canonicalDigest(guardBody)||
        scope.reclaimPlanDigest!==planDigest||scope.guardDigest!==guardDigest||scope.correctionId!==plan.correctionId||scope.shelfEntryId!==plan.shelfEntryId||
        scope.committedContextDigest!==plan.committedContextDigest||scope.commitReceiptDigest!==plan.commitReceiptDigest||typeof verifyReality!=='function'||
        execution.capabilityRef!==RECLAIM_CAPABILITY||execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_jav_identity_correction'||
        execution.ownerScope.processId!==scope.correctionId||canonicalDigest(execution.namedInputs?.javCorrectionWorkspaceReclaimScope)!==canonicalDigest(scope))
      fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim commit must bind the closed original Plan and actual execution.');
    const declared=new Set([...require('../../../contracts/transaction-contracts/helix.transaction.jav-correction-workspace-reclaim/v1/contract.json').contract.readTables,
      ...require('../../../contracts/transaction-contracts/helix.transaction.jav-correction-workspace-reclaim/v1/contract.json').contract.writeTables]);
    if([arca,platform,foundation].some(repo=>repo.tableIds.some(table=>!declared.has(table))))fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim repositories escape the canonical transaction.');
    return execute(scope.correctionId,null,(repo,at)=>{
      const prior=boundReclamation(repo,execution.eventId,scope.correctionId,scope.committedContextDigest);if(prior){
        if(prior.result.scopeDigest!==scope.digest||prior.result.executionReference.workId!==execution.workId||prior.result.executionReference.idempotencyKey!==execution.idempotencyKey)fail('ARCA_JAV_CORRECTION_WORKSPACE_RECEIPT_INVALID','Reclaim replay conflicts with its original scope.');
        inspectCommittedRegistry(repo,scope.correctionId,scope.committedContextDigest);return prior;
      }
      const work=repo.invoke('find_work',{work_id:execution.workId}),event=repo.invoke('find_event',{event_id:execution.eventId}),
        attempt=repo.invoke('find_attempt',{event_attempt_id:execution.eventAttemptId});
      if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==scope.correctionId||work.state!=='running'||
          work.work_kind!=='jav_correction_workspace_reclaim'||work.basis_digest!==scope.digest||event?.work_id!==execution.workId||
          event.capability_ref!==RECLAIM_CAPABILITY||event.state!=='executing'||attempt?.event_id!==execution.eventId||attempt.state!=='executing')
        fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim commit lost the actual Work/Event/Attempt fence.');
      const expectedCaps=['arca.jav_correction.assets.prepare@1','arca.jav_correction.formal_retirement.execute@1'];
      if(predecessors?.length!==2||new Set(predecessors.map(ref=>ref.capabilityRef)).size!==2||predecessors.some(ref=>!expectedCaps.includes(ref.capabilityRef)))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim predecessor set is incomplete.');
      for(const ref of predecessors){const w=repo.invoke('find_work',{work_id:ref.workId}),e=repo.invoke('find_event',{event_id:ref.eventId}),row=repo.invoke('find_result',{event_id:ref.eventId});
        if(w?.state!=='succeeded'||w.owner_domain!=='arca'||w.process_type!=='arca_jav_identity_correction'||w.process_id!==scope.correctionId||w.basis_digest!==ref.basisDigest||
            e?.state!=='succeeded'||e.work_id!==ref.workId||e.capability_ref!==ref.capabilityRef||row?.outcome_kind!=='succeeded'||row.result_schema_ref!==ref.resultSchemaRef||
            row.result_digest!==ref.resultDigest||canonicalDigest(JSON.parse(row.result_json))!==ref.resultDigest)fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim predecessor execution or Result changed.');
      }
      const registered=inspectCommittedRegistry(repo,scope.correctionId,scope.committedContextDigest);
      if(registered.reclamationReceipt||canonicalDigest({members:registered.members,artifacts:registered.artifacts})!==plan.handleSetDigest)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim Registry no longer matches the original complete Plan.');
      const reality=verifyReality(),expectedReality=canonicalDigest({schema:'arca.jav-correction-workspace-reclaimed@1',planDigest,handleSetDigest:plan.handleSetDigest,workspaceDisposition:'absent'}),
        bytes=plan.members.reduce((sum,item)=>sum+item.sizeBytes,0);
      if(reality?.realityDigest!==expectedReality||reality.handleSetDigest!==plan.handleSetDigest||reality.reclaimedHandleCount!==4||reality.reclaimedArtifactCount!==3||
          reality.reclaimedBytes!==bytes||reality.workspaceDisposition!=='absent')fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Actual Workspace absence has not been independently verified.');
      const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40),result={schemaRef:RECLAIM_SCHEMA,schemaVersion:1,
        receiptId:stable('arca-jav-workspace-receipt-',{eventId:execution.eventId}),receiptKind:'jav_correction_workspace_reclaimed',ownerDomain:'arca',scopeType:PROCESS,
        scopeId:scope.correctionId,scopeDigest:scope.digest,effectReceiptRef:stable('arca-jav-workspace-effect-',{eventId:execution.eventId}),committedAtMs:at,
        correctionId:scope.correctionId,shelfEntryId:scope.shelfEntryId,committedContextDigest:scope.committedContextDigest,commitReceiptDigest:scope.commitReceiptDigest,
        reclaimPlanDigest:planDigest,guardDigest,handleSetDigest:plan.handleSetDigest,reclaimedHandleCount:4,reclaimedArtifactCount:3,reclaimedBytes:bytes,
        workspaceDisposition:'absent',realityDigest:expectedReality,executionReference:{workId:execution.workId,eventId:execution.eventId,eventAttemptId:execution.eventAttemptId,idempotencyKey:execution.idempotencyKey}};
      options.contractValidator.validate(RECLAIM_SCHEMA,result);const value=workspaceReclaimOutcome(result),resultDigest=canonicalDigest(result),
        effect=repo.invoke('find_effect',{effect_id:value.effectReceipt.effectId}),originalAttempt=effect&&repo.invoke('find_attempt',{event_attempt_id:effect.event_attempt_id});
      if(effect?.effect_class!=='workspace_write'||effect.idempotency_key!==execution.idempotencyKey||originalAttempt?.event_id!==execution.eventId)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim commit has no exact original Effect intent.');
      for(const member of plan.members){const changed=repo.invoke('reclaim_material',{state:'reclaimed',reclaimed_effect_id:value.effectReceipt.effectId,reclaimed_effect_receipt_digest:resultDigest,
        reclaimed_at_ms:at,workspace_id:member.workspaceId,material_handle_id:member.handleId,expected_state:'active',expected_handle_digest:canonicalDigest(member),expected_fence_digest:member.fenceDigest});
        if(changed.changes!==1)fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim Material lifecycle CAS failed.');}
      for(const artifact of plan.artifacts){const changed=repo.invoke('reclaim_artifact',{state:'deleted',reference_revision:artifact.referenceRevision+1,artifact_handle_id:artifact.artifactHandleId,
        expected_state:'active',expected_reference_revision:artifact.referenceRevision});if(changed.changes!==1)fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim Artifact lifecycle CAS failed.');}
      if(repo.invoke('reclaim_registry',{state:'reclaimed',reclaimed_at_ms:at,workspace_id:workspaceId(scope.correctionId),expected_state:'active'}).changes!==1)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Reclaim Workspace lifecycle CAS failed.');
      const resultId=stable('arca-jav-workspace-result-',{eventId:execution.eventId});repo.invoke('insert_result',{result_id:resultId,event_id:execution.eventId,outcome_kind:'succeeded',
        result_schema_ref:RECLAIM_SCHEMA,result_json:canonicalJson(result),result_digest:resultDigest,evidence_schema_ref:value.evidenceSchemaRef,evidence_json:canonicalJson(value.evidence),
        evidence_digest:canonicalDigest(value.evidence),effect_receipt_id:result.effectReceiptRef,committed_at_ms:at});
      repo.invoke('insert_marker',{commit_marker:value.effectReceipt.commitMarker,effect_id:value.effectReceipt.effectId,owner_domain:'arca',scope_type:PROCESS,scope_id:scope.correctionId,
        commit_digest:value.effectReceipt.verificationEvidenceDigest,result_id:resultId,result_schema_ref:RECLAIM_SCHEMA,result_digest:resultDigest,committed_at_ms:at});
      inspectCommittedRegistry(repo,scope.correctionId,scope.committedContextDigest);return value;
    },scope.committedContextDigest,{scope,admissionDigest:plan.admissionDigest});
  }
  function register(correctionId,admissionDigest,handle,artifact) {
    options.contractValidator.validate('helix://contracts/types/WorkspaceMaterialHandle/v1',handle);
    const workingMetadata=handle.relativePath==='metadata/metadata.json'&&artifact===null;
    if(!workingMetadata)options.contractValidator.validate('helix://contracts/types/ArtifactHandle/v1',artifact);
    if(handle.workspaceId!==workspaceId(correctionId)||handle.processId!==correctionId||handle.ownerDomain!=='arca'||handle.rootHandleRef!==root.rootHandleRef||
        handle.endpointId!==root.endpointId||handle.physicalIdentity.mountScopeId!==root.mountScopeId||handle.digestAlgorithm!=='sha256'||
        handle.fenceDigest!==canonicalDigest(Object.fromEntries(Object.entries(handle).filter(([key])=>key!=='fenceDigest')))||
        handle.materialKey!==canonicalDigest({schema:'physical-material-identity@2',...handle.physicalIdentity})||
        (!workingMetadata&&!/^(nfo|poster|fanart)\/[^/\\\u0000-\u001F]{1,200}$/.test(handle.relativePath))||workingMetadata&&handle.sizeBytes>128*1024||
        !workingMetadata&&(
        artifact.ownerDomain!=='arca'||artifact.ownerScope.scopeType!==PROCESS||artifact.ownerScope.scopeId!==correctionId||
        !['nfo','poster','fanart'].includes(artifact.artifactKind)||artifact.artifactKind!==handle.relativePath.split('/')[0]||
        artifact.digestAlgorithm!=='sha256'||artifact.digestHex!==handle.digestHex||artifact.sizeBytes!==handle.sizeBytes||
        artifact.storageRef!==path.resolve(root.resolvedRoot,handle.workspaceId,...handle.relativePath.split('/')).split(path.sep).join('/')||
        artifact.provenanceRef.objectType!==PROCESS||artifact.provenanceRef.objectId!==correctionId||artifact.provenanceRef.revision!==1||artifact.provenanceRef.digest!==admissionDigest))
      fail('ARCA_JAV_CORRECTION_WORKSPACE_HANDLE_INVALID','Correction Artifact and Workspace handles must conserve their exact registered scope and bytes.');
    return execute(correctionId,admissionDigest,(repo,at)=>{
      ensureRegistry(repo,correctionId,at);const json=canonicalJson(handle),digest=canonicalDigest(handle),
        prior=repo.invoke('find_material',{workspace_id:handle.workspaceId,material_handle_id:handle.handleId}),path=repo.invoke('find_path',{workspace_id:handle.workspaceId,relative_path:handle.relativePath});
      if(prior&&(prior.handle_digest!==digest||prior.state!=='active')||path&&(path.handle_digest!==digest||path.state!=='active'))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Correction Workspace material replay conflicts with existing provenance.');
      if(!prior) {
        const physical=handle.physicalIdentity;
        repo.invoke('insert_material',{workspace_id:handle.workspaceId,material_handle_id:handle.handleId,material_key:handle.materialKey,endpoint_id:handle.endpointId,
          mount_scope_id:physical.mountScopeId,inode:physical.inode,fingerprint_algorithm:physical.fingerprintAlgorithm,fingerprint_version:String(physical.fingerprintVersion),
          content_fingerprint:physical.contentFingerprint,relative_path:handle.relativePath,digest_algorithm:handle.digestAlgorithm,digest_hex:handle.digestHex,size_bytes:handle.sizeBytes,
          reference_revision:handle.referenceRevision,owner_domain:'arca',process_id:correctionId,root_handle_ref:root.rootHandleRef,access_scope:handle.accessScope,
          handle_schema_ref:handle.schemaRef,handle_json:json,handle_digest:digest,fence_digest:handle.fenceDigest,state:'active',reclaimed_effect_id:null,reclaimed_effect_receipt_digest:null,reclaimed_at_ms:null});
      }
      if(workingMetadata)return {workspaceMaterialHandle:handle,artifactHandle:null};
      const existing=repo.invoke('find_artifact',{artifact_handle_id:artifact.artifactHandleId});
      const values={artifact_handle_id:artifact.artifactHandleId,artifact_kind:artifact.artifactKind,owner_domain:'arca',owner_scope_type:PROCESS,owner_scope_id:correctionId,
        storage_ref:artifact.storageRef,digest_algorithm:artifact.digestAlgorithm,digest_hex:artifact.digestHex,size_bytes:artifact.sizeBytes,media_type:artifact.mediaType,
        provenance_ref:canonicalJson(artifact.provenanceRef),reference_revision:artifact.referenceRevision,state:'active'};
      if(existing&&Object.keys(values).some(key=>key==='size_bytes'||key==='reference_revision'?Number(existing[key])!==values[key]:existing[key]!==values[key]))
        fail('ARCA_JAV_CORRECTION_ARTIFACT_REPLAY_CONFLICT','Correction Artifact replay conflicts with its registered source.');
      if(!existing)repo.invoke('insert_artifact',{...values,created_at_ms:at});
      return {workspaceMaterialHandle:handle,artifactHandle:artifact};
    });
  }
  return Object.freeze({workspaceId,ensure,register,resolve,resolveRecovery,inspect,inspectRecovery,inspectCommitted,readReclamation,commitReclamation});
}
module.exports=Object.freeze({createJavCorrectionWorkspaceStore});
