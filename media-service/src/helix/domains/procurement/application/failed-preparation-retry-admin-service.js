'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
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
      typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0 ||
      input.idempotencyKey.length > 256 ||
      typeof input.failedProcurementRunId !== 'string' ||
      input.failedProcurementRunId.length === 0 ||
      !Number.isSafeInteger(input.expectedFailedRunStateRevision) ||
      input.expectedFailedRunStateRevision < 1 ||
      !SHA256.test(input.expectedFailedRunBasisDigest || '') ||
      typeof input.actorId !== 'string' || input.actorId.length === 0) {
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
      find_field: {
        kind: 'select-one',
        tableId: 'proc_material_fields',
        columns: [
          'field_id',
          'status',
          'current_access_revision',
          'current_observation_revision',
          'extraction_policy_id',
          'extraction_policy_revision',
        ],
        keyColumns: ['field_id'],
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
          'content_hash_algorithm',
          'content_hash',
          'size_bytes',
          'endpoint_id',
          'binding_revision',
          'current_location',
          'reality_digest',
          'provenance_digest',
          'last_snapshot_digest',
          'last_observation_id',
          'eligibility_revision',
          'eligibility_state',
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

function runMember(material, controlSnapshot, ordinal) {
  const value = {
    ordinal,
    materialKey: material.material_key,
    selectionRole: 'triage_input',
    physicalIdentity: {
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1',
      schemaVersion: 1,
      materialKey: material.material_key,
      mountScopeId: material.mount_scope_id,
      inode: String(material.inode),
      contentHashAlgorithm: material.content_hash_algorithm,
      contentHash: material.content_hash,
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
    receiptContract: 'helix://contracts/types/ProcurementControlReceipt/v1',
    eventFenceDigest: canonicalDigest({
      schema: 'procurement.retry-control-event-fence@1',
      procurementRunId: newRunBasis.procurementRunId,
      runBasisDigest: newRunBasis.basisDigest,
    }),
  });
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
  const intentStore = createProcurementRetryIntentStore(options);
  const retryConsumer = createProcurementRetryAdmissionStore(options);

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
        if (!field || field.status !== 'active' || !access || !observation ||
            !observation.completed || !policy) {
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
          if (!material || material.eligibility_state !== 'eligible' ||
              selection.hasConflict) {
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

    const rule = activeTriageRule(options.triageRegistry);
    const headValue = {
      fieldId: input.fieldId,
      fieldStatus: snapshot.field.status,
      fieldAccess: {
        revision: Number(snapshot.access.revision),
        digest: snapshot.access.access_digest,
      },
      terminalObservation: {
        resultKind: 'available',
        revision: Number(snapshot.observation.revision),
        fieldObservationWorkId: snapshot.observation.field_observation_work_id,
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
    let newRunBasis;
    if (mayCreateRun) {
      const selectedMembers = snapshot.materials.map((material, index) =>
        runMember(material, controls[index], index));
      const selectedValue = {
        procurementRunId: newRunId,
        fieldId: input.fieldId,
        members: Object.freeze(selectedMembers),
      };
      const selectedFieldMaterialSet = Object.freeze({
        ...selectedValue,
        selectionDigest: canonicalDigest({
          schema: 'procurement.selected-field-material-set@1',
          ...selectedValue,
        }),
      });
      const basisValue = {
        procurementRunId: newRunId,
        fieldId: input.fieldId,
        fieldStatus: 'active',
        fieldAccess: retryAdmissionHead.fieldAccess,
        terminalObservation: {
          revision: retryAdmissionHead.terminalObservation.revision,
          fieldObservationWorkId:
            retryAdmissionHead.terminalObservation.fieldObservationWorkId,
        },
        extractionPolicy: retryAdmissionHead.extractionPolicy,
        triageRule: rule,
        sourceRetryIntentId: retryIntentId,
        selectedFieldMaterialSet,
      };
      newRunBasis = createProcurementRunExecutionBasis(Object.freeze({
        ...basisValue,
        basisDigest: canonicalDigest(basisValue),
      }), options.triageRegistry);
    }

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
    const admissionRequestValue = {
      retryIntentId,
      expectedStateRevision: 1,
      expectedIntentDigest: intent.intentDigest,
      ...(newRunBasis ? {
        newRunBasis,
        controlHandle: controlHandle(newRunBasis),
        createdControlReceiptId:
          stableId('retry-control-receipt-', { retryIntentId, newRunId }),
      } : {}),
      priorityClass: 'normal',
      commitMarker: Object.freeze({
        commitMarker: stableId('retry-admission-marker-', { retryIntentId }),
        commitDigest: canonicalDigest({
          schema: 'procurement.retry-admission-command@1',
          workId,
          retryIntentId,
          intentDigest: intent.intentDigest,
          newRunBasisDigest: newRunBasis?.basisDigest || null,
        }),
      }),
      resultBinding: Object.freeze({
        resultId: stableId('retry-admission-result-', { retryIntentId }),
        eventId: admissionEventId,
      }),
    };
    const admissionRequest = Object.freeze(admissionRequestValue);
    return Object.freeze({
      steps: Object.freeze([
        capabilityStep({
          nodeId: 'retry-intent-commit',
          eventId: intentEventId,
          capabilityRef: INTENT_CAPABILITY,
          inputSchemaRef:
            'helix://implementation/procurement/retry-intent-command/v1',
          input: Object.freeze({ intentRequest }),
          basisDigest,
          fieldId: input.fieldId,
          failedRunId: input.failedProcurementRunId,
        }),
        capabilityStep({
          nodeId: 'retry-admission',
          eventId: admissionEventId,
          capabilityRef: ADMISSION_CAPABILITY,
          inputSchemaRef:
            'helix://implementation/procurement/retry-admission-command/v1',
          input: Object.freeze({ admissionRequest }),
          basisDigest,
          fieldId: input.fieldId,
          failedRunId: input.failedProcurementRunId,
        }),
      ]),
    });
  }

  function retry(input) {
    validateInput(input);
    const basisValue = {
      schema: 'procurement.admin-failed-preparation-retry-basis@1',
      fieldId: input.fieldId,
      failedProcurementRunId: input.failedProcurementRunId,
      expectedFailedRunStateRevision: input.expectedFailedRunStateRevision,
      expectedFailedRunBasisDigest: input.expectedFailedRunBasisDigest,
      actorId: input.actorId,
    };
    const basisDigest = canonicalDigest(basisValue);
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

    const assembled = existing?.plan
      ? Object.freeze({
        steps: Object.freeze([
          capabilityStep({
            nodeId: 'retry-intent-commit',
            eventId: stableId('retry-intent-event-', { workId }),
            capabilityRef: INTENT_CAPABILITY,
            inputSchemaRef:
              'helix://implementation/procurement/retry-intent-command/v1',
            input: existing.pages[0],
            basisDigest,
            fieldId: input.fieldId,
            failedRunId: input.failedProcurementRunId,
          }),
          capabilityStep({
            nodeId: 'retry-admission',
            eventId: stableId('retry-admission-event-', { workId }),
            capabilityRef: ADMISSION_CAPABILITY,
            inputSchemaRef:
              'helix://implementation/procurement/retry-admission-command/v1',
            input: existing.pages[1],
            basisDigest,
            fieldId: input.fieldId,
            failedRunId: input.failedProcurementRunId,
          }),
        ]),
      })
      : assemble(input, workId, basisDigest);

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
      workId,
      ownerDomain: 'procurement',
      basisDigest,
      plannerRef: 'procurement.failed-preparation-retry-planner@1',
      catalogDigest: canonicalDigest({
        schema: 'procurement.failed-preparation-retry-catalog@1',
        capabilities: [INTENT_CAPABILITY, ADMISSION_CAPABILITY],
      }),
      steps: assembled.steps,
    });
    const frozen = activated.snapshot.pages;
    const intentStep = frozen[0];
    const admissionStep = frozen[1];
    const intentEventId = stableId('retry-intent-event-', { workId });
    const admissionEventId = stableId('retry-admission-event-', { workId });

    options.workRuntime.beginEvent(intentEventId);
    const intentResult = intentStore.create(intentStep.intentRequest);
    options.workRuntime.completeEvent(
      intentEventId,
      intentStep.intentRequest.resultBinding.resultId,
    );

    options.workRuntime.beginEvent(admissionEventId);
    const retryAdmission = retryConsumer.consume(
      admissionStep.admissionRequest,
    );
    options.workRuntime.completeEvent(
      admissionEventId,
      admissionStep.admissionRequest.resultBinding.resultId,
    );
    options.workRuntime.complete(workId);

    return Object.freeze({
      workId,
      state: 'succeeded',
      retryIntentReceipt: intentResult.typedResult,
      retryAdmissionResult: retryAdmission.typedResult,
      replayed: Boolean(
        admission.replayed &&
        intentResult.replayed &&
        retryAdmission.replayed,
      ),
    });
  }

  return Object.freeze({ retry });
}

module.exports = Object.freeze({
  FailedPreparationRetryAdminServiceError,
  createFailedPreparationRetryAdminService,
});
