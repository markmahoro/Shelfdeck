'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createExecutionRuntimeHost } = require('../../src/helix/foundation/execution/execution-runtime-host');
const { createPlannerRegistry } = require('../../src/helix/foundation/execution/planner-registry');

function withDefinition(work) {
  return Object.freeze({ ...work, definition:Object.freeze({
    workObjectiveTypeRef:'helix://test/work/' + work.work_kind + '/v1', workObjectiveVersion:1,
    executionBasisId:work.process_id + ':basis', dependencyRefs:Object.freeze([]), priorityRevision:1,
    capabilityCatalogScope:work.owner_domain, workspaceMaterialScope:Object.freeze([]),
    concurrencyScope:work.process_type + '/' + work.process_id + '/' + work.work_kind,
    outputContractRef:'helix://test/results/' + work.work_kind + '/v1',
  }) });
}

test('Planner Registry resolves one typed pure Planner per Owner Work kind', () => {
  const planner = Object.freeze({ plan() {} });
  const registry = createPlannerRegistry({ registrations: [{
    ownerDomain: 'procurement', workKind: 'evidence_assessment',
    plannerContractRef: 'helix://procurement/planners/EvidenceAssessment/v1', plannerVersion: 1, planner,
  }] });
  assert.equal(registry.resolve('procurement', 'evidence_assessment').planner, planner);
  assert.equal(registry.snapshot.length, 1);
  assert.throws(() => registry.resolve('libra', 'evidence_assessment'), { code: 'P4_PLANNER_NOT_REGISTERED' });
  assert.throws(() => createPlannerRegistry({ registrations: [{
    ownerDomain: 'procurement', workKind: 'evidence_assessment', plannerContractRef: 'a', plannerVersion: 1, planner,
  }, {
    ownerDomain: 'procurement', workKind: 'evidence_assessment', plannerContractRef: 'b', plannerVersion: 1, planner,
  }] }), { code: 'P4_PLANNER_REGISTRATION_DUPLICATE' });
});

test('Execution Runtime Host plans Work, delegates Event execution, aggregates terminal Work, and reconciles Owner facts', async () => {
  const calls = [];
  const leases = {
    work: Object.freeze({ targetType: 'work', targetId: 'work-1', leaseId: 'work-lease' }),
    event: Object.freeze({ targetType: 'event', targetId: 'event-1', leaseId: 'event-lease' }),
  };
  let workAvailable = true;
  let eventAvailable = true;
  const planner = { async plan(request) {
    calls.push('planner:' + request.workId);
    return Object.freeze({ planId: 'plan-1', resolution: 'planned' });
  } };
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000,
    startupRecovery: { async recover() { calls.push('recover'); return { state: 'ready', normalSupplyAllowed: true }; } },
    scheduler: {
      acquire({ targetType }) {
        if (targetType === 'work' && workAvailable) { workAvailable = false; calls.push('lease:work'); return { kind: 'leased', lease: leases.work }; }
        if (targetType === 'event' && eventAvailable) { eventAvailable = false; calls.push('lease:event'); return { kind: 'leased', lease: leases.event }; }
        return { kind: 'idle' };
      },
      release(lease) { calls.push('release:' + lease.targetType); },
    },
    plannerRegistry: { resolve() { return { plannerContractRef: 'planner@1', plannerVersion: 1, planner }; } },
    planPublisher: { publish(plan) { calls.push('publish:' + plan.planId); return plan; } },
    workLifecycle: {
      ensurePlanningAttempt() { calls.push('activate'); return { work: withDefinition({ work_id: 'work-1', owner_domain: 'procurement',
        process_type: 'procurement_run', process_id: 'run-1', work_kind: 'evidence_assessment', basis_digest: 'a'.repeat(64),
        priority_class: 'normal_foreground' }), attempt: { attempt_id: 'attempt-1' } }; },
      startPlanned() { calls.push('start'); return { state: 'running', attemptState: 'running', replayed: false }; },
      aggregateEvent() { calls.push('aggregate'); return { attemptTerminal: true, workTerminal: false, replayed: false,
        attemptId: 'attempt-1', attemptState: 'succeeded', work: { work_id: 'work-1', owner_domain: 'procurement',
          process_type: 'procurement_run', process_id: 'run-1', state: 'running' } }; },
      settleWork(request) { calls.push('settle:' + request.disposition);
        return { workId: request.workId, state: request.disposition, replayed: false }; },
    },
    eventRuntime: { async run() { calls.push('event-runtime'); return { kind: 'succeeded' }; } },
    domainReconciler: { async reconcile(request) { calls.push('reconcile:' + request.reconcilePhase + ':' + request.workState);
      return request.reconcilePhase === 'attempt_terminal'
        ? { workId: request.workId, disposition: 'succeeded' } : null; } },
    fallbackReconciler:{async start(){},async stop(){}},
  });
  const started = await host.start();
  assert.equal(started.state, 'ready');
  await new Promise((resolve) => setImmediate(resolve));
  await host.stop();
  assert.deepEqual(calls, [
    'recover', 'lease:work', 'activate', 'planner:work-1', 'publish:plan-1', 'start', 'release:work',
    'lease:event', 'event-runtime', 'aggregate', 'reconcile:attempt_terminal:running', 'settle:succeeded',
    'reconcile:work_terminal:succeeded',
  ]);
});

