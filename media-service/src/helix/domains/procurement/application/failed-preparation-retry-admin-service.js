'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionContract } = require('../model/retry-command-execution-contract');
const { INPUT_SET, PLANNER_REF, REFERENCE_SCHEMA, bindingSet, readReference, requestBasisDigest } =
  require('../model/retry-command-plan-reference');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createWorkResultReader } = require('../../../foundation/execution/work-result-reader');
const {
  createMaterialControlAdmissionReadParticipant,
} = require('../../../foundation/persistence/material-control');
const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');
const {
  activeTriageRule,
  createProcurementRunExecutionBasis,
} = require('../model/procurement-run-contracts');
const {
  emptySelectionSnapshot,
  failedRunMaterialDigest,
  memberPreconditionDigest,
  retryEligibilityAvailable,
  validateRetryIntent,
} = require('../model/procurement-retry-contracts');
const {
  createProcurementRetryAdmissionStore,
} = require('../persistence/procurement-retry-admission-store');
const {
  createProcurementRetryIntentStore,
} = require('../persistence/procurement-retry-intent-store');

const INTENT_CAPABILITY = 'procurement.retry.intent.create@1';
const ADMISSION_CAPABILITY = 'procurement.retry.admit@1';
const SHA256 = /^[0-9a-f]{64}$/;

class FailedPreparationRetryAdminServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FailedPreparationRetryAdminServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FailedPreparationRetryAdminServiceError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function validateInput(input) {
  const keys = [
    'fieldId',
    'idempotencyKey',
    'failedProcurementRunId',
    'expectedFailedRunStateRevision',
    'expectedFailedRunBasisDigest',
    'actorId',
  ];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(input, key)) ||
      typeof input.fieldId !== 'string' || input.fieldId.length === 0 ||
      input.fieldId.length > 256 ||
      typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0 ||
      input.idempotencyKey.length > 256 ||
      typeof input.failedProcurementRunId !== 'string' ||
      input.failedProcurementRunId.length === 0 ||
      input.failedProcurementRunId.length > 256 ||
      !Number.isSafeInteger(input.expectedFailedRunStateRevision) ||
      input.expectedFailedRunStateRevision < 1 ||
      !SHA256.test(input.expectedFailedRunBasisDigest || '') ||
      typeof input.actorId !== 'string' || input.actorId.length === 0 || input.actorId.length > 256) {
    fail(
      'FAILED_PREPARATION_RETRY_INPUT_INVALID',
      '失败准备重试请求不符合closed input合同。',
    );
  }
}

function repositoryDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'failed_preparation_retry_snapshot',
    owner: 'procurement',
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'proc_procurement_runs',
        columns: [
          'procurement_run_id',
          'field_id',
          'run_basis_digest',
          'state',
          'state_revision',
          'seal_outcome',
        ],
        keyColumns: ['procurement_run_id'],
        safeIntegers: true,
      },
      find_failed_members: {
        kind: 'select-all',
        tableId: 'proc_run_materials',
        columns: [
          'procurement_run_id',
          'ordinal',
          'material_key',
          'field_relative_location',
          'selection_scope_kind',
          'selection_scope_key',
          'selection_scope_root_relative_location',
          'basis_member_digest',
          'selection_state',
          'terminal_disposition',
          'terminal_evidence_digest',
        ],
        keyColumns: ['procurement_run_id'],
        safeIntegers: true,
      },
      find_retry_intents_for_failed_run: {
        kind: 'select-all',
        tableId: 'proc_procurement_retry_intents',
        columns: [
          'retry_intent_id',
          'failed_run_id',
          'failed_basis_digest',
          'state',
          'idempotency_key',
        ],
        keyColumns: ['failed_run_id'],
      },
      find_retry_intent: {
        kind: 'select-one',
        tableId: 'proc_procurement_retry_intents',
        columns: [
          'retry_intent_id',
          'field_id',
          'failed_run_id',
          'state',
          'state_revision',
          'idempotency_key',
          'intent_digest',
          'retry_scope_digest',
          'create_commit_marker',
          'create_result_digest',
          'consume_commit_marker',
          'consume_result_digest',
        ],
        keyColumns: ['retry_intent_id'],
        safeIntegers: true,
      },
      find_field: {
        kind: 'select-one',
        tableId: 'proc_material_fields',
        columns: [
          'field_id',
          'status',
          'current_access_revision',
          'current_profile_hint_revision',
          'current_observation_revision',
          'extraction_policy_id',
          'extraction_policy_revision',
        ],
        keyColumns: ['field_id'],
        safeIntegers: true,
      },
      find_profile_hint: {
        kind: 'select-one',
        tableId: 'proc_field_profile_hint_revisions',
        columns: [
          'field_id',
          'revision',
          'content_profile_hint',
          'hint_schema_ref',
          'hint_digest',
        ],
        keyColumns: ['field_id', 'revision'],
        safeIntegers: true,
      },
      find_access: {
        kind: 'select-one',
        tableId: 'proc_field_access_revisions',
        columns: ['field_id', 'revision', 'access_digest'],
        keyColumns: ['field_id', 'revision'],
        safeIntegers: true,
      },
      find_observation: {
        kind: 'select-one',
        tableId: 'proc_field_observations',
        columns: [
          'field_id',
          'revision',
          'field_observation_work_id',
          'content_profile_hint',
          'profile_hint_revision',
          'profile_hint_digest',
          'completed',
        ],
        keyColumns: ['field_id', 'revision'],
        safeIntegers: true,
      },
      find_policy: {
        kind: 'select-one',
        tableId: 'proc_extraction_policy_revisions',
        columns: ['extraction_policy_id', 'revision', 'policy_digest'],
        keyColumns: ['extraction_policy_id', 'revision'],
        safeIntegers: true,
      },
      find_material: {
        kind: 'select-one',
        tableId: 'proc_field_materials',
        columns: [
          'field_id',
          'material_key',
          'mount_scope_id',
          'inode',
          'size_bytes',
          'fingerprint_algorithm',
          'fingerprint_version',
          'content_fingerprint',
          'endpoint_id',
          'binding_revision',
          'current_location',
          'reality_digest',
          'provenance_digest',
          'last_snapshot_digest',
          'last_observation_id',
          'eligibility_revision',
          'eligibility_state',
          'eligibility_reason_code',
          'eligibility_basis_digest',
        ],
        keyColumns: ['field_id', 'material_key'],
        safeIntegers: true,
      },
      find_runs: {
        kind: 'select-all',
        tableId: 'proc_procurement_runs',
        columns: ['procurement_run_id', 'state'],
        keyColumns: ['field_id'],
      },
      find_run_member: {
        kind: 'select-one',
        tableId: 'proc_run_materials',
        columns: [
          'procurement_run_id',
          'material_key',
          'selection_state',
          'candidate_package_id',
          'selection_role',
          'binding_revision',
        ],
        keyColumns: ['procurement_run_id', 'material_key'],
        safeIntegers: true,
      },
      find_candidate: {
        kind: 'select-one',
        tableId: 'proc_candidate_packages',
        columns: ['candidate_package_id', 'package_digest'],
        keyColumns: ['candidate_package_id'],
      },
    },
  });
}

