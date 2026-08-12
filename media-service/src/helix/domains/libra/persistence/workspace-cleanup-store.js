'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  controlScopeDigest,
  createMaterialControlParticipant,
  projectMaterialControlRow,
} = require('../../../foundation/persistence/material-control');
const {
  buildReferenceSnapshot,
  referenceSetDigest,
  workspaceStateDigest,
} = require('../model/workspace-material-reference-contracts');
const {
  buildObservation,
  controlItem,
  memberFromReference,
  memberState,
  scopeState,
} = require('../model/workspace-cleanup-contracts');

const ADMISSION_RESULT =
  'helix://contracts/application-types/WorkspaceCleanupScopeAdmissionResult/v1';
const COMMIT_RESULT =
  'helix://contracts/types/WorkspaceCleanupCommitReceipt/v1';
const ADMISSION_RECORD =
  'helix://contracts/application-types/WorkspaceCleanupScopeAdmissionRecord/v1';
const DELETION_EVIDENCE =
  'helix://contracts/types/WorkspaceMaterialDeletionEvidence/v1';

class WorkspaceCleanupStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceCleanupStoreError';
    this.code = code;
    this.details = details;
  }
}
class Replay extends Error {
  constructor(result) {
    super('Workspace cleanup replay');
    this.result = result;
  }
}
function fail(code, message, details) {
  throw new WorkspaceCleanupStoreError(code, message, details);
}

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_workspace_cleanup',
    owner: 'libra',
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one', tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'state', 'state_revision', 'state_digest',
          'execution_basis_digest',
        ],
        keyColumns: ['libra_run_id'], safeIntegers: true,
      },
      find_workspace: {
        kind: 'select-one', tableId: 'libra_workspaces',
        columns: [
          'workspace_id', 'libra_run_id', 'current_revision', 'state',
          'state_digest',
        ],
        keyColumns: ['workspace_id'], safeIntegers: true,
      },
      list_run_workspaces: {
        kind: 'select-all', tableId: 'libra_workspaces',
        columns: ['workspace_id', 'libra_run_id', 'state', 'current_revision'],
        keyColumns: ['libra_run_id'], safeIntegers: true,
      },
      find_workspace_revision: {
        kind: 'select-one', tableId: 'libra_workspace_revisions',
        columns: [
          'workspace_id', 'workspace_revision', 'state',
          'material_reference_set_digest', 'transition_kind',
          'transition_evidence_digest', 'previous_revision', 'revision_digest',
        ],
        keyColumns: ['workspace_id', 'workspace_revision'], safeIntegers: true,
      },
      list_workspace_references: {
        kind: 'select-all', tableId: 'libra_workspace_material_refs',
        columns: [
          'workspace_id', 'libra_run_id', 'reference_id',
          'material_handle_id', 'material_key', 'workspace_handle_schema_ref',
          'workspace_handle_json', 'workspace_handle_digest',
          'reference_revision', 'reference_state',
          'episode_claims_schema_ref', 'episode_claims_json',
          'episode_scope_digest', 'product_verification_schema_ref',
          'product_verification_id', 'product_verification_json',
          'product_verification_digest', 'previous_reference_revision',
          'committed_workspace_revision', 'reference_digest',
        ],
        keyColumns: ['workspace_id'], safeIntegers: true,
      },
      list_material_references: {
        kind: 'select-all', tableId: 'libra_workspace_material_refs',
        columns: [
          'workspace_id', 'reference_id', 'material_handle_id', 'material_key',
          'reference_revision', 'reference_state', 'reference_digest',
        ],
        keyColumns: ['material_key'], safeIntegers: true,
      },
      find_scope: {
        kind: 'select-one', tableId: 'libra_workspace_cleanup_scopes',
        columns: [
          'cleanup_scope_id', 'libra_run_id', 'workspace_id', 'trigger_kind',
          'trigger_ref', 'trigger_revision', 'trigger_digest',
          'admission_record_schema_ref', 'admission_record_json',
          'admission_decision_digest', 'eligibility_evidence_digest',
          'member_set_digest', 'state', 'state_revision', 'state_digest',
          'created_at_ms', 'completed_at_ms',
        ],
        keyColumns: ['cleanup_scope_id'], safeIntegers: true,
      },
      find_trigger_scope: {
        kind: 'select-one', tableId: 'libra_workspace_cleanup_scopes',
        columns: [
          'cleanup_scope_id', 'admission_decision_digest', 'state',
          'state_revision', 'state_digest', 'member_set_digest',
        ],
        keyColumns: [
          'trigger_kind', 'trigger_ref', 'trigger_revision', 'trigger_digest',
        ],
        safeIntegers: true,
      },
      insert_scope: {
        kind: 'insert', tableId: 'libra_workspace_cleanup_scopes',
        columns: [
          'cleanup_scope_id', 'libra_run_id', 'workspace_id', 'trigger_kind',
          'trigger_ref', 'trigger_revision', 'trigger_digest',
          'admission_record_schema_ref', 'admission_record_json',
          'admission_decision_digest', 'eligibility_evidence_digest',
          'member_set_digest', 'state', 'state_revision', 'state_digest',
          'created_at_ms', 'completed_at_ms',
        ],
      },
      update_scope: {
        kind: 'update', tableId: 'libra_workspace_cleanup_scopes',
        setColumns: [
          'state', 'state_revision', 'state_digest', 'completed_at_ms',
        ],
        keyColumns: ['cleanup_scope_id'],
        compareColumns: [
          { column: 'state_revision', parameter: 'expected_state_revision' },
          { column: 'state_digest', parameter: 'expected_state_digest' },
          { column: 'state', parameter: 'expected_state' },
        ],
      },
      list_members: {
        kind: 'select-all', tableId: 'libra_workspace_cleanup_members',
        columns: [
          'cleanup_scope_id', 'material_handle_id', 'material_key',
          'workspace_reference_id', 'expected_reference_revision',
          'expected_reference_digest', 'control_disposition',
          'expected_control_revision', 'expected_control_projection_digest',
          'expected_control_owner_domain',
          'expected_control_owner_scope_type',
          'expected_control_owner_scope_id', 'cleanup_kind', 'state',
          'state_revision', 'state_digest', 'committed_scope_state_revision',
          'deletion_effect_id', 'outcome_evidence_schema_ref',
          'outcome_evidence_id', 'outcome_evidence_json',
          'outcome_evidence_digest', 'cleanup_receipt_id', 'updated_at_ms',
        ],
        keyColumns: ['cleanup_scope_id'], safeIntegers: true,
      },
      find_member: {
        kind: 'select-one', tableId: 'libra_workspace_cleanup_members',
        columns: [
          'cleanup_scope_id', 'material_handle_id', 'material_key',
          'workspace_reference_id', 'expected_reference_revision',
          'expected_reference_digest', 'control_disposition',
          'expected_control_revision', 'expected_control_projection_digest',
          'expected_control_owner_domain',
          'expected_control_owner_scope_type',
          'expected_control_owner_scope_id', 'cleanup_kind', 'state',
          'state_revision', 'state_digest', 'committed_scope_state_revision',
          'deletion_effect_id', 'outcome_evidence_schema_ref',
          'outcome_evidence_id', 'outcome_evidence_json',
          'outcome_evidence_digest', 'cleanup_receipt_id', 'updated_at_ms',
        ],
        keyColumns: ['cleanup_scope_id', 'material_handle_id'],
        safeIntegers: true,
      },
      insert_member: {
        kind: 'insert', tableId: 'libra_workspace_cleanup_members',
        columns: [
          'cleanup_scope_id', 'material_handle_id', 'material_key',
          'workspace_reference_id', 'expected_reference_revision',
          'expected_reference_digest', 'control_disposition',
          'expected_control_revision', 'expected_control_projection_digest',
          'expected_control_owner_domain',
          'expected_control_owner_scope_type',
          'expected_control_owner_scope_id', 'cleanup_kind', 'state',
          'state_revision', 'state_digest', 'committed_scope_state_revision',
          'deletion_effect_id', 'outcome_evidence_schema_ref',
          'outcome_evidence_id', 'outcome_evidence_json',
          'outcome_evidence_digest', 'cleanup_receipt_id', 'updated_at_ms',
        ],
      },
      update_member: {
        kind: 'update', tableId: 'libra_workspace_cleanup_members',
        setColumns: [
          'state', 'state_revision', 'state_digest',
          'committed_scope_state_revision', 'deletion_effect_id',
          'outcome_evidence_schema_ref', 'outcome_evidence_id',
          'outcome_evidence_json', 'outcome_evidence_digest',
          'cleanup_receipt_id', 'updated_at_ms',
        ],
        keyColumns: ['cleanup_scope_id', 'material_handle_id'],
        compareColumns: [
          { column: 'state', parameter: 'expected_state' },
          { column: 'state_revision', parameter: 'expected_state_revision' },
          { column: 'state_digest', parameter: 'expected_state_digest' },
        ],
      },
      insert_reference: {
        kind: 'insert', tableId: 'libra_workspace_material_refs',
        columns: [
          'workspace_id', 'libra_run_id', 'reference_id',
          'material_handle_id', 'material_key', 'workspace_handle_schema_ref',
          'workspace_handle_json', 'workspace_handle_digest',
          'reference_revision', 'reference_state',
          'episode_claims_schema_ref', 'episode_claims_json',
          'episode_scope_digest', 'product_verification_schema_ref',
          'product_verification_id', 'product_verification_json',
          'product_verification_digest', 'previous_reference_revision',
          'committed_workspace_revision', 'reference_digest',
          'committed_at_ms',
        ],
      },
      insert_workspace_revision: {
        kind: 'insert', tableId: 'libra_workspace_revisions',
        columns: [
          'workspace_id', 'workspace_revision', 'state',
          'material_reference_set_digest', 'transition_kind',
          'transition_evidence_digest', 'previous_revision', 'revision_digest',
          'committed_at_ms',
        ],
      },
      update_workspace: {
        kind: 'update', tableId: 'libra_workspaces',
        setColumns: [
          'current_revision', 'state', 'state_digest', 'completed_at_ms',
        ],
        keyColumns: ['workspace_id'],
        compareColumns: [
          { column: 'current_revision', parameter: 'expected_revision' },
          { column: 'state_digest', parameter: 'expected_state_digest' },
          { column: 'state', parameter: 'expected_state' },
        ],
      },
    },
  });
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_workspace_cleanup_foundation',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      find_marker: {
        kind: 'select-one', tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'owner_domain', 'scope_type', 'scope_id',
          'commit_digest', 'result_id', 'result_schema_ref', 'result_digest',
        ],
        keyColumns: ['commit_marker'],
      },
      find_admission_marker: {
        kind: 'select-one', tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'owner_domain', 'scope_type', 'scope_id',
          'commit_digest', 'result_id', 'result_schema_ref', 'result_digest',
        ],
        keyColumns: ['owner_domain', 'scope_type', 'scope_id'],
      },
      find_result: {
        kind: 'select-one', tableId: 'fx_event_result_bindings',
        columns: ['result_id', 'result_json', 'result_digest'],
        keyColumns: ['result_id'],
      },
      insert_result: {
        kind: 'insert', tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
          'result_json', 'result_digest', 'evidence_schema_ref',
          'evidence_json', 'evidence_digest', 'effect_receipt_id',
          'committed_at_ms',
        ],
      },
      insert_marker: {
        kind: 'insert', tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'effect_id', 'owner_domain', 'scope_type',
          'scope_id', 'commit_digest', 'result_id', 'result_schema_ref',
          'result_digest', 'committed_at_ms',
        ],
      },
      find_registry: {
        kind: 'select-one', tableId: 'fx_workspace_registry',
        columns: [
          'workspace_id', 'owner_domain', 'process_type', 'process_id',
          'root_handle_ref', 'state', 'reclaim_after_ms',
        ],
        keyColumns: ['workspace_id'], safeIntegers: true,
      },
      reclaim_registry: {
        kind: 'update', tableId: 'fx_workspace_registry',
        setColumns: ['state', 'reclaimed_at_ms'],
        keyColumns: ['workspace_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }],
      },
      find_material: {
        kind: 'select-one', tableId: 'fx_workspace_materials',
        columns: [
          'workspace_id', 'material_handle_id', 'material_key',
          'handle_json', 'handle_digest', 'fence_digest', 'state',
          'reclaimed_effect_id', 'reclaimed_effect_receipt_digest',
        ],
        keyColumns: ['workspace_id', 'material_handle_id'],
      },
    },
  });
}

function controlDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_workspace_cleanup_control',
    owner: 'material-control-authority',
    readOnly: true,
    schemaManifest,
    statements: {
      find_current: {
        kind: 'select-one', tableId: 'fx_material_controls',
        columns: [
          'material_key', 'mount_scope_id', 'inode',
          'size_bytes', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint', 'owner_domain',
          'owner_scope_type', 'owner_scope_id', 'control_revision', 'state',
        ],
        keyColumns: ['material_key'], safeIntegers: true,
      },
    },
  });
}

function currentRows(rows) {
  const byReference = new Map();
  for (const row of rows) {
    const prior = byReference.get(row.reference_id);
    if (!prior || Number(row.reference_revision) >
        Number(prior.reference_revision)) {
      byReference.set(row.reference_id, row);
    }
  }
  return [...byReference.values()];
}

function referenceSnapshot(row) {
  return buildReferenceSnapshot({
    workspaceId: row.workspace_id,
    libraRunId: row.libra_run_id,
    workspaceMaterialHandle: JSON.parse(row.workspace_handle_json),
    referenceRevision: Number(row.reference_revision),
    state: row.reference_state,
    episodeClaims: JSON.parse(row.episode_claims_json),
    episodeScopeDigest: row.episode_scope_digest,
    productVerificationRef: row.product_verification_json === null
      ? null : JSON.parse(row.product_verification_json),
    previousReferenceRevision: row.previous_reference_revision === null
      ? null : Number(row.previous_reference_revision),
    committedWorkspaceRevision: Number(row.committed_workspace_revision),
  });
}

