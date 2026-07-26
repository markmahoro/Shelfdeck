'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createMaterialControlProjectionPort } = require('../../../foundation/persistence/material-control');
const {
  buildDecisionInputSet,
  decisionHeadDigest,
} = require('../model/decision-front-half-contracts');
const {
  buildRoutingDecision,
  resolveRoutingAssessment,
} = require('../model/routing-contracts');
const { buildProductScope } = require('../model/acceptance-spec-contracts');
const {
  activeRunScopeSetDigest,
  buildProductionMaterialManifest,
  buildRunAdmissionDecision,
  buildRunExecutionBasis,
} = require('../model/run-admission-contracts');
const {
  RESULT_SCHEMA: DECISION_BASIS_RESULT_SCHEMA,
  createDecisionBasisStore,
} = require('../persistence/decision-basis-store');
const { createRoutingDecisionStore } = require('../persistence/routing-decision-store');
const { createAcceptanceSpecStore } = require('../persistence/acceptance-spec-store');
const { createRunAdmissionStore } = require('../persistence/run-admission-store');
const { createFieldRoutingPolicyStore } = require('../persistence/field-routing-policy-store');

class MovieFormationCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieFormationCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieFormationCoordinatorError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

const number = (value) => Number(value);
const utf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

function headSnapshot(subjectId, revision, routingId, basisId, specId = null) {
  const absent = revision === 0;
  const value = {
    subjectId,
    headState: absent ? 'absent' : 'present',
    headRevision: revision,
    headDigest: absent ? null : decisionHeadDigest(subjectId, revision, routingId, basisId, specId),
    currentRoutingDecisionId: routingId,
    currentDecisionBasisId: basisId,
    currentAcceptanceSpecId: specId,
  };
  return Object.freeze({
    ...value,
    snapshotDigest: canonicalDigest({
      schema: 'libra.subject-decision-head-snapshot@1',
      ...value,
    }),
  });
}

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_movie_formation_query',
    owner: 'libra',
    schemaManifest,
    statements: {
      find_subject: {
        kind: 'select-one', tableId: 'libra_subjects',
        columns: [
          'subject_id', 'structure_kind', 'content_profile',
          'routing_anchor_intake_decision_id', 'status', 'intake_revision',
          'current_continuity_set_digest', 'current_episode_scope_digest',
          'current_identity_revision',
        ],
        keyColumns: ['subject_id'],
      },
      find_intake: {
        kind: 'select-one', tableId: 'libra_intake_decisions',
        columns: [
          'intake_decision_id', 'candidate_package_id', 'source_field_id',
          'source_field_access_revision', 'source_field_context_digest',
          'candidate_identity_claim_digest', 'accepted_result', 'target_subject_id',
        ],
        keyColumns: ['intake_decision_id'],
      },
      list_bindings: {
        kind: 'select-all', tableId: 'libra_material_bindings', safeIntegers: true,
        columns: [
          'subject_id', 'material_key', 'role', 'mount_scope_id', 'inode',
          'content_hash_algorithm', 'content_hash', 'size_bytes', 'endpoint_id',
          'location', 'binding_revision', 'health_state', 'evidence_digest',
          'origin_intake_decision_id', 'origin_offer_id',
          'origin_candidate_package_id', 'origin_package_revision',
          'origin_package_digest', 'origin_candidate_delivery_snapshot_digest',
          'origin_related_reference_set_digest', 'current',
        ],
        keyColumns: ['subject_id'],
      },
      list_binding_claims: {
        kind: 'select-all', tableId: 'libra_material_binding_episode_claims',
        columns: [
          'subject_id', 'material_key', 'binding_revision', 'episode_key',
          'season_claim_digest', 'claim_digest',
        ],
        keyColumns: ['subject_id'],
      },
      find_run_head: {
        kind: 'select-one', tableId: 'libra_run_admission_heads', safeIntegers: true,
        columns: ['subject_id', 'head_revision', 'active_scope_set_digest'],
        keyColumns: ['subject_id'],
      },
      list_runs: {
        kind: 'select-all', tableId: 'libra_runs', safeIntegers: true,
        columns: [
          'libra_run_id', 'subject_id', 'acceptance_spec_id', 'state',
          'state_revision', 'state_digest', 'execution_basis_digest',
          'run_scope_digest',
        ],
        keyColumns: ['subject_id'],
      },
      find_spec: {
        kind: 'select-one', tableId: 'libra_acceptance_specs', safeIntegers: true,
        columns: [
          'acceptance_spec_id', 'subject_id', 'shelf_id',
          'shelf_routing_projection_revision', 'shelf_projection_digest',
          'shelf_standard_revision', 'shelf_standard_digest',
          'decision_basis_id', 'product_scope_digest', 'spec_revision',
          'spec_json', 'spec_digest', 'record_digest',
        ],
        keyColumns: ['acceptance_spec_id'],
      },
    },
  });
}

