'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCleanServiceHost}=require('../../../src/clean-service-host');
const {createJavHostTransport}=require('./jav-host-transport');
const [dataDir,adminDistDir,picturePath,correctionId,mode,titleMode]=process.argv.slice(2),root=path.dirname(path.resolve(dataDir));
if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('helix-jav-host-')||
    !/^arca-jav-correction-[a-f0-9]{40}$/.test(correctionId))throw new Error('Process-loss fixture escaped its temporary scope.');
const target=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','nfo','movie.nfo'),write=fs.writeFileSync,link=fs.linkSync,open=fs.openSync;
let producerDescriptor=null;
if(mode==='cleanup_uncommitted'){
  const Database=require('better-sqlite3'),prepare=Database.prototype.prepare;
  Database.prototype.prepare=function(sql,...args){const statement=prepare.call(this,sql,...args);
    if(/INSERT INTO\s+"arca_jav_correction_directory_checks"/i.test(sql)){const database=this,run=statement.run;
      statement.run=function(...values){const value=run.apply(statement,values);
        if(database.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId)?.cleanup_state==='completed')process.exit(72);
        return value;};}
    return statement;};
}
if(mode==='commit_uncommitted'||mode==='workspace_reclaim_rollback') {
  const Database=require('better-sqlite3'),prepare=Database.prototype.prepare;
  Database.prototype.prepare=function(sql,...args){const statement=prepare.call(this,sql,...args);
    if(/INSERT INTO\s+"fx_event_result_bindings"/i.test(sql)) {
      const database=this,run=statement.run;
      statement.run=function(...values){const result=run.apply(statement,values);
        if(mode==='commit_uncommitted'&&database.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId)?.state==='committed'||
          mode==='workspace_reclaim_rollback'&&database.prepare('SELECT state FROM fx_workspace_registry WHERE workspace_id=?').get(correctionId+'-assets')?.state==='reclaimed')process.exit(72);
        return result;};
    }return statement;};
}
if(mode==='commit_admitted'||mode==='commit_bound'||mode==='workspace_reclaim_commit'||mode==='cleanup_committed') {
  const Database=require('better-sqlite3'),exec=Database.prototype.exec;
  Database.prototype.exec=function(sql,...args){const result=exec.call(this,sql,...args);
    if(/^\s*COMMIT\b/i.test(sql)) {
      const exists=this.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fx_supporting_works'").get();
      if(exists){const work=this.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_commit'").get(correctionId);
        if(work&&mode==='commit_admitted')process.exit(72);
        if(work&&mode==='commit_bound'&&this.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId)?.state==='committed')process.exit(72);
        if(mode==='workspace_reclaim_commit'&&this.prepare('SELECT state FROM fx_workspace_registry WHERE workspace_id=?').get(correctionId+'-assets')?.state==='reclaimed')process.exit(72);}
      if(mode==='cleanup_committed'&&this.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId)?.cleanup_state==='completed')process.exit(72);
    }return result;};
}
fs.openSync=function(location,...args){const descriptor=open.call(fs,location,...args);
  if(typeof location==='string'&&path.dirname(path.resolve(location))===path.dirname(path.resolve(target))&&path.basename(location).startsWith('.shelfdeck-writing-'))producerDescriptor=descriptor;
  return descriptor;};
fs.writeFileSync=function(location,...args){if(mode==='partial'&&location===producerDescriptor){write.call(fs,location,args[0].subarray(0,Math.floor(args[0].length/2)));fs.fsyncSync(location);process.exit(72);}
  return write.call(fs,location,...args);};
fs.linkSync=function(source,location,...args){const result=link.call(fs,source,location,...args);
  if(['published','partial'].includes(mode)&&path.resolve(String(location))===path.resolve(target)||mode==='stage'&&
      path.basename(path.dirname(location))==='.shelfdeck-'+correctionId+'-stage'&&path.basename(location).startsWith('0003-'))process.exit(72);
  return result;};
const unlink=fs.unlinkSync;
fs.unlinkSync=function(location,...args){const value=unlink.call(fs,location,...args);if(mode==='retirement'&&path.basename(String(location)).startsWith('.shelfdeck-'+correctionId+'-0000-retained')||
  mode==='workspace_reclaim'&&path.resolve(String(location))===path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','metadata','metadata.json'))process.exit(72);return value;};
const copy=fs.promises.copyFile;
fs.promises.copyFile=async function(source,location,...args){const result=await copy.call(fs.promises,source,location,...args);
  if(mode==='stage'&&path.basename(path.dirname(location))==='.shelfdeck-'+correctionId+'-stage'&&path.basename(location).startsWith('0003-'))process.exit(72);
  return result;};
const timer=setTimeout(()=>{
  const database=new (require('better-sqlite3'))(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try {
    process.stderr.write(JSON.stringify({works:database.prepare('SELECT work_kind,state FROM fx_supporting_works WHERE process_id=?').all(correctionId),
      events:database.prepare('SELECT capability_ref,state FROM fx_workflow_events WHERE work_id IN (SELECT work_id FROM fx_supporting_works WHERE process_id=?)').all(correctionId),
      stageFiles:database.prepare('SELECT target_root_location FROM arca_shelves').all().map(row=>{
        const directory=path.join(row.target_root_location,'.shelfdeck-'+correctionId+'-stage');return fs.existsSync(directory)?fs.readdirSync(directory):[];})}));
  } finally {database.close();}process.exit(74);
},40000);
createCleanServiceHost({dataDir,adminDistDir,secretRoot:'jav-host-fixture-root-0123456789abcdef0123456789',
  integrationFetch:createJavHostTransport(fs.readFileSync(picturePath),[],titleMode==='overlap'),onExecutionRuntimeError:error=>{process.stderr.write(error.code+': '+error.message);process.exit(73);}})
  .catch(error=>{clearTimeout(timer);process.stderr.write(error.code+': '+error.message);process.exit(73);});
