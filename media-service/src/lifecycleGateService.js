'use strict';

const flowPlanner = require('./flowPlanner');
const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');

function clean(value) {
  return value == null ? '' : String(value).trim();
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

function evaluateBasedataGate(item = {}) {
  const freshness = item.factsFreshness && item.factsFreshness.basedataFacts || {};
  const sourceRevision = String(item.basedataSourceRevision || '');
  const admissionSourceRevision = String(item.admissionSourceRevision || item.currentSourceRevision || sourceRevision);
  const current = !!sourceRevision && sourceRevision === admissionSourceRevision;
  const fresh = !['stale', 'invalidated', 'blocked', 'refreshing', 'unknown'].includes(normalize(freshness.status));
  const passed = item.basedataComplete === true && current && fresh;
  return {
    gate: 'basedata',
    passed,
    status: passed ? 'passed' : fresh ? 'missing' : normalize(freshness.status) || 'missing',
    reason: passed ? 'basedata_gate_met' : !current ? 'basedata_source_revision_stale' : 'basedata_missing_or_stale',
    missingReasons: passed ? [] : [!current ? 'basedata.sourceRevision' : 'basedata.facts'],
    freshness,
    userAction: passed ? '' : 'observe_basedata',
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
  const projectedObjective = projectedOptimizeObjective(item);
  const bitrateProfile = target.bitrateProfile || bitrateObjectiveProfile.resolveBitrateProfile({
    objective: projectedObjective || { targetMediaFacts: item.targetMediaFacts || {} },
    item,
  });
  return {
    bitrateProfile,
    bitrateMbps: bitrateProfile ? bitrateProfile.targetMbps : normalizeBitrateMbps(target.bitrateMbps),
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

function targetFailures(_flowKind, target, observed) {
  const failures = [];

  if (target.bitrateProfile && observed.bitrateMbps != null) {
    const comparison = bitrateObjectiveProfile.compareBitrateToProfile(observed.bitrateMbps, target.bitrateProfile);
    if (comparison.status === 'below') failures.push('bitrate_below_range');
    if (comparison.status === 'above') failures.push('bitrate_above_range');
  }
  if (target.codec && observed.codec && target.codec !== observed.codec) {
    failures.push('target_codec_not_met');
  }
  return failures;
}

function projectedOptimizeObjective(item = {}) {
  return item.optimizeObjective || (item.targetMediaFacts && typeof item.targetMediaFacts === 'object'
    ? {
      kind: 'target_media_facts',
      targetMediaFacts: item.targetMediaFacts,
      targetCodec: item.targetCodec,
      maxSizeGB: item.maxSizeGB,
      seedPreferences: item.seedPreferences,
    }
    : null);
}

function gapFailureReasons(selection = {}) {
  const reasons = ['objective_not_satisfied'];
  for (const gap of selection.gap || []) {
    if (gap && gap.reason && !reasons.includes(gap.reason)) reasons.push(gap.reason);
  }
  if (selection.reason && !reasons.includes(selection.reason)) reasons.push(selection.reason);
  if (selection.blockedReason && !reasons.includes(selection.blockedReason)) reasons.push(selection.blockedReason);
  return reasons;
}

function gateBlockedReasonForSelection(selection = {}) {
  const reason = normalize(selection.reason);
  const blockedReason = normalize(selection.blockedReason);
  if (reason === 'objective_not_ready') return 'objective_not_ready';
  if (reason === 'facts_missing' || blockedReason === 'needs_metadata_repair') return 'blocked_by_missing_or_stale_facts';
  if (reason === 'objective_not_plannable' || blockedReason === 'objective_gap_unknown') return 'objective_not_plannable';
  if (reason === 'unsupported_objective' || blockedReason === 'unsupported_target_codec') return 'unsupported_objective';
  return '';
}

function evaluateOptimizeGate(item = {}) {
  const gate = explicitOptimizeGate(item);
  let flowKind = resolveOptimizeFlowKind(item, gate);
  const target = resolveOptimizeTarget(item, gate);
  const observed = resolveOptimizeObserved(item, gate);
  const projectedObjective = projectedOptimizeObjective(item);

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

  if (gate && gate.passed === true && (!projectedObjective || item.optimizeObjectiveStatus !== 'ready' || normalize(projectedObjective.kind) === 'optimize_strategy_pending')) {
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

  if (projectedObjective && item.optimizeObjectiveStatus !== 'pending_metadata') {
    const selection = flowPlanner.selectOptimizeFlow({
      itemInfo: item,
      optimizeObjective: projectedObjective,
      optimizeObjectiveStatus: item.optimizeObjectiveStatus,
      objectiveHash: item.objectiveHash,
      allowedOptimizeFlowKinds: item.allowedOptimizeFlowKinds,
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
    if (selection.allowed && ['transcode', 'upgrade'].includes(selection.flowKind)) {
      flowKind = selection.flowKind;
      return optimizeGateResult({
        passed: false,
        status: 'not_passed',
        reason: 'objective_not_satisfied',
        flowKind,
        target: selection.targetFacts,
        observed: selection.currentFacts,
        failureReasons: gapFailureReasons(selection),
        evidenceLevel: 'objective',
      });
    }
    if (selection.flowKind === 'blocked') {
      const gateBlockedReason = gateBlockedReasonForSelection(selection);
      if (!gateBlockedReason) {
        return optimizeGateResult({
          passed: false,
          status: 'not_passed',
          reason: 'objective_not_satisfied',
          flowKind: null,
          target: selection.targetFacts,
          observed: selection.currentFacts,
          failureReasons: gapFailureReasons(selection),
          evidenceLevel: 'objective',
        });
      }
      return optimizeGateResult({
        passed: false,
        status: 'blocked',
        reason: gateBlockedReason,
        flowKind: null,
        target: selection.targetFacts,
        observed: selection.currentFacts,
        failureReasons: gapFailureReasons(selection),
        evidenceLevel: 'objective',
      });
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
      status: 'not_passed',
      reason: 'objective_not_satisfied',
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
    reason: target.bitrateMbps || target.codec ? 'optimize_gate_met' : 'optimize_noop_result_valid',
    flowKind,
    target,
    observed,
    evidenceLevel: target.bitrateMbps || target.codec ? 'objective_or_marker' : 'marker',
  });
}

module.exports = {
  evaluateBasedataGate,
  evaluateOptimizeGate,
};
