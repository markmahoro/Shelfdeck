'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createRetiredFieldControlStore}=require('../../src/helix/domains/procurement/persistence/retired-field-control-store');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'))),schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
test('retired Field release preserves active selections, deliveries and the complete transaction on a crash',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-retired-control-')),databasePath=path.join(root,'test.db');
 const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl}),unitOfWork=createSqliteUnitOfWork({kernel}),db=new Database(databasePath);
 try{
   db.pragma('foreign_keys=OFF');
   const identity={mountScopeId:'mount',inode:'99',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:'a'.repeat(64)},
     key=canonicalDigest({schema:'physical-material-identity@2',...identity});
   db.prepare("INSERT INTO proc_material_fields (field_id,status) VALUES ('field','active')").run();
   db.prepare('INSERT INTO proc_field_materials (field_id,material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint) VALUES (?,?,?,?,?,?,?,?)')
     .run('field',key,identity.mountScopeId,identity.inode,100,identity.fingerprintAlgorithm,1,identity.contentFingerprint);
   db.prepare('INSERT INTO fx_material_controls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,identity.mountScopeId,identity.inode,100,identity.fingerprintAlgorithm,1,identity.contentFingerprint,'procurement','material_field','field',1,'controlled',1);
   const options={schemaManifest,unitOfWork},store=createRetiredFieldControlStore(options);
   assert.equal(store.reconcile('field').kind,'idle','active source keeps its control');
   db.prepare("UPDATE proc_material_fields SET status='deregistered'").run();
   db.prepare("INSERT INTO proc_procurement_runs (procurement_run_id,field_id,state,state_revision) VALUES ('run','field','active',1)").run();
   db.prepare("INSERT INTO proc_run_materials (procurement_run_id,ordinal,material_key,selection_state) VALUES ('run',0,?,'run_selection')").run(key);
   assert.equal(store.reconcile('field').kind,'idle');
   db.prepare("UPDATE proc_procurement_runs SET state='sealed'").run();
   db.prepare("UPDATE proc_run_materials SET selection_state='released',candidate_package_id='package'").run();
   db.prepare("INSERT INTO proc_candidate_deliveries (candidate_package_id,offer_id,state) VALUES ('package','offer','open')").run();
   assert.equal(store.reconcile('field').kind,'idle');
   db.prepare("UPDATE proc_candidate_deliveries SET state='rejected'").run();
   const crashing={execute(participants){return unitOfWork.execute(participants.map(p=>p.participantId!=='commit_foundation'?p:
     {...p,execute(context){p.execute(context);throw new Error('retirement-crash');}}));}};
   assert.throws(()=>createRetiredFieldControlStore({...options,unitOfWork:crashing}).reconcile('field'),/retirement-crash/);
   assert.equal(db.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
   assert.equal(db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
   assert.equal(store.reconcile('field').releasedCount,1);
   assert.equal(createRetiredFieldControlStore(options).reconcile('field').kind,'idle');
   assert.equal(db.prepare('SELECT state FROM fx_material_controls').get().state,'released');
   assert.equal(db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,1);
 }finally{db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
