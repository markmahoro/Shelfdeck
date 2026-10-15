'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {migrateUatIdentitySelectionSchema,PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST,TARGET_SCHEMA_DIGEST}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const schemaManifest=require('../fixtures/helix-historical-ddl/schema-snapshot').historicalSchema('c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d').schemaManifest;
const schemaDdl=require('../fixtures/helix-historical-ddl/schema-snapshot').historicalSchema('c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d').schemaDdl;
const catalog=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-offload-upgrade-')),databasePath=path.join(root,'db.sqlite'),db=new Database(databasePath);
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const bytes=zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname,'../fixtures/helix-historical-ddl',PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST+'.sql.gz')));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST);db.exec(bytes.toString());
  db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES (?,?,?,?,?)')
    .run('shelfdeck','helix-clean-v3',PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST,digest(catalog(db)),1);
  db.exec("INSERT INTO libra_runs(libra_run_id,state) VALUES ('run','completed'); INSERT INTO libra_product_packages(on_deck_package_id,libra_run_id,package_digest,production_provenance_json) VALUES ('package','run','"+digest('package')+"','{\"history\":true}'); INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id,package_digest,state) VALUES ('custody','package','"+digest('package')+"','active'); INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES ('on-deck','custody','committed'); INSERT INTO arca_shelf_entries(shelf_entry_id,structure_kind,status) VALUES ('movie','single','active');");
  db.prepare('INSERT INTO libra_offload_context_materials(on_deck_package_id,ordinal,material_key,context_role,final_product_material_key,disposition_kind,settlement_expectation,context_member_digest,location,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('package',0,digest('source'),'original_input',digest('product'),'replaced_and_settled','remove_after_place',digest('immutable-member'),'movie/source.mkv',12345);
  db.exec("INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision) VALUES ('receipt','on-deck','movie',1,1)");
  const old=db.prepare('SELECT * FROM libra_offload_context_materials').all(),marker=db.prepare('SELECT * FROM platform_schema_marker').get();
  const migrate=(Driver=Database)=>migrateUatIdentitySelectionSchema({Database:Driver,databasePath,schemaManifest,now:()=>2});
  return {db,databasePath,old,marker,migrate};
}
test('Exact prior Off-load schema preserves completed Movie rows and opens as the current schema',t=>{
  const f=fixture(t),tables=['libra_runs','libra_product_packages','arca_ondeck_runs','arca_ondeck_custodies','arca_shelf_entries','arca_ondeck_commit_receipts'],before=tables.map(name=>f.db.prepare('SELECT * FROM '+name).all());
  assert.equal(f.migrate().migrated,true);assert.equal(f.migrate().migrated,false);
  assert.equal(f.db.prepare('SELECT schema_digest FROM platform_schema_marker').get().schema_digest,TARGET_SCHEMA_DIGEST);
  assert.deepEqual(f.db.prepare('SELECT * FROM libra_offload_context_materials').all(),f.old.map(row=>({...row,final_product_material_keys_schema_ref:null,final_product_material_keys_json:null})));
  for(const [index,name] of tables.entries())assert.deepEqual(f.db.prepare('SELECT * FROM '+name).all(),before[index]);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);openSqliteKernel({Database,databasePath:f.databasePath,schemaManifest,schemaDdl}).close();
});
for(const mutation of ['active-run','uncommitted-package','wrong-custody-digest','missing-commit-receipt','uncommitted-ondeck-run','unreceipted-committed-custody','null-target','catalog-drift'])test('Off-load upgrade refuses '+mutation+' without changing history or marker',t=>{
  const f=fixture(t);
  if(mutation==='active-run')f.db.exec("UPDATE libra_runs SET state='active'");
  if(mutation==='uncommitted-package')f.db.exec('DELETE FROM arca_ondeck_commit_receipts; DELETE FROM arca_ondeck_runs');
  if(mutation==='wrong-custody-digest')f.db.exec("UPDATE arca_ondeck_custodies SET package_digest='"+digest('another-package')+"'");
  if(mutation==='missing-commit-receipt')f.db.exec('DELETE FROM arca_ondeck_commit_receipts');
  if(mutation==='uncommitted-ondeck-run')f.db.exec("UPDATE arca_ondeck_runs SET state='offloading'");
  if(mutation==='unreceipted-committed-custody')f.db.exec("DELETE FROM arca_ondeck_commit_receipts; UPDATE arca_ondeck_custodies SET state='committed'");
  if(mutation==='null-target')f.db.exec('UPDATE libra_offload_context_materials SET final_product_material_key=NULL');
  if(mutation==='catalog-drift')f.db.exec('CREATE INDEX unexpected_offload_index ON libra_offload_context_materials(location)');
  const rows=f.db.prepare('SELECT * FROM libra_offload_context_materials').all(),before=catalog(f.db);
  assert.throws(f.migrate,mutation==='null-target'||mutation==='catalog-drift'?undefined:{code:mutation==='uncommitted-ondeck-run'?'ARCA_TARGET_RESERVATION_FORMATION_RESET_REQUIRED':'SERIES_OFFLOAD_FORMATION_RESET_REQUIRED'});
  assert.deepEqual(f.db.prepare('SELECT * FROM platform_schema_marker').get(),f.marker);
  assert.deepEqual(f.db.prepare('SELECT * FROM libra_offload_context_materials').all(),rows);assert.deepEqual(catalog(f.db),before);
});
test('Exception after copying Off-load rows rolls back DDL and permits one clean retry',t=>{
  const f=fixture(t),before=catalog(f.db);
  class FaultDatabase extends Database {exec(sql){const result=super.exec(sql);if(sql.startsWith('INSERT INTO "libra_offload_context_materials"'))throw new Error('injected-copy-failure');return result;}}
  assert.throws(()=>f.migrate(FaultDatabase),/injected-copy-failure/);
  assert.deepEqual(catalog(f.db),before);assert.deepEqual(f.db.prepare('SELECT * FROM libra_offload_context_materials').all(),f.old);
  assert.deepEqual(f.db.prepare('SELECT * FROM platform_schema_marker').get(),f.marker);assert.equal(f.migrate().migrated,true);
});