function currentSelection(repository, runs, materialKey) {
  const activeGuards = [];
  for (const run of runs) {
    const row = repository.invoke('find_run_member', {
      procurement_run_id: run.procurement_run_id,
      material_key: materialKey,
    });
    if (!row || !['run_selection', 'candidate_delivery'].includes(row.selection_state)) {
      continue;
    }
    const guard = {
      guardKind: row.selection_state,
      procurementRunId: run.procurement_run_id,
      runState: run.state,
      selectionRole: row.selection_role,
      bindingRevision: Number(row.binding_revision),
    };
    if (row.candidate_package_id !== null) {
      const candidate = repository.invoke('find_candidate', {
        candidate_package_id: row.candidate_package_id,
      });
      if (!candidate) {
        fail(
          'FAILED_PREPARATION_RETRY_CANDIDATE_CORRUPT',
          'Selection guard引用了不存在的Candidate Package。',
        );
      }
      guard.candidatePackageId = row.candidate_package_id;
      guard.packageDigest = candidate.package_digest;
    }
    activeGuards.push(guard);
  }
  if (activeGuards.length === 0) return emptySelectionSnapshot(materialKey);
  activeGuards.sort((left, right) =>
    left.guardKind.localeCompare(right.guardKind) ||
    left.procurementRunId.localeCompare(right.procurementRunId) ||
    (left.candidatePackageId || '').localeCompare(right.candidatePackageId || '') ||
    left.selectionRole.localeCompare(right.selectionRole));
  const value = { materialKey, activeGuards, hasConflict: true };
  return Object.freeze({ ...value, selectionBasisDigest: canonicalDigest(value) });
}

function runMember(material, controlSnapshot, ordinal, scopeMember) {
  const value = {
    ordinal,
    materialKey: material.material_key,
    selectionRole: 'triage_input',
    fieldRelativeLocation: scopeMember.fieldRelativeLocation,
    scopeOrdinal: scopeMember.scopeOrdinal,
    scopeMemberOrdinal: scopeMember.scopeMemberOrdinal,
    physicalIdentity: {
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      materialKey: material.material_key,
      mountScopeId: material.mount_scope_id,
      inode: String(material.inode),
      sizeBytes: Number(material.size_bytes),
      fingerprintAlgorithm: material.fingerprint_algorithm,
      fingerprintVersion: Number(material.fingerprint_version),
      contentFingerprint: material.content_fingerprint,
    },
    sizeBytes: Number(material.size_bytes),
    bindingRevision: Number(material.binding_revision),
    eligibilityRevision: Number(material.eligibility_revision),
    eligibilityBasisDigest: material.eligibility_basis_digest,
    lastSnapshotDigest: material.last_snapshot_digest,
    lastObservationId: material.last_observation_id,
    endpointId: material.endpoint_id,
    location: material.current_location,
    realityDigest: material.reality_digest,
    provenanceDigest: material.provenance_digest,
    controlSnapshot,
    admissionControlAction: controlSnapshot.controlState === 'uncontrolled'
      ? 'acquire'
      : 'assert_same_field',
  };
  return Object.freeze({ ...value, basisMemberDigest: canonicalDigest(value) });
}

