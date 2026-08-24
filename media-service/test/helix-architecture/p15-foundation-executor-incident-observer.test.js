'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCircuitBreaker } = require('../../src/helix/foundation/diagnostics/pressure-guard');
const { createExecutorIncidentObserver } = require('../../src/helix/foundation/execution/executor-incident-observer');
const { createExecutorIncidentRegistry, OPEN_THRESHOLD } = require('../../src/helix/foundation/execution/executor-incident-registry');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => canonicalDigest({ value });

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-incident-observer-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let tick = 10_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => tick++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const breaker = createCircuitBreaker({ schemaManifest, unitOfWork });
  const registry = createExecutorIncidentRegistry({ schemaManifest, unitOfWork, circuitBreaker:breaker, now:() => tick++ });
  const observer = createExecutorIncidentObserver({ schemaManifest, unitOfWork, registry });
  const database = new Database(databasePath);
  function seedWork({ workId, ownerDomain='arca', processType='arca_shelf_entry', workKind='care_repair_prepare',
    workState, eventState, outcomeKind, failureClass=null, failureCode=null, resourceKeys=[] }) {
    const attemptId=workId+':attempt:1',planId=workId+':plan:1',eventId=workId+':event:1',eventAttemptId=eventId+':attempt:1';
    const basisDigest=digest(workId+':basis');
    database.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(workId,ownerDomain,processType,'process-1',workKind,basisDigest,'normal_foreground','test://work','{}',digest(workId+':definition'),workState,workId,9_000,10_000);
    database.prepare('INSERT INTO fx_work_attempts (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES (?,?,?,?,?,?,?,?)')
      .run(attemptId,workId,1,basisDigest,workState,9_000,10_000,failureCode);
    database.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(planId,attemptId,'test.planner',1,digest('catalog'),basisDigest,digest(workId+':graph'),'planned',9_000);
    database.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(eventId,planId,'node-1',workId,attemptId,ownerDomain,'test.capability@1',1,eventState,'normal_foreground',9_000);
    database.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(eventAttemptId,eventId,1,'test.executor',1,'test://input',digest('input'),digest('fence'),'completed',outcomeKind,
        failureClass,failureCode,digest(workId+':evidence'),9_000,10_000);
    const insertTiming=database.prepare('INSERT INTO fx_event_resource_timings (event_attempt_id,resource_key,queue_class,enqueued_at_ms,acquired_at_ms,released_at_ms,wait_duration_ms,hold_duration_ms,outcome) VALUES (?,?,?,?,?,?,?,?,?)');
    for(const resourceKey of resourceKeys)insertTiming.run(eventAttemptId,resourceKey,'normal_foreground',9_000,9_001,10_000,1,999,outcomeKind);
    return Object.freeze({ ownerDomain, processType, workKind, workId, workAttemptId:attemptId,
      workAttemptFailureCode:failureCode, workState });
  }
  try { return run({ database, breaker, registry, observer, seedWork }); }
  finally { database.close(); kernel.close(); fs.rmSync(root, { recursive:true, force:true }); }
}

