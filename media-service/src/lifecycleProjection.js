'use strict';

function normalizeAction(action) {
  return String(action || '').toLowerCase();
}

function isOptimizationDone(item) {
  const status = String(item && item.optimizationStatus || '').toLowerCase();
  return status === 'transcoded' || status === 'upgraded';
}

function resolveLifecycle(item) {
  const action = normalizeAction(item && item.action);
  const metadataComplete = !!(item && item.metadataComplete);

  if (!metadataComplete) {
    return {
      lifecycleStage: 'ingested',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'metadata',
      lifecycleReason: 'metadata_missing',
      optimizationDirection: action || null,
    };
  }

  if (!action || action === 'keep' || action === 'none') {
    return {
      lifecycleStage: 'archived',
      lifecycleDone: true,
      archiveStatus: 'archived_like',
      lifecycleNextTask: null,
      lifecycleReason: 'strategy_keep',
      optimizationDirection: 'keep',
    };
  }

  if (isOptimizationDone(item)) {
    return {
      lifecycleStage: 'archived',
      lifecycleDone: true,
      archiveStatus: 'archived_like',
      lifecycleNextTask: null,
      lifecycleReason: 'optimization_done',
      optimizationDirection: action,
    };
  }

  return {
    lifecycleStage: 'metadata_ready',
    lifecycleDone: false,
    archiveStatus: 'not_ready',
    lifecycleNextTask: 'optimize',
    lifecycleReason: 'optimization_pending',
    optimizationDirection: action,
  };
}

function decorateItem(item) {
  return {
    ...item,
    ...resolveLifecycle(item),
  };
}

function decorateItems(items) {
  return (items || []).map((item) => decorateItem(item));
}

function matchesFilter(item, filter) {
  const value = String(filter || '').toLowerCase();
  if (!value) return true;
  if (value === 'done' || value === 'closed') return !!item.lifecycleDone;
  if (value === 'open' || value === 'pending') return !item.lifecycleDone;
  if (value === 'archive_ready') return item.archiveStatus === 'archived_like';
  return item.lifecycleStage === value || item.archiveStatus === value || item.lifecycleNextTask === value;
}

module.exports = {
  decorateItem,
  decorateItems,
  matchesFilter,
  resolveLifecycle,
};
