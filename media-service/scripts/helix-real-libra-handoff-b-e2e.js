'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('./helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const TMDB_ENDPOINT = 'https://api.themoviedb.org/3';
const MOVIE_CANDIDATES = Object.freeze([
  Object.freeze({ title:'Inside Out 2', year:2024, tmdbMovieId:'1022789' }),
  Object.freeze({ title:'The Wild Robot', year:2024, tmdbMovieId:'1184918' }),
]);
// Real-integration safety budget. This is deliberately below the 50 GiB
// five-star Shelf requirement, but large enough for common bounded 4K
// releases with premium audio.
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024 * 1024;
const MAX_ELAPSED_MS = 8 * 60 * 60 * 1000;
const MONITOR_INTERVAL_MS = 30_000;
const PREMIUM_AUDIO = new Set(['eac3_atmos', 'truehd', 'truehd_atmos', 'dts_hd_ma', 'dts_x']);
const REQUIRED_EXTERNAL_CAPABILITIES = Object.freeze([
  'libra.external_material.query.prepare@1',
  'libra.external_material.search@1',
  'libra.external_material.candidate.select@1',
  'libra.external_material.acquire.request@1',
  'libra.external_material.acquire.observe@1',
  'libra.external_material.output.resolve@1',
  'libra.external_material.stability.observe@1',
  'libra.external_material.identity.verify@1',
  'libra.external_material.package.verify@1',
  'libra.workspace.material.import@1',
]);
let activeCanaryRoot = null;

function fail(message, code = 'HELIX_REAL_LIBRA_E2E_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required.`);
  return value.trim();
}

function safePathSegment(value) {
  const safe = String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe || safe === '.' || safe === '..') fail('Real Libra movie title cannot form a safe path segment.');
  return safe;
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertSource(sourcePath) {
  const resolved = path.resolve(sourcePath);
  const allowedRoot = path.resolve(os.tmpdir(), 'ShelfDeck-P14-20260723');
  if (!inside(allowedRoot, resolved)) {
    fail('The real Libra source must be one file inside the isolated P14 test root.');
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || path.extname(resolved).toLowerCase() !== '.mkv') {
    fail('The real Libra source must be one regular MKV file.');
  }
  return resolved;
}

function assertLandingRoot(downloadRoot) {
  const resolved = fs.realpathSync(path.resolve(downloadRoot));
  if (!fs.statSync(resolved).isDirectory()) fail('MoviePilot External Landing must be a directory.');
  return resolved;
}

function providerChild(root, child) {
  const normalized = String(root).replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized.startsWith('/')) fail('MoviePilot provider root must be an absolute POSIX path.');
  return normalized + '/' + child;
}

function numeric(value) {
  const found = Number(value);
  return Number.isFinite(found) && found >= 0 ? found : null;
}

function candidateSeeders(torrent) {
  for (const value of [torrent.seeders, torrent.seeders_count,
    torrent.seedersCount, torrent.seed]) {
    const found = numeric(value);
    if (found !== null) return Math.floor(found);
  }
  return null;
}

