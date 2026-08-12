'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const {
  memberFromReference,
  memberState,
  scopeState,
} = require('./workspace-cleanup-contracts');
const { workspaceStateDigest } = require('./workspace-material-reference-contracts');

const COMMAND_CONTRACT = 'libra.run-discard@1';
const COMMAND_RESULT_SCHEMA =
  'helix://contracts/application-types/LibraRunDiscardCommandResult/v1';
const RECEIPT_SCHEMA =
  'helix://contracts/application-types/LibraRunDiscardReceipt/v1';
const CLEANUP_RECORD_SCHEMA =
  'helix://contracts/application-types/WorkspaceCleanupScopeAdmissionRecord/v1';
const DIGEST = /^[a-f0-9]{64}$/;

class LibraRunDiscardContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraRunDiscardContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new LibraRunDiscardContractError(code, message, details);
}
function text(value, field) {
  if (typeof value !== 'string' || !value || value.length > 256) {
    fail('P9_DISCARD_TEXT', 'A bounded non-empty string is required.', { field });
  }
  return value;
}
function digest(value, field) {
  if (!DIGEST.test(value || '')) {
    fail('P9_DISCARD_DIGEST', 'A lowercase SHA-256 digest is required.', { field });
  }
  return value;
}
function revision(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('P9_DISCARD_REVISION', 'A positive revision is required.', { field });
  }
  return value;
}
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== field));
}
function utf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function buildRunDiscardCommand(value) {
  const command = {
    commandContract: COMMAND_CONTRACT,
    commandId: canonicalDigest({
      schema: 'libra.run-discard-decision-id@1',
      libraRunId: text(value?.libraRunId, 'libraRunId'),
      actorId: text(value?.actorId, 'actorId'),
      idempotencyKey: text(value?.idempotencyKey, 'idempotencyKey'),
    }),
    libraRunId: value.libraRunId,
    expectedRunStateRevision: revision(
      value.expectedRunStateRevision,
      'expectedRunStateRevision',
    ),
    expectedRunStateDigest: digest(
      value.expectedRunStateDigest,
      'expectedRunStateDigest',
    ),
    actorId: value.actorId,
    idempotencyKey: value.idempotencyKey,
  };
  command.commandDigest = canonicalDigest(command);
  return Object.freeze(command);
}

function assertRunDiscardCommand(value) {
  if (!value || value.commandContract !== COMMAND_CONTRACT) {
    fail('P9_DISCARD_COMMAND', 'Run Discard command contract is invalid.');
  }
  const expected = buildRunDiscardCommand(value);
  if (canonicalJson(expected) !== canonicalJson(value)) {
    fail('P9_DISCARD_COMMAND', 'Run Discard command identity or digest is invalid.');
  }
  return expected;
}

function buildResult(value) {
  const result = { ...value };
  result.resultDigest = canonicalDigest({
    schema: 'libra.run-discard-command-result@1',
    ...result,
  });
  return Object.freeze(result);
}

function buildOriginalInputControlScope(value) {
  const items = value.manifestMembers.map((member) => Object.freeze({
    materialKey: digest(member.materialKey, 'materialKey'),
    expectedControlRevision: revision(
      member.admittedControlRevision,
      'admittedControlRevision',
    ),
    expectedControlProjectionDigest: digest(
      member.admittedControlProjectionDigest,
      'admittedControlProjectionDigest',
    ),
    fromOwnerDomain: 'libra',
    fromOwnerScopeType: 'subject',
    fromOwnerScopeId: text(value.subjectId, 'subjectId'),
    operation: 'release',
  })).sort((left, right) => utf8(left.materialKey, right.materialKey));
  if (items.length < 1 || items.length > 1024 ||
      new Set(items.map((item) => item.materialKey)).size !== items.length) {
    fail('P9_DISCARD_INPUT_SCOPE', 'Run input Control scope must contain 1..1024 unique members.');
  }
  return Object.freeze({
    items: Object.freeze(items),
    scopeDigest: canonicalDigest({
      schema: 'libra.run-discard-input-control-scope@1',
      libraRunId: text(value.libraRunId, 'libraRunId'),
      runScopeDigest: digest(value.runScopeDigest, 'runScopeDigest'),
      items,
    }),
  });
}

