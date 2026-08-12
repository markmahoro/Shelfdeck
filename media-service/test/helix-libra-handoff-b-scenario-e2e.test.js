'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');
const ffmpeg = require('ffmpeg-static');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const SOURCE_ROOT = process.env.HELIX_LIBRA_HANDOFF_B_E2E_ROOT
  ? path.resolve(process.env.HELIX_LIBRA_HANDOFF_B_E2E_ROOT)
  : null;
const SECRET = 'libra-handoff-b-scenario-e2e-20260812';
const MOVIEPILOT_KEY = 'scenario-moviepilot-key';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestError = null;

function response(status, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  let delivered = false;
  return Object.freeze({
    ok: status >= 200 && status <= 299,
    status,
    url: '',
    headers: Object.freeze({
      get(name) {
        if (String(name).toLowerCase() === 'content-length') return String(bytes.length);
        if (String(name).toLowerCase() === 'content-type') return 'application/json';
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

function moviePilotFetch(downloadFile, calls) {
  let requested = false;
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(Object.freeze({ path:url.pathname, method:init.method || 'GET' }));
    if (url.host !== 'moviepilot.test' || url.searchParams.get('token') !== MOVIEPILOT_KEY) {
      return response(401, { detail:'denied' });
    }
    if (url.pathname === '/api/v1/search/title') {
      return response(200, { success:true, data:[{
        meta_info:{ name:'SDT-M05-External-Upgrade', year:'2008' },
        media_info:{ title:'SDT-M05-External-Upgrade', year:'2008', tmdb_id:990001 },
        torrent_info:{ title:'SDT.M05.External.Upgrade.2160p',
          enclosure:'https://tracker.test/sdt-m05.torrent', size:fs.statSync(downloadFile).size },
      }] });
    }
    if (url.pathname === '/api/v1/download/add') {
      requested = true;
      return response(200, { success:true, data:{ download_id:'scenario-external-job-1' } });
    }
    if (url.pathname === '/api/v1/download/') {
      return response(200, requested ? [{
        hash:'scenario-external-job-1', progress:100, state:'completed', content_path:downloadFile,
        media:{ title:'SDT-M05-External-Upgrade', year:2008, tmdbid:990001, type:'电影' },
      }] : []);
    }
    if (url.pathname === '/api/v1/history/download') return response(200, []);
    return response(404, { detail:'not found' });
  };
}

function routingHandle() {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:'scenario-tmdb-routing-handle', integrationId:'scenario-tmdb', integrationType:'tmdb',
    configRevision:1, secretRef:'scenario-tmdb-secret', allowedOperation:'libra.routing.fact.observe@1',
    expiresAtMs:Number.MAX_SAFE_INTEGER };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productHandle(intent, operationId, artifactKind = null) {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:canonicalDigest({ schema:'scenario-product-handle@1', operationId, artifactKind }),
    integrationId:intent.integrationId, integrationType:'tmdb', configRevision:intent.configRevision,
    secretRef:'scenario-tmdb-secret', allowedOperation:operationId, expiresAtMs:4_102_444_800_000 };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productOptions() {
  return Object.freeze({
    routingIntegrationHandleResolver: () => routingHandle(),
    routingProviderObservation: async ({ intent }) => Object.freeze([Object.freeze({
      providerKey:'990001', title:intent.candidateDisplayTitle,
      originalTitle:intent.candidateDisplayTitle, releaseYear:intent.candidateYear || 2008,
      regionCodes:Object.freeze(['US']), genreCodes:Object.freeze(['18']),
    })]),
    productIntegrationHandleResolver: ({ intent, operationId, artifactKind }) =>
      productHandle(intent, operationId, artifactKind || null),
    productProviderMetadataFetch: async ({ metadataFetchIntent:intent }) => Object.freeze({
      providerKind:'tmdb', integrationId:intent.integrationId, configRevision:intent.configRevision,
      descriptiveEntries:Object.freeze([
        { key:'director', value:'Scenario Director' },
        { key:'genre', value:'Drama' },
        { key:'plot', value:'Libra Handoff B scenario evidence' },
        { key:'title', value:'Scenario Movie' },
        { key:'tmdb_movie_id', value:intent.resolvedProviderIdentity.providerKey },
        { key:'year_or_release_date', value:2008 },
      ]),
      providerIdentities:Object.freeze([intent.resolvedProviderIdentity]),
      peopleHints:Object.freeze([Object.freeze({
        displayName:'Scenario Actor', role:'actor',
        providerIdentities:Object.freeze([Object.freeze({
          provider:'tmdb', namespace:'tmdb_person', providerKey:'990101',
        })]),
      })]),
    }),
    productProviderArtifactFetch: async ({ artifactKind, resolvedProviderIdentity, integrationHandle }) =>
      Object.freeze({ resultKind:'acquired',
        bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'), artifactKind,
        integrationId:integrationHandle.integrationId, configRevision:integrationHandle.configRevision,
        mediaType:'image/jpeg', resolvedProviderIdentity }),
  });
}

function reality(root) {
  const entries = [];
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes:true })
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
      const location = path.join(directory, item.name);
      if (item.isDirectory()) walk(location);
      else if (item.isFile()) {
        const stat = fs.statSync(location, { bigint:true });
        entries.push(Object.freeze({
          relativePath:path.relative(root, location).replaceAll('\\', '/'),
          sizeBytes:Number(stat.size), mtimeNs:String(stat.mtimeNs), ctimeNs:String(stat.ctimeNs),
        }));
      }
    }
  };
  walk(root);
  return Object.freeze({ count:entries.length, digest:canonicalDigest({ schema:'scenario-source-reality@1', entries }) });
}

function buildPremiumSample(root) {
  const video = path.join(SOURCE_ROOT, 'SDT-M04-4K-Premium (2008)', 'SDT-M04-4K-Premium (2008).mkv');
  const audio = path.join(SOURCE_ROOT, 'SDT-M12-Real-BDMV (2025)', 'BDMV', 'STREAM', '00001.m2ts');
  const targetDirectory = path.join(root, 'SDT-L06-Premium-4K-TrueHD (2025)');
  const target = path.join(targetDirectory, 'SDT-L06-Premium-4K-TrueHD (2025).mkv');
  fs.mkdirSync(targetDirectory, { recursive:true });
  const executed = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', target],
  { windowsHide:true, encoding:'utf8', maxBuffer:1024 * 1024 });
  assert.equal(executed.status, 0, executed.stderr);
  assert.ok(fs.statSync(target).size > 0);
  return target;
}

