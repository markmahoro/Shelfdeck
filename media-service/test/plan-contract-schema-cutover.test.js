'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const service=process.env.SHELFDECK_SERVICE_ROOT||path.resolve(__dirname,'..');
const Database=require(path.join(service,'node_modules/better-sqlite3'));
const {openSqliteKernel}=require(path.join(service,'src/helix/foundation/persistence/sqlite-kernel'));
const {schemas}=require(path.join(service,'scripts/helix-architecture/formation-retirement-schema-copy'));
const {preparePlanContractSchemaCopy}=require(path.join(service,'scripts/helix-architecture/plan-contract-schema-copy'));
const targetSchema={schemaManifest:require(path.join(service,'src/helix/foundation/persistence/generated/clean-schema.manifest.json')),schemaDdl:fs.readFileSync(path.join(service,'src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')};
const copy=options=>preparePlanContractSchemaCopy({...options,sourceSchema:schemas().target,targetSchema});
const {publishPreparedDatabase:publish}=require('../scripts/helix-plan-contract-cutover');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'formation-cutover-')),seed=path.join(root,'seed.sqlite'),dataDir=path.join(root,'data'),preparedDir=path.join(root,'prepared');
 fs.mkdirSync(dataDir);fs.mkdirSync(preparedDir);fs.mkdirSync(path.join(dataDir,'operator-runtime'));
 fs.writeFileSync(path.join(dataDir,'operator-runtime/intent.json'),JSON.stringify({schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',pendingReset:null}));
 openSqliteKernel({Database,databasePath:seed,...schemas().target}).close();
 const db=new Database(seed);db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');
 db.prepare("INSERT INTO libra_subjects(subject_id,status,structure_kind,content_profile,intake_revision,created_at_ms,updated_at_ms) VALUES ('subject','active','single','movie',1,1,1)").run();
 const source=path.join(preparedDir,'source.sqlite');await db.backup(source);
 for(const suffix of ['', '-wal','-shm'])if(fs.existsSync(seed+suffix))fs.copyFileSync(seed+suffix,path.join(dataDir,'shelfdeck.db'+suffix));
 assert.ok(fs.statSync(path.join(dataDir,'shelfdeck.db-wal')).size>0);db.close();
 const consistent=new Database(source);consistent.pragma('journal_mode=DELETE');consistent.close();
 const receipt=copy({Database,sourcePath:source,targetPath:path.join(preparedDir,'prepared.sqlite')});
 fs.writeFileSync(path.join(preparedDir,'copy-receipt.json'),JSON.stringify(receipt));
 const files=['shelfdeck.db','shelfdeck.db-wal','shelfdeck.db-shm'].filter(n=>fs.existsSync(path.join(dataDir,n))).map(name=>({name,bytes:fs.statSync(path.join(dataDir,name)).size,sha256:hash(path.join(dataDir,name))}));
 fs.writeFileSync(path.join(preparedDir,'source-files.json'),JSON.stringify({schema:'shelfdeck.frozen-sqlite-files@1',snapshotSha256:hash(source),files}));
 return {root,dataDir,preparedDir,Database,files,close(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('exact physical WAL source stays unchanged during preview and all committed facts survive atomic cutover',async()=>{const f=await fixture();try{
 const dry=await publish(f);assert.equal(dry.applied,false);for(const v of f.files)assert.equal(hash(path.join(f.dataDir,v.name)),v.sha256);
 const result=await publish({...f,apply:true});assert.equal(result.installed,true);
 for(const v of f.files.filter(v=>v.name!=='shelfdeck.db'))assert.equal(hash(path.join(f.preparedDir,'retained-source'+v.name.slice(12))),v.sha256);
 const db=new Database(path.join(f.dataDir,'shelfdeck.db'),{readonly:true});assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,1);db.close();
 assert.equal((await publish({...f,apply:true})).recovered,true);
 }finally{f.close();}});
test('cutover resumes after target rename without replaying or losing the frozen WAL',async()=>{const f=await fixture();try{
 await assert.rejects(publish({...f,apply:true,afterRename(){throw Error('crash');}}),/crash/);
 assert.equal((await publish({...f,apply:true})).recovered,true);
 }finally{f.close();}});
test('cutover resumes after old WAL was retained and before target rename',async()=>{const f=await fixture();try{
 const plan=await publish(f);fs.writeFileSync(path.join(f.preparedDir,'cutover.json'),JSON.stringify(plan));
 fs.renameSync(path.join(f.dataDir,'shelfdeck.db-wal'),path.join(f.preparedDir,'retained-source-wal'));
 assert.equal((await publish({...f,apply:true})).installed,true);
 }finally{f.close();}});
test('changed physical WAL refuses cutover before any file is retired',async()=>{const f=await fixture();try{
 fs.appendFileSync(path.join(f.dataDir,'shelfdeck.db-wal'),'drift');await assert.rejects(publish({...f,apply:true}),{code:'CUTOVER_SOURCE_DRIFT'});
 assert.equal(fs.existsSync(path.join(f.preparedDir,'cutover.json')),false);
 }finally{f.close();}});
test('missing captured WAL refuses cutover',async()=>{const f=await fixture();try{
 fs.renameSync(path.join(f.dataDir,'shelfdeck.db-wal'),path.join(f.root,'unavailable-wal'));await assert.rejects(publish({...f,apply:true}),{code:'CUTOVER_SOURCE_FILE_SET_DRIFT'});
 }finally{f.close();}});
test('changed protected fact proof refuses cutover',async()=>{const f=await fixture();try{
 const p=path.join(f.preparedDir,'copy-receipt.json'),v=JSON.parse(fs.readFileSync(p));v.tables[0].digest='0'.repeat(64);fs.writeFileSync(p,JSON.stringify(v));
 await assert.rejects(publish({...f,apply:true}),{code:'CONTRACT_COPY_PROTECTED_FACT_DRIFT'});
 }finally{f.close();}});

test('running intent refuses evidence cutover',async()=>{const f=await fixture();try{
 fs.writeFileSync(path.join(f.dataDir,'operator-runtime/intent.json'),JSON.stringify({schema:'shelfdeck.runtime-intent@1',desiredMode:'running',pendingReset:null}));
 await assert.rejects(publish({...f,apply:true}),{code:'CUTOVER_STOPPED_INTENT_REQUIRED'});
 }finally{f.close();}});
