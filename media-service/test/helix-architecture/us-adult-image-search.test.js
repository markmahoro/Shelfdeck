'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPeopleImageSearch, STASH_QUERY } = require('../../src/helix/integrations/people-image-search');

function fixture() {
  let now = 1000, route = { mode: 'direct', proxyEndpoint: null }, configuration = { endpoint: 'https://box.example/graphql', configRevision: 2 };
  const calls = [], image = Buffer.from('fixture image bytes');
  let failStash = false;
  const search = createPeopleImageSearch({ tokenKey: Buffer.alloc(32, 3), now: () => now,
    readNetworkRoute: () => route, readStashBoxConfiguration: () => configuration,
    withStashBoxCredential: async (revision, consume) => { assert.equal(revision, 2); const bytes = Buffer.from('fixture-api-key'); try { return await consume(bytes); } finally { bytes.fill(0); } },
    fetchImpl: async (url, request) => {
      calls.push({ url: String(url), request }); assert.equal(request.redirect, 'manual');
      if (url === configuration?.endpoint) {
        if (failStash) throw Object.assign(new Error('secret must never appear in public failure'), { code: 'ECONNRESET' });
        assert.equal(request.headers.ApiKey, 'fixture-api-key');
        assert.deepEqual(JSON.parse(request.body), { query: STASH_QUERY, variables: { term: 'Sample Actor' } });
        return Response.json({ data: { searchPerformers: { performers: [{ id: 'actor-1', name: 'Sample Actor', aliases: ['Alias'],
          images: [{ id: 'image-1', url: 'https://images.example/actor.jpg', width: 600, height: 900 }] }] } } });
      }
      if (String(url).startsWith('https://commons.wikimedia.org/w/api.php?')) {
        assert.equal(new URL(url).searchParams.get('gsrnamespace'), '6');
        return Response.json({ query: { pages: [{ pageid: 1, title: 'File:Sample Actor.jpg', imageinfo: [{ mime: 'image/jpeg',
          url: 'https://upload.wikimedia.org/actor.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sample_Actor.jpg',
          width: 500, height: 800, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }] } });
      }
      assert.equal(request.headers.ApiKey, undefined, 'Provider credentials never reach image hosts.');
      return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
    } });
  return { search, calls, image, now: value => { now = value; }, route: value => { route = value; },
    config: value => { configuration = value; }, failStash: () => { failStash = true; } };
}

test('name search reports independent sources and requires a signed user image selection', async () => {
  const f = fixture(), result = await f.search.search(' Sample Actor ');
  assert.deepEqual(result.sources.map(item => [item.source, item.state, item.items.length]), [['stashbox', 'available', 1], ['wikimedia', 'available', 1]]);
  assert.equal(f.calls.length, 2, 'Search never downloads or confirms an image automatically.');
  assert.match(result.sources[1].items[0].attribution, /CC BY-SA/);
  assert.ok(!JSON.stringify(result).includes('fixture-api-key'));
  const image = await f.search.readSelectedImage(result.sources[0].items[0].selectionToken);
  assert.deepEqual(image.bytes, f.image); assert.equal(image.provenance.source, 'stashbox');
  assert.equal(image.provenance.configRevision, 2);
});

test('source failures are visible independently without hiding errors or disclosing transport details', async () => {
  const f = fixture(); f.failStash();
  const result = await f.search.search('Sample Actor');
  assert.equal(result.sources[0].state, 'failed'); assert.equal(result.sources[1].state, 'available');
  assert.equal(result.sources[0].error.code, 'PEOPLE_IMAGE_SOURCE_UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes('secret'));
  f.config(null); assert.equal((await f.search.search('Sample Actor')).sources[0].state, 'unconfigured');
});

test('selection rejects tampering, expiry and changed source or network configuration before fetching bytes', async () => {
  for (const change of ['tamper', 'expire', 'source', 'network']) {
    const f = fixture(), result = await f.search.search('Sample Actor');
    let token = result.sources[0].items[0].selectionToken;
    if (change === 'tamper') token = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    if (change === 'expire') f.now(601000);
    if (change === 'source') f.config({ endpoint: 'https://box.example/graphql', configRevision: 3 });
    if (change === 'network') f.route({ mode: 'http_proxy', proxyEndpoint: 'http://proxy.example:8080' });
    await assert.rejects(f.search.readSelectedImage(token), { code: change === 'tamper' ? 'PEOPLE_IMAGE_SELECTION_INVALID' : 'PEOPLE_IMAGE_SELECTION_STALE' });
    assert.equal(f.calls.length, 2);
  }
});
