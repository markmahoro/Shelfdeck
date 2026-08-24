'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createCircuitBreaker } = require('../../src/helix/foundation/diagnostics/pressure-guard');
const { createExecutorIncidentRegistry } = require('../../src/helix/foundation/execution/executor-incident-registry');
const { createExecutorIncidentObserver } = require('../../src/helix/foundation/execution/executor-incident-observer');
const { createAftercareProcessCoordinator } = require('../../src/helix/domains/arca/application/aftercare-process-coordinator');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => canonicalDigest({ value });

function basis(label, inventoryRevision = 1) {
  const value = {
    inventoryRevision,
    standardRevision:1,
    placementRevision:1,
    canonicalIdentityDigest:digest('identity'),
    sourcePackageId:'package-1',
    acceptedProductFactSetDigest:digest('facts'),
    decisionFactSetDigest:digest('decisions'),
  };
  return Object.freeze({ ...value, digest:digest({ label, ...value }) });
}

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aftercare-state-machine-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => 10_000 });
  const unitOfWork=createSqliteUnitOfWork({ kernel }),breaker=createCircuitBreaker({ schemaManifest,unitOfWork }),
    incidents=createExecutorIncidentRegistry({ schemaManifest,unitOfWork,circuitBreaker:breaker,now:() => 10_000 }),
    incidentObserver=createExecutorIncidentObserver({ schemaManifest,unitOfWork,registry:incidents });
  const database = new Database(databasePath);
  const frozenBasis = options.frozenBasis || basis('frozen', 1);
  let currentBasis = options.currentBasis || frozenBasis;
  const care = Object.freeze({
    aftercareCaseId:'case-1', shelfEntryId:'entry-1', state:'active',
    careBasis:frozenBasis, careBasisDigest:frozenBasis.digest,
    careRequirementDigest:digest('requirement'),
    careRequirement:Object.freeze({ typedParameters:Object.freeze([]) }),
  });
  const history = { cases:[care], commits:[], assessments:[], findings:[] };
  const terminated = [],issuedApprovals=[];
  const context = () => Object.freeze({
    shelfEntryId:'entry-1', basis:currentBasis,
    raw:Object.freeze({
      shelf:Object.freeze({ status:'active', shelf_id:'shelf-1', target_endpoint_id:options.targetEndpointId||'endpoint-1',
        target_mount_scope_id:options.targetMountScopeId||'mount-1',target_mount_scope_revision:1 }),
      entry:Object.freeze({ current_inventory_revision:currentBasis.inventoryRevision, canonical_identity_revision:1 }),
      identity:Object.freeze({ provider:'tmdb' }),facts:Object.freeze([]),reservations:Object.freeze([]), materials:Object.freeze([]), oldBindings:Object.freeze([]), perceptionRating:null,
    }),
  });
  const store = {
    history:() => history,
    terminateCase:(caseId, state) => { terminated.push({ caseId, state }); },
    issueSettlementApproval:(request) => { issuedApprovals.push(request); return Object.freeze({ state:'active',...request }); },
  };
  let commitState = options.commitState || 'pending';
  const statusForKind = options.statusForKind || ((kind) => {
    if (kind === 'care_repair_prepare') return 'succeeded';
    if (kind === 'care_repair_commit') return commitState;
    return 'pending';
  });
  const workResultReader = {
    status(workId) {
      const row = database.prepare('SELECT work_kind,state FROM fx_supporting_works WHERE work_id=?').get(workId);
      if (!row) return null;
      const state = statusForKind(row.work_kind, workId, row);if(state&&typeof state==='object')return Object.freeze(state);
      return state === 'pending' ? Object.freeze({ state:'running' }) : Object.freeze({ state });
    },
    read:() => [],
    ...(options.settlementRecovery?{readBindings:() => [Object.freeze({ eventId:'settlement-event-1',
      capabilityRef:'arca.aftercare.input_settlement.delete@1' })]}:{}),
  };
  let drainingWorks = Number(options.drainingWorks || 0);
  const coordinator = createAftercareProcessCoordinator({
    schemaManifest,
    unitOfWork,
    contextReader:Object.freeze({ read:context, store, healthProjectionInputs:() => [],inventoryMaterials:() => [] }),
    workResultReader,
    executorIncidentProjection:Object.freeze({projectionForWork:(request)=>incidentObserver.projectionForWork(request)}),
    cancelProcessWorks:() => Object.freeze({ drainingWorks:drainingWorks > 0 ? drainingWorks-- : 0 }),
    ...(options.settlementRecovery?{computeBoundedMaterialFingerprintSync:() => { throw new Error('unexpected fingerprint'); },
      registry:{ resolve:() => ({ manifest:{ contractVersion:1 } }) }}:{}),
    now:() => 10_000,
  });
  return {
    coordinator, database, history, care, terminated, issuedApprovals,incidents,incidentObserver,breaker,
    setCurrentBasis(value) { currentBasis = value; },
    setCommitState(value) { commitState = value; },
    close() { database.close(); kernel.close(); fs.rmSync(root, { recursive:true, force:true }); },
  };
}

