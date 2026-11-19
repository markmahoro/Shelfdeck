'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { JAV_SOURCE_TRANSPORTS } = require('../../src/helix/contracts/jav-source-profiles');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createJavClassTransport } = require('./fixtures/jav-class-transport');

const SECRET_ROOT = 'duplicate-ondeck-journey-secret-0123456789abcdef0123';

function encodeSampleVideo(outputPath, color, durationSeconds) {
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const encoded = spawnSync(ffmpeg, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=24:d=${durationSeconds}`,
    '-c:v', 'libx265', '-preset', 'ultrafast',
    '-x265-params', 'pools=1:frame-threads=1', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    outputPath,
  ], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(encoded.status, 0, encoded.stderr);
  return fs.readFileSync(outputPath);
}

test('same-Shelf duplicate single DDOB-019 On-deck commits into (2), passes Aftercare, and enters Off-deck Duplicate Detection', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-duplicate-ondeck-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const source = path.join(root, 'source');
  const target = path.join(root, 'shelf');
  for (const directory of [adminDistDir, source, target]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');

  const picture = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#376892' } })
    .jpeg().toBuffer();
  const initialized = initializeCleanData({
    dataDir, secretRoot: SECRET_ROOT, confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
  });
  let requestError = null;
  let runtimeError = null;
  let clockEpoch = Date.parse('2026-10-31T02:00:00+08:00');
  let clockStart = Date.now();
  const clock = () => clockEpoch + (Date.now() - clockStart);
  const host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot: SECRET_ROOT,
    now: clock,
    integrationFetch: createJavClassTransport(picture, [], {
      sites: ['javdb'],
      javCode: 'DDOB-019',
      title: 'Fixture JAV film',
    }),
    onExecutionRuntimeError: (error) => { runtimeError = error; },
    onRequestError: (error) => { requestError = error; },
  });
  const db = new Database(path.join(dataDir, 'shelfdeck.db'));
  t.after(async () => {
    await host.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const login = await host.inject({
    method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': initialized.adminApiKey },
  });
  assert.equal(login.statusCode, 204);
  const cookie = login.headers['set-cookie'];

  async function request(method, url, payload) {
    requestError = null;
    const response = await host.inject({ method, url, headers: { cookie }, payload });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${response.body}\n${requestError?.stack || ''}`);
    return response.json();
  }

  const diagnostics = () => JSON.stringify({
    runtimeError: runtimeError?.message || null,
    runs: db.prepare('SELECT libra_run_id, state FROM libra_runs').all(),
    ondeck: db.prepare('SELECT on_deck_run_id, state FROM arca_ondeck_runs').all(),
    commits: db.prepare('SELECT shelf_entry_id, on_deck_run_id FROM arca_ondeck_commit_receipts').all(),
    identities: db.prepare('SELECT shelf_entry_id, revision, identity_kind, provider, provider_key, identity_digest FROM arca_canonical_identity_revisions').all(),
    attempts: db.prepare('SELECT event_id, failure_code, failure_class FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
    works: db.prepare('SELECT work_id, work_kind, process_id, state FROM fx_supporting_works').all(),
    events: db.prepare("SELECT work_id, event_id, capability_ref, state FROM fx_workflow_events WHERE capability_ref LIKE 'arca.offdeck.%'").all(),
    groups: db.prepare('SELECT duplicate_group_id, state FROM arca_offdeck_duplicate_groups').all(),
  });

  async function waitCommitCount(expectedCount) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !runtimeError) {
      const count = db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n;
      if (count >= expectedCount) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(runtimeError, null, diagnostics());
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n, expectedCount, diagnostics());
  }

  const proof = await request('POST', '/v1/admin/settings/integrations/jav-javdb/actions/test', {
    kind: 'jav-javdb',
    idempotencyKey: 'dup-jav-test',
    endpoint: JAV_SOURCE_TRANSPORTS.javdb.endpoints[0],
    credential: { kind: 'anonymous' },
    settings: { networkRoute: { mode: 'direct', proxyEndpoint: null } },
  });
  await request('PATCH', '/v1/admin/settings/integrations/jav-javdb', {
    kind: 'jav-javdb',
    idempotencyKey: 'dup-jav-configure',
    expectedConfigRevision: 0,
    connectionProofId: proof.connectionProofId,
  });

  await request('POST', '/v1/admin/shelves', {
    idempotencyKey: 'dup-jav-shelf',
    shelfId: 'jav-shelf',
    name: 'JAV Duplicate Fixture',
    targetRootLocation: target,
    ruleTemplateId: 'system-jav-recommended',
    expectedTemplateRevision: 1,
    placementPolicy: {
      folderTemplate: '{title}',
      primaryTemplate: '{stem}{ext}',
      nfoTemplate: '{stem}.nfo',
      subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
      posterTemplate: 'poster{ext}',
      fanartTemplate: 'fanart{ext}',
      collisionPolicy: 'reject',
    },
  });

  const fieldId = 'jav-field';
  const access = {
    fieldId, revision: 1, endpointId: 'jav-endpoint', rootLocation: source,
    mountScopeId: 'jav-mount', mountScopeRevision: 1, accessSchemaRef: 'helix://fixtures/dup-jav-access/v1',
  };
  const policy = {
    includedDirectories: [], excludedDirectories: [], allowedExtensions: ['.mkv'], minimumSizeBytes: 0, excludedMaterialKeys: [],
  };
  await request('POST', '/v1/admin/material-fields', {
    idempotencyKey: 'dup-jav-field',
    fieldId,
    name: 'JAV Source',
    contentProfileHint: 'jav',
    policy: {
      extractionPolicyId: 'jav-extraction',
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy,
      policyDigest: canonicalDigest({ extractionPolicyId: 'jav-extraction', revision: 1, ...policy }),
    },
    access: { ...access, accessDigest: canonicalDigest(access) },
  });
  await request('PATCH', `/v1/admin/routing/material-fields/${fieldId}`, {
    idempotencyKey: 'dup-jav-route',
    fieldId,
    expectedPolicyId: null,
    expectedRevision: 0,
    policy: {
      routingPolicyId: 'jav-route',
      mode: 'sorting',
      targets: [{
        shelfId: 'jav-shelf',
        rank: 1,
        matchExpression: { nodeKind: 'predicate', factKind: 'content_profile', operator: 'eq', expectedValue: 'jav' },
      }],
    },
  });
  await request('POST', '/v1/admin/settings/automatic-operation/actions/enable-full', {
    idempotencyKey: 'dup-settlement-auth',
    expectedRevision: 0,
    coverExclusiveRelatedInput: true,
  });

  // First DDOB-019 ingestion.
  const video1Path = path.join(source, 'DDOB-019.mkv');
  const video1Bytes = encodeSampleVideo(video1Path, 'black', 2);
  await request('POST', `/v1/admin/material-fields/${fieldId}/actions/observe`, {
    idempotencyKey: 'dup-observe-1', fieldId, expectedAccessRevision: 1, expectedObservationRevision: 0, pageBudget: 8,
  });
  await waitCommitCount(1);

  // Second DDOB-019 ingestion with distinct source bytes into the same Shelf.
  const video2Path = path.join(source, 'DDOB-019.mkv');
  const video2Bytes = encodeSampleVideo(video2Path, 'blue', 3);
  const currentField = (await request('GET', '/v1/admin/material-fields')).items[0];
  await request('POST', `/v1/admin/material-fields/${fieldId}/actions/observe`, {
    idempotencyKey: 'dup-observe-2',
    fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: currentField.currentObservationRevision,
    pageBudget: 8,
  });
  await waitCommitCount(2);

  assert.equal(
    db.prepare("SELECT count(*) n FROM fx_event_attempts WHERE failure_code='CLEAN_ARCA_STAGE_TARGET_OCCUPIED'").get().n,
    0,
    diagnostics(),
  );

  const entries = db.prepare(
    "SELECT shelf_entry_id, canonical_identity_key FROM arca_shelf_entries WHERE status='active' ORDER BY created_at_ms ASC",
  ).all();
  assert.equal(entries.length, 2, diagnostics());
  assert.equal(entries[0].canonical_identity_key, entries[1].canonical_identity_key);

  const materialsFor = (entryId) => db.prepare(
    'SELECT m.role, m.location FROM arca_inventory_materials m JOIN arca_shelf_entries e ' +
    'ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision ' +
    'WHERE m.shelf_entry_id=?',
  ).all(entryId);
  const entry1Materials = Object.fromEntries(materialsFor(entries[0].shelf_entry_id).map((row) => [row.role, row.location]));
  const entry2Materials = Object.fromEntries(materialsFor(entries[1].shelf_entry_id).map((row) => [row.role, row.location]));

  const dir1 = path.join(target, 'Fixture JAV film');
  const dir2 = path.join(target, 'Fixture JAV film (2)');
  assert.equal(entry1Materials.primary_payload, path.join(dir1, 'Fixture JAV film.mkv'));
  assert.equal(entry1Materials.metadata_sidecar, path.join(dir1, 'Fixture JAV film.nfo'));
  assert.equal(entry2Materials.primary_payload, path.join(dir2, 'Fixture JAV film.mkv'));
  assert.equal(entry2Materials.metadata_sidecar, path.join(dir2, 'Fixture JAV film.nfo'));
  assert.deepEqual(fs.readFileSync(entry1Materials.primary_payload), video1Bytes);
  assert.deepEqual(fs.readFileSync(entry2Materials.primary_payload), video2Bytes);

  const collection = await request('GET', '/v1/admin/collection?limit=24');
  assert.equal(collection.items.length, 2);

  // Trigger Aftercare health check on the second copy and confirm healthy placement.
  await request('POST', `/v1/admin/care/${entries[1].shelf_entry_id}/actions/check`, {
    idempotencyKey: 'dup-aftercare-check-2',
  });
  let careDetail = null;
  const careDeadline = Date.now() + 65000;
  while (Date.now() < careDeadline && !runtimeError) {
    careDetail = await request('GET', `/v1/admin/care/${entries[1].shelf_entry_id}`);
    if (careDetail?.health?.state === 'healthy' &&
        db.prepare('SELECT count(*) n FROM arca_aftercare_assessments WHERE shelf_entry_id=?').get(entries[1].shelf_entry_id).n >= 3) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(runtimeError, null, diagnostics());
  assert.equal(careDetail?.health?.state, 'healthy', JSON.stringify(careDetail));
  assert.equal(
    db.prepare("SELECT count(*) n FROM arca_aftercare_findings f JOIN arca_aftercare_assessments a USING(assessment_id) WHERE a.shelf_entry_id=? AND f.finding_kind LIKE '%placement%'").get(entries[1].shelf_entry_id).n,
    0,
  );

  // Enter the Saturday maintenance window so Off-deck Duplicate Detection work is admitted.
  clockEpoch = Date.parse('2026-10-31T03:00:00+08:00');
  clockStart = Date.now();

  // Trigger Off-deck Duplicate Detection and confirm both Shelf Entries form one duplicate group.
  const detectResult = await request('POST', '/v1/admin/offdeck/actions/detect-duplicates', {
    idempotencyKey: 'dup-offdeck-detect',
  });
  let candidates = null;
  const offdeckDeadline = Date.now() + 30000;
  while (Date.now() < offdeckDeadline && !runtimeError) {
    candidates = await request('GET', '/v1/admin/offdeck/candidates');
    if (candidates.duplicateGroups?.length >= 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const runtimeState = await request('GET', '/v1/admin/runtime');
  assert.equal(runtimeError, null, diagnostics());
  assert.equal(
    candidates.duplicateGroups.length,
    1,
    JSON.stringify({ detectResult, runtimeState, candidates, diag: JSON.parse(diagnostics()) }),
  );
  assert.equal(candidates.duplicateGroups[0].state, 'open', JSON.stringify(candidates));
  assert.deepEqual(
    candidates.duplicateGroups[0].members.map((item) => item.shelf_entry_id).sort(),
    entries.map((item) => item.shelf_entry_id).sort(),
  );
  assert.equal(
    candidates.candidates.some(
      (item) =>
        item.candidate_kind === 'duplicate_group' &&
        item.duplicate_group_id === candidates.duplicateGroups[0].duplicate_group_id &&
        item.state === 'open',
    ),
    true,
    JSON.stringify(candidates),
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
