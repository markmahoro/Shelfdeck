'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createWorkResultReader } = require('../../src/helix/foundation/execution/work-result-reader');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { createMovieProductionReader } = require('../../src/helix/domains/libra/persistence/movie-production-reader');
const { createAcquisitionCandidateEvidenceStore } = require('../../src/helix/domains/libra/persistence/acquisition-candidate-evidence-store');
const { createCustomTargetStore } = require('../../src/helix/domains/libra/persistence/custom-target-store');
const { createCustomTargetBaselineReader } = require('../../src/helix/domains/libra/application/custom-target-baseline-reader');
const { createCustomTargetApplication } = require('../../src/helix/domains/libra/application/custom-target-application');
const { createLibraRunContextReader } = require('../../src/helix/domains/libra/application/libra-run-context-reader');
const { createLibraRunCreator } = require('../../src/helix/domains/libra/application/libra-run-creator');
const { createMovieCustomTargetViewReader } = require('../../src/helix/domains/libra/application/movie-custom-target-view-reader');
const { buildMediaRequirement } = require('../../src/helix/domains/libra/model/media-production-contracts');
const external = require('../../src/helix/domains/libra/model/external-material-contracts');
const { externalSearchSelectionWork } = require('../../src/helix/domains/libra/planning/external-material-work');
const { createExternalMaterialPlanner } = require('../../src/helix/domains/libra/planning/external-material-planner');
const { sourceMediaObservationWork } = require('../../src/helix/domains/libra/planning/media-production-work');
const { fixture: specFixture } = require('./fixtures/custom-acceptance-spec-harness');
const { buildDecisionInputSet, decisionHeadDigest } = require('../../src/helix/domains/libra/model/decision-front-half-contracts');

const NOW = 1_700_000_000_000;
const D = value => canonicalDigest({ fixture: value });
const schema = capability => 'helix://contracts/capabilities/' + capability.replace('@1', '/v1') + '/result';
const EMPTY_RELATED = {
  relatedReferenceSetDigest: canonicalDigest({ schema: 'procurement.related-reference-set@1', items: [] }),
  relatedDispositionScopeDigest: canonicalDigest({ schema: 'procurement.related-disposition-scope@1', items: [] }),
};
const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));

function collectSchemas() {
  const schemas = [];
  const pending = [path.resolve(__dirname, '../../src/helix/contracts')];
  while (pending.length) {
    for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) {
      const full = path.join(entry.parentPath || entry.path, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name.endsWith('schema.json')) {
        const value = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (value.$id) schemas.push(value);
      }
    }
  }
  return createCapabilityContractValidator({ schemas });
}

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function insertWork(db, { workId, libraRunId, workKind, basisDigest, definition, state = 'succeeded', attemptId = workId + ':attempt:1', planId = workId + ':plan:1', planDigest = D('plan:' + workId), createdAtMs = NOW }) {
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,definition_json,definition_digest,state,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId, 'libra', 'libra_run', libraRunId, workKind, basisDigest, canonicalJson(definition), canonicalDigest(definition), state, createdAtMs, createdAtMs);
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,state) VALUES(?,?,?,?)')
    .run(attemptId, workId, 1, ['succeeded', 'failed', 'cancelled'].includes(state) ? state : 'running');
  if (state !== 'admitted') {
    db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_version,graph_digest,state) VALUES(?,?,?,?,?)')
      .run(planId, attemptId, 1, planDigest, 'planned');
  }
  return { attemptId, planId };
}

function insertEventResult(db, { workId, attemptId, planId, nodeId, eventId, eventAttemptId, capabilityRef, inputBindings, resultId, result, outcomeKind = 'succeeded' }) {
  db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,input_bindings_json) VALUES(?,?,?,?)')
    .run(planId, nodeId, capabilityRef, canonicalJson(inputBindings));
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,state) VALUES(?,?,?,?,?,?,?,?)')
    .run(eventId, planId, nodeId, workId, attemptId, 'libra', capabilityRef, outcomeKind === 'succeeded' ? 'succeeded' : 'failed');
  db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind) VALUES(?,?,?,?,?)')
    .run(eventAttemptId, eventId, 1, 'completed', outcomeKind);
  if (result !== null) {
    db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest) VALUES(?,?,?,?,?,?)')
      .run(resultId, eventId, outcomeKind, schema(capabilityRef), canonicalJson(result), canonicalDigest(result));
  }
}

