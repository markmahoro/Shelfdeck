'use strict';

const factsFreshnessService = require('./factsFreshnessService');

const POST_OPTIMIZE_REFRESH_REASON = 'post_optimize_replace';
const REFRESH_FACT_GROUPS = ['sourceFacts', 'mediaFacts', 'metadataFacts'];

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
      targetBitrate: verify.targetBitrate,
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
      targetBitrate: verify.targetBitrate || targetFacts.targetBitrate || undefined,
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

function recordPostOptimizeReplacement(libItem, task = {}, doneAt = '', flowKind = '') {
  if (!libItem || !libItem.itemId || !['transcode', 'upgrade'].includes(flowKind)) return libItem;

  const prefix = flowKind === 'transcode' ? 'Transcode' : 'Upgrade';
  libItem[`last${prefix}DoneAt`] = doneAt;
  libItem.optimizationStatus = 'pending_canonical_refresh';
  libItem.optimizeFlowKind = flowKind;
  libItem.optimizationDoneAt = doneAt;
  libItem.optimizationTaskId = task.id;
  libItem.optimizationResult = buildOptimizationResult(task, flowKind);
  libItem.optimizeGate = buildPendingOptimizeGate(task, doneAt, flowKind);
  libItem.optimizationGate = libItem.optimizeGate;

  const evidence = {
    source: 'post_optimize_flow',
    taskId: task.id || '',
    flowKind,
    objectiveHash: libItem.optimizeGate.target && libItem.optimizeGate.target.objectiveHash || '',
    stagedFacts: libItem.optimizeGate.stagedFacts || {},
  };
  factsFreshnessService.markStale(libItem.itemId, ['sourceFacts'], {
    now: doneAt,
    reason: POST_OPTIMIZE_REFRESH_REASON,
    source: flowKind,
    refreshTargetGate: 'ingest',
    evidence,
  });
  factsFreshnessService.markStale(libItem.itemId, ['mediaFacts', 'metadataFacts'], {
    now: doneAt,
    reason: POST_OPTIMIZE_REFRESH_REASON,
    source: flowKind,
    refreshTargetGate: 'metadata',
    evidence,
  });
  return libItem;
}

module.exports = {
  POST_OPTIMIZE_REFRESH_REASON,
  buildOptimizationResult,
  buildPendingOptimizeGate,
  recordPostOptimizeReplacement,
};
