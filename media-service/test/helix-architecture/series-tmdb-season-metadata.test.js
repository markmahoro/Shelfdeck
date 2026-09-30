'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createTmdbProviderAdapter } = require('../../src/helix/integrations/tmdb-provider-adapter');

const operationId = 'libra.product_metadata.fetch@1';
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
  const season = { id:3624, season_number:1, episodes:[{ episode_number:99, name:'Outside delivery' }] };
  const episode = { id:63056, season_number:1, episode_number:1, name:'Episode One', overview:'Episode One plot' };
  const adapter = createTmdbProviderAdapter({
    integrationQueryPort:{ query:() => ({ state:'active', integrationType:'tmdb', integrationId:handle.integrationId,
      configRevision:1, endpoint:'https://api.themoviedb.org/3', secretKind:'tmdb_access_token',
      secretRef:'fixture-secret', settings:{ language:'zh-CN' } }) },
    integrationHandleResolverPort:{ resolve:() => handle },
    secretLeaseResolverPort:{ resolve:() => ({ leaseId:'fixture-lease' }) },
    secretLeaseConsumer:{ consumeAsync:async (_lease, consume) => consume(Buffer.from('disposable-secret')) },
    fetchImpl:async (url) => {
      calls.push({ pathname:url.pathname, language:url.searchParams.get('language') });
      if (overrides.error) throw overrides.error;
      const isSeason = url.pathname.includes('/season/');
      const isEpisode = url.pathname.includes('/episode/');
      return new Response(JSON.stringify(isEpisode ? (overrides.episode ?? episode) :
        isSeason ? (overrides.season ?? season) : (overrides.show ?? show)),
        { status:isEpisode ? (overrides.episodeStatus ?? 200) : isSeason ? (overrides.seasonStatus ?? 200) : 200 });
    },
  });
  const fetch = (input = {}, suppliedHandle = handle) => adapter.observationPort.execute({
    operationId, integrationHandle:suppliedHandle, timeoutMs:1000,
    input:{ resolvedProviderIdentity:identity(),
      requestedFields:['genre', 'plot', 'season_number', 'series_title'], ...input },
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
});