function withViewHarness(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const profile = options.profile || 'movie';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-custom-view-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => NOW });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const contractValidator = collectSchemas();
  const db = new Database(databasePath);
  try {
    db.pragma('foreign_keys = OFF');
    const specData = specFixture(profile, 'old-run');
    const base = specData.baseSpec;
    let currentInputSet = specData.inputSet;
    const identity = {
      mountScopeId: 'mount',
      inode: '101',
      fingerprintAlgorithm: 'middle-256k-sha256',
      fingerprintVersion: 1,
      contentFingerprint: D('source-content'),
      sizeBytes: 1000,
    };
    const materialKey = canonicalDigest({ schema: 'physical-material-identity@2', ...identity });
    const deliveryBody = {
      materialInputForm: 'stream_file',
      candidatePackage: {
        contentProfile: profile,
        identityClaim: { contentProfile: profile, claimedTitle: 'Paris Memories' },
        relatedReferences: [],
        relatedReferenceSetDigest: EMPTY_RELATED.relatedReferenceSetDigest,
        relatedDispositionScopeDigest: EMPTY_RELATED.relatedDispositionScopeDigest,
      },
      primaryInputManifest: {},
      primaryMaterialDeliveries: [{
        materialKey,
        role: 'primary_payload',
        location: '/source/movie.mkv',
        endpointId: 'endpoint',
        sizeBytes: identity.sizeBytes,
        episodeClaims: [],
      }],
    };
    const deliverySnapshotDigest = canonicalDigest(deliveryBody);
    const deliveryJson = canonicalJson({ ...deliveryBody, deliverySnapshotDigest });

    db.prepare('INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)')
      .run('subject', 'active', profile, profile === 'series' ? 'season' : 'single', 1, D('continuity'), D('episodes'));
    db.prepare('INSERT INTO libra_routing_decisions(routing_decision_id,subject_id,decision,shelf_id) VALUES(?,?,?,?)')
      .run(specData.routing.routingDecisionId, 'subject', 'resolved', 'shelf');
    db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status,routing_decision_id,basis_digest) VALUES(?,?,?,?,?,?,?)')
      .run(base.decisionBasisId, 'subject', 'acceptance_spec', 2, 'ready', specData.routing.routingDecisionId, base.decisionBasisDigest);
    const specCols = ['acceptance_spec_id', 'subject_id', 'shelf_id', 'shelf_routing_projection_revision', 'shelf_projection_digest',
      'shelf_standard_revision', 'shelf_standard_digest', 'decision_basis_id', 'product_scope_digest', 'spec_revision',
      'spec_schema_ref', 'spec_json', 'spec_digest', 'record_digest', 'structure_kind', 'content_profile', 'published_at_ms'];
    db.prepare('INSERT INTO libra_acceptance_specs(' + specCols.join(',') + ') VALUES(' + specCols.map(() => '?').join(',') + ')')
      .run(base.acceptanceSpecId, 'subject', 'shelf', base.shelfRoutingProjectionRevision, base.shelfProjectionDigest,
        base.shelfStandardRevision, base.shelfStandardDigest, base.decisionBasisId, base.productScope.scopeDigest,
        base.specRevision, base.schemaRef, canonicalJson(base), base.specDigest, base.recordDigest,
        base.structureKind, base.contentProfile, base.publishedAtMs);
    const headDigest = decisionHeadDigest('subject', 4, specData.routing.routingDecisionId, base.decisionBasisId, base.acceptanceSpecId);
    db.prepare('INSERT INTO libra_subject_decision_heads(subject_id,head_revision,head_digest,current_routing_decision_id,current_decision_basis_id,current_acceptance_spec_id) VALUES(?,?,?,?,?,?)')
      .run('subject', 4, headDigest, specData.routing.routingDecisionId, base.decisionBasisId, base.acceptanceSpecId);

    db.prepare('INSERT INTO libra_intake_decisions(intake_decision_id,decision_kind,offer_id,candidate_package_id,package_revision,package_digest,candidate_delivery_snapshot_digest,target_subject_id,candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest,source_field_id,source_field_access_revision,source_field_context_digest,candidate_identity_claim_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('intake', 'accepted_resolution', 'offer', 'candidate', 1, D('package'), deliverySnapshotDigest, 'subject',
        'helix://contracts/types/CandidateDeliverySnapshot/v1', deliveryJson,
        'helix://contracts/types/DecisionIdentityEvidenceSnapshot/v1', '{}', D('decision-identity-evidence'),
        'field', 1, D('field'), D('claim'));
    db.prepare('INSERT INTO fx_material_controls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(materialKey, identity.mountScopeId, identity.inode, identity.sizeBytes, identity.fingerprintAlgorithm, 1,
        identity.contentFingerprint, 'libra', 'subject', 'subject', 1, 'controlled', 1);
    db.prepare('INSERT INTO fx_material_control_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(materialKey, 1, 'acquire', null, null, null, 'libra', 'subject', 'subject', D('control'), 'fixture-control-marker', 1);
    const bindCols = ['subject_id', 'material_key', 'role', 'authority_kind', 'mount_scope_id', 'inode', 'fingerprint_algorithm',
      'fingerprint_version', 'content_fingerprint', 'size_bytes', 'endpoint_id', 'location', 'binding_revision', 'health_state',
      'evidence_digest', 'origin_intake_decision_id', 'origin_offer_id', 'origin_candidate_package_id', 'origin_package_revision',
      'origin_package_digest', 'origin_candidate_delivery_snapshot_digest', 'origin_related_reference_set_digest',
      'origin_related_disposition_scope_digest', 'current'];
    db.prepare('INSERT INTO libra_material_bindings(' + bindCols.join(',') + ') VALUES(' + bindCols.map(() => '?').join(',') + ')')
      .run('subject', materialKey, 'primary_payload', 'primary_control', identity.mountScopeId, identity.inode,
        identity.fingerprintAlgorithm, 1, identity.contentFingerprint, identity.sizeBytes, 'endpoint', '/source/movie.mkv',
        1, 'active', D('binding'), 'intake', 'offer', 'candidate', 1, D('package'), deliverySnapshotDigest,
        EMPTY_RELATED.relatedReferenceSetDigest, EMPTY_RELATED.relatedDispositionScopeDigest, 1);
    if (profile === 'series') {
      db.prepare('INSERT INTO libra_material_binding_episode_claims(subject_id,material_key,binding_revision,episode_key,season_claim_digest,claim_digest) VALUES(?,?,?,?,?,?)')
        .run('subject', materialKey, 1, 'E001', D('season'), D('claim1'));
      db.prepare('INSERT INTO libra_material_binding_episode_claims(subject_id,material_key,binding_revision,episode_key,season_claim_digest,claim_digest) VALUES(?,?,?,?,?,?)')
        .run('subject', materialKey, 1, 'E002', D('season'), D('claim2'));
    }

    const runContextReader = createLibraRunContextReader({ schemaManifest, unitOfWork });
    const runCreator = createLibraRunCreator({ schemaManifest, unitOfWork, contextReader: runContextReader });
    const admitted = runCreator.reconcile('subject');
    assert.equal(admitted.kind, 'admitted');
    const libraRunId = admitted.libraRunId;

    const movieProductionReader = createMovieProductionReader({ schemaManifest, unitOfWork });
    const workResultReader = createWorkResultReader({ schemaManifest, unitOfWork });
    const evidenceStore = createAcquisitionCandidateEvidenceStore({ schemaManifest, unitOfWork, contractValidator, now: () => NOW });
    const customTargetStore = createCustomTargetStore({ schemaManifest, unitOfWork });

    const anchor = { provider: 'tmdb', namespace: 'tmdb_movie', providerKey: '912022', seasonNumber: null, identityAnchorDigest: D('anchor') };
    const resolvedIdentity = { subjectId: 'subject', contentProfile: profile, title: 'Paris Memories', identityDigest: D('resolved-identity'), providerIdentities: [anchor] };
    const productProductionPort = {
      issuePhysicalReadHandle(value) {
        const baseHandle = {
          schemaRef: 'helix://contracts/types/PhysicalMaterialReadHandle/v1',
          schemaVersion: 1,
          ownerDomain: 'libra',
          ownerScope: { scopeType: 'libra_run', scopeId: value.libraRunId },
          location: value.location,
          materialKey: value.physicalIdentity.materialKey,
          bindingRevision: value.bindingRevision,
        };
        return Object.freeze({ ...baseHandle, handleDigest: canonicalDigest(baseHandle) });
      },
    };

    function seedIdentity() {
      db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,schema_ref,fact_json,fact_digest,evidence_digest,result_digest) VALUES(?,?,?,?,?,?,?,?,?)')
        .run('identity-' + libraRunId, libraRunId, 'resolved_identity', 1, 'helix://contracts/types/ResolvedProductIdentity/v1',
          canonicalJson(resolvedIdentity), resolvedIdentity.identityDigest, D('identity-evidence'), canonicalDigest(resolvedIdentity));
      const observed = { libraRunId, result: 'resolved', sourceKind: 'provider_exact', verifiedIdentity: anchor };
      const identityObs = { ...observed, observationDigest: canonicalDigest(observed) };
      const { attemptId, planId } = insertWork(db, {
        workId: 'identity-work-' + libraRunId, libraRunId, workKind: 'product_identity', basisDigest: D('identity-work'), definition: { kind: 'identity' },
      });
      insertEventResult(db, {
        workId: 'identity-work-' + libraRunId, attemptId, planId, nodeId: 'identity-node', eventId: 'identity-event-' + libraRunId,
        eventAttemptId: 'identity-attempt-' + libraRunId, capabilityRef: 'libra.product_identity.evidence.observe@1',
        inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [] },
        resultId: 'identity-result-' + libraRunId, result: identityObs,
      });
      const { snapshotDigest: _ignoredSnapshotDigest, ...subjectWithoutDigest } = specData.inputSet.subjectSnapshot;
      const updatedSubject = {
        ...subjectWithoutDigest,
        currentIdentityRevision: 1,
        currentIdentityDigest: resolvedIdentity.identityDigest,
      };
      currentInputSet = buildDecisionInputSet({
        ...specData.inputSet,
        subjectSnapshot: {
          ...updatedSubject,
          snapshotDigest: canonicalDigest(updatedSubject),
        },
      });
      return identityObs;
    }

    function seedSourceProbe({ longEdge = 1920, shortEdge = 1080, audio = ['other'] } = {}) {
      const snapshot = movieProductionReader.readRunSnapshot(libraRunId);
      const sourceWork = sourceMediaObservationWork(snapshot);
      const readHandle = productProductionPort.issuePhysicalReadHandle({
        libraRunId,
        physicalIdentity: snapshot.members[0].physicalIdentity,
        location: snapshot.members[0].location,
        bindingRevision: snapshot.members[0].bindingRevision,
      });
      const sourceHandleDigest = canonicalDigest(readHandle);
      const inputBindings = {
        bindings: [{
          portName: 'physicalMaterialReadHandleOrWorkspaceMaterialHandle',
          ownerDomain: 'libra',
          processType: 'libra_run',
          processId: libraRunId,
          bindingKind: 'projected_owner_facts',
        }],
      };
      const probe = {
        schemaRef: 'helix://contracts/types/MediaProbeEvidence/v1',
        schemaVersion: 1,
        evidenceId: 'probe-' + libraRunId,
        evidenceKind: 'media_probe',
        producerRef: 'shared.material.media.probe@1',
        basisDigest: D('probe-basis'),
        observedAtMs: NOW,
        sourceHandleDigest,
        resultKind: 'probed',
        container: 'matroska',
        durationMs: 120_000,
        videoStreams: [{ streamIndex: 0, dispositionDefault: true, bitDepth: 8, pixelFormat: 'yuv420p', dynamicRangeKind: 'sdr', longEdge, shortEdge }],
        audioStreams: audio.map((cls, index) => ({ streamIndex: index + 1, dispositionDefault: index === 0, normalizedAudioClass: cls })),
        subtitleStreams: [],
      };
      probe.payloadDigest = canonicalDigest(probe);
      const { attemptId, planId } = insertWork(db, {
        workId: sourceWork.workId, libraRunId, workKind: sourceWork.workKind, basisDigest: sourceWork.executionBasisDigest, definition: sourceWork,
      });
      insertEventResult(db, {
        workId: sourceWork.workId, attemptId, planId, nodeId: 'source-probe-node', eventId: 'source-probe-event-' + libraRunId,
        eventAttemptId: 'source-probe-attempt-' + libraRunId, capabilityRef: 'shared.material.media.probe@1',
        inputBindings, resultId: 'probe-result-' + libraRunId, result: probe,
      });
    }

    function seedSearchNotSelected(state = 'succeeded', identityObs) {
      const snapshot = movieProductionReader.readRunSnapshot(libraRunId);
      const work = externalSearchSelectionWork(snapshot);
      if (state !== 'succeeded') {
        insertWork(db, { workId: work.workId, libraRunId, workKind: work.workKind, basisDigest: work.executionBasisDigest, definition: work, state });
        return null;
      }
      const handle = { integrationId: 'mp-1', configRevision: 1, integrationType: 'moviepilot', allowedOperation: 'libra.external_material.search@1' };
      const planner = createExternalMaterialPlanner({
        registry: {
          snapshot: [],
          resolve: ref => ({
            manifest: {
              effectClass: 'pure_observation',
              parametersSchemaRef: schema(ref).replace('/result', '/parameters'),
              resultSchemaRef: schema(ref),
              resourceDemandSchemaRef: 'resources',
              fenceSchemaRef: 'fence',
            },
          }),
        },
        policyRegistry: { digest: D('policy'), bindingFor: () => ({ retryPolicyRef: 'retry', timeoutPolicyRef: 'timeout' }) },
        movieProductionReader,
        workResultReader,
        resolveExternalMaterialIntegrationHandle: () => handle,
      });
      const attemptId = stable('attempt-', { workId: work.workId });
      const planId = stable('libra-external-material-plan-', { workId: work.workId, attempt: attemptId });
      const plan = planner.plan({ workId: work.workId, executionBasisDigest: work.executionBasisDigest, processId: libraRunId, workAttemptId: attemptId });
      const node = ref => plan.nodes.find(item => item.capabilityRef === ref);
      const literal = (item, name) => item.inputBindings.bindings.find(binding => binding.portName === name).value;
      const queryNode = node('libra.external_material.query.prepare@1');
      const query = external.buildAcquisitionQuery({
        resolvedProductIdentity: literal(queryNode, 'resolvedProductIdentity'),
        productIdentityEvidenceObservation: identityObs,
        productStructure: literal(queryNode, 'productStructure'),
        mediaRequirement: literal(queryNode, 'mediaRequirement'),
        acquisitionPolicy: literal(queryNode, 'acquisitionPolicy'),
        executionContext: { libraRunId, runExecutionBasisDigest: snapshot.run.executionBasisDigest },
        producedAtMs: NOW,
      });
      const evidence = {
        schemaRef: 'helix://contracts/types/AcquisitionCandidates/v1',
        schemaVersion: 1,
        evidenceId: 'evidence-' + libraRunId,
        evidenceKind: 'external_acquisition_candidates',
        producerRef: 'transport-1',
        basisDigest: D('req'),
        payloadDigest: D('resp'),
        observedAtMs: NOW,
        queryDigest: query.queryDigest,
        integrationId: handle.integrationId,
        configRevision: handle.configRevision,
        candidates: [],
      };
      evidence.candidateSetDigest = canonicalDigest({
        schema: 'libra.external-acquisition-candidate-set@1',
        queryDigest: query.queryDigest,
        integrationId: handle.integrationId,
        configRevision: handle.configRevision,
        items: [],
      });
      const searchEventAttemptId = 'search-event-attempt-' + libraRunId;
      const scope = {
        libraRunId,
        runExecutionBasisDigest: snapshot.run.executionBasisDigest,
        searchWorkId: work.workId,
        searchEventId: node('libra.external_material.search@1').eventId,
        searchEventAttemptId,
      };
      insertWork(db, {
        workId: work.workId, libraRunId, workKind: work.workKind, basisDigest: work.executionBasisDigest,
        definition: work, state: 'succeeded', attemptId, planId, planDigest: D('search-plan'),
      });
      const selection = external.selectCandidate({
        candidates: evidence,
        selectionCriteria: literal(node('libra.external_material.candidate.select@1'), 'selectionCriteria'),
        producedAtMs: NOW,
      });
      const queryNodeInfo = node('libra.external_material.query.prepare@1');
      insertEventResult(db, {
        workId: work.workId, attemptId, planId, nodeId: queryNodeInfo.nodeId, eventId: queryNodeInfo.eventId,
        eventAttemptId: 'q-attempt', capabilityRef: 'libra.external_material.query.prepare@1',
        inputBindings: queryNodeInfo.inputBindings, resultId: 'libra.external_material.query.prepare@1-' + libraRunId, result: query,
      });
      const searchNodeInfo = node('libra.external_material.search@1');
      db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,input_bindings_json) VALUES(?,?,?,?)')
        .run(planId, searchNodeInfo.nodeId, 'libra.external_material.search@1', canonicalJson(searchNodeInfo.inputBindings));
      db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,state) VALUES(?,?,?,?,?,?,?,?)')
        .run(searchNodeInfo.eventId, planId, searchNodeInfo.nodeId, work.workId, attemptId, 'libra', 'libra.external_material.search@1', 'succeeded');
      db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind) VALUES(?,?,?,?,?)')
        .run(searchEventAttemptId, searchNodeInfo.eventId, 1, 'completed', 'succeeded');
      const savedRecord = evidenceStore.save(scope, query, handle, evidence);
      db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest) VALUES(?,?,?,?,?,?)')
        .run('libra.external_material.search@1-' + libraRunId, searchNodeInfo.eventId, 'succeeded', schema('libra.external_material.search@1'), canonicalJson(savedRecord), canonicalDigest(savedRecord));
      const selectNodeInfo = node('libra.external_material.candidate.select@1');
      insertEventResult(db, {
        workId: work.workId, attemptId, planId, nodeId: selectNodeInfo.nodeId, eventId: selectNodeInfo.eventId,
        eventAttemptId: 's-attempt', capabilityRef: 'libra.external_material.candidate.select@1',
        inputBindings: selectNodeInfo.inputBindings, resultId: 'libra.external_material.candidate.select@1-' + libraRunId, result: selection,
      });
      return selection;
    }

    function freezeRun(stateRevision = 2) {
      const digestValue = D('frozen-' + stateRevision);
      const runRow = db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(libraRunId);
      const headRow = db.prepare('SELECT * FROM libra_run_admission_heads WHERE subject_id=?').get(runRow.subject_id);
      db.prepare("UPDATE libra_runs SET state='frozen',state_revision=?,state_digest=? WHERE libra_run_id=?")
        .run(stateRevision, digestValue, libraRunId);
      db.prepare('INSERT INTO libra_run_revisions(libra_run_id,state_revision,state,acceptance_spec_id,execution_basis_digest,run_scope_digest,transition_kind,expected_admission_head_revision,revision_digest) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(libraRunId, stateRevision, 'frozen', runRow.acceptance_spec_id, runRow.execution_basis_digest, runRow.run_scope_digest, 'frozen', headRow ? Number(headRow.head_revision) : 0, digestValue);
    }

    let handoffState = 'no_offer';
    const readHandoffResponsibility = ({ productScopeDigest }) => Object.freeze({
      kind: 'ready',
      subjectId: 'subject',
      libraRunId,
      productScopeDigest,
      handoffState,
    });
    const baselineReader = createCustomTargetBaselineReader({
      acceptanceSpecContextReader: { read: () => Object.freeze({ kind: 'current', inputSet: currentInputSet }) },
      readHandoffResponsibility,
    });
    const currentViewReader = createMovieCustomTargetViewReader({
      schemaManifest,
      unitOfWork,
      movieProductionReader,
      workResultReader,
      productProductionPort,
      acquisitionCandidateEvidenceStore: evidenceStore,
      customTargetStore,
      readHandoffResponsibility,
    });
    const app = createCustomTargetApplication({
      schemaManifest,
      unitOfWork,
      customTargetStore,
      currentViewReader,
      readCurrentCustomTargetBaseline: (req, view) => baselineReader.read(req, view),
      now: () => NOW,
    });

    callback({
      db, libraRunId, base, specData, currentViewReader, app, customTargetStore,
      seedIdentity, seedSourceProbe, seedSearchNotSelected, freezeRun,
      setHandoffState: next => { handoffState = next; },
    });
  } finally {
    db.close();
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Paris Memories (1080p + non-HD audio) vs 5-star standard proposes only raster + primary audio while retaining HEVC and 50 GiB', () =>
  withViewHarness(h => {
    const obs = h.seedIdentity();
    h.seedSourceProbe({ longEdge: 1920, shortEdge: 1080, audio: ['other'] });
    h.seedSearchNotSelected('succeeded', obs);
    h.freezeRun();

    const view = h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId });
    assert.equal(view.kind, 'ready');
    const codes = view.proposals.map(item => item.change.requirementCode).sort();
    assert.deepEqual(codes, ['minimum_raster_unmet', 'primary_audio_unmet']);

    const prepared = h.app.preparePreview('admin', { subjectId: 'subject', libraRunId: h.libraRunId, idempotencyKey: 'preview-paris' });
    assert.equal(prepared.kind, 'preview');
    assert.equal(prepared.record.proposals.length, 2);

    const confirmed = h.app.confirm('admin', {
      previewDigest: prepared.record.previewDigest,
      selectedChangeDigests: prepared.record.proposals.map(item => item.changeDigest),
      acknowledged: true,
      idempotencyKey: 'confirm-paris',
    });
    assert.equal(confirmed.kind, 'confirmed');
    assert.equal(confirmed.record.target.requirements.mandatoryMedia.videoCodec, 'hevc');
    assert.equal(confirmed.record.target.requirements.mandatoryMedia.minimumRasterClass, 'none');
    assert.deepEqual(confirmed.record.target.requirements.mandatoryMedia.acceptedPrimaryAudioClasses, []);
    assert.equal(confirmed.record.target.requirements.space.maxSizeGiB, 50);
  }));

