import type { MediaRating } from './mediaManager';

export type DoubanRatingEntry = {
  title: string;
  stars: MediaRating;
  subjectId: string;
};

/** 剔除标点、符号与空白后做严格相等匹配（NFKC） */
export function normalizeTitleForDoubanMatch(title: string): string {
  let s = title.normalize('NFKC').trim();
  s = s.replace(/[\p{P}\p{S}\s]+/gu, '');
  return s;
}

/**
 * 豆瓣条目标题常为「中文 / 英文 / 港译…」；须按每一段分别参与匹配，
 * 否则整串去掉标点后与 Emby 单语种片名无法相等。
 */
export function doubanTitleNormalizedKeys(rawTitle: string): string[] {
  const t = rawTitle.normalize('NFKC').trim();
  if (!t) return [];
  const segments = t
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const keys = new Set<string>();
  for (const seg of segments.length > 0 ? segments : [t]) {
    const k = normalizeTitleForDoubanMatch(seg);
    if (k) keys.add(k);
  }
  const whole = normalizeTitleForDoubanMatch(t);
  if (whole) keys.add(whole);
  return [...keys];
}

export function buildDoubanStarsByNormalizedTitle(entries: DoubanRatingEntry[]): Map<string, MediaRating> {
  const map = new Map<string, MediaRating>();
  for (const e of entries) {
    for (const k of doubanTitleNormalizedKeys(e.title)) {
      map.set(k, e.stars);
    }
  }
  return map;
}

/** 仅电影行参与豆瓣分；剧集等始终视为未匹配 */
export function movieDoubanStars(
  embyName: string,
  itemType: 'Movie' | 'Episode' | 'Other' | undefined,
  byNormTitle: Map<string, MediaRating>,
): MediaRating | null {
  if (itemType !== 'Movie') return null;
  const k = normalizeTitleForDoubanMatch(embyName);
  if (!k) return null;
  const s = byNormTitle.get(k);
  return s ?? null;
}

export type DoubanMatchExplainReason =
  | 'matched'
  | 'not_movie'
  | 'empty_emby_key'
  | 'no_douban_data'
  | 'no_key_hit';

export type DoubanMatchExplain = {
  reason: DoubanMatchExplainReason;
  embyNormKey: string;
  stars: MediaRating | null;
  matchedEntry: DoubanRatingEntry | null;
  /** 命中的豆瓣标题分段（斜杠分隔之一） */
  matchedSegment: string | null;
};

/** 用于日志页：说明某条 Emby 目录项为何能/不能匹配当前豆瓣缓存 */
export function explainMovieDoubanMatch(
  embyName: string,
  itemType: 'Movie' | 'Episode' | 'Other' | undefined,
  entries: DoubanRatingEntry[],
): DoubanMatchExplain {
  const embyK = normalizeTitleForDoubanMatch(embyName);
  if (itemType !== 'Movie') {
    return { reason: 'not_movie', embyNormKey: embyK, stars: null, matchedEntry: null, matchedSegment: null };
  }
  if (!embyK) {
    return { reason: 'empty_emby_key', embyNormKey: '', stars: null, matchedEntry: null, matchedSegment: null };
  }
  if (entries.length === 0) {
    return { reason: 'no_douban_data', embyNormKey: embyK, stars: null, matchedEntry: null, matchedSegment: null };
  }
  const map = buildDoubanStarsByNormalizedTitle(entries);
  const stars = map.get(embyK) ?? null;
  if (stars == null) {
    return { reason: 'no_key_hit', embyNormKey: embyK, stars: null, matchedEntry: null, matchedSegment: null };
  }
  for (const e of entries) {
    const segs = e.title
      .split(/\s*\/\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const candidates = segs.length > 0 ? [...segs, e.title] : [e.title];
    for (const seg of candidates) {
      if (normalizeTitleForDoubanMatch(seg) === embyK) {
        return { reason: 'matched', embyNormKey: embyK, stars, matchedEntry: e, matchedSegment: seg };
      }
    }
  }
  return { reason: 'matched', embyNormKey: embyK, stars, matchedEntry: null, matchedSegment: null };
}
