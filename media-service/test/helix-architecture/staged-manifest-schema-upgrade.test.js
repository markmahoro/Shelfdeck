'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const Database=require('better-sqlite3');
const {migrateUatIdentitySelectionSchema,PRE_STAGED_MANIFEST_SCHEMA_DIGEST:prior}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const catalog=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arca-evidence-upgrade-')),databasePath=path.join(root,'test.db'),db=new Database(databasePath);
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const ddl=zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname,'../fixtures/helix-historical-ddl',prior+'.sql.gz'))).toString();
  assert.equal(digest(ddl),prior);db.exec(ddl);
  db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
    .run('shelfdeck','helix-clean-v3',prior,digest(catalog(db)),1);
  db.exec("INSERT INTO libra_runs(libra_run_id,state) VALUES('active','active'); INSERT INTO arca_ondeck_runs(on_deck_run_id,state) VALUES('settling','offloading');");
  return {db,databasePath,migrate:(Driver=Database)=>migrateUatIdentitySelectionSchema({Database:Driver,databasePath,schemaManifest,now:()=>2})};
}
test('Staged Manifest additive upgrade preserves active Runs and reopens the exact target schema',t=>{
  const f=fixture(t),before=['libra_runs','arca_ondeck_runs'].map(table=>f.db.prepare('SELECT * FROM '+table).all());
  assert.equal(f.migrate().migrated,true);assert.equal(f.migrate().migrated,false);
  ['libra_runs','arca_ondeck_runs'].forEach((table,index)=>assert.deepEqual(f.db.prepare('SELECT * FROM '+table).all(),before[index]));
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_staged_manifest_records').get().n,0);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  openSqliteKernel({Database,databasePath:f.databasePath,schemaManifest,schemaDdl}).close();
});
test('Staged Manifest DDL failure rolls back the catalog and marker before retry',t=>{
  const f=fixture(t),before=catalog(f.db),marker=f.db.prepare('SELECT * FROM platform_schema_marker').get();
  class FaultDatabase extends Database {exec(sql){const result=super.exec(sql);if(sql.startsWith('CREATE TABLE "arca_staged_manifest_records"'))throw new Error('injected-stage-ddl-failure');return result;}}
  assert.throws(()=>f.migrate(FaultDatabase),/injected-stage-ddl-failure/);
  assert.deepEqual(catalog(f.db),before);assert.deepEqual(f.db.prepare('SELECT * FROM platform_schema_marker').get(),marker);
  assert.equal(f.migrate().migrated,true);
});
