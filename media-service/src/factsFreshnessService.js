'use strict';

const FACT_GROUPS = ['basedataFacts', 'metadataFacts', 'userPerceptionFacts', 'gateFacts'];
const BLOCKING_STATUSES = new Set(['stale', 'blocked', 'invalidated', 'refreshing']);

function entry(factGroup, status, updatedAt = '', staleReason = '') {
  return {
    factGroup,
    status,
    ownerGate: factGroup === 'basedataFacts' ? 'basedata' : factGroup === 'metadataFacts' ? 'metadata' : factGroup === 'gateFacts' ? 'lifecycle' : 'perception',
    updatedAt: String(updatedAt || ''),
    observedAt: String(updatedAt || ''),
    staleReason: String(staleReason || ''),
    refreshTargetGate: BLOCKING_STATUSES.has(status)
      ? factGroup === 'basedataFacts' ? 'basedata' : factGroup === 'metadataFacts' ? 'metadata' : ''
      : '',
    evidence: {},
  };
}

function projectForItem(item = {}) {
  const explicit = item.factsFreshness && typeof item.factsFreshness === 'object' ? item.factsFreshness : {};
  const basedataStatus = explicit.basedataFacts && explicit.basedataFacts.status
    || (item.basedataComplete ? 'fresh' : 'missing');
  const metadataStatus = explicit.metadataFacts && explicit.metadataFacts.status
    || (item.metadataComplete ? 'fresh' : 'missing');
  const perceptionStatus = explicit.userPerceptionFacts && explicit.userPerceptionFacts.status
    || (item.userPerceptionFacts && Object.keys(item.userPerceptionFacts).length > 0 ? 'fresh' : 'missing');
  return {
    basedataFacts: explicit.basedataFacts || entry('basedataFacts', basedataStatus, item.basedataUpdatedAt),
    metadataFacts: explicit.metadataFacts || entry('metadataFacts', metadataStatus, item.metadataUpdatedAt),
    userPerceptionFacts: explicit.userPerceptionFacts || entry('userPerceptionFacts', perceptionStatus, item.perceptionUpdatedAt),
    gateFacts: explicit.gateFacts || entry('gateFacts', 'fresh', item.updatedAt),
  };
}

function normalizeGroup(factGroup) {
  return FACT_GROUPS.includes(String(factGroup || '')) ? String(factGroup) : '';
}

function isFresh(projection = {}, factGroup) {
  const group = normalizeGroup(factGroup);
  return !!group && projection[group] && projection[group].status === 'fresh';
}

function isBlockingStale(projection = {}, factGroup) {
  const group = normalizeGroup(factGroup);
  return !!group && projection[group] && BLOCKING_STATUSES.has(String(projection[group].status || ''));
}

function decorateItem(item = {}) {
  return { ...item, factsFreshness: projectForItem(item) };
}

function decorateItems(items = []) { return items.map(decorateItem); }

module.exports = { FACT_GROUPS, projectForItem, isFresh, isBlockingStale, decorateItem, decorateItems };
