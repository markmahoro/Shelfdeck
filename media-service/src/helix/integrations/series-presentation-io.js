'use strict';

const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),sharp=require('sharp');
const {canonicalDigest}=require('../contracts/canonical-json');
const {analyzeNfoDocument,attribute,childText,directText}=require('../contracts/movie-nfo-document');
const {readBoundedFileSnapshotSync}=require('./bounded-material-fingerprint');
const {seriesPresentationFileName:fileName}=require('../contracts/series-presentation-basis');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const limit=kind=>kind==='nfo'?256*1024:16*1024*1024;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

function assertParents(root,target){
  const relative=path.relative(root,target);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('ARCA_SERIES_PATH_ESCAPE','Series file escapes its declared root.');
  let current=root;
  for(const part of ['',...relative.split(path.sep)]){
    if(part)current=path.join(current,part);
    let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.isSymbolicLink()||(current!==target&&!stat.isDirectory()))fail('ARCA_SERIES_PATH_CONFLICT','Series path crosses a linked or foreign parent.');
  }
}

function nfoIdentity(bytes){
  const document=analyzeNfoDocument(bytes,'tvshow');
  if(!document.usable||!directText(document,'title'))fail('ARCA_SERIES_NFO_INVALID','Series NFO must be a complete tvshow document with a title.');
  if(document.directChildren.some(node=>['episodedetails','season','season_number','seasonnumber','episode','episode_number','episodenumber'].includes(node.name)))
    fail('ARCA_SERIES_NFO_SCOPE_INVALID','Season or Episode NFO cannot be adopted as the shared show document.');
  const ids=document.directChildren.filter(node=>node.name==='tmdbid'||node.name==='uniqueid'&&attribute(node,'type')==='tmdb')
    .map(node=>childText(document,node));
  if(ids.length<1||ids.some(id=>!/^\d+$/.test(id||''))||new Set(ids).size!==1)
    fail('ARCA_SERIES_NFO_IDENTITY_INVALID','Series NFO requires one unambiguous top-level show identity.');
  return ids[0];
}

async function imageBytes(bytes,kind){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>limit(kind))fail('ARCA_SERIES_IMAGE_BOUND','Series image exceeds its byte bound.');
  let decoded;
  try{decoded=await sharp(bytes,{limitInputPixels:64*1024*1024,failOn:'error'}).rotate().jpeg({quality:90}).toBuffer({resolveWithObject:true});}
  catch{fail('ARCA_SERIES_IMAGE_UNDECODABLE','Series image cannot be decoded.');}
  const {width,height}=decoded.info;
  if(!width||!height||(kind==='poster'?height<=width:width<=height)||decoded.data.length>limit(kind))
    fail('ARCA_SERIES_IMAGE_ROLE_INVALID','Series image dimensions do not match its poster or background role.');
  return {bytes:decoded.data,width,height};
}

function physicalIdentity(snapshot,mountScopeId){
  const tuple={mountScopeId,inode:String(snapshot.stat.ino),sizeBytes:Number(snapshot.stat.size),
    fingerprintAlgorithm:snapshot.fingerprintAlgorithm,fingerprintVersion:snapshot.fingerprintVersion,contentFingerprint:snapshot.contentFingerprint};
  return {schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple};
}

