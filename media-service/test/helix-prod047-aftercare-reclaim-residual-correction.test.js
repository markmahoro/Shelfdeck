'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const {
  inspectPlan, applyCorrection, FAILURE_CODE, reclaimIdentity, receiptFor,
} = require('../scripts/helix-prod047-aftercare-reclaim-residual-correction');

const schemaDdl = fs.readFileSync(path.join(__dirname,
  '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-prod047-correction-'));
  const database = new Database(path.join(root, 'shelfdeck.db'));
  database.exec(schemaDdl);
  database.pragma('foreign_keys = OFF');
  const caseId = 'aftercare-case';
  const workId = 'work';
  const handleId = 'handle';
  const handleDigest = '1'.repeat(64);
  const fenceDigest = '2'.repeat(64);
  const definition = {
    schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion:1,
    workId, ownerDomain:'arca', processType:'arca_shelf_entry', processId:'shelf-entry',
    workKind:'care_workspace_reclaim', outputContractRef:'helix://contracts/types/ReclamationReceipt/v1',
    dependencyRefs:[{ ownerDomain:'arca', objectType:'aftercare_case', objectId:caseId,
      revision:1, digest:'3'.repeat(64) }],
    workspaceMaterialScope:[{ handleId, fenceDigest }],
  };
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,
     definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(workId,'arca','arca_shelf_entry','shelf-entry',
    'care_workspace_reclaim','4'.repeat(64),'normal',definition.schemaRef,JSON.stringify(definition),
    canonicalDigest(definition),'running','key',1,2);
  database.prepare(`INSERT INTO fx_work_attempts
    (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES (?,?,?,?,?,?)`)
    .run('attempt',workId,1,'4'.repeat(64),'running',2);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan','attempt','planner',1,'5'.repeat(64),'4'.repeat(64),
    '6'.repeat(64),'planned',2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('event','plan','node',workId,'attempt','arca',
    'arca.aftercare.workspace.reclaim@1',1,'executing','normal');
  database.prepare(`INSERT INTO fx_event_attempts
    (event_attempt_id,event_id,ordinal,state,started_at_ms) VALUES (?,?,?,?,?)`)
    .run('event-attempt','event',1,'executing',3);
  database.prepare(`INSERT INTO fx_effect_journal
    (effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms)
    VALUES (?,?,?,?,?,?,?)`).run('effect','event-attempt','workspace_write','effect-key',
    '7'.repeat(64),'intended',3);
  database.prepare(`INSERT INTO arca_aftercare_cases
    (aftercare_case_id,shelf_entry_id,state,terminal_at_ms) VALUES (?,?,?,?)`)
    .run(caseId,'shelf-entry','resolved',50);
  database.prepare(`INSERT INTO fx_workspace_registry
    (workspace_id,owner_domain,process_type,process_id,root_handle_ref,state,created_at_ms,reclaim_after_ms,reclaimed_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(caseId,'arca','aftercare_case',caseId,'root','reclaimed',1,40,100);
  const material = { material_handle_id:handleId, handle_digest:handleDigest, fence_digest:fenceDigest,
    size_bytes:20 };
  const identity = reclaimIdentity(caseId, [material]);
  const legacyDigest = canonicalDigest(receiptFor(caseId, identity, [material], 100, false));
  database.prepare(`INSERT INTO fx_workspace_materials
    (workspace_id,material_handle_id,size_bytes,handle_json,handle_digest,fence_digest,state,
     reclaimed_effect_id,reclaimed_effect_receipt_digest,reclaimed_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(caseId,handleId,20,'{}',handleDigest,fenceDigest,'reclaimed',
    identity.effectId,legacyDigest,100);
  database.prepare(`INSERT INTO fx_artifact_registry
    (artifact_handle_id,owner_domain,owner_scope_type,owner_scope_id,reference_revision,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?)`).run('artifact','arca','aftercare_case',caseId,1,'deleted',1);
  return { root, database, caseId, workId, identity, material };
}

function domainSnapshot(database) {
  return {
    cases:database.prepare('SELECT * FROM arca_aftercare_cases ORDER BY aftercare_case_id').all(),
    registry:database.prepare('SELECT * FROM fx_workspace_registry ORDER BY workspace_id').all(),
    materials:database.prepare('SELECT * FROM fx_workspace_materials ORDER BY workspace_id,material_handle_id').all(),
    artifacts:database.prepare('SELECT * FROM fx_artifact_registry ORDER BY artifact_handle_id').all(),
  };
}

function dispose(value) {
  value.database.close();
  fs.rmSync(value.root, { recursive:true, force:true });
}

test('PROD-047 retires only the execution graph proven to have the exact legacy Receipt', () => {
  const value = fixture();
  try {
    const before = domainSnapshot(value.database);
    const plan = inspectPlan(value.database);
    assert.equal(plan.repairableCount, 1);
    assert.equal(plan.unsafeCount, 0);
    assert.notEqual(plan.candidates[0].legacyReceiptDigest, plan.candidates[0].currentReceiptDigest);
    assert.deepEqual(applyCorrection(value.database, 1000, [value.workId]), {
      cancelledWorks:1, cancelledAttempts:1, cancelledEvents:1,
      completedEventAttempts:1, failedEffects:1, cancelledResourceDefers:0,
    });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_supporting_works').get(),
      { state:'cancelled' });
    assert.deepEqual(value.database.prepare('SELECT state,failure_code FROM fx_work_attempts').get(),
      { state:'cancelled', failure_code:FAILURE_CODE });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_workflow_events').get(),
      { state:'cancelled' });
    assert.deepEqual(value.database.prepare(
      'SELECT state,outcome_kind,failure_code FROM fx_event_attempts').get(),
    { state:'completed', outcome_kind:'cancelled', failure_code:FAILURE_CODE });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_effect_journal').get(),
      { state:'failed' });
    assert.deepEqual(domainSnapshot(value.database), before);
    assert.equal(inspectPlan(value.database).candidates.length, 0);
  } finally { dispose(value); }
});