function querySnapshot(options, repository, subjectId) {
  return options.unitOfWork.execute([{
    participantId: 'libra_movie_formation_snapshot',
    owner: 'libra',
    repositories: [repository],
    execute(context) {
      const repo = context.repository(repository.repositoryId);
      const subject = repo.invoke('find_subject', { subject_id: subjectId });
      if (!subject) return null;
      const intake = repo.invoke('find_intake', {
        intake_decision_id: subject.routing_anchor_intake_decision_id,
      });
      return Object.freeze({
        subject,
        intake,
        bindings: Object.freeze(repo.invoke('list_bindings', { subject_id: subjectId })
          .filter((row) => number(row.current) === 1 && row.health_state === 'active')
          .sort((left, right) => utf8(left.material_key, right.material_key))),
        claims: Object.freeze(repo.invoke('list_binding_claims', { subject_id: subjectId })),
        runHead: repo.invoke('find_run_head', { subject_id: subjectId }),
        runs: Object.freeze(repo.invoke('list_runs', { subject_id: subjectId })),
      });
    },
  }]).libra_movie_formation_snapshot;
}

function readSpec(options, repository, acceptanceSpecId) {
  return options.unitOfWork.execute([{
    participantId: 'libra_movie_spec_snapshot',
    owner: 'libra',
    repositories: [repository],
    execute(context) {
      const row = context.repository(repository.repositoryId).invoke('find_spec', {
        acceptance_spec_id: acceptanceSpecId,
      });
      if (!row) return null;
      let spec;
      try {
        spec = JSON.parse(row.spec_json);
      } catch (_error) {
        fail('P14_MOVIE_FORMATION_SPEC_CORRUPT', 'Acceptance Spec JSON is corrupt.');
      }
      if (spec.acceptanceSpecId !== row.acceptance_spec_id ||
          spec.subjectId !== row.subject_id ||
          spec.targetShelfId !== row.shelf_id ||
          spec.specRevision !== number(row.spec_revision) ||
          spec.specDigest !== row.spec_digest ||
          spec.recordDigest !== row.record_digest ||
          spec.productScope?.scopeDigest !== row.product_scope_digest ||
          spec.shelfRoutingProjectionRevision !==
            number(row.shelf_routing_projection_revision) ||
          spec.shelfProjectionDigest !== row.shelf_projection_digest ||
          spec.shelfStandardRevision !== number(row.shelf_standard_revision) ||
          spec.shelfStandardDigest !== row.shelf_standard_digest) {
        fail('P14_MOVIE_FORMATION_SPEC_CORRUPT',
          'Acceptance Spec Owner row does not conserve its typed record.');
      }
      return Object.freeze({
        ...spec,
        shelfId: row.shelf_id,
        productScopeDigest: row.product_scope_digest,
      });
    },
  }]).libra_movie_spec_snapshot;
}

