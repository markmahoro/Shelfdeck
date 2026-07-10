'use strict';

const TASK_TARGETS = new Set(['basedata', 'metadata', 'optimize']);
const OPTIMIZE_FLOW_KINDS = new Set(['transcode', 'upgrade']);

function cleanToken(value) {
  const token = String(value || '').trim().toLowerCase();
  return token || null;
}

function normalizeList(values, allowed) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = cleanToken(value);
    if (!normalized || !allowed.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveOptimizeAllowedFlowKinds(config = {}) {
  return normalizeList(
    config.optimizeFlowPolicy && config.optimizeFlowPolicy.allowedFlowKinds,
    OPTIMIZE_FLOW_KINDS,
  );
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
    allowedOptimizeFlowKinds: resolveOptimizeAllowedFlowKinds(input.config || input),
  };
}

module.exports = {
  TASK_TARGETS,
  OPTIMIZE_FLOW_KINDS,
  automationSnapshot,
  decideRunProgress,
  resolveOptimizeAllowedFlowKinds,
};
