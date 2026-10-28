'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {assertCustomAcceptanceSpec}=require('../../src/helix/domains/libra/model/custom-acceptance-spec');
const {fixture}=require('./fixtures/custom-acceptance-spec-harness');
const raster={requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'},audio={requirementCode:'primary_audio_unmet',targetId:'acceptedPrimaryAudioClasses'};

test('custom Spec preserves the original five-star target and changes only the two confirmed media requirements',()=>{
  const h=fixture(),original=canonicalJson(h.baseSpec),chosen=h.target([raster,audio]),spec=h.build(chosen);
  assert.equal(spec.targetKind,'user_custom');assert.equal(spec.schemaRef,'libra.acceptance-spec@1');assert.equal(spec.specRevision,2);
  assert.equal(spec.requirements.mandatoryMedia.minimumRasterClass,'none');assert.deepEqual(spec.requirements.mandatoryMedia.acceptedPrimaryAudioClasses,[]);
  assert.equal(spec.requirements.space.maxSizeGiB,50);assert.equal(spec.requirements.mandatoryMedia.videoCodec,'hevc');
  assert.equal(spec.originalTarget.requirements.mandatoryMedia.minimumRasterClass,'4k');assert.equal(spec.originalTarget.recordDigest,h.baseSpec.recordDigest);
  assert.notEqual(spec.acceptanceSpecId,h.baseSpec.acceptanceSpecId);assert.notEqual(spec.specDigest,h.baseSpec.specDigest);
  assert.equal(spec.customTargetRef.intentDigest,chosen.intent.intentDigest);assert.equal(Object.isFrozen(spec.originalTarget.requirements),true);
  assert.equal(canonicalJson(h.baseSpec),original);assert.deepEqual(assertCustomAcceptanceSpec({spec,baseSpec:h.baseSpec,...chosen}),spec);
});

test('one missing local Episode plot remains a per-Episode exception in the published target',()=>{
  const h=fixture('series'),chosen=h.target([{requirementCode:'metadata_field_unmet',targetId:'episode_plot',episodeScope:h.episodeScopes[0]}]),spec=h.build(chosen);
  assert.ok(spec.requirements.metadata.requiredFieldCodes.includes('episode_plot'));
  assert.deepEqual(spec.episodeMetadataOverrides.map(row=>row.episodeScope),[h.episodeScopes[0]]);
  assert.equal(spec.episodeMetadataOverrides[0].requiredFieldCodes.includes('episode_plot'),false);
  assert.deepEqual(spec.productScope.episodeKeys,['E001','E002']);
});

test('a different confirmation of identical requirements preserves semantics and changes provenance identity',()=>{
  const h=fixture(),a=h.build(h.target([raster],'admin-a')),b=h.build(h.target([raster],'admin-b'));
  assert.equal(a.specDigest,b.specDigest);assert.notEqual(a.recordDigest,b.recordDigest);assert.notEqual(a.acceptanceSpecId,b.acceptanceSpecId);
});

test('base record corruption, another baseline and nested custom Specs cannot become a target source',()=>{
  const h=fixture(),chosen=h.target([raster]),spec=h.build(chosen);
  for(const baseSpec of [{...h.baseSpec,recordDigest:D('changed')},{...h.baseSpec,requirements:{...h.baseSpec.requirements,space:{maxSizeGiB:null,maxSizeBytes:null}}},spec])
    assert.throws(()=>h.build(chosen,{baseSpec}),{code:'LIBRA_CUSTOM_SPEC_BASE_INVALID'});
  assert.throws(()=>h.build(chosen,{specRevision:1}),{code:'LIBRA_CUSTOM_SPEC_PUBLICATION_INVALID'});
});

test('the final Spec must rebuild from the exact intent, original requirements and complete local scope',()=>{
  const h=fixture(),chosen=h.target([raster]),spec=h.build(chosen),altered=JSON.parse(canonicalJson(spec));
  altered.requirements.space.maxSizeGiB=null;altered.requirements.space.maxSizeBytes=null;
  assert.throws(()=>assertCustomAcceptanceSpec({spec:altered,baseSpec:h.baseSpec,...chosen}),{code:'LIBRA_CUSTOM_SPEC_RECORD_INVALID'});
  assert.throws(()=>assertCustomAcceptanceSpec({spec:{...spec,collectionOwned:true},baseSpec:h.baseSpec,...chosen}),{code:'LIBRA_CUSTOM_SPEC_RECORD_INVALID'});
  const other=h.target([raster,audio]);
  assert.throws(()=>assertCustomAcceptanceSpec({spec,baseSpec:h.baseSpec,...other}),{code:'LIBRA_CUSTOM_SPEC_RECORD_INVALID'});
});
