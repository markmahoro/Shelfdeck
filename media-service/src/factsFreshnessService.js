'use strict';

const FACT_GROUPS = ['basedataFacts', 'metadataFacts', 'userPerceptionFacts', 'gateFacts', 'sourceFacts', 'mediaFacts'];
const STATUSES = new Set(['fresh', 'stale', 'unknown', 'needs_check', 'refreshing', 'blocked', 'invalidated']);

const OWNER_GATE_BY_GROUP = {
  basedataFacts: 'basedata',
  sourceFacts: 'ingest',
  mediaFacts: 'metadata',
  metadataFacts: 'metadata',
  userPerceptionFacts: 'perception',
  gateFacts: 'lifecycle',
};

const REFRESH_TARGET_BY_GROUP = {
  basedataFacts: 'basedata',
  sourceFacts: 'ingest',
  mediaFacts: 'metadata',
  metadataFacts: 'metadata',
};

function getLibraryStore() {
  return require('./libraryStore');
}

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeFactGroup(value) {
  const raw = clean(value);
  return FACT_GROUPS.includes(raw) ? raw : '';
}

function normalizeStatus(value) {
  const raw = clean(value).toLowerCase();
  return STATUSES.has(raw) ? raw : 'unknown';
}

function defaultUpdatedAt(item = {}, factGroup = '') {
  switch (factGroup) {
    case 'basedataFacts':
      return clean(item.basedataUpdatedAt || item.updatedAt);
    case 'sourceFacts':
    case 'mediaFacts':
      return clean(item.lastRefreshedAt || item.metadataUpdatedAt || item.updatedAt);
    case 'metadataFacts':
      return clean(item.metadataUpdatedAt || item.lastRefreshedAt || item.updatedAt);
    case 'userPerceptionFacts':
      return clean(item.perceptionUpdatedAt || item.userRatingUpdatedAt || item.doubanRatingUpdatedAt || item.lastRefreshedAt);
    case 'gateFacts':
      return clean(item.archiveDoneAt || item.optimizationDoneAt || item.metadataUpdatedAt || item.lastRefreshedAt);
    default:
      return '';
  }
}

function normalizeEntry(entry = {}, item = {}, factGroup = '') {
  const group = normalizeFactGroup(entry.factGroup || factGroup);
  const status = normalizeStatus(entry.status);
  const updatedAt = clean(entry.updatedAt) || defaultUpdatedAt(item, group);
  const observedAt = clean(entry.observedAt) || updatedAt;
  const ownerGate = clean(entry.ownerGate) || OWNER_GATE_BY_GROUP[group] || '';
  const refreshTargetGate = clean(entry.refreshTargetGate) || (status === 'stale' || status === 'invalidated' ? REFRESH_TARGET_BY_GROUP[group] || '' : '');
  return {
    factGroup: group,
    status,
    ownerGate,
    updatedAt,
    observedAt,
    staleReason: clean(entry.staleReason),
    staleSource: clean(entry.staleSource),
    refreshTargetGate,
    refreshTaskId: clean(entry.refreshTaskId),
    evidence: entry.evidence && typeof entry.evidence === 'object' ? entry.evidence : {},
    createdAt: clean(entry.createdAt),
    rowUpdatedAt: clean(entry.rowUpdatedAt),
  };
}

function defaultEntry(item = {}, factGroup = '') {
  const group = normalizeFactGroup(factGroup);
  const updatedAt = defaultUpdatedAt(item, group);
  return normalizeEntry({
    factGroup: group,
    status: updatedAt ? 'fresh' : 'unknown',
    ownerGate: OWNER_GATE_BY_GROUP[group] || '',
    updatedAt,
    observedAt: updatedAt,
  }, item, group);
}

function explicitInvalidation(item = {}, targetGate = '') {
  const invalidations = item.gateInvalidations && typeof item.gateInvalidations === 'object'
    ? item.gateInvalidations
    : {};
  const direct = targetGate === 'ingest' ? item.ingestGateFailure : targetGate === 'metadata' ? item.metadataGateFailure : null;
  const invalidation = direct || invalidations[targetGate];
  if (!invalidation || typeof invalidation !== 'object' || invalidation.clearedAt) return null;
  return invalidation;
}

