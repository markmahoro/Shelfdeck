'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const RETENTION_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);
const TERMINAL_CASE_STATES = new Set(['resolved', 'invalidated', 'unresolved']);
const MAX_WORKSPACE_MEMBERS = 1024;
const MAX_WORKSPACE_DEPTH = 16;

class AftercareWorkspaceStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AftercareWorkspaceStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new AftercareWorkspaceStoreError(code, message, details);
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') ||
      /^[A-Za-z]:/.test(value) || value.split('/').some((item) => !item || item === '.' || item === '..')) {
    fail('ARCA_AFTERCARE_WORKSPACE_PATH_INVALID', 'Aftercare Workspace path must be canonical and root-relative.');
  }
  return value;
}

function contains(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

function createDefinitions(schemaManifest) {
  return Object.freeze({
    platform: createRepositoryDefinition({
      repositoryId:'arca_aftercare_workspace_platform', owner:'platform-settings', schemaManifest, statements:{
        find_root:{kind:'select-one',tableId:'platform_workspace_roots',columns:['root_id','owner_scope','root_kind','endpoint_id','mount_scope_id','mount_scope_revision','resolved_root','config_revision','capability_digest','state','root_handle_ref','snapshot_digest','updated_at_ms'],keyColumns:['root_id'],safeIntegers:true},
        insert_root:{kind:'insert',tableId:'platform_workspace_roots',columns:['root_id','owner_scope','root_kind','endpoint_id','mount_scope_id','mount_scope_revision','resolved_root','config_revision','capability_digest','state','root_handle_ref','snapshot_digest','updated_at_ms']},
      },
    }),
    arca: createRepositoryDefinition({
      repositoryId:'arca_aftercare_workspace_domain', owner:'arca', schemaManifest, statements:{
        find_case:{kind:'select-one',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','shelf_entry_id','state','terminal_at_ms'],keyColumns:['aftercare_case_id'],safeIntegers:true},
        list_commits:{kind:'select-all',tableId:'arca_aftercare_inventory_commits',columns:['aftercare_case_id','shelf_entry_id','new_inventory_revision','commit_digest'],keyColumns:['shelf_entry_id'],safeIntegers:true},
      },
    }),
    foundation: createRepositoryDefinition({
      repositoryId:'arca_aftercare_workspace_foundation', owner:'execution-foundation', schemaManifest, statements:{
        find_registry:{kind:'select-one',tableId:'fx_workspace_registry',columns:['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state','created_at_ms','reclaim_after_ms','reclaimed_at_ms'],keyColumns:['workspace_id'],safeIntegers:true},
        page_registries:{kind:'select-range',tableId:'fx_workspace_registry',keyColumn:'workspace_id',fixedKeyColumns:['owner_domain','process_type','state'],maxItems:500,columns:['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state','created_at_ms','reclaim_after_ms','reclaimed_at_ms'],safeIntegers:true},
        insert_registry:{kind:'insert',tableId:'fx_workspace_registry',columns:['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state','created_at_ms','reclaim_after_ms','reclaimed_at_ms']},
        schedule_registry:{kind:'update',tableId:'fx_workspace_registry',setColumns:['reclaim_after_ms'],keyColumns:['workspace_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
        reclaim_registry:{kind:'update',tableId:'fx_workspace_registry',setColumns:['state','reclaimed_at_ms'],keyColumns:['workspace_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
        find_material:{kind:'select-one',tableId:'fx_workspace_materials',columns:['workspace_id','material_handle_id','material_key','endpoint_id','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','relative_path','digest_algorithm','digest_hex','size_bytes','reference_revision','owner_domain','process_id','root_handle_ref','access_scope','handle_schema_ref','handle_json','handle_digest','fence_digest','state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'],keyColumns:['workspace_id','material_handle_id'],safeIntegers:true},
        find_material_by_path:{kind:'select-one',tableId:'fx_workspace_materials',columns:['workspace_id','material_handle_id','handle_digest','state'],keyColumns:['workspace_id','relative_path'],safeIntegers:true},
        list_materials:{kind:'select-all',tableId:'fx_workspace_materials',columns:['workspace_id','material_handle_id','material_key','endpoint_id','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','relative_path','digest_algorithm','digest_hex','size_bytes','reference_revision','owner_domain','process_id','root_handle_ref','access_scope','handle_schema_ref','handle_json','handle_digest','fence_digest','state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'],keyColumns:['workspace_id'],safeIntegers:true},
        insert_material:{kind:'insert',tableId:'fx_workspace_materials',columns:['workspace_id','material_handle_id','material_key','endpoint_id','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','relative_path','digest_algorithm','digest_hex','size_bytes','reference_revision','owner_domain','process_id','root_handle_ref','access_scope','handle_schema_ref','handle_json','handle_digest','fence_digest','state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms']},
        reclaim_material:{kind:'update',tableId:'fx_workspace_materials',setColumns:['state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'],keyColumns:['workspace_id','material_handle_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'handle_digest',parameter:'expected_handle_digest'},{column:'fence_digest',parameter:'expected_fence_digest'}]},
        find_artifact:{kind:'select-one',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state'],keyColumns:['artifact_handle_id'],safeIntegers:true},
        list_artifacts:{kind:'select-all',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state'],keyColumns:['owner_domain','owner_scope_type','owner_scope_id'],safeIntegers:true},
        insert_artifact:{kind:'insert',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state','created_at_ms']},
        update_artifact:{kind:'update',tableId:'fx_artifact_registry',setColumns:['reference_revision','state'],keyColumns:['artifact_handle_id'],compareColumns:[{column:'reference_revision',parameter:'expected_reference_revision'},{column:'state',parameter:'expected_state'}]},
        list_artifact_references:{kind:'select-all',tableId:'fx_artifact_references',columns:['artifact_handle_id','consumer_domain','consumer_scope_type','consumer_scope_id','reference_kind','reference_revision','state','created_at_ms','released_at_ms'],keyColumns:['artifact_handle_id'],safeIntegers:true},
        list_process_works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','state','definition_json','updated_at_ms'],keyColumns:['owner_domain','process_type','process_id'],safeIntegers:true},
      },
    }),
  });
}

function createAftercareWorkspaceStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) fail('ARCA_AFTERCARE_WORKSPACE_DEPENDENCIES', 'Aftercare Workspace requires clean persistence.');
  const definitions = createDefinitions(options.schemaManifest);
  const now = options.now || Date.now;
  const resolvedRoot = path.resolve(options.aftercareWorkspaceRoot || path.join(os.tmpdir(),'shelfdeck-aftercare-workspaces'));
  const rootId = 'service-arca-aftercare-workspace';
  const endpointId=options.aftercareWorkspaceEndpointId||'aftercare-workspace-local';
  const mountScopeId=options.aftercareWorkspaceMountScopeId||'aftercare-workspace-local-mount';
  const mountScopeRevision = Number(options.aftercareWorkspaceMountScopeRevision || 1);
  const unlinkWorkspaceFile=typeof options.unlinkWorkspaceFile==='function'?options.unlinkWorkspaceFile:(location)=>fs.promises.unlink(location);
  const capabilityDigest = canonicalDigest({
    schema:'platform.local-aftercare-workspace-capability@1',
    operations:['atomic_replace','read','stat','bounded_member_reclaim'],
  });
  const rootHandleRef = canonicalDigest({schema:'platform.workspace-root-handle@1',rootId,
    endpointId,mountScopeId,
    mountScopeRevision,configRevision:1,capabilityDigest});
  const rootBasis = {rootId,ownerScope:'arca',rootKind:'aftercare-workspace',endpointId,
    mountScopeId,mountScopeRevision,configRevision:1,capabilityDigest,
    state:'active',rootHandleRef};
  const rootSnapshot = Object.freeze({...rootBasis,snapshotDigest:canonicalDigest(rootBasis)});

  function execute(participantId, owner, definition, body) {
    return options.unitOfWork.execute([{participantId,owner,repositories:[definition],execute:body}])[participantId];
  }

  function ensureRoot() {
    fs.mkdirSync(resolvedRoot, {recursive:true});
    return execute('arca_aftercare_workspace_root_ensure','platform-settings',definitions.platform,(context)=>{
      const repo=context.repository(definitions.platform.repositoryId),existing=repo.invoke('find_root',{root_id:rootId});
      if(existing){
        if(existing.owner_scope!=='arca'||existing.root_kind!=='aftercare-workspace'||existing.resolved_root!==resolvedRoot||
            existing.endpoint_id!==rootSnapshot.endpointId||existing.mount_scope_id!==rootSnapshot.mountScopeId||
            Number(existing.mount_scope_revision)!==mountScopeRevision||existing.root_handle_ref!==rootHandleRef||
            existing.snapshot_digest!==rootSnapshot.snapshotDigest||existing.state!=='active') {
          fail('ARCA_AFTERCARE_WORKSPACE_ROOT_CONFLICT','Configured Aftercare Workspace conflicts with its durable Platform root.');
        }
        return rootSnapshot;
      }
      repo.invoke('insert_root',{root_id:rootId,owner_scope:'arca',root_kind:'aftercare-workspace',endpoint_id:rootSnapshot.endpointId,
        mount_scope_id:rootSnapshot.mountScopeId,mount_scope_revision:mountScopeRevision,resolved_root:resolvedRoot,config_revision:1,
        capability_digest:capabilityDigest,state:'active',root_handle_ref:rootHandleRef,snapshot_digest:rootSnapshot.snapshotDigest,
        updated_at_ms:context.commitTimeMs});
      return rootSnapshot;
    });
  }

  function workspaceLocation(workspaceId, rawRelativePath) {
    const relative=relativePath(rawRelativePath),target=path.resolve(resolvedRoot,workspaceId,...relative.split('/'));
    if(!contains(path.join(resolvedRoot,workspaceId),target))fail('ARCA_AFTERCARE_WORKSPACE_ESCAPE','Aftercare Workspace member escaped its Case root.');
    return target;
  }

  function workspaceRelativePath(workspaceId, location) {
    const caseRoot=path.resolve(resolvedRoot,workspaceId),target=path.resolve(location);
    if(target===caseRoot||!contains(caseRoot,target))fail('ARCA_AFTERCARE_WORKSPACE_ESCAPE','Aftercare Workspace member escaped its Case root.');
    return relativePath(path.relative(caseRoot,target).split(path.sep).join('/'));
  }

  function ensureWorkspace(aftercareCaseId) {
    ensureRoot();
    return execute('arca_aftercare_workspace_admit','execution-foundation',definitions.foundation,(context)=>{
      const repo=context.repository(definitions.foundation.repositoryId),existing=repo.invoke('find_registry',{workspace_id:aftercareCaseId});
      if(existing){
        if(existing.owner_domain!=='arca'||existing.process_type!=='aftercare_case'||existing.process_id!==aftercareCaseId||
            existing.root_handle_ref!==rootHandleRef||existing.state!=='active')fail('ARCA_AFTERCARE_WORKSPACE_REGISTRY_CONFLICT','Aftercare Workspace registry conflicts with its Case.');
        if(existing.reclaim_after_ms!==null)fail('ARCA_AFTERCARE_WORKSPACE_TERMINAL','Aftercare Workspace cannot accept new members after terminal retention starts.');
        return existing;
      }
      repo.invoke('insert_registry',{workspace_id:aftercareCaseId,owner_domain:'arca',process_type:'aftercare_case',process_id:aftercareCaseId,
        root_handle_ref:rootHandleRef,state:'active',created_at_ms:context.commitTimeMs,reclaim_after_ms:null,reclaimed_at_ms:null});
      return repo.invoke('find_registry',{workspace_id:aftercareCaseId});
    });
  }

  function validateWorkspaceHandle(handle) {
    if(!handle||handle.schemaRef!=='helix://contracts/types/WorkspaceMaterialHandle/v1'||
        handle.ownerDomain!=='arca'||handle.rootHandleRef!==rootHandleRef||handle.endpointId!==rootSnapshot.endpointId||
        handle.physicalIdentity?.mountScopeId!==rootSnapshot.mountScopeId||handle.handleId!==handle.materialHandleId&&handle.materialHandleId!==undefined) {
      fail('ARCA_AFTERCARE_WORKSPACE_HANDLE_INVALID','Aftercare Workspace Material Handle does not match the registered root.');
    }
    relativePath(handle.relativePath);
    const unsigned=Object.fromEntries(Object.entries(handle).filter(([key])=>key!=='fenceDigest'));
    if(handle.fenceDigest!==canonicalDigest(unsigned))fail('ARCA_AFTERCARE_WORKSPACE_HANDLE_INVALID','Aftercare Workspace Material fence is invalid.');
  }

  function registerMaterial(workspaceMaterialHandle, artifactHandle=null) {
    validateWorkspaceHandle(workspaceMaterialHandle);
    ensureWorkspace(workspaceMaterialHandle.workspaceId);
    return execute('arca_aftercare_workspace_material_register','execution-foundation',definitions.foundation,(context)=>{
      const repo=context.repository(definitions.foundation.repositoryId),handleDigest=canonicalDigest(workspaceMaterialHandle),
        existing=repo.invoke('find_material',{workspace_id:workspaceMaterialHandle.workspaceId,material_handle_id:workspaceMaterialHandle.handleId}),
        byPath=repo.invoke('find_material_by_path',{workspace_id:workspaceMaterialHandle.workspaceId,relative_path:workspaceMaterialHandle.relativePath});
      if(existing||byPath){const row=existing||byPath;if(row.material_handle_id!==workspaceMaterialHandle.handleId||row.handle_digest!==handleDigest||row.state!=='active')fail('ARCA_AFTERCARE_WORKSPACE_MATERIAL_CONFLICT','Aftercare Workspace Material replay conflicts with the durable member.');}
      else repo.invoke('insert_material',{workspace_id:workspaceMaterialHandle.workspaceId,material_handle_id:workspaceMaterialHandle.handleId,
        material_key:workspaceMaterialHandle.materialKey,endpoint_id:workspaceMaterialHandle.endpointId,mount_scope_id:workspaceMaterialHandle.physicalIdentity.mountScopeId,
        inode:String(workspaceMaterialHandle.physicalIdentity.inode),fingerprint_algorithm:workspaceMaterialHandle.physicalIdentity.fingerprintAlgorithm,
        fingerprint_version:String(workspaceMaterialHandle.physicalIdentity.fingerprintVersion),content_fingerprint:workspaceMaterialHandle.physicalIdentity.contentFingerprint,
        relative_path:workspaceMaterialHandle.relativePath,digest_algorithm:workspaceMaterialHandle.digestAlgorithm,digest_hex:workspaceMaterialHandle.digestHex,
        size_bytes:Number(workspaceMaterialHandle.sizeBytes),reference_revision:Number(workspaceMaterialHandle.referenceRevision),owner_domain:'arca',
        process_id:workspaceMaterialHandle.processId,root_handle_ref:rootHandleRef,access_scope:workspaceMaterialHandle.accessScope,
        handle_schema_ref:workspaceMaterialHandle.schemaRef,handle_json:canonicalJson(workspaceMaterialHandle),handle_digest:handleDigest,
        fence_digest:workspaceMaterialHandle.fenceDigest,state:'active',reclaimed_effect_id:null,reclaimed_effect_receipt_digest:null,reclaimed_at_ms:null});
      if(artifactHandle){const prior=repo.invoke('find_artifact',{artifact_handle_id:artifactHandle.artifactHandleId});if(prior){if(prior.digest_hex!==artifactHandle.digestHex||prior.artifact_kind!==artifactHandle.artifactKind||prior.storage_ref!==artifactHandle.storageRef)fail('ARCA_AFTERCARE_ARTIFACT_REGISTRY_CONFLICT','Aftercare Artifact replay conflicts with the durable Artifact registry.');}
        else repo.invoke('insert_artifact',{artifact_handle_id:artifactHandle.artifactHandleId,artifact_kind:artifactHandle.artifactKind,owner_domain:'arca',owner_scope_type:'aftercare_case',owner_scope_id:workspaceMaterialHandle.workspaceId,storage_ref:artifactHandle.storageRef,digest_algorithm:artifactHandle.digestAlgorithm,digest_hex:artifactHandle.digestHex,size_bytes:Number(artifactHandle.sizeBytes),media_type:artifactHandle.mediaType,provenance_ref:canonicalJson(artifactHandle.provenanceRef),reference_revision:Number(artifactHandle.referenceRevision),state:'active',created_at_ms:context.commitTimeMs});}
      return workspaceMaterialHandle;
    });
  }

  function resolveArtifact(artifactHandle) {
    if(!artifactHandle||artifactHandle.ownerDomain!=='arca'||artifactHandle.ownerScope?.scopeType!=='aftercare_case')fail('ARCA_AFTERCARE_ARTIFACT_HANDLE_INVALID','Aftercare Artifact Handle owner scope is invalid.');
    const row=execute('arca_aftercare_artifact_resolve','execution-foundation',definitions.foundation,(context)=>context.repository(definitions.foundation.repositoryId).invoke('find_artifact',{artifact_handle_id:artifactHandle.artifactHandleId}));
    if(!row||row.state!=='active'||row.owner_domain!=='arca'||row.owner_scope_type!=='aftercare_case'||row.owner_scope_id!==artifactHandle.ownerScope.scopeId||row.artifact_kind!==artifactHandle.artifactKind||row.storage_ref!==artifactHandle.storageRef||row.digest_algorithm!==artifactHandle.digestAlgorithm||row.digest_hex!==artifactHandle.digestHex||Number(row.size_bytes)!==Number(artifactHandle.sizeBytes)||row.media_type!==artifactHandle.mediaType||Number(row.reference_revision)!==Number(artifactHandle.referenceRevision))fail('ARCA_AFTERCARE_ARTIFACT_HANDLE_STALE','Aftercare Artifact Handle does not match its active registry row.');
    workspaceRelativePath(artifactHandle.ownerScope.scopeId,artifactHandle.storageRef);
    return artifactHandle;
  }

  function schedule(aftercareCaseId, terminalAtMs) {
    if(!Number.isSafeInteger(terminalAtMs)||terminalAtMs<0)fail('ARCA_AFTERCARE_WORKSPACE_TERMINAL_TIME_INVALID','Aftercare Case terminal time is invalid.');
    const reclaimAfterMs=terminalAtMs+RETENTION_MS;
    return execute('arca_aftercare_workspace_schedule','execution-foundation',definitions.foundation,(context)=>{
      const repo=context.repository(definitions.foundation.repositoryId),row=repo.invoke('find_registry',{workspace_id:aftercareCaseId});
      if(!row)return null;
      if(row.state==='reclaimed')return row;
      if(row.reclaim_after_ms!==null){if(Number(row.reclaim_after_ms)!==reclaimAfterMs)fail('ARCA_AFTERCARE_WORKSPACE_RETENTION_CONFLICT','Aftercare Workspace retention boundary changed.');return row;}
      const changed=repo.invoke('schedule_registry',{reclaim_after_ms:reclaimAfterMs,workspace_id:aftercareCaseId,expected_state:'active'});
      if(changed.changes!==1)fail('ARCA_AFTERCARE_WORKSPACE_SCHEDULE_CAS','Aftercare Workspace retention scheduling CAS failed.');
      return repo.invoke('find_registry',{workspace_id:aftercareCaseId});
    });
  }

  function listLifecyclePage(cursor, limit=100) {
    const bounded=Math.max(1,Math.min(500,Number(limit)||100));
    return execute('arca_aftercare_workspace_lifecycle_list','execution-foundation',definitions.foundation,(context)=>context.repository(definitions.foundation.repositoryId)
      .invoke('page_registries',{owner_domain:'arca',process_type:'aftercare_case',state:'active',rangeStart:'',rangeEnd:'\uffff',cursor,limit:bounded})
      .map((row)=>Object.freeze({cursor:row.workspace_id,scope:Object.freeze({aftercareCaseId:row.process_id})})));
  }

  function inspectLifecycle(aftercareCaseId) {
    let care,registry,materials,works,commits,artifacts,references;
    options.unitOfWork.execute([{participantId:'arca_aftercare_workspace_lifecycle_domain_read',owner:'arca',repositories:[definitions.arca],execute(context){const repo=context.repository(definitions.arca.repositoryId);care=repo.invoke('find_case',{aftercare_case_id:aftercareCaseId});commits=care?repo.invoke('list_commits',{shelf_entry_id:care.shelf_entry_id}).filter((row)=>row.aftercare_case_id===aftercareCaseId):[];}},
      {participantId:'arca_aftercare_workspace_lifecycle_foundation_read',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[definitions.foundation],execute(context){const repo=context.repository(definitions.foundation.repositoryId);registry=repo.invoke('find_registry',{workspace_id:aftercareCaseId});materials=repo.invoke('list_materials',{workspace_id:aftercareCaseId});works=care?repo.invoke('list_process_works',{owner_domain:'arca',process_type:'arca_shelf_entry',process_id:care.shelf_entry_id}):[];artifacts=repo.invoke('list_artifacts',{owner_domain:'arca',owner_scope_type:'aftercare_case',owner_scope_id:aftercareCaseId});references=artifacts.flatMap((artifact)=>repo.invoke('list_artifact_references',{artifact_handle_id:artifact.artifact_handle_id}));}}]);
    return Object.freeze({care,registry,materials:Object.freeze(materials||[]),works:Object.freeze(works||[]),commits:Object.freeze(commits||[]),artifacts:Object.freeze(artifacts||[]),references:Object.freeze(references||[])});
  }

  async function enumerate(root) {
    const files=[],directories=[];
    async function visit(current,relative,depth) {
      if(depth>MAX_WORKSPACE_DEPTH)fail('ARCA_AFTERCARE_WORKSPACE_SCAN_BOUND','Aftercare Workspace directory depth exceeds its bound.');
      let entries;
      try{entries=await fs.promises.readdir(current,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
      for(const entry of entries){const child=path.join(current,entry.name),rel=relative?relative+'/'+entry.name:entry.name;
        if(Buffer.byteLength(rel,'utf8')>4096||files.length+directories.length>=MAX_WORKSPACE_MEMBERS)fail('ARCA_AFTERCARE_WORKSPACE_SCAN_BOUND','Aftercare Workspace member scan exceeds its bound.');
        if(entry.isSymbolicLink())fail('ARCA_AFTERCARE_WORKSPACE_UNKNOWN_MEMBER','Aftercare Workspace contains a symbolic link.',{relativePath:rel});
        if(entry.isDirectory()){directories.push({location:child,relativePath:rel});await visit(child,rel,depth+1);continue;}
        if(!entry.isFile())fail('ARCA_AFTERCARE_WORKSPACE_UNKNOWN_MEMBER','Aftercare Workspace contains a non-regular member.',{relativePath:rel});
        files.push({location:child,relativePath:rel});}
    }
    await visit(root,'',0);
    return Object.freeze({files:Object.freeze(files),directories:Object.freeze(directories)});
  }

  function parseHandle(row) {
    let handle;try{handle=JSON.parse(row.handle_json);}catch{fail('ARCA_AFTERCARE_WORKSPACE_MATERIAL_CORRUPT','Aftercare Workspace Material Handle JSON is corrupt.');}
    if(canonicalDigest(handle)!==row.handle_digest||handle.fenceDigest!==row.fence_digest)fail('ARCA_AFTERCARE_WORKSPACE_MATERIAL_CORRUPT','Aftercare Workspace Material Handle digest drifted.');
    return handle;
  }

  function reclaimIdentity(aftercareCaseId, materials) {
    const intentDigest=canonicalDigest({schema:'arca.aftercare-workspace-reclaim-intent@1',aftercareCaseId,
      members:materials.map((row)=>({handleId:row.material_handle_id,handleDigest:row.handle_digest,fenceDigest:row.fence_digest})).sort((a,b)=>a.handleId.localeCompare(b.handleId))});
    return Object.freeze({intentDigest,effectId:'arca-aftercare-workspace-reclaim-'+canonicalDigest({aftercareCaseId,intentDigest}).slice(0,40)});
  }

  function receiptFor(aftercareCaseId,identity,materials,reclaimedBytes,committedAtMs){return Object.freeze({schemaRef:'helix://contracts/types/ReclamationReceipt/v1',schemaVersion:1,receiptId:'arca-care-reclaim-'+canonicalDigest({aftercareCaseId,intentDigest:identity.intentDigest}).slice(0,40),receiptKind:'aftercare_workspace_reclaimed',ownerDomain:'arca',scopeType:'aftercare_case',scopeId:aftercareCaseId,workspaceId:aftercareCaseId,reclaimedHandleIds:Object.freeze(materials.map((row)=>row.material_handle_id).sort()),retainedHandleIds:Object.freeze([]),reclaimedBytes,committedAtMs});}
  function commitReclaim(aftercareCaseId, identity, materials, artifacts, reclaimedBytes) {
    return execute('arca_aftercare_workspace_reclaim_commit','execution-foundation',definitions.foundation,(context)=>{const repo=context.repository(definitions.foundation.repositoryId),receipt=receiptFor(aftercareCaseId,identity,materials,reclaimedBytes,context.commitTimeMs),receiptDigest=canonicalDigest(receipt);
      for(const row of materials){const current=repo.invoke('find_material',{workspace_id:aftercareCaseId,material_handle_id:row.material_handle_id});if(current?.state==='reclaimed'){if(current.reclaimed_effect_id!==identity.effectId)fail('ARCA_AFTERCARE_WORKSPACE_RECLAIM_INTENT_CONFLICT','Aftercare Workspace member belongs to another reclaim intent.');continue;}const changed=repo.invoke('reclaim_material',{state:'reclaimed',reclaimed_effect_id:identity.effectId,reclaimed_effect_receipt_digest:receiptDigest,reclaimed_at_ms:context.commitTimeMs,workspace_id:aftercareCaseId,material_handle_id:row.material_handle_id,expected_state:'active',expected_handle_digest:row.handle_digest,expected_fence_digest:row.fence_digest});if(changed.changes!==1)fail('ARCA_AFTERCARE_WORKSPACE_MATERIAL_RECLAIM_CAS','Aftercare Workspace member reclaim CAS failed.');}
      for(const artifact of artifacts){if(artifact.state==='deleted')continue;const changed=repo.invoke('update_artifact',{reference_revision:Number(artifact.reference_revision)+1,state:'deleted',artifact_handle_id:artifact.artifact_handle_id,expected_reference_revision:Number(artifact.reference_revision),expected_state:artifact.state});if(changed.changes!==1)fail('ARCA_AFTERCARE_ARTIFACT_RECLAIM_CAS','Aftercare Artifact lifecycle CAS failed.');}
      const registry=repo.invoke('find_registry',{workspace_id:aftercareCaseId});if(registry.state==='active'){const changed=repo.invoke('reclaim_registry',{state:'reclaimed',reclaimed_at_ms:context.commitTimeMs,workspace_id:aftercareCaseId,expected_state:'active'});if(changed.changes!==1)fail('ARCA_AFTERCARE_WORKSPACE_RECLAIM_CAS','Aftercare Workspace registry reclaim CAS failed.');}
      return receipt;});
  }

  function scopedActiveWork(snapshot,currentWorkId){const handleIds=new Set(snapshot.materials.map((row)=>row.material_handle_id));return snapshot.works.find((row)=>{if(row.work_id===currentWorkId||!ACTIVE_WORK_STATES.has(row.state))return false;let definition;try{definition=JSON.parse(row.definition_json);}catch{return true;}return (definition.workspaceMaterialScope||[]).some((ref)=>handleIds.has(ref.handleId));});}

  function assertReclaimAuthority(aftercareCaseId,currentWorkId,expectedMaterials){const current=inspectLifecycle(aftercareCaseId);if(!current.care||!TERMINAL_CASE_STATES.has(current.care.state)||!current.registry||current.registry.state!=='active'||current.registry.reclaim_after_ms===null||Number(current.registry.reclaim_after_ms)>now())fail('ARCA_AFTERCARE_WORKSPACE_AUTHORITY_STALE','Aftercare Workspace reclaim authority is stale.');if(current.references.some((row)=>row.state==='active'))fail('ARCA_AFTERCARE_WORKSPACE_ACTIVE_REFERENCE','Aftercare Workspace Artifact still has an active reference.');if(scopedActiveWork(current,currentWorkId))fail('ARCA_AFTERCARE_WORKSPACE_ACTIVE_REFERENCE','Aftercare Workspace Material still has an active Work reference.');const actual=new Map(current.materials.map((row)=>[row.material_handle_id,row]));for(const row of expectedMaterials){const found=actual.get(row.material_handle_id);if(!found||found.state!=='active'||found.handle_digest!==row.handle_digest||found.fence_digest!==row.fence_digest)fail('ARCA_AFTERCARE_WORKSPACE_AUTHORITY_STALE','Aftercare Workspace Material lifecycle changed during reclaim.');}return current;}

  async function reconcileLifecycle(aftercareCaseId,settings={}) {
    const snapshot=inspectLifecycle(aftercareCaseId),care=snapshot.care,registry=snapshot.registry;
    if(!care||!registry)return Object.freeze({kind:'not_found',aftercareCaseId});
    const allMaterials=snapshot.materials,identity=reclaimIdentity(aftercareCaseId,allMaterials),reclaimedBytes=allMaterials.reduce((sum,row)=>sum+Number(row.size_bytes),0);
    if(registry.state==='reclaimed')return Object.freeze({kind:'reclaimed',aftercareCaseId,receipt:receiptFor(aftercareCaseId,identity,allMaterials,reclaimedBytes,Number(registry.reclaimed_at_ms))});
    if(registry.state!=='active')return Object.freeze({kind:'not_found',aftercareCaseId});
    if(!TERMINAL_CASE_STATES.has(care.state))return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'case_active'});
    if(registry.reclaim_after_ms===null){schedule(aftercareCaseId,Number(care.terminal_at_ms));return Object.freeze({kind:'scheduled',aftercareCaseId,reclaimAfterMs:Number(care.terminal_at_ms)+RETENTION_MS});}
    if(Number(registry.reclaim_after_ms)>now())return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'retention_period_active',reclaimAfterMs:Number(registry.reclaim_after_ms)});
    if(snapshot.references.some((row)=>row.state==='active'))return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'active_artifact_reference'});
    if(scopedActiveWork(snapshot,settings.currentWorkId||null))return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'active_work_reference'});
    ensureRoot();
    const caseRoot=path.resolve(resolvedRoot,aftercareCaseId);if(!contains(resolvedRoot,caseRoot))fail('ARCA_AFTERCARE_WORKSPACE_ESCAPE','Aftercare Workspace Case root escaped its Platform root.');
    const handles=allMaterials.map((row)=>Object.freeze({row,handle:parseHandle(row)})),expected=new Map(handles.map((item)=>[relativePath(item.handle.relativePath),item])),expectedDirectories=new Set();
    for(const rel of expected.keys()){const parts=rel.split('/');for(let count=1;count<parts.length;count+=1)expectedDirectories.add(parts.slice(0,count).join('/'));}
    const observed=await enumerate(caseRoot);
    for(const file of observed.files)if(!expected.has(file.relativePath))fail('ARCA_AFTERCARE_WORKSPACE_UNKNOWN_MEMBER','Aftercare Workspace contains an undeclared file.',{relativePath:file.relativePath});
    for(const directory of observed.directories)if(!expectedDirectories.has(directory.relativePath))fail('ARCA_AFTERCARE_WORKSPACE_UNKNOWN_MEMBER','Aftercare Workspace contains an undeclared directory.',{relativePath:directory.relativePath});
    const recovery=Boolean(settings.recoveryDecision);
    for(const [rel,item] of expected){const handle=item.handle,location=workspaceLocation(aftercareCaseId,rel);let stat;try{stat=await fs.promises.lstat(location);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(!stat.isFile()||stat.isSymbolicLink()||Number(stat.size)!==Number(handle.sizeBytes))fail('ARCA_AFTERCARE_WORKSPACE_MEMBER_CHANGED','Aftercare Workspace member changed before reclaim.',{relativePath:rel});
      if(typeof options.computeBoundedMaterialFingerprintSync==='function'){const observedIdentity=options.computeBoundedMaterialFingerprintSync(location);if(String(observedIdentity.stat.ino)!==String(handle.physicalIdentity.inode)||observedIdentity.contentFingerprint!==handle.physicalIdentity.contentFingerprint)fail('ARCA_AFTERCARE_WORKSPACE_MEMBER_CHANGED','Aftercare Workspace member identity changed before reclaim.',{relativePath:rel});}
    }
    if(!recovery){
      for(const [rel] of expected){const location=workspaceLocation(aftercareCaseId,rel);try{await fs.promises.access(location,fs.constants.F_OK);}catch(error){if(error.code==='ENOENT')fail('ARCA_AFTERCARE_WORKSPACE_MEMBER_MISSING','Aftercare Workspace member is missing before live reclaim.',{relativePath:rel});throw error;}}
    }
    for(const rel of [...expected.keys()].sort()){assertReclaimAuthority(aftercareCaseId,settings.currentWorkId||null,allMaterials);const location=workspaceLocation(aftercareCaseId,rel);try{const stat=await fs.promises.lstat(location);if(!stat.isFile()||stat.isSymbolicLink())fail('ARCA_AFTERCARE_WORKSPACE_MEMBER_CHANGED','Aftercare Workspace member changed during reclaim.',{relativePath:rel});await unlinkWorkspaceFile(location);}catch(error){if(error.code!=='ENOENT'||!recovery)throw error;}await new Promise((resolve)=>setImmediate(resolve));}
    for(const directory of [...observed.directories].sort((a,b)=>b.relativePath.length-a.relativePath.length)){try{await fs.promises.rmdir(directory.location);}catch(error){if(!['ENOENT','ENOTEMPTY'].includes(error.code))throw error;}}
    try{await fs.promises.rmdir(caseRoot);}catch(error){if(!['ENOENT','ENOTEMPTY'].includes(error.code))throw error;}
    assertReclaimAuthority(aftercareCaseId,settings.currentWorkId||null,allMaterials);
    return Object.freeze({kind:'reclaimed',aftercareCaseId,receipt:commitReclaim(aftercareCaseId,identity,allMaterials,snapshot.artifacts,reclaimedBytes)});
  }

  function listWorkspaceHandles(aftercareCaseId){return Object.freeze(inspectLifecycle(aftercareCaseId).materials.map(parseHandle).sort((left,right)=>left.handleId.localeCompare(right.handleId)));}

  return Object.freeze({rootSnapshot,resolvedRoot,ensureRoot,ensureWorkspace,workspaceLocation,workspaceRelativePath,registerMaterial,resolveArtifact,schedule,
    listLifecyclePage,reconcileLifecycle,inspectLifecycle,listWorkspaceHandles});
}

module.exports=Object.freeze({AftercareWorkspaceStoreError,RETENTION_MS,createAftercareWorkspaceStore});
