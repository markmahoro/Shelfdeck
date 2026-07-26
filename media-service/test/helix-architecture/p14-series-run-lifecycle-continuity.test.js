'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } =
  require('../../src/helix/contracts/canonical-json');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  buildProductScope,
} = require('../../src/helix/domains/libra/model/acceptance-spec-contracts');
const {
  activeRunScopeSetDigest,
  buildProductionMaterialManifest,
  buildRunAdmissionDecision,
  buildRunExecutionBasis,
} = require('../../src/helix/domains/libra/model/run-admission-contracts');
const {
  buildRunLifecycleDecision,
} = require('../../src/helix/domains/libra/model/run-lifecycle-contracts');
const {
  createRunAdmissionStore,
} = require('../../src/helix/domains/libra/persistence/run-admission-store');
const {
  comparable,
  createRunLifecycleStore,
} = require('../../src/helix/domains/libra/persistence/run-lifecycle-store');

const generated = path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated',
);
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(
  path.join(generated, 'clean-schema.manifest.json'),
  'utf8',
));
const D = (value) => canonicalDigest({ value });

function controlProjection(materialKey) {
  const value = {
    materialKey,
    resultKind: 'available',
    controlRevision: 2,
    controlState: 'controlled',
    ownerDomain: 'libra',
    ownerScopeType: 'subject',
    ownerScopeId: 'series-subject',
    regionProjection: 'production',
  };
  const evidenceDigest = canonicalDigest({
    schema: 'foundation.material-control-evidence@1',
    materialKey,
    resultKind: value.resultKind,
    controlRevision: value.controlRevision,
    controlState: value.controlState,
    ownerDomain: value.ownerDomain,
    ownerScopeType: value.ownerScopeType,
    ownerScopeId: value.ownerScopeId,
  });
  return {
    ...value,
    evidenceDigest,
    projectionDigest: canonicalDigest({ ...value, evidenceDigest }),
  };
}