test('Execution Runtime Host persists terminal Work before notifying its exact Domain Process scope', async () => {
  let eventAvailable=true;
  let persistedState='running';
  const observations=[];
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:4,
    startupRecovery:{recover:async()=>({state:'ready',normalSupplyAllowed:true})},
    scheduler:{acquire({targetType}){
      if(targetType==='work'||!eventAvailable)return {kind:'idle'};
      eventAvailable=false;
      return {kind:'leased',lease:{targetType:'event',targetId:'event-terminal',leaseId:'lease-terminal'}};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{
      ensurePlanningAttempt(){},startPlanned(){},
      aggregateEvent(){return {attemptTerminal:true,workTerminal:false,replayed:false,attemptId:'attempt-terminal',
        attemptState:'succeeded',work:{work_id:'work-terminal',owner_domain:'libra',process_type:'libra_run',
          process_id:'run-terminal',work_kind:'product_identity',state:'running'}};},
      settleWork(request){persistedState=request.disposition;
        return {workId:request.workId,state:persistedState,replayed:false};},
    },
    eventRuntime:{async run(){return {kind:'succeeded'};}},
    domainReconciler:{async reconcile(request){
      observations.push({phase:request.reconcilePhase,reported:request.workState,persisted:persistedState});
      return request.reconcilePhase==='attempt_terminal'
        ? {workId:request.workId,disposition:'succeeded'} : null;
    }},
    fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  await host.stop();
  assert.deepEqual(observations,[
    {phase:'attempt_terminal',reported:'running',persisted:'running'},
    {phase:'work_terminal',reported:'succeeded',persisted:'succeeded'},
  ]);
});

test('Execution Runtime Host renews a Work lease while an asynchronous Planner is still building its plan', async () => {
  let available = true;
  let renewals = 0;
  let releases = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000,
    leaseHeartbeatMs: 10,
    startupRecovery: { recover: async () => ({ state: 'ready', normalSupplyAllowed: true }) },
    scheduler: {
      acquire({ targetType }) {
        if (targetType === 'work' && available) {
          available = false;
          return { kind: 'leased', lease: { targetType: 'work', targetId: 'work-long', leaseId: 'lease-long' } };
        }
        return { kind: 'idle' };
      },
      renew() { renewals += 1; },
      release() { releases += 1; },
    },
    plannerRegistry: { resolve() { return { plannerContractRef: 'planner@1', plannerVersion: 1, planner: {
      async plan() { await new Promise((resolve) => setTimeout(resolve, 35)); return { planId: 'plan-long', resolution: 'planned' }; },
    } }; } },
    planPublisher: { publish(plan) { return plan; } },
    workLifecycle: {
      ensurePlanningAttempt() { return { work: withDefinition({ work_id: 'work-long', owner_domain: 'procurement', process_type: 'procurement_run',
        process_id: 'run-long', work_kind: 'evidence_assessment', basis_digest: 'a'.repeat(64), priority_class: 'normal_foreground' }), attempt: { attempt_id: 'attempt-long' } }; },
      startPlanned() { return { state: 'running', attemptState: 'running', replayed: false }; },
      aggregateEvent() { return { attemptTerminal: false, workTerminal: false, replayed: false }; },
      settleWork() {},
    },
    eventRuntime: { async run() { return { kind: 'succeeded' }; } },
    domainReconciler: { async reconcile() {} },
    fallbackReconciler: { async start() {}, async stop() {} },
  });
  await host.start();
  await host.drainOnce();
  await host.stop();
  assert.ok(renewals >= 2, `expected lease renewals during planning, got ${renewals}`);
  assert.equal(releases, 1);
});

