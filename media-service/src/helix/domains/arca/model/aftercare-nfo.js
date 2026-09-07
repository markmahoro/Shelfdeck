'use strict';

const { bytesOf, analyzeMovieNfo, attribute, directText, childText, inspectMovieNfo:inspectAftercareMovieNfo } = require('../../../contracts/movie-nfo-document');

const MAX_NFO_BYTES = 256 * 1024;
const OWNED_FIELDS = Object.freeze([
  Object.freeze({ keys:['title', 'display_title'], tag:'title' }),
  Object.freeze({ keys:['original_title'], tag:'originaltitle' }),
  Object.freeze({ keys:['sort_title'], tag:'sorttitle' }),
  Object.freeze({ keys:['year_or_release_date', 'release_year', 'year'], tag:'year' }),
  Object.freeze({ keys:['release_date'], tag:'releasedate' }),
  Object.freeze({ keys:['plot', 'overview'], tag:'plot' }),
  Object.freeze({ keys:['tagline'], tag:'tagline' }),
  Object.freeze({ keys:['studio'], tag:'studio' }),
  Object.freeze({ keys:['genre', 'genres'], tag:'genre' }),
  Object.freeze({ keys:['director'], tag:'director' }),
]);
const PRESENTATION_GATE_TAGS = new Set(['title', 'year', 'plot', 'genre']);
const SET_LIKE_OWNED_FIELD_TAGS = new Set(['genre', 'director', 'studio']);

class AftercareNfoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AftercareNfoError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new AftercareNfoError(code, message, details);
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function scalar(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(' / ') || null;
  if (typeof value === 'object') return null;
  return String(value).trim() || null;
}

function metadataEntries(metadata) {
  const rows = metadata?.descriptiveFacts?.entries || metadata?.entries;
  if (!Array.isArray(rows)) fail('ARCA_AFTERCARE_NFO_METADATA_INVALID', 'Aftercare NFO metadata entries are absent.');
  const entries = new Map();
  for (const item of rows) {
    if (!item || typeof item.key !== 'string' || entries.has(item.key)) {
      fail('ARCA_AFTERCARE_NFO_METADATA_INVALID', 'Aftercare NFO metadata entries are invalid or duplicated.');
    }
    entries.set(item.key, item.value);
  }
  return entries;
}

function castRelations(cast) {
  const rows = Array.isArray(cast) ? cast : cast?.relations;
  if (!Array.isArray(rows)) fail('ARCA_AFTERCARE_NFO_CAST_INVALID', 'Aftercare NFO cast relations are absent.');
  return rows.filter((item) => item?.role === 'actor' && scalar(item.displayName)).map((item) => Object.freeze({
    displayName:scalar(item.displayName),
    providerIdentities:Object.freeze(Array.isArray(item.providerIdentities) ? item.providerIdentities.map((identity) => Object.freeze({ ...identity })) : []),
  }));
}

function movieIdentity(identity) {
  if (!identity || typeof identity.provider !== 'string' ||
      !['string', 'number'].includes(typeof identity.providerKey)) {
    fail('ARCA_AFTERCARE_NFO_IDENTITY_INVALID', 'Aftercare NFO movie identity is invalid.');
  }
  const provider = identity.provider.trim().toLowerCase();
  const providerKey = String(identity.providerKey).trim();
  if (!provider || !providerKey) {
    fail('ARCA_AFTERCARE_NFO_IDENTITY_INVALID', 'Aftercare NFO movie identity is invalid.');
  }
  return Object.freeze({ provider, providerKey });
}

function tmdbPersonId(relation) {
  const value = relation.providerIdentities.find((item) => item?.provider === 'tmdb' && item.namespace === 'tmdb_person')?.providerKey;
  return value === undefined || value === null ? null : String(value).trim() || null;
}

function normalizedName(value) {
  return String(value || '').trim().normalize('NFKC').toLowerCase();
}

function actorBlock(relation) {
  const lines = ['  <actor>', '    <name>' + escapeXml(relation.displayName) + '</name>'];
  const personId = tmdbPersonId(relation);
  if (personId) lines.push('    <tmdbid>' + escapeXml(personId) + '</tmdbid>');
  lines.push('  </actor>');
  return lines.join('\n');
}

