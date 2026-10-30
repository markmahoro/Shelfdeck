'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MEMBER_NAMES,assertGeneration,createGeneration}=require('../contracts/face-catalogue-generation');
const INSTALL_FAILED='US_ADULT_CATALOGUE_INSTALL_FAILED';
const INSTALLED_DIRNAME='us-adult-catalogue';
const GENERATION_FILE='generation.json';
function fail(message,details){throw Object.assign(new Error(message),{code:INSTALL_FAILED,details});}
function sha256File(filePath){
  const hash=crypto.createHash('sha256'),fd=fs.openSync(filePath,'r'),buffer=Buffer.alloc(1024*1024);
  try{
    let read;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,read));
  }finally{fs.closeSync(fd);}
  return hash.digest('hex');
}
function installedCatalogueRoot(dataDir){
  if(typeof dataDir!=='string'||!dataDir.trim())fail('An exact ShelfDeck data directory is required for the installed catalogue.');
  return path.resolve(dataDir,INSTALLED_DIRNAME);
}
function isSqliteReadonlyOpenFailure(error){
  const code=typeof error?.code==='string'?error.code:'';
  return code==='SQLITE_CANTOPEN'||code.startsWith('SQLITE_CANTOPEN')||
    code==='SQLITE_READONLY'||code==='SQLITE_READONLY_DIRECTORY'||code.startsWith('SQLITE_READONLY');
}
function readSourceGeneration(sourceRoot){
  const generationPath=path.join(sourceRoot,GENERATION_FILE);
  if(!fs.existsSync(generationPath))fail('The catalogue package is missing generation.json.',{sourceRoot});
  let value;try{value=JSON.parse(fs.readFileSync(generationPath,'utf8'));}catch{fail('The catalogue package generation.json is not valid JSON.',{generationPath});}
  return assertGeneration(value);
}
function assertPackageMembers(sourceRoot,generation){
  for(const member of generation.members){
    const file=path.join(sourceRoot,member.name);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('The catalogue package is missing a required member.',{member:member.name});
    const size=fs.statSync(file).size;
    if(size!==member.bytes)fail('A catalogue package member size does not match its generation.',{member:member.name,bytes:size,expected:member.bytes});
  }
}
function materializePerformersDatabase(Database,sourceDbPath,targetDbPath){
  let workPath=sourceDbPath,tempCopy=null;
  try{
    try{
      const probe=new Database(sourceDbPath,{readonly:true,fileMustExist:true,timeout:1000});
      try{probe.pragma('query_only=ON');probe.prepare('SELECT 1 AS ok FROM sqlite_master LIMIT 1').get();}
      finally{try{probe.close();}catch{}}
    }catch(error){
      if(!isSqliteReadonlyOpenFailure(error))throw error;
      // Install input may still be a RO WAL export. Copy once during install only.
      tempCopy=path.join(fs.realpathSync(os.tmpdir()),`shelfdeck-catalogue-install-${process.pid}-${crypto.randomUUID()}.db`);
      fs.copyFileSync(sourceDbPath,tempCopy);
      workPath=tempCopy;
    }
    // Keep install synchronous: copy the workable DB bytes, then rewrite journal
    // mode to DELETE so the product copy opens without WAL sidecars / RO CANTOPEN.
    fs.copyFileSync(workPath,targetDbPath);
    const installed=new Database(targetDbPath,{timeout:1000});
    try{
      installed.pragma('journal_mode=DELETE');
      try{installed.pragma('wal_checkpoint(TRUNCATE)');}catch{}
      installed.exec('VACUUM');
      installed.prepare('SELECT 1 AS ok FROM sqlite_master LIMIT 1').get();
      const mode=String(installed.pragma('journal_mode',{simple:true})||'').toLowerCase();
      if(mode!=='delete')fail('Installed performers.db must use DELETE journal mode.',{journalMode:mode});
    }finally{try{installed.close();}catch{}}
    for(const suffix of ['-wal','-shm']){
      const sidecar=targetDbPath+suffix;
      if(fs.existsSync(sidecar))fs.unlinkSync(sidecar);
    }
  }finally{
    if(tempCopy)try{fs.unlinkSync(tempCopy);}catch{}
  }
}
function installUsAdultCatalogue({sourceRoot,targetRoot,Database=require('better-sqlite3'),now=Date.now}={}){
  if(typeof sourceRoot!=='string'||!sourceRoot.trim()||typeof targetRoot!=='string'||!targetRoot.trim())
    fail('Catalogue install requires exact source and target roots.');
  const source=path.resolve(sourceRoot),target=path.resolve(targetRoot);
  if(source===target)fail('Catalogue install source and target must differ.');
  if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())fail('The catalogue package root is missing.',{sourceRoot:source});
  const generation=readSourceGeneration(source);
  assertPackageMembers(source,generation);
  const parent=path.dirname(target);
  fs.mkdirSync(parent,{recursive:true});
  const staging=path.join(parent,`.${INSTALLED_DIRNAME}-installing-${process.pid}-${crypto.randomUUID()}`);
  fs.rmSync(staging,{recursive:true,force:true});
  fs.mkdirSync(staging,{recursive:true});
  try{
    for(const name of MEMBER_NAMES){
      if(name==='performers.db')continue;
      fs.copyFileSync(path.join(source,name),path.join(staging,name));
    }
    materializePerformersDatabase(Database,path.join(source,'performers.db'),path.join(staging,'performers.db'));
    const members=MEMBER_NAMES.map(name=>{
      const file=path.join(staging,name),bytes=fs.statSync(file).size,sha256=sha256File(file);
      return {name,bytes,sha256};
    });
    const manifestPath=path.join(staging,'manifest.json');
    const manifest=JSON.stringify({version:generation.datasetVersion,models:{embedding_dim:512},
      checksums:Object.fromEntries(members.map(item=>[item.name,'sha256:'+item.sha256]))});
    fs.writeFileSync(manifestPath,manifest);
    const installedGeneration=createGeneration({datasetVersion:generation.datasetVersion,
      manifestDigest:crypto.createHash('sha256').update(manifest).digest('hex'),members});
    fs.writeFileSync(path.join(staging,GENERATION_FILE),JSON.stringify(installedGeneration,null,2)+'\n');
    // Replace previous install atomically after the new tree is complete.
    const retired=path.join(parent,`.${INSTALLED_DIRNAME}-retired-${process.pid}-${crypto.randomUUID()}`);
    if(fs.existsSync(target))fs.renameSync(target,retired);
    fs.renameSync(staging,target);
    fs.rmSync(retired,{recursive:true,force:true});
    const verify=new Database(path.join(target,'performers.db'),{readonly:true,fileMustExist:true,timeout:1000});
    try{
      verify.pragma('query_only=ON');
      verify.prepare('SELECT 1 AS ok FROM sqlite_master LIMIT 1').get();
    }finally{try{verify.close();}catch{}}
    return Object.freeze({
      targetRoot:target,
      generationDigest:installedGeneration.generationDigest,
      datasetVersion:installedGeneration.datasetVersion,
      installedAtMs:now(),
      journalMode:'delete',
    });
  }catch(error){
    fs.rmSync(staging,{recursive:true,force:true});
    throw error;
  }
}
function catalogueLooksInstalled(root){
  if(typeof root!=='string'||!root.trim())return false;
  const resolved=path.resolve(root);
  return fs.existsSync(path.join(resolved,GENERATION_FILE))&&fs.existsSync(path.join(resolved,'performers.db'))&&
    fs.statSync(resolved).isDirectory();
}
module.exports=Object.freeze({
  INSTALL_FAILED,INSTALLED_DIRNAME,GENERATION_FILE,
  installedCatalogueRoot,installUsAdultCatalogue,catalogueLooksInstalled,readSourceGeneration,
});
