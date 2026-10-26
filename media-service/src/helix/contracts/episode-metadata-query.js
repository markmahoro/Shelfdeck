'use strict';
const { canonicalJson } = require('./canonical-json');
const { buildProviderEpisodeReference, providerEpisodeReferenceSchema } = require('./provider-episode-reference');
function buildEpisodeMetadataQuery(value) {
  const keys = ['mappingDigest', 'mappingRevision', 'materialKey', 'evidenceDigest', 'providerEpisode'];
  if (!value || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort()) ||
      !/^[a-f0-9]{64}$/.test(value.mappingDigest || '') || !/^[a-f0-9]{64}$/.test(value.evidenceDigest || '') ||
      !Number.isSafeInteger(value.mappingRevision) || value.mappingRevision < 1 || typeof value.materialKey !== 'string' ||
      !value.materialKey || value.materialKey.length > 256)
    throw Object.assign(new TypeError('Confirmed Episode mapping query is invalid.'), { code: 'LIBRA_EPISODE_QUERY_INVALID' });
  return Object.freeze({ ...value, providerEpisode: buildProviderEpisodeReference(value.providerEpisode) });
}
function episodeMetadataQuerySchema() {
  return { type: 'object', additionalProperties: false,
    required: ['mappingDigest', 'mappingRevision', 'materialKey', 'evidenceDigest', 'providerEpisode'], properties: {
      mappingDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, evidenceDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      mappingRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, materialKey: { type: 'string', minLength: 1, maxLength: 256 },
      providerEpisode: providerEpisodeReferenceSchema(),
    } };
}
module.exports = Object.freeze({ buildEpisodeMetadataQuery, episodeMetadataQuerySchema });
