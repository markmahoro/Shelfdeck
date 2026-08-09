"use strict";

const {
  canonicalDigest,
  canonicalJson,
} = require("../../../contracts/canonical-json");
const {
  createRepositoryDefinition,
} = require("../../../foundation/persistence/owner-repository");
const {
  createMaterialControlAdmissionReadParticipant,
} = require("../../../foundation/persistence/material-control");
const {
  activeRunScopeSetDigest,
  buildRunAdmissionDecision,
  buildRunExecutionBasisRecord,
} = require("../model/run-admission-contracts");

const RESULT_SCHEMA = "helix://contracts/types/LibraRunAdmissionResult/v1";
const BASIS_SCHEMA = "helix://contracts/types/LibraRunExecutionBasisRecord/v1";
const DECISION_SCHEMA = "helix://contracts/types/LibraRunAdmissionDecision/v1";
class RunAdmissionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RunAdmissionStoreError";
    this.code = code;
    this.details = details;
  }
}
class Replay extends Error {
  constructor(result) {
    super("Run admission replay");
    this.result = result;
  }
}
function fail(code, message, details) {
  throw new RunAdmissionStoreError(code, message, details);
}
const number = (value) => Number(value);
const utf8 = (a, b) => Buffer.from(a).compare(Buffer.from(b));