test('lost wake is harmless because bounded periodic ticks rescan durable Scheduler facts', async () => {
  let scans = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 10,
    maxIdlePollMs: 40,
    maxActionsPerTick: 1,
    startupRecovery: { recover: async () => ({ state: 'ready', normalSupplyAllowed: true }) },
    scheduler: { acquire() { scans += 1; return { kind: 'idle' }; }, release() {} },
    plannerRegistry: { resolve() {} }, planPublisher: { publish() {} },
    workLifecycle: { ensurePlanningAttempt() {}, startPlanned() {}, aggregateEvent() {}, settleWork() {} },
    eventRuntime: { run() {} }, domainReconciler: { reconcile() {} },fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  await new Promise((resolve) => setTimeout(resolve, 115));
  await host.stop();
  assert.ok(scans >= 4 && scans <= 8, `expected bounded fallback scans without hot polling, got ${scans}`);
});

test('startup invokes the independent durable Domain fallback runner', async () => {
  let scans = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs:60000,
    startupRecovery:{recover:async()=>({state:'ready',normalSupplyAllowed:true})},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){},settleWork(){},pendingOwnerReconciliations(){return [];}},
    eventRuntime:{run(){}},domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){scans+=1;},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  await host.stop();
  assert.ok(scans>=1);
});

test('startup applies classified recovery actions before enabling ordinary Work supply', async () => {
  const calls = [];
  let pass = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:1,
    startupRecovery:{async recover(){calls.push('classify');return pass++===0
      ? {state:'recovering',normalSupplyAllowed:false,findings:[],actions:[{eventId:'event-recovery',effectId:'effect-recovery',decision:'safe_retry'}]}
      : {state:'ready',normalSupplyAllowed:true,findings:[],actions:[]};}},
    scheduler:{acquire(){calls.push('ordinary-supply');return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(eventId){calls.push('aggregate:'+eventId);
      return {attemptTerminal:false,workTerminal:false,replayed:false};},settleWork(){}},
    eventRuntime:{async recover(action){calls.push('recover:'+action.eventId);return {kind:'succeeded'};},async run(){}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){calls.push('fallback-start');},async stop(){}},
  });
  await host.start();
  assert.deepEqual(calls.slice(0,5),['classify','recover:event-recovery','aggregate:event-recovery','classify','fallback-start']);
  const firstSupply = calls.indexOf('ordinary-supply');
  assert.ok(firstSupply === -1 || firstSupply > calls.indexOf('fallback-start'),
    'ordinary supply must remain closed until recovery converges');
  await host.stop();
});

test('crash-before-intent recovery is deferred until after ordinary supply is enabled', async () => {
  const calls = [];
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000, maxActionsPerTick: 1, recoveryRetryMs: 10,
    startupRecovery: { async recover() {
      return { state: 'recovering', normalSupplyAllowed: false, findings: [],
        actions: [{ eventId: 'event-remux', decision: 'safe_retry_before_intent' }] };
    } },
    scheduler: { acquire() { calls.push('ordinary-supply'); return { kind: 'idle' }; }, release() {} },
    plannerRegistry: { resolve() {} }, planPublisher: { publish() {} },
    workLifecycle: { ensurePlanningAttempt() {}, startPlanned() {}, aggregateEvent() {
      return { attemptTerminal: false, workTerminal: false, replayed: false };
    }, settleWork() {} },
    eventRuntime: { async recover(action) { calls.push('recover:' + action.decision); return { kind: 'succeeded' }; }, async run() {} },
    domainReconciler: { reconcile() {} }, fallbackReconciler: { async start() { calls.push('fallback-start'); }, async stop() {} },
  });
  const started = await host.start();
  assert.equal(started.state, 'ready');
  assert.ok(calls.includes('fallback-start'));
  const fallbackAt = calls.indexOf('fallback-start');
  if (!calls.includes('recover:safe_retry_before_intent')) await host.drainOnce();
  const recoverAt = calls.indexOf('recover:safe_retry_before_intent');
  assert.ok(recoverAt > fallbackAt, 'crash-before-intent recover must run after ordinary readiness');
  await host.stop();
});

