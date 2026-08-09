"use strict";

const {
  canonicalDigest,
  canonicalJson,
} = require("../../../contracts/canonical-json");
const {
  createMaterialControlAdmissionReadParticipant,
  createMaterialControlParticipant,
} = require("../../../foundation/persistence/material-control");
const {
  createRepositoryDefinition,
} = require("../../../foundation/persistence/owner-repository");
const {
  createProfileHintSnapshot,
  sameProfileHintSnapshot,
} = require("../model/field-profile-hint-contracts");
const {
  activeTriageRule,
  createProcurementRunExecutionBasis,
} = require("../model/procurement-run-contracts");
const {
  STALE_REASONS,
  createRetryConsumeMemberSnapshot,
  retryHeadStaleReason,
  staleMaterialSetDigest,
  validateRetryAdmissionHead,
} = require("../model/procurement-retry-contracts");
const { validateControlHandle } = require("./procurement-run-admission-store");

const RESULT_SCHEMA =
  "helix://contracts/application-types/ProcurementRetryAdmissionResult/v1";
const HEAD_SCHEMA =
  "helix://contracts/application-types/ProcurementRetryAdmissionHead/v1";
const SNAPSHOT_SCHEMA =
  "helix://contracts/application-types/ProcurementRetryConsumeMemberSnapshot/v1";
const RUN_BASIS_SCHEMA =
  "helix://contracts/application-types/ProcurementRunExecutionBasis/v1";
const SHA256 = /^[0-9a-f]{64}$/;

class ProcurementRetryAdmissionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProcurementRetryAdmissionStoreError";
    this.code = code;
    this.details = details;
  }
}
class Replay extends Error {
  constructor(result, marker) {
    super("Retry consume replay");
    this.result = result;
    this.marker = marker;
  }
}
function fail(code, message, details) {
  throw new ProcurementRetryAdmissionStoreError(code, message, details);
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "procurement_retry_consume_foundation",
    owner: "execution-foundation",
    schemaManifest,
    statements: {
      find_marker: {
        kind: "select-one",
        tableId: "fx_commit_markers",
        columns: [
          "commit_marker",
          "owner_domain",
          "scope_type",
          "scope_id",
          "commit_digest",
          "result_id",
          "result_schema_ref",
          "result_digest",
        ],
        keyColumns: ["commit_marker"],
      },
      find_result: {
        kind: "select-one",
        tableId: "fx_event_result_bindings",
        columns: [
          "result_id",
          "result_schema_ref",
          "result_json",
          "result_digest",
        ],
        keyColumns: ["result_id"],
      },
      insert_result: {
        kind: "insert",
        tableId: "fx_event_result_bindings",
        columns: [
          "result_id",
          "event_id",
          "outcome_kind",
          "result_schema_ref",
          "result_json",
          "result_digest",
          "evidence_schema_ref",
          "evidence_json",
          "evidence_digest",
          "effect_receipt_id",
          "committed_at_ms",
        ],
      },
      insert_marker: {
        kind: "insert",
        tableId: "fx_commit_markers",
        columns: [
          "commit_marker",
          "effect_id",
          "owner_domain",
          "scope_type",
          "scope_id",
          "commit_digest",
          "result_id",
          "result_schema_ref",
          "result_digest",
          "committed_at_ms",
        ],
      },
    },
  });
}

