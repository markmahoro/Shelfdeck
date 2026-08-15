'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const POLICY_ID = 'arca-offdeck-system-policy';
const POLICY_SCHEMA_REF = 'helix://arca/types/OffdeckPolicySet/v1';
const CONDITION_KINDS = Object.freeze([
  'rating_and_collection_age',
  'disliked_person',
  'unresolved_care',
  'retention_age',
]);
const REVIEW_STATES = Object.freeze([
  'preparing', 'open', 'selection_confirmed', 'awaiting_escalation',
  'authorized', 'cancelled', 'stale',
]);
const CASE_STATES = Object.freeze([
  'executing', 'blocked', 'awaiting_reauthorization', 'completed',
]);
const CAPABILITY_REFS = Object.freeze({
  duplicateDetect:'arca.offdeck.duplicate.detect@1',
  duplicateCommit:'arca.offdeck.duplicate_group.commit@1',
  candidateCommit:'arca.offdeck.review_candidate.commit@1',
  scopeVerify:'arca.offdeck.destruction_scope.verify@1',
  primaryDelete:'arca.offdeck.primary_material.delete@1',
  relatedRelease:'arca.offdeck.related_reference.release@1',
  relatedDelete:'arca.offdeck.unreferenced_related.delete@1',
  deletionVerify:'arca.offdeck.deletion.verify@1',
  terminalCommit:'arca.offdeck.terminal.commit@1',
});

class OffdeckContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OffdeckContractError';
    this.code = code;
  }
}

function fail(code, message) { throw new OffdeckContractError(code, message); }
function frozen(value) { return Object.freeze(value); }
function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }

function defaultPolicy(nowMs = 0) {
  const basis = {
    schemaRef: POLICY_SCHEMA_REF,
    schemaVersion: 1,
    policyId: POLICY_ID,
    revision: 1,
    status: 'disabled',
    duplicateScheduleEnabled: false,
    entryRules: frozen([]),
    effectiveAtMs: nowMs,
  };
  return frozen({ ...basis, policyDigest: canonicalDigest(basis) });
}

function normalizeCondition(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) {
    fail('ARCA_OFFDECK_POLICY_CONDITION_INVALID', 'Off-deck condition is invalid.');
  }
  if (value.kind === 'all' || value.kind === 'any') {
    if (!Array.isArray(value.conditions) || value.conditions.length < 1 ||
        value.conditions.length > 8) {
      fail('ARCA_OFFDECK_POLICY_CONDITION_INVALID', 'Off-deck condition group is invalid.');
    }
    return frozen({
      kind: value.kind,
      conditions: frozen(value.conditions.map((item) => normalizeCondition(item, depth + 1))),
    });
  }
  if (!CONDITION_KINDS.includes(value.kind)) {
    fail('ARCA_OFFDECK_POLICY_CONDITION_INVALID', 'Off-deck condition kind is not supported.');
  }
  const parameters = value.parameters && typeof value.parameters === 'object' &&
    !Array.isArray(value.parameters) ? { ...value.parameters } : {};
  const finite = (name, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
    const number = Number(parameters[name]);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      fail('ARCA_OFFDECK_POLICY_CONDITION_INVALID', `Off-deck condition ${name} is invalid.`);
    }
    return number;
  };
  if (value.kind === 'rating_and_collection_age') {
    parameters.maxRating = finite('maxRating', 1, 5);
    parameters.minimumAgeDays = finite('minimumAgeDays', 0);
  } else if (value.kind === 'disliked_person') {
    parameters.maximumPreferenceLevel = finite('maximumPreferenceLevel', -2, 2);
  } else {
    parameters.minimumAgeDays = finite('minimumAgeDays', 0);
  }
  return frozen({ kind: value.kind, parameters: frozen(parameters) });
}

