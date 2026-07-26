'use strict';

const crypto = require('crypto');
const { buildDomainInputSchemas } = require('./domain-input-schema-builder');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/application-types/${name}/v1`;
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const positive = () => ({ type: 'integer', minimum: 1 });
const nonNegative = () => ({ type: 'integer', minimum: 0 });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...options
});

function productDeliveryQuery() {
  return {
    $schema: DRAFT,
    $id: typeId('ProductDeliveryQuery'),
    title: 'ProductDeliveryQuery@1',
    'x-helix-ssotRefs': ['8.2.2', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      queryContract: { const: 'libra.product-delivery@1' },
      readPurpose: { type: 'string', enum: ['historical', 'acceptance_fence'] },
      offerId: id(),
      onDeckPackageId: id(),
      expectedPackageRevision: positive(),
      expectedPackageDigest: digest()
    })
  };
}

function deliveryFence() {
  return object({
    eligibility: { type: 'string', enum: ['eligible', 'ineligible'] },
    reasonCode: { type: 'string', enum: [
      'run_not_active', 'spec_not_current', 'package_not_current', 'delivery_already_terminal', 'control_not_libra'
    ] },
    libraRunId: id(),
    runState: { type: 'string', enum: ['active', 'suspended', 'superseded', 'frozen', 'completed', 'discarded'] },
    runStateRevision: positive(),
    runStateDigest: digest(),
    acceptanceSpecId: id(),
    packageRevisionHead: nonNegative(),
    deliveryReceiptAbsent: { type: 'boolean' },
    productControlSetDigest: digest(),
    fenceDigest: digest()
  }, [
    'eligibility', 'libraRunId', 'runState', 'runStateRevision', 'runStateDigest', 'acceptanceSpecId',
    'packageRevisionHead', 'deliveryReceiptAbsent', 'fenceDigest'
  ], {
    allOf: [{
      if: { properties: { eligibility: { const: 'eligible' } } },
      then: {
        properties: { runState: { const: 'active' }, deliveryReceiptAbsent: { const: true } },
        not: { required: ['reasonCode'] }
      },
      else: { required: ['reasonCode'] }
    }]
  });
}

function productDeliveryReadResult() {
  const found = object({
    resultKind: { const: 'found' },
    onDeckProductPackage: { $ref: 'helix://contracts/types/OnDeckProductPackage/v1' },
    deliveryFence: { oneOf: [deliveryFence(), { type: 'null' }] },
    readDigest: digest()
  });
  const notFound = object({
    resultKind: { const: 'not_found' },
    reasonCode: { const: 'package_missing' },
    checkedAtMs: nonNegative()
  });
  return {
    $schema: DRAFT,
    $id: typeId('ProductDeliveryReadResult'),
    title: 'ProductDeliveryReadResult@1',
    'x-helix-ssotRefs': ['8.2.2', '8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024 * 1024,
    oneOf: [found, notFound]
  };
}

function workspaceCleanupScopeQuery() {
  const readSelector = object({
    kind: { type: 'string', enum: ['current', 'revision'] },
    revision: positive()
  }, ['kind'], {
    allOf: [{
      if: { properties: { kind: { const: 'revision' } } },
      then: { required: ['revision'] },
      else: { not: { required: ['revision'] } }
    }]
  });
  return {
    $schema: DRAFT,
    $id: typeId('WorkspaceCleanupScopeQuery'),
    title: 'WorkspaceCleanupScopeQuery@1',
    'x-helix-ssotRefs': ['8.1.4', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      queryContract: { const: 'libra.workspace-reclamation.scope@1' },
      cleanupScopeId: id(),
      readSelector,
      expectedCurrent: object({ stateRevision: positive(), stateDigest: digest() }),
      queryId: digest(),
      queryDigest: digest()
    }, ['queryContract', 'cleanupScopeId', 'readSelector', 'queryId', 'queryDigest'], {
      allOf: [{
        if: { properties: { readSelector: { properties: { kind: { const: 'revision' } }, required: ['kind'] } } },
        then: { not: { required: ['expectedCurrent'] } }
      }]
    })
  };
}

function workspaceCleanupScopeProjection() {
  return {
    $schema: DRAFT,
    $id: typeId('WorkspaceCleanupScopeProjection'),
    title: 'WorkspaceCleanupScopeProjection@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 8 * 1024,
    ...object({
      cleanupScopeId: id(),
      libraRunId: id(),
      triggerKind: { type: 'string', enum: ['offload_completed', 'run_superseded', 'run_discarded'] },
      state: { type: 'string', enum: ['active', 'completed', 'blocked'] },
      stateRevision: positive(),
      stateDigest: digest(),
      memberCount: { type: 'integer', minimum: 0, maximum: 1024 },
      pendingCount: { type: 'integer', minimum: 0, maximum: 1024 },
      completedCount: { type: 'integer', minimum: 0, maximum: 1024 },
      blockedCount: { type: 'integer', minimum: 0, maximum: 1024 },
      memberSetDigest: digest(),
      terminalMemberStateSetDigest: digest(),
      createdAtMs: nonNegative(),
      completedAtMs: nullable(nonNegative()),
      projectionDigest: digest()
    }, [
      'cleanupScopeId', 'libraRunId', 'triggerKind', 'state', 'stateRevision', 'stateDigest',
      'memberCount', 'pendingCount', 'completedCount', 'blockedCount', 'memberSetDigest',
      'terminalMemberStateSetDigest', 'createdAtMs', 'projectionDigest'
    ], {
      allOf: [{
        if: { properties: { state: { const: 'completed' } } },
        then: { required: ['completedAtMs'], properties: { completedAtMs: nonNegative() } },
        else: { properties: { completedAtMs: { type: 'null' } } }
      }]
    })
  };
}

function workspaceCleanupScopeReadResult() {
  const common = { queryId: digest(), queryDigest: digest() };
  const resultDigest = { resultDigest: digest() };
  return {
    $schema: DRAFT,
    $id: typeId('WorkspaceCleanupScopeReadResult'),
    title: 'WorkspaceCleanupScopeReadResult@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ resultKind: { const: 'found' }, ...common,
        projection: { $ref: typeId('WorkspaceCleanupScopeProjection') }, ...resultDigest }),
      object({ resultKind: { const: 'not_found' }, ...common,
        reasonCode: { type: 'string', enum: ['scope_missing', 'revision_missing'] }, ...resultDigest }),
      object({ resultKind: { const: 'stale' }, ...common,
        expectedStateRevision: positive(), expectedStateDigest: digest(),
        actualStateRevision: positive(), actualStateDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'integrity_error' }, ...common,
        reasonCode: { type: 'string', enum: [
          'owner_rows_incomplete', 'revision_chain_broken', 'digest_mismatch',
          'discard_receipt_continuity_broken'
        ] }, ...resultDigest })
    ]
  };
}

function libraRunDiscardReceipt() {
  return {
    $schema: DRAFT,
    $id: typeId('LibraRunDiscardReceipt'),
    title: 'LibraRunDiscardReceipt@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-envelopeRef': 'helix://contracts/types/ReceiptEnvelope/v1',
    'x-helix-maxCanonicalBytes': 8 * 1024,
    ...object({
      schemaRef: { const: typeId('LibraRunDiscardReceipt') },
      schemaVersion: { const: 1 },
      receiptId: id(),
      receiptKind: { const: 'libra_run_discarded' },
      ownerDomain: { const: 'libra' },
      scopeType: { const: 'libra_run' },
      scopeId: id(),
      scopeDigest: digest(),
      effectReceiptRef: nullable(id()),
      committedAtMs: nonNegative(),
      discardDecisionId: digest(),
      libraRunId: id(),
      committedRunStateRevision: positive(),
      releasedInputControlSetDigest: digest(),
      cleanupScopeId: nullable(id()),
      cleanupMemberSetDigest: digest(),
      commitDigest: digest()
    }, [
      'schemaRef', 'schemaVersion', 'receiptId', 'receiptKind', 'ownerDomain', 'scopeType', 'scopeId',
      'scopeDigest', 'committedAtMs', 'discardDecisionId', 'libraRunId', 'committedRunStateRevision',
      'releasedInputControlSetDigest', 'cleanupMemberSetDigest', 'commitDigest'
    ])
  };
}

function libraRunDiscardCommand() {
  return {
    $schema: DRAFT,
    $id: typeId('LibraRunDiscardCommand'),
    title: 'LibraRunDiscardCommand@1',
    'x-helix-ssotRefs': ['8.1.4', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      commandContract: { const: 'libra.run-discard@1' },
      commandId: digest(),
      libraRunId: id(),
      expectedRunStateRevision: positive(),
      expectedRunStateDigest: digest(),
      actorId: id(),
      idempotencyKey: id(),
      commandDigest: digest()
    })
  };
}

function libraRunDiscardCommandResult() {
  const common = { commandId: digest(), commandDigest: digest(), libraRunId: id() };
  const resultDigest = { resultDigest: digest() };
  return {
    $schema: DRAFT,
    $id: typeId('LibraRunDiscardCommandResult'),
    title: 'LibraRunDiscardCommandResult@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ resultKind: { const: 'discarded' }, ...common,
        discardReceipt: { $ref: typeId('LibraRunDiscardReceipt') },
        cleanupMemberCount: { type: 'integer', minimum: 0, maximum: 1024 }, ...resultDigest }),
      object({ resultKind: { const: 'not_found' }, ...common,
        reasonCode: { const: 'run_missing' }, ...resultDigest }),
      object({ resultKind: { const: 'stale' }, ...common,
        expectedRunStateRevision: positive(), expectedRunStateDigest: digest(),
        actualRunStateRevision: positive(), actualRunStateDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'invalid_state' }, ...common,
        reasonCode: { const: 'run_not_frozen' }, actualRunStateRevision: positive(),
        actualRunStateDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'conflict' }, ...common,
        reasonCode: { const: 'idempotency_key_reused' }, existingCommandDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'integrity_error' }, ...common,
        reasonCode: { type: 'string', enum: [
          'run_history_incomplete', 'material_manifest_incomplete', 'workspace_reference_incomplete',
          'control_fence_mismatch', 'discard_receipt_mismatch'
        ] }, ...resultDigest })
    ]
  };
}

function outputRequirement() {
  return {
    $schema: DRAFT, $id: typeId('ProductionMaterialOutputRequirement'),
    title: 'ProductionMaterialOutputRequirement@1', 'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 64 * 1024,
    ...object({
      acceptanceSpecRef: object({ acceptanceSpecId: id(), specRevision: positive(), specDigest: digest(),
        recordDigest: digest(), productScopeDigest: digest() }),
      manifestRole: { type: 'string', enum: ['run_input', 'product_delivery'] }, materialKey: digest(),
      materialRole: { type: 'string', enum: ['primary_payload', 'structural_dependency', 'metadata_sidecar',
        'poster', 'fanart', 'subtitle', 'external_audio', 'chapter'] },
      applicationScope: object({ kind: { type: 'string', enum: ['product_scope', 'episode_subset', 'production_support'] },
        episodeKeys: { type: 'array', items: text(), maxItems: 32, uniqueItems: true }, scopeDigest: digest() }),
      acceptanceRequirementSetDigest: digest(), outputRequirementDigest: digest()
    })
  };
}

function productionMaterialManifest() {
  const schema = buildDomainInputSchemas().ProductionMaterialManifest;
  return { ...schema, $id:typeId('ProductionMaterialManifest'), 'x-helix-ssotRefs':['8.6.21'],
    'x-helix-maxCanonicalBytes':8 * 1024 * 1024 };
}

function runExecutionBasis() {
  return {
    $schema: DRAFT, $id: typeId('LibraRunExecutionBasis'), title: 'LibraRunExecutionBasis@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 8 * 1024 * 1024,
    ...object({
      subjectSnapshot: object({ subjectId: id(), intakeRevision: positive(), structureKind: { type: 'string', enum: ['single', 'season'] },
        contentProfile: { type: 'string', enum: ['movie', 'series', 'jav', 'western_adult'] }, continuitySetDigest: digest(), episodeScopeDigest: digest() }),
      decisionHeadSnapshot: { type: 'object' },
      acceptanceSpec: object({ acceptanceSpecId: id(), specRevision: positive(), specDigest: digest(), recordDigest: digest(),
        productScopeDigest: digest(), shelfId: id() }),
      shelfProjection: object({ routingProjectionRevision: positive(), projectionDigest: digest(), standardRevision: positive(), standardDigest: digest() }),
      productionMaterialManifest: { $ref: typeId('ProductionMaterialManifest') }, executionBasisDigest: digest()
    })
  };
}

function runExecutionBasisRecord() {
  const basis = runExecutionBasis();
  const properties = { ...basis.properties };
  delete properties.productionMaterialManifest;
  properties.productionMaterialManifestRef = object({
    manifestId: digest(),
    manifestDigest: digest(),
    memberCount: positive(),
    memberSetDigest: digest(),
    episodeScopeDigest: digest(),
  });
  return { $schema: DRAFT, $id: typeId('LibraRunExecutionBasisRecord'), title: 'LibraRunExecutionBasisRecord@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 1024 * 1024,
    ...object(properties) };
}

function runAdmissionDecision() {
  const replacement = object({ libraRunId: digest(), stateRevision: positive(), stateDigest: digest(), runScopeDigest: digest(),
    acceptanceSpecId: id(), executionBasisDigest: digest() });
  return { $schema: DRAFT, $id: typeId('LibraRunAdmissionDecision'), title: 'LibraRunAdmissionDecision@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 8 * 1024 * 1024,
    ...object({ decisionId: digest(), admissionKind: { type: 'string', enum: ['initial', 'replacement'] }, subjectId: id(),
      admissionRevision: positive(), libraRunId: digest(), replacementOfRunRef: nullable(replacement),
      expectedRunAdmissionHead: object({ headState: { type: 'string', enum: ['absent', 'present'] }, headRevision: nonNegative(), activeScopeSetDigest: digest() }),
      runExecutionBasis: { $ref: typeId('LibraRunExecutionBasis') },
      initialPriority: object({ priorityClass: { type: 'string', enum: ['normal', 'expedited'] }, priorityIntentDigest: digest() }),
      runScopeDigest: digest(), decisionDigest: digest()
    }, ['decisionId', 'admissionKind', 'subjectId', 'admissionRevision', 'libraRunId', 'expectedRunAdmissionHead',
      'runExecutionBasis', 'initialPriority', 'runScopeDigest', 'decisionDigest']) };
}

function runAdmissionResult() {
  return { $schema: DRAFT, $id: typeId('LibraRunAdmissionResult'), title: 'LibraRunAdmissionResult@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 64 * 1024,
    ...object({ decisionId: digest(), libraRunId: digest(), admissionRevision: positive(), stateRevision: { const: 1 }, stateDigest: digest(),
      executionBasisDigest: digest(), runScopeDigest: digest(), productionMaterialManifestId: digest(),
      priorityClass: { type: 'string', enum: ['normal', 'expedited'] }, priorityIntentDigest: digest(),
      committedAdmissionHeadRevision: positive(), activeScopeSetDigest: digest(),
      supersededRunRef: nullable(object({ libraRunId: digest(), committedStateRevision: positive(), committedStateDigest: digest() })),
      resultDigest: digest()
    }, ['decisionId', 'libraRunId', 'admissionRevision', 'stateRevision', 'stateDigest', 'executionBasisDigest',
      'runScopeDigest', 'productionMaterialManifestId', 'priorityClass', 'priorityIntentDigest',
      'committedAdmissionHeadRevision', 'activeScopeSetDigest', 'resultDigest']) };
}

function runComparableBasisSnapshot() {
  const member = object({ materialKey: digest(), role: text(), physicalIdentity: { type: 'object' }, sizeBytes: nonNegative(),
    bindingRevision: positive(), bindingEvidenceDigest: digest(), episodeClaimSetDigest: digest(), controlRevision: positive(),
    controlProjectionDigest: digest(), outputRequirementDigest: digest(), memberComparisonDigest: digest() });
  return { $schema: DRAFT, $id: typeId('LibraRunComparableBasisSnapshot'), title: 'LibraRunComparableBasisSnapshot@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 1024 * 1024,
    ...object({ subjectId: id(), structureKind: { type: 'string', enum: ['single', 'season'] },
      contentProfile: { type: 'string', enum: ['movie', 'series', 'jav', 'western_adult'] },
      acceptanceSpecRef: object({ acceptanceSpecId: id(), specRevision: positive(), specDigest: digest(), recordDigest: digest() }),
      productScopeDigest: digest(), members: { type: 'array', items: member, minItems: 1, maxItems: 1024 },
      memberSetDigest: digest(), comparableBasisDigest: digest() }) };
}

function runRecoveryPolicySnapshot() {
  return { $schema: DRAFT, $id: typeId('LibraRunRecoveryPolicySnapshot'), title: 'LibraRunRecoveryPolicySnapshot@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({ policyRef: { const: 'libra.run-recovery.beta@1' }, policyRevision: { const: 1 },
      assessmentOffsetsMs: { type: 'array', prefixItems: [60000, 300000, 900000, 1800000, 3600000].map((value) => ({ const: value })), minItems: 5, maxItems: 5 },
      maxRecoveryAssessments: { const: 5 }, heavyPermitAllowed: { const: false },
      frozenAutoResumeAllowed: { const: false }, policyDigest: digest() }) };
}

function runFreshnessAssessment() {
  const dimension = object({ dimension: { type: 'string', enum: ['acceptance_spec', 'product_scope', 'material_binding', 'material_control', 'output_requirement'] },
    result: { type: 'string', enum: ['same', 'changed', 'unresolved'] }, evidenceDigest: digest() });
  return { $schema: DRAFT, $id: typeId('LibraRunFreshnessAssessment'), title: 'LibraRunFreshnessAssessment@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 1024 * 1024,
    ...object({ assessmentId: digest(), libraRunId: digest(), expectedState: object({ state: { type: 'string', enum: ['active', 'suspended'] }, stateRevision: positive(), stateDigest: digest() }),
      assessmentKind: { type: 'string', enum: ['active_checkpoint', 'suspension_recovery'] },
      recoveryPolicy: { $ref: typeId('LibraRunRecoveryPolicySnapshot') },
      recoveryEpisode: object({ startedAtMs: nonNegative(), attemptOrdinal: nonNegative(), dueAtMs: nonNegative() }, ['attemptOrdinal']),
      assessedAtMs: nonNegative(), currentDecisionHead: { type: 'object' },
      originalBasis: { $ref: typeId('LibraRunComparableBasisSnapshot') }, readiness: { type: 'string', enum: ['ready', 'unresolved'] },
      currentBasis: { $ref: typeId('LibraRunComparableBasisSnapshot') }, unresolvedReasonCodes: { type: 'array', uniqueItems: true,
        items: { type: 'string', enum: ['decision_basis_unresolved', 'acceptance_spec_unavailable', 'product_scope_unresolved', 'material_binding_unavailable', 'material_control_unavailable', 'required_query_unresolved'] } },
      dimensionResults: { type: 'array', items: dimension, minItems: 5, maxItems: 5 },
      comparison: { type: 'string', enum: ['same', 'changed', 'unresolved'] }, assessmentDigest: digest()
    }, ['assessmentId', 'libraRunId', 'expectedState', 'assessmentKind', 'recoveryPolicy', 'recoveryEpisode', 'assessedAtMs',
      'currentDecisionHead', 'originalBasis', 'readiness', 'unresolvedReasonCodes', 'dimensionResults', 'comparison', 'assessmentDigest']) };
}

function runPriorityIntent() {
  return { $schema: DRAFT, $id: typeId('LibraRunPriorityIntent'), title: 'LibraRunPriorityIntent@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 8 * 1024,
    ...object({ intentId: digest(), libraRunId: digest(), actorId: id(), idempotencyKey: id(),
      expectedPriorityClass: { type: 'string', enum: ['normal', 'expedited'] },
      requestedPriorityClass: { type: 'string', enum: ['normal', 'expedited'] },
      intentKind: { type: 'string', enum: ['accelerate', 'cancel_acceleration'] }, issuedAtMs: nonNegative(), intentDigest: digest() }) };
}

function runTerminalDeliveryEvidence() {
  const work = object({ workId: id(), planId: id(), workBasisDigest: digest(), terminalEventId: id(), capabilityRef: id(),
    failureClass: text(), failureCode: text(), attemptCount: positive(), retryPolicyDigest: digest(),
    terminalEvidenceDigest: digest(), memberDigest: digest() });
  return { $schema: DRAFT, $id: typeId('LibraRunTerminalDeliveryEvidence'), title: 'LibraRunTerminalDeliveryEvidence@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 256 * 1024,
    ...object({ evidenceId: digest(), libraRunId: digest(), executionBasisDigest: digest(),
      blockerKind: { type: 'string', enum: ['capability_exhausted', 'integration_exhausted', 'product_unachievable'] },
      blockedWorks: { type: 'array', items: work, minItems: 1, maxItems: 256 }, blockerSetDigest: digest(),
      assessedAtMs: nonNegative(), evidenceDigest: digest() }) };
}

function runLifecycleDecision() {
  return { $schema: DRAFT, $id: typeId('LibraRunLifecycleDecision'), title: 'LibraRunLifecycleDecision@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 1024 * 1024,
    ...object({ decisionId: digest(), libraRunId: digest(), expectedStateRevision: positive(), expectedStateDigest: digest(),
      transitionKind: { type: 'string', enum: ['suspend', 'resume', 'freeze', 'freshness_confirmed', 'recovery_reassessed', 'set_priority', 'complete'] },
      newPriority: object({ priorityClass: { type: 'string', enum: ['normal', 'expedited'] }, priorityIntentDigest: digest() }),
      transitionEvidence: { oneOf: [{ $ref: typeId('LibraRunFreshnessAssessment') }, { $ref: typeId('LibraRunTerminalDeliveryEvidence') },
        { $ref: typeId('LibraRunPriorityIntent') }, { $ref: 'helix://contracts/messages/ArcaProductAcceptedMessage/v1' }] },
      expectedAdmissionHeadRevision: positive(), expectedActiveScopeSetDigest: digest(), decisionDigest: digest()
    }, ['decisionId', 'libraRunId', 'expectedStateRevision', 'expectedStateDigest', 'transitionKind', 'transitionEvidence',
      'expectedAdmissionHeadRevision', 'expectedActiveScopeSetDigest', 'decisionDigest']) };
}

function runLifecycleResult() {
  return { $schema: DRAFT, $id: typeId('LibraRunLifecycleResult'), title: 'LibraRunLifecycleResult@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object({ decisionId: digest(), libraRunId: digest(), previousStateRevision: positive(), previousStateDigest: digest(),
      committedState: { type: 'string', enum: ['active', 'suspended', 'frozen', 'completed'] }, committedStateRevision: positive(),
      committedStateDigest: digest(), committedAdmissionHeadRevision: positive(), activeScopeSetDigest: digest(),
      deliveryReceiptId: id(), terminalAtMs: nonNegative(), resultDigest: digest()
    }, ['decisionId', 'libraRunId', 'previousStateRevision', 'previousStateDigest', 'committedState',
      'committedStateRevision', 'committedStateDigest', 'committedAdmissionHeadRevision', 'activeScopeSetDigest', 'resultDigest']) };
}

function workspaceAdmissionDecision() {
  const runRef = object({ libraRunId: id(), stateRevision: positive(), stateDigest: digest(), executionBasisDigest: digest() });
  return { $schema: DRAFT, $id: typeId('LibraWorkspaceAdmissionDecision'), title: 'LibraWorkspaceAdmissionDecision@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 64 * 1024,
    ...object({ decisionId: digest(), libraRunRef: runRef, workspaceId: digest(),
      platformWorkspaceRootSnapshot: { $ref: typeId('PlatformWorkspaceRootSnapshot') },
      spaceAdmissionEvidence: { $ref: typeId('WorkspaceSpaceAdmissionEvidence') },
      workspaceScopeDigest: digest(), decisionDigest: digest() }) };
}

function workspaceAdmissionResult() {
  return { $schema: DRAFT, $id: typeId('LibraWorkspaceAdmissionResult'), title: 'LibraWorkspaceAdmissionResult@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object({ decisionId: digest(), libraRunId: id(), workspaceId: digest(), platformWorkspaceRevision: positive(),
      workspaceRevision: { const: 1 }, workspaceState: { const: 'active' }, workspaceStateDigest: digest(), resultDigest: digest() }) };
}

function workspaceProductVerificationSnapshot() {
  const common = (verificationKind, materialRole, schemaRef, verificationValue, extra = {}) => object({
    verificationKind: { const: verificationKind },
    materialRole: Array.isArray(materialRole) ? { type: 'string', enum: materialRole } : { const: materialRole },
    libraRunId: id(),
    workspaceMaterialHandleId: id(),
    workspaceMaterialHandleDigest: digest(),
    workspaceMaterialFenceDigest: digest(),
    schemaRef: { const: schemaRef },
    verificationId: id(),
    verificationValue,
    verificationDigest: digest(),
    ...extra,
    snapshotDigest: digest()
  });
  return { $schema: DRAFT, $id: typeId('WorkspaceProductVerificationSnapshot'), title: 'WorkspaceProductVerificationSnapshot@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 128 * 1024,
    oneOf: [
      common('media', 'primary_payload', 'ProductMediaVerification@1',
        { $ref: 'helix://contracts/types/ProductMediaVerification/v1' }),
      common('artifact', ['metadata_sidecar', 'poster', 'fanart'], 'ArtifactManifestVerification@1',
        { $ref: 'helix://contracts/types/ArtifactManifestVerification/v1' }, {
          artifactHandle: { $ref: 'helix://contracts/types/ArtifactHandle/v1' },
          artifactRequirement: { $ref: 'helix://contracts/domain-types/ArtifactRequirement/v1' }
        }),
      common('structural', ['structural_dependency', 'subtitle', 'external_audio', 'chapter'], 'ManifestVerification@1',
        { $ref: 'helix://contracts/types/ManifestVerification/v1' }, {
          typedManifest: { $ref: 'helix://contracts/domain-types/TypedManifest/v1' },
          manifestContract: { $ref: 'helix://contracts/domain-types/ManifestContract/v1' },
          verifiedMemberDigest: digest()
        })
    ] };
}

function workspaceEpisodeClaims() {
  const claim = object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
  return {
    $schema: DRAFT, $id: typeId('LibraWorkspaceEpisodeClaims'), title: 'LibraWorkspaceEpisodeClaims@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    type: 'array', items: claim, maxItems: 32
  };
}

function workspaceMaterialReferenceSnapshot() {
  const claim = object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
  return { $schema: DRAFT, $id: typeId('WorkspaceMaterialReferenceSnapshot'), title: 'WorkspaceMaterialReferenceSnapshot@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 64 * 1024,
    ...object({ referenceId: digest(), workspaceId: digest(), libraRunId: id(), materialHandleId: digest(), materialKey: digest(),
      workspaceMaterialHandle: { $ref: 'helix://contracts/types/WorkspaceMaterialHandle/v1' }, workspaceHandleDigest: digest(),
      referenceRevision: positive(), state: { type: 'string', enum: ['working', 'product_staging', 'released'] },
      episodeClaims: { type: 'array', items: claim, maxItems: 32 }, episodeScopeDigest: digest(),
      productVerificationRef: nullable({ $ref: typeId('WorkspaceProductVerificationSnapshot') }),
      previousReferenceRevision: nullable(positive()), committedWorkspaceRevision: positive(), referenceDigest: digest() }) };
}

function workspaceMaterialReferenceDecision() {
  const claim = object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
  return { $schema: DRAFT, $id: typeId('LibraWorkspaceMaterialReferenceDecision'), title: 'LibraWorkspaceMaterialReferenceDecision@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 64 * 1024,
    ...object({ decisionId: digest(), operation: { type: 'string', enum: ['attach_working', 'promote_to_product_staging'] },
      libraRunId: id(), workspaceId: digest(), expectedWorkspaceRevision: positive(), expectedWorkspaceStateDigest: digest(),
      expectedReference: object({ state: { type: 'string', enum: ['absent', 'present'] }, revision: nonNegative(), digest: digest() }),
      workspaceMaterialHandle: { $ref: 'helix://contracts/types/WorkspaceMaterialHandle/v1' },
      episodeClaims: { type: 'array', items: claim, maxItems: 32 }, episodeScopeDigest: digest(),
      productVerificationRef: nullable({ $ref: typeId('WorkspaceProductVerificationSnapshot') }), decisionDigest: digest() }) };
}

function workspaceMaterialReferenceResult() {
  return { $schema: DRAFT, $id: typeId('LibraWorkspaceMaterialReferenceResult'), title: 'LibraWorkspaceMaterialReferenceResult@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 128 * 1024,
    ...object({ decisionId: digest(), workspaceId: digest(), workspaceRevision: positive(), workspaceStateDigest: digest(),
      referenceSnapshot: { $ref: typeId('WorkspaceMaterialReferenceSnapshot') },
      workspaceMaterialReferenceSetDigest: digest(), resultDigest: digest() }) };
}

function productFactCommitPlanBinding() {
  const sourceResultRef = object({
    workId: id(),
    attemptId: id(),
    planId: id(),
    eventId: id(),
    resultId: id(),
    capabilityRef: id(),
    resultSchemaRef: id(),
    resultDigest: digest(),
    evidenceDigest: digest(),
    inputBindingDigest: digest()
  });
  const artifactRef = object({
    artifactHandleId: id(),
    artifactRevision: positive(),
    artifactDigest: digest(),
    verificationResultId: id(),
    verificationResultDigest: digest()
  });
  const mediaCastFactRef = object({
    productFactId: id(),
    factRevision: positive(),
    factDigest: digest()
  });
  return {
    $schema: DRAFT,
    $id: typeId('LibraProductFactCommitPlanBinding'),
    title: 'LibraProductFactCommitPlanBinding@1',
    'x-helix-ssotRefs': ['8.5.11', '8.6.20'],
    'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object({
      schemaRef: { const: typeId('LibraProductFactCommitPlanBinding') },
      schemaVersion: { const: 1 },
      bindingKind: { const: 'product_fact_commit' },
      libraRunId: id(),
      runExecutionBasisDigest: digest(),
      factKind: {
        type: 'string',
        enum: ['resolved_identity', 'media_cast', 'product_metadata']
      },
      expectedFactRevision: { const: 0 },
      payloadDigest: digest(),
      sourceBasisKind: {
        type: 'string',
        enum: ['metadata_observation', 'western_analysis', 'western_match']
      },
      sourceBasisId: id(),
      sourceBasisDigest: digest(),
      sourceResultRefs: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: sourceResultRef
      },
      artifactRefs: {
        type: 'array',
        maxItems: 16,
        items: artifactRef
      },
      mediaCastFactRef: nullable(mediaCastFactRef),
      bindingDigest: digest()
    })
  };
}

function buildLibraApplicationSchemas() {
  return Object.freeze({
    ProductDeliveryQuery: productDeliveryQuery(),
    ProductDeliveryReadResult: productDeliveryReadResult(),
    WorkspaceCleanupScopeQuery: workspaceCleanupScopeQuery(),
    WorkspaceCleanupScopeProjection: workspaceCleanupScopeProjection(),
    WorkspaceCleanupScopeReadResult: workspaceCleanupScopeReadResult(),
    LibraRunDiscardReceipt: libraRunDiscardReceipt(),
    LibraRunDiscardCommand: libraRunDiscardCommand(),
    LibraRunDiscardCommandResult: libraRunDiscardCommandResult(),
    ProductionMaterialOutputRequirement: outputRequirement(),
    ProductionMaterialManifest: productionMaterialManifest(),
    LibraRunExecutionBasis: runExecutionBasis(),
    LibraRunExecutionBasisRecord: runExecutionBasisRecord(),
    LibraRunAdmissionDecision: runAdmissionDecision(),
    LibraRunAdmissionResult: runAdmissionResult(),
    LibraRunComparableBasisSnapshot: runComparableBasisSnapshot(),
    LibraRunRecoveryPolicySnapshot: runRecoveryPolicySnapshot(),
    LibraRunFreshnessAssessment: runFreshnessAssessment(),
    LibraRunPriorityIntent: runPriorityIntent(),
    LibraRunTerminalDeliveryEvidence: runTerminalDeliveryEvidence(),
    LibraRunLifecycleDecision: runLifecycleDecision(),
    LibraRunLifecycleResult: runLifecycleResult(),
    LibraWorkspaceAdmissionDecision: workspaceAdmissionDecision(),
    LibraWorkspaceAdmissionResult: workspaceAdmissionResult(),
    LibraWorkspaceEpisodeClaims: workspaceEpisodeClaims(),
    WorkspaceProductVerificationSnapshot: workspaceProductVerificationSnapshot(),
    WorkspaceMaterialReferenceSnapshot: workspaceMaterialReferenceSnapshot(),
    LibraWorkspaceMaterialReferenceDecision: workspaceMaterialReferenceDecision(),
    LibraWorkspaceMaterialReferenceResult: workspaceMaterialReferenceResult(),
    LibraProductFactCommitPlanBinding: productFactCommitPlanBinding()
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function schemaDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

module.exports = Object.freeze({ buildLibraApplicationSchemas, schemaDigest, typeId });
