'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHmac } = require('node:crypto');
const { createPeopleImageSearch, STASH_QUERY } = require('../../src/helix/integrations/people-image-search');

function fixture() {
  let now = 1000, route = { mode: 'direct', proxyEndpoint: null }, configuration = { endpoint: 'https://api.theporndb.net/graphql', configRevision: 2 };
  const calls = [], image = Buffer.from('fixture image bytes');
  let failStash = false, aliases = ['Alias'], stashResult;
  const search = createPeopleImageSearch({ tokenKey: Buffer.alloc(32, 3), now: () => now,
    readNetworkRoute: () => route, readStashBoxConfiguration: () => configuration,
    withStashBoxCredential: async (revision, consume) => { assert.equal(revision, 2); const bytes = Buffer.from('fixture-api-key'); try { return await consume(bytes); } finally { bytes.fill(0); } },
    fetchImpl: async (url, request) => {
      calls.push({ url: String(url), request }); assert.equal(request.redirect, 'manual');
      if (url === configuration?.endpoint) {
        if (failStash) throw Object.assign(new Error('secret must never appear in public failure'), { code: 'ECONNRESET' });
        assert.equal(request.headers.ApiKey, 'fixture-api-key');
        assert.deepEqual(JSON.parse(request.body), { query: STASH_QUERY, variables: { term: 'Sample Actor' } });
        assert.match(JSON.parse(request.body).query,/searchPerformer\(term: \$term, limit: 10\)/);
        return Response.json(stashResult || { data: { searchPerformer: [{ id: 'actor-1', name: 'Sample Actor', aliases,
          images: [{ id: 'image-1', url: 'https://images.example/actor.jpg', width: 600, height: 900 }] }] } });
      }
      assert.equal(String(url), 'https://images.example/actor.jpg', 'No alternate source is contacted.');
      assert.equal(request.headers.ApiKey, undefined, 'Provider credentials never reach image hosts.');
      return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
    } });
  return { search, calls, image, now: value => { now = value; }, route: value => { route = value; },
    config: value => { configuration = value; }, aliases:value=>{aliases=value;}, stashResult:value=>{stashResult=value;}, failStash: () => { failStash = true; } };
}

test('name search only contacts ThePornDB and requires a signed user image selection', async () => {
  const f = fixture(), result = await f.search.search(' Sample Actor ');
  assert.deepEqual(result.sources.map(item => [item.source, item.state, item.items.length]), [['stashbox', 'available', 1]]);
  assert.equal(f.calls.length, 1, 'Search never downloads or confirms an image automatically.');
  assert.equal(result.sources[0].items[0].attribution, 'ThePornDB');
  assert.ok(!JSON.stringify(result).includes('fixture-api-key'));
  const image = await f.search.readSelectedImage(result.sources[0].items[0].selectionToken);
  assert.deepEqual(image.bytes, f.image); assert.equal(image.provenance.source, 'stashbox');
  assert.equal(image.provenance.configRevision, 2);
});

test('ThePornDB failure is visible without fallback or disclosing transport details', async () => {
  const f = fixture(); f.failStash();
  const result = await f.search.search('Sample Actor');
  assert.equal(result.sources[0].state, 'failed'); assert.equal(result.sources.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(result.sources[0].error.code, 'PEOPLE_IMAGE_SOURCE_UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes('secret'));
  f.config(null); assert.equal((await f.search.search('Sample Actor')).sources[0].state, 'unconfigured');
  assert.equal(f.calls.length, 1, 'Unconfigured search does not contact any source.');
});

test('retired Commons selections and non-TPDB configurations are rejected before network access',async()=>{
  const f=fixture(), result=await f.search.search('Sample Actor');
  const payload=JSON.parse(Buffer.from(result.sources[0].items[0].selectionToken.split('.')[0],'base64url').toString('utf8'));
  payload.source='wikimedia';payload.imageUrl='https://upload.wikimedia.org/retired.jpg';
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token=encoded+'.'+createHmac('sha256',Buffer.alloc(32,3)).update(encoded).digest('base64url');
  await assert.rejects(f.search.readSelectedImage(token),{code:'PEOPLE_IMAGE_SELECTION_STALE'});
  f.config({endpoint:'https://other.example/graphql',configRevision:2});
  assert.equal((await f.search.search('Sample Actor')).sources[0].error.code,'PEOPLE_IMAGE_SOURCE_CHANGED');
  await assert.rejects(f.search.readSelectedImage(result.sources[0].items[0].selectionToken),{code:'PEOPLE_IMAGE_SELECTION_STALE'});
  assert.equal(f.calls.length,1);
});

test('StashBox array response is bounded and protocol errors never trigger a hidden alternate query',async()=>{
  for(const result of [
    {data:{searchPerformer:[]}},
    {data:{searchPerformers:{performers:[]}}},
    {data:{searchPerformer:Array.from({length:11},()=>({}))}},
    {data:{searchPerformer:[]},errors:[{message:'unsupported field'}]},
  ]){
    const f=fixture(); f.stashResult(result);
    const sources=(await f.search.search('Sample Actor')).sources;
    assert.equal(sources[0].state,result.data.searchPerformer?.length===0&&!result.errors?'empty':'failed');
    assert.equal(sources.length,1);
    assert.equal(f.calls.length,1,'ThePornDB receives exactly one request.');
  }
});

test('selection rejects tampering, expiry and changed source or network configuration before fetching bytes', async () => {
  for (const change of ['tamper', 'expire', 'source', 'network']) {
    const f = fixture(), result = await f.search.search('Sample Actor');
    let token = result.sources[0].items[0].selectionToken;
    if (change === 'tamper') token = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    if (change === 'expire') f.now(601000);
    if (change === 'source') f.config({ endpoint: 'https://api.theporndb.net/graphql', configRevision: 3 });
    if (change === 'network') f.route({ mode: 'http_proxy', proxyEndpoint: 'http://proxy.example:8080' });
    await assert.rejects(f.search.readSelectedImage(token), { code: change === 'tamper' ? 'PEOPLE_IMAGE_SELECTION_INVALID' : 'PEOPLE_IMAGE_SELECTION_STALE' });
    assert.equal(f.calls.length, 1);
  }
});

test('oversized source metadata fails visibly instead of publishing unusable or truncated selection tokens',async()=>{
  const f=fixture();f.aliases(Array.from({length:128},(_,index)=>'a'.repeat(500)+index));
  const result=await f.search.search('Sample Actor');
  assert.equal(result.sources[0].state,'failed');assert.equal(result.sources[0].error.code,'PEOPLE_IMAGE_SOURCE_INVALID');
  assert.equal(result.sources.length,1);assert.equal(result.sources[0].items.length,0);
});
