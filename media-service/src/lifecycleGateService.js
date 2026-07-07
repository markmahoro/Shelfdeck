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

  const sourceFreshness = item.factsFreshness && item.factsFreshness.sourceFacts;
  if (sourceFreshness && ['stale', 'invalidated', 'blocked', 'refreshing'].includes(normalize(sourceFreshness.status))) {
    return {
      gate: 'ingest',
      passed: false,
      status: normalize(sourceFreshness.status) || 'stale',
      reason: sourceFreshness.staleReason || 'source_facts_stale',
      missingReasons: ['source.facts_stale'],
      freshness: sourceFreshness,
      userAction: 'refresh_source_facts',
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

function explicitOptimizeGate(item = {}) {
  const gate = item.optimizeGate || item.optimizationGate;
  return gate && typeof gate === 'object' ? gate : null;
}

function resolveOptimizeFlowKind(item = {}, gate = null) {
  const status = normalize(item.optimizationStatus);

  if (gate && gate.flowKind) return normalize(gate.flowKind);
  if (gate && gate.appliedFlowKind) return normalize(gate.appliedFlowKind);
  if (status === 'transcoded') return 'transcode';
  if (status === 'upgraded') return 'upgrade';
  return null;
}

function resolveOptimizeTarget(item = {}, gate = null) {
  const target = gate && gate.target && typeof gate.target === 'object' ? gate.target : {};
  return {
    bitrateMbps: normalizeBitrateMbps(target.bitrateMbps || target.targetBitrate || item.targetBitrate),
    codec: normalizeCodec(target.codec || target.targetCodec || item.targetCodec),
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

function optimizeGateResult({ passed, status, reason, flowKind, target, observed, failureReasons, evidenceLevel }) {
  return {
    gate: 'optimize',
    passed: !!passed,
    status,
    reason,
    flowKind: flowKind || null,
    target: target || {},
    observed: observed || {},
    failureReasons: failureReasons || [],
    evidenceLevel: evidenceLevel || '',
    retryPolicy: passed ? { automaticRetry: false, manualRetryAllowed: false, reason: '' } : optimizeRetryPolicy(reason),
    userAction: passed ? '' : 'inspect_optimize_result_or_request_manual_retry',
  };
}

function isBlockingFreshnessStatus(value) {
  return ['stale', 'invalidated', 'blocked', 'refreshing'].includes(normalize(value));
}

function hasPendingCanonicalRefresh(item = {}, gate = {}) {
  if (!gate || normalize(gate.status) !== 'pending_canonical_refresh') return false;
  const freshness = item.factsFreshness && typeof item.factsFreshness === 'object'
    ? item.factsFreshness
    : {};
  return isBlockingFreshnessStatus(freshness.sourceFacts && freshness.sourceFacts.status)
    || isBlockingFreshnessStatus(freshness.mediaFacts && freshness.mediaFacts.status)
    || isBlockingFreshnessStatus(freshness.metadataFacts && freshness.metadataFacts.status);
}

function hasOptimizeDoneMarker(item = {}, flowKind = '') {
  const status = normalize(item.optimizationStatus);
  if (flowKind === 'transcode') return status === 'transcoded' || !!item.lastTranscodeDoneAt;
  if (flowKind === 'upgrade') return status === 'upgraded' || !!item.lastUpgradeDoneAt;
  return false;
}

function targetFailures(flowKind, target, observed) {
  const failures = [];
  const bitrateTolerance = flowKind === 'upgrade'
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
  let flowKind = resolveOptimizeFlowKind(item, gate);
  const target = resolveOptimizeTarget(item, gate);
  const observed = resolveOptimizeObserved(item, gate);

  if (hasPendingCanonicalRefresh(item, gate)) {
    return optimizeGateResult({
      passed: false,
      status: 'pending_canonical_refresh',
      reason: gate.reason || 'canonical_facts_stale_after_optimize',
      flowKind,
      target,
      observed,
      failureReasons: ['canonical_facts_stale'],
      evidenceLevel: 'staged',
    });
  }

  if (gate && gate.passed === false && normalize(gate.status) !== 'pending_canonical_refresh') {
    const failureReasons = Array.isArray(gate.failureReasons) && gate.failureReasons.length > 0
      ? gate.failureReasons
      : ['explicit_optimize_gate_failed'];
    return optimizeGateResult({
      passed: false,
      status: normalize(gate.status) || 'failed',
      reason: gate.reason || 'optimize_gate_failed',
      flowKind,
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
      flowKind,
      target,
      observed,
      evidenceLevel: 'explicit',
    });
  }

  const projectedObjective = item.optimizeObjective || (item.targetMediaFacts && typeof item.targetMediaFacts === 'object'
    ? {
      kind: 'target_media_facts',
      targetMediaFacts: item.targetMediaFacts,
      targetBitrate: item.targetBitrate,
      targetCodec: item.targetCodec,
      maxSizeGB: item.maxSizeGB,
      seedPreferences: item.seedPreferences,
    }
    : null);
  if (projectedObjective && item.optimizeObjectiveStatus !== 'pending_metadata') {
    const selection = flowPlanner.selectOptimizeFlow({
      itemInfo: item,
      optimizeObjective: projectedObjective,
      optimizeObjectiveStatus: item.optimizeObjectiveStatus,
      objectiveHash: item.objectiveHash,
    });
    if (selection.flowKind === 'no_op') {
      return optimizeGateResult({
        passed: true,
        status: 'passed',
        reason: 'objective_already_satisfied',
        flowKind: 'no_op',
        target: selection.targetFacts,
        observed: selection.currentFacts,
        evidenceLevel: 'objective',
      });
    }
    if (!flowKind && selection.allowed && ['transcode', 'upgrade'].includes(selection.flowKind)) {
      flowKind = selection.flowKind;
    }
  }

  if (!flowKind || flowKind === 'none') {
    return optimizeGateResult({
      passed: false,
      status: 'pending',
      reason: 'strategy_missing',
      flowKind: null,
      target,
      observed,
      failureReasons: ['strategy_missing'],
      evidenceLevel: 'none',
    });
  }

  if (flowKind === 'delete') {
    return optimizeGateResult({
      passed: false,
      status: 'blocked',
      reason: 'delete_gate_required',
      flowKind: null,
      target,
      observed,
      failureReasons: ['delete_is_not_optimize'],
      evidenceLevel: 'contract',
    });
  }

  if (['transcode', 'upgrade'].includes(flowKind) && !hasOptimizeDoneMarker(item, flowKind)) {
    return optimizeGateResult({
      passed: false,
      status: 'pending',
      reason: 'optimize_not_attempted',
      flowKind,
      target,
      observed,
      failureReasons: ['optimize_result_missing'],
      evidenceLevel: 'none',
    });
  }

  const failures = targetFailures(flowKind, target, observed);
  if (failures.length > 0) {
    return optimizeGateResult({
      passed: false,
      status: 'failed',
      reason: 'optimize_gate_failed',
      flowKind,
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
    flowKind,
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
