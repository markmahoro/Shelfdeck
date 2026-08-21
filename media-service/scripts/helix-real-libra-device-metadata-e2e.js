'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('./helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const TMDB_ENDPOINT = 'https://api.themoviedb.org/3';
const MONITOR_INTERVAL_MS = 30_000;
const DEVICE_SAMPLE_INTERVAL_MS = 2_000;
const SCENARIO_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const scenarios = Object.freeze([
  Object.freeze({
    id:'gpu', title:'Official Secrets', year:2019, tmdbId:'393624', rating:1,
    sourceEnvironment:'HELIX_REAL_GPU_SOURCE', expectedDeviceClass:'nvidia_nvenc',
    generatedNfo:true,
  }),
  Object.freeze({
    id:'cpu_fallback', title:'Public Enemies', year:2009, tmdbId:'11322', rating:1,
    sourceEnvironment:'HELIX_REAL_CPU_SOURCE', expectedDeviceClass:'software_cpu',
    generatedNfo:true, cpuFallback:true,
  }),
  Object.freeze({
    id:'metadata', title:'The Shawshank Redemption', year:1994, tmdbId:'278', rating:null,
    sourceEnvironment:'HELIX_REAL_METADATA_SOURCE', expectedDeviceClass:null,
    generatedNfo:false,
  }),
]);

function fail(message, code = 'HELIX_REAL_DEVICE_METADATA_E2E_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required.`);
  return value.trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function boundedReality(filePath) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(handle, { bigint:true });
    if (!stat.isFile()) fail('Selected source is not a regular file.');
    const size = Number(stat.size);
    const length = Math.min(size, 262144);
    const offset = Math.floor((size - length) / 2);
    const bytes = Buffer.alloc(length);
    let total = 0;
    while (total < length) {
      const read = fs.readSync(handle, bytes, total, length - total, offset + total);
      if (read === 0) fail('Selected source produced a short bounded fingerprint read.');
      total += read;
    }
    const after = fs.fstatSync(handle, { bigint:true });
    if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs ||
        after.ctimeNs !== stat.ctimeNs) fail('Selected source changed during the bounded fingerprint read.');
    return Object.freeze({
      path:path.resolve(filePath), sizeBytes:size, inode:String(stat.ino),
      mtimeNs:String(stat.mtimeNs), ctimeNs:String(stat.ctimeNs),
      sampleOffset:offset, sampleLength:length, middleFingerprint:sha256(bytes),
    });
  } finally {
    fs.closeSync(handle);
  }
}

function cpuOnlyRuntime() {
  const capabilityPayload = Object.freeze({
    supportedVideoCodecs:Object.freeze(['hevc']),
    supportedRateControlModes:Object.freeze(['two_pass_abr', 'strict_abr', 'quality_bound']),
    validatedConcurrentSlots:1,
  });
  const capabilityDigest = canonicalDigest(capabilityPayload);
  const snapshotBody = {
    deviceId:'controlled-software-cpu-0', deviceClass:'software_cpu', probeRevision:1,
    capabilitySchemaRef:'helix://platform/compute-device-capability/v1',
    capabilityPayload, capabilityDigest, enabled:true, state:'ready', workerRef:null,
  };
  const snapshot = Object.freeze({ ...snapshotBody, snapshotDigest:canonicalDigest(snapshotBody) });
  const refBody = { deviceId:snapshot.deviceId, deviceClass:snapshot.deviceClass,
    probeRevision:snapshot.probeRevision, capabilityDigest };
  const ref = Object.freeze({ ...refBody, refDigest:canonicalDigest(refBody) });
  return Object.freeze({
    listReadyDeviceRefs(query) {
      assert.equal(query.queryDigest, canonicalDigest({ queryContract:query.queryContract, limit:query.limit }));
      const body = { queryDigest:query.queryDigest, resultKind:'available', items:Object.freeze([ref]) };
      return Object.freeze({ ...body, resultDigest:canonicalDigest(body) });
    },
    readDeviceSnapshot(query) {
      const bodyQuery = { deviceId:query.deviceId };
      if (query.expectedProbeRevision !== undefined) bodyQuery.expectedProbeRevision = query.expectedProbeRevision;
      if (query.expectedCapabilityDigest !== undefined) bodyQuery.expectedCapabilityDigest = query.expectedCapabilityDigest;
      assert.equal(query.queryDigest, canonicalDigest(bodyQuery));
      assert.equal(query.deviceId, snapshot.deviceId);
      const body = { queryDigest:query.queryDigest, resultKind:'found', snapshot };
      return Object.freeze({ ...body, resultDigest:canonicalDigest(body) });
    },
  });
}

