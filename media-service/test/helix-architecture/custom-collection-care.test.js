'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {BETA_RECOMMENDED_RULES}=require('../../src/helix/domains/arca/model/rule-template-contracts');
const {effectiveRequirements}=require('../../src/helix/domains/arca/model/care-objective');
const {assertCollectionCareTarget}=require('../../src/helix/domains/arca/model/collection-care-target');
const {createAftercareContextReader}=require('../../src/helix/domains/arca/application/aftercare-context-reader');
const {createAftercareCapabilityPorts,probeConformance}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

function requirements(){return structuredClone(BETA_RECOMMENDED_RULES.profileRuleSets.find(item=>item.contentProfile==='movie')
  .decisionBranches.find(item=>item.rating===5).requirements);}
function customRequirements(){const value=requirements();value.mandatoryMedia.minimumRasterClass='none';
  value.metadata.requiredArtifactKinds=value.metadata.requiredArtifactKinds.filter(item=>item!=='poster');
  value.inventory.requiredMaterializedArtifactKinds=value.inventory.requiredMaterializedArtifactKinds.filter(item=>item!=='poster');return value;}
function target(value,{kind='user_custom',revision=1,entry='entry',shelf='shelf',inventoryRevision=1}={}){
  const body={schemaRef:'arca.collection-care-target@1',shelfEntryId:entry,shelfId:shelf,inventoryRevision,
    contentProfile:'movie',structureKind:'single',targetKind:kind,targetRevision:revision,intentId:'intent-'+revision,
    intentDigest:canonicalDigest('intent-'+revision),requirements:value,requirementsDigest:canonicalDigest(value)};
  return {...body,projectionDigest:canonicalDigest(body)};
}
function raw(targetValue){return {entry:{status:'active',structure_kind:'single',current_inventory_revision:1},
  shelf:{shelf_id:'shelf',status:'active',target_endpoint_id:'endpoint',current_standard_revision:1,current_placement_revision:1},
  standard:{standard_digest:canonicalDigest('standard'),value:{profileRuleSets:[{contentProfile:'movie',decisionInputKinds:[],baseRequirements:requirements()}]}},
  identity:{identity_kind:'tmdb_movie',identity_digest:canonicalDigest('identity'),revision:1,provider:'tmdb',provider_key:'1'},
  inventory:{source_package_id:'package',representation_digest:canonicalDigest('inventory')},
  placement:{policy_digest:canonicalDigest({}),value:{}},materials:[],oldBindings:[],facts:[],collectionTarget:targetValue};}

test('custom and restored collection targets select exact requirements without waiving audio, size or safety',()=>{
  const chosen=target(customRequirements()),context={shelfEntryId:'entry',raw:raw(chosen)},
    valid={resultKind:'probed',container:'matroska',videoStreams:[{codec:'hevc',width:1920,height:1080}],
      audioStreams:[{codec:'dts',normalizedAudioClass:'dts_hd_ma'}]};
  context.raw.materials=[{role:'primary_payload',material_key:canonicalDigest('primary'),location:'/shelf/movie.mkv',size_bytes:100}];
  assert.deepEqual(probeConformance(context,valid),[]);
  assert.equal(effectiveRequirements(context).space.maxSizeGiB,50);
  assert.deepEqual(effectiveRequirements(context).mandatoryMedia.acceptedPrimaryAudioClasses,requirements().mandatoryMedia.acceptedPrimaryAudioClasses);
  assert.ok(probeConformance(context,{...valid,audioStreams:[{codec:'aac'}]}).some(item=>item.schemaRef.includes('/primary_audio_unmet/')));
  assert.ok(probeConformance(context,{...valid,resultKind:'not_media'}).some(item=>item.schemaRef.includes('/primary_decode_failed/')));
  context.raw.materials[0].size_bytes=51*1024**3;
  assert.ok(probeConformance(context,valid).some(item=>item.schemaRef.includes('/max_size_exceeded/')));
  context.raw.materials[0].size_bytes=100;context.raw.collectionTarget=target(requirements(),{kind:'standard',revision:2});
  assert.ok(probeConformance(context,valid).some(item=>item.schemaRef.includes('/minimum_raster_unmet/')));
});

