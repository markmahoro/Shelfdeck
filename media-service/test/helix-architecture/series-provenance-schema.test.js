'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
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
    initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:'disposable-series-schema-secret-0123456789'});
    db=new Database(databasePath);
    for (const table of ['libra_product_fact_revisions','arca_inventory_product_facts']) {
      const definition=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
      const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
      db.exec('DROP TABLE '+table);
      db.exec(definition.split('\n').filter(line=>!line.includes('episode_metadata')).join('\n'));
      indexes.forEach(index=>db.exec(index.sql));
    }
    const row=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='libra_product_packages'").get();
    const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='libra_product_packages' AND sql IS NOT NULL").all();
    db.exec('DROP TABLE libra_product_packages');
    db.exec(row.sql.replace('length(CAST("production_provenance_json" AS BLOB)) <= 1048576','length(CAST("production_provenance_json" AS BLOB)) <= 65536'));
    for(const item of indexes)db.exec(item.sql);
    db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,product_structure_json,production_provenance_json,attestation_json) VALUES (?,?,?,?)')
      .run('published-package','{}','{ "historical" : true }','{}');
    db.prepare('INSERT INTO libra_product_package_material_episode_claims (on_deck_package_id,member_ordinal,episode_key) VALUES (?,?,?)')
      .run('published-package',0,'E001');
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
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
