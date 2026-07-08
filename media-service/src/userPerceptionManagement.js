'use strict';

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function numberOrNull(value) {
  if (!hasValue(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value) {
  return hasValue(value) ? String(value) : null;
}

function stableFactsHash(facts) {
  return JSON.stringify({
    rating: facts.rating ?? null,
    ratingSource: facts.ratingSource || '',
    watched: facts.watched,
    watchedSource: facts.watchedSource || '',
    playCount: facts.playCount ?? null,
    playCountSource: facts.playCountSource || '',
    lastPlayedAt: facts.lastPlayedAt || null,
    favorite: facts.favorite,
    favoriteSource: facts.favoriteSource || '',
    manualTier: facts.manualTier || null,
  });
}

function resolveRating(item) {
  if (hasValue(item && item.userRating)) {
    return {
      rating: numberOrNull(item.userRating),
      ratingSource: 'local',
      ratingUpdatedAt: isoOrNull(item.userRatingUpdatedAt),
    };
  }
  if (hasValue(item && item.doubanRating)) {
    return {
      rating: numberOrNull(item.doubanRating),
      ratingSource: 'douban',
      ratingUpdatedAt: isoOrNull(item.doubanRatingUpdatedAt),
    };
  }
  if (hasValue(item && item.doubanStars)) {
    return {
      rating: numberOrNull(item.doubanStars),
      ratingSource: 'douban',
      ratingUpdatedAt: isoOrNull(item.doubanRatingUpdatedAt),
    };
  }
  if (hasValue(item && item.embyRating)) {
    return {
      rating: numberOrNull(item.embyRating),
      ratingSource: 'emby',
      ratingUpdatedAt: isoOrNull(item.embyRatingUpdatedAt),
    };
  }
  return { rating: null, ratingSource: 'unknown', ratingUpdatedAt: null };
}

function resolvePerceptionFacts(item = {}, opts = {}) {
  const previous = item.userPerceptionFacts && typeof item.userPerceptionFacts === 'object'
    ? item.userPerceptionFacts
    : {};
  const rating = resolveRating(item);
  const watchedKnown = item.watched === true || item.watched === false;
  const playCount = numberOrNull(item.playCount);
  const favoriteKnown = item.favorite === true || item.favorite === false;
  const manualTier = hasValue(item.manualTier)
    ? String(item.manualTier)
    : (hasValue(previous.manualTier) ? String(previous.manualTier) : null);
  const now = opts.now || new Date().toISOString();

  const facts = {
    rating: rating.rating,
    ratingSource: rating.ratingSource,
    ratingUpdatedAt: rating.ratingUpdatedAt,
    watched: watchedKnown ? !!item.watched : null,
    watchedSource: watchedKnown ? (item.watchedSource || previous.watchedSource || 'emby') : 'unknown',
    watchedUpdatedAt: isoOrNull(item.watchedUpdatedAt || previous.watchedUpdatedAt),
    playCount,
    playCountSource: playCount != null ? (item.playCountSource || previous.playCountSource || 'emby') : 'unknown',
    lastPlayedAt: isoOrNull(item.lastPlayedAt || previous.lastPlayedAt),
    favorite: favoriteKnown ? !!item.favorite : null,
    favoriteSource: favoriteKnown ? (item.favoriteSource || previous.favoriteSource || 'emby') : 'unknown',
    manualTier,
    manualTierSource: manualTier ? (item.manualTierSource || previous.manualTierSource || 'user') : null,
  };

  const oldHash = previous.factsHash || stableFactsHash(previous);
  const newHash = stableFactsHash(facts);
  const previousVersion = Number(item.perceptionVersion || previous.perceptionVersion || 0);
  const changed = oldHash !== newHash;
  const shouldBump = opts.bump !== false && changed;
  facts.perceptionVersion = shouldBump ? previousVersion + 1 : previousVersion;
  facts.perceptionUpdatedAt = shouldBump
    ? now
    : isoOrNull(item.perceptionUpdatedAt || previous.perceptionUpdatedAt);
  facts.factsHash = newHash;
  return facts;
}

function projectItem(item = {}, opts = {}) {
  const facts = resolvePerceptionFacts(item, opts);
  item.userPerceptionFacts = facts;
  item.perceptionVersion = facts.perceptionVersion;
  item.perceptionUpdatedAt = facts.perceptionUpdatedAt;
  return item;
}

function decorateItem(item = {}) {
  return projectItem({ ...item }, { bump: false });
}

function decorateItems(items = []) {
  return (items || []).map((item) => decorateItem(item));
}

module.exports = {
  resolvePerceptionFacts,
  projectItem,
  decorateItem,
  decorateItems,
};
