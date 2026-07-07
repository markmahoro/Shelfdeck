'use strict';

const automationPolicy = require('./automationPolicy');

const TERMINAL = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);

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
    return blocked(targetGate, 'metadata_already_complete');
  }
  if (targetGate === 'optimize') {
    const objectiveKind = cleanToken(resolvedGateObjective && resolvedGateObjective.kind);
    if (objectiveKind === 'remove_media' || objectiveKind === 'delete' || objectiveKind === 'delete_archived_media') {
      return blocked(targetGate, 'delete_is_not_optimize');
    }
    if (item.metadataComplete !== true) return blocked(targetGate, 'metadata_missing');
    if (item.optimizeObjectiveStatus && item.optimizeObjectiveStatus !== 'ready') {
      return blocked(targetGate, 'optimize_objective_not_ready', { optimizeObjectiveStatus: item.optimizeObjectiveStatus });
    }
    const optimizeGate = item.optimizeGate || item.optimizationGate || {};
    if (automatic && optimizeGate.passed === true) {
      return blocked(targetGate, 'optimize_gate_already_passed', { optimizeGate });
    }
    if (optimizeGate.status === 'failed' || optimizeGate.passed === false && optimizeGate.reason === 'optimize_gate_failed') {
      return blocked(targetGate, 'optimize_gate_failed_requires_failure_handling', {
        retryPolicy: optimizeGate.retryPolicy || {},
        failureHandling: {
          surface: 'task_center',
          userAction: 'inspect_failure_or_mark_no_action',
        },
      });
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

  const taskTarget = input.taskTarget && typeof input.taskTarget === 'object'
    ? {
      object: input.taskTarget.object || buildTaskTarget({ item, itemInfo, targetGate, gateObjective, source }).object,
      targetGate,
      gateObjective: resolvedGateObjective,
      source,
    }
    : buildTaskTarget({ item, itemInfo, targetGate, gateObjective: resolvedGateObjective, source });

  return allow(targetGate, taskTarget);
}

module.exports = {
  TERMINAL,
  taskTargetGate,
  activeTaskForItemTarget,
  canCreateTargetTask,
  buildTaskTarget,
  queueLimitForTarget,
  queuedCountForTargetGate,
};
