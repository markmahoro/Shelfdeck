'use strict';

const { canonicalJson } = require('./canonical-json');

// A Provider lookup coordinate is not a local Season identity. In particular,
// TMDB specials use Season zero while local Season claims remain positive.
function buildProviderEpisodeReference(value) {
  const keys = ['provider', 'providerKey', 'seasonNumber', 'episodeNumber', 'episodeId'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort()) ||
      value.provider !== 'tmdb' || typeof value.providerKey !== 'string' ||
      !/^[1-9][0-9]{0,14}$/.test(value.providerKey) ||
      !Number.isSafeInteger(value.seasonNumber) || value.seasonNumber < 0 ||
      !Number.isSafeInteger(value.episodeNumber) || value.episodeNumber < 1 ||
      !Number.isSafeInteger(value.episodeId) || value.episodeId < 1) {
    throw Object.assign(new TypeError('An exact Provider Episode identity is required.'),
      { code: 'SERIES_PROVIDER_EPISODE_INVALID' });
  }
  return Object.freeze({ provider: value.provider, providerKey: value.providerKey,
    seasonNumber: value.seasonNumber, episodeNumber: value.episodeNumber, episodeId: value.episodeId });
}

function providerEpisodeReferenceSchema() {
  return { type: 'object', additionalProperties: false,
    required: ['provider', 'providerKey', 'seasonNumber', 'episodeNumber', 'episodeId'], properties: {
      provider: { const: 'tmdb' }, providerKey: { type: 'string', pattern: '^[1-9][0-9]{0,14}$' },
      seasonNumber: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      episodeNumber: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      episodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    } };
}

module.exports = Object.freeze({ buildProviderEpisodeReference, providerEpisodeReferenceSchema });