function mapMember(row) {
  return Object.freeze({
    cleanupScopeId: row.cleanup_scope_id,
    materialHandleId: row.material_handle_id,
    materialKey: row.material_key,
    workspaceReferenceId: row.workspace_reference_id,
    expectedReferenceRevision: Number(row.expected_reference_revision),
    expectedReferenceDigest: row.expected_reference_digest,
    controlDisposition: row.control_disposition,
    expectedControlRevision: Number(row.expected_control_revision),
    expectedControlProjectionDigest: row.expected_control_projection_digest,
    expectedControlOwnerDomain: row.expected_control_owner_domain,
    expectedControlOwnerScopeType: row.expected_control_owner_scope_type,
    expectedControlOwnerScopeId: row.expected_control_owner_scope_id,
    state: row.state,
    stateRevision: Number(row.state_revision),
    stateDigest: row.state_digest,
    committedScopeStateRevision:
      row.committed_scope_state_revision === null
        ? null : Number(row.committed_scope_state_revision),
  });
}

function replayResult(repo, marker, digest, schemaRef) {
  const found = repo.invoke('find_marker', { commit_marker: marker });
  if (!found) return null;
  if (found.owner_domain !== 'libra' ||
      found.commit_digest !== digest ||
      found.result_schema_ref !== schemaRef) {
    fail('P14_CLEANUP_MARKER_CONFLICT',
      'Cleanup marker belongs to another immutable commit.');
  }
  const stored = repo.invoke('find_result', { result_id: found.result_id });
  if (!stored || stored.result_digest !== found.result_digest) {
    fail('P14_CLEANUP_REPLAY_CORRUPT',
      'Cleanup result is absent or corrupt.');
  }
  const value = JSON.parse(stored.result_json);
  if (canonicalDigest(value) !== stored.result_digest) {
    fail('P14_CLEANUP_REPLAY_CORRUPT',
      'Cleanup result digest cannot be reconstructed.');
  }
  return value;
}

function assertAdmissionAudit(decision, snapshot, controls) {
  const actualObservation = buildObservation({
    workspaceId: snapshot.workspace.workspaceId,
    observedAtMs: decision.referenceAudit.observation2.observedAtMs,
    otherReferences: snapshot.otherReferences,
    controls,
  });
  if (canonicalJson(actualObservation) !==
      canonicalJson(decision.referenceAudit.observation2)) {
    fail('P14_CLEANUP_ADMISSION_AUDIT_STALE',
      'Second cleanup observation changed before admission.');
  }
  const actualMembers = snapshot.references.map((reference) => {
    const currentControl = controls.find((item) =>
      item.materialKey === reference.materialKey);
    if (!currentControl) {
      fail('P14_CLEANUP_ADMISSION_CONTROL_MISSING',
        'Admission recheck requires every current Control projection.');
    }
    return memberFromReference(reference, currentControl);
  }).sort((left, right) =>
    Buffer.compare(Buffer.from(left.materialHandleId),
      Buffer.from(right.materialHandleId)));
  if (canonicalJson(actualMembers) !== canonicalJson(decision.members)) {
    fail('P14_CLEANUP_ADMISSION_MEMBER_STALE',
      'Cleanup members changed after the second observation.');
  }
}

function createWorkspaceCleanupStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P14_CLEANUP_STORE_DEPENDENCIES',
      'Workspace cleanup requires clean owner persistence.');
  }
  const libra = libraDefinition(options.schemaManifest);
  const foundation = foundationDefinition(options.schemaManifest);
  const control = controlDefinition(options.schemaManifest);

  function readLibraSnapshot(repo, libraRunId) {
    const run = repo.invoke('find_run', { libra_run_id: libraRunId });
    if (!run) fail('P14_CLEANUP_RUN_MISSING', 'Libra Run is absent.');
    const all = repo.invoke('list_run_workspaces', {
      libra_run_id: libraRunId,
    }).filter((item) => ['active', 'reclaiming'].includes(item.state));
    if (all.length !== 1) {
      fail('P14_CLEANUP_WORKSPACE_ID_REQUIRED',
        'Cleanup requires the exact Run Workspace identity.');
    }
    const workspace = repo.invoke('find_workspace', {
      workspace_id: all[0].workspace_id,
    });
    if (!workspace || workspace.libra_run_id !== libraRunId) {
      fail('P14_CLEANUP_WORKSPACE_MISSING',
        'Exact Libra Run Workspace is absent.');
    }
    const revision = repo.invoke('find_workspace_revision', {
      workspace_id: workspace.workspace_id,
      workspace_revision: Number(workspace.current_revision),
    });
    const rows = currentRows(repo.invoke('list_workspace_references', {
      workspace_id: workspace.workspace_id,
    }));
    const references = rows.filter((row) =>
      row.reference_state !== 'released').map(referenceSnapshot);
    if (!revision ||
        referenceSetDigest(workspace.workspace_id, references) !==
          revision.material_reference_set_digest) {
      fail('P14_CLEANUP_REFERENCE_INTEGRITY',
        'Workspace Reference set cannot be reconstructed.');
    }
    const otherReferences = [];
    for (const reference of references) {
      const materialRows = currentRows(repo.invoke(
        'list_material_references',
        { material_key: reference.materialKey },
      ));
      for (const row of materialRows) {
        if (row.workspace_id !== workspace.workspace_id &&
            row.reference_state !== 'released') {
          otherReferences.push({
            workspaceId: row.workspace_id,
            referenceId: row.reference_id,
            referenceRevision: Number(row.reference_revision),
            referenceDigest: row.reference_digest,
          });
        }
      }
    }
    return {
      run: {
        libraRunId: run.libra_run_id,
        stateRevision: Number(run.state_revision),
        stateDigest: run.state_digest,
        executionBasisDigest: run.execution_basis_digest,
      },
      workspace: {
        workspaceId: workspace.workspace_id,
        workspaceRevision: Number(workspace.current_revision),
        workspaceStateDigest: workspace.state_digest,
        materialReferenceSetDigest: revision.material_reference_set_digest,
        state: workspace.state,
      },
      references,
      otherReferences,
    };
  }

  function readControls(repo, references) {
    return references.map((reference) => {
      const row = repo.invoke('find_current', {
        material_key: reference.materialKey,
      });
      return controlItem(reference.materialKey,
        projectMaterialControlRow(reference.materialKey, row));
    });
  }

  function inspect(libraRunId) {
    let snapshot;
    let controls;
    options.unitOfWork.execute([{
      participantId: 'cleanup_inspect_libra',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        snapshot = readLibraSnapshot(
          context.repository(libra.repositoryId), libraRunId);
      },
    }, {
      participantId: 'cleanup_inspect_control',
      owner: 'material-control-authority',
      boundBusinessOwner: 'libra',
      repositories: [control],
      execute(context) {
        controls = readControls(
          context.repository(control.repositoryId), snapshot.references);
      },
    }]);
    return Object.freeze({ ...snapshot, controls: Object.freeze(controls) });
  }

  function admit(request) {
    const decision = request.decision;
    const marker = request.commitMarker;
    const resultId = request.resultId;
    let result;
    const record = {
      ...Object.fromEntries(Object.entries(decision)
        .filter(([name]) => name !== 'members')),
      memberCount: decision.members.length,
      memberSetDigest: decision.memberSetDigest,
    };
    const initialTerminalDigest = canonicalDigest({
      schema: 'libra.workspace-cleanup-terminal-member-states@1',
      cleanupScopeId: decision.cleanupScopeId,
      scopeStateRevision: 1,
      items: [],
    });
    const initialScope = scopeState({
      cleanupScopeId: decision.cleanupScopeId,
      stateRevision: 1,
      state: 'active',
      memberSetDigest: decision.memberSetDigest,
      terminalMemberSetDigest: initialTerminalDigest,
      completedAtMs: null,
    });
    const nextWorkspaceRevision =
      decision.workspaceRef.workspaceRevision + 1;
    const nextWorkspace = {
      workspaceId: decision.workspaceRef.workspaceId,
      workspaceRevision: nextWorkspaceRevision,
      state: 'reclaiming',
      workspaceMaterialReferenceSetDigest:
        decision.workspaceRef.materialReferenceSetDigest,
      transitionKind: 'reclaiming',
      transitionEvidenceDigest: decision.decisionDigest,
    };
    nextWorkspace.stateDigest = workspaceStateDigest(nextWorkspace);
    let admissionSnapshot;
    let admissionControls;
    const participants = [{
      participantId: 'cleanup_admission_preflight',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        const replay = replayResult(
          context.repository(foundation.repositoryId),
          marker, decision.decisionDigest, ADMISSION_RESULT);
        if (replay) throw new Replay(replay);
      },
    }, {
      participantId: 'cleanup_admission_reference_audit',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        admissionSnapshot = readLibraSnapshot(
          context.repository(libra.repositoryId),
          decision.libraRunRef.libraRunId);
        if (canonicalJson(admissionSnapshot.run) !==
              canonicalJson(decision.libraRunRef) ||
            canonicalJson({
              workspaceId: admissionSnapshot.workspace.workspaceId,
              workspaceRevision:
                admissionSnapshot.workspace.workspaceRevision,
              workspaceStateDigest:
                admissionSnapshot.workspace.workspaceStateDigest,
              materialReferenceSetDigest:
                admissionSnapshot.workspace.materialReferenceSetDigest,
            }) !== canonicalJson(decision.workspaceRef)) {
          fail('P14_CLEANUP_ADMISSION_SNAPSHOT_STALE',
            'Cleanup Run or Workspace snapshot changed before admission.');
        }
      },
    }, {
      participantId: 'cleanup_admission_control_audit',
      owner: 'material-control-authority',
      boundBusinessOwner: 'libra',
      repositories: [control],
      execute(context) {
        admissionControls = readControls(
          context.repository(control.repositoryId),
          admissionSnapshot.references);
        assertAdmissionAudit(decision, admissionSnapshot, admissionControls);
      },
    }, {
      participantId: 'cleanup_admission_libra',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        const repo = context.repository(libra.repositoryId);
        const existing = repo.invoke('find_trigger_scope', {
          trigger_kind: decision.triggerKind,
          trigger_ref: decision.triggerSnapshot.offloadCompletionFact.factId,
          trigger_revision: decision.triggerSnapshot.projectionRevision,
          trigger_digest: decision.triggerSnapshot.projectionDigest,
        });
        if (existing) {
          fail('P14_CLEANUP_TRIGGER_CONFLICT',
            'Cleanup trigger was committed under another marker.');
        }
        const workspace = repo.invoke('find_workspace', {
          workspace_id: decision.workspaceRef.workspaceId,
        });
        if (!workspace || workspace.state !== 'active' ||
            Number(workspace.current_revision) !==
              decision.workspaceRef.workspaceRevision ||
            workspace.state_digest !==
              decision.workspaceRef.workspaceStateDigest) {
          fail('P14_CLEANUP_WORKSPACE_STALE',
            'Workspace admission fence is stale.');
        }
        repo.invoke('insert_scope', {
          cleanup_scope_id: decision.cleanupScopeId,
          libra_run_id: decision.libraRunRef.libraRunId,
          workspace_id: decision.workspaceRef.workspaceId,
          trigger_kind: decision.triggerKind,
          trigger_ref: decision.triggerSnapshot.offloadCompletionFact.factId,
          trigger_revision: decision.triggerSnapshot.projectionRevision,
          trigger_digest: decision.triggerSnapshot.projectionDigest,
          admission_record_schema_ref: ADMISSION_RECORD,
          admission_record_json: canonicalJson(record),
          admission_decision_digest: decision.decisionDigest,
          eligibility_evidence_digest: decision.eligibilityEvidenceDigest,
          member_set_digest: decision.memberSetDigest,
          state: 'active',
          state_revision: 1,
          state_digest: initialScope.stateDigest,
          created_at_ms: context.commitTimeMs,
          completed_at_ms: null,
        });
        for (const member of decision.members) {
          const stateDigest = memberState({
            cleanupScopeId: decision.cleanupScopeId,
            materialHandleId: member.materialHandleId,
            stateRevision: 1,
            state: 'pending',
          });
          repo.invoke('insert_member', {
            cleanup_scope_id: decision.cleanupScopeId,
            material_handle_id: member.materialHandleId,
            material_key: member.materialKey,
            workspace_reference_id: member.workspaceReferenceId,
            expected_reference_revision: member.expectedReferenceRevision,
            expected_reference_digest: member.expectedReferenceDigest,
            control_disposition: member.controlDisposition,
            expected_control_revision: member.expectedControlRevision,
            expected_control_projection_digest:
              member.expectedControlProjectionDigest,
            expected_control_owner_domain:
              member.expectedControlOwnerDomain,
            expected_control_owner_scope_type:
              member.expectedControlOwnerScopeType,
            expected_control_owner_scope_id:
              member.expectedControlOwnerScopeId,
            cleanup_kind: member.cleanupKind,
            state: 'pending',
            state_revision: 1,
            state_digest: stateDigest,
            committed_scope_state_revision: null,
            deletion_effect_id: null,
            outcome_evidence_schema_ref: null,
            outcome_evidence_id: null,
            outcome_evidence_json: null,
            outcome_evidence_digest: null,
            cleanup_receipt_id: null,
            updated_at_ms: context.commitTimeMs,
          });
        }
        const revision = {
          workspaceId: nextWorkspace.workspaceId,
          workspaceRevision: nextWorkspace.workspaceRevision,
          state: nextWorkspace.state,
          materialReferenceSetDigest:
            nextWorkspace.workspaceMaterialReferenceSetDigest,
          transitionKind: nextWorkspace.transitionKind,
          transitionEvidenceDigest:
            nextWorkspace.transitionEvidenceDigest,
          previousRevision: decision.workspaceRef.workspaceRevision,
        };
        revision.revisionDigest = canonicalDigest(revision);
        repo.invoke('insert_workspace_revision', {
          workspace_id: revision.workspaceId,
          workspace_revision: revision.workspaceRevision,
          state: revision.state,
          material_reference_set_digest:
            revision.materialReferenceSetDigest,
          transition_kind: revision.transitionKind,
          transition_evidence_digest:
            revision.transitionEvidenceDigest,
          previous_revision: revision.previousRevision,
          revision_digest: revision.revisionDigest,
          committed_at_ms: context.commitTimeMs,
        });
        if (repo.invoke('update_workspace', {
          current_revision: nextWorkspaceRevision,
          state: 'reclaiming',
          state_digest: nextWorkspace.stateDigest,
          completed_at_ms: null,
          workspace_id: workspace.workspace_id,
          expected_revision: decision.workspaceRef.workspaceRevision,
          expected_state_digest: decision.workspaceRef.workspaceStateDigest,
          expected_state: 'active',
        }).changes !== 1) {
          fail('P14_CLEANUP_WORKSPACE_CAS',
            'Workspace reclaiming CAS failed.');
        }
        result = {
          decisionId: decision.decisionId,
          resultKind: 'created',
          cleanupScopeId: decision.cleanupScopeId,
          scopeStateRevision: 1,
          scopeStateDigest: initialScope.stateDigest,
          memberSetDigest: decision.memberSetDigest,
          memberCount: decision.members.length,
          committedWorkspaceRevision: nextWorkspaceRevision,
          committedWorkspaceStateDigest: nextWorkspace.stateDigest,
        };
        result.resultDigest = canonicalDigest(result);
      },
    }, {
      participantId: 'cleanup_admission_foundation',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        const repo = context.repository(foundation.repositoryId);
        repo.invoke('insert_result', {
          result_id: resultId, event_id: null, outcome_kind: 'succeeded',
          result_schema_ref: ADMISSION_RESULT,
          result_json: canonicalJson(result),
          result_digest: canonicalDigest(result),
          evidence_schema_ref: ADMISSION_RECORD,
          evidence_json: canonicalJson(record),
          evidence_digest: decision.decisionDigest,
          effect_receipt_id: null,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_marker', {
          commit_marker: marker, effect_id: null, owner_domain: 'libra',
          scope_type: 'workspace_cleanup_scope',
          scope_id: decision.cleanupScopeId,
          commit_digest: decision.decisionDigest, result_id: resultId,
          result_schema_ref: ADMISSION_RESULT,
          result_digest: canonicalDigest(result),
          committed_at_ms: context.commitTimeMs,
        });
      },
    }];
    try {
      options.unitOfWork.execute(participants);
      return Object.freeze({ replayed: false, result });
    } catch (error) {
      if (error instanceof Replay) {
        return Object.freeze({ replayed: true, result: error.result });
      }
      throw error;
    }
  }

  function readScope(cleanupScopeId) {
    return options.unitOfWork.execute([{
      participantId: 'cleanup_scope_read',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        const repo = context.repository(libra.repositoryId);
        const scope = repo.invoke('find_scope', {
          cleanup_scope_id: cleanupScopeId,
        });
        if (!scope) return null;
        const members = repo.invoke('list_members', {
          cleanup_scope_id: cleanupScopeId,
        }).map(mapMember);
        return Object.freeze({
          cleanupScopeId: scope.cleanup_scope_id,
          libraRunId: scope.libra_run_id,
          workspaceId: scope.workspace_id,
          memberSetDigest: scope.member_set_digest,
          state: scope.state,
          stateRevision: Number(scope.state_revision),
          stateDigest: scope.state_digest,
          createdAtMs: Number(scope.created_at_ms),
          completedAtMs: scope.completed_at_ms === null
            ? null : Number(scope.completed_at_ms),
          members: Object.freeze(members),
        });
      },
    }]).cleanup_scope_read;
  }

  function readScopeByTrigger(triggerSnapshot) {
    const fact = triggerSnapshot?.offloadCompletionFact;
    if (!fact || triggerSnapshot.resultKind !== 'found') return null;
    const row = options.unitOfWork.execute([{
      participantId: 'cleanup_trigger_scope_read',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        return context.repository(libra.repositoryId)
          .invoke('find_trigger_scope', {
            trigger_kind: 'offload_completed',
            trigger_ref: fact.factId,
            trigger_revision: triggerSnapshot.projectionRevision,
            trigger_digest: triggerSnapshot.projectionDigest,
          });
      },
    }]).cleanup_trigger_scope_read;
    return row ? readScope(row.cleanup_scope_id) : null;
  }

  function readAdmissionResult(cleanupScopeId) {
    return options.unitOfWork.execute([{
      participantId: 'cleanup_admission_result_read',
      owner: 'execution-foundation',
      repositories: [foundation],
      execute(context) {
        const repo = context.repository(foundation.repositoryId);
        const marker = repo.invoke('find_admission_marker', {
          owner_domain: 'libra',
          scope_type: 'workspace_cleanup_scope',
          scope_id: cleanupScopeId,
        });
        if (!marker || marker.result_schema_ref !== ADMISSION_RESULT) {
          fail('P14_CLEANUP_ADMISSION_RESULT_MISSING',
            'Cleanup Scope has no exact admission marker.');
        }
        const row = repo.invoke('find_result', {
          result_id: marker.result_id,
        });
        const result = row && JSON.parse(row.result_json);
        if (!row || result.cleanupScopeId !== cleanupScopeId ||
            canonicalDigest(result) !== row.result_digest ||
            row.result_digest !== marker.result_digest) {
          fail('P14_CLEANUP_ADMISSION_RESULT_CORRUPT',
            'Cleanup admission Result cannot be reconstructed exactly.');
        }
        return Object.freeze(result);
      },
    }]).cleanup_admission_result_read;
  }

  function readHandle(workspaceId, materialHandleId) {
    return options.unitOfWork.execute([{
      participantId: 'cleanup_handle_read',
      owner: 'execution-foundation',
      repositories: [foundation],
      execute(context) {
        const row = context.repository(foundation.repositoryId)
          .invoke('find_material', {
            workspace_id: workspaceId,
            material_handle_id: materialHandleId,
          });
        if (!row) return null;
        const handle = JSON.parse(row.handle_json);
        if (canonicalDigest(handle) !== row.handle_digest) {
          fail('P14_CLEANUP_HANDLE_CORRUPT',
            'Workspace Handle digest drifted.');
        }
        return Object.freeze(handle);
      },
    }]).cleanup_handle_read;
  }

  function currentWorkspace(workspaceId) {
    return options.unitOfWork.execute([{
      participantId: 'cleanup_workspace_read',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        const row = context.repository(libra.repositoryId)
          .invoke('find_workspace', { workspace_id: workspaceId });
        return row && Object.freeze({
          workspaceId: row.workspace_id,
          currentRevision: Number(row.current_revision),
          state: row.state,
          stateDigest: row.state_digest,
        });
      },
    }]).cleanup_workspace_read;
  }

  function commit(request) {
    const decision = request.decision;
    const scope = readScope(decision.cleanupScopeId);
    const member = scope?.members.find((item) =>
      item.materialHandleId === decision.materialHandleId);
    const handle = readHandle(decision.workspaceId,
      decision.materialHandleId);
    if (!scope || !member || !handle ||
        scope.state !== 'active' || member.state !== 'pending' ||
        scope.stateRevision !== decision.expectedScopeStateRevision ||
        scope.stateDigest !== decision.expectedScopeStateDigest ||
        member.stateRevision !== decision.expectedMemberStateRevision ||
        member.stateDigest !== decision.expectedMemberStateDigest) {
      fail('P14_CLEANUP_COMMIT_STALE',
        'Cleanup Scope or member fence is stale.');
    }
    let releasedControlRevision = null;
    let releaseParticipant = null;
    if (member.controlDisposition === 'libra_owned') {
      const change = {
        identity: {
          materialKey: handle.materialKey,
          ...handle.physicalIdentity,
        },
        action: 'release',
        expectedRevision: member.expectedControlRevision,
        expectedProjectionDigest:
          member.expectedControlProjectionDigest,
        fromScope: {
          ownerDomain: member.expectedControlOwnerDomain,
          scopeType: member.expectedControlOwnerScopeType,
          scopeId: member.expectedControlOwnerScopeId,
        },
        toScope: null,
      };
      const controlScope = controlScopeDigest([change]);
      const handleValue = {
        schemaRef:
          'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
        schemaVersion: 1,
        handleId: canonicalDigest({
          schema: 'libra.workspace-cleanup-control-handle-id@1',
          cleanupScopeId: scope.cleanupScopeId,
          materialHandleId: member.materialHandleId,
          decisionDigest: decision.decisionDigest,
        }),
        ownerDomain: 'libra',
        processType: 'workspace_cleanup',
        processId: scope.cleanupScopeId,
        operationKind: 'release',
        basisRef: {
          objectType: 'workspace_cleanup_decision',
          objectId: decision.decisionId,
          revision: 1,
          digest: decision.decisionDigest,
        },
        basisDigest: decision.decisionDigest,
        canonicalFactSetDigest: decision.outcome.deletionEvidence.evidenceDigest,
        bindingSetDigest: member.expectedReferenceDigest,
        expectedControlRevisions: [{
          materialKey: member.materialKey,
          revision: member.expectedControlRevision,
        }],
        controlScopeDigest: controlScope,
        receiptContract: Object.freeze({
          receiptSchemaRef: 'helix://contracts/types/WorkspaceCleanupCommitReceipt/v1',
          controlRevisionSetSchemaRef: 'libra.workspace-cleanup-released-control-set@1',
        }),
        eventFenceDigest: decision.decisionDigest,
      };
      releaseParticipant = createMaterialControlParticipant({
        schemaManifest: options.schemaManifest,
        participantId: 'cleanup_control_release',
        handle: handleValue,
        changes: [change],
        authorizedScopeDigest: controlScope,
        commitMarker: request.commitMarker,
      });
    }
    let result;
    const participants = [{
      participantId: 'cleanup_commit_preflight',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        const replay = replayResult(
          context.repository(foundation.repositoryId),
          request.commitMarker, decision.decisionDigest, COMMIT_RESULT);
        if (replay) throw new Replay(replay);
        const material = context.repository(foundation.repositoryId)
          .invoke('find_material', {
            workspace_id: decision.workspaceId,
            material_handle_id: decision.materialHandleId,
          });
        if (!material || material.state !== 'reclaimed' ||
            material.reclaimed_effect_id !==
              decision.outcome.deletionEvidence.effectId ||
            material.reclaimed_effect_receipt_digest !==
              decision.outcome.deletionEvidence.evidenceDigest) {
          fail('P14_CLEANUP_EFFECT_NOT_COMMITTED',
            'Cleanup commit requires the exact terminal physical Evidence.');
        }
      },
    }];
    if (releaseParticipant) participants.push(releaseParticipant);
    participants.push({
      participantId: 'cleanup_commit_libra',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        const repo = context.repository(libra.repositoryId);
        const currentScope = repo.invoke('find_scope', {
          cleanup_scope_id: scope.cleanupScopeId,
        });
        const currentMember = repo.invoke('find_member', {
          cleanup_scope_id: scope.cleanupScopeId,
          material_handle_id: member.materialHandleId,
        });
        const workspace = repo.invoke('find_workspace', {
          workspace_id: scope.workspaceId,
        });
        if (!currentScope || !currentMember || !workspace ||
            currentScope.state !== 'active' ||
            Number(currentScope.state_revision) !== scope.stateRevision ||
            currentScope.state_digest !== scope.stateDigest ||
            currentMember.state !== 'pending' ||
            Number(currentMember.state_revision) !== member.stateRevision ||
            currentMember.state_digest !== member.stateDigest ||
            workspace.state !== 'reclaiming' ||
            Number(workspace.current_revision) !==
              decision.expectedWorkspaceRevision ||
            workspace.state_digest !==
              decision.expectedWorkspaceStateDigest) {
          fail('P14_CLEANUP_COMMIT_CAS',
            'Cleanup commit lost its current owner-row fence.');
        }
        releasedControlRevision = releaseParticipant
          ? member.expectedControlRevision + 1 : null;
        const receiptId = canonicalDigest({
          schema: 'libra.workspace-cleanup-receipt-id@1',
          decisionId: decision.decisionId,
        });
        const memberRevision = member.stateRevision + 1;
        const nextScopeRevision = scope.stateRevision + 1;
        const terminalMemberDigest = memberState({
          cleanupScopeId: scope.cleanupScopeId,
          materialHandleId: member.materialHandleId,
          stateRevision: memberRevision,
          state: 'completed',
          outcomeEvidenceDigest:
            decision.outcome.deletionEvidence.evidenceDigest,
          cleanupReceiptId: receiptId,
          committedControlRevision: releasedControlRevision,
        });
        if (repo.invoke('update_member', {
          state: 'completed',
          state_revision: memberRevision,
          state_digest: terminalMemberDigest,
          committed_scope_state_revision: nextScopeRevision,
          deletion_effect_id:
            decision.outcome.deletionEvidence.effectId,
          outcome_evidence_schema_ref: DELETION_EVIDENCE,
          outcome_evidence_id:
            decision.outcome.deletionEvidence.evidenceId,
          outcome_evidence_json:
            canonicalJson(decision.outcome.deletionEvidence),
          outcome_evidence_digest:
            decision.outcome.deletionEvidence.evidenceDigest,
          cleanup_receipt_id: receiptId,
          updated_at_ms: context.commitTimeMs,
          cleanup_scope_id: scope.cleanupScopeId,
          material_handle_id: member.materialHandleId,
          expected_state: 'pending',
          expected_state_revision: member.stateRevision,
          expected_state_digest: member.stateDigest,
        }).changes !== 1) {
          fail('P14_CLEANUP_MEMBER_CAS',
            'Cleanup member CAS failed.');
        }
        const references = currentRows(repo.invoke(
          'list_workspace_references',
          { workspace_id: scope.workspaceId },
        )).map(referenceSnapshot);
        const prior = references.find((item) =>
          item.referenceId === member.workspaceReferenceId);
        if (!prior || prior.state === 'released' ||
            prior.referenceRevision !== member.expectedReferenceRevision ||
            prior.referenceDigest !== member.expectedReferenceDigest) {
          fail('P14_CLEANUP_REFERENCE_STALE',
            'Cleanup Reference fence is stale.');
        }
        const nextWorkspaceRevision = Number(workspace.current_revision) + 1;
        const released = buildReferenceSnapshot({
          workspaceId: prior.workspaceId,
          libraRunId: prior.libraRunId,
          workspaceMaterialHandle: prior.workspaceMaterialHandle,
          referenceRevision: prior.referenceRevision + 1,
          state: 'released',
          episodeClaims: prior.episodeClaims,
          episodeScopeDigest: prior.episodeScopeDigest,
          productVerificationRef: prior.productVerificationRef,
          previousReferenceRevision: prior.referenceRevision,
          committedWorkspaceRevision: nextWorkspaceRevision,
        });
        const nextReferences = references.filter((item) =>
          item.referenceId !== prior.referenceId).concat(released);
        const setDigest = referenceSetDigest(scope.workspaceId,
          nextReferences);
        const remaining = scope.members.filter((item) =>
          item.materialHandleId !== member.materialHandleId &&
          item.state !== 'completed').length;
        const final = remaining === 0;
        const workspaceState = {
          workspaceId: scope.workspaceId,
          workspaceRevision: nextWorkspaceRevision,
          state: final ? 'reclaimed' : 'reclaiming',
          workspaceMaterialReferenceSetDigest: setDigest,
          transitionKind: final ? 'reclaimed' : 'reference_released',
          transitionEvidenceDigest: decision.decisionDigest,
        };
        workspaceState.stateDigest = workspaceStateDigest(workspaceState);
        repo.invoke('insert_reference', {
          workspace_id: released.workspaceId,
          libra_run_id: released.libraRunId,
          reference_id: released.referenceId,
          material_handle_id: released.materialHandleId,
          material_key: released.materialKey,
          workspace_handle_schema_ref:
            released.workspaceMaterialHandle.schemaRef,
          workspace_handle_json:
            canonicalJson(released.workspaceMaterialHandle),
          workspace_handle_digest: released.workspaceHandleDigest,
          reference_revision: released.referenceRevision,
          reference_state: released.state,
          episode_claims_schema_ref:
            'helix://contracts/application-types/LibraWorkspaceEpisodeClaims/v1',
          episode_claims_json: canonicalJson(released.episodeClaims),
          episode_scope_digest: released.episodeScopeDigest,
          product_verification_schema_ref:
            released.productVerificationRef
              ? 'helix://contracts/application-types/WorkspaceProductVerificationSnapshot/v1'
              : null,
          product_verification_id:
            released.productVerificationRef?.verificationId || null,
          product_verification_json:
            released.productVerificationRef
              ? canonicalJson(released.productVerificationRef) : null,
          product_verification_digest:
            released.productVerificationRef?.snapshotDigest || null,
          previous_reference_revision:
            released.previousReferenceRevision,
          committed_workspace_revision: nextWorkspaceRevision,
          reference_digest: released.referenceDigest,
          committed_at_ms: context.commitTimeMs,
        });
        const revision = {
          workspaceId: scope.workspaceId,
          workspaceRevision: nextWorkspaceRevision,
          state: workspaceState.state,
          materialReferenceSetDigest: setDigest,
          transitionKind: workspaceState.transitionKind,
          transitionEvidenceDigest: decision.decisionDigest,
          previousRevision: Number(workspace.current_revision),
        };
        revision.revisionDigest = canonicalDigest(revision);
        repo.invoke('insert_workspace_revision', {
          workspace_id: revision.workspaceId,
          workspace_revision: revision.workspaceRevision,
          state: revision.state,
          material_reference_set_digest:
            revision.materialReferenceSetDigest,
          transition_kind: revision.transitionKind,
          transition_evidence_digest:
            revision.transitionEvidenceDigest,
          previous_revision: revision.previousRevision,
          revision_digest: revision.revisionDigest,
          committed_at_ms: context.commitTimeMs,
        });
        if (repo.invoke('update_workspace', {
          current_revision: nextWorkspaceRevision,
          state: workspaceState.state,
          state_digest: workspaceState.stateDigest,
          completed_at_ms: final ? context.commitTimeMs : null,
          workspace_id: scope.workspaceId,
          expected_revision: Number(workspace.current_revision),
          expected_state_digest: workspace.state_digest,
          expected_state: 'reclaiming',
        }).changes !== 1) {
          fail('P14_CLEANUP_WORKSPACE_CAS',
            'Workspace terminal revision CAS failed.');
        }
        const terminalRows = scope.members.filter((item) =>
          item.materialHandleId !== member.materialHandleId &&
          item.state === 'completed').map((item) => ({
          committedScopeStateRevision: item.committedScopeStateRevision,
          stateRevision: item.stateRevision,
          state: item.state,
          stateDigest: item.stateDigest,
        })).concat([{
          committedScopeStateRevision: nextScopeRevision,
          stateRevision: memberRevision,
          state: 'completed',
          stateDigest: terminalMemberDigest,
        }]).sort((left, right) =>
          left.committedScopeStateRevision -
          right.committedScopeStateRevision);
        const terminalMemberSetDigest = canonicalDigest({
          schema: 'libra.workspace-cleanup-terminal-member-states@1',
          cleanupScopeId: scope.cleanupScopeId,
          scopeStateRevision: nextScopeRevision,
          items: terminalRows,
        });
        const nextScope = scopeState({
          cleanupScopeId: scope.cleanupScopeId,
          stateRevision: nextScopeRevision,
          state: final ? 'completed' : 'active',
          memberSetDigest: scope.memberSetDigest,
          terminalMemberSetDigest,
          completedAtMs: final ? context.commitTimeMs : null,
        });
        if (repo.invoke('update_scope', {
          state: nextScope.state,
          state_revision: nextScopeRevision,
          state_digest: nextScope.stateDigest,
          completed_at_ms: final ? context.commitTimeMs : null,
          cleanup_scope_id: scope.cleanupScopeId,
          expected_state_revision: scope.stateRevision,
          expected_state_digest: scope.stateDigest,
          expected_state: 'active',
        }).changes !== 1) {
          fail('P14_CLEANUP_SCOPE_CAS',
            'Cleanup Scope CAS failed.');
        }
        result = {
          schemaRef: COMMIT_RESULT,
          schemaVersion: 1,
          receiptId,
          receiptKind: 'workspace_cleanup_committed',
          ownerDomain: 'libra',
          scopeType: 'workspace_cleanup_scope',
          scopeId: scope.cleanupScopeId,
          scopeDigest: decision.decisionDigest,
          effectReceiptRef:
            decision.outcome.deletionEvidence.effectReceiptId,
          committedAtMs: context.commitTimeMs,
          cleanupScopeId: scope.cleanupScopeId,
          materialHandleId: member.materialHandleId,
          deletionEvidenceDigest:
            decision.outcome.deletionEvidence.evidenceDigest,
          releasedControlRevision,
          cleanupState: 'completed',
        };
        result.receiptDigest = canonicalDigest(result);
      },
    }, {
      participantId: 'cleanup_commit_foundation',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        const repo = context.repository(foundation.repositoryId);
        if (scope.members.length === 1 ||
            scope.members.filter((item) => item.state === 'completed').length ===
              scope.members.length - 1) {
          const registry = repo.invoke('find_registry', {
            workspace_id: scope.workspaceId,
          });
          if (!registry || registry.state !== 'active' ||
              registry.owner_domain !== 'libra' ||
              repo.invoke('reclaim_registry', {
                state: 'reclaimed',
                reclaimed_at_ms: context.commitTimeMs,
                workspace_id: scope.workspaceId,
                expected_state: 'active',
              }).changes !== 1) {
            fail('P14_CLEANUP_REGISTRY_CAS',
              'Foundation Workspace Registry reclaim CAS failed.');
          }
        }
        repo.invoke('insert_result', {
          result_id: request.resultId, event_id: null,
          outcome_kind: 'succeeded', result_schema_ref: COMMIT_RESULT,
          result_json: canonicalJson(result),
          result_digest: canonicalDigest(result),
          evidence_schema_ref:
            'helix://contracts/domain-types/WorkspaceCleanupCommitDecision/v1',
          evidence_json: canonicalJson(decision),
          evidence_digest: decision.decisionDigest,
          effect_receipt_id:
            decision.outcome.deletionEvidence.effectReceiptId,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_marker', {
          commit_marker: request.commitMarker,
          effect_id: decision.outcome.deletionEvidence.effectId,
          owner_domain: 'libra',
          scope_type: 'workspace_cleanup_member',
          scope_id: member.materialHandleId,
          commit_digest: decision.decisionDigest,
          result_id: request.resultId,
          result_schema_ref: COMMIT_RESULT,
          result_digest: canonicalDigest(result),
          committed_at_ms: context.commitTimeMs,
        });
      },
    });
    try {
      options.unitOfWork.execute(participants);
      return Object.freeze({ replayed: false, result });
    } catch (error) {
      if (error instanceof Replay) {
        return Object.freeze({ replayed: true, result: error.result });
      }
      throw error;
    }
  }

  return Object.freeze({
    admit,
    commit,
    currentWorkspace,
    inspect,
    readHandle,
    readAdmissionResult,
    readScope,
    readScopeByTrigger,
  });
}

module.exports = Object.freeze({
  assertAdmissionAudit,
  WorkspaceCleanupStoreError,
  createWorkspaceCleanupStore,
});