test('collection target projections reject corruption, foreign Entry or Inventory, and weakened safety',()=>{
  const original=target(customRequirements());
  for(const change of [value=>{value.shelfId='foreign';},value=>{value.inventoryRevision=2;},
    value=>{value.requirements.inventory.requireChecksum=false;},value=>{value.requirements.identity.identityKind='internal_identity';}]){
    const value=structuredClone(original);change(value);value.requirementsDigest=canonicalDigest(value.requirements);
    value.projectionDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='projectionDigest')));
    assert.throws(()=>assertCollectionCareTarget(value,'entry',{shelfId:'shelf',inventoryRevision:1}),{code:'ARCA_COLLECTION_TARGET_INVALID'});
  }
  assert.throws(()=>assertCollectionCareTarget({...original,unexpected:true},'entry'),{code:'ARCA_COLLECTION_TARGET_INVALID'});
});

test('detail and batched health bind their basis to the same fenced current target',()=>{
  let current=target(customRequirements()),stale=false;const stored=raw(null),token={},unitOfWork={captureReadFence:()=>token,
    assertReadFence(value){assert.equal(value,token);if(stale)throw Object.assign(new Error('changed'),{code:'P3_UOW_READ_FENCE_CHANGED'});}},
    item={shelfEntryId:'entry',shelfId:'shelf',structureKind:'single',inventoryRevision:1,standardRevision:1,placementRevision:1,
      canonicalIdentity:stored.identity,canonicalIdentityDigest:stored.identity.identity_digest,sourcePackageId:'package',
      materialRoles:[],standardValue:stored.standard.value,acceptedPackageReference:null,decisionFacts:[],factDigests:[],decisionFactDigests:[],
      authorizedDefectManifest:null,history:{assessments:[],findings:[],cases:[],commits:[]}},
    aftercareStore={currentContext:()=>stored,healthProjectionInputs:()=>[item],defectStore:{current:()=>null,currentMany:()=>new Map()},
      healthAssessmentHistory:()=>new Map([['entry',{assessments:[],findings:[]} ]])},
    collectionTargetPort={readMany(ids,{readFence}){assert.equal(readFence,token);return new Map(ids.map(id=>[id,current]));}},
    reader=createAftercareContextReader({aftercareStore,unitOfWork,collectionTargetPort});
  const detail=reader.read('entry'),batch=reader.healthProjectionInputs(['entry'])[0];
  assert.deepEqual(effectiveRequirements(detail),current.requirements);assert.deepEqual(batch.effectiveRequirements,current.requirements);
  assert.equal(detail.basis.digest,batch.basis.digest);
  current=target(requirements(),{kind:'standard',revision:2});const restored=reader.read('entry');
  assert.notEqual(restored.basis.digest,detail.basis.digest);assert.equal(effectiveRequirements(restored).mandatoryMedia.minimumRasterClass,'4k');
  stale=true;assert.throws(()=>reader.read('entry'),{code:'P3_UOW_READ_FENCE_CHANGED'});
  const incomplete=createAftercareContextReader({aftercareStore,unitOfWork:{...unitOfWork,assertReadFence(){}},collectionTargetPort:{readMany:()=>new Map()}});
  assert.throws(()=>incomplete.read('entry'),{code:'ARCA_COLLECTION_TARGET_READER_UNAVAILABLE'});
});

test('custom optional poster does not recur as missing, but loss of a registered poster remains damage',async()=>{
  const context=require('./fixtures/jav-correction').context();context.shelfEntryId='entry';context.raw=raw(target(customRequirements()));
  context.basis={digest:canonicalDigest('basis'),inventoryRevision:1,standardRevision:1,placementRevision:1,
    decisionFactSetDigest:canonicalDigest('decision')};
  const ports=createAftercareCapabilityPorts({schemaManifest,unitOfWork:{execute(){throw new Error('No writes expected.');}},
    contextReader:{read:()=>context,store:{history:()=>({cases:[],findings:[],commits:[]})}},workResultReader:{read:()=>[]},
    computeBoundedMaterialFingerprintSync(){throw new Error('No media read expected.');},now:()=>1000});
  const observe=async()=>ports[C.presentation].execute({ownerScope:{processId:'entry'},workId:'assessment'});
  const absent=await observe();assert.equal(absent.result.findingDrafts.some(item=>item.schemaRef.includes('/poster_missing/')),false);
  context.raw.materials=[{role:'poster',material_key:'registered-poster',location:'Z:/missing-poster-for-test.jpg'}];
  const lost=await observe();assert.equal(lost.result.findingDrafts.some(item=>item.schemaRef.includes('/poster_missing/')),true);
});