function procurementDefinition(schemaManifest) {
  const runColumns = [
    "procurement_run_id",
    "field_id",
    "run_basis_schema_ref",
    "access_revision",
    "access_digest",
    "content_profile_hint",
    "profile_hint_revision",
    "profile_hint_digest",
    "terminal_observation_revision",
    "field_observation_work_id",
    "extraction_policy_id",
    "extraction_policy_revision",
    "extraction_policy_digest",
    "triage_rule_ref",
    "triage_rule_revision",
    "triage_rule_schema_ref",
    "triage_rule_digest",
    "triage_rule_authority_digest",
    "run_basis_digest",
    "retry_intent_id",
    "state",
    "state_revision",
    "seal_outcome",
    "seal_decision_id",
    "seal_decision_digest",
    "seal_evidence_digest",
    "admission_commit_marker",
    "admission_result_digest",
    "seal_commit_marker",
    "seal_result_digest",
    "priority_class",
    "created_at_ms",
    "finished_at_ms",
  ];
  const runMemberColumns = [
    "procurement_run_id",
    "ordinal",
    "material_key",
    "selection_role",
    "mount_scope_id",
    "inode",
    "size_bytes",
    "fingerprint_algorithm",
    "fingerprint_version",
    "content_fingerprint",
    "binding_revision",
    "eligibility_revision",
    "eligibility_basis_digest",
    "last_snapshot_digest",
    "last_observation_id",
    "endpoint_id",
    "location",
    "reality_digest",
    "provenance_digest",
    "expected_control_revision",
    "expected_control_state",
    "expected_control_owner_domain",
    "expected_control_owner_scope_type",
    "expected_control_owner_scope_id",
    "expected_control_region_projection",
    "expected_control_evidence_digest",
    "expected_control_projection_digest",
    "admission_control_action",
    "admitted_control_revision",
    "admitted_control_projection_digest",
    "basis_member_digest",
    "selection_state",
    "candidate_package_id",
    "terminal_disposition",
    "terminal_evidence_digest",
    "selected_at_ms",
    "reservation_updated_at_ms",
  ];
  return createRepositoryDefinition({
    repositoryId: "procurement_retry_consume",
    owner: "procurement",
    schemaManifest,
    statements: {
      find_intent: {
        kind: "select-one",
        tableId: "proc_procurement_retry_intents",
        columns: [
          "retry_intent_id",
          "field_id",
          "intent_digest",
          "state",
          "state_revision",
          "consume_commit_marker",
          "retry_field_status",
          "retry_content_profile_hint",
          "retry_profile_hint_revision",
          "retry_profile_hint_digest",
          "retry_access_revision",
          "retry_access_digest",
          "retry_terminal_observation_revision",
          "retry_field_observation_work_id",
          "retry_extraction_policy_id",
          "retry_extraction_policy_revision",
          "retry_extraction_policy_digest",
          "retry_triage_rule_ref",
          "retry_triage_rule_revision",
          "retry_triage_rule_schema_ref",
          "retry_triage_rule_digest",
          "retry_triage_rule_authority_digest",
        ],
        keyColumns: ["retry_intent_id"],
      },
      find_members: {
        kind: "select-all",
        tableId: "proc_procurement_retry_intent_materials",
        columns: [
          "retry_intent_id",
          "ordinal",
          "material_key",
          "expected_binding_revision",
          "expected_eligibility_revision",
          "expected_eligibility_basis_digest",
          "expected_selection_basis_digest",
          "expected_control_revision",
          "expected_control_state",
          "expected_control_owner_domain",
          "expected_control_owner_scope_type",
          "expected_control_owner_scope_id",
          "expected_control_region_projection",
          "expected_control_evidence_digest",
          "expected_control_projection_digest",
        ],
        keyColumns: ["retry_intent_id"],
        safeIntegers: true,
      },
      find_field: {
        kind: "select-one",
        tableId: "proc_material_fields",
        columns: [
          "field_id",
          "status",
          "current_access_revision",
          "current_profile_hint_revision",
          "current_observation_revision",
          "extraction_policy_id",
          "extraction_policy_revision",
        ],
        keyColumns: ["field_id"],
      },
      find_profile_hint: {
        kind: "select-one",
        tableId: "proc_field_profile_hint_revisions",
        columns: [
          "field_id",
          "revision",
          "content_profile_hint",
          "hint_schema_ref",
          "hint_digest",
        ],
        keyColumns: ["field_id", "revision"],
      },
      find_access: {
        kind: "select-one",
        tableId: "proc_field_access_revisions",
        columns: ["field_id", "revision", "access_digest"],
        keyColumns: ["field_id", "revision"],
      },
      find_observation: {
        kind: "select-one",
        tableId: "proc_field_observations",
        columns: [
          "field_id",
          "revision",
          "field_observation_work_id",
          "content_profile_hint",
          "profile_hint_revision",
          "profile_hint_digest",
          "completed",
        ],
        keyColumns: ["field_id", "revision"],
      },
      find_policy: {
        kind: "select-one",
        tableId: "proc_extraction_policy_revisions",
        columns: ["extraction_policy_id", "revision", "policy_digest"],
        keyColumns: ["extraction_policy_id", "revision"],
      },
      find_material: {
        kind: "select-one",
        tableId: "proc_field_materials",
        columns: [
          "field_id",
          "material_key",
          "mount_scope_id",
          "inode",
          "size_bytes",
          "fingerprint_algorithm",
          "fingerprint_version",
          "content_fingerprint",
          "endpoint_id",
          "binding_revision",
          "current_location",
          "reality_digest",
          "provenance_digest",
          "last_snapshot_digest",
          "last_observation_id",
          "eligibility_revision",
          "eligibility_state",
          "eligibility_basis_digest",
          "eligibility_field_status",
          "eligibility_observation_revision",
          "eligibility_policy_revision",
        ],
        keyColumns: ["field_id", "material_key"],
        safeIntegers: true,
      },
      find_runs: {
        kind: "select-all",
        tableId: "proc_procurement_runs",
        columns: ["procurement_run_id", "state"],
        keyColumns: ["field_id"],
      },
      find_run_member: {
        kind: "select-one",
        tableId: "proc_run_materials",
        columns: [
          "procurement_run_id",
          "material_key",
          "selection_state",
          "candidate_package_id",
          "selection_role",
          "binding_revision",
        ],
        keyColumns: ["procurement_run_id", "material_key"],
      },
      find_candidate: {
        kind: "select-one",
        tableId: "proc_candidate_packages",
        columns: ["candidate_package_id", "package_digest"],
        keyColumns: ["candidate_package_id"],
      },
      consume_intent: {
        kind: "update",
        tableId: "proc_procurement_retry_intents",
        setColumns: [
          "state",
          "state_revision",
          "new_run_id",
          "primary_stale_reason_code",
          "consume_admission_head_schema_ref",
          "consume_admission_head_json",
          "consume_admission_head_digest",
          "consume_commit_marker",
          "consume_result_digest",
          "consumed_at_ms",
        ],
        keyColumns: ["retry_intent_id"],
        compareColumns: [
          { column: "intent_digest", parameter: "expected_intent_digest" },
          { column: "state", parameter: "expected_state" },
          { column: "state_revision", parameter: "expected_state_revision" },
        ],
      },
      consume_member: {
        kind: "update",
        tableId: "proc_procurement_retry_intent_materials",
        setColumns: [
          "consume_snapshot_schema_ref",
          "consume_snapshot_json",
          "consume_snapshot_digest",
          "consume_outcome",
          "consume_stale_reason_code",
          "consumed_at_ms",
        ],
        keyColumns: ["retry_intent_id", "ordinal"],
      },
      insert_run: {
        kind: "insert",
        tableId: "proc_procurement_runs",
        columns: runColumns,
      },
      insert_run_member: {
        kind: "insert",
        tableId: "proc_run_materials",
        columns: runMemberColumns,
      },
    },
  });
}

