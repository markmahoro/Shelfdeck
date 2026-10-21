'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_SERIES_WORKSPACE_FENCE'});};
const registryColumns=['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state','created_at_ms','reclaim_after_ms','reclaimed_at_ms'];
const materialColumns=['workspace_id','material_handle_id','material_key','endpoint_id','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint',
  'relative_path','digest_algorithm','digest_hex','size_bytes','reference_revision','owner_domain','process_id','root_handle_ref','access_scope',
  'handle_schema_ref','handle_json','handle_digest','fence_digest','state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'];
const artifactColumns=['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes',
  'media_type','provenance_ref','reference_revision','state','created_at_ms'];

function createSeriesPresentationWorkspaceStore(options){
  const root=options.rootSnapshot,store=options.seriesStore;
  const platform=createRepositoryDefinition({repositoryId:'arca_series_workspace_root',owner:'platform-settings',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'platform_workspace_roots',columns:['root_id','owner_scope','endpoint_id','mount_scope_id','resolved_root','root_handle_ref','config_revision','snapshot_digest','state'],
      keyColumns:['root_id'],safeIntegers:true},
  }});
  const repo=createRepositoryDefinition({repositoryId:'arca_series_workspace',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    active_registries:{kind:'select-all',tableId:'fx_workspace_registry',columns:registryColumns,keyColumns:['owner_domain','process_type','state'],safeIntegers:true},
    registry:{kind:'select-one',tableId:'fx_workspace_registry',columns:registryColumns,keyColumns:['workspace_id'],safeIntegers:true},
    material:{kind:'select-one',tableId:'fx_workspace_materials',columns:materialColumns,keyColumns:['workspace_id','material_handle_id'],safeIntegers:true},
    materials:{kind:'select-all',tableId:'fx_workspace_materials',columns:materialColumns,keyColumns:['workspace_id'],safeIntegers:true},
    artifact:{kind:'select-one',tableId:'fx_artifact_registry',columns:artifactColumns,keyColumns:['artifact_handle_id'],safeIntegers:true},
    artifacts:{kind:'select-all',tableId:'fx_artifact_registry',columns:artifactColumns,keyColumns:['owner_domain','owner_scope_type','owner_scope_id'],safeIntegers:true},
    insert_registry:{kind:'insert',tableId:'fx_workspace_registry',columns:registryColumns},
    insert_material:{kind:'insert',tableId:'fx_workspace_materials',columns:materialColumns},
    insert_artifact:{kind:'insert',tableId:'fx_artifact_registry',columns:artifactColumns},
  }});
  function rootParticipant(){return {
      participantId:'arca_series_workspace_root',owner:'platform-settings',boundBusinessOwner:'arca',repositories:[platform],execute:c=>{
        const row=c.repository(platform.repositoryId).invoke('find',{root_id:root.rootId});
        if(!row||row.owner_scope!=='arca'||row.state!=='active'||row.root_handle_ref!==root.rootHandleRef||Number(row.config_revision)!==root.configRevision||
            row.endpoint_id!==root.endpointId||row.mount_scope_id!==root.mountScopeId||row.resolved_root!==root.resolvedRoot||row.snapshot_digest!==root.snapshotDigest)
          fail('Series Workspace no longer has its exact configured root.');
      },
    };}
  function execute(scope,operation){
    const frozen=store.build(scope.objectId);
    if(!frozen||frozen.digest!==scope.digest)fail('Series Workspace requires its exact immutable build.');
    return options.unitOfWork.execute([store.scopeParticipant(scope),rootParticipant(),{
      participantId:'arca_series_workspace',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repo],
      execute:c=>operation(c.repository(repo.repositoryId),c.commitTimeMs),
    }]).arca_series_workspace;
  }
  const workspaceId=scope=>scope.objectId+'-assets';
  function ensureUsing(r,scope,at){
    const id=workspaceId(scope),prior=r.invoke('registry',{workspace_id:id});
    if(prior){if(prior.owner_domain!=='arca'||prior.process_type!=='series_presentation'||prior.process_id!==scope.objectId||
        prior.root_handle_ref!==root.rootHandleRef||prior.state!=='active')fail('Series Workspace registry changed.');return;}
    r.invoke('insert_registry',{workspace_id:id,owner_domain:'arca',process_type:'series_presentation',process_id:scope.objectId,
      root_handle_ref:root.rootHandleRef,state:'active',created_at_ms:at,reclaim_after_ms:null,reclaimed_at_ms:null});
  }
  function register(scope,value){
    const handle=value.workspaceMaterialHandle,artifact=value.artifactHandle;
    options.contractValidator.validate(handle.schemaRef,handle);options.contractValidator.validate(artifact.schemaRef,artifact);
    if(handle.workspaceId!==workspaceId(scope)||handle.processId!==scope.objectId||handle.ownerDomain!=='arca'||handle.rootHandleRef!==root.rootHandleRef||
        artifact.ownerDomain!=='arca'||artifact.ownerScope.scopeType!=='series_presentation'||artifact.ownerScope.scopeId!==scope.objectId||
        artifact.provenanceRef.digest!==scope.digest||artifact.digestHex!==handle.digestHex||artifact.sizeBytes!==handle.sizeBytes)
      fail('Series Workspace Material and Artifact do not conserve their owner and source.');
    return execute(scope,(r,at)=>{
      ensureUsing(r,scope,at);
      const prior=r.invoke('material',{workspace_id:handle.workspaceId,material_handle_id:handle.handleId});
      if(prior){if(prior.handle_digest!==canonicalDigest(handle)||prior.state!=='active')fail('Series Material replay changed its immutable Handle.');}
      else r.invoke('insert_material',{workspace_id:handle.workspaceId,material_handle_id:handle.handleId,material_key:handle.materialKey,endpoint_id:handle.endpointId,
        mount_scope_id:handle.physicalIdentity.mountScopeId,inode:handle.physicalIdentity.inode,fingerprint_algorithm:handle.physicalIdentity.fingerprintAlgorithm,
        fingerprint_version:handle.physicalIdentity.fingerprintVersion,content_fingerprint:handle.physicalIdentity.contentFingerprint,
        relative_path:handle.relativePath,digest_algorithm:handle.digestAlgorithm,digest_hex:handle.digestHex,size_bytes:handle.sizeBytes,
        reference_revision:handle.referenceRevision,owner_domain:'arca',process_id:scope.objectId,root_handle_ref:root.rootHandleRef,access_scope:handle.accessScope,
        handle_schema_ref:handle.schemaRef,handle_json:canonicalJson(handle),handle_digest:canonicalDigest(handle),fence_digest:handle.fenceDigest,
        state:'active',reclaimed_effect_id:null,reclaimed_effect_receipt_digest:null,reclaimed_at_ms:null});
      const registered=r.invoke('artifact',{artifact_handle_id:artifact.artifactHandleId});
      if(registered){if(registered.digest_hex!==artifact.digestHex||registered.storage_ref!==artifact.storageRef||registered.state!=='active')
        fail('Series Artifact replay changed its exact registration.');}
      else r.invoke('insert_artifact',{artifact_handle_id:artifact.artifactHandleId,artifact_kind:artifact.artifactKind,owner_domain:'arca',
        owner_scope_type:'series_presentation',owner_scope_id:scope.objectId,storage_ref:artifact.storageRef,digest_algorithm:artifact.digestAlgorithm,
        digest_hex:artifact.digestHex,size_bytes:artifact.sizeBytes,media_type:artifact.mediaType,provenance_ref:canonicalJson(artifact.provenanceRef),
        reference_revision:artifact.referenceRevision,state:'active',created_at_ms:at});
    });
  }
  function resolve(scope,handle){return execute(scope,r=>{
    const registry=r.invoke('registry',{workspace_id:workspaceId(scope)}),row=r.invoke('material',{workspace_id:workspaceId(scope),material_handle_id:handle.handleId});
    if(!registry||registry.state!=='active'||registry.root_handle_ref!==root.rootHandleRef||!row||row.state!=='active'||
        row.handle_digest!==canonicalDigest(handle)||handle.workspaceId!==workspaceId(scope)||handle.processId!==scope.objectId)
      fail('Series Workspace read requires its exact active registered Handle.');return handle;
  });}
  function inspect(scope){return execute(scope,r=>{
    const registry=r.invoke('registry',{workspace_id:workspaceId(scope)}),rows=r.invoke('materials',{workspace_id:workspaceId(scope)});
    if(rows.length>3||!registry&&rows.length)fail('Series Workspace recovery registry exceeds its declared member set.');
    return {registryExists:Boolean(registry),members:rows.map(row=>{
      const handle=JSON.parse(row.handle_json);if(row.state!=='active'||row.handle_digest!==canonicalDigest(handle)||handle.processId!==scope.objectId)
        fail('Series recovery Material differs from its immutable registration.');return handle;
    })};
  });}
  function snapshot(scope){return options.unitOfWork.execute([rootParticipant(),{participantId:'arca_series_workspace_snapshot',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repo],execute:c=>{
    const r=c.repository(repo.repositoryId),registry=r.invoke('registry',{workspace_id:workspaceId(scope)}),rows=r.invoke('materials',{workspace_id:workspaceId(scope)}),artifacts=r.invoke('artifacts',{owner_domain:'arca',owner_scope_type:'series_presentation',owner_scope_id:scope.objectId});
    if(rows.length>3||artifacts.length!==rows.length||registry&&(registry.owner_domain!=='arca'||registry.process_id!==scope.objectId||registry.root_handle_ref!==root.rootHandleRef))fail('Recovery registration differs from the exact bounded build.');
    return {registry,artifacts:rows.map(row=>{const handle=JSON.parse(row.handle_json),a=artifacts.find(item=>item.digest_hex===handle.digestHex&&item.storage_ref.split('\\').join('/').endsWith('/'+handle.relativePath.split('\\').join('/')));
      if(row.handle_digest!==canonicalDigest(handle)||handle.processId!==scope.objectId||!a||!(row.state==='active'&&a.state==='active'||row.state==='reclaimed'&&a.state==='deleted'))fail('Recovery registration is not an exact Material/Artifact pair.');
      return {artifactKind:a.artifact_kind,workspaceMaterialHandle:handle,artifactHandle:{schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:a.artifact_handle_id,artifactKind:a.artifact_kind,ownerDomain:a.owner_domain,ownerScope:{scopeType:a.owner_scope_type,scopeId:a.owner_scope_id},storageRef:a.storage_ref,digestAlgorithm:a.digest_algorithm,digestHex:a.digest_hex,sizeBytes:Number(a.size_bytes),mediaType:a.media_type,provenanceRef:JSON.parse(a.provenance_ref),referenceRevision:Number(a.reference_revision)}};
    })};
  }}]).arca_series_workspace_snapshot;}
  return Object.freeze({listActive:()=>options.unitOfWork.execute([{participantId:'arca_series_active_workspaces',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repo],
    execute:c=>c.repository(repo.repositoryId).invoke('active_registries',{owner_domain:'arca',process_type:'series_presentation',state:'active'})}]).arca_series_active_workspaces,rootParticipant,assertRoot:()=>options.unitOfWork.execute([rootParticipant()]),ensure:scope=>execute(scope,(r,at)=>ensureUsing(r,scope,at)),register,resolve,inspect,snapshot});
}
module.exports=Object.freeze({createSeriesPresentationWorkspaceStore,registryColumns,materialColumns,artifactColumns});
