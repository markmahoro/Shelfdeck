'use strict';

/**
 * 豆瓣与 Emby 标题匹配工具（从 media-desktop/src/doubanUtils.ts 端口）。
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

function buildDoubanStarsByNormalizedTitle(entries) {
  const map = new Map();
  const list = Array.isArray(entries) ? entries : [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const title = e.title;
    const stars = e.stars;
    if (!title || typeof stars !== 'number') continue;
    for (const k of doubanTitleNormalizedKeys(title)) {
      map.set(k, stars);
    }
  }
  return map;
}

function movieDoubanStars(embyName, itemType, byNormTitle) {
  if (itemType !== 'Movie') return null;
  const keys = embyTitleNormalizedKeys(embyName);
  if (keys.length === 0) return null;
  const ordered = [...keys].sort((a, b) => b.length - a.length);
  for (const k of ordered) {
    const s = byNormTitle.get(k);
    if (s != null) return s;
  }
  return null;
}

module.exports = {
  normalizeTitleForDoubanMatch,
  doubanTitleNormalizedKeys,
  embyTitleNormalizedKeys,
  buildDoubanStarsByNormalizedTitle,
  movieDoubanStars,
};
