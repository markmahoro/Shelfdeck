'use strict';

const lifecycleGateService = require('./lifecycleGateService');
const lifecycleObjectiveResolver = require('./lifecycleObjectiveResolver');

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

function objectiveLifecycleReason(projection, fallback) {
  const status = projection && projection.optimizeObjectiveStatus;
  if (status === 'pending_perception') return 'pending_perception';
  if (status === 'pending_metadata') return 'pending_metadata';
  if (status === 'blocked_contract' && projection && projection.objectiveBlockedReason && projection.objectiveBlockedReason !== 'objective_not_projected') {
    return 'objective_contract_blocked';
  }
  return fallback;
}

function resolveLifecycle(item, config = {}) {
  const action = normalizeAction(item && item.action);
  const reason = normalizeReason(item && item.reason);
  const metadataComplete = !!(item && item.metadataComplete);
  const ingestGate = lifecycleGateService.evaluateIngestGate(item || {});
  const objectiveProjection = lifecycleObjectiveResolver.projectOptimizeObjective(item || {}, { config });

  if (!ingestGate.passed) {
    return {
      lifecycleStage: 'source_discovered',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'ingest',
      lifecycleReason: ingestGate.reason,
      optimizationDirection: action || null,
      ...objectiveProjection,
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
      ...objectiveProjection,
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
      lifecycleReason: objectiveLifecycleReason(objectiveProjection, action ? 'strategy_pending' : 'strategy_missing'),
      optimizationDirection: null,
      ...objectiveProjection,
      ingestGate,
      optimizeGate: null,
      archiveGate: null,
    };
  }

  const itemWithObjectiveProjection = { ...(item || {}), ...objectiveProjection };
  const terminalDeleteGate = lifecycleGateService.evaluateDeleteGate(item || {});
  if (terminalDeleteGate.passed) {
    const archiveGate = lifecycleGateService.evaluateArchiveGate(item || {});
    const optimizeGate = lifecycleGateService.evaluateOptimizeGate(itemWithObjectiveProjection);
    return {
      lifecycleStage: 'deleted',
      lifecycleDone: true,
      archiveStatus: archiveGate.passed ? 'archived_like' : (item.archiveStatus || 'not_ready'),
      deleteStatus: 'deleted',
      lifecycleNextTask: null,
      lifecycleReason: terminalDeleteGate.reason,
      optimizationDirection: optimizeGate.operation || action || null,
      ...objectiveProjection,
      ingestGate,
      optimizeGate,
      archiveGate,
      deleteGate: terminalDeleteGate,
    };
  }

  const optimizeGate = lifecycleGateService.evaluateOptimizeGate(itemWithObjectiveProjection);
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
        ...objectiveProjection,
        ingestGate,
        optimizeGate,
        archiveGate,
      };
    }
    const deleteGate = lifecycleGateService.evaluateDeleteGate(item || {});
    if (deleteGate.passed) {
      return {
        lifecycleStage: 'deleted',
        lifecycleDone: true,
        archiveStatus: 'archived_like',
        deleteStatus: 'deleted',
        lifecycleNextTask: null,
        lifecycleReason: deleteGate.reason,
        optimizationDirection: optimizeGate.operation || action,
        ...objectiveProjection,
        ingestGate,
        optimizeGate,
        archiveGate,
        deleteGate,
      };
    }
    return {
      lifecycleStage: 'archived',
      lifecycleDone: true,
      archiveStatus: 'archived_like',
      deleteStatus: 'not_deleted',
      lifecycleNextTask: null,
      lifecycleReason: optimizeGate.reason,
      optimizationDirection: optimizeGate.operation || action,
      ...objectiveProjection,
      ingestGate,
      optimizeGate,
      archiveGate,
      deleteGate,
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
      ...objectiveProjection,
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
    ...objectiveProjection,
    ingestGate,
    optimizeGate,
    archiveGate: null,
  };
}

function decorateItem(item, config = {}) {
  return {
    ...item,
    ...resolveLifecycle(item, config),
  };
}

function decorateItems(items, config = {}) {
  return (items || []).map((item) => decorateItem(item, config));
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
  evaluateDeleteGate: lifecycleGateService.evaluateDeleteGate,
};