function subjectSnapshot(subject, intake) {
  if (!subject || subject.status !== 'active' || subject.structure_kind !== 'single' ||
      subject.content_profile !== 'movie' || !intake ||
      !['new_subject', 'extend_subject'].includes(intake.accepted_result) ||
      intake.target_subject_id !== subject.subject_id) {
    fail('P14_MOVIE_FORMATION_SUBJECT_UNAVAILABLE',
      'Movie formation requires one exact active accepted Movie Subject.');
  }
  if (subject.current_identity_revision !== null) {
    fail('P14_MOVIE_FORMATION_IDENTITY_PROJECTION_UNAVAILABLE',
      'Movie formation cannot invent a Product Identity digest from an Owner pointer.');
  }
  const value = {
    subjectId: subject.subject_id,
    status: subject.status,
    intakeRevision: number(subject.intake_revision),
    structureKind: subject.structure_kind,
    contentProfile: subject.content_profile,
    routingAnchorIntakeDecisionId: subject.routing_anchor_intake_decision_id,
    routingProvenance: {
      candidatePackageId: intake.candidate_package_id,
      sourceFieldId: intake.source_field_id,
      sourceFieldAccessRevision: number(intake.source_field_access_revision),
      sourceFieldContextDigest: intake.source_field_context_digest,
      candidateIdentityClaimDigest: intake.candidate_identity_claim_digest,
    },
    currentIdentityRevision: null,
    currentIdentityDigest: null,
    continuitySetDigest: subject.current_continuity_set_digest,
    episodeScopeDigest: subject.current_episode_scope_digest,
  };
  return Object.freeze({ ...value, snapshotDigest: canonicalDigest(value) });
}

function routingFact(subject, factKind, value) {
  const fact = {
    factKind,
    sourceObjectId: subject.subjectId,
    sourceRevision: subject.intakeRevision,
    schemaRef: 'RoutingDecisionFact@1',
    ...(factKind === 'material_field' ? { fieldId: value } : { value }),
  };
  return Object.freeze({ ...fact, factDigest: canonicalDigest(fact) });
}

function authority(policy) {
  const value = { authorityKind: 'policy', policy };
  return Object.freeze({ ...value, authorityDigest: canonicalDigest(value) });
}

function basisRequest(inputSet) {
  const identity = {
    basisKind: inputSet.basisKind,
    subjectId: inputSet.subjectSnapshot.subjectId,
    inputSetDigest: inputSet.inputSetDigest,
  };
  return Object.freeze({
    decisionInputSet: inputSet,
    domainFactCommitHandle: Object.freeze({
      schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1',
      schemaVersion: 1,
      handleId: stableId('movie-decision-basis-handle-', identity),
      ownerDomain: 'libra',
      aggregateType: 'subject_decision_basis',
      aggregateId: inputSet.subjectSnapshot.subjectId,
      factType: 'decision_basis',
      factSchemaRef: 'libra.decision-basis@1',
      expectedRevision: inputSet.expectedDecisionHead.headRevision,
      payloadDigest: canonicalDigest(inputSet),
      resultSchemaRef: DECISION_BASIS_RESULT_SCHEMA,
      commitIdempotencyKey: stableId('movie-decision-basis-key-', identity),
      eventFenceDigest: canonicalDigest({
        schema: 'libra.movie-decision-basis-fence@1',
        ...identity,
      }),
    }),
    commitMarker: stableId('movie-decision-basis-marker-', identity),
    resultId: stableId('movie-decision-basis-result-', identity),
  });
}

