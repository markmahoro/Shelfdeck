'use strict';

class ExecutionRuntimeHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExecutionRuntimeHostError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ExecutionRuntimeHostError(code, message, details);
}

function createExecutionRuntimeHost(options) {
  const required = ['startupRecovery', 'scheduler', 'plannerRegistry', 'planPublisher', 'workLifecycle', 'eventRuntime', 'domainReconciler','fallbackReconciler'];
  if (!options || required.some((name) => !options[name]) ||
      typeof options.startupRecovery.recover !== 'function' ||
      typeof options.scheduler.acquire !== 'function' || typeof options.scheduler.release !== 'function' ||
      typeof options.plannerRegistry.resolve !== 'function' || typeof options.planPublisher.publish !== 'function' ||
      typeof options.workLifecycle.ensurePlanningAttempt !== 'function' || typeof options.workLifecycle.startPlanned !== 'function' ||
      typeof options.workLifecycle.aggregateEvent !== 'function' || typeof options.workLifecycle.settleWork !== 'function' ||
      typeof options.eventRuntime.run !== 'function' ||
      typeof options.domainReconciler.reconcile !== 'function'||typeof options.fallbackReconciler.start!=='function'||
      typeof options.fallbackReconciler.stop!=='function') {
    fail('P4_EXECUTION_HOST_DEPENDENCIES_REQUIRED', 'Execution Runtime Host requires the complete Foundation execution rail.');
  }
  const tickIntervalMs = options.tickIntervalMs === undefined ? 100 : options.tickIntervalMs;
  const maxActionsPerTick = options.maxActionsPerTick === undefined ? 16 : options.maxActionsPerTick;
  const maxInFlightEvents = options.maxInFlightEvents === undefined ? 16 : options.maxInFlightEvents;
  const leaseHeartbeatMs = options.leaseHeartbeatMs === undefined ? 1000 : options.leaseHeartbeatMs;
  if (!Number.isSafeInteger(tickIntervalMs) || tickIntervalMs < 10 || tickIntervalMs > 60000 ||
      !Number.isSafeInteger(maxActionsPerTick) || maxActionsPerTick < 1 || maxActionsPerTick > 256 ||
      !Number.isSafeInteger(maxInFlightEvents) || maxInFlightEvents < 1 || maxInFlightEvents > 256 ||
      !Number.isSafeInteger(leaseHeartbeatMs) || leaseHeartbeatMs < 10 || leaseHeartbeatMs > 30000) {
    fail('P4_EXECUTION_HOST_LIMITS_INVALID', 'Execution Runtime Host tick limits are invalid.');
  }
  let state = 'created';
  let timer = null;
  let draining = null;
  let wakeQueued = false;
  let lastRecovery = null;
  let firstFault = null;
  const inFlightEvents = new Map();

  async function reconcileTerminal(aggregation) {
    if (!aggregation?.attemptTerminal || aggregation.replayed) return;
    const disposition = await options.domainReconciler.reconcile(Object.freeze({
      ownerDomain: aggregation.work.owner_domain,
      processType: aggregation.work.process_type,
      processId: aggregation.work.process_id,
      workKind: aggregation.work.work_kind,
      workId: aggregation.work.work_id,
      workState: aggregation.work.state,
      workAttemptId: aggregation.attemptId,
      workAttemptState: aggregation.attemptState,
    }));
    if (disposition) options.workLifecycle.settleWork(disposition);
  }

  async function withWorkLeaseHeartbeat(lease, operation) {
    if (typeof options.scheduler.renew !== 'function') return operation();
    // Renew once before entering the planner.  The default scheduler TTL is
    // deliberately generous for synchronous plan construction, while this
    // heartbeat covers SQLite contention and genuinely asynchronous planners.
    options.scheduler.renew(lease);
    let heartbeatError = null;
    const heartbeat = setInterval(() => {
      if (heartbeatError) return;
      try { options.scheduler.renew(lease); } catch (error) { heartbeatError = error; }
    }, leaseHeartbeatMs);
    heartbeat.unref?.();
    try {
      const result = await operation();
      if (heartbeatError) throw heartbeatError;
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function drainOneWork() {
    const scheduled = options.scheduler.acquire({ targetType: 'work' });
    if (scheduled.kind !== 'leased') return scheduled;
    try {
      return await withWorkLeaseHeartbeat(scheduled.lease, async () => {
        const activation = options.workLifecycle.ensurePlanningAttempt(scheduled.lease.targetId);
        const registration = options.plannerRegistry.resolve(activation.work.owner_domain, activation.work.work_kind);
        const plan = await registration.planner.plan(Object.freeze({
          workId: activation.work.work_id,
          workAttemptId: activation.attempt.attempt_id,
          ownerDomain: activation.work.owner_domain,
          processType: activation.work.process_type,
          processId: activation.work.process_id,
          workKind: activation.work.work_kind,
          executionBasisDigest: activation.work.basis_digest,
          priorityClass: activation.work.priority_class,
          idempotencyKey: activation.work.idempotency_key,
          plannerContractRef: registration.plannerContractRef,
          plannerVersion: registration.plannerVersion,
        }));
        const published = options.planPublisher.publish(plan);
        const started = options.workLifecycle.startPlanned(activation.work.work_id, activation.attempt.attempt_id);
        await reconcileTerminal({ attemptTerminal: ['succeeded', 'failed', 'cancelled'].includes(started.attemptState),
          replayed: started.replayed, attemptId: activation.attempt.attempt_id, attemptState: started.attemptState,
          work: Object.freeze({ ...activation.work, state: started.state }) });
        return Object.freeze({ kind: 'work_planned', workId: activation.work.work_id, attemptId: activation.attempt.attempt_id,
          planId: published.planId, resolution: published.resolution });
      });
    } finally {
      options.scheduler.release(scheduled.lease);
    }
  }

  function drainOneEvent() {
    if(inFlightEvents.size>=maxInFlightEvents)return Object.freeze({kind:'at_capacity',inFlight:inFlightEvents.size});
    const scheduled = options.scheduler.acquire({ targetType: 'event' });
    if (scheduled.kind !== 'leased') return scheduled;
    const eventId=scheduled.lease.targetId;
    let wakeAfterCompletion=false;
    const operation=(async()=>{
      const outcome=await options.eventRuntime.run({schedulerLease:scheduled.lease});
      const aggregation=options.workLifecycle.aggregateEvent(eventId);
      await reconcileTerminal(aggregation);
      wakeAfterCompletion=aggregation.attemptTerminal===true||aggregation.workTerminal===true;
      return Object.freeze({kind:'event_advanced',eventId,outcome,
        attemptTerminal:aggregation.attemptTerminal,workTerminal:aggregation.workTerminal});
    })().catch((error)=>{
      firstFault=firstFault||error;
      state='faulted';
      if(typeof options.onError==='function')options.onError(error);
      return Object.freeze({kind:'event_faulted',eventId,error});
    }).finally(()=>{
      inFlightEvents.delete(eventId);
      if(state==='ready'&&wakeAfterCompletion)wake();
    });
    inFlightEvents.set(eventId,operation);
    return Object.freeze({kind:'event_launched',eventId,inFlight:inFlightEvents.size});
  }

  async function drainOneOwnerReconciliation() {
    if (typeof options.workLifecycle.pendingOwnerReconciliations === 'function') {
      const pending = options.workLifecycle.pendingOwnerReconciliations(1)[0];
      if (pending) {
        await reconcileTerminal({ attemptTerminal:true, replayed:false,
          attemptId:pending.attempt.attempt_id, attemptState:pending.attempt.state, work:pending.work });
        return Object.freeze({ kind:'owner_reconciled', workId:pending.work.work_id });
      }
    }
    return Object.freeze({ kind:'idle' });
  }

  async function drainOnce() {
    if (!['ready', 'draining'].includes(state)) return Object.freeze({ kind: 'inactive', state });
    const work = await drainOneWork();
    const event = drainOneEvent();
    const owner = await drainOneOwnerReconciliation();
    const advanced=work.kind==='work_planned'||event.kind==='event_launched'||owner.kind==='owner_reconciled';
    return Object.freeze({ kind:advanced?'advanced':'idle',
      work, event, owner });
  }

  async function tick() {
    if (draining || state !== 'ready') return draining;
    state = 'draining';
    draining = (async () => {
      try {
        let count = 0;
        let result = Object.freeze({ kind: 'idle' });
        while (count < maxActionsPerTick) {
          result = await drainOnce();
          if (result.kind === 'idle' || result.kind === 'inactive') break;
          count += 1;
        }
        return Object.freeze({ kind: 'tick_complete', actions: count, last: result });
      } finally {
        draining = null;
        if (state === 'draining') state = 'ready';
      }
    })();
    return draining;
  }

  function wake() {
    if (state !== 'ready' || wakeQueued) return Object.freeze({ accepted: false, state });
    wakeQueued = true;
    queueMicrotask(() => {
      wakeQueued = false;
      tick().catch((error) => {
        state = 'faulted';
        if (typeof options.onError === 'function') options.onError(error);
      });
    });
    return Object.freeze({ accepted: true, state });
  }

  return Object.freeze({
    async start() {
      if (state !== 'created') fail('P4_EXECUTION_HOST_LIFECYCLE_CONFLICT', 'Execution Runtime Host can start exactly once.');
      state = 'recovering';
      lastRecovery = await options.startupRecovery.recover();
      if (!lastRecovery || lastRecovery.normalSupplyAllowed !== true) {
        state = 'faulted';
        fail('P4_EXECUTION_HOST_RECOVERY_BLOCKED', 'Startup Recovery did not permit normal Work supply.', { recovery: lastRecovery });
      }
      state = 'ready';
      await options.fallbackReconciler.start();
      timer = setInterval(() => wake(), tickIntervalMs);
      timer.unref?.();
      wake();
      return Object.freeze({ state, normalSupplyAllowed: true, recovery: lastRecovery });
    },
    wake,
    drainOnce,
    readiness() { return Object.freeze({ state, normalSupplyAllowed: state === 'ready', recovery: lastRecovery }); },
    async stop() {
      if (state === 'stopped') return Object.freeze({ state, fault:firstFault });
      state = 'stopping';
      if (timer) clearInterval(timer);
      timer = null;
      wakeQueued = false;
      await options.fallbackReconciler.stop();
      if (draining) await draining;
      if(inFlightEvents.size>0)await Promise.all([...inFlightEvents.values()]);
      state = 'stopped';
      return Object.freeze({ state, fault:firstFault });
    },
    activity(){return Object.freeze({state,inFlightEvents:inFlightEvents.size,maxInFlightEvents,faulted:firstFault!==null});},
  });
}

module.exports = Object.freeze({ ExecutionRuntimeHostError, createExecutionRuntimeHost });
