'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createResourceGovernor } = require('../../src/helix/foundation/execution/resource-governor');
const { createResourceProfileMapper } = require('../../src/helix/foundation/execution/resource-profile-mapper');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const queueLimits = Object.freeze({ globalSoft: 1, globalHard: 2, perKeySoft: 1, perKeyHard: 2 });

function profile(profileKey = 'default') {
  return createResourceProfileMapper({ profileKey, profileRevision: profileKey === 'default' ? 1 : 2, logicalCpu: 8,
    integrations: [], volumes: [{ volumeKey: 'nas' }], encoders: [], aiDevices: [], workers: [] });
}

function request(eventId, resources, overrides = {}) {
  return { eventId, queueClass: overrides.queueClass || 'normal_foreground', localPriority: overrides.localPriority || 0,
    priorityRevision: overrides.priorityRevision || 1, resources: resources.map(([resourceKey, units = 1]) => ({ resourceKey, units })) };
}

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-governor-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let currentProfile = profile(); let now = 180000; let permitOrdinal = 0;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000001500 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const seed = createRepositoryDefinition({ repositoryId: 'governor_seed', owner: 'execution-foundation', schemaManifest, statements: {
    work: { kind: 'insert', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'priority_class', 'state', 'idempotency_key'] },
    attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'] },
    plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'] },
    event: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
      'event_id', 'plan_id', 'node_id', 'work_id', 'owner_domain', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms'
    ] }
  } });
  function seedEvents(...ids) {
    unitOfWork.execute([{ participantId: 'governor_seed', owner: 'execution-foundation', repositories: [seed], execute(context) {
      const repository = context.repository('governor_seed');
      for (const id of ids) {
        repository.invoke('work', { work_id: 'work-' + id, owner_domain: 'libra', priority_class: 'normal_foreground', state: 'running', idempotency_key: 'key-' + id });
        repository.invoke('attempt', { attempt_id: 'attempt-' + id, work_id: 'work-' + id, state: 'running' });
        repository.invoke('plan', { plan_id: 'plan-' + id, attempt_id: 'attempt-' + id, state: 'planned' });
        repository.invoke('event', { event_id: id, plan_id: 'plan-' + id, node_id: 'node-' + id, work_id: 'work-' + id,
          owner_domain: 'libra', priority_class: 'normal_foreground', state: 'ready', ready_at_ms: 100000, retry_at_ms: null });
      }
    } }]);
  }
  const governor = createResourceGovernor({ schemaManifest, unitOfWork, queueLimits, now: () => now,
    profileProvider: { current: () => currentProfile }, nextPermitId: () => 'permit-' + (++permitOrdinal) });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); };
  try {
    const result = run({ governor, databasePath, seedEvents, setNow: (value) => { now = value; }, setProfile: (value) => { currentProfile = value; } });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { cleanup(); throw error; }
}

test('multi-resource Permit is acquired atomically and a later pull promotes one stable waiter', () => {
  fixture(({ governor, seedEvents }) => {
    seedEvents('holder', 'bundle');
    const holder = governor.acquire(request('holder', [['cpu_heavy']]));
    assert.equal(holder.kind, 'permitted');
    assert.equal(governor.acquire(request('bundle', [['cpu_heavy'], ['sqlite_write']])).kind, 'waiting');
    assert.deepEqual(governor.snapshot().inUse, [{ resourceKey: 'cpu_heavy', units: 1 }]);
    governor.release(holder.permit);
    assert.equal(governor.acquire(request('bundle', [['cpu_heavy'], ['sqlite_write']])).kind, 'permitted');
    assert.deepEqual(governor.snapshot().inUse, [{ resourceKey: 'cpu_heavy', units: 1 }, { resourceKey: 'sqlite_write', units: 1 }]);
  });
});

test('capacity wait publishes one durable Scheduler fence without rolling writes', () => {
  fixture(({ governor, databasePath, seedEvents, setNow }) => {
    seedEvents('holder', 'waiter');
    const holder = governor.acquire(request('holder', [['cpu_heavy']]));
    const first = governor.acquire(request('waiter', [['cpu_heavy']]));
    assert.equal(first.kind, 'waiting');
    assert.equal(first.retryAtMs, 180100);
    assert.equal(governor.acquire(request('waiter', [['cpu_heavy']])).retryAtMs, 180100);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare('SELECT state,retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('waiter'),
        { state: 'waiting_for_resource', retry_at_ms: 180100 });
    } finally { database.close(); }
    setNow(180100);
    assert.equal(governor.acquire(request('waiter', [['cpu_heavy']])).retryAtMs, 180100);
    const stable = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(stable.prepare('SELECT enqueued_at_ms,retry_at_ms FROM fx_resource_defer WHERE event_id=?').get('waiter'),
        { enqueued_at_ms: 180000, retry_at_ms: 180100 });
    } finally { stable.close(); }
    governor.release(holder.permit);
    assert.equal(governor.acquire(request('waiter', [['cpu_heavy']])).kind, 'permitted');
    const released = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(released.prepare('SELECT state FROM fx_resource_defer WHERE event_id=?').all('waiter'),
        [{ state: 'released' }]);
    } finally { released.close(); }
  });
});