function stateDigest(value) {
  return canonicalDigest({
    schema: "libra.run-state@1",
    libraRunId: value.libraRunId,
    stateRevision: value.stateRevision,
    state: value.state,
    acceptanceSpecId: value.acceptanceSpecId,
    executionBasisDigest: value.executionBasisDigest,
    runScopeDigest: value.runScopeDigest,
    priorityClass: value.priorityClass,
    priorityIntentDigest: value.priorityIntentDigest,
    transitionKind: value.transitionKind,
    transitionEvidenceDigest: value.transitionEvidenceDigest,
  });
}
function revisionValue(value) {
  return {
    libraRunId: value.libraRunId,
    stateRevision: value.stateRevision,
    state: value.state,
    acceptanceSpecId: value.acceptanceSpecId,
    executionBasisDigest: value.executionBasisDigest,
    runScopeDigest: value.runScopeDigest,
    priorityClass: value.priorityClass,
    priorityIntentDigest: value.priorityIntentDigest,
    transitionKind: value.transitionKind,
    transitionDecisionId: value.transitionDecisionId,
    transitionDecisionDigest: value.transitionDecisionDigest,
    transitionEvidenceSchemaRef: value.transitionEvidenceSchemaRef,
    transitionEvidenceId: value.transitionEvidenceId,
    transitionEvidenceDigest: value.transitionEvidenceDigest,
    expectedAdmissionHeadRevision: value.expectedAdmissionHeadRevision,
    expectedActiveScopeSetDigest: value.expectedActiveScopeSetDigest,
    committedAdmissionHeadRevision: value.committedAdmissionHeadRevision,
    committedActiveScopeSetDigest: value.committedActiveScopeSetDigest,
    previousStateRevision: value.previousStateRevision,
  };
}

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "libra_run_admission",
    owner: "libra",
    schemaManifest,
    statements: {
      find_subject: {
        kind: "select-one",
        tableId: "libra_subjects",
        columns: [
          "subject_id",
          "structure_kind",
          "content_profile",
          "status",
          "intake_revision",
          "current_continuity_set_digest",
          "current_episode_scope_digest",
        ],
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
      find_spec: {
        kind: "select-one",
        tableId: "libra_acceptance_specs",
        columns: [
          "acceptance_spec_id",
          "subject_id",
          "shelf_id",
          "shelf_routing_projection_revision",
          "shelf_projection_digest",
          "shelf_standard_revision",
          "shelf_standard_digest",
          "spec_revision",
          "spec_json",
          "spec_digest",
          "record_digest",
          "product_scope_digest",
        ],
        keyColumns: ["acceptance_spec_id"],
      },
      list_bindings: {
        kind: "select-all",
        tableId: "libra_material_bindings",
        columns: [
          "subject_id",
          "material_key",
          "role",
          "mount_scope_id",
          "inode",
          "fingerprint_algorithm",
          "fingerprint_version",
          "content_fingerprint",
          "size_bytes",
          "endpoint_id",
          "location",
          "binding_revision",
          "health_state",
          "evidence_digest",
          "origin_intake_decision_id",
          "origin_offer_id",
          "origin_candidate_package_id",
          "origin_package_revision",
          "origin_package_digest",
          "origin_candidate_delivery_snapshot_digest",
          "origin_related_reference_set_digest",
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
      find_head: {
        kind: "select-one",
        tableId: "libra_run_admission_heads",
        columns: ["subject_id", "head_revision", "active_scope_set_digest"],
        keyColumns: ["subject_id"],
      },
      insert_head: {
        kind: "insert",
        tableId: "libra_run_admission_heads",
        columns: [
          "subject_id",
          "head_revision",
          "active_scope_set_digest",
          "updated_at_ms",
        ],
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
      list_runs: {
        kind: "select-all",
        tableId: "libra_runs",
        columns: [
          "libra_run_id",
          "subject_id",
          "admission_revision",
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
          "superseded_by_run_id",
        ],
        keyColumns: ["subject_id"],
      },
      find_manifest: {
        kind: "select-one",
        tableId: "libra_run_material_manifests",
        columns: [
          "run_material_manifest_id",
          "libra_run_id",
          "scope_kind",
          "episode_scope_digest",
          "manifest_digest",
        ],
        keyColumns: ["run_material_manifest_id"],
      },
      list_members: {
        kind: "select-all",
        tableId: "libra_run_material_members",
        columns: ["run_material_manifest_id", "ordinal", "material_key"],
        keyColumns: ["run_material_manifest_id"],
      },
      list_claims: {
        kind: "select-all",
        tableId: "libra_run_material_episode_claims",
        columns: ["run_material_manifest_id", "member_ordinal", "episode_key"],
        keyColumns: ["run_material_manifest_id"],
      },
      insert_run: {
        kind: "insert",
        tableId: "libra_runs",
        columns: [
          "libra_run_id",
          "subject_id",
          "admission_revision",
          "acceptance_spec_id",
          "run_material_manifest_id",
          "execution_basis_schema_ref",
          "execution_basis_record_json",
          "execution_basis_digest",
          "run_scope_digest",
          "state",
          "state_revision",
          "state_digest",
          "package_revision_head",
          "priority_class",
          "priority_intent_digest",
          "recovery_policy_ref",
          "recovery_policy_digest",
          "suspension_started_at_ms",
          "recovery_attempt_ordinal",
          "recovery_next_due_at_ms",
          "latest_freshness_assessment_id",
          "latest_freshness_assessment_digest",
          "supersedes_run_id",
          "superseded_by_run_id",
          "created_at_ms",
          "terminal_at_ms",
        ],
      },
      supersede_run: {
        kind: "update",
        tableId: "libra_runs",
        setColumns: [
          "state",
          "state_revision",
          "state_digest",
          "superseded_by_run_id",
          "terminal_at_ms",
        ],
        keyColumns: ["libra_run_id"],
        compareColumns: [
          { column: "state_revision", parameter: "expected_state_revision" },
          { column: "state_digest", parameter: "expected_state_digest" },
          { column: "state", parameter: "expected_state" },
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
      insert_manifest: {
        kind: "insert",
        tableId: "libra_run_material_manifests",
        columns: [
          "run_material_manifest_id",
          "libra_run_id",
          "manifest_role",
          "scope_kind",
          "manifest_revision",
          "member_count",
          "member_set_digest",
          "episode_scope_digest",
          "manifest_digest",
          "published_at_ms",
        ],
      },
      insert_member: {
        kind: "insert",
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
          "location_kind",
          "endpoint_id",
          "location",
          "binding_kind",
          "binding_revision",
          "binding_evidence_digest",
          "origin_intake_decision_id",
          "origin_offer_id",
          "origin_candidate_package_id",
          "origin_package_revision",
          "origin_package_digest",
          "origin_candidate_delivery_snapshot_digest",
          "origin_related_reference_set_digest",
          "admitted_control_revision",
          "admitted_control_projection_digest",
          "output_requirement_digest",
          "episode_claim_set_digest",
          "member_digest",
        ],
      },
      insert_claim: {
        kind: "insert",
        tableId: "libra_run_material_episode_claims",
        columns: [
          "run_material_manifest_id",
          "member_ordinal",
          "episode_key",
          "season_claim_digest",
          "claim_digest",
        ],
      },
    },
  });
}
function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "libra_run_admission_foundation",
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
    },
  });
}