function countedFetch(calls) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(Object.freeze({ host:url.hostname, path:url.pathname, method:init.method || 'GET', atMs:Date.now() }));
    return globalThis.fetch(input, init);
  };
}

async function session(host, apiKey) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey } });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

async function configureTmdb(host, cookie, credential, credentialKind, prefix) {
  let proof;
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    proof = await host.inject({ method:'POST', url:'/v1/admin/settings/integrations/tmdb/actions/test', headers:{ cookie },
      payload:{ kind:'tmdb', idempotencyKey:`${prefix}-tmdb-test-${ordinal}`, endpoint:TMDB_ENDPOINT,
        credential:{ kind:credentialKind, value:credential }, timeoutMs:20_000 } });
    if (proof.statusCode === 200) break;
    await new Promise((resolve) => setTimeout(resolve, ordinal * 2_000));
  }
  assert.equal(proof?.statusCode, 200, proof?.body);
  assert.equal(proof.json().result, 'passed');
  const saved = await host.inject({ method:'PATCH', url:'/v1/admin/settings/integrations/tmdb', headers:{ cookie },
    payload:{ kind:'tmdb', idempotencyKey:`${prefix}-tmdb-save`, expectedConfigRevision:0,
      connectionProofId:proof.json().connectionProofId } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().state, 'active');
}

async function createShelf(host, cookie, root, prefix) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers:{ cookie }, payload:{
    idempotencyKey:`${prefix}-shelf-create`, shelfId:`${prefix}-shelf`, name:`${prefix} real shelf`,
    targetRootLocation:root, ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
    placementPolicy:{ folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo', subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy:'reject' },
  } });
  assert.equal(response.statusCode, 201, response.body);
}

async function createField(host, cookie, root, prefix) {
  const fieldId = `${prefix}-field`;
  const policyValue = Object.freeze({ includedDirectories:[], excludedDirectories:[],
    allowedExtensions:['.mkv'], minimumSizeBytes:0, excludedMaterialKeys:[] });
  const access = Object.freeze({ fieldId, revision:1, endpointId:`${prefix}-field-endpoint`,
    rootLocation:root, mountScopeId:`${prefix}-field-mount`, mountScopeRevision:1,
    accessSchemaRef:'helix://e2e/real-device-metadata-field-access/v1' });
  const response = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{ cookie }, payload:{
    idempotencyKey:`${prefix}-field-create`, fieldId, name:`${prefix} real field`, contentProfileHint:'movie',
    policy:{ extractionPolicyId:`${prefix}-policy`, revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
      policyDigest:canonicalDigest({ extractionPolicyId:`${prefix}-policy`, revision:1, ...policyValue }) },
    access:{ ...access, accessDigest:canonicalDigest(access) },
  } });
  assert.equal(response.statusCode, 201, response.body);
  return fieldId;
}

async function route(host, cookie, prefix, fieldId) {
  const response = await host.inject({ method:'PATCH', url:`/v1/admin/routing/material-fields/${fieldId}`, headers:{ cookie },
    payload:{ idempotencyKey:`${prefix}-routing`, fieldId, expectedPolicyId:null, expectedRevision:0,
      policy:{ routingPolicyId:`${prefix}-routing-policy`, mode:'direct',
        targets:[{ shelfId:`${prefix}-shelf`, rank:1, matchExpression:{ nodeKind:'always' } }] } } });
  assert.equal(response.statusCode, 200, response.body);
}