function normalizedIdentityTitle(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

async function preflightMoviePilot(endpoint, apiKey) {
  for (const candidate of MOVIE_CANDIDATES) {
    const url = new URL('api/v1/search/title', endpoint.endsWith('/') ? endpoint : endpoint + '/');
    url.searchParams.set('token', apiKey);
    url.searchParams.set('keyword', candidate.title);
    url.searchParams.set('mtype', 'movie');
    const response = await fetch(url, { headers:{ accept:'application/json' }, signal:AbortSignal.timeout(20_000) });
    if (!response.ok) fail('MoviePilot read-only preflight search failed.', 'HELIX_MOVIEPILOT_PREFLIGHT_FAILED');
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const first = rows[0];
    const torrent = first?.torrent_info;
    const identity = String(first?.media_info?.tmdb_id ??
      first?.media_info?.tmdbid ?? '');
    const parsedTitle = first?.meta_info?.name ?? first?.meta_info?.en_name ??
      first?.meta_info?.cn_name ?? '';
    const parsedYear = Number(first?.meta_info?.year);
    const identityEvidence = identity === candidate.tmdbMovieId
      ? 'tmdb_id'
      : first?.media_recognize_fail_count === 0 &&
          normalizedIdentityTitle(parsedTitle) ===
            normalizedIdentityTitle(candidate.title) &&
          parsedYear === candidate.year
        ? 'moviepilot_title_year'
        : null;
    const title = String(torrent?.title || '');
    const sizeBytes = numeric(torrent?.size);
    const seeders = candidateSeeders(torrent || {});
    const is4k = /(?:2160p|\b4k\b)/i.test(title);
    const premiumAudio = /(?:atmos|truehd|dts[ ._-]?(?:hd|x)|dts-hd\s*ma)/i.test(title);
    const accepted = Boolean(first && identityEvidence && is4k && premiumAudio &&
      sizeBytes !== null && sizeBytes > 0 && sizeBytes <= MAX_DOWNLOAD_BYTES &&
      (seeders === null || seeders >= 10));
    process.stdout.write(`${JSON.stringify({ type:'moviepilot_preflight', title:candidate.title,
      tmdbMovieId:candidate.tmdbMovieId, accepted, identityEvidence,
      sizeBytes, seeders, is4k, premiumAudio,
      candidateDigest:first ? canonicalDigest(first) : null })}\n`);
    if (accepted) return Object.freeze({ ...candidate, sizeBytes, seeders,
      identityEvidence, candidateDigest:canonicalDigest(first) });
  }
  fail('No approved MoviePilot top candidate satisfies 4K, premium audio, size, and seeder gates.',
    'HELIX_MOVIEPILOT_NO_FAST_BOUNDED_CANDIDATE');
}

function digestFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function reality(root) {
  const pending = [root];
  const entries = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes:true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) {
        const stat = fs.statSync(target);
        entries.push(Object.freeze({
          relativeLocation:path.relative(root, target).replaceAll('\\', '/'),
          sizeBytes:stat.size,
          mtimeMs:stat.mtimeMs,
          digest:await digestFile(target),
        }));
      }
    }
  }
  entries.sort((left, right) => Buffer.from(left.relativeLocation).compare(Buffer.from(right.relativeLocation)));
  return Object.freeze({
    regularFileCount:entries.length,
    digest:canonicalDigest({ schema:'helix.real-libra-reality@1', entries }),
  });
}

async function session(host, apiKey) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey },
  });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

async function configureIntegration(host, cookie, kind, endpoint, credential, settings = undefined) {
  let proof = null;
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    proof = await host.inject({
      method:'POST', url:`/v1/admin/settings/integrations/${kind}/actions/test`, headers:{ cookie },
      payload:{ kind, idempotencyKey:`real-libra-${kind}-test-${ordinal}`, endpoint,
        credential:{ kind:'api_key', value:credential }, ...(settings ? { settings } : {}), timeoutMs:20_000 },
    });
    if (proof.statusCode === 200) break;
    if (ordinal < 3) await new Promise((resolve) => setTimeout(resolve, ordinal * 2_000));
  }
  assert.equal(proof?.statusCode, 200, proof?.body);
  assert.equal(proof.json().result, 'passed');
  const saved = await host.inject({
    method:'PATCH', url:`/v1/admin/settings/integrations/${kind}`, headers:{ cookie },
    payload:{ kind, idempotencyKey:`real-libra-${kind}-save`, expectedConfigRevision:0,
      connectionProofId:proof.json().connectionProofId },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().state, 'active');
}

