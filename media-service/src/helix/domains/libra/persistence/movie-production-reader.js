'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  workspaceStateDigest,
} = require('../model/workspace-admission-contracts');

class MovieProductionReaderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieProductionReaderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieProductionReaderError(code, message, details);
}

function parse(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    fail(code, 'Stored typed JSON is invalid.');
  }
}

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_movie_production_reads',
    owner: 'libra',
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'subject_id', 'acceptance_spec_id',
          'run_material_manifest_id', 'execution_basis_record_json',
          'execution_basis_digest', 'run_scope_digest', 'state',
          'state_revision', 'state_digest', 'package_revision_head', 'created_at_ms',
        ],
        keyColumns: ['libra_run_id'],
        safeIntegers: true,
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
          'spec_schema_ref', 'spec_json', 'spec_digest', 'record_digest',
          'structure_kind', 'content_profile',
        ],
        keyColumns: ['acceptance_spec_id'],
        safeIntegers: true,
      },
      find_manifest: {
        kind: 'select-one',
        tableId: 'libra_run_material_manifests',
        columns: [
          'run_material_manifest_id', 'libra_run_id', 'manifest_role',
          'scope_kind', 'manifest_revision', 'member_count', 'member_set_digest',
          'episode_scope_digest', 'manifest_digest',
        ],
        keyColumns: ['run_material_manifest_id'],
        safeIntegers: true,
      },
      list_members: {
        kind: 'select-all',
        tableId: 'libra_run_material_members',
        columns: [
          'run_material_manifest_id', 'ordinal', 'material_key', 'role',
          'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
          'location_kind', 'endpoint_id', 'location',
          'binding_kind', 'binding_revision', 'binding_evidence_digest',
          'origin_intake_decision_id', 'origin_offer_id',
          'origin_candidate_package_id', 'origin_package_revision',
          'origin_package_digest', 'origin_candidate_delivery_snapshot_digest',
          'origin_related_reference_set_digest', 'admitted_control_revision',
          'admitted_control_projection_digest', 'output_requirement_digest',
          'episode_claim_set_digest', 'member_digest',
        ],
        keyColumns: ['run_material_manifest_id'],
        safeIntegers: true,
      },
      list_claims: {
        kind: 'select-all',
        tableId: 'libra_run_material_episode_claims',
        columns: [
          'run_material_manifest_id', 'member_ordinal', 'episode_key',
          'season_claim_digest', 'claim_digest',
        ],
        keyColumns: ['run_material_manifest_id'],
        safeIntegers: true,
      },
      find_intake: {
        kind: 'select-one',
        tableId: 'libra_intake_decisions',
        columns: [
          'intake_decision_id', 'decision_kind', 'offer_id',
          'candidate_package_id', 'package_revision', 'package_digest',
          'candidate_delivery_snapshot_digest', 'target_subject_id',
          'candidate_delivery_snapshot_schema_ref',
          'candidate_delivery_snapshot_json',
        ],
        keyColumns: ['intake_decision_id'],
        safeIntegers: true,
      },
      find_fact: {
        kind: 'select-one',
        tableId: 'libra_product_fact_revisions',
        columns: [
          'product_fact_id', 'libra_run_id', 'fact_kind', 'fact_revision',
          'schema_ref', 'fact_json', 'fact_digest', 'evidence_digest',
          'result_digest',
        ],
        keyColumns: ['libra_run_id', 'fact_kind', 'fact_revision'],
        safeIntegers: true,
      },
      find_workspace: {
        kind: 'select-one',
        tableId: 'libra_workspaces',
        columns: [
          'workspace_id', 'libra_run_id', 'current_revision', 'state',
          'state_digest', 'workspace_scope_digest',
          'platform_workspace_snapshot_digest',
        ],
        keyColumns: ['workspace_id'],
        safeIntegers: true,
      },
      find_workspace_revision: {
        kind: 'select-one',
        tableId: 'libra_workspace_revisions',
        columns: [
          'workspace_id', 'workspace_revision', 'state',
          'material_reference_set_digest', 'transition_kind',
          'transition_evidence_digest', 'previous_revision',
          'revision_digest', 'committed_at_ms',
        ],
        keyColumns: ['workspace_id', 'workspace_revision'],
        safeIntegers: true,
      },
      find_package: {
        kind: 'select-one',
        tableId: 'libra_product_packages',
        columns: [
          'on_deck_package_id', 'offer_id', 'package_revision', 'libra_run_id',
          'shelf_id', 'acceptance_spec_id', 'package_digest',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      list_references: {
        kind: 'select-all',
        tableId: 'libra_workspace_material_refs',
        columns: [
          'workspace_id', 'libra_run_id', 'reference_id', 'material_handle_id',
          'material_key', 'workspace_handle_json', 'workspace_handle_digest',
          'reference_revision', 'reference_state', 'episode_claims_json',
          'episode_scope_digest', 'product_verification_schema_ref',
          'product_verification_id', 'product_verification_json',
          'product_verification_digest', 'committed_workspace_revision',
          'reference_digest',
        ],
        keyColumns: ['workspace_id'],
        safeIntegers: true,
      },
    },
  });
}

