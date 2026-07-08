'use strict';

const flowRecoveryContract = require('./flowRecoveryContract');

const TERMINAL_STATUSES = new Set(['done', 'failed_hard', 'failed_soft', 'cancelled', 'skipped', 'deleted']);
const ACTIVE_CANCEL_STATUSES = new Set([
  'created',
  'pending_manual',
  'queued',
  'executing',
  'pausing',
  'paused',
  'awaiting_user_confirm',
  'interrupted',
  'waiting_media_source',
]);
const PAUSE_STATUSES = new Set(['created', 'queued', 'executing', 'pausing', 'waiting_media_source']);
const EXECUTE_STATUSES = new Set(['created', 'pending_manual', 'interrupted', 'paused', 'pausing']);

function compactEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    id: event.id,
    eventType: event.eventType,
    eventStatus: event.eventStatus,
    phase: event.phase || '',
    resumePoint: event.resumePoint || '',
    resourceType: event.resourceType || '',
    resourceKey: event.resourceKey || '',
    resourceLabel: event.resourceLabel || '',
    createdAt: event.createdAt || '',
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
  };
}

function action(enabled, reason, effect, extra = {}) {
  return {
    enabled: !!enabled,
    reason: enabled ? 'available' : reason,
    effect,
    ...extra,
  };
}

function buildTaskRecoveryPlan(task) {
  return flowRecoveryContract.buildRecoveryPlan(task);
}

function stateForTask(task) {
  const status = task && task.status;
  if (status === 'awaiting_user_confirm') return 'awaiting_confirmation';
  if (status === 'paused') return 'paused';
  if (status === 'pausing') return 'pausing';
  if (status === 'interrupted') return 'interrupted';
  if (status === 'pending_manual' || status === 'created') return 'ready_to_start';
  if (status === 'queued') return 'queued';
  if (status === 'executing' || status === 'waiting_media_source') return 'running';
  if (TERMINAL_STATUSES.has(status)) return 'terminal';
  return status || 'unknown';
}

function executeAction(task) {
  const status = task && task.status;
  if (status === 'paused') {
    return action(true, '', 'resume_from_pause', {
      label: '恢复任务',
      endpoint: `/v1/tasks/${task.id}/actions/execute`,
      method: 'POST',
    });
  }
  if (status === 'interrupted') {
    return action(true, '', 'resume_after_interruption', {
      label: '从中断点继续',
      endpoint: `/v1/tasks/${task.id}/actions/execute`,
      method: 'POST',
    });
  }
  if (status === 'pausing') {
    return action(true, '', 'clear_pause_request', {
      label: '撤销暂停请求',
      endpoint: `/v1/tasks/${task.id}/actions/execute`,
      method: 'POST',
    });
  }
  if (status === 'created' || status === 'pending_manual') {
    return action(true, '', 'queue_for_scheduler_dispatch', {
      label: '开始任务',
      endpoint: `/v1/tasks/${task.id}/actions/execute`,
      method: 'POST',
    });
  }
  if (status === 'awaiting_user_confirm') {
    return action(false, 'confirmation_required', 'blocked_until_user_confirms', {
      label: '等待确认',
      endpoint: `/v1/tasks/${task.id}`,
      method: 'PATCH',
    });
  }
  if (status === 'queued' || status === 'executing' || status === 'waiting_media_source') {
    return action(false, 'already_active', 'scheduler_or_executor_already_owns_task', {
      label: '任务已在推进',
    });
  }
  if (TERMINAL_STATUSES.has(status)) {
    return action(false, 'terminal_task', 'cannot_execute_terminal_task', {
      label: '任务已结束',
    });
  }
  return action(EXECUTE_STATUSES.has(status), 'status_not_executable', 'no_execute_transition_defined', {
    label: '开始/继续',
  });
}

function pauseAction(task) {
  const status = task && task.status;
  if (PAUSE_STATUSES.has(status)) {
    return action(true, '', status === 'executing' || status === 'waiting_media_source'
      ? 'request_runtime_pause_and_cleanup_partial_work'
      : 'move_waiting_task_to_paused', {
      label: '暂停任务',
      endpoint: `/v1/tasks/${task.id}/actions/pause`,
      method: 'POST',
    });
  }
  if (status === 'paused') {
    return action(false, 'already_paused', 'no_pause_needed', { label: '已暂停' });
  }
  if (status === 'awaiting_user_confirm') {
    return action(false, 'confirmation_required', 'task_is_already_waiting_for_user', { label: '等待确认' });
  }
  if (TERMINAL_STATUSES.has(status)) {
    return action(false, 'terminal_task', 'cannot_pause_terminal_task', { label: '任务已结束' });
  }
  return action(false, 'status_not_pausable', 'no_pause_transition_defined', { label: '暂停任务' });
}

function confirmAction(task) {
  const status = task && task.status;
  const approval = task && task.approval && typeof task.approval === 'object' ? task.approval : null;
  if (status === 'awaiting_user_confirm') {
    return action(true, '', 'store_confirmation_and_queue_task', {
      label: '确认并继续',
      endpoint: `/v1/tasks/${task.id}`,
      method: 'PATCH',
      gateId: approval && approval.gateId || '',
    });
  }
  return action(false, status ? 'not_awaiting_confirmation' : 'missing_task_status', 'confirmation_not_required', {
    label: '无需确认',
  });
}