async function createShelf(host, cookie, shelfRoot) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/shelves', headers:{ cookie }, payload:{
      idempotencyKey:'real-libra-shelf-create', shelfId:'real-libra-shelf',
      name:'Real Libra Isolated Shelf', targetRootLocation:shelfRoot,
      ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
      placementPolicy:{ folderTemplate:'{title} ({year})', collisionPolicy:'reject' },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createField(host, cookie, fieldRoot) {
  const fieldId = 'real-libra-field';
  const policyValue = Object.freeze({ includedDirectories:[], excludedDirectories:[],
    allowedExtensions:['.mkv'], minimumSizeBytes:0, excludedMaterialKeys:[] });
  const access = Object.freeze({ fieldId, revision:1, endpointId:'real-libra-field-endpoint',
    rootLocation:fieldRoot, mountScopeId:'real-libra-field-mount', mountScopeRevision:1,
    accessSchemaRef:'helix://e2e/real-libra-field-access/v1' });
  const response = await host.inject({
    method:'POST', url:'/v1/admin/material-fields', headers:{ cookie }, payload:{
      idempotencyKey:'real-libra-field-create', fieldId, name:'Real Libra Isolated Field',
      contentProfileHint:'movie',
      policy:{ extractionPolicyId:'real-libra-policy', revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
        policyDigest:canonicalDigest({ extractionPolicyId:'real-libra-policy', revision:1, ...policyValue }) },
      access:{ ...access, accessDigest:canonicalDigest(access) },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function route(host, cookie) {
  const response = await host.inject({
    method:'PATCH', url:'/v1/admin/routing/material-fields/real-libra-field', headers:{ cookie },
    payload:{ idempotencyKey:'real-libra-routing', fieldId:'real-libra-field',
      expectedPolicyId:null, expectedRevision:0,
      policy:{ routingPolicyId:'real-libra-routing-policy', mode:'direct',
        targets:[{ shelfId:'real-libra-shelf', rank:1, matchExpression:{ nodeKind:'always' } }] } },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function observe(host, cookie) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/material-fields/real-libra-field/actions/observe', headers:{ cookie },
    payload:{ idempotencyKey:'real-libra-observe', fieldId:'real-libra-field',
      expectedAccessRevision:1, expectedObservationRevision:0, pageBudget:8 },
  });
  assert.equal(response.statusCode, 202, response.body);
}

async function formation(host, cookie) {
  const response = await host.inject({ method:'GET', url:'/v1/admin/formation', headers:{ cookie } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().items;
}

async function waitFor(host, cookie, predicate, runtimeFailure, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < deadline) {
    const runtimeError = runtimeFailure();
    if (runtimeError) throw runtimeError;
    items = await formation(host, cookie);
    if (predicate(items)) return items;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`Formation did not reach the expected state: ${JSON.stringify(items)}`,
    'HELIX_REAL_LIBRA_E2E_TIMEOUT');
}

async function rateFive(host, cookie, subject) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/perception/records', headers:{ cookie }, payload:{
      targetType:'subject', targetId:subject.subjectId, expectedRevision:0,
      rating:5, idempotencyKey:'real-libra-rating-five',
    },
  });
  assert.equal(response.statusCode, 202, response.body);
}

function scalar(database, sql, ...parameters) {
  return Number(database.prepare(sql).get(...parameters).count);
}

function inspect(databasePath) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const stateCounts = Object.fromEntries(database.prepare(`
      SELECT state,count(*) count FROM fx_supporting_works WHERE owner_domain='libra'
       GROUP BY state ORDER BY state`).all().map((row) => [row.state, Number(row.count)]));
    const eventCounts = Object.fromEntries(database.prepare(`
      SELECT state,count(*) count FROM fx_workflow_events WHERE owner_domain='libra'
       GROUP BY state ORDER BY state`).all().map((row) => [row.state, Number(row.count)]));
    const capabilityCounts = Object.fromEntries(database.prepare(`
      SELECT capability_ref,count(*) count FROM fx_workflow_events WHERE owner_domain='libra'
       GROUP BY capability_ref ORDER BY capability_ref`).all().map((row) => [row.capability_ref, Number(row.count)]));
    const capabilityCommittedAtMs = Object.fromEntries(database.prepare(`
      SELECT e.capability_ref,min(r.committed_at_ms) committed_at_ms
        FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id
       WHERE e.owner_domain='libra' GROUP BY e.capability_ref ORDER BY e.capability_ref`).all()
      .map((row)=>[row.capability_ref,Number(row.committed_at_ms)]));
    const run = database.prepare(`
      SELECT r.libra_run_id,r.state,r.state_revision,r.acceptance_spec_id,r.priority_class,
             p.on_deck_package_id,p.offer_id
        FROM libra_runs r LEFT JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id
       WHERE r.state='active' ORDER BY r.created_at_ms DESC LIMIT 1`).get() || null;
    return Object.freeze({
      integrityCheck:database.pragma('integrity_check', { simple:true }),
      works:stateCounts, events:eventCounts, capabilityCounts, capabilityCommittedAtMs,run,
      failedWorks:scalar(database, "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'"),
      failedEvents:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'"),
      packages:scalar(database, 'SELECT count(*) count FROM libra_product_packages'),
      consumedOffers:scalar(database, 'SELECT count(*) count FROM libra_delivery_receipts'),
      arcaEntries:scalar(database, 'SELECT count(*) count FROM arca_shelf_entries'),
      localTranscodes:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='libra.media.transcode@1'"),
      externalRequests:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='libra.external_material.acquire.request@1'"),
      acquisitionObservationSuccess:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='libra.external_material.acquire.observe@1' AND state='succeeded'"),
      stabilitySuccess:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='libra.external_material.stability.observe@1' AND state='succeeded'"),
      importExecuting:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='libra.workspace.material.import@1' AND state='executing'"),
      importSucceeded:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='libra.workspace.material.import@1' AND state='succeeded'"),
    });
  } finally { database.close(); }
}