function expectedHead(intent, registry) {
  const rule = registry.entries.find(
    (item) =>
      item.ruleRef === intent.retry_triage_rule_ref &&
      item.revision === intent.retry_triage_rule_revision,
  );
  if (
    !rule ||
    rule.ruleSchemaRef !== intent.retry_triage_rule_schema_ref ||
    rule.ruleDigest !== intent.retry_triage_rule_digest ||
    rule.authorityDigest !== intent.retry_triage_rule_authority_digest
  )
    fail(
      "P7_RETRY_ADMISSION_RULE_CORRUPT",
      "Intent Triage Rule is absent from the immutable Registry.",
    );
  const profileHintSnapshot = {
    fieldId: intent.field_id,
    revision: intent.retry_profile_hint_revision,
    contentProfileHint: intent.retry_content_profile_hint,
    hintDigest: intent.retry_profile_hint_digest,
  };
  return {
    fieldId: intent.field_id,
    fieldStatus: intent.retry_field_status,
    profileHintSnapshot,
    fieldAccess: {
      revision: intent.retry_access_revision,
      digest: intent.retry_access_digest,
    },
    terminalObservation: {
      resultKind: "available",
      revision: intent.retry_terminal_observation_revision,
      fieldObservationWorkId: intent.retry_field_observation_work_id,
      profileHintSnapshot,
    },
    extractionPolicy: {
      policyId: intent.retry_extraction_policy_id,
      revision: intent.retry_extraction_policy_revision,
      digest: intent.retry_extraction_policy_digest,
    },
    triageRule: rule,
  };
}
function expectedMember(row) {
  return {
    ordinal: Number(row.ordinal),
    materialKey: row.material_key,
    expectedBindingRevision: Number(row.expected_binding_revision),
    expectedEligibilityRevision: Number(row.expected_eligibility_revision),
    expectedEligibilityBasisDigest: row.expected_eligibility_basis_digest,
    expectedSelectionBasisDigest: row.expected_selection_basis_digest,
    expectedControlSnapshot: {
      materialKey: row.material_key,
      resultKind: "available",
      controlRevision: Number(row.expected_control_revision),
      controlState: row.expected_control_state,
      ...(row.expected_control_owner_domain === null
        ? {}
        : {
            ownerDomain: row.expected_control_owner_domain,
            ownerScopeType: row.expected_control_owner_scope_type,
            ownerScopeId: row.expected_control_owner_scope_id,
          }),
      regionProjection: row.expected_control_region_projection,
      evidenceDigest: row.expected_control_evidence_digest,
      projectionDigest: row.expected_control_projection_digest,
    },
  };
}
function currentSelection(repo, runs, materialKey) {
  const activeGuards = [];
  for (const run of runs) {
    const row = repo.invoke("find_run_member", {
      procurement_run_id: run.procurement_run_id,
      material_key: materialKey,
    });
    if (
      !row ||
      !["run_selection", "candidate_delivery"].includes(row.selection_state)
    )
      continue;
    const guard = {
      guardKind: row.selection_state,
      procurementRunId: run.procurement_run_id,
      runState: run.state,
      selectionRole: row.selection_role,
      bindingRevision: Number(row.binding_revision),
    };
    if (row.candidate_package_id !== null) {
      const candidate = repo.invoke("find_candidate", {
        candidate_package_id: row.candidate_package_id,
      });
      if (!candidate)
        fail(
          "P7_RETRY_ADMISSION_CANDIDATE_CORRUPT",
          "Candidate guard points to a missing immutable package.",
        );
      guard.candidatePackageId = row.candidate_package_id;
      guard.packageDigest = candidate.package_digest;
    }
    activeGuards.push(guard);
  }
  activeGuards.sort(
    (a, b) =>
      a.guardKind.localeCompare(b.guardKind) ||
      a.procurementRunId.localeCompare(b.procurementRunId) ||
      (a.candidatePackageId || "").localeCompare(b.candidatePackageId || "") ||
      a.selectionRole.localeCompare(b.selectionRole),
  );
  const value = {
    materialKey,
    activeGuards,
    hasConflict: activeGuards.length > 0,
  };
  return { ...value, selectionBasisDigest: canonicalDigest(value) };
}
function validateCreatedBasis(basis, intent, actualHead, snapshots) {
  if (
    !basis ||
    basis.sourceRetryIntentId !== intent.retry_intent_id ||
    basis.fieldId !== intent.field_id ||
    basis.fieldStatus !== "active" ||
    actualHead.fieldStatus !== "active" ||
    actualHead.terminalObservation.resultKind !== "available" ||
    canonicalJson(basis.profileHintSnapshot) !==
      canonicalJson(actualHead.profileHintSnapshot) ||
    canonicalJson(basis.fieldAccess) !==
      canonicalJson(actualHead.fieldAccess) ||
    canonicalJson(basis.terminalObservation) !==
      canonicalJson({
        revision: actualHead.terminalObservation.revision,
        fieldObservationWorkId:
          actualHead.terminalObservation.fieldObservationWorkId,
        profileHintSnapshot: actualHead.terminalObservation.profileHintSnapshot,
      }) ||
    canonicalJson(basis.extractionPolicy) !==
      canonicalJson(actualHead.extractionPolicy) ||
    canonicalJson(basis.triageRule) !== canonicalJson(actualHead.triageRule) ||
    basis.selectedFieldMaterialSet.members.length !== snapshots.length
  )
    fail(
      "P7_RETRY_ADMISSION_BASIS_MISMATCH",
      "Retry Run Basis does not bind the matched Intent and current admission head.",
    );
  for (const [index, item] of snapshots.entries()) {
    const material = item.material,
      control = item.snapshot.currentControlSnapshot,
      raw = {
        ordinal: index,
        materialKey: item.expected.materialKey,
        selectionRole: "triage_input",
        physicalIdentity: {
          schemaRef: "helix://contracts/types/PhysicalMaterialIdentity/v2",
          schemaVersion: 2,
          materialKey: item.expected.materialKey,
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
        controlSnapshot: control,
        admissionControlAction:
          control.controlState === "uncontrolled"
            ? "acquire"
            : "assert_same_field",
      };
    const expected = { ...raw, basisMemberDigest: canonicalDigest(raw) };
    if (
      canonicalJson(basis.selectedFieldMaterialSet.members[index]) !==
      canonicalJson(expected)
    )
      fail(
        "P7_RETRY_ADMISSION_BASIS_MEMBER_MISMATCH",
        "Retry Run Basis member does not match the current immutable admission snapshot.",
      );
  }
}

function createProcurementRetryAdmissionStore(options) {
  if (
    !options ||
    !options.schemaManifest ||
    !options.unitOfWork ||
    !options.triageRegistry
  )
    fail(
      "P7_RETRY_ADMISSION_DEPENDENCIES",
      "Retry consume dependencies are required.",
    );
  const foundation = foundationDefinition(options.schemaManifest),
    procurement = procurementDefinition(options.schemaManifest);
  return Object.freeze({
    consume(request) {
      if (
        !request ||
        !request.retryIntentId ||
        !request.expectedIntentDigest ||
        !request.commitMarker ||
        !request.resultBinding
      )
        fail(
          "P7_RETRY_ADMISSION_REQUEST_INVALID",
          "Retry consume request is incomplete.",
        );
      if (
        !SHA256.test(request.expectedIntentDigest) ||
        !SHA256.test(request.commitMarker.commitDigest || "")
      )
        fail(
          "P7_RETRY_ADMISSION_REQUEST_INVALID",
          "Retry consume digests are invalid.",
        );
      const expectedRevision = request.expectedStateRevision,
        newBasis = request.newRunBasis
          ? createProcurementRunExecutionBasis(
              request.newRunBasis,
              options.triageRegistry,
            )
          : null;
      if (newBasis) validateControlHandle(request.controlHandle, newBasis);
      let intent,
        memberRows,
        actualHead,
        snapshots,
        controlSnapshots,
        result,
        created = false,
        controlResults = [];
      const preflight = {
        participantId: "procurement_retry_consume_preflight",
        owner: "execution-foundation",
        boundBusinessOwner: "procurement",
        repositories: [foundation],
        execute(context) {
          const repo = context.repository(foundation.repositoryId),
            marker = repo.invoke("find_marker", {
              commit_marker: request.commitMarker.commitMarker,
            });
          if (!marker) return;
          if (
            marker.owner_domain !== "procurement" ||
            marker.scope_type !== "procurement_retry_intent" ||
            marker.scope_id !== request.retryIntentId ||
            marker.commit_digest !== request.commitMarker.commitDigest ||
            marker.result_schema_ref !== RESULT_SCHEMA
          )
            fail(
              "P7_RETRY_ADMISSION_MARKER_CONFLICT",
              "Retry consume marker belongs to another transaction.",
            );
          const row = repo.invoke("find_result", {
            result_id: marker.result_id,
          });
          if (!row)
            fail(
              "P7_RETRY_ADMISSION_REPLAY_CORRUPT",
              "Retry consume Result is missing.",
            );
          let value;
          try {
            value = JSON.parse(row.result_json);
          } catch {
            fail(
              "P7_RETRY_ADMISSION_REPLAY_CORRUPT",
              "Retry consume Result is corrupt.",
            );
          }
          if (
            row.result_schema_ref !== RESULT_SCHEMA ||
            canonicalDigest(value) !== row.result_digest ||
            value.retryIntentId !== request.retryIntentId ||
            value.intentDigest !== request.expectedIntentDigest
          )
            fail(
              "P7_RETRY_ADMISSION_REPLAY_CORRUPT",
              "Retry consume Result does not match the request.",
            );
          throw new Replay(Object.freeze(value), marker.commit_marker);
        },
      };
      const read = {
        participantId: "procurement_retry_consume_read",
        owner: "procurement",
        repositories: [procurement],
        execute(context) {
          const repo = context.repository(procurement.repositoryId);
          intent = repo.invoke("find_intent", {
            retry_intent_id: request.retryIntentId,
          });
          if (
            !intent ||
            intent.intent_digest !== request.expectedIntentDigest ||
            intent.state !== "open" ||
            intent.state_revision !== expectedRevision
          )
            fail(
              "P7_RETRY_ADMISSION_CAS_CONFLICT",
              "Retry Intent is absent or no longer open at the expected revision/digest.",
            );
          memberRows = repo.invoke("find_members", {
            retry_intent_id: request.retryIntentId,
          });
          if (memberRows.length < 1 || memberRows.length > 256)
            fail(
              "P7_RETRY_ADMISSION_MEMBER_CORRUPT",
              "Retry Intent member scope is invalid.",
            );
          memberRows.sort((a, b) =>
            a.material_key.localeCompare(b.material_key),
          );
          const field = repo.invoke("find_field", {
            field_id: intent.field_id,
          });
          if (
            !field ||
            !Number.isSafeInteger(field.current_profile_hint_revision)
          )
            fail(
              "P7_RETRY_ADMISSION_FIELD_CORRUPT",
              "Retry Field or its current Profile Hint head is missing.",
            );
          const hint = repo.invoke("find_profile_hint", {
              field_id: intent.field_id,
              revision: field.current_profile_hint_revision,
            }),
            access = repo.invoke("find_access", {
              field_id: intent.field_id,
              revision: field.current_access_revision,
            }),
            policy = repo.invoke("find_policy", {
              extraction_policy_id: field.extraction_policy_id,
              revision: field.extraction_policy_revision,
            });
          if (!hint || !access || !policy)
            fail(
              "P7_RETRY_ADMISSION_HEAD_CORRUPT",
              "Current Profile Hint, Access, or Policy reference is missing.",
            );
          const profileHintSnapshot = createProfileHintSnapshot({
            fieldId: intent.field_id,
            revision: Number(hint.revision),
            contentProfileHint: hint.content_profile_hint,
            hintDigest: hint.hint_digest,
          });
          const observation =
            field.current_observation_revision === null
              ? null
              : repo.invoke("find_observation", {
                  field_id: intent.field_id,
                  revision: field.current_observation_revision,
                });
          let terminalObservation = { resultKind: "unavailable" };
          if (observation && observation.completed) {
            const observationHint = createProfileHintSnapshot({
              fieldId: intent.field_id,
              revision: Number(observation.profile_hint_revision),
              contentProfileHint: observation.content_profile_hint,
              hintDigest: observation.profile_hint_digest,
            });
            if (sameProfileHintSnapshot(profileHintSnapshot, observationHint))
              terminalObservation = {
                resultKind: "available",
                revision: field.current_observation_revision,
                fieldObservationWorkId: observation.field_observation_work_id,
                profileHintSnapshot: observationHint,
              };
          }
          const value = {
            fieldId: intent.field_id,
            fieldStatus: field.status,
            profileHintSnapshot,
            fieldAccess: {
              revision: field.current_access_revision,
              digest: access.access_digest,
            },
            terminalObservation,
            extractionPolicy: {
              policyId: field.extraction_policy_id,
              revision: field.extraction_policy_revision,
              digest: policy.policy_digest,
            },
            triageRule: activeTriageRule(options.triageRegistry),
          };
          actualHead = { ...value, headDigest: canonicalDigest(value) };
          validateRetryAdmissionHead(actualHead, options.triageRegistry, true);
          const runs = repo.invoke("find_runs", { field_id: intent.field_id });
          snapshots = memberRows.map((row) => {
            const material = repo.invoke("find_material", {
              field_id: intent.field_id,
              material_key: row.material_key,
            });
            return {
              expected: expectedMember(row),
              material,
              actual: {
                materialState: material ? "present" : "missing",
                ...(material
                  ? {
                      currentBindingRevision: Number(material.binding_revision),
                      currentEligibilityRevision: Number(
                        material.eligibility_revision,
                      ),
                      currentEligibilityState: material.eligibility_state,
                      currentEligibilityBasisDigest:
                        material.eligibility_basis_digest,
                    }
                  : {}),
                currentSelection: currentSelection(
                  repo,
                  runs,
                  row.material_key,
                ),
              },
            };
          });
          return snapshots.length;
        },
      };
      const controlRead = createMaterialControlAdmissionReadParticipant({
        schemaManifest: options.schemaManifest,
        materialKeys: () => memberRows.map((row) => row.material_key),
        boundBusinessOwner: "procurement",
        participantId: "procurement_retry_consume_control_read",
        accept(value) {
          controlSnapshots = value;
        },
      });
      const decide = {
        participantId: "procurement_retry_consume_decide",
        owner: "procurement",
        repositories: [procurement],
        execute() {
          const headReason = retryHeadStaleReason(
            expectedHead(intent, options.triageRegistry),
            actualHead,
          );
          snapshots = snapshots.map((item, index) => ({
            ...item,
            snapshot: createRetryConsumeMemberSnapshot({
              retryIntentId: intent.retry_intent_id,
              expectedMember: item.expected,
              actual: {
                ...item.actual,
                currentControlSnapshot: controlSnapshots[index],
              },
              fieldId: intent.field_id,
              currentAdmissionHeadDigest: actualHead.headDigest,
              headReason,
            }),
          }));
          created = snapshots.every(
            (item) => item.snapshot.consumeOutcome === "matched",
          );
          if (created) {
            if (
              !newBasis ||
              !request.controlHandle ||
              !request.createdControlReceiptId
            )
              fail(
                "P7_RETRY_ADMISSION_CREATED_REQUEST_INVALID",
                "Matched Retry Intent requires a complete new Run Basis, Control Handle, and nested receipt identity.",
              );
            validateCreatedBasis(newBasis, intent, actualHead, snapshots);
          }
          return snapshots.length;
        },
      };
      let controlMutation = {
        participantId: "procurement_retry_consume_no_control",
        owner: "procurement",
        repositories: [procurement],
        execute() {
          return 0;
        },
      };
      if (newBasis) {
        const placeholder = createMaterialControlParticipant({
          schemaManifest: options.schemaManifest,
          handle: request.controlHandle,
          changes: newBasis.selectedFieldMaterialSet.members.map((member) => ({
            action: member.admissionControlAction,
            identity: {
              schemaRef: "helix://contracts/types/PhysicalMaterialIdentity/v2",
              schemaVersion: 2,
              materialKey: member.materialKey,
              mountScopeId: "pending",
              inode: "0",
              sizeBytes: 0,
              fingerprintAlgorithm: "middle-256k-sha256",
              fingerprintVersion: 1,
              contentFingerprint: "0".repeat(64),
            },
            expectedRevision: member.controlSnapshot.controlRevision,
            expectedProjectionDigest: member.controlSnapshot.projectionDigest,
            fromScope:
              member.admissionControlAction === "assert_same_field"
                ? {
                    ownerDomain: "procurement",
                    scopeType: "material_field",
                    scopeId: newBasis.fieldId,
                  }
                : null,
            toScope:
              member.admissionControlAction === "acquire"
                ? {
                    ownerDomain: "procurement",
                    scopeType: "material_field",
                    scopeId: newBasis.fieldId,
                  }
                : null,
          })),
          authorizedScopeDigest:
            newBasis.selectedFieldMaterialSet.selectionDigest,
          commitMarker: request.commitMarker.commitMarker,
          participantId: "procurement_retry_consume_control",
        });
        controlMutation = {
          ...placeholder,
          execute(context) {
            if (!created) return [];
            const changes = snapshots.map((item, index) => {
              const material = item.material,
                member = newBasis.selectedFieldMaterialSet.members[index];
              return {
                action: member.admissionControlAction,
                identity: {
                  schemaRef:
                    "helix://contracts/types/PhysicalMaterialIdentity/v2",
                  schemaVersion: 2,
                  materialKey: member.materialKey,
                  mountScopeId: material.mount_scope_id,
                  inode: String(material.inode),
                  sizeBytes: Number(material.size_bytes),
                  fingerprintAlgorithm: material.fingerprint_algorithm,
                  fingerprintVersion: Number(material.fingerprint_version),
                  contentFingerprint: material.content_fingerprint,
                },
                expectedRevision: member.controlSnapshot.controlRevision,
                expectedProjectionDigest:
                  member.controlSnapshot.projectionDigest,
                fromScope:
                  member.admissionControlAction === "assert_same_field"
                    ? {
                        ownerDomain: "procurement",
                        scopeType: "material_field",
                        scopeId: newBasis.fieldId,
                      }
                    : null,
                toScope:
                  member.admissionControlAction === "acquire"
                    ? {
                        ownerDomain: "procurement",
                        scopeType: "material_field",
                        scopeId: newBasis.fieldId,
                      }
                    : null,
              };
            });
            controlResults = createMaterialControlParticipant({
              schemaManifest: options.schemaManifest,
              handle: request.controlHandle,
              changes,
              authorizedScopeDigest:
                newBasis.selectedFieldMaterialSet.selectionDigest,
              commitMarker: request.commitMarker.commitMarker,
              participantId: "procurement_retry_consume_control_actual",
            }).execute(context);
            return controlResults;
          },
        };
      }
      const resultParticipant = {
        participantId: "procurement_retry_consume_result",
        owner: "execution-foundation",
        boundBusinessOwner: "procurement",
        repositories: [foundation],
        execute(context) {
          if (created) {
            const items = controlResults
                .map((item) => ({
                  materialKey: item.materialKey,
                  admittedControlRevision: item.revision,
                  admittedControlProjectionDigest:
                    item.projection.projectionDigest,
                }))
                .sort((a, b) => a.materialKey.localeCompare(b.materialKey)),
              acquiredMaterialCount = controlResults.filter(
                (item) => item.action === "acquire",
              ).length;
            const controlReceipt = {
              schemaRef: "helix://contracts/types/ProcurementControlReceipt/v1",
              schemaVersion: 1,
              receiptId: request.createdControlReceiptId,
              receiptKind: "procurement_run_admission",
              ownerDomain: "procurement",
              scopeType: "procurement_run",
              scopeId: newBasis.procurementRunId,
              scopeDigest: newBasis.basisDigest,
              committedAtMs: context.commitTimeMs,
              procurementRunId: newBasis.procurementRunId,
              fieldId: newBasis.fieldId,
              runBasisDigest: newBasis.basisDigest,
              selectedMaterialCount: items.length,
              selectedMaterialSetDigest:
                newBasis.selectedFieldMaterialSet.selectionDigest,
              acquiredMaterialCount,
              assertedMaterialCount: items.length - acquiredMaterialCount,
              controlRevisionSetDigest: canonicalDigest({
                schema: "procurement.admitted-control-set@1",
                items,
              }),
            };
            result = Object.freeze({
              schemaRef: RESULT_SCHEMA,
              schemaVersion: 1,
              receiptId: request.resultBinding.resultId,
              receiptKind: "procurement_retry_admission",
              ownerDomain: "procurement",
              scopeType: "procurement_retry_intent",
              scopeId: intent.retry_intent_id,
              scopeDigest: intent.intent_digest,
              committedAtMs: context.commitTimeMs,
              retryIntentId: intent.retry_intent_id,
              intentDigest: intent.intent_digest,
              terminalIntentState: "consumed",
              resultKind: "created",
              createdControlReceipt: controlReceipt,
            });
          } else {
            const stale = snapshots
                .filter((item) => item.snapshot.consumeOutcome === "stale")
                .map((item) => item.snapshot),
              reasonSet = new Set(stale.map((item) => item.staleReasonCode)),
              staleReasonCodes = STALE_REASONS.filter((code) =>
                reasonSet.has(code),
              );
            result = Object.freeze({
              schemaRef: RESULT_SCHEMA,
              schemaVersion: 1,
              receiptId: request.resultBinding.resultId,
              receiptKind: "procurement_retry_admission",
              ownerDomain: "procurement",
              scopeType: "procurement_retry_intent",
              scopeId: intent.retry_intent_id,
              scopeDigest: intent.intent_digest,
              committedAtMs: context.commitTimeMs,
              retryIntentId: intent.retry_intent_id,
              intentDigest: intent.intent_digest,
              terminalIntentState: "stale",
              resultKind: "stale",
              staleMaterialCount: stale.length,
              staleMaterialSetDigest: staleMaterialSetDigest(stale),
              staleReasonCodes,
            });
          }
          const json = canonicalJson(result),
            resultDigest = canonicalDigest(result);
          context
            .repository(foundation.repositoryId)
            .invoke("insert_result", {
              result_id: request.resultBinding.resultId,
              event_id: request.resultBinding.eventId,
              outcome_kind: "succeeded",
              result_schema_ref: RESULT_SCHEMA,
              result_json: json,
              result_digest: resultDigest,
              evidence_schema_ref: RESULT_SCHEMA,
              evidence_json: json,
              evidence_digest: resultDigest,
              effect_receipt_id: null,
              committed_at_ms: context.commitTimeMs,
            });
          return resultDigest;
        },
      };
      const marker = {
        participantId: "procurement_retry_consume_marker",
        owner: "execution-foundation",
        boundBusinessOwner: "procurement",
        repositories: [foundation],
        execute(context) {
          context
            .repository(foundation.repositoryId)
            .invoke("insert_marker", {
              commit_marker: request.commitMarker.commitMarker,
              effect_id: request.commitMarker.effectId || null,
              owner_domain: "procurement",
              scope_type: "procurement_retry_intent",
              scope_id: intent.retry_intent_id,
              commit_digest: request.commitMarker.commitDigest,
              result_id: request.resultBinding.resultId,
              result_schema_ref: RESULT_SCHEMA,
              result_digest: canonicalDigest(result),
              committed_at_ms: context.commitTimeMs,
            });
        },
      };
      const write = {
        participantId: "procurement_retry_consume_write",
        owner: "procurement",
        repositories: [procurement],
        execute(context) {
          const repo = context.repository(procurement.repositoryId);
          const headJson = canonicalJson(actualHead);
          const resultDigest = canonicalDigest(result);
          const primary = created ? null : result.staleReasonCodes[0];
          const update = repo.invoke("consume_intent", {
            state: created ? "consumed" : "stale",
            state_revision: expectedRevision + 1,
            new_run_id: created ? newBasis.procurementRunId : null,
            primary_stale_reason_code: primary,
            consume_admission_head_schema_ref: HEAD_SCHEMA,
            consume_admission_head_json: headJson,
            consume_admission_head_digest: actualHead.headDigest,
            consume_commit_marker: request.commitMarker.commitMarker,
            consume_result_digest: resultDigest,
            consumed_at_ms: context.commitTimeMs,
            retry_intent_id: intent.retry_intent_id,
            expected_intent_digest: intent.intent_digest,
            expected_state: "open",
            expected_state_revision: expectedRevision,
          });
          if (update.changes !== 1)
            fail(
              "P7_RETRY_ADMISSION_CAS_CONFLICT",
              "Retry Intent consume CAS lost its expected head.",
            );
          for (const item of snapshots) {
            const snapshot = item.snapshot;
            const changed = repo.invoke("consume_member", {
              consume_snapshot_schema_ref: SNAPSHOT_SCHEMA,
              consume_snapshot_json: canonicalJson(snapshot),
              consume_snapshot_digest: snapshot.snapshotDigest,
              consume_outcome: snapshot.consumeOutcome,
              consume_stale_reason_code: snapshot.staleReasonCode || null,
              consumed_at_ms: context.commitTimeMs,
              retry_intent_id: intent.retry_intent_id,
              ordinal: snapshot.ordinal,
            });
            if (changed.changes !== 1)
              fail(
                "P7_RETRY_ADMISSION_MEMBER_CAS_CONFLICT",
                "Retry member consume snapshot was not persisted.",
              );
          }
          if (created) {
            const rule = newBasis.triageRule;
            repo.invoke("insert_run", {
              procurement_run_id: newBasis.procurementRunId,
              field_id: newBasis.fieldId,
              run_basis_schema_ref: RUN_BASIS_SCHEMA,
              access_revision: newBasis.fieldAccess.revision,
              access_digest: newBasis.fieldAccess.digest,
              content_profile_hint:
                newBasis.profileHintSnapshot.contentProfileHint,
              profile_hint_revision: newBasis.profileHintSnapshot.revision,
              profile_hint_digest: newBasis.profileHintSnapshot.hintDigest,
              terminal_observation_revision:
                newBasis.terminalObservation.revision,
              field_observation_work_id:
                newBasis.terminalObservation.fieldObservationWorkId,
              extraction_policy_id: newBasis.extractionPolicy.policyId,
              extraction_policy_revision: newBasis.extractionPolicy.revision,
              extraction_policy_digest: newBasis.extractionPolicy.digest,
              triage_rule_ref: rule.ruleRef,
              triage_rule_revision: rule.revision,
              triage_rule_schema_ref: rule.ruleSchemaRef,
              triage_rule_digest: rule.ruleDigest,
              triage_rule_authority_digest: rule.authorityDigest,
              run_basis_digest: newBasis.basisDigest,
              retry_intent_id: intent.retry_intent_id,
              state: "active",
              state_revision: 1,
              seal_outcome: null,
              seal_decision_id: null,
              seal_decision_digest: null,
              seal_evidence_digest: null,
              admission_commit_marker: request.commitMarker.commitMarker,
              admission_result_digest: resultDigest,
              seal_commit_marker: null,
              seal_result_digest: null,
              priority_class: request.priorityClass || "normal",
              created_at_ms: context.commitTimeMs,
              finished_at_ms: null,
            });
            const admittedByKey = new Map(
              controlResults.map((item) => [item.materialKey, item]),
            );
            for (const member of newBasis.selectedFieldMaterialSet.members) {
              const admitted = admittedByKey.get(member.materialKey);
              const control = member.controlSnapshot;
              repo.invoke("insert_run_member", {
                procurement_run_id: newBasis.procurementRunId,
                ordinal: member.ordinal,
                material_key: member.materialKey,
                selection_role: member.selectionRole,
                mount_scope_id: member.physicalIdentity.mountScopeId,
                inode: member.physicalIdentity.inode,
                size_bytes: member.physicalIdentity.sizeBytes,
                fingerprint_algorithm:
                  member.physicalIdentity.fingerprintAlgorithm,
                fingerprint_version:
                  member.physicalIdentity.fingerprintVersion,
                content_fingerprint: member.physicalIdentity.contentFingerprint,
                binding_revision: member.bindingRevision,
                eligibility_revision: member.eligibilityRevision,
                eligibility_basis_digest: member.eligibilityBasisDigest,
                last_snapshot_digest: member.lastSnapshotDigest,
                last_observation_id: member.lastObservationId,
                endpoint_id: member.endpointId,
                location: member.location,
                reality_digest: member.realityDigest,
                provenance_digest: member.provenanceDigest,
                expected_control_revision: control.controlRevision,
                expected_control_state: control.controlState,
                expected_control_owner_domain: control.ownerDomain || null,
                expected_control_owner_scope_type:
                  control.ownerScopeType || null,
                expected_control_owner_scope_id: control.ownerScopeId || null,
                expected_control_region_projection: control.regionProjection,
                expected_control_evidence_digest: control.evidenceDigest,
                expected_control_projection_digest: control.projectionDigest,
                admission_control_action: member.admissionControlAction,
                admitted_control_revision: admitted.revision,
                admitted_control_projection_digest:
                  admitted.projection.projectionDigest,
                basis_member_digest: member.basisMemberDigest,
                selection_state: "run_selection",
                candidate_package_id: null,
                terminal_disposition: null,
                terminal_evidence_digest: null,
                selected_at_ms: context.commitTimeMs,
                reservation_updated_at_ms: context.commitTimeMs,
              });
            }
          }
          return result;
        },
      };
      try {
        const values = options.unitOfWork.execute([
          preflight,
          read,
          controlRead,
          decide,
          controlMutation,
          resultParticipant,
          marker,
          write,
        ]);
        return Object.freeze({
          replayed: false,
          typedResult: values.procurement_retry_consume_write,
          commitMarker: request.commitMarker.commitMarker,
        });
      } catch (error) {
        if (error instanceof Replay)
          return Object.freeze({
            replayed: true,
            typedResult: error.result,
            commitMarker: error.marker,
          });
        throw error;
      }
    },
  });
}

module.exports = Object.freeze({
  HEAD_SCHEMA,
  ProcurementRetryAdmissionStoreError,
  RESULT_SCHEMA,
  SNAPSHOT_SCHEMA,
  createProcurementRetryAdmissionStore,
});
