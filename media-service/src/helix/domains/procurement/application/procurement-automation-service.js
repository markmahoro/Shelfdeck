'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const {
  createMaterialControlProjectionPort,
} = require('../../../foundation/persistence/material-control');
const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');
const {
  evaluateExtractionEligibility,
} = require('../model/extraction-eligibility');
const {
  activeTriageRule,
  createProcurementRunExecutionBasis,
} = require('../model/procurement-run-contracts');
const {
  createEligibilityReconcileStore,
} = require('../persistence/eligibility-reconcile-store');
const {
  createProcurementRunSlices,
} = require('../model/procurement-run-creator');
const {
  createProcurementRunAdmissionStore,
} = require('../persistence/procurement-run-admission-store');

const CAPABILITY_REF = 'procurement.material.control.acquire@1';
const CAPABILITY_INPUTS =
  'helix://contracts/capabilities/procurement.material.control.acquire/v1/inputs';
const CAPABILITY_PARAMETERS =
  'helix://contracts/capabilities/procurement.material.control.acquire/v1/parameters';
const CAPABILITY_FENCE =
  'helix://contracts/capabilities/procurement.material.control.acquire/v1/fence';
const CAPABILITY_DEMAND =
  'helix://contracts/capabilities/procurement.material.control.acquire/v1/resource-demand';
const RESULT_SCHEMA = 'helix://contracts/types/ProcurementControlReceipt/v1';
// The active reconciliation path uses the Run Creator's logical/physical
// packing.  The synchronous helper is intentionally unavailable; retain the
// same Foundation physical bound if it is ever called by a fixture.
const MAX_RUN_MEMBERS = 1024;
const RECONCILE_BATCH_SIZE = 100;

class ProcurementAutomationServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProcurementAutomationServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProcurementAutomationServiceError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function repositoryDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'procurement_automation_snapshot',
    owner: 'procurement',
    schemaManifest,
    statements: {
      find_field: {
        kind: 'select-one',
        tableId: 'proc_material_fields',
        columns: [
          'field_id',
          'status',
          'extraction_policy_id',
          'extraction_policy_revision',
          'current_access_revision',
          'current_profile_hint_revision',
          'current_observation_revision',
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
        columns: [
          'field_id',
          'revision',
          'root_location',
          'access_digest',
        ],
        keyColumns: ['field_id', 'revision'],
        safeIntegers: true,
      },
      find_policy: {
        kind: 'select-one',
        tableId: 'proc_extraction_policy_revisions',
        columns: [
          'extraction_policy_id',
          'revision',
          'policy_json',
          'policy_digest',
        ],
        keyColumns: ['extraction_policy_id', 'revision'],
        safeIntegers: true,
      },
      find_observation: {
        kind: 'select-one',
        tableId: 'proc_field_observations',
        columns: [
          'field_id',
          'revision',
          'observation_id',
          'field_observation_work_id',
          'access_revision',
          'content_profile_hint',
          'profile_hint_revision',
          'profile_hint_digest',
          'completed',
        ],
        keyColumns: ['field_id', 'revision'],
        safeIntegers: true,
      },
      find_observation_id: {
        kind: 'select-one',
        tableId: 'proc_field_observations',
        columns: [
          'observation_id',
          'field_observation_work_id',
        ],
        keyColumns: ['observation_id'],
      },
      list_materials: {
        kind: 'select-all',
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
          'access_revision',
          'current_location',
          'binding_revision',
          'reality_digest',
          'provenance_digest',
          'last_snapshot_digest',
          'last_observation_id',
          'eligibility_revision',
          'eligibility_state',
          'eligibility_basis_digest',
          'eligibility_field_status',
          'eligibility_observation_revision',
          'eligibility_policy_revision',
          'selection_basis_digest',
          'control_projection',
          'control_projection_revision',
          'control_projection_digest',
        ],
        keyColumns: ['field_id'],
        safeIntegers: true,
      },
      list_material_fields: {
        kind: 'select-all',
        tableId: 'proc_field_materials',
        columns: ['field_id', 'material_key'],
        keyColumns: ['material_key'],
      },
      list_runs: {
        kind: 'select-all',
        tableId: 'proc_procurement_runs',
        columns: [
          'procurement_run_id',
          'state',
        ],
        keyColumns: ['field_id'],
      },
      find_run_material: {
        kind: 'select-one',
        tableId: 'proc_run_materials',
        columns: [
          'procurement_run_id',
          'material_key',
          'selection_role',
          'selection_state',
          'binding_revision',
        ],
        keyColumns: ['procurement_run_id', 'material_key'],
        safeIntegers: true,
      },
      find_run: {
        kind: 'select-one',
        tableId: 'proc_procurement_runs',
        columns: [
          'procurement_run_id',
          'field_id',
          'access_revision',
          'access_digest',
          'content_profile_hint',
          'profile_hint_revision',
          'profile_hint_digest',
          'terminal_observation_revision',
          'field_observation_work_id',
          'extraction_policy_id',
          'extraction_policy_revision',
          'extraction_policy_digest',
          'triage_rule_ref',
          'triage_rule_revision',
          'triage_rule_digest',
          'triage_rule_authority_digest',
          'run_basis_digest',
          'state',
          'state_revision',
          'admission_commit_marker',
          'admission_result_digest',
        ],
        keyColumns: ['procurement_run_id'],
        safeIntegers: true,
      },
      list_run_materials: {
        kind: 'select-all',
        tableId: 'proc_run_materials',
        columns: [
          'procurement_run_id',
          'ordinal',
          'material_key',
          'selection_state',
          'admitted_control_revision',
          'admitted_control_projection_digest',
        ],
        keyColumns: ['procurement_run_id'],
        safeIntegers: true,
      },
    },
  });
}

