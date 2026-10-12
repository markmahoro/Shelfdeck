'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {historicalDatabase}=require('../fixtures/historical-database');

const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {migrateUatIdentitySelectionSchema,PRE_SERIES_PROVENANCE_SCHEMA_DIGEST}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const catalog=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
  .all().map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));

test('Series provenance capacity upgrade preserves Package bytes, indexes and incoming refs atomically',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-provenance-schema-')),dataDir=path.join(root,'data'),databasePath=path.join(dataDir,'shelfdeck.db');
  let db;
  try {
    db=historicalDatabase(databasePath,PRE_SERIES_PROVENANCE_SCHEMA_DIGEST);
    db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,product_structure_json,production_provenance_json,attestation_json) VALUES (?,?,?,?)')
      .run('published-package','{}','{ "historical" : true }','{}');
    db.prepare('INSERT INTO libra_product_package_material_episode_claims (on_deck_package_id,member_ordinal,episode_key) VALUES (?,?,?)')
      .run('published-package',0,'E001');
    const packageDigest='a'.repeat(64);
    db.prepare('UPDATE libra_product_packages SET package_digest=?').run(packageDigest);
    db.prepare('INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id,package_digest) VALUES(?,?,?)')
      .run('custody','published-package',packageDigest);
    db.prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES(?,?,?)').run('committed-run','custody','committed');
    db.prepare('INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id) VALUES(?,?)').run('receipt','committed-run');
    const rows=db.prepare('SELECT * FROM libra_product_packages').all(),claims=db.prepare('SELECT * FROM libra_product_package_material_episode_claims').all();
    const priorCatalog=catalog(db);
    db.prepare('UPDATE platform_schema_marker SET schema_digest=?,catalog_digest=?').run(PRE_SERIES_PROVENANCE_SCHEMA_DIGEST,digest(priorCatalog));
    db.close();
    assert.throws(()=>migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>-1}),{code:'UAT_MIGRATION_INVALID_TIME'});
    db=new Database(databasePath);assert.deepEqual(catalog(db),priorCatalog);assert.deepEqual(db.prepare('SELECT * FROM libra_product_packages').all(),rows);db.close();
    const result=migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>123});
    assert.equal(result.migrated,true);assert.equal(result.sourceSchemaDigest,PRE_SERIES_PROVENANCE_SCHEMA_DIGEST);
    assert.equal(result.retiredPreProjectionWorks,undefined);assert.equal(result.retiredIntakeBindingAttempts,undefined);
    db=new Database(databasePath);assert.deepEqual(db.prepare('SELECT * FROM libra_product_packages').all(),rows);
    assert.deepEqual(db.prepare('SELECT * FROM libra_product_package_material_episode_claims').all(),claims);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
    const update=db.prepare('UPDATE libra_product_packages SET production_provenance_json=? WHERE on_deck_package_id=?');
    update.run(JSON.stringify({evidence:'x'.repeat(70000)}),'published-package');
    assert.throws(()=>update.run(JSON.stringify({evidence:'x'.repeat(1048576)}),'published-package'),/CHECK constraint/);
    db.close();
    const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});kernel.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
  } finally {if(db?.open)db.close();fs.rmSync(root,{recursive:true,force:true});}
});
