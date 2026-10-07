'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateSeriesExtension,isRetainedSeriesMaterial,extendInventory}=require('../../src/helix/domains/arca/model/series-inventory-extension');
const claims=items=>({items,episodeClaimSetDigest:'digest'});
function fixture(){const entry={structure_kind:'season',status:'active'},materials=[
 {material_key:'old-primary',role:'primary_payload',episode_claims_json:JSON.stringify(claims([{episodeKey:'E001'}]))},
 {material_key:'poster',role:'poster',endpoint_id:'endpoint',location:'/shelf/poster.jpg',size_bytes:12n,content_fingerprint:'fingerprint',episode_claims_json:JSON.stringify(claims([]))}];
 return {entry,materials,packageValue:{productMaterialManifest:{members:[{role:'primary_payload',episodeClaims:[{episodeKey:'E002'}]}]}}};}
test('Series extension admits only a nonempty disjoint Episode scope on an active Season',()=>{
 const f=fixture();assert.doesNotThrow(()=>validateSeriesExtension(f));
 f.packageValue.productMaterialManifest.members[0].episodeClaims.push({episodeKey:'E001'});
 assert.throws(()=>validateSeriesExtension(f),{code:'ARCA_SERIES_EPISODE_OVERLAP'});
 f.packageValue.productMaterialManifest.members=[];assert.throws(()=>validateSeriesExtension(f));
 f.entry.status='offdecked';assert.throws(()=>validateSeriesExtension(f),/active/);
});
test('Shared Season material reuse requires exact committed identity, binding and role',()=>{
 const previous=fixture(),member={role:'poster',endpointId:'endpoint',location:'/shelf/poster.jpg',episodeClaims:claims([]),
 physicalIdentity:{materialKey:'poster',sizeBytes:12,contentFingerprint:'fingerprint'}};
 assert.equal(isRetainedSeriesMaterial(previous,member),true);
 assert.equal(isRetainedSeriesMaterial(previous,{...member,physicalIdentity:{...member.physicalIdentity,materialKey:'new'}}),false);
 for(const change of [{role:'primary_payload'},{location:'/another/poster.jpg'},{endpointId:'foreign'},
  {physicalIdentity:{...member.physicalIdentity,sizeBytes:13}},{episodeClaims:claims([{episodeKey:'E002'}])}])
  assert.throws(()=>isRetainedSeriesMaterial(previous,{...member,...change}));
});

test('Inventory extension keeps old physical members and appends only distinct final targets',()=>{
 const f=fixture();Object.assign(f.materials[0],{ordinal:0,size_bytes:20,location:'/shelf/one.mkv',endpoint_id:'endpoint',binding_revision:1,fingerprint_version:'1'});
 Object.assign(f.materials[1],{ordinal:1,binding_revision:1,fingerprint_version:'1'});
 const member={materialKey:'new',role:'primary_payload',physicalIdentity:{materialKey:'new'},location:'/shelf/two.mkv'};
 const merged=extendInventory(f,[member]);assert.deepEqual(merged.map(row=>row.materialKey),['old-primary','poster','new']);
 assert.deepEqual(merged.map(row=>row.ordinal),[0,1,2]);assert.equal(f.materials.length,2);
 assert.throws(()=>extendInventory(f,[{...member,location:'/shelf/one.mkv'}]),/collides/);
});

const {deriveOnDeckControlChanges}=require('../../src/helix/domains/arca/persistence/on-deck-store');
test('Existing shared Season material stays controlled by the exact Entry without custody transfer',()=>{
 const previous=fixture(),member={materialKey:'poster',role:'poster',endpointId:'endpoint',location:'/shelf/poster.jpg',episodeClaims:claims([]),
 physicalIdentity:{materialKey:'poster',sizeBytes:12,contentFingerprint:'fingerprint'}};
 const projection={materialKey:'poster',resultKind:'available',controlState:'controlled',ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:'entry'};
 const input={previous,oldMaterials:new Map(),stagedMembers:[member],custodyControls:[],targetControls:[projection],custodyId:'custody',shelfEntryId:'entry'};
 assert.deepEqual(deriveOnDeckControlChanges(input),[]);
 assert.throws(()=>deriveOnDeckControlChanges({...input,targetControls:[{...projection,ownerScopeId:'other'}]}),{code:'P14_ONDECK_TARGET_CONTROL_CONFLICT'});
 assert.throws(()=>deriveOnDeckControlChanges({...input,previous:null}),{code:'P14_ONDECK_TARGET_CONTROL_CONFLICT'});
});
