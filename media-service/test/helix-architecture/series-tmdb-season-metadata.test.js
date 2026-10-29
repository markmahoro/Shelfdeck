'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createTmdbProviderAdapter } = require('../../src/helix/integrations/tmdb-provider-adapter');

const operationId = 'libra.product_metadata.fetch@1';
const { projectMappedEpisode } = require('../../src/helix/domains/libra/model/episode-metadata-mapping');
const handle = Object.freeze({ integrationId:'series-tmdb', integrationType:'tmdb',
  configRevision:1, allowedOperation:operationId, fenceDigest:'f'.repeat(64) });

function identity(overrides = {}) {
  const basis = { provider:'tmdb', namespace:'tmdb_series', providerKey:'1399', seasonNumber:1, ...overrides };
  return Object.freeze({ ...basis, identityAnchorDigest:canonicalDigest(basis) });
}

function harness(overrides = {}) {
  const calls = [];
  const show = { id:1399, name:'Demo Show', overview:'Series plot', genres:[{ id:18, name:'Drama' }],
    credits:{ cast:[{ id:1001, name:'Fixture Actor' }], crew:[] } };
  const season = { id:3624, season_number:1, episodes:[{ id:63999, season_number:1, episode_number:99, name:'Outside delivery' }] };
  const episode = { id:63056, season_number:1, episode_number:1, name:'Episode One', overview:'Episode One plot' };
  const adapter = createTmdbProviderAdapter({
    now:overrides.now,
    integrationQueryPort:{ query:() => ({ state:overrides.state || 'active', integrationType:'tmdb', integrationId:handle.integrationId,
      configRevision:overrides.handle?.configRevision || 1, endpoint:'https://api.themoviedb.org/3', secretKind:'tmdb_access_token',
      secretRef:'fixture-secret', settings:{ language:overrides.language || 'zh-CN' } }) },
    integrationHandleResolverPort:{ resolve:() => overrides.handle || handle },
    secretLeaseResolverPort:{ resolve:() => ({ leaseId:'fixture-lease' }) },
    secretLeaseConsumer:{ consumeAsync:async (_lease, consume) => consume(Buffer.from('disposable-secret')) },
    fetchImpl:async (url, init) => {
      calls.push({ pathname:url.pathname, language:url.searchParams.get('language') });
      if (overrides.error) throw overrides.error;
      if (overrides.timeout) await new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason), {once:true}));
      if(url.pathname.endsWith('/translations'))return new Response(JSON.stringify(overrides.translations??
        {id:(overrides.episode??episode).id,translations:[]}),{status:overrides.translationsStatus??200});
      const isSeason = url.pathname.includes('/season/');
      const isEpisode = url.pathname.includes('/episode/');
      return new Response(JSON.stringify(isEpisode ? (overrides.episode ?? episode) :
        isSeason ? (overrides.season ?? season) : (overrides.show ?? show)),
        { status:isEpisode ? (overrides.episodeStatus ?? 200) : isSeason ? (overrides.seasonStatus ?? 200) : 200 });
    },
  });
  const fetch = (input = {}, suppliedHandle = overrides.handle || handle) => adapter.observationPort.execute({
    operationId, integrationHandle:suppliedHandle, timeoutMs:1000,
    input:{ resolvedProviderIdentity:identity(),
      requestedFields:['genre', 'plot', 'season_number', 'series_title'], ...input,
      ...(input.episodeScope&&input.requestedFields?.includes('episode_plot')&&overrides.supplementation!==false?
        {episodePlotPolicyRef:require('../../src/helix/contracts/episode-plot-source').POLICY}:{}), },
  });
  return { calls, fetch };
}

