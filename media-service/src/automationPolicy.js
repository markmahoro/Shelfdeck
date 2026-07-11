'use strict';

const TASK_TARGETS = new Set(['basedata', 'metadata', 'optimize']);

function cleanToken(value) {
  const token = String(value || '').trim().toLowerCase();
  return token || null;
}

function decideRunProgress(input = {}) {
  const targetGate = cleanToken(input.targetGate);
  if (!TASK_TARGETS.has(targetGate)) return { allowed: false, targetGate, reason: 'invalid_target_gate' };
  if (input.runStatus !== 'ready') return { allowed: false, targetGate, reason: 'maintenance_run_not_ready' };
  if (input.lifecycleBlockedReason) {
    return { allowed: false, targetGate, reason: 'lifecycle_blocked', blocker: String(input.lifecycleBlockedReason) };
  }
  return { allowed: true, targetGate, reason: 'maintenance_run_progress_allowed' };
}

function automationSnapshot(input = {}) {
  return {
    maintenanceAutomationMode: input.maintenanceAutomationMode === 'auto' ? 'auto' : 'manual',
  };
}

module.exports = {
  TASK_TARGETS,
  automationSnapshot,
  decideRunProgress,
};
