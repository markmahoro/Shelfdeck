'use strict';

const GATES = new Set(['ingest', 'metadata', 'optimize', 'archive']);

function normalizeGate(gate) {
  const normalized = String(gate || '').trim().toLowerCase();
  return GATES.has(normalized) ? normalized : '';
}

function buildInvalidation(input = {}) {
  const invalidatedGate = normalizeGate(input.invalidatedGate || input.gate);
  if (!invalidatedGate) throw new Error('Invalid gate invalidation target');
  const now = input.invalidatedAt || new Date().toISOString();
  return {
    gate: invalidatedGate,
    invalidatedGate,
    reason: String(input.reason || 'upstream_fact_invalidated'),
    message: String(input.message || ''),
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : {},
    sourceTaskId: input.taskId || input.sourceTaskId || '',
    sourceActionType: input.sourceActionType || '',
    sourceTargetGate: input.sourceTargetGate || '',
    invalidatedAt: now,
    recovery: input.recovery || `rerun_${invalidatedGate}`,
    userAction: input.userAction || `rerun_${invalidatedGate}`,
  };
}

function applyInvalidationToItem(item, invalidation) {
  const gate = invalidation.invalidatedGate;
  const gateInvalidations = {
    ...(item.gateInvalidations || {}),
    [gate]: invalidation,
  };
  const updated = {
    ...item,
    gateInvalidations,
    lastGateInvalidatedAt: invalidation.invalidatedAt,
  };

  if (gate === 'ingest') {
    updated.ingestStatus = 'invalidated';
    updated.ingestGateFailure = invalidation;
    updated.sourceAvailable = false;
  } else if (gate === 'metadata') {
    updated.metadataComplete = false;
    updated.metadataStatus = 'missing';
    updated.metadataGateFailure = invalidation;
  } else if (gate === 'optimize') {
    updated.optimizeGate = {
      ...(item.optimizeGate || {}),
      gate: 'optimize',
      passed: false,
      status: 'invalidated',
      reason: invalidation.reason,
      invalidation,
    };
    updated.optimizationGate = updated.optimizeGate;
  } else if (gate === 'archive') {
    updated.archiveGate = {
      ...(item.archiveGate || {}),
      gate: 'archive',
      passed: false,
      status: 'invalidated',
      reason: invalidation.reason,
      invalidation,
    };
  }

  return updated;
}

function recordGateInvalidation(input = {}) {
  const invalidation = buildInvalidation(input);
  const itemId = input.itemId || '';
  if (!itemId) return { ...invalidation, stored: false, storeReason: 'missing_item_id' };

  const mediaLibraryService = require('./mediaLibraryService');
  const item = mediaLibraryService.getLibraryItem(itemId);
  if (!item) return { ...invalidation, stored: false, storeReason: 'library_item_missing' };

  const updated = applyInvalidationToItem(item, invalidation);
  mediaLibraryService.updateLibraryItems([updated]);
  return { ...invalidation, stored: true };
}

module.exports = {
  buildInvalidation,
  applyInvalidationToItem,
  recordGateInvalidation,
};
