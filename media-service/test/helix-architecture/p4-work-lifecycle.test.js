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

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-work-lifecycle-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
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
  const restart = () => {
    kernel.close();
    kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000001 });
    return createWorkLifecycle({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }),
      nextWorkAttemptId: () => 'attempt-' + (++ids) });
  };
  try { return await run({ lifecycle, unitOfWork, databasePath, restart }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function read(databasePath, sql, ...parameters) {
  const database = new Database(databasePath, { readonly: true });
  try { return database.prepare(sql).get(...parameters); } finally { database.close(); }
}

function seedPlannedAttempt(lifecycle, databasePath, suffix, eventState = 'succeeded') {
  const { attempt } = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  try {
    database.prepare(`INSERT INTO fx_workflow_plans
      (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-' + suffix, attempt.attempt_id, 'planner@1', 1,
        'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'planned', 2);
    database.prepare(`INSERT INTO fx_workflow_events
      (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('event-' + suffix, 'plan-' + suffix, 'node-' + suffix, 'work-1',
        attempt.attempt_id, 'procurement', 'procurement.test@1', 1, eventState, 'normal_foreground', 2);
  } finally { database.close(); }
  lifecycle.startPlanned('work-1', attempt.attempt_id);
  return attempt;
}

test('duplicate aggregation proves the terminal Attempt without deciding its Owner disposition', () => fixture(({ lifecycle, databasePath }) => {
  const attempt = seedPlannedAttempt(lifecycle, databasePath, 'duplicate', 'failed');
  const first = lifecycle.aggregateEvent('event-duplicate');
  const replay = lifecycle.aggregateEvent('event-duplicate');
  assert.equal(first.replayed, false);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(replay.attemptId, attempt.attempt_id);
  assert.equal(replay.attemptFailureCode, 'EVENT_TERMINAL_FAILURE');
  assert.equal(read(databasePath, 'SELECT state FROM fx_supporting_works').state, 'running');
  assert.equal(lifecycle.pendingOwnerReconciliations()[0].attempt.attempt_id, attempt.attempt_id);
}));

test('old Event callback cannot aggregate a new planned Attempt after Owner replan', () => fixture(({ lifecycle, databasePath }) => {
  const first = seedPlannedAttempt(lifecycle, databasePath, 'old');
  lifecycle.aggregateEvent('event-old');
  lifecycle.settleWork({ workId: 'work-1', workAttemptId: first.attempt_id, disposition: 'replan' });
  assert.equal(lifecycle.aggregateEvent('event-old').replayed, true);
  const next = seedPlannedAttempt(lifecycle, databasePath, 'new');
  const replay = lifecycle.aggregateEvent('event-old');
  assert.equal(replay.staleAttempt, true);
  assert.equal(replay.attemptTerminal, false);
  assert.equal(read(databasePath, 'SELECT state FROM fx_work_attempts WHERE attempt_id=?', next.attempt_id).state, 'running');
  assert.equal(lifecycle.aggregateEvent('event-new').attemptId, next.attempt_id);
  assert.equal(lifecycle.aggregateEvent('event-old').staleAttempt, true);
  assert.equal(lifecycle.aggregateEvent('event-old').attemptTerminal, false);
}));

test('Event without an Attempt binding cannot aggregate the current Work Attempt', () => fixture(({ lifecycle, databasePath }) => {
  const attempt = seedPlannedAttempt(lifecycle, databasePath, 'unbound');
  const database = new Database(databasePath);
  try { database.prepare('UPDATE fx_workflow_events SET attempt_id=NULL').run(); }
  finally { database.close(); }
  assert.throws(() => lifecycle.aggregateEvent('event-unbound'), { code: 'P4_WORK_EVENT_ATTEMPT_FACT_MISSING' });
  assert.equal(read(databasePath, 'SELECT state FROM fx_work_attempts WHERE attempt_id=?', attempt.attempt_id).state, 'running');
}));

test('reopening SQLite rediscovers the exact pending Owner disposition without reaggregating', () => fixture(({ lifecycle, databasePath, restart }) => {
  const attempt = seedPlannedAttempt(lifecycle, databasePath, 'restart');
  lifecycle.aggregateEvent('event-restart');
  const restarted = restart();
  const pending = restarted.pendingOwnerReconciliations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempt.attempt_id, attempt.attempt_id);
  assert.equal(restarted.aggregateEvent('event-restart').replayed, true);
  restarted.settleWork({ workId: 'work-1', workAttemptId: attempt.attempt_id, disposition: 'succeeded' });
  assert.deepEqual(restarted.pendingOwnerReconciliations(), []);
  assert.equal(read(databasePath, 'SELECT state FROM fx_supporting_works').state, 'succeeded');
}));

for (const resolution of ['no_effect_required', 'contract_unplannable']) {
  test('zero-Event terminal Plan remains an exact pending Owner receipt: ' + resolution, () => fixture(({ lifecycle, databasePath }) => {
    const { attempt } = lifecycle.ensurePlanningAttempt('work-1');
    const database = new Database(databasePath);
    try {
      database.prepare(`INSERT INTO fx_workflow_plans (plan_id,attempt_id,basis_digest,state)
        VALUES (?,?,?,?)`).run('zero-plan', attempt.attempt_id, 'a'.repeat(64), resolution);
    } finally { database.close(); }
    const started = lifecycle.startPlanned('work-1', attempt.attempt_id);
    const replay = lifecycle.aggregate('work-1');
    assert.equal(replay.replayed, true);
    assert.equal(replay.attemptId, attempt.attempt_id);
    assert.equal(replay.attemptState, started.attemptState);
    assert.equal(replay.workTerminal, false);
  }));
}

for (const corruption of ['missing_attempt', 'missing_plan', 'unfinished_event', 'wrong_terminal', 'missing_finish', 'wrong_basis', 'multiple_running']) {
  test('aggregation rejects unproven running Work state: ' + corruption, () => fixture(({ lifecycle, databasePath }) => {
    const attempt = seedPlannedAttempt(lifecycle, databasePath, 'invalid');
    if (corruption !== 'multiple_running') lifecycle.aggregateEvent('event-invalid');
    const database = new Database(databasePath);
    try {
      database.pragma('foreign_keys = OFF');
      if (corruption === 'missing_attempt') database.prepare('DELETE FROM fx_work_attempts').run();
      if (corruption === 'missing_plan') database.prepare('DELETE FROM fx_workflow_plans').run();
      if (corruption === 'unfinished_event') database.prepare("UPDATE fx_workflow_events SET state='ready'").run();
      if (corruption === 'wrong_terminal') database.prepare("UPDATE fx_work_attempts SET state='failed'").run();
      if (corruption === 'missing_finish') database.prepare('UPDATE fx_work_attempts SET finished_at_ms=NULL').run();
      if (corruption === 'wrong_basis') database.prepare('UPDATE fx_work_attempts SET basis_digest=?').run('d'.repeat(64));
      if (corruption === 'multiple_running') {
        // Deliberately remove the physical guard only in this disposable corruption fixture.
        database.exec('DROP INDEX uidx_fx_work_attempts_partial_01');
        database.prepare(`INSERT INTO fx_work_attempts (attempt_id,work_id,ordinal,basis_digest,state)
          VALUES (?,?,?,?,?)`).run('extra-attempt', 'work-1', attempt.ordinal + 1, 'a'.repeat(64), 'running');
      }
    } finally { database.close(); }
    assert.throws(() => lifecycle.aggregateEvent('event-invalid'), { code: 'P4_WORK_RUNNING_ATTEMPT_CARDINALITY' });
    assert.equal(read(databasePath, 'SELECT state FROM fx_supporting_works').state, 'running');
  }));
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

test('planning and its replay reject a stale Owner read fence without creating another Attempt',()=>fixture(({lifecycle,unitOfWork,databasePath})=>{
  function changeOwnerView(){const database=new Database(databasePath);try{
    database.prepare('UPDATE fx_supporting_works SET updated_at_ms=updated_at_ms+1 WHERE work_id=?').run('work-1');
  }finally{database.close();}}
  const stale=unitOfWork.captureReadFence();changeOwnerView();
  assert.throws(()=>lifecycle.ensurePlanningAttempt('work-1',{readFence:stale}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(read(databasePath,'SELECT count(*) n FROM fx_work_attempts').n,0);
  assert.equal(read(databasePath,'SELECT state FROM fx_supporting_works').state,'admitted');
  const fresh=unitOfWork.captureReadFence(),attempt=lifecycle.ensurePlanningAttempt('work-1',{readFence:fresh});
  assert.equal(attempt.replayed,false);
  const staleReplay=unitOfWork.captureReadFence();changeOwnerView();
  assert.throws(()=>lifecycle.ensurePlanningAttempt('work-1',{readFence:staleReplay}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(read(databasePath,'SELECT count(*) n FROM fx_work_attempts').n,1);
  assert.equal(read(databasePath,'SELECT state FROM fx_supporting_works').state,'ready');
}));

test('starting a published Plan rejects a stale Owner read and writes no running state',()=>fixture(({lifecycle,unitOfWork,databasePath})=>{
  const activation=lifecycle.ensurePlanningAttempt('work-1'),db=new Database(databasePath);
  try{db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,basis_digest,state) VALUES(?,?,?,?)')
    .run('plan',activation.attempt.attempt_id,'a'.repeat(64),'planned');
    const stale=unitOfWork.captureReadFence();
    db.prepare('UPDATE fx_supporting_works SET updated_at_ms=updated_at_ms+1 WHERE work_id=?').run('work-1');
    assert.throws(()=>lifecycle.startPlanned('work-1',activation.attempt.attempt_id,null,{readFence:stale}),
      {code:'P3_UOW_READ_FENCE_CHANGED'});
    assert.equal(read(databasePath,'SELECT state FROM fx_supporting_works').state,'ready');
    assert.equal(read(databasePath,'SELECT state FROM fx_work_attempts').state,'ready');
    assert.equal(lifecycle.startPlanned('work-1',activation.attempt.attempt_id,null,
      {readFence:unitOfWork.captureReadFence()}).state,'running');
  }finally{db.close();}
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

test('startup scan rediscovers a terminal Event whose running Attempt missed aggregation', () => fixture(({ lifecycle, databasePath }) => {
  const activation = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-crash', activation.attempt.attempt_id, 'planner@1', 1,
      'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'planned', 2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('event-crash', 'plan-crash', 'node-crash', 'work-1', activation.attempt.attempt_id,
      'procurement', 'procurement.field.observation.page.commit@1', 1, 'succeeded', 'background_observation', 2);
  database.close();
  lifecycle.startPlanned('work-1', activation.attempt.attempt_id);
  assert.deepEqual(lifecycle.pendingTerminalEventAggregations(1), [{
    workId:'work-1', attemptId:activation.attempt.attempt_id, eventId:'event-crash',
  }]);
  const aggregation = lifecycle.aggregateEvent('event-crash');
  assert.equal(aggregation.attemptState, 'succeeded');
  assert.deepEqual(lifecycle.pendingTerminalEventAggregations(1), []);
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
  const unrelated=database.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state) VALUES(?,?,?,?,?)');
  unrelated.run('other-owner','arca','procurement_run','run-1','ready');
  unrelated.run('other-process','procurement','other_type','run-1','ready');
  unrelated.run('other-id','procurement','procurement_run','run-2','ready');
  unrelated.run('terminal','procurement','procurement_run','run-1','succeeded');

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
    assert.deepEqual(check.prepare("SELECT state FROM fx_supporting_works WHERE work_id IN ('other-owner','other-process','other-id')").all().map(x=>x.state),['ready','ready','ready']);
    assert.equal(check.prepare("SELECT state FROM fx_supporting_works WHERE work_id='terminal'").get().state,'succeeded');
    assert.deepEqual(check.prepare('SELECT resource_key,state FROM fx_resource_defer WHERE event_id=? ORDER BY resource_key')
      .all('event-1'), [{resource_key:'cpu',state:'cancelled'},{resource_key:'volume:test',state:'cancelled'}]);
  } finally { check.close(); }
  assert.deepEqual(read(databasePath, 'SELECT state,failure_code FROM fx_work_attempts WHERE attempt_id=?', activation.attempt.attempt_id),
    { state:'cancelled', failure_code:'TEST_PROCESS_CANCELLED' });
  assert.deepEqual(read(databasePath, 'SELECT state FROM fx_supporting_works WHERE work_id=?', 'work-1'), { state:'cancelled' });
}));

test('startup repair closes only an active Attempt whose cancelled Work has fully terminal children', () => fixture(({ lifecycle, databasePath }) => {
  const activation = lifecycle.ensurePlanningAttempt('work-1');
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_workflow_plans
    (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('plan-1', activation.attempt.attempt_id, 'planner@1', 1,
      'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64), 'planned', 2);
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('event-1', 'plan-1', 'node-1', 'work-1', activation.attempt.attempt_id,
    'procurement', 'procurement.test@1', 1, 'cancelled', 'normal_foreground');
  database.prepare(`INSERT INTO fx_event_attempts
    (event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms)
    VALUES (?,?,?,?,?,?,?)`).run('event-attempt-1', 'event-1', 1, 'completed', 'cancelled', 2, 3);
  database.prepare("UPDATE fx_work_attempts SET state='running',started_at_ms=2 WHERE attempt_id=?")
    .run(activation.attempt.attempt_id);
  database.prepare("UPDATE fx_supporting_works SET state='cancelled' WHERE work_id='work-1'").run();
  database.close();

  assert.deepEqual(lifecycle.repairCancelledWorkAttempt({
    workId:'work-1', attemptId:activation.attempt.attempt_id, reasonCode:'TEST_RESIDUAL_RECOVERY',
  }), { workId:'work-1', attemptId:activation.attempt.attempt_id, state:'cancelled', replayed:false });
  assert.deepEqual(read(databasePath,
    'SELECT state,finished_at_ms,failure_code FROM fx_work_attempts WHERE attempt_id=?', activation.attempt.attempt_id), {
    state:'cancelled', finished_at_ms:1700000000000, failure_code:'TEST_RESIDUAL_RECOVERY',
  });
  assert.equal(lifecycle.repairCancelledWorkAttempt({
    workId:'work-1', attemptId:activation.attempt.attempt_id, reasonCode:'TEST_RESIDUAL_RECOVERY',
  }).replayed, true);
}));
