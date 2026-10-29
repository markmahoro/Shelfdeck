'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {selectEpisodePlot,assertEpisodePlotBinding}=require('../../src/helix/contracts/episode-plot-source');
const {buildMetadataFetchIntent,buildMetadataObservation}=require('../../src/helix/domains/libra/model/product-fact-contracts');
const localScope={episodeKey:'E001',seasonNumber:5,episodeNumber:1},
  providerEpisode={provider:'tmdb',providerKey:'105',seasonNumber:5,episodeNumber:1,episodeId:50001},
  row=(lang,country,overview)=>({iso_639_1:lang,iso_3166_1:country,data:{overview}}),
  select=translations=>selectEpisodePlot({response:{id:50001,translations},providerEpisode,localScope,requestedLanguage:'zh-CN',originalLanguage:'en'});

test('same-Episode plot chooses a real translation in deterministic language order',()=>{
  const translations=[row('en','US','English same-Episode plot'),row('zh','CN',''),row('zh','TW','同一集繁體劇情'),row('fr','FR','French plot')],
    result=select(translations);
  assert.equal(result.plot,'同一集繁體劇情');assert.equal(result.proof.selectedLanguage,'zh-TW');
  assert.deepEqual(select([...translations].reverse()),result);
  assert.equal(select([row('fr','FR','French'),row('en','US','English')]).plot,'English');
  assert.equal(select([row('fr','FR','French')]).proof.selectedLanguage,'fr-FR');
});

test('genuine absence records same-Episode evidence without inventing a plot',()=>{
  for(const rows of [[],[row('zh','CN',' '),row('en','US',null)]]){
    const result=select(rows);assert.equal(result.plot,null);assert.equal(result.proof.result,'not_available');
    assert.equal(result.proof.selectedLanguage,null);assert.equal(result.proof.plotDigest,null);
    assert.match(result.proof.translationSetDigest,/^[a-f0-9]{64}$/);
  }
});

test('foreign Episode, conflicting locales, invalid responses and unbounded plots fail closed',()=>{
  const invalid=[{id:50002,translations:[]},{id:50001,translations:new Array(129)},
    {id:50001,translations:[row('en','US','one'),row('en','US','different')]},
    {id:50001,translations:[row('en','US',123)]},{id:50001,translations:[row('en','US','x'.repeat(16*1024+1))]}];
  for(const response of invalid)assert.throws(()=>selectEpisodePlot({response,providerEpisode,localScope,requestedLanguage:'zh-CN',originalLanguage:'en'}),
    {code:'PLATFORM_TMDB_EPISODE_TRANSLATIONS_INVALID'});
});

function intent(mapping=null){
  const identity={provider:'tmdb',namespace:'tmdb_series',providerKey:'105',seasonNumber:5};
  identity.identityAnchorDigest=canonicalDigest(identity);
  return buildMetadataFetchIntent({libraRunId:'run',runExecutionBasisDigest:'a'.repeat(64),sourceKind:'provider',sourcePriority:0,
    contentProfile:'series',resolvedIdentityDigest:'b'.repeat(64),requestedFields:['episode_plot'],providerKind:'tmdb',integrationId:'tmdb',configRevision:1,
    resolvedProviderIdentity:identity,episodeScope:localScope,episodePlotPolicyRef:require('../../src/helix/contracts/episode-plot-source').POLICY,
    ...(mapping?{episodeMapping:mapping}:{})});
}
test('metadata Observation retains exact translation provenance and refuses foreign scope or changed plot bytes',()=>{
  const selected=select([row('en','US','Exact plot')]),fetch=intent(),entries=[{key:'episode_plot',value:selected.plot}],
    observation=buildMetadataObservation({intent:fetch,descriptiveEntries:entries,providerIdentities:[fetch.resolvedProviderIdentity],
      episodePlotSourceProof:selected.proof,observedAtMs:1000});
  assert.deepEqual(observation.episodePlotSourceProof,selected.proof);
  assertEpisodePlotBinding(selected.proof,fetch,entries);
  for(const change of [{...fetch,episodeScope:{...localScope,episodeNumber:2,episodeKey:'E002'}},
    {...fetch,resolvedProviderIdentity:{...fetch.resolvedProviderIdentity,providerKey:'999'}},{...fetch,sourceKind:'related_nfo'}])
    assert.throws(()=>assertEpisodePlotBinding(selected.proof,change,entries),{code:'EPISODE_PLOT_SOURCE_INVALID'});
  assert.throws(()=>assertEpisodePlotBinding(selected.proof,fetch,[{key:'episode_plot',value:'Borrowed plot'}]),{code:'EPISODE_PLOT_SOURCE_INVALID'});
  assert.throws(()=>assertEpisodePlotBinding(selected.proof,fetch,[]),{code:'EPISODE_PLOT_SOURCE_INVALID'});
});

test('confirmed special lookup preserves local numbering and refuses an unconfirmed cross-season plot',()=>{
  const special={...providerEpisode,seasonNumber:0,episodeId:90001},
    selected=selectEpisodePlot({response:{id:90001,translations:[row('en','US','Special plot')]},providerEpisode:special,
      localScope,requestedLanguage:'zh-CN',originalLanguage:'en'}),
    mapped={...intent(),episodeMapping:{providerEpisode:special}},entries=[{key:'episode_plot',value:selected.plot}];
  assertEpisodePlotBinding(selected.proof,mapped,entries);
  assert.equal(selected.proof.localScope.seasonNumber,5);assert.equal(selected.proof.providerEpisode.seasonNumber,0);
  assert.throws(()=>assertEpisodePlotBinding(selected.proof,intent(),entries),{code:'EPISODE_PLOT_SOURCE_INVALID'});
});

test('the declared language policy changes the exact Intent without rewriting a single-language source Intent',()=>{
  const current=intent(),{intentId,intentDigest,episodePlotPolicyRef,...base}=current,
    singleLanguage=buildMetadataFetchIntent(base);
  assert.notEqual(singleLanguage.intentDigest,current.intentDigest);
  assert.deepEqual(buildMetadataFetchIntent(singleLanguage),singleLanguage);
  assert.equal(singleLanguage.episodePlotPolicyRef,undefined);
  for(const change of [{episodePlotPolicyRef:'unapproved-policy'},{episodeScope:undefined},{requestedFields:['episode_title']}])
    assert.throws(()=>buildMetadataFetchIntent({...base,episodePlotPolicyRef,...change}),
      error=>['P9_METADATA_EPISODE_PLOT_POLICY','P9_METADATA_EPISODE_SCOPE'].includes(error.code));
});