test('1080p + DTS-HD MA proposes only minimum_raster_unmet and preserves DTS-HD MA, HEVC, and 50 GiB', () =>
  withViewHarness(h => {
    const obs = h.seedIdentity();
    h.seedSourceProbe({ longEdge: 1920, shortEdge: 1080, audio: ['dts_hd_ma'] });
    h.seedSearchNotSelected('succeeded', obs);
    h.freezeRun();

    const view = h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId });
    assert.equal(view.kind, 'ready');
    assert.deepEqual(view.proposals.map(item => item.change.requirementCode), ['minimum_raster_unmet']);
    assert.equal(view.requirements.mandatoryMedia.acceptedPrimaryAudioClasses.includes('dts_hd_ma'), true);
    assert.equal(view.requirements.space.maxSizeGiB, 50);
  }));

test('missing identity, missing source probe, or unstarted/running external search stays evidence_pending', () => {
  withViewHarness(h => {
    assert.equal(h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId }).kind, 'pending');
    assert.deepEqual(h.app.preparePreview('admin', { subjectId: 'subject', libraRunId: h.libraRunId, idempotencyKey: 'p1' }),
      { kind: 'evidence_pending', replayed: false });
    h.seedIdentity();
    assert.equal(h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId }).kind, 'pending');
    h.seedSourceProbe({ longEdge: 1920, shortEdge: 1080, audio: ['other'] });
    assert.equal(h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId }).kind, 'pending');
  });
  withViewHarness(h => {
    h.seedIdentity();
    h.seedSourceProbe({ longEdge: 1920, shortEdge: 1080, audio: ['other'] });
    h.seedSearchNotSelected('running');
    assert.equal(h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId }).kind, 'pending');
    assert.deepEqual(h.app.preparePreview('admin', { subjectId: 'subject', libraRunId: h.libraRunId, idempotencyKey: 'p2' }),
      { kind: 'evidence_pending', replayed: false });
  });
});

