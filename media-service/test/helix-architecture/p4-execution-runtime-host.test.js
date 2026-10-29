'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createExecutionRuntimeHost } = require('../../src/helix/foundation/execution/execution-runtime-host');
const { createPlannerRegistry } = require('../../src/helix/foundation/execution/planner-registry');

test('Owner startup wake may enter ordinary draining without being mistaken for shutdown',async()=>{
  let host,releasePlanner,plannerEntered,available=true;
  const entered=new Promise(resolve=>{plannerEntered=resolve;}),gate=new Promise(resolve=>{releasePlanner=resolve;});
  host=createExecutionRuntimeHost({tickIntervalMs:60000,
    startupRecovery:{async recover(){return {normalSupplyAllowed:true};}},
    scheduler:{acquire({targetType}){if(targetType==='work'&&available){available=false;return {kind:'leased',lease:{targetType:'work',targetId:'startup-work',leaseId:'lease'}};}return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){return {plannerContractRef:'planner@1',plannerVersion:1,planner:{async plan(){plannerEntered();await gate;return {planId:'plan',resolution:'planned'};}}};}},
    planPublisher:{publish(plan){return plan;}},
    workLifecycle:{ensurePlanningAttempt(){return {work:withDefinition({work_id:'startup-work',owner_domain:'libra',process_type:'libra_run',process_id:'run',work_kind:'test',basis_digest:'a'.repeat(64),priority_class:'normal'}),attempt:{attempt_id:'attempt'}};},startPlanned(){return {state:'running'};},aggregateEvent(){},settleWork(){}},
    eventRuntime:{async run(){}},domainReconciler:{async reconcile(){}},
    fallbackReconciler:{async start(){host.wake();await entered;},async stop(){}},
  });
  try{const started=await host.start();assert.equal(started.state,'draining');assert.equal(started.normalSupplyAllowed,true);}
  finally{releasePlanner();await host.stop();}
});

test('an actual shutdown during Owner startup still interrupts supply and drains safely',async()=>{
  let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const host=createExecutionRuntimeHost({startupRecovery:{async recover(){return {normalSupplyAllowed:true};}},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){},settleWork(){}},eventRuntime:{async run(){}},domainReconciler:{async reconcile(){}},
    fallbackReconciler:{async start(){enter();await gate;},async stop(){}},
  });
  const starting=host.start();await entered;const rejected=assert.rejects(starting,{code:'P4_STARTUP_INTERRUPTED'});
  const stopping=host.stop();release();await rejected;await stopping;assert.equal(host.readiness().state,'stopped');
});

test('maintenance quiesce waits for Event and Owner closure, then resumes through recovery', async () => {
  let eventRelease, ownerRelease, leaseNext=true, ownerEntered=false, recoveryCalls=0, starts=0;
  const eventGate=new Promise(resolve=>{eventRelease=resolve;}),ownerGate=new Promise(resolve=>{ownerRelease=resolve;});
  const host=createExecutionRuntimeHost({tickIntervalMs:60000,
    startupRecovery:{async recover(){recoveryCalls++;return {normalSupplyAllowed:true};}},
    scheduler:{acquire({targetType}){if(targetType==='event'&&leaseNext){leaseNext=false;return {kind:'leased',lease:{targetType:'event',targetId:'maintenance-event',leaseId:'lease'}};}return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {attemptTerminal:true,replayed:false,attemptId:'attempt',attemptState:'succeeded',work:{work_id:'work',owner_domain:'libra',process_type:'libra_run',process_id:'run',work_kind:'test',state:'running'}};},settleWork(){return {state:'succeeded'};}},
    eventRuntime:{run(){return eventGate;}},domainReconciler:{async reconcile(r){if(r.reconcilePhase==='attempt_terminal'){ownerEntered=true;await ownerGate;return {disposition:'succeeded'};}return null;}},
    fallbackReconciler:{async start(){starts++;},async stop(){},snapshot(){return {};}},
  });
  try {
    await host.start();await host.drainOnce();
    const stopped=host.quiesce();assert.equal(host.readiness().state,'quiescing');assert.equal(host.readiness().normalSupplyAllowed,false);
    leaseNext=true;assert.equal((await host.drainOnce()).kind,'inactive');assert.equal(leaseNext,true);
    eventRelease({kind:'succeeded'});for(let i=0;i<10&&!ownerEntered;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ownerEntered,true);assert.equal(host.readiness().state,'quiescing');
    ownerRelease();assert.equal((await stopped).state,'quiesced');assert.equal(host.activity().inFlightEvents,0);
    leaseNext=false;await host.start();assert.equal(recoveryCalls,2);assert.equal(starts,2);assert.equal(host.readiness().normalSupplyAllowed,true);
  }finally{eventRelease({kind:'succeeded'});ownerRelease();await host.stop();}
});

