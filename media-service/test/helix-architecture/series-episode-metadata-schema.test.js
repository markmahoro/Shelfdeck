'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {migrateUatIdentitySelectionSchema,PRE_EPISODE_METADATA_SCHEMA_DIGEST}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const schemaManifest=require('../fixtures/helix-historical-ddl/schema-snapshot').historicalSchema('c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d').schemaManifest;
const schemaDdl=require('../fixtures/helix-historical-ddl/schema-snapshot').historicalSchema('c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d').schemaDdl;
const catalog=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));

test('Episode metadata additive upgrade preserves active Runs and Movie facts, rolls back on failure and replays',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'episode-metadata-schema-')),databasePath=path.join(root,'db.sqlite'),db=new Database(databasePath);
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const bytes=zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname,'../fixtures/helix-historical-ddl',PRE_EPISODE_METADATA_SCHEMA_DIGEST+'.sql.gz')));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),PRE_EPISODE_METADATA_SCHEMA_DIGEST);
  db.exec(bytes.toString());
  db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES (?,?,?,?,?)')
    .run('shelfdeck','helix-clean-v3',PRE_EPISODE_METADATA_SCHEMA_DIGEST,digest(catalog(db)),1);
  db.exec("INSERT INTO libra_runs(libra_run_id,state) VALUES ('active-series','active'); INSERT INTO libra_product_fact_revisions(product_fact_id,fact_revision,libra_run_id,fact_json) VALUES ('movie-fact',1,'active-series','{\"historical\":true}')");
  const before=catalog(db),runs=db.prepare('SELECT * FROM libra_runs').all(),facts=db.prepare('SELECT * FROM libra_product_fact_revisions').all();
  class FaultDatabase extends Database {exec(sql){const result=super.exec(sql);if(sql.includes('ADD COLUMN "episode_metadata_json"'))throw new Error('injected-metadata-schema-failure');return result;}}
  const migrate=Driver=>migrateUatIdentitySelectionSchema({Database:Driver||Database,databasePath,schemaManifest,now:()=>2});
  assert.throws(()=>migrate(FaultDatabase),/injected-metadata-schema-failure/);
  assert.deepEqual(catalog(db),before);
  assert.deepEqual(db.prepare('SELECT * FROM libra_runs').all(),runs);
  assert.equal(migrate().migrated,true);
  assert.equal(migrate().migrated,false);
  assert.deepEqual(db.prepare('SELECT * FROM libra_runs').all(),runs);
  assert.deepEqual(db.prepare('SELECT * FROM libra_product_fact_revisions').all(),facts.map(row=>({...row,episode_metadata_schema_ref:null,episode_metadata_json:null})));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl}).close();
});