async function session(host, apiKey) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey } });
  assert.equal(result.statusCode, 204, result.body);
  return result.headers['set-cookie'];
}

async function configureMoviePilot(host, cookie) {
  const tested = await host.inject({ method:'POST',
    url:'/v1/admin/settings/integrations/moviepilot/actions/test', headers:{ cookie }, payload:{
      kind:'moviepilot', idempotencyKey:'scenario-moviepilot-test', endpoint:'https://moviepilot.test',
      credential:{ kind:'api_key', value:MOVIEPILOT_KEY }, timeoutMs:5_000,
    } });
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({ method:'PATCH', url:'/v1/admin/settings/integrations/moviepilot',
    headers:{ cookie }, payload:{ kind:'moviepilot', idempotencyKey:'scenario-moviepilot-save',
      expectedConfigRevision:0, connectionProofId:tested.json().connectionProofId } });
  assert.equal(saved.statusCode, 200, saved.body);
}

async function createShelf(host, cookie, shelfRoot) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers:{ cookie }, payload:{
    idempotencyKey:'scenario-shelf-create', shelfId:'scenario-shelf', name:'Libra scenario shelf',
    targetRootLocation:shelfRoot, ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
    placementPolicy:{ folderTemplate:'{title} ({year})', collisionPolicy:'reject' },
  } });
  assert.equal(result.statusCode, 201, result.body);
}