function ownedValues(metadata, identity) {
  const values = [];
  for (const field of OWNED_FIELDS) {
    const key = field.keys.find((candidate) => metadata.has(candidate) && scalar(metadata.get(candidate)) !== null);
    if (key) values.push(Object.freeze({ tag:field.tag, value:scalar(metadata.get(key)) }));
  }
  if (identity.provider === 'tmdb' && identity.providerKey) {
    values.push(Object.freeze({ tag:'tmdbid', value:identity.providerKey }));
  }
  return Object.freeze(values);
}

function assertOutputBound(xml) {
  const bytes = Buffer.from(xml, 'utf8');
  if (bytes.length > MAX_NFO_BYTES) fail('ARCA_AFTERCARE_NFO_OUTPUT_TOO_LARGE', 'Rendered Aftercare NFO exceeds its byte bound.', { maxBytes:MAX_NFO_BYTES });
  return bytes;
}

function createDocument(metadata, cast, identity) {
  const lines = ['<movie>'];
  for (const item of ownedValues(metadata, identity)) lines.push('  <' + item.tag + '>' + escapeXml(item.value) + '</' + item.tag + '>');
  if (identity.provider === 'tmdb' && identity.providerKey) {
    lines.push('  <uniqueid type="tmdb">' + escapeXml(identity.providerKey) + '</uniqueid>');
  }
  for (const relation of cast) lines.push(actorBlock(relation));
  lines.push('</movie>');
  return lines.join('\n') + '\n';
}

function replaceRanges(xml, replacements) {
  let output = xml;
  for (const item of [...replacements].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, item.start) + item.value + output.slice(item.end);
  }
  return output;
}

function updateOwnedFields(document, metadata, identity) {
  const replacements = [];
  const missing = [];
  for (const item of ownedValues(metadata, identity)) {
    const matches = document.directChildren.filter((child) => child.name === item.tag);
    if (matches.length === 0) missing.push('  <' + item.tag + '>' + escapeXml(item.value) + '</' + item.tag + '>');
    else {
      const retained = SET_LIKE_OWNED_FIELD_TAGS.has(item.tag) ? matches.slice(0, 1) : matches;
      for (const child of retained) replacements.push(child.selfClosing
        ? { start:child.openStart, end:child.closeEnd, value:'<' + item.tag + '>' + escapeXml(item.value) + '</' + item.tag + '>' }
        : { start:child.openEnd, end:child.closeStart, value:escapeXml(item.value) });
      for (const child of matches.slice(retained.length)) {
        replacements.push({ start:child.openStart, end:child.closeEnd, value:'' });
      }
    }
  }
  if (identity.provider === 'tmdb' && identity.providerKey) {
    const matches = document.directChildren.filter((child) => child.name === 'uniqueid' &&
      String(attribute(child, 'type') || '').toLowerCase() === 'tmdb');
    if (matches.length === 0) missing.push('  <uniqueid type="tmdb">' + escapeXml(identity.providerKey) + '</uniqueid>');
    else for (const child of matches) replacements.push(child.selfClosing
      ? { start:child.openStart, end:child.closeEnd, value:'<uniqueid type="tmdb">' + escapeXml(identity.providerKey) + '</uniqueid>' }
      : { start:child.openEnd, end:child.closeStart, value:escapeXml(identity.providerKey) });
  }
  if (missing.length) replacements.push({ start:document.root.closeStart, end:document.root.closeStart,
    value:'\n' + missing.join('\n') });
  return replaceRanges(document.xml, replacements);
}

function parseActor(xml, child) {
  const raw = xml.slice(child.openStart, child.closeEnd);
  const analyzed = analyzeMovieNfo('<movie>' + raw + '</movie>');
  if (!analyzed.usable) return Object.freeze({ raw, name:'', normalizedName:'', personId:null, closeStart:child.closeStart - child.openStart });
  const actor = analyzed.directChildren[0];
  const actorXml = analyzed.xml;
  const nested = actorXml.slice(actor.openEnd, actor.closeStart);
  const fields = analyzeMovieNfo('<movie>' + nested + '</movie>');
  const name = directText(fields, 'name') || '';
  const ids = [...new Set(fields.directChildren.filter((item) => item.name === 'tmdbid' ||
    (item.name === 'uniqueid' && String(attribute(item, 'type') || '').toLowerCase() === 'tmdb'))
    .map((item) => childText(fields, item)).filter(Boolean))];
  const identityConflict = ids.length > 1;
  const personId = identityConflict ? null : ids[0] || null;
  return Object.freeze({ raw, name, normalizedName:normalizedName(name), personId, identityConflict,
    closeStart:actor.closeStart - actor.openStart });
}

