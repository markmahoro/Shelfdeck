'use strict';

const configStore = require('./configStore');
const optimizationStatus = require('./optimizationStatus');

const TERMINAL = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);

function actionCooldownMs(config, actionType) {
  const cfg = config && config.taskAdmission || {};
  const byAction = cfg.cooldownHoursByAction || {};
  const hours = typeof byAction[actionType] === 'number'
    ? byAction[actionType]
    : (typeof cfg.defaultCooldownHours === 'number' ? cfg.defaultCooldownHours : 48);
  return Math.max(0, hours) * 3600 * 1000;
}

function lastActionDoneAt(item, actionType) {
  if (!item) return null;
  if (actionType === 'transcode' && item.lastTranscodeDoneAt) return item.lastTranscodeDoneAt;
  if (actionType === 'upgrade' && item.lastUpgradeDoneAt) return item.lastUpgradeDoneAt;
  if (item.lastTaskDoneAt) return item.lastTaskDoneAt;
  return null;
}

function lastTerminalTaskAt(tasks, itemId, actionType) {
  if (!itemId) return null;
  let latest = null;
  for (const task of tasks || []) {
    if (!task || task.itemId !== itemId || task.actionType !== actionType) continue;
    if (!TERMINAL.has(task.status)) continue;
    const at = task.updatedAt || task.createdAt;
    if (!at) continue;
    if (!latest || new Date(at).getTime() > new Date(latest).getTime()) latest = at;
  }
  return latest;
}

function activeTaskForItem(tasks, itemId) {
  return (tasks || []).find((t) => t && t.itemId === itemId && !TERMINAL.has(t.status));
}

function queuedCountForAction(tasks, actionType) {
  return (tasks || []).filter((t) => t && t.actionType === actionType && !TERMINAL.has(t.status)).length;
}

function queueLimit(config, actionType) {
  const cfg = config && config.taskAdmission || {};
  const byAction = cfg.maxQueuedByAction || {};
  const raw = byAction[actionType] !== undefined ? byAction[actionType] : cfg.defaultMaxQueued;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function enabledAutoActions(config) {
  return Array.isArray(config && config.smartTaskEnabledActions)
    ? config.smartTaskEnabledActions
    : [];
}

function canCreateTask({ item, itemInfo, actionType, source, config, tasks, optimizationIndex }) {
  const cfg = config || {};
  const info = itemInfo || item || {};
  const itemId = info.itemId || (item && item.itemId) || '';

  if (!itemId) {
    return { allowed: false, reason: 'missing_item_id' };
  }

  const active = activeTaskForItem(tasks || [], itemId);
  if (active) {
    return { allowed: false, reason: 'active_task_exists', activeTaskId: active.id };
  }

  const manual = source === 'manual';
  const automatic = !manual;
  const schedule = configStore.resolveSubLibSchedule(info, cfg);
  if (automatic && !enabledAutoActions(cfg).includes(actionType)) {
    return { allowed: false, reason: 'action_not_enabled' };
  }

  if (automatic && !schedule.autoCreate) {
    return { allowed: false, reason: 'automation_manual' };
  }

  if (!manual) {
    const lastDoneAt = lastActionDoneAt(item || info, actionType) || lastTerminalTaskAt(tasks || [], itemId, actionType);
    const cooldown = actionCooldownMs(cfg, actionType);
    if (lastDoneAt && cooldown > 0) {
      const nextEligibleAtMs = new Date(lastDoneAt).getTime() + cooldown;
      if (Date.now() < nextEligibleAtMs) {
        return {
          allowed: false,
          reason: 'recent_task_cooldown',
          nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
        };
      }
    }

    const limit = queueLimit(cfg, actionType);
    if (limit !== null && queuedCountForAction(tasks || [], actionType) >= limit) {
      return { allowed: false, reason: 'queue_limit', limit };
    }

    if (actionType === 'transcode') {
      const opt = optimizationStatus.resolveOptimization(
        item || info,
        optimizationIndex || optimizationStatus.buildOptimizationIndex(tasks || [], cfg),
        cfg,
      );
      if (opt.optimizationStatus === 'transcoded') {
        return { allowed: false, reason: 'already_transcoded' };
      }
    }
  }

  return { allowed: true, reason: 'allowed' };
}

module.exports = {
  canCreateTask,
};
