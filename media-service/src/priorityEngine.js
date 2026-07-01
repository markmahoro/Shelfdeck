'use strict';

const PRIORITY_MODEL_VERSION = 'additive-v3';
const TASK_PRIORITY_MODEL_VERSION = 'kairox-task-creator-v1';

/**
 * PriorityEngine — computes a task's initial `priority` value.
 *
 * Lower number = higher priority (runs first in the global task queue).
 *
 * Formula:
 *   priority = sum(source, operationKind, subLibrary, businessSignal, queueAge, retry, matchedRules)
 *
 * Evaluation order:
 *   1. Add source, operation kind, library, business signal, queue age, and retry dimensions.
 *   2. Advanced overlay rules (config.taskPriority.rules[operationKind], ordered):
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
 * @param {string} params.operationKind            transcode|upgrade|delete|scrape
 * @param {object} [params.itemInfo]            task.itemInfo (subLibraryId, type, ...)
 * @param {object} [params.task]                optional queued task context (createdAt, retryCount)
 * @param {object} params.config                full config (taskPriority + subLibraries)
 * @returns {number}                            priority value (lower = first)
 */
function computePriority({ source, operationKind, itemInfo, config, task }) {
  return explainPriority({ source, operationKind, itemInfo, config, task }).priority;
}

