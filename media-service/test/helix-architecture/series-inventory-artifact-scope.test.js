'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {artifactRequirement}=require('../../src/helix/contracts/product-artifact-requirement');
const {acceptedInventoryArtifactScopes,readInventoryArtifactScope,validateInventoryArtifactScope}=require('../../src/helix/domains/arca/model/inventory-artifact-scope');
const {migrateUatIdentitySelectionSchema,PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST}=require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
function catalogRows(db){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row,sql:row.sql&&row.sql.replaceAll('\r\n','\n')}));}
const schemaManifest=require('../fixtures/helix-historical-ddl/schema-snapshot').historicalSchema('c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d').schemaManifest;
const {appendInventoryRevision}=require('../../src/helix/domains/arca/persistence/inventory-revision-writer');
function fixture() {
  const episodeScope={seasonNumber:1,episodeNumber:2,episodeKey:'E002'},artifact={artifactHandleId:'nfo-2',artifactKind:'nfo',
    artifactRevision:1,artifactDigest:canonicalDigest('bytes'),requirementDigest:artifactRequirement('nfo',episodeScope).requirementDigest,materializationState:'included_product'};
  artifact.referenceDigest=canonicalDigest(artifact);
  const value={onDeckPackageId:'package',productStructureSnapshot:{structureKind:'season'},resolvedIdentitySnapshot:{factValue:{providerIdentities:[{namespace:'tmdb_series',seasonNumber:1}]}},
    productFactManifest:{items:[{factKind:'product_metadata',factValue:{episodeMetadata:[{episodeScope}]}}]},
    productMaterialManifest:{members:[{materialKey:'nfo-source',role:'metadata_sidecar',workspaceMaterialHandle:{digestHex:artifact.artifactDigest}}]},artifactManifest:{items:[artifact]}};
  return {value,scope:acceptedInventoryArtifactScopes(value).get('nfo-source')};
}
test('Inventory scope retains exact accepted Artifact provenance and canonical Episode target',()=>{
  const {scope}=fixture();assert.equal(scope.episodeScope.episodeKey,'E002');assert.equal(scope.sourcePackageId,'package');
  assert.deepEqual(readInventoryArtifactScope({role:'metadata_sidecar',artifact_scope_schema_ref:scope.schemaRef,artifact_scope_json:canonicalJson(scope)}),scope);
  assert.equal(readInventoryArtifactScope({role:'primary_payload',artifact_scope_json:null}),null);
});
for(const mutation of ['digest','unknown','season','requirement','source','role','noncanonical'])test('Inventory scope rejects '+mutation,()=>{
  const {scope}=fixture(),value=structuredClone(scope),row={role:'metadata_sidecar',artifact_scope_schema_ref:scope.schemaRef};
  if(mutation==='digest')value.scopeDigest='0'.repeat(64);
  if(mutation==='unknown')value.extra=true;
  if(mutation==='season')value.seasonNumber=2;
  if(mutation==='requirement')value.requirementDigest='0'.repeat(64);
  if(mutation==='source')value.sourcePackageId='';
  if(mutation==='role')row.role='primary_payload';
  row.artifact_scope_json=mutation==='noncanonical'?JSON.stringify(value,null,2):canonicalJson(value);
  assert.throws(()=>readInventoryArtifactScope(row));
});
test('an altered accepted Artifact reference is not persisted as provenance',()=>{
  const {value}=fixture();value.artifactManifest.items[0].artifactHandleId='foreign';
  assert.throws(()=>acceptedInventoryArtifactScopes(value),/reference digest/);
});
test('scope validation binds a changed Episode even if the outer digest is recomputed',()=>{
  const {scope}=fixture(),value=structuredClone(scope);value.episodeScope.episodeNumber=3;value.episodeScope.episodeKey='E003';
  const {scopeDigest,...body}=value;value.scopeDigest=canonicalDigest(body);
  assert.throws(()=>validateInventoryArtifactScope(value));
});
for(const corrupt of [false,true])test('Aftercare revision writer '+(corrupt?'rejects scope loss of role before any write':'preserves the exact NFO target'),()=>{
  const {scope}=fixture(),calls=[],row={role:corrupt?'primary_payload':'metadata_sidecar',material_key:'material',
    artifact_scope_schema_ref:scope.schemaRef,artifact_scope_json:canonicalJson(scope),binding_revision:1,size_bytes:12,fingerprint_version:1};
  const repo={invoke(name,value){calls.push({name,value});return {changes:1};}},value={shelfEntryId:'entry',representationDigest:canonicalDigest('inventory'),
    materials:[row],related:[],facts:[],people:[]};
  const write=()=>appendInventoryRevision(repo,value,{source_package_id:'package'},1,2,100);
  if(corrupt){assert.throws(write);assert.deepEqual(calls,[]);}
  else {write();const inserted=calls.find(call=>call.name==='insert_material').value;
    assert.equal(inserted.artifact_scope_schema_ref,row.artifact_scope_schema_ref);
    assert.equal(inserted.artifact_scope_json,row.artifact_scope_json);}
});
for(const series of [false,true])test('exact prior schema '+(series?'refuses unproven Series':'adds nullable scope without editing Movie facts'),t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-scope-upgrade-')),databasePath=path.join(root,'test.db');
  const source=zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname,'../fixtures/helix-historical-ddl',PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST+'.sql.gz')));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST);
  const db=new Database(databasePath);t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});db.exec(source.toString());
  db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES (?,?,?,?,?)')
    .run('shelfdeck','helix-clean-v3',PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST,digest(catalogRows(db)),1);
  db.prepare('INSERT INTO arca_shelf_entries(shelf_entry_id,structure_kind,status) VALUES (?,?,?)').run('entry',series?'season':'single','active');
  db.prepare('INSERT INTO arca_inventory_materials(shelf_entry_id,inventory_revision,ordinal,role,material_key,episode_claims_json,size_bytes) VALUES (?,?,?,?,?,?,?)').run('entry',1,0,'primary_payload',canonicalDigest('media'),'{"items":[]}',1024);
  const oldMaterials=db.prepare('SELECT * FROM arca_inventory_materials').all();
  const before=db.prepare('SELECT * FROM arca_shelf_entries').all(),marker=db.prepare('SELECT * FROM platform_schema_marker').get();
  const migrate=()=>migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>2});
  if(series){assert.throws(migrate,{code:'ARCA_SERIES_ARTIFACT_SCOPE_UNPROVEN'});assert.deepEqual(db.prepare('SELECT * FROM platform_schema_marker').get(),marker);
    assert.ok(!db.pragma('table_info(arca_inventory_materials)').some(column=>column.name==='artifact_scope_json'));}
  else {assert.equal(migrate().migrated,true);assert.equal(migrate().migrated,false);
    assert.ok(db.pragma('table_info(arca_inventory_materials)').some(column=>column.name==='artifact_scope_json'));
    assert.deepEqual(db.prepare('SELECT * FROM arca_inventory_materials').all(),oldMaterials.map(row=>({...row,artifact_scope_schema_ref:null,artifact_scope_json:null})));
    const schemaDdl=require('../fixtures/helix-historical-ddl/schema-snapshot').historicalSchema('c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d').schemaDdl;
    openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl}).close();}
  assert.deepEqual(db.prepare('SELECT * FROM arca_shelf_entries').all(),before);
});
