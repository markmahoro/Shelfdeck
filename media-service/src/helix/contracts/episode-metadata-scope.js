'use strict';

const { canonicalJson } = require('./canonical-json');

function buildEpisodeMetadataScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson(['episodeKey', 'episodeNumber', 'seasonNumber']) ||
      !Number.isSafeInteger(value.seasonNumber) || value.seasonNumber < 1 ||
      !Number.isSafeInteger(value.episodeNumber) || value.episodeNumber < 1 ||
      value.episodeKey !== 'E' + String(value.episodeNumber).padStart(3, '0')) {
    const error = new TypeError('Episode metadata requires one exact positive Season/Episode scope.');
    error.code = 'SERIES_METADATA_SCOPE_INVALID';
    throw error;
  }
  return Object.freeze({ episodeKey:value.episodeKey, episodeNumber:value.episodeNumber, seasonNumber:value.seasonNumber });
}

function episodeMetadataScopeSchema() {
  return { type:'object', additionalProperties:false, properties:{
    episodeKey:{ type:'string', pattern:'^E[0-9]{3,16}$' },
    episodeNumber:{ type:'integer', minimum:1, maximum:Number.MAX_SAFE_INTEGER },
    seasonNumber:{ type:'integer', minimum:1, maximum:Number.MAX_SAFE_INTEGER },
  }, required:['episodeKey', 'episodeNumber', 'seasonNumber'] };
}

function productSidecarRelativePath(contentProfile, episodeScope) {
  if (episodeScope !== undefined) {
    if (contentProfile !== 'series') throw new TypeError('Episode sidecars require Series content.');
    return 'product/' + buildEpisodeMetadataScope(episodeScope).episodeKey + '.nfo';
  }
  return contentProfile === 'series' ? 'product/season.nfo' : 'product/movie.nfo';
}

module.exports = Object.freeze({ buildEpisodeMetadataScope, episodeMetadataScopeSchema, productSidecarRelativePath });
