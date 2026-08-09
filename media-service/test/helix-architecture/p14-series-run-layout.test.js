'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  buildRunMaterialLayout,
} = require('../../src/helix/domains/procurement/application/movie-run-coordinator');
const {
  buildSeriesEpisodeDeliveryKeys,
} = require('../../src/helix/domains/libra/application/movie-formation-coordinator');
const {
  subjectEpisodeScopeDigest,
} = require('../../src/helix/domains/libra/model/libra-intake-contracts');

function row(ordinal, location, extensionLabel) {
  const contentFingerprint = canonicalDigest({ extensionLabel });
  const mountScopeId = 'series-layout-mount';
  const inode = String(ordinal + 1);
  return {
    ordinal,
    material_key: canonicalDigest({
      schema: 'physical-material-identity@2',
      mountScopeId,
      inode,
      sizeBytes:10,
      fingerprintAlgorithm: 'middle-256k-sha256',
      fingerprintVersion:1,
      contentFingerprint,
    }),
    mount_scope_id: mountScopeId,
    inode,
    fingerprint_algorithm: 'middle-256k-sha256',
    fingerprint_version: 1,
    content_fingerprint: contentFingerprint,
    size_bytes: 10,
    endpoint_id: 'series-layout-endpoint',
    location,
  };
}

function snapshot(members) {
  return {
    run: {
      procurement_run_id: 'series-layout-run',
      field_id: 'series-layout-field',
      access_revision: 1,
      access_digest: canonicalDigest({ access: 1 }),
      run_basis_digest: canonicalDigest({ run: 1 }),
    },
    access: {
      root_location: 'C:/series',
    },
    members,
  };
}

test('Run layout keeps media primary and leaves sidecar observation to the formal Layout capability', () => {
  const episode1 = row(0, 'C:/series/Season 1/Demo.Show.S01E01.mkv', 'episode-1');
  const episode1Nfo = row(1, 'C:/series/Season 1/Demo.Show.S01E01.nfo', 'episode-1-nfo');
  const episode1Art = row(2, 'C:/series/Season 1/Demo.Show.S01E01.jpg', 'episode-1-art');
  const episode2 = row(3, 'C:/series/Season 1/Demo.Show.S01E02.mkv', 'episode-2');
  const episode2Nfo = row(4, 'C:/series/Season 1/Demo.Show.S01E02.nfo', 'episode-2-nfo');
  const seasonPoster = row(5, 'C:/series/season01-poster.jpg', 'season-poster');
  const layout = buildRunMaterialLayout(snapshot([
    episode1,
    episode1Nfo,
    episode1Art,
    episode2,
    episode2Nfo,
    seasonPoster,
  ]));

  assert.equal(layout.primaryContexts.length, 2);
  assert.deepEqual(
    layout.primaryContexts.map((item) => item.materialKey),
    [episode1.material_key, episode2.material_key],
  );
  assert.deepEqual(layout.layoutEvidence, []);
  assert.deepEqual(
    layout.unresolved.map((item) => item.materialKey).sort(),
    [
      episode1Nfo.material_key,
      episode1Art.material_key,
      episode2Nfo.material_key,
      seasonPoster.material_key,
    ].sort(),
  );
  assert.equal(layout.primaryContexts.every((item) => item.layoutEvidenceRefs.length === 0), true);
});

test('ambiguous unrelated sidecars remain read-only layout evidence and never become primary', () => {
  const episode1 = row(0, 'C:/series/Season 1/Demo.Show.S01E01.mkv', 'episode-1');
  const episode2 = row(1, 'C:/series/Season 1/Demo.Show.S01E02.mkv', 'episode-2');
  const unrelated = row(2, 'C:/series/Season 1/Other.Show.nfo', 'unrelated');
  const layout = buildRunMaterialLayout(snapshot([episode1, episode2, unrelated]));
  assert.equal(layout.primaryContexts.length, 2);
  assert.equal(layout.unresolved.length, 1);
  assert.equal(layout.unresolved[0].materialKey, unrelated.material_key);
  assert.equal(layout.primaryContexts.some((item) => item.materialKey === unrelated.material_key), false);
});

test('Run layout never cross-associates generic or Season artwork before Layout observation', () => {
  const showAEpisode = row(0, 'C:/series/Show.A/Season 1/Show.A.S01E01.mkv', 'show-a-episode');
  const showATv = row(1, 'C:/series/Show.A/tvshow.nfo', 'show-a-tvshow');
  const showAPoster = row(2, 'C:/series/Show.A/season01-poster.jpg', 'show-a-poster');
  const showBEpisode = row(3, 'C:/series/Show.B/Season 1/Show.B.S01E01.mkv', 'show-b-episode');
  const showBTv = row(4, 'C:/series/Show.B/tvshow.nfo', 'show-b-tvshow');
  const showBPoster = row(5, 'C:/series/Show.B/season01-poster.jpg', 'show-b-poster');
  const layout = buildRunMaterialLayout(snapshot([
    showAEpisode,
    showATv,
    showAPoster,
    showBEpisode,
    showBTv,
    showBPoster,
  ]));
  assert.deepEqual(layout.layoutEvidence, []);
  assert.deepEqual(layout.unresolved.map((item) => item.materialKey).sort(), [
    showATv.material_key, showAPoster.material_key, showBTv.material_key, showBPoster.material_key,
  ].sort());
});

test('global generic sidecars spanning multiple local Series groups remain unresolved', () => {
  const showAEpisode = row(0, 'C:/series/Show.A/Season 1/Show.A.S01E01.mkv', 'show-a-episode');
  const showBEpisode = row(1, 'C:/series/Show.B/Season 1/Show.B.S01E01.mkv', 'show-b-episode');
  const globalTv = row(2, 'C:/series/tvshow.nfo', 'global-tvshow');
  const globalPoster = row(3, 'C:/series/season01-poster.jpg', 'global-poster');
  const layout = buildRunMaterialLayout(snapshot([
    showAEpisode,
    showBEpisode,
    globalTv,
    globalPoster,
  ]));
  assert.deepEqual(
    layout.unresolved.map((item) => item.materialKey).sort(),
    [globalTv.material_key, globalPoster.material_key].sort(),
  );
  assert.equal(
    layout.layoutEvidence.flatMap((item) => item.entries)
      .some((entry) => [globalTv.material_key, globalPoster.material_key]
        .includes(entry.identity.materialKey)),
    false,
  );
});

test('Series Formation freezes only current Binding claims and fences Subject Episode freshness', () => {
  const subjectId = 'series-formation-subject';
  const episodeKeys = ['E001', 'E002'];
  const formation = {
    subject: {
      subject_id: subjectId,
      structure_kind: 'season',
      current_episode_scope_digest: subjectEpisodeScopeDigest(subjectId, episodeKeys),
    },
    bindings: [
      { material_key: 'material-1', binding_revision: 2 },
      { material_key: 'material-2', binding_revision: 1 },
    ],
    claims: [
      { material_key: 'material-1', binding_revision: 1, episode_key: 'STALE' },
      { material_key: 'material-1', binding_revision: 2, episode_key: 'E001' },
      { material_key: 'material-2', binding_revision: 1, episode_key: 'E002' },
    ],
  };

  assert.deepEqual(buildSeriesEpisodeDeliveryKeys(formation), episodeKeys);
  assert.throws(
    () => buildSeriesEpisodeDeliveryKeys({
      ...formation,
      subject: {
        ...formation.subject,
        current_episode_scope_digest: canonicalDigest({ stale: true }),
      },
    }),
    (error) => error.code === 'P14_SERIES_FORMATION_EPISODE_SCOPE_STALE',
  );
});
