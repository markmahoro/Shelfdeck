'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  verifyOnDeckProductPackageDigest,
} = require('../model/delivery-lifecycle-contracts');

class ProductDeliveryReaderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProductDeliveryReaderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProductDeliveryReaderError(code, message, details);
}

function number(value) {
  return Number(value);
}

function nullableNumber(value) {
  return value === null ? null : Number(value);
}

function parse(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    fail(code, 'Stored Product Delivery JSON is corrupt.');
  }
}

function utf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function without(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function exactQuery(value) {
  const expected = [
    'queryContract', 'readPurpose', 'offerId', 'onDeckPackageId',
    'expectedPackageRevision', 'expectedPackageDigest',
  ];
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.sort()) ||
      value.queryContract !== 'libra.product-delivery@1' ||
      !['historical', 'acceptance_fence'].includes(value.readPurpose) ||
      !Number.isSafeInteger(value.expectedPackageRevision) || value.expectedPackageRevision < 1) {
    fail('P9_PRODUCT_DELIVERY_QUERY', 'Product Delivery query is not exact.');
  }
  return Object.freeze({ ...value });
}

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_product_delivery_reader',
    owner: 'libra',
    schemaManifest,
    statements: {
      find_package: {
        kind: 'select-one',
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
          'production_provenance_schema_ref', 'production_provenance_json',
          'production_provenance_digest', 'attestation_schema_ref', 'attestation_json',
          'attestation_digest', 'package_digest', 'published_at_ms',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      list_materials: {
        kind: 'select-all',
        tableId: 'libra_product_package_materials',
        columns: [
          'on_deck_package_id', 'ordinal', 'material_handle_id', 'material_key', 'role',
          'mount_scope_id', 'inode', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
          'location_kind', 'endpoint_id', 'location', 'root_handle_ref', 'relative_path',
          'binding_kind', 'binding_revision', 'binding_evidence_digest',
          'origin_intake_decision_id', 'origin_offer_id', 'origin_candidate_package_id',
          'origin_package_revision', 'origin_package_digest',
          'origin_candidate_delivery_snapshot_digest', 'origin_related_reference_set_digest',
          'workspace_reference_id', 'workspace_handle_json', 'output_requirement_digest',
          'episode_claim_set_digest', 'size_bytes', 'control_operation',
          'expected_control_revision', 'expected_control_projection_digest',
          'committed_control_revision', 'committed_control_projection_digest', 'member_digest',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      list_episode_claims: {
        kind: 'select-all',
        tableId: 'libra_product_package_material_episode_claims',
        columns: [
          'on_deck_package_id', 'member_ordinal', 'episode_key',
          'season_claim_digest', 'claim_digest',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      list_fact_refs: {
        kind: 'select-all',
        tableId: 'libra_product_package_fact_refs',
        columns: [
          'on_deck_package_id', 'ordinal', 'product_fact_id', 'fact_kind',
          'fact_revision', 'schema_ref', 'fact_digest', 'evidence_digest',
          'reference_digest',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      find_fact: {
        kind: 'select-one',
        tableId: 'libra_product_fact_revisions',
        columns: [
          'product_fact_id', 'fact_revision', 'schema_ref', 'fact_json',
          'fact_digest', 'evidence_digest',
        ],
        keyColumns: ['product_fact_id', 'fact_revision'],
        safeIntegers: true,
      },
      list_artifact_refs: {
        kind: 'select-all',
        tableId: 'libra_product_package_artifact_refs',
        columns: [
          'on_deck_package_id', 'ordinal', 'artifact_handle_id', 'artifact_kind',
          'artifact_revision', 'artifact_digest', 'requirement_digest',
          'materialization_state', 'reference_digest',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      list_offload: {
        kind: 'select-all',
        tableId: 'libra_offload_context_materials',
        columns: [
          'on_deck_package_id', 'ordinal', 'material_key', 'context_role',
          'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm', 'fingerprint_version', 'content_fingerprint',
          'endpoint_id', 'location', 'binding_revision', 'binding_evidence_digest',
          'admitted_control_revision', 'admitted_control_projection_digest',
          'settlement_expectation', 'context_member_digest',
        ],
        keyColumns: ['on_deck_package_id'],
        safeIntegers: true,
      },
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'state', 'state_revision', 'state_digest',
          'acceptance_spec_id', 'package_revision_head',
        ],
        keyColumns: ['libra_run_id'],
        safeIntegers: true,
      },
      find_delivery: {
        kind: 'select-one',
        tableId: 'libra_delivery_receipts',
        columns: ['on_deck_package_id', 'package_digest'],
        keyColumns: ['on_deck_package_id'],
      },
    },
  });
}

function physical(row) {
  return {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion: 2,
    materialKey: row.material_key,
    mountScopeId: row.mount_scope_id,
    inode: String(row.inode),
    sizeBytes: number(row.size_bytes),
    fingerprintAlgorithm: row.fingerprint_algorithm,
    fingerprintVersion: number(row.fingerprint_version),
    contentFingerprint: row.content_fingerprint,
  };
}

function material(row, claims) {
  const origin = row.origin_intake_decision_id === null ? null : {
    intakeDecisionId: row.origin_intake_decision_id,
    offerId: row.origin_offer_id,
    candidatePackageId: row.origin_candidate_package_id,
    packageRevision: number(row.origin_package_revision),
    packageDigest: row.origin_package_digest,
    candidateDeliverySnapshotDigest: row.origin_candidate_delivery_snapshot_digest,
    relatedReferenceSetDigest: row.origin_related_reference_set_digest,
  };
  return {
    ordinal: number(row.ordinal),
    materialKey: row.material_key,
    role: row.role,
    physicalIdentity: physical(row),
    sizeBytes: number(row.size_bytes),
    location: {
      locationKind: row.location_kind,
      endpointId: row.endpoint_id,
      location: row.location,
      rootHandleRef: row.root_handle_ref,
      relativePath: row.relative_path,
    },
    bindingKind: row.binding_kind,
    bindingRevision: number(row.binding_revision),
    originCandidateDeliveryRef: origin,
    workspaceReferenceId: row.workspace_reference_id,
    workspaceMaterialHandle: row.workspace_handle_json === null
      ? null
      : parse(row.workspace_handle_json, 'P9_PRODUCT_DELIVERY_WORKSPACE_HANDLE'),
    admittedControlRevision: nullableNumber(row.expected_control_revision),
    admittedControlProjectionDigest: row.expected_control_projection_digest,
    bindingEvidenceDigest: row.binding_evidence_digest,
    episodeClaims: claims,
    episodeClaimSetDigest: row.episode_claim_set_digest,
    outputRequirementDigest: row.output_requirement_digest,
    memberDigest: row.member_digest,
    controlOperation: row.control_operation,
    expectedControlRevision: nullableNumber(row.expected_control_revision),
    expectedControlProjectionDigest: row.expected_control_projection_digest,
    committedControlRevision: number(row.committed_control_revision),
    committedControlProjectionDigest: row.committed_control_projection_digest,
  };
}

function reconstruct(repo, row) {
  const claimRows = repo.invoke('list_episode_claims', {
    on_deck_package_id: row.on_deck_package_id,
  });
  const materialRows = repo.invoke('list_materials', {
    on_deck_package_id: row.on_deck_package_id,
  }).sort((left, right) => number(left.ordinal) - number(right.ordinal));
  const members = materialRows.map((item) => material(item, claimRows
    .filter((claim) => number(claim.member_ordinal) === number(item.ordinal))
    .sort((left, right) => utf8(left.episode_key, right.episode_key))
    .map((claim) => ({
      episodeKey: claim.episode_key,
      seasonClaimDigest: claim.season_claim_digest,
      claimDigest: claim.claim_digest,
    }))));
  const factRefs = repo.invoke('list_fact_refs', {
    on_deck_package_id: row.on_deck_package_id,
  }).sort((left, right) => number(left.ordinal) - number(right.ordinal));
  const facts = factRefs.map((ref) => {
    const fact = repo.invoke('find_fact', {
      product_fact_id: ref.product_fact_id,
      fact_revision: number(ref.fact_revision),
    });
    if (!fact || fact.fact_digest !== ref.fact_digest ||
        fact.evidence_digest !== ref.evidence_digest ||
        ref.reference_digest !== canonicalDigest(without({
          productFactId: ref.product_fact_id,
          factKind: ref.fact_kind,
          factRevision: number(ref.fact_revision),
          schemaRef: ref.schema_ref,
          factValue: parse(fact.fact_json, 'P9_PRODUCT_DELIVERY_FACT_JSON'),
          factDigest: ref.fact_digest,
          evidenceDigest: ref.evidence_digest,
          referenceDigest: ref.reference_digest,
        }, 'referenceDigest'))) {
      fail('P9_PRODUCT_DELIVERY_FACT_CORRUPT', 'Package Fact relation is not reconstructable.');
    }
    return {
      productFactId: ref.product_fact_id,
      factKind: ref.fact_kind,
      factRevision: number(ref.fact_revision),
      schemaRef: ref.schema_ref,
      factValue: parse(fact.fact_json, 'P9_PRODUCT_DELIVERY_FACT_JSON'),
      factDigest: ref.fact_digest,
      evidenceDigest: ref.evidence_digest,
      referenceDigest: ref.reference_digest,
    };
  });
  const resolved = facts.find((item) => item.productFactId === row.resolved_identity_fact_id &&
    item.factRevision === number(row.resolved_identity_revision));
  const cast = facts.find((item) => item.productFactId === row.media_cast_fact_id);
  if (!resolved || resolved.factDigest !== row.resolved_identity_digest ||
      !cast || cast.factDigest !== row.media_cast_fact_digest) {
    fail('P9_PRODUCT_DELIVERY_REQUIRED_FACT', 'Package required Fact snapshots are absent.');
  }
  const structure = parse(
    row.product_structure_json,
    'P9_PRODUCT_DELIVERY_STRUCTURE',
  );
  const episodeClaims = new Map();
  for (const claim of members.flatMap((item) => item.episodeClaims)) {
    const prior = episodeClaims.get(claim.episodeKey);
    if (prior && canonicalJson(prior) !== canonicalJson(claim)) {
      fail('P9_PRODUCT_DELIVERY_EPISODE_CLAIM_DRIFT',
        'Product members disagree on one Episode claim tuple.');
    }
    episodeClaims.set(claim.episodeKey, claim);
  }
  const episodeScope = [...episodeClaims.values()].sort((left, right) =>
    utf8(left.episodeKey, right.episodeKey));
  const productMaterialManifest = {
    manifestId: row.product_material_manifest_id,
    manifestRole: 'product_delivery',
    manifestRevision: number(row.package_revision),
    libraRunId: row.libra_run_id,
    scopeKind: structure.structureKind === 'season'
      ? 'episode_delivery'
      : 'single',
    members,
    memberSetDigest: canonicalDigest({ schema: 'libra.production-material-members@1', items: members }),
    episodeScopeDigest: canonicalDigest({
      schema: 'libra.production-episode-scope@1',
      items: episodeScope,
    }),
  };
  productMaterialManifest.manifestDigest = canonicalDigest(productMaterialManifest);
  if (productMaterialManifest.manifestDigest !== row.product_material_manifest_digest) {
    fail('P9_PRODUCT_DELIVERY_MATERIAL_DIGEST', 'Product Material Manifest reconstruction drifted.', {
      expectedManifestDigest: row.product_material_manifest_digest,
      reconstructedManifestDigest: productMaterialManifest.manifestDigest,
      reconstructedMemberDigests: members.map((item) => canonicalDigest(item)),
      storedMemberDigests: members.map((item) => item.memberDigest),
    });
  }
  const productFactManifest = {
    manifestId: row.product_fact_manifest_id,
    manifestRevision: number(row.package_revision),
    libraRunId: row.libra_run_id,
    items: facts,
    factSetDigest: row.product_fact_set_digest,
  };
  productFactManifest.manifestDigest = canonicalDigest(productFactManifest);
  const artifacts = repo.invoke('list_artifact_refs', {
    on_deck_package_id: row.on_deck_package_id,
  }).sort((left, right) => number(left.ordinal) - number(right.ordinal))
    .map((item) => ({
      artifactHandleId: item.artifact_handle_id,
      artifactKind: item.artifact_kind,
      artifactRevision: number(item.artifact_revision),
      artifactDigest: item.artifact_digest,
      requirementDigest: item.requirement_digest,
      materializationState: item.materialization_state,
      referenceDigest: item.reference_digest,
    }));
  const artifactManifest = {
    manifestId: row.artifact_manifest_id,
    manifestRevision: number(row.package_revision),
    libraRunId: row.libra_run_id,
    items: artifacts,
    artifactSetDigest: canonicalDigest({ schema: 'libra.product-artifact-set@1', items: artifacts }),
  };
  artifactManifest.manifestDigest = canonicalDigest(artifactManifest);
  const offloadMembers = repo.invoke('list_offload', {
    on_deck_package_id: row.on_deck_package_id,
  }).sort((left, right) => number(left.ordinal) - number(right.ordinal))
    .map((item) => ({
      ordinal: number(item.ordinal),
      materialKey: item.material_key,
      contextRole: item.context_role,
      physicalIdentity: physical(item),
      endpointId: item.endpoint_id,
      location: item.location,
      bindingRevision: number(item.binding_revision),
      bindingEvidenceDigest: item.binding_evidence_digest,
      admittedControlRevision: number(item.admitted_control_revision),
      admittedControlProjectionDigest: item.admitted_control_projection_digest,
      settlementExpectation: item.settlement_expectation,
      memberDigest: item.context_member_digest,
    }));
  const offloadContextManifest = {
    manifestId: row.offload_context_manifest_id,
    manifestRevision: number(row.package_revision),
    libraRunId: row.libra_run_id,
    members: offloadMembers,
    memberSetDigest: canonicalDigest({ schema: 'libra.offload-context-members@1', items: offloadMembers }),
  };
  offloadContextManifest.manifestDigest = canonicalDigest(offloadContextManifest);
  const resolvedIdentitySnapshot = resolved ? Object.fromEntries(
    Object.entries(resolved).filter(([name]) =>
      !['factKind', 'referenceDigest'].includes(name)),
  ) : null;
  const productionProvenance = parse(row.production_provenance_json, 'P9_PRODUCT_DELIVERY_PROVENANCE');
  const productionAttestation = parse(row.attestation_json, 'P9_PRODUCT_DELIVERY_ATTESTATION');
  const packageValue = {
    schemaRef: 'helix://contracts/types/OnDeckProductPackage/v1',
    schemaVersion: 1,
    manifestId: row.on_deck_package_id,
    manifestKind: 'on_deck_product_package',
    ownerDomain: 'libra',
    memberCount: members.length,
    membersDigest: productMaterialManifest.memberSetDigest,
    manifestDigest: row.package_digest,
    publishedAtMs: number(row.published_at_ms),
    onDeckPackageId: row.on_deck_package_id,
    packageRevision: number(row.package_revision),
    libraRunId: row.libra_run_id,
    runStateRevision: number(row.run_state_revision),
    runStateDigest: row.run_state_digest,
    runExecutionBasisDigest: parse(
      row.production_provenance_json,
      'P9_PRODUCT_DELIVERY_PROVENANCE',
    ).runExecutionBasisDigest,
    subjectId: row.subject_id,
    shelfId: row.shelf_id,
    acceptanceSpecRef: {
      id: row.acceptance_spec_id,
      recordDigest: row.acceptance_spec_record_digest,
    },
    resolvedIdentitySnapshot,
    productStructureSnapshot: structure,
    runMaterialManifestRef: {
      id: row.run_material_manifest_id,
      digest: row.run_material_manifest_digest,
    },
    productMaterialManifest,
    productFactManifest,
    artifactManifest,
    mediaCastSnapshot: {
      mediaCastFactId: cast.productFactId,
      mediaCastFactRevision: cast.factRevision,
      schemaRef: cast.schemaRef,
      factValue: cast.factValue,
      factDigest: cast.factDigest,
      evidenceDigest: cast.evidenceDigest,
      relations: cast.factValue.relations,
      relationsDigest: cast.factValue.relationsDigest,
    },
    offloadContextManifest,
    productionProvenance,
    productionAttestation,
    packageDigest: row.package_digest,
  };
  if (productFactManifest.manifestDigest !== row.product_fact_manifest_digest ||
      artifactManifest.manifestDigest !== row.artifact_manifest_digest ||
      offloadContextManifest.manifestDigest !== row.offload_context_digest ||
      structure.productStructureDigest !== row.product_structure_digest ||
      productionProvenance.provenanceDigest !== row.production_provenance_digest ||
      productionAttestation.attestationDigest !== row.attestation_digest) {
    fail('P9_PRODUCT_DELIVERY_MANIFEST_CORRUPT', 'Package relation manifest reconstruction drifted.');
  }
  try {
    verifyOnDeckProductPackageDigest(packageValue);
  } catch (error) {
    fail('P9_PRODUCT_DELIVERY_PACKAGE_DIGEST',
      'Product Delivery does not reconstruct the immutable complete Package.', {
        cause: error.code,
      });
  }
  return Object.freeze(packageValue);
}

function deliveryFence(repo, row, packageValue) {
  const run = repo.invoke('find_run', { libra_run_id: row.libra_run_id });
  const receipt = repo.invoke('find_delivery', { on_deck_package_id: row.on_deck_package_id });
  let eligibility = 'eligible';
  let reasonCode;
  if (!run || run.state !== 'active') {
    eligibility = 'ineligible';
    reasonCode = 'run_not_active';
  } else if (run.acceptance_spec_id !== row.acceptance_spec_id) {
    eligibility = 'ineligible';
    reasonCode = 'spec_not_current';
  } else if (number(run.package_revision_head) !== number(row.package_revision)) {
    eligibility = 'ineligible';
    reasonCode = 'package_not_current';
  } else if (receipt) {
    eligibility = 'ineligible';
    reasonCode = 'delivery_already_terminal';
  }
  const value = {
    eligibility,
    ...(reasonCode ? { reasonCode } : {}),
    libraRunId: row.libra_run_id,
    runState: run?.state || 'completed',
    runStateRevision: number(run?.state_revision || row.run_state_revision),
    runStateDigest: run?.state_digest || row.run_state_digest,
    acceptanceSpecId: row.acceptance_spec_id,
    packageRevisionHead: number(run?.package_revision_head || row.package_revision),
    deliveryReceiptAbsent: !receipt,
  };
  value.fenceDigest = canonicalDigest(value);
  return Object.freeze(value);
}

function createProductDeliveryReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P9_PRODUCT_DELIVERY_DEPENDENCIES', 'Product Delivery reader requires Libra persistence.');
  }
  const repository = definition(options.schemaManifest);
  function readPackage(input) {
    const query = exactQuery(input);
    return options.unitOfWork.execute([{
      participantId: 'libra_product_delivery_read',
      owner: 'libra',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const row = repo.invoke('find_package', {
          on_deck_package_id: query.onDeckPackageId,
        });
        if (!row) return Object.freeze({
          resultKind: 'not_found',
          reasonCode: 'package_missing',
          checkedAtMs: context.commitTimeMs,
        });
        if (row.offer_id !== query.offerId ||
            number(row.package_revision) !== query.expectedPackageRevision ||
            row.package_digest !== query.expectedPackageDigest) {
          fail('P9_PRODUCT_DELIVERY_INTEGRITY', 'Product Delivery query identity conflicts with the immutable Package.');
        }
        const onDeckProductPackage = reconstruct(repo, row);
        const fence = query.readPurpose === 'historical'
          ? null
          : deliveryFence(repo, row, onDeckProductPackage);
        const result = {
          resultKind: 'found',
          onDeckProductPackage,
          deliveryFence: fence,
          readDigest: canonicalDigest({
            schema: 'libra.product-delivery-read@1',
            query,
            packageDigest: onDeckProductPackage.packageDigest,
            deliveryFence: fence,
          }),
        };
        return Object.freeze(result);
      },
    }]).libra_product_delivery_read;
  }
  return Object.freeze({ readPackage });
}

module.exports = Object.freeze({
  ProductDeliveryReaderError,
  createProductDeliveryReader,
});
