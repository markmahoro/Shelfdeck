/**
 * [models] 媒体项数据模型 — 纯类型定义。
 *
 * 策略计算（recommendedAction / targetBitrateFor / estimateEquivalentBitrate 等）
 * 由 service mediaPolicyService.js 负责，通过 API 返回 computed 字段。
 * TODO: service 添加 recommendedAction / equivalentBitrate / targetBitrate /
 *       predictedSizeGb 字段到 GET /v1/library/queries/manage 响应后，
 *       MediaLibraryManageRow 直接从 item 读取，不再需要本地的策略函数。
 */

export type MediaRating = 1 | 2 | 3 | 4 | 5;
export type MediaAction = 'delete' | 'transcode' | 'upgrade' | 'keep';

export type ManagedMediaItem = {
  id: string;
  name: string;
  sectionId: string;
  sectionName?: string;
  itemType?: 'Movie' | 'Episode' | 'Other';
  resolution: '1080p' | '4K';
  codec: 'h264' | 'h265' | 'av1';
  durationSec: number;
  sizeGb: number;
  isBluRayDisc: boolean;
  rating: MediaRating | null;
  doubanStars: MediaRating | null;
  watched: boolean;
  /** service 返回的策略建议（SSOT）。客户端侧不自行计算。 */
  recommendedAction?: MediaAction;
  /** service 返回的等价码率（Mbps）。 */
  equivalentBitrate?: number;
  /** service 返回的策略目标码率（Mbps）。 */
  targetBitrate?: number;
  /** service 返回的预测转码后体积（GB）。 */
  predictedSizeGb?: number;
};

export type MediaPolicy = {
  target1080p: Record<2 | 3 | 4 | 5, number>;
  target4k: Record<2 | 3 | 4 | 5, number>;
};

import type { MediaTask } from './task';

export function buildTaskPreview(
  item: ManagedMediaItem,
  action: MediaAction,
): Pick<MediaTask, 'itemId' | 'itemName' | 'actionType'> | null {
  if (item.isBluRayDisc && (action === 'transcode' || action === 'upgrade')) return null;
  if (action === 'transcode') return { itemId: item.id, itemName: item.name, actionType: 'transcode' };
  if (action === 'upgrade') return { itemId: item.id, itemName: item.name, actionType: 'upgrade' };
  if (action === 'delete') return { itemId: item.id, itemName: item.name, actionType: 'delete' };
  return null;
}