test('a transient recovery invocation failure stays in the safety lane without denying ordinary service supply', async () => {
  const errors=[];
  let recoveryCalls=0;
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:1,recoveryRetryMs:10,
    startupRecovery:{async recover(){return {state:'recovering',normalSupplyAllowed:false,findings:[],
      actions:[{eventId:'event-recovery',effectId:'effect-recovery',decision:'safe_retry'}]};}},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {
      attemptTerminal:false,workTerminal:false,replayed:false,
    };},settleWork(){}},
    eventRuntime:{async recover(){recoveryCalls+=1;if(recoveryCalls===1)throw new Error('provider temporarily unavailable');
      return {kind:'succeeded'};},async run(){}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
    onError(error){errors.push(error);},
  });
  const started=await host.start();
  assert.equal(started.state,'ready');
  assert.equal(host.activity().deferredRecoveryActions,1);
  assert.equal(errors.length,1);
  await new Promise((resolve)=>setTimeout(resolve,15));
  await host.drainOnce();
  assert.equal(recoveryCalls,2);
  assert.equal(host.activity().deferredRecoveryActions,0);
  await host.stop();
});

test('an in-process Event crash after Effect commit enters recovery without requiring service restart', async () => {
  let eventAvailable = true;
  let recoveries = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:1,recoveryRetryMs:10,
    startupRecovery:{async recover(){return {state:'ready',normalSupplyAllowed:true,findings:[],actions:[]};}},
    scheduler:{acquire({targetType}){
      if(targetType==='event'&&eventAvailable){eventAvailable=false;return {kind:'leased',lease:{
        targetType:'event',targetId:'event-commit-window',leaseId:'lease-commit-window',
      }};}
      return {kind:'idle'};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {
      attemptTerminal:false,workTerminal:false,replayed:false,
    };},settleWork(){},pendingOwnerReconciliations(){return [];}},
    eventRuntime:{async run(){throw new Error('result binding failed after effect commit');},
      retryPendingCompletion(eventId){recoveries+=1;assert.equal(eventId,'event-commit-window');return {kind:'succeeded'};}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  const deadline=Date.now()+1000;
  while(recoveries===0&&Date.now()<deadline)await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(recoveries,1);
  assert.equal(host.activity().deferredRecoveryActions,0);
  await host.stop();
});

test('planner throw stays Work-local and does not fault the Runtime Host', async () => {
  const errors = [];
  let workAvailable = true;
  let eventAvailable = true;
  let succeeded = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000, maxActionsPerTick: 8,
    startupRecovery: { recover: async () => ({ state: 'ready', normalSupplyAllowed: true }) },
    scheduler: {
      acquire({ targetType }) {
        if (targetType === 'work' && workAvailable) {
          workAvailable = false;
          return { kind: 'leased', lease: { targetType: 'work', targetId: 'work-boom', leaseId: 'lease-work-boom' } };
        }
        if (targetType === 'event' && eventAvailable) {
          eventAvailable = false;
          return { kind: 'leased', lease: { targetType: 'event', targetId: 'event-ok', leaseId: 'lease-event-ok' } };
        }
        return { kind: 'idle' };
      },
      release() {},
    },
    plannerRegistry: { resolve() { return { plannerContractRef: 'planner@1', plannerVersion: 1, planner: {
      async plan() { throw new Error('planner boom'); },
    } }; } },
    planPublisher: { publish() {} },
    workLifecycle: {
      ensurePlanningAttempt() {
        return { work: withDefinition({ work_id: 'work-boom', owner_domain: 'libra', process_type: 'libra_run',
          process_id: 'run-boom', work_kind: 'artifact_production', basis_digest: 'a'.repeat(64),
          priority_class: 'normal_foreground' }), attempt: { attempt_id: 'attempt-boom' } };
      },
      startPlanned() {},
      aggregateEvent() { return { attemptTerminal: false, workTerminal: false, replayed: false }; },
      settleWork() {},
    },
    eventRuntime: { async run() { succeeded += 1; return { kind: 'succeeded' }; } },
    domainReconciler: { reconcile() {} },
    fallbackReconciler: { async start() {}, async stop() {} },
    onError(error) { errors.push(error); },
  });
  await host.start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.readiness().state, 'ready');
  assert.equal(host.activity().faulted, false);
  assert.equal(succeeded, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].message), /planner boom/);
  assert.equal((await host.stop()).state, 'stopped');
});