function recoveryPolicy() {
  const value = {
    policyRef: 'libra.run-recovery.beta@1',
    policyRevision: 1,
    assessmentOffsetsMs: [60000, 300000, 900000, 1800000, 3600000],
    maxRecoveryAssessments: 5,
    heavyPermitAllowed: false,
    frozenAutoResumeAllowed: false,
  };
  value.policyDigest = canonicalDigest(value);
  return value;
}

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-series-life-'));
  const databasePath = path.join(dir, 'db.sqlite');
  let now = 1000;
  openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now: () => now++,
  }).close();

  const subjectId = 'series-subject';
  const identity = {
    mountScopeId: 'series-mount',
    inode: '11',
    contentHashAlgorithm: 'sha256',
    contentHash: D('series-content'),
  };
  const materialKey = canonicalDigest({
    schema: 'physical-material-identity@1',
    ...identity,
  });
  const episodeClaims = ['E001', 'E002'].map((episodeKey) => ({
    episodeKey,
    seasonClaimDigest: D(`season:${episodeKey}`),
  }));
  const productScope = buildProductScope({
    subjectId,
    structureKind: 'season',
    contentProfile: 'series',
    intakeRevision: 1,
  }, episodeClaims.map((claim) => claim.episodeKey));
  const requirements = {
    identity: {},
    structure: { structureKind: 'season' },
    metadata: {},
    mandatoryMedia: {},
    space: {},
    inventory: {},
  };
  const spec = {
    acceptanceSpecId: 'series-spec',
    specRevision: 1,
    specDigest: D('series-spec'),
    recordDigest: D('series-spec-record'),
    productScopeDigest: productScope.scopeDigest,
    productScope,
    shelfId: 'series-shelf',
    requirements,
  };
  const headBase = {
    subjectId,
    headRevision: 4,
    currentRoutingDecisionId: null,
    currentDecisionBasisId: 'series-basis',
    currentAcceptanceSpecId: spec.acceptanceSpecId,
  };
  const headDigest = canonicalDigest({
    schema: 'libra.subject-decision-head@1',
    ...headBase,
  });
  const db = new Database(databasePath);
  db.prepare(
    `INSERT INTO libra_intake_decisions
       (intake_decision_id,candidate_package_id,source_field_id,
        source_field_access_revision,source_field_context_digest,
        candidate_identity_claim_digest)
     VALUES (?,?,?,?,?,?)`
  ).run('series-intake', 'series-candidate', 'series-field', 1, D('field'), D('claim'));
  db.prepare(
    `INSERT INTO libra_subjects
       (subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,
        status,intake_revision,current_continuity_set_digest,current_episode_scope_digest)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(subjectId, 'season', 'series', 'series-intake', 'active', 1,
    D('continuity'), D('episode-scope'));
  db.prepare(
    `INSERT INTO libra_decision_basis_revisions
       (decision_basis_id,subject_id,basis_kind,basis_revision,expected_head_revision,
        expected_head_snapshot_digest,routing_decision_id,query_result_set_digest,
        routing_input_digest,spec_input_digest,product_scope_digest,input_set_digest,
        status,basis_digest,committed_at_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('series-basis', subjectId, 'acceptance_spec', 1, 3, D('old-head'),
    null, D('queries'), null, D('spec-input'), productScope.scopeDigest,
    D('inputs'), 'ready', D('basis'), 1);
  db.prepare(
    `INSERT INTO libra_acceptance_specs
       (acceptance_spec_id,subject_id,shelf_id,shelf_routing_projection_revision,
        shelf_projection_digest,shelf_standard_revision,shelf_standard_digest,
        decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,
        spec_digest,record_digest,structure_kind,content_profile,published_at_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(spec.acceptanceSpecId, subjectId, spec.shelfId, 1, D('projection'), 1,
    D('standard'), 'series-basis', productScope.scopeDigest, 1,
    'AcceptanceSpec@1', canonicalJson(spec), spec.specDigest, spec.recordDigest,
    'season', 'series', 1);
  db.prepare(
    `INSERT INTO libra_subject_decision_heads
       (subject_id,head_revision,head_digest,current_routing_decision_id,
        current_decision_basis_id,current_acceptance_spec_id,updated_at_ms)
     VALUES (?,?,?,?,?,?,?)`
  ).run(subjectId, 4, headDigest, null, 'series-basis', spec.acceptanceSpecId, 1);
  db.prepare(
    `INSERT INTO libra_material_bindings
       (subject_id,material_key,role,mount_scope_id,inode,content_hash_algorithm,
        content_hash,size_bytes,endpoint_id,location,binding_revision,health_state,
        evidence_digest,origin_intake_decision_id,origin_offer_id,
        origin_candidate_package_id,origin_package_revision,origin_package_digest,
        origin_candidate_delivery_snapshot_digest,origin_related_reference_set_digest,current)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(subjectId, materialKey, 'primary_payload', identity.mountScopeId,
    identity.inode, identity.contentHashAlgorithm, identity.contentHash, 100,
    'series-endpoint', '/library/series.mkv', 1, 'active', D('binding'),
    'series-intake', 'series-offer', 'series-candidate', 1, D('package'),
    D('delivery'), D('related'), 1);
  for (const claim of [...episodeClaims].reverse()) {
    db.prepare(
      `INSERT INTO libra_material_binding_episode_claims
         (subject_id,material_key,binding_revision,episode_key,
          season_claim_digest,claim_digest)
       VALUES (?,?,?,?,?,?)`
    ).run(subjectId, materialKey, 1, claim.episodeKey, claim.seasonClaimDigest,
      D(`handoff-a:${claim.episodeKey}`));
  }
  db.prepare(
    `INSERT INTO fx_material_controls
       (material_key,mount_scope_id,inode,content_hash_algorithm,content_hash,
        owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(materialKey, identity.mountScopeId, identity.inode,
    identity.contentHashAlgorithm, identity.contentHash, 'libra', 'subject',
    subjectId, 2, 'controlled', 1);
  db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(materialKey, 1, 'acquire', null, null, null, 'libra', 'subject',
      subjectId, D('control-1'), 'control-marker-1', 1);
  db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(materialKey, 2, 'replace_control_set', 'libra', 'subject', subjectId,
      'libra', 'subject', subjectId, D('control-2'), 'control-marker-2', 2);
  db.close();

  const kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now: () => now++,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const control = controlProjection(materialKey);
  const libraRunId = canonicalDigest({
    schema: 'libra.run-id@1',
    subjectId,
    admissionRevision: 1,
  });
  const member = {
    materialKey,
    role: 'primary_payload',
    physicalIdentity: identity,
    sizeBytes: 100,
    location: {
      locationKind: 'domain_binding',
      endpointId: 'series-endpoint',
      location: '/library/series.mkv',
    },
    bindingKind: 'libra_material_binding',
    bindingRevision: 1,
    bindingEvidenceDigest: D('binding'),
    originCandidateDeliveryRef: {
      intakeDecisionId: 'series-intake',
      offerId: 'series-offer',
      candidatePackageId: 'series-candidate',
      packageRevision: 1,
      packageDigest: D('package'),
      candidateDeliverySnapshotDigest: D('delivery'),
      relatedReferenceSetDigest: D('related'),
    },
    admittedControlRevision: 2,
    admittedControlProjectionDigest: control.projectionDigest,
    episodeClaims,
  };
  const manifest = buildProductionMaterialManifest({
    manifestRole: 'run_input',
    manifestRevision: 1,
    libraRunId,
    scopeKind: 'episode_delivery',
    members: [member],
  }, spec);
  const headSnapshot = {
    ...headBase,
    headState: 'present',
    headDigest,
  };
  headSnapshot.snapshotDigest = canonicalDigest({
    schema: 'libra.subject-decision-head-snapshot@1',
    ...headSnapshot,
  });
  const basis = buildRunExecutionBasis({
    subjectSnapshot: {
      subjectId,
      intakeRevision: 1,
      structureKind: 'season',
      contentProfile: 'series',
      continuitySetDigest: D('continuity'),
      episodeScopeDigest: D('episode-scope'),
    },
    decisionHeadSnapshot: headSnapshot,
    acceptanceSpec: spec,
    shelfProjection: {
      routingProjectionRevision: 1,
      projectionDigest: D('projection'),
      standardRevision: 1,
      standardDigest: D('standard'),
    },
    productionMaterialManifest: manifest,
  });
  const admission = buildRunAdmissionDecision({
    admissionKind: 'initial',
    subjectId,
    expectedRunAdmissionHead: {
      headState: 'absent',
      headRevision: 0,
      activeScopeSetDigest: activeRunScopeSetDigest(subjectId, []),
    },
    runExecutionBasis: basis,
    initialPriority: {
      priorityClass: 'normal',
      priorityIntentDigest: canonicalDigest({
        schema: 'libra.priority-intent-empty@1',
      }),
    },
  });
  const admitted = createRunAdmissionStore({ schemaManifest, unitOfWork }).admit({
    decision: admission,
    commitMarker: 'series-admit-marker',
    resultId: 'series-admit-result',
  }).result;
  const basisSnapshot = comparable({
    subjectId,
    structureKind: 'season',
    contentProfile: 'series',
    acceptanceSpecRef: {
      acceptanceSpecId: spec.acceptanceSpecId,
      specRevision: spec.specRevision,
      specDigest: spec.specDigest,
      recordDigest: spec.recordDigest,
    },
    productScopeDigest: productScope.scopeDigest,
    members: [{
      materialKey,
      role: 'primary_payload',
      physicalIdentity: identity,
      sizeBytes: 100,
      bindingRevision: 1,
      bindingEvidenceDigest: D('binding'),
      episodeClaimSetDigest: manifest.members[0].episodeClaimSetDigest,
      controlRevision: 2,
      controlProjectionDigest: control.projectionDigest,
      outputRequirementDigest: manifest.members[0].outputRequirementDigest,
    }],
  });

  try {
    return run({
      admitted,
      basisSnapshot,
      databasePath,
      headSnapshot,
      libraRunId,
      materialKey,
      unitOfWork,
    });
  } finally {
    kernel.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function freshness(input) {
  const value = {
    libraRunId: input.libraRunId,
    expectedState: {
      state: 'active',
      stateRevision: input.admitted.stateRevision,
      stateDigest: input.admitted.stateDigest,
    },
    assessmentKind: 'active_checkpoint',
    recoveryPolicy: recoveryPolicy(),
    recoveryEpisode: { attemptOrdinal: 0 },
    assessedAtMs: 2000,
    currentDecisionHead: input.headSnapshot,
    originalBasis: input.basisSnapshot,
    readiness: 'ready',
    unresolvedReasonCodes: [],
    dimensionResults: [
      'acceptance_spec',
      'product_scope',
      'material_binding',
      'material_control',
      'output_requirement',
    ].map((dimension) => ({
      dimension,
      result: 'same',
      evidenceDigest: D(dimension),
    })),
    comparison: 'same',
    currentBasis: input.basisSnapshot,
  };
  value.assessmentId = canonicalDigest({
    schema: 'libra.run-freshness-assessment-id@1',
    libraRunId: input.libraRunId,
    expectedStateRevision: input.admitted.stateRevision,
    assessmentKind: value.assessmentKind,
    attemptOrdinal: 0,
    currentDecisionHeadDigest: input.headSnapshot.snapshotDigest,
  });
  value.assessmentDigest = canonicalDigest(value);
  return value;
}

function transition(input) {
  const decision = buildRunLifecycleDecision({
    libraRunId: input.libraRunId,
    expectedStateRevision: input.admitted.stateRevision,
    expectedStateDigest: input.admitted.stateDigest,
    transitionKind: 'freshness_confirmed',
    transitionEvidence: freshness(input),
    expectedAdmissionHeadRevision: input.admitted.committedAdmissionHeadRevision,
    expectedActiveScopeSetDigest: input.admitted.activeScopeSetDigest,
  });
  return createRunLifecycleStore({
    schemaManifest,
    unitOfWork: input.unitOfWork,
  }).transition({
    decision,
    commitMarker: 'series-life-marker',
    resultId: 'series-life-result',
  });
}

test('unchanged N:M Series claims reconstruct the identical Comparable Basis', () =>
  fixture((input) => {
    const committed = transition(input);
    assert.equal(committed.result.committedState, 'active');
    const db = new Database(input.databasePath, { readonly: true });
    const run = db.prepare(
      `SELECT state,state_revision,latest_freshness_assessment_digest
         FROM libra_runs`
    ).get();
    assert.equal(run.state, 'active');
    assert.equal(run.state_revision, 2);
    assert.equal(
      run.latest_freshness_assessment_digest,
      freshness(input).assessmentDigest,
    );
    db.close();
  }));

test('changed Series Episode relation or Binding revision fails closed', () => {
  for (const mutation of ['episode_relation', 'binding_revision']) {
    fixture((input) => {
      const db = new Database(input.databasePath);
      if (mutation === 'episode_relation') {
        db.prepare(
          `UPDATE libra_material_binding_episode_claims
              SET season_claim_digest=?
            WHERE subject_id=? AND material_key=? AND episode_key='E002'`
        ).run(D('changed-season-claim'), 'series-subject', input.materialKey);
      } else {
        db.prepare(
          `UPDATE libra_material_bindings
              SET binding_revision=2
            WHERE subject_id=? AND material_key=?`
        ).run('series-subject', input.materialKey);
      }
      db.close();
      assert.throws(
        () => transition(input),
        (error) => [
          'P9_RUN_LIFECYCLE_ASSESSMENT',
          'P9_RUN_REQUIREMENT_SCOPE',
        ].includes(error.code),
      );
      const check = new Database(input.databasePath, { readonly: true });
      assert.equal(check.prepare('SELECT state_revision FROM libra_runs').get().state_revision, 1);
      assert.equal(check.prepare(
        "SELECT count(*) count FROM fx_commit_markers WHERE commit_marker='series-life-marker'"
      ).get().count, 0);
      check.close();
    });
  }
});
