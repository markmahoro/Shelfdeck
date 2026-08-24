'use strict';

const { TextDecoder } = require('node:util');

const MAX_NFO_BYTES = 256 * 1024;
const XML_NAME = /^[A-Za-z_][\w:.-]*/;
const SAFE_ENTITY = /^(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/i;
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

function bytesOf(value, field = 'existingBytes') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail('ARCA_AFTERCARE_NFO_BYTES_INVALID', field + ' must be UTF-8 bytes or text.');
}

function decodeBounded(value) {
  const bytes = bytesOf(value);
  if (bytes.length === 0) return Object.freeze({ usable:false, reasonCode:'empty' });
  if (bytes.length > MAX_NFO_BYTES) return Object.freeze({ usable:false, reasonCode:'too_large' });
  let xml;
  try {
    xml = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
  } catch {
    return Object.freeze({ usable:false, reasonCode:'invalid_utf8' });
  }
  if (/\0|[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(xml)) {
    return Object.freeze({ usable:false, reasonCode:'invalid_xml_character' });
  }
  return Object.freeze({ usable:true, xml:xml.replace(/^\uFEFF/, '') });
}

function validateEntities(text) {
  for (let index = text.indexOf('&'); index !== -1; index = text.indexOf('&', index + 1)) {
    if (!SAFE_ENTITY.test(text.slice(index + 1))) return false;
  }
  return true;
}

function tagEnd(xml, start) {
  let quote = null;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

function parseAttributes(source) {
  let remainder = source.trim();
  const attributes = [];
  const names = new Set();
  while (remainder) {
    const name = XML_NAME.exec(remainder)?.[0];
    if (!name) return null;
    remainder = remainder.slice(name.length).replace(/^\s*/, '');
    if (!remainder.startsWith('=')) return null;
    remainder = remainder.slice(1).replace(/^\s*/, '');
    const quote = remainder[0];
    if (quote !== '"' && quote !== "'") return null;
    const close = remainder.indexOf(quote, 1);
    if (close === -1) return null;
    const value = remainder.slice(1, close);
    if (value.includes('<') || !validateEntities(value) || names.has(name)) return null;
    names.add(name);
    attributes.push(Object.freeze({ name, value }));
    remainder = remainder.slice(close + 1).replace(/^\s*/, '');
  }
  return Object.freeze(attributes);
}

function parseTag(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return null;
  if (inner.startsWith('/')) {
    const closing = inner.slice(1).trim();
    const name = XML_NAME.exec(closing)?.[0];
    if (!name || closing.slice(name.length).trim()) return null;
    return Object.freeze({ kind:'close', name });
  }
  const selfClosing = /\/\s*$/.test(inner);
  const body = selfClosing ? inner.replace(/\/\s*$/, '').trim() : inner;
  const name = XML_NAME.exec(body)?.[0];
  if (!name) return null;
  const attributes = parseAttributes(body.slice(name.length));
  if (!attributes) return null;
  return Object.freeze({ kind:selfClosing ? 'self' : 'open', name, attributes });
}

function tokenize(xml) {
  const tokens = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    const textEnd = open === -1 ? xml.length : open;
    const text = xml.slice(cursor, textEnd);
    if (text.includes(']]>') || !validateEntities(text)) return Object.freeze({ valid:false, reasonCode:'invalid_entity' });
    if (text) tokens.push(Object.freeze({ kind:'text', start:cursor, end:textEnd, raw:text }));
    if (open === -1) break;
    if (xml.startsWith('<!--', open)) {
      const close = xml.indexOf('-->', open + 4);
      if (close === -1 || xml.slice(open + 4, close).includes('--')) return Object.freeze({ valid:false, reasonCode:'malformed_comment' });
      tokens.push(Object.freeze({ kind:'misc', start:open, end:close + 3 }));
      cursor = close + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open + 9);
      if (close === -1) return Object.freeze({ valid:false, reasonCode:'malformed_cdata' });
      tokens.push(Object.freeze({ kind:'cdata', start:open, end:close + 3 }));
      cursor = close + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const close = xml.indexOf('?>', open + 2);
      if (close === -1) return Object.freeze({ valid:false, reasonCode:'malformed_processing_instruction' });
      tokens.push(Object.freeze({ kind:'misc', start:open, end:close + 2 }));
      cursor = close + 2;
      continue;
    }
    if (xml.startsWith('<!', open)) return Object.freeze({ valid:false, reasonCode:'declaration_forbidden' });
    const close = tagEnd(xml, open);
    if (close === -1) return Object.freeze({ valid:false, reasonCode:'unterminated_tag' });
    const raw = xml.slice(open, close + 1);
    const parsed = parseTag(raw);
    if (!parsed) return Object.freeze({ valid:false, reasonCode:'malformed_tag' });
    tokens.push(Object.freeze({ ...parsed, start:open, end:close + 1, raw }));
    cursor = close + 1;
  }
  return Object.freeze({ valid:true, tokens:Object.freeze(tokens) });
}

