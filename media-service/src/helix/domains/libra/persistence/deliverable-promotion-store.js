'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  createMaterialControlParticipant,
} = require('../../../foundation/persistence/material-control');
const {
  assertPromotionDecision,
  buildPromotionCommit,
} = require('../model/delivery-lifecycle-contracts');

const TRANSACTION_ID = 'helix.transaction.libra-deliverable-promotion';
const RESULT_SCHEMA = 'helix://contracts/types/OnDeckProductPackageCommitReceipt/v1';

class DeliverablePromotionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DeliverablePromotionStoreError';
    this.code = code;
    this.details = details;
  }
}

class Replay extends Error {
  constructor(result) {
    super('Deliverable promotion replay');
    this.result = result;
  }
}

function fail(code, message, details) {
  throw new DeliverablePromotionStoreError(code, message, details);
}

function number(value) {
  return Number(value);
}

function parse(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    fail(code, 'Stored immutable JSON is corrupt.');
  }
}

function utf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_deliverable_promotion',
    owner: 'libra',
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'subject_id', 'acceptance_spec_id', 'run_material_manifest_id',
          'execution_basis_record_json', 'execution_basis_digest', 'run_scope_digest', 'state', 'state_revision',
          'state_digest', 'package_revision_head',
        ],
        keyColumns: ['libra_run_id'],
        safeIntegers: true,
      },
      cas_run_package_head: {
        kind: 'update',
        tableId: 'libra_runs',
        setColumns: ['package_revision_head'],
        keyColumns: ['libra_run_id'],
        compareColumns: [{ column: 'package_revision_head', parameter: 'expected_package_revision_head' }],
      },
      find_run_revision: {
        kind: 'select-one',
        tableId: 'libra_run_revisions',
        columns: [
          'libra_run_id', 'state_revision', 'state', 'acceptance_spec_id',
          'execution_basis_digest', 'run_scope_digest', 'revision_digest',
        ],
        keyColumns: ['libra_run_id', 'state_revision'],
        safeIntegers: true,
      },
      find_spec: {
        kind: 'select-one',
        tableId: 'libra_acceptance_specs',
        columns: [
          'acceptance_spec_id', 'subject_id', 'shelf_id', 'spec_revision',
          'spec_json', 'spec_digest', 'record_digest',
        ],
        keyColumns: ['acceptance_spec_id'],
        safeIntegers: true,
      },
      find_run_manifest: {
        kind: 'select-one',
        tableId: 'libra_run_material_manifests',
        columns: [
          'run_material_manifest_id', 'libra_run_id', 'manifest_role', 'manifest_revision',
          'member_count', 'member_set_digest', 'episode_scope_digest', 'manifest_digest',
        ],
        keyColumns: ['run_material_manifest_id'],
        safeIntegers: true,
      },
      find_workspace: {
        kind: 'select-one',
        tableId: 'libra_workspaces',
        columns: ['workspace_id', 'libra_run_id', 'current_revision', 'state', 'state_digest'],
        keyColumns: ['workspace_id'],
        safeIntegers: true,
      },
      find_workspace_revision: {
        kind: 'select-one',
        tableId: 'libra_workspace_revisions',
        columns: ['workspace_id', 'workspace_revision', 'state', 'revision_digest'],
        keyColumns: ['workspace_id', 'workspace_revision'],
        safeIntegers: true,
      },
      find_workspace_ref: {
        kind: 'select-one',
        tableId: 'libra_workspace_material_refs',
        columns: [
          'workspace_id', 'libra_run_id', 'reference_id', 'material_handle_id',
          'material_key', 'workspace_handle_json', 'workspace_handle_digest',
          'reference_revision', 'reference_state', 'episode_claims_json',
          'episode_scope_digest', 'product_verification_json',
          'product_verification_digest', 'previous_reference_revision',
          'committed_workspace_revision', 'reference_digest',
        ],
        keyColumns: ['workspace_id', 'reference_id', 'reference_revision'],
        safeIntegers: true,
      },
      list_bindings: {
        kind:'select-all', tableId:'libra_material_bindings', safeIntegers:true,
        columns:['subject_id','material_key','role','authority_kind','primary_material_key','association_evidence_digest',
          'disposition_basis_digest','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint',
          'size_bytes','endpoint_id','location','binding_revision','health_state','evidence_digest','current'],
        keyColumns:['subject_id'],
      },
      find_fact: {
        kind: 'select-one',
        tableId: 'libra_product_fact_revisions',
        columns: [
          'product_fact_id', 'libra_run_id', 'fact_kind', 'fact_revision',
          'schema_ref', 'fact_json', 'fact_digest', 'evidence_digest',
        ],
        keyColumns: ['product_fact_id', 'fact_revision'],
        safeIntegers: true,
      },
      find_package: {
        kind: 'select-one',
        tableId: 'libra_product_packages',
        columns: ['on_deck_package_id', 'package_digest', 'promotion_decision_digest'],
        keyColumns: ['on_deck_package_id'],
      },
      insert_package: {
        kind: 'insert',
        tableId: 'libra_product_packages',
        columns: [
          'on_deck_package_id', 'offer_id', 'package_revision', 'libra_run_id',
          'run_state_revision', 'run_state_digest', 'subject_id', 'shelf_id',
          'acceptance_spec_id', 'acceptance_spec_record_digest',
          'resolved_identity_fact_id', 'resolved_identity_revision', 'resolved_identity_digest',
          'product_structure_schema_ref', 'product_structure_json', 'product_structure_digest',
          'run_material_manifest_id', 'run_material_manifest_digest',
          'product_material_manifest_id', 'product_material_manifest_digest',
          'product_fact_manifest_id', 'product_fact_set_digest', 'product_fact_manifest_digest',
          'artifact_manifest_id', 'artifact_manifest_digest',
          'media_cast_fact_id', 'media_cast_fact_digest',
          'offload_context_manifest_id', 'offload_context_digest',
          'related_disposition_set_digest',
          'production_provenance_schema_ref', 'production_provenance_json',
          'production_provenance_digest', 'attestation_schema_ref', 'attestation_json',
          'attestation_digest', 'promotion_decision_digest', 'package_digest',
          'state', 'published_at_ms',
        ],
      },
      insert_material: {
        kind: 'insert',
        tableId: 'libra_product_package_materials',
        columns: [
          'on_deck_package_id', 'ordinal', 'material_handle_id', 'material_key', 'role',
          'source_related_reference_id', 'derived_authority_digest',
          'mount_scope_id', 'inode', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
          'location_kind', 'endpoint_id', 'location', 'root_handle_ref', 'relative_path',
          'binding_kind', 'binding_revision', 'binding_evidence_digest',
          'origin_intake_decision_id', 'origin_offer_id', 'origin_candidate_package_id',
          'origin_package_revision', 'origin_package_digest',
          'origin_candidate_delivery_snapshot_digest', 'origin_related_reference_set_digest',
          'workspace_reference_id', 'workspace_handle_schema_ref', 'workspace_handle_json',
          'workspace_handle_digest', 'output_requirement_digest', 'episode_claim_set_digest',
          'digest_algorithm', 'digest_hex', 'size_bytes', 'control_operation',
          'expected_control_revision', 'expected_control_projection_digest',
          'committed_control_revision', 'committed_control_projection_digest', 'member_digest',
        ],
      },
      insert_episode_claim: {
        kind: 'insert',
        tableId: 'libra_product_package_material_episode_claims',
        columns: [
          'on_deck_package_id', 'member_ordinal', 'episode_key',
          'season_claim_digest', 'claim_digest',
        ],
      },
      insert_fact_ref: {
        kind: 'insert',
        tableId: 'libra_product_package_fact_refs',
        columns: [
          'on_deck_package_id', 'ordinal', 'product_fact_id', 'fact_kind',
          'fact_revision', 'schema_ref', 'fact_digest', 'evidence_digest',
          'reference_digest',
        ],
      },
      insert_artifact_ref: {
        kind: 'insert',
        tableId: 'libra_product_package_artifact_refs',
        columns: [
          'on_deck_package_id', 'ordinal', 'artifact_handle_id', 'artifact_kind',
          'artifact_revision', 'artifact_digest', 'requirement_digest',
          'materialization_state', 'reference_digest',
        ],
      },
      insert_offload: {
        kind: 'insert',
        tableId: 'libra_offload_context_materials',
        columns: [
          'on_deck_package_id', 'ordinal', 'material_key', 'context_role',
          'source_related_reference_id', 'final_product_material_key', 'disposition_kind',
          'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
          'endpoint_id', 'location', 'binding_revision', 'binding_evidence_digest',
          'admitted_control_revision', 'admitted_control_projection_digest',
          'derived_authority_digest',
          'settlement_expectation', 'context_member_digest',
        ],
      },
    },
  });
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_deliverable_promotion_foundation',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      find_marker: {
        kind: 'select-one',
        tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest',
          'result_id', 'result_schema_ref', 'result_digest',
        ],
        keyColumns: ['commit_marker'],
      },
      find_result: {
        kind: 'select-one',
        tableId: 'fx_event_result_bindings',
        columns: ['result_id', 'result_json', 'result_digest'],
        keyColumns: ['result_id'],
      },
      find_artifact: {
        kind: 'select-one',
        tableId: 'fx_artifact_registry',
        columns: [
          'artifact_handle_id', 'artifact_kind', 'owner_domain', 'owner_scope_type',
          'owner_scope_id', 'digest_algorithm', 'digest_hex', 'size_bytes',
          'reference_revision', 'state',
        ],
        keyColumns: ['artifact_handle_id'],
        safeIntegers: true,
      },
      insert_result: {
        kind: 'insert',
        tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
          'result_json', 'result_digest', 'evidence_schema_ref', 'evidence_json',
          'evidence_digest', 'effect_receipt_id', 'committed_at_ms',
        ],
      },
      insert_marker: {
        kind: 'insert',
        tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id',
          'commit_digest', 'result_id', 'result_schema_ref', 'result_digest',
          'committed_at_ms',
        ],
      },
      insert_outbox: {
        kind: 'insert',
        tableId: 'fx_outbox',
        columns: [
          'message_id', 'producer_domain', 'message_kind', 'aggregate_type',
          'aggregate_id', 'aggregate_revision', 'dedup_key', 'consumer_set_digest',
          'intended_consumer_count', 'payload_schema_ref', 'payload_json',
          'payload_digest', 'state', 'available_at_ms', 'created_at_ms', 'all_acked_at_ms',
        ],
      },
      insert_outbox_delivery: {
        kind: 'insert',
        tableId: 'fx_outbox_deliveries',
        columns: [
          'message_id', 'consumer_domain', 'state', 'attempt_count',
          'next_attempt_at_ms', 'acked_at_ms',
        ],
      },
    },
  });
}

