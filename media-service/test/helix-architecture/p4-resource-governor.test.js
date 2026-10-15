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

test('blocked preparation hint is bounded, read-only, and cleared by capacity release', () =>
  fixture(({ governor, seedEvents, setNow, getUnitOfWorkExecutions }) => {
    seedEvents('holder', 'waiter');
    assert.equal(governor.preparationWait('unknown'), null);
    const held = governor.acquire(request('holder', [['sqlite_write']]));
    assert.equal(governor.acquire(request('waiter', [['sqlite_write']])).kind, 'waiting');
    const reads = getUnitOfWorkExecutions();
    for (let i = 0; i < 20; i++) {
      assert.equal(governor.preparationWait('waiter').kind, 'waiting');
    }
    assert.equal(getUnitOfWorkExecutions(), reads);
    assert.equal(governor.snapshot().permitCount, 1);
    setNow(185000);
    assert.equal(governor.preparationWait('waiter'), null, 'fresh preparation must run after five seconds');
    assert.equal(governor.acquire(request('waiter', [['sqlite_write']])).kind, 'waiting');
    assert.equal(governor.preparationWait('waiter').kind, 'waiting');
    governor.release(held.permit);
    assert.equal(governor.preparationWait('waiter'), null, 'released capacity must bypass the refresh delay');
    const admitted = governor.acquire(request('waiter', [['sqlite_write']]));
    assert.equal(admitted.kind, 'permitted');
    assert.equal(governor.preparationWait('waiter'), null);
    governor.release(admitted.permit);
  }));

function profile(profileKey = 'default') {
  return createResourceProfileMapper({ profileKey, profileRevision: profileKey === 'default' ? 1 : 2, logicalCpu: 8,
    integrations: [], volumes: [{ volumeKey: 'nas' }], encoders: [], aiDevices: [], workers: [] });
}

function request(eventId, resources, overrides = {}) {
  return { eventId, queueClass: overrides.queueClass || 'normal_foreground', localPriority: overrides.localPriority || 0,
    priorityRevision: overrides.priorityRevision || 1, resources: resources.map(([resourceKey, units = 1]) => ({ resourceKey, units })) };
}

