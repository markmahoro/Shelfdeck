'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {SOURCE_DIGEST,TARGET_DIGEST,inspectLibraSchemaSource,prepareLibraSchemaCopy,verifyLibraSchemaRollback}=require('../../scripts/helix-architecture/libra-workshop-schema-copy');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'libra-schema-copy-')),sourcePath=path.join(root,'source.sqlite'),targetPath=path.join(root,'target.sqlite');
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('libra-schema-copy-'));fs.rmSync(root,{recursive:true,force:true});});
 const archive=path.resolve(__dirname,'../../src/helix/foundation/persistence/release-schemas',SOURCE_DIGEST);
 const schema={schemaDdl:zlib.gunzipSync(fs.readFileSync(archive+'.sql.gz')).toString('utf8'),schemaManifest:JSON.parse(zlib.gunzipSync(fs.readFileSync(archive+'.manifest.json.gz')))};
 const kernel=openSqliteKernel({Database,databasePath:sourcePath,...schema});
 kernel.runPrimitive(({prepare})=>{
  for(const [subjectId,runId] of [['protected-s02','protected-run-s02'],['protected-s03','protected-run-s03']]){
   prepare('INSERT INTO libra_subjects(subject_id,structure_kind,status) VALUES(?,?,?)').run(subjectId,'season','active');
   prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state,state_revision,priority_class) VALUES(?,?,?,?,?)').run(runId,subjectId,'active',1,'normal');
   prepare('INSERT INTO libra_predeck_pipeline_tokens(subject_id,source_field_id,source_process_id,acquired_at_ms) VALUES(?,?,?,?)').run(subjectId,'series-source','intake-'+subjectId,1);
  }
  prepare('INSERT INTO arca_shelves(shelf_id,name,status) VALUES(?,?,?)').run('existing-shelf','Retained collection','active');
  prepare('INSERT INTO fx_audit_records(audit_id,owner_domain,occurred_at_ms) VALUES(?,?,?)').run('retained-integer','arca',9223372036854775806n);
  prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state) VALUES(?,?,?,?,?)').run('live-work','libra','libra_run','protected-run-s02','running');
  prepare('INSERT INTO fx_workflow_events(event_id,work_id,state) VALUES(?,?,?)').run('waiting-event','live-work','waiting_for_resource');
  prepare('INSERT INTO fx_resource_defer(event_id,resource_key,queue_class,local_priority,enqueued_at_ms,retry_at_ms,state) VALUES(?,?,?,?,?,?,?)').run('waiting-event','sqlite_write','normal_foreground',100,10,5000,'waiting');
  prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES(?,?,?,?)').run('retained-attempt','waiting-event',1,'completed');
  prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,state) VALUES(?,?,?,?)').run('retained-effect','retained-attempt','workspace_write','reconcile_required');
 });kernel.close();return {root,sourcePath,targetPath,schema};
}

test('204-to-210 copies every existing fact including active Season responsibility and unresolved Effects without touching source bytes',t=>{
 const value=fixture(t),before=hash(value.sourcePath);
 assert.equal(inspectLibraSchemaSource({Database,...value}).eligible,true);
 const result=prepareLibraSchemaCopy({Database,...value});
 assert.equal(result.source.schemaDigest,SOURCE_DIGEST);assert.equal(result.target.schemaDigest,TARGET_DIGEST);
 assert.equal(result.copiedTableCount,203);assert.equal(hash(value.sourcePath),before);
 const db=new Database(value.targetPath,{readonly:true});
 try{
  assert.equal(db.prepare('SELECT count(*) n FROM libra_runs WHERE state=?').get('active').n,2);
  assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get('retained-effect').state,'reconcile_required');
  assert.deepEqual(db.prepare('SELECT local_priority,priority_revision,enqueued_at_ms,retry_at_ms FROM fx_resource_defer').get(),
   {local_priority:100,priority_revision:null,enqueued_at_ms:10,retry_at_ms:5000});
  assert.equal(db.prepare('SELECT occurred_at_ms FROM fx_audit_records').safeIntegers().get().occurred_at_ms,9223372036854775806n);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,0);
 }finally{db.close();}
 assert.deepEqual(verifyLibraSchemaRollback({Database,...value,upgradedPath:value.targetPath}),{eligible:true,verifiedTableCount:203,applied:false});
 const restored=path.join(value.root,'restored.sqlite');fs.copyFileSync(value.sourcePath,restored,fs.constants.COPYFILE_EXCL);
 assert.equal(hash(restored),before);
 const oldKernel=openSqliteKernel({Database,databasePath:restored,...value.schema});oldKernel.close();
});

