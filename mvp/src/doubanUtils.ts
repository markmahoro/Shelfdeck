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

export function buildDoubanStarsByNormalizedTitle(entries: DoubanRatingEntry[]): Map<string, MediaRating> {
  const map = new Map<string, MediaRating>();
  for (const e of entries) {
    const k = normalizeTitleForDoubanMatch(e.title);
    if (k) map.set(k, e.stars);
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
