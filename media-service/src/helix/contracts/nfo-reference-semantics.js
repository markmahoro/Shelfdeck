'use strict';

const { canonicalDigest, canonicalJson } = require('./canonical-json');
const { inspectMovieNfo, analyzeMovieNfo, childText, directText, attribute } = require('./movie-nfo-document');

const SCALARS = ['title', 'originaltitle', 'sorttitle', 'year', 'plot', 'tagline'];
const SETS = ['genre', 'director', 'studio'];
const tokens = (values) => [...new Set(values.filter(Boolean).flatMap((value) =>
  value.split(/\s*(?:\/|\||;)\s*/)).map((value) => value.trim()).filter(Boolean))].sort();

// A source witness describes observed reference facts, not Product ownership.
function observeNfoReferenceSemantics(bytes) {
  const document = inspectMovieNfo(bytes);
  if (!document.usable) return null;
  const entries = [];
  const add = (key, value) => entries.push({ key, value });
  for (const tag of SCALARS) {
    const values = [...new Set(document.directChildren.filter((item) => item.name === tag)
      .map((item) => childText(document, item)).filter(Boolean))];
    if (values.length > 1) return null;
    if (values.length) add(tag, values[0]);
  }
  // Emby may use either release-date tag; conflicting aliases are not a witness.
  const releaseDates = [...new Set(document.directChildren
    .filter(item => item.name === 'premiered' || item.name === 'releasedate')
    .map(item => childText(document, item)).filter(Boolean))];
  if (releaseDates.length > 1) return null;
  if (releaseDates.length) add('releasedate', releaseDates[0]);
  for (const tag of SETS) {
    for (const value of tokens(document.directChildren.filter((item) => item.name === tag)
      .map((item) => childText(document, item)))) add(tag + ':' + canonicalDigest(value), value);
  }
  if (document.movieIdentity.providerKey) add('tmdb', document.movieIdentity.providerKey);
  for (const child of document.directChildren.filter((item) => item.name === 'uniqueid' || item.name === 'imdbid')) {
    const provider = child.name === 'imdbid' ? 'imdb' : String(attribute(child, 'type') || '').trim().toLowerCase();
    const value = childText(document, child);
    if (provider && provider !== 'tmdb' && value) add('provider:' + provider, value);
  }
  for (const child of document.directChildren.filter((item) => item.name === 'actor')) {
    const actor = analyzeMovieNfo('<movie>' + document.xml.slice(child.openEnd, child.closeStart) + '</movie>');
    if (!actor.usable) return null;
    const name = directText(actor, 'name');
    const ids = [...new Set(actor.directChildren.filter((item) => item.name === 'tmdbid' ||
      item.name === 'uniqueid' && String(attribute(item, 'type')).toLowerCase() === 'tmdb')
      .map((item) => childText(actor, item)).filter(Boolean))];
    if (ids.length > 1) return null;
    if (name || ids[0]) add('actor:' + canonicalDigest(name ? name.trim().toLowerCase() : 'tmdb:' + ids[0]),
      ids[0] ? 'tmdb:' + ids[0] : 'name:' + name.trim().toLowerCase());
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const unique = new Map();
  for (const entry of entries) {
    if (unique.has(entry.key) && unique.get(entry.key) !== entry.value) return null;
    unique.set(entry.key, entry.value);
  }
  const body = { schemaRef:'helix://contracts/records/source-nfo-semantics/v1', schemaVersion:1,
    recordKind:'source-nfo-semantics', entries:[...unique].map(([key, value]) => ({ key, value })) };
  if (body.entries.length > 256 || Buffer.byteLength(canonicalJson(body)) > 32 * 1024) return null;
  return Object.freeze({ ...body, recordDigest:canonicalDigest(body) });
}

function preservesNfoReferenceSemantics(basis, current) {
  if (!basis || !current || basis.recordKind !== 'source-nfo-semantics') return false;
  const { recordDigest, ...body } = basis;
  if (canonicalDigest(body) !== recordDigest) return false;
  const expected = new Map(basis.entries.map((item) => [item.key, item.value]));
  // An empty/unidentified document cannot establish mutable source continuity.
  if (!expected.get('tmdb') && !expected.get('title')) return false;
  const actual = new Map(current.entries.map((item) => [item.key, item.value]));
  return [...expected].every(([key, value]) => {
    if (key.startsWith('actor:')) {
      if (value.startsWith('tmdb:')) return [...actual].some(([actualKey, actualValue]) =>
        actualKey.startsWith('actor:') && actualValue === value);
      return actual.has(key);
    }
    return actual.get(key) === value;
  });
}

module.exports = Object.freeze({ observeNfoReferenceSemantics, preservesNfoReferenceSemantics });
