'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {SOURCE_DIGEST,TARGET_DIGEST,inspectLifecycleSchemaSource,prepareLifecycleSchemaCopy}=require('../../scripts/helix-architecture/lifecycle-schema-copy');
const archive=path.resolve(__dirname,'../../src/helix/foundation/persistence/release-schemas');
const schema=digest=>({schemaDdl:zlib.gunzipSync(fs.readFileSync(path.join(archive,digest+'.sql.gz'))).toString('utf8'),schemaManifest:JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(archive,digest+'.manifest.json.gz'))))});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('lifecycle upgrade preserves all existing tables and rollback preserves changes made after upgrade',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-lifecycle-schema-')),sourcePath=path.join(root,'old.db'),targetPath=path.join(root,'new.db');
 try{
   openSqliteKernel({Database,databasePath:sourcePath,...schema(SOURCE_DIGEST)}).close();
   const seed=new Database(sourcePath);seed.prepare("INSERT INTO libra_subjects (subject_id,status) VALUES ('subject','active')").run();seed.pragma('journal_mode=DELETE');seed.close();
   const before=hash(sourcePath);assert.equal(inspectLifecycleSchemaSource({Database,sourcePath}).eligible,true);
   const result=prepareLifecycleSchemaCopy({Database,sourcePath,targetPath});assert.equal(result.copiedTableCount,223);assert.equal(hash(sourcePath),before);
   assert.throws(()=>prepareLifecycleSchemaCopy({Database,sourcePath,targetPath}),{code:'LIFECYCLE_SCHEMA_TARGET_EXISTS'});
   openSqliteKernel({Database,databasePath:targetPath,...schema(TARGET_DIGEST)}).close();
   const used=new Database(targetPath);used.prepare("INSERT INTO libra_subjects (subject_id,status) VALUES ('after-upgrade','active')").run();used.pragma('journal_mode=DELETE');used.close();
   const rollbackPath=path.join(root,'rollback.db');prepareLifecycleSchemaCopy({Database,sourcePath:targetPath,targetPath:rollbackPath,rollback:true});
   openSqliteKernel({Database,databasePath:rollbackPath,...schema(SOURCE_DIGEST)}).close();
   const rollback=new Database(rollbackPath,{readonly:true});assert.equal(rollback.prepare('SELECT count(*) n FROM libra_subjects').get().n,2);rollback.close();
   const changed=new Database(targetPath);changed.prepare("INSERT INTO libra_task_cancellations (cancellation_id,subject_id,state,request_json,request_digest) VALUES ('cancel','subject','pending','{}',?)").run('a'.repeat(64));changed.pragma('journal_mode=DELETE');changed.close();
   const protectedHash=hash(targetPath),refusedPath=path.join(root,'refused.db');
   assert.throws(()=>prepareLifecycleSchemaCopy({Database,sourcePath:targetPath,targetPath:refusedPath,rollback:true}),{code:'LIFECYCLE_SCHEMA_ROLLBACK_NEW_FACTS'});
   assert.equal(fs.existsSync(refusedPath),false);assert.equal(hash(targetPath),protectedHash);
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});
