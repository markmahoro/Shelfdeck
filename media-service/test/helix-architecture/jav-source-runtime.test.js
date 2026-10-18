'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const { createPlatformIntegrationServices, createCleanServiceHost } = require('../../src/clean-service-host');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const { buildJavQueryAnchor } = require('../../src/helix/contracts/jav-source-contracts');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createJavSourceClient } = require('../../src/helix/integrations/jav-source-client');

const secretRoot = 'jav-source-test-root-0123456789abcdef0123456789';
const schemaDdl = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const rootList = [];
test.after(() => { for (const root of rootList) {
  const resolved = path.resolve(root), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith('helix-jav-source-'));
  fs.rmSync(resolved, { recursive: true, force: true });
} });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-jav-source-')); rootList.push(root);
  const dataDir = path.join(root, 'data'), adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true }); fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<html>JAV source fixture</html>');
  const initialized = initializeCleanData({ dataDir, confirmation: 'INITIALIZE_HELIX_CLEAN_V1', secretRoot });
  return { root, dataDir, adminDistDir, initialized };
}
function open(value, fetchImpl, extra = {}) {
  const now = () => 1_900_000_000_000;
  const kernel = openSqliteKernel({ Database, databasePath: path.join(value.dataDir, 'shelfdeck.db'), schemaDdl, schemaManifest, now });
  const services = createPlatformIntegrationServices({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }),
    dataDir: value.dataDir, secretRoot, now, fetchImpl, ...extra });
  return { kernel, services };
}
async function image() { return sharp({ create: { width: 100, height: 60, channels: 3, background: '#237890' } }).png().toBuffer(); }
function detail(code = 'IPX-177', extra = '') {
  return `<html><link rel="canonical" href="https://javdb.com/v/Fixture01"><div class="video-detail">
    <h2 class="title">${code} Fixture title</h2><div class="movie-panel-info"><div class="panel-block"><strong>番號：</strong><span class="value">${code}</span></div></div>
    <img class="video-cover" src="https://c0.jdbstatic.com/fixture-cover.png"></div>${extra}</html>`;
}
function transport(picture, options = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const target = new URL(url);
    if (options.override) { const response = options.override(target, init); if (response) return response; }
    if (target.hostname === 'javdb.com' && target.pathname === '/search') return new Response(`<div class="movie-list"><div class="item"><a href="/v/Fixture01"><strong>IPX-177</strong></a></div></div>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (target.hostname === 'javdb.com' && target.pathname === '/v/Fixture01') return new Response(options.detail || detail(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (target.hostname === 'c0.jdbstatic.com') return new Response(picture, { headers: { 'content-type': 'image/png' } });
    throw new Error('Unexpected foreign request in source fixture.');
  };
  return { requests, fetchImpl };
}
async function configure(services, key = 'one') {
  const kind = 'jav-javdb';
  const proof = await services.admin.test(kind, { kind, idempotencyKey: 'test-' + key, endpoint: 'https://javdb.com',
    credential: { kind: 'anonymous' }, settings: { networkRoute: { mode: 'direct', proxyEndpoint: null } } });
  const body = { kind, idempotencyKey: 'save-' + key, expectedConfigRevision: 0, connectionProofId: proof.connectionProofId };
  return { saved: services.admin.configure(kind, body), body };
}

test('JAV Aftercare resolves an artifact-scoped handle for the accepted source and acquires only its pinned original cover', async () => {
  const value=fixture(),picture=await image(),fake=transport(picture),opened=open(value,fake.fetchImpl);
  try {
    await configure(opened.services);
    const queryAnchor=buildJavQueryAnchor('jav_code','IPX-177'),
      observation=await opened.services.observeJavSource({siteRef:'javdb',input:{queryAnchor}}),
      identityHandle=opened.services.resolveJavSourceHandle({siteRef:'javdb',operationId:'libra.product_identity.evidence.observe@1'}),
      body={schema:'libra.jav-selected-source@1',siteRef:'javdb',integrationId:identityHandle.integrationId,
        configRevision:identityHandle.configRevision,authMode:'anonymous',endpointProfileDigest:identityHandle.endpointProfileDigest,
        networkRouteDigest:identityHandle.networkRouteDigest,queryAnchor,resourceKey:observation.resourceKey,
        title:observation.descriptiveEntries.find(item=>item.key==='title').value,coverDigest:observation.cover.byteDigest,
        qualificationDigest:observation.observationDigest},javSelectedSource={...body,bindingDigest:canonicalDigest(body)},
      operationId='arca.aftercare.binary_artifact.acquire@1',resolvedProviderIdentity={provider:'jav',namespace:'jav_code',
        providerKey:'IPX-177',seasonNumber:null,identityAnchorDigest:'a'.repeat(64)},
      handle=opened.services.resolveCurrentProductHandle({providerKind:'jav',javSelectedSource,operationId,artifactKind:'poster'}),
      before=fake.requests.length;
    assert.equal(handle.integrationType,'jav_source');assert.equal(handle.allowedOperation,operationId);
    const result=await opened.services.fetchProviderArtifact({operationId,artifactKind:'poster',integrationHandle:handle,
      resolvedProviderIdentity,javSelectedSource});
    assert.equal(result.resultKind,'acquired');assert.deepEqual(result.sourceCoverBytes,picture);
    assert.deepEqual(result.resolvedProviderIdentity,resolvedProviderIdentity);
    assert.deepEqual(result.javSelectedSource,javSelectedSource);
    assert.ok(fake.requests.slice(before).every(item=>!new URL(item.url).pathname.startsWith('/search')));
    const renewal=await opened.services.admin.test('jav-javdb',{kind:'jav-javdb',idempotencyKey:'aftercare-renew-test',endpoint:'https://javdb.com',
      credential:{kind:'anonymous'},settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}});
    opened.services.admin.configure('jav-javdb',{kind:'jav-javdb',idempotencyKey:'aftercare-renew-save',expectedConfigRevision:1,connectionProofId:renewal.connectionProofId});
    const renewed=opened.services.resolveCurrentProductHandle({providerKind:'jav',javSelectedSource,operationId,artifactKind:'poster'});
    assert.equal(renewed.configRevision,2);assert.equal(javSelectedSource.configRevision,1);
    const refreshed=await opened.services.fetchProviderArtifact({operationId,artifactKind:'poster',integrationHandle:renewed,resolvedProviderIdentity,javSelectedSource});
    assert.equal(refreshed.configRevision,2);assert.deepEqual(refreshed.sourceCoverBytes,picture);
    await assert.rejects(()=>opened.services.fetchProviderArtifact({operationId,artifactKind:'poster',integrationHandle:handle,resolvedProviderIdentity,javSelectedSource}),
      {code:'P5_PROVIDER_HANDLE_DENIED'});
    assert.throws(()=>opened.services.resolveCurrentProductHandle({providerKind:'jav',javSelectedSource,operationId:'libra.product_artifact.acquire@1',artifactKind:'poster'}),
      {code:'CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE'});
  } finally { opened.kernel.close(); }
});

test('real Platform test-save-read supplies qualified title and cover without any Secret row', async () => {
  const value = fixture(), fake = transport(await image()), opened = open(value, fake.fetchImpl);
  try {
    const { saved } = await configure(opened.services);
    assert.equal(saved.configRevision, 1); assert.equal(saved.configured, true);
    const result = await opened.services.observeJavSource({ siteRef: 'javdb', input: { queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') } });
    assert.equal(result.result, 'qualified'); assert.deepEqual(result.descriptiveEntries, [{ key: 'title', value: 'Fixture title' }]);
    assert.equal(result.resolvedProviderIdentity.providerKey, 'IPX-177'); assert.equal(result.cover.width, 100);
    const db = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_secret_refs WHERE owner_scope_type=?').get('integration').n, 0); }
    finally { db.close(); }
    const artifact = await opened.services.prepareJavSourceArtifact({ siteRef: 'javdb', input: {
      queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177'), qualifiedObservation: result, artifactKind: 'poster' } });
    const metadata = await sharp(artifact.bytes).metadata();
    assert.equal(artifact.resultKind, 'prepared_artifact_bytes');
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 42); assert.equal(metadata.height, 60);
    assert.equal(artifact.derivationEvidence.sourceByteDigest, result.cover.byteDigest);
    assert.deepEqual(artifact.derivationEvidence.crop, { left: 58, top: 0, width: 42, height: 60 });
  } finally { opened.kernel.close(); }
});

test('JAV connection testing reports a safe upstream error and creates no proof or configuration on denied source access',async()=>{
  const value=fixture(),privateValue='do-not-expose-upstream-token',host=await createCleanServiceHost({...value,secretRoot,
    integrationFetch:async()=>new Response(privateValue,{status:403,headers:{'content-type':'text/html'}})});
  try{
    const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':value.initialized.adminApiKey}}),cookie=login.headers['set-cookie'],kind='jav-javdb',
      response=await host.inject({method:'POST',url:'/v1/admin/settings/integrations/'+kind+'/actions/test',headers:{cookie},payload:{kind,
        idempotencyKey:'denied-source-test',endpoint:'https://javdb.com',credential:{kind:'anonymous'},settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}}});
    assert.equal(response.statusCode,502,response.body);assert.equal(response.json().error.code,'PLATFORM_INTEGRATION_HTTP_FAILED');
    assert.deepEqual(response.json().error.details,{siteRef:'javdb',reasonCode:'JAV_SOURCE_ACCESS_DENIED',status:403,stage:'page'});
    assert.equal(response.body.includes(privateValue),false);assert.equal(response.json().connectionProofId,undefined);
    const config=await host.inject({method:'GET',url:'/v1/admin/settings/integrations/'+kind,headers:{cookie}});
    assert.equal(config.statusCode,200);assert.equal(config.json().configured,false);assert.equal(config.json().configRevision,0);
    const forged=await host.inject({method:'PATCH',url:'/v1/admin/settings/integrations/'+kind,headers:{cookie},payload:{kind,
      idempotencyKey:'no-proof-save',expectedConfigRevision:0,connectionProofId:'missing-proof'}});
    assert.equal(forged.statusCode,400);assert.equal(forged.json().error.code,'PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID');
  }finally{await host.close();}
});

test('JAV connection testing keeps unavailable, malformed and timeout failures in the existing Platform error contract',async()=>{
  const cases=[
    {name:'unavailable',code:'PLATFORM_INTEGRATION_NETWORK_FAILED',reason:'JAV_SOURCE_UNAVAILABLE',fetch:async()=>new Response('private upstream body',{status:503})},
    {name:'malformed',code:'PLATFORM_INTEGRATION_RESPONSE_INVALID',reason:'JAV_SOURCE_RESPONSE_INVALID',fetch:async()=>new Response('private upstream body',{headers:{'content-type':'application/json'}})},
    {name:'timeout',code:'PLATFORM_INTEGRATION_TIMEOUT',reason:'JAV_SOURCE_TIMEOUT',fetch:async(url,init)=>new Promise((resolve,reject)=>{
      const abort=()=>reject(Object.assign(new Error('private transport detail'),{name:'AbortError'}));if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});})},
  ];
  for(const item of cases){const value=fixture(),opened=open(value,item.fetch);try{
    await assert.rejects(opened.services.admin.test('jav-javdb',{kind:'jav-javdb',idempotencyKey:'safe-'+item.name,endpoint:'https://javdb.com',timeoutMs:100,
      credential:{kind:'anonymous'},settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}}),error=>{
        assert.equal(error.code,item.code);assert.deepEqual(error.details,{siteRef:'javdb',reasonCode:item.reason,stage:'page',...(item.name==='unavailable'?{status:503}:{})});assert.equal(error.message.includes('private'),false);return true;
      });
    assert.equal(opened.services.admin.get('jav-javdb').configured,false);
  }finally{opened.kernel.close();}}
});

test('saved anonymous source and idempotent configure survive service reconstruction', async () => {
  const value = fixture(), fake = transport(await image());
  const first = open(value, fake.fetchImpl), configured = await configure(first.services);
  first.kernel.close();
  const second = open(value, fake.fetchImpl);
  try {
    const calls = fake.requests.length;
    assert.deepEqual(second.services.admin.configure('jav-javdb', configured.body), configured.saved);
    assert.equal(fake.requests.length, calls);
    assert.throws(() => second.services.admin.configure('jav-javdb', { ...configured.body, connectionProofId: 'different' }), { code: 'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT' });
    const result = await second.services.observeJavSource({ siteRef: 'javdb', input: { queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') } });
    assert.equal(result.result, 'qualified');
  } finally { second.kernel.close(); }
});

test('correction source and cover operations use distinct scoped Handles and deny undeclared artifact requests', async () => {
  const value=fixture(),fake=transport(await image()),opened=open(value,fake.fetchImpl);
  try {
    await configure(opened.services);
    const queryAnchor=buildJavQueryAnchor('jav_code','IPX-177'),sourceOperation='arca.jav_correction.source.verify@1',assetsOperation='arca.jav_correction.assets.prepare@1',
      sourceHandle=opened.services.resolveJavSourceHandle({siteRef:'javdb',operationId:sourceOperation}),
      assetsHandle=opened.services.resolveJavSourceHandle({siteRef:'javdb',operationId:assetsOperation,artifactKind:'fanart'}),
      observation=await opened.services.observeJavSource({siteRef:'javdb',operationId:sourceOperation,integrationHandle:sourceHandle,input:{queryAnchor}}),
      cover=await opened.services.acquireJavCorrectionCover({siteRef:'javdb',operationId:assetsOperation,integrationHandle:assetsHandle,
        input:{queryAnchor,qualifiedObservation:observation,artifactKind:'fanart'}});
    assert.equal(observation.result,'qualified');assert.ok(Buffer.isBuffer(cover.coverBytes));
    assert.notEqual(sourceHandle.handleId,assetsHandle.handleId);
    assert.throws(()=>opened.services.resolveJavSourceHandle({siteRef:'javdb',operationId:sourceOperation,artifactKind:'fanart'}),{code:'PLATFORM_INTEGRATION_HANDLE_DENIED'});
    assert.throws(()=>opened.services.resolveJavSourceHandle({siteRef:'javdb',operationId:assetsOperation,artifactKind:'nfo'}),{code:'PLATFORM_INTEGRATION_HANDLE_DENIED'});
    await assert.rejects(opened.services.acquireJavCorrectionCover({siteRef:'javdb',operationId:assetsOperation,integrationHandle:sourceHandle,
      input:{queryAnchor,qualifiedObservation:observation,artifactKind:'fanart'}}),{code:'P5_PROVIDER_HANDLE_DENIED'});
  } finally {opened.kernel.close();}
});

test('source and revision mismatched Handles fail before foreign transport', async () => {
  const value = fixture(), fake = transport(await image()), opened = open(value, fake.fetchImpl);
  try {
    await configure(opened.services);
    const handle = opened.services.resolveJavSourceHandle({ siteRef: 'javdb', operationId: 'libra.product_identity.evidence.observe@1' });
    const input = { queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') }, calls = fake.requests.length;
    for (const change of [{ siteRef: 'javmenu' }, { networkRouteDigest: '0'.repeat(64) }, { configRevision: 2 }, { expiresAtMs: 0 }, { secretRef: 'dummy' }])
      await assert.rejects(opened.services.observeJavSource({ siteRef: 'javdb', input, integrationHandle: { ...handle, ...change } }), { code: 'P5_PROVIDER_HANDLE_DENIED' });
    assert.equal(fake.requests.length, calls);
    const runtime = opened.services.providerRuntimes.get('jav-javdb');
    assert.throws(() => runtime.secretLeaseResolverPort.resolve({}), { code: 'PLATFORM_INTEGRATION_SECRET_DENIED' });
  } finally { opened.kernel.close(); }
});

test('two exact resources require selection and never fetch an arbitrary first detail', async () => {
  const fake = transport(await image(), { override: target => target.pathname === '/search'
    ? new Response('<div class="movie-list"><div class="item"><a href="/v/One"><strong>IPX-177</strong></a></div><div class="item"><a href="/v/Two"><strong>IPX-177</strong></a></div></div>', { headers: { 'content-type': 'text/html' } }) : null });
  const client = createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', fetchImpl: fake.fetchImpl });
  const result = await client.observe({ queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') });
  assert.equal(result.result, 'ambiguous'); assert.equal(result.candidates.length, 2); assert.equal(fake.requests.length, 1);
});

test('wrong primary code, missing title and bad cover cannot qualify or mix another source', async () => {
  for (const [page, cover, reason] of [[detail('IPX-178'), await image(), 'identity_mismatch'],
    [detail().replace('IPX-177 Fixture title', 'IPX-177'), await image(), 'title_missing'],
    [detail(), Buffer.from('not an image'), 'cover_undecodable']]) {
    const fake = transport(cover, { detail: page });
    const client = createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', fetchImpl: fake.fetchImpl });
    assert.equal((await client.observe({ queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') })).result, reason);
    assert.equal(fake.requests.some(row => new URL(row.url).hostname.includes('javmenu')), false);
  }
});

test('redirects, excessive image bytes and transport failure retain explicit source failures', async () => {
  const fixtures = [
    [target => target.pathname === '/search' ? new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }) : null, 'JAV_SOURCE_URL_DENIED'],
    [target => target.hostname === 'c0.jdbstatic.com' ? new Response('small', { headers: { 'content-type': 'image/png', 'content-length': String(17 * 1024 * 1024) } }) : null, 'JAV_SOURCE_RESPONSE_TOO_LARGE'],
    [target => target.pathname === '/search' ? new Response('', { status: 429 }) : null, 'JAV_SOURCE_UNAVAILABLE'],
  ];
  for (const [override, code] of fixtures) {
    const fake = transport(await image(), { override }), client = createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', fetchImpl: fake.fetchImpl });
    await assert.rejects(client.observe({ queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') }), { code });
    assert.equal(fake.requests.some(row => new URL(row.url).hostname === '127.0.0.1'), false);
  }
});

test('exact resource selection rejects a different canonical resource with the same code', async () => {
  const fake = transport(await image(), { detail: detail().replace('/v/Fixture01', '/v/Different') });
  const client = createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', fetchImpl: fake.fetchImpl });
  const result = await client.observe({ queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177'), resourceKey: 'Fixture01' });
  assert.equal(result.result, 'identity_mismatch'); assert.equal(fake.requests.length, 1);
});

test('source timeout is bounded and never switches to another site', async () => {
  const requests = [];
  const client = createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', timeoutMs: 100,
    fetchImpl: (url, init) => { requests.push(url); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('Synthetic timeout')), { once: true })); } });
  await assert.rejects(client.observe({ queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177') }), { code: 'JAV_SOURCE_TIMEOUT' });
  assert.equal(requests.length, 1);
});

test('changed cover bytes cannot be adopted from an earlier qualified observation', async () => {
  let picture = await image();
  const fake = transport(picture, { override: target => target.hostname === 'c0.jdbstatic.com'
    ? new Response(picture, { headers: { 'content-type': 'image/png' } }) : null });
  const client = createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', fetchImpl: fake.fetchImpl });
  const queryAnchor = buildJavQueryAnchor('jav_code', 'IPX-177'), qualifiedObservation = await client.observe({ queryAnchor });
  picture = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#912837' } }).png().toBuffer();
  await assert.rejects(client.prepareArtifact({ queryAnchor, qualifiedObservation, artifactKind: 'poster' }), { code: 'JAV_SOURCE_ARTIFACT_CHANGED' });
});

test('post-commit crash recovers the same configuration receipt without a Secret or another request', async () => {
  const value = fixture(), fake = transport(await image());
  const first = open(value, fake.fetchImpl, { afterIntegrationPlatformCommit() { throw new Error('Synthetic crash after Owner commit'); } });
  const kind = 'jav-javdb';
  const proof = await first.services.admin.test(kind, { kind, idempotencyKey: 'crash-test', endpoint: 'https://javdb.com',
    credential: { kind: 'anonymous' }, settings: { networkRoute: { mode: 'direct', proxyEndpoint: null } } });
  const body = { kind, idempotencyKey: 'crash-save', expectedConfigRevision: 0, connectionProofId: proof.connectionProofId };
  assert.throws(() => first.services.admin.configure(kind, body), /Synthetic crash/);
  first.kernel.close();
  const second = open(value, fake.fetchImpl);
  try { const calls = fake.requests.length; assert.equal(second.services.admin.configure(kind, body).configRevision, 1);
    assert.equal(fake.requests.length, calls); }
  finally { second.kernel.close(); }
});

test('explicit malformed routes and embedded credentials do not become a direct connection', () => {
  for (const networkRoute of [null, false, { mode: 'http_proxy', proxyEndpoint: 'http://user:password@127.0.0.1:7890' }])
    assert.throws(() => createJavSourceClient({ siteRef: 'javdb', endpoint: 'https://javdb.com', networkRoute }), { code: 'JAV_SOURCE_PROFILE_INVALID' });
});

test('dedicated JAV sources reobserve only their exact frozen number resource key', async () => {
  const { JAV_SOURCE_TRANSPORTS } = require('../../src/helix/contracts/jav-source-profiles');
  const { createJavClassTransport } = require('./fixtures/jav-class-transport');
  const picture = await image();
  for (const [siteRef, code] of [
    ['fc2_official', 'FC2-718323'], ['heydouga_official', 'HEYDOUGA-4030-2113'],
    ['caribbeancom_official', '082713-417'], ['avwiki', '259LUXU-1022'],
    ['dl_getchu', 'GETCHU-4052694'], ['gyutto', 'GYUTTO-242158'], ['javmenu', 'T38-071'],
  ]) {
    const requests = [], queryAnchor = buildJavQueryAnchor('jav_code', code);
    const source = createJavSourceClient({ siteRef, endpoint: JAV_SOURCE_TRANSPORTS[siteRef].endpoints[0],
      fetchImpl: createJavClassTransport(picture, requests, { sites: [siteRef], title: 'Fixture JAV film' }) });
    const first = await source.observe({ queryAnchor });
    assert.equal(first.result, 'qualified', siteRef);
    const pinned = await source.observe({ queryAnchor, resourceKey: first.resourceKey });
    assert.deepEqual(pinned, first, siteRef);
    const callCount = requests.length;
    for (const resourceKey of [null, '', code + '0', 'https://example.com/'])
      await assert.rejects(source.observe({ queryAnchor, resourceKey }), { code: 'JAV_SOURCE_QUERY_DENIED' });
    assert.equal(requests.length, callCount, siteRef);
  }
});

test('Admin HTTP accepts anonymous JAV test and configuration through existing session protection', async () => {
  const value = fixture(), fake = transport(await image());
  const host = await createCleanServiceHost({ ...value, secretRoot, integrationFetch: fake.fetchImpl });
  try {
    const session = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': value.initialized.adminApiKey } });
    assert.equal(session.statusCode, 204);
    const kind = 'jav-javdb', headers = { cookie: session.headers['set-cookie'] };
    const tested = await host.inject({ method: 'POST', url: '/v1/admin/settings/integrations/' + kind + '/actions/test', headers,
      payload: { kind, idempotencyKey: 'http-test', endpoint: 'https://javdb.com', credential: { kind: 'anonymous' }, settings: { networkRoute: { mode: 'direct', proxyEndpoint: null } } } });
    assert.equal(tested.statusCode, 200, tested.body);
    const saved = await host.inject({ method: 'PATCH', url: '/v1/admin/settings/integrations/' + kind, headers,
      payload: { kind, idempotencyKey: 'http-save', expectedConfigRevision: 0, connectionProofId: tested.json().connectionProofId } });
    assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().configRevision, 1);
    const database = new Database(path.join(value.dataDir,'shelfdeck.db'));
    const hex = key => canonicalDigest({key});
    try {
      database.prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)')
        .run('jav-preview-subject','single','jav','active',1,hex('continuity'),hex('scope'));
      database.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,execution_basis_schema_ref,execution_basis_record_json,execution_basis_digest,run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_policy_ref,recovery_policy_digest,recovery_attempt_ordinal,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('jav-preview-run','jav-preview-subject',1,'LibraRunExecutionBasis@1','{}',hex('basis'),hex('scope'),'active',1,hex('state'),'normal',hex('priority'),'LibraRunRecoveryPolicy@1',hex('recovery'),0,1000);
      const preview = await host.inject({method:'GET',url:'/v1/admin/formation/runs/jav-preview-run/product-identity-preview?javCode=IPX-177',headers});
      assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().result,'qualified');
      assert.equal(preview.json().displayTitle,'Fixture title');assert.equal(preview.json().siteRef,'javdb');
      assert.equal(database.prepare('SELECT count(*) n FROM libra_product_identity_selection_intents').get().n,0);
      assert.equal(database.prepare('SELECT count(*) n FROM libra_product_identity_revisions').get().n,0);
    } finally { database.close(); }
  } finally { await host.close(); }
});

test('JAV development schema refuses an older marker before startup repair or historical migration writes',async()=>{
  const value=fixture(),databasePath=path.join(value.dataDir,'shelfdeck.db');
  const database=new Database(databasePath);
  const previous='c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d';
  try {
    database.prepare('UPDATE platform_schema_marker SET schema_digest=?').run(previous);
    const before=database.prepare('SELECT * FROM platform_schema_marker').all();
    await assert.rejects(createCleanServiceHost({...value,secretRoot,integrationFetch:async()=>{throw new Error('Unexpected transport.');}}),
      error=>error.code==='CLEAN_SERVICE_NOT_READY' && error.details.findings.includes('P3_SQLITE_SCHEMA_GENERATION_MISMATCH'));
    assert.deepEqual(database.prepare('SELECT * FROM platform_schema_marker').all(),before);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_identity_selection_intents').get().n,0);
  } finally {database.close();}
});

test('global network settings persist in real Platform storage and invalidate a JAV test proof on route change',async()=>{
  const value=fixture(),picture=await image(),fake=transport(picture),opened=open(value,fake.fetchImpl);
  const save=(proxyServer,expectedConfigRevision,idempotencyKey)=>opened.services.admin.configure('network',{kind:'network',settings:{proxyServer},expectedConfigRevision,idempotencyKey});
  try {
    const initial=opened.services.admin.get('network');assert.equal(initial.configRevision,0);
    const proof=await opened.services.admin.test('jav-javdb',{kind:'jav-javdb',idempotencyKey:'global-proof',endpoint:'https://javdb.com',credential:{kind:'anonymous'}});
    const saved=save('http://proxy.test:7890',0,'global-save');assert.equal(saved.configRevision,1);
    assert.deepEqual(save('http://proxy.test:7890',0,'global-save'),saved);
    assert.throws(()=>save('',0,'global-stale'),{code:'PLATFORM_INTEGRATION_CAS_CONFLICT'});
    assert.throws(()=>opened.services.admin.configure('jav-javdb',{kind:'jav-javdb',idempotencyKey:'global-stale-proof',expectedConfigRevision:0,connectionProofId:proof.connectionProofId}),{code:'PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID'});
    const next=await opened.services.admin.test('jav-javdb',{kind:'jav-javdb',idempotencyKey:'global-fresh-proof',endpoint:'https://javdb.com',credential:{kind:'anonymous'},settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}});
    opened.services.admin.configure('jav-javdb',{kind:'jav-javdb',idempotencyKey:'global-jav-save',expectedConfigRevision:0,connectionProofId:next.connectionProofId});
    const source=opened.services.admin.get('jav-javdb');assert.deepEqual(source.settings.networkRoute,{mode:'http_proxy',proxyEndpoint:'http://proxy.test:7890'});
    const handle=opened.services.resolveJavSourceHandle({siteRef:'javdb',operationId:'libra.product_identity.evidence.observe@1'});
    assert.equal(handle.networkRouteDigest,canonicalDigest(source.settings.networkRoute));
    save('',1,'global-direct');
    await assert.rejects(opened.services.observeJavSource({siteRef:'javdb',operationId:'libra.product_identity.evidence.observe@1',integrationHandle:handle,input:{queryAnchor:buildJavQueryAnchor('jav_code','IPX-177')}}),{code:'P5_PROVIDER_HANDLE_DENIED'});
  }finally{await opened.services.close();opened.kernel.close();}
  const reopened=open(value,fake.fetchImpl);try{assert.equal(reopened.services.admin.get('network').configRevision,2);assert.equal(reopened.services.admin.get('network').settings.proxyServer,'');}finally{await reopened.services.close();reopened.kernel.close();}
});

test('global proxy Admin API requires the existing session, preserves GET purity and reports invalid input without credentials',async()=>{
  const value=fixture(),host=await createCleanServiceHost({...value,secretRoot,integrationFetch:async()=>{throw new Error('Network configuration must not contact providers.');}});
  const url='/v1/admin/settings/integrations/network';
  try{
    const denied=await host.inject({method:'GET',url});assert.equal(denied.statusCode,401);
    const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':value.initialized.adminApiKey}}),headers={cookie:login.headers['set-cookie']};
    const before=await host.inject({method:'GET',url,headers});assert.equal(before.statusCode,200);assert.equal(before.json().configRevision,0);
    const invalid=await host.inject({method:'PATCH',url,headers,payload:{kind:'network',idempotencyKey:'network-api-invalid',expectedConfigRevision:0,settings:{proxyServer:'http://private-user:private-password@proxy.test:7890'}}});
    assert.equal(invalid.statusCode,400);assert.equal(invalid.json().error.code,'PLATFORM_NETWORK_PROXY_INVALID');assert.equal(invalid.body.includes('private-password'),false);
    const saved=await host.inject({method:'PATCH',url,headers,payload:{kind:'network',idempotencyKey:'network-api-save',expectedConfigRevision:0,settings:{proxyServer:'http://proxy.test:7890'}}});
    assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().settings.proxyServer,'http://proxy.test:7890');
    const current=await host.inject({method:'GET',url,headers});assert.equal(current.json().configRevision,1);assert.deepEqual(current.json(),saved.json());
  }finally{await host.close();}
});

test('JAV cover connection errors retain safe stage and HTTP status without leaking its body',async()=>{
  const value=fixture(),picture=await image(),fake=transport(picture,{override:url=>url.hostname==='c0.jdbstatic.com'?new Response('private-cover-body',{status:403}):null}),opened=open(value,fake.fetchImpl);
  try {
    await assert.rejects(opened.services.admin.test('jav-javdb',{kind:'jav-javdb',idempotencyKey:'cover-denied-test',endpoint:'https://javdb.com',credential:{kind:'anonymous'}}),error=>{
      assert.equal(error.code,'PLATFORM_INTEGRATION_HTTP_FAILED');assert.deepEqual(error.details,{siteRef:'javdb',reasonCode:'JAV_SOURCE_ACCESS_DENIED',status:403,stage:'cover'});assert.equal(JSON.stringify(error).includes('private-cover-body'),false);return true;
    });
    assert.equal(opened.services.admin.get('jav-javdb').configured,false);
  } finally {await opened.services.close();opened.kernel.close();}
});