function assertReplay(repo, marker, decision) {
  const row = repo.invoke('find_marker', { commit_marker: marker });
  if (!row) return;
  if (row.owner_domain !== 'libra' || row.scope_type !== 'on_deck_package' ||
      row.scope_id !== decision.onDeckPackageId || row.commit_digest !== decision.decisionDigest ||
      row.result_schema_ref !== RESULT_SCHEMA) {
    fail('P9_PROMOTION_REPLAY_CONFLICT', 'Commit marker already binds another Promotion.');
  }
  const result = repo.invoke('find_result', { result_id: row.result_id });
  if (!result || result.result_digest !== row.result_digest ||
      canonicalDigest(parse(result.result_json, 'P9_PROMOTION_RESULT_CORRUPT')) !== result.result_digest) {
    fail('P9_PROMOTION_REPLAY_CORRUPT', 'Promotion replay Result is missing or corrupt.');
  }
  throw new Replay(Object.freeze({
    replayed: true,
    receipt: parse(result.result_json, 'P9_PROMOTION_RESULT_CORRUPT'),
  }));
}

function assertLibraSnapshot(repo, decision) {
  const run = repo.invoke('find_run', { libra_run_id: decision.libraRunRef.libraRunId });
  if (!run || run.state !== 'active' ||
      number(run.state_revision) !== decision.libraRunRef.stateRevision ||
      run.state_digest !== decision.libraRunRef.stateDigest ||
      run.execution_basis_digest !== decision.libraRunRef.executionBasisDigest ||
      run.run_scope_digest !== decision.libraRunRef.runScopeDigest ||
      number(run.package_revision_head) !== decision.libraRunRef.expectedPackageRevisionHead ||
      decision.packageRevision !== number(run.package_revision_head) + 1 ||
      run.acceptance_spec_id !== decision.acceptanceSpecRef.acceptanceSpecId) {
    fail('P9_PROMOTION_RUN_STALE', 'Active Libra Run fence differs from the Promotion Decision.');
  }
  const revision = repo.invoke('find_run_revision', {
    libra_run_id: run.libra_run_id,
    state_revision: decision.libraRunRef.stateRevision,
  });
  if (!revision || revision.state !== 'active' ||
      revision.execution_basis_digest !== run.execution_basis_digest ||
      revision.run_scope_digest !== run.run_scope_digest) {
    fail('P9_PROMOTION_RUN_HISTORY', 'Immutable Run revision cannot prove the Promotion fence.');
  }
  const spec = repo.invoke('find_spec', {
    acceptance_spec_id: decision.acceptanceSpecRef.acceptanceSpecId,
  });
  if (!spec || spec.subject_id !== run.subject_id ||
      spec.record_digest !== decision.acceptanceSpecRef.recordDigest) {
    fail('P9_PROMOTION_SPEC_STALE', 'Acceptance Spec differs from the Promotion Decision.');
  }
  const runManifest = repo.invoke('find_run_manifest', {
    run_material_manifest_id: decision.runMaterialManifestRef.manifestId,
  });
  if (!runManifest || runManifest.libra_run_id !== run.libra_run_id ||
      runManifest.manifest_digest !== decision.runMaterialManifestRef.manifestDigest) {
    fail('P9_PROMOTION_RUN_MANIFEST', 'Run Material Manifest continuity is invalid.');
  }
  const basis=parse(run.execution_basis_record_json,'P9_PROMOTION_RUN_BASIS_CORRUPT');
  if(basis.executionBasisDigest!==run.execution_basis_digest||!basis.relatedDispositionScope||
      canonicalJson(basis.relatedDispositionScope.items)!==canonicalJson(decision.relatedAuthorityAssertions.map((item)=>({
        referenceId:item.sourceRelatedReferenceId,primaryMaterialKey:item.primaryMaterialKey,role:item.role,
        materialKey:item.sourceMaterialKey,associationEvidenceDigest:item.associationEvidenceDigest,
        dispositionBasisDigest:item.dispositionBasisDigest})))){
    fail('P9_PROMOTION_RELATED_BASIS','Promotion Related assertions do not cover the frozen Run Basis.');
  }
  const bindingRows=repo.invoke('list_bindings',{subject_id:run.subject_id})
    .filter((row)=>Number(row.current)===1&&row.health_state==='active'&&row.authority_kind==='related_derived');
  if(bindingRows.length!==decision.relatedAuthorityAssertions.length)fail('P9_PROMOTION_RELATED_BINDING','Related Binding count changed.');
  for(const assertion of decision.relatedAuthorityAssertions){
    const row=bindingRows.find((candidate)=>candidate.material_key===assertion.sourceMaterialKey&&
      candidate.primary_material_key===assertion.primaryMaterialKey&&candidate.role===assertion.role);
    const derived=row&&canonicalDigest({schema:'libra.related-derived-authority@1',subjectId:run.subject_id,
      sourceRelatedReferenceId:assertion.sourceRelatedReferenceId,primaryMaterialKey:assertion.primaryMaterialKey,
      role:assertion.role,sourceMaterialKey:assertion.sourceMaterialKey,
      associationEvidenceDigest:row.association_evidence_digest,dispositionBasisDigest:row.disposition_basis_digest,
      bindingRevision:Number(row.binding_revision),bindingEvidenceDigest:row.evidence_digest});
    if(!row||row.association_evidence_digest!==assertion.associationEvidenceDigest||
      row.disposition_basis_digest!==assertion.dispositionBasisDigest||Number(row.binding_revision)!==assertion.bindingRevision||
      row.evidence_digest!==assertion.bindingEvidenceDigest||derived!==assertion.derivedAuthorityDigest)
      fail('P9_PROMOTION_RELATED_BINDING','Related assertion differs from the immutable Libra Binding.');
  }
  if (decision.workspaceRef === null) {
    if (decision.productStagingReferences.length !== 0) {
      fail('P9_PROMOTION_WORKSPACE_SCOPE', 'Direct-original Promotion cannot carry staging references.');
    }
  } else {
    const workspace = repo.invoke('find_workspace', {
      workspace_id: decision.workspaceRef.workspaceId,
    });
    const workspaceRevision = workspace && repo.invoke('find_workspace_revision', {
      workspace_id: workspace.workspace_id,
      workspace_revision: decision.workspaceRef.workspaceRevision,
    });
    if (!workspace || workspace.libra_run_id !== run.libra_run_id ||
        workspace.state !== 'active' ||
        number(workspace.current_revision) !== decision.workspaceRef.workspaceRevision ||
        workspace.state_digest !== decision.workspaceRef.workspaceStateDigest ||
        !workspaceRevision || workspaceRevision.state !== 'active') {
      fail('P9_PROMOTION_WORKSPACE_STALE', 'Workspace revision differs from the Promotion Decision.');
    }
    for (const ref of decision.productStagingReferences) {
      const row = repo.invoke('find_workspace_ref', {
        workspace_id: ref.workspaceId,
        reference_id: ref.referenceId,
        reference_revision: ref.referenceRevision,
      });
      if (!row || row.libra_run_id !== run.libra_run_id ||
          row.material_handle_id !== ref.materialHandleId ||
          row.material_key !== ref.materialKey ||
          row.workspace_handle_digest !== ref.workspaceHandleDigest ||
          row.reference_state !== 'product_staging' ||
          number(row.reference_revision) !== ref.referenceRevision ||
          row.episode_scope_digest !== ref.episodeScopeDigest ||
          row.product_verification_digest !== ref.productVerificationRef.snapshotDigest ||
          number(row.committed_workspace_revision) !== ref.committedWorkspaceRevision ||
          row.reference_digest !== ref.referenceDigest ||
          canonicalJson(parse(row.workspace_handle_json, 'P9_PROMOTION_WORKSPACE_HANDLE_CORRUPT')) !==
            canonicalJson(ref.workspaceMaterialHandle) ||
          canonicalJson(parse(row.episode_claims_json, 'P9_PROMOTION_EPISODE_CLAIMS_CORRUPT')) !==
            canonicalJson(ref.episodeClaims) ||
          canonicalJson(parse(row.product_verification_json, 'P9_PROMOTION_VERIFICATION_CORRUPT')) !==
            canonicalJson(ref.productVerificationRef)) {
        fail('P9_PROMOTION_STAGING_STALE', 'Product Staging Reference differs from its immutable row.', {
          referenceId: ref.referenceId,
        });
      }
    }
  }
  for (const item of decision.productFactManifest.items) {
    const row = repo.invoke('find_fact', {
      product_fact_id: item.productFactId,
      fact_revision: item.factRevision,
    });
    if (!row || row.libra_run_id !== run.libra_run_id || row.fact_kind !== item.factKind ||
        row.schema_ref !== item.schemaRef || row.fact_digest !== item.factDigest ||
        row.evidence_digest !== item.evidenceDigest ||
        canonicalJson(parse(row.fact_json, 'P9_PROMOTION_FACT_CORRUPT')) !== canonicalJson(item.factValue)) {
      fail('P9_PROMOTION_FACT_STALE', 'Product Fact differs from the immutable Package input.', {
        productFactId: item.productFactId,
      });
    }
  }
  return Object.freeze({ run, spec });
}

