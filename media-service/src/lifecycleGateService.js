'use strict';

const optimizeGapAnalyzer = require('./optimizeGapAnalyzer');

function clean(value) { return value == null ? '' : String(value).trim(); }
function normalize(value) { return clean(value).toLowerCase(); }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function normalizeCodec(value) {
  const raw = normalize(value).replace(/[^a-z0-9]/g, '');
  if (['h265', 'x265', 'hevc'].includes(raw)) return 'h265';
  if (['h264', 'x264', 'avc', 'avc1'].includes(raw)) return 'h264';
  return raw;
}

function basedataRequiredFactsMissing(item = {}) {
  if (item.playable === false) return [];
  const facts = item.basedataFacts && typeof item.basedataFacts === 'object' ? item.basedataFacts : item;
  const missing = [];
  if (!clean(facts.path || item.path)) missing.push('basedata.path');
  if (numberOrNull(facts.size || item.size) == null) missing.push('basedata.size');
  if (numberOrNull(facts.duration || item.duration) == null) missing.push('basedata.duration');
  if (numberOrNull(facts.bitrate || item.bitrate) == null) missing.push('basedata.bitrate');
  if (!clean(facts.resolution || item.resolution)) missing.push('basedata.resolution');
  if (!normalizeCodec(facts.codec || facts.videoCodec || item.codec || item.videoCodec)) missing.push('basedata.codec');
  return missing;
}

function evaluateBasedataGate(item = {}) {
  const freshness = item.factsFreshness && item.factsFreshness.basedataFacts || {};
  const sourceRevision = String(item.basedataSourceRevision || '');
  const admissionSourceRevision = String(item.admissionSourceRevision || item.currentSourceRevision || sourceRevision);
  const current = !!sourceRevision && sourceRevision === admissionSourceRevision;
  const fresh = !['stale', 'invalidated', 'blocked', 'refreshing', 'unknown'].includes(normalize(freshness.status));
  const requiredMissing = basedataRequiredFactsMissing(item);
  const contractBlocked = item.basedataComplete === true && current && fresh && requiredMissing.length > 0;
  const passed = item.basedataComplete === true && current && fresh && requiredMissing.length === 0;
  return {
    gate: 'basedata', passed,
    status: passed ? 'passed' : contractBlocked ? 'blocked' : fresh ? 'missing' : normalize(freshness.status) || 'missing',
    reason: passed ? 'basedata_gate_met' : contractBlocked ? 'basedata_required_facts_missing' : !current ? 'basedata_source_revision_stale' : 'basedata_missing_or_stale',
    missingReasons: passed ? [] : contractBlocked ? requiredMissing : [!current ? 'basedata.sourceRevision' : 'basedata.facts'],
    freshness,
    userAction: passed ? '' : 'observe_basedata',
  };
}

function projectedOptimizeObjective(item = {}) {
  return item.optimizeObjective || (item.targetMediaFacts && typeof item.targetMediaFacts === 'object'
    ? { kind: 'target_media_facts', targetMediaFacts: item.targetMediaFacts }
    : null);
}

function evaluateOptimizeGate(item = {}) {
  const pendingRefresh = !!(item.optimizeGate && item.optimizeGate.status === 'pending_canonical_refresh');
  if (pendingRefresh) return { gate: 'optimize', passed: false, status: 'pending_canonical_refresh', reason: 'canonical_facts_stale_after_optimize', failureReasons: ['canonical_facts_stale'], evidenceLevel: 'staged' };
  const objective = projectedOptimizeObjective(item);
  if (!objective || item.optimizeObjectiveStatus === 'pending_metadata') return { gate: 'optimize', passed: false, status: 'pending', reason: 'objective_not_ready', failureReasons: ['objective_not_ready'], evidenceLevel: 'none' };
  const selection = optimizeGapAnalyzer.analyze({ itemInfo: item, optimizeObjective: objective, optimizeObjectiveStatus: item.optimizeObjectiveStatus, objectiveHash: item.objectiveHash });
  if (selection.satisfied) return { gate: 'optimize', passed: true, status: 'passed', reason: selection.reason, target: selection.targetFacts, observed: selection.currentFacts, failureReasons: [], evidenceLevel: 'objective' };
  if (selection.status === 'blocked') return { gate: 'optimize', passed: false, status: 'blocked', reason: selection.reason || 'objective_not_plannable', target: selection.targetFacts, observed: selection.currentFacts, failureReasons: (selection.gap || []).map((gap) => gap.reason), evidenceLevel: 'objective' };
  return { gate: 'optimize', passed: false, status: 'not_passed', reason: 'objective_not_satisfied', target: selection.targetFacts, observed: selection.currentFacts, objectiveGap: selection.gap || [], failureReasons: [...new Set(['objective_not_satisfied', ...(selection.gap || []).map((gap) => gap.reason)])], evidenceLevel: 'objective' };
}

module.exports = { evaluateBasedataGate, evaluateOptimizeGate, basedataRequiredFactsMissing };