function buildDiscardCleanupDraft(value) {
  const references = value.references || [];
  const emptyMemberSetDigest = canonicalDigest({
    schema: 'libra.workspace-cleanup-members@1',
    items: [],
  });
  if (references.length === 0) {
    return Object.freeze({
      draft: null,
      memberSetDigest: emptyMemberSetDigest,
      members: Object.freeze([]),
    });
  }
  if (!value.workspaceRef || references.length > 1024) {
    fail('P9_DISCARD_WORKSPACE_SCOPE', 'Discard cleanup requires one bounded Workspace scope.');
  }
  const controlByKey = new Map(value.controls.map((item) => [item.materialKey, item]));
  const members = references.map((reference) => {
    const control = controlByKey.get(reference.materialKey);
    if (!control) {
      fail('P9_DISCARD_WORKSPACE_CONTROL', 'Every Workspace reference requires a current Control projection.');
    }
    return memberFromReference(reference, control);
  }).sort((left, right) => utf8(left.materialHandleId, right.materialHandleId));
  if (new Set(members.map((item) => item.materialHandleId)).size !== members.length) {
    fail('P9_DISCARD_WORKSPACE_SCOPE', 'Workspace cleanup handles must be unique.');
  }
  const memberSetDigest = canonicalDigest({
    schema: 'libra.workspace-cleanup-members@1',
    items: members,
  });
  const cleanupScopeId = canonicalDigest({
    schema: 'libra.workspace-cleanup-scope-id@1',
    triggerKind: 'run_discarded',
    discardDecisionId: value.discardDecisionId,
    workspaceId: value.workspaceRef.workspaceId,
  });
  const triggerSnapshot = {
    discardDecisionId: value.discardDecisionId,
    expectedFrozenRunRevision: value.libraRunRef.stateRevision,
    expectedFrozenRunDigest: value.libraRunRef.stateDigest,
  };
  const eligibilityEvidenceDigest = canonicalDigest({
    schema: 'libra.workspace-cleanup-eligibility@1',
    triggerKind: 'run_discarded',
    triggerSnapshot,
    libraRunRef: value.libraRunRef,
    workspaceRef: value.workspaceRef,
    graceDeadlineMs: 0,
    referenceAudit: null,
  });
  const decisionId = canonicalDigest({
    schema: 'libra.workspace-cleanup-admission-decision-id@1',
    triggerKind: 'run_discarded',
    discardDecisionId: value.discardDecisionId,
    workspaceId: value.workspaceRef.workspaceId,
    memberSetDigest,
  });
  const draft = {
    decisionId,
    triggerKind: 'run_discarded',
    triggerSnapshot,
    libraRunRef: value.libraRunRef,
    workspaceRef: value.workspaceRef,
    graceDeadlineMs: 0,
    referenceAudit: null,
    eligibilityEvidenceDigest,
    members,
    memberSetDigest,
    cleanupScopeId,
  };
  draft.decisionDigest = canonicalDigest(draft);
  return Object.freeze({
    draft: Object.freeze(draft),
    memberSetDigest,
    members: Object.freeze(members),
  });
}

function buildRunDiscardDecision(value) {
  const command = assertRunDiscardCommand(value.command);
  const originalInputControlScope = buildOriginalInputControlScope({
    libraRunId: command.libraRunId,
    runScopeDigest: value.run.runScopeDigest,
    subjectId: value.run.subjectId,
    manifestMembers: value.manifestMembers,
  });
  const libraRunRef = Object.freeze({
    libraRunId: command.libraRunId,
    stateRevision: value.run.stateRevision,
    stateDigest: value.run.stateDigest,
    executionBasisDigest: value.run.executionBasisDigest,
  });
  const cleanup = buildDiscardCleanupDraft({
    discardDecisionId: command.commandId,
    libraRunRef,
    workspaceRef: value.workspaceRef || null,
    references: value.workspaceReferences || [],
    controls: value.workspaceControls || [],
  });
  const decision = {
    discardDecisionId: command.commandId,
    libraRunId: command.libraRunId,
    expectedRunStateRevision: command.expectedRunStateRevision,
    expectedRunStateDigest: command.expectedRunStateDigest,
    runScopeDigest: digest(value.run.runScopeDigest, 'runScopeDigest'),
    originalInputControlScope,
    workspaceCleanupMemberSetDigest: cleanup.memberSetDigest,
    actorId: command.actorId,
    idempotencyKey: command.idempotencyKey,
  };
  if (cleanup.draft) decision.workspaceCleanupScopeDraft = cleanup.draft;
  decision.decisionDigest = canonicalDigest(decision);
  return Object.freeze({ decision:Object.freeze(decision), cleanup });
}

