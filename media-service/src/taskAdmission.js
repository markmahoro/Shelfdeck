'use strict';

const configStore = require('./configStore');
const optimizationStatus = require('./optimizationStatus');

const TERMINAL = new Set(['done', 'failed_hard', 'deleted']);

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

function activeTaskForItem(tasks, itemId) {
  return (tasks || []).find((t) => t && t.itemId === itemId && !TERMINAL.has(t.status));
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
  const schedule = configStore.resolveSubLibSchedule(info, cfg);
  if (!manual && !schedule.autoCreate) {
    return { allowed: false, reason: 'automation_manual' };
  }

  if (!manual) {
    const lastDoneAt = lastActionDoneAt(item || info, actionType);
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
