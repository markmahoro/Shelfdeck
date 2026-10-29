'use strict';

const { buildJavQueryAnchor } = require('../../../contracts/jav-source-contracts');

// The dependency is pinned because a later Unicode table must not reinterpret
// a frozen Final Inventory Decision.
const RULE = 'arca.jav-title-prefix@1';
const MAX_TITLE_BYTES = 230;

function fail(code, message) {
  throw Object.assign(new TypeError(message), { code });
}

function validUnicode(value) {
  return !Array.from(value).some(character => {
    const point = character.codePointAt(0);
    return point >= 0xd800 && point <= 0xdfff;
  });
}

/** Choose a display title only; this function does not reserve or write a target. */
function chooseJavTitlePrefix({ title, providerIdentities, fits, splitGraphemes }) {
  if (typeof title !== 'string' || !title.trim() || !validUnicode(title)) {
    fail('CLEAN_ARCA_TARGET_SEGMENT_INVALID', 'Final Inventory title contains invalid Unicode or is empty.');
  }
  if (typeof fits !== 'function') throw new TypeError('A complete rendered-name budget check is required.');
  if (typeof splitGraphemes !== 'function') throw new TypeError('The versioned grapheme segmenter is required.');
  if (fits(title)) return Object.freeze({ title, shortened:false });

  const identities = Array.isArray(providerIdentities) ? providerIdentities.filter(item =>
    item?.provider === 'jav' && item.namespace === 'jav_code') : [];
  const code = identities.length === 1 ? identities[0].providerKey : null;
  try {
    if (typeof code !== 'string' || buildJavQueryAnchor('jav_code', code).javCode !== code) throw new Error();
  } catch {
    fail('CLEAN_ARCA_JAV_CODE_REQUIRED', 'JAV shortening requires one complete, canonical frozen code.');
  }
  const source = title.startsWith(code + ' ') ? title.slice(code.length + 1) : title;
  let prefix = '', best = null;
  for (const grapheme of splitGraphemes(source)) {
    prefix += grapheme;
    // Do not trim part of a grapheme: a Unicode Prepend character and a
    // following space can be one cluster. Skip an unportable ending instead.
    if (/[.\s]$/u.test(grapheme)) continue;
    const candidate = code + ' ' + prefix;
    // Every primary template contains the entire stem. No longer candidate
    // can fit a 230-byte primary-component budget even before its extension.
    if (Buffer.byteLength(candidate, 'utf8') > MAX_TITLE_BYTES) break;
    if (fits(candidate)) best = candidate;
  }
  if (!best) {
    fail('CLEAN_ARCA_JAV_TITLE_UNFITTING', 'JAV code, fixed fields and one complete title character do not fit.');
  }
  return Object.freeze({ title:best, shortened:true, javCode:code, rule:RULE });
}

module.exports = Object.freeze({ RULE, chooseJavTitlePrefix });
