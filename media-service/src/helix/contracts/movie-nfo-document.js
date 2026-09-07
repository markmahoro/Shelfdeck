'use strict';
const { nfoXmlText:xmlCharacterData } = require('./nfo-xml-text');
const MAX_NFO_BYTES = 256 * 1024;
const XML_NAME = /^[A-Za-z_][\w:.-]*/;
function fail(code,message){throw Object.assign(new Error(message),{code});}
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
  if (/\0|[\x01-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(xml)) {
    return Object.freeze({ usable:false, reasonCode:'invalid_xml_character' });
  }
  return Object.freeze({ usable:true, xml:xml.replace(/^\uFEFF/, '') });
}

function validateEntities(text) {
  return !text.trim() || xmlCharacterData(text) !== null;
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
  return xmlCharacterData(document.xml.slice(child.openEnd, child.closeStart));
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


module.exports=Object.freeze({MAX_NFO_BYTES,bytesOf,analyzeMovieNfo,attribute,directText,childText,inspectMovieNfo:inspectAftercareMovieNfo});
