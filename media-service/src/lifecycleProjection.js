'use strict';

const lifecycleGateService = require('./lifecycleGateService');
const lifecycleObjectiveResolver = require('./lifecycleObjectiveResolver');
const factsFreshnessService = require('./factsFreshnessService');

function normalizeReason(reason) {
  return String(reason || '').trim();
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
  const reason = normalizeReason(item && item.reason);
  const metadataComplete = !!(item && item.metadataComplete);
  const factsFreshness = item && item.factsFreshness
    ? item.factsFreshness
    : factsFreshnessService.projectForItem(item || {});
  const itemWithFreshness = { ...(item || {}), factsFreshness };
  const ingestGate = lifecycleGateService.evaluateIngestGate(itemWithFreshness);
  const objectiveProjection = lifecycleObjectiveResolver.projectOptimizeObjective(itemWithFreshness, { config });

  if (!ingestGate.passed) {
    return {
      lifecycleStage: 'source_discovered',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'ingest',
      lifecycleReason: ingestGate.reason,
      optimizeFlowKind: null,
      ...objectiveProjection,
      factsFreshness,
      ingestGate,
      optimizeGate: null,
      archiveGate: null,
    };
  }

  const metadataFresh = factsFreshnessService.isFresh(factsFreshness, 'mediaFacts')
    && factsFreshnessService.isFresh(factsFreshness, 'metadataFacts');
  const staleMetadataFacts = factsFreshnessService.isBlockingStale(factsFreshness, 'mediaFacts')
    || factsFreshnessService.isBlockingStale(factsFreshness, 'metadataFacts');
  if (!metadataComplete || !metadataFresh) {
    return {
      lifecycleStage: 'ingested',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: 'metadata',
      lifecycleReason: staleMetadataFacts ? 'metadata_facts_stale' : 'metadata_missing',
      optimizeFlowKind: null,
      ...objectiveProjection,
      factsFreshness,
      ingestGate,
      metadataGate: {
        gate: 'metadata',
        passed: false,
        status: staleMetadataFacts ? 'stale' : 'missing',
        reason: staleMetadataFacts ? 'metadata_facts_stale' : 'metadata_missing',
        missingReasons: metadataComplete ? [] : (item && item.metadataMissingReasons || []),
        freshness: {
          mediaFacts: factsFreshness.mediaFacts,
          metadataFacts: factsFreshness.metadataFacts,
        },
        userAction: staleMetadataFacts ? 'refresh_media_or_metadata_facts' : 'repair_metadata',
      },
      optimizeGate: null,
      archiveGate: null,
    };
  }

  const hasGateClosureFacts = !!(
    item && (item.optimizeGate || item.optimizationGate || item.archiveStatus || item.archiveDoneAt)
  );
  if (!hasGateClosureFacts && objectiveProjection.optimizeObjectiveStatus !== 'ready') {
    return {
      lifecycleStage: 'metadata_ready',
      lifecycleDone: false,
      archiveStatus: 'not_ready',
      lifecycleNextTask: null,
      lifecycleReason: objectiveLifecycleReason(objectiveProjection, reason ? 'strategy_pending' : 'strategy_missing'),
      optimizeFlowKind: null,
      ...objectiveProjection,
      factsFreshness,
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
      optimizeFlowKind: optimizeGate.flowKind || null,
      ...objectiveProjection,
      factsFreshness,
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
        optimizeFlowKind: optimizeGate.flowKind || null,
        ...objectiveProjection,
        factsFreshness,
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
        optimizeFlowKind: optimizeGate.flowKind || null,
        ...objectiveProjection,
        factsFreshness,
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
      optimizeFlowKind: optimizeGate.flowKind || null,
      ...objectiveProjection,
      factsFreshness,
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
      optimizeFlowKind: optimizeGate.flowKind || null,
      ...objectiveProjection,
      factsFreshness,
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
    optimizeFlowKind: optimizeGate.flowKind || null,
    ...objectiveProjection,
    factsFreshness,
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
