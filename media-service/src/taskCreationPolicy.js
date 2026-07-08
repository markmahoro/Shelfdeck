'use strict';

const crypto = require('crypto');
const automationPolicy = require('./automationPolicy');
const factsFreshnessService = require('./factsFreshnessService');
const mediaFreeze = require('./mediaFreeze');

const TERMINAL = new Set(['done', 'failed_hard', 'failed_soft', 'cancelled', 'skipped', 'deleted']);
const ATTEMPT_FAILURE_STATUSES = new Set(['failed_hard', 'failed_soft', 'interrupted']);

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function taskTargetGate(task = {}) {
  return cleanToken(
    task.taskTarget && task.taskTarget.targetGate
    || task.targetGate
    || task.taskBridge && task.taskBridge.kind
    || task.flowPlan && task.flowPlan.bridgeKind
    || '',
  );
}

function activeTaskForItemTarget(tasks, itemId, targetGate) {
  return (tasks || []).find((task) => (
    task
    && task.itemId === itemId
    && !TERMINAL.has(task.status)
    && taskTargetGate(task) === targetGate
  ));
}

function targetCooldownMs(config = {}, targetGate = '') {
  const cfg = config.taskAdmission || {};
  const byTarget = cfg.cooldownHoursByTargetGate || {};
  const hours = typeof byTarget[targetGate] === 'number'
    ? byTarget[targetGate]
    : (typeof cfg.defaultCooldownHours === 'number' ? cfg.defaultCooldownHours : 48);
  return Math.max(0, hours) * 3600 * 1000;
}

function lastTerminalTaskAt(tasks, itemId, targetGate) {
  if (!itemId) return null;
  let latest = null;
  for (const task of tasks || []) {
    if (!task || task.itemId !== itemId || taskTargetGate(task) !== targetGate) continue;
    if (!TERMINAL.has(task.status)) continue;
    const at = task.updatedAt || task.createdAt;
    if (!at) continue;
    if (!latest || new Date(at).getTime() > new Date(latest).getTime()) latest = at;
  }
  return latest;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      const child = stableValue(value[key]);
      if (child !== undefined) acc[key] = child;
      return acc;
    }, {});
  }
  if (value === undefined) return undefined;
  return value;
}

function hashObject(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
    .slice(0, 16);
}

function factVersion(entry = {}) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.updatedAt || entry.observedAt || entry.rowUpdatedAt || '');
}

function perceptionVersion(item = {}, freshness = {}) {
  return String(
    item.perceptionVersion
    || item.userPerceptionFacts && item.userPerceptionFacts.perceptionVersion
    || factVersion(freshness.userPerceptionFacts)
    || item.perceptionUpdatedAt
    || '',
  );
}

function buildAttemptKey({ item = {}, itemInfo = {}, itemId = '', targetGate = '', gateObjective = {} } = {}) {
  const freshness = item.factsFreshness || itemInfo.factsFreshness || factsFreshnessService.projectForItem(item);
  return hashObject({
    itemId,
    targetGate,
    gateObjective: gateObjective || {},
    sourceFactsUpdatedAt: factVersion(freshness.sourceFacts),
    mediaFactsUpdatedAt: factVersion(freshness.mediaFacts),
    metadataFactsUpdatedAt: factVersion(freshness.metadataFacts),
    perceptionVersion: perceptionVersion(item, freshness),
  });
}

function taskAttemptKey(task = {}) {
  return String(
    task.taskAttempt && task.taskAttempt.attemptKey
    || task.taskTarget && task.taskTarget.attemptKey
    || '',
  );
}

