'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  createDeliverablePromotionStore,
} = require('../../src/helix/domains/libra/persistence/deliverable-promotion-store');
const {
  createProductDeliveryReader,
} = require('../../src/helix/domains/libra/persistence/product-delivery-reader');
const {
  assertPromotionDecision,
  onDeckProductPackageDigest,
} = require('../../src/helix/domains/libra/model/delivery-lifecycle-contracts');

const serviceRoot = path.resolve(__dirname, '../..');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.join(
  serviceRoot,
  'src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

const D = (value) => canonicalDigest({ value });
const NOW = 1_700_000_000_000;

function complete(value, field) {
  const result = { ...value };
  result[field] = canonicalDigest(result);
  return result;
}

function controlProjection(materialKey) {
  const value = {
    materialKey,
    resultKind: 'available',
    controlRevision: 1,
    controlState: 'controlled',
    ownerDomain: 'libra',
    ownerScopeType: 'subject',
    ownerScopeId: 'subject-1',
    regionProjection: 'production',
  };
  const evidence = {
    schema: 'foundation.material-control-evidence@1',
    materialKey,
    resultKind: value.resultKind,
    controlRevision: value.controlRevision,
    controlState: value.controlState,
    ownerDomain: value.ownerDomain,
    ownerScopeType: value.ownerScopeType,
    ownerScopeId: value.ownerScopeId,
  };
  const withEvidence = { ...value, evidenceDigest: canonicalDigest(evidence) };
  return { ...withEvidence, projectionDigest: canonicalDigest(withEvidence) };
}

function fixtureValue() {
  const physical = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion: 2,
    materialKey: '',
    mountScopeId: 'mount-1',
    inode: '1',
    sizeBytes: 100,
    fingerprintAlgorithm: 'middle-256k-sha256',
    fingerprintVersion: 1,
    contentFingerprint: D('movie-bytes'),
  };
  physical.materialKey = canonicalDigest({
    schema: 'physical-material-identity@2',
    mountScopeId: physical.mountScopeId,
    inode: physical.inode,
    sizeBytes: physical.sizeBytes,
    fingerprintAlgorithm: physical.fingerprintAlgorithm,
    fingerprintVersion: physical.fingerprintVersion,
    contentFingerprint: physical.contentFingerprint,
  });
  const control = controlProjection(physical.materialKey);
  const identityFact = {
    schemaRef: 'helix://contracts/types/ResolvedProductIdentity/v1',
    schemaVersion: 1,
    subjectId: 'subject-1',
    structureKind: 'single',
    contentProfile: 'movie',
    identityKind: 'weak_title',
    providerIdentities: [],
    providerIdentitySetDigest: canonicalDigest({
      schema: 'libra.resolved-provider-identity-set@1',
      items: [],
    }),
    exactSeasonContinuityClaims: [],
    exactSeasonContinuitySetDigest: D('season-continuity'),
    displayIdentity: 'Example Movie',
  };
  identityFact.identityDigest = canonicalDigest({
    schema: 'libra.resolved-product-identity@1',
    subjectId: identityFact.subjectId,
    structureKind: identityFact.structureKind,
    contentProfile: identityFact.contentProfile,
    identityKind: identityFact.identityKind,
    providerIdentities: identityFact.providerIdentities,
    providerIdentitySetDigest: identityFact.providerIdentitySetDigest,
    exactSeasonContinuityClaims: identityFact.exactSeasonContinuityClaims,
    exactSeasonContinuitySetDigest: identityFact.exactSeasonContinuitySetDigest,
    displayIdentity: identityFact.displayIdentity,
  });
  const castFact = {
    schemaRef: 'helix://contracts/types/MediaCastFact/v1',
    schemaVersion: 1,
    factId: 'cast-fact-1',
    subjectId: 'subject-1',
    relations: [],
    relationsDigest: canonicalDigest({ schema: 'libra.media-cast-relations@1', relations: [] }),
    relationCount: 0,
    factDigest: '',
  };
  castFact.factDigest = canonicalDigest({
    schema: 'libra.media-cast-fact@1',
    subjectId: castFact.subjectId,
    relations: castFact.relations,
    relationsDigest: castFact.relationsDigest,
    relationCount: 0,
  });
  const metadataFact = {
    schemaRef: 'helix://contracts/types/ProductMetadataFact/v1',
    schemaVersion: 1,
    factId: 'metadata-fact-1',
    subjectId: 'subject-1',
    descriptiveFacts: {
      schemaRef: 'helix://contracts/records/descriptive-facts/v1',
      schemaVersion: 1,
      recordKind: 'descriptive-facts',
      recordDigest: D('descriptive'),
      entries: [{ key: 'title', value: 'Example Movie' }],
    },
    providerIdentities: [],
    factDigest: D('metadata-fact'),
  };
  const factItems = [
    {
      productFactId: 'cast-fact-1',
      factKind: 'media_cast',
      factRevision: 1,
      schemaRef: castFact.schemaRef,
      factValue: castFact,
      factDigest: castFact.factDigest,
      evidenceDigest: D('cast-evidence'),
    },
    {
      productFactId: 'metadata-fact-1',
      factKind: 'product_metadata',
      factRevision: 1,
      schemaRef: metadataFact.schemaRef,
      factValue: metadataFact,
      factDigest: metadataFact.factDigest,
      evidenceDigest: D('metadata-evidence'),
    },
    {
      productFactId: 'identity-fact-1',
      factKind: 'resolved_identity',
      factRevision: 1,
      schemaRef: identityFact.schemaRef,
      factValue: identityFact,
      factDigest: identityFact.identityDigest,
      evidenceDigest: D('identity-evidence'),
    },
  ].sort((left, right) => Buffer.compare(Buffer.from(left.factKind), Buffer.from(right.factKind)));
  factItems.forEach((item) => {
    item.referenceDigest = canonicalDigest(item);
  });
  const productFactManifest = {
    manifestId: 'product-facts-1',
    manifestRevision: 1,
    libraRunId: 'run-1',
    items: factItems,
    factSetDigest: canonicalDigest({ schema: 'libra.product-fact-set@1', items: factItems }),
  };
  productFactManifest.manifestDigest = canonicalDigest(productFactManifest);
  const member = {
    ordinal: 0,
    materialKey: physical.materialKey,
    role: 'primary_payload',
    physicalIdentity: physical,
    sizeBytes: 100,
    location: {
      locationKind: 'domain_binding',
      endpointId: 'endpoint-1',
      location: 'movie.mkv',
      rootHandleRef: null,
      relativePath: null,
    },
    bindingKind: 'libra_material_binding',
    bindingRevision: 1,
    originCandidateDeliveryRef: {
      intakeDecisionId: 'intake-1',
      offerId: 'candidate-offer-1',
      candidatePackageId: 'candidate-1',
      packageRevision: 1,
      packageDigest: D('candidate'),
      candidateDeliverySnapshotDigest: D('candidate-delivery'),
      relatedReferenceSetDigest: D('related'),
    },
    workspaceReferenceId: null,
    workspaceMaterialHandle: null,
    sourceRelatedReferenceId: null,
    derivedAuthorityDigest: null,
    admittedControlRevision: 1,
    admittedControlProjectionDigest: control.projectionDigest,
    bindingEvidenceDigest: D('binding'),
    episodeClaims: [],
    episodeClaimSetDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claims@1',
      items: [],
    }),
    outputRequirementDigest: D('output-requirement'),
    controlOperation: 'assert_existing_input',
    expectedControlRevision: 1,
    expectedControlProjectionDigest: control.projectionDigest,
    committedControlRevision: 1,
    committedControlProjectionDigest: control.projectionDigest,
  };
  member.memberDigest = canonicalDigest(member);
  const productMaterialManifest = {
    manifestId: 'product-materials-1',
    manifestRole: 'product_delivery',
    manifestRevision: 1,
    libraRunId: 'run-1',
    scopeKind: 'single',
    members: [member],
    memberSetDigest: canonicalDigest({
      schema: 'libra.production-material-members@1',
      items: [member],
    }),
    episodeScopeDigest: canonicalDigest({
      schema: 'libra.production-episode-scope@1',
      items: [],
    }),
  };
  productMaterialManifest.manifestDigest = canonicalDigest(productMaterialManifest);
  const artifactManifest = {
    manifestId: 'artifacts-1',
    manifestRevision: 1,
    libraRunId: 'run-1',
    items: [],
    artifactSetDigest: canonicalDigest({ schema: 'libra.product-artifact-set@1', items: [] }),
  };
  artifactManifest.manifestDigest = canonicalDigest(artifactManifest);
  const offloadMember = {
    ordinal: 0,
    materialKey: physical.materialKey,
    contextRole: 'original_input',
    sourceRelatedReferenceId: null,
    finalProductMaterialKey: physical.materialKey,
    dispositionKind: 'carried_forward',
    physicalIdentity: physical,
    endpointId: 'endpoint-1',
    location: 'movie.mkv',
    bindingRevision: 1,
    bindingEvidenceDigest: D('binding'),
    admittedControlRevision: 1,
    admittedControlProjectionDigest: control.projectionDigest,
    derivedAuthorityDigest: null,
    settlementExpectation: 'replace_or_move',
  };
  offloadMember.memberDigest = canonicalDigest(offloadMember);
  const offloadContextManifest = {
    manifestId: 'offload-1',
    manifestRevision: 1,
    libraRunId: 'run-1',
    members: [offloadMember],
    memberSetDigest: canonicalDigest({
      schema: 'libra.offload-context-members@1',
      items: [offloadMember],
    }),
  };
  offloadContextManifest.manifestDigest = canonicalDigest(offloadContextManifest);
  const structure = complete({
    structureKind: 'single',
    contentProfile: 'movie',
    productScopeDigest: D('product-scope'),
    episodeScopeDigest: productMaterialManifest.episodeScopeDigest,
    primaryMaterialCount: 1,
    structuralDependencyCount: 0,
  }, 'productStructureDigest');
  const provenance = {
    libraRunId: 'run-1',
    runExecutionBasisDigest: D('run-basis'),
    acceptanceSpecRecordDigest: D('spec-record'),
    workflowPlanRefs: [],
    productVerificationRefs: [{ verificationId: 'media-verify-1', verificationDigest: D('media-verify') }],
    externalRealityObservationRefs: [{ evidenceId: 'probe-1', evidenceDigest: D('probe') }],
  };
  provenance.provenanceDigest = canonicalDigest(provenance);
  const attestation = {
    attestationId: '',
    libraRunId: 'run-1',
    onDeckPackageId: '',
    acceptanceSpecId: 'spec-1',
    acceptanceSpecRecordDigest: D('spec-record'),
    productConformanceEvidenceId: 'conformance-1',
    productConformanceEvidenceDigest: D('conformance'),
    evaluatedRequirementSetDigest: D('requirements'),
    productSnapshotDigest: D('product-snapshot'),
    unmetRequirementCount: 0,
    unmetRequirementCodes: [],
    acceptanceKind: 'accepted',
    authorizedDefectManifest: null,
    attestedAtMs: NOW,
    attestationDigest: '',
  };
  const controlItems = [{
    controlOperation: 'assert_existing_input',
    materialKey: physical.materialKey,
    expectedControlRevision: 1,
    expectedControlProjectionDigest: control.projectionDigest,
    ownerDomain: 'libra',
    ownerScopeType: 'subject',
    ownerScopeId: 'subject-1',
  }];
  const controlCommitScope = {
    items: controlItems,
    controlScopeDigest: '',
  };
  const onDeckPackageId = canonicalDigest({
    schema: 'libra.on-deck-package-id@1',
    libraRunId: 'run-1',
    packageRevision: 1,
  });
  controlCommitScope.controlScopeDigest = canonicalDigest({
    schema: 'libra.product-control-commit-scope@1',
    libraRunId: 'run-1',
    onDeckPackageId,
    items: controlItems,
  });
  attestation.onDeckPackageId = onDeckPackageId;
  attestation.attestationId = canonicalDigest({
    schema: 'libra.production-attestation-id@1',
    libraRunId: 'run-1',
    onDeckPackageId,
    productConformanceEvidenceId: attestation.productConformanceEvidenceId,
    productConformanceEvidenceDigest: attestation.productConformanceEvidenceDigest,
  });
  attestation.attestationDigest = canonicalDigest(Object.fromEntries(
    Object.entries(attestation).filter(([key]) => key !== 'attestationDigest'),
  ));
  const decision = {
    decisionId: '',
    libraRunRef: {
      libraRunId: 'run-1',
      stateRevision: 1,
      stateDigest: D('run-state'),
      executionBasisDigest: D('run-basis'),
      runScopeDigest: D('run-scope'),
      expectedPackageRevisionHead: 0,
    },
    runMaterialManifestRef: { manifestId: 'run-materials-1', manifestDigest: D('run-manifest') },
    workspaceRef: null,
    productStagingReferences: [],
    acceptanceSpecRef: { acceptanceSpecId: 'spec-1', recordDigest: D('spec-record') },
    resolvedIdentitySnapshot: factItems.find((item) => item.factKind === 'resolved_identity'),
    productStructureSnapshot: structure,
    productFactManifest,
    artifactManifest,
    mediaCastSnapshot: {
      mediaCastFactId: 'cast-fact-1',
      mediaCastFactRevision: 1,
      schemaRef: castFact.schemaRef,
      factValue: castFact,
      factDigest: castFact.factDigest,
      evidenceDigest: D('cast-evidence'),
      relations: [],
      relationsDigest: castFact.relationsDigest,
    },
    productMaterialManifest,
    offloadContextManifest,
    relatedAuthorityAssertions: [],
    relatedDispositionSetDigest: canonicalDigest({ schema:'libra.related-disposition-set@1', items:[] }),
    productionProvenance: provenance,
    productionAttestation: attestation,
    controlCommitScope,
    onDeckPackageId,
    packageRevision: 1,
    packageDigest: '',
    offerId: '',
    decisionDigest: '',
  };
  decision.packageDigest = onDeckProductPackageDigest(decision, 'subject-1', 'shelf-1');
  decision.offerId = canonicalDigest({
    schema: 'libra.product-offer-id@1',
    onDeckPackageId,
    packageDigest: decision.packageDigest,
  });
  decision.decisionId = canonicalDigest({
    schema: 'libra.deliverable-promotion-decision-id@1',
    libraRunId: 'run-1',
    packageRevision: 1,
    packageDigest: decision.packageDigest,
    controlScopeDigest: controlCommitScope.controlScopeDigest,
  });
  decision.decisionDigest = canonicalDigest(Object.fromEntries(
    Object.entries(decision).filter(([key]) => key !== 'decisionDigest'),
  ));
  const handle = {
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
    schemaVersion: 1,
    handleId: 'promotion-control-1',
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: 'run-1',
    operationKind: 'replace_control_set',
    basisRef: {
      objectType: 'deliverable_promotion',
      objectId: decision.decisionId,
      revision: 1,
      digest: decision.decisionDigest,
    },
    basisDigest: decision.decisionDigest,
    canonicalFactSetDigest: productFactManifest.factSetDigest,
    bindingSetDigest: productMaterialManifest.memberSetDigest,
    controlScopeDigest: controlCommitScope.controlScopeDigest,
    expectedControlRevisions: [{ materialKey: physical.materialKey, revision: 1 }],
    receiptContract: {
      receiptSchemaRef: RESULT_SCHEMA,
      controlRevisionSetSchemaRef: 'libra.product-control-revision-set@1',
    },
    eventFenceDigest: D('promotion-event-fence'),
  };
  return { control, decision, handle, physical };
}

