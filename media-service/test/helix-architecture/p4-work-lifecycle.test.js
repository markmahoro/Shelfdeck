'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createWorkLifecycle } = require('../../src/helix/foundation/execution/work-lifecycle');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-work-lifecycle-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const database = new Database(databasePath);
  const definition = {
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1,
    workId: 'work-1', ownerDomain: 'procurement', processType: 'procurement_run', processId: 'run-1',
    workKind: 'evidence_assessment', workObjectiveTypeRef: 'helix://procurement/work/EvidenceAssessment/v1',
    workObjectiveVersion: 1, executionBasisId: 'run-1', executionBasisDigest: 'a'.repeat(64),
    dependencyRefs: [{ ownerDomain:'procurement', objectType:'procurement_run', objectId:'run-1', revision:1,
      digest:'b'.repeat(64) }], priorityClass: 'normal_foreground', priorityRevision: 1,
    capabilityCatalogScope: 'procurement', workspaceMaterialScope: [], idempotencyKey: 'key-1',
    concurrencyScope: 'run-1/evidence', outputContractRef: 'helix://procurement/results/EvidenceAssessment/v1',
  };
  const definitionJson = JSON.stringify(canonical(definition));
  const definitionDigest = crypto.createHash('sha256').update(definitionJson).digest('hex');
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,
     definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('work-1', 'procurement', 'procurement_run', 'run-1', 'evidence_assessment',
    'a'.repeat(64), 'normal_foreground', definition.schemaRef, definitionJson, definitionDigest, 'admitted', 'key-1', 1, 1);
  database.close();
  let ids = 0;
  const lifecycle = createWorkLifecycle({ schemaManifest, unitOfWork, nextWorkAttemptId: () => 'attempt-' + (++ids) });
  try { return run({ lifecycle, databasePath }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function read(databasePath, sql, ...parameters) {
  const database = new Database(databasePath, { readonly: true });
  try { return database.prepare(sql).get(...parameters); } finally { database.close(); }
}

test('activation creates one ready Work Attempt and replay never replans under another Attempt', () => fixture(({ lifecycle, databasePath }) => {
  const first = lifecycle.ensurePlanningAttempt('work-1');
  const second = lifecycle.ensurePlanningAttempt('work-1');
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.attempt.attempt_id, first.attempt.attempt_id);
  assert.deepEqual(first.work.definition.dependencyRefs, [{ ownerDomain:'procurement', objectType:'procurement_run',
    objectId:'run-1', revision:1, digest:'b'.repeat(64) }]);
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_supporting_works WHERE work_id=?', 'work-1'), { state: 'ready' });
  assert.deepEqual(read(databasePath, 'SELECT COUNT(*) count FROM fx_work_attempts WHERE work_id=?', 'work-1'), { count: 1 });
}));

test('terminal Event aggregation closes only Work Attempt until Domain Owner settles Work', () => fixture(({ lifecycle, databasePath }) => {
  const activation = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', activation.attempt.attempt_id, 'planner@1', 1, 'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'planned', 2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('event-1', 'plan-1', 'node-1', 'work-1', activation.attempt.attempt_id,
    'procurement', 'procurement.test@1', 1, 'succeeded', 'normal_foreground', 2);
  database.close();
  assert.equal(lifecycle.startPlanned('work-1', activation.attempt.attempt_id).state, 'running');
  const terminal = lifecycle.aggregateEvent('event-1');
  assert.equal(terminal.attemptTerminal, true);
  assert.equal(terminal.workTerminal, false);
  assert.equal(terminal.work.state, 'running');
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_work_attempts WHERE attempt_id=?', activation.attempt.attempt_id), { state: 'succeeded' });
  assert.equal(lifecycle.settleWork({ workId: 'work-1', disposition: 'succeeded' }).state, 'succeeded');
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_supporting_works WHERE work_id=?', 'work-1'), { state: 'succeeded' });
}));

test('failed Event reports failed Attempt and Domain Owner explicitly fails its Work', () => fixture(({ lifecycle, databasePath }) => {
  const activation = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', activation.attempt.attempt_id, 'planner@1', 1, 'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'planned', 2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('event-1', 'plan-1', 'node-1', 'work-1', activation.attempt.attempt_id,
    'procurement', 'procurement.test@1', 1, 'failed', 'normal_foreground', 2);
  database.close();
  lifecycle.startPlanned('work-1', activation.attempt.attempt_id);
  assert.equal(lifecycle.aggregate('work-1').attemptState, 'failed');
  assert.deepEqual(read(databasePath, 'SELECT state,failure_code FROM fx_work_attempts WHERE attempt_id=?', activation.attempt.attempt_id),
    { state: 'failed', failure_code: 'EVENT_TERMINAL_FAILURE' });
  lifecycle.settleWork({ workId: 'work-1', disposition: 'failed' });
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_supporting_works WHERE work_id=?', 'work-1'), { state: 'failed' });
}));

test('contract-unplannable Work persists its stable Planner diagnostic on the terminal Attempt', () => fixture(({ lifecycle, databasePath }) => {
  const activation = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', activation.attempt.attempt_id, 'planner@1', 1,
      'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'contract_unplannable', 2);
  database.close();
  const started = lifecycle.startPlanned('work-1', activation.attempt.attempt_id,
    'candidate_disposition_scope_unrepresentable');
  assert.equal(started.attemptState, 'failed');
  assert.equal(started.attemptFailureCode, 'candidate_disposition_scope_unrepresentable');
  assert.deepEqual(read(databasePath, 'SELECT state,failure_code FROM fx_work_attempts WHERE attempt_id=?', activation.attempt.attempt_id),
    { state:'failed', failure_code:'candidate_disposition_scope_unrepresentable' });
}));

test('Owner can replan a blocked Work onto a new Attempt without changing identity or Basis', () => fixture(({ lifecycle, databasePath }) => {
  const first = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', first.attempt.attempt_id, 'planner@1', 1, 'b'.repeat(64), 'a'.repeat(64),
    'c'.repeat(64), 'temporarily_unplannable', 2);
  database.close();
  const started = lifecycle.startPlanned('work-1', first.attempt.attempt_id, 'media_device_strategies_unavailable');
  assert.equal(started.state, 'blocked');
  assert.equal(started.attemptState, 'blocked');
  assert.equal(lifecycle.settleWork({ workId: 'work-1', disposition: 'replan' }).state, 'ready');
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_supporting_works WHERE work_id=?', 'work-1'), { state: 'ready' });
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_work_attempts WHERE attempt_id=?', first.attempt.attempt_id),
    { state: 'cancelled' });
  const second = lifecycle.ensurePlanningAttempt('work-1');
  assert.equal(second.attempt.ordinal, 2);
  assert.notEqual(second.attempt.attempt_id, first.attempt.attempt_id);
  assert.equal(second.attempt.basis_digest, first.attempt.basis_digest);
}));

