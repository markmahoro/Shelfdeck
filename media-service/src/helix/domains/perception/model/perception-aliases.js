'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const RULE_REVISION = 2;
const TECHNICAL_TOKEN = /(?:^|[\s._-])(?:2160p|1080p|720p|480p|4k|uhd|bluray|blu-ray|remux|web[- .]?dl|webrip|hdtv|x26[45]|h\.?26[45]|hevc|avc|hdr10\+?|dolby[ .]?vision|dv|atmos|truehd|dts(?:-hd)?|aac|flac)(?:$|[\s._-])/iu;

function normalizeAlias(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function splitTitleYear(value) {
  const separator = String(value || '').lastIndexOf('\0');
  if (separator < 1) return null;
  const title = String(value).slice(0, separator).trim();
  const year = String(value).slice(separator + 1).trim();
  return title && /^\d{4}$/.test(year) ? { title, year } : null;
}

function stripReleaseSuffix(title) {
  let value = String(title || '').normalize('NFKC').trim();
  for (const separator of [' - ', ' – ', ' — ']) {
    const index = value.lastIndexOf(separator);
    if (index > 0 && TECHNICAL_TOKEN.test(value.slice(index + separator.length))) {
      value = value.slice(0, index).trim();
    }
  }
  const tokens = value.split(/\s+/u);
  while (tokens.length > 1 && TECHNICAL_TOKEN.test(' ' + tokens.at(-1) + ' ')) tokens.pop();
  return tokens.join(' ').trim()
    .replace(/\s*(?:\((?:19|20)\d{2}\)|\[(?:19|20)\d{2}\])\s*$/u, '')
    .trim();
}

function titleAliases(title, { providerDelimited = false, stripTechnical = false } = {}) {
  const source = String(title || '').normalize('NFKC').trim();
  const values = providerDelimited ? source.split(/\s+[\/／]\s+/u) : [source];
  const result = new Map();
  for (const raw of values) {
    for (const candidate of [raw, stripTechnical ? stripReleaseSuffix(raw) : raw]) {
      const normalized = normalizeAlias(candidate);
      if (normalized) result.set(normalized, candidate.trim());
    }
  }
  return Object.freeze([...result.values()].slice(0, 16));
}

function deriveTitleYearEvidence(anchorValue, options = {}) {
  const parsed = splitTitleYear(anchorValue);
  if (!parsed) return Object.freeze([]);
  return Object.freeze(titleAliases(parsed.title, options).map((alias) => Object.freeze({
    anchorKind: 'title_year',
    anchorValue: alias + '\0' + parsed.year,
    confidenceClass: 'medium',
    aliasRuleRevision: RULE_REVISION,
    evidenceDigest: canonicalDigest({
      schema: 'perception-derived-title-year-alias@2',
      sourceAnchorValue: anchorValue,
      alias,
      year: parsed.year,
      aliasRuleRevision: RULE_REVISION,
    }),
  })));
}

function aliasesMatch(left, right) {
  return normalizeAlias(left) === normalizeAlias(right);
}

module.exports = Object.freeze({
  RULE_REVISION,
  aliasesMatch,
  deriveTitleYearEvidence,
  normalizeAlias,
  splitTitleYear,
  stripReleaseSuffix,
  titleAliases,
});
