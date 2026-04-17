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
