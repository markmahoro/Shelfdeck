'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');
const {createBackup,initializeCleanData,inspectReadiness,restoreBackup,verifyBackup}=require('../../scripts/helix-operational-safety');
const secretRoot='p13-test-secret-root-0123456789abcdef';
const roots=[];const root=()=>{const value=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p13-'));roots.push(value);return value;};test.after(()=>roots.forEach((value)=>fs.rmSync(value,{recursive:true,force:true})));
test('clean initialization rejects missing confirmation and backs up old bytes before replacement',()=>{const r=root(),data=path.join(r,'data'),backup=path.join(r,'backup');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'legacy.json'),'legacy');assert.throws(()=>initializeCleanData({dataDir:data,backupDir:backup,confirmation:'wrong'}),/CONFIRMATION/);const result=initializeCleanData({dataDir:data,backupDir:backup,confirmation:'INITIALIZE_HELIX_CLEAN_V1',now:()=>1700000000000,secretRoot});assert.equal(result.generation,'helix-clean-v3');assert.equal(result.tableCount,242);assert.match(result.adminApiKey,/^sd_/);assert.equal(verifyBackup(backup).files[0].path,'legacy.json');assert.equal(fs.existsSync(path.join(data,'legacy.json')),false);assert.equal(fs.existsSync(path.join(data,'shelfdeck.db')),true);});
test('backup digest tampering is rejected and restore never overwrites a non-empty target',()=>{const r=root(),source=path.join(r,'source'),backup=path.join(r,'backup'),target=path.join(r,'target');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'a.txt'),'alpha');createBackup({sourceDir:source,backupDir:backup,createdAt:'2026-07-23T00:00:00Z'});fs.mkdirSync(target);fs.writeFileSync(path.join(target,'keep.txt'),'keep');assert.throws(()=>restoreBackup({backupDir:backup,targetDir:target}),/NOT_EMPTY/);fs.rmSync(target,{recursive:true});const restored=restoreBackup({backupDir:backup,targetDir:target});assert.equal(restored.fileCount,1);fs.writeFileSync(path.join(backup,'a.txt'),'tampered');assert.throws(()=>verifyBackup(backup),/DIGEST_MISMATCH/);});

test('large backup verification and restoration preserve exact bytes within bounded process memory', {timeout:120000},()=>{
  const r=root(),source=path.join(r,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'credential.bin'),'private-fixture-bytes');
  const descriptor=fs.openSync(path.join(source,'large.bin'),'wx'),size=256*1024*1024;
  try{fs.ftruncateSync(descriptor,size);fs.writeSync(descriptor,Buffer.from([127]),0,1,size-1);}finally{fs.closeSync(descriptor);}
  const chunk=Buffer.alloc(1024*1024),hash=require('node:crypto').createHash('sha256');for(let index=0;index<255;index++)hash.update(chunk);chunk[chunk.length-1]=127;hash.update(chunk);
  const child=require('node:child_process').spawnSync(process.execPath,['--max-old-space-size=128',path.join(__dirname,'fixtures/large-operational-backup.js'),r,hash.digest('hex')],
    {encoding:'utf8',windowsHide:true,timeout:110000,maxBuffer:32768});
  assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(JSON.parse(child.stdout).restored,true);
});

test('backup evidence refuses a file modified while it is being hashed',()=>{
  const r=root(),location=path.join(r,'changing.bin');fs.writeFileSync(location,Buffer.alloc(2*1024*1024));
  const read=fs.readSync;let changed=false;
  fs.readSync=function(descriptor,...args){const result=read.call(fs,descriptor,...args);if(!changed&&result>0){changed=true;fs.writeFileSync(location,Buffer.alloc(2*1024*1024,1));}return result;};
  try{assert.throws(()=>require('../../scripts/helix-operational-safety').files(r),/P13_BACKUP_FILE_CHANGED/);}finally{fs.readSync=read;}
});
test('readiness accepts only clean DB, authenticated credential and built Admin surface',()=>{const r=root(),data=path.join(r,'data'),admin=path.join(r,'admin');initializeCleanData({dataDir:data,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});assert.equal(inspectReadiness({dataDir:data,adminDistDir:admin,secretRoot}).state,'not_ready');fs.mkdirSync(admin);fs.writeFileSync(path.join(admin,'index.html'),'<!doctype html>');const ready=inspectReadiness({dataDir:data,adminDistDir:admin,secretRoot});assert.equal(ready.state,'ready');assert.deepEqual({tables:ready.tableCount,routes:ready.routeCount,surfaces:ready.uiSurfaceCount},{tables:242,routes:167,surfaces:17});assert.equal(inspectReadiness({dataDir:data,adminDistDir:admin,secretRoot:'wrong-secret-root-that-is-still-long-enough'}).state,'not_ready');});
test('P13 sources contain no legacy state import, compatibility or dual path',()=>{for(const file of ['scripts/helix-clean-init.js','scripts/helix-operational-safety.js','src/helix/composition/createHelixApplication.js']){const source=fs.readFileSync(path.join(__dirname,'../../',file),'utf8');assert.doesNotMatch(source,/helixCleanState|legacy runtime fallback|dual[-_ ]?(read|write|run)|src\/app/i,file);}});
