'use strict';

const TASK_TARGETS = new Set(['ingest', 'metadata', 'optimize', 'archive', 'delete']);
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

function resolveAutomaticTaskTargets(config = {}) {
  return normalizeList(config.automaticTaskTargets, TASK_TARGETS);
}

function resolveOptimizeAllowedFlowKinds(config = {}) {
  return normalizeList(config.optimizeAllowedFlowKinds, OPTIMIZE_FLOW_KINDS);
}

function automaticTargetEnabled(config = {}, targetGate = '') {
  return resolveAutomaticTaskTargets(config).includes(cleanToken(targetGate));
}

function automationSnapshot(config = {}) {
  return {
    enabledTaskTargets: resolveAutomaticTaskTargets(config),
    allowedOptimizeFlowKinds: resolveOptimizeAllowedFlowKinds(config),
  };
}

module.exports = {
  TASK_TARGETS,
  OPTIMIZE_FLOW_KINDS,
  resolveAutomaticTaskTargets,
  resolveOptimizeAllowedFlowKinds,
  automaticTargetEnabled,
  automationSnapshot,
};
