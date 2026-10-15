'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {readBoundedFileSnapshotSync}=require('./bounded-material-fingerprint');
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});};
function createJavCorrectionWorkspaceReclaim({validatePlan}) {
  if(typeof validatePlan!=='function')throw new TypeError('Workspace reclaim requires its closed Plan validator.');
  function scope(plan,options){
    validatePlan(plan);const {planDigest,...body}=plan,{guardDigest,...guard}=body;
    if(planDigest!==canonicalDigest(body)||guardDigest!==canonicalDigest(guard)||plan.handleSetDigest!==canonicalDigest({members:plan.members,artifacts:plan.artifacts})||
        !/^arca-jav-correction-[a-f0-9]{40}$/.test(plan.correctionId)||!path.isAbsolute(plan.root.resolvedRoot)||
        plan.members.map(item=>item.relativePath).join(',')!=='fanart/fanart.jpg,metadata/metadata.json,nfo/movie.nfo,poster/poster.jpg'||
        plan.artifacts.map(item=>item.artifactKind).join(',')!=='fanart,nfo,poster'||
        typeof options?.shouldContinue!=='function'||options.shouldContinue()!==true||typeof options.readCurrentGuardDigest!=='function'||
        options.readCurrentGuardDigest()!==guardDigest)fail('Workspace reclaim lost its exact Plan or current execution/ownership guard.');
    for(const member of plan.members){
      const {fenceDigest,...unsigned}=member,physical=member.physicalIdentity;
      if(member.ownerDomain!=='arca'||member.processId!==plan.correctionId||member.workspaceId!==plan.correctionId+'-assets'||
          member.rootHandleRef!==plan.root.rootHandleRef||member.endpointId!==plan.root.endpointId||physical.mountScopeId!==plan.root.mountScopeId||
          physical.sizeBytes!==member.sizeBytes||member.digestAlgorithm!=='sha256'||fenceDigest!==canonicalDigest(unsigned)||
          member.materialKey!==canonicalDigest({schema:'physical-material-identity@2',...physical}))fail('Workspace reclaim contains a foreign Handle.');
    }
  }
  function stat(location){try{return fs.lstatSync(location,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  function directory(location,required=false){const value=stat(location);if(!value){if(required)fail('Workspace root is unavailable.');return null;}
    if(!value.isDirectory()||value.isSymbolicLink())fail('Workspace reclaim encountered a foreign or linked directory.');return value;}
  function rootDirectories(root){let current=path.parse(root).root;directory(current,true);
    for(const segment of path.relative(current,root).split(path.sep).filter(Boolean)){current=path.join(current,segment);directory(current,true);}}
  function locations(plan){const root=path.resolve(plan.root.resolvedRoot),workspace=path.join(root,plan.correctionId+'-assets');
    return {root,workspace,members:plan.members.map(handle=>({handle,location:path.join(workspace,...handle.relativePath.split('/'))}))};}
  function inspectTree(plan){const value=locations(plan);rootDirectories(value.root);
    if(directory(value.workspace)){
      const kinds=fs.readdirSync(value.workspace);if(kinds.length>4)fail('Workspace contains undeclared directories.');
      for(const kind of kinds){const member=value.members.find(item=>item.handle.relativePath.split('/')[0]===kind);
        if(!member)fail('Workspace contains an undeclared directory.');const parent=path.dirname(member.location);directory(parent,true);
        const names=fs.readdirSync(parent);if(names.length>1||names.some(name=>name!==path.basename(member.location)))fail('Workspace contains undeclared files.');}
    }
    return value;
  }
  function inspectMember(member,allowMissing){const value=stat(member.location);if(!value){if(!allowMissing)fail('Registered Workspace member is missing before initial reclaim.');return null;}
    const handle=member.handle,physical=handle.physicalIdentity,kind=handle.relativePath.split('/')[0],maximum=kind==='metadata'||kind==='nfo'?128*1024:16*1024*1024;
    if(!value.isFile()||value.isSymbolicLink()||value.size!==BigInt(handle.sizeBytes)||handle.sizeBytes>maximum)fail('Workspace member differs from its bounded registered bytes.');
    const snapshot=readBoundedFileSnapshotSync(member.location,maximum,{requireStableSnapshot:true});
    if(String(snapshot.stat.ino)!==physical.inode||snapshot.contentFingerprint!==physical.contentFingerprint||
        snapshot.fingerprintAlgorithm!==physical.fingerprintAlgorithm||snapshot.fingerprintVersion!==physical.fingerprintVersion||
        createHash('sha256').update(snapshot.bytes).digest('hex')!==handle.digestHex)fail('Workspace member Physical Identity or complete bytes changed.');
    return snapshot.stat;
  }
  function preflight(plan,options){scope(plan,options);const value=inspectTree(plan),allowMissing=options.recoveryDecision==='continue_forward';
    return {...value,members:value.members.map(member=>({...member,stat:inspectMember(member,allowMissing)}))};}
  function verifyReclaimed(plan,options){scope(plan,options);const value=inspectTree(plan);
    if(stat(value.workspace)||value.members.some(member=>stat(member.location)))fail('Workspace reclaim has not removed the complete declared file and directory set.');
    return {correctionId:plan.correctionId,committedContextDigest:plan.committedContextDigest,handleSetDigest:plan.handleSetDigest,
      reclaimedHandleCount:4,reclaimedArtifactCount:3,reclaimedBytes:plan.members.reduce((sum,member)=>sum+member.sizeBytes,0),workspaceDisposition:'absent',
      realityDigest:canonicalDigest({schema:'arca.jav-correction-workspace-reclaimed@1',planDigest:plan.planDigest,handleSetDigest:plan.handleSetDigest,workspaceDisposition:'absent'})};
  }
  function reclaim(plan,options){const value=preflight(plan,options);
    for(const member of value.members){scope(plan,options);inspectTree(plan);const observed=inspectMember(member,options.recoveryDecision==='continue_forward');
      if(!observed)continue;scope(plan,options);inspectTree(plan);const current=stat(member.location);
      if(!current||current.isSymbolicLink()||!current.isFile()||current.dev!==observed.dev||current.ino!==observed.ino||current.size!==observed.size||
          current.mtimeNs!==observed.mtimeNs||current.ctimeNs!==observed.ctimeNs)fail('Workspace member changed immediately before scoped unlink.');
      fs.unlinkSync(member.location);
    }
    for(const parent of [...value.members.map(member=>path.dirname(member.location)),value.workspace]){
      scope(plan,options);inspectTree(plan);const observed=directory(parent);if(!observed)continue;
      if(fs.readdirSync(parent).length)fail('Workspace directory became nonempty before removal.');
      scope(plan,options);inspectTree(plan);const current=directory(parent,true);
      if(current.dev!==observed.dev||current.ino!==observed.ino||current.mtimeNs!==observed.mtimeNs||current.ctimeNs!==observed.ctimeNs||fs.readdirSync(parent).length)
        fail('Workspace directory changed immediately before scoped removal.');fs.rmdirSync(parent);
    }
    return verifyReclaimed(plan,options);
  }
  return Object.freeze({preflight,reclaim,verifyReclaimed});
}
module.exports=Object.freeze({createJavCorrectionWorkspaceReclaim});
