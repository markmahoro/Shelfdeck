"use strict";

const {
  canonicalDigest,
  canonicalJson,
} = require("../../../contracts/canonical-json");
const {
  createRepositoryDefinition,
} = require("../../../foundation/persistence/owner-repository");
const {
  activeRunScopeSetDigest,
  buildOutputRequirement,
} = require("../model/run-admission-contracts");
const {
  applyRunLifecycleDecision,
  buildRunLifecycleDecision,
  buildRunLifecycleResult,
  evidenceMeta,
  RECOVERY_OFFSETS,
} = require("../model/run-lifecycle-contracts");

const RESULT_SCHEMA =
  "helix://contracts/application-types/LibraRunLifecycleResult/v1";
const DECISION_SCHEMA =
  "helix://contracts/application-types/LibraRunLifecycleDecision/v1";
const ACCEPTED_SCHEMA =
  "helix://contracts/messages/ArcaProductAcceptedMessage/v1";
class RunLifecycleStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RunLifecycleStoreError";
    this.code = code;
    this.details = details;
  }
}
class Replay extends Error {
  constructor(result) {
    super("Run lifecycle replay");
    this.result = result;
  }
}
function fail(code, message, details) {
  throw new RunLifecycleStoreError(code, message, details);
}
const number = (value) => Number(value);
const utf8 = (a, b) => Buffer.from(a).compare(Buffer.from(b));

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "libra_run_lifecycle",
    owner: "libra",
    schemaManifest,
    statements: {
      find_run: {
        kind: "select-one",
        tableId: "libra_runs",
        columns: [
          "libra_run_id",
          "subject_id",
          "acceptance_spec_id",
          "run_material_manifest_id",
          "execution_basis_record_json",
          "execution_basis_digest",
          "run_scope_digest",
          "state",
          "state_revision",
          "state_digest",
          "priority_class",
          "priority_intent_digest",
          "recovery_policy_ref",
          "recovery_policy_digest",
          "suspension_started_at_ms",
          "recovery_attempt_ordinal",
          "recovery_next_due_at_ms",
          "latest_freshness_assessment_id",
          "latest_freshness_assessment_digest",
          "package_revision_head",
          "terminal_at_ms",
        ],
        keyColumns: ["libra_run_id"],
      },
      list_runs: {
        kind: "select-all",
        tableId: "libra_runs",
        columns: [
          "libra_run_id",
          "run_scope_digest",
          "state",
          "state_revision",
          "state_digest",
        ],
        keyColumns: ["subject_id"],
      },
      update_run: {
        kind: "update",
        tableId: "libra_runs",
        setColumns: [
          "state",
          "state_revision",
          "state_digest",
          "priority_class",
          "priority_intent_digest",
          "recovery_policy_ref",
          "recovery_policy_digest",
          "suspension_started_at_ms",
          "recovery_attempt_ordinal",
          "recovery_next_due_at_ms",
          "latest_freshness_assessment_id",
          "latest_freshness_assessment_digest",
          "terminal_at_ms",
        ],
        keyColumns: ["libra_run_id"],
        compareColumns: [
          { column: "state_revision", parameter: "expected_state_revision" },
          { column: "state_digest", parameter: "expected_state_digest" },
          { column: "state", parameter: "expected_state" },
        ],
      },
      find_head: {
        kind: "select-one",
        tableId: "libra_run_admission_heads",
        columns: ["subject_id", "head_revision", "active_scope_set_digest"],
        keyColumns: ["subject_id"],
      },
      advance_head: {
        kind: "update",
        tableId: "libra_run_admission_heads",
        setColumns: [
          "head_revision",
          "active_scope_set_digest",
          "updated_at_ms",
        ],
        keyColumns: ["subject_id"],
        compareColumns: [
          { column: "head_revision", parameter: "expected_head_revision" },
          {
            column: "active_scope_set_digest",
            parameter: "expected_scope_digest",
          },
        ],
      },
      find_subject: {
        kind: "select-one",
        tableId: "libra_subjects",
        columns: ["subject_id", "structure_kind", "content_profile", "status"],
        keyColumns: ["subject_id"],
      },
      find_decision_head: {
        kind: "select-one",
        tableId: "libra_subject_decision_heads",
        columns: [
          "subject_id",
          "head_revision",
          "head_digest",
          "current_routing_decision_id",
          "current_decision_basis_id",
          "current_acceptance_spec_id",
        ],
        keyColumns: ["subject_id"],
      },
      find_basis: {
        kind: "select-one",
        tableId: "libra_decision_basis_revisions",
        columns: [
          "decision_basis_id",
          "subject_id",
          "basis_revision",
          "product_scope_digest",
          "input_set_digest",
          "status",
          "unresolved_reason_code",
          "basis_digest",
        ],
        keyColumns: ["decision_basis_id"],
      },
      list_basis_inputs: {
        kind: "select-all",
        tableId: "libra_decision_basis_inputs",
        columns: [
          "decision_basis_id",
          "input_ordinal",
          "input_kind",
          "input_schema_ref",
          "input_object_id",
          "input_revision",
          "input_digest",
          "input_json",
          "result_kind",
          "result_revision",
          "result_digest",
        ],
        keyColumns: ["decision_basis_id"],
      },
      find_spec: {
        kind: "select-one",
        tableId: "libra_acceptance_specs",
        columns: [
          "acceptance_spec_id",
          "subject_id",
          "decision_basis_id",
          "product_scope_digest",
          "spec_revision",
          "spec_json",
          "spec_digest",
          "record_digest",
          "structure_kind",
          "content_profile",
        ],
        keyColumns: ["acceptance_spec_id"],
      },
      find_manifest: {
        kind: "select-one",
        tableId: "libra_run_material_manifests",
        columns: [
          "run_material_manifest_id",
          "libra_run_id",
          "member_count",
          "member_set_digest",
          "episode_scope_digest",
          "manifest_digest",
        ],
        keyColumns: ["run_material_manifest_id"],
      },
      list_members: {
        kind: "select-all",
        tableId: "libra_run_material_members",
        columns: [
          "run_material_manifest_id",
          "ordinal",
          "material_key",
          "role",
          "mount_scope_id",
          "inode",
          "fingerprint_algorithm",
          "fingerprint_version",
          "content_fingerprint",
          "size_bytes",
          "binding_revision",
          "binding_evidence_digest",
          "admitted_control_revision",
          "admitted_control_projection_digest",
          "output_requirement_digest",
          "episode_claim_set_digest",
          "member_digest",
        ],
        keyColumns: ["run_material_manifest_id"],
      },
      list_run_claims: {
        kind: "select-all",
        tableId: "libra_run_material_episode_claims",
        columns: [
          "run_material_manifest_id",
          "member_ordinal",
          "episode_key",
          "season_claim_digest",
          "claim_digest",
        ],
        keyColumns: ["run_material_manifest_id"],
      },
      list_bindings: {
        kind: "select-all",
        tableId: "libra_material_bindings",
        columns: [
          "subject_id",
          "material_key",
          "role",
          "authority_kind",
          "mount_scope_id",
          "inode",
          "fingerprint_algorithm",
          "fingerprint_version",
          "content_fingerprint",
          "size_bytes",
          "binding_revision",
          "health_state",
          "evidence_digest",
          "current",
        ],
        keyColumns: ["subject_id"],
      },
      list_binding_claims: {
        kind: "select-all",
        tableId: "libra_material_binding_episode_claims",
        columns: [
          "subject_id",
          "material_key",
          "binding_revision",
          "episode_key",
          "season_claim_digest",
          "claim_digest",
        ],
        keyColumns: ["subject_id"],
      },
      list_packages: {
        kind: "select-all",
        tableId: "libra_product_packages",
        columns: [
          "on_deck_package_id",
          "offer_id",
          "package_revision",
          "libra_run_id",
          "package_digest",
          "state",
        ],
        keyColumns: ["libra_run_id"],
      },
      list_package_materials: {
        kind: "select-all",
        tableId: "libra_product_package_materials",
        columns: [
          "on_deck_package_id",
          "ordinal",
          "material_key",
          "committed_control_revision",
          "committed_control_projection_digest",
          "member_digest",
        ],
        keyColumns: ["on_deck_package_id"],
      },
      list_package_claims: {
        kind: "select-all",
        tableId: "libra_product_package_material_episode_claims",
        columns: [
          "on_deck_package_id",
          "member_ordinal",
          "episode_key",
          "claim_digest",
        ],
        keyColumns: ["on_deck_package_id"],
      },
      list_offload: {
        kind: "select-all",
        tableId: "libra_offload_context_materials",
        columns: [
          "on_deck_package_id",
          "ordinal",
          "material_key",
          "admitted_control_revision",
          "admitted_control_projection_digest",
          "context_member_digest",
        ],
        keyColumns: ["on_deck_package_id"],
      },
      find_receipt: {
        kind: "select-one",
        tableId: "libra_delivery_receipts",
        columns: [
          "receipt_id",
          "offer_id",
          "on_deck_package_id",
          "package_digest",
          "arca_acceptance_decision_id",
          "arca_acceptance_decision_digest",
          "result",
          "handoff_receipt_id",
          "handoff_receipt_digest",
          "custody_id",
          "arca_binding_set_digest",
          "control_revision_set_digest",
          "closure_digest",
        ],
        keyColumns: ["offer_id"],
      },
      insert_receipt: {
        kind: "insert",
        tableId: "libra_delivery_receipts",
        columns: [
          "receipt_id",
          "offer_id",
          "on_deck_package_id",
          "package_digest",
          "arca_acceptance_decision_id",
          "arca_acceptance_decision_digest",
          "result",
          "handoff_receipt_id",
          "handoff_receipt_digest",
          "custody_id",
          "arca_binding_set_digest",
          "control_revision_set_digest",
          "rejection_digest",
          "closure_digest",
          "received_at_ms",
        ],
      },
      insert_revision: {
        kind: "insert",
        tableId: "libra_run_revisions",
        columns: [
          "libra_run_id",
          "state_revision",
          "state",
          "acceptance_spec_id",
          "execution_basis_digest",
          "run_scope_digest",
          "priority_class",
          "priority_intent_digest",
          "transition_kind",
          "transition_decision_id",
          "transition_decision_digest",
          "transition_evidence_schema_ref",
          "transition_evidence_id",
          "transition_evidence_json",
          "transition_evidence_digest",
          "recovery_policy_ref",
          "recovery_policy_digest",
          "suspension_started_at_ms",
          "recovery_attempt_ordinal",
          "recovery_next_due_at_ms",
          "expected_admission_head_revision",
          "expected_active_scope_set_digest",
          "committed_admission_head_revision",
          "committed_active_scope_set_digest",
          "previous_state_revision",
          "revision_digest",
          "committed_at_ms",
        ],
      },
    },
  });
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "libra_run_lifecycle_foundation",
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
        columns: ["result_id", "result_json", "result_digest"],
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
      find_inbox: {
        kind: "select-one",
        tableId: "fx_inbox",
        columns: [
          "consumer_domain",
          "message_id",
          "dedup_key",
          "result_digest",
        ],
        keyColumns: ["consumer_domain", "message_id"],
      },
      insert_inbox: {
        kind: "insert",
        tableId: "fx_inbox",
        columns: [
          "consumer_domain",
          "message_id",
          "dedup_key",
          "received_at_ms",
          "consumed_at_ms",
          "result_digest",
        ],
      },
      find_work: {
        kind: "select-one",
        tableId: "fx_supporting_works",
        columns: [
          "work_id",
          "owner_domain",
          "process_type",
          "process_id",
          "basis_digest",
          "state",
        ],
        keyColumns: ["work_id"],
      },
      list_works: {
        kind: "select-all",
        tableId: "fx_supporting_works",
        columns: [
          "work_id",
          "owner_domain",
          "process_type",
          "process_id",
          "priority_class",
          "state",
        ],
        keyColumns: [],
      },
      update_work_priority: {
        kind: "update",
        tableId: "fx_supporting_works",
        setColumns: ["priority_class", "updated_at_ms"],
        keyColumns: ["work_id"],
        compareColumns: [
          { column: "priority_class", parameter: "expected_priority_class" },
        ],
      },
      find_plan: {
        kind: "select-one",
        tableId: "fx_workflow_plans",
        columns: ["plan_id", "basis_digest", "graph_digest", "state"],
        keyColumns: ["plan_id"],
      },
      list_plans: {
        kind: "select-all",
        tableId: "fx_workflow_plans",
        columns: ["plan_id", "basis_digest", "graph_digest", "state"],
        keyColumns: [],
      },
      find_event: {
        kind: "select-one",
        tableId: "fx_workflow_events",
        columns: [
          "event_id",
          "plan_id",
          "work_id",
          "owner_domain",
          "capability_ref",
          "state",
        ],
        keyColumns: ["event_id"],
      },
      list_events: {
        kind: "select-all",
        tableId: "fx_workflow_events",
        columns: [
          "event_id",
          "plan_id",
          "work_id",
          "owner_domain",
          "capability_ref",
          "priority_class",
          "state",
        ],
        keyColumns: [],
      },
      update_event_priority: {
        kind: "update",
        tableId: "fx_workflow_events",
        setColumns: ["priority_class"],
        keyColumns: ["event_id"],
        compareColumns: [
          { column: "priority_class", parameter: "expected_priority_class" },
        ],
      },
      list_attempts: {
        kind: "select-all",
        tableId: "fx_event_attempts",
        columns: [
          "event_attempt_id",
          "event_id",
          "ordinal",
          "state",
          "outcome_kind",
          "failure_class",
          "failure_code",
          "evidence_digest",
        ],
        keyColumns: ["event_id"],
      },
      find_event_result: {
        kind: "select-one",
        tableId: "fx_event_result_bindings",
        columns: [
          "event_id",
          "outcome_kind",
          "result_schema_ref",
          "result_json",
          "result_digest",
        ],
        keyColumns: ["event_id"],
      },
    },
  });
}

function controlHistoryDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "libra_run_lifecycle_control_history",
    owner: "material-control-authority",
    schemaManifest,
    statements: {
      find_current: {
        kind: "select-one",
        tableId: "fx_material_controls",
        columns: [
          "material_key",
          "owner_domain",
          "owner_scope_type",
          "owner_scope_id",
          "control_revision",
          "state",
        ],
        keyColumns: ["material_key"],
      },
      find_revision: {
        kind: "select-one",
        tableId: "fx_material_control_revisions",
        columns: [
          "material_key",
          "revision",
          "operation_kind",
          "to_owner_domain",
          "to_scope_type",
          "to_scope_id",
        ],
        keyColumns: ["material_key", "revision"],
      },
    },
  });
}

function controlProjection(value) {
  const evidence = {
      schema: "foundation.material-control-evidence@1",
      materialKey: value.materialKey,
      resultKind: "available",
      controlRevision: value.controlRevision,
      controlState: value.controlState,
      ...(value.ownerDomain
        ? {
            ownerDomain: value.ownerDomain,
            ownerScopeType: value.ownerScopeType,
            ownerScopeId: value.ownerScopeId,
          }
        : {}),
    },
    withEvidence = { ...value, evidenceDigest: canonicalDigest(evidence) };
  return { ...withEvidence, projectionDigest: canonicalDigest(withEvidence) };
}
function currentControl(materialKey, row) {
  if (!row)
    return controlProjection({
      materialKey,
      resultKind: "available",
      controlRevision: 0,
      controlState: "uncontrolled",
      regionProjection: "uncontrolled",
    });
  if (row.state === "released" && row.owner_domain === null)
    return controlProjection({
      materialKey,
      resultKind: "available",
      controlRevision: number(row.control_revision),
      controlState: "uncontrolled",
      regionProjection: "uncontrolled",
    });
  const regions = {
    procurement: "procurement",
    libra: "production",
    arca: "finished_goods",
  };
  if (row.state !== "controlled" || !regions[row.owner_domain])
    return {
      materialKey,
      resultKind: "unavailable",
      failureCode: "control_row_invalid",
    };
  return controlProjection({
    materialKey,
    resultKind: "available",
    controlRevision: number(row.control_revision),
    controlState: "controlled",
    ownerDomain: row.owner_domain,
    ownerScopeType: row.owner_scope_type,
    ownerScopeId: row.owner_scope_id,
    regionProjection: regions[row.owner_domain],
  });
}
function assertHistoricalControls(repo, original, run) {
  for (const member of original.members) {
    const row = repo.invoke("find_revision", {
      material_key: member.materialKey,
      revision: member.controlRevision,
    });
    if (!row)
      fail(
        "P9_RUN_LIFECYCLE_HISTORY",
        "Admitted historical Control revision is absent.",
        { materialKey: member.materialKey },
      );
    let projection;
    if (row.operation_kind === "release")
      projection = controlProjection({
        materialKey: member.materialKey,
        resultKind: "available",
        controlRevision: member.controlRevision,
        controlState: "uncontrolled",
        regionProjection: "uncontrolled",
      });
    else {
      const regions = {
        procurement: "procurement",
        libra: "production",
        arca: "finished_goods",
      };
      if (!regions[row.to_owner_domain])
        fail(
          "P9_RUN_LIFECYCLE_HISTORY",
          "Historical Control post-state is invalid.",
          { materialKey: member.materialKey },
        );
      projection = controlProjection({
        materialKey: member.materialKey,
        resultKind: "available",
        controlRevision: member.controlRevision,
        controlState: "controlled",
        ownerDomain: row.to_owner_domain,
        ownerScopeType: row.to_scope_type,
        ownerScopeId: row.to_scope_id,
        regionProjection: regions[row.to_owner_domain],
      });
    }
    if (
      projection.projectionDigest !== member.controlProjectionDigest ||
      projection.ownerDomain !== "libra" ||
      projection.ownerScopeType !== "subject" ||
      projection.ownerScopeId !== run.subject_id
    )
      fail(
        "P9_RUN_LIFECYCLE_HISTORY",
        "Admitted historical Control projection is inconsistent.",
        { materialKey: member.materialKey },
      );
  }
}

