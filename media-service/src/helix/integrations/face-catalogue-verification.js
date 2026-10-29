'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {assertGeneration}=require('../contracts/face-catalogue-generation');
const {canonicalJson,canonicalDigest}=require('../contracts/canonical-json');
const {awaitWithinDeadline,assertWithinDeadline}=require('./cooperative-deadline');
function fail(message){throw Object.assign(new Error(message),{code:'FACE_CATALOGUE_FILES_INVALID'});}
function same(a,b){return ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);}
function snapshot(stat){return Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])]));}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
async function verifyCatalogueGenerationFiles({root,generation,deadlineAtMs,signal,fsPromises=fs.promises,now=Date.now,onRead}={}){
  if(process.platform!=='linux')fail('Catalogue file qualification requires the Linux runtime.');
  if(typeof root!=='string'||root!==path.resolve(root)||!Number.isSafeInteger(deadlineAtMs)||deadlineAtMs<0||deadlineAtMs>now()+300000||
    onRead!==undefined&&typeof onRead!=='function')fail('An exact resource root and bounded verification deadline are required.');
  const reference=JSON.parse(canonicalJson(assertGeneration(generation))),guard={signal,deadlineAtMs,now},
    bounded=(stage,name,operation)=>awaitWithinDeadline(operation,{...guard,stage,location:name});
  assertWithinDeadline(guard);
  const beforeRoot=await bounded('catalogue_root_stat','catalogue',()=>fsPromises.lstat(root,{bigint:true}));
  if(!beforeRoot.isDirectory()||beforeRoot.isSymbolicLink()||await bounded('catalogue_root_realpath','catalogue',()=>fsPromises.realpath(root))!==root)
    fail('The resource generation root is not one real directory.');
  const verified=[],snapshots=new Map();let totalBytes=0,manifest;
  for(const expected of [{name:'manifest.json',bytes:null,sha256:reference.manifestDigest},...reference.members]){
    const file=path.join(root,expected.name),before=await bounded('catalogue_member_stat',expected.name,()=>fsPromises.lstat(file,{bigint:true}));
    if(!before.isFile()||before.isSymbolicLink()||before.size<1n||expected.bytes!==null&&before.size!==BigInt(expected.bytes)||
      expected.bytes===null&&before.size>65536n)fail('A catalogue member is missing, symbolic, or has an unexpected size.');
    const opening=Promise.resolve().then(()=>fsPromises.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW));
    let handle;
    try{handle=await bounded('catalogue_member_open',expected.name,()=>opening);}
    catch(error){opening.then(late=>late.close()).catch(()=>{});throw error;}
    try{
      const opened=await bounded('catalogue_member_fstat',expected.name,()=>handle.stat({bigint:true}));
      if(!same(before,opened))fail('A catalogue member changed while opening.');
      const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(262144),chunks=[];let position=0;
      while(position<Number(opened.size)){
        const requested=Math.min(buffer.length,Number(opened.size)-position),read=await bounded('catalogue_member_read',expected.name,()=>handle.read(buffer,0,requested,position));
        if(!Number.isSafeInteger(read.bytesRead)||read.bytesRead<1||read.bytesRead>requested)fail('A catalogue member ended before its declared size.');
        hash.update(buffer.subarray(0,read.bytesRead));
        if(expected.name==='manifest.json')chunks.push(Buffer.from(buffer.subarray(0,read.bytesRead)));
        position+=read.bytesRead;totalBytes+=read.bytesRead;
        onRead?.({name:expected.name,bytes:read.bytesRead,totalBytes});assertWithinDeadline(guard);
      }
      const after=await bounded('catalogue_member_fstat_after',expected.name,()=>handle.stat({bigint:true})),
        pathAfter=await bounded('catalogue_member_path_after',expected.name,()=>fsPromises.lstat(file,{bigint:true}));
      if(!same(opened,after)||pathAfter.isSymbolicLink()||!same(after,pathAfter)||hash.digest('hex')!==expected.sha256)
        fail('A catalogue member changed or failed its pinned SHA256.');
      if(expected.name==='manifest.json'){
        try{manifest=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('The catalogue manifest is not valid JSON.');}
      }
      snapshots.set(expected.name,after);
      verified.push({name:expected.name,bytes:position,sha256:expected.sha256,statDigest:canonicalDigest(snapshot(after))});
    }finally{
      if(signal?.aborted||now()>=deadlineAtMs)Promise.resolve().then(()=>handle.close()).catch(()=>{});
      else await bounded('catalogue_member_close',expected.name,()=>handle.close());
    }
  }
  if(manifest?.version!==reference.datasetVersion||manifest?.models?.embedding_dim!==512||!manifest?.checksums||
    Object.keys(manifest.checksums).sort().join(',')!==reference.members.map(member=>member.name).join(',')||
    reference.members.some(member=>manifest.checksums[member.name]!=='sha256:'+member.sha256))fail('The manifest version, feature dimension or complete member declarations differ.');
  for(const [name,stat]of snapshots){
    const current=await bounded('catalogue_final_member_fence',name,()=>fsPromises.lstat(path.join(root,name),{bigint:true}));
    if(current.isSymbolicLink()||!same(stat,current))fail('A previously verified member changed before qualification completed.');
  }
  const afterRoot=await bounded('catalogue_final_root_fence','catalogue',()=>fsPromises.lstat(root,{bigint:true}));
  if(afterRoot.isSymbolicLink()||!same(beforeRoot,afterRoot)||await bounded('catalogue_final_root_realpath','catalogue',()=>fsPromises.realpath(root))!==root)
    fail('The resource root changed during qualification.');
  const value={generationDigest:reference.generationDigest,verifiedMembers:verified,totalBytes,rootSnapshotDigest:canonicalDigest(snapshot(afterRoot)),verifiedAtMs:now()};
  return freeze({...value,verificationDigest:canonicalDigest(value)});
}
module.exports=Object.freeze({verifyCatalogueGenerationFiles});
