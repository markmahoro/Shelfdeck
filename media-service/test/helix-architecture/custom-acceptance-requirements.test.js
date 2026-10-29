'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {BETA_RECOMMENDED_RULES}=require('../../src/helix/domains/arca/model/rule-template-contracts');
const {describeCustomRequirement,applyCustomRequirementChanges}=require('../../src/helix/contracts/custom-acceptance-requirements');
const requirements=profile=>BETA_RECOMMENDED_RULES.profileRuleSets.find(row=>row.contentProfile===profile)
  .decisionBranches.find(row=>row.rating===5).requirements;
const delta=(base,requirementCode,targetId,episodeScope,scopes=[])=>describeCustomRequirement(base,{requirementCode,targetId,...(episodeScope?{episodeScope}:{})},scopes);

test('three-film target changes preserve the true rating target basis, 50 GiB and every unrelated requirement',()=>{
  const base=requirements('movie'),before=canonicalJson(base);
  for(const [title,audio] of [['黑水',true],['三峡好人',true],['登堂入室',false]]){
    const changes=[delta(base,'minimum_raster_unmet','minimumRasterClass'),...(audio?[delta(base,'primary_audio_unmet','acceptedPrimaryAudioClasses')]:[])],
      result=applyCustomRequirementChanges({requirements:base,changes});
    assert.equal(result.requirements.mandatoryMedia.minimumRasterClass,'none',title);
    assert.deepEqual(result.requirements.mandatoryMedia.acceptedPrimaryAudioClasses,audio?[]:base.mandatoryMedia.acceptedPrimaryAudioClasses);
    assert.equal(result.requirements.space.maxSizeGiB,50);assert.deepEqual(result.requirements.metadata,base.metadata);
    assert.deepEqual(result.requirements.identity,base.identity);assert.deepEqual(result.requirements.inventory,base.inventory);
    assert.equal(result.requirements.mandatoryMedia.videoCodec,'hevc');assert.equal(result.episodeMetadataOverrides.length,0);
  }
  assert.equal(canonicalJson(base),before);
});

test('a missing Episode plot changes only its explicit local scope',()=>{
  const base=requirements('series'),one={episodeKey:'E001',episodeNumber:1,seasonNumber:5},two={episodeKey:'E002',episodeNumber:2,seasonNumber:5},
    change=delta(base,'metadata_field_unmet','episode_plot',one,[one,two]),
    result=applyCustomRequirementChanges({requirements:base,changes:[change],episodeScopes:[one,two]});
  assert.ok(result.requirements.metadata.requiredFieldCodes.includes('episode_plot'));
  assert.equal(result.episodeMetadataOverrides.length,1);assert.deepEqual(result.episodeMetadataOverrides[0].episodeScope,one);
  assert.equal(result.episodeMetadataOverrides[0].requiredFieldCodes.includes('episode_plot'),false);
  assert.throws(()=>applyCustomRequirementChanges({requirements:base,changes:[change],episodeScopes:[two]}),{code:'CUSTOM_TARGET_SCOPE_INVALID'});
  assert.throws(()=>delta(base,'metadata_field_unmet','episode_plot'),{code:'CUSTOM_TARGET_PROTECTED_REQUIREMENT'});
});

test('image relaxation changes both requested and materialized roles while keeping NFO and file safety',()=>{
  const base=requirements('movie'),result=applyCustomRequirementChanges({requirements:base,changes:[delta(base,'metadata_artifact_unmet','poster')]});
  assert.equal(result.requirements.metadata.requiredArtifactKinds.includes('poster'),false);
  assert.equal(result.requirements.inventory.requiredMaterializedArtifactKinds.includes('poster'),false);
  assert.ok(result.requirements.metadata.requiredArtifactKinds.includes('nfo'));
  assert.equal(result.requirements.inventory.requireChecksum,true);
  assert.equal(result.requirements.inventory.requireDomainBinding,true);
});

test('identity, playback, integrity, NFO, paths and arbitrary replacement values cannot become custom exceptions',()=>{
  const base=requirements('movie');
  for(const [code,id] of [['identity_unmet','identityKind'],['playback_decode_failed','playback'],['metadata_field_unmet','tmdb_movie_id'],
    ['metadata_field_unmet','title'],['metadata_artifact_unmet','nfo'],['path_escape','root']])
    assert.throws(()=>delta(base,code,id),{code:'CUSTOM_TARGET_PROTECTED_REQUIREMENT'});
  assert.throws(()=>describeCustomRequirement(base,{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass',newValue:'fake4k'}),
    {code:'CUSTOM_TARGET_CHANGE_INVALID'});
});

test('stale, duplicate and no-op changes fail and input order does not change target identity',()=>{
  const base=requirements('movie'),a=delta(base,'minimum_raster_unmet','minimumRasterClass'),b=delta(base,'primary_audio_unmet','acceptedPrimaryAudioClasses');
  assert.deepEqual(applyCustomRequirementChanges({requirements:base,changes:[a,b]}),applyCustomRequirementChanges({requirements:base,changes:[b,a]}));
  assert.throws(()=>applyCustomRequirementChanges({requirements:base,changes:[{...a,requiredValueDigest:'f'.repeat(64)}]}),{code:'CUSTOM_TARGET_REQUIREMENT_STALE'});
  assert.throws(()=>applyCustomRequirementChanges({requirements:base,changes:[a,a]}),{code:'CUSTOM_TARGET_DUPLICATE_CHANGE'});
  const target=applyCustomRequirementChanges({requirements:base,changes:[a]}).requirements;
  assert.throws(()=>delta(target,'minimum_raster_unmet','minimumRasterClass'),{code:'CUSTOM_TARGET_NO_CHANGE'});
  assert.throws(()=>applyCustomRequirementChanges({requirements:base,changes:[]}),{code:'CUSTOM_TARGET_CHANGE_LIMIT'});
});
