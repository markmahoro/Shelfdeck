"use strict";
const {
  canonicalDigest,
  canonicalJson,
} = require("../../../contracts/canonical-json");
const {
  createRepositoryDefinition,
} = require("../../../foundation/persistence/owner-repository");
const {
  buildSpaceAdmissionRequest,
  buildWorkspaceAdmissionDecision,
  emptyReferenceSetDigest,
  validateRootSnapshot,
  validateSpaceEvidence,
  workspaceStateDigest,
} = require("../model/workspace-admission-contracts");
const RESULT_SCHEMA =
  "helix://contracts/application-types/LibraWorkspaceAdmissionResult/v1";
const DECISION_SCHEMA =
  "helix://contracts/application-types/LibraWorkspaceAdmissionDecision/v1";
class WorkspaceAdmissionStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceAdmissionStoreError";
    this.code = code;
  }
}
class Replay extends Error {
  constructor(result) {
    super("Workspace admission replay");
    this.result = result;
  }
}
function fail(code, message) {
  throw new WorkspaceAdmissionStoreError(code, message);
}
function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "libra_workspace_admission",
    owner: "libra",
    schemaManifest,
    statements: {
      find_run: {
        kind: "select-one",
        tableId: "libra_runs",
        columns: [
          "libra_run_id",
          "state",
          "state_revision",
          "state_digest",
          "execution_basis_digest",
          "execution_basis_record_json",
          "run_material_manifest_id",
        ],
        keyColumns: ["libra_run_id"],
      },
      find_manifest: {
        kind: "select-one",
        tableId: "libra_run_material_manifests",
        columns: [
          "run_material_manifest_id",
          "libra_run_id",
          "manifest_role",
          "manifest_revision",
          "member_count",
          "member_set_digest",
          "manifest_digest",
        ],
        keyColumns: ["run_material_manifest_id"],
        safeIntegers: true,
      },
      list_members: {
        kind: "select-all",
        tableId: "libra_run_material_members",
        columns: [
          "run_material_manifest_id",
          "role",
          "size_bytes",
          "member_digest",
        ],
        keyColumns: ["run_material_manifest_id"],
        safeIntegers: true,
      },
      find_workspace: {
        kind: "select-one",
        tableId: "libra_workspaces",
        columns: ["workspace_id", "libra_run_id"],
        keyColumns: ["workspace_id"],
      },
      insert_workspace: {
        kind: "insert",
        tableId: "libra_workspaces",
        columns: [
          "workspace_id",
          "libra_run_id",
          "platform_workspace_root_id",
          "platform_workspace_root_kind",
          "platform_workspace_revision",
          "platform_workspace_endpoint_id",
          "platform_workspace_mount_scope_id",
          "platform_workspace_mount_scope_revision",
          "platform_workspace_capability_digest",
          "platform_workspace_snapshot_digest",
          "root_handle_ref",
          "space_admission_evidence_schema_ref",
          "space_admission_evidence_id",
          "space_admission_evidence_json",
          "space_admission_evidence_digest",
          "space_admission_required_bytes",
          "space_admission_available_bytes",
          "space_admission_expires_at_ms",
          "workspace_scope_digest",
          "admission_decision_digest",
          "current_revision",
          "state",
          "state_digest",
          "created_at_ms",
          "completed_at_ms",
        ],
      },
      insert_revision: {
        kind: "insert",
        tableId: "libra_workspace_revisions",
        columns: [
          "workspace_id",
          "workspace_revision",
          "state",
          "material_reference_set_digest",
          "transition_kind",
          "transition_evidence_digest",
          "previous_revision",
          "revision_digest",
          "committed_at_ms",
        ],
      },
    },
  });
}
function platformDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "platform_workspace_admission_read",
    owner: "platform-settings",
    schemaManifest,
    statements: {
      find_root: {
        kind: "select-one",
        tableId: "platform_workspace_roots",
        columns: [
          "root_id",
          "owner_scope",
          "root_kind",
          "endpoint_id",
          "mount_scope_id",
          "mount_scope_revision",
          "config_revision",
          "capability_digest",
          "state",
          "root_handle_ref",
          "snapshot_digest",
        ],
        keyColumns: ["root_id"],
      },
    },
  });
}
function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: "workspace_admission_foundation",
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
      insert_registry: {
        kind: "insert",
        tableId: "fx_workspace_registry",
        columns: [
          "workspace_id",
          "owner_domain",
          "process_type",
          "process_id",
          "root_handle_ref",
          "state",
          "created_at_ms",
          "reclaim_after_ms",
          "reclaimed_at_ms",
        ],
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
function createWorkspaceAdmissionStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork)
    fail(
      "P9_WORKSPACE_STORE_DEPENDENCIES",
      "Schema manifest and Unit of Work are required.",
    );
  const libra = libraDefinition(options.schemaManifest),
    platform = platformDefinition(options.schemaManifest),
    foundation = foundationDefinition(options.schemaManifest);
  return Object.freeze({
    repositoryManifest: Object.freeze({
      libraTableIds: libra.tableIds,
      platformTableIds: platform.tableIds,
      foundationTableIds: foundation.tableIds,
    }),
    admit(request) {
      const decision = buildWorkspaceAdmissionDecision(request?.decision),
        marker = request?.commitMarker,
        resultId = request?.resultId;
      if (
        typeof marker !== "string" ||
        !marker ||
        typeof resultId !== "string" ||
        !resultId
      )
        fail(
          "P9_WORKSPACE_COMMIT_INPUT",
          "Commit marker and Result identity are required.",
        );
      let root, result;
      const preflight = {
        participantId: "workspace_admission_preflight",
        owner: "execution-foundation",
        boundBusinessOwner: "libra",
        repositories: [foundation],
        execute(context) {
          const repo = context.repository(foundation.repositoryId),
            found = repo.invoke("find_marker", { commit_marker: marker });
          if (!found) return;
          if (
            found.owner_domain !== "libra" ||
            found.scope_type !== "libra_workspace" ||
            found.scope_id !== decision.workspaceId ||
            found.commit_digest !== decision.decisionDigest ||
            found.result_schema_ref !== RESULT_SCHEMA
          )
            fail(
              "P9_WORKSPACE_MARKER_CONFLICT",
              "Commit marker belongs to another admission.",
            );
          const stored = repo.invoke("find_result", {
            result_id: found.result_id,
          });
          if (!stored || stored.result_digest !== found.result_digest)
            fail("P9_WORKSPACE_REPLAY_CORRUPT", "Stored Result is absent.");
          const replay = JSON.parse(stored.result_json);
          if (canonicalDigest(replay) !== stored.result_digest)
            fail("P9_WORKSPACE_REPLAY_CORRUPT", "Stored Result is corrupt.");
          throw new Replay(replay);
        },
      };
      const platformRead = {
        participantId: "workspace_admission_platform_read",
        owner: "platform-settings",
        boundBusinessOwner: "libra",
        repositories: [platform],
        execute(context) {
          const row = context
            .repository(platform.repositoryId)
            .invoke("find_root", {
              root_id: decision.platformWorkspaceRootSnapshot.rootId,
            });
          if (!row)
            fail("P9_WORKSPACE_ROOT_STALE", "Workspace root no longer exists.");
          root = validateRootSnapshot({
            rootId: row.root_id,
            ownerScope: row.owner_scope,
            rootKind: row.root_kind,
            endpointId: row.endpoint_id,
            mountScopeId: row.mount_scope_id,
            mountScopeRevision: Number(row.mount_scope_revision),
            configRevision: Number(row.config_revision),
            capabilityDigest: row.capability_digest,
            state: row.state,
            rootHandleRef: row.root_handle_ref,
            snapshotDigest: row.snapshot_digest,
          });
          if (
            canonicalJson(root) !==
            canonicalJson(decision.platformWorkspaceRootSnapshot)
          )
            fail(
              "P9_WORKSPACE_ROOT_STALE",
              "Workspace root current tuple is stale.",
            );
        },
      };
      const apply = {
        participantId: "workspace_admission_domain",
        owner: "libra",
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId),
            run = repo.invoke("find_run", {
              libra_run_id: decision.libraRunRef.libraRunId,
            });
          if (
            !run ||
            run.state !== "active" ||
            Number(run.state_revision) !== decision.libraRunRef.stateRevision ||
            run.state_digest !== decision.libraRunRef.stateDigest ||
            run.execution_basis_digest !==
              decision.libraRunRef.executionBasisDigest
          )
            fail("P9_WORKSPACE_RUN_STALE", "Run current fence is stale.");
          if (
            repo.invoke("find_workspace", {
              workspace_id: decision.workspaceId,
            })
          )
            fail(
              "P9_WORKSPACE_ALREADY_EXISTS",
              "Run already has its stable Workspace.",
            );
          const manifest = repo.invoke("find_manifest", {
            run_material_manifest_id: run.run_material_manifest_id,
          });
          const executionBasisRecord = JSON.parse(
            run.execution_basis_record_json || "{}",
          );
          const manifestRef = executionBasisRecord.productionMaterialManifestRef;
          const members = repo.invoke("list_members", {
            run_material_manifest_id: run.run_material_manifest_id,
          });
          if (
            !manifest ||
            manifest.libra_run_id !== run.libra_run_id ||
            manifest.manifest_role !== "run_input" ||
            Number(manifest.manifest_revision) !== 1 ||
            !manifestRef ||
            manifestRef.manifestId !== manifest.run_material_manifest_id ||
            manifestRef.memberCount !== Number(manifest.member_count) ||
            manifestRef.memberSetDigest !== manifest.member_set_digest ||
            manifestRef.manifestDigest !== manifest.manifest_digest ||
            members.length !== Number(manifest.member_count) ||
            members.some((item) => !/^[a-f0-9]{64}$/.test(item.member_digest || ""))
          )
            fail(
              "P9_WORKSPACE_MANIFEST_INTEGRITY",
              "Immutable Run Manifest/member continuity is broken.",
            );
          const primaryMembers = members.filter(
              (item) => item.role === "primary_payload",
            ),
            inputPrimaryTotalBytes = primaryMembers.reduce(
              (sum, item) => sum + Number(item.size_bytes),
              0,
            );
          if (
            primaryMembers.length < 1 ||
            !Number.isSafeInteger(inputPrimaryTotalBytes)
          )
            fail(
              "P9_WORKSPACE_DEMAND_RANGE",
              "Primary input bytes exceed the safe integer range or are absent.",
            );
          const spaceRequest = buildSpaceAdmissionRequest({
            workspaceId: decision.workspaceId,
            libraRunId: run.libra_run_id,
            executionBasisDigest: run.execution_basis_digest,
            rootId: root.rootId,
            rootSnapshotDigest: root.snapshotDigest,
            inputPrimaryTotalBytes,
            requiredFreeBytes: decision.spaceAdmissionEvidence.requiredBytes,
            requestDigest: decision.spaceAdmissionEvidence.requestDigest,
          });
          const evidence = validateSpaceEvidence(
            decision.spaceAdmissionEvidence,
            {
              requestDigest: spaceRequest.requestDigest,
              workspaceId: decision.workspaceId,
              libraRunId: run.libra_run_id,
              rootId: root.rootId,
              rootSnapshotDigest: root.snapshotDigest,
              requiredBytes: spaceRequest.requiredFreeBytes,
            },
            context.commitTimeMs,
          );
          const referenceSetDigest = emptyReferenceSetDigest(
              decision.workspaceId,
            ),
            state = {
              workspaceId: decision.workspaceId,
              workspaceRevision: 1,
              state: "active",
              workspaceMaterialReferenceSetDigest: referenceSetDigest,
              transitionKind: "admitted",
              transitionEvidenceDigest: decision.decisionDigest,
            };
          state.stateDigest = workspaceStateDigest(state);
          repo.invoke("insert_workspace", {
            workspace_id: decision.workspaceId,
            libra_run_id: run.libra_run_id,
            platform_workspace_root_id: root.rootId,
            platform_workspace_root_kind: root.rootKind,
            platform_workspace_revision: root.configRevision,
            platform_workspace_endpoint_id: root.endpointId,
            platform_workspace_mount_scope_id: root.mountScopeId,
            platform_workspace_mount_scope_revision: root.mountScopeRevision,
            platform_workspace_capability_digest: root.capabilityDigest,
            platform_workspace_snapshot_digest: root.snapshotDigest,
            root_handle_ref: root.rootHandleRef,
            space_admission_evidence_schema_ref:
              "helix://contracts/application-types/WorkspaceSpaceAdmissionEvidence/v1",
            space_admission_evidence_id: evidence.evidenceId,
            space_admission_evidence_json: canonicalJson(evidence),
            space_admission_evidence_digest: evidence.evidenceDigest,
            space_admission_required_bytes: evidence.requiredBytes,
            space_admission_available_bytes: evidence.availableBytes,
            space_admission_expires_at_ms: evidence.expiresAtMs,
            workspace_scope_digest: decision.workspaceScopeDigest,
            admission_decision_digest: decision.decisionDigest,
            current_revision: 1,
            state: "active",
            state_digest: state.stateDigest,
            created_at_ms: context.commitTimeMs,
            completed_at_ms: null,
          });
          const revisionDigest = canonicalDigest({
            ...state,
            previousRevision: null,
          });
          repo.invoke("insert_revision", {
            workspace_id: decision.workspaceId,
            workspace_revision: 1,
            state: "active",
            material_reference_set_digest: referenceSetDigest,
            transition_kind: "admitted",
            transition_evidence_digest: decision.decisionDigest,
            previous_revision: null,
            revision_digest: revisionDigest,
            committed_at_ms: context.commitTimeMs,
          });
          result = {
            decisionId: decision.decisionId,
            libraRunId: run.libra_run_id,
            workspaceId: decision.workspaceId,
            platformWorkspaceRevision: root.configRevision,
            workspaceRevision: 1,
            workspaceState: "active",
            workspaceStateDigest: state.stateDigest,
          };
          result.resultDigest = canonicalDigest(result);
        },
      };
      const finish = {
        participantId: "workspace_admission_foundation",
        owner: "execution-foundation",
        boundBusinessOwner: "libra",
        repositories: [foundation],
        execute(context) {
          const repo = context.repository(foundation.repositoryId);
          repo.invoke("insert_registry", {
            workspace_id: decision.workspaceId,
            owner_domain: "libra",
            process_type: "libra_run",
            process_id: decision.libraRunRef.libraRunId,
            root_handle_ref: root.rootHandleRef,
            state: "active",
            created_at_ms: context.commitTimeMs,
            reclaim_after_ms: null,
            reclaimed_at_ms: null,
          });
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
            scope_type: "libra_workspace",
            scope_id: decision.workspaceId,
            commit_digest: decision.decisionDigest,
            result_id: resultId,
            result_schema_ref: RESULT_SCHEMA,
            result_digest: canonicalDigest(result),
            committed_at_ms: context.commitTimeMs,
          });
        },
      };
      try {
        options.unitOfWork.execute([preflight, platformRead, apply, finish]);
      } catch (error) {
        if (error instanceof Replay)
          return Object.freeze({ result: error.result, replayed: true });
        throw error;
      }
      return Object.freeze({ result, replayed: false });
    },
  });
}
module.exports = Object.freeze({
  DECISION_SCHEMA,
  RESULT_SCHEMA,
  WorkspaceAdmissionStoreError,
  createWorkspaceAdmissionStore,
});
