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

/** Emby 片名若含主副标题（全角或半角冒号、全角或半角竖线），按段各自生成规范化键 */
const EMBY_SUBTITLE_SPLIT = /[\uFF1A\u003A\uFF5C|]/;

/**
 * Emby 片名生成的规范化键（有序、去重）：各拆段 + 整串。
 * 例：`变形金刚2：卷土重来` → `变形金刚2`、`卷土重来`、整串去标点后的键。
 */
export function embyTitleNormalizedKeys(rawName: string): string[] {
  const t = rawName.normalize('NFKC').trim();
  if (!t) return [];
  const parts = t.split(EMBY_SUBTITLE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const segs = parts.length > 1 ? parts : [t];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const seg of segs) {
    push(normalizeTitleForDoubanMatch(seg));
  }
  push(normalizeTitleForDoubanMatch(t));
  return out;
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
  const keys = embyTitleNormalizedKeys(embyName);
  if (keys.length === 0) return null;
  const ordered = [...keys].sort((a, b) => b.length - a.length);
  for (const k of ordered) {
    const s = byNormTitle.get(k);
    if (s != null) return s;
  }
  return null;
}