test('4K compliant source surfaces poster, plot, and safe size cap gaps without external search and protects nfo/identity', () =>
  withViewHarness(h => {
    h.seedIdentity();
    h.seedSourceProbe({ longEdge: 3840, shortEdge: 2160, audio: ['dts_hd_ma'] });

    const { attemptId: metaAttempt, planId: metaPlan } = insertWork(h.db, {
      workId: 'meta-work-' + h.libraRunId, libraRunId: h.libraRunId, workKind: 'product_metadata_observation', basisDigest: D('meta'), definition: { kind: 'meta' },
    });
    const metaResult = {
      schemaRef: 'helix://contracts/types/MetadataObservation/v1',
      schemaVersion: 1,
      sourcePriority: 0,
      evidenceId: 'meta-evidence-1',
      descriptiveFacts: {
        entries: [
          { key: 'tmdb_movie_id', value: '912022' },
          { key: 'title', value: 'Paris Memories' },
          { key: 'year_or_release_date', value: 2022 },
          { key: 'genre', value: 'Drama' },
          { key: 'director', value: 'Alice Winocour' },
        ],
      },
      peopleHints: [{ role: 'actor', displayName: 'Virginie Efira' }],
    };
    insertEventResult(h.db, {
      workId: 'meta-work-' + h.libraRunId, attemptId: metaAttempt, planId: metaPlan, nodeId: 'meta-node',
      eventId: 'meta-event-' + h.libraRunId, eventAttemptId: 'meta-attempt', capabilityRef: 'libra.product_metadata.fetch@1',
      inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [] },
      resultId: 'meta-result-1', result: metaResult,
    });

    const { attemptId: artAttempt, planId: artPlan } = insertWork(h.db, {
      workId: 'art-work-' + h.libraRunId, libraRunId: h.libraRunId, workKind: 'artifact_production', basisDigest: D('art'), definition: { kind: 'art' },
    });
    insertEventResult(h.db, {
      workId: 'art-work-' + h.libraRunId, attemptId: artAttempt, planId: artPlan, nodeId: 'poster-node',
      eventId: 'poster-event-' + h.libraRunId, eventAttemptId: 'poster-attempt', capabilityRef: 'libra.product_artifact.acquire@1',
      inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [{ portName: 'artifactRequirement', bindingKind: 'literal', parameters: { artifactKind: 'poster' } }] },
      resultId: 'poster-result-1',
      result: { schemaRef: 'helix://contracts/types/ArtifactAcquisitionResult/v1', resultKind: 'not_available', artifactKind: 'poster', reasonCode: 'provider_artifact_absent' },
    });

    const { attemptId: mediaAttempt, planId: mediaPlan } = insertWork(h.db, {
      workId: 'media-work-' + h.libraRunId, libraRunId: h.libraRunId, workKind: 'workspace_media_production', basisDigest: D('media'), definition: { kind: 'media' },
    });
    insertEventResult(h.db, {
      workId: 'media-work-' + h.libraRunId, attemptId: mediaAttempt, planId: mediaPlan, nodeId: 'verify-node',
      eventId: 'verify-event-' + h.libraRunId, eventAttemptId: 'verify-attempt', capabilityRef: 'libra.product_media.verify@1',
      inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [] },
      resultId: 'verify-size-1',
      result: {
        libraRunId: h.libraRunId,
        verificationId: 'verify-size-id',
        candidateKind: 'workspace_output',
        result: 'failed',
        reasonCodes: ['max_size_exceeded'],
        decodeSummary: { samplePointsPercent: [5, 50, 95], passedSamplePointsPercent: [5, 50, 95], decodeDigest: D('decode-ok') },
        spaceSummary: { unit: 'product', maxSizeBytes: 50 * 1073741824, actualSizeBytes: 55 * 1073741824, withinLimit: false },
      },
    });
    h.freezeRun();

    const view = h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId });
    assert.equal(view.kind, 'ready');
    const summary = view.proposals.map(p => p.change.requirementCode + ':' + p.change.targetId).sort();
    assert.deepEqual(summary, [
      'max_size_exceeded:maxSizeBytes',
      'metadata_artifact_unmet:poster',
      'metadata_field_unmet:plot',
    ]);
  }));