function relativeLocation(root, location) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocation = location.replace(/\\/g, '/');
  const prefix = normalizedRoot + '/';
  if (!normalizedLocation.startsWith(prefix) ||
      normalizedLocation.length === prefix.length) {
    return null;
  }
  return normalizedLocation.slice(prefix.length);
}

function extension(location) {
  const name = location.slice(location.lastIndexOf('/') + 1);
  const index = name.lastIndexOf('.');
  return index < 0
    ? ''
    : name.slice(index).replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function selectionSnapshot(repo, runs, material) {
  const activeSelections = runs
    .filter((run) => ['active', 'waiting'].includes(run.state))
    .map((run) => {
      const selected = repo.invoke('find_run_material', {
        procurement_run_id: run.procurement_run_id,
        material_key: material.material_key,
      });
      return selected &&
        ['run_selection', 'candidate_delivery'].includes(selected.selection_state) && {
          procurementRunId: run.procurement_run_id,
          runState: run.state,
          selectionRole: selected.selection_role,
          bindingRevision: Number(selected.binding_revision),
        };
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.procurementRunId.localeCompare(right.procurementRunId) ||
      left.selectionRole.localeCompare(right.selectionRole));
  const value = {
    materialKey: material.material_key,
    activeSelections,
    hasConflict: activeSelections.length > 0,
  };
  return Object.freeze({
    ...value,
    selectionBasisDigest: canonicalDigest(value),
  });
}

function readOwnerSnapshot(options, repository, observation, rule) {
  return options.unitOfWork.execute([{
    participantId: 'procurement_automation_owner_snapshot',
    owner: 'procurement',
    repositories: [repository],
    execute(context) {
      const repo = context.repository(repository.repositoryId);
      const field = repo.invoke('find_field', { field_id: observation.fieldId });
      if (!field || field.status !== 'active' ||
          Number(field.current_access_revision) !== observation.accessRevision ||
          Number(field.current_observation_revision) !==
            observation.terminalObservationRevision) {
        fail(
          'PROCUREMENT_AUTOMATION_HEAD_STALE',
          'Observation终态不再是Material Field的显式current head。',
        );
      }
      const access = repo.invoke('find_access', {
        field_id: observation.fieldId,
        revision: observation.accessRevision,
      });
      const profileHint = repo.invoke('find_profile_hint', {
        field_id: observation.fieldId,
        revision: Number(field.current_profile_hint_revision),
      });
      const terminalObservation = repo.invoke('find_observation', {
        field_id: observation.fieldId,
        revision: observation.terminalObservationRevision,
      });
      const policy = repo.invoke('find_policy', {
        extraction_policy_id: field.extraction_policy_id,
        revision: field.extraction_policy_revision,
      });
      if (!access || !profileHint ||
          profileHint.hint_schema_ref !==
            'helix://contracts/application-types/MaterialFieldProfileHintSnapshot/v1' ||
          !terminalObservation || !terminalObservation.completed ||
          terminalObservation.field_observation_work_id !==
            observation.observationWorkId ||
          Number(terminalObservation.access_revision) !== observation.accessRevision ||
          terminalObservation.content_profile_hint !== profileHint.content_profile_hint ||
          Number(terminalObservation.profile_hint_revision) !== Number(profileHint.revision) ||
          terminalObservation.profile_hint_digest !== profileHint.hint_digest ||
          !policy) {
        fail(
          'PROCUREMENT_AUTOMATION_HEAD_INCOMPLETE',
          'Run Admission缺少精确Access、terminal Observation或Policy事实。',
        );
      }
      const runId = stableId('procurement-run-', {
        schema: 'procurement.automatic-run-identity@1',
        fieldId: observation.fieldId,
        accessRevision: observation.accessRevision,
        accessDigest: access.access_digest,
        contentProfileHint: profileHint.content_profile_hint,
        profileHintRevision: Number(profileHint.revision),
        profileHintDigest: profileHint.hint_digest,
        terminalObservationRevision: observation.terminalObservationRevision,
        fieldObservationWorkId: observation.observationWorkId,
        policyId: field.extraction_policy_id,
        policyRevision: Number(field.extraction_policy_revision),
        policyDigest: policy.policy_digest,
        triageRuleRef: rule.ruleRef,
        triageRuleRevision: rule.revision,
        triageRuleAuthorityDigest: rule.authorityDigest,
      });
      const existingRun = repo.invoke('find_run', {
        procurement_run_id: runId,
      });
      const materials = repo.invoke('list_materials', {
        field_id: observation.fieldId,
      }).sort((left, right) =>
        left.material_key.localeCompare(right.material_key));
      const runs = repo.invoke('list_runs', {
        field_id: observation.fieldId,
      });
      const appearedInTerminalWork = new Map(materials.map((material) => {
        const lastObservation = repo.invoke('find_observation_id', {
          observation_id: material.last_observation_id,
        });
        return [
          material.material_key,
          Boolean(lastObservation &&
            lastObservation.field_observation_work_id ===
              observation.observationWorkId),
        ];
      }));
      return Object.freeze({
        field,
        access,
        profileHint,
        terminalObservation,
        policy,
        runId,
        existingRun,
        materials: Object.freeze(materials),
        runs: Object.freeze(runs),
        appearedInTerminalWork,
      });
    },
  }]).procurement_automation_owner_snapshot;
}

function readControlSnapshots(options, materialKeys, participantId) {
  if (materialKeys.length === 0) return Object.freeze([]);
  const port = createMaterialControlProjectionPort({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
  });
  const controls = [];
  const orderedKeys=[...materialKeys].sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
  for (let offset = 0; offset < orderedKeys.length; offset += 500) {
    controls.push(...port.getMaterialControlProjections(
      orderedKeys.slice(offset, offset + 500),
    ));
  }
  if (controls.some((control) => control.resultKind !== 'available')) {
    fail(
      'PROCUREMENT_AUTOMATION_CONTROL_UNAVAILABLE',
      'Material Control Projection读取失败。',
      { participantId },
    );
  }
  const byKey=new Map(controls.map((control)=>[control.materialKey,control]));
  return Object.freeze(materialKeys.map((materialKey)=>byKey.get(materialKey)));
}

function policyValue(row) {
  let rules;
  try {
    rules = JSON.parse(row.policy_json);
  } catch {
    fail(
      'PROCUREMENT_AUTOMATION_POLICY_CORRUPT',
      'Extraction Policy持久化值不是合法JSON。',
    );
  }
  return Object.freeze({
    extractionPolicyId: row.extraction_policy_id,
    revision: Number(row.revision),
    ...rules,
    policyDigest: row.policy_digest,
  });
}

function eligibilityDecisions(snapshot, controls, materials = snapshot.materials) {
  const policy = policyValue(snapshot.policy);
  const controlByKey = new Map(controls.map((item) => [item.materialKey, item]));
  return Object.freeze(materials.map((material) => {
    const relative = relativeLocation(
      snapshot.access.root_location,
      material.current_location,
    );
    if (relative === null) {
      fail(
        'PROCUREMENT_AUTOMATION_MATERIAL_OUTSIDE_FIELD',
        'Observed Material不在当前Field Access containment内。',
        { materialKey: material.material_key },
      );
    }
    const control = controlByKey.get(material.material_key);
    if (!control) {
      fail(
        'PROCUREMENT_AUTOMATION_CONTROL_MISSING',
        'Material缺少正式Control Projection。',
        { materialKey: material.material_key },
      );
    }
    return evaluateExtractionEligibility({
      fieldId: snapshot.field.field_id,
      fieldStatus: snapshot.field.status,
      materialKey: material.material_key,
      expectedEligibilityRevision: Number(material.eligibility_revision),
      accessRevision: Number(snapshot.access.revision),
      accessDigest: snapshot.access.access_digest,
      terminalObservationRevision: Number(snapshot.terminalObservation.revision),
      fieldObservationWorkId:
        snapshot.terminalObservation.field_observation_work_id,
      materialBindingRevision: Number(material.binding_revision),
      lastSnapshotDigest: material.last_snapshot_digest,
      lastObservationId: material.last_observation_id,
      appearedInTerminalWork:
        snapshot.appearedInTerminalWork.get(material.material_key),
      materialRelativeLocation: relative,
      sizeBytes: Number(material.size_bytes),
      observedExtension: extension(relative),
      extractionPolicy: policy,
      selectionSnapshot: selectionSnapshot(
        snapshot.repository,
        snapshot.runs,
        material,
      ),
      controlSnapshot: control,
    });
  }));
}

function needsEligibilityReconcile(material, snapshot, changedMaterialKeys = null) {
  return changedMaterialKeys?.has(material.material_key) ||
    material.eligibility_state === 'unknown' ||
    !material.eligibility_basis_digest ||
    Number(material.access_revision) !== Number(snapshot.access.revision) ||
    material.eligibility_field_status !== snapshot.field.status ||
    Number(material.eligibility_policy_revision) !== Number(snapshot.policy.revision) ||
    material.eligibility_reason_code === 'not_observed_in_current_terminal_work' ||
    !snapshot.appearedInTerminalWork.get(material.material_key);
}

function reconcileEligibility(options, snapshot, decisions) {
  if (decisions.length === 0) return;
  const store = createEligibilityReconcileStore(options);
  for (let offset = 0; offset < decisions.length; offset += RECONCILE_BATCH_SIZE) {
    const batchDecisions = decisions.slice(
      offset,
      offset + RECONCILE_BATCH_SIZE,
    );
    const value = {
      fieldId: snapshot.field.field_id,
      accessRevision: Number(snapshot.access.revision),
      terminalObservationRevision:
        Number(snapshot.terminalObservation.revision),
      policyRevision: Number(snapshot.policy.revision),
      decisions: Object.freeze(batchDecisions),
    };
    const result = store.reconcile(Object.freeze({
      ...value,
      batchDigest: canonicalDigest(value),
    }));
    if (result.staleMaterialKeys.length > 0) {
      fail(
        'PROCUREMENT_AUTOMATION_ELIGIBILITY_STALE',
        'Eligibility reconcile检测到并发变化，拒绝继续Run Admission。',
        { materialKeys: result.staleMaterialKeys },
      );
    }
  }
}

function runMember(material, controlSnapshot, ordinal, scopeMember) {
  if (!scopeMember || typeof scopeMember.fieldRelativeLocation !== 'string' ||
      !Number.isSafeInteger(scopeMember.scopeOrdinal) || !Number.isSafeInteger(scopeMember.scopeMemberOrdinal)) {
    fail('PROCUREMENT_AUTOMATION_SCOPE_MISSING', 'Run Admission requires a frozen Selection Scope for every Material.');
  }
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
  return Object.freeze({
    ...value,
    basisMemberDigest: canonicalDigest(value),
  });
}

function selectedSetForSlice(slice, fieldId, controls) {
  const orderedMembers = [...slice.members]
    .sort((left, right) => Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
  const members = orderedMembers.map((item, index) => runMember(item.material, controls[index], index, item));
  const selectionValue = {
    procurementRunId: slice.procurementRunId,
    fieldId,
    physicalMemberCount: slice.physicalMemberCount,
    selectionScopeCount: slice.selectionScopeCount,
    selectionScopes: slice.selectionScopes,
    scopeSetDigest: slice.scopeSetDigest,
    members: Object.freeze(members),
  };
  return Object.freeze({
    ...selectionValue,
    selectionDigest: canonicalDigest({ schema:'procurement.selected-field-material-set@2', ...selectionValue }),
  });
}

function controlHandle(runBasis) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
    schemaVersion: 1,
    handleId: stableId('procurement-run-control-handle-', {
      procurementRunId: runBasis.procurementRunId,
      basisDigest: runBasis.basisDigest,
    }),
    operationKind: 'acquire',
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: runBasis.procurementRunId,
    basisRef: Object.freeze({
      objectType: 'procurement_run_execution_basis',
      objectId: runBasis.procurementRunId,
      revision: 1,
      digest: runBasis.basisDigest,
    }),
    basisDigest: runBasis.basisDigest,
    canonicalFactSetDigest: runBasis.basisDigest,
    bindingSetDigest: runBasis.selectedFieldMaterialSet.selectionDigest,
    controlScopeDigest: runBasis.selectedFieldMaterialSet.selectionDigest,
    expectedControlRevisions: Object.freeze(
      runBasis.selectedFieldMaterialSet.members.map((member) => Object.freeze({
        materialKey: member.materialKey,
        revision: member.controlSnapshot.controlRevision,
      })),
    ),
    receiptContract: Object.freeze({
      receiptSchemaRef: RESULT_SCHEMA,
      controlRevisionSetSchemaRef: 'procurement.control-revision-set@1',
    }),
    eventFenceDigest: canonicalDigest({
      schema: 'procurement.run-admission-control-event-fence@1',
      procurementRunId: runBasis.procurementRunId,
      runBasisDigest: runBasis.basisDigest,
    }),
  });
}

