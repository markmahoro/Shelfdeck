'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {canonicalDigest}=require('./helix/contracts/canonical-json');
const {createRepositoryDefinition}=require('./helix/foundation/persistence/owner-repository');

function fail(code){throw Object.assign(new Error(code),{code});}
function inside(root,target){const rel=path.relative(path.resolve(root),path.resolve(target));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
async function present(location){try{await fs.promises.lstat(location);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function emptyDirectory(location){await noLinks(location);const dir=await fs.promises.opendir(location);try{return await dir.read()===null;}finally{await dir.close();}}
async function noLinks(location){let current=path.resolve(location);for(;;){try{if((await fs.promises.lstat(current)).isSymbolicLink())fail('ARCA_RECYCLE_SYMLINK');}catch(error){if(error.code!=='ENOENT')throw error;}const parent=path.dirname(current);if(parent===current)break;current=parent;}}
async function sha(location){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(location))hash.update(chunk);return hash.digest('hex');}

async function snapshot(root){
  await noLinks(root);const rows=[];let total=0;
  async function walk(folder){
    const entries=(await fs.promises.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(rows.length>=256)fail('ARCA_RECYCLE_SCOPE_TOO_LARGE');
      const location=path.join(folder,entry.name),relativePath=path.relative(root,location).split(path.sep).join('/');
      const before=await fs.promises.lstat(location,{bigint:true});
      if(before.isSymbolicLink())fail('ARCA_RECYCLE_SYMLINK');
      if(before.isDirectory()){rows.push({relativePath,kind:'directory'});await walk(location);continue;}
      if(!before.isFile())fail('ARCA_RECYCLE_SPECIAL_FILE');
      total+=Number(before.size);if(total>512*1024*1024)fail('ARCA_RECYCLE_SCOPE_TOO_LARGE');
      const digest=await sha(location),after=await fs.promises.lstat(location,{bigint:true});
      if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs)fail('ARCA_RECYCLE_SOURCE_CHANGED');
      rows.push({relativePath,kind:'file',sizeBytes:Number(before.size),sha256:digest,inode:String(before.ino),mtimeNs:String(before.mtimeNs)});
    }
  }
  if(!(await fs.promises.lstat(root)).isDirectory())fail('ARCA_RECYCLE_NOT_DIRECTORY');
  await walk(root);return Object.freeze({version:1,entries:rows.sort((a,b)=>a.relativePath.localeCompare(b.relativePath)),totalBytes:total});
}
function content(manifest){return manifest.entries.map(({relativePath,kind,sizeBytes,sha256})=>({relativePath,kind,...(kind==='file'?{sizeBytes,sha256}:{})}));}
async function verify(root,manifest){const actual=await snapshot(root);if(canonicalDigest(content(actual))!==canonicalDigest(content(manifest)))fail('ARCA_RECYCLE_CONTENT_CHANGED');return actual;}
function member(root,relative){const target=path.resolve(root,...relative.split('/'));if(!relative||!inside(root,target)||target===path.resolve(root))fail('ARCA_RECYCLE_PATH_ESCAPE');return target;}

async function copyResumable(source,target,expectedSize){
  const input=await fs.promises.open(source,'r');let output;
  try{
    const exists=await present(target);output=await fs.promises.open(target,exists?'r+':'wx');
    const stat=await output.stat();if(!stat.isFile()||stat.size>expectedSize)fail('ARCA_RECYCLE_COPY_CONFLICT');
    const sourceBytes=Buffer.alloc(1024*1024),targetBytes=Buffer.alloc(1024*1024);let offset=0;
    // Continue only a byte-for-byte prefix of this exact source, never truncate
    // a conflicting target left by another writer.
    while(offset<stat.size){const length=Math.min(sourceBytes.length,stat.size-offset);
      const a=await input.read(sourceBytes,0,length,offset),b=await output.read(targetBytes,0,length,offset);
      if(a.bytesRead!==length||b.bytesRead!==length||!sourceBytes.subarray(0,length).equals(targetBytes.subarray(0,length)))fail('ARCA_RECYCLE_COPY_CONFLICT');offset+=length;}
    while(offset<expectedSize){const length=Math.min(sourceBytes.length,expectedSize-offset),read=await input.read(sourceBytes,0,length,offset);
      if(read.bytesRead!==length)fail('ARCA_RECYCLE_SOURCE_CHANGED');let written=0;
      while(written<length){const result=await output.write(sourceBytes,written,length-written,offset+written);if(!result.bytesWritten)fail('ARCA_RECYCLE_COPY_FAILED');written+=result.bytesWritten;}
      offset+=length;
    }
    await output.sync();
  }finally{await output?.close();await input.close();}
}

async function removeExact(root,manifest){
  // Recovery may see an already removed prefix, but never an added or changed member.
  const remaining=await snapshot(root),expected=new Map(content(manifest).map(row=>[row.relativePath,row]));
  for(const row of content(remaining))if(canonicalDigest(row)!==canonicalDigest(expected.get(row.relativePath)||null))fail('ARCA_RECYCLE_CONTENT_CHANGED');
  for(const row of remaining.entries.filter(row=>row.kind==='file')){
    const location=member(root,row.relativePath);await noLinks(location);
    if(await sha(location)!==row.sha256)fail('ARCA_RECYCLE_CONTENT_CHANGED');
    await fs.promises.unlink(location);
  }
  for(const row of remaining.entries.filter(row=>row.kind==='directory').sort((a,b)=>b.relativePath.length-a.relativePath.length))await fs.promises.rmdir(member(root,row.relativePath));
  await fs.promises.rmdir(root);
}

async function moveExact(source,target,manifest,options={}){
  await noLinks(source);await noLinks(target);
  const hasSource=await present(source),hasTarget=await present(target);
  if(!hasSource){if(!hasTarget)fail('ARCA_RECYCLE_BOTH_LOCATIONS_MISSING');await verify(target,manifest);return;}
  if(hasTarget){
    // Only a durable operation may resume an exact previously copied target.
    if(!options.resume)fail('ARCA_RECYCLE_TARGET_EXISTS');
    await verify(target,manifest);await removeExact(source,manifest);return;
  }
  await verify(source,manifest);
  await fs.promises.mkdir(path.dirname(target),{recursive:true});
  try{
    if(options.forceCopy)throw Object.assign(new Error('Cross volume fixture'),{code:'EXDEV'});
    await fs.promises.rename(source,target);
    await verify(target,manifest);
    options.afterMove?.();return;
  }catch(error){if(error.code!=='EXDEV')throw error;}
  const staging=target+'.copying';
  if(!await present(staging))await fs.promises.mkdir(staging);
  await noLinks(staging);
  for(const row of manifest.entries){
    const from=member(source,row.relativePath),to=member(staging,row.relativePath);
    await noLinks(to);
    if(row.kind==='directory'){await fs.promises.mkdir(to,{recursive:true});continue;}
    await fs.promises.mkdir(path.dirname(to),{recursive:true});
    await copyResumable(from,to,row.sizeBytes);
  }
  await verify(staging,manifest);await verify(source,manifest);
  if(await present(target))fail('ARCA_RECYCLE_TARGET_EXISTS');
  await fs.promises.rename(staging,target);
  options.afterCopy?.();
  await removeExact(source,manifest);
}

function createRecycleEffectPort(options){
  const columns=['effect_id','event_attempt_id','effect_class','idempotency_key','intent_digest','state','external_receipt_ref','output_digest','verified_at_ms','updated_at_ms'];
  const repo=createRepositoryDefinition({repositoryId:'arca_recycle_effect',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'fx_effect_journal',columns,keyColumns:['effect_id'],safeIntegers:true},
    insert:{kind:'insert',tableId:'fx_effect_journal',columns},
    complete:{kind:'update',tableId:'fx_effect_journal',setColumns:['state','external_receipt_ref','output_digest','verified_at_ms','updated_at_ms'],keyColumns:['effect_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
  }});
  const execute=fn=>options.unitOfWork.execute([{participantId:'arca_recycle_effect',owner:'execution-foundation',repositories:[repo],execute:ctx=>fn(ctx.repository(repo.repositoryId),ctx.commitTimeMs)}]).arca_recycle_effect;
  return Object.freeze({async apply(row){
    if(canonicalDigest(row.manifest)!==row.manifest_digest)fail('ARCA_RECYCLE_MANIFEST_CHANGED');
    const kind={moving:'move',restoring:'restore',purging:'purge'}[row.state];if(!kind)fail('ARCA_RECYCLE_OPERATION_INVALID');
    const intent={id:row.recycle_entry_id,revision:row.operation_revision,kind,source:row.source_location,target:row.archive_location,manifestDigest:row.manifest_digest};
    const intentDigest=canonicalDigest(intent),effectId=canonicalDigest({class:'arca_recycle_'+kind,intentDigest});
    const prior=execute((r,at)=>{const prior=r.invoke('find',{effect_id:effectId});if(prior)return prior;
      r.invoke('insert',{effect_id:effectId,event_attempt_id:null,effect_class:'arca_recycle_'+kind,idempotency_key:effectId,intent_digest:intentDigest,state:'intended',external_receipt_ref:null,output_digest:null,verified_at_ms:null,updated_at_ms:at});return null;});
    if(prior?.intent_digest&&prior.intent_digest!==intentDigest)fail('ARCA_RECYCLE_EFFECT_CONFLICT');
    if(prior?.state==='committed')return;
    if(kind==='purge'){
      if(await present(row.archive_location))await removeExact(row.archive_location,row.manifest);
    }else await moveExact(kind==='move'?row.source_location:row.archive_location,kind==='move'?row.archive_location:row.source_location,row.manifest,{resume:Boolean(prior),...options.testHooks});
    execute((r,at)=>{const result=r.invoke('complete',{effect_id:effectId,state:'committed',external_receipt_ref:'arca-recycle:'+row.recycle_entry_id,output_digest:canonicalDigest({intentDigest,result:'completed'}),verified_at_ms:at,updated_at_ms:at,expected_state:'intended'});if(result.changes!==1)fail('ARCA_RECYCLE_EFFECT_CONFLICT');});
  }});
}
module.exports=Object.freeze({createRecycleEffectPort,snapshot,verify,moveExact,removeExact,inside,present,noLinks,emptyDirectory});