function headSnapshot(row, subjectId) {
  return row
    ? {
        headState: "present",
        headRevision: number(row.head_revision),
        activeScopeSetDigest: row.active_scope_set_digest,
      }
    : {
        headState: "absent",
        headRevision: 0,
        activeScopeSetDigest: activeRunScopeSetDigest(subjectId, []),
      };
}
function runScopeItem(
  row,
  stateRevision = number(row.state_revision),
  digest = row.state_digest,
) {
  return {
    libraRunId: row.libra_run_id,
    runScopeDigest: row.run_scope_digest,
    stateRevision,
    stateDigest: digest,
  };
}
function storedRunScope(repo, row) {
  const record = JSON.parse(row.execution_basis_record_json),
    manifest = repo.invoke("find_manifest", {
      run_material_manifest_id: row.run_material_manifest_id,
    });
  if (
    !manifest ||
    manifest.libra_run_id !== row.libra_run_id ||
    manifest.manifest_digest !==
      record.productionMaterialManifestRef.manifestDigest
  )
    fail(
      "P9_RUN_HISTORY_CORRUPT",
      "Stored Run Manifest relation is inconsistent.",
    );
  const members = repo
      .invoke("list_members", {
        run_material_manifest_id: row.run_material_manifest_id,
      })
      .sort((a, b) => number(a.ordinal) - number(b.ordinal)),
    claims = repo.invoke("list_claims", {
      run_material_manifest_id: row.run_material_manifest_id,
    }),
    specRow = repo.invoke("find_spec", {
      acceptance_spec_id: row.acceptance_spec_id,
    });
  if (!specRow)
    fail("P9_RUN_HISTORY_CORRUPT", "Stored Run Acceptance Spec is absent.");
  const spec = JSON.parse(specRow.spec_json);
  return {
    record,
    materialKeys: members.map((item) => item.material_key),
    episodeKeys: [...new Set(claims.map((item) => item.episode_key))].sort(),
    productScopeKind: spec.productScope.scopeKind,
    productEpisodeKeys: spec.productScope.episodeKeys,
  };
}
function sameScope(oldScope, newBasis, newSpec) {
  return (
    oldScope.record.subjectSnapshot.subjectId ===
      newBasis.subjectSnapshot.subjectId &&
    oldScope.record.subjectSnapshot.structureKind ===
      newBasis.subjectSnapshot.structureKind &&
    oldScope.productScopeKind === newSpec.productScope.scopeKind &&
    canonicalJson(oldScope.productEpisodeKeys) ===
      canonicalJson(newSpec.productScope.episodeKeys)
  );
}
function overlaps(left, right) {
  const values = new Set(left);
  return right.some((item) => values.has(item));
}
function assertOwnerRows(repo, decision, controls) {
  const basis = decision.runExecutionBasis,
    subject = repo.invoke("find_subject", { subject_id: decision.subjectId });
  if (
    !subject ||
    subject.status !== "active" ||
    subject.structure_kind !== basis.subjectSnapshot.structureKind ||
    subject.content_profile !== basis.subjectSnapshot.contentProfile ||
    number(subject.intake_revision) !== basis.subjectSnapshot.intakeRevision ||
    subject.current_continuity_set_digest !==
      basis.subjectSnapshot.continuitySetDigest ||
    subject.current_episode_scope_digest !==
      basis.subjectSnapshot.episodeScopeDigest
  )
    fail(
      "P9_RUN_SUBJECT_STALE",
      "Subject snapshot differs from current Owner row.",
    );
  const head = repo.invoke("find_decision_head", {
    subject_id: decision.subjectId,
  });
  if (
    !head ||
    number(head.head_revision) !== basis.decisionHeadSnapshot.headRevision ||
    head.head_digest !== basis.decisionHeadSnapshot.headDigest ||
    head.current_routing_decision_id !==
      basis.decisionHeadSnapshot.currentRoutingDecisionId ||
    head.current_decision_basis_id !==
      basis.decisionHeadSnapshot.currentDecisionBasisId ||
    head.current_acceptance_spec_id !==
      basis.decisionHeadSnapshot.currentAcceptanceSpecId
  )
    fail(
      "P9_RUN_DECISION_HEAD_STALE",
      "Subject Decision head differs from Execution Basis.",
    );
  const specRow = repo.invoke("find_spec", {
    acceptance_spec_id: basis.acceptanceSpec.acceptanceSpecId,
  });
  if (!specRow)
    fail("P9_RUN_SPEC_STALE", "Acceptance Spec Owner row is absent.");
  const spec = JSON.parse(specRow.spec_json);
  if (
    specRow.subject_id !== decision.subjectId ||
    number(specRow.spec_revision) !== basis.acceptanceSpec.specRevision ||
    specRow.spec_digest !== basis.acceptanceSpec.specDigest ||
    specRow.record_digest !== basis.acceptanceSpec.recordDigest ||
    specRow.product_scope_digest !== basis.acceptanceSpec.productScopeDigest ||
    specRow.shelf_id !== basis.acceptanceSpec.shelfId ||
    number(specRow.shelf_routing_projection_revision) !==
      basis.shelfProjection.routingProjectionRevision ||
    specRow.shelf_projection_digest !==
      basis.shelfProjection.projectionDigest ||
    number(specRow.shelf_standard_revision) !==
      basis.shelfProjection.standardRevision ||
    specRow.shelf_standard_digest !== basis.shelfProjection.standardDigest
  )
    fail(
      "P9_RUN_SPEC_STALE",
      "Acceptance Spec or Shelf Projection differs from immutable Owner row.",
    );
  const bindings = repo
      .invoke("list_bindings", { subject_id: decision.subjectId })
      .filter((row) => number(row.current) === 1),
    byKey = new Map(bindings.map((row) => [row.material_key, row])),
    claims = repo.invoke("list_binding_claims", {
      subject_id: decision.subjectId,
    });
  const controlByKey = new Map(
    controls.map((item) => [item.materialKey, item]),
  );
  for (const member of basis.productionMaterialManifest.members) {
    const row = byKey.get(member.materialKey);
    if (
      !row ||
      row.health_state !== "active" ||
      row.role !== member.role ||
      row.mount_scope_id !== member.physicalIdentity.mountScopeId ||
      row.inode !== member.physicalIdentity.inode ||
      row.fingerprint_algorithm !==
        member.physicalIdentity.fingerprintAlgorithm ||
      number(row.fingerprint_version) !== member.physicalIdentity.fingerprintVersion ||
      row.content_fingerprint !== member.physicalIdentity.contentFingerprint ||
      number(row.size_bytes) !== member.sizeBytes ||
      row.endpoint_id !== member.location.endpointId ||
      row.location !== member.location.location ||
      number(row.binding_revision) !== member.bindingRevision ||
      row.evidence_digest !== member.bindingEvidenceDigest ||
      row.origin_intake_decision_id !==
        member.originCandidateDeliveryRef.intakeDecisionId ||
      row.origin_offer_id !== member.originCandidateDeliveryRef.offerId ||
      row.origin_candidate_package_id !==
        member.originCandidateDeliveryRef.candidatePackageId ||
      number(row.origin_package_revision) !==
        member.originCandidateDeliveryRef.packageRevision ||
      row.origin_package_digest !==
        member.originCandidateDeliveryRef.packageDigest ||
      row.origin_candidate_delivery_snapshot_digest !==
        member.originCandidateDeliveryRef.candidateDeliverySnapshotDigest ||
      row.origin_related_reference_set_digest !==
        member.originCandidateDeliveryRef.relatedReferenceSetDigest
    )
      fail(
        "P9_RUN_BINDING_STALE",
        "Run member differs from current Libra Binding.",
        { materialKey: member.materialKey },
      );
    const boundClaims = claims
      .filter(
        (item) =>
          item.material_key === member.materialKey &&
          number(item.binding_revision) === member.bindingRevision,
      )
      .sort((a, b) => utf8(a.episode_key, b.episode_key))
      .map((item) => ({
        episodeKey: item.episode_key,
        seasonClaimDigest: item.season_claim_digest,
        claimDigest: canonicalDigest({
          schema: "libra.production-material-episode-claim@1",
          episodeKey: item.episode_key,
          seasonClaimDigest: item.season_claim_digest,
        }),
      }));
    if (canonicalJson(boundClaims) !== canonicalJson(member.episodeClaims))
      fail(
        "P9_RUN_BINDING_STALE",
        "Run Episode claims differ from Binding relations.",
        { materialKey: member.materialKey },
      );
    const control = controlByKey.get(member.materialKey);
    if (
      !control ||
      control.resultKind !== "available" ||
      control.controlState !== "controlled" ||
      control.ownerDomain !== "libra" ||
      control.ownerScopeType !== "subject" ||
      control.ownerScopeId !== decision.subjectId ||
      control.controlRevision !== member.admittedControlRevision ||
      control.projectionDigest !== member.admittedControlProjectionDigest
    )
      fail(
        "P9_RUN_CONTROL_STALE",
        "Material Control is not the admitted Libra Subject snapshot.",
        { materialKey: member.materialKey },
      );
  }
  return spec;
}

function createRunAdmissionStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork)
    fail(
      "P9_RUN_STORE_DEPENDENCIES",
      "Schema manifest and Unit of Work are required.",
    );
  const libra = libraDefinition(options.schemaManifest),
    foundation = foundationDefinition(options.schemaManifest);
  return Object.freeze({
    repositoryManifest: Object.freeze({
      libraTableIds: libra.tableIds,
      foundationTableIds: foundation.tableIds,
    }),
    admit(request) {
      const decision = buildRunAdmissionDecision(request?.decision),
        marker = request?.commitMarker,
        resultId = request?.resultId;
      if (
        typeof marker !== "string" ||
        !marker ||
        typeof resultId !== "string" ||
        !resultId
      )
        fail(
          "P9_RUN_COMMIT_INPUT",
          "Run admission marker and Result identity are required.",
        );
      const commitDigest = decision.decisionDigest;
      let result,
        replayed = false,
        controls = [];
      const preflight = {
        participantId: "run_admission_preflight",
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
            found.commit_digest !== commitDigest ||
            found.result_schema_ref !== RESULT_SCHEMA
          )
            fail(
              "P9_RUN_MARKER_CONFLICT",
              "Commit marker belongs to another Run admission.",
            );
          const stored = repo.invoke("find_result", {
            result_id: found.result_id,
          });
          if (!stored || stored.result_digest !== found.result_digest)
            fail("P9_RUN_REPLAY_CORRUPT", "Run admission Result is absent.");
          result = JSON.parse(stored.result_json);
          if (
            canonicalDigest(result) !== stored.result_digest ||
            result.resultDigest !==
              canonicalDigest(
                Object.fromEntries(
                  Object.entries(result).filter(
                    ([key]) => key !== "resultDigest",
                  ),
                ),
              )
          )
            fail("P9_RUN_REPLAY_CORRUPT", "Run admission Result is corrupt.");
          throw new Replay(result);
        },
      };
      const control = createMaterialControlAdmissionReadParticipant({
        schemaManifest: options.schemaManifest,
        materialKeys:
          decision.runExecutionBasis.productionMaterialManifest.members.map(
            (item) => item.materialKey,
          ),
        boundBusinessOwner: "libra",
        participantId: "run_admission_control_read",
        accept(value) {
          controls = value;
        },
      });
      const apply = {
        participantId: "run_admission_domain",
        owner: "libra",
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId),
            storedHead = repo.invoke("find_head", {
              subject_id: decision.subjectId,
            }),
            actualHead = headSnapshot(storedHead, decision.subjectId);
          if (
            canonicalJson(actualHead) !==
            canonicalJson(decision.expectedRunAdmissionHead)
          )
            fail("P9_RUN_HEAD_CAS", "Run admission head snapshot is stale.");
          const currentSpec = assertOwnerRows(repo, decision, controls);
          const runs = repo.invoke("list_runs", {
              subject_id: decision.subjectId,
            }),
            eligible = runs.filter((row) =>
              ["active", "suspended", "frozen"].includes(row.state),
            ),
            manifest = decision.runExecutionBasis.productionMaterialManifest,
            newMaterialKeys = manifest.members.map((item) => item.materialKey),
            newEpisodeKeys = [
              ...new Set(
                manifest.members.flatMap((item) =>
                  item.episodeClaims.map((claim) => claim.episodeKey),
                ),
              ),
            ].sort();
          let old = null,
            oldRevision = null;
          if (decision.admissionKind === "replacement") {
            old = runs.find(
              (row) =>
                row.libra_run_id === decision.replacementOfRunRef.libraRunId,
            );
            if (
              !old ||
              !["active", "suspended"].includes(old.state) ||
              number(old.state_revision) !==
                decision.replacementOfRunRef.stateRevision ||
              old.state_digest !== decision.replacementOfRunRef.stateDigest ||
              old.run_scope_digest !==
                decision.replacementOfRunRef.runScopeDigest ||
              old.acceptance_spec_id !==
                decision.replacementOfRunRef.acceptanceSpecId ||
              old.execution_basis_digest !==
                decision.replacementOfRunRef.executionBasisDigest
            )
              fail(
                "P9_RUN_REPLACEMENT_STALE",
                "Replacement target is absent or stale.",
              );
            if (
              old.priority_class !== decision.initialPriority.priorityClass ||
              old.priority_intent_digest !==
                decision.initialPriority.priorityIntentDigest
            )
              fail(
                "P9_RUN_REPLACEMENT_PRIORITY",
                "Replacement must copy current Run priority.",
              );
            if (
              !sameScope(
                storedRunScope(repo, old),
                decision.runExecutionBasis,
                currentSpec,
              )
            )
              fail(
                "P9_RUN_REPLACEMENT_SCOPE",
                "Replacement changes Subject or Episode delivery scope.",
              );
          }
          const retained = eligible.filter(
              (row) => !old || row.libra_run_id !== old.libra_run_id,
            ),
            retainedScopes = retained.map((row) => ({
              row,
              scope: storedRunScope(repo, row),
            }));
          if (
            decision.runExecutionBasis.subjectSnapshot.structureKind ===
              "single" &&
            retained.length
          )
            fail(
              "P9_RUN_SCOPE_CONFLICT",
              "Single Subject permits at most one eligible Run.",
            );
          if (
            retainedScopes.some(
              ({ scope }) =>
                overlaps(scope.materialKeys, newMaterialKeys) ||
                overlaps(scope.episodeKeys, newEpisodeKeys),
            )
          )
            fail(
              "P9_RUN_SCOPE_CONFLICT",
              "Eligible Run material or Episode scopes overlap.",
            );
          const committedHead = actualHead.headRevision + 1,
            transitionKind = "admitted",
            transitionEvidenceDigest = decision.decisionDigest,
            newState = {
              libraRunId: decision.libraRunId,
              stateRevision: 1,
              state: "active",
              acceptanceSpecId:
                decision.runExecutionBasis.acceptanceSpec.acceptanceSpecId,
              executionBasisDigest:
                decision.runExecutionBasis.executionBasisDigest,
              runScopeDigest: decision.runScopeDigest,
              priorityClass: decision.initialPriority.priorityClass,
              priorityIntentDigest:
                decision.initialPriority.priorityIntentDigest,
              transitionKind,
              transitionEvidenceDigest,
            };
          newState.stateDigest = stateDigest(newState);
          if (old) {
            const transitionEvidenceDigestOld = decision.decisionDigest;
            oldRevision = {
              libraRunId: old.libra_run_id,
              stateRevision: number(old.state_revision) + 1,
              state: "superseded",
              acceptanceSpecId: old.acceptance_spec_id,
              executionBasisDigest: old.execution_basis_digest,
              runScopeDigest: old.run_scope_digest,
              priorityClass: old.priority_class,
              priorityIntentDigest: old.priority_intent_digest,
              transitionKind: "superseded",
              transitionEvidenceDigest: transitionEvidenceDigestOld,
            };
            oldRevision.stateDigest = stateDigest(oldRevision);
          }
          const scopeItems = [
              ...retained.map((row) => runScopeItem(row)),
              runScopeItem(
                {
                  libra_run_id: decision.libraRunId,
                  run_scope_digest: decision.runScopeDigest,
                },
                1,
                newState.stateDigest,
              ),
            ].sort((a, b) =>
              Buffer.from(a.libraRunId).compare(Buffer.from(b.libraRunId)),
            ),
            scopeDigest = activeRunScopeSetDigest(
              decision.subjectId,
              scopeItems,
            );
          const makeRevision = (state, previous) => {
            const value = {
              recoveryPolicyRef: null,
              recoveryPolicyDigest: null,
              suspensionStartedAtMs: null,
              recoveryAttemptOrdinal: 0,
              recoveryNextDueAtMs: null,
              ...state,
              transitionDecisionId: decision.decisionId,
              transitionDecisionDigest: decision.decisionDigest,
              transitionEvidenceSchemaRef: DECISION_SCHEMA,
              transitionEvidenceId: decision.decisionId,
              transitionEvidenceJson: decision,
              expectedAdmissionHeadRevision: actualHead.headRevision,
              expectedActiveScopeSetDigest: actualHead.activeScopeSetDigest,
              committedAdmissionHeadRevision: committedHead,
              committedActiveScopeSetDigest: scopeDigest,
              previousStateRevision: previous,
            };
            value.revisionDigest = canonicalDigest(revisionValue(value));
            return value;
          };
          if (old)
            oldRevision = makeRevision(oldRevision, number(old.state_revision));
          const record = buildRunExecutionBasisRecord(
            decision.runExecutionBasis,
          );
          repo.invoke("insert_run", {
            libra_run_id: decision.libraRunId,
            subject_id: decision.subjectId,
            admission_revision: decision.admissionRevision,
            acceptance_spec_id: newState.acceptanceSpecId,
            run_material_manifest_id: manifest.manifestId,
            execution_basis_schema_ref: BASIS_SCHEMA,
            execution_basis_record_json: canonicalJson(record),
            execution_basis_digest: newState.executionBasisDigest,
            run_scope_digest: newState.runScopeDigest,
            state: "active",
            state_revision: 1,
            state_digest: newState.stateDigest,
            package_revision_head: 0,
            priority_class: newState.priorityClass,
            priority_intent_digest: newState.priorityIntentDigest,
            recovery_policy_ref: null,
            recovery_policy_digest: null,
            suspension_started_at_ms: null,
            recovery_attempt_ordinal: 0,
            recovery_next_due_at_ms: null,
            latest_freshness_assessment_id: null,
            latest_freshness_assessment_digest: null,
            supersedes_run_id: (old && old.libra_run_id) || null,
            superseded_by_run_id: null,
            created_at_ms: context.commitTimeMs,
            terminal_at_ms: null,
          });
          if (old) {
            if (
              repo.invoke("supersede_run", {
                state: "superseded",
                state_revision: oldRevision.stateRevision,
                state_digest: oldRevision.stateDigest,
                superseded_by_run_id: decision.libraRunId,
                terminal_at_ms: context.commitTimeMs,
                libra_run_id: old.libra_run_id,
                expected_state_revision: number(old.state_revision),
                expected_state_digest: old.state_digest,
                expected_state: old.state,
              }).changes !== 1
            )
              fail("P9_RUN_REPLACEMENT_CAS", "Replacement target CAS failed.");
            insertRevision(repo, oldRevision, context.commitTimeMs);
          }
          repo.invoke("insert_manifest", {
            run_material_manifest_id: manifest.manifestId,
            libra_run_id: decision.libraRunId,
            manifest_role: manifest.manifestRole,
            scope_kind: manifest.scopeKind,
            manifest_revision: manifest.manifestRevision,
            member_count: manifest.members.length,
            member_set_digest: manifest.memberSetDigest,
            episode_scope_digest: manifest.episodeScopeDigest,
            manifest_digest: manifest.manifestDigest,
            published_at_ms: context.commitTimeMs,
          });
          for (const member of manifest.members) {
            repo.invoke("insert_member", {
              run_material_manifest_id: manifest.manifestId,
              ordinal: member.ordinal,
              material_key: member.materialKey,
              role: member.role,
              mount_scope_id: member.physicalIdentity.mountScopeId,
              inode: member.physicalIdentity.inode,
              fingerprint_algorithm:
                member.physicalIdentity.fingerprintAlgorithm,
              fingerprint_version: member.physicalIdentity.fingerprintVersion,
              content_fingerprint: member.physicalIdentity.contentFingerprint,
              size_bytes: member.sizeBytes,
              location_kind: member.location.locationKind,
              endpoint_id: member.location.endpointId,
              location: member.location.location,
              binding_kind: member.bindingKind,
              binding_revision: member.bindingRevision,
              binding_evidence_digest: member.bindingEvidenceDigest,
              origin_intake_decision_id:
                member.originCandidateDeliveryRef.intakeDecisionId,
              origin_offer_id: member.originCandidateDeliveryRef.offerId,
              origin_candidate_package_id:
                member.originCandidateDeliveryRef.candidatePackageId,
              origin_package_revision:
                member.originCandidateDeliveryRef.packageRevision,
              origin_package_digest:
                member.originCandidateDeliveryRef.packageDigest,
              origin_candidate_delivery_snapshot_digest:
                member.originCandidateDeliveryRef
                  .candidateDeliverySnapshotDigest,
              origin_related_reference_set_digest:
                member.originCandidateDeliveryRef.relatedReferenceSetDigest,
              admitted_control_revision: member.admittedControlRevision,
              admitted_control_projection_digest:
                member.admittedControlProjectionDigest,
              output_requirement_digest: member.outputRequirementDigest,
              episode_claim_set_digest: member.episodeClaimSetDigest,
              member_digest: member.memberDigest,
            });
            for (const claim of member.episodeClaims)
              repo.invoke("insert_claim", {
                run_material_manifest_id: manifest.manifestId,
                member_ordinal: member.ordinal,
                episode_key: claim.episodeKey,
                season_claim_digest: claim.seasonClaimDigest,
                claim_digest: claim.claimDigest,
              });
          }
          const initialRevision = makeRevision(
            {
              ...newState,
              recoveryPolicyRef: null,
              recoveryPolicyDigest: null,
              suspensionStartedAtMs: null,
              recoveryAttemptOrdinal: 0,
              recoveryNextDueAtMs: null,
            },
            null,
          );
          insertRevision(repo, initialRevision, context.commitTimeMs);
          if (actualHead.headState === "absent")
            repo.invoke("insert_head", {
              subject_id: decision.subjectId,
              head_revision: committedHead,
              active_scope_set_digest: scopeDigest,
              updated_at_ms: context.commitTimeMs,
            });
          else if (
            repo.invoke("advance_head", {
              head_revision: committedHead,
              active_scope_set_digest: scopeDigest,
              updated_at_ms: context.commitTimeMs,
              subject_id: decision.subjectId,
              expected_head_revision: actualHead.headRevision,
              expected_scope_digest: actualHead.activeScopeSetDigest,
            }).changes !== 1
          )
            fail("P9_RUN_HEAD_CAS", "Run admission head CAS failed.");
          result = {
            decisionId: decision.decisionId,
            libraRunId: decision.libraRunId,
            admissionRevision: decision.admissionRevision,
            stateRevision: 1,
            stateDigest: newState.stateDigest,
            executionBasisDigest: newState.executionBasisDigest,
            runScopeDigest: newState.runScopeDigest,
            productionMaterialManifestId: manifest.manifestId,
            priorityClass: newState.priorityClass,
            priorityIntentDigest: newState.priorityIntentDigest,
            committedAdmissionHeadRevision: committedHead,
            activeScopeSetDigest: scopeDigest,
          };
          if (oldRevision)
            result.supersededRunRef = {
              libraRunId: old.libra_run_id,
              committedStateRevision: oldRevision.stateRevision,
              committedStateDigest: oldRevision.stateDigest,
            };
          result.resultDigest = canonicalDigest(result);
        },
      };
      const finish = {
        participantId: "run_admission_foundation",
        owner: "execution-foundation",
        boundBusinessOwner: "libra",
        repositories: [foundation],
        execute(context) {
          const repo = context.repository(foundation.repositoryId);
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
            effect_receipt_id: null,
            committed_at_ms: context.commitTimeMs,
          });
          repo.invoke("insert_marker", {
            commit_marker: marker,
            effect_id: null,
            owner_domain: "libra",
            scope_type: "libra_run",
            scope_id: decision.libraRunId,
            commit_digest: commitDigest,
            result_id: resultId,
            result_schema_ref: RESULT_SCHEMA,
            result_digest: canonicalDigest(result),
            committed_at_ms: context.commitTimeMs,
          });
        },
      };
      try {
        options.unitOfWork.execute([preflight, control, apply, finish]);
      } catch (error) {
        if (error instanceof Replay)
          return Object.freeze({ result: error.result, replayed: true });
        throw error;
      }
      return Object.freeze({ result, replayed });
    },
  });
}
function insertRevision(repo, value, time) {
  repo.invoke("insert_revision", {
    libra_run_id: value.libraRunId,
    state_revision: value.stateRevision,
    state: value.state,
    acceptance_spec_id: value.acceptanceSpecId,
    execution_basis_digest: value.executionBasisDigest,
    run_scope_digest: value.runScopeDigest,
    priority_class: value.priorityClass,
    priority_intent_digest: value.priorityIntentDigest,
    transition_kind: value.transitionKind,
    transition_decision_id: value.transitionDecisionId,
    transition_decision_digest: value.transitionDecisionDigest,
    transition_evidence_schema_ref: value.transitionEvidenceSchemaRef,
    transition_evidence_id: value.transitionEvidenceId,
    transition_evidence_json: canonicalJson(value.transitionEvidenceJson || {}),
    transition_evidence_digest: value.transitionEvidenceDigest,
    recovery_policy_ref: value.recoveryPolicyRef,
    recovery_policy_digest: value.recoveryPolicyDigest,
    suspension_started_at_ms: value.suspensionStartedAtMs,
    recovery_attempt_ordinal: value.recoveryAttemptOrdinal,
    recovery_next_due_at_ms: value.recoveryNextDueAtMs,
    expected_admission_head_revision: value.expectedAdmissionHeadRevision,
    expected_active_scope_set_digest: value.expectedActiveScopeSetDigest,
    committed_admission_head_revision: value.committedAdmissionHeadRevision,
    committed_active_scope_set_digest: value.committedActiveScopeSetDigest,
    previous_state_revision: value.previousStateRevision,
    revision_digest: value.revisionDigest,
    committed_at_ms: time,
  });
}

module.exports = Object.freeze({
  BASIS_SCHEMA,
  DECISION_SCHEMA,
  RESULT_SCHEMA,
  RunAdmissionStoreError,
  createRunAdmissionStore,
  stateDigest,
});
