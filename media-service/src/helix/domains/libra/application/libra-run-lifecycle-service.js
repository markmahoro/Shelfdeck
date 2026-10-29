'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildRunLifecycleDecision } = require('../model/run-lifecycle-contracts');
const { createRunLifecycleStore } = require('../persistence/run-lifecycle-store');

class LibraRunLifecycleServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraRunLifecycleServiceError';
    this.code = code;
    this.details = details;
  }
}

function createLibraRunLifecycleService(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new LibraRunLifecycleServiceError(
      'LIBRA_RUN_LIFECYCLE_DEPENDENCIES',
      'Libra Run lifecycle service requires Owner persistence.',
    );
  }
  const store = createRunLifecycleStore(options);
  const now = options.now || Date.now;

  function commit(assessmentResult, transitionKind, readFence) {
    const evidence = assessmentResult.assessment;
    const decision = buildRunLifecycleDecision({
      libraRunId: evidence.libraRunId,
      expectedStateRevision: evidence.expectedState.stateRevision,
      expectedStateDigest: evidence.expectedState.stateDigest,
      transitionKind,
      transitionEvidence: evidence,
      expectedAdmissionHeadRevision:
        assessmentResult.admissionHead.headRevision,
      expectedActiveScopeSetDigest:
        assessmentResult.admissionHead.activeScopeSetDigest,
    });
    const committed = store.transition({
      decision, readFence,
      commitMarker: canonicalDigest({
        schema: 'libra.run-freshness-marker@1',
        decisionDigest: decision.decisionDigest,
      }),
      resultId: canonicalDigest({
        schema: 'libra.run-freshness-result-id@1',
        decisionId: decision.decisionId,
      }),
    });
    options.libraRunExecutionProjection?.invalidate(evidence.libraRunId);
    options.wake?.();
    return Object.freeze({
      kind: transitionKind,
      libraRunId: evidence.libraRunId,
      assessment: evidence,
      result: committed.result,
      replayed: committed.replayed,
    });
  }

  function reconcile(libraRunId, {readFence = null} = {}) {
    const assessed = store.assess({ libraRunId, assessedAtMs: now() });
    if (assessed.kind !== 'assessment') return assessed;
    const evidence = assessed.assessment;
    if (evidence.comparison === 'changed') {
      return Object.freeze({
        kind: 'replacement_required',
        libraRunId,
        subjectId: evidence.originalBasis.subjectId,
        assessment: evidence,
      });
    }
    if (evidence.expectedState.state === 'active') {
      if (evidence.readiness === 'unresolved') return commit(assessed, 'suspend', readFence);
      if (!assessed.latestFreshnessAssessmentId) {
        return commit(assessed, 'freshness_confirmed', readFence);
      }
      return Object.freeze({ kind:'ready', libraRunId, assessment:evidence });
    }
    if (evidence.readiness === 'ready') return commit(assessed, 'resume', readFence);
    return commit(
      assessed,
      evidence.recoveryEpisode.attemptOrdinal === 5
        ? 'freeze' : 'recovery_reassessed', readFence,
    );
  }

  function commitTerminalFreeze(libraRunId, blockerKind, built, transitionKind = 'freeze', readFence = null) {
    if (built.kind !== 'terminal_evidence') return built;
    const decision = buildRunLifecycleDecision({
      libraRunId,
      expectedStateRevision: built.run.stateRevision,
      expectedStateDigest: built.run.stateDigest,
      transitionKind,
      transitionEvidence: built.evidence,
      expectedAdmissionHeadRevision: built.admissionHead.headRevision,
      expectedActiveScopeSetDigest: built.admissionHead.activeScopeSetDigest,
    });
    const committed = store.transition({
      decision, readFence,
      commitMarker: canonicalDigest({
        schema: 'libra.run-terminal-freeze-marker@1',
        decisionDigest: decision.decisionDigest,
      }),
      resultId: canonicalDigest({
        schema: 'libra.run-terminal-freeze-result-id@1',
        decisionId: decision.decisionId,
      }),
    });
    options.libraRunExecutionProjection?.invalidate(libraRunId);
    options.wake?.();
    return Object.freeze({
      kind: transitionKind === 'secondary_target' ? 'secondary_target' : 'frozen',
      libraRunId,
      blockerKind,
      terminalEvidence: built.evidence,
      result: committed.result,
      replayed: committed.replayed,
    });
  }

  function freezeFailedWork(libraRunId, workId, blockerKind, {readFence = null} = {}) {
    return commitTerminalFreeze(libraRunId, blockerKind, store.buildTerminalEvidence({
      libraRunId,
      workId,
      blockerKind,
      assessedAtMs: now(),
    }), 'freeze', readFence);
  }

  function freezeTerminalResult(libraRunId, workId, blockerKind, terminalResult, {readFence = null} = {}) {
    return commitTerminalFreeze(libraRunId, blockerKind, store.buildTerminalEvidence({
      libraRunId,
      workId,
      blockerKind,
      assessedAtMs: now(),
      terminalResult,
    }), 'freeze', readFence);
  }

  function enterSecondaryTarget(libraRunId, workId, terminalResult, {readFence = null} = {}) {
    return commitTerminalFreeze(libraRunId,'product_unachievable',store.buildTerminalEvidence({
      libraRunId,workId,blockerKind:'product_unachievable',assessedAtMs:now(),terminalResult
    }),'secondary_target',readFence);
  }
  return Object.freeze({ reconcile, freezeFailedWork, freezeTerminalResult, enterSecondaryTarget });
}

module.exports = Object.freeze({
  LibraRunLifecycleServiceError,
  createLibraRunLifecycleService,
});