test('rollback refuses new workshop/fairness facts, refreshed resource metadata, or changed retained facts',t=>{
 const value=fixture(t);prepareLibraSchemaCopy({Database,...value});
 for(const [change,undo] of [
  ["INSERT INTO libra_workshop_policies(policy_id,secondary_seats,policy_revision,updated_at_ms) VALUES('secondary',5,1,1)","DELETE FROM libra_workshop_policies"],
  ["INSERT INTO libra_fairness_clocks(clock_id,turn_sequence,priority_revision) VALUES('production',1,1)","DELETE FROM libra_fairness_clocks"],
  ['UPDATE fx_resource_defer SET priority_revision=2','UPDATE fx_resource_defer SET priority_revision=NULL'],
  ["UPDATE libra_runs SET state_revision=2 WHERE libra_run_id='protected-run-s03'","UPDATE libra_runs SET state_revision=1 WHERE libra_run_id='protected-run-s03'"],
 ]){
  const db=new Database(value.targetPath);db.exec(change);db.close();
  assert.throws(()=>verifyLibraSchemaRollback({Database,...value,upgradedPath:value.targetPath}),{code:'LIBRA_SCHEMA_ROLLBACK_CHANGED_FACTS'});
  const reset=new Database(value.targetPath);reset.exec(undo);reset.close();
 }
});

test('copy refuses overwrites, aliases and changed catalogs; interrupted publication leaves no artifact',t=>{
 const value=fixture(t),before=hash(value.sourcePath);
 assert.throws(()=>prepareLibraSchemaCopy({Database,...value,targetPath:value.sourcePath}),{code:'LIBRA_SCHEMA_TARGET_EXISTS'});
 fs.writeFileSync(value.targetPath,'existing');assert.throws(()=>prepareLibraSchemaCopy({Database,...value}),{code:'LIBRA_SCHEMA_TARGET_EXISTS'});
 assert.equal(fs.readFileSync(value.targetPath,'utf8'),'existing');
 fs.unlinkSync(value.targetPath);
 const alias=path.join(value.root,'alias.sqlite');fs.linkSync(value.sourcePath,alias);
 assert.throws(()=>prepareLibraSchemaCopy({Database,...value}),{code:'LIBRA_SCHEMA_PATH_UNSAFE'});fs.unlinkSync(alias);
 function FailingDatabase(file,options){const db=new Database(file,options),prepare=db.prepare.bind(db);
  if(path.basename(file).startsWith('.libra-schema-preparing-')&&!options?.readonly)db.prepare=sql=>sql.startsWith('INSERT INTO "libra_runs"')?
   {run(){throw Error('injected copy interruption');}}:prepare(sql);return db;}
 assert.throws(()=>prepareLibraSchemaCopy({Database:FailingDatabase,...value}),/injected copy interruption/);
 assert.equal(hash(value.sourcePath),before);assert.equal(fs.existsSync(value.targetPath),false);
 assert.equal(fs.readdirSync(value.root).filter(name=>name.startsWith('.libra-schema-preparing-')).length,0);
 const changed=new Database(value.sourcePath);changed.exec('CREATE TABLE unexpected(value TEXT)');changed.close();
 assert.throws(()=>inspectLibraSchemaSource({Database,...value}),{code:'P3_SQLITE_CATALOG_SHAPE_MISMATCH'});
});
