'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createIntakeProcessCoordinator } = require('../../src/helix/domains/libra/application/intake-process-coordinator');
const {
  REJECTION,
  REJECTION_HANDLE,
  createIntakeProjections,
  createRejectionPlanner,
} = require('../../src/helix/domains/libra/planning/intake-planners');
const { createIntakeRejectionStore } = require('../../src/helix/domains/libra/persistence/intake-rejection-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const rejectionManifest = require('../../src/helix/contracts/capabilities/libra/intake/rejection/commit/v1/manifest.json');
const digest = (value) => canonicalDigest({ value });
const without = (value, ...fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));

function deliverySnapshot() {
  const candidatePackage = {
    candidatePackageId: 'candidate-planner-1', packageRevision: 1, packageDigest: digest('package'),
    materialFieldContextRef: { fieldId: 'field-planner-1', accessRevision: 1, contextDigest: digest('field') },
    contentProfile: 'movie', identityClaim: { claimDigest: digest('identity') },
    relatedDispositionScopeDigest: digest('related'),
  };
  const acceptanceBasis = { acceptanceBasisDigest: digest('acceptance') };
  const offer = {
    offerId: 'offer-planner-1', candidatePackageId: candidatePackage.candidatePackageId,
    packageRevision: 1, packageDigest: candidatePackage.packageDigest,
    acceptanceBasisDigest: acceptanceBasis.acceptanceBasisDigest,
  };
  const value = {
    snapshotContract: 'CandidateDeliverySnapshot@1', offer, acceptanceBasis, candidatePackage,
    primaryInputManifest: { manifestId: 'manifest-planner-1', structureKind: 'single' },
    primaryMaterialDeliveries: [], deliveryMemberSetDigest: digest('members'), deliverySnapshotDigest: '',
  };
  value.deliverySnapshotDigest = canonicalDigest(without(value, 'deliverySnapshotDigest'));
  return Object.freeze(value);
}

function planner() {
  const registry = Object.freeze({
    snapshot: Object.freeze([{ capabilityRef: rejectionManifest.capabilityRef }]),
    resolve: () => Object.freeze({ manifest: rejectionManifest }),
  });
  const policyRegistry = Object.freeze({
    digest: digest('policy'),
    bindingFor: () => Object.freeze({ retryPolicyRef: 'retry@1', timeoutPolicyRef: 'timeout@1' }),
  });
  return createRejectionPlanner({ registry, policyRegistry });
}

function verificationResults(snapshot) {
  return Object.freeze([
    Object.freeze({ outcomeKind: 'succeeded', result: Object.freeze({
      schemaRef: 'helix://contracts/types/CandidateContractVerification/v1', schemaVersion: 1,
      verificationId: 'candidate-verification-1', result: 'passed', reasonCodes: Object.freeze([]),
      verifiedAtMs: 100, basisDigest: snapshot.deliverySnapshotDigest,
    }) }),
    Object.freeze({ outcomeKind: 'succeeded', result: Object.freeze({
      schemaRef: 'helix://contracts/types/IntakeMaterialVerification/v1', schemaVersion: 1,
      verificationId: 'material-verification-1', result: 'failed',
      reasonCodes: Object.freeze(['candidate_material_unavailable']), verifiedMaterials: Object.freeze([]),
      verifiedAtMs: 101, basisDigest: snapshot.deliverySnapshotDigest,
    }) }),
  ]);
}

