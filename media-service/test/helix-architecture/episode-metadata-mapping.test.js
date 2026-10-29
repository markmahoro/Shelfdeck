'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildEpisodeMetadataScope } = require('../../src/helix/contracts/episode-metadata-scope');
const { SCHEMA, buildEpisodeMetadataMapping, assertEpisodeMetadataMapping, projectMappedEpisode } =
  require('../../src/helix/domains/libra/model/episode-metadata-mapping');
function value() {
  return { schemaRef: SCHEMA, subjectId: 'season-subject', identityDigest: 'a'.repeat(64), identityScopeDigest:'d'.repeat(64),
    materialSetDigest: 'b'.repeat(64), providerKey: '33907', revision: 1, actorId: 'admin', confirmedAtMs: 1,
    entries: [{ localScope: { seasonNumber: 2, episodeNumber: 9, episodeKey: 'E009' }, materialKey: 'material-9',
      providerEpisode: { provider: 'tmdb', providerKey: '33907', seasonNumber: 0, episodeNumber: 2, episodeId: 123 },
      evidenceDigest: 'c'.repeat(64) }] };
}
function basis(v) { return { ...v, members: v.entries.map(e => ({ materialKey: e.materialKey, localScope: e.localScope })),
  evidence: v.entries.map(e => ({ providerEpisode: e.providerEpisode, evidenceDigest: e.evidenceDigest })) }; }
test('confirmed specials mapping preserves local positive Season and Episode numbers', () => {
  const v = value(), mapping = buildEpisodeMetadataMapping(v);
  assert.equal(assertEpisodeMetadataMapping(mapping, basis(v)).mappingDigest, mapping.mappingDigest);
  const fields = projectMappedEpisode(mapping.entries[0], { providerEpisode: v.entries[0].providerEpisode,
    descriptiveEntries: [{ key: 'season_number', value: 0 }, { key: 'episode_number', value: 2 },
      { key: 'episode_plot', value: 'Verified special plot' }] });
  assert.deepEqual(Object.fromEntries(fields.map(e => [e.key, e.value])),
    { episode_number: 9, episode_plot: 'Verified special plot', season_number: 2 });
  assert.throws(() => buildEpisodeMetadataScope({ seasonNumber: 0, episodeNumber: 2, episodeKey: 'E002' }));
});
test('one local Season can explicitly map across Provider Seasons', () => {
  const v = value(); v.providerKey = '68670';
  v.entries = [10, 11, 23, 34].map((n, index) => ({ localScope: { seasonNumber: 1, episodeNumber: n,
    episodeKey: 'E' + String(n).padStart(3, '0') }, materialKey: 'material-' + n,
    providerEpisode: { provider: 'tmdb', providerKey: '68670', seasonNumber: [1, 2, 3, 3][index],
      episodeNumber: [10, 1, 1, 12][index], episodeId: 100 + n }, evidenceDigest: 'c'.repeat(64) }));
  const mapping = assertEpisodeMetadataMapping(buildEpisodeMetadataMapping(v), basis(v));
  assert.equal(mapping.entries.length, 4);
  assert.ok(mapping.entries.every(e => e.localScope.seasonNumber === 1));
});
test('identity drift, changed material and absent evidence cannot reuse a confirmation', () => {
  const v = value(), mapping = buildEpisodeMetadataMapping(v);
  assert.throws(() => assertEpisodeMetadataMapping(mapping, { ...basis(v), identityScopeDigest: 'e'.repeat(64) }),
    { code: 'LIBRA_EPISODE_MAPPING_STALE' });
  assert.throws(() => assertEpisodeMetadataMapping(mapping, { ...basis(v), members: [] }),
    { code: 'LIBRA_EPISODE_MAPPING_MATERIAL' });
  assert.throws(() => assertEpisodeMetadataMapping(mapping, { ...basis(v), evidence: [] }),
    { code: 'LIBRA_EPISODE_MAPPING_EVIDENCE' });
});
test('new evidence for the same exact identity scope keeps the explicitly confirmed mapping',()=>{
  const v=value(),mapping=buildEpisodeMetadataMapping(v);
  assert.equal(assertEpisodeMetadataMapping(mapping,{...basis(v),identityDigest:'e'.repeat(64)}).mappingDigest,mapping.mappingDigest);
  assert.equal(mapping.identityDigest,v.identityDigest,'The original confirmation evidence remains immutable.');
});
test('duplicate local or Provider episodes and foreign shows are refused', () => {
  const v = value(); v.entries.push(structuredClone(v.entries[0]));
  assert.throws(() => buildEpisodeMetadataMapping(v), { code: 'LIBRA_EPISODE_MAPPING_DUPLICATE' });
  v.entries[1].localScope = { seasonNumber: 2, episodeNumber: 10, episodeKey: 'E010' };
  assert.throws(() => buildEpisodeMetadataMapping(v), { code: 'LIBRA_EPISODE_MAPPING_DUPLICATE' });
  v.entries = [v.entries[0]]; v.entries[0].providerEpisode.providerKey = '99';
  assert.throws(() => buildEpisodeMetadataMapping(v), { code: 'LIBRA_EPISODE_MAPPING_IDENTITY' });
});
test('foreign response cannot be relabelled as the requested local Episode', () => {
  const v = value();
  assert.throws(() => projectMappedEpisode(v.entries[0], { providerEpisode: { ...v.entries[0].providerEpisode, episodeId: 999 },
    descriptiveEntries: [] }), { code: 'LIBRA_EPISODE_MAPPING_RESPONSE' });
});
