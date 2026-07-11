'use strict';

const DEFAULT_FREEZE_REASON = 'post_task_external_settle';

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function taskTargetGate(task = {}) {
  return cleanToken(
    task.taskTarget && task.taskTarget.targetGate
    || task.targetGate
    || '',
  );
}

function freezeReasonForTargetGate(targetGate) {
  const gate = cleanToken(targetGate);
  if (gate === 'optimize') return 'post_optimize_external_settle';
  return gate ? `post_${gate}_external_settle` : DEFAULT_FREEZE_REASON;
}

function freezeHoursForCompletedTargetGate(config = {}, targetGate = '') {
  const cfg = config.taskAdmission || {};
  const byGate = cfg.mediaFreezeHoursByCompletedTargetGate || {};
  const raw = byGate[cleanToken(targetGate)];
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

function rawFreeze(item = {}) {
  const embedded = item.mediaFreeze && typeof item.mediaFreeze === 'object' ? item.mediaFreeze : {};
  return {
    frozenUntil: String(embedded.frozenUntil || item.mediaFrozenUntil || ''),
    reason: String(embedded.reason || item.mediaFreezeReason || ''),
    sourceTaskId: String(embedded.sourceTaskId || item.mediaFreezeSourceTaskId || ''),
    sourceTargetGate: String(embedded.sourceTargetGate || item.mediaFreezeSourceTargetGate || ''),
  };
}

function project(item = {}, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const raw = rawFreeze(item);
  const untilMs = Date.parse(raw.frozenUntil);
  const frozen = Number.isFinite(untilMs) && untilMs > nowMs;
  return {
    frozen,
    frozenUntil: raw.frozenUntil,
    reason: raw.reason,
    sourceTaskId: raw.sourceTaskId,
    sourceTargetGate: raw.sourceTargetGate,
  };
}

function clear(item = {}) {
  item.mediaFrozenUntil = '';
  item.mediaFreezeReason = '';
  item.mediaFreezeSourceTaskId = '';
  item.mediaFreezeSourceTargetGate = '';
  item.mediaFreeze = project(item);
  return item.mediaFreeze;
}

function applyCompletedTaskFreeze(item = {}, task = {}, doneAt, config = {}) {
  const targetGate = taskTargetGate(task);
  const hours = freezeHoursForCompletedTargetGate(config, targetGate);
  if (hours <= 0) return clear(item);

  const baseMs = Date.parse(doneAt);
  const startedAtMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  const until = new Date(startedAtMs + hours * 3600 * 1000).toISOString();
  item.mediaFrozenUntil = until;
  item.mediaFreezeReason = freezeReasonForTargetGate(targetGate);
  item.mediaFreezeSourceTaskId = String(task.id || '');
  item.mediaFreezeSourceTargetGate = targetGate;
  item.mediaFreeze = project(item);
  return item.mediaFreeze;
}

module.exports = {
  DEFAULT_FREEZE_REASON,
  taskTargetGate,
  freezeHoursForCompletedTargetGate,
  project,
  clear,
  applyCompletedTaskFreeze,
};
