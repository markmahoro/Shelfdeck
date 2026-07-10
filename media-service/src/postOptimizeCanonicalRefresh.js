'use strict';

const kairoxStore = require('./kairoxStore');

const POST_OPTIMIZE_REFRESH_REASON = 'post_optimize_replace';
const REFRESH_FACT_GROUPS = ['basedataFacts'];

function gateObjectiveForTask(task = {}) {
  return task.taskTarget && task.taskTarget.gateObjective && typeof task.taskTarget.gateObjective === 'object'
    ? task.taskTarget.gateObjective
    : {};
}

function objectiveHashForTask(task = {}, verify = {}) {
  return verify.objectiveHash
    || task.objectiveHash
    || (task.itemInfo && task.itemInfo.objectiveHash)
    || '';
}

function targetFactsForObjective(objective = {}) {
  return objective.targetMediaFacts && typeof objective.targetMediaFacts === 'object'
    ? objective.targetMediaFacts
    : {};
}

function stagedFactsForVerify(verify = {}) {
  const staged = {
    sizeBytes: verify.sizeBytes,
    bitrateKbps: verify.bitrate,
    bitrateMbps: typeof verify.bitrate === 'number' ? verify.bitrate / 1000 : undefined,
    codec: verify.videoCodec,
    videoCodec: verify.videoCodec,
    audioCodec: verify.audioCodec,
    width: verify.width,
    height: verify.height,
    resolution: verify.width && verify.height ? `${verify.width}x${verify.height}` : undefined,
    durationSec: verify.durationSec,
    outputPath: verify.outputPath,
    bytesSaved: verify.bytesSaved,
  };
  Object.keys(staged).forEach((key) => {
    if (staged[key] === undefined || staged[key] === null || staged[key] === '') delete staged[key];
  });
  return staged;
}

function buildOptimizationResult(task = {}, flowKind = '') {
  const verify = task.verifyResult && typeof task.verifyResult === 'object' ? task.verifyResult : {};
  return {
    flowKind,
    objectiveHash: objectiveHashForTask(task, verify),
    stagedFacts: stagedFactsForVerify(verify),
    verifyEvidence: {
      outputPath: verify.outputPath || '',
      objectiveHash: objectiveHashForTask(task, verify),
      targetMbps: verify.targetMbps,
      targetCodec: verify.targetCodec,
      minResolution: verify.minResolution,
    },
  };
}

function buildPendingOptimizeGate(task = {}, doneAt = '', flowKind = '') {
  const verify = task.verifyResult && typeof task.verifyResult === 'object' ? task.verifyResult : {};
  const objective = gateObjectiveForTask(task);
  const targetFacts = targetFactsForObjective(objective);
  const stagedFacts = stagedFactsForVerify(verify);
  return {
    gate: 'optimize',
    passed: false,
    status: 'pending_canonical_refresh',
    reason: 'canonical_facts_stale_after_optimize',
    flowKind,
    target: {
      objectiveHash: objectiveHashForTask(task, verify),
      ...targetFacts,
      targetMbps: verify.targetMbps || undefined,
      targetCodec: verify.targetCodec || targetFacts.targetCodec || targetFacts.codec || undefined,
      minResolution: verify.minResolution || targetFacts.minResolution || undefined,
    },
    observed: stagedFacts,
    stagedFacts,
    evidence: {
      taskId: task.id || '',
      flowKind,
      completedAt: doneAt,
      verifyResult: verify,
    },
    factRefreshRequest: {
      reason: POST_OPTIMIZE_REFRESH_REASON,
      causedByTaskId: task.id || '',
      affectedFacts: REFRESH_FACT_GROUPS,
      stagedFacts,
      evidence: {
        outputPath: verify.outputPath || '',
        objectiveHash: objectiveHashForTask(task, verify),
      },
    },
    failureReasons: ['canonical_facts_stale'],
    evidenceLevel: 'staged',
    retryPolicy: {
      automaticRetry: false,
      manualRetryAllowed: false,
      reason: 'awaiting_canonical_fact_refresh',
    },
    userAction: 'refresh_canonical_facts',
    completedAt: doneAt,
  };
}

function recordPostOptimizeReplacement(task = {}, doneAt = '', flowKind = '', store = kairoxStore) {
  if (!task.itemId || !['transcode', 'upgrade'].includes(flowKind)) return null;
  const completedAt = doneAt || new Date().toISOString();
  const optimizeGate = buildPendingOptimizeGate(task, completedAt, flowKind);
  const optimizationResult = buildOptimizationResult(task, flowKind);
  const evidence = {
    source: 'post_optimize_flow',
    taskId: task.id || '',
    flowKind,
    objectiveHash: optimizeGate.target && optimizeGate.target.objectiveHash || '',
    stagedFacts: optimizeGate.stagedFacts || {},
  };
  const optimize = store.publishOptimize({
    itemId: task.itemId,
    objectiveRevision: evidence.objectiveHash,
    facts: { passed: true, flowKind, optimizationResult },
    evidence,
    verifiedAt: completedAt,
    updatedAt: completedAt,
  });
  store.markBasedataStale({ itemId: task.itemId, reason: POST_OPTIMIZE_REFRESH_REASON, updatedAt: completedAt });
  const refreshRequest = store.requestRefresh({
    itemId: task.itemId,
    factGroup: 'basedata',
    sourceRevision: task.helixAdmission && task.helixAdmission.sourceRevision || '',
    reason: POST_OPTIMIZE_REFRESH_REASON,
    causedByTaskId: task.id || '',
    evidence,
    updatedAt: completedAt,
  });
  return { optimize, optimizeGate, refreshRequest };
}

module.exports = {
  POST_OPTIMIZE_REFRESH_REASON,
  buildOptimizationResult,
  buildPendingOptimizeGate,
  recordPostOptimizeReplacement,
};
