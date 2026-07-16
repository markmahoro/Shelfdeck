'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createWorkScheduler } = require('../../src/helix/foundation/execution/work-scheduler');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-scheduler-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 180000;
  let leaseOrdinal = 0;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000001400 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const seed = createRepositoryDefinition({ repositoryId: 'scheduler_seed', owner: 'execution-foundation', schemaManifest, statements: {
    work: { kind: 'insert', tableId: 'fx_supporting_works', columns: [
      'work_id', 'owner_domain', 'process_type', 'process_id', 'priority_class', 'state', 'idempotency_key', 'created_at_ms'
    ] },
    attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'] },
    plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'] },
    event: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
      'event_id', 'plan_id', 'node_id', 'work_id', 'owner_domain', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms'
    ] },
    edge: { kind: 'insert', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'] }
  } });
  const projections = new Map();
  const supplyController = { evaluate: ({ targetId }) => Object.freeze({ kind: 'permitted', targetId, lane: 'normal' }) };
  const priorityProjectionProvider = { read: ({ processId }) => projections.get(processId) };
  const scheduler = createWorkScheduler({ schemaManifest, unitOfWork, supplyController, priorityProjectionProvider,
    now: () => now, leaseTtlMs: 1000, nextLeaseId: () => 'lease-' + (++leaseOrdinal) });
  function seedRows(callback) {
    unitOfWork.execute([{ participantId: 'scheduler_seed', owner: 'execution-foundation', repositories: [seed],
      execute(context) { callback(context.repository('scheduler_seed')); } }]);
  }
  try { return run({ scheduler, seedRows, projections, supplyController, databasePath, setNow: (value) => { now = value; } }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function addWork(repository, projections, id, options = {}) {
  const priorityClass = options.priorityClass || 'normal_foreground';
  repository.invoke('work', { work_id: 'work-' + id, owner_domain: 'libra', process_type: 'libra_run', process_id: 'process-' + id,
    priority_class: priorityClass, state: options.state || 'admitted', idempotency_key: 'key-' + id, created_at_ms: options.createdAtMs ?? 120000 });
  projections.set('process-' + id, Object.freeze({ priorityClass, localPriority: options.localPriority || 0, priorityRevision: options.priorityRevision || 1 }));
}

function addEventGraph(repository, projections, id, options = {}) {
  addWork(repository, projections, id, { ...options, state: 'running' });
  repository.invoke('attempt', { attempt_id: 'attempt-' + id, work_id: 'work-' + id, state: 'running' });
  repository.invoke('plan', { plan_id: 'plan-' + id, attempt_id: 'attempt-' + id, state: 'planned' });
  repository.invoke('event', { event_id: 'event-' + id, plan_id: 'plan-' + id, node_id: 'node-' + id, work_id: 'work-' + id,
    owner_domain: 'libra', priority_class: options.priorityClass || 'normal_foreground', state: options.eventState || 'ready',
    ready_at_ms: options.readyAtMs ?? 120000, retry_at_ms: options.retryAtMs ?? null });
}

function addDependentPlan(repository, projections, id, dependencyKind, predecessorState, options = {}) {
  addWork(repository, projections, id, { ...options, state: 'running' });
  repository.invoke('attempt', { attempt_id: 'attempt-' + id, work_id: 'work-' + id, state: 'running' });
  repository.invoke('plan', { plan_id: 'plan-' + id, attempt_id: 'attempt-' + id, state: 'planned' });
  for (const event of [
    { suffix: 'source', state: predecessorState, readyAtMs: 100000 },
    { suffix: 'target', state: 'ready', readyAtMs: options.readyAtMs ?? 120000 }
  ]) repository.invoke('event', {
    event_id: 'event-' + id + '-' + event.suffix, plan_id: 'plan-' + id, node_id: 'node-' + event.suffix,
    work_id: 'work-' + id, owner_domain: 'libra', priority_class: options.priorityClass || 'normal_foreground',
    state: event.state, ready_at_ms: event.readyAtMs, retry_at_ms: null
  });
  repository.invoke('edge', { plan_id: 'plan-' + id, from_node_id: 'node-source', to_node_id: 'node-target', dependency_kind: dependencyKind });
}

test('Scheduler selects only admitted Work by strict class, local aging, and FIFO ordering', () => {
  fixture(({ scheduler, seedRows, projections }) => {
    seedRows((repository) => {
      addWork(repository, projections, 'background-old', { priorityClass: 'background_observation', createdAtMs: 0, localPriority: 100 });
      addWork(repository, projections, 'normal-new', { createdAtMs: 179000 });
      addWork(repository, projections, 'normal-aged', { createdAtMs: 60000 });
      addWork(repository, projections, 'terminal', { state: 'succeeded', localPriority: 1000 });
    });
    const selected = scheduler.acquire({ targetType: 'work' });
    assert.equal(selected.lease.targetId, 'work-normal-aged');
    assert.equal(selected.aging, 2);
  });
});

test('same effective local priority uses durable FIFO timestamp then identity', () => {
  fixture(({ scheduler, seedRows, projections }) => {
    seedRows((repository) => {
      addWork(repository, projections, 'z', { createdAtMs: 60000, localPriority: 0 });
      addWork(repository, projections, 'a', { createdAtMs: 120000, localPriority: 1 });
    });
    assert.equal(scheduler.acquire({ targetType: 'work' }).lease.targetId, 'work-z');
  });
});

test('Event requires ready state, elapsed retryAt, and exact success or terminal dependencies', () => {
  fixture(({ scheduler, seedRows, projections }) => {
    seedRows((repository) => {
      addDependentPlan(repository, projections, 'success', 'success', 'failed', { localPriority: 100 });
      addEventGraph(repository, projections, 'retry', { retryAtMs: 180001, localPriority: 100 });
      addDependentPlan(repository, projections, 'terminal', 'terminal', 'failed', { readyAtMs: 130000 });
    });
    assert.equal(scheduler.acquire({ targetType: 'event' }).lease.targetId, 'event-terminal-target');
  });
});

test('technical lease is unique, expiring, releasable, and never durable', () => {
  fixture(({ scheduler, seedRows, projections, databasePath, setNow }) => {
    seedRows((repository) => addWork(repository, projections, 'one'));
    const first = scheduler.acquire({ targetType: 'work' });
    assert.equal(scheduler.acquire({ targetType: 'work' }).kind, 'idle');
    assert.equal(scheduler.assertCurrent(first.lease).leaseId, 'lease-1');
    scheduler.release(first.lease);
    assert.equal(scheduler.acquire({ targetType: 'work' }).lease.leaseId, 'lease-2');
    setNow(181001);
    assert.throws(() => scheduler.assertCurrent({ ...first.lease, leaseId: 'lease-2' }), { code: 'P4_SCHEDULER_LEASE_STALE' });
    assert.equal(scheduler.acquire({ targetType: 'work' }).lease.leaseId, 'lease-3');
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('fx_technical_leases','fx_scheduler_leases')").get().count, 0);
    } finally { database.close(); }
  });
});

test('stale Owner projection fails closed and Supply defer cannot cause priority inversion', () => {
  fixture(({ scheduler, seedRows, projections, supplyController }) => {
    seedRows((repository) => addWork(repository, projections, 'one'));
    projections.set('process-one', { priorityClass: 'expedited_formation', localPriority: 0, priorityRevision: 2 });
    assert.throws(() => scheduler.acquire({ targetType: 'work' }), { code: 'P4_SCHEDULER_PRIORITY_PROJECTION_MISMATCH' });
    projections.set('process-one', { priorityClass: 'normal_foreground', localPriority: 0, priorityRevision: 2 });
    supplyController.evaluate = () => ({ kind: 'deferred', reasonCode: 'SUPPLY_SOFT_CAP' });
    assert.deepEqual(scheduler.acquire({ targetType: 'work' }), {
      kind: 'deferred', reasonCode: 'SUPPLY_SOFT_CAP', targetType: 'work', targetId: 'work-one'
    });
  });
});

test('Scheduler source has no Domain Store, capacity, Capability substitution, or business authority', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/work-scheduler.js'), 'utf8').toLowerCase();
  for (const forbidden of ['../domains', 'resource_demand', 'shelf_standard', 'acceptance_spec', 'contentprofile', 'material_control', 'authorizationref']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
