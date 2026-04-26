'use strict';

/**
 * Pure function: computes recommended action and reason from a MediaItem
 * and a subLibrary-level mediaPolicy.
 *
 * Input item fields used:
 *   bitrate (number, bps), resolution (string e.g. "3840x2160"),
 *   doubanRating (number|null), userRating (number|null)
 *
 * Output: { action: 'delete'|'transcode'|'upgrade'|'keep', reason: string }
 */

const HYSTERESIS_MBPS = 1;
const UPGRADE_BELOW_RATIO = 0.8;

function effectiveRating(item) {
  if (item.doubanRating != null) return item.doubanRating;
  if (item.userRating != null) return item.userRating;
  return null;
}

function isDeleteTier(r) {
  return r === 1 || r === 2;
}

function resolutionBucket(resolution) {
  if (!resolution) return '1080p';
  const h = parseInt(String(resolution).split('x')[1], 10) || 0;
  return h >= 2160 ? '4K' : '1080p';
}

function itemBitrateMbps(item) {
  const bps = typeof item.bitrate === 'number' ? item.bitrate : 0;
  return bps / 1_000_000;
}

function targetMbps(item, policy) {
  const r = effectiveRating(item);
  if (r == null || isDeleteTier(r)) return null;
  const bucket = resolutionBucket(item.resolution);
  // 5-star 1080p always upgrades, but still need a target for transcode check
  if (r === 5 && bucket === '1080p') return null;
  const ladder = bucket === '4K' ? policy.target4k : policy.target1080p;
  return ladder[r] != null ? ladder[r] : null;
}

function isModernCodec(codec) {
  if (!codec) return false;
  const c = String(codec).toLowerCase();
  return c === 'h265' || c === 'hevc' || c === 'av1';
}

function recommendedAction(item, policy) {
  const r = effectiveRating(item);
  const eq = itemBitrateMbps(item);
  const res = resolutionBucket(item.resolution);

  if (r == null) {
    return { action: 'keep', reason: '无有效评分' };
  }

  if (isDeleteTier(r)) {
    return { action: 'delete', reason: `${r}★ 属于删除档` };
  }

  const target = targetMbps(item, policy);
  if (target == null) {
    if (r === 5 && res === '1080p') {
      return { action: 'upgrade', reason: '5★ 1080p 建议升级到 4K' };
    }
    return { action: 'keep', reason: '无目标码率阈值' };
  }

  if (r === 3) {
    if (eq > target + HYSTERESIS_MBPS) {
      if (isModernCodec(item.codec)) {
        return { action: 'keep', reason: `已是 ${item.codec} 编码，硬件重编码不会显著减小体积（当前 ${eq.toFixed(1)} Mbps）` };
      }
      return { action: 'transcode', reason: `码率 ${eq.toFixed(1)} Mbps 超出 3★ 目标 ${target} Mbps` };
    }
    return { action: 'keep', reason: '码率在 3★ 目标范围内' };
  }

  if (r === 4) {
    if (eq > target + HYSTERESIS_MBPS) {
      if (isModernCodec(item.codec)) {
        return { action: 'keep', reason: `已是 ${item.codec} 编码，硬件重编码不会显著减小体积（当前 ${eq.toFixed(1)} Mbps）` };
      }
      return { action: 'transcode', reason: `码率 ${eq.toFixed(1)} Mbps 超出 4★ 目标 ${target} Mbps` };
    }
    if (eq < target * UPGRADE_BELOW_RATIO) {
      return { action: 'upgrade', reason: `码率 ${eq.toFixed(1)} Mbps 远低于 4★ 目标 ${target} Mbps` };
    }
    return { action: 'keep', reason: '码率在 4★ 目标范围内' };
  }

  if (r === 5) {
    if (res === '4K' && eq < target * UPGRADE_BELOW_RATIO) {
      return { action: 'upgrade', reason: `5★ 4K 码率 ${eq.toFixed(1)} Mbps 低于目标 ${target} Mbps` };
    }
    return { action: 'keep', reason: '码率在 5★ 目标范围内' };
  }

  return { action: 'keep', reason: '策略未覆盖' };
}

module.exports = { recommendedAction, effectiveRating, isDeleteTier };
