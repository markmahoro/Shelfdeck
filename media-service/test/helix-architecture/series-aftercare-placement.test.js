'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fixture:acceptedFixture}=require('./fixtures/series-aftercare-context');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync:fingerprint}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createCleanArcaInventoryPort}=require('../../src/clean-arca-inventory-port');
const {buildAftercareInventoryRequest,placementMatchesInventory}=require('../../src/helix/domains/arca/model/aftercare-placement');
function fixture(t, options = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-care-placement-')),source=path.join(root,'source'),target=path.join(root,'target');
  fs.mkdirSync(source);fs.mkdirSync(target);
  t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const c=acceptedFixture();c.shelfEntryId='entry';c.raw.shelf={shelf_id:'shelf',status:'active',current_standard_revision:1,
    current_placement_revision:2,target_root_location:target,target_endpoint_id:'endpoint',target_mount_scope_id:'mount',target_mount_scope_revision:1};
  c.raw.placement={revision:2,value:{folderTemplate:'{title}'},policy_digest:D('placement')};
  c.raw.materials.forEach((row,ordinal)=>{
    row.name=row.material_key;row.location=path.join(source,row.name+(row.role==='metadata_sidecar'?'.nfo':'.mkv'));
    fs.writeFileSync(row.location,'Physical '+row.name);
    const observed=fingerprint(row.location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
    Object.assign(row,{ordinal,material_key:D({schema:'physical-material-identity@2',...tuple}),endpoint_id:'endpoint',binding_revision:1,
      mount_scope_id:'mount',inode:tuple.inode,size_bytes:tuple.sizeBytes,fingerprint_algorithm:tuple.fingerprintAlgorithm,
      fingerprint_version:tuple.fingerprintVersion,content_fingerprint:tuple.contentFingerprint});
    const items=(row.episode_claims_json?JSON.parse(row.episode_claims_json).items:[]).map(({episodeKey})=>{
      const seasonClaimDigest=D('season'),body={episodeKey,seasonClaimDigest};
      return {...body,claimDigest:D({schema:'libra.production-material-episode-claim@1',...body})};});
    row.episode_claim_set_digest=D({schema:'libra.production-material-episode-claims@1',items});
    row.episode_claims_json=canonicalJson({items,episodeClaimSetDigest:row.episode_claim_set_digest});
  });
  const port=createCleanArcaInventoryPort({schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('Placement planning must not write a transaction.');}},workspaceRoot:path.join(root,'workspace'),...options});
  return {c,port,root,target,request:()=>buildAftercareInventoryRequest(c,port,1,'case')};
}
test('Series Aftercare plans current Inventory across batches and shared Episode parts without Workspace Artifacts',t=>{
  const f=fixture(t),r=f.request(),names=r.finalInventoryDecision.members.map(item=>item.finalName).sort();
  assert.deepEqual(names,['Original Series - S02E01-E02.mkv','Original Series - S02E01.nfo','Original Series - S02E02.nfo',
    'Original Series - S02E03-part01.mkv','Original Series - S02E03-part02.mkv','Original Series - S02E03.nfo','season.nfo'].sort());
  assert.equal(f.port.resolveTargetLocation(r).targetDirectory,path.join(f.target,'Original Series','Season 02'));
  assert.equal(r.onDeckProductPackage.artifactManifest,undefined);
  assert.ok(r.onDeckProductPackage.productMaterialManifest.members.every(item=>!item.workspaceMaterialHandle));
  assert.deepEqual(fs.readdirSync(f.target),[]);
  assert.throws(()=>f.port.prepare({...r,aftercareCaseId:null}),{code:'CLEAN_ARCA_INVENTORY_INPUT'});
});
test('Series component checks preserve Episode markers and mapped thumbnails or reject the complete name',t=>{
  const f=fixture(t),metadata=f.c.raw.facts.find(item=>item.fact_kind==='product_metadata');
  const title='劇'.repeat(60);metadata.value.descriptiveFacts.entries.find(item=>item.key==='series_title').value=title;
  const r=f.request(),shared=r.onDeckProductPackage.productMaterialManifest.members.find(item=>
    item.role==='primary_payload'&&item.episodeClaims.length===2);
  const before=r.finalInventoryDecision.members.find(item=>item.sourceMaterialKey===shared.materialKey);
  assert.equal(before.finalName,title+' - S02E01-E02.mkv');
  assert.ok(r.finalInventoryDecision.members.some(item=>item.finalName===title+' - S02E03-part01.mkv'));
  assert.ok(r.finalInventoryDecision.members.some(item=>item.finalName===title+' - S02E01.nfo'));
  const thumbPath=path.join(f.root,'thumb.jpg');fs.writeFileSync(thumbPath,'thumbnail');
  const observed=fingerprint(thumbPath),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),
    sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,
    fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
  const materialKey=D({schema:'physical-material-identity@2',...tuple}),empty=[];
  const thumb={materialKey,role:'sidecar',sizeBytes:tuple.sizeBytes,
    physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,...tuple,materialKey},
    location:{locationKind:'physical_path',endpointId:'endpoint',location:thumbPath},
    episodeClaims:empty,episodeClaimSetDigest:D({schema:'libra.production-material-episode-claims@1',items:empty})};
  const pkg=r.onDeckProductPackage,expanded={...pkg,relatedPrimaryMappings:[{relatedMaterialKey:materialKey,
    finalPrimaryMaterialKey:shared.materialKey,namingKind:'episode_thumb'}],productMaterialManifest:{...pkg.productMaterialManifest,
      members:[...pkg.productMaterialManifest.members,thumb]}};
  const result=f.port.prepare({...r,onDeckProductPackage:expanded});
  const primary=result.members.find(item=>item.sourceMaterialKey===shared.materialKey),related=result.members.find(item=>item.sourceMaterialKey===materialKey);
  assert.equal(primary.finalName,before.finalName);
  assert.equal(related.finalName,path.basename(primary.finalName,'.mkv')+'-thumb.jpg');
  const many=structuredClone(pkg),manyPrimary=many.productMaterialManifest.members.find(item=>item.materialKey===shared.materialKey),
    firstMetadata=many.productFactManifest.items.find(item=>item.factKind==='product_metadata'&&item.sourcePackageId==='first');
  for(let number=4;number<=32;number++)firstMetadata.factValue.episodeMetadata.push({episodeScope:{seasonNumber:2,
    episodeNumber:number,episodeKey:'E'+String(number).padStart(3,'0')}});
  manyPrimary.episodeClaims=Array.from({length:32},(_unused,index)=>{
    const episodeKey='E'+String(index+1).padStart(3,'0'),seasonClaimDigest=D('season');
    return {episodeKey,seasonClaimDigest,claimDigest:D({schema:'libra.production-material-episode-claim@1',episodeKey,seasonClaimDigest})};
  });
  manyPrimary.episodeClaimSetDigest=D({schema:'libra.production-material-episode-claims@1',items:manyPrimary.episodeClaims});
  assert.throws(()=>f.port.prepare({...r,onDeckProductPackage:many}),{code:'CLEAN_ARCA_TARGET_SEGMENT_INVALID'});
  many.resolvedIdentitySnapshot.factValue.title='Short Show';
  const shortDecision=f.port.prepare({...r,onDeckProductPackage:many});
  assert.match(shortDecision.members.find(item=>item.sourceMaterialKey===shared.materialKey).finalName,/ - S02E01-E02-.*-E32\.mkv$/);
  assert.deepEqual(fs.readdirSync(f.target),[]);
});
test('policy target observation exposes a changed Series root while normal intake keeps the durable binding',t=>{
  let binding=null;
  const f=fixture(t,{readSeriesRootBinding:()=>binding});
  binding={rootLocation:path.join(f.target,'Previous Series Root'),endpointId:'endpoint',mountScopeId:'mount'};
  const request=f.request();
  assert.equal(f.port.resolveTargetLocation(request).targetDirectory,path.join(binding.rootLocation,'Season 02'));
  assert.equal(f.port.resolvePolicyTargetLocation(request).targetDirectory,path.join(f.target,'Original Series','Season 02'));
  assert.deepEqual(fs.readdirSync(f.target),[]);
});
for(const [name,mutate] of [
  ['missing title',c=>{c.raw.facts.filter(item=>item.fact_kind==='product_metadata').forEach(item=>{item.value.descriptiveFacts.entries=item.value.descriptiveFacts.entries.filter(entry=>entry.key!=='series_title');});}],
  ['absent scope',c=>{c.raw.materials[0].artifact_scope_schema_ref=null;c.raw.materials[0].artifact_scope_json=null;}],
  ['foreign batch',c=>{const row=c.raw.materials[1],{scopeDigest,...body}=JSON.parse(row.artifact_scope_json);body.sourcePackageId='second';row.artifact_scope_json=canonicalJson({...body,scopeDigest:D(body)});}],
  ['duplicate scope',c=>{c.raw.materials[1].artifact_scope_json=c.raw.materials[2].artifact_scope_json;}],
  ['conflicting Season',c=>{c.raw.facts.find(item=>item.fact_kind==='resolved_identity').value.providerIdentities[0].seasonNumber=3;}],
  ['missing Episode',c=>{c.raw.facts.find(item=>item.fact_kind==='product_metadata'&&item.source_package_id==='second').value.episodeMetadata=[];}],
])test('Series Aftercare placement rejects '+name+' before any target write',t=>{
  const f=fixture(t);mutate(f.c);assert.throws(f.request);assert.deepEqual(fs.readdirSync(f.target),[]);
});