function applyLegacySignals(item = {}, projection = {}) {
  const sourceInvalidation = explicitInvalidation(item, 'ingest');
  if (sourceInvalidation) {
    projection.sourceFacts = normalizeEntry({
      factGroup: 'sourceFacts',
      status: 'invalidated',
      ownerGate: 'ingest',
      staleReason: sourceInvalidation.reason || 'ingest_gate_invalidated',
      staleSource: sourceInvalidation.sourceFlowKind || sourceInvalidation.sourceTaskId || 'gate_invalidation',
      refreshTargetGate: 'ingest',
      evidence: sourceInvalidation.evidence || sourceInvalidation,
      updatedAt: defaultUpdatedAt(item, 'sourceFacts'),
      observedAt: sourceInvalidation.invalidatedAt || sourceInvalidation.createdAt || '',
    }, item, 'sourceFacts');
  }

  const metadataInvalidation = explicitInvalidation(item, 'metadata');
  if (metadataInvalidation) {
    const entry = {
      status: 'invalidated',
      ownerGate: 'metadata',
      staleReason: metadataInvalidation.reason || 'metadata_gate_invalidated',
      staleSource: metadataInvalidation.sourceFlowKind || metadataInvalidation.sourceTaskId || 'gate_invalidation',
      refreshTargetGate: 'metadata',
      evidence: metadataInvalidation.evidence || metadataInvalidation,
      updatedAt: defaultUpdatedAt(item, 'metadataFacts'),
      observedAt: metadataInvalidation.invalidatedAt || metadataInvalidation.createdAt || '',
    };
    projection.mediaFacts = normalizeEntry({ ...entry, factGroup: 'mediaFacts' }, item, 'mediaFacts');
    projection.metadataFacts = normalizeEntry({ ...entry, factGroup: 'metadataFacts' }, item, 'metadataFacts');
  }
  return projection;
}

function projectForItem(item = {}, stored = null) {
  const storedMap = stored || (item.itemId ? getLibraryStore().getFactFreshnessForItem(item.itemId || '') : {});
  const projection = {};
  for (const group of FACT_GROUPS) {
    projection[group] = storedMap && storedMap[group]
      ? normalizeEntry(storedMap[group], item, group)
      : defaultEntry(item, group);
  }
  return applyLegacySignals(item, projection);
}

function decorateItem(item = {}) {
  if (!item || !item.itemId) return item;
  return {
    ...item,
    factsFreshness: projectForItem(item),
  };
}

function decorateItems(items = []) {
  const ids = (items || []).map((item) => item && item.itemId).filter(Boolean);
  const stored = getLibraryStore().getFactFreshnessForItems(ids);
  return (items || []).map((item) => {
    if (!item || !item.itemId) return item;
    return {
      ...item,
      factsFreshness: projectForItem(item, stored[item.itemId] || {}),
    };
  });
}

function upsert(itemId, factGroup, input = {}) {
  const group = normalizeFactGroup(factGroup);
  if (!group) throw new Error('Invalid factGroup');
  return normalizeEntry(getLibraryStore().upsertFactFreshness({
    itemId,
    factGroup: group,
    ownerGate: OWNER_GATE_BY_GROUP[group] || '',
    ...input,
  }), {}, group);
}

function markFresh(itemId, factGroups = [], input = {}) {
  const now = input.now || nowIso();
  const groups = (Array.isArray(factGroups) ? factGroups : [factGroups]).map(normalizeFactGroup).filter(Boolean);
  return groups.map((group) => upsert(itemId, group, {
    status: 'fresh',
    updatedAt: input.updatedAt || now,
    observedAt: input.observedAt || now,
    staleReason: '',
    staleSource: '',
    refreshTargetGate: '',
    refreshTaskId: '',
    evidence: input.evidence || {},
  }));
}

function markNeedsCheck(itemId, factGroups = [], input = {}) {
  const now = input.now || nowIso();
  const groups = (Array.isArray(factGroups) ? factGroups : [factGroups]).map(normalizeFactGroup).filter(Boolean);
  return groups.map((group) => upsert(itemId, group, {
    status: 'needs_check',
    observedAt: input.observedAt || now,
    staleReason: input.reason || 'soft_ttl_elapsed',
    staleSource: input.source || 'source_adapter',
    refreshTargetGate: '',
    evidence: input.evidence || {},
  }));
}

function markStale(itemId, factGroups = [], input = {}) {
  const now = input.now || nowIso();
  const groups = (Array.isArray(factGroups) ? factGroups : [factGroups]).map(normalizeFactGroup).filter(Boolean);
  return groups.map((group) => upsert(itemId, group, {
    status: input.status || 'stale',
    observedAt: input.observedAt || now,
    staleReason: input.reason || input.staleReason || 'facts_stale',
    staleSource: input.source || input.staleSource || '',
    refreshTargetGate: input.refreshTargetGate || REFRESH_TARGET_BY_GROUP[group] || '',
    refreshTaskId: input.refreshTaskId || '',
    evidence: input.evidence || {},
  }));
}

function isFresh(projection = {}, factGroup = '') {
  const group = normalizeFactGroup(factGroup);
  const entry = projection[group] || {};
  return entry.status === 'fresh' || entry.status === 'needs_check';
}

function isBlockingStale(projection = {}, factGroup = '') {
  const group = normalizeFactGroup(factGroup);
  const entry = projection[group] || {};
  return ['stale', 'invalidated', 'blocked', 'refreshing'].includes(entry.status);
}

module.exports = {
  FACT_GROUPS,
  OWNER_GATE_BY_GROUP,
  REFRESH_TARGET_BY_GROUP,
  projectForItem,
  decorateItem,
  decorateItems,
  markFresh,
  markNeedsCheck,
  markStale,
  upsert,
  isFresh,
  isBlockingStale,
};
