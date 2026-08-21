'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const SECRET = 'libra-external-handoff-b-e2e-20260812';
const MOVIEPILOT_KEY = 'moviepilot-e2e-key';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function response(status, body, responseUrl = '') {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  let delivered = false;
  return Object.freeze({
    ok: status >= 200 && status <= 299,
    status,
    url: responseUrl,
    headers: Object.freeze({
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-length') return String(bytes.length);
        if (key === 'content-type') return 'application/json';
        return null;
      },
    }),
    body: Object.freeze({
      getReader() {
        return Object.freeze({
          async read() {
            if (delivered) return { done:true };
            delivered = true;
            return { done:false, value:Uint8Array.from(bytes) };
          },
          async cancel() { delivered = true; },
        });
      },
    }),
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  });
}

function moviePilotFetch(downloadFiles, calls) {
  let requestedTitle = null;
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(Object.freeze({ path:url.pathname, method:init.method || 'GET', keyword:url.searchParams.get('keyword') }));
    if (url.host !== 'moviepilot.test' ||
        url.searchParams.get('token') !== MOVIEPILOT_KEY) {
      return response(401, { detail:'denied' });
    }
    if (url.pathname === '/api/v1/search/title') {
      return response(200, { success:true, data:['bad', 'good'].map((kind) => ({
        meta_info:{ name:'External Upgrade Movie', year:'2024' },
        media_info:{ title:'External Upgrade Movie', year:'2024', tmdb_id:990001 },
        torrent_info:{ title:`External.Upgrade.Movie.2024.${kind}.2160p.HEVC.TrueHD`,
          enclosure:`https://tracker.test/external-upgrade-${kind}.torrent`, size:fs.statSync(downloadFiles[kind]).size },
      })) });
    }
    if (url.pathname === '/api/v1/download/add') {
      const body = JSON.parse(String(init.body || '{}'));
      assert.equal(body.tmdbid, 990001);
      assert.equal(body.save_path, '/provider/downloads');
      requestedTitle = body.torrent_in.title;
      const kind = requestedTitle.includes('.bad.') ? 'bad' : 'good';
      return response(200, { success:true, data:{ download_id:`external-job-${kind}` } });
    }
    if (url.pathname === '/api/v1/download/') {
      const kind = requestedTitle?.includes('.bad.') ? 'bad' : requestedTitle ? 'good' : null;
      return response(200, kind ? [{
        hash:`external-job-${kind}`, progress:100, state:'completed', content_path:downloadFiles[kind],
        title:requestedTitle, size:fs.statSync(downloadFiles[kind]).size,
        media:{ title:'External Upgrade Movie', year:2024, tmdbid:990001, type:'电影' },
      }] : []);
    }
    if (url.pathname === '/api/v1/history/download') return response(200, []);
    if (url.pathname === '/api/v1/history/transfer') return response(200, {
      success:true,
      data:{ list:requestedTitle ? (() => { const kind=requestedTitle.includes('.bad.')?'bad':'good'; return [{ download_hash:`external-job-${kind}`, status:true,
        dest:`/provider/organized/External.Upgrade.Movie.2024.${kind}.2160p.HEVC.TrueHD.mkv`,
        type:'电影', tmdbid:990001, title:'External Upgrade Movie' },
      { download_hash:`external-job-${kind}`, status:true,
        dest:`/provider/organized/External.Upgrade.Movie.2024.${kind}.2160p.HEVC.TrueHD.nfo`,
        type:'电影', tmdbid:990001, title:'External Upgrade Movie' }]; })() : [],
      total:requestedTitle ? 2 : 0 },
    });
    return response(404, { detail:'not found' });
  };
}

function mediaProbe() {
  return Object.freeze({
    async probe(handle) {
      const location = String(handle?.relativePath || handle?.location || '');
      const normalized = location.replaceAll('\\', '/'), external = normalized.includes('external/'),
        rejectedExternal = external && normalized.includes('.bad.');
      const value = {
        resultKind:'probed', sourceHandleDigest:canonicalDigest(handle),
        container:'matroska', durationMs:7_200_000,
        videoStreams:[{ streamIndex:0, codec:external && !rejectedExternal ? 'hevc' : 'h264',
          dispositionDefault:true, width:external && !rejectedExternal ? 3840 : 1920,
          height:external && !rejectedExternal ? 2160 : 1080 }],
        audioStreams:external && !rejectedExternal ? [{ streamIndex:1, codec:'truehd', profile:'unknown',
          dispositionDefault:true, channels:8, channelLayout:'7.1',
          normalizedAudioClass:'truehd' }] : [],
        subtitleStreams:[], discTopology:null, payloadDigest:'',
      };
      value.payloadDigest = canonicalDigest(Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== 'payloadDigest')));
      return Object.freeze(value);
    },
  });
}