test('Placement assessment compares exact member names even within the same directory',t=>{
  const f=fixture(t),r=f.request(),c=structuredClone(f.c);
  for(const row of c.raw.materials) {
    const expected=r.finalInventoryDecision.members.find(item=>item.sourceMaterialKey===row.material_key);
    row.location=expected.targetLocation;row.endpoint_id=expected.targetEndpointId;
  }
  assert.equal(placementMatchesInventory(c,r),true);
  const row=c.raw.materials[0];row.location=path.join(path.dirname(row.location),'old-name.nfo');
  assert.equal(placementMatchesInventory(c,r),false);
  assert.throws(()=>placementMatchesInventory(c,{finalInventoryDecision:{members:r.finalInventoryDecision.members.slice(1)}}));
});

test('Placement receipts exclude unchanged Inventory members from retirement and settlement',t=>{
  const f=fixture(t),row=f.c.raw.materials[0],identity=require('../../src/helix/domains/arca/model/aftercare-contract').physicalIdentityFromInventoryRow(row),
    receipts=require('../../src/helix/domains/arca/model/aftercare-placement').placementMaterialReceipts,
    stage={schemaRef:'helix://contracts/types/StagedInventoryManifest/v1',stagedMembers:[{
      sourceMaterialKey:row.material_key,endpointId:row.endpoint_id,location:row.location,physicalIdentity:identity}]},
    reader={read:()=>[{outcomeKind:'succeeded',result:stage},{outcomeKind:'succeeded',result:{receiptKind:'placement_switched',receiptId:'switch',committedAtMs:1}}]};
  assert.deepEqual(receipts(f.c,reader,'work',{aftercareCaseId:'case',careRequirementDigest:D('requirement')}),[]);
});