test('Rejection Planner projects the exact Evidence Work id, commits rejection, and releases the pipeline seat', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-intake-rejection-planner-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 102 });
  const snapshot = deliverySnapshot();
  const processId = canonicalDigest({ schema: 'libra.intake-decision-id@1', offerId: snapshot.offer.offerId });
  const source = Object.freeze({ processId, offer: snapshot.offer, snapshot });
  const results = verificationResults(snapshot);
  const readWorkIds = [];
  let rejectionSucceeded = false;
  let releasedSubjectId = null;
  try {
    const rejectionStore = createIntakeRejectionStore({
      schemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
    });
    const projections = createIntakeProjections({
      offerReader: { read: () => source },
      workResultReader: {
        listWorks: () => { throw new Error('The exact Evidence Work dependency must be used.'); },
        read(workId) { readWorkIds.push(workId); return results; },
      },
      decisionResolver: { resolve: () => { throw new Error('Rejection must not resolve Subject continuity.'); } },
    });
    const byRef = new Map(projections.map((item) => [item.projectionRef, item.projection]));
    const workAdmission = Object.freeze({
      replay: () => null,
      submit(work) {
        if (work.workKind === 'rejection') {
          const plan = planner().plan({ ...work, workAttemptId: 'attempt-rejection-planner-1' });
          const node = plan.nodes[0];
          const decisionBinding = node.inputBindings.bindings.find((item) => item.portName === 'intakeRejectionDecision');
          const handleBinding = node.inputBindings.bindings.find((item) => item.portName === 'domainFactCommitHandle');
          assert.equal(typeof decisionBinding.parameters.evidenceWorkId, 'string');
          assert.equal(decisionBinding.parameters.evidenceWorkId, work.dependencyRefs[0].objectId);
          assert.equal(handleBinding.parameters.evidenceWorkId, work.dependencyRefs[0].objectId);
          const ownerScope = { processId };
          const decision = byRef.get(REJECTION).project({ ownerScope, parameters: decisionBinding.parameters });
          const handle = byRef.get(REJECTION_HANDLE).project({ ownerScope, parameters: handleBinding.parameters });
          const db = new Database(databasePath);
          db.prepare('INSERT INTO fx_workflow_events(event_id) VALUES(?)').run(node.eventId);
          db.close();
          rejectionStore.reject({
            deliverySnapshot: snapshot,
            reasons: decision.structuredRejection.reasons,
            decidedAtMs: decision.structuredRejection.decidedAtMs,
            domainFactCommitHandle: handle,
            commitMarker: { commitMarker: 'rejection-planner-marker', commitDigest: decision.decisionDigest },
            resultBinding: {
              resultId: 'rejection-planner-result', eventId: node.eventId,
              evidenceSchemaRef: 'helix://tests/intake-rejection-planner/evidence/v1',
              evidence: { kind: 'planner-regression' }, effectReceiptId: 'rejection-planner-effect',
            },
          });
          rejectionSucceeded = true;
        }
        return Object.freeze({ kind: 'admitted', workId: work.workId, state: 'admitted', replayed: false });
      },
    });
    const coordinator = createIntakeProcessCoordinator({
      offerReader: {
        read: () => source,
        decisionId: () => processId,
      },
      pipelineAdmission: {
        hasToken: () => true,
        freeSeats: () => 0,
        readPolicy: () => ({ predeckPipelineSeats: 1 }),
        tryAcquireForProcess: () => { throw new Error('The held seat must be reused.'); },
        releaseForSubject(subjectId) { releasedSubjectId = subjectId; },
      },
      subjectIdForProcess: () => 'subject-planner-1',
      workAdmission,
      workResultReader: {
        status: (workId) => workId.includes('-evidence-work-') || rejectionSucceeded ? { state: 'succeeded' } : null,
        read: () => results,
      },
    });
    const outcome = coordinator.reconcile(processId);
    assert.equal(outcome.kind, 'terminal');
    assert.equal(outcome.outcome, 'rejected');
    assert.equal(releasedSubjectId, 'subject-planner-1');
    assert.deepEqual([...new Set(readWorkIds)], [outcome.evidenceWorkId]);
    const db = new Database(databasePath, { readonly: true });
    assert.deepEqual(db.prepare('SELECT decision_kind,primary_rejection_code FROM libra_intake_decisions').get(), {
      decision_kind: 'rejected_acceptance', primary_rejection_code: 'candidate_material_unavailable',
    });
    db.close();
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Rejection Planner refuses an absent or non-Work Evidence dependency', () => {
  const request = {
    workAttemptId: 'attempt-invalid', workId: 'work-invalid', ownerDomain: 'libra',
    processType: 'libra_intake', processId: 'process-invalid', executionBasisDigest: digest('basis'),
  };
  assert.throws(() => planner().plan({ ...request, dependencyRefs: [] }), {
    code: 'P8_INTAKE_REJECTION_EVIDENCE_DEPENDENCY_INVALID',
  });
  assert.throws(() => planner().plan({ ...request, dependencyRefs: [{
    ownerDomain: 'libra', objectType: 'subject', objectId: 'subject-1', revision: 1, digest: digest('subject'),
  }] }), { code: 'P8_INTAKE_REJECTION_EVIDENCE_DEPENDENCY_INVALID' });
});
