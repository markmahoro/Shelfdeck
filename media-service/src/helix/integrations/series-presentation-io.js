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
  root=path.resolve(root);target=path.resolve(target);
  const relative=path.relative(root,target);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('ARCA_SERIES_PATH_ESCAPE','Series file escapes its declared root.');
  let current=root;
  for(const part of ['',...relative.split(path.sep)]){
    if(part)current=path.join(current,part);
    let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.isSymbolicLink()||(path.relative(current,target)!==''&&!stat.isDirectory()))fail('ARCA_SERIES_PATH_CONFLICT','Series path crosses a linked or foreign parent.');
  }
}

function sameAliasSnapshot(left,right){
  return left.isFile()&&right.isFile()&&!left.isSymbolicLink()&&!right.isSymbolicLink()&&
    left.dev>0n&&left.ino>0n&&right.dev>0n&&right.ino>0n&&
    ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>left[key]===right[key]);
}

function publishedAliasProof(root,location,temporary,expected,snapshot){
  assertParents(root,location);assertParents(root,temporary);
  const finalStat=fs.lstatSync(location,{bigint:true}),temporaryStat=fs.lstatSync(temporary,{bigint:true});
  if(!sameAliasSnapshot(finalStat,temporaryStat)||!sameAliasSnapshot(finalStat,snapshot.stat)||
      snapshot.bytes.length!==expected.sizeBytes||sha(snapshot.bytes)!==expected.byteDigest)return null;
  // A matching inode on the same device identifies the already verified file,
  // even when an SMB producer alias cannot be opened independently.
  const proof={finalStat,temporaryStat,evidence:{kind:'verified_published_hardlink',byteDigest:expected.byteDigest,
    device:String(finalStat.dev),inode:String(finalStat.ino),sizeBytes:String(finalStat.size),
    modifiedNs:String(finalStat.mtimeNs),changedNs:String(finalStat.ctimeNs)}};
  assertPublishedAliasCurrent(root,location,temporary,proof);
  return proof;
}

function assertPublishedAliasCurrent(root,location,temporary,proof){
  assertParents(root,location);assertParents(root,temporary);
  const finalStat=fs.lstatSync(location,{bigint:true}),temporaryStat=fs.lstatSync(temporary,{bigint:true});
  if(!sameAliasSnapshot(finalStat,proof.finalStat)||!sameAliasSnapshot(temporaryStat,proof.temporaryStat)||
      !sameAliasSnapshot(finalStat,temporaryStat))
    fail('ARCA_SERIES_TEMP_CONFLICT','Published Series alias changed after its exact physical proof.');
}

const scopeNodeNames=new Set(['season','season_number','seasonnumber','episode','episode_number','episodenumber']);

