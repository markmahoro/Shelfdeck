'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {buildSeriesRootRelocationPlan}=require('../../src/helix/domains/arca/model/series-root-relocation');
const {createCleanSeriesRootRelocationPort}=require('../../src/clean-series-root-relocation-port');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-root-move-')),oldRoot=path.join(root,'Old Show'),newRoot=path.join(root,'New Show');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(oldRoot);
  function material(relativePath) {
    const location=path.join(oldRoot,relativePath);fs.mkdirSync(path.dirname(location),{recursive:true});fs.writeFileSync(location,'known bytes: '+relativePath);
    const observed=computeBoundedMaterialFingerprintSync(location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
    const identity={...tuple,materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple})};
    return {location,identity};
  }
  const seasons=[1,2].map(n=>{
    const {location,identity}=material('Season 0'+n+'/Episode.mkv');
    return {entry:{shelf_entry_id:'season-'+n,shelf_id:'shelf',structure_kind:'season',status:'active',current_inventory_revision:3,
      canonical_identity_revision:1,current_deck_fact_revision:2},identity:{provider:'tmdb',provider_key:'1399'},inventory:{revision:3},
      materials:[{material_key:identity.materialKey,role:'primary_payload',endpoint_id:'endpoint',location,mount_scope_id:'mount',inode:identity.inode,
        size_bytes:identity.sizeBytes,fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:identity.fingerprintVersion,content_fingerprint:identity.contentFingerprint}],
      cases:[],reservations:[]};
  });
  const members=['tvshow.nfo','poster.jpg','fanart.jpg'].map(name=>{const m=material(name);return {location:m.location,physicalIdentity:m.identity,endpointId:'endpoint',
    byteDigest:crypto.createHash('sha256').update(fs.readFileSync(m.location)).digest('hex')};});
  const request={scope:{scope_id:'scope',shelf_id:'shelf',provider:'tmdb',provider_key:'1399',endpoint_id:'endpoint',mount_scope_id:'mount',shelf_root:root,
    root_location:oldRoot,placement_revision:1,current_version:2,active_build_id:null,retirement_scope_id:null},
    shared:{scopeId:'scope',revision:2,rootLocation:oldRoot,members,digest:canonicalDigest(members)},seasons,
    references:seasons.map(s=>({shelf_entry_id:s.entry.shelf_entry_id,state:'active'})),reservations:[],targetRoot:newRoot,placementRevision:2};
  return {root,oldRoot,newRoot,request,plan:()=>buildSeriesRootRelocationPlan(request)};
}

test('one root move carries both Seasons and shared presentation, retaining physical identities',t=>{
  const f=fixture(t),plan=f.plan(),port=createCleanSeriesRootRelocationPort();let fences=0;
  assert.equal(plan.seasons.length,2);assert.equal(plan.files.length,5);
  assert.equal(port.observe(plan).state,'source_ready');
  const result=port.move(plan,()=>{fences++;});assert.equal(result.fileCount,5);assert.ok(fences>=3);
  assert.equal(fs.existsSync(f.oldRoot),false);assert.equal(port.observe(plan).state,'target_verified');
  assert.deepEqual(port.move(plan,()=>{}),result);
});

test('restart after physical rename verifies the original complete set and never moves another root',t=>{
  const f=fixture(t),plan=f.plan();
  assert.throws(()=>createCleanSeriesRootRelocationPort({afterRename(){throw new Error('process interrupted');}}).move(plan,()=>{}),/process interrupted/);
  const result=createCleanSeriesRootRelocationPort().move(plan,()=>{});assert.equal(result.rootLocation,f.newRoot);
  fs.mkdirSync(f.oldRoot);fs.writeFileSync(path.join(f.oldRoot,'new-owner.txt'),'foreign');
  assert.throws(()=>createCleanSeriesRootRelocationPort().move(plan,()=>{}),{code:'ARCA_SERIES_RELOCATION_TARGET_CONFLICT'});
  assert.equal(fs.readFileSync(path.join(f.oldRoot,'new-owner.txt'),'utf8'),'foreign');
});

test('unknown files, empty directories, changed media and an occupied target block before moving any Season',t=>{
  const f=fixture(t),plan=f.plan(),port=createCleanSeriesRootRelocationPort();
  const unknown=path.join(f.oldRoot,'unknown.txt');fs.writeFileSync(unknown,'user file');
  assert.throws(()=>port.move(plan,()=>{}),{code:'ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER'});fs.unlinkSync(unknown);
  fs.mkdirSync(path.join(f.oldRoot,'unknown'));assert.throws(()=>port.move(plan,()=>{}),{code:'ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER'});fs.rmdirSync(path.join(f.oldRoot,'unknown'));
  fs.mkdirSync(f.newRoot);assert.throws(()=>port.move(plan,()=>{}),{code:'ARCA_SERIES_RELOCATION_TARGET_CONFLICT'});fs.rmdirSync(f.newRoot);
  fs.appendFileSync(path.join(f.oldRoot,'Season 02','Episode.mkv'),'changed');
  assert.throws(()=>port.move(plan,()=>{}),{code:'ARCA_SERIES_RELOCATION_PHYSICAL_DRIFT'});assert.ok(fs.existsSync(f.oldRoot));assert.equal(fs.existsSync(f.newRoot),false);
});

for(const [name,change,code] of [
  ['omitted Season',r=>{r.seasons.pop();},'ARCA_SERIES_RELOCATION_MEMBER_SET_INVALID'],
  ['pending accepted reservation',r=>{r.reservations.push({state:'pending'});},'ARCA_SERIES_RELOCATION_BUSY'],
  ['active shared builder',r=>{r.scope.active_build_id='other';},'ARCA_SERIES_RELOCATION_BUSY'],
  ['other maintenance',r=>{r.seasons[1].cases.push({state:'active'});},'ARCA_SERIES_RELOCATION_MEMBER_BUSY'],
  ['foreign Provider identity',r=>{r.seasons[1].identity.provider_key='other';},'ARCA_SERIES_RELOCATION_MEMBER_BUSY'],
])test('whole-Series planning rejects '+name,t=>{const f=fixture(t);change(f.request);assert.throws(f.plan,{code});});