function comparable(value) {
  const members = [...value.members]
    .sort((a, b) => utf8(a.materialKey, b.materialKey))
    .map((item) => {
      const member = {
        materialKey: item.materialKey,
        role: item.role,
        physicalIdentity: item.physicalIdentity,
        sizeBytes: item.sizeBytes,
        bindingRevision: item.bindingRevision,
        bindingEvidenceDigest: item.bindingEvidenceDigest,
        episodeClaimSetDigest: item.episodeClaimSetDigest,
        controlRevision: item.controlRevision,
        controlProjectionDigest: item.controlProjectionDigest,
        outputRequirementDigest: item.outputRequirementDigest,
      };
      member.memberComparisonDigest = canonicalDigest({
        schema: "libra.run-comparable-member-semantic@1",
        materialKey: member.materialKey,
        role: member.role,
        physicalIdentity: member.physicalIdentity,
        sizeBytes: member.sizeBytes,
        bindingRevision: member.bindingRevision,
        bindingEvidenceDigest: member.bindingEvidenceDigest,
        episodeClaimSetDigest: member.episodeClaimSetDigest,
        controlRevision: member.controlRevision,
        controlProjectionDigest: member.controlProjectionDigest,
        outputRequirementSemanticDigest: canonicalDigest({
          schema: "libra.output-requirement-semantic@1",
          acceptanceSpecDigest: value.acceptanceSpecRef.specDigest,
          productScopeDigest: value.productScopeDigest,
          materialKey: member.materialKey,
          materialRole: member.role,
          episodeClaimSetDigest: member.episodeClaimSetDigest,
        }),
      });
      return member;
    });
  const result = {
    subjectId: value.subjectId,
    structureKind: value.structureKind,
    contentProfile: value.contentProfile,
    acceptanceSpecRef: value.acceptanceSpecRef,
    productScopeDigest: value.productScopeDigest,
    members,
    memberSetDigest: canonicalDigest({
      schema: "libra.run-comparable-member-set@1",
      items: members.map((item) => ({
        materialKey: item.materialKey,
        memberComparisonDigest: item.memberComparisonDigest,
      })),
    }),
  };
  result.comparableBasisDigest = canonicalDigest({
    schema: "libra.run-comparable-basis-semantic@1",
    subjectId: result.subjectId,
    structureKind: result.structureKind,
    contentProfile: result.contentProfile,
    acceptanceSpecDigest: result.acceptanceSpecRef.specDigest,
    productScopeDigest: result.productScopeDigest,
    memberSetDigest: result.memberSetDigest,
  });
  return result;
}

function originalSnapshot(repo, run) {
  let record;
  try {
    record = JSON.parse(run.execution_basis_record_json);
  } catch {
    fail("P9_RUN_LIFECYCLE_HISTORY", "Execution Basis JSON is corrupt.");
  }
  if (record.executionBasisDigest !== run.execution_basis_digest)
    fail(
      "P9_RUN_LIFECYCLE_HISTORY",
      "Execution Basis record digest pointer is inconsistent.",
    );
  const manifest = repo.invoke("find_manifest", {
    run_material_manifest_id: run.run_material_manifest_id,
  });
  const members = repo
    .invoke("list_members", {
      run_material_manifest_id: run.run_material_manifest_id,
    })
    .sort((a, b) => number(a.ordinal) - number(b.ordinal));
  const claims = repo.invoke("list_run_claims", {
    run_material_manifest_id: run.run_material_manifest_id,
  });
  if (
    !manifest ||
    manifest.libra_run_id !== run.libra_run_id ||
    manifest.manifest_digest !==
      record.productionMaterialManifestRef?.manifestDigest ||
    number(manifest.member_count) !== members.length
  )
    fail("P9_RUN_LIFECYCLE_HISTORY", "Immutable Run Manifest is inconsistent.");
  const mapped = members.map((row) => {
    const relation = claims
      .filter((item) => number(item.member_ordinal) === number(row.ordinal))
      .sort((a, b) => utf8(a.episode_key, b.episode_key));
    const setDigest = canonicalDigest({
      schema: "libra.production-material-episode-claims@1",
      items: relation.map((item) => ({
        episodeKey: item.episode_key,
        seasonClaimDigest: item.season_claim_digest,
        claimDigest: item.claim_digest,
      })),
    });
    if (setDigest !== row.episode_claim_set_digest)
      fail(
        "P9_RUN_LIFECYCLE_HISTORY",
        "Run Episode relation digest is inconsistent.",
      );
    return {
      materialKey: row.material_key,
      role: row.role,
      physicalIdentity: {
        schemaRef: "helix://contracts/types/PhysicalMaterialIdentity/v2",
        schemaVersion: 2,
        materialKey: row.material_key,
        mountScopeId: row.mount_scope_id,
        inode: row.inode,
        sizeBytes: number(row.size_bytes),
        fingerprintAlgorithm: row.fingerprint_algorithm,
        fingerprintVersion: number(row.fingerprint_version),
        contentFingerprint: row.content_fingerprint,
      },
      sizeBytes: number(row.size_bytes),
      bindingRevision: number(row.binding_revision),
      bindingEvidenceDigest: row.binding_evidence_digest,
      episodeClaimSetDigest: row.episode_claim_set_digest,
      controlRevision: number(row.admitted_control_revision),
      controlProjectionDigest: row.admitted_control_projection_digest,
      outputRequirementDigest: row.output_requirement_digest,
    };
  });
  return comparable({
    subjectId: record.subjectSnapshot.subjectId,
    structureKind: record.subjectSnapshot.structureKind,
    contentProfile: record.subjectSnapshot.contentProfile,
    acceptanceSpecRef: {
      acceptanceSpecId: record.acceptanceSpec.acceptanceSpecId,
      specRevision: record.acceptanceSpec.specRevision,
      specDigest: record.acceptanceSpec.specDigest,
      recordDigest: record.acceptanceSpec.recordDigest,
    },
    productScopeDigest: record.acceptanceSpec.productScopeDigest,
    members: mapped,
  });
}

function currentSkeleton(repo, run) {
  const subject = repo.invoke("find_subject", { subject_id: run.subject_id }),
    head = repo.invoke("find_decision_head", { subject_id: run.subject_id });
  if (!subject || subject.status !== "active")
    return { reason: "decision_basis_unresolved", head };
  if (!head || !head.current_decision_basis_id)
    return { reason: "decision_basis_unresolved", head };
  const basis = repo.invoke("find_basis", {
    decision_basis_id: head.current_decision_basis_id,
  });
  if (!basis || basis.subject_id !== run.subject_id)
    return { integrity: "Current Decision Basis pointer is broken.", head };
  const inputs = repo.invoke("list_basis_inputs", {
    decision_basis_id: basis.decision_basis_id,
  });
  if (basis.status !== "ready")
    return { reason: "decision_basis_unresolved", head, basis, inputs };
  const spec =
    head.current_acceptance_spec_id &&
    repo.invoke("find_spec", {
      acceptance_spec_id: head.current_acceptance_spec_id,
    });
  if (!spec)
    return { reason: "acceptance_spec_unavailable", head, basis, inputs };
  if (
    spec.subject_id !== run.subject_id ||
    spec.decision_basis_id !== basis.decision_basis_id ||
    spec.product_scope_digest !== basis.product_scope_digest
  )
    return {
      integrity: "Current Acceptance Spec is inconsistent with Decision Basis.",
      head,
    };
  const bindings = repo
    .invoke("list_bindings", { subject_id: run.subject_id })
    .filter(
      (row) => number(row.current) === 1 && row.health_state === "active" &&
        row.authority_kind === "primary_control",
    );
  if (!bindings.length)
    return {
      reason: "material_binding_unavailable",
      head,
      basis,
      spec,
      inputs,
    };
  const claims = repo.invoke("list_binding_claims", {
    subject_id: run.subject_id,
  });
  return {
    subject,
    head,
    basis,
    spec,
    inputs,
    bindings,
    claims,
    keys: bindings.map((row) => row.material_key).sort(utf8),
  };
}