function nfoIdentity(bytes){
  const document=analyzeNfoDocument(bytes,'tvshow');
  if(!document.usable||!directText(document,'title'))fail('ARCA_SERIES_NFO_INVALID','Series NFO must be a complete tvshow document with a title.');
  const scopeNode=document.directChildren.find(node=>node.name==='episodedetails' ||
    (scopeNodeNames.has(node.name)&&String(childText(document,node)||'').trim()!=='-1'));
  if(scopeNode)
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

  async function readLocalSource(scope,kind,{required=false}={}){
    if(!scope.basis.localSource)return null;
    try{const value=require('./series-local-source-io').readQualified(scope.basis.localSource,kind);if(!value)return null;
      if(kind==='nfo')return {...value,normalized:true,width:null,height:null};
      return {...value,...await imageBytes(value.bytes,kind),sourceBytes:value.bytes,normalized:true};
    }catch(error){if(!required&&/^(ENOENT|SERIES_LOCAL_SOURCE_CHANGED|ARCA_SERIES_(IMAGE|NFO)_)/.test(error.code||''))return null;throw error;}
  }
  function writeExact(root,location,bytes,execution){
    continuation(execution);assertParents(root,location);fs.mkdirSync(path.dirname(location),{recursive:true});assertParents(root,location);
    const digest=sha(bytes),temporary=location+'.shelfdeck-'+digest+'.partial';assertParents(root,temporary);
    let targetStat;try{targetStat=fs.lstatSync(location);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(targetStat){
      if(!targetStat.isFile()||targetStat.isSymbolicLink()||targetStat.size!==bytes.length)
        fail('ARCA_SERIES_TARGET_CONFLICT','Series publication refuses to replace different existing bytes.');
      const published=readBoundedFileSnapshotSync(location,bytes.length,{requireStableSnapshot:true});
      if(!published.bytes.equals(bytes))
        fail('ARCA_SERIES_TARGET_CONFLICT','Series publication refuses to replace different existing bytes.');
      let temporaryStat;try{temporaryStat=fs.lstatSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(temporaryStat){
        const alias=publishedAliasProof(root,location,temporary,{sizeBytes:bytes.length,byteDigest:digest},published);
        if(!alias&&(!temporaryStat.isFile()||temporaryStat.isSymbolicLink()||temporaryStat.size!==bytes.length||
            !readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true}).bytes.equals(bytes)))
          fail('ARCA_SERIES_TEMP_CONFLICT','Published Series temporary differs from its complete frozen recipe.');
        continuation(execution);assertParents(root,temporary);
        if(alias)assertPublishedAliasCurrent(root,location,temporary,alias);
        fs.unlinkSync(temporary);
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
        if(!['safe_retry','continue_forward'].includes(execution.recoveryDecision))fail('ARCA_SERIES_TEMP_RECOVERY_REQUIRED','Short Series temporary requires classified Effect recovery.');
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

  const supplementLocation=source=>path.join(workspaceRoot,'series-user-inputs',source.uploadId+'.jpg');
  async function stageSupplement(scope,artifactKind,bytes,idempotencyKey){
    if(!['poster','fanart'].includes(artifactKind)||typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>256)
      fail('ARCA_SERIES_SUPPLEMENT_INVALID','Supplement requires one exact show image role and request identity.');
    const normalized=await imageBytes(bytes,artifactKind),byteDigest=sha(normalized.bytes),uploadId=canonicalDigest({schema:'arca.series-user-input@1',scopeId:scope.scopeId,artifactKind,idempotencyKey,byteDigest}),
      location=supplementLocation({uploadId});
    writeExact(workspaceRoot,location,normalized.bytes,{shouldContinue:()=>true});
    const snapshot=readBoundedFileSnapshotSync(location,limit(artifactKind),{requireStableSnapshot:true}),body={schema:'arca.series-supplement@1',scopeId:scope.scopeId,uploadId,artifactKind,
      byteDigest,sizeBytes:normalized.bytes.length,width:normalized.width,height:normalized.height,physicalIdentity:physicalIdentity(snapshot,rootSnapshot.mountScopeId)};
    return {...body,qualificationDigest:canonicalDigest(body)};
  }
  function readSupplement(scope,source){
    const {qualificationDigest,...body}=source;
    if(source.scopeId!==scope.scopeId||!/^[a-f0-9]{64}$/.test(source.uploadId)||qualificationDigest!==canonicalDigest(body))
      fail('ARCA_SERIES_SUPPLEMENT_INVALID','Supplement is not qualified for this exact show.');
    const location=supplementLocation(source);assertParents(workspaceRoot,location);
    const value=readBoundedFileSnapshotSync(location,limit(source.artifactKind),{requireStableSnapshot:true});
    if(sha(value.bytes)!==source.byteDigest||value.bytes.length!==source.sizeBytes||physicalIdentity(value,rootSnapshot.mountScopeId).materialKey!==source.physicalIdentity.materialKey)
      fail('ARCA_SERIES_SUPPLEMENT_CHANGED','Supplement changed after its explicit admission.');return value.bytes;
  }

  async function publish(scope,artifacts,execution,retainedMembers=scope.existingMembers){
    for(const artifact of artifacts){
      const target=workspaceLocation(scope,artifact.artifactKind),handle=artifact.workspaceMaterialHandle;
      if(handle.workspaceId!==target.workspaceId||handle.relativePath!==target.relativePath||handle.processId!==scope.objectId||
          handle.rootHandleRef!==rootSnapshot.rootHandleRef)fail('ARCA_SERIES_WORKSPACE_FENCE','Series artifact does not belong to its frozen Workspace.');
      const snapshot=readBoundedFileSnapshotSync(target.location,limit(artifact.artifactKind),{requireStableSnapshot:true});
      if(sha(snapshot.bytes)!==handle.digestHex||physicalIdentity(snapshot,rootSnapshot.mountScopeId).materialKey!==handle.materialKey)
        fail('ARCA_SERIES_WORKSPACE_FENCE','Series artifact bytes changed before formal placement.');
      writeExact(scope.shelfRoot,path.join(scope.rootLocation,fileName(artifact.artifactKind)),snapshot.bytes,execution);
    }
    const members=await inspectRoot(scope,scope.basis,{members:retainedMembers});
    for(const artifact of artifacts)if(members.find(member=>member.artifactKind===artifact.artifactKind)?.byteDigest!==artifact.workspaceMaterialHandle.digestHex)
      fail('ARCA_SERIES_TARGET_CONFLICT','Published Series bytes differ from their exact prepared Artifact.');
    return {members,memberSetDigest:canonicalDigest(members)};
  }
  function readPreparedBytes(scope,recipe){const location=workspaceLocation(scope,recipe.artifactKind).location;assertParents(workspaceRoot,location);
    try{fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')return null;throw error;}const value=readBoundedFileSnapshotSync(location,limit(recipe.artifactKind),{requireStableSnapshot:true});
    if(sha(value.bytes)!==recipe.byteDigest||value.bytes.length!==recipe.sizeBytes)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Prepared Workspace bytes differ from the frozen Source recipe.');return value.bytes;}
  function capturePrepared(scope,source){return source.recipe.flatMap(recipe=>{
    const bytes=readPreparedBytes(scope,recipe);if(!bytes)return [];
    const snapshot=readBoundedFileSnapshotSync(workspaceLocation(scope,recipe.artifactKind).location,limit(recipe.artifactKind),{requireStableSnapshot:true});
    if(sha(snapshot.bytes)!==recipe.byteDigest)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Recovery source changed during capture.');
    return [{artifactKind:recipe.artifactKind,originBuildId:scope.objectId,originScopeDigest:scope.digest,sourceObservedDigest:canonicalDigest(source),recipe,physicalIdentity:physicalIdentity(snapshot,rootSnapshot.mountScopeId)}];
  });}
  function readRecoverySource(origin,ref){
    if(origin.objectId!==ref.originBuildId||origin.digest!==ref.originScopeDigest)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Recovery source lost its immutable original build.');
    const location=workspaceLocation(origin,ref.artifactKind).location;assertParents(workspaceRoot,location);
    const snapshot=readBoundedFileSnapshotSync(location,limit(ref.artifactKind),{requireStableSnapshot:true});
    if(sha(snapshot.bytes)!==ref.recipe.byteDigest||snapshot.bytes.length!==ref.recipe.sizeBytes||physicalIdentity(snapshot,rootSnapshot.mountScopeId).materialKey!==ref.physicalIdentity.materialKey)
      fail('ARCA_SERIES_WORKSPACE_CONFLICT','Recovery source no longer has its exact produced bytes.');
    return snapshot.bytes;
  }
  function currentManifestState(scope,manifest){let missing=false;for(const member of manifest.members){
    assertParents(scope.shelfRoot,member.location);let stat;try{stat=fs.lstatSync(member.location);}catch(error){if(error.code==='ENOENT'){missing=true;continue;}throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())return 'conflict';const value=readBoundedFileSnapshotSync(member.location,limit(member.artifactKind),{requireStableSnapshot:true});
    if(sha(value.bytes)!==member.byteDigest||physicalIdentity(value,scope.mountScopeId).materialKey!==member.physicalIdentity.materialKey)return 'conflict';}
    return missing?'missing':'healthy';}
  async function verifyManifest(scope,manifest){
    const members=await inspectRoot(scope,scope.basis,manifest);
    if(canonicalDigest(members)!==canonicalDigest(manifest.members))fail('ARCA_SERIES_FINAL_VERIFICATION_CHANGED','Shared Series bytes changed after publication.');
    return canonicalDigest({schema:'arca.series-presentation-final-verification@1',manifestDigest:manifest.digest,members});
  }
  function observeWrites(scope,expectations,{formal=false,registry=null}={}){
    const observations=[];let conflict=false,shortTemporary=false;
    for(const expected of expectations){
      const root=formal?scope.shelfRoot:workspaceRoot,location=formal?path.join(scope.rootLocation,fileName(expected.artifactKind)):workspaceLocation(scope,expected.artifactKind).location,
        temporary=location+'.shelfdeck-'+expected.byteDigest+'.partial';
      assertParents(root,location);assertParents(root,temporary);
      let publishedSnapshot=null;
      for(const [target,isTemporary] of [[location,false],[temporary,true]]){
        let stat;try{stat=fs.lstatSync(target);}catch(error){if(error.code==='ENOENT'){observations.push({artifactKind:expected.artifactKind,temporary:isTemporary,present:false});continue;}throw error;}
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>expected.sizeBytes||(!isTemporary&&stat.size!==expected.sizeBytes)){conflict=true;continue;}
        if(isTemporary&&publishedSnapshot){
          const alias=publishedAliasProof(root,location,temporary,expected,publishedSnapshot);
          if(alias){observations.push({artifactKind:expected.artifactKind,temporary:true,present:true,complete:true,
            byteDigest:expected.byteDigest,inode:alias.evidence.inode,aliasProof:alias.evidence});continue;}
        }
        const value=readBoundedFileSnapshotSync(target,Math.max(1,expected.sizeBytes),{requireStableSnapshot:true}),complete=value.bytes.length===expected.sizeBytes,digest=sha(value.bytes);
        if(complete&&digest!==expected.byteDigest)conflict=true;
        if(!isTemporary&&complete&&digest===expected.byteDigest)publishedSnapshot=value;
        if(!complete&&isTemporary)shortTemporary=true;
        const registered=!formal&&registry?.members.find(handle=>handle.relativePath===workspaceLocation(scope,expected.artifactKind).relativePath);
        if(!isTemporary&&registered&&(registered.digestHex!==digest||registered.physicalIdentity.inode!==String(value.stat.ino)||registered.physicalIdentity.contentFingerprint!==value.contentFingerprint))conflict=true;
        observations.push({artifactKind:expected.artifactKind,temporary:isTemporary,present:true,complete,byteDigest:digest,inode:String(value.stat.ino)});
      }
    }
    if(!formal&&(!registry||expectations.length>0&&!registry.registryExists&&observations.some(row=>row.present)))conflict=true;
    return {status:conflict||shortTemporary?'conflict':observations.some(row=>row.present)?'matching':'absent',cleanupDeclared:!conflict&&shortTemporary,
      evidenceDigest:canonicalDigest({schema:'arca.series-presentation-write-reality@1',buildId:scope.objectId,scopeDigest:scope.digest,formal,expectations,observations,conflict,shortTemporary})};
  }
  function reclaim(scope,artifacts,execution,{observeOnly=false}={}){
    const observations=[];
    for(const item of artifacts){
      const expected=workspaceLocation(scope,item.artifactKind),handle=item.workspaceMaterialHandle;
      if(handle.workspaceId!==expected.workspaceId||handle.relativePath!==expected.relativePath||handle.processId!==scope.objectId||
          item.artifactHandle.storageRef!==expected.location.split(path.sep).join('/'))fail('ARCA_SERIES_WORKSPACE_FENCE','Reclamation cannot escape its exact registered build.');
      for(const location of [expected.location,expected.location+'.shelfdeck-'+handle.digestHex+'.partial']){
        assertParents(workspaceRoot,location);let stat;try{stat=fs.lstatSync(location,{bigint:true});}catch(error){if(error.code==='ENOENT'){observations.push({location,present:false});continue;}throw error;}
        if(!stat.isFile()||stat.isSymbolicLink())fail('ARCA_SERIES_WORKSPACE_CONFLICT','Reclamation encountered another file kind.');
        const actual=readBoundedFileSnapshotSync(location,Math.max(1,handle.sizeBytes),{requireStableSnapshot:true});
        if(sha(actual.bytes)!==handle.digestHex||actual.bytes.length!==handle.sizeBytes||location===expected.location&&physicalIdentity(actual,rootSnapshot.mountScopeId).materialKey!==handle.materialKey)
          fail('ARCA_SERIES_WORKSPACE_CONFLICT','Reclamation bytes differ from their committed source Artifact.');
        observations.push({location,present:true,digest:sha(actual.bytes),inode:String(actual.stat.ino)});
      }
    }
    if(!observeOnly)for(const observation of observations.filter(row=>row.present)){
      continuation(execution);assertParents(workspaceRoot,observation.location);
      const actual=readBoundedFileSnapshotSync(observation.location,16*1024*1024,{requireStableSnapshot:true});
      if(sha(actual.bytes)!==observation.digest||String(actual.stat.ino)!==observation.inode)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Reclamation target changed after preflight.');
      fs.unlinkSync(observation.location);afterPhysicalEffect?.({location:observation.location,eventId:execution.eventId,reclaimed:true});
    }
    for(const source of scope.supplementalSources||[]){const location=supplementLocation(source);assertParents(workspaceRoot,location);
      try{fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      readSupplement(scope,source);observations.push({location,present:true,digest:source.byteDigest,inode:source.physicalIdentity.inode});
      if(!observeOnly){continuation(execution);readSupplement(scope,source);fs.unlinkSync(location);}
    }
    return {status:'matching',cleanupDeclared:false,evidenceDigest:canonicalDigest({schema:'arca.series-workspace-reclamation-reality@1',scopeDigest:scope.digest,observations})};
  }
  function verifyUnmaterialized(scope,recipe){const paths=[];for(const item of recipe){const target=workspaceLocation(scope,item.artifactKind).location;for(const location of [target,target+'.shelfdeck-'+item.byteDigest+'.partial']){
    assertParents(workspaceRoot,location);try{fs.lstatSync(location);}catch(error){if(error.code==='ENOENT'){paths.push(location);continue;}throw error;}fail('ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE','The old Workspace has physical output requiring recovery.');}}
    return canonicalDigest({schema:'arca.series-unmaterialized-workspace@1',scopeDigest:scope.digest,recipeDigest:canonicalDigest(recipe),paths});}
  function reclaimSuperseded(scope,basis,execution,{observeOnly=false}={}){
    const artifacts=basis.registeredArtifacts,observations=[];
    for(const recipe of basis.sourceObserved?.recipe||[]){if(artifacts.some(row=>row.artifactKind===recipe.artifactKind))continue;
      const target=workspaceLocation(scope,recipe.artifactKind).location;
      for(const [location,temporary] of [[target,false],[target+'.shelfdeck-'+recipe.byteDigest+'.partial',true]]){
        assertParents(workspaceRoot,location);let stat;try{stat=fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>recipe.sizeBytes)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Superseded output is outside its private Source recipe.');
        const snapshot=readBoundedFileSnapshotSync(location,recipe.sizeBytes,{requireStableSnapshot:true});
        if((!temporary||snapshot.bytes.length===recipe.sizeBytes)&&sha(snapshot.bytes)!==recipe.byteDigest)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Superseded output differs from its exact recipe.');
        observations.push({location,digest:sha(snapshot.bytes),identity:physicalIdentity(snapshot,rootSnapshot.mountScopeId)});
      }
    }
    if(!observeOnly)for(const row of observations){continuation(execution);assertParents(workspaceRoot,row.location);const snapshot=readBoundedFileSnapshotSync(row.location,16*1024*1024,{requireStableSnapshot:true});
      if(physicalIdentity(snapshot,rootSnapshot.mountScopeId).materialKey!==row.identity.materialKey||sha(snapshot.bytes)!==row.digest)fail('ARCA_SERIES_WORKSPACE_CONFLICT','Superseded output changed after preflight.');fs.unlinkSync(row.location);afterPhysicalEffect?.({location:row.location,eventId:execution.eventId,reclaimed:true});}
    const registered=reclaim(scope,artifacts,execution,{observeOnly});return {...registered,evidenceDigest:canonicalDigest({registered:registered.evidenceDigest,observations})};
  }
  function verifySupersededReclaimed(scope,basis){verifyReclaimed(scope,basis.registeredArtifacts);verifyUnmaterialized(scope,basis.sourceObserved?.recipe||[]);return canonicalDigest({scopeDigest:scope.digest,reclamationBasisDigest:basis.digest});}
  function verifyReclaimed(scope,artifacts){
    for(const item of artifacts){const location=workspaceLocation(scope,item.artifactKind).location;
      for(const target of [location,location+'.shelfdeck-'+item.workspaceMaterialHandle.digestHex+'.partial']){
        assertParents(workspaceRoot,target);try{fs.lstatSync(target);}catch(error){if(error.code==='ENOENT')continue;throw error;}
        fail('ARCA_SERIES_WORKSPACE_NOT_RECLAIMED','A declared Workspace file remains after reclamation.');
      }}
    for(const source of scope.supplementalSources||[]){const location=supplementLocation(source);assertParents(workspaceRoot,location);
      try{fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')continue;throw error;}fail('ARCA_SERIES_WORKSPACE_NOT_RECLAIMED','A staged user input remains after reclamation.');}
    return canonicalDigest({schema:'arca.series-workspace-declared-files-absent@1',scopeDigest:scope.digest,handles:artifacts.map(item=>item.workspaceMaterialHandle)});
  }
  return Object.freeze({rootSnapshot,workspaceLocation,inspectRoot,writeWorkspace,publish,verifyManifest,readPreparedBytes,capturePrepared,readRecoverySource,currentManifestState,imageBytes,nfoIdentity,readLocalSource,observeWrites,reclaim,verifyReclaimed,reclaimSuperseded,verifySupersededReclaimed,verifyUnmaterialized,stageSupplement,readSupplement});
}
module.exports=Object.freeze({createSeriesPresentationIo,assertParents,nfoIdentity,imageBytes,physicalIdentity});