function automaticAttemptLimit(config = {}, targetGate = '') {
  const cfg = config.taskAdmission || {};
  const byTarget = cfg.automaticAttemptLimitsByTargetGate || {};
  const raw = byTarget[targetGate];
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function failedAttemptCount(tasks, itemId, targetGate, attemptKey) {
  if (!attemptKey) return 0;
  return (tasks || []).filter((task) => (
    task
    && task.itemId === itemId
    && taskTargetGate(task) === targetGate
    && ATTEMPT_FAILURE_STATUSES.has(task.status)
    && taskAttemptKey(task) === attemptKey
  )).length;
}

function queueLimitForTarget(config = {}, targetGate = '') {
  const cfg = config.taskAdmission || {};
  const byTarget = cfg.maxQueuedByTargetGate || {};
  const raw = byTarget[targetGate] !== undefined ? byTarget[targetGate] : cfg.defaultMaxQueued;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function queuedCountForTargetGate(tasks, targetGate) {
  return (tasks || []).filter((task) => (
    task
    && !TERMINAL.has(task.status)
    && taskTargetGate(task) === targetGate
  )).length;
}

function isArchived(item = {}) {
  return item.archiveStatus === 'archived_like'
    || !!item.archiveDoneAt
    || !!(item.archiveGate && item.archiveGate.passed);
}

function deleteReviewConfirmed(item = {}) {
  const candidate = item.deleteCandidate || {};
  return candidate.candidateStatus === 'confirmed'
    || candidate.decision === 'confirm_delete'
    || item.deleteReviewConfirmed === true;
}

function destructivePreAuthorized(input = {}) {
  return input.destructivePreAuthorized === true
    || input.preAuthorized === true
    || (input.intent && input.intent.destructivePreAuthorized === true);
}

function objectiveKind(objective = {}) {
  return cleanToken(objective && objective.kind);
}

function isMetadataRefreshObjective(objective = {}) {
  const kind = objectiveKind(objective);
  return kind === 'metadata_refresh'
    || kind === 'media_facts_refresh'
    || kind === 'refresh_metadata'
    || kind === 'refresh_media_facts'
    || objective.forceRefresh === true
    || objective.refresh === true
    || Array.isArray(objective.refreshFacts);
}

function metadataFactsFresh(item = {}) {
  const projection = item.factsFreshness || factsFreshnessService.projectForItem(item);
  return factsFreshnessService.isFresh(projection, 'mediaFacts')
    && factsFreshnessService.isFresh(projection, 'metadataFacts');
}

function metadataFactsStale(item = {}) {
  const projection = item.factsFreshness || factsFreshnessService.projectForItem(item);
  return factsFreshnessService.isBlockingStale(projection, 'mediaFacts')
    || factsFreshnessService.isBlockingStale(projection, 'metadataFacts');
}

function buildTaskTarget({ item = {}, itemInfo = {}, targetGate = '', gateObjective = {}, source = '' } = {}) {
  const info = itemInfo && Object.keys(itemInfo).length ? itemInfo : item;
  const itemId = info.itemId || item.itemId || '';
  const objective = gateObjective && typeof gateObjective === 'object' ? gateObjective : {};
  let resolvedObjective = objective;
  if (targetGate === 'delete' && !objective.kind) {
    resolvedObjective = { kind: 'delete_archived_media', ...objective };
  } else if (targetGate === 'metadata' && !objective.kind) {
    resolvedObjective = {
      kind: 'metadata_complete',
      repairMode: info.source === 'emby' || info.metadataKind === 'emby' ? 'emby_repair' : 'scrape',
      ...objective,
    };
  } else if (targetGate === 'archive' && !objective.kind) {
    resolvedObjective = { kind: 'archive_item', ...objective };
  } else if (targetGate === 'ingest' && !objective.kind) {
    resolvedObjective = { kind: 'source_ingested', ...objective };
  }
  return {
    object: {
      type: targetGate === 'ingest' ? 'source_candidate' : 'media_item',
      itemId,
    },
    targetGate,
    gateObjective: resolvedObjective,
    source,
  };
}

function blocked(targetGate, reason, extra = {}) {
  return {
    allowed: false,
    targetGate,
    reason,
    ...extra,
  };
}

function allow(targetGate, taskTarget, extra = {}) {
  return {
    allowed: true,
    targetGate,
    taskTarget,
    reason: 'allowed',
    ...extra,
  };
}

function canCreateTargetTask(input = {}) {
  const item = input.item || {};
  const itemInfo = input.itemInfo || item;
  const itemId = input.itemId || item.itemId || itemInfo.itemId || '';
  const targetGate = cleanToken(input.targetGate || (input.taskTarget && input.taskTarget.targetGate));
  const source = input.source || '';
  const automatic = source === 'auto';
  const tasks = input.tasks || [];
  const config = input.config || {};
  const gateObjective = input.gateObjective
    || input.optimizeObjective
    || (input.taskTarget && input.taskTarget.gateObjective)
    || (targetGate === 'optimize' && (item.optimizeObjective || itemInfo.optimizeObjective))
    || {};
  const resolvedGateObjective = targetGate === 'delete' && !(gateObjective && gateObjective.kind)
    ? { kind: 'delete_archived_media', ...(gateObjective && typeof gateObjective === 'object' ? gateObjective : {}) }
    : gateObjective;

  if (!itemId) return blocked(targetGate, 'missing_item_id');
  if (!automationPolicy.TASK_TARGETS.has(targetGate)) return blocked(targetGate, 'invalid_target_gate');

  const freeze = mediaFreeze.project(itemInfo && Object.keys(itemInfo).length ? { ...item, ...itemInfo } : item);
  if (freeze.frozen) {
    return blocked(targetGate, 'media_frozen', {
      mediaFreeze: freeze,
      frozenUntil: freeze.frozenUntil,
      freezeReason: freeze.reason,
      sourceTaskId: freeze.sourceTaskId,
      sourceTargetGate: freeze.sourceTargetGate,
      sourceFlowKind: freeze.sourceFlowKind,
    });
  }

  const active = activeTaskForItemTarget(tasks, itemId, targetGate);
  if (active) return blocked(targetGate, 'active_task_exists', { activeTask: { id: active.id, status: active.status, targetGate } });

  if (automatic && !automationPolicy.automaticTargetEnabled(config, targetGate)) {
    return blocked(targetGate, 'target_gate_not_enabled');
  }

  if (automatic) {
    const cooldown = targetCooldownMs(config, targetGate);
    const lastDoneAt = item.lastTaskDoneAt || lastTerminalTaskAt(tasks, itemId, targetGate);
    if (cooldown > 0 && lastDoneAt && Date.now() - new Date(lastDoneAt).getTime() < cooldown) {
      return blocked(targetGate, 'recent_task_cooldown', { cooldownMs: cooldown, lastDoneAt });
    }
    const limit = queueLimitForTarget(config, targetGate);
    if (limit !== null && queuedCountForTargetGate(tasks, targetGate) >= limit) {
      return blocked(targetGate, 'queue_limit', { limit });
    }
  }

  if (targetGate === 'metadata' && item.metadataComplete === true) {
    const refreshIntent = isMetadataRefreshObjective(resolvedGateObjective);
    const stale = metadataFactsStale(item);
    if (!refreshIntent && !stale && metadataFactsFresh(item)) {
      return blocked(targetGate, 'metadata_already_complete');
    }
  }
  if (targetGate === 'optimize') {
    const kind = objectiveKind(resolvedGateObjective);
    if (kind === 'remove_media' || kind === 'delete' || kind === 'delete_archived_media') {
      return blocked(targetGate, 'delete_is_not_optimize');
    }
    if (item.metadataComplete !== true) return blocked(targetGate, 'metadata_missing');
    if (!metadataFactsFresh(item)) return blocked(targetGate, 'metadata_facts_stale');
    if (item.optimizeObjectiveStatus && item.optimizeObjectiveStatus !== 'ready') {
      return blocked(targetGate, 'optimize_objective_not_ready', { optimizeObjectiveStatus: item.optimizeObjectiveStatus });
    }
    const optimizeGate = item.optimizeGate || item.optimizationGate || {};
    if (automatic && optimizeGate.passed === true) {
      return blocked(targetGate, 'optimize_gate_already_passed', { optimizeGate });
    }
  }
  if (targetGate === 'archive') {
    const optimizeGate = item.optimizeGate || item.optimizationGate || {};
    if (!optimizeGate.passed) return blocked(targetGate, 'optimize_gate_missing', { optimizeGate });
    const archiveGate = item.archiveGate || {};
    if (archiveGate.passed || item.archiveStatus === 'archived_like') return blocked(targetGate, 'archive_already_closed', { archiveGate });
  }
  if (targetGate === 'delete') {
    if (!isArchived(item)) return blocked(targetGate, 'delete_requires_archived_item');
    if (!deleteReviewConfirmed(item) && !destructivePreAuthorized(input)) {
      return blocked(targetGate, 'delete_review_required');
    }
  }

  const attemptKey = buildAttemptKey({
    item,
    itemInfo,
    itemId,
    targetGate,
    gateObjective: resolvedGateObjective,
  });
  if (automatic) {
    const limit = automaticAttemptLimit(config, targetGate);
    const failedAttempts = failedAttemptCount(tasks, itemId, targetGate, attemptKey);
    if (limit !== null && failedAttempts >= limit) {
      return blocked(targetGate, 'automatic_attempt_limit_reached', {
        attemptKey,
        automaticAttemptLimit: limit,
        automaticAttemptCount: failedAttempts,
      });
    }
  }

  const taskTarget = input.taskTarget && typeof input.taskTarget === 'object'
    ? {
      object: input.taskTarget.object || buildTaskTarget({ item, itemInfo, targetGate, gateObjective, source }).object,
      targetGate,
      gateObjective: resolvedGateObjective,
      source,
      attemptKey: input.taskTarget.attemptKey || attemptKey,
    }
    : buildTaskTarget({ item, itemInfo, targetGate, gateObjective: resolvedGateObjective, source });
  taskTarget.attemptKey = taskTarget.attemptKey || attemptKey;

  return allow(targetGate, taskTarget);
}

module.exports = {
  TERMINAL,
  taskTargetGate,
  activeTaskForItemTarget,
  buildAttemptKey,
  mediaFreezeStatus: mediaFreeze.project,
  canCreateTargetTask,
  buildTaskTarget,
  queueLimitForTarget,
  queuedCountForTargetGate,
};
