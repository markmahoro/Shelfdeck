'use strict';

const kairoxStore = require('./kairoxStore');

const GATES = new Set(['basedata', 'metadata', 'optimize']);

function normalizeGate(gate) {
  const normalized = String(gate || '').trim().toLowerCase();
  return GATES.has(normalized) ? normalized : '';
}

function buildInvalidation(input = {}) {
  const invalidatedGate = normalizeGate(input.invalidatedGate || input.gate);
  if (!invalidatedGate) {
    const error = new Error('Invalid Kairox gate invalidation target');
    error.code = 'KAIROX_INVALID_TARGET_GATE';
    throw error;
  }
  const now = input.invalidatedAt || new Date().toISOString();
  return {
    gate: invalidatedGate,
    invalidatedGate,
    reason: String(input.reason || 'upstream_fact_invalidated'),
    message: String(input.message || ''),
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : {},
    sourceTaskId: input.taskId || input.sourceTaskId || '',
    sourceFlowKind: input.sourceFlowKind || '',
    sourceTargetGate: input.sourceTargetGate || '',
    invalidatedAt: now,
    recovery: input.recovery || `rerun_${invalidatedGate}`,
    userAction: input.userAction || `rerun_${invalidatedGate}`,
  };
}

function recordGateInvalidation(input = {}) {
  const invalidation = buildInvalidation(input);
  const itemId = String(input.itemId || '').trim();
  if (!itemId) return { ...invalidation, stored: false, storeReason: 'missing_item_id' };

  const markStale = {
    basedata: kairoxStore.markBasedataStale,
    metadata: kairoxStore.markMetadataStale,
    optimize: kairoxStore.markOptimizeStale,
  }[invalidation.invalidatedGate];
  markStale({ itemId, reason: invalidation.reason, updatedAt: invalidation.invalidatedAt });
  kairoxStore.requestRefresh({
    itemId,
    factGroup: invalidation.invalidatedGate,
    reason: invalidation.reason,
    causedByTaskId: invalidation.sourceTaskId,
    evidence: invalidation.evidence,
    updatedAt: invalidation.invalidatedAt,
  });
  return { ...invalidation, stored: true };
}

module.exports = { buildInvalidation, recordGateInvalidation };