test('executor crash stays Event-local and does not fault the Runtime Host', async () => {
  const errors = [];
  let next = 0;
  let succeeded = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000, maxActionsPerTick: 8, maxInFlightEvents: 16,
    startupRecovery: { recover: async () => ({ state: 'ready', normalSupplyAllowed: true }) },
    scheduler: {
      acquire({ targetType }) {
        if (targetType === 'work' || next >= 2) return { kind: 'idle' };
        const targetId = 'event-' + next++;
        return { kind: 'leased', lease: { targetType: 'event', targetId, leaseId: 'lease-' + targetId } };
      },
      release() {},
    },
    plannerRegistry: { resolve() {} }, planPublisher: { publish() {} },
    workLifecycle: {
      ensurePlanningAttempt() {}, startPlanned() {},
      aggregateEvent() { return { attemptTerminal: false, workTerminal: false, replayed: false }; },
      settleWork() {},
    },
    eventRuntime: {
      async run({ schedulerLease }) {
        if (schedulerLease.targetId === 'event-0') throw new Error('executor crash');
        succeeded += 1;
        return { kind: 'succeeded' };
      },
    },
    domainReconciler: { reconcile() {} },
    fallbackReconciler: { async start() {}, async stop() {} },
    onError(error) { errors.push(error); },
  });
  await host.start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.readiness().state, 'ready');
  assert.equal(host.activity().faulted, false);
  assert.equal(succeeded, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].message), /executor crash/);
  assert.equal((await host.stop()).state, 'stopped');
});

test('pre-dispatch input failure is reported without faulting the Runtime Host', async () => {
  const errors=[];
  let available=true;
  let aggregated=0;
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:4,
    startupRecovery:{recover:async()=>({state:'ready',normalSupplyAllowed:true})},
    scheduler:{acquire({targetType}){
      if(targetType==='work'||!available)return {kind:'idle'};
      available=false;
      return {kind:'leased',lease:{targetType:'event',targetId:'event-input-failed',leaseId:'lease-input-failed'}};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){aggregated+=1;
      return {attemptTerminal:false,workTerminal:false,replayed:false};},settleWork(){}},
    eventRuntime:{async run(){return {kind:'input_failed',failureCode:'P4_EVENT_INPUT_PREPARATION_FAILED'};}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
    onError(error){errors.push(error);},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  await host.stop();
  assert.equal(aggregated,1);
  assert.equal(errors.length,1);
  assert.equal(errors[0].code,'P4_EVENT_INPUT_PREPARATION_FAILED');
  assert.equal(host.activity().faulted,false);
});

test('Runtime Host launches up to sixteen Events concurrently and stop leases no additional Event', async () => {
  const gates = [];
  const leased = [];
  let next = 0;
  const host = createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:64,maxInFlightEvents:16,
    startupRecovery:{recover:async()=>({state:'ready',normalSupplyAllowed:true})},
    scheduler:{acquire({targetType}){
      if(targetType==='work')return {kind:'idle'};
      if(next>=24)return {kind:'idle'};
      const targetId='event-'+next++;leased.push(targetId);
      return {kind:'leased',lease:{targetType:'event',targetId,leaseId:'lease-'+targetId}};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {attemptTerminal:false,workTerminal:false,replayed:false};},settleWork(){}},
    eventRuntime:{run(){return new Promise((resolve)=>gates.push(resolve));}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(host.activity().inFlightEvents,16);
  assert.equal(leased.length,16);
  const stopping=host.stop();
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(leased.length,16,'stop must stop new leasing before awaiting in-flight Events');
  for(const release of gates)release({kind:'succeeded'});
  assert.equal((await stopping).state,'stopped');
  assert.equal(host.activity().inFlightEvents,0);
});
