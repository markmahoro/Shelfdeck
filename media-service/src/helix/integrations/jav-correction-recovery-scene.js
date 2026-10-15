'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {computeBoundedMaterialFingerprint,readBoundedFileSnapshot}=require('./bounded-material-fingerprint');
const fail=(reasonCode='invalid_scope',locations=[])=>{throw Object.assign(new Error('Correction recovery scene is outside its bounded declared file scope.'),
  {code:'ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID',details:{reasonCode,locations:locations.slice(0,8)}});};
const key=location=>process.platform==='win32'?path.resolve(location).toLowerCase():path.resolve(location);
function createJavCorrectionRecoveryScene({now=Date.now}={}){
  return Object.freeze({async observe({correctionId,phase,roots,files,directories,requiredGroups=[]}){
    if(!/^arca-jav-correction-[a-f0-9]{40}$/.test(correctionId)||!Array.isArray(roots)||!roots.length||roots.length>2||
        !Array.isArray(files)||files.length>32||!Array.isArray(directories)||directories.length>32)fail();
    for(const root of roots){if(!path.isAbsolute(root))fail();const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||key(fs.realpathSync(root))!==key(root))fail();}
    function parents(location){
      if(!path.isAbsolute(location))fail();const root=roots.find(root=>{const rel=path.relative(root,location);return rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);});
      if(!root)fail();let current=root;
      for(const part of path.relative(root,location).split(path.sep).slice(0,-1)){
        current=path.join(current,part);let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')return;throw error;}
        if(stat.isSymbolicLink()||!stat.isDirectory())fail();
      }
    }
    const observed=[];
    for(const [ordinal,rule] of files.entries()){
      parents(rule.location);let before;try{before=fs.lstatSync(rule.location,{bigint:true});}catch(error){if(error.code!=='ENOENT')throw error;}
      const entry={role:rule.role,ordinal,location:path.resolve(rule.location),exists:Boolean(before),kind:!before?'absent':before.isSymbolicLink()?'symlink':before.isFile()?'file':before.isDirectory()?'directory':'other',
        physical:null,expectedDigest:rule.byteDigest||rule.producerRecipe?.byteDigest||null,status:!before?(rule.missingAllowed?'absent':'conflict'):'conflict'};
      if(before?.isFile()&&!before.isSymbolicLink()){
        const bounded=await computeBoundedMaterialFingerprint(rule.location,{requireStableSnapshot:true}),stat=fs.lstatSync(rule.location,{bigint:true});
        if(['dev','ino','size','mtimeNs','ctimeNs'].some(name=>stat[name]!==before[name]))fail();
        if(!Number.isSafeInteger(Number(stat.size)))fail();
        entry.physical={device:String(stat.dev),inode:String(stat.ino),sizeBytes:Number(stat.size),modifiedAtNs:String(stat.mtimeNs),changedAtNs:String(stat.ctimeNs),contentFingerprint:bounded.contentFingerprint};
        const identities=rule.identities||[],identityMatches=identities.some(({identity,inodeRequired=true})=>
          (!inodeRequired||identity.inode===String(stat.ino))&&identity.sizeBytes===Number(stat.size)&&identity.contentFingerprint===bounded.contentFingerprint);
        const recipe=rule.producerRecipe;
        if(recipe&&(!recipe.registeredWorkspace||!/^[a-f0-9]{64}$/.test(recipe.byteDigest)||
            path.basename(rule.location)!=='.shelfdeck-writing-'+recipe.byteDigest+'.part'))fail();
        const expectedDigest=rule.byteDigest||recipe?.byteDigest,sizeBytes=recipe?.sizeBytes??rule.sizeBytes;
        let byteMatches=false;
        if(expectedDigest){
          if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>16*1024*1024)fail();
          if(stat.size===BigInt(sizeBytes)){
            const snapshot=await readBoundedFileSnapshot(rule.location,sizeBytes,{requireStableSnapshot:true});
            if(['dev','ino','size','mtimeNs','ctimeNs'].some(name=>snapshot.stat[name]!==before[name]))fail();
            byteMatches=createHash('sha256').update(snapshot.bytes).digest('hex')===expectedDigest;
          }
        }
        const shortProducer=recipe&&stat.nlink===1n&&stat.size<BigInt(sizeBytes);
        if((identities.length?identityMatches:true)&&(expectedDigest?byteMatches||shortProducer:identities.length>0))entry.status='matching';
      }
      observed.push(entry);
    }
    const seenDirectories=[];
    for(const rule of directories){
      parents(rule.location);let stat;try{stat=fs.lstatSync(rule.location);}catch(error){if(error.code!=='ENOENT')throw error;}
      let names=[];
      if(stat){
        if(!stat.isDirectory()||stat.isSymbolicLink())fail();
        const handle=fs.opendirSync(rule.location);try{for(let member;(member=handle.readSync());){names.push(member.name);if(names.length>2048)fail();}}finally{handle.closeSync();}
        names.sort();
        const allowed=new Set(rule.allowedMembers.map(key));
        const unknown=names.filter(name=>!allowed.has(key(path.join(rule.location,name))));
        if(unknown.length)fail('undeclared_member',unknown.map(name=>path.join(rule.location,name)));
      }
      seenDirectories.push({location:path.resolve(rule.location),exists:Boolean(stat),memberNames:names,memberSetDigest:canonicalDigest(names)});
    }
    if(requiredGroups.some(group=>!Array.isArray(group)||!group.length||!group.some(index=>observed[index]?.status==='matching')))fail();
    const value={schema:'arca.jav-correction-recovery-reality@1',correctionId,phase,observedAtMs:now(),
      classification:observed.some(file=>file.status==='conflict')?'conflict':'matching',files:observed,directories:seenDirectories};
    if(Buffer.byteLength(canonicalJson(value))>1024*1024)fail();return Object.freeze(value);
  }});
}
module.exports=Object.freeze({createJavCorrectionRecoveryScene});