async function observe(host, cookie, prefix, fieldId) {
  const response = await host.inject({ method:'POST', url:`/v1/admin/material-fields/${fieldId}/actions/observe`, headers:{ cookie },
    payload:{ idempotencyKey:`${prefix}-observe`, fieldId, expectedAccessRevision:1,
      expectedObservationRevision:0, pageBudget:8 } });
  assert.equal(response.statusCode, 202, response.body);
}

async function formation(host, cookie) {
  const response = await host.inject({ method:'GET', url:'/v1/admin/formation', headers:{ cookie } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().items;
}

async function waitFor(host, cookie, predicate, failure, timeoutMs = SCENARIO_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < deadline) {
    if (failure()) throw failure();
    items = await formation(host, cookie);
    const found = predicate(items);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`Formation timeout: ${JSON.stringify(items)}`, 'HELIX_REAL_DEVICE_METADATA_E2E_TIMEOUT');
}

async function rate(host, cookie, scenario, subject) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/perception/records', headers:{ cookie }, payload:{
    targetType:'subject', targetId:subject.subjectId, expectedRevision:0, rating:scenario.rating,
    idempotencyKey:`real-${scenario.id}-rating`,
  } });
  assert.equal(response.statusCode, 202, response.body);
}

function scalar(database, sql, ...parameters) {
  return Number(database.prepare(sql).get(...parameters).count);
}

function databaseSnapshot(databasePath, subjectId) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const run = database.prepare(`SELECT r.libra_run_id,r.state,r.acceptance_spec_id,r.priority_class,
      p.on_deck_package_id,p.offer_id FROM libra_runs r
      LEFT JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id
      WHERE r.subject_id=? AND r.state='active' ORDER BY r.created_at_ms DESC LIMIT 1`).get(subjectId) || null;
    const events = Object.fromEntries(database.prepare(`SELECT state,count(*) count FROM fx_workflow_events
      WHERE owner_domain='libra' GROUP BY state ORDER BY state`).all().map((row) => [row.state, Number(row.count)]));
    return Object.freeze({ run, events,
      failedWorks:scalar(database, "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'"),
      failedEvents:scalar(database, "SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'"),
      packages:scalar(database, 'SELECT count(*) count FROM libra_product_packages'),
      consumedOffers:scalar(database, 'SELECT count(*) count FROM libra_delivery_receipts'),
      arcaEntries:scalar(database, 'SELECT count(*) count FROM arca_shelf_entries'),
      transcodes:run ? scalar(database, `SELECT count(*) count FROM fx_workflow_events e
        JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=? AND e.capability_ref='libra.media.transcode@1'`, run.libra_run_id) : 0,
    });
  } finally { database.close(); }
}