function assertArtifacts(repo, decision) {
  for (const item of decision.artifactManifest.items) {
    const row = repo.invoke('find_artifact', { artifact_handle_id: item.artifactHandleId });
    if (!row || row.owner_domain !== 'libra' || row.state !== 'active' ||
        row.artifact_kind !== item.artifactKind ||
        number(row.reference_revision) !== item.artifactRevision ||
        row.digest_hex !== item.artifactDigest) {
      fail('P9_PROMOTION_ARTIFACT_STALE', 'Artifact Manifest differs from the active immutable Artifact.', {
        artifactHandleId: item.artifactHandleId,
      });
    }
  }
}

function materialRow(packageId, member) {
  const origin = member.originCandidateDeliveryRef;
  const workspace = member.workspaceMaterialHandle;
  return {
    on_deck_package_id: packageId,
    ordinal: member.ordinal,
    material_handle_id: workspace?.handleId || member.physicalIdentity.materialKey,
    material_key: member.materialKey,
    role: member.role,
    source_related_reference_id: member.sourceRelatedReferenceId ?? null,
    derived_authority_digest: member.derivedAuthorityDigest ?? null,
    mount_scope_id: member.physicalIdentity.mountScopeId,
    inode: member.physicalIdentity.inode,
    fingerprint_algorithm: member.physicalIdentity.fingerprintAlgorithm,
    fingerprint_version: member.physicalIdentity.fingerprintVersion,
    content_fingerprint: member.physicalIdentity.contentFingerprint,
    location_kind: member.location.locationKind,
    endpoint_id: member.location.endpointId,
    location: member.location.location,
    root_handle_ref: member.location.rootHandleRef,
    relative_path: member.location.relativePath,
    binding_kind: member.bindingKind,
    binding_revision: member.bindingRevision,
    binding_evidence_digest: member.bindingEvidenceDigest,
    origin_intake_decision_id: origin?.intakeDecisionId || null,
    origin_offer_id: origin?.offerId || null,
    origin_candidate_package_id: origin?.candidatePackageId || null,
    origin_package_revision: origin?.packageRevision || null,
    origin_package_digest: origin?.packageDigest || null,
    origin_candidate_delivery_snapshot_digest: origin?.candidateDeliverySnapshotDigest || null,
    origin_related_reference_set_digest: origin?.relatedReferenceSetDigest || null,
    workspace_reference_id: member.workspaceReferenceId,
    workspace_handle_schema_ref: workspace?.schemaRef || null,
    workspace_handle_json: workspace ? canonicalJson(workspace) : null,
    workspace_handle_digest: workspace ? canonicalDigest(workspace) : null,
    output_requirement_digest: member.outputRequirementDigest,
    episode_claim_set_digest: member.episodeClaimSetDigest,
    digest_algorithm: workspace?.digestAlgorithm || member.physicalIdentity.fingerprintAlgorithm,
    digest_hex: workspace?.digestHex || member.physicalIdentity.contentFingerprint,
    size_bytes: member.sizeBytes,
    control_operation: member.controlOperation,
    expected_control_revision: member.expectedControlRevision ?? null,
    expected_control_projection_digest: member.expectedControlProjectionDigest ?? null,
    committed_control_revision: member.committedControlRevision ?? null,
    committed_control_projection_digest: member.committedControlProjectionDigest ?? null,
    member_digest: member.memberDigest,
  };
}

