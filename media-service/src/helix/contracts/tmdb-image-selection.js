'use strict';

// Popular TV titles (e.g. Game of Thrones / TV 1399) publish 500+ posters across
// languages. The previous 512 cap rejected exact Provider image sets before
// language selection could run, wrapping as P5_SECRET_LEASE_INVOCATION_FAILED.
const TMDB_IMAGE_COLLECTION_MAX = 2048;

function normalizedLanguage(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().split(/[-_]/)[0] || null : null;
}

function preferredLanguages(language) {
  const config = normalizedLanguage(language);
  return Object.freeze([...new Set([config, 'en'].filter(Boolean))]);
}

function isStructuralCandidate(item, artifactKind) {
  return typeof item?.file_path === 'string' &&
    /^\/[A-Za-z0-9._-]+$/.test(item.file_path) &&
    (!Number.isFinite(item.width) || item.width > 0) &&
    (!Number.isFinite(item.height) || item.height > 0) &&
    (artifactKind === 'still' || !item.width || !item.height ||
      (artifactKind === 'poster' ? item.height > item.width : item.width > item.height));
}

function selectTmdbImage(items, { artifactKind, language, originalLanguage = null }) {
  // originalLanguage is accepted for call-site compatibility but is not a
  // selection key: posters/fanart prefer the configured Admin language and en.
  void originalLanguage;
  if (!['poster', 'fanart', 'still'].includes(artifactKind) ||
      !Array.isArray(items) || items.length > TMDB_IMAGE_COLLECTION_MAX) {
    throw new TypeError('TMDB image selection requires a bounded exact image role.');
  }

  const preferred = preferredLanguages(language);
  const structural = items.filter((item) => isStructuralCandidate(item, artifactKind));

  // Admitted language set: configured language + English. Fanart/textless also
  // admits null-language assets. Selection never falls through to other locales.
  const admitted = new Set(preferred);
  if (artifactKind === 'fanart') admitted.add(null);

  const pool = structural.filter((item) => admitted.has(normalizedLanguage(item.iso_639_1)));
  if (!pool.length) return null;

  const rank = (image) => {
    const lang = normalizedLanguage(image.iso_639_1);
    if (artifactKind === 'fanart') {
      if (lang === null) return 0;
      const index = preferred.indexOf(lang);
      return index < 0 ? preferred.length + 1 : index + 1;
    }
    const index = preferred.indexOf(lang);
    return index < 0 ? preferred.length : index;
  };

  return [...pool].sort((a, b) => rank(a) - rank(b) ||
    (b.vote_average || 0) - (a.vote_average || 0) ||
    (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0) ||
    Buffer.from(a.file_path).compare(Buffer.from(b.file_path)))[0] || null;
}

module.exports = Object.freeze({
  TMDB_IMAGE_COLLECTION_MAX,
  normalizedLanguage,
  preferredLanguages,
  selectTmdbImage,
});