test('PROD-047 fails closed when the stored Receipt is already the current contract', () => {
  const value = fixture();
  try {
    const currentDigest = canonicalDigest(receiptFor(value.caseId, value.identity,
      [value.material], 100, true));
    value.database.prepare(`UPDATE fx_workspace_materials
      SET reclaimed_effect_receipt_digest = ?`).run(currentDigest);
    const plan = inspectPlan(value.database);
    assert.equal(plan.unsafeCount, 1);
    assert.ok(plan.candidates[0].unsafeReasons.includes('legacy_receipt_proof_mismatch'));
    assert.throws(() => applyCorrection(value.database, 1000, [value.workId]),
      /PROD047_AFTERCARE_RECLAIM_RESIDUAL_UNSAFE/);
  } finally { dispose(value); }
});

test('PROD-047 fails closed for an immutable Result, commit marker, or active reference', () => {
  const variants = [
    (db) => db.prepare(`INSERT INTO fx_event_result_bindings
      (result_id,event_id,result_json,evidence_json,committed_at_ms) VALUES (?,?,?,?,?)`)
      .run('result','event','{}','{}',5),
    (db) => db.prepare(`INSERT INTO fx_commit_markers
      (commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?)`).run('marker','effect','arca','aftercare_case','aftercare-case','8'.repeat(64),5),
    (db) => db.prepare(`INSERT INTO fx_artifact_references
      (artifact_handle_id,consumer_domain,consumer_scope_type,consumer_scope_id,reference_kind,
       reference_revision,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact','arca','case','consumer','test',1,'active',5),
  ];
  for (const mutate of variants) {
    const value = fixture();
    try {
      mutate(value.database);
      assert.equal(inspectPlan(value.database).unsafeCount, 1);
      assert.throws(() => applyCorrection(value.database, 1000, [value.workId]),
        /PROD047_AFTERCARE_RECLAIM_RESIDUAL_UNSAFE/);
    } finally { dispose(value); }
  }
});

test('PROD-047 requires the operator-provided Work set to match exactly', () => {
  const value = fixture();
  try {
    assert.throws(() => applyCorrection(value.database, 1000, []),
      /PROD047_EXPECTED_WORK_IDS_REQUIRED/);
    assert.throws(() => applyCorrection(value.database, 1000, ['another-work']),
      /PROD047_EXPECTED_WORK_IDS_MISMATCH/);
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_supporting_works').get(),
      { state:'running' });
  } finally { dispose(value); }
});