function currentSnapshot(snapshot, controls) {
  if (snapshot.integrity)
    fail("P9_RUN_LIFECYCLE_INTEGRITY", snapshot.integrity);
  if (snapshot.reason) return null;
  const byKey = new Map(controls.map((item) => [item.materialKey, item])),
    specValue = JSON.parse(snapshot.spec.spec_json);
  const members = snapshot.bindings
    .sort((a, b) => utf8(a.material_key, b.material_key))
    .map((row) => {
      const control = byKey.get(row.material_key);
      if (
        !control ||
        control.resultKind !== "available" ||
        control.controlState !== "controlled" ||
        control.ownerDomain !== "libra" ||
        control.ownerScopeType !== "subject" ||
        control.ownerScopeId !== snapshot.subject.subject_id
      )
        fail(
          "P9_RUN_LIFECYCLE_CONTROL",
          "Current Binding Control is not owned by Libra.",
          { materialKey: row.material_key },
        );
      const relation = snapshot.claims
        .filter(
          (item) =>
            item.material_key === row.material_key &&
            number(item.binding_revision) === number(row.binding_revision),
        )
        .sort((a, b) => utf8(a.episode_key, b.episode_key));
      const episodeClaims = relation.map((item) => ({
          episodeKey: item.episode_key,
          seasonClaimDigest: item.season_claim_digest,
          claimDigest: canonicalDigest({
            schema: "libra.production-material-episode-claim@1",
            episodeKey: item.episode_key,
            seasonClaimDigest: item.season_claim_digest,
          }),
        })),
        episodeClaimSetDigest = canonicalDigest({
          schema: "libra.production-material-episode-claims@1",
          items: episodeClaims,
        });
      const outputRequirement = buildOutputRequirement({
        acceptanceSpec: specValue,
        manifestRole: "run_input",
        materialKey: row.material_key,
        materialRole: row.role,
        episodeKeys: episodeClaims.map((item) => item.episodeKey),
      });
      return {
        materialKey: row.material_key,
        role: row.role,
        physicalIdentity: {
          schemaRef: "helix://contracts/types/PhysicalMaterialIdentity/v2",
          schemaVersion: 2,
          materialKey: row.material_key,
          mountScopeId: row.mount_scope_id,
          inode: row.inode,
          sizeBytes: number(row.size_bytes),
          fingerprintAlgorithm: row.fingerprint_algorithm,
          fingerprintVersion: number(row.fingerprint_version),
          contentFingerprint: row.content_fingerprint,
        },
        sizeBytes: number(row.size_bytes),
        bindingRevision: number(row.binding_revision),
        bindingEvidenceDigest: row.evidence_digest,
        episodeClaimSetDigest,
        controlRevision: control.controlRevision,
        controlProjectionDigest: control.projectionDigest,
        outputRequirementDigest: outputRequirement.outputRequirementDigest,
      };
    });
  return comparable({
    subjectId: snapshot.subject.subject_id,
    structureKind: snapshot.subject.structure_kind,
    contentProfile: snapshot.subject.content_profile,
    acceptanceSpecRef: {
      acceptanceSpecId: snapshot.spec.acceptance_spec_id,
      specRevision: number(snapshot.spec.spec_revision),
      specDigest: snapshot.spec.spec_digest,
      recordDigest: snapshot.spec.record_digest,
    },
    productScopeDigest: snapshot.spec.product_scope_digest,
    members,
  });
}

function decisionHeadSnapshot(subjectId, row) {
  if (!row) {
    const absent = {
      subjectId,
      headState: "absent",
      headRevision: 0,
      currentRoutingDecisionId: null,
      currentDecisionBasisId: null,
      currentAcceptanceSpecId: null,
    };
    absent.snapshotDigest = canonicalDigest({
      schema: "libra.subject-decision-head-snapshot@1",
      ...absent,
    });
    return absent;
  }
  const headDigest = canonicalDigest({
    schema: "libra.subject-decision-head@1",
    subjectId: row.subject_id,
    headRevision: number(row.head_revision),
    currentRoutingDecisionId: row.current_routing_decision_id,
    currentDecisionBasisId: row.current_decision_basis_id,
    currentAcceptanceSpecId: row.current_acceptance_spec_id,
  });
  if (headDigest !== row.head_digest)
    fail(
      "P9_RUN_LIFECYCLE_INTEGRITY",
      "Current Decision Head digest is invalid.",
    );
  const snapshot = {
    subjectId: row.subject_id,
    headState: "present",
    headRevision: number(row.head_revision),
    headDigest: row.head_digest,
    currentRoutingDecisionId: row.current_routing_decision_id,
    currentDecisionBasisId: row.current_decision_basis_id,
    currentAcceptanceSpecId: row.current_acceptance_spec_id,
  };
  snapshot.snapshotDigest = canonicalDigest({
    schema: "libra.subject-decision-head-snapshot@1",
    ...snapshot,
  });
  return snapshot;
}

function normalizeControlReadiness(skeleton, controls) {
  if (!skeleton || skeleton.reason || skeleton.integrity) return skeleton;
  const byKey = new Map(controls.map((item) => [item.materialKey, item]));
  const unavailable = skeleton.bindings.some((row) => {
    const control = byKey.get(row.material_key);
    return !control || control.resultKind !== "available" ||
      control.controlState !== "controlled" || control.ownerDomain !== "libra" ||
      control.ownerScopeType !== "subject" ||
      control.ownerScopeId !== skeleton.subject.subject_id;
  });
  return unavailable
    ? { ...skeleton, reason: "material_control_unavailable" }
    : skeleton;
}

function recoveryPolicy() {
  const value = {
    policyRef: "libra.run-recovery.beta@1",
    policyRevision: 1,
    assessmentOffsetsMs: RECOVERY_OFFSETS,
    maxRecoveryAssessments: 5,
    heavyPermitAllowed: false,
    frozenAutoResumeAllowed: false,
  };
  value.policyDigest = canonicalDigest(value);
  return value;
}

function dimensionProjection(value, dimension) {
  if (!value) return null;
  if (dimension === "acceptance_spec") return {
    specDigest: value.acceptanceSpecRef.specDigest,
  };
  if (dimension === "product_scope") return value.productScopeDigest;
  if (dimension === "material_binding") return value.members.map((item) => ({
    materialKey: item.materialKey,
    role: item.role,
    physicalIdentity: item.physicalIdentity,
    sizeBytes: item.sizeBytes,
    bindingRevision: item.bindingRevision,
    bindingEvidenceDigest: item.bindingEvidenceDigest,
    episodeClaimSetDigest: item.episodeClaimSetDigest,
  }));
  if (dimension === "material_control") return value.members.map((item) => ({
    materialKey: item.materialKey,
    controlRevision: item.controlRevision,
    controlProjectionDigest: item.controlProjectionDigest,
  }));
  return value.members.map((item) => ({
    materialKey: item.materialKey,
    outputRequirementSemanticDigest: canonicalDigest({
      schema: "libra.output-requirement-semantic@1",
      acceptanceSpecDigest: value.acceptanceSpecRef.specDigest,
      productScopeDigest: value.productScopeDigest,
      materialKey: item.materialKey,
      materialRole: item.role,
      episodeClaimSetDigest: item.episodeClaimSetDigest,
    }),
  }));
}

function buildFreshnessAssessment(run, original, skeletonValue, controls, assessedAtMs) {
  const skeleton = normalizeControlReadiness(skeletonValue, controls);
  if (skeleton.integrity)
    fail("P9_RUN_LIFECYCLE_INTEGRITY", skeleton.integrity);
  const policy = recoveryPolicy();
  if (run.state === "suspended" &&
      (run.recovery_policy_ref !== policy.policyRef ||
       run.recovery_policy_digest !== policy.policyDigest)) {
    fail("P9_RUN_RECOVERY_POLICY", "Persisted recovery policy is invalid.");
  }
  const attemptOrdinal = run.state === "suspended"
    ? number(run.recovery_attempt_ordinal || 0) + 1
    : 0;
  const dueAtMs = run.state === "suspended"
    ? number(run.suspension_started_at_ms) + RECOVERY_OFFSETS[attemptOrdinal - 1]
    : null;
  if (run.state === "suspended" && assessedAtMs < dueAtMs) {
    return Object.freeze({
      kind: "not_due",
      libraRunId: run.libra_run_id,
      dueAtMs,
      attemptOrdinal,
    });
  }
  const current = skeleton.reason ? null : currentSnapshot(skeleton, controls);
  const readiness = current ? "ready" : "unresolved";
  const comparison = !current
    ? "unresolved"
    : original.comparableBasisDigest === current.comparableBasisDigest
      ? "same" : "changed";
  const dimensions = [
    "acceptance_spec",
    "product_scope",
    "material_binding",
    "material_control",
    "output_requirement",
  ];
  const dimensionResults = dimensions.map((dimension) => {
    const before = dimensionProjection(original, dimension);
    const after = dimensionProjection(current, dimension);
    const result = !current ? "unresolved"
      : canonicalJson(before) === canonicalJson(after) ? "same" : "changed";
    return {
      dimension,
      result,
      evidenceDigest: canonicalDigest({
        schema: "libra.run-freshness-dimension-evidence@1",
        dimension,
        result,
        original: before,
        current: after,
        unresolvedReason: skeleton.reason || null,
      }),
    };
  });
  const currentDecisionHead = decisionHeadSnapshot(run.subject_id, skeleton.head);
  const assessment = {
    libraRunId: run.libra_run_id,
    expectedState: {
      state: run.state,
      stateRevision: number(run.state_revision),
      stateDigest: run.state_digest,
    },
    assessmentKind: run.state === "active"
      ? "active_checkpoint" : "suspension_recovery",
    recoveryPolicy: policy,
    recoveryEpisode: run.state === "active"
      ? { attemptOrdinal: 0 }
      : {
          startedAtMs: number(run.suspension_started_at_ms),
          attemptOrdinal,
          dueAtMs,
        },
    assessedAtMs,
    currentDecisionHead,
    originalBasis: original,
    readiness,
    unresolvedReasonCodes: current ? [] : [skeleton.reason],
    dimensionResults,
    comparison,
  };
  if (current) assessment.currentBasis = current;
  assessment.assessmentId = canonicalDigest({
    schema: "libra.run-freshness-assessment-id@1",
    libraRunId: run.libra_run_id,
    expectedStateRevision: number(run.state_revision),
    assessmentKind: assessment.assessmentKind,
    attemptOrdinal,
    currentDecisionHeadDigest: currentDecisionHead.snapshotDigest,
  });
  assessment.assessmentDigest = canonicalDigest(assessment);
  return Object.freeze({ kind: "assessment", assessment: Object.freeze(assessment) });
}