test('Aftercare does not reassess or close while the Repair Work settlement is still nonterminal', () => {
  const value = fixture();
  try {
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'repair_commit_pending');
    value.history.commits.push(Object.freeze({
      aftercareCaseId:'case-1', newInventoryRevision:2, commitDigest:digest('inventory-commit'),
    }));
    value.setCurrentBasis(basis('after-inventory', 2));
    const result = value.coordinator.reconcile('entry-1');
    assert.equal(result.kind, 'repair_commit_pending');
    assert.equal(value.database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE work_kind='health_assessment'",
    ).get().count, 0);
    assert.equal(value.terminated.length, 0);
  } finally { value.close(); }
});

test('a terminal Commit Work after Inventory commit closes the active Case unresolved', () => {
  const value = fixture();
  try {
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'repair_commit_pending');
    value.history.commits.push(Object.freeze({
      aftercareCaseId:'case-1', newInventoryRevision:2, commitDigest:digest('inventory-commit'),
    }));
    value.setCurrentBasis(basis('after-inventory', 2));
    value.setCommitState('failed');
    const result = value.coordinator.reconcile('entry-1');
    assert.equal(result.kind, 'case_unresolved');
    assert.equal(result.reasonCode, 'settlement_or_commit_failed');
    assert.deepEqual(value.terminated, [{ caseId:'case-1', state:'unresolved' }]);
  } finally { value.close(); }
});

test('Aftercare keeps frozen Repair Work lineage after Inventory advances and uses the new Basis only for reassessment', () => {
  const value = fixture();
  try {
    value.coordinator.reconcile('entry-1');
    value.history.commits.push(Object.freeze({
      aftercareCaseId:'case-1', newInventoryRevision:2, commitDigest:digest('inventory-commit'),
    }));
    const nextBasis = basis('after-inventory', 2);
    value.setCurrentBasis(nextBasis);
    value.setCommitState('succeeded');
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'reassessment_pending');
    const works = value.database.prepare(
      'SELECT work_kind,basis_digest FROM fx_supporting_works ORDER BY created_at_ms,work_id',
    ).all();
    assert.equal(works.find((item) => item.work_kind === 'care_repair_prepare').basis_digest,
      value.care.careBasisDigest);
    assert.equal(works.find((item) => item.work_kind === 'care_repair_commit').basis_digest,
      value.care.careBasisDigest);
    assert.equal(works.find((item) => item.work_kind === 'health_assessment').basis_digest,
      nextBasis.digest);
  } finally { value.close(); }
});

test('a committed Inventory deterministically reissues a missing Settlement Approval before reassessment', () => {
  const value=fixture({ settlementRecovery:true });
  try {
    value.coordinator.reconcile('entry-1');
    value.history.commits.push(Object.freeze({ aftercareCaseId:'case-1',newInventoryRevision:2,
      commitDigest:digest('inventory-commit'),committedAtMs:12_000 }));
    value.setCurrentBasis(basis('after-inventory',2));
    assert.equal(value.coordinator.reconcile('entry-1').kind,'repair_commit_pending');
    assert.equal(value.issuedApprovals.length,1);
    assert.equal(value.issuedApprovals[0].settlementEventId,'settlement-event-1');
  } finally { value.close(); }
});

test('a Care Basis change drains existing execution before cleanup and invalidation', () => {
  const value = fixture({ currentBasis:basis('changed', 1), drainingWorks:1,
    statusForKind:(kind) => kind === 'care_deregistration_settlement' ? 'succeeded' : 'pending' });
  try {
    const draining = value.coordinator.reconcile('entry-1');
    assert.equal(draining.kind, 'case_fence_draining');
    assert.equal(draining.reasonCode, 'care_basis_changed');
    assert.equal(value.terminated.length, 0);
    assert.equal(value.database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE work_kind='care_deregistration_settlement'",
    ).get().count, 0);
    const stopped = value.coordinator.reconcile('entry-1');
    assert.equal(stopped.kind, 'case_invalidated');
    assert.deepEqual(value.terminated, [{ caseId:'case-1', state:'invalidated' }]);
  } finally { value.close(); }
});