test('Owner can request a new bounded Attempt without changing Work identity or Basis', () => fixture(({ lifecycle, databasePath }) => {
  const first = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', first.attempt.attempt_id, 'planner@1', 1, 'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'no_effect_required', 2);
  database.close();
  const started = lifecycle.startPlanned('work-1', first.attempt.attempt_id);
  assert.equal(started.attemptState, 'succeeded');
  lifecycle.settleWork({ workId: 'work-1', disposition: 'replan' });
  const second = lifecycle.ensurePlanningAttempt('work-1');
  assert.equal(second.attempt.ordinal, 2);
  assert.notEqual(second.attempt.attempt_id, first.attempt.attempt_id);
  assert.equal(second.attempt.basis_digest, first.attempt.basis_digest);
}));

test('Process cancellation atomically cancels durable Resource Defers and clears the Event retry fence', () => fixture(({ lifecycle, databasePath }) => {
  const activation = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', activation.attempt.attempt_id, 'planner@1', 1,
      'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'planned', 2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,retry_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('event-1', 'plan-1', 'node-1', 'work-1', activation.attempt.attempt_id,
    'procurement', 'procurement.test@1', 1, 'waiting_for_resource', 'normal_foreground', 2, 999);
  const insertDefer = database.prepare(`INSERT INTO fx_resource_defer
    (event_id,resource_key,queue_class,local_priority,enqueued_at_ms,retry_at_ms,state) VALUES(?,?,?,?,?,?,?)`);
  insertDefer.run('event-1', 'cpu', 'normal_foreground', 0, 3, 999, 'waiting');
  insertDefer.run('event-1', 'volume:test', 'normal_foreground', 0, 3, 999, 'waiting');
  database.close();
  lifecycle.startPlanned('work-1', activation.attempt.attempt_id);

  assert.deepEqual(lifecycle.cancelProcess({ ownerDomain:'procurement', processType:'procurement_run',
    processId:'run-1', reasonCode:'TEST_PROCESS_CANCELLED' }), {
    ownerDomain:'procurement', processType:'procurement_run', processId:'run-1', reasonCode:'TEST_PROCESS_CANCELLED',
    selectedWorks:1, cancelledWorks:1, drainingWorks:0, cancelledEvents:1,
  });
  assert.deepEqual(read(databasePath, 'SELECT state,retry_at_ms FROM fx_workflow_events WHERE event_id=?', 'event-1'),
    { state:'cancelled', retry_at_ms:null });
  const check = new Database(databasePath, { readonly:true });
  try {
    assert.deepEqual(check.prepare('SELECT resource_key,state FROM fx_resource_defer WHERE event_id=? ORDER BY resource_key')
      .all('event-1'), [{resource_key:'cpu',state:'cancelled'},{resource_key:'volume:test',state:'cancelled'}]);
  } finally { check.close(); }
  assert.deepEqual(read(databasePath, 'SELECT state,failure_code FROM fx_work_attempts WHERE attempt_id=?', activation.attempt.attempt_id),
    { state:'cancelled', failure_code:'TEST_PROCESS_CANCELLED' });
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_supporting_works WHERE work_id=?', 'work-1'), { state:'cancelled' });
}));