function selectedVerification(databasePath, libraRunId) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const rows = database.prepare(`
      SELECT e.capability_ref,r.result_json,r.committed_at_ms
        FROM fx_event_result_bindings r
        JOIN fx_workflow_events e ON e.event_id=r.event_id
        JOIN fx_supporting_works w ON w.work_id=e.work_id
       WHERE w.process_id=?
         AND e.capability_ref IN ('libra.product_media.verify@1','libra.product_output.select@1')
       ORDER BY r.committed_at_ms,r.result_id`).all(libraRunId);
    const selections = rows.filter((row) => row.capability_ref === 'libra.product_output.select@1')
      .map((row) => JSON.parse(row.result_json)).filter((item) => item.result === 'selected');
    assert.equal(selections.length, 1);
    const verification = rows.filter((row) => row.capability_ref === 'libra.product_media.verify@1')
      .map((row) => JSON.parse(row.result_json))
      .find((item) => item.verificationId === selections[0].selectedVerificationId);
    assert.ok(verification);
    return verification;
  } finally { database.close(); }
}

async function externalCopyEvidence(databasePath, libraRunId, landingRoot, workspaceRoot) {
  const database = new Database(databasePath, { readonly:true });
  let stable;
  let imported;
  try {
    const rows = database.prepare(`
      SELECT e.capability_ref,r.result_json
        FROM fx_event_result_bindings r
        JOIN fx_workflow_events e ON e.event_id=r.event_id
        JOIN fx_supporting_works w ON w.work_id=e.work_id
       WHERE w.process_id=? AND e.capability_ref IN (
         'libra.external_material.stability.observe@1',
         'libra.workspace.material.import@1')
       ORDER BY r.committed_at_ms,r.result_id`).all(libraRunId);
    stable = JSON.parse(rows.find((row) =>
      row.capability_ref === 'libra.external_material.stability.observe@1')?.result_json || 'null');
    imported = JSON.parse(rows.find((row) =>
      row.capability_ref === 'libra.workspace.material.import@1')?.result_json || 'null');
  } finally { database.close(); }
  assert.ok(stable?.stableExternalMaterialHandle);
  assert.ok(imported?.relativePath);
  const handle = stable.stableExternalMaterialHandle;
  assert.equal(path.isAbsolute(handle.location), false);
  const landingPath = path.resolve(landingRoot,
    ...handle.location.split('/').filter(Boolean));
  assert.equal(typeof imported.workspaceId, 'string');
  const workspacePath = path.resolve(workspaceRoot, imported.workspaceId,
    ...imported.relativePath.split('/').filter(Boolean));
  assert.ok(inside(landingRoot, landingPath));
  assert.ok(inside(workspaceRoot, workspacePath));
  const landingStat = fs.statSync(landingPath, { bigint:true });
  const workspaceStat = fs.statSync(workspacePath, { bigint:true });
  const landingDigest = await digestFile(landingPath);
  const workspaceDigest = await digestFile(workspacePath);
  const member = handle.outputSnapshot.members[0];
  assert.equal(Number(landingStat.size), member.sizeBytes);
  assert.equal(landingDigest, member.checksumHex);
  assert.equal(Number(workspaceStat.size), member.sizeBytes);
  assert.equal(workspaceDigest, member.checksumHex);
  assert.equal(landingStat.dev === workspaceStat.dev &&
    landingStat.ino === workspaceStat.ino, false);
  return Object.freeze({
    landingPath,workspacePath,sizeBytes:member.sizeBytes,
    digest:member.checksumHex,
    landingInode:String(landingStat.ino),workspaceInode:String(workspaceStat.ino),
    bindingDigest:handle.landingBinding.bindingDigest,
    endpointRelativeLocation:handle.location,
  });
}

