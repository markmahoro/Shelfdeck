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

function pendingCanonicalOptimizeGate(item = {}, factsFreshness = {}) {
  const gate = item.optimizeGate || item.optimizationGate;
  if (!gate || gate.status !== 'pending_canonical_refresh') return null;
  return lifecycleGateService.evaluateOptimizeGate({ ...item, factsFreshness });
}

function resolveLifecycle(item, config = {}) {
  const reason = normalizeReason(item && item.reason);
  const metadataComplete = !!(item && item.metadataComplete);
  const factsFreshness = item && item.factsFreshness
    ? item.factsFreshness
    : factsFreshnessService.projectForItem(item || {});
  const itemWithFreshness = { ...(item || {}), factsFreshness };
  const basedataGate = lifecycleGateService.evaluateBasedataGate(itemWithFreshness);
  const objectiveProjection = lifecycleObjectiveResolver.projectOptimizeObjective(itemWithFreshness, { config });
  const pendingOptimizeGate = pendingCanonicalOptimizeGate(item || {}, factsFreshness);

  if (!basedataGate.passed) {
    return {
      lifecycleStage: 'admitted',
      lifecycleDone: false,
      lifecycleNextTask: basedataGate.status === 'blocked' ? null : 'basedata',
      lifecycleReason: basedataGate.reason,
      ...objectiveProjection,
      factsFreshness,
      basedataGate,
      optimizeGate: pendingOptimizeGate,
    };
  }

  const metadataFresh = factsFreshnessService.isFresh(factsFreshness, 'metadataFacts');
  const staleMetadataFacts = factsFreshnessService.isBlockingStale(factsFreshness, 'metadataFacts');
  if (!metadataComplete || !metadataFresh) {
    return {
      lifecycleStage: 'basedata_ready',
      lifecycleDone: false,
      lifecycleNextTask: 'metadata',
      lifecycleReason: staleMetadataFacts ? 'metadata_facts_stale' : 'metadata_missing',
      ...objectiveProjection,
      factsFreshness,
      basedataGate,
      metadataGate: {
        gate: 'metadata',
        passed: false,
        status: staleMetadataFacts ? 'stale' : 'missing',
        reason: staleMetadataFacts ? 'metadata_facts_stale' : 'metadata_missing',
        missingReasons: metadataComplete ? [] : (item && item.metadataMissingReasons || []),
        freshness: {
          metadataFacts: factsFreshness.metadataFacts,
        },
        userAction: staleMetadataFacts ? 'refresh_media_or_metadata_facts' : 'repair_metadata',
      },
      optimizeGate: pendingOptimizeGate,
    };
  }

  const metadataGate = {
    gate: 'metadata',
    passed: true,
    status: 'passed',
    reason: 'metadata_gate_met',
    missingReasons: [],
    freshness: { metadataFacts: factsFreshness.metadataFacts },
    userAction: '',
  };

  const hasGateClosureFacts = !!(item && (item.optimizeGate || item.optimizationGate));
  if (!hasGateClosureFacts && objectiveProjection.optimizeObjectiveStatus !== 'ready') {
    return {
      lifecycleStage: 'metadata_ready',
      lifecycleDone: false,
      lifecycleNextTask: null,
      lifecycleReason: objectiveLifecycleReason(objectiveProjection, reason ? 'strategy_pending' : 'strategy_missing'),
      ...objectiveProjection,
      factsFreshness,
      basedataGate,
      metadataGate,
      optimizeGate: null,
    };
  }

  const itemWithObjectiveProjection = { ...(item || {}), ...objectiveProjection };
  const optimizeGate = lifecycleGateService.evaluateOptimizeGate(itemWithObjectiveProjection);
  if (optimizeGate.passed) {
    return {
      lifecycleStage: 'maintenance_complete',
      lifecycleDone: true,
      lifecycleNextTask: null,
      lifecycleReason: optimizeGate.reason,
      ...objectiveProjection,
      factsFreshness,
      basedataGate,
      metadataGate,
      optimizeGate,
    };
  }

  return {
    lifecycleStage: 'metadata_ready',
    lifecycleDone: false,
    lifecycleNextTask: optimizeGate.status === 'blocked' ? null : 'optimize',
    lifecycleReason: optimizeGate.reason === 'objective_not_satisfied' ? 'objective_not_satisfied' : 'optimization_pending',
    ...objectiveProjection,
    factsFreshness,
    basedataGate,
    metadataGate,
    optimizeGate,
  };
}

