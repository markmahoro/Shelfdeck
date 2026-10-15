'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {computeBoundedMaterialFingerprint,readBoundedFileSnapshot}=require('./bounded-material-fingerprint');
const {javCorrectionRetainedLocation}=require('../contracts/jav-correction-retained-location');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function createJavCorrectionFormalFiles({resolveWorkspaceMaterial}) {
  if(typeof resolveWorkspaceMaterial!=='function')throw new TypeError('Correction staging requires its scoped Workspace resolver.');
  function assertParents(root,location) {
    const relative=path.relative(root,location);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('ARCA_JAV_CORRECTION_FILE_ESCAPE','Correction staging escaped the exact Shelf target.');
    let current=root;
    for(const part of [null,...relative.split(path.sep)]) {
      if(part!==null)current=path.join(current,part);
      let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(stat.isSymbolicLink()||current!==location&&!stat.isDirectory())fail('ARCA_JAV_CORRECTION_FILE_ESCAPE','Correction staging traverses a linked or foreign parent.');
    }
  }
  async function digestFile(location,shouldContinue) {
    const before=fs.statSync(location,{bigint:true}),hash=createHash('sha256');let chunks=0;
    for await(const chunk of fs.createReadStream(location,{highWaterMark:256*1024})) {hash.update(chunk);if(++chunks%64===0)shouldContinue();}
    const after=fs.statSync(location,{bigint:true});
    if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Correction source changed during full byte verification.');
    shouldContinue();return hash.digest('hex');
  }
  async function preflightStage(plan,{shouldContinue}) {
    const check=()=>{if(typeof shouldContinue!=='function'||shouldContinue()!==true)fail('ARCA_JAV_CORRECTION_FILE_FENCED','Correction staging no longer holds its exact execution scope.');};
    check();const {planDigest,...body}=plan;
    if(plan.schemaRef!=='helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1'||planDigest!==canonicalDigest(body)||
        !/^arca-jav-correction-[a-f0-9]{40}$/.test(plan.correctionId)||!path.isAbsolute(plan.target?.rootLocation)||
        !Array.isArray(plan.members)||plan.members.length<4||plan.members.length>1024)
      fail('ARCA_JAV_CORRECTION_FILE_PLAN_INVALID','Staging requires the exact complete owned File Plan.');
    const root=path.resolve(plan.target.rootLocation),directory=path.join(root,'.shelfdeck-'+plan.correctionId+'-stage'),prepared=[];
    assertParents(root,directory);
    if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())fail('ARCA_JAV_CORRECTION_TARGET_UNAVAILABLE','Correction Shelf target is unavailable.');
    for(const member of plan.members) {
      check();
      if(member.ordinal!==prepared.length||member.targetEndpointId!==plan.target.endpointId||!['retained_inventory','correction_artifact'].includes(member.source?.kind))
        fail('ARCA_JAV_CORRECTION_FILE_PLAN_INVALID','Stage members must conserve complete ordering, source kind and endpoint.');
      assertParents(root,member.targetLocation);
      const original=member.original,observed=await computeBoundedMaterialFingerprint(original.location,{requireStableSnapshot:true}),identity=original.physicalIdentity;
      if(fs.lstatSync(original.location).isSymbolicLink()||String(observed.stat.ino)!==identity.inode||Number(observed.stat.size)!==identity.sizeBytes||
          observed.contentFingerprint!==identity.contentFingerprint)fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Owned Inventory source changed before correction staging.');
      const location=path.join(directory,String(member.ordinal).padStart(4,'0')+'-'+path.basename(member.targetLocation));assertParents(root,location);
      let source=original.location,byteDigest;
      if(member.source.kind==='correction_artifact') {
        const handle=member.source.workspaceMaterialHandle,resolved=resolveWorkspaceMaterial(plan.correctionId,plan.admissionDigest,handle);
        source=resolved.location;const snapshot=await readBoundedFileSnapshot(source,handle.sizeBytes,{requireStableSnapshot:true});
        byteDigest=createHash('sha256').update(snapshot.bytes).digest('hex');
        if(byteDigest!==handle.digestHex||snapshot.bytes.length!==handle.sizeBytes||String(snapshot.stat.ino)!==handle.physicalIdentity.inode||snapshot.contentFingerprint!==handle.physicalIdentity.contentFingerprint)
          fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Prepared correction Artifact changed before staging.');
      } else byteDigest=await digestFile(source,check);
      prepared.push({member,source,location,byteDigest});
    }
    // Validate every source before creating the stage or copying any member.
    check();
    if(fs.existsSync(directory)) {
      if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()||
          fs.readdirSync(directory).some(name=>!prepared.some(item=>path.basename(item.location)===name)))
        fail('ARCA_JAV_CORRECTION_STAGE_CONFLICT','Correction stage contains an unknown member.');
    }
    for(const item of prepared){check();assertParents(root,item.location);
      if(fs.existsSync(item.location)&&(!fs.lstatSync(item.location).isFile()||fs.lstatSync(item.location).isSymbolicLink()||await digestFile(item.location,check)!==item.byteDigest))
        fail('ARCA_JAV_CORRECTION_STAGE_CONFLICT','Existing correction stage bytes differ from the exact source.');
    }
    return {check,root,directory,prepared};
  }
  async function stage(plan,options) {
    const {check,root,directory,prepared}=await preflightStage(plan,options);
    check();assertParents(root,directory);if(!fs.existsSync(directory))fs.mkdirSync(directory,{recursive:false});
    const staged=[];
    for(const item of prepared) {
      check();assertParents(root,item.location);
      if(fs.existsSync(item.location)) {
        if(!fs.lstatSync(item.location).isFile()||fs.lstatSync(item.location).isSymbolicLink()||await digestFile(item.location,check)!==item.byteDigest)
          fail('ARCA_JAV_CORRECTION_STAGE_CONFLICT','Existing correction stage bytes differ from the exact source.');
      } else if(item.member.source.kind==='retained_inventory') {
        try{fs.linkSync(item.source,item.location);}catch(error){if(error.code!=='EXDEV')throw error;await fs.promises.copyFile(item.source,item.location,fs.constants.COPYFILE_EXCL);}
      } else await fs.promises.copyFile(item.source,item.location,fs.constants.COPYFILE_EXCL);
      const byteDigest=await digestFile(item.location,check),fingerprint=await computeBoundedMaterialFingerprint(item.location,{requireStableSnapshot:true});
      if(byteDigest!==item.byteDigest)fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Staged bytes differ from their exact owned source.');
      const tuple={mountScopeId:plan.target.mountScopeId,inode:String(fingerprint.stat.ino),sizeBytes:Number(fingerprint.stat.size),
        fingerprintAlgorithm:fingerprint.fingerprintAlgorithm,fingerprintVersion:fingerprint.fingerprintVersion,contentFingerprint:fingerprint.contentFingerprint},
        physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple};
      staged.push({ordinal:item.member.ordinal,role:item.member.role,previousMaterialKey:item.member.original.physicalIdentity.materialKey,
        location:item.location,targetLocation:item.member.targetLocation,endpointId:plan.target.endpointId,physicalIdentity,byteDigest});
    }
    check();const result={schema:'arca.jav-correction-staged-files@1',correctionId:plan.correctionId,planDigest:plan.planDigest,directory,members:staged};
    return Object.freeze({...result,manifestDigest:canonicalDigest(result)});
  }
  async function matchesIdentity(location,identity,check,byteDigest=null) {
    let stat;try{stat=fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')return false;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())return false;
    const actual=await computeBoundedMaterialFingerprint(location,{requireStableSnapshot:true});check();
    return String(actual.stat.ino)===identity.inode&&Number(actual.stat.size)===identity.sizeBytes&&actual.contentFingerprint===identity.contentFingerprint&&
      (byteDigest===null||await digestFile(location,check)===byteDigest);
  }
  async function preflightPublish(plan,manifest,{shouldContinue,recoveryDecision=null}) {
    const check=()=>{if(typeof shouldContinue!=='function'||shouldContinue()!==true)fail('ARCA_JAV_CORRECTION_FILE_FENCED','Correction publication no longer holds its exact execution scope.');};
    check();const {planDigest,...body}=plan,{manifestDigest,...manifestBody}=manifest;
    if(planDigest!==canonicalDigest(body)||manifestDigest!==canonicalDigest(manifestBody)||manifest.sourceProductManifestDigest!==planDigest||
        manifest.stagedMembers?.length!==plan.members.length)fail('ARCA_JAV_CORRECTION_FILE_PLAN_INVALID','Publication requires the exact complete File Plan and staged Manifest.');
    const root=path.resolve(plan.target.rootLocation),key=location=>process.platform==='win32'?path.resolve(location).toLowerCase():path.resolve(location),prepared=[];
    for(let index=0;index<plan.members.length;index++) {
      check();const member=plan.members[index],staged=manifest.stagedMembers[index],original=member.original,
        retained=javCorrectionRetainedLocation(plan.correctionId,member.ordinal,original.location);
      if(member.retainedLocation!==retained||staged.role!==member.role||!/^[a-f0-9]{64}$/.test(staged.fullByteDigest||''))
        fail('ARCA_JAV_CORRECTION_FILE_PLAN_INVALID','Publication member differs from its retained source or full byte proof.');
      assertParents(root,staged.location);assertParents(root,member.targetLocation);
      if(!await matchesIdentity(staged.location,staged.physicalIdentity,check,staged.fullByteDigest))
        fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Staged source changed before publication.');
      const originalExact=await matchesIdentity(original.location,original.physicalIdentity,check),retainedExact=await matchesIdentity(retained,original.physicalIdentity,check);
      if(!originalExact&&!retainedExact)fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Publication has no exact retained original material.');
      if(fs.existsSync(retained)&&!retainedExact)fail('ARCA_JAV_CORRECTION_TARGET_CONFLICT','Retained source path contains a foreign material.');
      const finalExact=await matchesIdentity(member.targetLocation,staged.physicalIdentity,check,staged.fullByteDigest),
        targetOriginal=plan.members.find(item=>key(item.original.location)===key(member.targetLocation));
      if(fs.existsSync(member.targetLocation)&&!finalExact&&(!targetOriginal||!await matchesIdentity(member.targetLocation,targetOriginal.original.physicalIdentity,check)))
        fail('ARCA_JAV_CORRECTION_TARGET_CONFLICT','Correction target contains a foreign material.');
      prepared.push({member,staged,retained,originalExact,retainedExact,finalExact,targetOriginal});
    }
    const allowed=new Set(prepared.flatMap(item=>[key(item.member.original.location),key(item.member.targetLocation),key(item.retained)]));
    for(const directory of new Set(prepared.map(item=>path.dirname(item.member.targetLocation)))) {
      if(!fs.existsSync(directory))continue;
      if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()||fs.readdirSync(directory).some(name=>!allowed.has(key(path.join(directory,name)))))
        fail('ARCA_JAV_CORRECTION_TARGET_CONFLICT','Correction target directory contains an unknown member.');
      if(!plan.members.some(item=>key(path.dirname(item.original.location))===key(directory))&&
          !prepared.some(item=>item.finalExact&&key(path.dirname(item.member.targetLocation))===key(directory))&&recoveryDecision!=='continue_forward')
        fail('ARCA_JAV_CORRECTION_TARGET_CONFLICT','Correction target directory existed before this publication.');
    }
    return {check,root,prepared};
  }
  async function publish(plan,manifest,options) {
    const {check,root,prepared}=await preflightPublish(plan,manifest,options),{shouldContinue}=options;
    // Retain every original before the first replacement; primary source paths are never removed here.
    for(const item of prepared) {
      check();if(item.retainedExact)continue;
      if(fs.lstatSync(path.dirname(item.retained)).isSymbolicLink())fail('ARCA_JAV_CORRECTION_FILE_ESCAPE','Retained source parent became linked.');
      fs.linkSync(item.member.original.location,item.retained);
      if(!await matchesIdentity(item.retained,item.member.original.physicalIdentity,check))fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Retained original no longer matches its owned identity.');
    }
    for(const item of prepared) {
      check();if(item.finalExact)continue;assertParents(root,item.member.targetLocation);
      if(fs.existsSync(item.member.targetLocation)) {
        if(item.targetOriginal?.role==='primary_payload')fail('ARCA_JAV_CORRECTION_PRIMARY_REPLACEMENT_FORBIDDEN','Correction cannot replace or remove the original video.');
        if(!item.targetOriginal||!await matchesIdentity(item.member.targetLocation,item.targetOriginal.original.physicalIdentity,check))
          fail('ARCA_JAV_CORRECTION_TARGET_CONFLICT','Correction target changed after preflight.');
        fs.unlinkSync(item.member.targetLocation);
      }
      fs.mkdirSync(path.dirname(item.member.targetLocation),{recursive:true});assertParents(root,item.member.targetLocation);
      fs.linkSync(item.staged.location,item.member.targetLocation);
      if(!await matchesIdentity(item.member.targetLocation,item.staged.physicalIdentity,check,item.staged.fullByteDigest))
        fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Published material differs from its verified stage.');
    }
    return verify(plan,manifest,{shouldContinue});
  }
  async function verify(plan,manifest,{shouldContinue}) {
    const check=()=>{if(typeof shouldContinue!=='function'||shouldContinue()!==true)fail('ARCA_JAV_CORRECTION_FILE_FENCED','Correction verification lost its scope.');};
    check();const members=[];
    for(let index=0;index<plan.members.length;index++) {
      const member=plan.members[index],staged=manifest.stagedMembers[index];assertParents(path.resolve(plan.target.rootLocation),member.targetLocation);
      if(!await matchesIdentity(member.targetLocation,staged.physicalIdentity,check,staged.fullByteDigest))
        fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Final correction member differs from its complete staged byte and identity proof.');
      if(!await matchesIdentity(member.retainedLocation,member.original.physicalIdentity,check))
        fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Final correction lost its original retained material.');
      members.push({...staged,location:member.targetLocation,bindingRevision:member.original.bindingRevision+1});
    }
    const value={schema:'arca.jav-correction-final-files@1',correctionId:plan.correctionId,planDigest:plan.planDigest,stagedManifestDigest:manifest.manifestDigest,members};
    return Object.freeze({...value,finalRealityDigest:canonicalDigest(value)});
  }
  async function readVerifiedNfo(plan,manifest,{shouldContinue}) {
    const index=plan.members.findIndex(member=>member.role==='metadata_sidecar'),member=plan.members[index],staged=manifest.stagedMembers[index];
    if(!member||!staged||staged.physicalIdentity.sizeBytes>128*1024)
      fail('ARCA_JAV_CORRECTION_NFO_INVALID','Final NFO exceeds its bounded semantic verification scope.');
    assertParents(path.resolve(plan.target.rootLocation),member.targetLocation);
    const snapshot=await readBoundedFileSnapshot(member.targetLocation,128*1024,{requireStableSnapshot:true});
    if(typeof shouldContinue!=='function'||shouldContinue()!==true||fs.lstatSync(member.targetLocation).isSymbolicLink()||
        String(snapshot.stat.ino)!==staged.physicalIdentity.inode||snapshot.contentFingerprint!==staged.physicalIdentity.contentFingerprint||
        createHash('sha256').update(snapshot.bytes).digest('hex')!==staged.fullByteDigest)
      fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Final NFO changed during independent semantic verification.');
    return snapshot.bytes;
  }
  return Object.freeze({preflightStage,preflightPublish,stage,publish,verify,readVerifiedNfo});
}
module.exports=Object.freeze({createJavCorrectionFormalFiles});
