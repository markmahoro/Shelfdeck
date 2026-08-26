'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createProcurementRunCoordinator } = require(
  '../../src/helix/domains/procurement/application/procurement-run-coordinator');
const { validateProcurementRunSealDecision } = require(
  '../../src/helix/domains/procurement/model/procurement-run-seal-contracts');
const { createWorkResultReader } = require('../../src/helix/foundation/execution/work-result-reader');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

test('failed Evidence Assessment seals its Procurement Run and releases the immutable Selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-procurement-coordinator-failure-'));
  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(root, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => 1700000001100,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const runId = 'procurement-run-failed-evidence';
  const runBasisDigest = canonicalDigest({ runId });
  const materialKeys = [canonicalDigest({ material: 2 }), canonicalDigest({ material: 1 })];
  const run = Object.freeze({
    procurement_run_id: runId,
    run_basis_digest: runBasisDigest,
    state: 'active',
    state_revision: 1,
    candidate_package_revision_head: 0,
  });
  let evidenceIndexReads = 0;
  let sealedDecision = null;
  const coordinator = createProcurementRunCoordinator({
    schemaManifest,
    unitOfWork,
    triageReader: Object.freeze({
      readRunHeader: () => run,
      readRunBasis: () => Object.freeze({
        run,
        members: Object.freeze(materialKeys.map((materialKey) => Object.freeze({ material_key: materialKey }))),
      }),
      listCandidatePackages: () => Object.freeze([]),
    }),
    workResultReader: Object.freeze({
      status: (workId) => Object.freeze({
        work_id: workId,
        owner_domain: 'procurement',
        process_type: 'procurement_run',
        process_id: runId,
        work_kind: 'evidence_assessment',
        state: 'running',
        latestAttempt: Object.freeze({
          attempt_id: 'evidence-attempt-1', ordinal: 1, state: 'failed', failure_code: 'P4_EVENT_INPUT_PREPARATION_FAILED',
        }),
      }),
    }),
    evidenceIndex: Object.freeze({ read: () => {
      evidenceIndexReads += 1;
      return Object.freeze({ structureResults: Object.freeze([]), units: Object.freeze([]), terminal: false });
    } }),
    runSealStore: Object.freeze({ seal: (decision) => {
      sealedDecision = validateProcurementRunSealDecision(decision);
      return Object.freeze({ receiptKind: 'procurement_run_sealed' });
    } }),
  });

  try {
    const result = coordinator.reconcile(runId);
    assert.equal(result.kind, 'run_sealed');
    assert.equal(result.newlyAdmitted, 0);
    assert.deepEqual(result.candidateWorks, []);
    assert.equal(evidenceIndexReads, 1);
    assert.equal(sealedDecision.sealOutcome, 'failed');
    assert.deepEqual(sealedDecision.publishedCandidates, []);
    assert.deepEqual(sealedDecision.releasedMembers.map((item) => item.materialKey), [...materialKeys].sort());
    assert.ok(sealedDecision.releasedMembers.every((item) => item.disposition === 'triage_failed'));
    assert.ok(sealedDecision.releasedMembers.every((item) => /^[0-9a-f]{64}$/.test(item.evidenceDigest)));
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cancelled paged Evidence preserves successful Candidates and releases only the uncovered Selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-procurement-coordinator-partial-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000002200 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const workResultReader = createWorkResultReader({ schemaManifest, unitOfWork });
  const runId = 'procurement-run-partial-evidence';
  const runBasisDigest = canonicalDigest({ runId });
  const candidateMaterialKey = canonicalDigest({ material: 'candidate' });
  const uncoveredMaterialKey = canonicalDigest({ material: 'uncovered' });
  let run = Object.freeze({
    procurement_run_id: runId,
    run_basis_digest: runBasisDigest,
    state: 'active',
    state_revision: 1,
    candidate_package_revision_head: 0,
  });
  const structure = Object.freeze({
    payloadDigest: canonicalDigest({ structure: 1 }),
    unassignedMaterials: Object.freeze([]),
  });
  const unit = Object.freeze({
    unitId: 'unit-1',
    unitDigest: canonicalDigest({ unit: 1 }),
    members: Object.freeze([Object.freeze({ materialKey: candidateMaterialKey })]),
  });
  const runBasis = () => Object.freeze({
    run,
    members: Object.freeze([candidateMaterialKey, uncoveredMaterialKey]
      .map((materialKey) => Object.freeze({ material_key: materialKey }))),
  });
  let sealedDecision = null;
  const coordinator = createProcurementRunCoordinator({
    schemaManifest,
    unitOfWork,
    triageReader: Object.freeze({
      readRunHeader: () => run,
      readRunBasis: runBasis,
      listCandidatePackages: () => Number(run.candidate_package_revision_head) === 0 ? Object.freeze([]) : Object.freeze([Object.freeze({
        candidate_package_id: canonicalDigest({ candidate: 1 }),
        package_digest: canonicalDigest({ package: 1 }),
        manifest_digest: canonicalDigest({ manifest: 1 }),
      })]),
    }),
    workResultReader,
    evidenceIndex: Object.freeze({ read: () => Object.freeze({
      structureResults: Object.freeze([structure]),
      units: Object.freeze([Object.freeze({ structure, unit, ordinal: 0 })]),
      terminal: false,
    }) }),
    runSealStore: Object.freeze({ seal: (decision) => {
      sealedDecision = validateProcurementRunSealDecision(decision);
      return Object.freeze({ receiptKind: 'procurement_run_sealed' });
    } }),
  });

  try {
    const admitted = coordinator.reconcile(runId);
    assert.equal(admitted.kind, 'candidate_work_ready');
    assert.equal(admitted.newlyAdmitted, 1);
    const database = new Database(databasePath);
    try {
      const evidence = database.prepare("SELECT work_id,basis_digest FROM fx_supporting_works WHERE work_kind='evidence_assessment'").get();
      const candidate = database.prepare("SELECT work_id FROM fx_supporting_works WHERE work_kind='candidate_assembly'").get();
      database.prepare("UPDATE fx_supporting_works SET state='running' WHERE work_id=?").run(evidence.work_id);
      database.prepare(`INSERT INTO fx_work_attempts
        (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code)
        VALUES (?,?,?,?,?,?,?,?)`).run('cancelled-evidence-attempt', evidence.work_id, 1, evidence.basis_digest,
        'cancelled', 1700000002200, 1700000002201, null);
      database.prepare("UPDATE fx_supporting_works SET state='succeeded' WHERE work_id=?").run(candidate.work_id);
    } finally {
      database.close();
    }
    run = Object.freeze({ ...run, candidate_package_revision_head: 1 });

    const result = coordinator.reconcile(runId);
    assert.equal(result.kind, 'run_sealed');
    assert.equal(result.newlyAdmitted, 0);
    assert.equal(sealedDecision.sealOutcome, 'partial_failure');
    assert.equal(sealedDecision.publishedCandidates.length, 1);
    assert.deepEqual(sealedDecision.releasedMembers.map((item) => item.materialKey), [uncoveredMaterialKey]);
    assert.equal(sealedDecision.releasedMembers[0].disposition, 'triage_failed');
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
