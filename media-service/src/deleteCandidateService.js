'use strict';

const configStore = require('./configStore');
const libraryStore = require('./libraryStore');
const userPerceptionManagement = require('./userPerceptionManagement');
const lifecycleProjection = require('./lifecycleProjection');

function nowIso() {
  return new Date().toISOString();
}

function daysBetween(from, to = Date.now()) {
  const at = from ? new Date(from).getTime() : 0;
  if (!Number.isFinite(at) || at <= 0) return 0;
  return Math.max(0, Math.floor((to - at) / 86400000));
}

function isArchived(item = {}) {
  const archiveStatus = String(item.archiveStatus || '').toLowerCase();
  return archiveStatus === 'archived' || archiveStatus === 'archived_like' || item.lifecycleDone === true || !!item.archiveDoneAt;
}

function perceptionRating(item = {}) {
  const facts = userPerceptionManagement.resolvePerceptionFacts(item, { bump: false });
  const n = Number(facts.rating);
  return Number.isFinite(n) ? n : null;
}

function normalizeRules(policy = {}) {
  return Array.isArray(policy.rules) ? policy.rules.filter((rule) => rule && typeof rule === 'object') : [];
}

function matchRule(item = {}, rule = {}, nowMs = Date.now()) {
  if (rule.enabled === false) return null;
  const archivedAt = item.archiveDoneAt || item.optimizationDoneAt || item.lastRefreshedAt || '';
  const archivedForDays = daysBetween(archivedAt, nowMs);
  const minArchivedDays = Number(rule.archivedForDays || rule.minArchivedDays || 0);
  if (Number.isFinite(minArchivedDays) && archivedForDays < minArchivedDays) return null;

  const rating = perceptionRating(item);
  const maxRating = rule.ratingLte ?? rule.maxRating ?? rule.ratingMax;
  if (maxRating !== undefined && maxRating !== null && maxRating !== '') {
    const threshold = Number(maxRating);
    if (!Number.isFinite(threshold) || rating == null || rating > threshold) return null;
  }

  const minRating = rule.ratingGte ?? rule.minRating ?? rule.ratingMin;
  if (minRating !== undefined && minRating !== null && minRating !== '') {
    const threshold = Number(minRating);
    if (!Number.isFinite(threshold) || rating == null || rating < threshold) return null;
  }

  if (rule.subLibraryId && String(item.subLibraryId || '') !== String(rule.subLibraryId)) return null;
  if (rule.mediaType && String(item.mediaType || item.type || '') !== String(rule.mediaType)) return null;

  return {
    ruleId: String(rule.id || rule.name || 'delete-policy'),
    ruleName: String(rule.name || rule.id || 'Delete policy'),
    archivedForDays,
    rating,
    archivedAt,
  };
}

function candidateStatus(item = {}, matched = null, nowMs = Date.now()) {
  const existing = item.deleteCandidate && typeof item.deleteCandidate === 'object' ? item.deleteCandidate : {};
  if (existing.candidateStatus === 'suppressed') return 'suppressed';
  if (existing.candidateStatus === 'kept_archived') return 'kept_archived';
  if (existing.candidateStatus === 'confirmed') return 'confirmed';
  if (existing.candidateStatus === 'deleted') return 'deleted';
  if (existing.candidateStatus === 'snoozed') {
    const until = existing.snoozedUntil ? new Date(existing.snoozedUntil).getTime() : 0;
    if (Number.isFinite(until) && until > nowMs) return 'snoozed';
  }
  return matched ? 'pending_review' : '';
}