function buildControlCommitHandle(decision, manifestDigest, commandDigest) {
  const expectedControlRevisions = decision.originalInputControlScope.items
    .map((item) => Object.freeze({
      materialKey: item.materialKey,
      revision: item.expectedControlRevision,
    }));
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
    schemaVersion: 1,
    handleId: canonicalDigest({
      schema: 'libra.run-discard-control-handle-id@1',
      discardDecisionId: decision.discardDecisionId,
      controlScopeDigest: decision.originalInputControlScope.scopeDigest,
    }),
    operationKind: 'release',
    ownerDomain: 'libra',
    processType: 'libra_run_discard',
    processId: decision.libraRunId,
    basisRef: {
      objectType: 'LibraRunDiscardDecision',
      objectId: decision.discardDecisionId,
      revision: 1,
      digest: decision.decisionDigest,
    },
    basisDigest: decision.decisionDigest,
    canonicalFactSetDigest: decision.originalInputControlScope.scopeDigest,
    bindingSetDigest: digest(manifestDigest, 'manifestDigest'),
    controlScopeDigest: decision.originalInputControlScope.scopeDigest,
    expectedControlRevisions,
    receiptContract: {
      receiptSchemaRef: RECEIPT_SCHEMA,
      controlRevisionSetSchemaRef: 'libra.run-discard-released-control-set@1',
    },
    eventFenceDigest: digest(commandDigest, 'commandDigest'),
  });
}

function initialCleanupState(draft) {
  const terminalMemberSetDigest = canonicalDigest({
    schema: 'libra.workspace-cleanup-terminal-member-states@1',
    cleanupScopeId: draft.cleanupScopeId,
    scopeStateRevision: 1,
    items: [],
  });
  return scopeState({
    cleanupScopeId: draft.cleanupScopeId,
    stateRevision: 1,
    state: 'active',
    memberSetDigest: draft.memberSetDigest,
    terminalMemberSetDigest,
    completedAtMs: null,
  });
}

function cleanupAdmissionRecord(draft) {
  return Object.freeze({
    ...without(draft, 'members'),
    memberCount: draft.members.length,
    memberSetDigest: draft.memberSetDigest,
  });
}

function nextWorkspaceState(workspaceRef, decisionDigest) {
  const next = {
    workspaceId: workspaceRef.workspaceId,
    workspaceRevision: workspaceRef.workspaceRevision + 1,
    state: 'reclaiming',
    workspaceMaterialReferenceSetDigest: workspaceRef.materialReferenceSetDigest,
    transitionKind: 'reclaiming',
    transitionEvidenceDigest: decisionDigest,
  };
  next.stateDigest = workspaceStateDigest(next);
  return Object.freeze(next);
}

function cleanupMemberInitialState(cleanupScopeId, member) {
  return memberState({
    cleanupScopeId,
    materialHandleId: member.materialHandleId,
    stateRevision: 1,
    state: 'pending',
  });
}

function buildDiscardReceipt(value) {
  const receipt = {
    schemaRef: RECEIPT_SCHEMA,
    schemaVersion: 1,
    receiptId: canonicalDigest({
      schema: 'libra.run-discard-receipt-id@1',
      discardDecisionId: value.decision.discardDecisionId,
    }),
    receiptKind: 'libra_run_discarded',
    ownerDomain: 'libra',
    scopeType: 'libra_run',
    scopeId: value.decision.libraRunId,
    scopeDigest: value.decision.decisionDigest,
    effectReceiptRef: null,
    committedAtMs: value.committedAtMs,
    discardDecisionId: value.decision.discardDecisionId,
    libraRunId: value.decision.libraRunId,
    committedRunStateRevision: value.committedRunStateRevision,
    releasedInputControlSetDigest: value.releasedInputControlSetDigest,
    cleanupScopeId: value.cleanupScopeId || null,
    cleanupMemberSetDigest: value.decision.workspaceCleanupMemberSetDigest,
  };
  receipt.commitDigest = canonicalDigest(receipt);
  return Object.freeze(receipt);
}

function buildCleanupRequestedMessage(decision, cleanupScopeId) {
  const identity = {
    schema: 'libra.workspace-cleanup-message-id@1',
    libraRunId: decision.libraRunId,
    triggerDigest: decision.decisionDigest,
    cleanupMemberSetDigest: decision.workspaceCleanupMemberSetDigest,
  };
  const messageId = canonicalDigest(identity);
  const message = {
    messageKind: 'libra.workspace-cleanup.requested@1',
    messageId,
    libraRunId: decision.libraRunId,
    cleanupMemberSetDigest: decision.workspaceCleanupMemberSetDigest,
    triggerDigest: decision.decisionDigest,
    dedupKey: messageId,
  };
  if (cleanupScopeId) message.cleanupScopeId = cleanupScopeId;
  return Object.freeze(message);
}

module.exports = Object.freeze({
  CLEANUP_RECORD_SCHEMA,
  COMMAND_RESULT_SCHEMA,
  LibraRunDiscardContractError,
  RECEIPT_SCHEMA,
  assertRunDiscardCommand,
  buildCleanupRequestedMessage,
  buildControlCommitHandle,
  buildDiscardReceipt,
  buildResult,
  buildRunDiscardCommand,
  buildRunDiscardDecision,
  cleanupAdmissionRecord,
  cleanupMemberInitialState,
  initialCleanupState,
  nextWorkspaceState,
});