function retrySelectionScopes(failedMembers) {
  const groups = new Map();
  for (const member of failedMembers) {
    const key = member.selection_scope_key;
    if (!groups.has(key)) groups.set(key, { scopeKind:member.selection_scope_kind, scopeKey:key,
      scopeRootRelativeLocation:member.selection_scope_root_relative_location, members:[] });
    groups.get(key).members.push(member);
  }
  const scopeByMaterial = new Map();
  const selectionScopes = [...groups.values()].sort((left,right)=>Buffer.compare(Buffer.from(left.scopeKey),Buffer.from(right.scopeKey)))
    .map((group, scopeOrdinal) => {
      const ordered = group.members.sort((left,right)=>Buffer.compare(Buffer.from(left.field_relative_location),Buffer.from(right.field_relative_location)) ||
        Buffer.compare(Buffer.from(left.material_key),Buffer.from(right.material_key)));
      const items = ordered.map((member, scopeMemberOrdinal) => {
        const value={ materialKey:member.material_key, fieldRelativeLocation:member.field_relative_location, scopeMemberOrdinal };
        scopeByMaterial.set(member.material_key, { ...value, scopeOrdinal }); return value;
      });
      const memberSetDigest=canonicalDigest({schema:'procurement.selection-scope-members@1',items});
      const value={scopeOrdinal,scopeKind:group.scopeKind,scopeKey:group.scopeKey,
        scopeRootRelativeLocation:group.scopeRootRelativeLocation,memberCount:items.length,memberSetDigest};
      return Object.freeze({...value,scopeDigest:canonicalDigest({schema:'procurement.selection-scope@1',
        scopeKind:value.scopeKind,scopeKey:value.scopeKey,scopeRootRelativeLocation:value.scopeRootRelativeLocation,
        memberCount:value.memberCount,memberSetDigest:value.memberSetDigest})});
    });
  return Object.freeze({selectionScopes:Object.freeze(selectionScopes),scopeByMaterial,
    scopeSetDigest:canonicalDigest({schema:'procurement.selection-scope-set@1',scopes:selectionScopes})});
}

function controlHandle(newRunBasis) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
    schemaVersion: 1,
    handleId: stableId('retry-control-handle-', {
      procurementRunId: newRunBasis.procurementRunId,
      basisDigest: newRunBasis.basisDigest,
    }),
    operationKind: 'acquire',
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: newRunBasis.procurementRunId,
    basisRef: {
      objectType: 'procurement_run_execution_basis',
      objectId: newRunBasis.procurementRunId,
      revision: 1,
      digest: newRunBasis.basisDigest,
    },
    basisDigest: newRunBasis.basisDigest,
    canonicalFactSetDigest: newRunBasis.basisDigest,
    bindingSetDigest: newRunBasis.selectedFieldMaterialSet.selectionDigest,
    controlScopeDigest: newRunBasis.selectedFieldMaterialSet.selectionDigest,
    expectedControlRevisions: Object.freeze(
      newRunBasis.selectedFieldMaterialSet.members.map((member) => Object.freeze({
        materialKey: member.materialKey,
        revision: member.controlSnapshot.controlRevision,
      })),
    ),
    receiptContract: Object.freeze({
      receiptSchemaRef:
        'helix://contracts/types/ProcurementControlReceipt/v1',
      controlRevisionSetSchemaRef: 'procurement.control-revision-set@1',
    }),
    eventFenceDigest: canonicalDigest({
      schema: 'procurement.retry-control-event-fence@1',
      procurementRunId: newRunBasis.procurementRunId,
      runBasisDigest: newRunBasis.basisDigest,
    }),
  });
}

function createRetryBasis({ newRunId, retryIntentId, head, failedMembers, materials, controls, triageRegistry }) {
  const scopes = retrySelectionScopes(failedMembers);
  const members = materials.map((material, index) =>
    runMember(material, controls[index], index, scopes.scopeByMaterial.get(material.material_key)));
  const selection = { procurementRunId:newRunId, fieldId:head.fieldId,
    physicalMemberCount:members.length, selectionScopeCount:scopes.selectionScopes.length,
    selectionScopes:scopes.selectionScopes, scopeSetDigest:scopes.scopeSetDigest, members:Object.freeze(members) };
  const selectedFieldMaterialSet = Object.freeze({ ...selection,
    selectionDigest:canonicalDigest({ schema:'procurement.selected-field-material-set@2', ...selection }) });
  const value = { procurementRunId:newRunId, fieldId:head.fieldId, fieldStatus:'active',
    fieldAccess:head.fieldAccess, profileHintSnapshot:head.profileHintSnapshot,
    terminalObservation:{ revision:head.terminalObservation.revision,
      fieldObservationWorkId:head.terminalObservation.fieldObservationWorkId,
      profileHintSnapshot:head.terminalObservation.profileHintSnapshot },
    extractionPolicy:head.extractionPolicy, triageRule:head.triageRule, sourceRetryIntentId:retryIntentId,
    selectedFieldMaterialSet };
  return createProcurementRunExecutionBasis(Object.freeze({ ...value, basisDigest:canonicalDigest(value) }), triageRegistry);
}

function admissionCommand(reference, workId, newRunBasis = null) {
  const { retryIntentId, intentDigest, newRunId, newRunBasisDigest } = reference;
  return Object.freeze({ retryIntentId, expectedStateRevision:1, expectedIntentDigest:intentDigest,
    ...(newRunBasis ? { newRunBasis, controlHandle:controlHandle(newRunBasis),
      createdControlReceiptId:stableId('retry-control-receipt-', { retryIntentId, newRunId }) } : {}),
    priorityClass:'normal',
    commitMarker:Object.freeze({ commitMarker:stableId('retry-admission-marker-', { retryIntentId }),
      commitDigest:canonicalDigest({ schema:'procurement.retry-admission-command@1', workId,
        retryIntentId, intentDigest, newRunBasisDigest }) }),
    resultBinding:Object.freeze({ resultId:stableId('retry-admission-result-', { retryIntentId }),
      eventId:stableId('retry-admission-event-', { workId }) }) });
}

function retryIntentAvailablePayload(intent) {
  return Object.freeze({
    messageKind: 'procurement_retry_intent_available',
    retryIntentId: intent.retryIntentId,
    fieldId: intent.fieldId,
    failedRunId: intent.failedRunId,
    intentStateRevision: 1,
    intentDigest: intent.intentDigest,
    retryScopeDigest: intent.retryScopeDigest,
  });
}