function inspectProduct(databasePath, workspaceRoot, subjectId) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const run = database.prepare(`SELECT r.libra_run_id,p.on_deck_package_id,p.offer_id
      FROM libra_runs r JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id
      WHERE r.subject_id=? AND r.state='active' ORDER BY r.created_at_ms DESC LIMIT 1`).get(subjectId);
    assert.ok(run?.offer_id);
    const transcodes = database.prepare(`SELECT e.event_id,n.input_bindings_json,r.result_json
      FROM fx_workflow_events e JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      JOIN fx_event_result_bindings r ON r.event_id=e.event_id
      WHERE e.capability_ref='libra.media.transcode@1' AND e.work_id IN
        (SELECT work_id FROM fx_supporting_works WHERE process_id=?) ORDER BY e.event_id`).all(run.libra_run_id)
      .map((row) => {
        const bindings = JSON.parse(row.input_bindings_json).bindings;
        const device = bindings.find((item) => item.portName === 'mediaExecutionDeviceSnapshot')?.value;
        const intent = bindings.find((item) => item.portName === 'encodeIntent')?.value;
        const result = JSON.parse(row.result_json);
        return Object.freeze({ eventId:row.event_id, deviceId:device.deviceId,
          deviceClass:device.deviceClass, rateControlMode:intent.video.rateControlMode,
          targetVideoBitrateBps:intent.video.targetVideoBitrateBps,
          outputSizeBytes:result.workspaceMaterialHandle.sizeBytes,
          outputRelativePath:result.workspaceMaterialHandle.relativePath,
          workspaceId:result.workspaceMaterialHandle.workspaceId,
          resultDeviceClass:result.executionDeviceRef.deviceClass,
        });
      });
    const identity = JSON.parse(database.prepare(`SELECT f.fact_json FROM libra_product_fact_revisions f
      WHERE f.libra_run_id=? AND f.fact_kind='resolved_identity' ORDER BY f.fact_revision DESC LIMIT 1`).get(run.libra_run_id).fact_json);
    const metadata = JSON.parse(database.prepare(`SELECT f.fact_json FROM libra_product_fact_revisions f
      WHERE f.libra_run_id=? AND f.fact_kind='product_metadata' ORDER BY f.fact_revision DESC LIMIT 1`).get(run.libra_run_id).fact_json);
    const mediaCast = JSON.parse(database.prepare(`SELECT f.fact_json FROM libra_product_fact_revisions f
      WHERE f.libra_run_id=? AND f.fact_kind='media_cast' ORDER BY f.fact_revision DESC LIMIT 1`).get(run.libra_run_id).fact_json);
    const artifacts = database.prepare(`SELECT a.artifact_kind,a.storage_ref,a.digest_hex,a.size_bytes,a.media_type,a.provenance_ref
      FROM fx_artifact_registry a WHERE a.owner_scope_id=? ORDER BY a.artifact_kind`).all(run.libra_run_id).map((row) => {
        const match = /^workspace:\/\/([^/]+)\/(.+)$/.exec(row.storage_ref);
        assert.ok(match, `Artifact storage ref is not a Workspace URI: ${row.storage_ref}`);
        const physicalPath = path.join(workspaceRoot, match[1], ...match[2].split('/'));
        assert.equal(fs.existsSync(physicalPath), true, physicalPath);
        const bytes = fs.readFileSync(physicalPath);
        assert.equal(bytes.length, row.size_bytes);
        assert.equal(sha256(bytes), row.digest_hex);
        return Object.freeze({ ...row, physicalPath, bytes });
      });
    return Object.freeze({ run, transcodes, identity, metadata, mediaCast, artifacts });
  } finally { database.close(); }
}

function nvidiaSample() {
  const result = spawnSync('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.encoder,memory.used,power.draw',
    '--format=csv,noheader,nounits'], { encoding:'utf8', windowsHide:true });
  if (result.status !== 0) return null;
  const values = result.stdout.trim().split(',').map((item) => Number(item.trim()));
  if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) return null;
  return Object.freeze({ gpuUtilizationPct:values[0], encoderUtilizationPct:values[1],
    memoryUsedMiB:values[2], powerDrawW:values[3] });
}

function assertArtifactBytes(scenario, product) {
  const nfo = product.artifacts.find((item) => item.artifact_kind === 'nfo');
  const poster = product.artifacts.find((item) => item.artifact_kind === 'poster');
  assert.ok(nfo, 'Product NFO artifact is absent.');
  assert.ok(poster, 'Product poster artifact is absent.');
  const xml = nfo.bytes.toString('utf8');
  assert.match(xml, /<movie[>\s]/i);
  assert.match(xml, new RegExp(scenario.tmdbId));
  assert.ok(xml.toLowerCase().includes(scenario.title.toLowerCase()) || scenario.id === 'cpu_fallback');
  const jpeg = poster.bytes.length >= 3 && poster.bytes[0] === 0xff && poster.bytes[1] === 0xd8 && poster.bytes[2] === 0xff;
  const png = poster.bytes.length >= 8 && poster.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.ok(jpeg || png, 'Product poster is not a decodable image envelope.');
  return Object.freeze({ nfoPath:nfo.physicalPath, nfoBytes:nfo.bytes.length,
    posterPath:poster.physicalPath, posterBytes:poster.bytes.length, posterMediaType:poster.media_type });
}

