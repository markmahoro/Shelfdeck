'use strict';

/**
 * @deprecated
 *
 * mediaPolicyService is no longer the SSOT for strategy rules.
 *
 * Strategy rules are now defined as rule templates in config.json
 * and evaluated by StrategyEngine (strategyEngine.js). All modules
 * that previously called recommendedAction() / targetMbps() /
 * effectiveRating() have been migrated to read rule-evaluated fields
 * directly from media library item records.
 *
 * The resolutionBucket() helper is kept for media library item bucket
 * projection (mediaLibraryService.projectMediaFactsForItem).
 */

function resolutionBucket(resolutionOrItem) {
  if (resolutionOrItem && typeof resolutionOrItem === 'object' && resolutionOrItem.bucket) {
    return resolutionOrItem.bucket;
  }
  const res = typeof resolutionOrItem === 'string' ? resolutionOrItem : (resolutionOrItem && resolutionOrItem.resolution) || '';
  if (!res) return '1080p';
  const parts = String(res).split('x');
  const w = parseInt(parts[0], 10) || 0;
  const h = parseInt(parts[1], 10) || 0;
  return (w >= 3840 || h >= 2160) ? '4K' : '1080p';
}

module.exports = { resolutionBucket };