function validateRetryIntentAvailablePayload(payload) {
  const keys = [
    'messageKind',
    'retryIntentId',
    'fieldId',
    'failedRunId',
    'intentStateRevision',
    'intentDigest',
    'retryScopeDigest',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(payload, key)) ||
      payload.messageKind !== 'procurement_retry_intent_available' ||
      typeof payload.retryIntentId !== 'string' || payload.retryIntentId.length === 0 ||
      typeof payload.fieldId !== 'string' || payload.fieldId.length === 0 ||
      typeof payload.failedRunId !== 'string' || payload.failedRunId.length === 0 ||
      payload.intentStateRevision !== 1 ||
      !SHA256.test(payload.intentDigest || '') ||
      !SHA256.test(payload.retryScopeDigest || '')) {
    fail(
      'FAILED_PREPARATION_RETRY_AVAILABLE_MESSAGE_INVALID',
      'Procurement Retry Intent Available消息不符合closed合同。',
    );
  }
  return Object.freeze({ ...payload });
}

function capabilityStep(options) {
  const inputSetDigest = canonicalDigest(options.input);
  const fence = {
    basisDigest: options.basisDigest,
    inputSetDigest,
    eventFenceDigest: canonicalDigest({
      schema: 'procurement.retry-event-fence@1',
      eventId: options.eventId,
      inputSetDigest,
    }),
    effectScopeDigest: canonicalDigest({
      schema: 'procurement.retry-effect-scope@1',
      fieldId: options.fieldId,
      failedRunId: options.failedRunId,
      capabilityRef: options.capabilityRef,
    }),
  };
  const demandBasis = { resourceKinds: ['cpu'] };
  return Object.freeze({
    nodeId: options.nodeId,
    eventId: options.eventId,
    capabilityRef: options.capabilityRef,
    effectClass: 'domain_fact_commit',
    inputSchemaRef: options.inputSchemaRef,
    input: options.input,
    parametersSchemaRef: 'helix://implementation/procurement/retry-parameters/v1',
    parameters: Object.freeze({}),
    fenceSchemaRef: 'helix://implementation/procurement/retry-event-fence/v1',
    fenceBasis: Object.freeze(fence),
    resourceDemandSchemaRef: 'helix://implementation/foundation/cpu-demand/v1',
    resourceDemand: Object.freeze({
      ...demandBasis,
      demandDigest: canonicalDigest(demandBasis),
    }),
  });
}

function workDefinition(input, workId, basisDigest) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId,
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: input.failedProcurementRunId,
    workKind: 'failed_preparation_retry',
    workObjectiveTypeRef: 'helix://procurement/work/FailedPreparationRetry/v1',
    workObjectiveVersion: 1,
    executionBasisId: stableId('failed-preparation-retry-basis-', {
      fieldId: input.fieldId,
      failedRunId: input.failedProcurementRunId,
      failedRunBasisDigest: input.expectedFailedRunBasisDigest,
    }),
    executionBasisDigest: basisDigest,
    dependencyRefs: Object.freeze([Object.freeze({
      ownerDomain: 'procurement',
      objectType: 'procurement_run',
      objectId: input.failedProcurementRunId,
      revision: input.expectedFailedRunStateRevision,
      digest: input.expectedFailedRunBasisDigest,
    })]),
    priorityClass: 'normal_foreground',
    priorityRevision: 1,
    capabilityCatalogScope: 'procurement',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: input.idempotencyKey,
    concurrencyScope: input.fieldId + '/failed-preparation-retry',
    outputContractRef:
      'helix://contracts/application-types/ProcurementRetryAdmissionResult/v1',
  });
}

