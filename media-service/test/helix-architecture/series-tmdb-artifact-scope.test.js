'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createTmdbProviderAdapter}=require('../../src/helix/integrations/tmdb-provider-adapter');
const {buildImageSource:buildSeriesPresentationSource}=require('../../src/helix/contracts/series-image-source');
const D=value=>canonicalDigest({value});
const identity={provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber:3};identity.identityAnchorDigest=canonicalDigest(identity);
const source=buildSeriesPresentationSource({provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonIdentityAnchorDigest:identity.identityAnchorDigest,
  integrationId:'tmdb-main',configRevision:2,language:'zh-CN',sourceRef:'tmdb:tv:1399',title:'Show',originalTitle:'Show',firstAirDate:'2008-01-20',plot:'Whole show',genres:[]});

function harness(){
  const calls=[],bytes=Buffer.from('controlled transport bytes; decoding is verified by the separate real image IO fixture');
  let currentHandle;
  const adapter=createTmdbProviderAdapter({integrationQueryPort:{query:()=>({state:'active',integrationType:'tmdb',integrationId:'tmdb-main',configRevision:2,
    endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_access_token',secretRef:'fixture-secret',settings:{language:'zh-CN'}})},
    integrationHandleResolverPort:{resolve:()=>currentHandle},secretLeaseResolverPort:{resolve:()=>({leaseId:'fixture-lease'})},
    secretLeaseConsumer:{consumeAsync:async(_lease,consume)=>consume(Buffer.from('disposable-fixture-token'))},
    fetchImpl:async value=>{
      const url=new URL(value);calls.push(url.pathname);
      if(url.hostname==='image.tmdb.org')return new Response(bytes,{headers:{'content-type':'image/jpeg'}});
      const season=url.pathname.includes('/season/');
      return new Response(JSON.stringify({id:season?93070:1399,
        posters:[{file_path:season?'/season3.jpg':'/show.jpg',iso_639_1:'zh',width:600,height:900,vote_average:8}],
        backdrops:[{file_path:'/show-wide.jpg',iso_639_1:null,width:1600,height:900,vote_average:8}],
        stills:[{file_path:'/episode.jpg',iso_639_1:null,width:1600,height:900,vote_average:8}]}));
    }});
  async function execute(operationId,input,port='artifactPort'){
    currentHandle={integrationId:'tmdb-main',integrationType:'tmdb',configRevision:2,allowedOperation:operationId,fenceDigest:D(operationId)};
    return adapter[port].execute({operationId,integrationHandle:currentHandle,input,timeoutMs:1000});
  }
  return {calls,bytes,execute};
}

test('Season poster and show poster use distinct exact TMDB image endpoints',async()=>{
  const h=harness();
  await h.execute('libra.product_artifact.acquire@1',{artifactKind:'poster',resolvedProviderIdentity:identity,artifactScope:{scopeKind:'season',seasonNumber:3}});
  await h.execute('libra.product_artifact.acquire@1',{artifactKind:'poster',resolvedProviderIdentity:identity,artifactScope:{scopeKind:'series'}});
  assert.deepEqual(h.calls,['/3/tv/1399/season/3/images','/t/p/original/season3.jpg','/3/tv/1399/images','/t/p/original/show.jpg']);
});

test('shared preparation reacquires only its frozen show image locator without repeating image selection',async()=>{
  const h=harness(),observed=await h.execute('arca.series_presentation.source.observe@1',
    {artifactKind:'fanart',seriesPresentationSource:source},'observationPort');
  assert.equal(observed.imagePath,'/show-wide.jpg');assert.equal(observed.sourceDigest,source.qualificationDigest);
  const prepared=await h.execute('arca.series_presentation.assets.prepare@1',
    {artifactKind:'fanart',seriesPresentationSource:source,imagePath:observed.imagePath});
  assert.deepEqual(prepared.bytes,h.bytes);
  assert.deepEqual(h.calls,['/3/tv/1399/images','/t/p/original/show-wide.jpg','/t/p/original/show-wide.jpg']);
});

test('Series source observation and workspace acquisition reject the opposite effect port',async()=>{
  const h=harness();
  await assert.rejects(h.execute('arca.series_presentation.source.observe@1',
    {artifactKind:'poster',seriesPresentationSource:source},'artifactPort'),{code:'PLATFORM_TMDB_EFFECT_CLASS_MISMATCH'});
  await assert.rejects(h.execute('arca.series_presentation.assets.prepare@1',
    {artifactKind:'poster',seriesPresentationSource:source,imagePath:'/show.jpg'},'observationPort'),
    {code:'PLATFORM_TMDB_EFFECT_CLASS_MISMATCH'});
  assert.equal(h.calls.length,0);
});

test('unscoped Series images, foreign Seasons and configuration substitution are rejected before transport',async()=>{
  const h=harness();
  for(const input of [{artifactKind:'poster',resolvedProviderIdentity:identity},
    {artifactKind:'poster',resolvedProviderIdentity:identity,artifactScope:{scopeKind:'season',seasonNumber:4}},
    {artifactKind:'poster',resolvedProviderIdentity:identity,artifactScope:{scopeKind:'episode',seasonNumber:3,episodeNumber:1}}])
    await assert.rejects(h.execute('libra.product_artifact.acquire@1',input),{code:'PLATFORM_TMDB_ARTIFACT_SCOPE_INVALID'});
  const {qualificationDigest,...raw}=source,changed=buildSeriesPresentationSource({...raw,configRevision:3});
  await assert.rejects(h.execute('arca.series_presentation.source.observe@1',{artifactKind:'poster',seriesPresentationSource:changed},'observationPort'),
    {code:'PLATFORM_TMDB_SERIES_PRESENTATION_STALE'});
  assert.equal(h.calls.length,0);
});

test('an explicit Episode still cannot be returned as a show poster or fanart',async()=>{
  const h=harness();
  const result=await h.execute('libra.product_artifact.acquire@1',{artifactKind:'still',resolvedProviderIdentity:identity,
    artifactScope:{scopeKind:'episode',seasonNumber:3,episodeNumber:2}});
  assert.equal(result.artifactKind,'still');
  assert.deepEqual(h.calls,['/3/tv/1399/season/3/episode/2/images','/t/p/original/episode.jpg']);
});
