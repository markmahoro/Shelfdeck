'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {readBoundedFileSnapshotSync}=require('./bounded-material-fingerprint');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function createJavCorrectionWorkspaceIo({rootSnapshot}) {
  if(!rootSnapshot?.resolvedRoot||!path.isAbsolute(rootSnapshot.resolvedRoot)||!rootSnapshot.rootHandleRef||!rootSnapshot.mountScopeId||!rootSnapshot.endpointId)
    throw new TypeError('Correction Workspace IO requires its exact configured root snapshot.');
  const root=path.resolve(rootSnapshot.resolvedRoot);
  function location(correctionId,kind) {
    if(!/^arca-jav-correction-[a-f0-9]{40}$/.test(correctionId)||!['metadata','nfo','poster','fanart'].includes(kind))
      fail('ARCA_JAV_CORRECTION_WORKSPACE_PATH_INVALID','Correction Workspace path is not a declared scope member.');
    const names={metadata:'metadata.json',nfo:'movie.nfo',poster:'poster.jpg',fanart:'fanart.jpg'},relativePath=kind+'/'+names[kind],workspaceId=correctionId+'-assets';
    return {workspaceId,relativePath,location:path.join(root,workspaceId,kind,names[kind])};
  }
  function assertParents(target) {
    if(!fs.existsSync(root)||!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())
      fail('ARCA_JAV_CORRECTION_WORKSPACE_ROOT_UNAVAILABLE','Registered correction Workspace root is unavailable.');
    const relative=path.relative(root,target);
    if(relative.startsWith('..')||path.isAbsolute(relative))fail('ARCA_JAV_CORRECTION_WORKSPACE_PATH_INVALID','Workspace path escaped its root.');
    let current=root;
    for(const part of relative.split(path.sep)) {
      current=path.join(current,part);
      let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(stat.isSymbolicLink()||current!==target&&!stat.isDirectory())
        fail('ARCA_JAV_CORRECTION_WORKSPACE_PATH_INVALID','Workspace path traverses a foreign or linked member.');
    }
  }
  function describe(members) {
    if(!Array.isArray(members)||members.map(item=>item.kind).join(',')!=='metadata,nfo,poster,fanart')
      fail('ARCA_JAV_CORRECTION_WORKSPACE_BYTES_INVALID','Correction byte recipe must contain the four exact ordered members.');
    return members.map(({kind,bytes})=>{
      if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>(kind==='metadata'||kind==='nfo'?128*1024:16*1024*1024))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_BYTES_INVALID','Correction recipe exceeds its member byte bound.');
      return {kind,byteDigest:sha(bytes),sizeBytes:bytes.length};
    });
  }
  function temporaryLocation(member,byteDigest) {
    if(!/^[a-f0-9]{64}$/.test(byteDigest))fail('ARCA_JAV_CORRECTION_WORKSPACE_BYTES_INVALID','Producer temporary requires the frozen full byte digest.');
    return path.join(path.dirname(member.location),'.shelfdeck-writing-'+byteDigest+'.part');
  }
  function observe({correctionId,byteExpectations,registry}) {
    const observed=[],temporaries=[];let conflict=false,partialTemporary=false;
    for(const expected of byteExpectations) {
      const member=location(correctionId,expected.kind);assertParents(member.location);
      const temporary=temporaryLocation(member,expected.byteDigest);assertParents(temporary);
      let temporaryStat;try{temporaryStat=fs.lstatSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(temporaryStat) {
        if(!temporaryStat.isFile()||temporaryStat.isSymbolicLink()||temporaryStat.size>expected.sizeBytes||registry?.registryExists!==true)conflict=true;
        else {
          const snapshot=readBoundedFileSnapshotSync(temporary,expected.sizeBytes,{requireStableSnapshot:true}),byteDigest=sha(snapshot.bytes),complete=snapshot.bytes.length===expected.sizeBytes;
          if(complete&&byteDigest!==expected.byteDigest)conflict=true;
          else if(!complete)partialTemporary=true;
          temporaries.push({kind:expected.kind,sizeBytes:snapshot.bytes.length,byteDigest,inode:String(snapshot.stat.ino),complete});
        }
      }
      let stat;try{stat=fs.lstatSync(member.location);}catch(error){if(error.code!=='ENOENT')throw error;}
      const registered=registry?.members.find(handle=>handle.relativePath===member.relativePath);
      if(!stat){conflict ||= Boolean(registered);observed.push({kind:expected.kind,present:false});continue;}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==expected.sizeBytes){conflict=true;observed.push({kind:expected.kind,present:true,matching:false});continue;}
      const snapshot=readBoundedFileSnapshotSync(member.location,expected.sizeBytes,{requireStableSnapshot:true}),byteDigest=sha(snapshot.bytes),
        matching=byteDigest===expected.byteDigest&&registry?.registryExists===true&&(!registered||registered.digestHex===byteDigest&&registered.sizeBytes===expected.sizeBytes&&
          registered.physicalIdentity.inode===String(snapshot.stat.ino)&&registered.physicalIdentity.contentFingerprint===snapshot.contentFingerprint);
      conflict ||= !matching;observed.push({kind:expected.kind,present:true,matching,byteDigest,inode:String(snapshot.stat.ino)});
    }
    conflict ||= !registry||registry.members.some(handle=>!byteExpectations.some(expected=>location(correctionId,expected.kind).relativePath===handle.relativePath));
    const directory=path.join(root,correctionId+'-assets'),allowed=new Set(byteExpectations.flatMap(item=>{
      const member=location(correctionId,item.kind);return [member.location,temporaryLocation(member,item.byteDigest)];}));
    if(fs.existsSync(directory)) {
      for(const kind of fs.readdirSync(directory)) {
        const parent=path.join(directory,kind),stat=fs.lstatSync(parent);
        if(!['metadata','nfo','poster','fanart'].includes(kind)||!stat.isDirectory()||stat.isSymbolicLink()){conflict=true;continue;}
        for(const name of fs.readdirSync(parent))if(!allowed.has(path.join(parent,name)))conflict=true;
      }
    }
    return {status:conflict||partialTemporary?'conflict':observed.some(item=>item.present)||temporaries.length?'matching':'absent',cleanupDeclared:!conflict&&partialTemporary,
      evidenceDigest:canonicalDigest({schema:'arca.jav-correction-workspace-reality@1',correctionId,rootHandleRef:rootSnapshot.rootHandleRef,byteExpectations,observed,temporaries,conflict,partialTemporary})};
  }
  function write({correctionId,admissionDigest,kind,bytes,shouldContinue,recoveryDecision=null}) {
    const maximum=kind==='metadata'||kind==='nfo'?128*1024:16*1024*1024;
    if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>maximum||!/^[a-f0-9]{64}$/.test(admissionDigest||''))
      fail('ARCA_JAV_CORRECTION_WORKSPACE_BYTES_INVALID','Correction Workspace bytes exceed their exact member bound.');
    const member=location(correctionId,kind),continueScope=()=>{if(typeof shouldContinue!=='function'||shouldContinue()!==true)
      fail('ARCA_JAV_CORRECTION_WORKSPACE_FENCED','Correction execution no longer holds its file scope.');};
    continueScope();assertParents(member.location);fs.mkdirSync(path.dirname(member.location),{recursive:true});assertParents(member.location);continueScope();
    const temporary=temporaryLocation(member,sha(bytes));assertParents(temporary);
    let temporaryStat;try{temporaryStat=fs.lstatSync(temporary,{bigint:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    if(temporaryStat) {
      if(!temporaryStat.isFile()||temporaryStat.isSymbolicLink()||temporaryStat.size>BigInt(bytes.length))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Producer temporary is outside the frozen byte recipe.');
      const snapshot=readBoundedFileSnapshotSync(temporary,maximum,{requireStableSnapshot:true});
      if(snapshot.bytes.length===bytes.length&&!snapshot.bytes.equals(bytes))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Complete producer temporary conflicts with the frozen bytes.');
      if(snapshot.bytes.length<bytes.length&&recoveryDecision!=='safe_retry')
        fail('ARCA_JAV_CORRECTION_TEMP_RECOVERY_REQUIRED','A short producer temporary requires classified cleanup and rebuild.');
      continueScope();assertParents(temporary);const current=fs.lstatSync(temporary,{bigint:true});
      if(current.ino!==snapshot.stat.ino||current.dev!==snapshot.stat.dev||current.size!==snapshot.stat.size||current.mtimeNs!==snapshot.stat.mtimeNs||current.ctimeNs!==snapshot.stat.ctimeNs)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Producer temporary changed before its scoped cleanup.');
      // This fixed, recipe-named producer file has no Material or Artifact authority.
      // Only a classified recovery may discard a short write; final targets are never removed.
      if(snapshot.bytes.length<bytes.length)fs.unlinkSync(temporary);
    }
    let targetStat;try{targetStat=fs.lstatSync(member.location);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(targetStat&&(!targetStat.isFile()||targetStat.isSymbolicLink()||targetStat.size!==bytes.length||
        !readBoundedFileSnapshotSync(member.location,maximum,{requireStableSnapshot:true}).bytes.equals(bytes)))
      fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Existing correction bytes differ from the frozen source Result.');
    if(!targetStat) {
      if(!fs.existsSync(temporary)) {
        const descriptor=fs.openSync(temporary,'wx');
        try{fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
      }
      continueScope();assertParents(temporary);assertParents(member.location);
      if(!readBoundedFileSnapshotSync(temporary,maximum,{requireStableSnapshot:true}).bytes.equals(bytes))
        fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Producer temporary changed before atomic publication.');
      try{fs.linkSync(temporary,member.location);}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    continueScope();const fingerprint=readBoundedFileSnapshotSync(member.location,maximum,{requireStableSnapshot:true}),actual=fingerprint.bytes,digestHex=sha(actual);
    if(actual.length!==bytes.length||!actual.equals(bytes))fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Correction bytes changed after write.');
    if(fs.existsSync(temporary)) {
      continueScope();assertParents(temporary);const snapshot=readBoundedFileSnapshotSync(temporary,maximum,{requireStableSnapshot:true});
      if(!snapshot.bytes.equals(bytes))fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Published producer temporary changed before cleanup.');
      const current=fs.lstatSync(temporary,{bigint:true});
      if(current.ino!==snapshot.stat.ino||current.dev!==snapshot.stat.dev||current.size!==snapshot.stat.size||current.mtimeNs!==snapshot.stat.mtimeNs||current.ctimeNs!==snapshot.stat.ctimeNs)
        fail('ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT','Published producer temporary changed before cleanup.');
      fs.unlinkSync(temporary);
    }
    const physicalIdentity={mountScopeId:rootSnapshot.mountScopeId,
      inode:String(fingerprint.stat.ino),sizeBytes:Number(fingerprint.stat.size),fingerprintAlgorithm:fingerprint.fingerprintAlgorithm,
      fingerprintVersion:fingerprint.fingerprintVersion,contentFingerprint:fingerprint.contentFingerprint},unsigned={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,
      handleId:'arca-correction-material-'+canonicalDigest({correctionId,kind,digestHex}).slice(0,40),workspaceId:member.workspaceId,ownerDomain:'arca',processId:correctionId,
      endpointId:rootSnapshot.endpointId,materialKey:canonicalDigest({schema:'physical-material-identity@2',...physicalIdentity}),physicalIdentity,
      rootHandleRef:rootSnapshot.rootHandleRef,relativePath:member.relativePath,digestAlgorithm:'sha256',digestHex,sizeBytes:actual.length,referenceRevision:1,accessScope:'workspace_material_read'},
      workspaceMaterialHandle=Object.freeze({...unsigned,fenceDigest:canonicalDigest(unsigned)}),artifactHandle=kind==='metadata'?null:Object.freeze({
        schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:'arca-correction-artifact-'+canonicalDigest({correctionId,kind,digestHex}).slice(0,40),
        artifactKind:kind,ownerDomain:'arca',ownerScope:{scopeType:'jav_identity_correction',scopeId:correctionId},storageRef:member.location.split(path.sep).join('/'),
        digestAlgorithm:'sha256',digestHex,sizeBytes:actual.length,mediaType:kind==='nfo'?'application/xml':'image/jpeg',
        provenanceRef:{objectType:'jav_identity_correction',objectId:correctionId,revision:1,digest:admissionDigest},referenceRevision:1});
    continueScope();return Object.freeze({workspaceMaterialHandle,artifactHandle});
  }
  return Object.freeze({write,location,describe,observe});
}
module.exports=Object.freeze({createJavCorrectionWorkspaceIo});
