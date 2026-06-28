'use strict';

const PRIORITY_MODEL_VERSION = 'additive-v2';

/**
 * PriorityEngine — computes a task's initial `priority` value.
 *
 * Lower number = higher priority (runs first in the global task queue).
 *
 * Formula:
 *   priority = sum(source, actionType, subLibrary, matchedRules)
 *
 * Evaluation order:
 *   1. Add source, action type, and library dimensions.
 *   2. Advanced overlay rules (config.taskPriority.rules[actionType], ordered):
 *      each matching rule contributes a delta (subtract=add priority, add=defer).
 *   3. clamp to >= 0.
 *
 * Match conditions are AND-combined; any field left undefined does not
 * participate. Adding a new match field = one case in matchConditions(); the
 * evaluation loop does not change. This is the extensibility contract.
 */

/**
 * @param {object} params
 * @param {'manual'|'auto'} params.source       task origin
 * @param {string} params.actionType            transcode|upgrade|delete|scrape
 * @param {object} [params.itemInfo]            task.itemInfo (subLibraryId, type, ...)
 * @param {object} params.config                full config (taskPriority + subLibraries)
 * @returns {number}                            priority value (lower = first)
 */
function computePriority({ source, actionType, itemInfo, config }) {
  return explainPriority({ source, actionType, itemInfo, config }).priority;
}

function explainPriority({ source, actionType, itemInfo, config }) {
  const cfg = config && config.taskPriority || {};
  const manualBase = typeof cfg.manualTaskPriority === 'number' ? cfg.manualTaskPriority : 0;
  const autoBase = typeof cfg.autoTaskPriorityBase === 'number' ? cfg.autoTaskPriorityBase : 100;
  const actionWeights = cfg.actionTypeWeights || {};
  const actionWeight = typeof actionWeights[actionType] === 'number' ? actionWeights[actionType] : 0;

  // ── 1. source + action type + library dimensions ─────────────────────────
  const sourceWeight = source === 'manual' ? manualBase : autoBase;
  const libraryWeight = resolveLibraryWeight(itemInfo, config);
  const dimensions = [
    { key: 'source', label: source === 'manual' ? '手动来源' : '自动来源', value: sourceWeight },
    { key: 'actionType', label: '任务类型', actionType, value: actionWeight },
    { key: 'subLibrary', label: '子库权重', subLibraryId: itemInfo && itemInfo.subLibraryId || '', value: libraryWeight },
  ];

  // ── 2. advanced overlay rules (per actionType, ordered) ───────────────────
  const rules = ((cfg.rules || {})[actionType] || []);
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== 'object') continue;
    if (matchConditions(rule.match, itemInfo)) {
      const delta = computeAdjustDelta(rule.adjust);
      if (delta !== 0) {
        dimensions.push({
          key: 'rule',
          label: '高级规则',
          index,
          match: rule.match || {},
          adjust: normalizeAdjust(rule.adjust),
          value: delta,
        });
      }
    }
  }

  // ── 3. clamp ──────────────────────────────────────────────────────────────
  const raw = dimensions.reduce((sum, dim) => sum + dim.value, 0);
  return {
    modelVersion: PRIORITY_MODEL_VERSION,
    lowerIsEarlier: true,
    formula: 'source + actionType + subLibrary + matchedRules',
    dimensions,
    raw,
    priority: Math.max(0, Math.round(raw)),
  };
}

function resolveLibraryWeight(itemInfo, config) {
  const subLibId = itemInfo && itemInfo.subLibraryId;
  if (!subLibId) return 100;
  const subLib = (config && config.subLibraries || []).find((s) => s && s.uuid === subLibId);
  if (subLib && typeof subLib.priorityWeight === 'number') {
    return subLib.priorityWeight;
  }
  return 100;
}

/**
 * AND-combined matcher. Returns true if every defined condition matches.
 * Undefined/null conditions are skipped (do not constrain). This keeps the
 * function total even as new fields are added.
 */
function matchConditions(match, itemInfo) {
  if (!match || typeof match !== 'object') return true; // no conditions = always match
  const info = itemInfo || {};

  if (match.subLibraryId !== undefined && info.subLibraryId !== match.subLibraryId) return false;
  if (match.type !== undefined && info.type !== match.type) return false;
  if (match.isDiscLike !== undefined && !!info.isDiscLike !== !!match.isDiscLike) return false;
  if (match.isDolbyVision !== undefined && !!info.isDolbyVision !== !!match.isDolbyVision) return false;

  if (match.resolution !== undefined) {
    const r = String(info.resolution || '');
    if (!r.startsWith(String(match.resolution))) return false;
  }

  // Comparison operator for numeric fields (e.g. retryCount: { gte: 1 }).
  // Reserved for the future failure-backoff strategy; not enabled by default
  // config but the engine supports it.
  if (match.retryCount !== undefined) {
    if (!compareNumber(info.retryCount || 0, match.retryCount)) return false;
  }

  return true;
}

function compareNumber(actual, cond) {
  if (typeof cond === 'number') return actual === cond;
  if (cond && typeof cond === 'object') {
    if (cond.gte !== undefined && !(actual >= cond.gte)) return false;
    if (cond.lte !== undefined && !(actual <= cond.lte)) return false;
    if (cond.gt !== undefined && !(actual > cond.gt)) return false;
    if (cond.lt !== undefined && !(actual < cond.lt)) return false;
    return true;
  }
  return false;
}

function applyAdjust(current, adjust) {
  return current + computeAdjustDelta(adjust);
}

function normalizeAdjust(adjust) {
  const op = adjust && adjust.op === 'subtract' ? 'subtract' : 'add';
  const value = Number(adjust && adjust.value);
  return { op, value: Number.isFinite(value) ? value : 0 };
}

function computeAdjustDelta(adjust) {
  if (!adjust || typeof adjust !== 'object') return 0;
  const v = Number(adjust.value);
  if (!Number.isFinite(v)) return 0;
  switch (adjust.op) {
    case 'subtract': return -v; // smaller = higher priority
    case 'add': return v;      // larger = deferred
    default: return 0;
  }
}

module.exports = {
  computePriority,
  explainPriority,
  PRIORITY_MODEL_VERSION,
  // exported for unit testing
  _matchConditions: matchConditions,
  _applyAdjust: applyAdjust,
  _computeAdjustDelta: computeAdjustDelta,
};