test('Series metadata observes exact Season, exposes required fields, and never expands Episode delivery', async () => {
  const fixture = harness();
  const result = await fixture.fetch();
  assert.deepEqual(result.descriptiveEntries, [
    { key:'genre', value:'Drama' }, { key:'plot', value:'Series plot' },
    { key:'season_number', value:1 }, { key:'series_title', value:'Demo Show' },
    { key:'tmdb_series_id', value:'1399' },
  ]);
  assert.deepEqual(result.providerIdentities, [identity()]);
  assert.equal(result.sourceRef, 'tmdb:tv:1399:season:1');
  assert.equal(result.peopleHints[0].providerIdentities[0].providerKey, '1001');
  assert.deepEqual(fixture.calls, [
    { pathname:'/3/tv/1399', language:'zh-CN' },
    { pathname:'/3/tv/1399/season/1', language:'zh-CN' },
  ]);
  assert.equal(Object.hasOwn(result, 'episodes'), false);
  assert.equal(Object.hasOwn(result, 'episodeKeys'), false);
});

for (const [localSeason, localEpisode, providerSeason, providerEpisode, episodeId] of [[2,9,0,2,4002],[6,9,0,11,4011],[1,11,2,1,5001]]) {
  test(`confirmed Provider S${providerSeason}E${providerEpisode} lookup preserves local S${localSeason}E${localEpisode}`, async () => {
    const reference = { provider: 'tmdb', providerKey: '1399', seasonNumber: providerSeason, episodeNumber: providerEpisode, episodeId };
    const localScope = { seasonNumber: localSeason, episodeNumber: localEpisode, episodeKey: 'E' + String(localEpisode).padStart(3,'0') };
    const f = harness({ season: { id: 42, season_number: providerSeason, episodes: [] },
      episode: { id: episodeId, show_id: 1399, season_number: providerSeason, episode_number: providerEpisode, name: 'Confirmed title', overview: 'Confirmed plot' } });
    const result = await f.fetch({ resolvedProviderIdentity: identity({ seasonNumber: localSeason }), episodeScope: localScope,
      providerEpisodeReference: reference, requestedFields: ['episode_number','episode_plot','episode_title','season_number'] });
    assert.equal(f.calls.at(-1).pathname, `/3/tv/1399/season/${providerSeason}/episode/${providerEpisode}`);
    assert.deepEqual(result.providerEpisodeReference, reference);
    assert.equal(result.descriptiveEntries.find(row => row.key === 'season_number').value, providerSeason, 'Adapter keeps observed Provider coordinates');
    const projected = new Map(projectMappedEpisode({ localScope, providerEpisode: reference }, {
      providerEpisode: result.providerEpisodeReference, descriptiveEntries: result.descriptiveEntries }).map(row => [row.key, row.value]));
    assert.equal(projected.get('season_number'), localSeason);
    assert.equal(projected.get('episode_number'), localEpisode);
    assert.equal(projected.get('episode_plot'), 'Confirmed plot');
    assert.equal(result.sourceRef, `tmdb:tv:1399:season:${providerSeason}:episode:${providerEpisode}`);
  });
}

test('confirmed mappings reject another show, changed Episode ID and 404 without borrowing metadata', async () => {
  const reference = { provider: 'tmdb', providerKey: '1399', seasonNumber: 0, episodeNumber: 2, episodeId: 4002 };
  const input = { episodeScope: { seasonNumber: 1, episodeNumber: 9, episodeKey: 'E009' }, providerEpisodeReference: reference,
    requestedFields: ['episode_number','episode_plot','episode_title','season_number'] };
  const invalid = harness();
  await assert.rejects(invalid.fetch({ ...input, providerEpisodeReference: { ...reference, providerKey: '99' } }), { code: 'PLATFORM_TMDB_IDENTITY_INVALID' });
  assert.equal(invalid.calls.length, 0);
  for (const episode of [{ id: 9999, season_number: 0, episode_number: 2 }, { id: 4002, show_id: 99, season_number: 0, episode_number: 2 }]) {
    const f = harness({ season: { id: 42, season_number: 0, episodes: [] }, episode });
    await assert.rejects(f.fetch(input), { code: 'PLATFORM_TMDB_IDENTITY_MISMATCH' });
  }
  const missing = harness({ season: { id: 42, season_number: 0, episodes: [] }, episodeStatus: 404 });
  await assert.rejects(missing.fetch(input), { code: 'PLATFORM_INTEGRATION_HTTP_FAILED' });
  assert.equal(missing.calls.filter(row => row.pathname.includes('/episode/')).length, 1);
});