test('persisted stopped intent classifies recovery without running Effects or supply', async () => {
  let supplies=0,recoveries=0;
  const host=createExecutionRuntimeHost({startupRecovery:{async recover(){return {normalSupplyAllowed:false,actions:[{eventId:'unknown',effectId:'effect'}]};}},
    scheduler:{acquire(){supplies++;return {kind:'idle'};},release(){}},plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){},settleWork(){}},
    eventRuntime:{run(){throw Error('No Event expected');},recover(){recoveries++;}},domainReconciler:{reconcile(){}},
    fallbackReconciler:{async start(){throw Error('No ordinary reconciliation expected');},async stop(){},snapshot(){return {};}},
  });
  await host.start({quiesced:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(host.readiness().state,'quiesced');assert.equal(supplies,0);assert.equal(recoveries,0);await host.stop();
});

function withDefinition(work) {
  return Object.freeze({ ...work, definition:Object.freeze({
    workObjectiveTypeRef:'helix://test/work/' + work.work_kind + '/v1', workObjectiveVersion:1,
    executionBasisId:work.process_id + ':basis', dependencyRefs:Object.freeze([]), priorityRevision:1,
    capabilityCatalogScope:work.owner_domain, workspaceMaterialScope:Object.freeze([]),
    concurrencyScope:work.process_type + '/' + work.process_id + '/' + work.work_kind,
    outputContractRef:'helix://test/results/' + work.work_kind + '/v1',
  }) });
}

