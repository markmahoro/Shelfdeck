import type { MediaTask } from './taskQueue';

export type MediaRating = 1 | 2 | 3 | 4 | 5;
export type MediaAction = 'delete' | 'transcode' | 'upgrade' | 'keep';

export type ManagedMediaItem = {
  id: string;
  name: string;
  sectionId: string;
  sectionName?: string;
  /** Emby 类型；用于电影专属的容量预测汇总 */
  itemType?: 'Movie' | 'Episode' | 'Other';
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

/**
 * 默认目标视频码率（Mbps），与 estimateEquivalentBitrate / 容量预测共用。
 * 校准参考：典型 4K UHD H265 成片约 45GB/2h → 容器 ~51 Mbps、视频约 50 Mbps（扣 0.5音轨后）；
 * 旧版 5★4K=35 与源差距偏小，预测「可省空间」偏保守，故整体下调一档以利码率优化与预测对齐现实片源。
 */
export const defaultMediaPolicy: MediaPolicy = {
  target1080p: { 2: 2, 3: 4, 4: 7, 5: 12 },
  target4k: { 2: 5, 3: 10, 4: 16, 5: 25 },
};

/** 与 estimateEquivalentBitrate 中从容器总码率里扣减的音轨估算（Mbps）一致 */
const AUDIO_MBPS_LUMP = 0.5;

function codecToH265Factor(codec: ManagedMediaItem['codec']): number {
  if (codec === 'h264') return 1.35;
  if (codec === 'av1') return 0.85;
  return 1;
}

export function estimateEquivalentBitrate(item: ManagedMediaItem): number {
  const totalMbps = (item.sizeGb * 8192) / Math.max(1, item.durationSec);
  const videoMbps = Math.max(0.3, totalMbps - AUDIO_MBPS_LUMP);
  return Number((videoMbps * codecToH265Factor(item.codec)).toFixed(2));
}

/**
 * 假设视频轨按策略目标码率重编码（音轨等按固定 Mbps 估算），得到的单条目体积（GB）。
 * 无有效星级时无法对齐策略，返回当前体积；1 星（删除档）视为 0。
 */
export function predictedSizeGbAtPolicyTarget(item: ManagedMediaItem, policy: MediaPolicy): number {
  const r = effectiveRatingForPolicy(item);
  if (r == null) return item.sizeGb;
  if (r === 1) return 0;
  const target = targetBitrateFor(item, policy);
  if (target == null) return item.sizeGb;
  const totalMbps = target + AUDIO_MBPS_LUMP;
  const sec = Math.max(1, item.durationSec);
  return (totalMbps * sec) / 8192;
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