async function createField(host, cookie, fieldId, fieldRoot) {
  const allowedExtensions = ['.avi','.bdmv','.bup','.clpi','.ifo','.iso','.m2ts','.m4v','.mkv','.mov','.mp4','.mpls','.ts','.vob','.wmv'];
  const policyValue = { includedDirectories:[], excludedDirectories:[], allowedExtensions,
    minimumSizeBytes:0, excludedMaterialKeys:[] };
  const access = { fieldId, revision:1, endpointId:fieldId + '-endpoint', rootLocation:fieldRoot,
    mountScopeId:fieldId + '-mount', mountScopeRevision:1,
    accessSchemaRef:'helix://fixtures/libra-handoff-b-scenario-access/v1' };
  const result = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{ cookie }, payload:{
    idempotencyKey:fieldId + '-create', fieldId, name:fieldId, contentProfileHint:'movie',
    policy:{ extractionPolicyId:fieldId + '-policy', revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
      policyDigest:canonicalDigest({ extractionPolicyId:fieldId + '-policy', revision:1, ...policyValue }) },
    access:{ ...access, accessDigest:canonicalDigest(access) },
  } });
  assert.equal(result.statusCode, 201, result.body);
}

async function observe(host, cookie, fieldId) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/material-fields/' + fieldId + '/actions/observe',
    headers:{ cookie }, payload:{ idempotencyKey:fieldId + '-observe', fieldId,
      expectedAccessRevision:1, expectedObservationRevision:0, pageBudget:256 } });
  assert.equal(result.statusCode, 202,
    result.body + (lastRequestError ? '\n' + lastRequestError.stack : ''));
}

async function formation(host, cookie) {
  const response = await host.inject({ method:'GET', url:'/v1/admin/formation?limit=100', headers:{ cookie } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().items;
}

async function waitFor(host, cookie, predicate, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < deadline) {
    items = await formation(host, cookie);
    if (predicate(items)) return items;
    await pause(100);
  }
  assert.fail('Formation did not reach the expected scenario state: ' + JSON.stringify(items));
}

function byScenario(items, scenarioId) {
  const matches = items.filter((item) => String(item.displayIdentity || '').includes(scenarioId));
  assert.equal(matches.length, 1, scenarioId + ' must resolve to exactly one Subject.');
  return matches[0];
}

async function rate(host, cookie, subject, rating) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/perception/records', headers:{ cookie }, payload:{
    targetType:'subject', targetId:subject.subjectId, expectedRevision:0, rating,
    idempotencyKey:'scenario-rating-' + rating + '-' + subject.subjectId,
  } });
  assert.equal(result.statusCode, 202,
    result.body + (lastRequestError ? '\n' + lastRequestError.stack : ''));
}

async function route(host, cookie, fieldId) {
  const result = await host.inject({ method:'PATCH', url:'/v1/admin/routing/material-fields/' + fieldId,
    headers:{ cookie }, payload:{ idempotencyKey:fieldId + '-routing', fieldId,
      expectedPolicyId:null, expectedRevision:0, policy:{ routingPolicyId:fieldId + '-routing-policy',
        mode:'direct', targets:[{ shelfId:'scenario-shelf', rank:1, matchExpression:{ nodeKind:'always' } }] } } });
  assert.equal(result.statusCode, 200, result.body);
}

function productEvidence(databasePath) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const rows = database.prepare(`
      SELECT s.subject_id,s.display_identity,r.libra_run_id,r.state,r.priority_class,
             p.on_deck_package_id,p.offer_id,p.package_digest
        FROM libra_subjects s
        JOIN libra_runs r ON r.subject_id=s.subject_id
        LEFT JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id
       WHERE r.state='active'
       ORDER BY s.display_identity`).all();
    const capabilityCounts = Object.fromEntries(database.prepare(`
      SELECT capability_ref,count(*) count FROM fx_workflow_events
       WHERE owner_domain='libra' GROUP BY capability_ref ORDER BY capability_ref`).all()
      .map((row) => [row.capability_ref, Number(row.count)]));
    return Object.freeze({
      rows:Object.freeze(rows), capabilityCounts:Object.freeze(capabilityCounts),
      packages:Number(database.prepare('SELECT count(*) count FROM libra_product_packages').get().count),
      consumedOffers:Number(database.prepare('SELECT count(*) count FROM libra_delivery_receipts').get().count),
      failedWorks:Number(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'").get().count),
      failedEvents:Number(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().count),
      arcaEntries:Number(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count),
    });
  } finally { database.close(); }
}