function attribute(node, name) {
  return node.attributes?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function analyzeMovieNfo(value) {
  const decoded = decodeBounded(value);
  if (!decoded.usable) return decoded;
  const tokenized = tokenize(decoded.xml);
  if (!tokenized.valid) return Object.freeze({ usable:false, reasonCode:tokenized.reasonCode });
  const stack = [];
  const directChildren = [];
  let root = null;
  let rootClosed = false;
  for (const token of tokenized.tokens) {
    if (token.kind === 'text') {
      if (stack.length === 0 && token.raw.trim()) return Object.freeze({ usable:false, reasonCode:'text_outside_root' });
      continue;
    }
    if (token.kind === 'misc' || token.kind === 'cdata') {
      if (token.kind === 'cdata' && stack.length === 0) return Object.freeze({ usable:false, reasonCode:'cdata_outside_root' });
      continue;
    }
    if (token.kind === 'open' || token.kind === 'self') {
      if (stack.length === 0) {
        if (root || rootClosed || token.name.toLowerCase() !== 'movie' || token.kind === 'self') {
          return Object.freeze({ usable:false, reasonCode:'movie_root_required' });
        }
        root = { name:token.name, openStart:token.start, openEnd:token.end, closeStart:null, closeEnd:null };
      } else if (stack.length === 1) {
        directChildren.push({ name:token.name.toLowerCase(), attributes:token.attributes,
          openStart:token.start, openEnd:token.end, closeStart:token.kind === 'self' ? token.start : null,
          closeEnd:token.kind === 'self' ? token.end : null, selfClosing:token.kind === 'self' });
      }
      if (token.kind === 'open') stack.push(token.name);
      continue;
    }
    if (stack.length === 0 || stack.at(-1) !== token.name) {
      return Object.freeze({ usable:false, reasonCode:'unbalanced_tags' });
    }
    if (stack.length === 2) {
      const child = directChildren.at(-1);
      child.closeStart = token.start;
      child.closeEnd = token.end;
    }
    stack.pop();
    if (stack.length === 0) {
      root.closeStart = token.start;
      root.closeEnd = token.end;
      rootClosed = true;
    }
  }
  if (!root || !rootClosed || stack.length) return Object.freeze({ usable:false, reasonCode:'unbalanced_tags' });
  const completed = directChildren.every((item) => item.closeStart !== null);
  if (!completed) return Object.freeze({ usable:false, reasonCode:'unbalanced_tags' });
  return Object.freeze({ usable:true, reasonCode:null, xml:decoded.xml, root:Object.freeze(root),
    directChildren:Object.freeze(directChildren.map((item) => Object.freeze(item))) });
}

function directText(document, tag, predicate = () => true) {
  const child = document.directChildren.find((item) => item.name === tag && predicate(item));
  return childText(document, child);
}

function childText(document, child) {
  if (!child || child.selfClosing) return null;
  const raw = document.xml.slice(child.openEnd, child.closeStart);
  if (raw.includes('<')) return null;
  return raw.trim() || null;
}

function inspectAftercareMovieNfo(value) {
  const document = analyzeMovieNfo(value);
  if (!document.usable) return document;
  const tmdbIds = [
    ...document.directChildren.filter((item) => item.name === 'tmdbid').map((item) => childText(document, item)),
    ...document.directChildren.filter((item) => item.name === 'uniqueid' &&
      String(attribute(item, 'type') || '').toLowerCase() === 'tmdb').map((item) => {
      if (item.selfClosing) return null;
      return childText(document, item);
    }),
  ].filter(Boolean);
  if (new Set(tmdbIds).size > 1) return Object.freeze({ usable:false, reasonCode:'movie_identity_conflict' });
  return Object.freeze({ ...document, movieIdentity:Object.freeze({
    provider:'tmdb', providerKey:tmdbIds[0] || null,
  }) });
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
    else for (const child of matches) replacements.push(child.selfClosing
      ? { start:child.openStart, end:child.closeEnd, value:'<' + item.tag + '>' + escapeXml(item.value) + '</' + item.tag + '>' }
      : { start:child.openEnd, end:child.closeStart, value:escapeXml(item.value) });
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
  const name = nested.match(/<name(?:\s[^<>]*?)?>([^<>]*)<\/name>/i)?.[1]?.trim() || '';
  const personId = nested.match(/<tmdbid(?:\s[^<>]*?)?>([^<>]*)<\/tmdbid>/i)?.[1]?.trim() ||
    nested.match(/<uniqueid\b[^<>]*\btype\s*=\s*["']tmdb["'][^<>]*>([^<>]*)<\/uniqueid>/i)?.[1]?.trim() || null;
  return Object.freeze({ raw, name, normalizedName:normalizedName(name), personId,
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
    const sameName = actors.find((item) => item.normalizedName === name);
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

module.exports = Object.freeze({
  AftercareNfoError,
  MAX_NFO_BYTES,
  createAftercareMovieNfo,
  inspectAftercareMovieNfo,
  rebuildAftercareMovieNfo,
  renderAftercareMovieNfo,
  updateAftercareMovieNfo,
});
