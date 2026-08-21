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
  const recoveryRetryMs = options.recoveryRetryMs === undefined ? 30000 : options.recoveryRetryMs;
  if (!Number.isSafeInteger(tickIntervalMs) || tickIntervalMs < 10 || tickIntervalMs > 60000 ||
      !Number.isSafeInteger(maxActionsPerTick) || maxActionsPerTick < 1 || maxActionsPerTick > 256 ||
      !Number.isSafeInteger(maxInFlightEvents) || maxInFlightEvents < 1 || maxInFlightEvents > 256 ||
      !Number.isSafeInteger(leaseHeartbeatMs) || leaseHeartbeatMs < 10 || leaseHeartbeatMs > 30000 ||
      !Number.isSafeInteger(recoveryRetryMs) || recoveryRetryMs < 10 || recoveryRetryMs > 300000) {
    fail('P4_EXECUTION_HOST_LIMITS_INVALID', 'Execution Runtime Host tick limits are invalid.');
  }
  let state = 'created';
  let timer = null;
  let draining = null;
  let wakeQueued = false;
  let lastRecovery = null;
  let firstFault = null;
  const inFlightEvents = new Map();
  const deferredRecoveries = new Map();

  async function reconcileTerminal(aggregation) {
    if (!aggregation?.attemptTerminal || aggregation.replayed) return;
    const disposition = await options.domainReconciler.reconcile(Object.freeze({
      reconcilePhase: 'attempt_terminal',
      ownerDomain: aggregation.work.owner_domain,
      processType: aggregation.work.process_type,
      processId: aggregation.work.process_id,
      workKind: aggregation.work.work_kind,
      workId: aggregation.work.work_id,
      workState: aggregation.work.state,
      workAttemptId: aggregation.attemptId,
      workAttemptState: aggregation.attemptState,
      workAttemptFailureCode: aggregation.attemptFailureCode || null,
    }));
    if (!disposition) return;
    const settled = options.workLifecycle.settleWork({...disposition,workAttemptId:aggregation.attemptId});
    if (!['succeeded', 'failed', 'cancelled'].includes(settled.state)) return;
    await options.domainReconciler.reconcile(Object.freeze({
      reconcilePhase: 'work_terminal',
      ownerDomain: aggregation.work.owner_domain,
      processType: aggregation.work.process_type,
      processId: aggregation.work.process_id,
      workKind: aggregation.work.work_kind,
      workId: aggregation.work.work_id,
      workState: settled.state,
      workAttemptId: aggregation.attemptId,
      workAttemptState: aggregation.attemptState,
      workAttemptFailureCode: aggregation.attemptFailureCode || null,
    }));
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
        const definition = activation.work.definition;
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
          workObjectiveTypeRef: definition.workObjectiveTypeRef,
          workObjectiveVersion: definition.workObjectiveVersion,
          executionBasisId: definition.executionBasisId,
          dependencyRefs: definition.dependencyRefs,
          priorityRevision: definition.priorityRevision,
          capabilityCatalogScope: definition.capabilityCatalogScope,
          workspaceMaterialScope: definition.workspaceMaterialScope,
          concurrencyScope: definition.concurrencyScope,
          outputContractRef: definition.outputContractRef,
          approvalOrAuthorizationRef: definition.approvalOrAuthorizationRef || null,
          plannerContractRef: registration.plannerContractRef,
          plannerVersion: registration.plannerVersion,
        }));
        const published = options.planPublisher.publish(plan);
        const started = options.workLifecycle.startPlanned(activation.work.work_id, activation.attempt.attempt_id,
          plan.diagnosticClassification);
        await reconcileTerminal({ attemptTerminal: ['succeeded', 'failed', 'cancelled'].includes(started.attemptState),
          replayed: started.replayed, attemptId: activation.attempt.attempt_id, attemptState: started.attemptState,
          attemptFailureCode: started.attemptFailureCode || null,
          work: Object.freeze({ ...activation.work, state: started.state }) });
        return Object.freeze({ kind: 'work_planned', workId: activation.work.work_id, attemptId: activation.attempt.attempt_id,
          planId: published.planId, resolution: published.resolution });
      });
    } catch (error) {
      // Planner or Work reconcile failure stays Work-local. Runtime Host fault is reserved for global invariants.
      if (typeof options.onError === 'function') options.onError(error);
      return Object.freeze({ kind: 'work_faulted', workId: scheduled.lease.targetId, error });
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
      if(outcome?.kind==='input_failed'&&outcome.failureCode!=='P8_ACCEPTANCE_CONTINUITY_BASIS_STALE'&&typeof options.onError==='function'){
        options.onError(new ExecutionRuntimeHostError(
          outcome.failureCode||'P4_EVENT_INPUT_PREPARATION_FAILED',
          'Event input preparation failed before Capability dispatch: ' +
            (outcome.failureMessage || outcome.failureCode || 'unknown input failure') + '.',
          {eventId, failureMessage:outcome.failureMessage || null}
        ));
      }
      const aggregation=options.workLifecycle.aggregateEvent(eventId);
      await reconcileTerminal(aggregation);
      wakeAfterCompletion=aggregation.attemptTerminal===true||aggregation.workTerminal===true;
      return Object.freeze({kind:'event_advanced',eventId,outcome,
        attemptTerminal:aggregation.attemptTerminal,workTerminal:aggregation.workTerminal});
    })().catch((error)=>{
      // Executor crash stays Event-local; effect-specific recovery owns the executing Attempt.
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
        try {
          await reconcileTerminal({ attemptTerminal:true, replayed:false,
            attemptId:pending.attempt.attempt_id, attemptState:pending.attempt.state,
            attemptFailureCode:pending.attempt.failure_code||null, work:pending.work });
          return Object.freeze({ kind:'owner_reconciled', workId:pending.work.work_id });
        } catch (error) {
          if (typeof options.onError === 'function') options.onError(error);
          return Object.freeze({ kind:'owner_faulted', workId:pending.work.work_id, error });
        }
      }
    }
    return Object.freeze({ kind:'idle' });
  }

  async function drainOneDeferredRecovery() {
    const current = Date.now();
    const pending = [...deferredRecoveries.values()]
      .sort((left, right) => left.retryAtMs - right.retryAtMs || left.action.eventId.localeCompare(right.action.eventId))
      .find((item) => item.retryAtMs <= current);
    if (!pending) return Object.freeze({ kind:'idle' });
    pending.retryAtMs = current + recoveryRetryMs;
    try {
      const recovered = await options.eventRuntime.recover(pending.action);
      if (!recovered || recovered.kind === 'recovery_deferred') return Object.freeze({
        kind:'recovery_deferred', eventId:pending.action.eventId,
      });
      deferredRecoveries.delete(pending.action.eventId);
      const aggregation = options.workLifecycle.aggregateEvent(pending.action.eventId);
      await reconcileTerminal(aggregation);
      return Object.freeze({ kind:'recovery_advanced', eventId:pending.action.eventId });
    } catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      return Object.freeze({ kind:'recovery_deferred', eventId:pending.action.eventId, error });
    }
  }

  async function drainOnce() {
    if (!['ready', 'draining'].includes(state)) return Object.freeze({ kind: 'inactive', state });
    let recovery; let work; let event; let owner;
    try { recovery = await drainOneDeferredRecovery(); }
    catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      recovery = Object.freeze({ kind:'recovery_deferred', error });
    }
    try { work = await drainOneWork(); }
    catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      work = Object.freeze({ kind: 'work_faulted', error });
    }
    try { event = drainOneEvent(); }
    catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      event = Object.freeze({ kind: 'event_faulted', error });
    }
    try { owner = await drainOneOwnerReconciliation(); }
    catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      owner = Object.freeze({ kind: 'owner_faulted', error });
    }
    const advanced=recovery.kind==='recovery_advanced'||work.kind==='work_planned'||event.kind==='event_launched'||owner.kind==='owner_reconciled';
    return Object.freeze({ kind:advanced?'advanced':'idle',
      recovery, work, event, owner });
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
      let recoveryPass = 0;
      while (lastRecovery && lastRecovery.findings?.length === 0 && lastRecovery.actions?.length > 0) {
        if (typeof options.eventRuntime.recover !== 'function' || recoveryPass++ >= 100) fail(
          'P4_EXECUTION_HOST_RECOVERY_ACTION_BLOCKED', 'Startup recovery actions did not converge within the bounded recovery sweep.',
          { recovery: lastRecovery, recoveryPass }
        );
        let deferred = false;
        for (const action of lastRecovery.actions) {
          // Crash-before-intent recovery may re-dispatch a hours-long
          // workspace write. Do that in the ordinary drain lane after
          // readiness, not inside start().
          if (action.decision === 'safe_retry_before_intent') {
            deferredRecoveries.set(action.eventId, { action, retryAtMs: Date.now() });
            deferred = true;
            continue;
          }
          try {
            const recovered = await options.eventRuntime.recover(action);
            if (!recovered || recovered.kind === 'recovery_deferred') {
              deferredRecoveries.set(action.eventId, { action, retryAtMs:Date.now() + recoveryRetryMs });
              deferred = true;
              continue;
            }
            const aggregation = options.workLifecycle.aggregateEvent(action.eventId);
            await reconcileTerminal(aggregation);
          } catch (error) {
            deferredRecoveries.set(action.eventId, { action, retryAtMs:Date.now() + recoveryRetryMs });
            deferred = true;
            if (typeof options.onError === 'function') options.onError(error);
          }
        }
        if (deferred) {
          lastRecovery = Object.freeze({ ...lastRecovery, normalSupplyAllowed:true,
            deferredRecoveryActions:deferredRecoveries.size });
          break;
        }
        lastRecovery = await options.startupRecovery.recover();
      }
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
    activity(){return Object.freeze({state,inFlightEvents:inFlightEvents.size,maxInFlightEvents,
      deferredRecoveryActions:deferredRecoveries.size,faulted:firstFault!==null});},
  });
}

module.exports = Object.freeze({ ExecutionRuntimeHostError, createExecutionRuntimeHost });
