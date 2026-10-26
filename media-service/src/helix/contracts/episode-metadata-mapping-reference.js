'use strict';
const { canonicalJson } = require('./canonical-json');
function buildEpisodeMetadataMappingReference(value) {
  if (!value || canonicalJson(Object.keys(value).sort()) !== canonicalJson(['intentId', 'mappingDigest', 'mappingRevision', 'recordDigest']) ||
      ![value.intentId, value.mappingDigest, value.recordDigest].every(item => /^[a-f0-9]{64}$/.test(item || '')) ||
      !Number.isSafeInteger(value.mappingRevision) || value.mappingRevision < 1)
    throw Object.assign(new TypeError('Episode mapping reference is invalid.'), { code: 'LIBRA_EPISODE_MAPPING_REFERENCE_INVALID' });
  return Object.freeze({ ...value });
}
function episodeMetadataMappingReferenceSchema() {
  const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
  return { type: 'object', additionalProperties: false, required: ['intentId', 'mappingDigest', 'mappingRevision', 'recordDigest'],
    properties: { intentId: digest, mappingDigest: digest, recordDigest: digest,
      mappingRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } };
}
module.exports = Object.freeze({ buildEpisodeMetadataMappingReference, episodeMetadataMappingReferenceSchema });
