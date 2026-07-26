'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCleanServiceHost } = require('../../src/clean-service-host');

const secretRoot = 'p14-series-handoff-a-secret-root-0123456789abcdef';

function probe(readHandle) {
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    durationMs: 1000,
    videoStreams: [{
      streamIndex: 0,
      codec: 'hevc',
      dispositionDefault: true,
      width: 1920,
      height: 1080,
    }],
    audioStreams: [],
    subtitleStreams: [],
    discTopology: null,
    payloadDigest: '',
  };
  value.payloadDigest = canonicalDigest(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'payloadDigest'),
  ));
  return Object.freeze(value);
}

async function session(host, apiKey) {
  return (await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  })).headers['set-cookie'];
}

test('Series public HTTP publishes one Season Candidate and accepts one new Subject with N:M Episodes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-series-handoff-a-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const sourceRoot = path.join(root, 'series-source');
  const seasonRoot = path.join(sourceRoot, 'Season 1');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.mkdirSync(seasonRoot, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<!doctype html><div id="root"></div>');

  const sources = [
    ['Demo.Show.S01E01.mkv', Buffer.from('series-episode-1')],
    ['Demo.Show.S01E01.nfo', Buffer.from('<episodedetails><season>1</season><episode>1</episode></episodedetails>')],
    ['Demo.Show.S01E02.mkv', Buffer.from('series-episode-2')],
    ['Demo.Show.S01E02.nfo', Buffer.from('<episodedetails><season>1</season><episode>2</episode></episodedetails>')],
  ];
  for (const [name, bytes] of sources) fs.writeFileSync(path.join(seasonRoot, name), bytes);
  const before = new Map(sources.map(([name]) => {
    const file = path.join(seasonRoot, name);
    return [file, { bytes: fs.readFileSync(file), mtimeMs: fs.statSync(file).mtimeMs }];
  }));

  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const mediaProbe = Object.freeze({ async probe(readHandle) { return probe(readHandle); } });
  const access = {
    fieldId: 'series-handoff-field',
    revision: 1,
    endpointId: 'series-handoff-endpoint',
    rootLocation: sourceRoot,
    mountScopeId: 'series-handoff-mount',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/series-handoff-access/v1',
  };
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv', '.nfo'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'series-handoff-policy',
    revision: 1,
    ...policyValue,
  };
  const register = {
    idempotencyKey: 'series-handoff-register',
    fieldId: access.fieldId,
    name: 'Series Handoff Source',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...access, accessDigest: canonicalDigest(access) },
  };
  const observe = {
    idempotencyKey: 'series-handoff-observe',
    fieldId: access.fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 8,
  };

  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const unauthorized = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      payload: observe,
    });
    assert.equal(unauthorized.statusCode, 401);
    const cookie = await session(host, initialized.adminApiKey);
    const registered = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: register,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const observed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observe,
    });
    assert.equal(observed.statusCode, 200, observed.body);
    assert.equal(observed.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(observed.json().movieJourney.handoff.intake.decision.result, 'new_subject');
    assert.equal(observed.json().movieJourney.handoff.formation.stage, 'routing_unresolved');
  } finally {
    await host.close();
  }

  const db = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  const candidate = db.prepare(
    'SELECT candidate_package_id,media_type,content_profile,structure_kind FROM proc_candidate_packages'
  ).get();
  assert.deepEqual(
    {
      mediaType: candidate.media_type,
      contentProfile: candidate.content_profile,
      structureKind: candidate.structure_kind,
    },
    { mediaType: 'group', contentProfile: 'series', structureKind: 'season' },
  );
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_primary_materials WHERE candidate_package_id=?'
  ).get(candidate.candidate_package_id).count, 2);
  assert.deepEqual(db.prepare(
    'SELECT episode_key FROM proc_candidate_primary_material_episode_claims WHERE candidate_package_id=? ORDER BY episode_key'
  ).all(candidate.candidate_package_id).map((row) => row.episode_key), ['E001', 'E002']);
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_related_references WHERE candidate_package_id=? AND role=?'
  ).get(candidate.candidate_package_id, 'nfo').count, 2);
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_season_continuity_claims WHERE candidate_package_id=?'
  ).get(candidate.candidate_package_id).count, 0);
  const subject = db.prepare(
    'SELECT subject_id,structure_kind,content_profile,intake_revision FROM libra_subjects'
  ).get();
  assert.equal(subject.structure_kind, 'season');
  assert.equal(subject.content_profile, 'series');
  assert.equal(Number(subject.intake_revision), 1);
  assert.deepEqual(db.prepare(
    'SELECT episode_key FROM libra_subject_episode_scopes WHERE subject_id=? ORDER BY episode_key'
  ).all(subject.subject_id).map((row) => row.episode_key), ['E001', 'E002']);
  const decision = db.prepare(
    'SELECT accepted_result,match_cardinality,target_subject_id FROM libra_intake_decisions'
  ).get();
  assert.equal(decision.accepted_result, 'new_subject');
  assert.equal(decision.match_cardinality, 'none');
  assert.equal(decision.target_subject_id, subject.subject_id);
  assert.equal(db.prepare(
    "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='libra' AND owner_scope_type='subject' AND owner_scope_id=?"
  ).get(subject.subject_id).count, 2);
  db.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const replay = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(replay.json().movieJourney.replayed, true);
  } finally {
    await host.close();
  }

  const replayDb = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  assert.equal(replayDb.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_subjects').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_intake_decisions').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_subject_episode_scopes').get().count, 2);
  replayDb.close();

  for (const [file, expected] of before) {
    assert.deepEqual(fs.readFileSync(file), expected.bytes);
    assert.equal(fs.statSync(file).mtimeMs, expected.mtimeMs);
  }
});