test('Series cast-only lookup still verifies Season without returning unrequested metadata', async () => {
  const fixture = harness();
  const result = await fixture.fetch({ requestedFields:[] });
  assert.deepEqual(result.descriptiveEntries, [{ key:'tmdb_series_id', value:'1399' }]);
  assert.equal(fixture.calls.length, 2);
});
test('Series metadata accepts the documented TV alternative_titles results shape', async () => {
  const fixture=harness({show:{id:1399,name:'Demo Show',alternative_titles:{id:1399,results:[{title:'Alternate Show',iso_3166_1:'US',type:''}]}}});
  assert.equal((await fixture.fetch()).descriptiveEntries.find(item=>item.key==='series_title').value,'Demo Show');
});

for (const seasonNumber of [null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
  test(`Series rejects invalid Season ${String(seasonNumber)} before HTTP`, async () => {
    const fixture = harness();
    await assert.rejects(fixture.fetch({ resolvedProviderIdentity:identity({ seasonNumber }) }),
      { code:'PLATFORM_TMDB_IDENTITY_INVALID' });
    assert.equal(fixture.calls.length, 0);
  });
}

test('Series rejects a tuple digest that was not refreshed after changing Season', async () => {
  const fixture = harness();
  await assert.rejects(fixture.fetch({ resolvedProviderIdentity:{ ...identity(), seasonNumber:2 } }),
    { code:'PLATFORM_TMDB_IDENTITY_INVALID' });
  assert.equal(fixture.calls.length, 0);
});

for (const [label, overrides, code, count] of [
  ['foreign Series', { show:{ id:1400, name:'Foreign' } }, 'PLATFORM_TMDB_IDENTITY_MISMATCH', 1],
  ['foreign Season', { season:{ id:3624, season_number:2 } }, 'PLATFORM_TMDB_IDENTITY_MISMATCH', 2],
  ['malformed Season', { season:{ season_number:1 } }, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 2],
  ['noninteger Season', { season:{ id:3624, season_number:'1' } }, 'PLATFORM_TMDB_IDENTITY_MISMATCH', 2],
  ['missing Season', { seasonStatus:404 }, 'PLATFORM_INTEGRATION_HTTP_FAILED', 2],
  ['network failure', { error:new Error('disposable transport failure') }, 'PLATFORM_INTEGRATION_NETWORK_FAILED', 1],
]) {
  test(`Series metadata rejects ${label} without partial result`, async () => {
    const fixture = harness(overrides);
    await assert.rejects(fixture.fetch(), { code });
    assert.equal(fixture.calls.length, count);
  });
}

test('Series metadata retains Integration Handle fencing before any HTTP', async () => {
  const fixture = harness();
  await assert.rejects(fixture.fetch({}, { ...handle, configRevision:2 }),
    { code:'PLATFORM_TMDB_HANDLE_FENCE_MISMATCH' });
  assert.equal(fixture.calls.length, 0);
});

test('Episode fields remain rejected until the observation has an explicit Episode scope', async () => {
  const fixture = harness();
  await assert.rejects(fixture.fetch({ requestedFields:['episode_title'] }),
    { code:'PLATFORM_TMDB_IDENTITY_INVALID' });
  assert.equal(fixture.calls.length, 0);
});

test('Movie metadata cannot request Season fields', async () => {
  const fixture = harness();
  await assert.rejects(fixture.fetch({ resolvedProviderIdentity:identity({ namespace:'tmdb_movie', seasonNumber:null }) }),
    { code:'PLATFORM_TMDB_IDENTITY_INVALID' });
  assert.equal(fixture.calls.length, 0);
});

const episodeScope = { episodeKey:'E001', episodeNumber:1, seasonNumber:1 };
const episodeFields = ['episode_number', 'episode_plot', 'episode_title', 'season_number', 'series_title'];

test('Series observes only the exact Episode endpoint and preserves frozen scope', async () => {
  const fixture = harness();
  const result = await fixture.fetch({ episodeScope, requestedFields:episodeFields });
  assert.deepEqual(result.episodeScope, episodeScope);
  assert.deepEqual(result.descriptiveEntries, [
    { key:'episode_number', value:1 }, { key:'episode_plot', value:'Episode One plot' },
    { key:'episode_title', value:'Episode One' }, { key:'season_number', value:1 },
    { key:'series_title', value:'Demo Show' }, { key:'tmdb_series_id', value:'1399' },
  ]);
  assert.equal(result.sourceRef, 'tmdb:tv:1399:season:1:episode:1');
  assert.equal(fixture.calls.at(-1).pathname, '/3/tv/1399/season/1/episode/1');
  assert.equal(JSON.stringify(result).includes('Outside delivery'), false);
});

for (const invalidScope of [null, { ...episodeScope, seasonNumber:2 }, { ...episodeScope, episodeNumber:0 },
  { ...episodeScope, episodeNumber:'1' }, { ...episodeScope, episodeKey:'E002' }, { ...episodeScope, extra:true }]) {
  test('Series rejects invalid or foreign Episode scope before HTTP: ' + JSON.stringify(invalidScope), async () => {
    const fixture = harness();
    await assert.rejects(fixture.fetch({ episodeScope:invalidScope, requestedFields:episodeFields }),
      { code:'PLATFORM_TMDB_IDENTITY_INVALID' });
    assert.equal(fixture.calls.length, 0);
  });
}

for (const [label, overrides, code] of [
  ['foreign Episode', { episode:{ id:63057, season_number:1, episode_number:2 } }, 'PLATFORM_TMDB_IDENTITY_MISMATCH'],
  ['foreign Season', { episode:{ id:63056, season_number:2, episode_number:1 } }, 'PLATFORM_TMDB_IDENTITY_MISMATCH'],
  ['missing numbers', { episode:{ id:63056 } }, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID'],
  ['missing Episode', { episodeStatus:404 }, 'PLATFORM_INTEGRATION_HTTP_FAILED'],
]) {
  test('Exact Episode lookup rejects ' + label + ' without partial result', async () => {
    const fixture = harness(overrides);
    await assert.rejects(fixture.fetch({ episodeScope, requestedFields:episodeFields }), { code });
    assert.equal(fixture.calls.length, 3);
  });
}

test('Missing Episode title or plot remains a gap and never inherits Series plot', async () => {
  const fixture = harness({ episode:{ id:63056, season_number:1, episode_number:1, name:'', overview:'' } });
  const result = await fixture.fetch({ episodeScope, requestedFields:episodeFields });
  assert.deepEqual(result.descriptiveEntries.map(item => item.key), ['episode_number', 'season_number', 'series_title', 'tmdb_series_id']);
  assert.equal(result.episodePlotSourceProof.result,'not_available');
});

test('exact Episode translations complete a missing plot without changing local title or numbering',async()=>{
  const f=harness({episode:{id:63056,season_number:1,episode_number:1,name:'Local preferred title',overview:''},
    translations:{id:63056,translations:[{iso_639_1:'en',iso_3166_1:'US',data:{name:'Other-language title',overview:'Same-Episode English plot'}}]}}),
    result=await f.fetch({episodeScope,requestedFields:episodeFields});
  assert.equal(result.descriptiveEntries.find(row=>row.key==='episode_plot').value,'Same-Episode English plot');
  assert.equal(result.descriptiveEntries.find(row=>row.key==='episode_title').value,'Local preferred title');
  assert.equal(result.episodePlotSourceProof.selectedLanguage,'en-US');
  assert.deepEqual(result.episodePlotSourceProof.localScope,episodeScope);
  assert.equal(f.calls.at(-1).pathname,'/3/tv/1399/season/1/episode/1/translations');
  assert.equal(f.calls.length,4);
});

test('only the explicit frozen Owner policy permits additional-language observation',async()=>{
  const f=harness({supplementation:false,episode:{id:63056,season_number:1,episode_number:1,name:'Title',overview:''}}),
    result=await f.fetch({episodeScope,requestedFields:episodeFields});
  assert.equal(result.episodePlotSourceProof,undefined);assert.equal(f.calls.length,3);
  const invalid=harness({supplementation:false});
  await assert.rejects(invalid.fetch({episodeScope,requestedFields:episodeFields,episodePlotPolicyRef:'unapproved-policy'}),
    {code:'PLATFORM_TMDB_METADATA_SHAPE'});
  assert.equal(invalid.calls.length,0);
});

test('a foreign Episode translation or translation HTTP failure cannot become a missing-field observation',async()=>{
  for(const overrides of [{translations:{id:99999,translations:[]},code:'PLATFORM_TMDB_EPISODE_TRANSLATIONS_INVALID'},
    {translationsStatus:503,code:'PLATFORM_INTEGRATION_HTTP_FAILED'}]){
    const f=harness({...overrides,episode:{id:63056,season_number:1,episode_number:1,name:'Title',overview:''}});
    await assert.rejects(f.fetch({episodeScope,requestedFields:episodeFields}),{code:overrides.code});
    assert.equal(f.calls.length,4);
  }
});
function seasonWithEpisodes(count = 77) {
  return { id:3624, season_number:1, episodes:Array.from({length:count}, (_, index) => ({
    id:63056+index, show_id:1399, season_number:1, episode_number:index+1,
    name:'Episode '+(index+1), overview:'Plot '+(index+1),
  })) };
}
function episodeInput(number) {
  return { episodeScope:{episodeKey:'E'+String(number).padStart(3,'0'),episodeNumber:number,seasonNumber:1},
    requestedFields:episodeFields };
}

test('77 concurrent Episode observations share exactly two HTTP requests and retain separate scopes', async()=>{
  const fixture=harness({season:seasonWithEpisodes()});
  const results=await Promise.all(Array.from({length:77},(_,index)=>fixture.fetch(episodeInput(index+1))));
  assert.equal(fixture.calls.length,2);
  for(const [index,result] of results.entries()) {
    assert.equal(result.episodeScope.episodeNumber,index+1);
    assert.equal(result.descriptiveEntries.find(x=>x.key==='episode_plot').value,'Plot '+(index+1));
    assert.equal(result.sourceRef,'tmdb:tv:1399:season:1:episode:'+(index+1));
    assert.equal(Object.hasOwn(result,'episodes'),false);
  }
  await fixture.fetch(episodeInput(1));assert.equal(fixture.calls.length,2);
});

test('Series response reuse expires and separates language while enforcing the Handle on cache hits',async()=>{
  let time=1000;const config={season:seasonWithEpisodes(2),now:()=>time};const fixture=harness(config);
  await fixture.fetch(episodeInput(1));await fixture.fetch(episodeInput(2));assert.equal(fixture.calls.length,2);
  await assert.rejects(fixture.fetch(episodeInput(1),{...handle,configRevision:2}),{code:'PLATFORM_TMDB_HANDLE_FENCE_MISMATCH'});
  assert.equal(fixture.calls.length,2);
  config.language='en-US';await fixture.fetch(episodeInput(1));assert.equal(fixture.calls.length,4);
  time+=5*60*1000+1;await fixture.fetch(episodeInput(1));assert.equal(fixture.calls.length,6);
});

test('Failed concurrent requests are evicted so a subsequent contract retry performs HTTP again',async()=>{
  const config={season:seasonWithEpisodes(2),error:new Error('disposable transport failure')},fixture=harness(config);
  const failed=await Promise.allSettled([fixture.fetch(episodeInput(1)),fixture.fetch(episodeInput(2))]);
  assert.ok(failed.every(x=>x.status==='rejected'&&x.reason.code==='PLATFORM_INTEGRATION_NETWORK_FAILED'));
  assert.equal(fixture.calls.length,1);
  delete config.error;
  await Promise.all([fixture.fetch(episodeInput(1)),fixture.fetch(episodeInput(2))]);
  assert.equal(fixture.calls.length,3);
});

for(const kind of ['duplicate','foreign','malformed'])test('Invalid Season Episode '+kind+' is rejected and never cached',async()=>{
  const invalid=seasonWithEpisodes(2);
  if(kind==='duplicate')invalid.episodes.push({...invalid.episodes[0]});
  if(kind==='foreign')invalid.episodes[0].show_id=1400;
  if(kind==='malformed')delete invalid.episodes[0].id;
  const config={season:invalid},fixture=harness(config);
  await assert.rejects(fixture.fetch(episodeInput(1)),{code:kind==='malformed'?'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID':'PLATFORM_TMDB_IDENTITY_MISMATCH'});
  config.season=seasonWithEpisodes(2);await fixture.fetch(episodeInput(1));assert.equal(fixture.calls.length,4);
});

test('Only a missing requested Episode field triggers exact detail supplementation',async()=>{
  const season=seasonWithEpisodes(2);season.episodes[0].overview='';
  const fixture=harness({season});
  const first=await fixture.fetch(episodeInput(1));await fixture.fetch(episodeInput(2));
  assert.equal(first.descriptiveEntries.find(x=>x.key==='episode_plot').value,'Episode One plot');
  assert.deepEqual(fixture.calls.map(x=>x.pathname),['/3/tv/1399','/3/tv/1399/season/1','/3/tv/1399/season/1/episode/1']);
});

test('Supplemented detail must match the Season member identity',async()=>{
  const season=seasonWithEpisodes(1);season.episodes[0].overview='';
  const fixture=harness({season,episode:{...season.episodes[0],id:99999,overview:'Foreign'}});
  await assert.rejects(fixture.fetch(episodeInput(1)),{code:'PLATFORM_TMDB_IDENTITY_MISMATCH'});
});

test('Protocol reuse evicts older Seasons at its item bound',async()=>{
  const config={},fixture=harness(config);
  for(let seasonNumber=1;seasonNumber<=17;seasonNumber++) {
    config.season={id:3623+seasonNumber,season_number:seasonNumber,episodes:[]};
    await fixture.fetch({resolvedProviderIdentity:identity({seasonNumber})});
  }
  config.season={id:3624,season_number:1,episodes:[]};
  await fixture.fetch();assert.equal(fixture.calls.length,36);
});


test('Revoked integration is rejected even with a warm Season response',async()=>{
  const config={season:seasonWithEpisodes(1)},fixture=harness(config);
  await fixture.fetch(episodeInput(1));config.state='disabled';
  await assert.rejects(fixture.fetch(episodeInput(1)),{code:'PLATFORM_INTEGRATION_UNAVAILABLE'});
  assert.equal(fixture.calls.length,2);
});

test('Response byte budget evicts successful entries before reaching the item bound',async()=>{
  const config={show:{id:1399,name:'Show',padding:'s'.repeat(900000)}},fixture=harness(config);
  for(let seasonNumber=1;seasonNumber<=10;seasonNumber++) {
    config.season={id:3623+seasonNumber,season_number:seasonNumber,padding:'s'.repeat(900000),episodes:[]};
    await fixture.fetch({resolvedProviderIdentity:identity({seasonNumber})});
  }
  config.season={id:3624,season_number:1,episodes:[]};
  await fixture.fetch();assert.equal(fixture.calls.length,22);
});


test('A real timeout is not memoized and the next attempt uses the original retry contract',async()=>{
  const config={timeout:true,season:seasonWithEpisodes(1)},fixture=harness(config);
  await assert.rejects(fixture.fetch(episodeInput(1)),{code:'PLATFORM_INTEGRATION_TIMEOUT'});
  config.timeout=false;await fixture.fetch(episodeInput(1));assert.equal(fixture.calls.length,3);
});

test('An authorized configuration revision cannot reuse the previous revision response',async()=>{
  const config={season:seasonWithEpisodes(1)},fixture=harness(config);
  await fixture.fetch(episodeInput(1));
  config.handle={...handle,configRevision:2,fenceDigest:'a'.repeat(64)};
  const result=await fixture.fetch(episodeInput(1));
  assert.equal(result.configRevision,2);assert.equal(fixture.calls.length,4);
});