function fixture(run, reads = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-governor-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let currentProfile = profile(); let now = 180000; let permitOrdinal = 0;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000001500 });
  const sqliteUnitOfWork = createSqliteUnitOfWork({ kernel });
  let unitOfWorkExecutions=0;
  const unitOfWork={execute(participants){
    unitOfWorkExecutions+=1;
    if (!reads) return sqliteUnitOfWork.execute(participants);
    return sqliteUnitOfWork.execute(participants.map(participant => ({...participant, execute(context) {
      return participant.execute({...context, repository(id) {
        const repository = context.repository(id);
        return {...repository, invoke(statement, parameters) {
          const result = repository.invoke(statement, parameters);
          if (Array.isArray(result)) reads.push({ repositoryId: id, statement, rowCount: result.length });
          return result;
        }};
      }});
    }})));
  }};
  const seed = createRepositoryDefinition({ repositoryId: 'governor_seed', owner: 'execution-foundation', schemaManifest, statements: {
    work: { kind: 'insert', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'priority_class', 'state', 'idempotency_key'] },
    attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'] },
    plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'] },
    event: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
      'event_id', 'plan_id', 'node_id', 'work_id', 'owner_domain', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms'
    ] },
    set_event_state: { kind:'update', tableId:'fx_workflow_events',
      setColumns:['state'], keyColumns:['event_id'] },
    defer: { kind:'insert', tableId:'fx_resource_defer', columns:[
      'event_id','resource_key','queue_class','local_priority','priority_revision','enqueued_at_ms','retry_at_ms','state'
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
  function setEventState(eventId, state) {
    unitOfWork.execute([{ participantId:'governor_seed_state',
      owner:'execution-foundation', repositories:[seed], execute(context) {
        context.repository('governor_seed').invoke('set_event_state', {
          event_id:eventId, state,
        });
      } }]);
  }
  function seedDefers(rows) {
    unitOfWork.execute([{ participantId:'governor_seed_defers', owner:'execution-foundation', repositories:[seed], execute(context) {
      for (const row of rows) context.repository('governor_seed').invoke('defer', {
        resource_key:'sqlite_write', queue_class:'normal_foreground', local_priority:0, priority_revision:1,
        enqueued_at_ms:100000, retry_at_ms:185000, ...row,
      });
    }}]);
  }
  const governor = createResourceGovernor({ schemaManifest, unitOfWork, queueLimits, now: () => now,
    profileProvider: { current: () => currentProfile }, nextPermitId: () => 'permit-' + (++permitOrdinal) });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); };
  try {
    const result = run({ governor, databasePath, seedEvents, setEventState, seedDefers,
      getUnitOfWorkExecutions:()=>unitOfWorkExecutions,
      setNow: (value) => { now = value; }, setProfile: (value) => { currentProfile = value; } });
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

test('capacity wait publishes one durable Scheduler fence without rolling reads or writes', () => {
  fixture(({ governor, databasePath, seedEvents, setNow, getUnitOfWorkExecutions }) => {
    seedEvents('holder', 'waiter');
    const holder = governor.acquire(request('holder', [['cpu_heavy']]));
    const first = governor.acquire(request('waiter', [['cpu_heavy']]));
    assert.equal(first.kind, 'waiting');
    assert.equal(first.retryAtMs, 180100);
    assert.equal(governor.acquire(request('waiter', [['cpu_heavy']])).retryAtMs, 180100);
    const persistedExecutions=getUnitOfWorkExecutions();
    for(let index=0;index<1000;index++)assert.equal(governor.acquire(request('waiter',[['cpu_heavy']])).retryAtMs,180100);
    assert.equal(getUnitOfWorkExecutions(),persistedExecutions);
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

test('recovery capacity wait preserves the executing Event without a durable ordinary waiter', () => {
  fixture(({ governor, databasePath, seedEvents, setEventState }) => {
    seedEvents('holder', 'recovering');
    setEventState('recovering', 'executing');
    const holder = governor.acquire(request('holder', [['cpu_heavy']]));
    const waiting = governor.acquireRecovery(request('recovering', [['cpu_heavy']]));
    assert.equal(waiting.kind, 'waiting');
    assert.equal(governor.snapshot().waiterCount, 0);
    const database = new Database(databasePath, { readonly:true });
    try {
      assert.deepEqual(database.prepare(
        'SELECT state,retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('recovering'),
      { state:'executing', retry_at_ms:null });
      assert.equal(database.prepare(
        'SELECT COUNT(*) count FROM fx_resource_defer WHERE event_id=?').get('recovering').count, 0);
    } finally { database.close(); }
    governor.release(holder.permit);
    assert.equal(governor.acquireRecovery(
      request('recovering', [['cpu_heavy']])).kind, 'permitted');
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

test('priority refresh covers durable hard defers without permits, changed clocks, or a new queue', () => {
  fixture(({ governor, seedEvents, databasePath, setEventState }) => {
    const {createLibraResourcePriorityBridge}=require('../../src/helix/composition/libra-resource-priority-bridge');
    seedEvents('holder','wait-1','wait-2','defer-a','defer-b','impossible');
    let revision=2;
    const projection=scope=>({priorityClass:'normal_foreground',localPriority:scope.processId==='b'?195:100,priorityRevision:revision});
    const bridge=createLibraResourcePriorityBridge({governor,readProjection:projection});
    const holder=bridge.governor.acquire(request('holder',[['sqlite_write']]));
    for(const [eventId,processId] of [['wait-1','a'],['wait-2','a'],['defer-a','a'],['defer-b','b']]){
      bridge.recordScope(eventId,{ownerDomain:'libra',processType:'libra_run',processId,workKind:'production'});
      const admitted=bridge.governor.acquire(request(eventId,[['sqlite_write']]));
      assert.equal(admitted.kind,eventId.startsWith('defer')?'deferred':'waiting');
    }
    bridge.recordScope('impossible',{ownerDomain:'libra',processType:'libra_run',processId:'b',workKind:'production'});
    assert.equal(bridge.governor.acquire(request('impossible',[['encoder:unknown']])).kind,'unavailable');
    const database=new Database(databasePath,{readonly:true});
    try {
      const clocks=()=>database.prepare('SELECT event_id,resource_key,enqueued_at_ms,retry_at_ms,state FROM fx_resource_defer ORDER BY event_id,resource_key').all();
      const before=clocks();
      bridge.refresh();
      assert.deepEqual(clocks(),before);
      assert.equal(governor.snapshot().permitCount,1);assert.equal(governor.snapshot().waiterCount,2);
      assert.deepEqual(database.prepare('SELECT local_priority,priority_revision FROM fx_resource_defer WHERE event_id=?').get('defer-b'),
        {local_priority:195,priority_revision:2});
      assert.throws(()=>governor.updateWaiterPriority({eventId:'defer-b',queueClass:'normal_foreground',localPriority:195,priorityRevision:2}),
        {code:'P4_RESOURCE_PRIORITY_UPDATE_INVALID'});
      assert.throws(()=>governor.updateWaiterPriority({eventId:'unknown',queueClass:'normal_foreground',localPriority:100,priorityRevision:3}),
        {code:'P4_RESOURCE_WAITER_NOT_FOUND'});
      governor.release(holder.permit);
      const next=bridge.governor.acquire(request('wait-1',[['sqlite_write']],{localPriority:100,priorityRevision:2}));
      assert.equal(next.kind,'permitted');setEventState('wait-1','succeeded');governor.release(next.permit);
      const a=database.prepare('SELECT retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('defer-a');
      const b=database.prepare('SELECT retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('defer-b');
      assert.ok(b.retry_at_ms<a.retry_at_ms,'a free queue slot wakes the newly preferred durable defer');
      const recreated=createLibraResourcePriorityBridge({governor,readProjection:projection});
      recreated.observeWait('defer-b',{ownerDomain:'libra',processType:'libra_run',processId:'b',workKind:'production'},2);
      revision=3;recreated.refresh();
      assert.equal(database.prepare('SELECT priority_revision FROM fx_resource_defer WHERE event_id=?').get('defer-b').priority_revision,3);
      assert.equal(governor.snapshot().permitCount,0);
      setEventState('defer-b','cancelled');
      revision=4;recreated.refresh();
      assert.equal(database.prepare('SELECT priority_revision FROM fx_resource_defer WHERE event_id=?').get('defer-b').priority_revision,3);
    } finally {database.close();}
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

test('capacity release drains a large deferred batch without advancing its backoff clock', () => {
  fixture(({ governor, databasePath, seedEvents, setNow, setEventState }) => {
    const ids = Array.from({ length: 100 }, (_, index) => 'batch-' + String(index).padStart(3, '0'));
    seedEvents(...ids);
    const holder = governor.acquire(request(ids[0], [['sqlite_write']]));
    for (const id of ids.slice(1)) governor.acquire(request(id, [['sqlite_write']]));
    const db = new Database(databasePath, { readonly: true });
    try {
      setEventState(ids[0], 'succeeded');
      governor.release(holder.permit);
      assert.equal(db.prepare('SELECT retry_at_ms FROM fx_workflow_events WHERE event_id=?').get(ids[3]).retry_at_ms, 185000);
      setNow(180100);
      for (let count = 1; count < ids.length; count++) {
        const due = db.prepare("SELECT event_id FROM fx_workflow_events WHERE state='waiting_for_resource' AND retry_at_ms<=? ORDER BY event_id").all(180100);
        assert.ok(due.length > 0, 'released capacity must keep the original batch progressing');
        assert.ok(due.length <= queueLimits.globalHard, 'early wakes must share the bounded queue budget');
        const next = governor.acquire(request(due[0].event_id, [['sqlite_write']]));
        assert.equal(next.kind, 'permitted');
        setEventState(due[0].event_id, 'succeeded');
        governor.release(next.permit);
      }
      assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE state='succeeded'").get().n, 100);
      assert.equal(governor.snapshot().waiterCount, 0);
      assert.equal(governor.snapshot().permitCount, 0);
    } finally { db.close(); }
  });
});

test('capacity wake preserves unrelated defers and terminal events', () => {
  fixture(({ governor, databasePath, seedEvents, setEventState, setNow }) => {
    seedEvents('holder', 'cpu-holder', 'wait-one', 'wait-two', 'related', 'terminal', 'unrelated');
    const holder = governor.acquire(request('holder', [['sqlite_write']]));
    const cpu = governor.acquire(request('cpu-holder', [['cpu_heavy', profile().capacityFor('cpu_heavy')]]));
    for (const id of ['wait-one', 'wait-two', 'related', 'terminal']) governor.acquire(request(id, [['sqlite_write']]));
    governor.acquire(request('unrelated', [['cpu_heavy']]));
    setEventState('terminal', 'cancelled');
    governor.release(holder.permit);
    setNow(180100);
    const next = governor.acquire(request('wait-one', [['sqlite_write']]));
    governor.release(next.permit);
    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.prepare('SELECT retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('related').retry_at_ms, 180100);
      assert.equal(db.prepare('SELECT retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('unrelated').retry_at_ms, 185000);
      assert.deepEqual(db.prepare('SELECT state,retry_at_ms FROM fx_workflow_events WHERE event_id=?').get('terminal'), { state:'cancelled', retry_at_ms:185000 });
    } finally { db.close(); }
    governor.release(cpu.permit);
  });
});

test('Permit issue and capacity wake do not materialize unrelated terminal defer history', () => {
  const reads = [];
  fixture(({ governor, databasePath, seedEvents, seedDefers }) => {
    const ids = Array.from({ length: 1000 }, (_, ordinal) => 'history-' + ordinal);
    seedEvents('holder', 'waiter', ...ids);
    seedDefers(ids.map((event_id, ordinal) => ({ event_id,
      state:['released', 'cancelled', 'expired'][ordinal % 3] })));
    const database = new Database(databasePath, { readonly: true });
    try {
      const history = database.prepare("SELECT * FROM fx_resource_defer WHERE event_id LIKE 'history-%' ORDER BY event_id").all();
      reads.length = 0;
      const holder = governor.acquire(request('holder', [['sqlite_write']]));
      assert.equal(holder.kind, 'permitted');
      assert.deepEqual(reads.filter(row => row.repositoryId === 'governor_defers'), [
        { repositoryId:'governor_defers', statement:'list_for_event', rowCount:0 },
      ]);
      assert.equal(governor.acquire(request('waiter', [['sqlite_write']])).kind, 'waiting');
      reads.length = 0;
      governor.release(holder.permit);
      assert.deepEqual(reads.filter(row => row.repositoryId === 'governor_defers'), [
        { repositoryId:'governor_defers', statement:'list_waiting', rowCount:1 },
      ]);
      assert.equal(governor.acquire(request('waiter', [['sqlite_write']])).kind, 'permitted');
      assert.equal(database.prepare('SELECT state FROM fx_resource_defer WHERE event_id=?').get('waiter').state, 'released');
      assert.deepEqual(database.prepare("SELECT * FROM fx_resource_defer WHERE event_id LIKE 'history-%' ORDER BY event_id").all(), history);
    } finally { database.close(); }
  }, reads);
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


test('shutdown removes unpermitted waiters while preserving active Permits and Event facts',()=>{
  fixture(({governor,seedEvents,databasePath})=>{
    seedEvents('holder','waiting');
    const holder=governor.acquire(request('holder',[['cpu_heavy']]));
    assert.equal(governor.acquire(request('waiting',[['cpu_heavy']])).kind,'waiting');
    assert.deepEqual(governor.abandonWaiters(),{abandonedWaiters:1});
    assert.equal(governor.snapshot().waiterCount,0);assert.equal(governor.snapshot().permitCount,1);
    const db=new Database(databasePath,{readonly:true});
    try{
      assert.equal(db.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('waiting').state,'waiting_for_resource');
      assert.equal(db.prepare("SELECT count(*) n FROM fx_resource_defer WHERE event_id=? AND state='waiting'").get('waiting').n,1);
    }
    finally{db.close();}
    governor.release(holder.permit);assert.equal(governor.snapshot().permitCount,0);
    assert.equal(governor.acquire(request('waiting',[['cpu_heavy']])).kind,'permitted');
  });
});
