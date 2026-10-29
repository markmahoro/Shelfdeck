'use strict';
const { canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataQuery } = require('../../../contracts/episode-metadata-query');
const { buildEpisodeMetadataBasis } = require('./episode-metadata-basis');
const { assertEpisodeMetadataMapping } = require('./episode-metadata-mapping');
function resolveEpisodeMetadataQuery(options, snapshot, identity, localScope) {
  const ref = snapshot.run.episodeMetadataMappingRef;
  if (!ref) return null;
  if (!options.episodeMetadataMappingStore) throw Object.assign(new Error('Episode mapping authority is unavailable.'), { code: 'LIBRA_EPISODE_MAPPING_AUTHORITY_REQUIRED' });
  const record = options.episodeMetadataMappingStore.readReference(ref);
  const review = options.episodeMetadataMappingStore.readReview(record.reviewId).review;
  const basis = buildEpisodeMetadataBasis(snapshot, identity);
  const mapping = assertEpisodeMetadataMapping(record.mapping, { ...basis, evidence: review.evidence });
  const selected = mapping.entries.find(entry => canonicalJson(entry.localScope) === canonicalJson(localScope));
  return selected ? buildEpisodeMetadataQuery({ mappingDigest: mapping.mappingDigest, mappingRevision: mapping.revision,
    materialKey: selected.materialKey, evidenceDigest: selected.evidenceDigest, providerEpisode: selected.providerEpisode }) : null;
}
module.exports = Object.freeze({ resolveEpisodeMetadataQuery });
