'use strict';

function hasText(value) {
  return String(value == null ? '' : value).trim().length > 0;
}

function hasPositiveNumber(value) {
  return Number(value) > 0;
}

function hasRating(item) {
  return item && (item.userRating != null || item.doubanRating != null || item.doubanStars != null);
}

function hasWatchedState(item) {
  return item && (item.watched === true || item.watched === false);
}

function hasExternalIdentity(item) {
  if (!item) return false;
  if (hasText(item.tmdbId) || hasText(item.doubanId)) return true;
  const refs = item.externalRefs || {};
  const emby = refs.emby || {};
  const providerIds = emby.providerIds || item.providerIds || {};
  return hasText(item.sourceId)
    || hasText(emby.id)
    || hasText(providerIds.Tmdb)
    || hasText(providerIds.TMDB)
    || hasText(providerIds.Douban);
}

function subLibraryFor(item, config) {
  const subLibs = (config && config.subLibraries) || [];
  return subLibs.find((sl) => sl.uuid === (item && item.subLibraryId)) || null;
}

function mediaKind(item, subLib) {
  const source = (item && item.source) || (subLib && subLib.source) || 'emby';
  const mediaType = (subLib && subLib.mediaType) || (item && item.mediaType) || '';
  if (source === 'adult_folder' || mediaType === 'adult') return 'adult';
  return 'emby';
}

function adultMissingReasons(item) {
  const reasons = [];
  const meta = (item && item.adultMetadata) || {};
  if (!item || item.scraped !== true) reasons.push('adult.scraped');
  if (String(meta.scrapeStatus || '').toLowerCase() !== 'done') reasons.push('adult.scrapeStatus');
  if (!hasText(meta.adultId)) reasons.push('adult.adultId');
  if (!hasText(meta.title) && !hasText(item && item.name)) reasons.push('adult.title');
  if (!hasText(item && item.path)) reasons.push('media.path');
  if (!hasPositiveNumber(item && item.size)) reasons.push('media.size');
  if (!hasPositiveNumber(item && item.duration)) reasons.push('media.duration');
  if (!hasPositiveNumber((item && item.bitrate) || (item && item.equivalentBitrate))) reasons.push('media.bitrate');
  if (!hasText(item && item.resolution)) reasons.push('media.resolution');
  if (!hasText(item && item.codec)) reasons.push('media.codec');
  if (meta.region === 'western_adult' && !(meta.protagonist && meta.protagonist.name)) {
    reasons.push('adult.protagonist');
  }
  return reasons;
}

function embyMissingReasons(item) {
  const reasons = [];
  const type = String((item && item.type) || '').toLowerCase();
  if (!hasText(item && item.itemId)) reasons.push('identity.itemId');
  if (!hasExternalIdentity(item)) reasons.push('identity.externalId');
  if (!hasText(item && item.name)) reasons.push('identity.name');
  if (type === 'season') {
    if (!hasText(item && item.seriesName)) reasons.push('identity.seriesName');
    if (item && item.seasonNumber == null) reasons.push('identity.seasonNumber');
  }
  if (!hasText(item && item.path)) reasons.push('media.path');
  if (!hasPositiveNumber(item && item.size)) reasons.push('media.size');
  if (!hasPositiveNumber(item && item.duration)) reasons.push('media.duration');
  if (!hasPositiveNumber((item && item.bitrate) || (item && item.equivalentBitrate))) reasons.push('media.bitrate');
  if (!hasText(item && item.resolution)) reasons.push('media.resolution');
  if (!hasText(item && item.codec)) reasons.push('media.codec');
  if (!hasWatchedState(item)) reasons.push('decision.watched');
  if (!hasRating(item)) reasons.push('decision.rating');
  if (!hasText(item && item.tmdbId) && !hasText(item && item.doubanId)) reasons.push('decision.providerId');
  return reasons;
}

function resolveMetadataStatus(item, config = {}) {
  const subLib = subLibraryFor(item, config);
  const kind = mediaKind(item, subLib);
  const missingReasons = kind === 'adult' ? adultMissingReasons(item) : embyMissingReasons(item);
  const status = missingReasons.length === 0 ? 'complete' : 'missing';
  return {
    metadataStatus: status,
    metadataComplete: status === 'complete',
    metadataMissingReasons: missingReasons,
    metadataKind: kind,
  };
}

function decorateItem(item, config = {}) {
  return {
    ...item,
    ...resolveMetadataStatus(item, config),
  };
}

function decorateItems(items, config = {}) {
  return (items || []).map((item) => decorateItem(item, config));
}

module.exports = {
  decorateItem,
  decorateItems,
  resolveMetadataStatus,
};
