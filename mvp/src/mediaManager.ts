import type { MediaTask } from './taskQueue';

export type MediaRating = 1 | 2 | 3 | 4 | 5;
export type MediaAction = 'delete' | 'transcode' | 'upgrade' | 'keep';

export type ManagedMediaItem = {
  id: string;
  name: string;
  sectionId: string;
  sectionName?: string;
  resolution: '1080p' | '4K';
  codec: 'h264' | 'h265' | 'av1';
  durationSec: number;
  sizeGb: number;
  /** ISO / BDMV 等原盘结构；为 true 时禁止码率优化入队 */
  isBluRayDisc: boolean;
  /** null 表示未标注 */
  rating: MediaRating | null;
  /**豆瓣个人评分：null 表示未抓取到（含未同步、无匹配、非电影行） */
  doubanStars: MediaRating | null;
  /** Emby 观看状态（与未播放列表可能不同步，以本地与接口为准） */
  watched: boolean;
};

export type MediaPolicy = {
  target1080p: Record<2 | 3 | 4 | 5, number>;
  target4k: Record<2 | 3 | 4 | 5, number>;
};

export const defaultMediaPolicy: MediaPolicy = {
  target1080p: { 2: 3, 3: 6, 4: 10, 5: 16 },
  target4k: { 2: 8, 3: 14, 4: 22, 5: 35 },
};

function codecToH265Factor(codec: ManagedMediaItem['codec']): number {
  if (codec === 'h264') return 1.35;
  if (codec === 'av1') return 0.85;
  return 1;
}

export function estimateEquivalentBitrate(item: ManagedMediaItem): number {
  const totalMbps = (item.sizeGb * 8192) / Math.max(1, item.durationSec);
  const videoMbps = Math.max(0.3, totalMbps - 0.5);
  return Number((videoMbps * codecToH265Factor(item.codec)).toFixed(2));
}

/**
 * 码率策略与列表「星级状态」：已匹配到豆瓣分时优先用豆瓣，否则用用户在媒体库中标注的星级。
 */
export function effectiveRatingForPolicy(item: ManagedMediaItem): MediaRating | null {
  if (item.doubanStars != null) return item.doubanStars;
  return item.rating;
}

export function targetBitrateFor(item: ManagedMediaItem, policy: MediaPolicy): number | null {
  const r = effectiveRatingForPolicy(item);
  if (r == null || r === 1) return null;
  const ladder = item.resolution === '4K' ? policy.target4k : policy.target1080p;
  return ladder[r];
}

export function recommendedAction(item: ManagedMediaItem, policy: MediaPolicy): MediaAction {
  const r = effectiveRatingForPolicy(item);
  if (r == null) return 'keep';
  if (r === 1) return 'delete';
  const target = targetBitrateFor(item, policy);
  if (!target) return 'keep';
  const eq = estimateEquivalentBitrate(item);
  if (eq > target + 1) return 'transcode';
  if (eq < target - 1) return 'upgrade';
  return 'keep';
}

export function buildTaskPreview(item: ManagedMediaItem, action: MediaAction): Pick<MediaTask, 'itemId' | 'itemName' | 'actionType'> | null {
  if (item.isBluRayDisc && (action === 'transcode' || action === 'upgrade')) return null;
  if (action === 'transcode') return { itemId: item.id, itemName: item.name, actionType: 'transcode' };
  if (action === 'upgrade') return { itemId: item.id, itemName: item.name, actionType: 'upgrade' };
  return null;
}

export function nextManualRefreshInfo(retryCount: number, settings: TaskSchedulerSettings): string {
  if (retryCount < settings.waitingFastRetryCount) return `快速重搜：每 ${settings.waitingFastIntervalHours} 小时`;
  if (retryCount < settings.waitingMidRetryCount) return `中速重搜：每 ${settings.waitingMidIntervalDays} 天`;
  return `慢速重搜：每 ${settings.waitingSlowIntervalDays} 天`;
}