for (const failFirst of [false, true]) {
  test('concurrent Owner scans share the exact Attempt and preserve retry after failure: ' + failFirst, async () => {
    let pending = false, ownerCalls = 0, settleCalls = 0, notifyCalls = 0, enter, release;
    const entered = new Promise((resolve) => { enter = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const errors = [];
    const work = { work_id: 'owner-work', owner_domain: 'libra', process_type: 'libra_run',
      process_id: 'owner-run', work_kind: 'test_work', state: 'running' };
    const host = createExecutionRuntimeHost({ tickIntervalMs: 60000,
      startupRecovery: { async recover() { return { state: 'ready', normalSupplyAllowed: true }; } },
      scheduler: { acquire() { return { kind: 'idle' }; }, release() {} },
      plannerRegistry: { resolve() {} }, planPublisher: { publish() {} },
      workLifecycle: { ensurePlanningAttempt() {}, startPlanned() {}, aggregateEvent() {},
        pendingOwnerReconciliations() { return pending ? [{ work,
          attempt: { attempt_id: 'owner-attempt', state: 'failed', failure_code: 'INPUT_IO_FAILED' } }] : []; },
        settleWork() { settleCalls++; pending = false; return { state: 'failed' }; },
      }, eventRuntime: { async run() {} },
      domainReconciler: { async reconcile(request) {
        if (request.reconcilePhase === 'work_terminal') { notifyCalls++; return null; }
        ownerCalls++; enter(); await gate;
        if (failFirst && ownerCalls === 1) throw Object.assign(new Error('Owner temporarily unavailable'), { code: 'OWNER_TEST_FAILURE' });
        return { workId: request.workId, disposition: 'failed' };
      } },
      fallbackReconciler: { async start() {}, async stop() {} }, onError(error) { errors.push(error.code); },
    });
    try {
      await host.start();
      await new Promise((resolve) => setImmediate(resolve));
      pending = true;
      const first = host.drainOnce();
      await entered;
      const second = host.drainOnce();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(ownerCalls, 1);
      release();
      await Promise.all([first, second]);
      if (failFirst) {
        assert.ok(errors.length > 0);
        assert.ok(errors.every((code) => code === 'OWNER_TEST_FAILURE'));
        assert.equal(settleCalls, 0);
        await host.drainOnce();
      } else assert.deepEqual(errors, []);
      assert.equal(ownerCalls, failFirst ? 2 : 1);
      assert.equal(settleCalls, 1);
      assert.equal(notifyCalls, 1);
    } finally { release(); await host.stop(); }
  });
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

test('an Owner-deferred Event is not aggregated or reported as completed Work',async()=>{
  let available=true,aggregations=0,reconciliations=0,errors=0;
  const host=createExecutionRuntimeHost({tickIntervalMs:60000,
    startupRecovery:{async recover(){return {state:'ready',normalSupplyAllowed:true};}},
    scheduler:{acquire({targetType}){if(targetType==='event'&&available){available=false;
      return {kind:'leased',lease:{targetType:'event',targetId:'deferred-event',leaseId:'lease'}};}return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){aggregations++;},settleWork(){}},
    eventRuntime:{async run(){return {kind:'owner_deferred',eventId:'deferred-event',reasonCode:'target_not_current'};}},
    domainReconciler:{async reconcile(){reconciliations++;}},fallbackReconciler:{async start(){},async stop(){}},onError(){errors++;},
  });
  await host.start();await new Promise(resolve=>setImmediate(resolve));await host.stop();
  assert.equal(aggregations,0);assert.equal(reconciliations,0);assert.equal(errors,0);
});

async function guardedWorkCase(decisions,{staleAt=null}={}){
  const calls=[],errors=[],scope={ownerDomain:'libra',processType:'libra_run',processId:'run',workKind:'test_work',executionBasisDigest:'a'.repeat(64)},
    lease={targetType:'work',targetId:'guarded-work',leaseId:'guarded-lease'},fences=[];
  let available=false;
  const host=createExecutionRuntimeHost({tickIntervalMs:60000,
    startupRecovery:{async recover(){return {normalSupplyAllowed:true};}},
    scheduler:{acquire({targetType}){if(targetType==='work'&&available){available=false;return {kind:'leased',lease,executionScope:scope};}
      return {kind:'idle'};},noteDispatchOutcome(_lease,outcome){calls.push(outcome.kind);},release(){calls.push('release');}},
    workDispatchGuard:{check(value){assert.deepEqual(value,{...scope,workId:'guarded-work'});calls.push('check');
      const decision=decisions.shift();if(decision instanceof Error)throw decision;return decision;}},
    plannerRegistry:{resolve(){return {plannerContractRef:'planner@1',plannerVersion:1,planner:{async plan(){calls.push('plan');return {planId:'plan',resolution:'planned'};}}};}},
    planPublisher:{publish(plan,options){calls.push('publish');fences.push(options?.readFence);if(staleAt==='publish')throw Object.assign(new Error('stale'),{code:'P3_UOW_READ_FENCE_CHANGED'});return plan;}},
    workLifecycle:{ensurePlanningAttempt(_id,options){calls.push('activate');fences.push(options?.readFence);
        if(staleAt==='activate')throw Object.assign(new Error('stale'),{code:'P3_UOW_READ_FENCE_CHANGED'});
        return {work:withDefinition({work_id:'guarded-work',owner_domain:'libra',process_type:'libra_run',process_id:'run',
          work_kind:'test_work',basis_digest:'a'.repeat(64),priority_class:'normal_foreground'}),attempt:{attempt_id:'attempt'}};},
      startPlanned(_work,_attempt,_diagnostic,options){calls.push('start');fences.push(options?.readFence);
        if(staleAt==='start')throw Object.assign(new Error('stale'),{code:'P3_UOW_READ_FENCE_CHANGED'});
        return {state:'running',attemptState:'running'};},aggregateEvent(){},settleWork(){}},
    eventRuntime:{async run(){}},domainReconciler:{async reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},onError:error=>errors.push(error),
  });
  try{await host.start();await new Promise(resolve=>setImmediate(resolve));available=true;const outcome=await host.drainOnce();
    return {outcome,calls,fences,errors};}finally{await host.stop();}
}

test('Work planning holds one Owner view from before planning through publication and refreshes before start',async()=>{
  const first=Object.freeze({fence:1}),planning=Object.freeze({fence:2}),start=Object.freeze({fence:3}),
    result=await guardedWorkCase([{kind:'ready',readFence:first},{kind:'ready',readFence:planning},{kind:'ready',readFence:start}]);
  assert.equal(result.outcome.work.kind,'work_planned');assert.deepEqual(result.fences,[first,planning,start]);
  assert.deepEqual(result.calls,['check','activate','check','plan','publish','check','start','started','release']);assert.deepEqual(result.errors,[]);
});

for(const stage of ['before_activation','before_planning','before_start'])test('Owner pending '+stage+' defers Work without falsely completing it',async()=>{
  const ready=()=>({kind:'ready',readFence:Object.freeze({})}),pending={kind:'pending',reasonCode:'target_not_current'},
    decisions=stage==='before_activation'?[pending]:stage==='before_planning'?[ready(),pending]:[ready(),ready(),pending],
    result=await guardedWorkCase(decisions);
  assert.deepEqual(result.outcome.work,{kind:'work_owner_deferred',workId:'guarded-work',reasonCode:'target_not_current'});
  assert.equal(result.outcome.kind,'advanced');
  assert.equal(result.calls.includes('activate'),stage!=='before_activation');assert.equal(result.calls.includes('plan'),stage==='before_start');
  assert.equal(result.calls.includes('publish'),stage==='before_start');assert.equal(result.calls.includes('start'),false);
  assert.equal(result.calls.at(-2),'owner_wait');assert.equal(result.calls.at(-1),'release');assert.deepEqual(result.errors,[]);
});

for(const stage of ['activate','publish','start'])test('a stale Owner fence at Work '+stage+' defers rather than records a fault',async()=>{
  const ready=()=>({kind:'ready',readFence:Object.freeze({})}),result=await guardedWorkCase([ready(),ready(),ready()],{staleAt:stage});
  assert.deepEqual(result.outcome.work,{kind:'work_owner_deferred',workId:'guarded-work',reasonCode:'owner_view_changed'});
  assert.equal(result.calls.includes('start'),stage==='start');assert.equal(result.calls.at(-2),'owner_wait');assert.equal(result.calls.at(-1),'release');
  assert.deepEqual(result.errors,[]);
});

test('an explicit not-applicable Owner guard preserves ordinary Work planning',async()=>{
  const result=await guardedWorkCase([{kind:'not_applicable'},{kind:'not_applicable'},{kind:'not_applicable'}]);
  assert.equal(result.outcome.work.kind,'work_planned');assert.deepEqual(result.fences,[null,undefined,undefined]);assert.deepEqual(result.errors,[]);
});

test('a malformed Owner Work decision cannot create a planning Attempt',async()=>{
  const result=await guardedWorkCase([{kind:'ready',readFence:null}]);
  assert.equal(result.outcome.work.kind,'work_faulted');assert.equal(result.errors[0].code,'P4_WORK_OWNER_GUARD_INVALID');
  assert.equal(result.calls.includes('activate'),false);assert.equal(result.calls.at(-1),'release');
});

test('an Owner projection that races its own read is deferred without creating an Attempt',async()=>{
  const result=await guardedWorkCase([Object.assign(new Error('stale'),{code:'P3_UOW_READ_FENCE_CHANGED'})]);
  assert.deepEqual(result.outcome.work,{kind:'work_owner_deferred',workId:'guarded-work',reasonCode:'owner_view_changed'});
  assert.equal(result.calls.includes('activate'),false);assert.equal(result.calls.at(-2),'owner_wait');assert.deepEqual(result.errors,[]);
});

test('Execution Runtime Host repairs classified cancelled-Work Attempt residuals before normal supply', async () => {
  const calls=[];
  let pass=0;
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,
    startupRecovery:{async recover(){calls.push('recover');return pass++===0
      ? {state:'recovering',normalSupplyAllowed:false,findings:[],actions:[],workAttemptRepairs:[{
        workId:'work-old',attemptId:'attempt-old',reasonCode:'P4_CANCELLED_WORK_ATTEMPT_RECOVERED',
      }]}
      : {state:'ready',normalSupplyAllowed:true,findings:[],actions:[]};}},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){},settleWork(){},
      repairCancelledWorkAttempt(repair){calls.push('repair:'+repair.attemptId);}},
    eventRuntime:{async run(){}},
    domainReconciler:{async reconcile(){}},
    fallbackReconciler:{async start(){calls.push('fallback:start');},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  await host.stop();
  assert.deepEqual(calls,['recover','repair:attempt-old','recover','fallback:start']);
});

test('Execution Runtime Host starts when Startup Recovery isolates a scoped degraded Circuit', async () => {
  const calls = [];
  const host = createExecutionRuntimeHost({
    tickIntervalMs:60000,
    startupRecovery:{recover:async()=>({state:'degraded',normalSupplyAllowed:true,findings:[],actions:[]})},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){},settleWork(){}},
    eventRuntime:{async run(){}},domainReconciler:{async reconcile(){}},
    fallbackReconciler:{async start(){calls.push('fallback:start');},async stop(){calls.push('fallback:stop');}},
  });
  const started = await host.start();
  assert.equal(started.state, 'ready');
  assert.equal(started.recovery.state, 'degraded');
  await host.stop();
  assert.deepEqual(calls, ['fallback:start', 'fallback:stop']);
});