function workDefinition(runBasis, workId) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId,
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: runBasis.procurementRunId,
    workKind: 'procurement_run_admission',
    workObjectiveTypeRef: 'helix://procurement/work/RunAdmission/v1',
    workObjectiveVersion: 1,
    executionBasisId: stableId('procurement-run-admission-basis-', {
      procurementRunId: runBasis.procurementRunId,
      basisDigest: runBasis.basisDigest,
    }),
    executionBasisDigest: runBasis.basisDigest,
    dependencyRefs: Object.freeze([Object.freeze({
      ownerDomain: 'procurement',
      objectType: 'material_field_observation',
      objectId: runBasis.terminalObservation.fieldObservationWorkId,
      revision: runBasis.terminalObservation.revision,
      digest: runBasis.selectedFieldMaterialSet.selectionDigest,
    })]),
    priorityClass: 'normal_foreground',
    priorityRevision: 1,
    capabilityCatalogScope: 'procurement',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stableId('procurement-run-admission-idempotency-', {
      procurementRunId: runBasis.procurementRunId,
      basisDigest: runBasis.basisDigest,
    }),
    concurrencyScope: runBasis.fieldId + '/procurement-run-admission',
    outputContractRef: RESULT_SCHEMA,
  });
}

function capabilityStep(runBasis, handle, workId, eventId) {
  const input = Object.freeze({
    selectedFieldMaterialSet: runBasis.selectedFieldMaterialSet,
    responsibilityControlCommitHandle: handle,
  });
  const inputSetDigest = canonicalDigest(input);
  const demand = Object.freeze({
    resourceKinds: Object.freeze(['disk_io', 'network']),
  });
  return Object.freeze({
    nodeId: 'procurement-run-admission',
    eventId,
    capabilityRef: CAPABILITY_REF,
    effectClass: 'domain_fact_commit',
    inputSchemaRef: CAPABILITY_INPUTS,
    input,
    parametersSchemaRef: CAPABILITY_PARAMETERS,
    parameters: Object.freeze({}),
    fenceSchemaRef: CAPABILITY_FENCE,
    fenceBasis: Object.freeze({
      basisDigest: runBasis.basisDigest,
      inputSetDigest,
      eventFenceDigest: handle.eventFenceDigest,
      effectScopeDigest: canonicalDigest({
        schema: 'procurement.run-admission-effect-scope@1',
        workId,
        procurementRunId: runBasis.procurementRunId,
        selectionDigest: runBasis.selectedFieldMaterialSet.selectionDigest,
      }),
    }),
    resourceDemandSchemaRef: CAPABILITY_DEMAND,
    resourceDemand: Object.freeze({
      ...demand,
      demandDigest: canonicalDigest(demand),
    }),
  });
}

