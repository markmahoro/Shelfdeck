'use strict';

const flowPlanner = require('./flowPlanner');

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function hasAny(...values) {
  return values.some((value) => clean(value));
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeBitrateMbps(value) {
  const n = numberOrNull(value);
  if (n == null) return null;
  return n > 100000 ? n / 1000000 : n;
}

function normalizeCodec(value) {
  const raw = normalize(value).replace(/[^a-z0-9]/g, '');
  if (['h265', 'x265', 'hevc'].includes(raw)) return 'h265';
  if (['h264', 'x264', 'avc', 'avc1'].includes(raw)) return 'h264';
  return raw;
}

function explicitGateInvalidation(item = {}, gate) {
  const direct = gate === 'ingest' ? item.ingestGateFailure : null;
  const invalidations = item.gateInvalidations && typeof item.gateInvalidations === 'object'
    ? item.gateInvalidations
    : {};
  const invalidation = direct || invalidations[gate];
  if (!invalidation || typeof invalidation !== 'object') return null;
  if (invalidation.clearedAt) return null;
  return invalidation;
}

function invalidationMissingReason(invalidation) {
  const reason = normalize(invalidation && invalidation.reason);
  if (reason === 'source_missing' || reason === 'source_unavailable') return 'source.file';
  if (reason === 'source_identity_invalid') return 'source.location_or_reference';
  return 'upstream_fact_invalidated';
}

function evaluateIngestGate(item = {}) {
  const missing = [];
  const adultMetadata = item.adultMetadata && typeof item.adultMetadata === 'object'
    ? item.adultMetadata
    : {};
  const invalidation = explicitGateInvalidation(item, 'ingest');

  if (invalidation) {
    const missingReason = invalidationMissingReason(invalidation);
    return {
      gate: 'ingest',
      passed: false,
      status: 'invalidated',
      reason: 'ingest_gate_invalidated',
      missingReasons: [missingReason],
      invalidation,
      userAction: invalidation.userAction || 'rerun_ingest_source_sync',
    };
  }

  if (!hasAny(item.itemId)) missing.push('identity.itemId');
  if (!hasAny(item.source, item.subLibraryId, item.mediaType)) missing.push('identity.source_or_sub_library');
  if (!hasAny(item.path, item.sourceId, item.embyItemId, item.assetKey, item.assetRootPath)) {
    missing.push('source.location_or_reference');
  }

  const hasMediaFacts = hasAny(item.duration, item.size, item.bitrate, item.resolution, item.codec)
    || item.probeError
    || adultMetadata.probeError
    || item.mediaFactsUnavailable === true;
  if (!hasMediaFacts) missing.push('media.basic_facts_or_probe_failure');

  return {
    gate: 'ingest',
    passed: missing.length === 0,
    status: missing.length === 0 ? 'passed' : 'missing',
    reason: missing.length === 0 ? 'ingest_gate_met' : 'ingest_gate_missing_required_facts',
    missingReasons: missing,
    userAction: missing.length === 0 ? '' : 'inspect_source_identity_and_probe_result',
  };
}

function isInitialStrategyPlaceholder(action, reason) {
  if (!action || action === 'none') return true;
  if (action !== 'keep') return false;
  return ['新入库', '成人库新入库'].includes(clean(reason));
}

function explicitOptimizeGate(item = {}) {
  const gate = item.optimizeGate || item.optimizationGate;
  return gate && typeof gate === 'object' ? gate : null;
}

function resolveOptimizeOperation(item = {}, gate = null) {
  const action = normalize(item.action);
  const status = normalize(item.optimizationStatus);

  if (gate && gate.operation) return normalize(gate.operation);
  if (item.optimizationAction) return normalize(item.optimizationAction);
  if (status === 'transcoded') return 'transcode';
  if (status === 'upgraded') return 'upgrade';
  return action || null;
}

function resolveOptimizeTarget(item = {}, gate = null) {
  const target = gate && gate.target && typeof gate.target === 'object' ? gate.target : {};
  const actionParams = item.actionParams && typeof item.actionParams === 'object' ? item.actionParams : {};
  return {
    bitrateMbps: normalizeBitrateMbps(target.bitrateMbps || target.targetBitrate || item.targetBitrate || actionParams.targetBitrate),
    codec: normalizeCodec(target.codec || target.targetCodec || item.targetCodec || actionParams.targetCodec),
  };
}

function resolveOptimizeObserved(item = {}, gate = null) {
  const observed = gate && gate.observed && typeof gate.observed === 'object' ? gate.observed : {};
  const result = item.optimizationResult && typeof item.optimizationResult === 'object'
    ? item.optimizationResult
    : {};
  const verify = item.verifyResult && typeof item.verifyResult === 'object' ? item.verifyResult : {};
  return {
    bitrateMbps: normalizeBitrateMbps(
      observed.bitrateMbps
        || observed.bitrate
        || result.bitrateMbps
        || result.bitrate
        || verify.bitrate
        || item.equivalentBitrate
        || item.bitrate
    ),
    codec: normalizeCodec(
      observed.codec
        || observed.videoCodec
        || result.codec
        || result.videoCodec
        || verify.videoCodec
        || item.videoCodec
        || item.codec
    ),
  };
}

function optimizeRetryPolicy(reason) {
  return {
    automaticRetry: false,
    manualRetryAllowed: true,
    reason: reason || 'heavy_resource_gate_miss',
  };
}

function optimizeGateResult({ passed, status, reason, operation, target, observed, failureReasons, evidenceLevel }) {
  return {
    gate: 'optimize',
    passed: !!passed,
    status,
    reason,
    operation: operation || null,
    target: target || {},
    observed: observed || {},
    failureReasons: failureReasons || [],
    evidenceLevel: evidenceLevel || '',
    retryPolicy: passed ? { automaticRetry: false, manualRetryAllowed: false, reason: '' } : optimizeRetryPolicy(reason),
    userAction: passed ? '' : 'inspect_optimize_result_or_request_manual_retry',
  };
}

function hasOptimizeDoneMarker(item = {}, operation = '') {
  const status = normalize(item.optimizationStatus);
  if (operation === 'transcode') return status === 'transcoded' || !!item.lastTranscodeDoneAt;
  if (operation === 'upgrade') return status === 'upgraded' || !!item.lastUpgradeDoneAt;
  return false;
}

function targetFailures(operation, target, observed) {
  const failures = [];
  const bitrateTolerance = operation === 'upgrade'
    ? { minRatio: 0.9, maxRatio: null }
    : { minRatio: 0.65, maxRatio: 1.35 };

  if (target.bitrateMbps != null && observed.bitrateMbps != null) {
    if (bitrateTolerance.minRatio != null && observed.bitrateMbps < target.bitrateMbps * bitrateTolerance.minRatio) {
      failures.push('target_bitrate_not_met');
    }
    if (bitrateTolerance.maxRatio != null && observed.bitrateMbps > target.bitrateMbps * bitrateTolerance.maxRatio) {
      failures.push('target_bitrate_exceeded');
    }
  }
  if (target.codec && observed.codec && target.codec !== observed.codec) {
    failures.push('target_codec_not_met');
  }
  return failures;
}

function evaluateOptimizeGate(item = {}) {
  const gate = explicitOptimizeGate(item);
  const operation = resolveOptimizeOperation(item, gate);
  const target = resolveOptimizeTarget(item, gate);
  const observed = resolveOptimizeObserved(item, gate);

  if (gate && gate.passed === false) {
    const failureReasons = Array.isArray(gate.failureReasons) && gate.failureReasons.length > 0
      ? gate.failureReasons
      : ['explicit_optimize_gate_failed'];
    return optimizeGateResult({
      passed: false,
      status: normalize(gate.status) || 'failed',
      reason: gate.reason || 'optimize_gate_failed',
      operation,
      target,
      observed,
      failureReasons,
      evidenceLevel: 'explicit',
    });
  }

  if (gate && gate.passed === true) {
    return optimizeGateResult({
      passed: true,
      status: 'passed',
      reason: gate.reason || 'optimize_gate_met',
      operation,
      target,
      observed,
      evidenceLevel: 'explicit',
    });
  }

  const action = normalize(item.action);
  const reason = clean(item.reason);
  if (action === 'keep' && !isInitialStrategyPlaceholder(action, reason)) {
    return optimizeGateResult({
      passed: true,
      status: 'passed',
      reason: 'objective_already_satisfied',
      operation: 'no_op',
      target: { operation: 'no_op' },
      observed: { action: 'keep' },
      evidenceLevel: 'strategy',
    });
  }

  if (item.optimizeObjective && item.optimizeObjectiveStatus !== 'pending_metadata') {
    const selection = flowPlanner.selectOptimizeFlow({
      itemInfo: item,
      optimizeObjective: item.optimizeObjective,
      optimizeObjectiveStatus: item.optimizeObjectiveStatus,
      objectiveHash: item.objectiveHash,
    });
    if (selection.selectedOperation === 'no_op') {
      return optimizeGateResult({
        passed: true,
        status: 'passed',
        reason: 'objective_already_satisfied',
        operation: 'no_op',
        target: selection.targetFacts,
        observed: selection.currentFacts,
        evidenceLevel: 'objective',
      });
    }
  }

  if (!operation || operation === 'none') {
    return optimizeGateResult({
      passed: false,
      status: 'pending',
      reason: 'strategy_missing',
      operation: null,
      target,
      observed,
      failureReasons: ['strategy_missing'],
      evidenceLevel: 'none',
    });
  }

  if (operation === 'delete') {
    return optimizeGateResult({
      passed: false,
      status: 'blocked',
      reason: 'delete_gate_required',
      operation: null,
      target,
      observed,
      failureReasons: ['delete_is_not_optimize'],
      evidenceLevel: 'contract',
    });
  }

  if (['transcode', 'upgrade'].includes(operation) && !hasOptimizeDoneMarker(item, operation)) {
    return optimizeGateResult({
      passed: false,
      status: 'pending',
      reason: 'optimize_not_attempted',
      operation,
      target,
      observed,
      failureReasons: ['optimize_result_missing'],
      evidenceLevel: 'none',
    });
  }

  const failures = targetFailures(operation, target, observed);
  if (failures.length > 0) {
    return optimizeGateResult({
      passed: false,
      status: 'failed',
      reason: 'optimize_gate_failed',
      operation,
      target,
      observed,
      failureReasons: failures,
      evidenceLevel: 'objective',
    });
  }

  return optimizeGateResult({
    passed: true,
    status: 'passed',
    reason: target.bitrateMbps || target.codec ? 'optimize_gate_met' : 'legacy_optimization_marker',
    operation,
    target,
    observed,
    evidenceLevel: target.bitrateMbps || target.codec ? 'objective_or_marker' : 'marker',
  });
}

function isOptimizedLike(item = {}) {
  const archiveStatus = normalize(item.archiveStatus);
  if (archiveStatus === 'archived' || archiveStatus === 'archived_like') return true;
  return evaluateOptimizeGate(item).passed;
}

function hasArchiveClosureMarker(item = {}) {
  const archiveStatus = normalize(item.archiveStatus);
  return archiveStatus === 'archived'
    || archiveStatus === 'archived_like'
    || item.lifecycleDone === true
    || !!item.archiveDoneAt;
}

function evaluateArchiveGate(item = {}) {
  const missing = [];
  const blockers = Array.isArray(item.archiveBlockers) ? item.archiveBlockers.filter(Boolean) : [];

  if (!isOptimizedLike(item)) missing.push('optimize.result');
  else if (!hasArchiveClosureMarker(item)) missing.push('archive.finalization');
  if (blockers.length > 0) missing.push('archive.blocker');

  return {
    gate: 'archive',
    passed: missing.length === 0,
    status: missing.length === 0 ? 'passed' : 'not_ready',
    reason: missing.length === 0 ? 'archive_gate_met'
      : missing.includes('archive.finalization') ? 'archive_finalize_required'
      : 'archive_gate_not_ready',
    missingReasons: missing,
    blockers,
    userAction: missing.length === 0 ? '' : 'finalize_archive_or_inspect_blocker',
  };
}

function explicitDeleteGate(item = {}) {
  const gate = item.deleteGate || item.deletionGate;
  return gate && typeof gate === 'object' ? gate : null;
}

function evaluateDeleteGate(item = {}) {
  const gate = explicitDeleteGate(item);
  if (gate && gate.passed === true) {
    return {
      gate: 'delete',
      passed: true,
      status: 'passed',
      reason: gate.reason || 'delete_gate_met',
      target: gate.target || {},
      observed: gate.observed || {},
      evidenceLevel: 'explicit',
      userAction: '',
    };
  }
  if (gate && gate.passed === false) {
    return {
      gate: 'delete',
      passed: false,
      status: gate.status || 'failed',
      reason: gate.reason || 'delete_gate_failed',
      target: gate.target || {},
      observed: gate.observed || {},
      failureReasons: gate.failureReasons || ['explicit_delete_gate_failed'],
      evidenceLevel: 'explicit',
      userAction: 'inspect_delete_result_or_retry',
    };
  }
  if (item.deleted === true || item.removed === true || item.removedAt || item.deletedAt) {
    return {
      gate: 'delete',
      passed: true,
      status: 'passed',
      reason: 'delete_marker_present',
      target: {},
      observed: {
        deletedAt: item.deletedAt || item.removedAt || '',
        removed: true,
      },
      evidenceLevel: 'marker',
      userAction: '',
    };
  }
  return {
    gate: 'delete',
    passed: false,
    status: 'not_ready',
    reason: 'delete_not_requested',
    target: {},
    observed: {},
    missingReasons: ['delete.confirmed_result'],
    evidenceLevel: 'none',
    userAction: 'review_delete_candidate',
  };
}

module.exports = {
  evaluateIngestGate,
  evaluateOptimizeGate,
  evaluateArchiveGate,
  evaluateDeleteGate,
};