function normalizePolicy(input, current, nowMs) {
  if (!current || input?.expectedRevision !== current.revision ||
      typeof input?.idempotencyKey !== 'string' || !input.idempotencyKey) {
    fail('ARCA_OFFDECK_POLICY_STALE', 'Off-deck Policy expected revision is stale.');
  }
  const entryRules = input.entryRules || [];
  if (!Array.isArray(entryRules) || entryRules.length > 64) {
    fail('ARCA_OFFDECK_POLICY_RULE_LIMIT', 'Off-deck Policy supports at most 64 Entry rules.');
  }
  const normalizedRules = entryRules.map((rule, ordinal) => {
    if (!rule || typeof rule !== 'object') {
      fail('ARCA_OFFDECK_POLICY_RULE_INVALID', 'Off-deck Policy rule is invalid.');
    }
    const shelfIds = rule.shelfScope === 'all' ? [] : [...new Set(rule.shelfIds || [])].sort();
    if (rule.shelfScope !== 'all' && (rule.shelfScope !== 'selected' || shelfIds.length < 1)) {
      fail('ARCA_OFFDECK_POLICY_SHELF_SCOPE_INVALID', 'Off-deck Policy Shelf scope is invalid.');
    }
    return frozen({
      ruleId: rule.ruleId || stable('arca-offdeck-rule-', { ordinal, rule }),
      ordinal,
      shelfScope: rule.shelfScope,
      shelfIds: frozen(shelfIds),
      condition: normalizeCondition(rule.condition),
    });
  });
  const basis = {
    schemaRef: POLICY_SCHEMA_REF,
    schemaVersion: 1,
    policyId: current.policyId,
    revision: current.revision + 1,
    status: input.status === 'active' ? 'active' : 'disabled',
    duplicateScheduleEnabled: input.duplicateScheduleEnabled === true,
    entryRules: frozen(normalizedRules),
    effectiveAtMs: nowMs,
  };
  return frozen({ ...basis, policyDigest: canonicalDigest(basis) });
}

function triAnd(values) {
  if (values.includes(false)) return false;
  return values.includes('unknown') ? 'unknown' : true;
}
function triOr(values) {
  if (values.includes(true)) return true;
  return values.includes('unknown') ? 'unknown' : false;
}

function evaluateCondition(condition, facts) {
  if (condition.kind === 'all' || condition.kind === 'any') {
    const values = condition.conditions.map((item) => evaluateCondition(item, facts));
    return condition.kind === 'all' ? triAnd(values) : triOr(values);
  }
  const p = condition.parameters || {};
  if (condition.kind === 'rating_and_collection_age') {
    if (!Number.isInteger(facts.rating) || !Number.isFinite(facts.collectionAgeDays)) return 'unknown';
    return facts.rating <= Number(p.maxRating) && facts.collectionAgeDays >= Number(p.minimumAgeDays);
  }
  if (condition.kind === 'disliked_person') {
    if (!Array.isArray(facts.peoplePreferences) || facts.peoplePreferences.length === 0) return 'unknown';
    return facts.peoplePreferences.some((item) => item.preferenceLevel <= Number(p.maximumPreferenceLevel ?? -1));
  }
  if (condition.kind === 'unresolved_care') {
    if (!facts.care) return 'unknown';
    return facts.care.state === 'attention_required' &&
      Number(facts.care.ageDays) >= Number(p.minimumAgeDays);
  }
  if (!Number.isFinite(facts.collectionAgeDays)) return 'unknown';
  return facts.collectionAgeDays >= Number(p.minimumAgeDays);
}

function evaluateEntryPolicy(policy, entryFacts) {
  if (policy.status !== 'active') return frozen({ result: false, matchedRuleId: null, evidence: frozen([]) });
  for (const rule of policy.entryRules) {
    if (rule.shelfScope === 'selected' && !rule.shelfIds.includes(entryFacts.shelfId)) continue;
    const result = evaluateCondition(rule.condition, entryFacts);
    if (result === 'unknown') return frozen({ result: 'unknown', matchedRuleId: rule.ruleId, evidence: frozen([]) });
    if (result === true) return frozen({ result: true, matchedRuleId: rule.ruleId, evidence: frozen([]) });
  }
  return frozen({ result: false, matchedRuleId: null, evidence: frozen([]) });
}

function highVolumeDecision(metrics) {
  const shelfCoverage = Object.values(metrics.shelfCoverageRatios || {});
  const reasons = [];
  if (metrics.entryCount >= 10) reasons.push('entry_count');
  if (metrics.primaryCount >= 50) reasons.push('primary_count');
  if (metrics.totalBytes >= 100 * 1024 ** 3) reasons.push('total_bytes');
  if (metrics.entryCount >= 5 && shelfCoverage.some((value) => value >= 0.2)) reasons.push('shelf_coverage');
  if (metrics.entryCount >= 5 && metrics.deckCoverageRatio >= 0.1) reasons.push('deck_coverage');
  return frozen({ highVolume: reasons.length > 0, reasons: frozen(reasons) });
}

module.exports = Object.freeze({
  POLICY_ID,
  POLICY_SCHEMA_REF,
  REVIEW_STATES,
  CASE_STATES,
  CAPABILITY_REFS,
  OffdeckContractError,
  defaultPolicy,
  normalizePolicy,
  evaluateCondition,
  evaluateEntryPolicy,
  highVolumeDecision,
  stable,
});
