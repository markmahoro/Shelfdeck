'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {migrateUatIdentitySelectionSchema,PRE_SERIES_FACT_KEY_SCHEMA_DIGEST}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
test('Inventory Fact key upgrade preserves accepted snapshots and admits distinct Package revisions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-fact-key-')),dataDir=path.join(root,'data'),databasePath=path.join(dataDir,'shelfdeck.db');
 try {
  initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:'disposable-series-fact-key-secret-0123456789'});
  let db=new Database(databasePath);
  const sql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='arca_inventory_product_facts'").get().sql;
  db.exec('DROP TABLE arca_inventory_product_facts');
  db.exec(sql.replace('PRIMARY KEY ("shelf_entry_id", "inventory_revision", "source_package_id", "fact_kind", "fact_revision")','PRIMARY KEY ("shelf_entry_id", "inventory_revision", "fact_kind", "fact_revision")'));
  db.prepare('INSERT INTO arca_shelf_entries (shelf_entry_id) VALUES (?)').run('season');
  db.prepare('INSERT INTO arca_inventory_product_facts (shelf_entry_id,inventory_revision,source_package_id,fact_kind,fact_revision,fact_json) VALUES (?,?,?,?,?,?)')
    .run('season',1,'package-one','product_metadata',1,'{ "original" : true }');
  const rows=db.prepare('SELECT * FROM arca_inventory_product_facts').all();
  const catalog=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));
  db.prepare('UPDATE platform_schema_marker SET schema_digest=?,catalog_digest=?').run(PRE_SERIES_FACT_KEY_SCHEMA_DIGEST,digest(catalog));db.close();
  const result=migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>123});assert.equal(result.migrated,true);
  db=new Database(databasePath);assert.deepEqual(db.prepare('SELECT * FROM arca_inventory_product_facts').all(),rows);
  const insert=db.prepare('INSERT INTO arca_inventory_product_facts (shelf_entry_id,inventory_revision,source_package_id,fact_kind,fact_revision,fact_json) VALUES (?,?,?,?,?,?)');
  insert.run('season',1,'package-two','product_metadata',1,'{}');
  assert.throws(()=>insert.run('season',1,'package-two','product_metadata',1,'{}'),/UNIQUE/);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);db.close();
  assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