function writePackage(repo, commit, decision, snapshot) {
  const value = commit.package;
  repo.invoke('insert_package', {
    on_deck_package_id: value.onDeckPackageId,
    offer_id: decision.offerId,
    package_revision: value.packageRevision,
    libra_run_id: value.libraRunId,
    run_state_revision: value.runStateRevision,
    run_state_digest: value.runStateDigest,
    subject_id: value.subjectId,
    shelf_id: value.shelfId,
    acceptance_spec_id: value.acceptanceSpecRef.id,
    acceptance_spec_record_digest: value.acceptanceSpecRef.recordDigest,
    resolved_identity_fact_id: decision.resolvedIdentitySnapshot.productFactId,
    resolved_identity_revision: decision.resolvedIdentitySnapshot.factRevision,
    resolved_identity_digest: decision.resolvedIdentitySnapshot.factDigest,
    product_structure_schema_ref: 'libra.product-structure-snapshot@1',
    product_structure_json: canonicalJson(decision.productStructureSnapshot),
    product_structure_digest: decision.productStructureSnapshot.productStructureDigest,
    run_material_manifest_id: decision.runMaterialManifestRef.manifestId,
    run_material_manifest_digest: decision.runMaterialManifestRef.manifestDigest,
    product_material_manifest_id: decision.productMaterialManifest.manifestId,
    product_material_manifest_digest: decision.productMaterialManifest.manifestDigest,
    product_fact_manifest_id: decision.productFactManifest.manifestId,
    product_fact_set_digest: decision.productFactManifest.factSetDigest,
    product_fact_manifest_digest: decision.productFactManifest.manifestDigest,
    artifact_manifest_id: decision.artifactManifest.manifestId,
    artifact_manifest_digest: decision.artifactManifest.manifestDigest,
    media_cast_fact_id: decision.mediaCastSnapshot.mediaCastFactId,
    media_cast_fact_digest: decision.mediaCastSnapshot.factDigest,
    offload_context_manifest_id: decision.offloadContextManifest.manifestId,
    offload_context_digest: decision.offloadContextManifest.manifestDigest,
    related_disposition_set_digest: decision.relatedDispositionSetDigest,
    production_provenance_schema_ref: 'libra.production-provenance@1',
    production_provenance_json: canonicalJson(decision.productionProvenance),
    production_provenance_digest: decision.productionProvenance.provenanceDigest,
    attestation_schema_ref: 'libra.production-attestation@1',
    attestation_json: canonicalJson(decision.productionAttestation),
    attestation_digest: decision.productionAttestation.attestationDigest,
    promotion_decision_digest: decision.decisionDigest,
    package_digest: decision.packageDigest,
    state: 'published',
    published_at_ms: value.publishedAtMs,
  });
  for (const member of decision.productMaterialManifest.members) {
    repo.invoke('insert_material', materialRow(value.onDeckPackageId, member));
    for (const claim of member.episodeClaims) {
      repo.invoke('insert_episode_claim', {
        on_deck_package_id: value.onDeckPackageId,
        member_ordinal: member.ordinal,
        episode_key: claim.episodeKey,
        season_claim_digest: claim.seasonClaimDigest,
        claim_digest: claim.claimDigest,
      });
    }
  }
  decision.productFactManifest.items.forEach((item, ordinal) => repo.invoke('insert_fact_ref', {
    on_deck_package_id: value.onDeckPackageId,
    ordinal,
    product_fact_id: item.productFactId,
    fact_kind: item.factKind,
    fact_revision: item.factRevision,
    schema_ref: item.schemaRef,
    fact_digest: item.factDigest,
    evidence_digest: item.evidenceDigest,
    reference_digest: item.referenceDigest,
  }));
  decision.artifactManifest.items.forEach((item, ordinal) => repo.invoke('insert_artifact_ref', {
    on_deck_package_id: value.onDeckPackageId,
    ordinal,
    artifact_handle_id: item.artifactHandleId,
    artifact_kind: item.artifactKind,
    artifact_revision: item.artifactRevision,
    artifact_digest: item.artifactDigest,
    requirement_digest: item.requirementDigest,
    materialization_state: item.materializationState,
    reference_digest: item.referenceDigest,
  }));
  decision.offloadContextManifest.members.forEach((item) => repo.invoke('insert_offload', {
    on_deck_package_id: value.onDeckPackageId,
    ordinal: item.ordinal,
    material_key: item.materialKey,
    context_role: item.contextRole,
    source_related_reference_id: item.sourceRelatedReferenceId ?? null,
    final_product_material_key: item.finalProductMaterialKey ?? null,
    disposition_kind: item.dispositionKind ?? null,
    mount_scope_id: item.physicalIdentity.mountScopeId,
    inode: item.physicalIdentity.inode,
    size_bytes: item.physicalIdentity.sizeBytes,
    fingerprint_algorithm: item.physicalIdentity.fingerprintAlgorithm,
    fingerprint_version: item.physicalIdentity.fingerprintVersion,
    content_fingerprint: item.physicalIdentity.contentFingerprint,
    endpoint_id: item.endpointId,
    location: item.location,
    binding_revision: item.bindingRevision,
    binding_evidence_digest: item.bindingEvidenceDigest,
    admitted_control_revision: item.admittedControlRevision ?? null,
    admitted_control_projection_digest: item.admittedControlProjectionDigest ?? null,
    derived_authority_digest: item.derivedAuthorityDigest ?? null,
    settlement_expectation: item.settlementExpectation,
    context_member_digest: item.memberDigest,
  }));
  const advanced = repo.invoke('cas_run_package_head', {
    package_revision_head: decision.packageRevision,
    libra_run_id: decision.libraRunRef.libraRunId,
    expected_package_revision_head: decision.libraRunRef.expectedPackageRevisionHead,
  });
  if (advanced.changes !== 1) {
    fail('P9_PROMOTION_PACKAGE_HEAD_CAS', 'Run package revision head changed concurrently.');
  }
  return snapshot;
}

function createDeliverablePromotionStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P9_PROMOTION_STORE_DEPENDENCIES', 'Promotion Store requires clean persistence.');
  }
  const libra = libraDefinition(options.schemaManifest);
  const foundation = foundationDefinition(options.schemaManifest);

  function publish(request) {
    const decision = assertPromotionDecision(request?.decision);
    if (request.transactionId !== TRANSACTION_ID ||
        !request.commitMarker || typeof request.commitMarker !== 'object' || Array.isArray(request.commitMarker) ||
        typeof request.commitMarker.commitMarker !== 'string' || !request.commitMarker.commitMarker ||
        typeof request.commitMarker.effectId !== 'string' || !request.commitMarker.effectId ||
        request.commitMarker.commitDigest !== decision.decisionDigest ||
        typeof request.resultId !== 'string' || !request.resultId ||
        (request.eventId !== undefined && (typeof request.eventId !== 'string' || !request.eventId)) ||
        (request.effectReceiptId !== undefined && (typeof request.effectReceiptId !== 'string' || !request.effectReceiptId))) {
      fail('P9_PROMOTION_REQUEST', 'Promotion request is incomplete.');
    }
    let snapshot;
    let controlCommits;
    let commit;
    const replay = {
      participantId: 'libra_deliverable_promotion_replay',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        assertReplay(context.repository(foundation.repositoryId), request.commitMarker.commitMarker, decision);
      },
    };
    const prepare = {
      participantId: 'libra_deliverable_promotion_prepare',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        snapshot = assertLibraSnapshot(context.repository(libra.repositoryId), decision);
        return snapshot;
      },
    };
    const artifactRead = {
      participantId: 'libra_deliverable_promotion_artifact_read',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        assertArtifacts(context.repository(foundation.repositoryId), decision);
      },
    };
    const subjectId = decision.resolvedIdentitySnapshot.factValue.subjectId;
    const controlChanges = decision.productMaterialManifest.members.map((member) => {
      if (member.controlOperation === 'assert_existing_input') {
        return Object.freeze({
          identity: member.physicalIdentity,
          action: 'assert_same_field',
          expectedRevision: member.expectedControlRevision,
          expectedProjectionDigest: member.expectedControlProjectionDigest,
          fromScope: Object.freeze({
            ownerDomain: 'libra',
            scopeType: 'subject',
            scopeId: subjectId,
          }),
          toScope: null,
        });
      }
      return Object.freeze({
        identity: member.physicalIdentity,
        action: 'acquire',
        expectedRevision: 0,
        fromScope: null,
        toScope: Object.freeze({
          ownerDomain: 'libra',
          scopeType: 'on_deck_package',
          scopeId: decision.onDeckPackageId,
        }),
      });
    });
    const rawControl = createMaterialControlParticipant({
      schemaManifest: options.schemaManifest,
      participantId: 'libra_deliverable_promotion_control',
      handle: request.controlCommitHandle,
      changes: controlChanges,
      authorizedScopeDigest: decision.controlCommitScope.controlScopeDigest,
      commitMarker: request.commitMarker.commitMarker,
    });
    const scopeByKey = new Map(decision.controlCommitScope.items.map((item) => [item.materialKey, item]));
    const control = Object.freeze({
      ...rawControl,
      execute(context) {
        const results = rawControl.execute(context);
        controlCommits = results.map((item) => Object.freeze({
        materialKey: item.materialKey,
        controlOperation: scopeByKey.get(item.materialKey).controlOperation,
        committedControlRevision: item.revision,
        committedControlProjectionDigest: item.projection.projectionDigest,
        })).sort((left, right) => utf8(left.materialKey, right.materialKey));
        return results;
      },
    });
    const domain = {
      participantId: 'libra_deliverable_promotion_write',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        commit = buildPromotionCommit({
          decision,
          committedAtMs: context.commitTimeMs,
          subjectId: snapshot.run.subject_id,
          shelfId: snapshot.spec.shelf_id,
          controlCommits,
        });
        writePackage(context.repository(libra.repositoryId), commit, decision, snapshot);
        return commit.package;
      },
    };
    const finish = {
      participantId: 'libra_deliverable_promotion_foundation',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        const repo = context.repository(foundation.repositoryId);
        const receiptJson = canonicalJson(commit.receipt);
        const receiptDigest = canonicalDigest(commit.receipt);
        repo.invoke('insert_result', {
          result_id: request.resultId,
          event_id: request.eventId || null,
          outcome_kind: 'succeeded',
          result_schema_ref: RESULT_SCHEMA,
          result_json: receiptJson,
          result_digest: receiptDigest,
          evidence_schema_ref: 'helix://contracts/domain-types/LibraDeliverablePromotionDecision/v1',
          evidence_json: canonicalJson(decision),
          evidence_digest: canonicalDigest(decision),
          effect_receipt_id: request.effectReceiptId || null,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_marker', {
          commit_marker: request.commitMarker.commitMarker,
          effect_id: request.commitMarker.effectId,
          owner_domain: 'libra',
          scope_type: 'on_deck_package',
          scope_id: decision.onDeckPackageId,
          commit_digest: request.commitMarker.commitDigest,
          result_id: request.resultId,
          result_schema_ref: RESULT_SCHEMA,
          result_digest: receiptDigest,
          committed_at_ms: context.commitTimeMs,
        });
        const consumerSetDigest = canonicalDigest(['arca']);
        repo.invoke('insert_outbox', {
          message_id: commit.outbox.messageId,
          producer_domain: 'libra',
          message_kind: commit.outbox.messageKind,
          aggregate_type: 'on_deck_package',
          aggregate_id: decision.onDeckPackageId,
          aggregate_revision: decision.packageRevision,
          dedup_key: commit.outbox.dedupKey,
          consumer_set_digest: consumerSetDigest,
          intended_consumer_count: 1,
          payload_schema_ref: 'helix://contracts/types/LibraProductOfferAvailableMessage/v1',
          payload_json: canonicalJson(commit.outbox),
          payload_digest: canonicalDigest(commit.outbox),
          state: 'pending',
          available_at_ms: context.commitTimeMs,
          created_at_ms: context.commitTimeMs,
          all_acked_at_ms: null,
        });
        repo.invoke('insert_outbox_delivery', {
          message_id: commit.outbox.messageId,
          consumer_domain: 'arca',
          state: 'pending',
          attempt_count: 0,
          next_attempt_at_ms: context.commitTimeMs,
          acked_at_ms: null,
        });
        return receiptDigest;
      },
    };
    try {
      options.unitOfWork.execute([replay, prepare, artifactRead, control, domain, finish]);
      return Object.freeze({ replayed: false, receipt: commit.receipt, package: commit.package, offer: commit.outbox });
    } catch (error) {
      if (error instanceof Replay) return error.result;
      throw error;
    }
  }

  return Object.freeze({ publish });
}

module.exports = Object.freeze({
  DeliverablePromotionStoreError,
  createDeliverablePromotionStore,
});
