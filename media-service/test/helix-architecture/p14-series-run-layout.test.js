'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  buildRunMaterialLayout,
} = require('../../src/helix/domains/procurement/application/movie-run-coordinator');

function row(ordinal, location, extensionLabel) {
  const contentHash = canonicalDigest({ extensionLabel });
  const mountScopeId = 'series-layout-mount';
  const inode = String(ordinal + 1);
  return {
    ordinal,
    material_key: canonicalDigest({
      schema: 'physical-material-identity@1',
      mountScopeId,
      inode,
      contentHashAlgorithm: 'sha256',
      contentHash,
    }),
    mount_scope_id: mountScopeId,
    inode,
    content_hash_algorithm: 'sha256',
    content_hash: contentHash,
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

test('Series layout keeps Episode media primary and associates NFO/artwork as references', () => {
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
  const entries = layout.layoutEvidence.flatMap((item) => item.entries);
  assert.deepEqual(
    entries.map((item) => item.identity.materialKey).sort(),
    [
      episode1Nfo.material_key,
      episode1Art.material_key,
      episode2Nfo.material_key,
      seasonPoster.material_key,
    ].sort(),
  );
  assert.equal(entries.some((item) => item.identity.materialKey === episode1.material_key), false);
  assert.equal(entries.some((item) => item.identity.materialKey === episode2.material_key), false);
  assert.equal(layout.unresolved.length, 0);
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

test('generic and Season artwork sidecars never cross-associate between local Series trees', () => {
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
  const evidenceById = new Map(layout.layoutEvidence.map((item) => [item.evidenceId, item]));
  const entriesFor = (materialKey) => layout.primaryContexts
    .find((item) => item.materialKey === materialKey)
    .layoutEvidenceRefs
    .flatMap((ref) => evidenceById.get(ref.evidenceId).entries)
    .map((entry) => entry.identity.materialKey)
    .sort();

  assert.deepEqual(entriesFor(showAEpisode.material_key), [
    showATv.material_key,
    showAPoster.material_key,
  ].sort());
  assert.deepEqual(entriesFor(showBEpisode.material_key), [
    showBTv.material_key,
    showBPoster.material_key,
  ].sort());
  assert.equal(entriesFor(showAEpisode.material_key).includes(showBTv.material_key), false);
  assert.equal(entriesFor(showBEpisode.material_key).includes(showATv.material_key), false);
  assert.equal(layout.unresolved.length, 0);
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