test('Foundation derives one resource Incident from the latest failed Work facts and repeated observation is idempotent', () => fixture(({ database, observer, seedWork }) => {
  const terminal=seedWork({workId:'failed-main',workState:'failed',eventState:'failed',outcomeKind:'failed',
    failureClass:'integration',failureCode:'P5_PROVIDER_TRANSPORT_FAILED',resourceKeys:['cpu:shared','integration:tmdb-main']});
  observer.observeTerminalWork(terminal);
  observer.observeTerminalWork(terminal);
  const row=database.prepare('SELECT occurrence_count,circuit_key FROM fx_executor_incidents').get();
  assert.equal(row.occurrence_count,1);
  assert.match(row.circuit_key,/\/resource\//);
}));

test('Foundation reserves one recovery Work and successful actual resource path resolves only its exact Circuit', () => fixture(({ breaker, registry, observer, seedWork }) => {
  const base={ownerDomain:'arca',processType:'arca_shelf_entry',workKind:'care_repair_prepare',errorCode:'P5_PROVIDER_TRANSPORT_FAILED'};
  for(let ordinal=1;ordinal<=OPEN_THRESHOLD;ordinal+=1){
    registry.recordFailure({...base,resourceKey:'integration:tmdb-main',occurrenceId:'main-'+ordinal});
    registry.recordFailure({...base,resourceKey:'integration:tmdb-backup',occurrenceId:'backup-'+ordinal});
  }
  const mainScope={ownerDomain:base.ownerDomain,processType:base.processType,workKind:base.workKind,resourceKey:'integration:tmdb-main'};
  const backupScope={...mainScope,resourceKey:'integration:tmdb-backup'};
  assert.equal(observer.prepareExecution({...mainScope,resourceKeys:['integration:tmdb-main'],workId:'recovery-main'}).allowed,true);
  assert.equal(observer.prepareExecution({...mainScope,resourceKeys:['integration:tmdb-main'],workId:'recovery-main'}).allowed,true);
  assert.equal(observer.prepareExecution({...mainScope,resourceKeys:['integration:tmdb-main'],workId:'another-work'}).allowed,false);
  assert.equal(observer.prepareExecution({...mainScope,resourceKeys:['integration:tmdb-third'],workId:'unrelated-work'}).allowed,true);
  const success=seedWork({workId:'recovery-main',workState:'succeeded',eventState:'succeeded',outcomeKind:'succeeded',
    resourceKeys:['cpu:shared','integration:tmdb-main']});
  observer.observeTerminalWork(success);
  assert.equal(registry.scopeStatus(mainScope).blocked,false);
  assert.equal(registry.scopeStatus(backupScope).blocked,true);
  assert.equal(breaker.read(registry.scopeKey(mainScope)).state,'closed');
  assert.equal(breaker.read(registry.scopeKey(backupScope)).state,'open');
}));

test('a terminal cancelled recovery Work releases its Foundation reservation without resolving the Incident', () => fixture(({ breaker, registry, observer }) => {
  const base={ownerDomain:'arca',processType:'arca_shelf_entry',workKind:'care_repair_prepare',
    errorCode:'P5_PROVIDER_TRANSPORT_FAILED',resourceKey:'integration:tmdb-main'};
  for(let ordinal=1;ordinal<=OPEN_THRESHOLD;ordinal+=1)registry.recordFailure({...base,occurrenceId:'failure-'+ordinal});
  const scope={ownerDomain:base.ownerDomain,processType:base.processType,workKind:base.workKind,resourceKey:base.resourceKey};
  assert.equal(observer.prepareExecution({...scope,resourceKeys:[base.resourceKey],workId:'cancelled-recovery'}).allowed,true);
  assert.equal(breaker.read(registry.scopeKey(scope)).state,'recovering');
  observer.observeTerminalWork({...scope,workId:'cancelled-recovery',workAttemptId:'attempt-1',workState:'cancelled'});
  assert.equal(breaker.read(registry.scopeKey(scope)).state,'open');
  assert.equal(registry.scopeStatus(scope).blocked,true);
  assert.equal(observer.prepareExecution({...scope,resourceKeys:[base.resourceKey],workId:'next-recovery'}).allowed,true);
}));

test('unattributable technical failures remain process-local and Libra business facts are untouched', () => fixture(({ database, observer, seedWork }) => {
  const before=Object.fromEntries(['libra_runs','libra_acceptance_specs','libra_workspaces'].map((table)=>
    [table,database.prepare('SELECT count(*) count FROM '+table).get().count]));
  const terminal=seedWork({workId:'libra-failed',ownerDomain:'libra',processType:'libra_run',workKind:'product_production',
    workState:'failed',eventState:'failed',outcomeKind:'failed',failureClass:'executor',failureCode:'EXECUTOR_DOWN',
    resourceKeys:['cpu:shared','volume_write:workspace-1']});
  observer.observeTerminalWork(terminal);
  observer.observeTerminalWork(seedWork({workId:'libra-business-terminal',ownerDomain:'libra',processType:'libra_run',
    workKind:'external_material_acquisition',workState:'failed',eventState:'failed',outcomeKind:'failed',
    failureClass:'business',failureCode:'LIBRA_EXTERNAL_MATERIAL_NOT_AVAILABLE'}));
  const row=database.prepare("SELECT owner_domain,circuit_key FROM fx_executor_incidents WHERE owner_domain='libra'").get();
  assert.equal(row.owner_domain,'libra');
  assert.doesNotMatch(row.circuit_key,/\/resource\//);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_executor_incidents WHERE owner_domain='libra'").get().count,1);
  for(const [table,count] of Object.entries(before))assert.equal(database.prepare('SELECT count(*) count FROM '+table).get().count,count);
}));