test('Execution Runtime Host persists terminal Work before notifying its exact Domain Process scope', async () => {
  let eventAvailable=true;
  let persistedState='running';
  const observations=[],incidentObservations=[];
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
    incidentObserver:{observeTerminalWork(request){incidentObservations.push(request);return {incidentRefs:[{incidentKey:'incident-1'}]};}},
    domainReconciler:{async reconcile(request){
      observations.push({phase:request.reconcilePhase,reported:request.workState,persisted:persistedState,
        incidentRefs:request.incidentRefs||[]});
      return request.reconcilePhase==='attempt_terminal'
        ? {workId:request.workId,disposition:'succeeded'} : null;
    }},
    fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  await host.stop();
  assert.deepEqual(observations,[
    {phase:'attempt_terminal',reported:'running',persisted:'running',incidentRefs:[]},
    {phase:'work_terminal',reported:'succeeded',persisted:'succeeded',incidentRefs:[{incidentKey:'incident-1'}]},
  ]);
  assert.deepEqual(incidentObservations,[{ownerDomain:'libra',processType:'libra_run',processId:'run-terminal',
    workKind:'product_identity',workId:'work-terminal',workAttemptId:'attempt-terminal',workAttemptFailureCode:null,
    workState:'succeeded'}]);
});

test('Execution Runtime Host aggregates terminal Events left behind by a crash before Owner reconciliation', async () => {
  const calls=[]; let scanPending=true; let attemptTerminal=false; let workTerminal=false;
  const host=createExecutionRuntimeHost({tickIntervalMs:60000,maxActionsPerTick:4,
    startupRecovery:{recover:async()=>({state:'ready',normalSupplyAllowed:true})},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},
      pendingTerminalEventAggregations(){if(!scanPending)return [];scanPending=false;
        return [{workId:'observation-work',attemptId:'attempt-68',eventId:'page-event-68'}];},
      aggregateEvent(eventId){calls.push('aggregate:'+eventId);attemptTerminal=true;return {attemptTerminal:true,replayed:false,
        attemptId:'attempt-68',attemptState:'succeeded',work:{work_id:'observation-work',owner_domain:'procurement',
          process_type:'material_field',process_id:'field-1',work_kind:'field_observation',state:'running'}};},
      pendingOwnerReconciliations(){return attemptTerminal&&!workTerminal?[{attempt:{attempt_id:'attempt-68',state:'succeeded',failure_code:null},
        work:{work_id:'observation-work',owner_domain:'procurement',process_type:'material_field',process_id:'field-1',
          work_kind:'field_observation',state:'running'}}]:[];},
      settleWork(request){calls.push('settle:'+request.disposition);workTerminal=true;
        return {workId:request.workId,state:'succeeded',replayed:false};}},
    eventRuntime:{run(){}},
    domainReconciler:{async reconcile(request){calls.push('reconcile:'+request.reconcilePhase);
      return request.reconcilePhase==='attempt_terminal'?{workId:request.workId,disposition:'succeeded'}:null;}},
    fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  await host.stop();
  assert.deepEqual(calls,['aggregate:page-event-68','reconcile:attempt_terminal','settle:succeeded','reconcile:work_terminal']);
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

test('dense synchronous Event fanout yields to the Node poll phase between bounded batches', async () => {
  let next=0;
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:16,maxInFlightEvents:16,
    startupRecovery:{recover:async()=>({state:'ready',normalSupplyAllowed:true})},
    scheduler:{acquire({targetType}){
      if(targetType==='work'||next>=200)return {kind:'idle'};
      const targetId='fanout-'+next++;
      return {kind:'leased',lease:{targetType:'event',targetId,leaseId:'lease-'+targetId}};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {
      attemptTerminal:false,workTerminal:false,replayed:false,
    };},settleWork(){},pendingOwnerReconciliations(){return [];}},
    eventRuntime:{async run(){return {kind:'succeeded'};}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  await new Promise((resolve)=>setImmediate(resolve));
  assert.ok(next>0&&next<200,`dense fanout must yield before draining all Events, leased ${next}`);
  await host.stop();
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

test('workspace-write continue_forward recovery is deferred until after ordinary supply is enabled', async () => {
  const calls = [];
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000, maxActionsPerTick: 1, recoveryRetryMs: 10,
    startupRecovery: { async recover() {
      return { state: 'recovering', normalSupplyAllowed: false, findings: [],
        actions: [{ eventId: 'event-remux', effectId: 'effect-remux', decision: 'continue_forward', action: 'reuse_existing' }] };
    } },
    scheduler: { acquire() { calls.push('ordinary-supply'); return { kind: 'idle' }; }, release() {} },
    plannerRegistry: { resolve() {} }, planPublisher: { publish() {} },
    workLifecycle: { ensurePlanningAttempt() {}, startPlanned() {}, aggregateEvent() {
      return { attemptTerminal: false, workTerminal: false, replayed: false };
    }, settleWork() {} },
    eventRuntime: { async recover(action) { calls.push('recover:' + action.decision + ':' + action.action); return { kind: 'succeeded' }; }, async run() {} },
    domainReconciler: { reconcile() {} }, fallbackReconciler: { async start() { calls.push('fallback-start'); }, async stop() {} },
  });
  const started = await host.start();
  assert.equal(started.state, 'ready');
  assert.ok(calls.includes('fallback-start'));
  assert.equal(calls.includes('recover:continue_forward:reuse_existing'), false,
    'workspace-write continue_forward must not run inside start()');
  const fallbackAt = calls.indexOf('fallback-start');
  await host.drainOnce();
  const recoverAt = calls.indexOf('recover:continue_forward:reuse_existing');
  assert.ok(recoverAt > fallbackAt, 'workspace-write continue_forward recover must run after ordinary readiness');
  await host.stop();
});

test('workspace-write rebuild recovery is deferred until after ordinary supply is enabled', async () => {
  const calls = [];
  const host = createExecutionRuntimeHost({
    tickIntervalMs: 60000, maxActionsPerTick: 1, recoveryRetryMs: 10,
    startupRecovery: { async recover() {
      return { state: 'recovering', normalSupplyAllowed: false, findings: [],
        actions: [{ eventId: 'event-remux', effectId: 'effect-remux', decision: 'safe_retry', action: 'rebuild_workspace_output' }] };
    } },
    scheduler: { acquire() { calls.push('ordinary-supply'); return { kind: 'idle' }; }, release() {} },
    plannerRegistry: { resolve() {} }, planPublisher: { publish() {} },
    workLifecycle: { ensurePlanningAttempt() {}, startPlanned() {}, aggregateEvent() {
      return { attemptTerminal: false, workTerminal: false, replayed: false };
    }, settleWork() {} },
    eventRuntime: { async recover(action) { calls.push('recover:' + action.decision + ':' + action.action); return { kind: 'succeeded' }; }, async run() {} },
    domainReconciler: { reconcile() {} }, fallbackReconciler: { async start() { calls.push('fallback-start'); }, async stop() {} },
  });
  const started = await host.start();
  assert.equal(started.state, 'ready');
  assert.equal(calls.includes('recover:safe_retry:rebuild_workspace_output'), false,
    'workspace-write rebuild must not run inside start()');
  await host.drainOnce();
  assert.ok(calls.includes('recover:safe_retry:rebuild_workspace_output'));
  await host.stop();
});

test('a long crash-before-intent recovery does not block ordinary Event supply', async () => {
  let eventAvailable=true;
  let releaseRecovery;
  let recoveryCalls=0;
  let recoveryStarted=false;
  let ordinaryEventStarted=false;
  const recoveryGate=new Promise((resolve)=>{releaseRecovery=resolve;});
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:4,recoveryRetryMs:10,
    startupRecovery:{async recover(){return {state:'recovering',normalSupplyAllowed:false,findings:[],
      actions:[{eventId:'event-long-recovery',decision:'safe_retry_before_intent'}]};}},
    scheduler:{acquire({targetType}){
      if(targetType==='work'||!eventAvailable)return {kind:'idle'};
      eventAvailable=false;
      return {kind:'leased',lease:{targetType:'event',targetId:'event-ordinary',leaseId:'lease-ordinary'}};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {
      attemptTerminal:false,workTerminal:false,replayed:false,
    };},settleWork(){},pendingOwnerReconciliations(){return [];}},
    eventRuntime:{async recover(){recoveryCalls+=1;recoveryStarted=true;await recoveryGate;return {kind:'succeeded'};},
      async run(){ordinaryEventStarted=true;return {kind:'succeeded'};}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();
  const supplyDeadline=Date.now()+1000;
  while((!recoveryStarted||!ordinaryEventStarted)&&Date.now()<supplyDeadline){
    await new Promise((resolve)=>setImmediate(resolve));
  }
  assert.equal(recoveryStarted,true);
  assert.equal(ordinaryEventStarted,true,'ordinary Event must start before the long recovery settles');
  assert.equal(host.activity().inFlightRecoveries,1);
  await host.drainOnce();
  await host.drainOnce();
  assert.equal(recoveryCalls,1,'the same in-flight recovery must not be started twice');
  let stopSettled=false;
  const stopping=host.stop().then((result)=>{stopSettled=true;return result;});
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(stopSettled,false,'stop must wait for an in-flight recovery to settle');
  releaseRecovery();
  assert.equal((await stopping).state,'stopped');
  assert.equal(host.activity().inFlightRecoveries,0);
});

test('a transient recovery invocation failure stays in the safety lane without denying ordinary service supply', async () => {
  const errors=[];
  let recoveryCalls=0;
  let classifications=0;
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:1,recoveryRetryMs:10,
    startupRecovery:{async recover(){return {state:'recovering',normalSupplyAllowed:false,findings:[],
      actions:[{eventId:'event-recovery',effectId:'effect-recovery',decision:'safe_retry'}]};}},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {
      attemptTerminal:false,workTerminal:false,replayed:false,
    };},settleWork(){}},
    eventRuntime:{async classifyRecovery(request){classifications+=1;assert.deepEqual(request,
      {eventId:'event-recovery',effectId:'effect-recovery'});return {
        ...request,decision:'safe_retry',action:'rebuild_workspace_output'};},
      async recover(){recoveryCalls+=1;if(recoveryCalls<=2)throw new Error('provider temporarily unavailable');
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
  assert.equal(classifications,1,'startup recovery failure must refresh its reality classification');
  await new Promise((resolve)=>setTimeout(resolve,15));
  await host.drainOnce();
  assert.equal(recoveryCalls,3);
  assert.equal(classifications,2,'deferred recovery failure must refresh its reality classification again');
  assert.equal(host.activity().deferredRecoveryActions,0);
  await host.stop();
});

test('unobservable file recovery refreshes reality without blocking supply or redispatching stale decisions', async () => {
  let classifications=0,recoveries=0;
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:1,recoveryRetryMs:10,
    startupRecovery:{async recover(){return {state:'recovering',normalSupplyAllowed:false,findings:[],
      actions:[{eventId:'event',effectId:'effect',decision:'observe_again',action:'reobserve_effect'}]};}},
    scheduler:{acquire(){return {kind:'idle'};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){return {
      attemptTerminal:false,workTerminal:false,replayed:false,
    };},settleWork(){}},
    eventRuntime:{async classifyRecovery(request){classifications+=1;return {...request,
      decision:classifications===1?'observe_again':'continue_forward',
      action:classifications===1?'reobserve_effect':'finish_material_commit'};},
      async recover(action){recoveries+=1;
        if(recoveries<3){assert.equal(action.decision,'observe_again');return {kind:'recovery_deferred',eventId:'event',effectId:'effect'};}
        assert.equal(action.decision,'continue_forward');return {kind:'succeeded'};
      },async run(){}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
  });
  try{
    assert.equal((await host.start()).state,'ready');
    await host.drainOnce();
    assert.equal(host.activity().deferredRecoveryActions,1);
    for(let step=0;step<2;step++){await new Promise(resolve=>setTimeout(resolve,15));await host.drainOnce();}
    assert.equal(recoveries,3);
    assert.equal(classifications,2);
    assert.equal(host.activity().deferredRecoveryActions,0);
  }finally{await host.stop();}
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

test('an in-process non-pure dispatch failure is classified and recovered without service restart', async () => {
  let eventAvailable=true;
  let classifications=0;
  let recoveries=0;
  let aggregations=0;
  const errors=[];
  const host=createExecutionRuntimeHost({
    tickIntervalMs:60000,maxActionsPerTick:1,recoveryRetryMs:10,
    startupRecovery:{async recover(){return {state:'ready',normalSupplyAllowed:true,findings:[],actions:[]};}},
    scheduler:{acquire({targetType}){
      if(targetType==='event'&&eventAvailable){eventAvailable=false;return {kind:'leased',lease:{
        targetType:'event',targetId:'event-online-recovery',leaseId:'lease-online-recovery',
      }};}
      return {kind:'idle'};
    },release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(eventId){
      aggregations+=1;assert.equal(eventId,'event-online-recovery');return {
        attemptTerminal:false,workTerminal:false,replayed:false,
      };
    },settleWork(){},pendingOwnerReconciliations(){return [];}},
    eventRuntime:{async run(){return {kind:'effect_recovery_required',eventId:'event-online-recovery',
      effectId:'effect-online-recovery',failureCode:'PLATFORM_INTEGRATION_NETWORK_FAILED',
      failureMessage:'TMDB connection reset'};},async classifyRecovery(request){
      classifications+=1;assert.deepEqual(request,{eventId:'event-online-recovery',effectId:'effect-online-recovery'});
      return {eventId:request.eventId,effectId:request.effectId,decision:'safe_retry',
        action:'rebuild_workspace_output',evidenceDigest:'a'.repeat(64)};
    },async recover(action){recoveries+=1;assert.equal(action.decision,'safe_retry');return {kind:'succeeded'};}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
    onError(error){errors.push(error);},
  });
  await host.start();
  const deadline=Date.now()+1000;
  while(recoveries===0&&Date.now()<deadline)await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(classifications,1);
  assert.equal(recoveries,1);
  assert.equal(aggregations,1,'Event aggregation must occur only after Effect recovery converges');
  assert.equal(errors[0].code,'PLATFORM_INTEGRATION_NETWORK_FAILED');
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
  const deadline=Date.now()+1000;
  while((host.readiness().state!=='ready'||succeeded<1||errors.length<1)&&Date.now()<deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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
  const deadline=Date.now()+1000;
  while((host.readiness().state!=='ready'||succeeded<1||errors.length<1)&&Date.now()<deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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
  const capacityDeadline=Date.now()+1000;
  while(host.activity().inFlightEvents<16&&Date.now()<capacityDeadline){
    await new Promise((resolve)=>setImmediate(resolve));
  }
  assert.equal(host.activity().inFlightEvents,16);
  assert.equal(leased.length,16);
  const stopping=host.stop();
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(leased.length,16,'stop must stop new leasing before awaiting in-flight Events');
  for(const release of gates)release({kind:'succeeded'});
  assert.equal((await stopping).state,'stopped');
  assert.equal(host.activity().inFlightEvents,0);
});


test('shutdown stops dispatch and bounds a pending Event without synthesizing completion',async()=>{
  let release,leased=false,aggregated=0,waitersRemoved=false;
  const pending=new Promise(resolve=>{release=resolve;});
  const host=createExecutionRuntimeHost({shutdownTimeoutMs:20,tickIntervalMs:60000,
    startupRecovery:{async recover(){return {normalSupplyAllowed:true};}},
    scheduler:{acquire({targetType}){if(targetType!=='event'||leased)return {kind:'idle'};leased=true;return {kind:'leased',lease:{targetType:'event',targetId:'event',leaseId:'lease'}};},release(){}},
    plannerRegistry:{resolve(){}},planPublisher:{publish(){}},
    workLifecycle:{ensurePlanningAttempt(){},startPlanned(){},aggregateEvent(){aggregated++;return {};},settleWork(){}},
    eventRuntime:{run(){return pending;},beginShutdown(){waitersRemoved=true;}},
    domainReconciler:{reconcile(){}},fallbackReconciler:{async start(){},async stop(){}},
  });
  await host.start();await host.drainOnce();
  try{
    const stop=host.stop();assert.equal(waitersRemoved,true);
    assert.equal(host.readiness().normalSupplyAllowed,false);
    await assert.rejects(stop,{code:'P4_SHUTDOWN_CHECKPOINT_TIMEOUT'});
    assert.equal(aggregated,0);assert.equal(host.activity().inFlightEvents,1);
    assert.equal((await host.drainOnce()).kind,'inactive');
  }finally{release({kind:'succeeded'});await new Promise(resolve=>setImmediate(resolve));}
});