function routingHandle() {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:'external-e2e-tmdb-routing-handle', integrationId:'external-e2e-tmdb',
    integrationType:'tmdb', configRevision:1, secretRef:'external-e2e-tmdb-secret',
    allowedOperation:'libra.routing.fact.observe@1', expiresAtMs:Number.MAX_SAFE_INTEGER };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productHandle(intent, operationId, artifactKind = null) {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:canonicalDigest({ schema:'external-e2e-product-handle@1', operationId, artifactKind }),
    integrationId:intent.integrationId, integrationType:'tmdb', configRevision:intent.configRevision,
    secretRef:'external-e2e-tmdb-secret', allowedOperation:operationId, expiresAtMs:4_102_444_800_000 };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productOptions() {
  return {
    routingIntegrationHandleResolver: () => routingHandle(),
    routingProviderObservation: async ({ intent }) => {
      assert.equal(intent.candidateDisplayTitle, 'external upgrade movie');
      assert.equal(intent.yearHint, 2024);
      return Object.freeze([Object.freeze({
      providerKey:'990001', title:intent.candidateDisplayTitle,
      originalTitle:intent.candidateDisplayTitle, releaseYear:2024,
      regionCodes:Object.freeze(['US']), genreCodes:Object.freeze(['18']),
      })]);
    },
    productIntegrationHandleResolver: ({ intent, operationId, artifactKind }) =>
      productHandle(intent, operationId, artifactKind || null),
    productProviderMetadataFetch: async ({ metadataFetchIntent:intent }) => Object.freeze({
      providerKind:'tmdb', integrationId:intent.integrationId,
      configRevision:intent.configRevision,
      descriptiveEntries:Object.freeze([
        { key:'director', value:'Test Director' }, { key:'genre', value:'Drama' },
        { key:'plot', value:'External acquisition E2E' },
        { key:'title', value:'External Upgrade Movie' },
        { key:'tmdb_movie_id', value:intent.resolvedProviderIdentity.providerKey },
        { key:'year_or_release_date', value:2024 },
      ]), providerIdentities:Object.freeze([intent.resolvedProviderIdentity]),
      peopleHints:Object.freeze([Object.freeze({ displayName:'Test Actor', role:'actor',
        providerIdentities:Object.freeze([Object.freeze({ provider:'tmdb', namespace:'tmdb_person',
          providerKey:'990101' })]) })]),
    }),
    productProviderArtifactFetch: async ({ artifactKind, resolvedProviderIdentity, integrationHandle }) =>
      Object.freeze({ resultKind:'acquired', bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'),
        artifactKind, integrationId:integrationHandle.integrationId,
        configRevision:integrationHandle.configRevision, mediaType:'image/jpeg', resolvedProviderIdentity }),
  };
}

async function session(host, apiKey) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey } });
  assert.equal(result.statusCode, 204, result.body);
  return result.headers['set-cookie'];
}

async function configureMoviePilot(host, cookie, landingRoot) {
  const tested = await host.inject({ method:'POST',
    url:'/v1/admin/settings/integrations/moviepilot/actions/test', headers:{ cookie }, payload:{
      kind:'moviepilot', idempotencyKey:'moviepilot-test', endpoint:'https://moviepilot.test',
      credential:{ kind:'api_key', value:MOVIEPILOT_KEY }, settings:{
        providerRequestSaveRoot:'/provider/downloads',
        providerOrganizedRoot:'/provider/organized',
        shelfDeckVisibleRoot:landingRoot,
      }, timeoutMs:5_000,
    } });
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({ method:'PATCH', url:'/v1/admin/settings/integrations/moviepilot',
    headers:{ cookie }, payload:{ kind:'moviepilot', idempotencyKey:'moviepilot-save',
      expectedConfigRevision:0, connectionProofId:tested.json().connectionProofId } });
  assert.equal(saved.statusCode, 200, saved.body);
}

async function waitFormation(host, cookie, predicate) {
  const deadline = Date.now() + 30_000;
  let item;
  while (Date.now() < deadline) {
    const response = await host.inject({ method:'GET', url:'/v1/admin/formation', headers:{ cookie } });
    assert.equal(response.statusCode, 200, response.body);
    item = response.json().items[0];
    if (item && predicate(item)) return item;
    await pause(25);
  }
  assert.fail('Formation did not reach the expected state: ' + JSON.stringify(item));
}