function physicalIdentity(row) {
  const identity = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion: 2,
    materialKey: row.material_key,
    mountScopeId: row.mount_scope_id,
    inode: String(row.inode),
    sizeBytes: Number(row.size_bytes),
    fingerprintAlgorithm: row.fingerprint_algorithm,
    fingerprintVersion: Number(row.fingerprint_version),
    contentFingerprint: row.content_fingerprint,
  };
  const materialKey = canonicalDigest({
    schema: 'physical-material-identity@2',
    mountScopeId: identity.mountScopeId,
    inode: identity.inode,
    sizeBytes: identity.sizeBytes,
    fingerprintAlgorithm: identity.fingerprintAlgorithm,
    fingerprintVersion: identity.fingerprintVersion,
    contentFingerprint: identity.contentFingerprint,
  });
  if (identity.materialKey !== materialKey) {
    fail('P14_MOVIE_PRODUCTION_IDENTITY_DRIFT',
      'Run material identity cannot be reconstructed.');
  }
  return Object.freeze(identity);
}

function createMovieProductionReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P14_MOVIE_PRODUCTION_READER_DEPENDENCIES',
      'Movie production reads require Libra persistence.');
  }
  const repository = definition(options.schemaManifest);
  const exact = (body) => options.unitOfWork.execute([{
    participantId: 'libra_movie_production_read',
    owner: 'libra',
    repositories: [repository],
    execute: body,
  }]).libra_movie_production_read;

  function readRun(libraRunId) {
    return exact((context) => {
      const repo = context.repository(repository.repositoryId);
      const run = repo.invoke('find_run', { libra_run_id: libraRunId });
      if (!run || run.state !== 'active') {
        fail('P14_MOVIE_PRODUCTION_RUN_UNAVAILABLE',
          'The exact active Libra Run is unavailable.');
      }
      const revision = repo.invoke('find_run_revision', {
        libra_run_id: libraRunId,
        state_revision: Number(run.state_revision),
      });
      const specRow = repo.invoke('find_spec', {
        acceptance_spec_id: run.acceptance_spec_id,
      });
      const manifest = repo.invoke('find_manifest', {
        run_material_manifest_id: run.run_material_manifest_id,
      });
      const members = repo.invoke('list_members', {
        run_material_manifest_id: run.run_material_manifest_id,
      }).sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
      const claims = repo.invoke('list_claims', {
        run_material_manifest_id: run.run_material_manifest_id,
      });
      if (!revision || revision.state !== 'active' ||
          revision.execution_basis_digest !== run.execution_basis_digest ||
          revision.run_scope_digest !== run.run_scope_digest ||
          !specRow || specRow.subject_id !== run.subject_id ||
          specRow.acceptance_spec_id !== run.acceptance_spec_id ||
          !manifest || manifest.libra_run_id !== run.libra_run_id ||
          manifest.manifest_role !== 'run_input' ||
          Number(manifest.member_count) !== members.length ||
          members.length < 1 || members.length > 1024 ||
          members.some((member, ordinal) =>
            Number(member.ordinal) !== ordinal ||
            member.role !== 'primary_payload')) {
        fail('P14_MOVIE_PRODUCTION_RUN_DRIFT',
          'Run, Spec, Manifest, or active revision continuity drifted.');
      }
      const spec = parse(specRow.spec_json, 'P14_MOVIE_PRODUCTION_SPEC_JSON');
      if (spec.schemaRef !== 'libra.acceptance-spec@1' ||
          spec.acceptanceSpecId !== specRow.acceptance_spec_id ||
          spec.recordDigest !== specRow.record_digest ||
          canonicalJson(spec) !== canonicalJson(parse(specRow.spec_json,
            'P14_MOVIE_PRODUCTION_SPEC_JSON'))) {
        fail('P14_MOVIE_PRODUCTION_SPEC_DRIFT',
          'Acceptance Spec is not the exact immutable Product contract.');
      }
      const isMovie = spec.contentProfile === 'movie' &&
        spec.structureKind === 'single' &&
        manifest.scope_kind === 'single' &&
        members.length === 1;
      const isJav = spec.contentProfile === 'jav' &&
        spec.structureKind === 'single' &&
        manifest.scope_kind === 'single' &&
        members.length === 1;
      const isWestern = spec.contentProfile === 'western_adult' &&
        spec.structureKind === 'single' &&
        manifest.scope_kind === 'single' &&
        members.length === 1;
      const isSeries = spec.contentProfile === 'series' &&
        spec.structureKind === 'season' &&
        manifest.scope_kind === 'episode_delivery';
      if (!isMovie && !isJav && !isWestern && !isSeries) {
        fail('P14_MOVIE_PRODUCTION_SPEC_DRIFT',
          'Product profile, structure, Run scope, and Primary cardinality conflict.');
      }
      const relatedById = new Map();
      let candidateIdentityClaim = null;
      const mappedMembers = members.map((member) => {
        const memberClaims = claims
          .filter((claim) =>
            Number(claim.member_ordinal) === Number(member.ordinal))
          .sort((left, right) => Buffer.compare(
            Buffer.from(left.episode_key),
            Buffer.from(right.episode_key),
          ))
          .map((claim) => Object.freeze({
            episodeKey: claim.episode_key,
            seasonClaimDigest: claim.season_claim_digest,
            claimDigest: claim.claim_digest,
          }));
        const claimSetDigest = canonicalDigest({
          schema: 'libra.production-material-episode-claims@1',
          items: memberClaims,
        });
        if (claimSetDigest !== member.episode_claim_set_digest ||
            (!isSeries && memberClaims.length) ||
            (isSeries && (memberClaims.length < 1 || memberClaims.length > 32))) {
          fail('P14_MOVIE_PRODUCTION_EPISODE_DRIFT',
            'Run member Episode claims do not match the immutable Manifest.');
        }
        const intake = repo.invoke('find_intake', {
          intake_decision_id: member.origin_intake_decision_id,
        });
        if (!intake || intake.decision_kind !== 'accepted_resolution' ||
            intake.target_subject_id !== run.subject_id ||
            intake.offer_id !== member.origin_offer_id ||
            intake.candidate_package_id !== member.origin_candidate_package_id ||
            Number(intake.package_revision) !== Number(member.origin_package_revision) ||
            intake.package_digest !== member.origin_package_digest ||
            intake.candidate_delivery_snapshot_digest !==
              member.origin_candidate_delivery_snapshot_digest) {
          fail('P14_MOVIE_PRODUCTION_HANDOFF_DRIFT',
            'Run input no longer matches its immutable accepted Handoff A snapshot.');
        }
        const delivery = parse(
          intake.candidate_delivery_snapshot_json,
          'P14_MOVIE_PRODUCTION_HANDOFF_JSON',
        );
        if (delivery.deliverySnapshotDigest !==
            intake.candidate_delivery_snapshot_digest) {
          fail('P14_MOVIE_PRODUCTION_HANDOFF_DRIFT',
            'Accepted Handoff A snapshot digest drifted.');
        }
        const identityClaim = delivery.candidatePackage?.identityClaim;
        if (!identityClaim ||
            delivery.candidatePackage.contentProfile !== spec.contentProfile ||
            identityClaim.contentProfile !== spec.contentProfile) {
          fail('P14_MOVIE_PRODUCTION_HANDOFF_DRIFT',
            'Accepted Candidate identity is unavailable for Product preparation.');
        }
        if (candidateIdentityClaim &&
            canonicalJson(candidateIdentityClaim) !== canonicalJson(identityClaim)) {
          fail('P14_MOVIE_PRODUCTION_HANDOFF_DRIFT',
            'Run members disagree on the accepted Candidate identity.');
        }
        candidateIdentityClaim = identityClaim;
        const primary = delivery.primaryMaterialDeliveries.find((item) =>
          item.materialKey === member.material_key);
        const acceptedEpisodeClaims = (primary?.episodeClaims || [])
          .map((claim) => Object.freeze({
            episodeKey: claim.episodeKey,
            seasonClaimDigest: claim.seasonClaimDigest,
            claimDigest: canonicalDigest({
              schema: 'libra.production-material-episode-claim@1',
              episodeKey: claim.episodeKey,
              seasonClaimDigest: claim.seasonClaimDigest,
            }),
          }))
          .sort((left, right) => Buffer.compare(
            Buffer.from(left.episodeKey),
            Buffer.from(right.episodeKey),
          ));
        if (!primary || primary.location !== member.location ||
            primary.endpointId !== member.endpoint_id ||
            primary.sizeBytes !== Number(member.size_bytes) ||
            canonicalJson(acceptedEpisodeClaims) !== canonicalJson(memberClaims)) {
          fail('P14_MOVIE_PRODUCTION_PRIMARY_DRIFT',
            'Handoff A primary material and Run input disagree.');
        }
        for (const item of delivery.candidatePackage.relatedReferences
          .filter((reference) =>
            reference.primaryMaterialKey === member.material_key)) {
          const prior = relatedById.get(item.referenceId);
          if (prior && canonicalJson(prior) !== canonicalJson(item)) {
            fail('P14_MOVIE_PRODUCTION_RELATED_DRIFT',
              'Related Material reference identity conflicts across Run members.');
          }
          relatedById.set(item.referenceId, item);
        }
        return Object.freeze({
          ordinal: Number(member.ordinal),
          materialKey: member.material_key,
          role: member.role,
          physicalIdentity: physicalIdentity(member),
          sizeBytes: Number(member.size_bytes),
          endpointId: member.endpoint_id,
          location: member.location,
          bindingRevision: Number(member.binding_revision),
          bindingEvidenceDigest: member.binding_evidence_digest,
          admittedControlRevision: Number(member.admitted_control_revision),
          admittedControlProjectionDigest:
            member.admitted_control_projection_digest,
          outputRequirementDigest: member.output_requirement_digest,
          episodeClaims: Object.freeze(memberClaims),
          episodeClaimSetDigest: member.episode_claim_set_digest,
          originCandidateDeliveryRef: Object.freeze({
            intakeDecisionId: member.origin_intake_decision_id,
            offerId: member.origin_offer_id,
            candidatePackageId: member.origin_candidate_package_id,
            packageRevision: Number(member.origin_package_revision),
            packageDigest: member.origin_package_digest,
            candidateDeliverySnapshotDigest:
              member.origin_candidate_delivery_snapshot_digest,
            relatedReferenceSetDigest:
              member.origin_related_reference_set_digest,
          }),
        });
      });
      const episodeClaims = new Map();
      for (const claim of mappedMembers.flatMap((member) =>
        member.episodeClaims)) {
        const prior = episodeClaims.get(claim.episodeKey);
        if (prior && canonicalJson(prior) !== canonicalJson(claim)) {
          fail('P14_MOVIE_PRODUCTION_EPISODE_DRIFT',
            'Run members disagree on one Episode claim tuple.');
        }
        episodeClaims.set(claim.episodeKey, claim);
      }
      const episodeKeys = [...episodeClaims.keys()].sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)));
      if (canonicalJson(episodeKeys) !==
          canonicalJson(spec.productScope.episodeKeys || [])) {
        fail('P14_MOVIE_PRODUCTION_EPISODE_DRIFT',
          'Run Manifest and Acceptance Spec Episode scopes disagree.');
      }
      const related = [...relatedById.values()]
        .sort((left, right) => Buffer.compare(
          Buffer.from(left.referenceId),
          Buffer.from(right.referenceId),
        ));
      return Object.freeze({
        run: Object.freeze({
          libraRunId: run.libra_run_id,
          subjectId: run.subject_id,
          acceptanceSpecId: run.acceptance_spec_id,
          executionBasisDigest: run.execution_basis_digest,
          runScopeDigest: run.run_scope_digest,
          stateRevision: Number(run.state_revision),
          stateDigest: run.state_digest,
          packageRevisionHead: Number(run.package_revision_head),
          createdAtMs: Number(run.created_at_ms),
          runMaterialManifestId: run.run_material_manifest_id,
          runMaterialManifestDigest: manifest.manifest_digest,
        }),
        spec: Object.freeze(spec),
        members: Object.freeze(mappedMembers),
        candidateIdentityClaim: Object.freeze(candidateIdentityClaim),
        episodeClaims: Object.freeze([...episodeClaims.values()].sort(
          (left, right) => Buffer.compare(
            Buffer.from(left.episodeKey),
            Buffer.from(right.episodeKey),
          ),
        )),
        relatedReferences: Object.freeze(related),
      });
    });
  }

  function readFact(libraRunId, factKind, factRevision = 1) {
    return exact((context) => {
      const row = context.repository(repository.repositoryId).invoke('find_fact', {
        libra_run_id: libraRunId,
        fact_kind: factKind,
        fact_revision: factRevision,
      });
      if (!row) return null;
      const value = parse(row.fact_json, 'P14_MOVIE_PRODUCTION_FACT_JSON');
      if (canonicalDigest(value) !== row.result_digest) {
        fail('P14_MOVIE_PRODUCTION_FACT_DRIFT',
          'Product Fact result digest drifted.');
      }
      return Object.freeze({
        productFactId: row.product_fact_id,
        factKind: row.fact_kind,
        factRevision: Number(row.fact_revision),
        schemaRef: row.schema_ref,
        factValue: value,
        factDigest: row.fact_digest,
        evidenceDigest: row.evidence_digest,
      });
    });
  }

  function readWorkspace(workspaceId) {
    return exact((context) => {
      const repo = context.repository(repository.repositoryId);
      const row = repo.invoke('find_workspace', { workspace_id: workspaceId });
      if (!row) return null;
      const currentRows = new Map();
      for (const item of repo.invoke('list_references', {
        workspace_id: workspaceId,
      })) {
        const existing = currentRows.get(item.reference_id);
        if (!existing ||
            Number(item.reference_revision) >
              Number(existing.reference_revision)) {
          currentRows.set(item.reference_id, item);
        }
      }
      const references = [...currentRows.values()].map((item) => Object.freeze({
        workspaceId: item.workspace_id,
        libraRunId: item.libra_run_id,
        referenceId: item.reference_id,
        materialHandleId: item.material_handle_id,
        materialKey: item.material_key,
        workspaceMaterialHandle: parse(
          item.workspace_handle_json,
          'P14_MOVIE_PRODUCTION_REFERENCE_JSON',
        ),
        workspaceHandleDigest: item.workspace_handle_digest,
        referenceRevision: Number(item.reference_revision),
        state: item.reference_state,
        episodeClaims: parse(
          item.episode_claims_json,
          'P14_MOVIE_PRODUCTION_REFERENCE_CLAIMS_JSON',
        ),
        episodeScopeDigest: item.episode_scope_digest,
        productVerificationRef: item.product_verification_json
          ? parse(
            item.product_verification_json,
            'P14_MOVIE_PRODUCTION_REFERENCE_VERIFICATION_JSON',
          )
          : null,
        productVerificationDigest: item.product_verification_digest,
        committedWorkspaceRevision: Number(item.committed_workspace_revision),
        referenceDigest: item.reference_digest,
      }));
      return Object.freeze({
        workspaceId: row.workspace_id,
        libraRunId: row.libra_run_id,
        currentRevision: Number(row.current_revision),
        state: row.state,
        stateDigest: row.state_digest,
        workspaceScopeDigest: row.workspace_scope_digest,
        rootSnapshotDigest: row.platform_workspace_snapshot_digest,
        references: Object.freeze(references),
      });
    });
  }

  function readWorkspaceRevision(workspaceId, workspaceRevision) {
    if (typeof workspaceId !== 'string' || !workspaceId ||
        !Number.isSafeInteger(workspaceRevision) ||
        workspaceRevision < 1) {
      fail('P14_MOVIE_WORKSPACE_REVISION_INPUT',
        'Workspace historical read requires an exact positive revision.');
    }
    return exact((context) => {
      const repo = context.repository(repository.repositoryId);
      const workspace = repo.invoke('find_workspace', {
        workspace_id: workspaceId,
      });
      const row = repo.invoke('find_workspace_revision', {
        workspace_id: workspaceId,
        workspace_revision: workspaceRevision,
      });
      if (!workspace || !row ||
          row.workspace_id !== workspace.workspace_id ||
          !/^[a-f0-9]{64}$/.test(row.revision_digest || '')) {
        return null;
      }
      const state = {
        workspaceId,
        workspaceRevision: Number(row.workspace_revision),
        state: row.state,
        workspaceMaterialReferenceSetDigest:
          row.material_reference_set_digest,
        transitionKind: row.transition_kind,
        transitionEvidenceDigest: row.transition_evidence_digest,
      };
      const stateDigest = workspaceStateDigest(state);
      const revisionDigest = canonicalDigest({
        ...state,
        stateDigest,
        previousRevision: row.previous_revision === null
          ? null
          : Number(row.previous_revision),
      });
      if (revisionDigest !== row.revision_digest ||
          (Number(workspace.current_revision) === workspaceRevision &&
           workspace.state_digest !== stateDigest)) {
        fail('P14_MOVIE_WORKSPACE_REVISION_CORRUPT',
          'Workspace historical revision cannot reconstruct its exact state.');
      }
      return Object.freeze({
        workspaceId,
        libraRunId: workspace.libra_run_id,
        currentRevision: Number(row.workspace_revision),
        state: row.state,
        stateDigest,
        workspaceScopeDigest: workspace.workspace_scope_digest,
        rootSnapshotDigest:
          workspace.platform_workspace_snapshot_digest,
      });
    });
  }

  function readPublishedDeliveryRef(libraRunId, packageRevision) {
    if (!Number.isSafeInteger(packageRevision) || packageRevision < 1) {
      fail('P14_MOVIE_PRODUCT_DELIVERY_REVISION',
        'Published Product Delivery revision must be explicit.');
    }
    const onDeckPackageId = canonicalDigest({
      schema: 'libra.on-deck-package-id@1',
      libraRunId,
      packageRevision,
    });
    return exact((context) => {
      const row = context.repository(repository.repositoryId).invoke(
        'find_package',
        { on_deck_package_id: onDeckPackageId },
      );
      if (!row) return null;
      if (row.libra_run_id !== libraRunId ||
          Number(row.package_revision) !== packageRevision ||
          !/^[a-f0-9]{64}$/.test(row.offer_id || '') ||
          !/^[a-f0-9]{64}$/.test(row.package_digest || '')) {
        fail('P14_MOVIE_PRODUCT_DELIVERY_DRIFT',
          'Published Product Delivery identity cannot be reconstructed.');
      }
      return Object.freeze({
        libraRunId,
        onDeckPackageId,
        packageRevision,
        packageDigest: row.package_digest,
        offerId: row.offer_id,
        shelfId: row.shelf_id,
        acceptanceSpecId: row.acceptance_spec_id,
      });
    });
  }

  return Object.freeze({
    readFact,
    readPublishedDeliveryRef,
    readRun,
    readWorkspace,
    readWorkspaceRevision,
  });
}

module.exports = Object.freeze({
  MovieProductionReaderError,
  createMovieProductionReader,
});
