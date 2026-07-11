'use strict';

function compactEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    id: event.id,
    eventType: event.eventType,
    eventStatus: event.eventStatus,
    phase: event.phase || '',
    resourceType: event.resourceType || '',
    resourceKey: event.resourceKey || '',
    createdAt: event.createdAt || '',
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
  };
}

function confirmAction(task) {
  const approval = task && task.approval && typeof task.approval === 'object' ? task.approval : null;
  if (task && task.status === 'awaiting_user_confirm') {
    return {
      enabled: true,
      reason: 'available',
      effect: 'store_confirmation_and_queue_task',
      label: '确认并继续',
      endpoint: `/v1/tasks/${task.id}/actions/confirm`,
      method: 'POST',
      gateId: approval && approval.gateId || '',
    };
  }
  return { enabled: false, reason: 'not_awaiting_confirmation', effect: 'confirmation_not_required', label: '无需确认' };
}

function stateForTask(task) {
  const status = task && task.status || 'unknown';
  if (status === 'awaiting_user_confirm') return 'awaiting_confirmation';
  if (status === 'waiting_for_resource' || status === 'queued' || status === 'created') return 'queued';
  if (status === 'executing') return 'running';
  return status;
}

function buildTaskControlState(task, options = {}) {
  const confirm = confirmAction(task);
  const failed = task && (task.status === 'failed_hard' || task.status === 'failed_soft');
  return {
    state: stateForTask(task),
    requiresUserAction: confirm.enabled,
    phase: task && task.phase || '',
    primaryAction: confirm.enabled ? 'confirm' : '',
    actions: { confirm },
    confirmation: {
      required: confirm.enabled,
      gateId: confirm.gateId || '',
      message: task && task.approval && task.approval.message || '',
      options: Array.isArray(task && task.approval && task.approval.options) ? task.approval.options : [],
    },
    recovery: failed
      ? { state: 'system_diagnostics_required', reason: task.status, nextAction: 'inspect_logs' }
      : { state: 'not_user_actionable', reason: task && task.status || 'unknown', nextAction: 'none' },
    latestEvent: compactEvent(options.latestEvent),
  };
}

function getTaskAction(task, actionName) {
  if (actionName === 'confirm') return confirmAction(task);
  return { enabled: false, reason: 'user_task_control_removed', effect: 'no_user_transition', label: actionName || 'unknown' };
}

module.exports = { buildTaskControlState, getTaskAction };
