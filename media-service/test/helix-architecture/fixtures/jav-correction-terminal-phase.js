'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Database=require('better-sqlite3');
const {createCleanServiceHost}=require('../../../src/clean-service-host');
const {createJavHostTransport}=require('./jav-host-transport');
const [dataDir,adminDistDir,picturePath,correctionId,phase,receiptPath]=process.argv.slice(2),root=path.dirname(path.resolve(dataDir));
if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('helix-jav-host-')||
    !/^arca-jav-correction-[a-f0-9]{40}$/.test(correctionId)||path.dirname(path.resolve(receiptPath))!==root||
    !['stage','publish','verify','commit','producer'].includes(phase))throw new Error('Terminal phase fixture escaped its temporary scope.');
const target=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','nfo','movie.nfo'),write=fs.writeFileSync,open=fs.openSync,
  copy=fs.promises.copyFile,link=fs.linkSync,exec=Database.prototype.exec;
let injected=false,producerDescriptor=null;
function save(value){write.call(fs,receiptPath,JSON.stringify({phase,...value}));injected=true;}
function injectedError(){return Object.assign(new Error('Injected local test file conflict.'),{code:'ARCA_JAV_CORRECTION_TARGET_CONFLICT'});}
fs.promises.copyFile=async function(source,destination,...args){const result=await copy.call(fs.promises,source,destination,...args);
  if(phase==='stage'&&!injected&&path.basename(path.dirname(destination))==='.shelfdeck-'+correctionId+'-stage'&&path.resolve(source)===path.resolve(target)){
    const bytes=fs.readFileSync(destination);bytes[0]^=1;write.call(fs,destination,bytes);save({foreignPath:destination,restoreFromPath:source,restoreAction:'copy'});throw injectedError();
  }return result;};
fs.linkSync=function(source,destination,...args){const result=link.call(fs,source,destination,...args);
  if(phase==='publish'&&!injected&&path.basename(path.dirname(source))==='.shelfdeck-'+correctionId+'-stage'&&
      path.basename(path.dirname(destination))!=='.shelfdeck-'+correctionId+'-stage'){
    const foreignPath=path.join(path.dirname(destination),'fixture-recovery-blocker');write.call(fs,foreignPath,'fixture recovery blocker');
    save({foreignPath,restoreAction:'remove'});throw injectedError();
  }return result;};
fs.openSync=function(location,...args){const descriptor=open.call(fs,location,...args);
  if(phase==='producer'&&typeof location==='string'&&path.dirname(path.resolve(location))===path.dirname(target)&&path.basename(location).startsWith('.shelfdeck-writing-'))producerDescriptor=descriptor;
  return descriptor;};
fs.writeFileSync=function(location,...args){
  if(phase==='producer'&&!injected&&location===producerDescriptor){write.call(fs,location,args[0].subarray(0,Math.floor(args[0].length/2)));fs.fsyncSync(location);
    write.call(fs,target,'fixture producer blocker');save({foreignPath:target,restoreAction:'remove'});throw injectedError();
  }return write.call(fs,location,...args);};
Database.prototype.exec=function(sql,...args){const result=exec.call(this,sql,...args);
  if(!injected&&['verify','commit'].includes(phase)&&/^\s*COMMIT\b/i.test(sql)&&
      this.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fx_supporting_works'").get()){
    const work=this.prepare('SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind=?').get(correctionId,'jav_correction_'+phase);
    if(work){const proof=JSON.parse(this.prepare('SELECT preview_proof_json FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).preview_proof_json),
      member=proof.paths.find(member=>member.role==='metadata_sidecar'),manifest=JSON.parse(this.prepare('SELECT manifest_json FROM arca_staged_manifest_records WHERE process_type=? AND process_id=?').get('arca_jav_identity_correction',correctionId).manifest_json),
      staged=manifest.stagedMembers.find(member=>member.role==='metadata_sidecar');
      fs.unlinkSync(member.targetLocation);write.call(fs,member.targetLocation,'fixture final nfo blocker');save({foreignPath:member.targetLocation,restoreFromPath:staged.location,restoreAction:'link'});
    }
  }return result;};
const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true}),errors=[];
const poll=setInterval(()=>{
  const current=database.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId);
  if(injected&&current.state==='attention_required'){
    const effects=database.prepare('SELECT j.state FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.work_id IN (SELECT work_id FROM fx_supporting_works WHERE process_id=?)').all(correctionId);
    if(effects.every(effect=>['committed','failed'].includes(effect.state))){clearInterval(poll);database.close();process.exit(72);}
  }
},100);
setTimeout(()=>{process.stderr.write(JSON.stringify({injected,errors,works:database.prepare('SELECT work_kind,state FROM fx_supporting_works WHERE process_id=?').all(correctionId),
  events:database.prepare('SELECT capability_ref,state FROM fx_workflow_events WHERE work_id IN (SELECT work_id FROM fx_supporting_works WHERE process_id=?)').all(correctionId)}));process.exit(74);},55000);
createCleanServiceHost({dataDir,adminDistDir,secretRoot:'jav-host-fixture-root-0123456789abcdef0123456789',integrationFetch:createJavHostTransport(fs.readFileSync(picturePath)),
  onExecutionRuntimeError:error=>errors.push({code:error.code,message:error.message})}).catch(error=>{process.stderr.write(error.code+': '+error.message);process.exit(73);});
