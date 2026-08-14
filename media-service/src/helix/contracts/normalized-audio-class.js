'use strict';

const MAX_FORMAT_TAGS = 64;

function asciiFold(value) {
  return String(value || '').replace(/[A-Z]/g, (item) =>
    String.fromCharCode(item.charCodeAt(0) + 32));
}

function uniqueSortedTags(values) {
  const seen = new Set();
  const tags = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    tags.push(trimmed);
    if (tags.length >= MAX_FORMAT_TAGS) break;
  }
  tags.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  return Object.freeze(tags);
}

function collectFormatTags(stream) {
  if (Array.isArray(stream?.formatTags)) return uniqueSortedTags(stream.formatTags);
  const tags = stream?.tags && typeof stream.tags === 'object' ? stream.tags : {};
  return uniqueSortedTags(Object.values(tags));
}

function hasTagToken(formatTags, tokens) {
  return formatTags.some((tag) => {
    const folded = asciiFold(tag);
    return tokens.some((token) => folded.includes(token));
  });
}

function normalizeAudioClass(stream) {
  const codec = asciiFold(stream?.codec).replace(/[_\s]+/g, '-');
  const profile = asciiFold(stream?.profile);
  const formatTags = collectFormatTags(stream);
  const hasAtmosOrJoc = hasTagToken(formatTags, ['joc', 'atmos']);
  const hasDtsX = hasTagToken(formatTags, ['dts:x', 'dts-x', 'dtsx']);
  const isEac3 = codec === 'eac3' || codec === 'e-ac-3' || codec === 'e-ac3';
  const isTruehd = codec === 'truehd';
  const isDts = codec === 'dts' || codec === 'dca';
  const isDtsHdMa = profile.includes('dts-hd ma') || profile.includes('dts-hd master audio');
  if (isEac3 && hasAtmosOrJoc) return 'eac3_atmos';
  if (isTruehd && hasAtmosOrJoc) return 'truehd_atmos';
  if (isTruehd) return 'truehd';
  if (isDts && hasDtsX) return 'dts_x';
  if (isDts && isDtsHdMa) return 'dts_hd_ma';
  return 'other';
}

module.exports = Object.freeze({
  asciiFold,
  collectFormatTags,
  normalizeAudioClass,
});
