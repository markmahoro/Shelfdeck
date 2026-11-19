'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { SYSTEM_TEMPLATE_ID } = require('../../src/helix/domains/arca/model/rule-template-contracts');

const MOVIEPILOT_KEY = 'movie-custom-acceptance-mp-key';
const SECRET = 'movie-custom-acceptance-secret-0123456789abcdef0123456789';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('full Docker host journey: 1080p AVC AAC movie freezes on 5-star 4K shelf, confirms minimal custom spec, transcodes HEVC, and commits via Arca custom target', { timeout: 240000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-movie-custom-host-'));
  const dataDir = path.join(root, 'data');
  const sourceDir = path.join(root, 'source');
  const shelfDir = path.join(root, 'shelf');
  const downloadsDir = path.join(root, 'downloads');
  const adminDistDir = path.join(root, 'admin');
  for (const dir of [dataDir, sourceDir, shelfDir, downloadsDir, adminDistDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');

  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const sourceFile = path.join(sourceDir, '巴黎夜旅人 (2022) - 1080p AVC DTS.mkv');
  const encoded = spawnSync(ffmpeg, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=24:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', sourceFile,
  ], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(encoded.status, 0, encoded.stderr);

  const image = await sharp({ create: { width: 360, height: 540, channels: 3, background: '#3a577a' } }).jpeg().toBuffer();
  const movie = {
    id: 778899,
    title: '巴黎夜旅人',
    original_title: 'Revoir Paris',
    release_date: '2022-11-09',
    overview: 'A survivor searches for meaning after an attack in Paris.',
    genres: [{ id: 18, name: '剧情' }],
    poster_path: '/poster.jpg',
    backdrop_path: '/fanart.jpg',
    credits: {
      cast: [{ id: 201, name: 'Virginie Efira', character: 'Mia', order: 0 }],
      crew: [{ id: 202, name: 'Alice Winocour', job: 'Director', department: 'Directing' }],
    },
  };

  const errors = [];
  let host;
  let db;
  t.after(async () => {
    await host?.close();
    db?.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const initialized = initializeCleanData({ dataDir, secretRoot: SECRET, confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
  host = await createCleanServiceHost({
    dataDir,
    secretRoot: SECRET,
    adminDistDir,
    onExecutionRuntimeError: error => errors.push([error.code, error.message, error.details ? JSON.stringify(error.details) : ''].filter(Boolean).join(': ')),
    integrationFetch: async input => {
      const url = new URL(String(input));
      if (url.hostname === 'image.tmdb.org') return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
      if (url.hostname === 'api.themoviedb.org') {
        if (url.pathname.endsWith('/configuration')) return jsonResponse(200, { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } });
        if (url.pathname.endsWith('/movie/550')) return jsonResponse(200, {
          id: 550, title: 'Fight Club', original_title: 'Fight Club', release_date: '1999-10-15',
          overview: 'TMDB live test fixture', genres: [{ id: 18, name: 'Drama' }],
        });
        if (url.pathname.endsWith('/search/movie')) return jsonResponse(200, { page: 1, results: [{ id: 778899, title: movie.title, original_title: movie.original_title, release_date: movie.release_date }], total_pages: 1, total_results: 1 });
        if (url.pathname.endsWith('/movie/778899')) return jsonResponse(200, movie);
        if (url.pathname.endsWith('/movie/778899/images')) return jsonResponse(200, { id: 778899, posters: [{ file_path: '/poster.jpg' }], backdrops: [{ file_path: '/fanart.jpg' }] });
        return jsonResponse(404, { detail: 'tmdb route not found' });
      }
      if (url.hostname === 'moviepilot.test') {
        if (url.searchParams.get('token') !== MOVIEPILOT_KEY) return jsonResponse(401, { detail: 'denied' });
        if (url.pathname === '/api/v1/search/title') return jsonResponse(200, { success: true, data: [] });
        if (url.pathname === '/api/v1/download/' || url.pathname === '/api/v1/history/download') return jsonResponse(200, []);
        if (url.pathname === '/api/v1/history/transfer') return jsonResponse(200, { success: true, data: { list: [], total: 0 } });
        return jsonResponse(404, { detail: 'mp route not found' });
      }
      throw new Error('Unexpected fetch URL: ' + url.toString());
    },
  });
  db = new Database(path.join(dataDir, 'shelfdeck.db'));

  const login = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': initialized.adminApiKey } });
  assert.equal(login.statusCode, 204);
  const cookie = login.headers['set-cookie'];

  async function req(method, url, payload) {
    const res = await host.inject({ method, url, headers: { cookie }, payload });
    assert.ok(res.statusCode >= 200 && res.statusCode < 300, `${method} ${url} -> ${res.statusCode}: ${res.body}`);
    return res.statusCode === 204 ? null : res.json();
  }

  // Configure TMDB + MoviePilot + Shelf + Full Automatic Operation
  const tmdbTest = await req('POST', '/v1/admin/settings/integrations/tmdb/actions/test', {
    kind: 'tmdb', idempotencyKey: 'tmdb-test', endpoint: 'https://api.themoviedb.org/3',
    credential: { kind: 'api_key', value: 'tmdb-test-key' }, settings: { language: 'zh-CN', proxyServer: '' }, timeoutMs: 5000,
  });
  await req('PATCH', '/v1/admin/settings/integrations/tmdb', {
    kind: 'tmdb', idempotencyKey: 'tmdb-save', expectedConfigRevision: 0, connectionProofId: tmdbTest.connectionProofId,
  });
  const mpTest = await req('POST', '/v1/admin/settings/integrations/moviepilot/actions/test', {
    kind: 'moviepilot', idempotencyKey: 'mp-test', endpoint: 'https://moviepilot.test',
    credential: { kind: 'api_key', value: MOVIEPILOT_KEY },
    settings: { providerRequestSaveRoot: '/provider/dl', providerOrganizedRoot: '/provider/org', shelfDeckVisibleRoot: downloadsDir },
    timeoutMs: 5000,
  });
  await req('PATCH', '/v1/admin/settings/integrations/moviepilot', {
    kind: 'moviepilot', idempotencyKey: 'mp-save', expectedConfigRevision: 0, connectionProofId: mpTest.connectionProofId,
  });
  await req('POST', '/v1/admin/shelves', {
    idempotencyKey: 'shelf-create', shelfId: 'movie-shelf', name: 'Movie 5-Star', targetRootLocation: shelfDir,
    ruleTemplateId: SYSTEM_TEMPLATE_ID, expectedTemplateRevision: 1,
    placementPolicy: {
      folderTemplate: '{title} ({year})', primaryTemplate: '{stem}{ext}', nfoTemplate: '{stem}.nfo',
      subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}', posterTemplate: 'poster{ext}', fanartTemplate: 'fanart{ext}', collisionPolicy: 'reject',
    },
  });
  await req('POST', '/v1/admin/settings/automatic-operation/actions/enable-full', {
    idempotencyKey: 'auto-full', expectedRevision: 0, coverExclusiveRelatedInput: true,
  });

  // Create field WITHOUT routing first, observe so we can set rating=5 before Libra spec creation
  const fieldId = 'movie-field';
  const policy = { includedDirectories: [], excludedDirectories: [], allowedExtensions: ['.mkv'], minimumSizeBytes: 0, excludedMaterialKeys: [] };
  const access = { fieldId, revision: 1, endpointId: 'movie-ep', rootLocation: sourceDir, mountScopeId: 'movie-mount', mountScopeRevision: 1, accessSchemaRef: 'helix://fixtures/movie-access/v1' };
  await req('POST', '/v1/admin/material-fields', {
    idempotencyKey: 'field-create', fieldId, name: 'Movies', contentProfileHint: 'movie',
    policy: { extractionPolicyId: 'movie-policy', revision: 1, policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy, policyDigest: canonicalDigest({ extractionPolicyId: 'movie-policy', revision: 1, ...policy }) },
    access: { ...access, accessDigest: canonicalDigest(access) },
  });
  await req('POST', '/v1/admin/material-fields/' + fieldId + '/actions/observe', {
    idempotencyKey: 'observe-1', fieldId, expectedAccessRevision: 1, expectedObservationRevision: 0, pageBudget: 8,
  });

  async function waitUntil(predicate, message, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assert.deepEqual(errors, [], 'Runtime errors: ' + JSON.stringify(errors));
      const result = await predicate();
      if (result) return result;
      await pause(100);
    }
    assert.fail(message + ': ' + JSON.stringify({
      runs: db.prepare('SELECT libra_run_id,subject_id,state,acceptance_spec_id FROM libra_runs').all(),
      works: db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all(),
      commits: db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,
    }));
  }

  const unresolved = await waitUntil(async () => {
    const page = await req('GET', '/v1/admin/formation?limit=25');
    return page.items.find(item => item.subjectId);
  }, 'Subject did not enter Formation');

  await req('POST', '/v1/admin/perception/records', {
    targetType: 'subject', targetId: unresolved.subjectId, expectedRevision: 0, rating: 5, idempotencyKey: 'rate-5-star',
  });
  await waitUntil(async () => {
    const r = await req('GET', '/v1/admin/perception/records?targetType=subject&targetId=' + encodeURIComponent(unresolved.subjectId));
    return r.currentRating?.state === 'ready' && r.currentRating.rating === 5;
  }, '5-star rating did not settle');

  await req('PATCH', '/v1/admin/routing/material-fields/' + fieldId, {
    idempotencyKey: 'routing-save', fieldId, expectedPolicyId: null, expectedRevision: 0,
    policy: { routingPolicyId: 'movie-route', mode: 'direct', targets: [{ shelfId: 'movie-shelf', rank: 1, matchExpression: { nodeKind: 'always' } }] },
  });

  const frozenRun = await waitUntil(async () => {
    const row = db.prepare("SELECT * FROM libra_runs WHERE subject_id=? AND state='frozen'").get(unresolved.subjectId);
    return row || null;
  }, 'Standard 4K Run did not freeze after empty MoviePilot search');

  // Step 1: Prepare custom target preview via HTTP Admin API
  const previewRes = await req('POST', `/v1/admin/formation/runs/${frozenRun.libra_run_id}/actions/prepare-custom-target-preview`, {
    subjectId: unresolved.subjectId,
    idempotencyKey: 'prepare-preview-1',
  });
  assert.equal(previewRes.kind, 'preview');
  const codes = previewRes.record.proposals.map(p => p.change.requirementCode).sort();
  assert.deepEqual(codes, ['minimum_raster_unmet', 'primary_audio_unmet']);
  assert.equal(previewRes.record.baseRequirements.mandatoryMedia.videoCodec, 'hevc');
  assert.equal(previewRes.record.baseRequirements.space.maxSizeGiB, 50);

  const fetched = await req('GET', `/v1/admin/formation/runs/${frozenRun.libra_run_id}/custom-target-previews/${previewRes.record.previewDigest}`);
  assert.equal(fetched.record.previewDigest, previewRes.record.previewDigest);

  const replayedPreview = await req('POST', `/v1/admin/formation/runs/${frozenRun.libra_run_id}/actions/prepare-custom-target-preview`, {
    subjectId: unresolved.subjectId,
    idempotencyKey: 'prepare-preview-1',
  });
  assert.equal(replayedPreview.replayed, true);
  assert.equal(replayedPreview.record.previewDigest, previewRes.record.previewDigest);

  // Confirm with wrong digest must fail cleanly (409)
  const badConfirm = await host.inject({
    method: 'POST',
    url: `/v1/admin/formation/runs/${frozenRun.libra_run_id}/actions/confirm-custom-target`,
    headers: { cookie },
    payload: {
      previewDigest: 'f'.repeat(64),
      selectedChangeDigests: previewRes.record.proposals.map(p => p.changeDigest),
      acknowledged: true,
      idempotencyKey: 'bad-confirm',
    },
  });
  assert.equal(badConfirm.statusCode, 404);

  // Step 2: Confirm custom target (202) and let runtime continue -> transcode HEVC -> Handoff B -> Arca Commit!
  const confirmAccepted = await host.inject({
    method: 'POST',
    url: `/v1/admin/formation/runs/${frozenRun.libra_run_id}/actions/confirm-custom-target`,
    headers: { cookie },
    payload: {
      previewDigest: previewRes.record.previewDigest,
      selectedChangeDigests: previewRes.record.proposals.map(p => p.changeDigest),
      acknowledged: true,
      idempotencyKey: 'confirm-custom-1',
    },
  });
  assert.equal(confirmAccepted.statusCode, 202, confirmAccepted.body);
  assert.equal(confirmAccepted.json().kind, 'confirmed');

  // Reconfirm with same key must replay cleanly
  const confirmReplay = await host.inject({
    method: 'POST',
    url: `/v1/admin/formation/runs/${frozenRun.libra_run_id}/actions/confirm-custom-target`,
    headers: { cookie },
    payload: {
      previewDigest: previewRes.record.previewDigest,
      selectedChangeDigests: previewRes.record.proposals.map(p => p.changeDigest),
      acknowledged: true,
      idempotencyKey: 'confirm-custom-1',
    },
  });
  assert.equal(confirmReplay.statusCode, 202);
  assert.equal(confirmReplay.json().replayed, true);

  await waitUntil(() => db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n === 1,
    'Custom target replacement Run did not complete Arca On-deck Commit');

  assert.equal(db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(frozenRun.libra_run_id).state, 'superseded');
  const completedRun = db.prepare("SELECT * FROM libra_runs WHERE supersedes_run_id=? AND state='completed'").get(frozenRun.libra_run_id);
  assert.ok(completedRun);
  assert.ok(db.prepare("SELECT e.event_id FROM fx_workflow_events e JOIN fx_supporting_works w USING(work_id) WHERE w.process_id=? AND e.capability_ref='libra.media.transcode@1' AND e.state='succeeded'").get(completedRun.libra_run_id));
  assert.equal(db.prepare('SELECT count(*) n FROM arca_collection_target_heads').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM arca_collection_target_intents').get().n, 1);

  // Verify stale preview confirm against superseded Run is rejected with 409
  const staleConfirm = await host.inject({
    method: 'POST',
    url: `/v1/admin/formation/runs/${frozenRun.libra_run_id}/actions/confirm-custom-target`,
    headers: { cookie },
    payload: {
      previewDigest: previewRes.record.previewDigest,
      selectedChangeDigests: previewRes.record.proposals.map(p => p.changeDigest),
      acknowledged: true,
      idempotencyKey: 'confirm-stale-after-superseded',
    },
  });
  assert.equal(staleConfirm.statusCode, 409);

  // Verify Formation + Collection HTTP projections & Aftercare check
  const collection = await req('GET', '/v1/admin/collection?limit=24');
  assert.equal(collection.items.length, 1);
  const entry = collection.items[0];
  assert.equal(entry.collectionBasis, 'user_custom');
  assert.equal(entry.defectAdmission, null);
  assert.equal(entry.primaryContainer, 'MKV');
  assert.equal(entry.customTarget.targetRevision, 1);
  assert.equal(entry.customTarget.changes.length, 2);
  const placedPrimary = db.prepare("SELECT location FROM arca_inventory_materials m JOIN arca_shelf_entries e USING(shelf_entry_id) WHERE m.inventory_revision=e.current_inventory_revision AND m.role='primary_payload'").get();
  assert.ok(placedPrimary && fs.existsSync(placedPrimary.location));
  const ffprobe = process.env.FFPROBE_PATH || require('ffprobe-static').path;
  const probed = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', placedPrimary.location], { encoding: 'utf8', windowsHide: true });
  assert.equal(probed.status, 0, probed.stderr);
  assert.equal(JSON.parse(probed.stdout).streams[0].codec_name, 'hevc');

  const detail = await req('GET', `/v1/admin/collection/${entry.shelfEntryId}`);
  assert.equal(detail.collectionBasis, 'user_custom');
  assert.equal(detail.customTarget.targetRevision, 1);

  await req('POST', `/v1/admin/care/${entry.shelfEntryId}/actions/check`, { idempotencyKey: 'care-check-custom' });
  await waitUntil(async () => {
    const refreshed = await req('GET', `/v1/admin/collection/${entry.shelfEntryId}`);
    return refreshed.health?.state === 'healthy';
  }, 'Aftercare health check did not become healthy against user_custom target');

  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