function createSeriesPresentationIo({rootSnapshot,afterPhysicalEffect}){
  if(!rootSnapshot?.resolvedRoot||!path.isAbsolute(rootSnapshot.resolvedRoot)||!rootSnapshot.rootHandleRef||!rootSnapshot.endpointId||!rootSnapshot.mountScopeId)
    throw new TypeError('Series Workspace requires its registered Arca root snapshot.');
  const workspaceRoot=path.resolve(rootSnapshot.resolvedRoot);
  const continuation=execution=>{if(typeof execution.shouldContinue!=='function'||execution.shouldContinue()!==true)
    fail('ARCA_SERIES_EXECUTION_FENCED','Series presentation execution lost its active scope.');};
  function workspaceLocation(scope,kind){
    if(!/^arca-series-build-[a-f0-9]{40}$/.test(scope.objectId))fail('ARCA_SERIES_WORKSPACE_SCOPE_INVALID','Series Workspace has an invalid build identity.');
    const workspaceId=scope.objectId+'-assets',relativePath=kind+'/'+fileName(kind),location=path.join(workspaceRoot,workspaceId,relativePath);
    assertParents(workspaceRoot,location);return {workspaceId,relativePath,location};
  }
  async function member(binding,kind,sourceDigest){
    if(!path.isAbsolute(binding.shelfRoot)||!path.isAbsolute(binding.rootLocation)||path.resolve(binding.shelfRoot)===path.resolve(binding.rootLocation))
      fail('ARCA_SERIES_PATH_ESCAPE','Series file requires a distinct absolute root within its Shelf.');
    assertParents(binding.shelfRoot,binding.rootLocation);
    const location=path.join(binding.rootLocation,fileName(kind));assertParents(binding.shelfRoot,location);
    let stat;try{stat=fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())fail('ARCA_SERIES_FILE_CONFLICT','Required Series file is not a regular unlinked file.');
    const snapshot=readBoundedFileSnapshotSync(location,limit(kind),{requireStableSnapshot:true}),bytes=snapshot.bytes;
    let width=null,height=null,nfoProviderKey=null;
    if(kind==='nfo')nfoProviderKey=nfoIdentity(bytes);
    else{
      try{await sharp(bytes,{limitInputPixels:64*1024*1024,failOn:'error'}).stats();}
      catch{fail('ARCA_SERIES_IMAGE_UNDECODABLE','Existing Series image cannot be decoded.');}
      const metadata=await sharp(bytes,{limitInputPixels:64*1024*1024}).metadata();
      if(metadata.format!=='jpeg')fail('ARCA_SERIES_IMAGE_FORMAT_INVALID','Series JPEG target contains another image format.');
      ({width,height}=metadata);
      if(!width||!height||(kind==='poster'?height<=width:width<=height))fail('ARCA_SERIES_IMAGE_ROLE_INVALID','Existing image has the wrong Series role.');
    }
    return {artifactKind:kind,endpointId:binding.endpointId,location,physicalIdentity:physicalIdentity(snapshot,binding.mountScopeId),
      byteDigest:sha(bytes),sizeBytes:bytes.length,width,height,nfoProviderKey,sourceDigest};
  }
  async function inspectRoot(binding,basis,currentManifest=null){
    const values=[];
    for(const kind of ['nfo','poster','fanart']){
      const prior=currentManifest?.members.find(item=>item.artifactKind===kind),
        value=await member(binding,kind,prior?.sourceDigest||basis.basisDigest);
      if(!value)continue;
      if(prior&&(prior.byteDigest!==value.byteDigest||prior.physicalIdentity.materialKey!==value.physicalIdentity.materialKey))
        fail('ARCA_SERIES_EXTERNAL_CHANGE','Registered Series file changed outside its accepted Inventory.');
      if(kind==='nfo'&&value.nfoProviderKey!==basis.sourceObservation.providerKey)
        fail('ARCA_SERIES_IDENTITY_CONFLICT','Existing Series NFO belongs to a different show.');
      values.push(value);
    }
    if(!currentManifest&&values.some(item=>item.artifactKind!=='nfo')&&!values.some(item=>item.artifactKind==='nfo'))
      fail('ARCA_SERIES_LOCAL_IDENTITY_UNPROVEN','Unregistered Series images require an exact show NFO association.');
    return values;
  }

  function writeExact(root,location,bytes,execution){
    continuation(execution);assertParents(root,location);fs.mkdirSync(path.dirname(location),{recursive:true});assertParents(root,location);
    const digest=sha(bytes),temporary=location+'.shelfdeck-'+digest+'.partial';assertParents(root,temporary);
    let targetStat;try{targetStat=fs.lstatSync(location);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(targetStat){
      if(!targetStat.isFile()||targetStat.isSymbolicLink()||targetStat.size!==bytes.length||
          !readBoundedFileSnapshotSync(location,bytes.length,{requireStableSnapshot:true}).bytes.equals(bytes))
        fail('ARCA_SERIES_TARGET_CONFLICT','Series publication refuses to replace different existing bytes.');
      let temporaryStat;try{temporaryStat=fs.lstatSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(temporaryStat){
        if(!temporaryStat.isFile()||temporaryStat.isSymbolicLink()||temporaryStat.size!==bytes.length||
            !readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true}).bytes.equals(bytes))
          fail('ARCA_SERIES_TEMP_CONFLICT','Published Series temporary differs from its complete frozen recipe.');
        continuation(execution);assertParents(root,temporary);fs.unlinkSync(temporary);
      }
      return;
    }
    let temporaryStat;try{temporaryStat=fs.lstatSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(temporaryStat){
      if(!temporaryStat.isFile()||temporaryStat.isSymbolicLink()||temporaryStat.size>bytes.length)
        fail('ARCA_SERIES_TEMP_CONFLICT','Series producer temporary conflicts with the frozen byte recipe.');
      const snapshot=readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true});
      if(snapshot.bytes.length===bytes.length&&!snapshot.bytes.equals(bytes))fail('ARCA_SERIES_TEMP_CONFLICT','Complete Series temporary has different bytes.');
      if(snapshot.bytes.length<bytes.length){
        if(execution.recoveryDecision!=='safe_retry')fail('ARCA_SERIES_TEMP_RECOVERY_REQUIRED','Short Series temporary requires classified Effect recovery.');
        continuation(execution);assertParents(root,temporary);
        const fresh=fs.lstatSync(temporary,{bigint:true});
        if(fresh.ino!==snapshot.stat.ino||fresh.dev!==snapshot.stat.dev||fresh.size!==snapshot.stat.size||fresh.mtimeNs!==snapshot.stat.mtimeNs)
          fail('ARCA_SERIES_TEMP_CONFLICT','Series producer temporary changed before scoped cleanup.');
        fs.unlinkSync(temporary);temporaryStat=null;
      }
    }
    if(!temporaryStat){const descriptor=fs.openSync(temporary,'wx');try{fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}}
    continuation(execution);assertParents(root,location);assertParents(root,temporary);
    if(!readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true}).bytes.equals(bytes))
      fail('ARCA_SERIES_TEMP_CONFLICT','Series producer bytes changed before publication.');
    try{fs.linkSync(temporary,location);}catch(error){if(error.code!=='EEXIST')throw error;}
    if(!readBoundedFileSnapshotSync(location,bytes.length,{requireStableSnapshot:true}).bytes.equals(bytes))
      fail('ARCA_SERIES_TARGET_CONFLICT','Series destination changed during publication.');
    afterPhysicalEffect?.({location,byteDigest:digest,eventId:execution.eventId});
    continuation(execution);assertParents(root,temporary);fs.unlinkSync(temporary);
  }

  function writeWorkspace(scope,kind,bytes,execution){
    const target=workspaceLocation(scope,kind);writeExact(workspaceRoot,target.location,bytes,execution);
    const snapshot=readBoundedFileSnapshotSync(target.location,limit(kind),{requireStableSnapshot:true}),identity=physicalIdentity(snapshot,rootSnapshot.mountScopeId),
      {schemaRef,schemaVersion,materialKey,...tuple}=identity,digestHex=sha(snapshot.bytes),
      unsigned={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,
        handleId:stableHandle('material',scope,kind,digestHex),workspaceId:target.workspaceId,ownerDomain:'arca',processId:scope.objectId,
        endpointId:rootSnapshot.endpointId,materialKey,physicalIdentity:tuple,rootHandleRef:rootSnapshot.rootHandleRef,
        relativePath:target.relativePath,digestAlgorithm:'sha256',digestHex,sizeBytes:snapshot.bytes.length,referenceRevision:1,accessScope:'workspace_material_read'},
      workspaceMaterialHandle={...unsigned,fenceDigest:canonicalDigest(unsigned)},artifactHandle={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
        artifactHandleId:stableHandle('artifact',scope,kind,digestHex),artifactKind:kind,ownerDomain:'arca',ownerScope:{scopeType:'series_presentation',scopeId:scope.objectId},
        storageRef:target.location.split(path.sep).join('/'),digestAlgorithm:'sha256',digestHex,sizeBytes:snapshot.bytes.length,
        mediaType:kind==='nfo'?'application/xml':'image/jpeg',provenanceRef:{objectType:'series_presentation_build',objectId:scope.objectId,revision:scope.revision,digest:scope.digest},referenceRevision:1};
    return {artifactKind:kind,workspaceMaterialHandle,artifactHandle};
  }
  function stableHandle(kind,scope,role,digest){return 'arca-series-'+kind+'-'+canonicalDigest({buildId:scope.objectId,role,digest}).slice(0,40);}

  async function publish(scope,artifacts,execution){
    for(const artifact of artifacts){
      const target=workspaceLocation(scope,artifact.artifactKind),handle=artifact.workspaceMaterialHandle;
      if(handle.workspaceId!==target.workspaceId||handle.relativePath!==target.relativePath||handle.processId!==scope.objectId||
          handle.rootHandleRef!==rootSnapshot.rootHandleRef)fail('ARCA_SERIES_WORKSPACE_FENCE','Series artifact does not belong to its frozen Workspace.');
      const snapshot=readBoundedFileSnapshotSync(target.location,limit(artifact.artifactKind),{requireStableSnapshot:true});
      if(sha(snapshot.bytes)!==handle.digestHex||physicalIdentity(snapshot,rootSnapshot.mountScopeId).materialKey!==handle.materialKey)
        fail('ARCA_SERIES_WORKSPACE_FENCE','Series artifact bytes changed before formal placement.');
      writeExact(scope.shelfRoot,path.join(scope.rootLocation,fileName(artifact.artifactKind)),snapshot.bytes,execution);
    }
    const members=await inspectRoot(scope,scope.basis,{members:scope.existingMembers});
    for(const artifact of artifacts)if(members.find(member=>member.artifactKind===artifact.artifactKind)?.byteDigest!==artifact.workspaceMaterialHandle.digestHex)
      fail('ARCA_SERIES_TARGET_CONFLICT','Published Series bytes differ from their exact prepared Artifact.');
    return {members,memberSetDigest:canonicalDigest(members)};
  }
  async function verifyManifest(scope,manifest){
    const members=await inspectRoot(scope,scope.basis,manifest);
    if(canonicalDigest(members)!==canonicalDigest(manifest.members))fail('ARCA_SERIES_FINAL_VERIFICATION_CHANGED','Shared Series bytes changed after publication.');
    return canonicalDigest({schema:'arca.series-presentation-final-verification@1',manifestDigest:manifest.digest,members});
  }
  return Object.freeze({rootSnapshot,workspaceLocation,inspectRoot,writeWorkspace,publish,verifyManifest,imageBytes,nfoIdentity});
}
module.exports=Object.freeze({createSeriesPresentationIo,assertParents,nfoIdentity,imageBytes,physicalIdentity});