function cancelAction(task) {
  const status = task && task.status;
  if (ACTIVE_CANCEL_STATUSES.has(status)) {
    const needsRuntimeCancel = ['executing', 'pausing', 'paused', 'awaiting_user_confirm', 'interrupted', 'waiting_media_source'].includes(status);
    return action(true, '', needsRuntimeCancel ? 'cancel_runtime_then_remove_task' : 'remove_waiting_task', {
      label: needsRuntimeCancel ? '取消任务' : '移除任务',
      endpoint: `/v1/tasks/${task.id}`,
      method: 'DELETE',
      destructive: needsRuntimeCancel,
    });
  }
  if (TERMINAL_STATUSES.has(status)) {
    return action(true, '', 'remove_task_history_record', {
      label: '移除记录',
      endpoint: `/v1/tasks/${task.id}`,
      method: 'DELETE',
      destructive: false,
    });
  }
  return action(false, 'status_not_cancellable', 'no_cancel_transition_defined', { label: '取消任务' });
}

function retryAction(task) {
  const status = task && task.status;
  if (status === 'interrupted') {
    return action(true, '', 'retry_from_resume_point_via_execute', {
      label: '重试/继续',
      endpoint: `/v1/tasks/${task.id}/actions/execute`,
      method: 'POST',
    });
  }
  if (status === 'failed_hard' || status === 'failed_soft') {
    const plan = buildTaskRecoveryPlan(task);
    return action(plan.available, plan.reason, plan.effect, {
      label: plan.label,
      endpoint: `/v1/tasks/${task.id}/actions/retry`,
      method: 'POST',
      resumePoint: plan.resumePoint,
      retryCount: plan.retryCount,
      maxRetryCount: plan.maxRetryCount,
    });
  }
  return action(false, 'retry_not_required', 'retry_only_applies_to_interrupted_or_failed_tasks', {
    label: '重试',
  });
}

function confirmationSummary(task) {
  const approval = task && task.approval && typeof task.approval === 'object' ? task.approval : null;
  return {
    required: task && task.status === 'awaiting_user_confirm',
    gateId: approval && approval.gateId || '',
    message: approval && approval.message || '',
    options: Array.isArray(approval && approval.options) ? approval.options : [],
    resumePoint: task && task.resumePoint || '',
    effect: task && task.status === 'awaiting_user_confirm'
      ? 'confirmation_will_queue_task_at_resume_point'
      : 'no_confirmation_needed',
  };
}

function recoverySummary(task) {
  const status = task && task.status;
  if (status === 'interrupted') {
    return {
      state: 'resume_available',
      reason: 'task_interrupted_before_completion',
      resumePoint: task.resumePoint || '',
      nextAction: 'execute',
    };
  }
  if (status === 'paused') {
    return {
      state: 'resume_available',
      reason: 'paused_by_user',
      resumePoint: task.resumePoint || '',
      nextAction: 'execute',
    };
  }
  if (status === 'awaiting_user_confirm') {
    return {
      state: 'waiting_for_user_confirmation',
      reason: 'flow_gate_requires_user_decision',
      resumePoint: task.resumePoint || '',
      nextAction: 'confirm',
    };
  }
  if (status === 'failed_hard' || status === 'failed_soft') {
    const plan = buildTaskRecoveryPlan(task);
    return {
      state: plan.available ? 'retry_available' : 'flow_specific_recovery_required',
      reason: plan.reason,
      resumePoint: plan.resumePoint || '',
      nextAction: plan.action,
      effect: plan.effect,
      retryCount: plan.retryCount,
      maxRetryCount: plan.maxRetryCount,
    };
  }
  if (TERMINAL_STATUSES.has(status)) {
    return {
      state: 'terminal',
      reason: status,
      resumePoint: '',
      nextAction: 'none',
    };
  }
  return {
    state: 'not_needed',
    reason: status || 'unknown',
    resumePoint: task && task.resumePoint || '',
    nextAction: EXECUTE_STATUSES.has(status) ? 'execute' : 'inspect_status',
  };
}

function buildTaskControlState(task, options = {}) {
  const latestEvent = compactEvent(options.latestEvent);
  const actions = {
    execute: executeAction(task),
    pause: pauseAction(task),
    confirm: confirmAction(task),
    cancel: cancelAction(task),
    retry: retryAction(task),
  };
  const primaryAction = ['confirm', 'execute', 'retry', 'pause', 'cancel'].find((key) => {
    const value = actions[key];
    if (!value || !value.enabled) return false;
    return !(key === 'cancel' && value.effect === 'remove_task_history_record');
  });
  return {
    state: stateForTask(task),
    requiresUserAction: !!(task && task.status === 'awaiting_user_confirm'),
    phase: task && task.phase || '',
    resumePoint: task && task.resumePoint || '',
    retryCount: task && Number(task.retryCount || 0) || 0,
    primaryAction: primaryAction || '',
    actions,
    confirmation: confirmationSummary(task),
    recovery: recoverySummary(task),
    recoveryContract: flowRecoveryContract.buildContractProjection(task),
    latestEvent,
  };
}

function getTaskAction(task, actionName) {
  const state = buildTaskControlState(task);
  const actionValue = state.actions && state.actions[actionName];
  if (actionValue) return actionValue;
  return action(false, 'unknown_action', 'no_action_transition_defined', {
    label: actionName || 'unknown',
  });
}

module.exports = {
  buildTaskControlState,
  buildTaskRecoveryPlan,
  getTaskAction,
};