async function runScenario(scenario, tmdbCredential, tmdbCredentialKind) {
  const startedAtMs = Date.now();
  const source = path.resolve(requiredEnvironment(scenario.sourceEnvironment));
  if (path.extname(source).toLowerCase() !== '.mkv') fail(`${scenario.id} source must be MKV.`);
  const sourceBefore = boundedReality(source);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `helix-real-libra-${scenario.id}-`));
  const dataDir = path.join(root, 'data');
  const adminRoot = path.join(root, 'admin');
  const fieldRoot = path.join(root, 'material-field');
  const movieRoot = path.join(fieldRoot, `${scenario.title} (${scenario.year})`);
  const shelfRoot = path.join(root, 'shelf');
  const workspaceRoot = path.join(root, 'libra-workspaces');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  [adminRoot, movieRoot, shelfRoot, workspaceRoot].forEach((item) => fs.mkdirSync(item, { recursive:true }));
  fs.writeFileSync(path.join(adminRoot, 'index.html'), '<div id="root"></div>');
  const destination = path.join(movieRoot, `${scenario.title} (${scenario.year}).mkv`);
  process.stdout.write(`${JSON.stringify({ type:'copy_start', scenario:scenario.id, source, destination,
    bytes:sourceBefore.sizeBytes, root })}\n`);
  fs.copyFileSync(source, destination);
  assert.equal(fs.statSync(destination).size, sourceBefore.sizeBytes);
  if (scenario.generatedNfo) {
    fs.writeFileSync(path.join(movieRoot, 'movie.nfo'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<movie><title>${scenario.title}</title><year>${scenario.year}</year>` +
      `<uniqueid type="tmdb">${scenario.tmdbId}</uniqueid></movie>\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ type:'copy_complete', scenario:scenario.id,
    elapsedMs:Date.now() - startedAtMs })}\n`);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot:`real-device-metadata-${scenario.id}-secret-20260813` });
  const calls = [];
  let runtimeError = null;
  let requestError = null;
  let host;
  let monitor;
  let sampler;
  const gpuSamples = [];
  try {
    host = await createCleanServiceHost({ dataDir, adminDistDir:adminRoot,
      secretRoot:`real-device-metadata-${scenario.id}-secret-20260813`,
      libraWorkspaceRoot:workspaceRoot, integrationFetch:countedFetch(calls),
      ...(scenario.cpuFallback ? { platformComputeRuntime:cpuOnlyRuntime() } : {}),
      onExecutionRuntimeError(error) { runtimeError = error; },
      onRequestError(error) { requestError = error; },
    });
    const cookie = await session(host, initialized.adminApiKey);
    await configureTmdb(host, cookie, tmdbCredential, tmdbCredentialKind, `real-${scenario.id}`);
    await createShelf(host, cookie, shelfRoot, `real-${scenario.id}`);
    const fieldId = await createField(host, cookie, fieldRoot, `real-${scenario.id}`);
    await route(host, cookie, `real-${scenario.id}`, fieldId);
    await observe(host, cookie, `real-${scenario.id}`, fieldId);
    const subject = await waitFor(host, cookie, (items) => items.find((item) =>
      item.displayIdentity === `${scenario.title} (${scenario.year})` && item.acceptanceSpecRevision === 1),
    () => runtimeError || requestError, 10 * 60 * 1000);
    if (scenario.rating !== null) {
      await rate(host, cookie, scenario, subject);
      await waitFor(host, cookie, (items) => items.find((item) => item.subjectId === subject.subjectId &&
        item.acceptanceSpecRevision === 2), () => runtimeError || requestError, 10 * 60 * 1000);
    }
    monitor = setInterval(() => {
      try {
        const snapshot = databaseSnapshot(databasePath, subject.subjectId);
        process.stdout.write(`${JSON.stringify({ type:'progress', scenario:scenario.id,
          elapsedMs:Date.now() - startedAtMs, rssBytes:process.memoryUsage().rss,
          runState:snapshot.run?.state || null, packages:snapshot.packages,
          transcodes:snapshot.transcodes, events:snapshot.events,
          failedWorks:snapshot.failedWorks, failedEvents:snapshot.failedEvents })}\n`);
      } catch (error) { runtimeError = error; }
    }, MONITOR_INTERVAL_MS);
    if (scenario.id === 'gpu') sampler = setInterval(() => {
      const value = nvidiaSample();
      if (value) gpuSamples.push(value);
    }, DEVICE_SAMPLE_INTERVAL_MS);
    const ready = await waitFor(host, cookie, (items) => items.find((item) => item.subjectId === subject.subjectId &&
      item.productionStage === 'handoff_b_ready' && item.handoffB?.state === 'published' && item.handoffB?.offerId),
    () => runtimeError || requestError);
    clearInterval(monitor); monitor = null;
    if (sampler) { clearInterval(sampler); sampler = null; }
    assert.ok(ready.handoffB.offerId);
    const snapshot = databaseSnapshot(databasePath, subject.subjectId);
    assert.equal(snapshot.failedWorks, 0);
    assert.equal(snapshot.failedEvents, 0);
    assert.equal(snapshot.consumedOffers, 0);
    assert.equal(snapshot.arcaEntries, 0);
    const product = inspectProduct(databasePath, workspaceRoot, subject.subjectId);
    const artifactEvidence = assertArtifactBytes(scenario, product);
    const providerIdentities = product.identity.providerIdentities || [];
    assert.ok(providerIdentities.some((item) => item.provider === 'tmdb' && item.providerKey === scenario.tmdbId));
    const metadataEntries = Object.fromEntries(product.metadata.descriptiveFacts.entries.map((item) => [item.key, item.value]));
    for (const field of ['title', 'year_or_release_date', 'plot', 'genre', 'director', 'tmdb_movie_id']) {
      assert.ok(metadataEntries[field] !== undefined && String(metadataEntries[field]).trim(), `Missing real metadata field: ${field}`);
    }
    assert.ok(product.mediaCast.relations.some((item) => item.role === 'actor' &&
      item.confidenceClass === 'provider_asserted' && item.providerIdentities.some((identity) =>
      identity.provider === 'tmdb' && identity.namespace === 'tmdb_person')),
    'Real TMDB actor evidence is absent from Media-Cast Fact.');
    assert.equal(String(metadataEntries.tmdb_movie_id), scenario.tmdbId);
    if (scenario.expectedDeviceClass) {
      assert.ok(product.transcodes.length >= 1, `${scenario.id} did not execute a Transcode Event.`);
      assert.ok(product.transcodes.every((item) => item.deviceClass === scenario.expectedDeviceClass &&
        item.resultDeviceClass === scenario.expectedDeviceClass));
      assert.ok(product.transcodes.every((item) => item.outputSizeBytes <= 2 * 1073741824));
    } else {
      assert.equal(product.transcodes.length, 0, 'Metadata-only no-rating input must remain direct.');
    }
    if (scenario.id === 'metadata') {
      assert.equal(fs.readdirSync(movieRoot).filter((name) => name.toLowerCase().endsWith('.nfo')).length, 0,
        'Metadata source fixture unexpectedly contains an NFO.');
      assert.ok(product.metadata.fieldProvenance.every((item) => item.sourceKind === 'provider'));
      assert.ok(calls.some((item) => item.host === 'api.themoviedb.org' && item.path === '/3/search/movie'));
      assert.ok(calls.some((item) => item.host === 'api.themoviedb.org' && item.path.includes(`/3/movie/${scenario.tmdbId}`)));
      assert.ok(calls.some((item) => item.host === 'image.tmdb.org'));
    }
    const sourceAfter = boundedReality(source);
    assert.deepEqual(sourceAfter, sourceBefore);
    const maxGpu = gpuSamples.reduce((value, item) => ({
      gpuUtilizationPct:Math.max(value.gpuUtilizationPct, item.gpuUtilizationPct),
      encoderUtilizationPct:Math.max(value.encoderUtilizationPct, item.encoderUtilizationPct),
      memoryUsedMiB:Math.max(value.memoryUsedMiB, item.memoryUsedMiB),
      powerDrawW:Math.max(value.powerDrawW, item.powerDrawW),
    }), { gpuUtilizationPct:0, encoderUtilizationPct:0, memoryUsedMiB:0, powerDrawW:0 });
    const report = Object.freeze({ schema:'helix.real-libra-device-metadata-scenario@1', result:'passed',
      scenario:scenario.id, movie:{ title:scenario.title, year:scenario.year, tmdbId:scenario.tmdbId,
        sourceBytes:sourceBefore.sizeBytes }, elapsedMs:Date.now() - startedAtMs,
      execution:{ libraRunId:product.run.libra_run_id, packageId:product.run.on_deck_package_id,
        offerId:product.run.offer_id, offerState:'open', transcodes:product.transcodes,
        failedWorks:snapshot.failedWorks, failedEvents:snapshot.failedEvents,
        consumedOffers:snapshot.consumedOffers, arcaEntries:snapshot.arcaEntries },
      metadata:{ entries:metadataEntries, providerOnly:scenario.id === 'metadata',
        tmdbRequestPaths:Object.freeze(calls.filter((item) => item.host.endsWith('themoviedb.org'))
          .map((item) => `${item.method} ${item.host}${item.path}`)), ...artifactEvidence },
      device:{ expectedClass:scenario.expectedDeviceClass,
        ordinaryDevicesControlledUnavailable:Boolean(scenario.cpuFallback), maxObservedGpu:maxGpu,
        gpuSampleCount:gpuSamples.length },
      safety:{ sourceRealityUnchanged:true, sourceReality:sourceBefore,
        materialFieldIsTemp:true, shelfIsTemp:true, offerConsumed:false, arcaEntries:0 },
      root, databasePath, workspaceRoot,
    });
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    if (monitor) clearInterval(monitor);
    if (sampler) clearInterval(sampler);
    if (host) await host.close();
  }
}

async function main() {
  const tmdbCredential = requiredEnvironment('HELIX_TMDB_CREDENTIAL');
  const tmdbCredentialKind = String(process.env.HELIX_TMDB_CREDENTIAL_KIND || 'access_token').trim();
  if (!['api_key', 'access_token'].includes(tmdbCredentialKind)) {
    fail('HELIX_TMDB_CREDENTIAL_KIND must be api_key or access_token.');
  }
  const selected = String(process.env.HELIX_REAL_SCENARIOS || 'gpu,cpu_fallback,metadata')
    .split(',').map((item) => item.trim()).filter(Boolean);
  const chosen = scenarios.filter((item) => selected.includes(item.id));
  if (chosen.length !== selected.length) fail('HELIX_REAL_SCENARIOS contains an unknown scenario.');
  const reports = [];
  for (const scenario of chosen) {
    reports.push(await runScenario(scenario, tmdbCredential, tmdbCredentialKind));
  }
  const aggregate = Object.freeze({ schema:'helix.real-libra-device-metadata-e2e@1', result:'passed',
    scenarios:Object.freeze(reports.map((item) => ({ scenario:item.scenario, root:item.root,
      databasePath:item.databasePath, elapsedMs:item.elapsedMs, offerId:item.execution.offerId }))) });
  process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ result:'failed', code:error.code || 'HELIX_REAL_DEVICE_METADATA_E2E_FAILED',
    message:error.message, stack:error.stack })}\n`);
  process.exitCode = 1;
});
