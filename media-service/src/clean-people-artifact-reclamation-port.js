'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonicalDigest:D,canonicalJson:J}=require('./helix/contracts/canonical-json');
function fail(message){throw Object.assign(new Error(message),{code:'PEOPLE_ARTIFACT_PHYSICAL_FENCE_CHANGED'});}
function createCleanPeopleArtifactReclamationPort(options){
  const bootId=crypto.randomUUID(),rootPath=path.resolve(options.rootPath),directory=path.join(rootPath,'gc-intents');
  function stat(file){try{return fs.lstatSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  function identity(value){return value?{device:String(value.dev),inode:String(value.ino),sizeBytes:String(value.size),mtimeNs:String(value.mtimeNs),ctimeNs:String(value.ctimeNs)}:null;}
  function regular(value){if(!value?.isFile()||value.isSymbolicLink()||value.nlink!==1n)fail('Reclamation requires one exact regular file.');}
  function directoryIdentity(){const value=fs.lstatSync(rootPath,{bigint:true});
    if(!value.isDirectory()||value.isSymbolicLink()||(process.platform==='win32'?fs.realpathSync(rootPath).toLowerCase():fs.realpathSync(rootPath))!==(process.platform==='win32'?rootPath.toLowerCase():rootPath))fail('Artifact root physical directory changed.');return {device:String(value.dev),inode:String(value.ino)};}
  function snapshot(){const root=options.controlledRoot(),value=fs.lstatSync(rootPath,{bigint:true});
    if(!value.isDirectory()||value.isSymbolicLink())fail('Artifact root is no longer an exact directory.');
    return {bootId,rootFenceDigest:D({root,device:String(value.dev),inode:String(value.ino)})};}
  function fileFor(evidence){const handle=evidence.artifactHandle;
    if(!/^[a-f0-9]{64}$/.test(handle.artifactHandleId)||handle.storageRef!=='people-artifact:'+handle.artifactHandleId)fail('Artifact storage is not its exact declared leaf.');
    return path.join(rootPath,handle.artifactHandleId);}
  function physical(file,handle){const before=stat(file);regular(before);options.readExact(file,handle.digestHex,handle.sizeBytes);const after=stat(file);
    if(D(identity(before))!==D(identity(after)))fail('Artifact changed during its complete checksum read.');return identity(after);}
  function loadIntent(file){const value=stat(file);if(!value)return null;regular(value);if(value.size>16384n)fail('Deletion Intent exceeds its bound.');
    let intent;try{intent=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('Deletion Intent is corrupt.');}
    const {intentDigest,...body}=intent;if(D(body)!==intentDigest)fail('Deletion Intent digest changed.');return intent;}
  function owns(intent,context,evidence){return intent?.schema==='people.reference-artifact-deletion-intent@1'&&
    intent.artifactHandleId===evidence.artifactHandle.artifactHandleId&&intent.artifactDigest===evidence.artifactHandle.digestHex&&
    intent.referenceRevision===evidence.artifactHandle.referenceRevision&&intent.workId===context.workId&&intent.eventId===context.eventId&&
    intent.effectId===D(['workspace_write',context.idempotencyKey])&&intent.auditEvidenceDigest===D(evidence)&&intent.rootFenceDigest===evidence.rootFenceDigest;}
  function syncDirectory(){if(process.platform==='linux'){const fd=fs.openSync(rootPath,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}
  function reclaim({context,evidence,authority,claim,settle,replay,readRegistry}){
    const previous=replay();if(previous)return previous;
    const effect=options.requireEffect(context);if(effect?.effect_id!==D(['workspace_write',context.idempotencyKey]))fail('Deletion requires its exact durable Effect identity.');const file=fileFor(evidence),intentFile=path.join(directory,D({artifactHandleId:evidence.artifactHandle.artifactHandleId,referenceRevision:evidence.artifactHandle.referenceRevision})+'.json');
    const originalDirectory=D(directoryIdentity());let current=snapshot();if(current.rootFenceDigest!==evidence.rootFenceDigest)fail('Current root no longer proves the original Artifact location.');
    options.safeDirectory(directory);let intent=loadIntent(intentFile),currentStat=stat(file);
    if(intent&&!owns(intent,context,evidence))fail('Another execution owns this Artifact deletion Intent.');
    const registry=readRegistry();
    if(registry?.state==='gc_eligible'&&(!intent||!owns(intent,context,evidence)||registry.handle.referenceRevision!==evidence.artifactHandle.referenceRevision+1))fail('Claimed Artifact has no exact deletion Intent for this Effect.');
    if(intent&&!currentStat){
      if(registry?.state!=='gc_eligible'||registry.handle.referenceRevision!==evidence.artifactHandle.referenceRevision+1)fail('Missing Artifact has no exact claimed deletion.');
      const proof=D({schema:'people.reference-artifact-absence@1',intentDigest:intent.intentDigest});
      return settle({disposition:'deleted',physicalEvidenceDigest:proof,verifyReality:()=>D(directoryIdentity())===originalDirectory&&stat(file)===null});
    }
    const permitted=()=>{const next=snapshot();return next.bootId===evidence.bootId&&next.rootFenceDigest===evidence.rootFenceDigest&&authority();};
    if(!permitted())return settle({disposition:'retained',physicalEvidenceDigest:D({schema:'people.reference-artifact-retained@1',currentIdentity:identity(currentStat)}),verifyReality:()=>true});
    if(!intent){const preimage=physical(file,evidence.artifactHandle),body={schema:'people.reference-artifact-deletion-intent@1',
      artifactHandleId:evidence.artifactHandle.artifactHandleId,artifactDigest:evidence.artifactHandle.digestHex,referenceRevision:evidence.artifactHandle.referenceRevision,
      workId:context.workId,eventId:context.eventId,effectId:D(['workspace_write',context.idempotencyKey]),auditEvidenceDigest:D(evidence),rootFenceDigest:evidence.rootFenceDigest,preimage};
      intent={...body,intentDigest:D(body)};options.publish(intentFile,Buffer.from(J(intent)));
      if(process.platform==='linux'){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}
    if(D(physical(file,evidence.artifactHandle))!==D(intent.preimage))fail('Artifact physical identity changed after its immutable deletion Intent.');
    claim({verifyIntent:()=>owns(loadIntent(intentFile),context,evidence)&&D(physical(file,evidence.artifactHandle))===D(intent.preimage)});
    context.assertExecutionActive();if(!permitted())return settle({disposition:'retained',physicalEvidenceDigest:D({intentDigest:intent.intentDigest,retained:true}),verifyReality:()=>true});
    if(D(physical(file,evidence.artifactHandle))!==D(intent.preimage))fail('Artifact was replaced immediately before unlink.');
    fs.unlinkSync(file);syncDirectory();options.afterPhysicalEffect?.({artifactHandleId:evidence.artifactHandle.artifactHandleId,effectId:intent.effectId});
    const proof=D({schema:'people.reference-artifact-absence@1',intentDigest:intent.intentDigest});
    return settle({disposition:'deleted',physicalEvidenceDigest:proof,verifyReality:()=>D(directoryIdentity())===originalDirectory&&stat(file)===null});
  }
  function observe({context,evidence,readRegistry}){
    const current=snapshot();if(current.rootFenceDigest!==evidence.rootFenceDigest)fail('Recovery no longer proves the original Artifact root.');
    const file=fileFor(evidence),intentFile=path.join(directory,D({artifactHandleId:evidence.artifactHandle.artifactHandleId,referenceRevision:evidence.artifactHandle.referenceRevision})+'.json'),intent=loadIntent(intentFile),value=stat(file);
    if(intent&&!owns(intent,context,evidence))fail('Recovery found a foreign deletion Intent.');
    if(!value){const record=readRegistry();if(!intent||record?.state!=='gc_eligible'||record.handle.referenceRevision!==evidence.artifactHandle.referenceRevision+1)fail('Recovery has no exact claimed absence.');
      return {present:false,evidenceDigest:D({intentDigest:intent.intentDigest,absent:true})};}
    const currentIdentity=physical(file,evidence.artifactHandle);if(intent&&D(currentIdentity)!==D(intent.preimage))fail('Recovery found a replaced Artifact.');
    return {present:true,evidenceDigest:D({currentIdentity,intentDigest:intent?.intentDigest||null})};
  }
  return Object.freeze({snapshot,reclaim,observe,rootReadParticipant:()=>options.locationRegistryRepository.createWorkspaceRootReadParticipant(options.controlledRoot())});
}
module.exports=Object.freeze({createCleanPeopleArtifactReclamationPort});