const RESULT_SCHEMA = 'helix://contracts/types/OnDeckProductPackageCommitReceipt/v1';

test('rejects Episode claims on a non-primary Product member', () => {
  const decision = JSON.parse(JSON.stringify(fixtureValue().decision));
  const member = decision.productMaterialManifest.members[0];
  const claim = {
    episodeKey: 'E001',
    seasonClaimDigest: D('season-1'),
    claimDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claim@1',
      episodeKey: 'E001',
      seasonClaimDigest: D('season-1'),
    }),
  };
  member.role = 'metadata_sidecar';
  member.episodeClaims = [claim];
  member.episodeClaimSetDigest = canonicalDigest({
    schema: 'libra.production-material-episode-claims@1',
    items: [claim],
  });
  assert.throws(
    () => assertPromotionDecision(decision),
    (error) => error.code === 'P9_PROMOTION_EPISODE_ROLE',
  );
});

function withDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p9-promotion-'));
  const databasePath = path.join(root, 'db.sqlite');
  let now = NOW;
  const kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now: () => now++,
  });
  try {
    const value = fixtureValue();
    seed(databasePath, value);
    return run({
      ...value,
      databasePath,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
    });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seed(databasePath, value) {
  const database = new Database(databasePath);
  database.pragma('foreign_keys = OFF');
  const prepare = (statement) => database.prepare(statement);
  try {
    prepare(`INSERT INTO libra_subjects
      (subject_id,structure_kind,content_profile,status,intake_revision,
       current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      'subject-1', 'single', 'movie', 'active', 1, D('continuity'), D('episodes'), 1, 1,
    );
    prepare(`INSERT INTO libra_intake_decisions
      (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,
       package_revision,package_digest,acceptance_basis_digest,
       candidate_delivery_snapshot_digest,candidate_structure_kind,
       candidate_content_profile,candidate_identity_claim_digest,
       expected_continuity_head_revision,expected_continuity_head_digest,
       committed_continuity_head_revision,candidate_continuity_set_digest,
       candidate_episode_scope_digest,match_cardinality,matched_subject_set_digest,
       episode_overlap_digest,accepted_result,target_subject_id,
       committed_target_intake_revision,committed_subject_continuity_set_digest,
       committed_subject_episode_scope_digest,accepted_payload_digest,decision_digest,
       decided_at_ms,candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
       decision_identity_evidence_schema_ref,decision_identity_evidence_json,
       decision_identity_evidence_digest)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'intake-1', 1, 'accepted_resolution', 'candidate-offer-1', 'candidate-1',
      1, D('candidate'), D('acceptance-basis'), D('candidate-delivery'),
      'single', 'movie', D('identity-claim'), 0, D('continuity-head'), 1,
      D('continuity'), D('episodes'), 'none', D('matched-subjects'),
      D('overlap'), 'new_subject', 'subject-1', 1, D('continuity'), D('episodes'),
      D('accepted-payload'), D('intake-decision'), 1,
      'helix://contracts/types/CandidateDeliverySnapshot/v1', '{}',
      'helix://contracts/types/DecisionIdentityEvidenceSnapshot/v1', '{}',
      D('decision-identity-evidence'),
    );
    prepare(`INSERT INTO libra_decision_basis_revisions
      (decision_basis_id,subject_id,basis_kind,basis_revision,expected_head_revision,
       expected_head_snapshot_digest,routing_decision_id,query_result_set_digest,
       routing_input_digest,spec_input_digest,product_scope_digest,input_set_digest,
       status,basis_digest,committed_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'basis-1', 'subject-1', 'acceptance_spec', 1, 0, D('basis-head'),
      'routing-decision-1', D('queries'), D('routing-input'), D('spec-input'),
      D('product-scope'), D('basis-inputs'), 'ready', D('basis-record'), 1,
    );
    const spec = {
      schemaRef: 'libra.acceptance-spec@1',
      schemaVersion: 1,
      acceptanceSpecId: 'spec-1',
      specRevision: 1,
      recordDigest: D('spec-record'),
    };
    prepare(`INSERT INTO libra_acceptance_specs
      (acceptance_spec_id,subject_id,shelf_id,shelf_routing_projection_revision,
       shelf_projection_digest,shelf_standard_revision,shelf_standard_digest,
       decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,
       spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'spec-1', 'subject-1', 'shelf-1', 1, D('shelf-projection'), 1, D('standard'),
      'basis-1', D('product-scope'), 1, 'libra.acceptance-spec@1',
      canonicalJson(spec), D('spec'), D('spec-record'), 'single', 'movie', 1,
    );
    prepare(`INSERT INTO libra_run_material_manifests
      (run_material_manifest_id,libra_run_id,manifest_role,scope_kind,manifest_revision,
       member_count,member_set_digest,episode_scope_digest,manifest_digest,published_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'run-materials-1', 'run-1', 'run_input', 'single', 1, 1,
      D('run-members'), D('episodes'), D('run-manifest'), 1,
    );
    prepare(`INSERT INTO libra_runs
      (libra_run_id,subject_id,admission_revision,acceptance_spec_id,
       run_material_manifest_id,execution_basis_schema_ref,execution_basis_record_json,
       execution_basis_digest,run_scope_digest,state,state_revision,state_digest,
       package_revision_head,priority_class,priority_intent_digest,recovery_policy_ref,
       recovery_policy_digest,recovery_attempt_ordinal,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'run-1', 'subject-1', 1, 'spec-1', 'run-materials-1',
      'libra.run-execution-basis@1', canonicalJson({ executionBasisDigest:D('run-basis'), relatedDispositionScope:{
        relatedReferenceSetDigest:canonicalDigest({ schema:'procurement.related-reference-set@1', items:[] }),
        relatedDispositionScopeDigest:canonicalDigest({ schema:'procurement.related-disposition-scope@1', items:[] }), items:[] } }),
      D('run-basis'), D('run-scope'),
      'active', 1, D('run-state'), 0, 'normal', D('priority'),
      'libra.default-recovery@1', D('recovery'), 0, 1,
    );
    prepare(`INSERT INTO libra_run_revisions
      (libra_run_id,state_revision,state,acceptance_spec_id,execution_basis_digest,
       run_scope_digest,priority_class,priority_intent_digest,transition_kind,
       transition_decision_id,transition_decision_digest,recovery_policy_ref,
       recovery_policy_digest,recovery_attempt_ordinal,expected_admission_head_revision,
       expected_active_scope_set_digest,committed_admission_head_revision,
       committed_active_scope_set_digest,revision_digest,committed_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'run-1', 1, 'active', 'spec-1', D('run-basis'), D('run-scope'), 'normal',
      D('priority'), 'admitted', 'run-admission-1', D('run-admission'),
      'libra.default-recovery@1', D('recovery'), 0, 0, D('empty-scope'), 1,
      D('active-scope'), D('run-revision'), 1,
    );
    for (const item of value.decision.productFactManifest.items) {
      prepare(`INSERT INTO fx_commit_markers
        (commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,
         result_id,result_schema_ref,result_digest,committed_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        item.productFactId + ':marker', null, 'libra', 'product_fact',
        item.productFactId, D(item.productFactId + ':commit'), null, null, null, 1,
      );
      prepare(`INSERT INTO libra_product_fact_revisions
        (product_fact_id,libra_run_id,fact_kind,fact_revision,aggregate_id,schema_ref,
         fact_json,fact_digest,evidence_digest,source_basis_kind,source_basis_id,
         source_basis_digest,source_ref_count,artifact_verification_result_count,
         commit_payload_schema_ref,commit_payload_digest,event_fence_digest,
         commit_marker,result_digest,committed_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        item.productFactId, 'run-1', item.factKind, item.factRevision,
        'run-1:' + item.factKind, item.schemaRef, canonicalJson(item.factValue),
        item.factDigest, item.evidenceDigest, 'metadata_observation',
        item.productFactId + ':basis', D(item.productFactId + ':basis'), 0, 0,
        'libra.product-fact-commit@1', D(item.productFactId + ':payload'),
        D(item.productFactId + ':fence'), item.productFactId + ':marker',
        canonicalDigest(item.factValue), 1,
      );
    }
    prepare(`INSERT INTO fx_material_controls
      (material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,
       owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      value.physical.materialKey, value.physical.mountScopeId, value.physical.inode,
      value.physical.sizeBytes, value.physical.fingerprintAlgorithm, value.physical.fingerprintVersion, value.physical.contentFingerprint,
      'libra', 'subject', 'subject-1', 1, 'controlled', 1,
    );
    prepare(`INSERT INTO fx_material_control_revisions
      (material_key,revision,operation_kind,to_owner_domain,to_scope_type,to_scope_id,
       basis_digest,commit_marker,committed_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      value.physical.materialKey, 1, 'acquire', 'libra', 'subject', 'subject-1',
      D('intake-control'), 'intake-marker', 1,
    );
    assert.deepEqual(database.pragma('foreign_key_check'), [], 'promotion fixture seed must conserve every FK');
  } finally {
    database.close();
  }
}

function request(value) {
  return {
    transactionId: 'helix.transaction.libra-deliverable-promotion',
    decision: value.decision,
    controlCommitHandle: value.handle,
    commitMarker: {
      commitMarker: 'promotion-marker-1',
      effectId: D('promotion-effect'),
      commitDigest: value.decision.decisionDigest,
    },
    resultId: 'promotion-result-1',
  };
}

function dropTableTriggers(database, tableId) {
  const triggers = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?",
  ).all(tableId);
  for (const trigger of triggers) {
    database.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
  }
}

function readRequest(value) {
  return {
    queryContract: 'libra.product-delivery@1',
    readPurpose: 'historical',
    offerId: value.decision.offerId,
    onDeckPackageId: value.decision.onDeckPackageId,
    expectedPackageRevision: 1,
    expectedPackageDigest: value.decision.packageDigest,
  };
}

test('commits one immutable Package, Offer, Result, marker and exact historical read atomically', () =>
  withDatabase((value) => {
    const store = createDeliverablePromotionStore({
      schemaManifest,
      unitOfWork: value.unitOfWork,
    });
    const first = store.publish(request(value));
    const replay = store.publish(request(value));
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, first.receipt);
    const reader = createProductDeliveryReader({
      schemaManifest,
      unitOfWork: value.unitOfWork,
    });
    const read = reader.readPackage(readRequest(value));
    assert.equal(read.resultKind, 'found');
    assert.equal(read.deliveryFence, null);
    assert.equal(read.onDeckProductPackage.onDeckPackageId, value.decision.onDeckPackageId);
    assert.equal(read.onDeckProductPackage.productMaterialManifest.members.length, 1);
    assert.equal(first.receipt.receiptId, canonicalDigest({
      schema: 'libra.product-package-commit-receipt-id@1',
      onDeckPackageId: value.decision.onDeckPackageId,
      packageRevision: 1,
    }));
    assert.equal(first.receipt.scopeDigest, value.decision.decisionDigest);
    const db = new Database(value.databasePath, { readonly: true });
    try {
      assert.equal(db.prepare('SELECT package_revision_head FROM libra_runs').get().package_revision_head, 1);
      for (const table of [
        'libra_product_packages', 'libra_product_package_materials',
        'libra_offload_context_materials',
        'fx_event_result_bindings', 'fx_outbox',
      ]) {
        assert.equal(db.prepare(`SELECT count(*) count FROM ${table}`).get().count, 1, table);
      }
      assert.equal(db.prepare('SELECT count(*) count FROM libra_product_package_fact_refs').get().count, 3);
      assert.equal(db.prepare('SELECT count(*) count FROM fx_commit_markers').get().count, 4);
      assert.equal(db.prepare('SELECT count(*) count FROM fx_material_control_revisions').get().count, 1);
    } finally {
      db.close();
    }
  }));

test('historical Product Delivery recomputes the complete Package and excludes only commit time', async (t) => {
  const cases = [
    {
      name: 'Shelf identity',
      tables: ['libra_product_packages'],
      mutate(database) {
        database.prepare('UPDATE libra_product_packages SET shelf_id=?').run('tampered-shelf');
      },
    },
    {
      name: 'Run Material reference',
      tables: ['libra_product_packages'],
      mutate(database) {
        database.prepare(
          'UPDATE libra_product_packages SET run_material_manifest_digest=?',
        ).run(D('tampered-run-manifest'));
      },
    },
    {
      name: 'Product Fact Manifest identity',
      tables: ['libra_product_packages'],
      mutate(database) {
        database.prepare(
          'UPDATE libra_product_packages SET product_fact_manifest_id=?',
        ).run('tampered-product-facts');
      },
    },
    {
      name: 'Production Provenance',
      tables: ['libra_product_packages'],
      mutate(database) {
        const row = database.prepare(
          'SELECT production_provenance_json FROM libra_product_packages',
        ).get();
        const provenance = JSON.parse(row.production_provenance_json);
        provenance.acceptanceSpecRecordDigest = D('tampered-provenance-spec');
        delete provenance.provenanceDigest;
        provenance.provenanceDigest = canonicalDigest(provenance);
        database.prepare(`UPDATE libra_product_packages
          SET production_provenance_json=?, production_provenance_digest=?`).run(
          canonicalJson(provenance), provenance.provenanceDigest,
        );
      },
    },
    {
      name: 'Production Attestation',
      tables: ['libra_product_packages'],
      mutate(database) {
        const row = database.prepare(
          'SELECT attestation_json FROM libra_product_packages',
        ).get();
        const attestation = JSON.parse(row.attestation_json);
        attestation.productSnapshotDigest = D('tampered-product-snapshot');
        delete attestation.attestationDigest;
        attestation.attestationDigest = canonicalDigest(attestation);
        database.prepare(`UPDATE libra_product_packages
          SET attestation_json=?, attestation_digest=?`).run(
          canonicalJson(attestation), attestation.attestationDigest,
        );
      },
    },
    {
      name: 'Product member committed Control',
      tables: ['libra_product_package_materials', 'libra_product_packages'],
      mutate(database, value) {
        const member = structuredClone(value.decision.productMaterialManifest.members[0]);
        member.committedControlProjectionDigest = D('tampered-committed-control');
        delete member.memberDigest;
        member.memberDigest = canonicalDigest(member);
        const manifest = structuredClone(value.decision.productMaterialManifest);
        manifest.members = [member];
        manifest.memberSetDigest = canonicalDigest({
          schema: 'libra.production-material-members@1',
          items: manifest.members,
        });
        delete manifest.manifestDigest;
        manifest.manifestDigest = canonicalDigest(manifest);
        database.prepare(`UPDATE libra_product_package_materials
          SET committed_control_projection_digest=?, member_digest=?`).run(
          member.committedControlProjectionDigest, member.memberDigest,
        );
        database.prepare(`UPDATE libra_product_packages
          SET product_material_manifest_digest=?`).run(manifest.manifestDigest);
      },
    },
  ];
  for (const item of cases) {
    await t.test(item.name, () => withDatabase((value) => {
      const store = createDeliverablePromotionStore({
        schemaManifest,
        unitOfWork: value.unitOfWork,
      });
      store.publish(request(value));
      const database = new Database(value.databasePath);
      try {
        database.pragma('foreign_keys = OFF');
        item.tables.forEach((tableId) => dropTableTriggers(database, tableId));
        item.mutate(database, value);
      } finally {
        database.close();
      }
      const reader = createProductDeliveryReader({
        schemaManifest,
        unitOfWork: value.unitOfWork,
      });
      assert.throws(() => reader.readPackage(readRequest(value)),
        /reconstruct|drift|immutable complete Package/i);
    }));
  }

  await t.test('publishedAtMs commit metadata', () => withDatabase((value) => {
    const store = createDeliverablePromotionStore({
      schemaManifest,
      unitOfWork: value.unitOfWork,
    });
    store.publish(request(value));
    const database = new Database(value.databasePath);
    try {
      dropTableTriggers(database, 'libra_product_packages');
      database.prepare('UPDATE libra_product_packages SET published_at_ms=published_at_ms+99').run();
    } finally {
      database.close();
    }
    const reader = createProductDeliveryReader({
      schemaManifest,
      unitOfWork: value.unitOfWork,
    });
    const read = reader.readPackage(readRequest(value));
    assert.equal(read.resultKind, 'found');
    assert.equal(read.onDeckProductPackage.packageDigest, value.decision.packageDigest);
  }));
});

test('rolls every participant back when package write fails after Control assertion', () =>
  withDatabase((value) => {
    const crashing = {
      execute(participants) {
        return value.unitOfWork.execute(participants.map((participant) =>
          participant.participantId !== 'libra_deliverable_promotion_write'
            ? participant
            : {
              ...participant,
              execute() {
                throw new Error('fault-after-control-before-package');
              },
            }));
      },
    };
    const store = createDeliverablePromotionStore({ schemaManifest, unitOfWork: crashing });
    assert.throws(() => store.publish(request(value)), /fault-after-control-before-package/);
    const db = new Database(value.databasePath, { readonly: true });
    try {
      assert.equal(db.prepare('SELECT package_revision_head FROM libra_runs').get().package_revision_head, 0);
      for (const table of [
        'libra_product_packages', 'libra_product_package_materials',
        'libra_product_package_fact_refs', 'libra_offload_context_materials',
        'fx_event_result_bindings', 'fx_outbox',
      ]) {
        assert.equal(db.prepare(`SELECT count(*) count FROM ${table}`).get().count, 0, table);
      }
      assert.equal(db.prepare('SELECT count(*) count FROM fx_commit_markers').get().count, 3);
    } finally {
      db.close();
    }
  }));


test('Series Promotion refuses any absent or non-Primary target in a multiple Off-load mapping',()=>{
  for(const kind of ['missing','artifact','movie']){
    const decision=structuredClone(fixtureValue().decision),target=decision.productMaterialManifest.members[0];
    decision.productStructureSnapshot.structureKind=kind==='movie'?'single':'season';
    const second={...target,materialKey:D('second-target'),role:kind==='artifact'?'metadata_sidecar':'primary_payload',
      controlOperation:'acquire_workspace_product',episodeClaims:[{episodeKey:'E002'}]};
    target.role='primary_payload';target.controlOperation='acquire_workspace_product';target.episodeClaims=[{episodeKey:'E001'}];
    if(kind!=='missing')decision.productMaterialManifest.members.push(second);
    const source=decision.offloadContextManifest.members[0];delete source.finalProductMaterialKey;
    Object.assign(source,{finalProductMaterialKeys:[target.materialKey,second.materialKey].sort(),
      materialKey:D('original-source'),contextRole:'original_input',dispositionKind:'replaced_and_settled',settlementExpectation:'remove_after_place'});
    assert.throws(()=>assertPromotionDecision(decision),error=>error.code==='P9_PROMOTION_MULTIPLE_TARGETS');
  }
});


test('Off-load target persistence round-trips the full canonical list and rolls back one source row atomically',()=>withDatabase(value=>{
  const {writeOffloadTargets,readOffloadTargets}=require('../../src/helix/domains/libra/persistence/offload-target-storage');
  createDeliverablePromotionStore({schemaManifest,unitOfWork:value.unitOfWork}).publish(request(value));
  const db=new Database(value.databasePath);
  try{
    const original=db.prepare('SELECT * FROM libra_offload_context_materials').get();
    assert.deepEqual(readOffloadTargets(original),{finalProductMaterialKey:value.physical.materialKey});
    const keys=[D('new-one'),D('new-two')].sort(),source={materialKey:D('replaced'),contextRole:'original_input',
      dispositionKind:'replaced_and_settled',settlementExpectation:'remove_after_place',finalProductMaterialKeys:keys};
    const row={...original,ordinal:1,material_key:source.materialKey,disposition_kind:source.dispositionKind,
      settlement_expectation:source.settlementExpectation,...writeOffloadTargets(source)};
    const columns=Object.keys(row),insert=db.prepare('INSERT INTO libra_offload_context_materials ('+columns.join(',')+') VALUES ('+columns.map(key=>'@'+key).join(',')+')');
    assert.throws(()=>db.transaction(()=>{insert.run(row);throw new Error('injected after full target insert');})(),/injected/);
    assert.equal(db.prepare('SELECT count(*) AS count FROM libra_offload_context_materials').get().count,1);
    insert.run(row);
    const stored=db.prepare('SELECT * FROM libra_offload_context_materials WHERE ordinal=1').get();
    assert.deepEqual(readOffloadTargets(stored),{finalProductMaterialKeys:keys});
    assert.equal(stored.final_product_material_key,null);
    for(const changes of [{final_product_material_key:keys[0]},
      {final_product_material_keys_json:null},{final_product_material_keys_json:'[]'},
      {final_product_material_keys_json:JSON.stringify([keys[0]])},{final_product_material_keys_json:'{}'},
      {final_product_material_keys_schema_ref:null},{final_product_material_keys_schema_ref:'wrong'},
      {context_role:'related_input'},{disposition_kind:'carried_forward'},{settlement_expectation:'replace_or_move'}])
      assert.throws(()=>insert.run({...row,ordinal:2,material_key:D('invalid-source'),...changes}),/CHECK constraint failed/);
    for(const json of [JSON.stringify([...keys].reverse()),JSON.stringify([keys[0],keys[0]]),JSON.stringify(keys,null,2)])
      assert.throws(()=>readOffloadTargets({...stored,final_product_material_keys_json:json}));
    assert.equal(db.prepare('SELECT count(*) AS count FROM libra_offload_context_materials').get().count,2);
  }finally{db.close();}
}));


test('administrative retirement closes a genuinely published but unobserved Offer through exact public delivery proof', () =>
  withDatabase(value => {
    const { createArcaFormationRetirementStore } = require('../../src/helix/domains/arca/public');
    const store = createDeliverablePromotionStore({ schemaManifest, unitOfWork: value.unitOfWork });
    store.publish(request(value));
    const delivery = createProductDeliveryReader({ schemaManifest, unitOfWork: value.unitOfWork });
    const query = readRequest(value), proof = delivery.readPackage(query);
    const arca = createArcaFormationRetirementStore({ schemaManifest, unitOfWork: value.unitOfWork, readPublishedProduct: delivery.readPackage });
    const command = { retirementId:'reset-unobserved',offerId:query.offerId,packageId:query.onDeckPackageId,
      packageRevision:query.expectedPackageRevision,packageDigest:query.expectedPackageDigest,
      expectedSnapshotDigest:arca.inspect(query.offerId,query.onDeckPackageId).snapshotDigest,
      expectedDeliveryReadDigest:proof.readDigest,backupDigest:canonicalDigest({backup:1}),manifestDigest:canonicalDigest({manifest:1}) };
    assert.throws(() => arca.commit({...command,expectedDeliveryReadDigest:'f'.repeat(64)}), {code:'ARCA_RETIREMENT_OFFER_UNOBSERVED'});
    const result=arca.commit(command);
    assert.equal(result.receipt.resultRef.deliveryReadDigest,proof.readDigest);
    assert.equal(arca.commit(command).replayed,true);
    assert.equal(arca.inspect(query.offerId,query.onDeckPackageId).decisions.length,0,'No Handoff decision is fabricated');
    assert.equal(arca.readRetirementProof([{offerId:query.offerId,packageId:query.onDeckPackageId,packageDigest:query.expectedPackageDigest}])[0].disposition,'administratively_retired');
    assert.equal(arca.retiredAdmission({offerId:query.offerId,onDeckPackageId:query.onDeckPackageId,packageDigest:query.expectedPackageDigest}).kind,'administratively_retired');
  }));

// Seed a complete immutable target relation for commit-fence isolation. The
// confirmation Store separately tests the original requirement/Run/Head proof.
function seedCommittedCustomTarget(value){
  const db=new Database(value.databasePath);try{
    const run=db.prepare('SELECT * FROM libra_runs').get(),spec=db.prepare('SELECT * FROM libra_acceptance_specs').get(),
      requirements=require('../../src/helix/domains/arca/model/rule-template-contracts').BETA_RECOMMENDED_RULES.profileRuleSets
        .find(row=>row.contentProfile==='movie').decisionBranches.find(row=>row.rating===5).requirements,
      basis={subjectId:run.subject_id,libraRunId:run.libra_run_id,runState:run.state,runStateRevision:run.state_revision,
        runStateDigest:run.state_digest,runPackageRevisionHead:run.package_revision_head,runExecutionBasisDigest:run.execution_basis_digest,runAcceptanceSpecId:spec.acceptance_spec_id,
        runSpecRecordDigest:spec.record_digest,runSpecDigest:spec.spec_digest,baseAcceptanceSpecId:spec.acceptance_spec_id,
        baseSpecRecordDigest:spec.record_digest,baseSpecDigest:spec.spec_digest,decisionHeadDigest:D('head'),decisionHeadAcceptanceSpecId:spec.acceptance_spec_id,
        shelfId:spec.shelf_id,shelfStandardDigest:spec.shelf_standard_digest,shelfStandardRevision:spec.shelf_standard_revision,
        productScopeDigest:spec.product_scope_digest,materialSetDigest:D('members'),identityDigest:D('identity'),gapEvidenceSetDigest:D('gaps'),customTargetRevision:0,
        handoffState:db.prepare('SELECT count(*) n FROM libra_product_packages').get().n?'not_accepted':'no_offer',contentProfile:'movie',structureKind:'single'},
      {buildCustomTargetPreview,confirmCustomTarget}=require('../../src/helix/domains/libra/model/custom-target-records'),
      preview=buildCustomTargetPreview({basis,requirements,actorId:'admin',createdAtMs:NOW,
        proposals:[{change:require('../../src/helix/contracts/custom-acceptance-requirements').describeCustomRequirement(requirements,
          {requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}),evidenceRefs:[{resultId:'source-result',resultDigest:D('source-result')}]}]}),
      intent=confirmCustomTarget({preview,expectedPreviewDigest:preview.previewDigest,currentBasis:basis,
        selectedChangeDigests:preview.proposals.map(row=>row.changeDigest),actorId:'admin',idempotencyKey:'confirmed-target',acknowledged:true,confirmedAtMs:NOW+1});
    db.prepare('INSERT INTO libra_custom_target_previews(preview_id,subject_id,libra_run_id,actor_id,idempotency_key,request_digest,record_schema_ref,record_json,record_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(preview.previewDigest,run.subject_id,run.libra_run_id,'admin','target-preview',D('preview-request'),preview.schemaRef,canonicalJson(preview),preview.previewDigest,NOW);
    db.prepare('INSERT INTO libra_custom_target_intents(intent_id,preview_id,subject_id,libra_run_id,product_scope_digest,target_revision,actor_id,idempotency_key,request_digest,record_schema_ref,record_json,record_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(intent.intentId,preview.previewDigest,run.subject_id,run.libra_run_id,spec.product_scope_digest,1,'admin',intent.idempotencyKey,intent.requestDigest,intent.schemaRef,canonicalJson(intent),intent.intentDigest,NOW+1);
    db.prepare('INSERT INTO libra_custom_target_heads(subject_id,product_scope_digest,current_revision,intent_id,record_digest) VALUES(?,?,?,?,?)')
      .run(run.subject_id,spec.product_scope_digest,1,intent.intentId,intent.intentDigest);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);return intent;
  }finally{db.close();}
}

test('a confirmed custom target blocks old Run promotion before Package, Control or Outbox writes',()=>withDatabase(value=>{
  seedCommittedCustomTarget(value);const db=new Database(value.databasePath),before=db.prepare('SELECT * FROM fx_material_controls').all();
  const tables=['libra_product_packages','fx_outbox','fx_commit_markers'],snapshots=tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
  try{
    assert.throws(()=>createDeliverablePromotionStore({schemaManifest,unitOfWork:value.unitOfWork}).publish(request(value)),{code:'P9_PROMOTION_TARGET_SUPERSEDED'});
    for(let index=0;index<tables.length;index++)assert.deepEqual(db.prepare('SELECT * FROM '+tables[index]+' ORDER BY rowid').all(),snapshots[index]);
    assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls').all(),before);
  }finally{db.close();}
}));

test('confirmed target invalidates an unaccepted Offer while preserving immutable Package history and receipt replay',()=>withDatabase(value=>{
  const store=createDeliverablePromotionStore({schemaManifest,unitOfWork:value.unitOfWork}),first=store.publish(request(value)),
    reader=createProductDeliveryReader({schemaManifest,unitOfWork:value.unitOfWork}),query=readRequest(value),
    before=reader.readPackage(query),current={...query,readPurpose:'acceptance_fence'};
  assert.equal(reader.readPackage(current).deliveryFence.eligibility,'eligible');
  seedCommittedCustomTarget(value);const invalidated=reader.readPackage(current);
  assert.equal(invalidated.deliveryFence.eligibility,'ineligible');assert.equal(invalidated.deliveryFence.reasonCode,'target_not_current');
  assert.deepEqual(invalidated.onDeckProductPackage,before.onDeckProductPackage);
  assert.deepEqual(reader.readPackage(query),before);
  const replay=store.publish(request(value));assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);
  assert.equal(reader.readPackage(current).deliveryFence.reasonCode,'target_not_current');
}));