function createFailedPreparationRetryAdminService(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.triageRegistry ||
      !options.workRuntime) {
    fail(
      'FAILED_PREPARATION_RETRY_DEPENDENCIES',
      '失败准备重试需要Procurement与Foundation正式依赖。',
    );
  }
  const repository = repositoryDefinition(options.schemaManifest);
  const intentStore = options.retryIntentStore ||
    createProcurementRetryIntentStore(options);
  const retryConsumer = options.retryAdmissionStore ||
    createProcurementRetryAdmissionStore(options);
  const resultReader = options.workResultReader || createWorkResultReader(options);

  function readIntentReceipt(row, workId) {
    const eventId = stableId('retry-intent-event-', { workId });
    const resultId = stableId('retry-intent-result-', { retryIntentId:row.retry_intent_id });
    const result = resultReader.read(workId).find((item) => item.eventId === eventId);
    const receipt = result?.result;
    const schemaRef = 'helix://contracts/application-types/ProcurementRetryIntentReceipt/v1';
    if (!receipt || result.resultId !== resultId || result.capabilityRef !== INTENT_CAPABILITY ||
        result.outcomeKind !== 'succeeded' || result.resultSchemaRef !== schemaRef ||
        result.resultDigest !== row.create_result_digest || canonicalDigest(receipt) !== row.create_result_digest ||
        receipt.schemaRef !== schemaRef || receipt.schemaVersion !== 1 || receipt.receiptId !== resultId ||
        receipt.receiptKind !== 'procurement_retry_intent_created' || receipt.ownerDomain !== 'procurement' ||
        receipt.scopeType !== 'procurement_retry_intent' || receipt.scopeId !== row.retry_intent_id ||
        receipt.retryIntentId !== row.retry_intent_id || receipt.fieldId !== row.field_id ||
        receipt.failedRunId !== row.failed_run_id || receipt.intentDigest !== row.intent_digest ||
        receipt.scopeDigest !== row.intent_digest || receipt.retryScopeDigest !== row.retry_scope_digest ||
        receipt.intentState !== 'open')
      fail('FAILED_PREPARATION_RETRY_INTENT_RECEIPT_CORRUPT', 'The committed Retry Intent receipt does not match its Owner record.', { workId });
    return receipt;
  }

  function assemble(input, workId, basisDigest) {
    let snapshot;
    let materialKeys;
    let controls;
    const read = {
      participantId: 'failed_preparation_retry_snapshot',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const failedRun = repo.invoke('find_run', {
          procurement_run_id: input.failedProcurementRunId,
        });
        if (!failedRun || failedRun.field_id !== input.fieldId ||
            failedRun.run_basis_digest !== input.expectedFailedRunBasisDigest ||
            Number(failedRun.state_revision) !== input.expectedFailedRunStateRevision ||
            failedRun.state !== 'sealed' ||
            !['failed', 'partial_failure'].includes(failedRun.seal_outcome)) {
          fail(
            'FAILED_PREPARATION_RETRY_SOURCE_INVALID',
            '目标Procurement Run不是显式指定的失败sealed revision。',
          );
        }
        const priorIntents = repo.invoke('find_retry_intents_for_failed_run', {
          failed_run_id: input.failedProcurementRunId,
        }).filter((intent) =>
          intent.failed_basis_digest === input.expectedFailedRunBasisDigest &&
          ['open', 'consumed'].includes(intent.state));
        if (priorIntents.length > 0) {
          fail(
            'FAILED_PREPARATION_RETRY_ALREADY_EXISTS',
            '该失败Run/Basis已经有open或consumed Retry Intent。',
            { retryIntentId: priorIntents[0].retry_intent_id },
          );
        }
        const failedMembers = repo.invoke('find_failed_members', {
          procurement_run_id: input.failedProcurementRunId,
        }).filter((member) =>
          member.selection_state === 'released' &&
          member.terminal_disposition === 'triage_failed');
        failedMembers.sort((left, right) =>
          left.material_key.localeCompare(right.material_key));
        if (failedMembers.length < 1 || failedMembers.length > 1024 ||
            failedMembers.some((member) =>
              !Number.isSafeInteger(Number(member.ordinal)) ||
              Number(member.ordinal) < 0)) {
          fail(
            'FAILED_PREPARATION_RETRY_SCOPE_INVALID',
            '失败Run没有合法且连续的triage_failed成员范围。',
          );
        }
        const field = repo.invoke('find_field', { field_id: input.fieldId });
        const access = field && repo.invoke('find_access', {
          field_id: input.fieldId,
          revision: field.current_access_revision,
        });
        const profileHint = field && repo.invoke('find_profile_hint', {
          field_id: input.fieldId,
          revision: field.current_profile_hint_revision,
        });
        const observation = field?.current_observation_revision === null
          ? null
          : repo.invoke('find_observation', {
            field_id: input.fieldId,
            revision: field.current_observation_revision,
          });
        const policy = field && repo.invoke('find_policy', {
          extraction_policy_id: field.extraction_policy_id,
          revision: field.extraction_policy_revision,
        });
        if (!field || field.status !== 'active' || !access || !profileHint ||
            profileHint.hint_schema_ref !==
              'helix://contracts/application-types/MaterialFieldProfileHintSnapshot/v1' ||
            !observation ||
            !observation.completed ||
            observation.content_profile_hint !== profileHint.content_profile_hint ||
            Number(observation.profile_hint_revision) !== Number(profileHint.revision) ||
            observation.profile_hint_digest !== profileHint.hint_digest ||
            !policy) {
          fail(
            'FAILED_PREPARATION_RETRY_HEAD_UNAVAILABLE',
            'Material Field当前没有可用于重试的完整admission head。',
          );
        }
        const runs = repo.invoke('find_runs', { field_id: input.fieldId });
        const materials = [];
        const selections = [];
        for (const failedMember of failedMembers) {
          const material = repo.invoke('find_material', {
            field_id: input.fieldId,
            material_key: failedMember.material_key,
          });
          const selection = currentSelection(repo, runs, failedMember.material_key);
          if (!material || selection.hasConflict) {
            fail(
              'FAILED_PREPARATION_RETRY_MEMBER_INELIGIBLE',
              '失败成员当前不可重试或仍被Selection占用。',
              { materialKey: failedMember.material_key },
            );
          }
          materials.push(material);
          selections.push(selection);
        }
        materialKeys = failedMembers.map((member) => member.material_key);
        snapshot = Object.freeze({
          failedRun,
          failedMembers: Object.freeze(failedMembers),
          field,
          access,
          profileHint,
          observation,
          policy,
          materials: Object.freeze(materials),
          selections: Object.freeze(selections),
        });
        return failedMembers.length;
      },
    };
    const controlRead = createMaterialControlAdmissionReadParticipant({
      schemaManifest: options.schemaManifest,
      materialKeys: () => materialKeys,
      boundBusinessOwner: 'procurement',
      participantId: 'failed_preparation_retry_control_snapshot',
      accept(value) {
        controls = value;
      },
    });
    options.unitOfWork.execute([read, controlRead]);
    for(let index=0;index<snapshot.materials.length;index++){
      const material=snapshot.materials[index];
      if(!retryEligibilityAvailable({currentEligibilityState:material.eligibility_state,
        currentEligibilityReasonCode:material.eligibility_reason_code,currentSelection:snapshot.selections[index],
        currentControlSnapshot:controls[index]},input.fieldId)){
        fail('FAILED_PREPARATION_RETRY_MEMBER_INELIGIBLE','失败成员当前不满足显式重试条件。',
          {materialKey:material.material_key});
      }
    }

    const rule = activeTriageRule(options.triageRegistry);
    const headValue = {
      fieldId: input.fieldId,
      fieldStatus: snapshot.field.status,
      profileHintSnapshot: {
        fieldId: input.fieldId,
        revision: Number(snapshot.profileHint.revision),
        contentProfileHint: snapshot.profileHint.content_profile_hint,
        hintDigest: snapshot.profileHint.hint_digest,
      },
      fieldAccess: {
        revision: Number(snapshot.access.revision),
        digest: snapshot.access.access_digest,
      },
      terminalObservation: {
        resultKind: 'available',
        revision: Number(snapshot.observation.revision),
        fieldObservationWorkId: snapshot.observation.field_observation_work_id,
        profileHintSnapshot: {
          fieldId: input.fieldId,
          revision: Number(snapshot.profileHint.revision),
          contentProfileHint: snapshot.profileHint.content_profile_hint,
          hintDigest: snapshot.profileHint.hint_digest,
        },
      },
      extractionPolicy: {
        policyId: snapshot.policy.extraction_policy_id,
        revision: Number(snapshot.policy.revision),
        digest: snapshot.policy.policy_digest,
      },
      triageRule: rule,
    };
    const retryAdmissionHead = Object.freeze({
      ...headValue,
      headDigest: canonicalDigest(headValue),
    });
    const members = snapshot.failedMembers.map((failedMember, index) => {
      const material = snapshot.materials[index];
      const member = {
        ordinal: index,
        materialKey: failedMember.material_key,
        failedRunMaterialDigest: failedRunMaterialDigest({
          failedRunId: input.failedProcurementRunId,
          failedRunBasisDigest: input.expectedFailedRunBasisDigest,
          ordinal: Number(failedMember.ordinal),
          materialKey: failedMember.material_key,
          basisMemberDigest: failedMember.basis_member_digest,
          terminalEvidenceDigest: failedMember.terminal_evidence_digest,
        }),
        expectedBindingRevision: Number(material.binding_revision),
        expectedEligibilityRevision: Number(material.eligibility_revision),
        expectedEligibilityBasisDigest: material.eligibility_basis_digest,
        expectedSelectionBasisDigest: snapshot.selections[index].selectionBasisDigest,
        expectedSelectionHasConflict: false,
        expectedControlSnapshot: controls[index],
      };
      return Object.freeze({
        ...member,
        memberPreconditionDigest: memberPreconditionDigest(member),
      });
    });
    const retryIntentId = stableId('procurement-retry-intent-', {
      workId,
      failedRunId: input.failedProcurementRunId,
      failedRunBasisDigest: input.expectedFailedRunBasisDigest,
    });
    const retryScopeDigest = canonicalDigest({
      schema: 'procurement.retry-scope@1',
      failedRunId: input.failedProcurementRunId,
      failedRunBasisDigest: input.expectedFailedRunBasisDigest,
      items: members.map((member) => ({
        ordinal: member.ordinal,
        materialKey: member.materialKey,
        failedRunMaterialDigest: member.failedRunMaterialDigest,
      })),
    });
    const preconditionSetDigest = canonicalDigest({
      schema: 'procurement.retry-precondition-set@1',
      retryAdmissionHeadDigest: retryAdmissionHead.headDigest,
      items: members.map((member) => ({
        ordinal: member.ordinal,
        materialKey: member.materialKey,
        memberPreconditionDigest: member.memberPreconditionDigest,
      })),
    });
    const intentValue = {
      retryIntentId,
      fieldId: input.fieldId,
      failedRunId: input.failedProcurementRunId,
      failedRunBasisDigest: input.expectedFailedRunBasisDigest,
      retryAdmissionHead,
      members: Object.freeze(members),
      retryScopeDigest,
      preconditionSetDigest,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
    };
    const intent = validateRetryIntent(Object.freeze({
      ...intentValue,
      intentDigest: canonicalDigest(intentValue),
    }), options.triageRegistry);

    const newRunId = stableId('procurement-run-', {
      retryIntentId,
      retryScopeDigest,
    });
    const mayCreateRun = controls.every((control) =>
      control.resultKind === 'available' &&
      (control.controlState === 'uncontrolled' ||
        control.ownerDomain === 'procurement' &&
        control.ownerScopeType === 'material_field' &&
        control.ownerScopeId === input.fieldId));
    const newRunBasis = mayCreateRun ? createRetryBasis({ newRunId, retryIntentId,
      head:retryAdmissionHead, failedMembers:snapshot.failedMembers, materials:snapshot.materials,
      controls, triageRegistry:options.triageRegistry }) : null;
    const reference = Object.freeze({ schemaRef:REFERENCE_SCHEMA, schemaVersion:1, request:Object.freeze({...input}), retryIntentId,
      intentDigest:intent.intentDigest, retryScopeDigest, newRunId, newRunBasisDigest:newRunBasis?.basisDigest || null });

    const intentEventId = stableId('retry-intent-event-', { workId });
    const admissionEventId = stableId('retry-admission-event-', { workId });
    const intentRequest = Object.freeze({
      intent,
      commitMarker: Object.freeze({
        commitMarker: stableId('retry-intent-marker-', { retryIntentId }),
        commitDigest: canonicalDigest({
          schema: 'procurement.retry-intent-command@1',
          workId,
          intentDigest: intent.intentDigest,
        }),
      }),
      resultBinding: Object.freeze({
        resultId: stableId('retry-intent-result-', { retryIntentId }),
        eventId: intentEventId,
      }),
      outbox: Object.freeze({
        messageId: stableId('retry-intent-message-', { retryIntentId }),
      }),
    });
    return Object.freeze({
      intentRequest, reference,
      steps: Object.freeze([
        capabilityStep({
          nodeId: 'retry-intent-commit',
          eventId: intentEventId,
          capabilityRef: INTENT_CAPABILITY,
          inputSchemaRef: INPUT_SET,
          input: bindingSet('intent', reference),
          basisDigest,
          fieldId: input.fieldId,
          failedRunId: input.failedProcurementRunId,
        }),
        capabilityStep({
          nodeId: 'retry-admission',
          eventId: admissionEventId,
          capabilityRef: ADMISSION_CAPABILITY,
          inputSchemaRef: INPUT_SET,
          input: bindingSet('admission', reference),
          basisDigest,
          fieldId: input.fieldId,
          failedRunId: input.failedProcurementRunId,
        }),
      ]),
    });
  }

  function retryIntentRow(retryIntentId) {
    return options.unitOfWork.execute([{
      participantId: 'failed_preparation_retry_intent_lookup',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        return context.repository(repository.repositoryId).invoke(
          'find_retry_intent',
          { retry_intent_id: retryIntentId },
        );
      },
    }]).failed_preparation_retry_intent_lookup;
  }

  function assertAvailableMessageRow(payload, row) {
    if (!row ||
        row.retry_intent_id !== payload.retryIntentId ||
        row.field_id !== payload.fieldId ||
        row.failed_run_id !== payload.failedRunId ||
        row.intent_digest !== payload.intentDigest ||
        row.retry_scope_digest !== payload.retryScopeDigest ||
        !['open', 'consumed', 'stale'].includes(row.state) ||
        ![1, 2].includes(Number(row.state_revision)) ||
        (row.state === 'open' && Number(row.state_revision) !== 1) ||
        (row.state !== 'open' && Number(row.state_revision) !== 2)) {
      fail(
        'FAILED_PREPARATION_RETRY_AVAILABLE_MESSAGE_STALE',
        'Procurement Retry Intent Available消息与Owner事实不一致。',
        { retryIntentId: payload.retryIntentId },
      );
    }
  }

  function frozenRetryWork(payload, row) {
    const workId = stableId('failed-preparation-retry-work-', { fieldId:row.field_id, idempotencyKey:row.idempotency_key });
    const snapshot = options.workRuntime.snapshot(workId);
    const reference = readReference(snapshot?.pages);
    const intentEventId = stableId('retry-intent-event-', { workId });
    const admissionEventId = stableId('retry-admission-event-', { workId });
    const eventIds = (snapshot?.events || []).map((event) => event.event_id).sort();
    if (!snapshot?.plan || snapshot.plan.planner_ref !== PLANNER_REF ||
        snapshot.work?.basis_digest !== requestBasisDigest(reference.request) ||
        canonicalDigest(eventIds) !== canonicalDigest([intentEventId, admissionEventId].sort()) ||
        reference.retryIntentId !== payload.retryIntentId || reference.intentDigest !== payload.intentDigest ||
        reference.retryScopeDigest !== payload.retryScopeDigest || reference.request.fieldId !== row.field_id ||
        reference.request.failedProcurementRunId !== row.failed_run_id || reference.request.idempotencyKey !== row.idempotency_key ||
        stableId('retry-intent-marker-', { retryIntentId:reference.retryIntentId }) !== row.create_commit_marker) {
      fail('FAILED_PREPARATION_RETRY_FROZEN_WORK_CORRUPT', 'Retry Intent与精确的Owner Plan引用不一致。', { workId });
    }
    let admissionRequest = admissionCommand(reference, workId);
    if (row.state === 'open') {
      const current = retryConsumer.prepare(admissionRequest);
      // This read prepares a proposal only. The original admission transaction
      // independently repeats every current precondition before creating or staling.
      if (current.preconditionsMatched) {
        const basis = createRetryBasis({ newRunId:reference.newRunId, retryIntentId:reference.retryIntentId,
          head:current.admissionHead, failedMembers:current.members.map((item) => item.sourceMember),
          materials:current.members.map((item) => item.material),
          controls:current.members.map((item) => item.snapshot.currentControlSnapshot), triageRegistry:options.triageRegistry });
        if (basis.basisDigest !== reference.newRunBasisDigest)
          fail('FAILED_PREPARATION_RETRY_FROZEN_BASIS_DRIFT', '重建的Run Basis与Plan冻结摘要不一致。', { workId });
        admissionRequest = admissionCommand(reference, workId, basis);
      }
    }
    return Object.freeze({ workId, intentEventId, admissionEventId, admissionRequest,
      intentResultId:stableId('retry-intent-result-', { retryIntentId:reference.retryIntentId }) });
  }

  function retryInboxParticipant(payload, admissionResultDigest) {
    return Object.freeze({
      participantId: 'procurement_retry_intent_available_receipt',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        const row = context.repository(repository.repositoryId).invoke(
          'find_retry_intent',
          { retry_intent_id: payload.retryIntentId },
        );
        assertAvailableMessageRow(payload, row);
        if (!['consumed', 'stale'].includes(row.state) ||
            row.consume_result_digest !== admissionResultDigest ||
            typeof row.consume_commit_marker !== 'string' ||
            row.consume_commit_marker.length === 0) {
          fail(
            'FAILED_PREPARATION_RETRY_AVAILABLE_MESSAGE_UNSETTLED',
            'Retry Intent Available消息不能在Admission终态前写入Inbox。',
            { retryIntentId: payload.retryIntentId },
          );
        }
        return Object.freeze({
          retryIntentId: row.retry_intent_id,
          terminalIntentState: row.state,
          admissionResultDigest,
        });
      },
    });
  }

  function consumeAvailable(messagePayload) {
    const payload = validateRetryIntentAvailablePayload(messagePayload);
    const row = retryIntentRow(payload.retryIntentId);
    assertAvailableMessageRow(payload, row);
    const frozen = frozenRetryWork(payload, row);
    readIntentReceipt(row, frozen.workId);

    options.workRuntime.beginEvent(frozen.intentEventId);
    options.workRuntime.completeEvent(
      frozen.intentEventId,
      frozen.intentResultId,
    );
    options.workRuntime.beginEvent(frozen.admissionEventId);
    const retryAdmission = retryConsumer.consume(frozen.admissionRequest);
    options.workRuntime.completeEvent(
      frozen.admissionEventId,
      frozen.admissionRequest.resultBinding.resultId,
    );
    options.workRuntime.complete(frozen.workId);

    const admissionResultDigest = canonicalDigest(retryAdmission.typedResult);
    return Object.freeze({
      workId: frozen.workId,
      retryAdmissionResult: retryAdmission.typedResult,
      replayed: Boolean(retryAdmission.replayed),
      resultDigest: admissionResultDigest,
      inboxParticipant: retryInboxParticipant(payload, admissionResultDigest),
    });
  }

  function retry(input) {
    validateInput(input);
    const basisDigest = requestBasisDigest(input);
    const workId = stableId('failed-preparation-retry-work-', {
      fieldId: input.fieldId,
      idempotencyKey: input.idempotencyKey,
    });
    const existing = options.workRuntime.snapshot(workId);
    if (existing && existing.work.basis_digest !== basisDigest) {
      fail(
        'FAILED_PREPARATION_RETRY_IDEMPOTENCY_CONFLICT',
        '同一幂等键已绑定不同的失败准备重试请求。',
      );
    }

    let frozenReference = null;
    if (existing?.plan) {
      if (existing.plan.planner_ref !== PLANNER_REF)
        fail('FAILED_PREPARATION_RETRY_PLAN_REFERENCE_INVALID', 'Retry只接受当前typed-reference Plan。');
      frozenReference = readReference(existing.pages);
      if (canonicalDigest(frozenReference.request) !== canonicalDigest(input))
        fail('FAILED_PREPARATION_RETRY_IDEMPOTENCY_CONFLICT', 'Retry请求与冻结Plan不一致。');
      const row = retryIntentRow(frozenReference.retryIntentId);
      if (row) {
        const payload = retryIntentAvailablePayload({ ...frozenReference, fieldId:input.fieldId,
          failedRunId:input.failedProcurementRunId });
        const receipt = readIntentReceipt(row, workId);
        const consumed = consumeAvailable(payload);
        return Object.freeze({ workId, state:'succeeded', retryIntentReceipt:receipt,
          retryAdmissionResult:consumed.retryAdmissionResult, replayed:consumed.replayed });
      }
    }
    const assembled = assemble(input, workId, basisDigest);
    if (frozenReference && canonicalDigest(frozenReference) !== canonicalDigest(assembled.reference))
      fail('FAILED_PREPARATION_RETRY_FROZEN_BASIS_DRIFT', 'Intent提交前的Owner事实已偏离Plan冻结摘要。', { workId });

    const admission = createWorkAdmission({
      schemaManifest: options.schemaManifest,
      unitOfWork: options.unitOfWork,
      eligibilityProvider: {
        check: (request) => Object.freeze({
          eligible: request.ownerDomain === 'procurement' &&
            request.processId === input.failedProcurementRunId &&
            request.executionBasisDigest === basisDigest,
          basisDigest,
          reasonCode: 'FAILED_PREPARATION_RETRY_BASIS_STALE',
        }),
      },
      limits: Object.freeze({
        globalOpenWorks: 1_000,
        ownerOpenWorks: 500,
        openEvents: 100_000,
      }),
    }).submit(workDefinition(input, workId, basisDigest));
    if (admission.kind !== 'admitted') {
      fail(
        'FAILED_PREPARATION_RETRY_WORK_DEFERRED',
        '失败准备重试Work当前无法admit。',
        { reasonCode: admission.reasonCode },
      );
    }
    const activated = options.workRuntime.activate({
      executionContract,
      workId,
      ownerDomain: 'procurement',
      basisDigest,
      plannerRef: PLANNER_REF,
      catalogDigest: canonicalDigest({
        schema: 'procurement.failed-preparation-retry-catalog@1',
        capabilities: [INTENT_CAPABILITY, ADMISSION_CAPABILITY],
      }),
      steps: assembled.steps,
    });
    const frozen = activated.snapshot.pages;
    if (canonicalDigest(readReference(frozen)) !== canonicalDigest(assembled.reference))
      fail('FAILED_PREPARATION_RETRY_PLAN_REFERENCE_INVALID', 'Published Retry Plan does not match its Owner proposal.');
    const intentRequest = assembled.intentRequest;
    const intentEventId = stableId('retry-intent-event-', { workId });

    options.workRuntime.beginEvent(intentEventId);
    const intentResult = intentStore.create(intentRequest);
    options.workRuntime.completeEvent(
      intentEventId,
      intentRequest.resultBinding.resultId,
    );
    const consumed = consumeAvailable(
      retryIntentAvailablePayload(intentRequest.intent),
    );

    return Object.freeze({
      workId,
      state: 'succeeded',
      retryIntentReceipt: intentResult.typedResult,
      retryAdmissionResult: consumed.retryAdmissionResult,
      replayed: Boolean(
        admission.replayed &&
        intentResult.replayed &&
        consumed.replayed,
      ),
    });
  }

  return Object.freeze({ consumeAvailable, retry });
}

module.exports = Object.freeze({
  FailedPreparationRetryAdminServiceError,
  createFailedPreparationRetryAdminService,
});
