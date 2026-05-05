'use strict';

/**
 * Douban title keyword matching.
 * Core algorithm: NFKC normalize → split on /:：｜| → longest-key-first lookup.
 *
 * Ported from media-desktop/src/doubanUtils.ts.
 */

const EMBY_SUBTITLE_SPLIT = /[：:｜|]/;

function normalizeTitleForDoubanMatch(title) {
  let s = String(title || '').normalize('NFKC').trim();
  s = s.replace(/[\p{P}\p{S}\s]+/gu, '');
  return s;
}

function doubanTitleNormalizedKeys(rawTitle) {
  const t = String(rawTitle || '').normalize('NFKC').trim();
  if (!t) return [];
  const segments = t.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  const keys = new Set();
  for (const seg of segments.length > 0 ? segments : [t]) {
    const k = normalizeTitleForDoubanMatch(seg);
    if (k) keys.add(k);
  }
  const whole = normalizeTitleForDoubanMatch(t);
  if (whole) keys.add(whole);
  return [...keys];
}

function embyTitleNormalizedKeys(rawName) {
  const t = String(rawName || '').normalize('NFKC').trim();
  if (!t) return [];
  const parts = t.split(EMBY_SUBTITLE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const segs = parts.length > 1 ? parts : [t];
  const out = [];
  const seen = new Set();
  const push = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const seg of segs) push(normalizeTitleForDoubanMatch(seg));
  push(normalizeTitleForDoubanMatch(t));
  return out;
}

// ── TV season extraction ────────────────────────────────────────────────────

// ── Chinese numeral → Arabic ─────────────────────────────────────────────

const CN_NUM_MAP = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
const CN_NUM_RE = /第\s*([\d一二三四五六七八九十]+)\s*季/i;

function parseCnNumeral(s) {
  const d = parseInt(s, 10);
  if (!Number.isNaN(d)) return d;
  if (CN_NUM_MAP[s]) return CN_NUM_MAP[s];
  // "十一" → 11, "二十一" → 21, "九十九" → 99
  const tenIdx = s.indexOf('十');
  if (tenIdx >= 0) {
    const tens = tenIdx > 0 ? (CN_NUM_MAP[s[tenIdx - 1]] || 1) : 1;
    const ones = tenIdx < s.length - 1 ? (CN_NUM_MAP[s[tenIdx + 1]] || 0) : 0;
    return tens * 10 + ones;
  }
  return NaN;
}

// ── TV season extraction ────────────────────────────────────────────────────

const SEASON_PATTERNS = [
  CN_NUM_RE,              // 第一季, 第 1 季, 第十一季
  /Season\s*(\d+)/i,      // Season 1
  /(\d+)$/i,              // trailing number (半泽直树2)
];

const NON_SEASON_RE = /(SP|Special|Movie|剧场版|特別篇|特别篇|OVA|OAD|OAV|总集篇|合集)/i;

function extractDoubanSeason(title) {
  const t = String(title || '').trim();
  if (!t || NON_SEASON_RE.test(t)) return null;

  // Only search the first segment (before /) to avoid matching English season numbers
  const firstSeg = t.split('/')[0].trim();

  for (const re of SEASON_PATTERNS) {
    const m = firstSeg.match(re);
    if (m) {
      const num = parseCnNumeral(m[1]);
      if (Number.isNaN(num) || num < 1 || num > 99) continue;
      // Strip the matched season part to get series name
      const seriesName = firstSeg.slice(0, m.index).trim().replace(/[\s\-_]+$/, '');
      if (!seriesName) continue;
      return { seriesName, seasonNum: num };
    }
  }
  return null;
}

function seasonKey(seriesName, seasonNum) {
  return normalizeTitleForDoubanMatch(seriesName) + '|S' + String(seasonNum).padStart(2, '0');
}

function seriesKey(seriesName) {
  return normalizeTitleForDoubanMatch(seriesName);
}

function buildDoubanStarsByNormalizedTitle(entries) {
  const map = new Map();
  const list = Array.isArray(entries) ? entries : [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const title = e.title;
    const stars = e.stars;
    if (!title || typeof stars !== 'number') continue;

    // Original keys (for movie matching)
    for (const k of doubanTitleNormalizedKeys(title)) {
      const prev = map.get(k);
      if (prev == null || stars > prev) map.set(k, stars);
    }

    // TV series/season keys (only for douban TV entries, not movies)
    if (e.collectType === 'tv') {
      const extracted = extractDoubanSeason(title);
      if (extracted) {
        const sk = seriesKey(extracted.seriesName);
        const prevS = map.get(sk);
        if (prevS == null || stars > prevS) map.set(sk, stars);

        const ssk = seasonKey(extracted.seriesName, extracted.seasonNum);
        const prevSS = map.get(ssk);
        if (prevSS == null || stars > prevSS) map.set(ssk, stars);
      }
    }
  }
  return map;
}

function movieDoubanStars(embyName, itemType, byNormTitle) {
  if (itemType !== 'Movie' && itemType !== 'Series') return null;
  const keys = embyTitleNormalizedKeys(embyName);
  if (keys.length === 0) return null;
  const ordered = [...keys].sort((a, b) => b.length - a.length);
  for (const k of ordered) {
    const s = byNormTitle.get(k);
    if (s != null) return s;
  }
  return null;
}

function seasonDoubanStars(seriesName, seasonNum, byNormTitle) {
  if (!seriesName || seasonNum == null) return null;
  const key = seasonKey(seriesName, seasonNum);
  const s = byNormTitle.get(key);
  return s != null ? s : null;
}

module.exports = {
  normalizeTitleForDoubanMatch,
  doubanTitleNormalizedKeys,
  embyTitleNormalizedKeys,
  extractDoubanSeason,
  seasonKey,
  seriesKey,
  buildDoubanStarsByNormalizedTitle,
  movieDoubanStars,
  seasonDoubanStars,
};
