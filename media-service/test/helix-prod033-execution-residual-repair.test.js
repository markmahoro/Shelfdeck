'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { inspectPlan, applyRepair, FAILURE_CODE } = require('../scripts/helix-prod033-execution-residual-repair');

const schemaDdl = fs.readFileSync(path.join(__dirname,
  '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');

function fixture(effectClass = 'workspace_write') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-prod033-repair-'));
  const database = new Database(path.join(root, 'shelfdeck.db'));
  database.exec(schemaDdl);
  const definition = JSON.stringify({ schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1' });
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,
     definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('work','libra','libra_run','run','artifact_production','a'.repeat(64),
    'normal','helix://foundation/types/SupportingWorkDefinition/v1',definition,canonicalDigest(JSON.parse(definition)),
    'cancelled','key',1,2);
  database.prepare(`INSERT INTO fx_work_attempts
    (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES (?,?,?,?,?,?)`)
    .run('attempt','work',1,'a'.repeat(64),'running',2);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan','attempt','planner',1,'b'.repeat(64),'a'.repeat(64),'c'.repeat(64),'planned',2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('event','plan','node','work','attempt','libra','libra.fixture@1',1,'executing','normal');
  database.prepare(`INSERT INTO fx_event_attempts
    (event_attempt_id,event_id,ordinal,state,started_at_ms) VALUES (?,?,?,?,?)`)
    .run('event-attempt','event',1,'executing',3);
  database.prepare(`INSERT INTO fx_effect_journal
    (effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms)
    VALUES (?,?,?,?,?,?,?)`).run('effect','event-attempt',effectClass,'effect-key','d'.repeat(64),'intended',3);
  return { root, database };
}

test('PROD-033 repair closes only cancelled Libra Work graphs with uncommitted Workspace Effects', () => {
  const value = fixture();
  try {
    assert.equal(inspectPlan(value.database).repairableCount, 1);
    assert.deepEqual(applyRepair(value.database, 1000), {
      repairedAttempts:1, cancelledEvents:1, completedEventAttempts:1, abandonedEffects:1,
      cancelledResourceDefers:0,
    });
    assert.deepEqual(value.database.prepare('SELECT state,failure_code FROM fx_work_attempts').get(),
      { state:'cancelled', failure_code:FAILURE_CODE });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_workflow_events').get(), { state:'cancelled' });
    assert.deepEqual(value.database.prepare('SELECT state,outcome_kind,failure_code FROM fx_event_attempts').get(),
      { state:'completed', outcome_kind:'cancelled', failure_code:FAILURE_CODE });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_effect_journal').get(), { state:'failed' });
    assert.equal(inspectPlan(value.database).attempts.length, 0);
  } finally {
    value.database.close(); fs.rmSync(value.root, { recursive:true, force:true });
  }
});

test('PROD-033 repair fails closed for a non-Workspace unresolved Effect', () => {
  const value = fixture('material_commit');
  try {
    assert.equal(inspectPlan(value.database).unsafeCount, 1);
    assert.throws(() => applyRepair(value.database, 1000), /PROD033_EXECUTION_RESIDUAL_UNSAFE/);
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_work_attempts').get(), { state:'running' });
  } finally {
    value.database.close(); fs.rmSync(value.root, { recursive:true, force:true });
  }
});
