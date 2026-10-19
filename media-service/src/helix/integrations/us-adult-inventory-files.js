'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {computeBoundedMaterialFingerprint}=require('./bounded-material-fingerprint');
const {retainedName}=require('../contracts/us-adult-retained-name');
const PLAN='helix://contracts/domain-types/UsAdultActorFilePlan/v1';
function fail(code,message){throw Object.assign(new Error(message),{code});}
const key=location=>process.platform==='win32'?path.resolve(location).toLowerCase():path.resolve(location);
function createUsAdultInventoryFiles(options){
  if(typeof options?.resolveWorkspaceMaterial!=='function')throw new TypeError('Actor file effects require their controlled Case Workspace resolver.');
  function parents(root,location){
    const relative=path.relative(root,location);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('ARCA_US_ADULT_FILE_ESCAPE','File effect escaped its exact physical target.');
    let current=root;
    for(const part of [null,...relative.split(path.sep)]){
      if(part!==null)current=path.join(current,part);
      let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT'&&part!==null)continue;throw error;}
      if(stat.isSymbolicLink()||current!==location&&!stat.isDirectory())fail('ARCA_US_ADULT_FILE_ESCAPE','File effect traverses a linked or foreign parent.');
    }
  }
  async function fullDigest(location,check){
    const before=fs.lstatSync(location,{bigint:true});
    if(!before.isFile()||before.isSymbolicLink())fail('ARCA_US_ADULT_FILE_CHANGED','File effect requires a regular non-linked material.');
    const digest=createHash('sha256');let ordinal=0;
    for await(const chunk of fs.createReadStream(location,{highWaterMark:256*1024})){digest.update(chunk);if(++ordinal%16===0)check();}
    const after=fs.lstatSync(location,{bigint:true});check();
    if(['dev','ino','size','mtimeNs','ctimeNs'].some(field=>before[field]!==after[field]))fail('ARCA_US_ADULT_FILE_CHANGED','Material changed during complete byte verification.');
    return digest.digest('hex');
  }
  function scope(plan,settings){
    const {planDigest,...body}=plan||{},check=()=>{if(typeof settings?.shouldContinue!=='function'||settings.shouldContinue()!==true)
      fail('ARCA_US_ADULT_FILE_FENCED','The actor Case no longer holds its exact file effect authority.');};check();
    if(plan?.schemaRef!==PLAN||plan.schemaVersion!==1||planDigest!==canonicalDigest(body)||!plan.aftercareCaseId||!path.isAbsolute(plan.target?.rootLocation||'')||
        !Array.isArray(plan.members)||plan.members.length<3||plan.members.length>1024||new Set(plan.members.map(item=>key(item.targetLocation))).size!==plan.members.length||
        plan.members.some((item,ordinal)=>item.ordinal!==ordinal||item.targetEndpointId!==plan.target.endpointId||
          item.retainedLocation!==path.join(path.dirname(item.original?.location),retainedName(plan.aftercareCaseId,ordinal))))
      fail('ARCA_US_ADULT_FILE_PLAN_INVALID','File effects require the complete immutable Actor File Plan.');
    return {check,root:path.resolve(plan.target.rootLocation),stage:path.join(plan.target.rootLocation,'.shelfdeck-us-'+canonicalDigest(plan.aftercareCaseId).slice(0,32)+'-stage')};
  }
  async function exact(location,identity,check,byteDigest=null){
    let stat;try{stat=fs.lstatSync(location);}catch(error){if(error.code==='ENOENT')return false;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())return false;
    const observed=await computeBoundedMaterialFingerprint(location,{requireStableSnapshot:true});check();
    return String(observed.stat.ino)===identity.inode&&Number(observed.stat.size)===identity.sizeBytes&&observed.fingerprintAlgorithm===identity.fingerprintAlgorithm&&
      observed.fingerprintVersion===identity.fingerprintVersion&&observed.contentFingerprint===identity.contentFingerprint&&
      (!byteDigest||await fullDigest(location,check)===byteDigest);
  }
  async function preflight(plan,settings){
    const current=scope(plan,settings),prepared=[];parents(current.root,current.stage);
    for(const member of plan.members){
      current.check();parents(current.root,member.targetLocation);parents(member.original.rootLocation,member.original.location);
      if(!await exact(member.original.location,member.original.physicalIdentity,current.check))fail('ARCA_US_ADULT_FILE_CHANGED','An original Inventory member changed before staging.');
      let source=member.original.location;
      if(member.source.kind==='actor_artifact')source=(await options.resolveWorkspaceMaterial(plan.aftercareCaseId,plan.intentDigest,member.source.workspaceMaterialHandle)).location;
      else if(member.source.kind!=='retained_inventory')fail('ARCA_US_ADULT_FILE_PLAN_INVALID','Unknown file source kind.');
      const byteDigest=await fullDigest(source,current.check),location=path.join(current.stage,String(member.ordinal).padStart(4,'0')+'.stage');
      if(member.source.kind==='actor_artifact'&&byteDigest!==member.source.workspaceMaterialHandle.digestHex)
        fail('ARCA_US_ADULT_FILE_CHANGED','Prepared Actor artifact changed before staging.');
      prepared.push({member,source,byteDigest,location});
    }
    if(fs.existsSync(current.stage)){
      parents(current.root,path.join(current.stage,'0000.stage'));
      if(fs.readdirSync(current.stage).some(name=>!prepared.some(item=>path.basename(item.location)===name||path.basename(item.location)+'.part'===name)))
        fail('ARCA_US_ADULT_STAGE_CONFLICT','Actor stage contains an unknown member.');
    }
    for(const item of prepared)if(fs.existsSync(item.location)&&await fullDigest(item.location,current.check)!==item.byteDigest)
      fail('ARCA_US_ADULT_STAGE_CONFLICT','Existing staged material differs from this exact source.');
    return {...current,prepared};
  }
  async function matchingPrefix(part,source,check){
    const a=await fs.promises.open(part,'r'),b=await fs.promises.open(source,'r');
    try{const left=Buffer.allocUnsafe(256*1024),right=Buffer.allocUnsafe(256*1024);let offset=0;
      while(true){check();const read=await a.read(left,0,left.length,offset);if(!read.bytesRead)return true;
        const other=await b.read(right,0,read.bytesRead,offset);if(other.bytesRead!==read.bytesRead||!left.subarray(0,read.bytesRead).equals(right.subarray(0,read.bytesRead)))return false;offset+=read.bytesRead;}
    }finally{await a.close();await b.close();}
  }
  async function stage(plan,settings){
    const current=await preflight(plan,settings),members=[];current.check();if(!fs.existsSync(current.stage))fs.mkdirSync(current.stage);
    for(const item of current.prepared){
      current.check();parents(current.root,item.location);
      if(!fs.existsSync(item.location)){
        let linked=false;
        if(item.member.source.kind==='retained_inventory')try{fs.linkSync(item.source,item.location);linked=true;}catch(error){if(error.code!=='EXDEV')throw error;}
        if(!linked){
          const part=item.location+'.part';parents(current.root,part);
          if(fs.existsSync(part)){
            if(await fullDigest(part,current.check)!==item.byteDigest){
              const before=fs.lstatSync(part,{bigint:true});
              if(!['safe_retry','continue_forward'].includes(settings.recoveryDecision)||!await matchingPrefix(part,item.source,current.check))
                fail('ARCA_US_ADULT_STAGE_PARTIAL_WRITE','Incomplete stage copy requires classified exact-prefix recovery.');
              const after=fs.lstatSync(part,{bigint:true});current.check();
              if(['dev','ino','size','mtimeNs','ctimeNs'].some(field=>before[field]!==after[field]))fail('ARCA_US_ADULT_FILE_CHANGED','Partial stage changed before exact-prefix recovery.');
              fs.unlinkSync(part);
            }
          }
          if(!fs.existsSync(part))await fs.promises.copyFile(item.source,part,fs.constants.COPYFILE_EXCL);
          if(await fullDigest(part,current.check)!==item.byteDigest)fail('ARCA_US_ADULT_FILE_CHANGED','Stage copy does not preserve complete source bytes.');
          current.check();parents(current.root,item.location);fs.linkSync(part,item.location);fs.unlinkSync(part);
        }
      }
      const byteDigest=await fullDigest(item.location,current.check),observed=await computeBoundedMaterialFingerprint(item.location,{requireStableSnapshot:true}),
        tuple={mountScopeId:plan.target.mountScopeId,inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,
          fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
        physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple};
      if(byteDigest!==item.byteDigest)fail('ARCA_US_ADULT_FILE_CHANGED','Stage bytes changed after publication.');
      members.push({ordinal:item.member.ordinal,role:item.member.role,previousMaterialKey:item.member.original.physicalIdentity.materialKey,
        location:item.location,targetLocation:item.member.targetLocation,endpointId:plan.target.endpointId,physicalIdentity,fullByteDigest:byteDigest});
    }
    const body={schema:'arca.us-adult-staged-files@1',aftercareCaseId:plan.aftercareCaseId,planDigest:plan.planDigest,directory:current.stage,members};
    return Object.freeze({...body,manifestDigest:canonicalDigest(body)});
  }
  function manifestFor(plan,manifest,settings){
    const current=scope(plan,settings),{manifestDigest,...body}=manifest||{};
    if(manifest?.schema!=='arca.us-adult-staged-files@1'||manifest.aftercareCaseId!==plan.aftercareCaseId||manifest.planDigest!==plan.planDigest||
        manifest.manifestDigest!==canonicalDigest(body)||manifest.directory!==current.stage||manifest.members?.length!==plan.members.length||manifest.members.some((item,ordinal)=>
          item.ordinal!==ordinal||item.role!==plan.members[ordinal].role||item.location!==path.join(current.stage,String(ordinal).padStart(4,'0')+'.stage')||
          item.targetLocation!==plan.members[ordinal].targetLocation||item.previousMaterialKey!==plan.members[ordinal].original.physicalIdentity.materialKey))
      fail('ARCA_US_ADULT_FILE_PLAN_INVALID','Staged receipt does not explain every exact planned member.');
    return current;
  }
  async function preparePublication(plan,manifest,settings){
    const current=manifestFor(plan,manifest,settings),prepared=[];
    for(const member of plan.members){
      const staged=manifest.members[member.ordinal];current.check();parents(current.root,member.targetLocation);parents(current.root,staged.location);
      parents(member.original.rootLocation,member.retainedLocation);
      if(!await exact(staged.location,staged.physicalIdentity,current.check,staged.fullByteDigest))fail('ARCA_US_ADULT_FILE_CHANGED','Staged output changed before publication.');
      const originalExact=await exact(member.original.location,member.original.physicalIdentity,current.check),
        retainedExact=await exact(member.retainedLocation,member.original.physicalIdentity,current.check),finalExact=await exact(member.targetLocation,staged.physicalIdentity,current.check,staged.fullByteDigest),
        targetOriginal=plan.members.find(item=>key(item.original.location)===key(member.targetLocation));
      if(!originalExact&&!retainedExact)fail('ARCA_US_ADULT_FILE_CHANGED','Publication lost the exact original material.');
      if(fs.existsSync(member.retainedLocation)&&!retainedExact)fail('ARCA_US_ADULT_TARGET_CONFLICT','Retained source path contains a foreign file.');
      if(fs.existsSync(member.targetLocation)&&!finalExact&&(!targetOriginal||!await exact(member.targetLocation,targetOriginal.original.physicalIdentity,current.check)))
        fail('ARCA_US_ADULT_TARGET_CONFLICT','Actor target contains a foreign file.');
      prepared.push({member,staged,retainedExact,finalExact,targetOriginal});
    }
    const allowed=new Set(plan.members.flatMap(item=>[key(item.original.location),key(item.targetLocation),key(item.retainedLocation)]));
    for(const directory of new Set(plan.members.map(item=>path.dirname(item.targetLocation))))if(fs.existsSync(directory)){
      parents(current.root,path.join(directory,'scope-check'));
      if(fs.readdirSync(directory).some(name=>!allowed.has(key(path.join(directory,name)))))fail('ARCA_US_ADULT_TARGET_CONFLICT','Actor target directory contains unknown files.');
      if(!plan.members.some(item=>key(path.dirname(item.original.location))===key(directory))&&!prepared.some(item=>item.finalExact&&key(path.dirname(item.member.targetLocation))===key(directory))&&settings.recoveryDecision!=='continue_forward')
        fail('ARCA_US_ADULT_TARGET_CONFLICT','Actor target directory already exists without a publication receipt.');
    }
    return {current,prepared};
  }
  async function publish(plan,manifest,settings){
    let value;
    try{value=await preparePublication(plan,manifest,settings);}
    catch(error){
      if(!settings.recoveryDecision&&['ARCA_US_ADULT_TARGET_CONFLICT','ARCA_US_ADULT_FILE_CHANGED','ARCA_US_ADULT_FILE_ESCAPE'].includes(error.code))
        error.details={...error.details,effectWriteStarted:false,boundary:'before_publication'};
      throw error;
    }
    const {current,prepared}=value;
    for(const item of prepared)if(!item.retainedExact){current.check();parents(item.member.original.rootLocation,item.member.retainedLocation);
      fs.linkSync(item.member.original.location,item.member.retainedLocation);}
    for(const item of prepared){
      current.check();if(item.finalExact)continue;parents(current.root,item.member.targetLocation);
      if(fs.existsSync(item.member.targetLocation)){
        if(item.targetOriginal?.role==='primary_payload'||!item.targetOriginal||!await exact(item.member.targetLocation,item.targetOriginal.original.physicalIdentity,current.check))
          fail('ARCA_US_ADULT_TARGET_CONFLICT','Actor publication cannot replace a video or a changed foreign file.');
        current.check();fs.unlinkSync(item.member.targetLocation);
      }
      fs.mkdirSync(path.dirname(item.member.targetLocation),{recursive:true});parents(current.root,item.member.targetLocation);
      fs.linkSync(item.staged.location,item.member.targetLocation);
    }
    return verify(plan,manifest,settings);
  }
  async function verify(plan,manifest,settings){
    const current=manifestFor(plan,manifest,settings),members=[];
    for(const member of plan.members){const staged=manifest.members[member.ordinal];current.check();parents(current.root,member.targetLocation);
      if(!await exact(member.targetLocation,staged.physicalIdentity,current.check,staged.fullByteDigest)||
          !await exact(member.retainedLocation,member.original.physicalIdentity,current.check))fail('ARCA_US_ADULT_FILE_CHANGED','Final output or retained original differs from its exact receipt.');
      members.push({...staged,location:member.targetLocation,bindingRevision:member.original.bindingRevision+1});}
    const body={schema:'arca.us-adult-final-files@1',aftercareCaseId:plan.aftercareCaseId,planDigest:plan.planDigest,stagedManifestDigest:manifest.manifestDigest,members};
    return Object.freeze({...body,finalRealityDigest:canonicalDigest(body)});
  }
  async function retire(plan,manifest,settings){
    const current=manifestFor(plan,manifest,settings);current.check();
    // Retirement is only called with the Owner's durable post-commit authority.
    if(settings.inventoryCommitted!==true)fail('ARCA_US_ADULT_RETIREMENT_NOT_COMMITTED','Old aliases cannot retire before the Inventory commit.');
    const targets=new Set(plan.members.map(item=>key(item.targetLocation)));
    for(const member of plan.members){const staged=manifest.members[member.ordinal];parents(current.root,member.targetLocation);
      if(!await exact(member.targetLocation,staged.physicalIdentity,current.check,staged.fullByteDigest))fail('ARCA_US_ADULT_FILE_CHANGED','Final output changed before old-material retirement.');}
    let deletedCount=0;
    for(const member of plan.members){
      for(const location of [member.original.location,member.retainedLocation]){
        current.check();if(targets.has(key(location))||!fs.existsSync(location))continue;parents(member.original.rootLocation,location);
        if(!await exact(location,member.original.physicalIdentity,current.check))fail('ARCA_US_ADULT_RETIREMENT_CONFLICT','An old alias changed before retirement.');
        current.check();fs.unlinkSync(location);deletedCount++;
      }
    }
    for(const staged of manifest.members){current.check();parents(current.root,staged.location);if(!fs.existsSync(staged.location))continue;
      if(!await exact(staged.location,staged.physicalIdentity,current.check,staged.fullByteDigest))fail('ARCA_US_ADULT_RETIREMENT_CONFLICT','An Actor stage alias changed before retirement.');
      current.check();fs.unlinkSync(staged.location);deletedCount++;}
    for(const directory of new Set([...plan.members.map(item=>path.dirname(item.original.location)),current.stage])){
      current.check();if(!fs.existsSync(directory)||targets.has(key(directory))||key(directory)===key(current.root)||plan.members.some(item=>key(item.original.rootLocation)===key(directory))||
          plan.members.some(item=>key(path.dirname(item.targetLocation))===key(directory)))continue;
      const stat=fs.lstatSync(directory);if(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.readdirSync(directory).length===0)fs.rmdirSync(directory);
    }
    return Object.freeze({schema:'arca.us-adult-retired-files@1',aftercareCaseId:plan.aftercareCaseId,planDigest:plan.planDigest,finalRealityDigest:canonicalDigest(manifest.members.map(item=>({identity:item.physicalIdentity,location:item.targetLocation}))),deletedCount});
  }
  async function discardReality(plan,manifest,settings){
    const current=manifestFor(plan,manifest,settings),members=[];
    parents(current.root,current.stage);
    if(fs.existsSync(current.stage)){
      const stat=fs.lstatSync(current.stage);
      if(!stat.isDirectory()||stat.isSymbolicLink()||fs.readdirSync(current.stage).some(name=>!manifest.members.some(item=>path.basename(item.location)===name)))
        fail('ARCA_US_ADULT_STAGE_CONFLICT','Stage discard cannot include foreign or linked members.');
    }
    for(const staged of manifest.members){
      current.check();parents(current.root,staged.location);const present=fs.existsSync(staged.location);
      if(present&&!await exact(staged.location,staged.physicalIdentity,current.check,staged.fullByteDigest))
        fail('ARCA_US_ADULT_STAGE_CONFLICT','Stage discard requires each exact temporary identity and complete bytes.');
      members.push({ordinal:staged.ordinal,present});
    }
    return {current,members};
  }
  async function discard(plan,manifest,settings){
    const {current}=await discardReality(plan,manifest,settings);let deletedCount=0;
    for(const staged of manifest.members){
      current.check();parents(current.root,staged.location);if(!fs.existsSync(staged.location))continue;
      if(!await exact(staged.location,staged.physicalIdentity,current.check,staged.fullByteDigest))
        fail('ARCA_US_ADULT_STAGE_CONFLICT','Stage member changed before exact temporary removal.');
      current.check();fs.unlinkSync(staged.location);deletedCount++;
    }
    current.check();parents(current.root,current.stage);
    if(fs.existsSync(current.stage)){
      if(fs.readdirSync(current.stage).length)fail('ARCA_US_ADULT_STAGE_CONFLICT','Stage directory gained a foreign member during discard.');
      fs.rmdirSync(current.stage);
    }
    return Object.freeze({schema:'arca.us-adult-discarded-stage@1',aftercareCaseId:plan.aftercareCaseId,planDigest:plan.planDigest,
      stagedManifestDigest:manifest.manifestDigest,deletedCount});
  }
  async function observe(plan,manifest,action,settings){
    if(action==='discard'){
      const {members}=await discardReality(plan,manifest,settings);return {planDigest:plan.planDigest,action,members};
    }
    if(action==='stage'){
      const current=await preflight(plan,settings),members=[];
      for(const item of current.prepared){const part=item.location+'.part';parents(current.root,part);
        if(fs.existsSync(part)&&!await matchingPrefix(part,item.source,current.check))fail('ARCA_US_ADULT_STAGE_CONFLICT','Partial stage bytes differ from the exact prepared source.');
        members.push({ordinal:item.member.ordinal,staged:fs.existsSync(item.location),partial:fs.existsSync(part)});}
      return {planDigest:plan.planDigest,action,members};
    }
    const current=manifestFor(plan,manifest,settings),members=[],targets=new Set(plan.members.map(item=>key(item.targetLocation)));
    for(const member of plan.members){const staged=manifest.members[member.ordinal];current.check();parents(current.root,member.targetLocation);
      const finalExact=await exact(member.targetLocation,staged.physicalIdentity,current.check,staged.fullByteDigest),
        old=plan.members.find(item=>key(item.original.location)===key(member.targetLocation));
      if(action==='retire'){
        if(!finalExact)fail('ARCA_US_ADULT_RETIREMENT_CONFLICT','Committed target changed during retirement recovery.');
        for(const location of [member.original.location,member.retainedLocation]){
          parents(member.original.rootLocation,location);if(targets.has(key(location))||!fs.existsSync(location))continue;
          if(!await exact(location,member.original.physicalIdentity,current.check))fail('ARCA_US_ADULT_RETIREMENT_CONFLICT','Old retirement alias changed.');
        }
        parents(current.root,staged.location);
        if(fs.existsSync(staged.location)&&!await exact(staged.location,staged.physicalIdentity,current.check,staged.fullByteDigest))
          fail('ARCA_US_ADULT_RETIREMENT_CONFLICT','Retirement stage alias changed.');
      }else{
        parents(current.root,staged.location);parents(member.original.rootLocation,member.retainedLocation);
        if(!await exact(staged.location,staged.physicalIdentity,current.check,staged.fullByteDigest)||
            !await exact(member.original.location,member.original.physicalIdentity,current.check)&&!await exact(member.retainedLocation,member.original.physicalIdentity,current.check)||
            fs.existsSync(member.retainedLocation)&&!await exact(member.retainedLocation,member.original.physicalIdentity,current.check)||
            fs.existsSync(member.targetLocation)&&!finalExact&&(!old||!await exact(member.targetLocation,old.original.physicalIdentity,current.check)))
          fail('ARCA_US_ADULT_TARGET_CONFLICT','Partial publication lost its exact stage, original or target.');
      }
      members.push({ordinal:member.ordinal,finalExact,originalPresent:fs.existsSync(member.original.location),retainedPresent:fs.existsSync(member.retainedLocation),stagedPresent:fs.existsSync(staged.location)});
    }
    if(action==='publish'){
      const allowed=new Set(plan.members.flatMap(item=>[key(item.original.location),key(item.targetLocation),key(item.retainedLocation)]));
      for(const directory of new Set(plan.members.map(item=>path.dirname(item.targetLocation))))if(fs.existsSync(directory)){
        if(fs.readdirSync(directory).some(name=>!allowed.has(key(path.join(directory,name)))))fail('ARCA_US_ADULT_TARGET_CONFLICT','Publication directory contains unknown files.');
        if(!plan.members.some(item=>key(path.dirname(item.original.location))===key(directory))&&!members.some(item=>item.finalExact)&&
            members.some(item=>!item.retainedPresent))fail('ARCA_US_ADULT_TARGET_CONFLICT','Existing empty target has no retained-source publication proof.');
      }
    }
    return {planDigest:plan.planDigest,action,members};
  }
  return Object.freeze({stage,publish,verify,retire,discard,preflight,exact,fullDigest,observe});
}
module.exports=Object.freeze({PLAN,createUsAdultInventoryFiles});