function metadataRefreshObjective(projection = {}) {
  return {
    kind: 'metadata_refresh',
    refreshFacts: ['metadataFacts'],
    reason: projection.lifecycleReason || 'facts_stale',
  };
}

function basedataRefreshObjective(projection = {}) {
  return {
    kind: 'basedata_current',
    reason: projection.lifecycleReason || 'basedata_missing_or_stale',
  };
}

function gateObjectiveForProjection(projection = {}) {
  const targetGate = projection.lifecycleNextTask || '';
  if (targetGate === 'optimize') return projection.optimizeObjective || {};
  if (targetGate === 'metadata') {
    const freshness = projection.factsFreshness || {};
    const stale = factsFreshnessService.isBlockingStale(freshness, 'metadataFacts');
    return stale ? metadataRefreshObjective(projection) : {};
  }
  if (targetGate === 'basedata') return basedataRefreshObjective(projection);
  return {};
}

function blockedReasonForProjection(projection = {}) {
  const targetGate = projection.lifecycleNextTask || '';
  if (targetGate !== 'metadata') return '';
  const adultMeta = projection.adultMetadata && typeof projection.adultMetadata === 'object' ? projection.adultMetadata : {};
  const scrapeStatus = String(adultMeta.scrapeStatus || '').trim().toLowerCase();
  const metadataFactsStale = factsFreshnessService.isBlockingStale(projection.factsFreshness || {}, 'metadataFacts');
  if (!metadataFactsStale && (projection.scraped === true || scrapeStatus === 'done')) return 'metadata_already_scraped';
  if (['failed', 'ambiguous', 'needs_review'].includes(scrapeStatus)) return `metadata_${scrapeStatus}`;
  return '';
}

function toLifecycleSnapshot(item, config = {}) {
  const projection = decorateItem(item, config);
  const blockedReason = blockedReasonForProjection(projection);
  const nextTargetGate = blockedReason ? null : (projection.lifecycleNextTask || null);
  return {
    subjectId: projection.subjectId || '',
    object: {
      type: 'media_item',
      subjectId: projection.subjectId || '',
    },
    item: projection,
    subjectInfo: projection,
    nextTargetGate,
    gateObjective: nextTargetGate ? gateObjectiveForProjection({ ...projection, lifecycleNextTask: nextTargetGate }) : {},
    lifecycleReason: projection.lifecycleReason || '',
    factsFreshness: projection.factsFreshness || {},
    optimizeObjectiveStatus: projection.optimizeObjectiveStatus || '',
    blockedReason,
    timestamp: projection.updatedAt ? new Date(projection.updatedAt).getTime() : 0,
  };
}

function toLifecycleSnapshots(items, config = {}) {
  return (items || []).map((item) => toLifecycleSnapshot(item, config));
}

function decorateItem(item, config = {}) {
  const lifecycle = resolveLifecycle(item, config);
  const pendingCanonicalRefresh = !!(lifecycle.optimizeGate && lifecycle.optimizeGate.status === 'pending_canonical_refresh');
  const admissionCurrent = item.admissionCurrent !== false;
  const unresolvedSourceIncident = !!item.unresolvedSourceIncident;
  const maintenanceComplete = lifecycle.lifecycleDone === true
    && admissionCurrent
    && !pendingCanonicalRefresh
    && !unresolvedSourceIncident;
  return {
    ...item,
    ...lifecycle,
    maintenanceComplete,
    maintenanceState: maintenanceComplete ? 'complete' : 'maintaining',
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
  return item.lifecycleStage === value || item.lifecycleNextTask === value;
}

module.exports = {
  decorateItem,
  decorateItems,
  matchesFilter,
  resolveLifecycle,
  evaluateBasedataGate: lifecycleGateService.evaluateBasedataGate,
  evaluateOptimizeGate: lifecycleGateService.evaluateOptimizeGate,
  toLifecycleSnapshot,
  toLifecycleSnapshots,
};