function resultSummary(run, members, replayed, recovered = false) {
  return Object.freeze({
    stage: 'procurement_run_active',
    procurementRunId: run.procurement_run_id,
    runBasisDigest: run.run_basis_digest,
    state: run.state,
    stateRevision: Number(run.state_revision),
    selectedMaterialCount: members.length,
    materialKeys: Object.freeze(
      members
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
        .map((member) => member.material_key),
    ),
    replayed,
    recovered,
  });
}

function createProcurementAutomationService(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.triageRegistry) {
    fail(
      'PROCUREMENT_AUTOMATION_DEPENDENCIES',
      'Procurement Automation requires Owner-local persistence and Registry.',
    );
  }
  const repository = repositoryDefinition(options.schemaManifest);
  const runAdmissionStore = createProcurementRunAdmissionStore(options);
  const rule = activeTriageRule(options.triageRegistry);

  function snapshot(observation) {
    const value = readOwnerSnapshot(options, repository, observation, rule);
    return Object.freeze({ ...value, repository });
  }

  function recoverExisting(runSnapshot) {
    const run = runSnapshot.existingRun;
    if (run.field_id !== runSnapshot.field.field_id ||
        Number(run.access_revision) !== Number(runSnapshot.access.revision) ||
        run.access_digest !== runSnapshot.access.access_digest ||
        run.content_profile_hint !== runSnapshot.profileHint.content_profile_hint ||
        Number(run.profile_hint_revision) !== Number(runSnapshot.profileHint.revision) ||
        run.profile_hint_digest !== runSnapshot.profileHint.hint_digest ||
        Number(run.terminal_observation_revision) !==
          Number(runSnapshot.terminalObservation.revision) ||
        run.field_observation_work_id !==
          runSnapshot.terminalObservation.field_observation_work_id ||
        run.extraction_policy_id !== runSnapshot.policy.extraction_policy_id ||
        Number(run.extraction_policy_revision) !==
          Number(runSnapshot.policy.revision) ||
        run.extraction_policy_digest !== runSnapshot.policy.policy_digest ||
        run.triage_rule_ref !== rule.ruleRef ||
        Number(run.triage_rule_revision) !== rule.revision ||
        run.triage_rule_digest !== rule.ruleDigest ||
        run.triage_rule_authority_digest !== rule.authorityDigest) {
      fail(
        'PROCUREMENT_AUTOMATION_EXISTING_RUN_CONFLICT',
        'Deterministic Run identity已绑定不同的显式Observation head。',
      );
    }
    const workId = stableId('procurement-run-admission-work-', {
      procurementRunId: run.procurement_run_id,
      basisDigest: run.run_basis_digest,
    });
    const eventId = stableId('procurement-run-admission-event-', { workId });
    const frozen = options.workRuntime.snapshot(workId);
    if (!frozen?.plan || frozen.work.basis_digest !== run.run_basis_digest ||
        frozen.events.length !== 1 ||
        frozen.events[0].event_id !== eventId) {
      fail(
        'PROCUREMENT_AUTOMATION_RUN_PROVENANCE_MISSING',
        'Existing automatic Run缺少其精确Supporting Work provenance。',
      );
    }
    const event = options.workRuntime.beginEvent(eventId);
    if (event.state !== 'succeeded') {
      fail(
        'PROCUREMENT_AUTOMATION_RUN_RESULT_MISSING',
        'Existing automatic Run未绑定可恢复的durable Result。',
      );
    }
    const completion = options.workRuntime.complete(workId);
    const members = options.unitOfWork.execute([{
      participantId: 'procurement_automation_existing_members',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        return context.repository(repository.repositoryId).invoke(
          'list_run_materials',
          { procurement_run_id: run.procurement_run_id },
        );
      },
    }]).procurement_automation_existing_members;
    return resultSummary(
      run,
      members,
      true,
      Boolean(event.recovered || !completion.replayed),
    );
  }

  function reconcileFromObservation(observation, changedMaterialKeys = []) {
    if (!observation || observation.state !== 'succeeded' ||
        typeof observation.fieldId !== 'string' ||
        !Number.isSafeInteger(observation.accessRevision) ||
        !Number.isSafeInteger(observation.terminalObservationRevision) ||
        typeof observation.observationWorkId !== 'string') {
      fail('PROCUREMENT_AUTOMATION_OBSERVATION_INVALID',
        'Procurement Automation只接受正式terminal Observation Result。');
    }
    if (!Array.isArray(changedMaterialKeys) || changedMaterialKeys.length > 256 ||
        new Set(changedMaterialKeys).size !== changedMaterialKeys.length ||
        changedMaterialKeys.some((materialKey) => typeof materialKey !== 'string' || !materialKey)) {
      fail('PROCUREMENT_AUTOMATION_CHANGE_SET_INVALID',
        'Eligibility Change Set must be a unique bounded Material Key list.');
    }
    const changedKeySet = new Set(changedMaterialKeys);
    let current = snapshot(observation);
    if (current.materials.length === 0) return Object.freeze({ stage:'no_observed_material', runs:Object.freeze([]), closedGroups:Object.freeze([]) });
    const changedMaterials = current.materials.filter((material) =>
      needsEligibilityReconcile(material, current, changedKeySet));
    const alreadyReconciled = changedMaterials.length === 0;
    if (!alreadyReconciled) {
      const controls = readControlSnapshots(options, changedMaterials.map((material) => material.material_key),
        'procurement_automation_eligibility_control');
      reconcileEligibility(options, current, eligibilityDecisions(current, controls, changedMaterials));
      current = snapshot(observation);
    }
    const eligible = current.materials.filter((material) =>
      material.eligibility_state === 'eligible' && material.eligibility_field_status === 'active' &&
      Number(material.eligibility_policy_revision) === Number(current.policy.revision));
    const creationBasisDigest = canonicalDigest({ schema:'procurement.run-creator-basis@1', fieldId:observation.fieldId,
      accessRevision:observation.accessRevision, accessDigest:current.access.access_digest,
      profileHintRevision:Number(current.profileHint.revision), profileHintDigest:current.profileHint.hint_digest,
      terminalObservationRevision:observation.terminalObservationRevision,
      fieldObservationWorkId:observation.observationWorkId,
      extractionPolicyId:current.policy.extraction_policy_id, extractionPolicyRevision:Number(current.policy.revision),
      extractionPolicyDigest:current.policy.policy_digest, triageRuleAuthorityDigest:rule.authorityDigest });
    const sliced = createProcurementRunSlices({ fieldId:observation.fieldId, creationBasisDigest,
      maxRunPhysicalMembers:rule.maxRunPhysicalMembers,
      maxSelectionScopeMembers:rule.maxSelectionScopeMembers,
      materials:eligible.map((material) => ({ materialKey:material.material_key,
        relativeLocation:relativeLocation(current.access.root_location, material.current_location), material })) });
    const admittedRuns = [];
    for (const slice of sliced.runs) {
      const orderedMembers=[...slice.members].sort((left,right)=>Buffer.compare(Buffer.from(left.materialKey),Buffer.from(right.materialKey)));
      const controls = readControlSnapshots(options, orderedMembers.map((item) => item.materialKey),
        'procurement_automation_admission_control');
      const selectedFieldMaterialSet = selectedSetForSlice(slice, observation.fieldId, controls);
      const profileHintSnapshot = Object.freeze({ fieldId:observation.fieldId,
        revision:Number(current.profileHint.revision), contentProfileHint:current.profileHint.content_profile_hint,
        hintDigest:current.profileHint.hint_digest });
      const basisValue = { procurementRunId:slice.procurementRunId, fieldId:observation.fieldId, fieldStatus:'active',
        fieldAccess:Object.freeze({ revision:Number(current.access.revision), digest:current.access.access_digest }),
        profileHintSnapshot,
        terminalObservation:Object.freeze({ revision:Number(current.terminalObservation.revision),
          fieldObservationWorkId:current.terminalObservation.field_observation_work_id, profileHintSnapshot }),
        extractionPolicy:Object.freeze({ policyId:current.policy.extraction_policy_id,
          revision:Number(current.policy.revision), digest:current.policy.policy_digest }),
        triageRule:rule, selectedFieldMaterialSet };
      const runBasis = createProcurementRunExecutionBasis(Object.freeze({ ...basisValue,
        basisDigest:canonicalDigest(basisValue) }), options.triageRegistry);
      const handle = controlHandle(runBasis);
      const commitDigest = canonicalDigest({ schema:'procurement.run-admission-command@2',
        runBasisDigest:runBasis.basisDigest, controlHandleDigest:canonicalDigest(handle) });
      const committed = runAdmissionStore.admit({ basis:runBasis, controlHandle:handle, priorityClass:'normal',
        commitMarker:Object.freeze({ commitMarker:stableId('procurement-run-admission-marker-', {
          procurementRunId:runBasis.procurementRunId, basisDigest:runBasis.basisDigest }), commitDigest }) });
      admittedRuns.push(Object.freeze({ procurementRunId:runBasis.procurementRunId,
        runBasisDigest:runBasis.basisDigest, selectedMaterialCount:selectedFieldMaterialSet.physicalMemberCount,
        selectionScopeCount:selectedFieldMaterialSet.selectionScopeCount, replayed:committed.replayed }));
    }
    return Object.freeze({ stage:admittedRuns.length ? 'procurement_runs_active' : 'no_eligible_material',
      runs:Object.freeze(admittedRuns), closedGroups:sliced.closedGroups });
  }

  function reconcileMaterialControlChanges(materialKeys) {
    if (!Array.isArray(materialKeys) || materialKeys.length === 0 || materialKeys.length > 100 ||
        new Set(materialKeys).size !== materialKeys.length ||
        materialKeys.some((materialKey) => typeof materialKey !== 'string' || !materialKey)) {
      fail('PROCUREMENT_AUTOMATION_CONTROL_CHANGE_SET_INVALID',
        'Material Control Change Set must contain 1..100 unique Material Keys.');
    }
    const affected = options.unitOfWork.execute([{
      participantId: 'procurement_automation_control_change_fields',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const fields = new Map();
        for (const materialKey of materialKeys) {
          for (const row of repo.invoke('list_material_fields', { material_key: materialKey })) {
            if (!fields.has(row.field_id)) fields.set(row.field_id, []);
            fields.get(row.field_id).push(materialKey);
          }
        }
        return [...fields.entries()].map(([fieldId, keys]) => {
          const field = repo.invoke('find_field', { field_id: fieldId });
          const observation = field?.current_observation_revision === null || field?.current_observation_revision === undefined
            ? null
            : repo.invoke('find_observation', { field_id: fieldId, revision: field.current_observation_revision });
          return Object.freeze({ field, observation, materialKeys: Object.freeze([...new Set(keys)].sort()) });
        });
      },
    }]).procurement_automation_control_change_fields;
    const reconciled = [];
    for (const item of affected) {
      if (!item.field || item.field.status !== 'active' || !item.observation || Number(item.observation.completed) !== 1) continue;
      reconciled.push(Object.freeze({
        fieldId: item.field.field_id,
        result: reconcileFromObservation(Object.freeze({
          state: 'succeeded',
          fieldId: item.field.field_id,
          accessRevision: Number(item.field.current_access_revision),
          terminalObservationRevision: Number(item.field.current_observation_revision),
          observationWorkId: item.observation.field_observation_work_id,
        }), item.materialKeys),
      }));
    }
    return Object.freeze(reconciled);
  }

  return Object.freeze({ reconcileFromObservation, reconcileMaterialControlChanges });
}

module.exports = Object.freeze({
  ProcurementAutomationServiceError,
  createProcurementAutomationService,
});
