'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildProviderEpisodeEvidence, buildEpisodeMetadataReview, confirmEpisodeMetadataReview } =
  require('../../src/helix/domains/libra/model/episode-metadata-review');
function fixture(count = 34) {
  const members = Array.from({ length: count }, (_, index) => ({ materialKey: 'material-' + (index + 1),
    localScope: { seasonNumber: 1, episodeNumber: index + 1, episodeKey: 'E' + String(index + 1).padStart(3,'0') },
    title: 'Local ' + (index + 1), airDate: '' }));
  // Synthetic individually observed candidates. This fixture does not assert
  // that production's 34 files match these coordinates or authorize a mapping.
  const evidence = members.map((member, index) => buildProviderEpisodeEvidence({ integrationId: 'tmdb', configRevision: 1,
    language: 'zh-CN', providerEpisode: { provider: 'tmdb', providerKey: '68670', seasonNumber: index < 10 ? 1 : index < 22 ? 2 : 3,
      episodeNumber: index < 10 ? index + 1 : index < 22 ? index - 9 : index - 21, episodeId: 10000 + index },
    title: 'Provider ' + index, airDate: '2006-01-01', plot: 'Episode ' + index + ' plot', observedAtMs: 100 }));
  const input = { subjectId: 'subject', libraRunId: 'run', runStateRevision: 3, runExecutionBasisDigest: 'a'.repeat(64),
    identityDigest: 'b'.repeat(64), identityScopeDigest:'d'.repeat(64), materialSetDigest: 'c'.repeat(64), providerKey: '68670', expectedMappingRevision: 0, members, evidence };
  const review = buildEpisodeMetadataReview(input);
  const choices = members.map((member, index) => ({ materialKey: member.materialKey, localScope: member.localScope, evidenceDigest: evidence[index].evidenceDigest }));
  const confirm = overrides => confirmEpisodeMetadataReview({ review, reviewDigest: review.reviewDigest, choices, actorId: 'authenticated-admin', confirmedAtMs: 200, ...overrides });
  return { input, review, choices, confirm };
}
test('all 34 local Episodes require explicit per-material choices before cross-season confirmation', () => {
  const f = fixture();
  assert.throws(() => f.confirm({ choices: [] }), { code: 'LIBRA_EPISODE_REVIEW_SELECTION_REQUIRED' });
  const mapping = f.confirm();
  assert.equal(mapping.entries.length, 34);
  assert.ok(mapping.entries.every(entry => entry.localScope.seasonNumber === 1));
  assert.equal(mapping.entries[10].providerEpisode.seasonNumber, 2);
  assert.equal(mapping.entries[22].providerEpisode.seasonNumber, 3);
  assert.equal(mapping.entries[33].providerEpisode.episodeNumber, 12);
  assert.equal(mapping.actorId, 'authenticated-admin');
});
test('equal counts and ambiguous candidates do not generate or default a selection', () => {
  const f = fixture(2), first = f.input.evidence[0], { evidenceDigest, ...basis } = first;
  f.input.evidence.push(buildProviderEpisodeEvidence({ ...basis, title: 'Another plausible special',
    providerEpisode: { ...basis.providerEpisode, seasonNumber: 0, episodeNumber: 9, episodeId: 20001 } }));
  const review = buildEpisodeMetadataReview(f.input);
  assert.equal(Object.hasOwn(review, 'choices'), false);
  assert.throws(() => f.confirm({ review, reviewDigest: review.reviewDigest, choices: [] }), { code: 'LIBRA_EPISODE_REVIEW_SELECTION_REQUIRED' });
});
test('changed review, substituted evidence and duplicate Provider choices fail confirmation', () => {
  const f = fixture(2);
  assert.throws(() => f.confirm({ review: { ...f.review, expectedMappingRevision: 1 } }), { code: 'LIBRA_EPISODE_REVIEW_STALE' });
  assert.throws(() => f.confirm({ choices: [{ ...f.choices[0], evidenceDigest: 'e'.repeat(64) }] }), { code: 'LIBRA_EPISODE_REVIEW_SELECTION_STALE' });
  assert.throws(() => f.confirm({ choices: [f.choices[0], { ...f.choices[1], evidenceDigest: f.choices[0].evidenceDigest }] }),
    { code: 'LIBRA_EPISODE_MAPPING_DUPLICATE' });
  const wrong = fixture(2); wrong.input.providerKey = '999';
  assert.throws(() => buildEpisodeMetadataReview(wrong.input), { code: 'LIBRA_EPISODE_REVIEW_EVIDENCE' });
});
test('combined or split local media are explicitly unresolved in this iteration', () => {
  const f = fixture(2); f.input.members[1].materialKey = f.input.members[0].materialKey;
  assert.throws(() => buildEpisodeMetadataReview(f.input), { code: 'LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED' });
});

test('review arrays are immutable and invalid calendar dates are not display evidence', () => {
  const f = fixture(2);
  assert.throws(() => f.review.members.push(f.review.members[0]), TypeError);
  assert.throws(() => f.review.evidence.pop(), TypeError);
  const { evidenceDigest, ...evidence } = f.input.evidence[0];
  for (const airDate of ['2026-02-30', '2026-13-01', null])
    assert.throws(() => buildProviderEpisodeEvidence({ ...evidence, airDate }), { code: 'LIBRA_EPISODE_REVIEW_EVIDENCE' });
});