function assertSuccess(databasePath, snapshot) {
  assert.equal(snapshot.integrityCheck, 'ok');
  assert.equal(snapshot.failedWorks, 0);
  assert.equal(snapshot.failedEvents, 0);
  assert.equal(snapshot.consumedOffers, 0);
  assert.equal(snapshot.arcaEntries, 0);
  assert.equal(snapshot.localTranscodes, 0, 'L07 must not locally upscale or transcode.');
  assert.ok(snapshot.run?.offer_id, 'The active Libra Run must publish an open Handoff B Offer.');
  for (const capabilityRef of REQUIRED_EXTERNAL_CAPABILITIES) {
    assert.ok((snapshot.capabilityCounts[capabilityRef] || 0) >= 1, capabilityRef);
  }
  const verification = selectedVerification(databasePath, snapshot.run.libra_run_id);
  assert.equal(verification.result, 'passed');
  assert.equal(verification.candidateKind, 'workspace_output');
  assert.equal(verification.qualitySummary.videoCodec, 'hevc');
  assert.equal(verification.qualitySummary.displayRasterClass, '4k');
  assert.equal(verification.qualitySummary.systemUpscaleDetected, false);
  assert.equal(verification.spaceSummary.withinLimit, true);
  assert.ok(verification.qualitySummary.primaryAudioClasses.some((item) => PREMIUM_AUDIO.has(item)));
  return verification;
}

function countedFetch(calls, options = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const kind = url.hostname === 'api.themoviedb.org' ? 'tmdb' :
      url.pathname.includes('/api/v1/download/add') ? 'moviepilot_download_add' :
      url.pathname.includes('/api/v1/search/title') ? 'moviepilot_search' :
      url.pathname.includes('/api/v1/download/') ? 'moviepilot_observe' :
      url.pathname.includes('/api/v1/history/transfer') ? 'moviepilot_transfer' :
      url.pathname.includes('/api/v1/history/download') ? 'moviepilot_history' : 'other';
    calls.push(Object.freeze({ kind, method:init.method || 'GET', atMs:Date.now() }));
    if (options.forbidMoviePilotDownloadAdd === true &&
        kind === 'moviepilot_download_add') {
      fail('Recovery E2E forbids creating a second MoviePilot download.',
        'HELIX_MOVIEPILOT_DUPLICATE_DOWNLOAD_BLOCKED');
    }
    return globalThis.fetch(input, init);
  };
}

