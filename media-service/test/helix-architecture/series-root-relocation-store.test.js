'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createSeriesPresentationStore}=require('../../src/helix/domains/arca/persistence/series-presentation-store');
const {createSeriesRootRelocationStore}=require('../../src/helix/domains/arca/persistence/series-root-relocation-store');
const {seriesScopeId,buildSharedManifest}=require('../../src/helix/domains/arca/model/series-presentation');
const {createCleanSeriesRootRelocationPort}=require('../../src/clean-series-root-relocation-port');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {basis}=require('./helpers/series-basis');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-relocation-store-')),shelfRoot=path.join(root,'shelf'),oldRoot=path.join(shelfRoot,'Old Show'),newRoot=path.join(shelfRoot,'New Show');
  fs.mkdirSync(oldRoot,{recursive:true});
  const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),databasePath=path.join(root,'state.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl:fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')});
  const db=new Database(databasePath),unitOfWork=createSqliteUnitOfWork({kernel}),contractValidator=createCapabilityContractValidator({schemas:[
    require('../../src/helix/contracts/domain-types/SeriesPresentationScope/v1/schema.json'),require('../../src/helix/contracts/domain-types/SeriesPresentationManifest/v1/schema.json'),
    require('../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json')]});
  const deps={schemaManifest,unitOfWork,contractValidator},series=createSeriesPresentationStore(deps),store=createSeriesRootRelocationStore(deps);
  t.after(()=>{db.close();kernel.close();assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  function insert(table,row) {const keys=Object.keys(row);try {db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(k=>'@'+k).join(',')})`).run(row);} catch(error) {throw new Error(table+': '+error.message,{cause:error});}}
  db.exec('BEGIN');
  insert('arca_shelves',{shelf_id:'shelf',status:'active',target_endpoint_id:'endpoint',target_mount_scope_id:'mount',target_mount_scope_revision:1,target_root_location:shelfRoot,current_standard_revision:null,current_placement_revision:null});
  insert('arca_shelf_standard_revisions',{shelf_id:'shelf',revision:1,standard_json:'{}'});
  insert('arca_placement_policy_revisions',{shelf_id:'shelf',revision:2,policy_json:'{}'});
  db.prepare("UPDATE arca_shelves SET current_standard_revision=1,current_placement_revision=2").run();
  db.exec('COMMIT');
  const scopeId=seriesScopeId('shelf','1399');
  insert('arca_series_presentation_scopes',{scope_id:scopeId,shelf_id:'shelf',provider:'tmdb',provider_key:'1399',endpoint_id:'endpoint',mount_scope_id:'mount',shelf_root:shelfRoot,
    root_location:oldRoot,placement_revision:1,current_version:0,active_build_id:null,retirement_scope_id:null,state_revision:1,state_digest:D('scope'),created_at_ms:1,updated_at_ms:1});
  function material(relative) {
    const location=path.join(oldRoot,relative);fs.mkdirSync(path.dirname(location),{recursive:true});fs.writeFileSync(location,'bytes '+relative);
    const observed=computeBoundedMaterialFingerprintSync(location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,
      fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
    return {location,identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D({schema:'physical-material-identity@2',...tuple}),...tuple}};
  }
  const build=series.admitBuild({scopeId,basis:basis().value,existingMembers:[]});
  const members=['nfo','poster','fanart'].map(artifactKind=>{const {location,identity}=material(artifactKind==='nfo'?'tvshow.nfo':artifactKind+'.jpg');
    return {artifactKind,location,endpointId:'endpoint',physicalIdentity:identity,byteDigest:crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex'),sizeBytes:identity.sizeBytes,
      width:artifactKind==='nfo'?null:artifactKind==='poster'?600:1600,height:artifactKind==='nfo'?null:900,nfoProviderKey:artifactKind==='nfo'?'1399':null,sourceDigest:D('source')};});
  unitOfWork.execute([series.versionParticipant(build,buildSharedManifest(build,members),D('verify'))]);
  db.exec('BEGIN');
  for(const n of [1,2]) {
    const id='season-'+n,{location,identity}=material('Season 0'+n+'/Episode.mkv');
    insert('arca_shelf_entries',{shelf_entry_id:id,shelf_id:'shelf',structure_kind:'season',status:'active',canonical_identity_key:'key-'+n,canonical_identity_revision:null,current_inventory_revision:null,current_deck_fact_revision:null,created_at_ms:1});
    insert('arca_canonical_identity_revisions',{shelf_entry_id:id,revision:1,identity_kind:'provider_identity',provider:'tmdb',provider_key:'1399',identity_digest:D(id),committed_at_ms:1});
    insert('arca_deck_fact_revisions',{shelf_entry_id:id,revision:1,state:'active'});
    insert('arca_inventory_representations',{shelf_entry_id:id,revision:1,representation_digest:D(id),source_package_id:'package-'+n,committed_at_ms:1});
    insert('arca_inventory_materials',{shelf_entry_id:id,inventory_revision:1,ordinal:0,material_key:identity.materialKey,role:'primary_payload',episode_claims_schema_ref:'claims@1',episode_claims_json:'{}',episode_claim_set_digest:D('claims'),
      endpoint_id:'endpoint',location,binding_revision:1,mount_scope_id:'mount',inode:identity.inode,fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:String(identity.fingerprintVersion),
      content_fingerprint:identity.contentFingerprint,digest_hex:identity.contentFingerprint,size_bytes:identity.sizeBytes,active_guard:1});
    db.prepare('UPDATE arca_shelf_entries SET canonical_identity_revision=1,current_inventory_revision=1,current_deck_fact_revision=1 WHERE shelf_entry_id=?').run(id);
    insert('arca_series_presentation_references',{scope_id:scopeId,shelf_entry_id:id,first_committed_version:1,state:'active',reference_revision:1,reference_digest:D(id),created_at_ms:1});
  }
  db.exec('COMMIT');
  const request={scopeId,targetRoot:newRoot,placementRevision:2},io=createCleanSeriesRootRelocationPort();
  const ref=row=>({relocationId:row.relocation_id,scopeId,planDigest:row.plan_digest});
  return {root,oldRoot,newRoot,scopeId,store,series,db,unitOfWork,request,io,ref,insert};
}

test('whole-Series Inventory commit advances every Season and shared root atomically, preserving identities and history',t=>{
  const f=fixture(t),row=f.store.admit(f.request),reference=f.ref(row);
  assert.equal(row.plan.seasons.length,2);assert.equal(row.plan.files.length,5);
  assert.deepEqual(f.store.admit(f.request),row);
  const before=f.db.prepare('SELECT * FROM arca_inventory_materials ORDER BY shelf_entry_id').all();
  const verified=f.io.move(row.plan,()=>f.store.inspect(reference));
  const crash={participantId:'injected_commit_failure',owner:'arca',repositories:[f.store.repository],execute(){throw new Error('commit interrupted');}};
  assert.throws(()=>f.unitOfWork.execute([f.store.commitParticipant(reference,verified,'marker'),crash]),/commit interrupted/);
  assert.deepEqual(f.db.prepare('SELECT * FROM arca_inventory_materials ORDER BY shelf_entry_id').all(),before);
  assert.equal(f.store.read(row.relocation_id).state,'active');assert.equal(f.series.readScope(f.scopeId).root_location,f.oldRoot);
  const result=f.unitOfWork.execute([f.store.commitParticipant(reference,verified,'marker')]).arca_series_root_inventory;
  assert.equal(result.sharedVersion,2);assert.equal(f.store.read(row.relocation_id).state,'committed');
  const current=f.db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=2 ORDER BY shelf_entry_id').all();
  assert.equal(current.length,2);
  for(let i=0;i<2;i++){assert.equal(current[i].material_key,before[i].material_key);assert.equal(current[i].inode,before[i].inode);assert.equal(current[i].binding_revision,2);assert.ok(current[i].location.startsWith(f.newRoot));}
  const history=f.db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=1 ORDER BY shelf_entry_id').all();
  assert.deepEqual(history,before.map(row=>({...row,active_guard:0})));
  assert.equal(f.series.manifest(f.scopeId,1).value.rootLocation,f.oldRoot);assert.equal(f.series.manifest(f.scopeId,2).value.rootLocation,f.newRoot);
  assert.deepEqual(f.db.prepare('SELECT current_inventory_revision FROM arca_shelf_entries').all().map(r=>r.current_inventory_revision),[2,2]);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

test('admission independently rejects an omitted reference and a busy Season',t=>{
  const f=fixture(t);
  f.db.prepare("UPDATE arca_series_presentation_references SET state='released' WHERE shelf_entry_id='season-2'").run();
  assert.throws(()=>f.store.admit(f.request),{code:'ARCA_SERIES_RELOCATION_MEMBER_SET_INVALID'});
  f.db.prepare("UPDATE arca_series_presentation_references SET state='active'").run();
  f.db.prepare("UPDATE arca_shelf_entries SET status='offdeck_in_progress' WHERE shelf_entry_id='season-2'").run();
  assert.throws(()=>f.store.admit(f.request),{code:'ARCA_SERIES_RELOCATION_MEMBER_BUSY'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_series_root_relocations').get().n,0);
});

test('a changed Season head after admission blocks the move and all Inventory writes',t=>{
  const f=fixture(t),row=f.store.admit(f.request),reference=f.ref(row);
  f.insert('arca_deck_fact_revisions',{shelf_entry_id:'season-2',revision:2,state:'active'});
  f.db.prepare("UPDATE arca_shelf_entries SET current_deck_fact_revision=2 WHERE shelf_entry_id='season-2'").run();
  assert.throws(()=>f.io.move(row.plan,()=>f.store.inspect(reference)),{code:'ARCA_SERIES_RELOCATION_STALE'});
  assert.ok(fs.existsSync(f.oldRoot));assert.equal(fs.existsSync(f.newRoot),false);
  assert.equal(f.store.read(row.relocation_id).state,'active');
});

test('the durable relocation gate blocks a new Season and shared builders until the group commits',t=>{
  const f=fixture(t),row=f.store.admit(f.request),source=basis(3);
  const request={shelf:{shelfId:'shelf',currentPlacementRevision:2,target:{endpointId:'endpoint',mountScopeId:'mount',rootLocation:path.dirname(f.oldRoot)}},
    onDeckRunId:'new-run',custodyId:'new-custody',targetLocation:path.join(f.oldRoot,'Season 03'),
    package:{productStructureSnapshot:{structureKind:'season'},resolvedIdentitySnapshot:{factValue:{providerIdentities:[source.identity]}},
      productFactManifest:{items:[{factKind:'product_metadata',factValue:{seriesPresentationBasis:source.value}}]}}};
  assert.throws(()=>f.unitOfWork.execute([f.series.reservationParticipant(request)]),{code:'ARCA_SERIES_RELOCATION_BUSY'});
  assert.throws(()=>f.series.admitBuild({scopeId:f.scopeId,basis:source.value,existingMembers:[]}),{code:'ARCA_SERIES_RELOCATION_BUSY'});
  assert.throws(()=>f.unitOfWork.execute([f.series.releaseReferencesParticipant(['season-1'])]),{code:'ARCA_SERIES_RELOCATION_BUSY'});
  const gate=require('../../src/helix/domains/arca/persistence/series-root-relocation-gate');
  assert.throws(()=>f.unitOfWork.execute([f.series.participant('check_shelf',repo=>gate.assertNoShelfSeriesRelocation(repo,'shelf'))]),{code:'ARCA_SERIES_RELOCATION_BUSY'});
  assert.throws(()=>f.unitOfWork.execute([f.series.participant('check_season',repo=>gate.assertNoEntrySeriesRelocation(repo,'season-2'))]),{code:'ARCA_SERIES_RELOCATION_BUSY'});
  assert.equal(f.store.read(row.relocation_id).state,'active');
  assert.equal(f.db.prepare("SELECT count(*) n FROM arca_series_presentation_references WHERE state='active'").get().n,2);
});