function assertAssessment(decision, original, current, skeleton) {
  const evidence = decision.transitionEvidence;
  if (!evidence.assessmentId) return;
  if (canonicalJson(evidence.originalBasis) !== canonicalJson(original))
    fail(
      "P9_RUN_LIFECYCLE_ASSESSMENT",
      "Original Comparable Basis differs from Owner rows.",
    );
  const head = evidence.currentDecisionHead,
    snapshot = decisionHeadSnapshot(original.subjectId, skeleton.head);
  if (canonicalJson(head) !== canonicalJson(snapshot))
    fail(
      "P9_RUN_LIFECYCLE_ASSESSMENT",
      "Current Decision Head differs from Owner row.",
    );
  if (skeleton.reason) {
    if (
      evidence.readiness !== "unresolved" ||
      !evidence.unresolvedReasonCodes.includes(skeleton.reason) ||
      evidence.currentBasis !== undefined
    )
      fail(
        "P9_RUN_LIFECYCLE_ASSESSMENT",
        "Typed unresolved assessment does not match Owner rows.",
      );
  } else if (
    evidence.readiness !== "ready" ||
    canonicalJson(evidence.currentBasis) !== canonicalJson(current)
  )
    fail(
      "P9_RUN_LIFECYCLE_ASSESSMENT",
      "Current Comparable Basis differs from Owner rows.",
    );
}

function assertPackageFence(repo, run, decision, controls) {
  const packages = repo
    .invoke("list_packages", { libra_run_id: run.libra_run_id })
    .filter((row) => row.state === "published");
  if (!packages.length) return null;
  if (packages.length !== 1)
    fail(
      "P9_RUN_LIFECYCLE_PACKAGE",
      "Run has more than one published Package.",
    );
  const pkg = packages[0];
  if (
    pkg.offer_id !==
    canonicalDigest({
      schema: "libra.product-offer-id@1",
      onDeckPackageId: pkg.on_deck_package_id,
      packageDigest: pkg.package_digest,
    })
  )
    fail(
      "P9_RUN_LIFECYCLE_PACKAGE",
      "Published Package Offer identity is invalid.",
    );
  if (decision.transitionKind === "complete") return pkg;
  const materials = repo.invoke("list_package_materials", {
      on_deck_package_id: pkg.on_deck_package_id,
    }),
    offload = repo.invoke("list_offload", {
      on_deck_package_id: pkg.on_deck_package_id,
    });
  repo.invoke("list_package_claims", {
    on_deck_package_id: pkg.on_deck_package_id,
  });
  const keys = [
      ...new Set([
        ...materials.map((row) => row.material_key),
        ...offload.map((row) => row.material_key),
      ]),
    ].sort(utf8),
    byKey = new Map(controls.map((item) => [item.materialKey, item]));
  for (const key of keys) {
    const control = byKey.get(key);
    if (
      !control ||
      control.resultKind !== "available" ||
      control.controlState !== "controlled" ||
      control.ownerDomain !== "libra"
    )
      fail(
        "P9_RUN_LIFECYCLE_PACKAGE_CONTROL",
        "Published Package Control is no longer owned by Libra.",
        { materialKey: key },
      );
  }
  return pkg;
}

function acceptedMessage(value, run, pkg) {
  if (
    !pkg ||
    value.messageKind !== "arca.product.accepted@1" ||
    value.libraRunId !== run.libra_run_id ||
    value.offerId !== pkg.offer_id ||
    value.onDeckPackageId !== pkg.on_deck_package_id ||
    value.packageDigest !== pkg.package_digest
  )
    fail(
      "P9_RUN_LIFECYCLE_ACCEPTED",
      "Arca accepted message does not match the published Package.",
    );
  const receipt = value.handoffReceipt;
  if (
    !receipt ||
    !receipt.receiptId ||
    !receipt.custodyId ||
    !receipt.arcaBindingSetDigest ||
    !receipt.controlRevisionSetDigest ||
    !receipt.receiptDigest
  )
    fail(
      "P9_RUN_LIFECYCLE_ACCEPTED",
      "Arca accepted message lacks its complete Handoff Receipt.",
    );
  const id = canonicalDigest({
    schema: "arca.product-accepted-message-id@1",
    offerId: value.offerId,
    acceptanceDecisionId: value.acceptanceDecisionId,
    receiptDigest: receipt.receiptDigest,
  });
  if (value.messageId !== id || value.dedupKey !== id)
    fail(
      "P9_RUN_LIFECYCLE_ACCEPTED",
      "Arca accepted message identity is invalid.",
    );
  return receipt;
}

function assertTerminalEvidence(repo, decision, run, resolveRetryPolicyDigest) {
  const evidence = decision.transitionEvidence;
  if (!evidence.blockedWorks) return;
  if (typeof resolveRetryPolicyDigest !== "function")
    fail(
      "P9_RUN_LIFECYCLE_TERMINAL_POLICY",
      "Terminal Evidence validation requires the immutable Retry Policy resolver.",
    );
  for (const member of evidence.blockedWorks) {
    const work = repo.invoke("find_work", { work_id: member.workId }),
      plan = repo.invoke("find_plan", { plan_id: member.planId }),
      event = repo.invoke("find_event", { event_id: member.terminalEventId }),
      attempts = repo
        .invoke("list_attempts", { event_id: member.terminalEventId })
        .sort((a, b) => number(a.ordinal) - number(b.ordinal)),
      attempt = attempts.at(-1),
      businessUnachievable = member.failureClass === "business_unachievable",
      boundResult = businessUnachievable
        ? repo.invoke("find_event_result", { event_id: member.terminalEventId })
        : null,
      attemptsClosed =
        attempts.length === member.attemptCount &&
        attempts.every(
          (item, index) =>
            number(item.ordinal) === index + 1 && item.state === "completed",
        );
    let businessResultValid = !businessUnachievable;
    if (businessUnachievable && boundResult) {
      try {
        const payload = JSON.parse(boundResult.result_json), reasons = [
          payload.selectionReasonCode,
          payload.reasonCode,
          ...(Array.isArray(payload.reasonCodes) ? payload.reasonCodes : []),
        ].filter(Boolean);
        businessResultValid = boundResult.outcome_kind === "succeeded" &&
          canonicalDigest(payload) === boundResult.result_digest &&
          boundResult.result_digest === member.terminalEvidenceDigest &&
          reasons.includes(member.failureCode);
      } catch {
        businessResultValid = false;
      }
    }
    if (
      !work ||
      work.owner_domain !== "libra" ||
      work.process_id !== run.libra_run_id ||
      work.basis_digest !== member.workBasisDigest ||
      work.state !== (businessUnachievable ? "succeeded" : "failed") ||
      !plan ||
      plan.plan_id !== member.planId ||
      plan.basis_digest !== member.workBasisDigest ||
      plan.state !== "planned" ||
      !event ||
      event.plan_id !== member.planId ||
      event.work_id !== member.workId ||
      event.owner_domain !== "libra" ||
      event.capability_ref !== member.capabilityRef ||
      event.state !== (businessUnachievable ? "succeeded" : "failed") ||
      !attempt ||
      !attemptsClosed ||
      attempt.outcome_kind !== (businessUnachievable ? "succeeded" : "failed") ||
      (!businessUnachievable && (attempt.failure_class !== member.failureClass ||
        attempt.failure_code !== member.failureCode ||
        attempt.evidence_digest !== member.terminalEvidenceDigest)) ||
      !businessResultValid ||
      resolveRetryPolicyDigest(member.capabilityRef) !==
        member.retryPolicyDigest
    )
      fail(
        "P9_RUN_LIFECYCLE_TERMINAL",
        "Terminal Delivery Evidence differs from Work/Plan/Event/Attempt/Retry Policy Owner rows.",
        { workId: member.workId },
      );
    const digest = canonicalDigest({
      schema: "libra.run-terminal-blocker-member@1",
      workId: member.workId,
      planId: member.planId,
      workBasisDigest: member.workBasisDigest,
      terminalEventId: member.terminalEventId,
      capabilityRef: member.capabilityRef,
      failureClass: member.failureClass,
      failureCode: member.failureCode,
      attemptCount: member.attemptCount,
      retryPolicyDigest: member.retryPolicyDigest,
      terminalEvidenceDigest: member.terminalEvidenceDigest,
    });
    if (digest !== member.memberDigest)
      fail(
        "P9_RUN_LIFECYCLE_TERMINAL",
        "Terminal Delivery member digest is invalid.",
        { workId: member.workId },
      );
  }
}

function createRunLifecycleStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork)
    fail(
      "P9_RUN_LIFECYCLE_DEPENDENCIES",
      "Schema manifest and Unit of Work are required.",
    );
  const libra = libraDefinition(options.schemaManifest),
    foundation = foundationDefinition(options.schemaManifest),
    history = controlHistoryDefinition(options.schemaManifest);
  return Object.freeze({
    repositoryManifest: Object.freeze({
      libraTableIds: libra.tableIds,
      foundationTableIds: foundation.tableIds,
      controlHistoryTableIds: history.tableIds,
    }),
    assess(request) {
      const libraRunId = request?.libraRunId,
        assessedAtMs = request?.assessedAtMs;
      if (typeof libraRunId !== "string" || !libraRunId ||
          !Number.isSafeInteger(assessedAtMs) || assessedAtMs < 0)
        fail(
          "P9_RUN_LIFECYCLE_ASSESSMENT_INPUT",
          "Run identity and non-negative assessment time are required.",
        );
      let run, admissionHead, original, skeleton, controls = [], controlKeys = [];
      const read = {
        participantId: "run_freshness_read",
        owner: "libra",
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId);
          run = repo.invoke("find_run", { libra_run_id: libraRunId });
          if (!run) return;
          if (!["active", "suspended"].includes(run.state))
            fail(
              "P9_RUN_LIFECYCLE_ILLEGAL_STATE",
              "Freshness may only assess an active or suspended Run.",
            );
          original = originalSnapshot(repo, run);
          skeleton = currentSkeleton(repo, run);
          admissionHead = repo.invoke("find_head", { subject_id: run.subject_id });
          if (!admissionHead)
            fail(
              "P9_RUN_LIFECYCLE_HEAD",
              "Run admission head is absent during Freshness assessment.",
            );
          controlKeys = [...new Set(skeleton?.keys || [])].sort(utf8);
        },
      };
      const authority = {
        participantId: "run_freshness_control_read",
        owner: "material-control-authority",
        boundBusinessOwner: "libra",
        repositories: [history],
        execute(context) {
          if (!run) return;
          const repo = context.repository(history.repositoryId);
          controls = controlKeys.map((key) => currentControl(
            key,
            repo.invoke("find_current", { material_key: key }),
          ));
          assertHistoricalControls(repo, original, run);
        },
      };
      options.unitOfWork.execute([read, authority]);
      if (!run) return Object.freeze({ kind: "not_found", libraRunId });
      const built = buildFreshnessAssessment(
        run,
        original,
        skeleton,
        controls,
        assessedAtMs,
      );
      if (built.kind === "not_due") return built;
      return Object.freeze({
        ...built,
        admissionHead: Object.freeze({
          headRevision: number(admissionHead.head_revision),
          activeScopeSetDigest: admissionHead.active_scope_set_digest,
        }),
        latestFreshnessAssessmentId: run.latest_freshness_assessment_id,
      });
    },
    buildTerminalEvidence(request) {
      const libraRunId = request?.libraRunId,
        workId = request?.workId,
        blockerKind = request?.blockerKind,
        assessedAtMs = request?.assessedAtMs,
        terminalResult = request?.terminalResult || null;
      if (typeof libraRunId !== "string" || !libraRunId ||
          typeof workId !== "string" || !workId ||
          !["capability_exhausted", "integration_exhausted",
            "product_unachievable"].includes(blockerKind) ||
          !Number.isSafeInteger(assessedAtMs) || assessedAtMs < 0)
        fail(
          "P9_RUN_TERMINAL_EVIDENCE_INPUT",
          "Terminal Evidence requires exact Run, Work, blocker, and time.",
        );
      if (terminalResult &&
          (typeof terminalResult.eventId !== "string" || !terminalResult.eventId ||
           typeof terminalResult.failureCode !== "string" || !terminalResult.failureCode ||
           terminalResult.failureClass !== "business_unachievable" ||
           typeof terminalResult.resultDigest !== "string" || !/^[a-f0-9]{64}$/.test(terminalResult.resultDigest)))
        fail(
          "P9_RUN_TERMINAL_EVIDENCE_INPUT",
          "Business terminal Evidence requires an exact terminal Result binding.",
        );
      if (typeof options.resolveRetryPolicyDigest !== "function")
        fail(
          "P9_RUN_LIFECYCLE_TERMINAL_POLICY",
          "Terminal Evidence requires the immutable Retry Policy resolver.",
        );
      let run, admissionHead, blockedWorks;
      const owner = {
        participantId: "run_terminal_owner_read",
        owner: "libra",
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId);
          run = repo.invoke("find_run", { libra_run_id: libraRunId });
          if (!run) return;
          if (run.state !== "active")
            fail(
              "P9_RUN_LIFECYCLE_ILLEGAL_STATE",
              "Terminal Evidence may only freeze an active Run.",
            );
          admissionHead = repo.invoke("find_head", { subject_id: run.subject_id });
          if (!admissionHead)
            fail("P9_RUN_LIFECYCLE_HEAD", "Run admission head is absent.");
        },
      };
      const execution = {
        participantId: "run_terminal_execution_read",
        owner: "execution-foundation",
        boundBusinessOwner: "libra",
        repositories: [foundation],
        execute(context) {
          if (!run) return;
          const repo = context.repository(foundation.repositoryId),
            work = repo.invoke("find_work", { work_id: workId });
          const expectedWorkState = terminalResult ? "succeeded" : "failed";
          if (!work || work.owner_domain !== "libra" ||
              work.process_type !== "libra_run" ||
              work.process_id !== libraRunId || work.state !== expectedWorkState)
            fail(
              "P9_RUN_LIFECYCLE_TERMINAL",
              "Terminal blocker Work is not in the required terminal state for the Run.",
            );
          const plans = new Map(repo.invoke("list_plans", {})
            .map((item) => [item.plan_id, item]));
          const events = terminalResult
            ? [repo.invoke("find_event", { event_id: terminalResult.eventId })].filter((item) =>
              item && item.work_id === workId && item.owner_domain === "libra" && item.state === "succeeded")
            : repo.invoke("list_events", {}).filter((item) =>
              item.work_id === workId && item.owner_domain === "libra" && item.state === "failed");
          if (!events.length)
            fail(
              "P9_RUN_LIFECYCLE_TERMINAL",
              "Terminal Work has no matching terminal Event.",
            );
          blockedWorks = events.map((event) => {
            const plan = plans.get(event.plan_id),
              attempts = repo.invoke("list_attempts", { event_id: event.event_id })
                .sort((a, b) => number(a.ordinal) - number(b.ordinal)),
              attempt = attempts.at(-1),
              boundResult = terminalResult
                ? repo.invoke("find_event_result", { event_id: event.event_id })
                : null;
            let boundResultDigestValid = !terminalResult;
            if (terminalResult && boundResult) {
              try {
                boundResultDigestValid = canonicalDigest(JSON.parse(boundResult.result_json)) ===
                  boundResult.result_digest;
              } catch {
                boundResultDigestValid = false;
              }
            }
            if (!plan || plan.state !== "planned" ||
                plan.basis_digest !== work.basis_digest || !attempt ||
                attempts.some((item, ordinal) =>
                  number(item.ordinal) !== ordinal + 1 || item.state !== "completed") ||
                (!terminalResult && (attempt.outcome_kind !== "failed" ||
                  !attempt.failure_class || !attempt.failure_code || !attempt.evidence_digest)) ||
                (terminalResult && (attempt.outcome_kind !== "succeeded" || !boundResult ||
                  boundResult.outcome_kind !== "succeeded" ||
                  boundResult.result_digest !== terminalResult.resultDigest || !boundResultDigestValid)))
              fail(
                "P9_RUN_LIFECYCLE_TERMINAL",
                "Terminal Work execution history is incomplete.",
                { eventId: event.event_id },
              );
            const member = {
              workId,
              planId: event.plan_id,
              workBasisDigest: work.basis_digest,
              terminalEventId: event.event_id,
              capabilityRef: event.capability_ref,
              failureClass: terminalResult ? terminalResult.failureClass : attempt.failure_class,
              failureCode: terminalResult ? terminalResult.failureCode : attempt.failure_code,
              attemptCount: attempts.length,
              retryPolicyDigest: options.resolveRetryPolicyDigest(
                event.capability_ref,
              ),
              terminalEvidenceDigest: terminalResult ? boundResult.result_digest : attempt.evidence_digest,
            };
            member.memberDigest = canonicalDigest({
              schema: "libra.run-terminal-blocker-member@1",
              ...member,
            });
            return member;
          }).sort((a, b) => utf8(a.workId, b.workId) ||
            utf8(a.terminalEventId, b.terminalEventId));
        },
      };
      options.unitOfWork.execute([owner, execution]);
      if (!run) return Object.freeze({ kind: "not_found", libraRunId });
      const evidence = {
        libraRunId,
        executionBasisDigest: run.execution_basis_digest,
        blockerKind,
        blockedWorks,
        assessedAtMs,
      };
      evidence.blockerSetDigest = canonicalDigest({
        schema: "libra.run-terminal-blocker-set@1",
        libraRunId,
        executionBasisDigest: evidence.executionBasisDigest,
        blockerKind,
        items: blockedWorks,
      });
      evidence.evidenceId = canonicalDigest({
        schema: "libra.run-terminal-delivery-evidence-id@1",
        libraRunId,
        executionBasisDigest: evidence.executionBasisDigest,
        blockerKind,
        blockerSetDigest: evidence.blockerSetDigest,
        assessedAtMs,
      });
      evidence.evidenceDigest = canonicalDigest(evidence);
      return Object.freeze({
        kind: "terminal_evidence",
        evidence: Object.freeze(evidence),
        run: Object.freeze({
          stateRevision: number(run.state_revision),
          stateDigest: run.state_digest,
        }),
        admissionHead: Object.freeze({
          headRevision: number(admissionHead.head_revision),
          activeScopeSetDigest: admissionHead.active_scope_set_digest,
        }),
      });
    },
    transition(request) {
      const decision = buildRunLifecycleDecision(request?.decision),
        marker = request?.commitMarker,
        resultId = request?.resultId;
      if (
        typeof marker !== "string" ||
        !marker ||
        typeof resultId !== "string" ||
        !resultId
      )
        fail(
          "P9_RUN_LIFECYCLE_INPUT",
          "Commit marker and Result identity are required.",
        );
      let result,
        replayed = false,
        receiptId = null,
        run,
        skeleton,
        original,
        controls = [],
        controlKeys = [];
      const preflight = {
        participantId: "run_lifecycle_preflight",
        owner: "execution-foundation",
        boundBusinessOwner: "libra",
        repositories: [foundation],
        execute(context) {
          const repo = context.repository(foundation.repositoryId),
            found = repo.invoke("find_marker", { commit_marker: marker });
          if (!found) return;
          if (
            found.owner_domain !== "libra" ||
            found.scope_type !== "libra_run" ||
            found.scope_id !== decision.libraRunId ||
            found.commit_digest !== decision.decisionDigest ||
            found.result_schema_ref !== RESULT_SCHEMA
          )
            fail(
              "P9_RUN_LIFECYCLE_MARKER",
              "Lifecycle marker conflicts with another commit.",
            );
          const stored = repo.invoke("find_result", {
            result_id: found.result_id,
          });
          if (!stored || stored.result_digest !== found.result_digest)
            fail("P9_RUN_LIFECYCLE_REPLAY", "Lifecycle Result is absent.");
          const value = JSON.parse(stored.result_json);
          if (canonicalDigest(value) !== stored.result_digest)
            fail("P9_RUN_LIFECYCLE_REPLAY", "Lifecycle Result is corrupt.");
          result = value;
          throw new Replay(value);
        },
      };
      const read = {
        participantId: "run_lifecycle_read",
        owner: "libra",
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId);
          run = repo.invoke("find_run", { libra_run_id: decision.libraRunId });
          if (!run) fail("P9_RUN_LIFECYCLE_RUN", "Run is absent.");
          const freshness = Boolean(decision.transitionEvidence.assessmentId);
          if (freshness) {
            original = originalSnapshot(repo, run);
            skeleton = currentSkeleton(repo, run);
          }
          const packageKeys =
            decision.transitionKind === "complete"
              ? []
              : repo
                  .invoke("list_packages", { libra_run_id: run.libra_run_id })
                  .flatMap((pkg) => [
                    ...repo
                      .invoke("list_package_materials", {
                        on_deck_package_id: pkg.on_deck_package_id,
                      })
                      .map((row) => row.material_key),
                    ...repo
                      .invoke("list_offload", {
                        on_deck_package_id: pkg.on_deck_package_id,
                      })
                      .map((row) => row.material_key),
                  ]);
          controlKeys = [
            ...new Set([...(skeleton?.keys || []), ...packageKeys]),
          ].sort(utf8);
        },
      };
      const authority = {
        participantId: "run_lifecycle_control_read",
        owner: "material-control-authority",
        boundBusinessOwner: "libra",
        repositories: [history],
        execute(context) {
          const repo = context.repository(history.repositoryId);
          controls = controlKeys.map((key) =>
            currentControl(
              key,
              repo.invoke("find_current", { material_key: key }),
            ),
          );
          if (original) assertHistoricalControls(repo, original, run);
        },
      };
      const apply = {
        participantId: "run_lifecycle_apply",
        owner: "libra",
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId),
            fresh = repo.invoke("find_run", {
              libra_run_id: decision.libraRunId,
            });
          if (
            !fresh ||
            fresh.state_revision !== run.state_revision ||
            fresh.state_digest !== run.state_digest
          )
            fail(
              "P9_RUN_LIFECYCLE_CAS",
              "Run changed during lifecycle transaction.",
            );
          const head = repo.invoke("find_head", { subject_id: run.subject_id });
          if (
            !head ||
            number(head.head_revision) !==
              decision.expectedAdmissionHeadRevision ||
            head.active_scope_set_digest !==
              decision.expectedActiveScopeSetDigest
          )
            fail("P9_RUN_LIFECYCLE_HEAD", "Run admission head CAS is stale.");
          if (skeleton) {
            skeleton = normalizeControlReadiness(skeleton, controls);
            const current = currentSnapshot(skeleton, controls);
            assertAssessment(decision, original, current, skeleton);
          }
          const pkg = assertPackageFence(repo, run, decision, controls),
            currentState = {
              libraRunId: run.libra_run_id,
              stateRevision: number(run.state_revision),
              state: run.state,
              stateDigest: run.state_digest,
              acceptanceSpecId: run.acceptance_spec_id,
              executionBasisDigest: run.execution_basis_digest,
              runScopeDigest: run.run_scope_digest,
              priorityClass: run.priority_class,
              priorityIntentDigest: run.priority_intent_digest,
              recoveryPolicyRef: run.recovery_policy_ref,
              recoveryPolicyDigest: run.recovery_policy_digest,
              suspensionStartedAtMs:
                run.suspension_started_at_ms === null
                  ? null
                  : number(run.suspension_started_at_ms),
              recoveryAttemptOrdinal: number(run.recovery_attempt_ordinal || 0),
              recoveryNextDueAtMs:
                run.recovery_next_due_at_ms === null
                  ? null
                  : number(run.recovery_next_due_at_ms),
            },
            next = applyRunLifecycleDecision(currentState, decision),
            meta = evidenceMeta(decision.transitionEvidence);
          if (decision.transitionKind === "complete") {
            const receipt = acceptedMessage(
                decision.transitionEvidence,
                run,
                pkg,
              ),
              existing = repo.invoke("find_receipt", {
                offer_id: pkg.offer_id,
              });
            if (existing)
              fail(
                "P9_RUN_LIFECYCLE_RECEIPT",
                "Offer already has a Delivery Receipt.",
              );
            receiptId = canonicalDigest({
              schema: "libra.product-delivery-receipt-id@1",
              offerId: pkg.offer_id,
            });
            repo.invoke("insert_receipt", {
              receipt_id: receiptId,
              offer_id: pkg.offer_id,
              on_deck_package_id: pkg.on_deck_package_id,
              package_digest: pkg.package_digest,
              arca_acceptance_decision_id:
                decision.transitionEvidence.acceptanceDecisionId,
              arca_acceptance_decision_digest:
                decision.transitionEvidence.acceptanceDecisionDigest,
              result: "accepted",
              handoff_receipt_id: receipt.receiptId,
              handoff_receipt_digest: receipt.receiptDigest,
              custody_id: receipt.custodyId,
              arca_binding_set_digest: receipt.arcaBindingSetDigest,
              control_revision_set_digest: receipt.controlRevisionSetDigest,
              rejection_digest: null,
              closure_digest: null,
              received_at_ms: context.commitTimeMs,
            });
          }
          const runs = repo.invoke("list_runs", { subject_id: run.subject_id }),
            items = runs
              .filter(
                (row) =>
                  ["active", "suspended", "frozen"].includes(row.state) &&
                  row.libra_run_id !== run.libra_run_id,
              )
              .map((row) => ({
                libraRunId: row.libra_run_id,
                runScopeDigest: row.run_scope_digest,
                stateRevision: number(row.state_revision),
                stateDigest: row.state_digest,
              }));
          if (next.state !== "completed")
            items.push({
              libraRunId: run.libra_run_id,
              runScopeDigest: run.run_scope_digest,
              stateRevision: next.stateRevision,
              stateDigest: next.stateDigest,
            });
          items.sort((a, b) => utf8(a.libraRunId, b.libraRunId));
          const committedHead = number(head.head_revision) + 1,
            scopeDigest = activeRunScopeSetDigest(run.subject_id, items),
            freshness = decision.transitionEvidence.assessmentId
              ? decision.transitionEvidence
              : null,
            terminalAt =
              next.state === "completed" ? context.commitTimeMs : null;
          if (
            repo.invoke("update_run", {
              state: next.state,
              state_revision: next.stateRevision,
              state_digest: next.stateDigest,
              priority_class: next.priorityClass,
              priority_intent_digest: next.priorityIntentDigest,
              recovery_policy_ref: next.recoveryPolicyRef,
              recovery_policy_digest: next.recoveryPolicyDigest,
              suspension_started_at_ms: next.suspensionStartedAtMs,
              recovery_attempt_ordinal: next.recoveryAttemptOrdinal,
              recovery_next_due_at_ms: next.recoveryNextDueAtMs,
              latest_freshness_assessment_id:
                freshness?.assessmentId || run.latest_freshness_assessment_id,
              latest_freshness_assessment_digest:
                freshness?.assessmentDigest ||
                run.latest_freshness_assessment_digest,
              terminal_at_ms: terminalAt,
              libra_run_id: run.libra_run_id,
              expected_state_revision: number(run.state_revision),
              expected_state_digest: run.state_digest,
              expected_state: run.state,
            }).changes !== 1
          )
            fail("P9_RUN_LIFECYCLE_CAS", "Run state CAS failed.");
          if (
            repo.invoke("advance_head", {
              head_revision: committedHead,
              active_scope_set_digest: scopeDigest,
              updated_at_ms: context.commitTimeMs,
              subject_id: run.subject_id,
              expected_head_revision: number(head.head_revision),
              expected_scope_digest: head.active_scope_set_digest,
            }).changes !== 1
          )
            fail("P9_RUN_LIFECYCLE_HEAD", "Run admission head CAS failed.");
          const revision = {
            libraRunId: run.libra_run_id,
            stateRevision: next.stateRevision,
            state: next.state,
            acceptanceSpecId: run.acceptance_spec_id,
            executionBasisDigest: run.execution_basis_digest,
            runScopeDigest: run.run_scope_digest,
            priorityClass: next.priorityClass,
            priorityIntentDigest: next.priorityIntentDigest,
            transitionKind: next.transitionKind,
            transitionDecisionId: decision.decisionId,
            transitionDecisionDigest: decision.decisionDigest,
            transitionEvidenceSchemaRef: meta.schemaRef,
            transitionEvidenceId: meta.evidenceId,
            transitionEvidenceDigest: meta.evidenceDigest,
            recoveryPolicyRef: next.recoveryPolicyRef,
            recoveryPolicyDigest: next.recoveryPolicyDigest,
            suspensionStartedAtMs: next.suspensionStartedAtMs,
            recoveryAttemptOrdinal: next.recoveryAttemptOrdinal,
            recoveryNextDueAtMs: next.recoveryNextDueAtMs,
            expectedAdmissionHeadRevision:
              decision.expectedAdmissionHeadRevision,
            expectedActiveScopeSetDigest: decision.expectedActiveScopeSetDigest,
            committedAdmissionHeadRevision: committedHead,
            committedActiveScopeSetDigest: scopeDigest,
            previousStateRevision: number(run.state_revision),
          };
          revision.revisionDigest = canonicalDigest(revision);
          repo.invoke("insert_revision", {
            libra_run_id: revision.libraRunId,
            state_revision: revision.stateRevision,
            state: revision.state,
            acceptance_spec_id: revision.acceptanceSpecId,
            execution_basis_digest: revision.executionBasisDigest,
            run_scope_digest: revision.runScopeDigest,
            priority_class: revision.priorityClass,
            priority_intent_digest: revision.priorityIntentDigest,
            transition_kind: revision.transitionKind,
            transition_decision_id: revision.transitionDecisionId,
            transition_decision_digest: revision.transitionDecisionDigest,
            transition_evidence_schema_ref:
              revision.transitionEvidenceSchemaRef,
            transition_evidence_id: revision.transitionEvidenceId,
            transition_evidence_json: canonicalJson(
              decision.transitionEvidence,
            ),
            transition_evidence_digest: revision.transitionEvidenceDigest,
            recovery_policy_ref: revision.recoveryPolicyRef,
            recovery_policy_digest: revision.recoveryPolicyDigest,
            suspension_started_at_ms: revision.suspensionStartedAtMs,
            recovery_attempt_ordinal: revision.recoveryAttemptOrdinal,
            recovery_next_due_at_ms: revision.recoveryNextDueAtMs,
            expected_admission_head_revision:
              revision.expectedAdmissionHeadRevision,
            expected_active_scope_set_digest:
              revision.expectedActiveScopeSetDigest,
            committed_admission_head_revision:
              revision.committedAdmissionHeadRevision,
            committed_active_scope_set_digest:
              revision.committedActiveScopeSetDigest,
            previous_state_revision: revision.previousStateRevision,
            revision_digest: revision.revisionDigest,
            committed_at_ms: context.commitTimeMs,
          });
          result = buildRunLifecycleResult({
            decisionId: decision.decisionId,
            libraRunId: run.libra_run_id,
            previousStateRevision: number(run.state_revision),
            previousStateDigest: run.state_digest,
            committedState: next.state,
            committedStateRevision: next.stateRevision,
            committedStateDigest: next.stateDigest,
            committedAdmissionHeadRevision: committedHead,
            activeScopeSetDigest: scopeDigest,
            deliveryReceiptId: receiptId,
            terminalAtMs: terminalAt,
          });
        },
      };
      const finish = {
        participantId: "run_lifecycle_foundation",
        owner: "execution-foundation",
        boundBusinessOwner: "libra",
        repositories: [foundation],
        execute(context) {
          const repo = context.repository(foundation.repositoryId);
          assertTerminalEvidence(
            repo,
            decision,
            run,
            options.resolveRetryPolicyDigest,
          );
          if (decision.transitionKind === "set_priority") {
            const queueClass = decision.newPriority.priorityClass === "expedited"
              ? "expedited_formation"
              : "normal_foreground";
            const works = repo.invoke("list_works", {}).filter((work) =>
              work.owner_domain === "libra" &&
              work.process_type === "libra_run" &&
              work.process_id === decision.libraRunId &&
              !["succeeded", "failed", "cancelled"].includes(work.state));
            const workIds = new Set(works.map((work) => work.work_id));
            for (const work of works) {
              if (work.priority_class === queueClass) continue;
              if (repo.invoke("update_work_priority", {
                work_id: work.work_id,
                priority_class: queueClass,
                updated_at_ms: context.commitTimeMs,
                expected_priority_class: work.priority_class,
              }).changes !== 1) {
                fail("P9_RUN_PRIORITY_WORK_CAS",
                  "Supporting Work priority changed during Run reprioritization.");
              }
            }
            const events = repo.invoke("list_events", {}).filter((event) =>
              workIds.has(event.work_id) &&
              !["executing", "succeeded", "skipped", "failed", "cancelled"]
                .includes(event.state));
            for (const event of events) {
              if (event.priority_class === queueClass) continue;
              if (repo.invoke("update_event_priority", {
                event_id: event.event_id,
                priority_class: queueClass,
                expected_priority_class: event.priority_class,
              }).changes !== 1) {
                fail("P9_RUN_PRIORITY_EVENT_CAS",
                  "Workflow Event priority changed during Run reprioritization.");
              }
            }
          }
          if (decision.transitionKind === "complete") {
            const message = decision.transitionEvidence,
              existing = repo.invoke("find_inbox", {
                consumer_domain: "libra",
                message_id: message.messageId,
              });
            if (existing)
              fail(
                "P9_RUN_LIFECYCLE_INBOX",
                "Accepted message was already consumed outside this lifecycle commit.",
              );
            repo.invoke("insert_inbox", {
              consumer_domain: "libra",
              message_id: message.messageId,
              dedup_key: message.dedupKey,
              received_at_ms: context.commitTimeMs,
              consumed_at_ms: context.commitTimeMs,
              result_digest: result.resultDigest,
            });
          }
          repo.invoke("insert_result", {
            result_id: resultId,
            event_id: null,
            outcome_kind: "succeeded",
            result_schema_ref: RESULT_SCHEMA,
            result_json: canonicalJson(result),
            result_digest: canonicalDigest(result),
            evidence_schema_ref: DECISION_SCHEMA,
            evidence_json: canonicalJson(decision),
            evidence_digest: decision.decisionDigest,
            effect_receipt_id: receiptId,
            committed_at_ms: context.commitTimeMs,
          });
          repo.invoke("insert_marker", {
            commit_marker: marker,
            effect_id: null,
            owner_domain: "libra",
            scope_type: "libra_run",
            scope_id: decision.libraRunId,
            commit_digest: decision.decisionDigest,
            result_id: resultId,
            result_schema_ref: RESULT_SCHEMA,
            result_digest: canonicalDigest(result),
            committed_at_ms: context.commitTimeMs,
          });
        },
      };
      try {
        options.unitOfWork.execute([preflight, read, authority, apply, finish]);
      } catch (error) {
        if (error instanceof Replay)
          return Object.freeze({ result: error.result, replayed: true });
        throw error;
      }
      return Object.freeze({ result, replayed });
    },
  });
}

module.exports = Object.freeze({
  ACCEPTED_SCHEMA,
  DECISION_SCHEMA,
  RESULT_SCHEMA,
  RunLifecycleStoreError,
  comparable,
  createRunLifecycleStore,
});
