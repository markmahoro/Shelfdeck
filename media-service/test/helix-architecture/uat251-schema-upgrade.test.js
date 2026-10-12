'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {historicalDatabase}=require('../fixtures/historical-database');

const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {migrateUatIdentitySelectionSchema}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const {validManifest}=require('../../src/helix/domains/arca/model/authorized-defect-manifest');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const beforeDigest='b8cbd25e773b61e1e9ecfe1b8aecb079f4c97eae02f38c117b4d4e8a08427821';
const catalog=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
  .all().map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));

test('UAT-251 upgrades the 189-table schema atomically and preserves historical defect facts byte for byte',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'uat251-upgrade-')),dataDir=path.join(root,'data'),databasePath=path.join(dataDir,'shelfdeck.db');
  let db;
  try {
    db=historicalDatabase(databasePath,beforeDigest);
    db.prepare('INSERT INTO arca_shelves (shelf_id) VALUES (?)').run('historical-shelf');
    db.prepare('INSERT INTO arca_shelf_entries (shelf_entry_id,shelf_id) VALUES (?,?)').run('historical-entry','historical-shelf');
    const body={schemaRef:'helix://contracts/application-types/AuthorizedDefectManifest/v1',schemaVersion:1,
      manifestId:'historical-decision',defectDecisionId:'historical-decision',defectCount:1,
      defects:[{defectCode:'actor_unavailable',waivedRequirementCodes:['metadata_field_unmet']}],
      waivedRequirementCodes:['metadata_field_unmet'],acknowledgement:'accept_listed_defects'};
    const manifest={...body,manifestDigest:canonicalDigest(body)},bytes=JSON.stringify(manifest,null,2);
    assert.equal(validManifest(manifest),true);
    db.prepare('INSERT INTO arca_inventory_product_facts (shelf_entry_id,inventory_revision,fact_kind,fact_revision,fact_json,fact_digest) VALUES (?,?,?,?,?,?)')
      .run('historical-entry',1,'authorized_defect_manifest',1,bytes,canonicalDigest(manifest));
    const initialCatalog=catalog(db);
    assert.equal(initialCatalog.filter(row=>row.type==='table').length,189);
    db.prepare('UPDATE platform_schema_marker SET schema_digest=?,catalog_digest=?').run(beforeDigest,digest(initialCatalog));
    const initialFacts=db.prepare('SELECT * FROM arca_inventory_product_facts').all();
    db.close();
    assert.throws(()=>migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>-1}),error=>error.code==='UAT_MIGRATION_INVALID_TIME');
    db=new Database(databasePath);
    assert.deepEqual(catalog(db),initialCatalog);
    assert.equal(db.prepare('SELECT schema_digest FROM platform_schema_marker').get().schema_digest,beforeDigest);
    db.close();
    const migrated=migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>251});
    assert.equal(migrated.migrated,true);assert.equal(migrated.sourceSchemaDigest,beforeDigest);
    assert.equal(migrated.targetSchemaDigest,schemaManifest.ddlDigest);
    db=new Database(databasePath);
    assert.equal(catalog(db).filter(row=>row.type==='table').length,200);
    assert.deepEqual(db.prepare('SELECT * FROM arca_inventory_product_facts').all(),
      initialFacts.map(row=>({...row,episode_metadata_schema_ref:null,episode_metadata_json:null})));
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
    assert.equal(validManifest(JSON.parse(initialFacts[0].fact_json)),true);
    db.close();
    const opened=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});opened.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
  }finally{if(db?.open)db.close();fs.rmSync(root,{recursive:true,force:true});}
});
