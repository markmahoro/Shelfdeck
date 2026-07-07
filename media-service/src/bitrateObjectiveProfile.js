'use strict';

const DEFAULT_MIN_RATIO = 0.65;
const DEFAULT_MAX_RATIO = 1.35;

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roundMbps(value) {
  const n = numberOrNull(value);
  return n == null ? null : Math.round(n * 1000) / 1000;
}

function normalizeBucket(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('4k') || raw.includes('2160')) return '4K';
  if (raw.includes('1080')) return '1080p';
  if (raw.includes('720')) return '720p';
  return raw || '1080p';
}

function bucketFromMediaFacts(item = {}) {
  const explicit = normalizeBucket(item.bucket || item.resolutionBucket || item.resolution);
  if (explicit === '4K') return '4K';
  if (explicit === '1080p' || explicit === '720p') return explicit;
  const width = Number(item.width || item.originalWidth || 0);
  const height = Number(item.height || item.originalHeight || 0);
  if (width >= 3000 || height >= 2000) return '4K';
  return '1080p';
}

function profileFromTargetMbps(targetMbps, bucket, source = 'generated_default') {
  const target = roundMbps(targetMbps);
  if (target == null) return null;
  return {
    minMbps: roundMbps(target * DEFAULT_MIN_RATIO),
    targetMbps: target,
    maxMbps: roundMbps(target * DEFAULT_MAX_RATIO),
    bucket: bucket || '1080p',
    source,
  };
}

function normalizeProfile(value, bucket, source = 'targetBitrateProfileByBucket') {
  if (value == null) return null;
  if (typeof value !== 'object') return null;

  const target = roundMbps(value.targetMbps);
  const min = roundMbps(value.minMbps);
  const max = roundMbps(value.maxMbps);
  if (target == null || min == null || max == null) return null;

  return {
    minMbps: min,
    targetMbps: target,
    maxMbps: max,
    bucket: bucket || value.bucket || '1080p',
    source,
  };
}

function pickBucketValue(map, bucket) {
  if (!map || typeof map !== 'object') return undefined;
  const normalized = normalizeBucket(bucket);
  return map[bucket] ?? map[normalized] ?? map['1080p'] ?? map['4K'];
}

function targetFactsFromObjective(objective = {}) {
  return objective.targetMediaFacts && typeof objective.targetMediaFacts === 'object'
    ? objective.targetMediaFacts
    : objective;
}

function resolveBitrateProfile(input = {}) {
  const target = targetFactsFromObjective(input.targetMediaFacts || input.objective || input);
  const item = input.item || input.itemInfo || {};
  const bucket = normalizeBucket(input.bucket || bucketFromMediaFacts(item));

  const profileByBucket = target.targetBitrateProfileByBucket;
  const explicitBucketProfile = pickBucketValue(profileByBucket, bucket);
  const explicitProfile = normalizeProfile(explicitBucketProfile, bucket, 'targetBitrateProfileByBucket');
  if (explicitProfile) return explicitProfile;

  return null;
}

function compareBitrateToProfile(actualMbps, profile) {
  const actual = numberOrNull(actualMbps);
  if (actual == null) return { status: 'missing', reason: 'media.bitrate' };
  if (!profile || profile.minMbps == null || profile.maxMbps == null) return { status: 'no_profile' };
  if (actual < profile.minMbps) return { status: 'below', reason: 'bitrate_below_range' };
  if (actual > profile.maxMbps) return { status: 'above', reason: 'bitrate_above_range' };
  return { status: 'within', reason: 'bitrate_within_range' };
}

function targetBitrateProfileFromTarget(targetMbps, bucket) {
  return profileFromTargetMbps(targetMbps, normalizeBucket(bucket), 'generated_default');
}

module.exports = {
  DEFAULT_MIN_RATIO,
  DEFAULT_MAX_RATIO,
  bucketFromMediaFacts,
  compareBitrateToProfile,
  normalizeBucket,
  resolveBitrateProfile,
  targetBitrateProfileFromTarget,
};
