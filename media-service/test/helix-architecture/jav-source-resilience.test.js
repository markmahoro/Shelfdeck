'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { document, parseJavSourcePage } = require('../../src/helix/integrations/jav-source-pages');
const { createJavSourceClient } = require('../../src/helix/integrations/jav-source-client');
const { createJavSourceProviderAdapter } = require('../../src/helix/integrations/jav-source-provider-adapter');
const { buildJavQueryAnchor } = require('../../src/helix/contracts/jav-source-contracts');

function page(title, cover = 'https://fmtu.sl2025p.com/fixture.jpg') {
  return `<div class="col-md-9"><h1 class="display-5"><strong>${title}</strong></h1>
    <div class="left-wrapper"><div class="card"><div class="card-body"><div class="code"><a>ABF</a><span>-047</span></div></div></div></div>
    <div class="single-video"><video poster="${cover}"></video></div></div>`;
}

test('JavMenu reads only the main actor row, preserves names without invented identities and deduplicates links',()=>{
  const html=page('ABF-047 Fixture title').replace('<div class="code">',
    '<div><span>女優:</span><div><a href="/actress/one">Fixture Actor</a><a href="/actress/one">Fixture Actor</a><a href="/actress/two">Second Actor</a></div></div><div class="code">')+
    '<aside><span>女優:</span><a>Unrelated Recommended Actor</a></aside>';
  const result=parseJavSourcePage('javmenu','ABF-047',document(Buffer.from(html),'text/html'),'https://mrzyx.xyz');
  assert.equal(result.identityVerified,true);
  assert.deepEqual(result.peopleHints,[{displayName:'Fixture Actor',role:'actor',providerIdentities:[]},
    {displayName:'Second Actor',role:'actor',providerIdentities:[]}]);
  const absent=parseJavSourcePage('javmenu','ABF-047',document(Buffer.from(page('ABF-047 Fixture title')),'text/html'),'https://mrzyx.xyz');
  assert.deepEqual(absent.peopleHints,[]);
});

test('JavMenu removes known trailing advertisements while preserving title content and identity checks', () => {
  for (const suffix of [' 免費AV在線看', ' 免费AV在线看', ' 免費在線看', ' 免費AV在線看  | JAV目錄大全 | 每日更新']) {
    const result = parseJavSourcePage('javmenu', 'ABF-047', document(Buffer.from(page('ABF-047 Fixture title' + suffix)), 'text/html'), 'https://mrzyx.xyz');
    assert.equal(result.title, 'Fixture title');
    assert.equal(result.identityVerified, true);
    assert.deepEqual(result.descriptiveEntries, [{ key: 'title', value: 'Fixture title' }]);
  }
  const parse = (text, code = 'ABF-047') => parseJavSourcePage('javmenu', code, document(Buffer.from(page(text)), 'text/html'), 'https://mrzyx.xyz');
  assert.equal(parse('ABF-047 免費AV在線看 is part of this title').title, '免費AV在線看 is part of this title');
  assert.equal(parse('ABF-047 Fixture title 免費AV在線看', 'ABF-048').identityVerified, false);
  assert.equal(parse('ABF-047 免費AV在線看').title, null);
  const otherSite = parseJavSourcePage('javdb', 'ABF-047', document(Buffer.from('<h2 class="title">ABF-047 Fixture title 免費AV在線看</h2>'), 'text/html'), 'https://javdb.com');
  assert.equal(otherSite.title, 'Fixture title 免費AV在線看');
});

test('JavMenu accepts the verified cover host while retaining exact HTTPS host boundaries', async () => {
  const picture = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#394b59' } }).jpeg().toBuffer();
  for (const [host, allowed] of [['fmtu.sl2025p.com', true], ['fmtu.sl2025p.com.attacker.invalid', false], ['127.0.0.1', false]]) {
    const requests = [];
    const client = createJavSourceClient({ siteRef: 'javmenu', endpoint: 'https://mrzyx.xyz', fetchImpl: async url => {
      requests.push(url);
      return new URL(url).hostname === 'mrzyx.xyz'
        ? new Response(page('ABF-047 Fixture title 免費AV在線看', `https://${host}/fixture.jpg`), { headers: { 'content-type': 'text/html' } })
        : new Response(picture, { headers: { 'content-type': 'image/jpeg' } });
    } });
    const request = { queryAnchor: buildJavQueryAnchor('jav_code', 'ABF-047') };
    if (allowed) {
      const result = await client.observe(request);
      assert.equal(result.result, 'qualified');
      assert.equal(result.descriptiveEntries[0].value, 'Fixture title');
      assert.equal(requests.length, 2);
    } else {
      await assert.rejects(client.observe(request), { code: 'JAV_SOURCE_URL_DENIED' });
      assert.equal(requests.length, 1);
    }
  }
});

function adapter(fetchImpl) {
  let routeReads = 0;
  const value = createJavSourceProviderAdapter({
    runtime: { readCurrent() {}, profile: { siteRef: 'javmenu', probeCode: 'ABF-047', normalizeEndpoint: value => value } },
    networkPolicy: { route() { routeReads++; return { mode: 'direct', proxyEndpoint: null }; } }, fetchImpl,
  });
  return { value, routeReads: () => routeReads };
}

test('connection test retries a transient failure once on the same source and route', async () => {
  const picture = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#394b59' } }).jpeg().toBuffer();
  let pages = 0;
  const input = adapter(async url => {
    if (new URL(url).hostname !== 'mrzyx.xyz') return new Response(picture, { headers: { 'content-type': 'image/jpeg' } });
    if (++pages === 1) return new Response('Temporary upstream failure', { status: 503 });
    return new Response(page('ABF-047 Fixture title'), { headers: { 'content-type': 'text/html' } });
  });
  const result = await input.value.testCandidate({ endpoint: 'https://mrzyx.xyz', timeoutMs: 1000 });
  assert.equal(result.result, 'passed');
  assert.equal(pages, 2);
  assert.equal(input.routeReads(), 1);
});

test('connection test does not retry permanent or semantic failures and bounds transient attempts', async () => {
  for (const [status, code, expectedCalls] of [[403, 'PLATFORM_INTEGRATION_HTTP_FAILED', 1], [404, 'PLATFORM_INTEGRATION_CONNECTION_TEST_FAILED', 1], [503, 'PLATFORM_INTEGRATION_NETWORK_FAILED', 2]]) {
    let calls = 0;
    const input = adapter(async () => { calls++; return new Response('Fixture response', { status }); });
    await assert.rejects(input.value.testCandidate({ endpoint: 'https://mrzyx.xyz', timeoutMs: 1000 }), { code });
    assert.equal(calls, expectedCalls);
  }
});

test('connection test shares its original timeout budget across attempts', async () => {
  let calls = 0;
  const input = adapter(async (url, init) => {
    calls++;
    if (calls === 1) return new Response('Temporary upstream failure', { status: 503 });
    return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('Fixture timeout'), { name: 'AbortError' }));
      if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
    });
  });
  const started = Date.now();
  await assert.rejects(input.value.testCandidate({ endpoint: 'https://mrzyx.xyz', timeoutMs: 200 }), { code: 'PLATFORM_INTEGRATION_TIMEOUT' });
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 1000);
});
