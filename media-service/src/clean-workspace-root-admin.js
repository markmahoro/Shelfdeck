'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { createRepositoryDefinition } = require('./helix/foundation/persistence/owner-repository');
const { createLocationRegistryService } = require('./helix/platform/application/location-registry');
const { createPathAuthority } = require('./helix/platform/model/path-authority');

const ROOT_ID='service-libra-production-workspace';

class CleanWorkspaceRootAdminError extends Error {
  constructor(code,message,details={}){super(message);this.name='CleanWorkspaceRootAdminError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new CleanWorkspaceRootAdminError(code,message,details);}

function activityDefinition(schemaManifest){
  return createRepositoryDefinition({repositoryId:'clean_workspace_root_activity',owner:'libra',readOnly:true,schemaManifest,statements:{
    list_workspaces:{kind:'select-all',tableId:'libra_workspaces',columns:['workspace_id','state'],keyColumns:[]},
    list_cleanup_scopes:{kind:'select-all',tableId:'libra_workspace_cleanup_scopes',columns:['cleanup_scope_id','state'],keyColumns:[]},
  }});
}

function createCleanWorkspaceRootAdmin(options){
  if(!options?.schemaManifest||!options.unitOfWork||!options.locationRegistryRepository||!options.mountScopeResolver||
      typeof options.effectiveRootPath!=='string'||typeof options.reservedRoots!=='function'){
    fail('CLEAN_WORKSPACE_ROOT_ADMIN_DEPENDENCIES','Workspace Root Admin requires Platform persistence, probes, and the effective root.');
  }
  const now=options.now||Date.now;
  const pathAuthority=createPathAuthority(path);
  const activity=activityDefinition(options.schemaManifest);

  function reserved(){
    const values=options.reservedRoots();
    if(!Array.isArray(values)||values.length>4096)fail('CLEAN_WORKSPACE_ROOT_RESERVED_INVALID','Reserved roots are invalid.');
    return values.filter((item)=>item&&item.rootId!==ROOT_ID&&typeof item.resolvedRoot==='string').map((item)=>Object.freeze({
      kind:String(item.kind),rootId:String(item.rootId),resolvedRoot:pathAuthority.canonicalize(item.resolvedRoot),
      revision:Number.isSafeInteger(item.revision)?item.revision:1,
    }));
  }

  function assertNoOverlap(resolvedRoot){
    for(const item of reserved())if(pathAuthority.overlaps(resolvedRoot,item.resolvedRoot)){
      fail('P5_WORKSPACE_ROOT_RESERVED_OVERLAP','Production Workspace overlaps another managed directory.',
        {reservedKind:item.kind,reservedRootId:item.rootId});
    }
    for(const item of options.locationRegistryRepository.listWorkspaceRoots()){
      if(item.rootId!==ROOT_ID&&item.state==='active'&&pathAuthority.overlaps(resolvedRoot,item.resolvedRoot)){
        fail('P5_WORKSPACE_ROOT_OVERLAP','Production Workspace overlaps another active Workspace Root.',{rootId:item.rootId});
      }
    }
  }

  function inspectRoot(request){
    const requested=pathAuthority.canonicalize(request.resolvedRoot);
    assertNoOverlap(requested);
    let first=null,second=null;
    try{
      fs.mkdirSync(requested,{recursive:true});
      const real=path.resolve(fs.realpathSync.native(requested));
      if(real!==path.resolve(requested))fail('CLEAN_WORKSPACE_ROOT_REALPATH_CHANGED','Workspace path resolves through a symlink or another location.');
      const suffix=crypto.randomUUID();
      first=path.join(real,`.shelfdeck-workspace-probe-${suffix}.tmp`);
      second=path.join(real,`.shelfdeck-workspace-probe-${suffix}.ready`);
      const bytes=Buffer.from(`shelfdeck-workspace-probe:${suffix}`,'utf8');
      fs.writeFileSync(first,bytes,{flag:'wx'});
      fs.renameSync(first,second);first=null;
      if(!fs.readFileSync(second).equals(bytes))fail('CLEAN_WORKSPACE_ROOT_READ_FAILED','Workspace probe bytes could not be read back.');
      fs.unlinkSync(second);second=null;
      const statistics=(options.statfsSync||fs.statfsSync)(real,{bigint:true});
      const available=statistics.bavail*statistics.bsize;
      const availableBytes=available>BigInt(Number.MAX_SAFE_INTEGER)?Number.MAX_SAFE_INTEGER:Number(available);
      if(availableBytes<1)fail('CLEAN_WORKSPACE_ROOT_SPACE_UNAVAILABLE',
        'Production Workspace directory has no usable free space.');
      const capabilityDigest=canonicalDigest({schema:'platform.local-workspace-capability@2',resolvedRoot:real,
        operations:['atomic_rename','create','delete','read','stat','write']});
      return Object.freeze({resolvedRoot:real,created:true,writable:true,atomicRename:true,readable:true,deletable:true,
        availableBytes,capabilityDigest,probeEvidenceDigest:canonicalDigest({schema:'platform.workspace-root-probe@1',
          resolvedRoot:real,capabilityDigest,availableBytes})});
    }catch(error){
      if(error instanceof CleanWorkspaceRootAdminError)throw error;
      fail('CLEAN_WORKSPACE_ROOT_PROBE_FAILED','Production Workspace directory is not fully readable and writable.',
        {reasonCode:error.code||'FILESYSTEM_PROBE_FAILED'});
    }finally{
      for(const candidate of [first,second])if(candidate)try{fs.unlinkSync(candidate);}catch{}
    }
  }

  const locationRegistry=createLocationRegistryService({repository:options.locationRegistryRepository,pathAuthority,
    mountProbe:{inspect(){throw new Error('Mount publication is owned by the local mount resolver.');}},
    workspaceProbe:{inspect:inspectRoot,assessSpace:({resolvedRoot})=>{
      const statistics=(options.statfsSync||fs.statfsSync)(resolvedRoot,{bigint:true});
      const available=statistics.bavail*statistics.bsize;
      return {availableBytes:available>BigInt(Number.MAX_SAFE_INTEGER)?Number.MAX_SAFE_INTEGER:Number(available)};
    }},reservedRootQuery:{list:reserved},clock:{now}});

  function assertSwitchIdle(){
    const value=options.unitOfWork.execute([{participantId:'clean_workspace_root_activity',owner:'libra',repositories:[activity],execute(context){
      const repo=context.repository(activity.repositoryId);
      return {workspaces:repo.invoke('list_workspaces',{}).filter((item)=>['active','reclaiming'].includes(item.state)),
        cleanupScopes:repo.invoke('list_cleanup_scopes',{}).filter((item)=>item.state==='active')};
    }}]).clean_workspace_root_activity;
    if(value.workspaces.length||value.cleanupScopes.length)fail('CLEAN_WORKSPACE_ROOT_SWITCH_BUSY',
      'Production Workspace can change only after all existing Workspaces are reclaimed.',
      {activeWorkspaceCount:value.workspaces.length,activeCleanupScopeCount:value.cleanupScopes.length});
  }

  function view(){
    const durable=options.locationRegistryRepository.getWorkspaceRoot(ROOT_ID);
    const effective=path.resolve(options.effectiveRootPath);
    const pending=durable&&path.resolve(durable.resolvedRoot)!==effective?Object.freeze({rootPath:durable.resolvedRoot,
      configRevision:durable.configRevision,validation:'passed'}):null;
    return Object.freeze({current:Object.freeze({rootPath:effective,configRevision:pending?durable.configRevision-1:durable?.configRevision||1}),
      pending,restartRequired:Boolean(pending)});
  }

  function probe(body){
    const rootPath=pathAuthority.canonicalize(body?.rootPath);
    const inspected=inspectRoot({resolvedRoot:rootPath});
    const mount=options.mountScopeResolver.resolveRoot({rootLocation:inspected.resolvedRoot});
    return Object.freeze({rootPath:inspected.resolvedRoot,validation:'passed',availableBytes:inspected.availableBytes,
      endpointId:mount.endpointId,mountScopeId:mount.mountScopeId,mountScopeRevision:mount.mountScopeRevision});
  }

  function configure(body){
    const requested=pathAuthority.canonicalize(body?.rootPath);
    const current=options.locationRegistryRepository.getWorkspaceRoot(ROOT_ID);
    if(current&&path.resolve(current.resolvedRoot)===path.resolve(requested)&&
        [current.configRevision,current.configRevision-1].includes(body?.expectedConfigRevision))return view();
    assertSwitchIdle();
    if(!current||body?.expectedConfigRevision!==current.configRevision)fail('P5_WORKSPACE_ROOT_REVISION_CONFLICT',
      'Production Workspace setting changed; reload before saving.');
    const checked=probe({rootPath:requested});
    if(path.resolve(checked.rootPath)===path.resolve(options.effectiveRootPath))return view();
    locationRegistry.publishWorkspaceRoot({rootId:ROOT_ID,rootKind:'production-workspace',endpointId:checked.endpointId,
      mountScopeId:checked.mountScopeId,mountScopeRevision:checked.mountScopeRevision,requestedRoot:checked.rootPath,
      expectedConfigRevision:current.configRevision,updatedAtMs:now()});
    return view();
  }

  return Object.freeze({get:view,probe,configure});
}

module.exports=Object.freeze({CleanWorkspaceRootAdminError,createCleanWorkspaceRootAdmin});