test('P14 real bytes cover the Libra main production paths through open Handoff B Offers', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:360_000,
}, async (t) => {
  assert.equal(fs.statSync(SOURCE_ROOT).isDirectory(), true);
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-scenarios-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const supplemental = path.join(root, 'supplemental-field');
  const downloads = path.join(root, 'moviepilot-downloads');
  [admin, shelf, supplemental, downloads].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const premium = buildPremiumSample(supplemental);
  const external = path.join(downloads, 'SDT-M05-External-Upgrade.2025.2160p.mkv');
  fs.copyFileSync(premium, external);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(external, old, old);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const calls = [];
  let runtimeError = null;
  lastRequestError = null;
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'), integrationFetch:moviePilotFetch(external, calls),
    moviePilotSavePath:downloads, moviePilotDownloadRoots:[downloads], ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await configureMoviePilot(host, cookie);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-main-field', SOURCE_ROOT);
  await createField(host, cookie, 'p14-premium-field', supplemental);
  await observe(host, cookie, 'p14-main-field');
  await observe(host, cookie, 'p14-premium-field');

  const subjects = await waitFor(host, cookie, (items) =>
    ['SDT-M01','SDT-M02','SDT-M03A','SDT-M03B','SDT-M05','SDT-M06','SDT-M07','SDT-G08','SDT-G09','SDT-L06']
      .every((id) => items.some((item) => String(item.displayIdentity || '').includes(id))));
  await rate(host, cookie, byScenario(subjects, 'SDT-M03A'), 1);
  await rate(host, cookie, byScenario(subjects, 'SDT-M03B'), 2);
  await rate(host, cookie, byScenario(subjects, 'SDT-G02'), 3);
  await rate(host, cookie, byScenario(subjects, 'SDT-M02'), 4);
  await rate(host, cookie, byScenario(subjects, 'SDT-L06'), 5);
  await rate(host, cookie, byScenario(subjects, 'SDT-M05'), 5);
  await route(host, cookie, 'p14-main-field');
  await route(host, cookie, 'p14-premium-field');

  const required = ['SDT-M01','SDT-M02','SDT-M03A','SDT-M03B','SDT-M05','SDT-M06','SDT-M07','SDT-G08','SDT-G09','SDT-L06'];
  await waitFor(host, cookie, (items) => required.every((id) => {
    const item = items.find((entry) => String(entry.displayIdentity || '').includes(id));
    return item?.offerStage === 'handoff_b_offer_open';
  }), 330_000);
  assert.ifError(runtimeError);

  const evidence = productEvidence(path.join(dataDir, 'shelfdeck.db'));
  for (const id of required) {
    const rows = evidence.rows.filter((row) => String(row.display_identity || '').includes(id));
    assert.equal(rows.length, 1, id + ' must have exactly one active Run.');
    assert.ok(rows[0].offer_id, id + ' must have one open Handoff B Offer.');
  }
  assert.ok((evidence.capabilityCounts['libra.media.transcode@1'] || 0) >= 2);
  assert.ok((evidence.capabilityCounts['libra.media.remux@1'] || 0) >= 4);
  assert.ok((evidence.capabilityCounts['libra.external_material.package.verify@1'] || 0) >= 1);
  assert.equal(evidence.failedWorks, 0);
  assert.equal(evidence.failedEvents, 0);
  assert.equal(evidence.consumedOffers, 0);
  assert.equal(evidence.arcaEntries, 0);
  assert.ok(calls.some((item) => item.path === '/api/v1/download/add' && item.method === 'POST'));
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
  t.diagnostic('Libra main-path evidence: ' + JSON.stringify(evidence));
});