test('non-Movie profile, protected media/metadata failures, and zero relaxable gaps return ineligible and reject confirm', () => {
  withViewHarness({ profile: 'series' }, h => {
    h.seedIdentity();
    const view = h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId });
    assert.equal(view.kind, 'ineligible');
    const previewRes = h.app.preparePreview('admin', { subjectId: 'subject', libraRunId: h.libraRunId, idempotencyKey: 'series-ineligible' });
    assert.equal(previewRes.kind, 'ineligible');
  });

  withViewHarness(h => {
    const obs = h.seedIdentity();
    h.seedSourceProbe({ longEdge: 1920, shortEdge: 1080, audio: ['other'] });
    h.seedSearchNotSelected('succeeded', obs);
    h.freezeRun();
    const preview = h.app.preparePreview('admin', { subjectId: 'subject', libraRunId: h.libraRunId, idempotencyKey: 'valid-preview' });
    assert.equal(preview.kind, 'preview');

    // Inject non-relaxable decode failure after preview
    const { attemptId, planId } = insertWork(h.db, {
      workId: 'decode-fail-work', libraRunId: h.libraRunId, workKind: 'workspace_media_production', basisDigest: D('decode'), definition: { kind: 'decode' },
    });
    insertEventResult(h.db, {
      workId: 'decode-fail-work', attemptId, planId, nodeId: 'decode-fail-node', eventId: 'decode-fail-event',
      eventAttemptId: 'decode-fail-attempt', capabilityRef: 'libra.product_media.verify@1',
      inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [] },
      resultId: 'decode-fail-result',
      result: { libraRunId: h.libraRunId, verificationId: 'bad-decode', candidateKind: 'direct_input', result: 'failed', reasonCodes: ['decode_failed'] },
    });
    assert.equal(h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId }).kind, 'ineligible');
    assert.throws(() => h.app.confirm('admin', {
      previewDigest: preview.record.previewDigest,
      selectedChangeDigests: preview.record.proposals.map(p => p.changeDigest),
      acknowledged: true,
      idempotencyKey: 'confirm-after-ineligible',
    }), { code: 'LIBRA_CUSTOM_TARGET_PREVIEW_STALE' });
  });

  withViewHarness(h => {
    h.seedIdentity();
    h.seedSourceProbe({ longEdge: 3840, shortEdge: 2160, audio: ['dts_hd_ma'] });
    h.freezeRun();
    const view = h.currentViewReader.read({ subjectId: 'subject', libraRunId: h.libraRunId });
    assert.equal(view.kind, 'ineligible');
    assert.equal(view.reasonCode, 'no_relaxable_gaps');
  });
});