async function main() {
  const startedAtMs = Date.now();
  const moviePilotEndpoint = requiredEnvironment('HELIX_MOVIEPILOT_ENDPOINT');
  const moviePilotKey = requiredEnvironment('HELIX_MOVIEPILOT_API_KEY');
  const chosen = await preflightMoviePilot(moviePilotEndpoint, moviePilotKey);
  if (process.env.HELIX_REAL_LIBRA_PREFLIGHT_ONLY === '1') {
    process.stdout.write(`${JSON.stringify({ type:'moviepilot_preflight_complete',
      result:'passed', movie:{ title:chosen.title, year:chosen.year,
        tmdbMovieId:chosen.tmdbMovieId, sizeBytes:chosen.sizeBytes,
        seeders:chosen.seeders, candidateDigest:chosen.candidateDigest } })}\n`);
    return;
  }
  const source = assertSource(requiredEnvironment('HELIX_REAL_LIBRA_MEDIA_SOURCE'));
  const tmdbKey = requiredEnvironment('HELIX_TMDB_API_KEY');
  const moviePilotRequestSaveRoot = requiredEnvironment('HELIX_MOVIEPILOT_REQUEST_SAVE_ROOT');
  const moviePilotOrganizedRoot = requiredEnvironment('HELIX_MOVIEPILOT_ORGANIZED_ROOT');
  const moviePilotLandingRoot = assertLandingRoot(
    requiredEnvironment('HELIX_MOVIEPILOT_LANDING_ROOT'));
  const movieTitle = chosen.title;
  const movieYear = chosen.year;
  const tmdbMovieId = chosen.tmdbMovieId;
  const expectExistingDownload =
    process.env.HELIX_REAL_LIBRA_EXPECT_EXISTING_DOWNLOAD === '1';
  const canaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-real-libra-handoff-b-'));
  activeCanaryRoot = canaryRoot;
  const requestSaveRoot = providerChild(moviePilotRequestSaveRoot,
    path.basename(canaryRoot));
  const expectedDownloadAdds = expectExistingDownload ? 0 : 1;
  const dataDir = path.join(canaryRoot, 'data');
  const adminRoot = path.join(canaryRoot, 'admin');
  const fieldRoot = path.join(canaryRoot, 'material-field');
  const safeMovieTitle = safePathSegment(movieTitle);
  const movieRoot = path.join(fieldRoot, `${safeMovieTitle} (${movieYear})`);
  const shelfRoot = path.join(canaryRoot, 'shelf');
  const workspaceRoot = path.join(canaryRoot, 'libra-workspaces');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  [adminRoot, movieRoot, shelfRoot, workspaceRoot].forEach((item) => fs.mkdirSync(item, { recursive:true }));
  fs.writeFileSync(path.join(adminRoot, 'index.html'), '<div id="root"></div>');
  fs.copyFileSync(source, path.join(movieRoot, `${safeMovieTitle} (${movieYear}).mkv`));
  fs.writeFileSync(path.join(movieRoot, 'movie.nfo'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<movie><title>${movieTitle}</title><year>${movieYear}</year><tmdbid>${tmdbMovieId}</tmdbid></movie>\n`);
  const sourceBefore = await reality(fieldRoot);
  const shelfBefore = await reality(shelfRoot);
  const secretRoot = `real-libra-e2e-${crypto.randomUUID()}`;
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot });
  const calls = [];
  let runtimeError = null;
  let requestError = null;
  let host;
  let monitor;
  let recoveryRestartCount = 0;
  const hostOptions = Object.freeze({
    dataDir, adminDistDir:adminRoot, secretRoot,
    libraWorkspaceRoot:workspaceRoot, integrationFetch:countedFetch(calls, {
      forbidMoviePilotDownloadAdd:expectExistingDownload,
    }),
    integrationReservedRoots:[fieldRoot,shelfRoot],
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { requestError = error; },
  });
  try {
    host = await createCleanServiceHost(hostOptions);
    let cookie = await session(host, initialized.adminApiKey);
    await configureIntegration(host, cookie, 'tmdb', TMDB_ENDPOINT, tmdbKey);
    await configureIntegration(host, cookie, 'moviepilot', moviePilotEndpoint, moviePilotKey, {
      providerRequestSaveRoot:requestSaveRoot,
      providerOrganizedRoot:moviePilotOrganizedRoot,
      shelfDeckVisibleRoot:moviePilotLandingRoot,
    });
    await createShelf(host, cookie, shelfRoot);
    await createField(host, cookie, fieldRoot);
    await route(host, cookie);
    await observe(host, cookie);
    let items = await waitFor(host, cookie,
      (value) => value.length === 1 && value[0].acceptanceSpecRevision === 1,
      () => runtimeError || requestError, 180_000);
    const subject = items[0];
    assert.equal(subject.displayIdentity, `${safeMovieTitle} (${movieYear})`);
    await rateFive(host, cookie, subject);
    items = await waitFor(host, cookie,
      (value) => value.length === 1 && value[0].acceptanceSpecRevision === 2,
      () => runtimeError || requestError, 180_000);
    const monitorStart = Date.now();
    monitor = setInterval(() => {
      try {
        const snapshot = inspect(databasePath);
        process.stdout.write(`${JSON.stringify({ type:'progress', elapsedMs:Date.now() - startedAtMs,
          runState:snapshot.run?.state || null, packageCount:snapshot.packages,
          works:snapshot.works, events:snapshot.events, externalRequests:snapshot.externalRequests,
          downloadAdds:calls.filter((item) => item.kind === 'moviepilot_download_add').length,
        })}\n`);
      } catch (error) {
        runtimeError = error;
      }
    }, MONITOR_INTERVAL_MS);
    const preImportDeadline = Date.now() + Math.max(1_000,
      MAX_ELAPSED_MS - (Date.now() - startedAtMs));
    let preImportSnapshot;
    let preImportRecoveryRestarts = 0;
    while (Date.now() < preImportDeadline) {
      if (runtimeError || requestError) {
        const recoveryError = runtimeError || requestError;
        if (preImportRecoveryRestarts >= 3) throw recoveryError;
        preImportRecoveryRestarts += 1;
        process.stdout.write(`${JSON.stringify({ type:'pre_import_recovery_restart',
          elapsedMs:Date.now() - startedAtMs, ordinal:preImportRecoveryRestarts,
          failureCode:recoveryError.code || 'EXECUTOR_CRASH',
          causeCode:recoveryError.details?.causeCode || null })}\n`);
        await host.close();
        runtimeError = null;
        requestError = null;
        host = await createCleanServiceHost(hostOptions);
        cookie = await session(host, initialized.adminApiKey);
      }
      preImportSnapshot = inspect(databasePath);
      if (preImportSnapshot.stabilitySuccess >= 1 &&
          preImportSnapshot.importExecuting === 0 &&
          preImportSnapshot.importSucceeded === 0) break;
      if (preImportSnapshot.importExecuting > 0 || preImportSnapshot.importSucceeded > 0) {
        fail('Workspace Import started before the required post-transfer recovery checkpoint.',
          'HELIX_REAL_LIBRA_RESTART_CHECKPOINT_MISSED');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!preImportSnapshot || preImportSnapshot.stabilitySuccess < 1) {
      fail('External Landing did not reach terminal Stability before the restart deadline.',
        'HELIX_REAL_LIBRA_STABILITY_TIMEOUT');
    }
    const callsBeforePlannedRestart = Object.freeze({
      downloadAdds:calls.filter((item) => item.kind === 'moviepilot_download_add').length,
      acquisitionObservationSuccess:preImportSnapshot.acquisitionObservationSuccess,
      stabilitySuccess:preImportSnapshot.stabilitySuccess,
    });
    await host.close();
    host = await createCleanServiceHost(hostOptions);
    cookie = await session(host, initialized.adminApiKey);
    process.stdout.write(`${JSON.stringify({ type:'planned_post_transfer_restart',
      elapsedMs:Date.now() - startedAtMs, ...callsBeforePlannedRestart })}\n`);
    const terminalPredicate = (value) => value.length === 1 &&
      value[0].productionStage === 'handoff_b_ready' &&
      value[0].handoffB?.state === 'published' && value[0].handoffB?.offerId;
    while (true) {
      try {
        items = await waitFor(host, cookie, terminalPredicate,
          () => runtimeError || requestError,
          Math.max(1_000, MAX_ELAPSED_MS - (Date.now() - startedAtMs)));
        break;
      } catch (error) {
        if (recoveryRestartCount >= 1 || (!runtimeError && !requestError)) throw error;
        recoveryRestartCount += 1;
        process.stdout.write(`${JSON.stringify({ type:'recovery_restart',
          elapsedMs:Date.now() - startedAtMs, ordinal:recoveryRestartCount,
          failureCode:error.code || 'EXECUTOR_CRASH',
          causeCode:error.details?.causeCode || null })}\n`);
        await host.close();
        runtimeError = null;
        requestError = null;
        host = await createCleanServiceHost(hostOptions);
        cookie = await session(host, initialized.adminApiKey);
      }
    }
    clearInterval(monitor);
    monitor = null;
    const beforeRestart = inspect(databasePath);
    const verification = assertSuccess(databasePath, beforeRestart);
    const copyEvidence = await externalCopyEvidence(databasePath,
      beforeRestart.run.libra_run_id, moviePilotLandingRoot, workspaceRoot);
    const downloadAddsBefore = calls.filter((item) => item.kind === 'moviepilot_download_add').length;
    assert.equal(downloadAddsBefore, expectedDownloadAdds);
    assert.equal(beforeRestart.acquisitionObservationSuccess,
      callsBeforePlannedRestart.acquisitionObservationSuccess);
    assert.equal(beforeRestart.stabilitySuccess,
      callsBeforePlannedRestart.stabilitySuccess);
    await host.close();
    host = await createCleanServiceHost(hostOptions);
    cookie = await session(host, initialized.adminApiKey);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.ifError(runtimeError);
    assert.ifError(requestError);
    const afterRestart = inspect(databasePath);
    assert.equal(afterRestart.packages, beforeRestart.packages);
    assert.equal(afterRestart.run.offer_id, beforeRestart.run.offer_id);
    assert.equal(calls.filter((item) => item.kind === 'moviepilot_download_add').length, downloadAddsBefore);
    assert.deepEqual(await reality(fieldRoot), sourceBefore);
    assert.deepEqual(await reality(shelfRoot), shelfBefore);
    const report = Object.freeze({
      schema:'helix.real-libra-handoff-b-e2e-report@1', result:'passed',
      realProviders:Object.freeze(['tmdb', 'moviepilot']), movie:Object.freeze({
        provider:'tmdb', providerKey:tmdbMovieId, title:movieTitle, year:movieYear,
        preflightCandidateDigest:chosen.candidateDigest,preflightSizeBytes:chosen.sizeBytes,
        preflightSeeders:chosen.seeders,
      }),
      execution:Object.freeze({
        elapsedMs:Date.now() - startedAtMs, externalCapabilities:REQUIRED_EXTERNAL_CAPABILITIES,
        externalRequestCount:beforeRestart.externalRequests,
        moviePilotDownloadAddCount:downloadAddsBefore, packageCount:beforeRestart.packages,
        offerState:'open', consumedOfferCount:beforeRestart.consumedOffers,
        stageElapsedMs:Object.freeze({
          search:(beforeRestart.capabilityCommittedAtMs['libra.external_material.search@1']||startedAtMs)-startedAtMs,
          request:(beforeRestart.capabilityCommittedAtMs['libra.external_material.acquire.request@1']||startedAtMs)-startedAtMs,
          transfer:(beforeRestart.capabilityCommittedAtMs['libra.external_material.acquire.observe@1']||startedAtMs)-startedAtMs,
          resolve:(beforeRestart.capabilityCommittedAtMs['libra.external_material.output.resolve@1']||startedAtMs)-startedAtMs,
          stability:(beforeRestart.capabilityCommittedAtMs['libra.external_material.stability.observe@1']||startedAtMs)-startedAtMs,
          verify:(beforeRestart.capabilityCommittedAtMs['libra.external_material.package.verify@1']||startedAtMs)-startedAtMs,
          import:(beforeRestart.capabilityCommittedAtMs['libra.workspace.material.import@1']||startedAtMs)-startedAtMs,
        }),
      }),
      selectedProduct:Object.freeze({
        videoCodec:verification.qualitySummary.videoCodec,
        rasterClass:verification.qualitySummary.displayRasterClass,
        primaryAudioClasses:verification.qualitySummary.primaryAudioClasses,
        actualSizeBytes:verification.spaceSummary.actualSizeBytes,
        maxSizeBytes:verification.spaceSummary.maxSizeBytes,
        withinLimit:verification.spaceSummary.withinLimit,
      }),
      externalLanding:Object.freeze(copyEvidence),
      recovery:Object.freeze({ restarted:true, duplicateExternalRequest:false,
        plannedPostTransferRestart:true,
        crashRecoveryRestarts:recoveryRestartCount + preImportRecoveryRestarts,
        duplicatePackage:false, duplicateOffer:false,
        adoptedExistingDownload:expectExistingDownload }),
      safety:Object.freeze({ sourceUnchanged:true, shelfUnchanged:true, arcaEntries:0,
        localTranscodes:0, downloadedAssetsPreserved:true,
        externalLandingRoot:moviePilotLandingRoot,
        selectedLandingMaterialVerifiedAfterImport:true }),
      canaryRoot, databasePath,
    });
    fs.writeFileSync(path.join(canaryRoot, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (monitor) clearInterval(monitor);
    if (host) await host.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ result:'failed', code:error.code || 'HELIX_REAL_LIBRA_E2E_FAILED',
    causeCode:error.details?.causeCode || null, message:error.message,
    canaryRoot:activeCanaryRoot })}\n`);
  process.exitCode = 1;
});