test('terminal failed Repair Works receive at most two durable replacements and then close unresolved', () => {
  const value = fixture({ statusForKind:(_kind, _workId, row) => row.state });
  try {
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'repair_preparation_pending');
    value.database.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_kind='care_repair_prepare'").run();
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'repair_preparation_pending');
    value.database.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_kind='care_repair_prepare' AND state!='failed'").run();
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'repair_preparation_pending');
    value.database.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_kind='care_repair_prepare' AND state!='failed'").run();
    assert.equal(value.coordinator.reconcile('entry-1').kind, 'case_unresolved');
    const works = value.database.prepare(
      "SELECT work_id FROM fx_supporting_works WHERE work_kind='care_repair_prepare' ORDER BY work_id",
    ).all();
    assert.equal(works.length, 3);
    assert.equal(new Set(works.map((item) => item.work_id)).size, 3);
    assert.deepEqual(value.terminated,[{caseId:'case-1',state:'unresolved'}]);
  } finally { value.close(); }
});

test('Arca reconciliation does not control Incidents and Foundation observation is durable and idempotent', () => {
  const value=fixture({statusForKind:(_kind,workId,row)=>row.state==='failed'?Object.freeze({state:'failed',
    latestAttempt:Object.freeze({attempt_id:workId+':attempt:1',failure_code:'PLATFORM_INTEGRATION_NETWORK_FAILED'})}):'pending'});
  try{
    assert.equal(value.coordinator.reconcile('entry-1').kind,'repair_preparation_pending');
    value.database.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_kind='care_repair_prepare'").run();
    assert.equal(value.coordinator.reconcile('entry-1').kind,'repair_preparation_pending');
    assert.equal(value.coordinator.reconcile('entry-1').kind,'repair_preparation_pending');
    assert.equal(value.database.prepare('SELECT count(*) count FROM fx_executor_incidents').get().count,0);
    const work=value.database.prepare("SELECT work_id,owner_domain,process_type,work_kind,basis_digest FROM fx_supporting_works WHERE work_kind='care_repair_prepare' AND state='failed'").get();
    const attemptId=work.work_id+':attempt:1',planId=work.work_id+':plan:1',eventId=work.work_id+':event:1',eventAttemptId=eventId+':attempt:1';
    value.database.prepare('INSERT INTO fx_work_attempts (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES (?,?,?,?,?,?,?,?)')
      .run(attemptId,work.work_id,1,work.basis_digest,'failed',9_000,10_000,'PLATFORM_INTEGRATION_NETWORK_FAILED');
    value.database.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(planId,attemptId,'test.planner',1,digest('catalog'),work.basis_digest,digest('graph'),'planned',9_000);
    value.database.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(eventId,planId,'node-1',work.work_id,attemptId,work.owner_domain,'arca.aftercare.provider.fetch@1',1,'failed','normal_foreground',9_000);
    value.database.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(eventAttemptId,eventId,1,'test.executor',1,'test://input',digest('input'),digest('fence'),'completed','failed','integration','PLATFORM_INTEGRATION_NETWORK_FAILED',digest('evidence'),9_000,10_000);
    value.database.prepare('INSERT INTO fx_event_resource_timings (event_attempt_id,resource_key,queue_class,enqueued_at_ms,acquired_at_ms,released_at_ms,wait_duration_ms,hold_duration_ms,outcome) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(eventAttemptId,'integration:tmdb-main','normal_foreground',9_000,9_001,10_000,1,999,'failed');
    const terminal={ownerDomain:work.owner_domain,processType:work.process_type,workKind:work.work_kind,
      workId:work.work_id,workAttemptId:attemptId,workAttemptFailureCode:'PLATFORM_INTEGRATION_NETWORK_FAILED',workState:'failed'};
    value.incidentObserver.observeTerminalWork(terminal);
    value.incidentObserver.observeTerminalWork(terminal);
    const rows=value.database.prepare("SELECT occurrence_count,circuit_key FROM fx_executor_incidents WHERE work_kind='care_repair_prepare'").all();
    assert.equal(rows.length,1);
    assert.equal(rows[0].occurrence_count,1);
    assert.match(rows[0].circuit_key,/\/resource\//);
  }finally{value.close();}
});