function explainTaskPriority({ source, taskTarget, itemInfo, config, task, operationKind }) {
  const cfg = config && config.taskPriority || {};
  const manualBase = typeof cfg.manualTaskPriority === 'number' ? cfg.manualTaskPriority : 0;
  const autoBase = typeof cfg.autoTaskPriorityBase === 'number' ? cfg.autoTaskPriorityBase : 100;
  const context = buildTaskContext({ itemInfo, task, taskTarget, operationKind });

  const targetGateWeights = cfg.targetGateWeights || {};
  const legacyActionWeights = cfg.operationKindWeights || {};
  const targetGate = context.targetGate || targetGateForAction(context.operationKind);
  const operationHint = context.operationHint || operationHintForAction(context.operationKind);
  const targetGateWeight = typeof targetGateWeights[targetGate] === 'number'
    ? targetGateWeights[targetGate]
    : legacyTargetGateWeight(targetGate, legacyActionWeights);
  const optimizeOperationHints = cfg.optimizeOperationHints || {};
  const operationHintWeight = targetGate === 'optimize'
    ? (typeof optimizeOperationHints[operationHint] === 'number'
      ? optimizeOperationHints[operationHint]
      : legacyOptimizeOperationHint(operationHint, legacyActionWeights, targetGateWeight))
    : 0;

  const sourceWeight = source === 'manual' ? manualBase : autoBase;
  const libraryWeight = resolveLibraryWeight(context, config);
  const businessSignalWeight = computeBusinessSignalDelta(operationHint || context.operationKind || targetGate, context, cfg);
  const queueAgeWeight = computeQueueAgeDelta(context, cfg);
  const retryWeight = computeRetryDelta(context, cfg);
  const dimensions = [
    { key: 'source', label: source === 'manual' ? '手动来源' : '自动来源', value: sourceWeight },
    { key: 'targetGate', label: '目标 Gate', targetGate, value: targetGateWeight },
  ];
  if (operationHintWeight !== 0) {
    dimensions.push({ key: 'optimizeOperationHint', label: '优化路径提示', operationHint, value: operationHintWeight });
  }
  dimensions.push({ key: 'subLibrary', label: '子库权重', subLibraryId: context.subLibraryId || '', value: libraryWeight });
  if (businessSignalWeight !== 0) {
    dimensions.push({ key: 'businessSignal', label: '业务信号', targetGate, operationHint, value: businessSignalWeight });
  }
  if (queueAgeWeight !== 0) {
    dimensions.push({ key: 'queueAge', label: '等待时间', createdAt: context.createdAt || '', value: queueAgeWeight });
  }
  if (retryWeight !== 0) {
    dimensions.push({ key: 'retry', label: '重试惩罚', retryCount: context.retryCount || 0, value: retryWeight });
  }

  for (const [index, rule] of taskPriorityRules(cfg, targetGate, operationHint).entries()) {
    if (!rule || typeof rule !== 'object') continue;
    if (matchConditions(rule.match, context)) {
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

  const raw = dimensions.reduce((sum, dim) => sum + dim.value, 0);
  return {
    modelVersion: TASK_PRIORITY_MODEL_VERSION,
    lowerIsEarlier: true,
    formula: 'source + targetGate + optimizeOperationHint + subLibrary + businessSignal + queueAge + retry + matchedRules',
    targetGate,
    operationHint,
    dimensions,
    raw,
    priority: Math.max(0, Math.round(raw)),
  };
}

function explainPriority({ source, operationKind, itemInfo, config, task }) {
  const cfg = config && config.taskPriority || {};
  const manualBase = typeof cfg.manualTaskPriority === 'number' ? cfg.manualTaskPriority : 0;
  const autoBase = typeof cfg.autoTaskPriorityBase === 'number' ? cfg.autoTaskPriorityBase : 100;
  const actionWeights = cfg.operationKindWeights || {};
  const actionWeight = typeof actionWeights[operationKind] === 'number' ? actionWeights[operationKind] : 0;
  const context = buildContext(itemInfo, task);

  // ── 1. source + operation kind + library + dynamic queue dimensions ───────
  const sourceWeight = source === 'manual' ? manualBase : autoBase;
  const libraryWeight = resolveLibraryWeight(context, config);
  const businessSignalWeight = computeBusinessSignalDelta(operationKind, context, cfg);
  const queueAgeWeight = computeQueueAgeDelta(context, cfg);
  const retryWeight = computeRetryDelta(context, cfg);
  const dimensions = [
    { key: 'source', label: source === 'manual' ? '手动来源' : '自动来源', value: sourceWeight },
    { key: 'operationKind', label: '任务类型', operationKind, value: actionWeight },
    { key: 'subLibrary', label: '子库权重', subLibraryId: context.subLibraryId || '', value: libraryWeight },
  ];
  if (businessSignalWeight !== 0) {
    dimensions.push({ key: 'businessSignal', label: '业务信号', operationKind, value: businessSignalWeight });
  }
  if (queueAgeWeight !== 0) {
    dimensions.push({ key: 'queueAge', label: '等待时间', createdAt: context.createdAt || '', value: queueAgeWeight });
  }
  if (retryWeight !== 0) {
    dimensions.push({ key: 'retry', label: '重试惩罚', retryCount: context.retryCount || 0, value: retryWeight });
  }

  // ── 2. advanced overlay rules (per operationKind, ordered) ───────────────────
  const rules = ((cfg.rules || {})[operationKind] || []);
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== 'object') continue;
    if (matchConditions(rule.match, context)) {
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
    formula: 'source + operationKind + subLibrary + businessSignal + queueAge + retry + matchedRules',
    dimensions,
    raw,
    priority: Math.max(0, Math.round(raw)),
  };
}

function buildContext(itemInfo, task) {
  const info = itemInfo && typeof itemInfo === 'object' ? itemInfo : {};
  const t = task && typeof task === 'object' ? task : {};
  return {
    ...info,
    createdAt: t.createdAt || info.createdAt,
    retryCount: t.retryCount !== undefined ? t.retryCount : info.retryCount,
  };
}

function buildTaskContext({ itemInfo, task, taskTarget, operationKind }) {
  const context = buildContext(itemInfo, task);
  const target = taskTarget && typeof taskTarget === 'object' ? taskTarget : {};
  const inferredAction = operationKind || target.operationHint || context.operationKind;
  return {
    ...context,
    operationKind: inferredAction,
    targetGate: target.targetGate || targetForAction(inferredAction),
    gateObjective: target.gateObjective || context.gateObjective || {},
    operationHint: target.operationHint || operationHintForAction(inferredAction),
  };
}

function targetForAction(operationKind) {
  const action = String(operationKind || '').trim().toLowerCase();
  if (action === 'ingest') return 'ingest';
  if (action === 'scrape' || action === 'metadata') return 'metadata';
  if (action === 'archive') return 'archive';
  if (action === 'delete') return 'delete';
  if (action === 'transcode' || action === 'upgrade') return 'optimize';
  return action || '';
}

function operationHintForAction(operationKind) {
  return String(operationKind || '').trim().toLowerCase();
}

function legacyTargetGateWeight(targetGate, actionWeights = {}) {
  if (targetGate === 'ingest') return numberOr(actionWeights.ingest, 60);
  if (targetGate === 'metadata') return numberOr(actionWeights.scrape, 80);
  if (targetGate === 'archive') return numberOr(actionWeights.archive, 70);
  if (targetGate === 'delete') return numberOr(actionWeights.delete, 90);
  if (targetGate === 'optimize') {
    const values = ['transcode', 'upgrade']
      .map((key) => Number(actionWeights[key]))
      .filter(Number.isFinite);
    if (values.length) return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return 110;
  }
  return 0;
}

function legacyOptimizeOperationHint(operationHint, actionWeights = {}, targetGateWeight = 0) {
  const actionWeight = Number(actionWeights[operationHint]);
  if (Number.isFinite(actionWeight)) return actionWeight - targetGateWeight;
  return 0;
}

function taskPriorityRules(cfg, targetGate, operationHint) {
  if (cfg.rulesByTargetGate && Array.isArray(cfg.rulesByTargetGate[targetGate])) {
    return cfg.rulesByTargetGate[targetGate];
  }
  const legacyRules = cfg.rules || {};
  if (targetGate === 'metadata') return legacyRules.scrape || [];
  if (targetGate === 'ingest') return legacyRules.ingest || [];
  if (targetGate === 'archive') return legacyRules.archive || [];
  if (targetGate === 'delete') return legacyRules.delete || [];
  if (targetGate === 'optimize') return legacyRules[operationHint] || [];
  return [];
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

function computeBusinessSignalDelta(operationKind, itemInfo, cfg) {
  const weights = cfg.businessSignalWeights || {};
  const adultWorkflowBonus = numberOr(weights.adultWorkflowBonus, 20);
  const maxTranscodeSavingBonus = numberOr(weights.maxTranscodeSavingBonus, 30);
  const info = itemInfo || {};
  const meta = info.adultMetadata || {};

  if (operationKind === 'ingest') {
    if (info.source === 'adult_folder' || info.mediaType === 'adult' || meta.region) {
      return -adultWorkflowBonus;
    }
    return 0;
  }

  if (operationKind === 'scrape') {
    const scrapeStatus = String(meta.scrapeStatus || '').toLowerCase();
    if (info.scraped === false || scrapeStatus === '' || scrapeStatus === 'pending') {
      return -adultWorkflowBonus;
    }
    return 0;
  }

  if (operationKind === 'transcode') {
    const bitrate = Number(info.equivalentBitrate || info.bitrate || 0);
    const target = Number(info.targetBitrate || 0);
    const size = Number(info.size || info.originalSizeBytes || 0);
    let bonus = 0;
    if (bitrate > 0 && target > 0 && bitrate > target) {
      bonus += Math.min(maxTranscodeSavingBonus, Math.floor((bitrate - target) / Math.max(target, 1) * maxTranscodeSavingBonus));
    }
    const gb = size / (1024 * 1024 * 1024);
    if (gb >= 50) bonus += 20;
    else if (gb >= 20) bonus += 10;
    return -Math.min(maxTranscodeSavingBonus, bonus);
  }

  return 0;
}

function computeQueueAgeDelta(itemInfo, cfg) {
  const createdMs = Date.parse(itemInfo && itemInfo.createdAt || '');
  if (!Number.isFinite(createdMs)) return 0;
  const ageMs = Date.now() - createdMs;
  if (ageMs <= 0) return 0;
  const stepMinutes = Math.max(1, numberOr(cfg.queueAgeStepMinutes, 60));
  const bonusPerStep = Math.max(0, numberOr(cfg.queueAgeBonusPerStep, 2));
  const maxBonus = Math.max(0, numberOr(cfg.maxQueueAgeBonus, 40));
  const steps = Math.floor(ageMs / (stepMinutes * 60 * 1000));
  return -Math.min(maxBonus, steps * bonusPerStep);
}

function computeRetryDelta(itemInfo, cfg) {
  const retryCount = Math.max(0, Number.parseInt(itemInfo && itemInfo.retryCount, 10) || 0);
  if (retryCount <= 0) return 0;
  const penalty = Math.max(0, numberOr(cfg.retryPenalty, 20));
  const maxPenalty = Math.max(0, numberOr(cfg.maxRetryPenalty, 80));
  return Math.min(maxPenalty, retryCount * penalty);
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
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
  if (match.targetGate !== undefined && info.targetGate !== match.targetGate) return false;
  if (match.operationHint !== undefined && info.operationHint !== match.operationHint) return false;
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
  explainTaskPriority,
  PRIORITY_MODEL_VERSION,
  TASK_PRIORITY_MODEL_VERSION,
  // exported for unit testing
  _matchConditions: matchConditions,
  _applyAdjust: applyAdjust,
  _computeAdjustDelta: computeAdjustDelta,
};
