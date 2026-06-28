'use strict';

/**
 * PriorityEngine — computes a task's initial `priority` value.
 *
 * Lower number = higher priority (runs first within its actionType bucket).
 *
 * Evaluation order:
 *   1. base = source==='manual' ? manualTaskPriority
 *           : taskPriority.actionTypeWeights[actionType] || autoTaskPriorityBase
 *   2. Library weight: for auto tasks, take min(base, subLibrary.priorityWeight)
 *      so a library with a small weight lifts all its tasks ahead. Manual tasks
 *      ignore library weight and stay at manualTaskPriority.
 *   3. Advanced overlay rules (config.taskPriority.rules[actionType], ordered):
 *      each rule that matches adjusts the running value (subtract=add priority,
 *      add=defer, set=absolute band).
 *   4. clamp to >= 0.
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
  const cfg = config && config.taskPriority || {};
  const manualBase = typeof cfg.manualTaskPriority === 'number' ? cfg.manualTaskPriority : 0;
  const autoBase = typeof cfg.autoTaskPriorityBase === 'number' ? cfg.autoTaskPriorityBase : 100;
  const actionWeights = cfg.actionTypeWeights || {};
  const actionBase = typeof actionWeights[actionType] === 'number' ? actionWeights[actionType] : autoBase;

  // ── 1-2. base + library weight ────────────────────────────────────────────
  let value;
  if (source === 'manual') {
    value = manualBase;
  } else {
    const weight = resolveLibraryWeight(itemInfo, config);
    // A library weight smaller than the action base lifts the task; a larger one
    // is ignored. Missing library weight leaves the action base untouched.
    value = typeof weight === 'number' ? Math.min(actionBase, weight) : actionBase;
  }

  // ── 3. advanced overlay rules (per actionType, ordered) ───────────────────
  const rules = ((cfg.rules || {})[actionType] || []);
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (matchConditions(rule.match, itemInfo)) {
      value = applyAdjust(value, rule.adjust);
    }
  }

  // ── 4. clamp ──────────────────────────────────────────────────────────────
  return Math.max(0, Math.round(value));
}

function resolveLibraryWeight(itemInfo, config) {
  const subLibId = itemInfo && itemInfo.subLibraryId;
  if (!subLibId) return null;
  const subLib = (config && config.subLibraries || []).find((s) => s && s.uuid === subLibId);
  if (subLib && typeof subLib.priorityWeight === 'number') {
    return subLib.priorityWeight;
  }
  return null;
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
  if (!adjust || typeof adjust !== 'object') return current;
  const v = Number(adjust.value);
  if (!Number.isFinite(v)) return current;
  switch (adjust.op) {
    case 'subtract': return current - v;  // smaller = higher priority
    case 'add':      return current + v;  // larger = deferred
    case 'set':      return v;            // absolute band
    default:         return current;
  }
}

module.exports = {
  computePriority,
  // exported for unit testing
  _matchConditions: matchConditions,
  _applyAdjust: applyAdjust,
};