function runManifest(snapshot, controlPort, spec, libraRunId) {
  if (snapshot.bindings.length < 1 || snapshot.bindings.length > 1024) {
    fail('P14_MOVIE_FORMATION_BINDINGS_UNAVAILABLE',
      'Movie Run requires 1..1024 current Libra Material Bindings.');
  }
  const controls = controlPort.getMaterialControlProjections(
    snapshot.bindings.map((row) => row.material_key),
  );
  const controlByKey = new Map(controls.map((item) => [item.materialKey, item]));
  const members = snapshot.bindings.map((row) => {
    const control = controlByKey.get(row.material_key);
    if (!control || control.resultKind !== 'available' ||
        control.controlState !== 'controlled' ||
        control.ownerDomain !== 'libra' ||
        control.ownerScopeType !== 'subject' ||
        control.ownerScopeId !== snapshot.subject.subject_id) {
      fail('P14_MOVIE_FORMATION_CONTROL_UNAVAILABLE',
        'Movie Run input is not under the exact Libra Subject Control.', {
          materialKey: row.material_key,
        });
    }
    const episodeClaims = snapshot.claims
      .filter((claim) => claim.material_key === row.material_key &&
        number(claim.binding_revision) === number(row.binding_revision))
      .sort((left, right) => utf8(left.episode_key, right.episode_key))
      .map((claim) => Object.freeze({
        episodeKey: claim.episode_key,
        seasonClaimDigest: claim.season_claim_digest,
        claimDigest: claim.claim_digest,
      }));
    return Object.freeze({
      materialKey: row.material_key,
      role: row.role,
      physicalIdentity: Object.freeze({
        mountScopeId: row.mount_scope_id,
        inode: String(row.inode),
        contentHashAlgorithm: row.content_hash_algorithm,
        contentHash: row.content_hash,
      }),
      sizeBytes: number(row.size_bytes),
      location: Object.freeze({
        locationKind: 'domain_binding',
        endpointId: row.endpoint_id,
        location: row.location,
      }),
      bindingKind: 'libra_material_binding',
      bindingRevision: number(row.binding_revision),
      bindingEvidenceDigest: row.evidence_digest,
      originCandidateDeliveryRef: Object.freeze({
        intakeDecisionId: row.origin_intake_decision_id,
        offerId: row.origin_offer_id,
        candidatePackageId: row.origin_candidate_package_id,
        packageRevision: number(row.origin_package_revision),
        packageDigest: row.origin_package_digest,
        candidateDeliverySnapshotDigest: row.origin_candidate_delivery_snapshot_digest,
        relatedReferenceSetDigest: row.origin_related_reference_set_digest,
      }),
      admittedControlRevision: control.controlRevision,
      admittedControlProjectionDigest: control.projectionDigest,
      episodeClaims: Object.freeze(episodeClaims),
    });
  });
  return buildProductionMaterialManifest({
    manifestRole: 'run_input',
    manifestRevision: 1,
    libraRunId,
    scopeKind: 'single',
    members,
  }, spec);
}

function createMovieFormationCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      typeof options.readArcaRoutingTargets !== 'function' ||
      typeof options.readArcaShelfStandard !== 'function') {
    fail('P14_MOVIE_FORMATION_DEPENDENCIES',
      'Movie formation requires Libra persistence and formal Arca Projection ports.');
  }
  const repository = definition(options.schemaManifest);
  const policies = createFieldRoutingPolicyStore(options);
  const basisStore = createDecisionBasisStore(options);
  const routingStore = createRoutingDecisionStore(options);
  const specStore = createAcceptanceSpecStore(options);
  const runStore = createRunAdmissionStore(options);
  const controlPort = createMaterialControlProjectionPort(options);

  function advance(subjectId) {
    const snapshot = querySnapshot(options, repository, subjectId);
    if (!snapshot) {
      fail('P14_MOVIE_FORMATION_SUBJECT_UNAVAILABLE', 'Libra Subject does not exist.');
    }
    const active = snapshot.runs.find((run) => run.state === 'active');
    if (active) {
      return Object.freeze({
        stage: 'libra_run_active',
        replayed: true,
        subjectId,
        libraRunId: active.libra_run_id,
        acceptanceSpecId: active.acceptance_spec_id,
        executionBasisDigest: active.execution_basis_digest,
        runScopeDigest: active.run_scope_digest,
        stateRevision: number(active.state_revision),
        stateDigest: active.state_digest,
      });
    }
    if (snapshot.runs.some((run) => ['suspended', 'frozen'].includes(run.state))) {
      fail('P14_MOVIE_FORMATION_RUN_SCOPE_OCCUPIED',
        'Movie Subject already has an eligible non-active Libra Run.');
    }
    const subject = subjectSnapshot(snapshot.subject, snapshot.intake);
    const policy = policies.current(subject.routingProvenance.sourceFieldId);
    if (!policy) {
      return Object.freeze({
        stage: 'routing_unresolved',
        subjectId,
        reasonCode: 'routing_policy_unavailable',
      });
    }
    const targetMap = new Map(options.readArcaRoutingTargets()
      .map((projection) => [projection.shelfId, projection]));
    const targetProjections = Object.freeze(policy.targets
      .map((target) => targetMap.get(target.shelfId))
      .filter(Boolean));
    if (targetProjections.length !== policy.targets.length) {
      return Object.freeze({
        stage: 'routing_unresolved',
        subjectId,
        reasonCode: 'shelf_projection_unavailable',
      });
    }
    const facts = Object.freeze([
      routingFact(subject, 'content_profile', subject.contentProfile),
      routingFact(subject, 'material_field', subject.routingProvenance.sourceFieldId),
      routingFact(subject, 'structure_kind', subject.structureKind),
    ]);
    const routingSet = buildDecisionInputSet({
      basisKind: 'routing',
      subjectSnapshot: subject,
      expectedDecisionHead: headSnapshot(subjectId, 0, null, null),
      readiness: { result: 'ready' },
      routingAuthoritySnapshot: authority(policy),
      shelfRoutingTargets: targetProjections,
      routingDecision: null,
      shelfStandardProjection: null,
      productScope: null,
      decisionFacts: facts,
      queryResults: [],
    });
    const routingBasis = basisStore.commit(basisRequest(routingSet)).result;
    const assessment = resolveRoutingAssessment({
      ...routingSet,
      decisionBasisId: routingBasis.decisionBasisId,
    });
    const routingDecision = buildRoutingDecision(assessment, 1);
    const routingCommit = routingStore.commit({
      decisionInputSet: routingSet,
      decisionBasis: routingBasis,
      expectedDecisionDigest: routingDecision.decisionDigest,
      commitMarker: stableId('movie-routing-decision-marker-', {
        subjectId,
        decisionDigest: routingDecision.decisionDigest,
      }),
      resultId: stableId('movie-routing-decision-result-', {
        subjectId,
        decisionDigest: routingDecision.decisionDigest,
      }),
    });
    if (routingDecision.result !== 'resolved') {
      return Object.freeze({
        stage: 'routing_unresolved',
        subjectId,
        routingDecisionId: routingDecision.routingDecisionId,
        reasonCode: routingDecision.unresolvedReasonCode,
        decisionDigest: routingDecision.decisionDigest,
      });
    }
    const standardResult = options.readArcaShelfStandard(
      routingDecision.targetShelfId,
    );
    if (!standardResult || standardResult.resultKind !== 'found') {
      return Object.freeze({
        stage: 'decision_preparation_unresolved',
        subjectId,
        routingDecisionId: routingDecision.routingDecisionId,
        reasonCode: standardResult?.reasonCode || 'shelf_standard_unavailable',
      });
    }
    const productScope = buildProductScope(subject, []);
    const specSet = buildDecisionInputSet({
      basisKind: 'acceptance_spec',
      subjectSnapshot: subject,
      expectedDecisionHead: headSnapshot(
        subjectId,
        routingCommit.result.committedHeadRevision,
        routingDecision.routingDecisionId,
        routingBasis.decisionBasisId,
      ),
      readiness: { result: 'ready' },
      routingAuthoritySnapshot: null,
      shelfRoutingTargets: [],
      routingDecision,
      shelfStandardProjection: standardResult.projection,
      productScope,
      // Absence of a Rating Fact selects the Standard's formal no_rating
      // branch. Formation consults no foreign Owner.
      decisionFacts: [],
      queryResults: [],
    });
    const specBasis = basisStore.commit(basisRequest(specSet)).result;
    const specPublication = specStore.publish({
      decisionInputSet: specSet,
      decisionBasis: specBasis,
      producedAtMs: 0,
      commitMarker: stableId('movie-acceptance-spec-marker-', {
        subjectId,
        inputSetDigest: specSet.inputSetDigest,
      }),
      resultId: stableId('movie-acceptance-spec-result-', {
        subjectId,
        inputSetDigest: specSet.inputSetDigest,
      }),
    });
    const spec = readSpec(
      options,
      repository,
      specPublication.result.acceptanceSpecId,
    );
    if (!spec) {
      fail('P14_MOVIE_FORMATION_SPEC_UNAVAILABLE',
        'Published Acceptance Spec cannot be read by exact identity.');
    }
    const expectedRunHead = snapshot.runHead
      ? Object.freeze({
        headState: 'present',
        headRevision: number(snapshot.runHead.head_revision),
        activeScopeSetDigest: snapshot.runHead.active_scope_set_digest,
      })
      : Object.freeze({
        headState: 'absent',
        headRevision: 0,
        activeScopeSetDigest: activeRunScopeSetDigest(subjectId, []),
      });
    const libraRunId = canonicalDigest({
      schema: 'libra.run-id@1',
      subjectId,
      admissionRevision: expectedRunHead.headRevision + 1,
    });
    const manifest = runManifest(snapshot, controlPort, spec, libraRunId);
    const runBasis = buildRunExecutionBasis({
      subjectSnapshot: {
        subjectId,
        intakeRevision: subject.intakeRevision,
        structureKind: subject.structureKind,
        contentProfile: subject.contentProfile,
        continuitySetDigest: subject.continuitySetDigest,
        episodeScopeDigest: subject.episodeScopeDigest,
      },
      decisionHeadSnapshot: headSnapshot(
        subjectId,
        specPublication.result.committedHeadRevision,
        routingDecision.routingDecisionId,
        specBasis.decisionBasisId,
        spec.acceptanceSpecId,
      ),
      acceptanceSpec: spec,
      shelfProjection: {
        routingProjectionRevision: spec.shelfRoutingProjectionRevision,
        projectionDigest: spec.shelfProjectionDigest,
        standardRevision: spec.shelfStandardRevision,
        standardDigest: spec.shelfStandardDigest,
      },
      productionMaterialManifest: manifest,
    });
    const runDecision = buildRunAdmissionDecision({
      admissionKind: 'initial',
      subjectId,
      expectedRunAdmissionHead: expectedRunHead,
      runExecutionBasis: runBasis,
      initialPriority: {
        priorityClass: 'normal',
        priorityIntentDigest: canonicalDigest({
          schema: 'libra.priority-intent-empty@1',
        }),
      },
    });
    const admitted = runStore.admit({
      decision: runDecision,
      commitMarker: stableId('movie-run-admission-marker-', {
        subjectId,
        decisionDigest: runDecision.decisionDigest,
      }),
      resultId: stableId('movie-run-admission-result-', {
        subjectId,
        decisionDigest: runDecision.decisionDigest,
      }),
    });
    return Object.freeze({
      stage: 'libra_run_active',
      replayed: admitted.replayed,
      subjectId,
      routing: Object.freeze({
        routingDecisionId: routingDecision.routingDecisionId,
        targetShelfId: routingDecision.targetShelfId,
        policyId: policy.routingPolicyId,
        policyRevision: policy.revision,
        policyDigest: policy.policyDigest,
        shelfPrioritySetDigest: routingDecision.shelfPrioritySetDigest,
        decisionDigest: routingDecision.decisionDigest,
      }),
      acceptanceSpec: Object.freeze({
        acceptanceSpecId: spec.acceptanceSpecId,
        specRevision: spec.specRevision,
        specDigest: spec.specDigest,
        recordDigest: spec.recordDigest,
        decisionBasisId: specBasis.decisionBasisId,
        decisionBasisDigest: specBasis.basisDigest,
        productScopeDigest: spec.productScope.scopeDigest,
        shelfProjectionDigest: spec.shelfProjectionDigest,
        shelfStandardDigest: spec.shelfStandardDigest,
      }),
      libraRun: admitted.result,
    });
  }

  return Object.freeze({ advance });
}

module.exports = Object.freeze({
  MovieFormationCoordinatorError,
  createMovieFormationCoordinator,
});