async function waitActiveOffer(dataDir, runtimeError) {
  const deadline = Date.now() + 15_000;
  let current;
  while (Date.now() < deadline) {
    if (runtimeError()) throw runtimeError();
    const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
    try {
      current = database.prepare("SELECT p.libra_run_id,p.on_deck_package_id,p.offer_id FROM libra_product_packages p JOIN libra_runs r ON r.libra_run_id=p.libra_run_id WHERE r.state='active' AND NOT EXISTS (SELECT 1 FROM libra_delivery_receipts d WHERE d.on_deck_package_id=p.on_deck_package_id) ORDER BY p.published_at_ms DESC LIMIT 1").get();
      if (current) return current;
    } finally { database.close(); }
    await pause(25);
  }
  assert.fail('Active Libra Run did not publish Handoff B: ' + JSON.stringify(current));
}

test('5-star 4K gap rejects the first real download, tries the next candidate, and publishes Handoff B', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-external-handoff-b-'));
  t.after(() => { if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true }); });
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const field = path.join(root, 'field');
  const shelf = path.join(root, 'shelf');
  const downloads = path.join(root, 'moviepilot-downloads');
  [admin, field, shelf, downloads].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(field, 'External Upgrade Movie (2024).mkv'), 'source movie');
  const downloaded = {
    bad:path.join(downloads, 'External.Upgrade.Movie.2024.bad.2160p.HEVC.TrueHD.mkv'),
    good:path.join(downloads, 'External.Upgrade.Movie.2024.good.2160p.HEVC.TrueHD.mkv'),
  };
  fs.writeFileSync(downloaded.bad, 'rejected isolated moviepilot output');
  fs.writeFileSync(downloaded.good, 'verified isolated moviepilot output');
  fs.writeFileSync(path.join(downloads, 'External.Upgrade.Movie.2024.bad.2160p.HEVC.TrueHD.nfo'), '<movie/>');
  fs.writeFileSync(path.join(downloads, 'External.Upgrade.Movie.2024.good.2160p.HEVC.TrueHD.nfo'), '<movie/>');
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(downloaded.bad, old, old);
  fs.utimesSync(downloaded.good, old, old);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const calls = [];
  let runtimeError = null;
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    mediaProbe:mediaProbe(), integrationFetch:moviePilotFetch(downloaded, calls),
    ...productOptions(),
    onExecutionRuntimeError(error) {
      runtimeError = error;
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error('runtime error', error, new Error('runtime callback').stack);
    } });
  try {
    const cookie = await session(host, initialized.adminApiKey);
    const headers = { cookie };
    await configureMoviePilot(host, cookie, downloads);
    calls.length = 0;
    let result = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers, payload:{
      idempotencyKey:'external-overlap-shelf-create', shelfId:'external-overlap-shelf',
      name:'invalid overlapping shelf', targetRootLocation:downloads,
      ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
      placementPolicy:{ folderTemplate:'{title} ({year})', collisionPolicy:'reject' },
    } });
    assert.notEqual(result.statusCode, 201, result.body);
    result = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers, payload:{
      idempotencyKey:'external-shelf-create', shelfId:'external-shelf', name:'外部获取测试收藏架',
      targetRootLocation:shelf, ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
      placementPolicy:{ folderTemplate:'{title} ({year})', collisionPolicy:'reject' },
    } });
    assert.equal(result.statusCode, 201, result.body);
    const policyValue = { includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'],
      minimumSizeBytes:0, excludedMaterialKeys:[] };
    const access = { fieldId:'external-field', revision:1, endpointId:'external-endpoint',
      rootLocation:field, mountScopeId:'external-mount', mountScopeRevision:1,
      accessSchemaRef:'helix://fixtures/external-field-access/v1' };
    const overlapAccess = { ...access, fieldId:'external-overlap-field',
      rootLocation:downloads };
    result = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers, payload:{
      idempotencyKey:'external-overlap-field-create', fieldId:'external-overlap-field',
      name:'invalid overlapping field', contentProfileHint:'movie',
      policy:{ extractionPolicyId:'external-overlap-policy', revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
        policyDigest:canonicalDigest({ extractionPolicyId:'external-overlap-policy', revision:1,
          ...policyValue }) },
      access:{ ...overlapAccess, accessDigest:canonicalDigest(overlapAccess) },
    } });
    assert.notEqual(result.statusCode, 201, result.body);
    result = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers, payload:{
      idempotencyKey:'external-field-create', fieldId:'external-field', name:'external field', contentProfileHint:'movie',
      policy:{ extractionPolicyId:'external-policy', revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
        policyDigest:canonicalDigest({ extractionPolicyId:'external-policy', revision:1, ...policyValue }) },
      access:{ ...access, accessDigest:canonicalDigest(access) },
    } });
    assert.equal(result.statusCode, 201, result.body);
    result = await host.inject({ method:'PATCH', url:'/v1/admin/routing/material-fields/external-field', headers,
      payload:{ idempotencyKey:'external-routing', fieldId:'external-field', expectedPolicyId:null,
        expectedRevision:0, policy:{ routingPolicyId:'external-routing-policy', mode:'direct',
          targets:[{ shelfId:'external-shelf', rank:1, matchExpression:{ nodeKind:'always' } }] } } });
    assert.equal(result.statusCode, 200, result.body);
    result = await host.inject({ method:'POST', url:'/v1/admin/material-fields/external-field/actions/observe', headers,
      payload:{ idempotencyKey:'external-observe', fieldId:'external-field', expectedAccessRevision:1,
        expectedObservationRevision:0, pageBudget:8 } });
    assert.equal(result.statusCode, 202, result.body);
    const subject = await waitFormation(host, cookie, (item) => item.acceptanceSpecRevision === 1);
    result = await host.inject({ method:'POST', url:'/v1/admin/perception/records', headers,
      payload:{ targetType:'subject', targetId:subject.subjectId, expectedRevision:0, rating:5,
        idempotencyKey:'external-rating-five' } });
    assert.equal(result.statusCode, 202, result.body);
    await waitFormation(host, cookie, (item) => item.acceptanceSpecRevision === 2);
    const offer = await waitActiveOffer(dataDir, () => runtimeError);
    assert.ok(offer.offer_id);
    assert.ifError(runtimeError);

    const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
    try {
      const refs = [
        'libra.external_material.query.prepare@1', 'libra.external_material.search@1',
        'libra.external_material.candidate.select@1', 'libra.external_material.acquire.request@1',
        'libra.external_material.acquire.observe@1', 'libra.external_material.output.resolve@1',
        'libra.external_material.stability.observe@1', 'libra.external_material.identity.verify@1',
        'libra.external_material.package.verify@1', 'libra.workspace.material.import@1',
      ];
      for (const ref of refs) {
        assert.ok(database.prepare('SELECT count(1) count FROM fx_workflow_events WHERE capability_ref=? AND state=?')
          .get(ref, 'succeeded').count >= 1, ref);
      }
      assert.equal(database.prepare("SELECT count(1) count FROM fx_workflow_events WHERE capability_ref='libra.external_material.search@1' AND state='succeeded'").get().count, 1);
      const selections=database.prepare(`SELECT r.result_json FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref='libra.external_material.candidate.select@1' AND e.state='succeeded' ORDER BY r.committed_at_ms`).all().map((row)=>JSON.parse(row.result_json));
      assert.equal(selections.length,2);
      assert.equal(new Set(selections.map((item)=>item.candidateSetDigest)).size,1);
      assert.equal(new Set(selections.map((item)=>item.selectedCandidateId)).size,2);
      assert.equal(database.prepare('SELECT count(1) count FROM arca_shelf_entries').get().count, 0);
      assert.equal(database.prepare('SELECT count(1) count FROM libra_delivery_receipts').get().count, 0);
      assert.equal(database.prepare("SELECT count(1) count FROM fx_workflow_events WHERE capability_ref='libra.media.transcode@1'").get().count, 0);
      const importedRow = database.prepare(`
        SELECT r.result_json
          FROM fx_event_result_bindings r
          JOIN fx_workflow_events e ON e.event_id=r.event_id
         WHERE e.capability_ref='libra.workspace.material.import@1'
         ORDER BY r.committed_at_ms DESC LIMIT 1`).get();
      const imported = JSON.parse(importedRow.result_json);
      const importedPath = path.join(dataDir, 'workspaces', 'libra',
        imported.workspaceId,
        ...imported.relativePath.split('/'));
      assert.deepEqual(fs.readFileSync(importedPath), fs.readFileSync(downloaded.good));
      const sourceStat = fs.statSync(downloaded.good, { bigint:true });
      const importedStat = fs.statSync(importedPath, { bigint:true });
      assert.equal(sourceStat.dev === importedStat.dev &&
        sourceStat.ino === importedStat.ino, false);
      assert.equal(fs.readFileSync(downloaded.good, 'utf8'),
        'verified isolated moviepilot output');
    } finally { database.close(); }
    assert.equal(calls.filter((item) => item.path === '/api/v1/download/add' && item.method === 'POST').length, 2);
  } finally { await host.close(); }
});
