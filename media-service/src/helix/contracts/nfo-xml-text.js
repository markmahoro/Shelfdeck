'use strict';

function xmlCodePoint(value) {
  return value === 9 || value === 10 || value === 13 ||
    (value >= 0x20 && value <= 0xd7ff) || (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff);
}

// Character data only: CDATA is literal, entities are decoded exactly once,
// comments carry no text, and nested markup cannot masquerade as a scalar Fact.
function nfoXmlText(raw) {
  if (raw == null) return null;
  const source = String(raw).replace(/\r\n?/g, '\n'), tokens = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--((?:(?!--)[\s\S])*?)-->|&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);|([^<&]+)/gy;
  const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
  let offset = 0, output = '';
  while (offset < source.length) {
    const token = tokens.exec(source);
    if (!token) return null;
    offset = tokens.lastIndex;
    if (token[1] !== undefined) output += token[1];
    else if (token[2] !== undefined) continue;
    else if (token[3] !== undefined) {
      const entity = token[3];
      if (Object.hasOwn(named, entity)) output += named[entity];
      else {
        const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (!xmlCodePoint(code)) return null;
        output += String.fromCodePoint(code);
      }
    } else {
      if (token[4].includes(']]>')) return null;
      output += token[4];
    }
  }
  if ([...output].some((character) => !xmlCodePoint(character.codePointAt(0)))) return null;
  return output.trim() || null;
}

module.exports = Object.freeze({ nfoXmlText });
