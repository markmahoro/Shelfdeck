'use strict';

/**
 * 码率策略与推荐动作：从 media-desktop/src/mediaManager.ts 端口到 service。
 * 输入 item 形如 { sizeGb, durationSec, codec, resolution, rating, doubanStars }。
 */

const AUDIO_MBPS_LUMP = 0.5;
const BITRATE_RECOMMEND_HYSTERESIS_MBPS = 1;
const UPGRADE_EQ_BELOW_TARGET_RATIO = 0.8;

function codecToH265Factor(codec) {
  if (codec === 'h264') return 1.35;
  if (codec === 'av1') return 0.85;
  return 1;
}

function estimateEquivalentBitrate(item) {
  const sizeGb = typeof item.sizeGb === 'number' ? item.sizeGb : 0;
  const durationSec = typeof item.durationSec === 'number' ? item.durationSec : 0;
  const totalMbps = (sizeGb * 8192) / Math.max(1, durationSec);
  const videoMbps = Math.max(0.3, totalMbps - AUDIO_MBPS_LUMP);
  return Number((videoMbps * codecToH265Factor(item.codec)).toFixed(2));
}

function effectiveRatingForPolicy(item) {
  if (item.doubanStars != null) return item.doubanStars;
  return item.rating != null ? item.rating : null;
}

function isDeleteTierRating(r) {
  return r === 1 || r === 2;
}

function targetBitrateFor(item, policy) {
  const r = effectiveRatingForPolicy(item);
  if (r == null) return null;
  if (isDeleteTierRating(r)) return null;
  const use4KPolicyTier = item.resolution === '4K' || (r === 5 && item.resolution === '1080p');
  const ladder = use4KPolicyTier ? policy.target4k : policy.target1080p;
  return ladder[r] != null ? ladder[r] : null;
}

function predictedSizeGbAtPolicyTarget(item, policy) {
  const r = effectiveRatingForPolicy(item);
  if (r == null) return item.sizeGb;
  if (isDeleteTierRating(r)) return 0;
  const target = targetBitrateFor(item, policy);
  if (target == null) return item.sizeGb;
  const totalMbps = target + AUDIO_MBPS_LUMP;
  const sec = Math.max(1, item.durationSec || 0);
  return (totalMbps * sec) / 8192;
}

function recommendedAction(item, policy) {
  const r = effectiveRatingForPolicy(item);
  if (r == null) return 'keep';
  if (isDeleteTierRating(r)) return 'delete';
  const target = targetBitrateFor(item, policy);
  if (!target) return 'keep';
  const eq = estimateEquivalentBitrate(item);
  const h = BITRATE_RECOMMEND_HYSTERESIS_MBPS;
  const belowRatio = UPGRADE_EQ_BELOW_TARGET_RATIO;

  if (r === 5) {
    if (item.resolution === '1080p') return 'upgrade';
    if (eq < target * belowRatio) return 'upgrade';
    return 'keep';
  }

  if (r === 3) {
    if (eq > target + h) return 'transcode';
    return 'keep';
  }

  if (r === 4) {
    if (eq > target + h) return 'transcode';
    if (eq < target * belowRatio) return 'upgrade';
    return 'keep';
  }

  return 'keep';
}

module.exports = {
  AUDIO_MBPS_LUMP,
  BITRATE_RECOMMEND_HYSTERESIS_MBPS,
  UPGRADE_EQ_BELOW_TARGET_RATIO,
  estimateEquivalentBitrate,
  effectiveRatingForPolicy,
  isDeleteTierRating,
  targetBitrateFor,
  predictedSizeGbAtPolicyTarget,
  recommendedAction,
};