function buildCandidate(item = {}, ruleMatch = {}, status = 'pending_review', opts = {}) {
  const existing = item.deleteCandidate && typeof item.deleteCandidate === 'object' ? item.deleteCandidate : {};
  const now = opts.now || nowIso();
  const eligibleAt = ruleMatch.archivedAt
    ? new Date(new Date(ruleMatch.archivedAt).getTime() + Number(ruleMatch.archivedForDays || 0) * 86400000).toISOString()
    : now;
  return {
    itemId: item.itemId || '',
    itemName: item.name || '',
    subLibraryId: item.subLibraryId || '',
    candidateStatus: status,
    eligibilityReason: ruleMatch.ruleId ? 'delete_policy_matched' : (existing.eligibilityReason || ''),
    matchedRule: ruleMatch.ruleId ? ruleMatch : (existing.matchedRule || null),
    archivedAt: ruleMatch.archivedAt || item.archiveDoneAt || '',
    eligibleAt,
    decision: existing.decision || '',
    decisionAt: existing.decisionAt || '',
    snoozedUntil: existing.snoozedUntil || '',
    taskId: existing.taskId || '',
    updatedAt: existing.updatedAt || now,
  };
}

function evaluateItem(item = {}, config = {}, opts = {}) {
  if (!isArchived(item)) return null;
  const policy = config.deleteGatePolicy || {};
  if (policy.enabled !== true) return null;
  const nowMs = opts.nowMs || Date.now();
  let matched = null;
  for (const rule of normalizeRules(policy)) {
    matched = matchRule(item, rule, nowMs);
    if (matched) break;
  }
  const status = candidateStatus(item, matched, nowMs);
  if (!status) return null;
  return buildCandidate(item, matched || {}, status, opts);
}

function listCandidates(opts = {}) {
  const config = opts.config || configStore.loadConfig();
  const lib = libraryStore.loadLibrary();
  const includeDecided = !!opts.includeDecided;
  const candidates = [];
  for (const raw of lib.items || []) {
    const item = lifecycleProjection.decorateItem(userPerceptionManagement.decorateItem(raw), config);
    const candidate = evaluateItem(item, config, opts);
    if (!candidate) continue;
    if (!includeDecided && !['pending_review', 'confirmed'].includes(candidate.candidateStatus)) continue;
    candidates.push(candidate);
  }
  candidates.sort((a, b) => String(a.eligibleAt || '').localeCompare(String(b.eligibleAt || '')));
  return { candidates, total: candidates.length };
}

function updateCandidateDecision(itemId, patch = {}) {
  const item = libraryStore.getItem(itemId);
  if (!item) return null;
  const now = nowIso();
  const existing = item.deleteCandidate && typeof item.deleteCandidate === 'object' ? item.deleteCandidate : {};
  item.deleteCandidate = {
    ...existing,
    itemId,
    ...patch,
    decisionAt: patch.decisionAt || now,
    updatedAt: now,
  };
  libraryStore.updateItems([item]);
  return item.deleteCandidate;
}

function confirmDelete(itemId) {
  return updateCandidateDecision(itemId, {
    candidateStatus: 'confirmed',
    decision: 'confirm_delete',
  });
}

function keepArchived(itemId) {
  return updateCandidateDecision(itemId, {
    candidateStatus: 'kept_archived',
    decision: 'keep_archived',
  });
}

function snooze(itemId, opts = {}) {
  const days = Number(opts.days || opts.snoozeDays || 30);
  const snoozedUntil = new Date(Date.now() + Math.max(1, Number.isFinite(days) ? days : 30) * 86400000).toISOString();
  return updateCandidateDecision(itemId, {
    candidateStatus: 'snoozed',
    decision: 'snooze',
    snoozedUntil,
  });
}

function suppress(itemId) {
  return updateCandidateDecision(itemId, {
    candidateStatus: 'suppressed',
    decision: 'suppress',
  });
}

function attachTask(itemId, taskId) {
  return updateCandidateDecision(itemId, {
    candidateStatus: 'confirmed',
    decision: 'confirm_delete',
    taskId,
  });
}

module.exports = {
  evaluateItem,
  listCandidates,
  confirmDelete,
  keepArchived,
  snooze,
  suppress,
  attachTask,
};