function mergeActors(xml, cast) {
  let document = analyzeMovieNfo(xml);
  if (!document.usable) fail('ARCA_AFTERCARE_NFO_UPDATE_INVALID', 'Updated Aftercare NFO became invalid before actor merge.');
  const actors = document.directChildren.filter((child) => child.name === 'actor').map((child) => parseActor(document.xml, child));
  for (const relation of cast) {
    const personId = tmdbPersonId(relation);
    if (personId && actors.some((item) => item.personId === personId)) continue;
    const name = normalizedName(relation.displayName);
    const sameName = actors.find((item) => !item.identityConflict && item.normalizedName === name &&
      (!personId || !item.personId || item.personId === personId));
    if (sameName) {
      if (personId && !sameName.personId) {
        const updated = sameName.raw.slice(0, sameName.closeStart) +
          '\n    <tmdbid>' + escapeXml(personId) + '</tmdbid>\n  ' + sameName.raw.slice(sameName.closeStart);
        xml = xml.replace(sameName.raw, updated);
        actors.splice(actors.indexOf(sameName), 1, Object.freeze({ ...sameName, raw:updated, personId }));
      }
      continue;
    }
    document = analyzeMovieNfo(xml);
    const block = actorBlock(relation);
    xml = xml.slice(0, document.root.closeStart) + '\n' + block + xml.slice(document.root.closeStart);
    actors.push(Object.freeze({ raw:block, name:relation.displayName, normalizedName:name, personId }));
  }
  return xml.endsWith('\n') ? xml : xml + '\n';
}

function prepareInputs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('ARCA_AFTERCARE_NFO_INPUT_INVALID', 'Aftercare NFO render input is absent.');
  }
  return Object.freeze({ metadata:metadataEntries(input.metadata), cast:castRelations(input.cast), identity:movieIdentity(input.identity) });
}

function createAftercareMovieNfo(input) {
  const prepared = prepareInputs(input);
  return Object.freeze({ disposition:'create', reasonCode:'source_missing',
    bytes:assertOutputBound(createDocument(prepared.metadata, prepared.cast, prepared.identity)) });
}

function rebuildAftercareMovieNfo(input, reasonCode = 'source_damaged') {
  const prepared = prepareInputs(input);
  return Object.freeze({ disposition:'rebuild', reasonCode,
    bytes:assertOutputBound(createDocument(prepared.metadata, prepared.cast, prepared.identity)) });
}

function updateAftercareMovieNfo(input) {
  const prepared = prepareInputs(input);
  const inspected = inspectAftercareMovieNfo(input.existingBytes);
  if (!inspected.usable) fail('ARCA_AFTERCARE_NFO_UPDATE_SOURCE_INVALID', 'Only a usable movie NFO can be updated.', { reasonCode:inspected.reasonCode });
  if (prepared.identity.provider === 'tmdb' && inspected.movieIdentity.providerKey &&
      inspected.movieIdentity.providerKey !== prepared.identity.providerKey) {
    fail('ARCA_AFTERCARE_NFO_UPDATE_IDENTITY_CONFLICT', 'A movie identity conflict requires NFO rebuild.');
  }
  const updated = mergeActors(updateOwnedFields(inspected, prepared.metadata, prepared.identity), prepared.cast);
  return Object.freeze({ disposition:'update', reasonCode:null, bytes:assertOutputBound(updated) });
}

function renderAftercareMovieNfo(input) {
  if (input?.existingBytes === null || input?.existingBytes === undefined) return createAftercareMovieNfo(input);
  const inspected = inspectAftercareMovieNfo(input.existingBytes);
  if (!inspected.usable) return rebuildAftercareMovieNfo(input, inspected.reasonCode);
  const identity = movieIdentity(input.identity);
  if (identity.provider === 'tmdb' && inspected.movieIdentity.providerKey &&
      inspected.movieIdentity.providerKey !== identity.providerKey) {
    return rebuildAftercareMovieNfo(input, 'movie_identity_conflict');
  }
  return updateAftercareMovieNfo(input);
}

function comparableText(value) {
  return normalizedName(scalar(value) || '');
}

function yearToken(value) {
  const text = scalar(value);
  if (!text) return null;
  return text.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/)?.[1] || comparableText(text);
}

function listTokens(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => comparableText(item)).filter(Boolean));
  const text = scalar(value);
  if (!text) return Object.freeze([]);
  return Object.freeze(text.split(/\s*\/\s*|\s*,\s*/).map((item) => comparableText(item)).filter(Boolean));
}

