'use strict';

const assert = require('node:assert/strict');
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

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-work-lifecycle-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('work-1', 'procurement', 'procurement_run', 'run-1', 'evidence_assessment',
    'a'.repeat(64), 'normal_foreground', 'admitted', 'key-1', 1, 1);
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
