'use strict';

const lifecycleGateService = require('./lifecycleGateService');

function normalizeAction(action) {
  return String(action || '').toLowerCase();
}

function normalizeReason(reason) {
  return String(reason || '').trim();
}

function isInitialStrategyPlaceholder(action, reason) {
  if (!action || action === 'none') return true;
  if (action !== 'keep') return false;
  return ['新入库', '成人库新入库'].includes(normalizeReason(reason));
}

function resolveLifecycle(item) {
  const action = normalizeAction(item && item.action);
  const reason = normalizeReason(item && item.reason);
  const metadataComplete = !!(item && item.metadataComplete);
  const ingestGate = lifecycleGateService.evaluateIngestGate(item || {});

  if (!ingestGate.passed) {
    return {
      lifecycleStage: 'source_discovered',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'ingest',
      lifecycleReason: ingestGate.reason,
      optimizationDirection: action || null,
      ingestGate,
      optimizeGate: null,
      archiveGate: null,
    };
  }

  if (!metadataComplete) {
    return {
      lifecycleStage: 'ingested',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'metadata',
      lifecycleReason: 'metadata_missing',
      optimizationDirection: action || null,
      ingestGate,
      optimizeGate: null,
      archiveGate: null,
    };
  }

  if (isInitialStrategyPlaceholder(action, reason)) {
    return {
      lifecycleStage: 'metadata_ready',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'optimize',
      lifecycleReason: action ? 'strategy_pending' : 'strategy_missing',
      optimizationDirection: null,
      ingestGate,
      optimizeGate: null,
      archiveGate: null,
    };
  }

  const optimizeGate = lifecycleGateService.evaluateOptimizeGate(item || {});
  if (optimizeGate.passed) {
    const archiveGate = lifecycleGateService.evaluateArchiveGate(item || {});
    if (!archiveGate.passed) {
      return {
        lifecycleStage: 'optimized',
        lifecycleDone: false,
        archiveStatus: 'not_ready',
        lifecycleNextTask: 'archive',
        lifecycleReason: archiveGate.reason,
        optimizationDirection: optimizeGate.operation || action,
        ingestGate,
        optimizeGate,
        archiveGate,
      };
    }
    return {
      lifecycleStage: 'archived',
      lifecycleDone: true,
      archiveStatus: 'archived_like',
      lifecycleNextTask: null,
      lifecycleReason: optimizeGate.reason,
      optimizationDirection: optimizeGate.operation || action,
      ingestGate,
      optimizeGate,
      archiveGate,
    };
  }

  if (optimizeGate.status === 'failed') {
    return {
      lifecycleStage: 'metadata_ready',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: null,
      lifecycleReason: optimizeGate.reason,
      optimizationDirection: optimizeGate.operation || action,
      ingestGate,
      optimizeGate,
      archiveGate: null,
    };
  }

  return {
    lifecycleStage: 'metadata_ready',
    lifecycleDone: false,
    archiveStatus: 'not_ready',
    lifecycleNextTask: 'optimize',
    lifecycleReason: 'optimization_pending',
    optimizationDirection: optimizeGate.operation || action,
    ingestGate,
    optimizeGate,
    archiveGate: null,
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
  evaluateIngestGate: lifecycleGateService.evaluateIngestGate,
  evaluateOptimizeGate: lifecycleGateService.evaluateOptimizeGate,
  evaluateArchiveGate: lifecycleGateService.evaluateArchiveGate,
};