test('one Event has one waiter and newer Owner projection can reprioritize it', () => {
  fixture(({ governor, seedEvents }) => {
    seedEvents('holder', 'waiter');
    governor.acquire(request('holder', [['cpu_heavy']]));
    assert.equal(governor.acquire(request('waiter', [['cpu_heavy']])).replayed, false);
    assert.equal(governor.acquire(request('waiter', [['cpu_heavy']])).replayed, true);
    assert.throws(() => governor.acquire(request('waiter', [['cpu_heavy'], ['sqlite_write']])), { code: 'P4_RESOURCE_DUPLICATE_WAITER_CONFLICT' });
    assert.deepEqual(governor.updateWaiterPriority({ eventId: 'waiter', queueClass: 'expedited_formation', localPriority: 4, priorityRevision: 2 }),
      { updated: true, eventId: 'waiter' });
  });
});

test('independent Capability resource keys do not share one global waiter head', () => {
  fixture(({ governor, seedEvents }) => {
    seedEvents('holder-a', 'holder-b', 'waiter-a', 'waiter-b');
    const holderA=governor.acquire(request('holder-a',[['cpu_heavy']]));
    const holderB=governor.acquire(request('holder-b',[['sqlite_write']]));
    assert.equal(governor.acquire(request('waiter-a',[['cpu_heavy']])).kind,'waiting');
    assert.equal(governor.acquire(request('waiter-b',[['sqlite_write']])).kind,'waiting');
    governor.release(holderA.permit);governor.release(holderB.permit);
    assert.equal(governor.acquire(request('waiter-b',[['sqlite_write']])).kind,'permitted');
    assert.equal(governor.snapshot().waiterCount,1);
  });
});

test('Governor does not override the Work Scheduler lease with a hidden waiter priority head', () => {
  fixture(({ governor, seedEvents, setNow }) => {
    seedEvents('holder', 'background', 'safety');
    const holder = governor.acquire(request('holder', [['cpu_heavy']]));
    governor.acquire(request('background', [['cpu_heavy']], { queueClass: 'background_observation', localPriority: 100 }));
    setNow(780000);
    governor.acquire(request('safety', [['cpu_heavy']], { queueClass: 'safety_liveness' }));
    governor.release(holder.permit);
    assert.equal(governor.acquire(request('background', [['cpu_heavy']], { queueClass: 'background_observation', localPriority: 100 })).kind, 'permitted');
    assert.equal(governor.acquire(request('safety', [['cpu_heavy']], { queueClass: 'safety_liveness' })).kind, 'waiting');
    assert.equal(governor.snapshot().waiterCount, 1);
  });
});

test('hard-full queue persists stable defer and exact exponential retryAt without Permit facts', () => {
  fixture(({ governor, databasePath, seedEvents, setNow }) => {
    seedEvents('holder', 'wait-one', 'wait-two', 'deferred');
    governor.acquire(request('holder', [['cpu_heavy']]));
    governor.acquire(request('wait-one', [['cpu_heavy']]));
    governor.acquire(request('wait-two', [['cpu_heavy']]));
    const first = governor.acquire(request('deferred', [['cpu_heavy']]));
    assert.deepEqual(first, { kind: 'deferred', reasonCode: 'RESOURCE_QUEUE_HARD_CAP', retryAtMs: 185000, replayed: false });
    assert.equal(governor.acquire(request('deferred', [['cpu_heavy']])).retryAtMs, 185000);
    setNow(185000);
    assert.equal(governor.acquire(request('deferred', [['cpu_heavy']])).retryAtMs, 215000);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare('SELECT state,retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('deferred'),
        { state: 'waiting_for_resource', retry_at_ms: 215000 });
      assert.deepEqual(database.prepare('SELECT state,retry_at_ms FROM fx_resource_defer WHERE event_id=?').get('deferred'),
        { state: 'waiting', retry_at_ms: 215000 });
      assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'fx_%permit%'").get().count, 0);
    } finally { database.close(); }
  });
});

test('unsatisfiable resource is stable blocker and Profile reduction never revokes existing Permit', () => {
  fixture(({ governor, seedEvents, setProfile }) => {
    seedEvents('holder', 'next', 'missing');
    setProfile(profile('full'));
    const holder = governor.acquire(request('holder', [['volume_write:nas', 2]]));
    assert.equal(holder.kind, 'permitted');
    setProfile(profile('default'));
    assert.equal(governor.acquire(request('next', [['volume_write:nas']])).kind, 'waiting');
    assert.deepEqual(governor.acquire(request('missing', [['encoder:unknown']])), {
      kind: 'unavailable', reasonCode: 'RESOURCE_MAP_UNSATISFIABLE', resourceKey: 'encoder:unknown'
    });
    assert.equal(governor.snapshot().permitCount, 1);
  });
});

test('withPermit releases all capacity when operation throws', async () => {
  await fixture(async ({ governor, seedEvents }) => {
    seedEvents('operation');
    await assert.rejects(governor.withPermit(request('operation', [['cpu_heavy'], ['sqlite_write']]), async () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(governor.snapshot(), { permitCount: 0, waiterCount: 0, inUse: [], queueSoftExceeded: false });
  });
});

test('Governor source has one accounting map and no persisted Permit, business decision, or fallback', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/resource-governor.js'), 'utf8').toLowerCase();
  for (const forbidden of ['insertpermit', 'fx_permit', '../domains', 'fallback', 'outcome_kind', 'material_control']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