function sameTokenSet(left, right) {
  const expected = new Set(left), observed = new Set(right);
  return expected.size === observed.size && [...expected].every((item) => observed.has(item));
}

function collectDirectTexts(document, tag, predicate = () => true) {
  return Object.freeze(document.directChildren
    .filter((item) => item.name === tag && predicate(item))
    .map((item) => childText(document, item))
    .filter(Boolean));
}

function ownedFieldMatches(tag, expected, observed) {
  if (observed.length === 0) return false;
  if (tag === 'year' || tag === 'releasedate') {
    const expectedYear = yearToken(expected);
    return observed.every((item) => yearToken(item) === expectedYear);
  }
  if (tag === 'genre' || tag === 'director' || tag === 'studio') {
    return sameTokenSet(listTokens(expected), observed.flatMap((item) => [...listTokens(item)]));
  }
  const wanted = comparableText(expected);
  return observed.every((item) => comparableText(item) === wanted);
}

function actorPresent(document, relation) {
  const personId = tmdbPersonId(relation);
  const name = normalizedName(relation.displayName);
  const actors = document.directChildren.filter((child) => child.name === 'actor')
    .map((child) => parseActor(document.xml, child));
  if (personId && actors.some((item) => item.personId === personId)) return true;
  return Boolean(name) && actors.some((item) => !item.identityConflict && item.normalizedName === name &&
    (!personId || !item.personId));
}

function requiredActorRelations(relations) {
  return Object.freeze(relations.filter((relation) => {
    if (tmdbPersonId(relation)) return true;
    const name = normalizedName(relation.displayName);
    return !name || !relations.some((candidate) =>
      candidate !== relation && normalizedName(candidate.displayName) === name && tmdbPersonId(candidate));
  }));
}

function projectMovieNfoSemantics(value) {
  const inspected = inspectAftercareMovieNfo(value);
  if (!inspected.usable) return inspected;
  const fields = Object.freeze(Object.fromEntries(OWNED_FIELDS.map((field) => [
    field.tag, collectDirectTexts(inspected, field.tag),
  ])));
  return Object.freeze({
    usable:true,
    reasonCode:null,
    movieIdentity:inspected.movieIdentity,
    fields,
    actors:Object.freeze(inspected.directChildren.filter((child) => child.name === 'actor')
      .map((child) => parseActor(inspected.xml, child)).map((item) => Object.freeze({
        name:item.name, normalizedName:item.normalizedName, personId:item.personId,
      }))),
  });
}

function compareMovieNfoPresentation(input) {
  if (input?.existingBytes === null || input?.existingBytes === undefined) {
    return Object.freeze({ matches:false, reasonCode:'source_missing' });
  }
  const prepared = prepareInputs(input);
  const inspected = inspectAftercareMovieNfo(input.existingBytes);
  if (!inspected.usable) return Object.freeze({ matches:false, reasonCode:inspected.reasonCode });
  if (prepared.identity.provider === 'tmdb') {
    if (!inspected.movieIdentity.providerKey) {
      return Object.freeze({ matches:false, reasonCode:'movie_identity_missing' });
    }
    if (inspected.movieIdentity.providerKey !== prepared.identity.providerKey) {
      return Object.freeze({ matches:false, reasonCode:'movie_identity_conflict' });
    }
  }
  for (const item of ownedValues(prepared.metadata, prepared.identity)
    .filter((field) => PRESENTATION_GATE_TAGS.has(field.tag))) {
    if (item.tag === 'tmdbid') continue;
    const observed = collectDirectTexts(inspected, item.tag);
    if (!ownedFieldMatches(item.tag, item.value, observed)) {
      return Object.freeze({ matches:false, reasonCode:'owned_field_mismatch', field:item.tag });
    }
  }
  for (const relation of requiredActorRelations(prepared.cast)) {
    if (!actorPresent(inspected, relation)) {
      return Object.freeze({ matches:false, reasonCode:'actor_missing' });
    }
  }
  return Object.freeze({ matches:true, reasonCode:null });
}

module.exports = Object.freeze({
  AftercareNfoError,
  MAX_NFO_BYTES,
  compareMovieNfoPresentation,
  createAftercareMovieNfo,
  inspectAftercareMovieNfo,
  projectMovieNfoSemantics,
  rebuildAftercareMovieNfo,
  renderAftercareMovieNfo,
  updateAftercareMovieNfo,
});
