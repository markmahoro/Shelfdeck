'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const DAY_MS = 86_400_000;
const CYCLE_MS = 60_000;

class WorkspaceCleanupContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceCleanupContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkspaceCleanupContractError(code, message, details);
}

function digestWithout(value, field) {
  return canonicalDigest(Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== field),
  ));
}

function controlItem(materialKey, projection) {
  const disposition = projection.controlState === 'uncontrolled'
    ? 'uncontrolled'
    : projection.ownerDomain === 'libra' ? 'libra_owned' : 'other_owned';
  return Object.freeze({
    materialKey,
    controlDisposition: disposition,
    controlRevision: projection.controlRevision,
    controlProjectionDigest: projection.projectionDigest,
    ownerDomain: projection.ownerDomain || null,
    ownerScopeType: projection.ownerScopeType || null,
    ownerScopeId: projection.ownerScopeId || null,
  });
}

function buildObservation(value) {
  const references = [...value.otherReferences].sort((left, right) =>
    Buffer.compare(Buffer.from(left.workspaceId), Buffer.from(right.workspaceId)) ||
    Buffer.compare(Buffer.from(left.referenceId), Buffer.from(right.referenceId)));
  const controls = [...value.controls].sort((left, right) =>
    Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
  const observation = {
    observedAtMs: value.observedAtMs,
    activeReferenceSetDigest: canonicalDigest({
      schema: 'libra.workspace-cleanup-other-reference-set@1',
      targetWorkspaceId: value.workspaceId,
      items: references,
    }),
    activeReferenceCount: references.length,
    controlProjectionSetDigest: canonicalDigest({
      schema: 'libra.workspace-cleanup-control-projection-set@1',
      items: controls,
    }),
  };
  observation.evidenceDigest = canonicalDigest(observation);
  return Object.freeze(observation);
}

function memberFromReference(reference, control) {
  const member = {
    materialHandleId: reference.materialHandleId,
    materialKey: reference.materialKey,
    workspaceReferenceId: reference.referenceId,
    expectedReferenceRevision: reference.referenceRevision,
    expectedReferenceDigest: reference.referenceDigest,
    controlDisposition: control.controlDisposition,
    expectedControlRevision: control.controlRevision,
    expectedControlProjectionDigest: control.controlProjectionDigest,
    expectedControlOwnerDomain: control.ownerDomain,
    expectedControlOwnerScopeType: control.ownerScopeType,
    expectedControlOwnerScopeId: control.ownerScopeId,
    cleanupKind: 'delete_or_verify_absent',
  };
  member.memberDigest = canonicalDigest(member);
  return Object.freeze(member);
}

function buildOffloadAdmission(value) {
  const found = value.triggerSnapshot;
  if (!found || found.resultKind !== 'found' ||
      found.onDeckPackageId !== value.onDeckPackageId ||
      found.packageDigest !== value.packageDigest) {
    fail('P14_CLEANUP_TRIGGER_INVALID',
      'Cleanup admission requires the exact found Off-load Completion projection.');
  }
  if (value.observation2.observedAtMs - value.observation1.observedAtMs < CYCLE_MS ||
      value.observation1.activeReferenceCount !== 0 ||
      value.observation2.activeReferenceCount !== 0) {
    fail('P14_CLEANUP_REFERENCE_AUDIT',
      'Cleanup requires two empty reference observations one cycle apart.');
  }
  const members = value.references.map((reference) => {
    const control = value.controls.find((item) =>
      item.materialKey === reference.materialKey);
    if (!control) {
      fail('P14_CLEANUP_CONTROL_MISSING',
        'Every cleanup member requires one current Control projection.');
    }
    return memberFromReference(reference, control);
  }).sort((left, right) =>
    Buffer.compare(Buffer.from(left.materialHandleId),
      Buffer.from(right.materialHandleId)));
  const memberSetDigest = canonicalDigest({
    schema: 'libra.workspace-cleanup-members@1',
    items: members,
  });
  const fact = found.offloadCompletionFact;
  const graceDeadlineMs = fact.committedAtMs;
  const triggerRef = fact.factId;
  const triggerRevision = found.projectionRevision;
  const triggerDigest = found.projectionDigest;
  const cleanupScopeId = canonicalDigest({
    schema: 'libra.workspace-cleanup-scope-id@1',
    triggerKind: 'offload_completed',
    triggerRef,
    triggerRevision,
    triggerDigest,
    workspaceId: value.workspaceRef.workspaceId,
  });
  const referenceAudit = {
    observation1: value.observation1,
    observation2: value.observation2,
  };
  const eligibilityEvidenceDigest = canonicalDigest({
    schema: 'libra.workspace-cleanup-eligibility@1',
    triggerKind: 'offload_completed',
    triggerSnapshot: found,
    libraRunRef: value.libraRunRef,
    workspaceRef: value.workspaceRef,
    graceDeadlineMs,
    referenceAudit,
  });
  const decisionId = canonicalDigest({
    schema: 'libra.workspace-cleanup-admission-decision-id@1',
    triggerRef,
    triggerRevision,
    triggerDigest,
    workspaceId: value.workspaceRef.workspaceId,
    memberSetDigest,
  });
  const decision = {
    decisionId,
    triggerKind: 'offload_completed',
    triggerSnapshot: found,
    libraRunRef: value.libraRunRef,
    workspaceRef: value.workspaceRef,
    graceDeadlineMs,
    referenceAudit,
    eligibilityEvidenceDigest,
    members,
    memberSetDigest,
    cleanupScopeId,
  };
  decision.decisionDigest = canonicalDigest(decision);
  return Object.freeze(decision);
}

function scopeState(value) {
  const state = {
    cleanupScopeId: value.cleanupScopeId,
    stateRevision: value.stateRevision,
    state: value.state,
    memberSetDigest: value.memberSetDigest,
    terminalMemberSetDigest: value.terminalMemberSetDigest,
  };
  if (value.completedAtMs !== null && value.completedAtMs !== undefined) {
    state.completedAtMs = value.completedAtMs;
  }
  return Object.freeze({ ...state, stateDigest: canonicalDigest({
    schema: 'libra.workspace-cleanup-scope-state@1',
    ...state,
  }) });
}

function memberState(value) {
  const basis = {
    schema: 'libra.workspace-cleanup-member-state@1',
    cleanupScopeId: value.cleanupScopeId,
    materialHandleId: value.materialHandleId,
    stateRevision: value.stateRevision,
    state: value.state,
    outcomeEvidenceDigest: value.outcomeEvidenceDigest || null,
    cleanupReceiptId: value.cleanupReceiptId || null,
  };
  if (value.committedControlRevision !== null &&
      value.committedControlRevision !== undefined) {
    basis.committedControlRevision = value.committedControlRevision;
  }
  return canonicalDigest(basis);
}

function buildEffectIntent(scope, member, handle) {
  const controlFence = {
    controlDisposition: member.controlDisposition,
    expectedControlRevision: member.expectedControlRevision,
    expectedControlProjectionDigest: member.expectedControlProjectionDigest,
    expectedControlOwnerDomain: member.expectedControlOwnerDomain,
    expectedControlOwnerScopeType: member.expectedControlOwnerScopeType,
    expectedControlOwnerScopeId: member.expectedControlOwnerScopeId,
  };
  const effectMode = member.controlDisposition === 'other_owned'
    ? 'verify_absent_only' : 'delete_or_verify_absent';
  const identity = {
    schema: 'libra.workspace-cleanup-effect-intent-id@1',
    cleanupScopeId: scope.cleanupScopeId,
    workspaceId: scope.workspaceId,
    materialHandleId: member.materialHandleId,
    expectedReferenceRevision: member.expectedReferenceRevision,
    expectedReferenceDigest: member.expectedReferenceDigest,
    controlFence,
    effectMode,
  };
  const intent = {
    intentId: canonicalDigest(identity),
    cleanupScopeId: scope.cleanupScopeId,
    workspaceId: scope.workspaceId,
    materialHandleId: member.materialHandleId,
    expectedWorkspaceHandleDigest: canonicalDigest(handle),
    expectedReferenceRevision: member.expectedReferenceRevision,
    expectedReferenceDigest: member.expectedReferenceDigest,
    controlFence,
    effectMode,
    containmentFenceDigest: canonicalDigest({
      schema: 'libra.workspace-cleanup-containment-fence@1',
      workspaceId: scope.workspaceId,
      materialHandleId: member.materialHandleId,
      rootHandleRef: handle.rootHandleRef,
      relativePath: handle.relativePath,
      fenceDigest: handle.fenceDigest,
    }),
  };
  intent.idempotencyKey = intent.intentId;
  intent.intentDigest = canonicalDigest(intent);
  return Object.freeze(intent);
}

function buildCommitDecision(value) {
  const evidence = value.deletionEvidence;
  const outcome = { kind: 'deletion_verified', deletionEvidence: evidence };
  const outcomeEvidenceDigest = evidence.evidenceDigest;
  const decision = {
    decisionId: canonicalDigest({
      schema: 'libra.workspace-cleanup-commit-decision-id@1',
      cleanupScopeId: value.scope.cleanupScopeId,
      materialHandleId: value.member.materialHandleId,
      expectedMemberStateRevision: value.member.stateRevision,
      outcomeEvidenceDigest,
    }),
    cleanupScopeId: value.scope.cleanupScopeId,
    expectedScopeStateRevision: value.scope.stateRevision,
    expectedScopeStateDigest: value.scope.stateDigest,
    workspaceId: value.scope.workspaceId,
    expectedWorkspaceRevision: value.workspace.currentRevision,
    expectedWorkspaceStateDigest: value.workspace.stateDigest,
    materialHandleId: value.member.materialHandleId,
    expectedReferenceRevision: value.member.expectedReferenceRevision,
    expectedReferenceDigest: value.member.expectedReferenceDigest,
    expectedMemberStateRevision: value.member.stateRevision,
    expectedMemberStateDigest: value.member.stateDigest,
    outcome,
    expectedControlFence: {
      materialKey: value.member.materialKey,
      controlDisposition: value.member.controlDisposition,
      revision: value.member.expectedControlRevision,
      projectionDigest: value.member.expectedControlProjectionDigest,
      ownerDomain: value.member.expectedControlOwnerDomain,
      ownerScopeType: value.member.expectedControlOwnerScopeType,
      ownerScopeId: value.member.expectedControlOwnerScopeId,
    },
  };
  decision.decisionDigest = canonicalDigest(decision);
  return Object.freeze(decision);
}

module.exports = Object.freeze({
  CYCLE_MS,
  DAY_MS,
  WorkspaceCleanupContractError,
  buildCommitDecision,
  buildEffectIntent,
  buildObservation,
  buildOffloadAdmission,
  controlItem,
  digestWithout,
  memberFromReference,
  memberState,
  scopeState,
});
