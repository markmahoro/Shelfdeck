'use strict';

const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {readBoundedFileSnapshotSync}=require('./bounded-material-fingerprint');
const readAuthority=require('../contracts/us-adult-inventory-read-handle');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES=16*1024*1024;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function createUsAdultInventoryWorkspace(options){
  const root=options?.rootSnapshot;
  if(!root||!path.isAbsolute(root.resolvedRoot||'')||!root.rootHandleRef||!root.mountScopeId||!root.endpointId||
      typeof options.ensureWorkspace!=='function'||typeof options.registerMaterial!=='function'||typeof options.assertRegistered!=='function')
    throw new TypeError('Actor refresh Workspace requires its registered Arca root and controlled material registry.');
  function guard(context,intent,aftercareCaseId){
    readAuthority.scope(intent,aftercareCaseId);
    if(context?.ownerScope?.domain!=='arca'||context.ownerScope.processType!=='arca_shelf_entry'||context.ownerScope.processId!==intent.shelfEntryId||
        typeof context.assertExecutionActive!=='function')fail('ARCA_US_ADULT_WORKSPACE_AUTHORITY_INVALID','Workspace access requires the exact Entry execution authority.');
    context.assertExecutionActive();
    if(!/^[A-Za-z0-9_-]{1,256}$/.test(aftercareCaseId))fail('ARCA_US_ADULT_WORKSPACE_PATH_INVALID','Case identity cannot contain a physical path.');
  }
  function location(aftercareCaseId,relativePath){
    if(typeof relativePath!=='string'||!/^us-adult\/[a-f0-9]{64}\/(?:frame-\d{2}|frames|features|poster|nfo)-[a-f0-9]{64}\.(?:jpg|json|nfo)$/.test(relativePath))
      fail('ARCA_US_ADULT_WORKSPACE_PATH_INVALID','Workspace member is outside the declared actor refresh recipe.');
    return path.join(root.resolvedRoot,aftercareCaseId,...relativePath.split('/'));
  }
  function parents(target){
    const relative=path.relative(root.resolvedRoot,target);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))
      fail('ARCA_US_ADULT_WORKSPACE_PATH_INVALID','Workspace member escaped the registered root.');
    let current=root.resolvedRoot;
    for(const part of [null,...relative.split(path.sep)]){
      if(part!==null)current=path.join(current,part);
      let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT'&&part!==null)continue;throw error;}
      if(stat.isSymbolicLink()||(current===target?!stat.isFile():!stat.isDirectory()))
        fail('ARCA_US_ADULT_WORKSPACE_PATH_INVALID','Workspace member traverses a linked or foreign path.');
    }
  }
  function sameSnapshot(left,right){return left.ino===right.ino&&left.dev===right.dev&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;}
  function write({intent,aftercareCaseId,kind,bytes,context,recoveryDecision=null}){
    guard(context,intent,aftercareCaseId);
    if(!/^(?:frame-\d{2}|frames|features|poster|nfo)$/.test(kind||'')||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_BYTES)
      fail('ARCA_US_ADULT_WORKSPACE_BYTES_INVALID','Actor refresh member exceeds its declared kind or bounded bytes.');
    const digestHex=sha(bytes),extension=kind==='nfo'?'nfo':kind.startsWith('frame-')||kind==='poster'?'jpg':'json',
      relativePath='us-adult/'+intent.intentId+'/'+kind+'-'+digestHex+'.'+extension,target=location(aftercareCaseId,relativePath),temporary=target+'.part';
    options.ensureWorkspace(aftercareCaseId);parents(target);fs.mkdirSync(path.dirname(target),{recursive:true});parents(target);guard(context,intent,aftercareCaseId);
    if(fs.existsSync(temporary)){
      parents(temporary);
      const previous=readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true});
      if(previous.bytes.length<bytes.length){
        if(!bytes.subarray(0,previous.bytes.length).equals(previous.bytes)||recoveryDecision!=='safe_retry')
          fail('ARCA_US_ADULT_WORKSPACE_PARTIAL_WRITE','A short producer temporary requires exact recipe recovery before reuse.');
        guard(context,intent,aftercareCaseId);
        if(!sameSnapshot(previous.stat,fs.lstatSync(temporary,{bigint:true})))fail('ARCA_US_ADULT_WORKSPACE_CHANGED','Producer temporary changed before recovery.');
        fs.unlinkSync(temporary);
      }else if(!previous.bytes.equals(bytes))fail('ARCA_US_ADULT_WORKSPACE_CHANGED','Producer temporary differs from the frozen byte recipe.');
    }
    if(!fs.existsSync(target)){
      if(!fs.existsSync(temporary)){
        const descriptor=fs.openSync(temporary,'wx');
        try{fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
      }
      guard(context,intent,aftercareCaseId);parents(temporary);parents(target);
      if(!readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true}).bytes.equals(bytes))
        fail('ARCA_US_ADULT_WORKSPACE_CHANGED','Producer temporary changed before publication.');
      try{fs.linkSync(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    parents(target);
    const observed=readBoundedFileSnapshotSync(target,bytes.length,{requireStableSnapshot:true});
    if(!observed.bytes.equals(bytes))fail('ARCA_US_ADULT_WORKSPACE_CHANGED','Existing Workspace bytes differ from the frozen recipe.');
    if(fs.existsSync(temporary)){
      parents(temporary);const previous=readBoundedFileSnapshotSync(temporary,bytes.length,{requireStableSnapshot:true});
      guard(context,intent,aftercareCaseId);
      if(!previous.bytes.equals(bytes)||!sameSnapshot(previous.stat,fs.lstatSync(temporary,{bigint:true})))
        fail('ARCA_US_ADULT_WORKSPACE_CHANGED','Published producer temporary changed before cleanup.');
      fs.unlinkSync(temporary);
    }
    const physicalIdentity={mountScopeId:root.mountScopeId,inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
      body={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,
        handleId:'arca-us-material-'+canonicalDigest({aftercareCaseId,relativePath}),workspaceId:aftercareCaseId,ownerDomain:'arca',processId:aftercareCaseId,
        endpointId:root.endpointId,materialKey:canonicalDigest({schema:'physical-material-identity@2',...physicalIdentity}),physicalIdentity,
        rootHandleRef:root.rootHandleRef,relativePath,digestAlgorithm:'sha256',digestHex,sizeBytes:bytes.length,referenceRevision:1,accessScope:'workspace_material_read'},
      handle=Object.freeze({...body,fenceDigest:canonicalDigest(body)});
    guard(context,intent,aftercareCaseId);options.registerMaterial(handle);return handle;
  }
  function read({intent,aftercareCaseId,handle,context,maximumBytes=MAX_BYTES}){
    guard(context,intent,aftercareCaseId);
    const {fenceDigest,...body}=handle||{};
    if(handle?.schemaRef!=='helix://contracts/types/WorkspaceMaterialHandle/v1'||handle.schemaVersion!==1||handle.workspaceId!==aftercareCaseId||
        handle.ownerDomain!=='arca'||handle.processId!==aftercareCaseId||handle.rootHandleRef!==root.rootHandleRef||handle.endpointId!==root.endpointId||
        !Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>MAX_BYTES||!Number.isSafeInteger(handle.sizeBytes)||handle.sizeBytes<1||handle.sizeBytes>maximumBytes||
        !handle.relativePath?.startsWith('us-adult/'+intent.intentId+'/')||fenceDigest!==canonicalDigest(body)||options.assertRegistered(handle)!==true)
      fail('ARCA_US_ADULT_WORKSPACE_HANDLE_INVALID','Workspace Handle is not the exact registered member of this Case and Intent.');
    const target=location(aftercareCaseId,handle.relativePath);parents(target);
    const observed=readBoundedFileSnapshotSync(target,maximumBytes,{requireStableSnapshot:true}),identity=handle.physicalIdentity;
    if(observed.bytes.length!==handle.sizeBytes||sha(observed.bytes)!==handle.digestHex||String(observed.stat.ino)!==identity?.inode||
        identity.mountScopeId!==root.mountScopeId||identity.sizeBytes!==handle.sizeBytes||observed.fingerprintAlgorithm!==identity.fingerprintAlgorithm||
        observed.fingerprintVersion!==identity.fingerprintVersion||observed.contentFingerprint!==identity.contentFingerprint||
        handle.materialKey!==canonicalDigest({schema:'physical-material-identity@2',...identity}))
      fail('ARCA_US_ADULT_WORKSPACE_CHANGED','Registered Workspace material no longer matches its physical identity and full digest.');
    guard(context,intent,aftercareCaseId);return observed.bytes;
  }
  return Object.freeze({write,read,readJson:request=>{const bytes=read(request);let value;try{value=JSON.parse(bytes.toString('utf8'));}
    catch{fail('ARCA_US_ADULT_WORKSPACE_JSON_INVALID','Workspace JSON is unreadable.');}
    if(canonicalJson(value)!==bytes.toString('utf8'))fail('ARCA_US_ADULT_WORKSPACE_JSON_INVALID','Workspace JSON is not canonical.');return value;}});
}
module.exports=Object.freeze({MAX_BYTES,createUsAdultInventoryWorkspace});
