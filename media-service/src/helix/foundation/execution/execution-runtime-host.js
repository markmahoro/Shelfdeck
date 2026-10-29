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

function withRecoveryContext(error, eventId, effectId) {
  if (!error || typeof error !== 'object') return error;
  try {
    return Object.assign(error, { details: { ...(error.details || {}), eventId: eventId || null, effectId: effectId || null } });
  } catch {
    return error;
  }
}

function deferRecoveryUntilReady(action) {
  if (!action || typeof action.decision !== 'string') return false;
  if (action.decision === 'safe_retry_before_intent') return true;
  if (action.decision === 'observe_again') return true;
  if (action.decision === 'continue_forward' && action.action === 'reuse_existing') return true;
  if (action.decision === 'safe_retry' &&
      (action.action === 'rebuild_workspace_output' || action.action === 'cleanup_then_rebuild')) {
    return true;
  }
  return false;
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
      (options.workDispatchGuard && (typeof options.workDispatchGuard.check !== 'function' ||
        typeof options.scheduler.noteDispatchOutcome !== 'function')) ||
      (options.incidentObserver && typeof options.incidentObserver.observeTerminalWork !== 'function') ||
      typeof options.domainReconciler.reconcile !== 'function'||typeof options.fallbackReconciler.start!=='function'||
      typeof options.fallbackReconciler.stop!=='function') {
    fail('P4_EXECUTION_HOST_DEPENDENCIES_REQUIRED', 'Execution Runtime Host requires the complete Foundation execution rail.');
  }
  const tickIntervalMs = options.tickIntervalMs === undefined ? 100 : options.tickIntervalMs;
  const maxIdlePollMs = options.maxIdlePollMs === undefined ? Math.max(1000, tickIntervalMs) : options.maxIdlePollMs;
  const maxActionsPerTick = options.maxActionsPerTick === undefined ? 16 : options.maxActionsPerTick;
  const maxInFlightEvents = options.maxInFlightEvents === undefined ? 16 : options.maxInFlightEvents;
  const leaseHeartbeatMs = options.leaseHeartbeatMs === undefined ? 1000 : options.leaseHeartbeatMs;
  const recoveryRetryMs = options.recoveryRetryMs === undefined ? 30000 : options.recoveryRetryMs;
  if (!Number.isSafeInteger(tickIntervalMs) || tickIntervalMs < 10 || tickIntervalMs > 60000 ||
      !Number.isSafeInteger(maxIdlePollMs) || maxIdlePollMs < tickIntervalMs || maxIdlePollMs > 60000 ||
      !Number.isSafeInteger(maxActionsPerTick) || maxActionsPerTick < 1 || maxActionsPerTick > 256 ||
      !Number.isSafeInteger(maxInFlightEvents) || maxInFlightEvents < 1 || maxInFlightEvents > 256 ||
      !Number.isSafeInteger(leaseHeartbeatMs) || leaseHeartbeatMs < 10 || leaseHeartbeatMs > 30000 ||
      !Number.isSafeInteger(recoveryRetryMs) || recoveryRetryMs < 10 || recoveryRetryMs > 300000) {
    fail('P4_EXECUTION_HOST_LIMITS_INVALID', 'Execution Runtime Host tick limits are invalid.');
  }
  const shutdownTimeoutMs=options.shutdownTimeoutMs===undefined?60000:options.shutdownTimeoutMs;
  if(!Number.isSafeInteger(shutdownTimeoutMs)||shutdownTimeoutMs<1||shutdownTimeoutMs>60000)
    fail('P4_SHUTDOWN_BUDGET_INVALID','Shutdown checkpoint budget must be within 60 seconds.');
  let stopping=null;
  let quiescing=null;
  let starting=null;
  let state = 'created';
  let timer = null;
  let draining = null;
  let wakeQueued = false;
  let idlePollMs = tickIntervalMs;
  let lastRecovery = null;
  let firstFault = null;
  const inFlightEvents = new Map();
  let inFlightPlanning = 0;
  const inFlightRecoveries = new Map();
  const deferredRecoveries = new Map();
  const completionRetries = new Map();
  const inFlightOwnerReconciliations = new Map();

  async function reconcileTerminal(aggregation) {
    if (!aggregation?.attemptTerminal || aggregation.replayed) return;
    const key = JSON.stringify([aggregation.work.work_id, aggregation.attemptId]);
    if (inFlightOwnerReconciliations.has(key)) return inFlightOwnerReconciliations.get(key);
    const operation = Promise.resolve().then(() => reconcileOwnerTerminal(aggregation));
    inFlightOwnerReconciliations.set(key, operation);
    try { return await operation; }
    finally { inFlightOwnerReconciliations.delete(key); }
  }

  async function reconcileOwnerTerminal(aggregation) {
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
    const incidentObservation=options.incidentObserver&&['succeeded','failed','cancelled'].includes(settled.state)
      ?options.incidentObserver.observeTerminalWork(Object.freeze({ownerDomain:aggregation.work.owner_domain,
        processType:aggregation.work.process_type,processId:aggregation.work.process_id,workKind:aggregation.work.work_kind,
        workId:aggregation.work.work_id,workAttemptId:aggregation.attemptId,workAttemptFailureCode:aggregation.attemptFailureCode||null,
        workState:settled.state}))
      :null;
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
      incidentRefs: incidentObservation?.incidentRefs||Object.freeze([]),
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
    inFlightPlanning++;
    let finishScope;
    try {
      finishScope = options.onExecutionScopeStarted?.(scheduled.executionScope);
      return await withWorkLeaseHeartbeat(scheduled.lease, async () => {
        const scope=scheduled.executionScope;
        if(options.workDispatchGuard&&(!scope||['ownerDomain','processType','processId','workKind'].some(key=>typeof scope[key]!=='string'||!scope[key])||
            !/^[a-f0-9]{64}$/.test(scope.executionBasisDigest||'')))
          fail('P4_WORK_OWNER_GUARD_INVALID','Owner Work scope must be exact.');
        const expectedScope=options.workDispatchGuard?Object.freeze({ownerDomain:scope.ownerDomain,processType:scope.processType,
          processId:scope.processId,workKind:scope.workKind,executionBasisDigest:scope.executionBasisDigest}):null;
        function checkOwner(){
          if(!options.workDispatchGuard)return {kind:'not_applicable',readFence:null};
          let decision;
          try{decision=options.workDispatchGuard.check(Object.freeze({...expectedScope,workId:scheduled.lease.targetId}));}
          catch(error){if(error?.code==='P3_UOW_READ_FENCE_CHANGED')return {kind:'pending',reasonCode:'owner_view_changed'};throw error;}
          if(!decision||typeof decision!=='object'||Array.isArray(decision)||!['ready','pending','not_applicable'].includes(decision.kind))
            fail('P4_WORK_OWNER_GUARD_INVALID','Owner Work guard returned an invalid decision.');
          const keys=Object.keys(decision).sort().join(',');
          if(decision.kind==='pending'){
            if(keys!=='kind,reasonCode'||typeof decision.reasonCode!=='string'||!/^[-a-zA-Z0-9_.]{1,128}$/.test(decision.reasonCode))
              fail('P4_WORK_OWNER_GUARD_INVALID','Owner Work deferral requires a bounded reason.');
            return decision;
          }
          if(decision.kind==='ready'){
            if(keys!=='kind,readFence'||!decision.readFence||typeof decision.readFence!=='object'||Array.isArray(decision.readFence))
              fail('P4_WORK_OWNER_GUARD_INVALID','Ready Owner Work requires an opaque read fence.');
            return decision;
          }
          if(keys!=='kind')fail('P4_WORK_OWNER_GUARD_INVALID','Unscoped Owner Work must be explicit.');
          return {kind:'not_applicable',readFence:null};
        }
        function ownerWait(reasonCode){
          options.scheduler.noteDispatchOutcome(scheduled.lease,Object.freeze({kind:'owner_wait'}));
          return Object.freeze({kind:'work_owner_deferred',workId:scheduled.lease.targetId,reasonCode});
        }
        function guardedWrite(decision,write){
          if(decision.kind==='pending')return {deferred:true,result:ownerWait(decision.reasonCode)};
          try{return {deferred:false,result:write(decision.readFence)};}
          catch(error){
            if(decision.readFence&&error?.code==='P3_UOW_READ_FENCE_CHANGED')
              return {deferred:true,result:ownerWait('owner_view_changed')};
            throw error;
          }
        }
        const admission=guardedWrite(checkOwner(),readFence=>options.workDispatchGuard
          ?options.workLifecycle.ensurePlanningAttempt(scheduled.lease.targetId,{readFence,expectedScope})
          :options.workLifecycle.ensurePlanningAttempt(scheduled.lease.targetId));
        if(admission.deferred)return admission.result;
        const activation=admission.result,planningView=checkOwner();
        if(planningView.kind==='pending')return ownerWait(planningView.reasonCode);
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
        const publication=guardedWrite(planningView,readFence=>readFence
          ?options.planPublisher.publish(plan,{readFence}):options.planPublisher.publish(plan));
        if(publication.deferred)return publication.result;
        const published=publication.result,start=guardedWrite(checkOwner(),readFence=>readFence
          ?options.workLifecycle.startPlanned(activation.work.work_id,activation.attempt.attempt_id,plan.diagnosticClassification,{readFence})
          :options.workLifecycle.startPlanned(activation.work.work_id,activation.attempt.attempt_id,plan.diagnosticClassification));
        if(start.deferred)return start.result;
        const started=start.result;
        if(options.workDispatchGuard)options.scheduler.noteDispatchOutcome(scheduled.lease,Object.freeze({kind:'started'}));
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
      inFlightPlanning--;
        try { finishScope?.(); } finally { options.scheduler.release(scheduled.lease); }
    }
  }

  function drainOneEvent() {
    if(inFlightEvents.size>=maxInFlightEvents)return Object.freeze({kind:'at_capacity',inFlight:inFlightEvents.size});
    const scheduled = options.scheduler.acquire({ targetType: 'event' });
    if (scheduled.kind !== 'leased') return scheduled;
    const eventId=scheduled.lease.targetId;
    let wakeAfterCompletion=false,finishScope;
    const operation=(async()=>{
      finishScope=options.onExecutionScopeStarted?.(scheduled.executionScope);
      const outcome=await options.eventRuntime.run({schedulerLease:scheduled.lease});
      if(outcome?.kind==='owner_deferred')return Object.freeze({kind:'event_owner_deferred',eventId,outcome});
      if(outcome?.kind==='effect_recovery_required'){
        deferredRecoveries.set(eventId,{
          eventId,effectId:outcome.effectId,action:null,retryAtMs:Date.now(),
        });
        wakeAfterCompletion=true;
        if(typeof options.onError==='function')options.onError(new ExecutionRuntimeHostError(
          outcome.failureCode||'P4_EVENT_EFFECT_RECOVERY_REQUIRED',
          outcome.failureMessage||'Non-pure Event execution requires exact Effect recovery.',
          {eventId,effectId:outcome.effectId}
        ));
        return Object.freeze({kind:'event_recovery_queued',eventId,outcome});
      }
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
    })().catch(async(error)=>{
      // Event Runtime retains the exact successful Outcome when an Effect
      // committed immediately before Result binding failed. Retry only that
      // completion capsule; never re-dispatch the physical Capability here.
      if(typeof options.onError==='function')options.onError(error);
      if(typeof options.eventRuntime.retryPendingCompletion==='function'){
        try{
          const retried=options.eventRuntime.retryPendingCompletion(eventId);
          if(retried?.kind!=='no_pending_completion'){
            const aggregation=options.workLifecycle.aggregateEvent(eventId);
            await reconcileTerminal(aggregation);
            wakeAfterCompletion=true;
          }
        }catch(completionError){
          completionRetries.set(eventId,{eventId,retryAtMs:Date.now()+recoveryRetryMs});
          if(typeof options.onError==='function')options.onError(completionError);
          wakeAfterCompletion=true;
        }
      }
      return Object.freeze({kind:'event_faulted',eventId,error});
    }).finally(()=>{
        try { finishScope?.(); } finally {
          inFlightEvents.delete(eventId);
          if(wakeAfterCompletion&&['ready','draining'].includes(state))wake();
        }
    });
    inFlightEvents.set(eventId,operation);
    return Object.freeze({kind:'event_launched',eventId,inFlight:inFlightEvents.size});
  }

  async function drainOneOwnerReconciliation() {
    if (typeof options.workLifecycle.pendingTerminalEventAggregations === 'function') {
      const pending = options.workLifecycle.pendingTerminalEventAggregations(1)[0];
      if (pending) {
        try {
          const aggregation = options.workLifecycle.aggregateEvent(pending.eventId);
          await reconcileTerminal(aggregation);
          return Object.freeze({ kind:'terminal_event_aggregated', workId:pending.workId, eventId:pending.eventId });
        } catch (error) {
          if (typeof options.onError === 'function') options.onError(error);
          return Object.freeze({ kind:'terminal_event_aggregation_faulted', workId:pending.workId,
            eventId:pending.eventId, error });
        }
      }
    }
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

  function drainOneDeferredRecovery() {
    if (inFlightRecoveries.size >= maxInFlightEvents) return Object.freeze({
      kind:'at_capacity', lane:'recovery', inFlight:inFlightRecoveries.size,
    });
    const current = Date.now();
    const completion=[...completionRetries.values()]
      .sort((left,right)=>left.retryAtMs-right.retryAtMs||left.eventId.localeCompare(right.eventId))
      .find((item)=>item.retryAtMs<=current&&!inFlightRecoveries.has(item.eventId));
    if(completion){
      completion.retryAtMs=current+recoveryRetryMs;
      const operation=(async()=>{
        const recovered=options.eventRuntime.retryPendingCompletion(completion.eventId);
        if(!recovered||recovered.kind==='no_pending_completion')return Object.freeze({kind:'recovery_deferred',eventId:completion.eventId});
        completionRetries.delete(completion.eventId);
        const aggregation=options.workLifecycle.aggregateEvent(completion.eventId);
        await reconcileTerminal(aggregation);
        return Object.freeze({kind:'recovery_advanced',eventId:completion.eventId});
      })().catch((error)=>{
        if(typeof options.onError==='function')options.onError(error);
        return Object.freeze({kind:'recovery_deferred',eventId:completion.eventId,error});
      }).finally(()=>{
        inFlightRecoveries.delete(completion.eventId);
        if(['ready','draining'].includes(state))wake();
      });
      inFlightRecoveries.set(completion.eventId,operation);
      return Object.freeze({kind:'recovery_launched',eventId:completion.eventId,inFlight:inFlightRecoveries.size});
    }
    const pending = [...deferredRecoveries.values()]
      .sort((left, right) => left.retryAtMs - right.retryAtMs ||
        (left.action?.eventId||left.eventId).localeCompare(right.action?.eventId||right.eventId))
      .find((item) => item.retryAtMs <= current&&
        !inFlightRecoveries.has(item.action?.eventId||item.eventId));
    if (!pending) return Object.freeze({ kind:'idle' });
    pending.retryAtMs = current + recoveryRetryMs;
    const pendingEventId=pending.action?.eventId||pending.eventId;
    const operation=(async()=>{
      if(!pending.action){
        if(typeof options.eventRuntime.classifyRecovery!=='function')fail(
          'P4_EXECUTION_HOST_RECOVERY_CLASSIFIER_UNAVAILABLE',
          'An online Effect recovery item requires exact reality classification.'
        );
        pending.action=await options.eventRuntime.classifyRecovery({
          eventId:pending.eventId,effectId:pending.effectId,
        });
      }
      const recovered = await options.eventRuntime.recover(pending.action);
      if (!recovered || recovered.kind === 'recovery_deferred') {
        const eventId=pending.action.eventId;
        if(pending.effectId)pending.action=null;
        return Object.freeze({kind:'recovery_deferred',eventId});
      }
      deferredRecoveries.delete(pending.action.eventId);
      const aggregation = options.workLifecycle.aggregateEvent(pending.action.eventId);
      await reconcileTerminal(aggregation);
      return Object.freeze({ kind:'recovery_advanced', eventId:pending.action.eventId });
    })().catch((error)=>{
      // A failed non-pure recovery may have changed physical reality before it
      // threw. Never replay a cached decision; observe the exact Effect again.
      if (pending.effectId) pending.action=null;
      if (typeof options.onError === 'function') options.onError(withRecoveryContext(error,
        pendingEventId, pending.effectId));
      return Object.freeze({ kind:'recovery_deferred', eventId:pendingEventId, error });
    }).finally(()=>{
      inFlightRecoveries.delete(pendingEventId);
      if(['ready','draining'].includes(state))wake();
    });
    inFlightRecoveries.set(pendingEventId,operation);
    return Object.freeze({kind:'recovery_launched',eventId:pendingEventId,inFlight:inFlightRecoveries.size});
  }

  async function drainOnce() {
    if (!['ready', 'draining'].includes(state)) return Object.freeze({ kind: 'inactive', state });
    let recovery; let work; let event; let owner;
    try { recovery = drainOneDeferredRecovery(); }
    catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      recovery = Object.freeze({ kind:'recovery_deferred', error });
    }
    try { work = await drainOneWork(); }
    catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
      work = Object.freeze({ kind: 'work_faulted', error });
    }
    if (!['ready','draining'].includes(state)) return Object.freeze({kind:'inactive',state});
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
    const advanced=recovery.kind==='recovery_launched'||['work_planned','work_owner_deferred'].includes(work.kind)||event.kind==='event_launched'||
      ['owner_reconciled','terminal_event_aggregated'].includes(owner.kind);
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
          // A large ready graph can complete synchronously and immediately
          // wake the next drain. Give HTTP and operational timers a poll
          // opportunity before another batch monopolizes the Node thread.
          await new Promise((resolve) => setImmediate(resolve));
        }
        return Object.freeze({ kind: 'tick_complete', actions: count, last: result });
      } finally {
        draining = null;
        if (state === 'draining') state = 'ready';
      }
    })();
    return draining;
  }

  function nextIdlePoll(current) {
    if (current >= maxIdlePollMs) return maxIdlePollMs;
    const multiplier = current === tickIntervalMs ? 2.5 : 2;
    return Math.min(maxIdlePollMs, Math.max(current + 1, Math.ceil(current * multiplier)));
  }

  function scheduleFallbackPoll() {
    if (state !== 'ready' || timer) return;
    const delay = idlePollMs;
    idlePollMs = nextIdlePoll(idlePollMs);
    timer = setTimeout(() => {
      timer = null;
      queueTick(false);
    }, delay);
    timer.unref?.();
  }

  function queueTick(resetIdlePoll) {
    if (resetIdlePoll) {
      idlePollMs = tickIntervalMs;
      if (timer) clearTimeout(timer);
      timer = null;
    }
    if (state === 'draining') {
      wakeQueued = true;
      return Object.freeze({ accepted:true, state });
    }
    if (state !== 'ready' || wakeQueued) return Object.freeze({ accepted: false, state });
    wakeQueued = true;
    setImmediate(() => {
      wakeQueued = false;
      tick().then((result) => {
        if (state !== 'ready') return;
        const pendingWake = wakeQueued;
        if (pendingWake) wakeQueued = false;
        if (pendingWake) {
          queueTick(false);
          return;
        }
        if (result.actions > 0) idlePollMs = tickIntervalMs;
        scheduleFallbackPoll();
      }).catch((error) => {
          state = 'faulted';
          if (typeof options.onError === 'function') options.onError(error);
        });
    });
    return Object.freeze({ accepted: true, state });
  }

  function wake() { return queueTick(true); }

  return Object.freeze({
    async start(request = {}) {
      if (!['created','quiesced'].includes(state)) fail('P4_EXECUTION_HOST_LIFECYCLE_CONFLICT', 'Execution Runtime Host must be created or quiesced before recovery.');
      quiescing = null;
      deferredRecoveries.clear();
      completionRetries.clear();
      state = 'recovering';
      const requireRecovery=()=>{if(state!=='recovering')fail('P4_STARTUP_INTERRUPTED','Runtime recovery was interrupted by shutdown.');};
      starting=(async()=>{
      lastRecovery = await options.startupRecovery.recover();
      requireRecovery();
      if (request.quiesced === true) {
        state = 'quiesced';
        return Object.freeze({ state, normalSupplyAllowed:false, recovery:lastRecovery });
      }
      let recoveryPass = 0;
      while (lastRecovery && lastRecovery.findings?.length === 0 &&
          ((lastRecovery.actions?.length || 0) > 0 || (lastRecovery.workAttemptRepairs?.length || 0) > 0)) {
        requireRecovery();
        if (recoveryPass++ >= 100) fail(
          'P4_EXECUTION_HOST_RECOVERY_ACTION_BLOCKED', 'Startup recovery actions did not converge within the bounded recovery sweep.',
          { recovery: lastRecovery, recoveryPass }
        );
        if ((lastRecovery.workAttemptRepairs?.length || 0) > 0) {
          if (typeof options.workLifecycle.repairCancelledWorkAttempt !== 'function') fail(
            'P4_EXECUTION_HOST_WORK_ATTEMPT_REPAIR_UNAVAILABLE',
            'Startup Recovery classified a cancelled Work Attempt repair without its lifecycle authority.'
          );
          for (const repair of lastRecovery.workAttemptRepairs) {
            options.workLifecycle.repairCancelledWorkAttempt(repair);
          }
          lastRecovery = await options.startupRecovery.recover();
          continue;
        }
        if (typeof options.eventRuntime.recover !== 'function') fail(
          'P4_EXECUTION_HOST_RECOVERY_ACTION_BLOCKED', 'Event recovery authority is unavailable.',
          { recovery:lastRecovery, recoveryPass }
        );
        let deferred = false;
        for (const action of lastRecovery.actions) {
          requireRecovery();
          // Hours-long workspace writes (remux/transcode) must not run inside
          // start(); HTTP listen waits on start(). Recover them in the ordinary
          // drain lane after readiness.
          if (deferRecoveryUntilReady(action)) {
            deferredRecoveries.set(action.eventId, { eventId:action.eventId,
              effectId:action.effectId||null, action, retryAtMs: Date.now() });
            deferred = true;
            continue;
          }
          try {
            const recovered = await options.eventRuntime.recover(action);
            if (!recovered || recovered.kind === 'recovery_deferred') {
              deferredRecoveries.set(action.eventId, { eventId:action.eventId,
                effectId:action.effectId||null, action, retryAtMs:Date.now() + recoveryRetryMs });
              deferred = true;
              continue;
            }
            const aggregation = options.workLifecycle.aggregateEvent(action.eventId);
            await reconcileTerminal(aggregation);
          } catch (error) {
            deferredRecoveries.set(action.eventId, { eventId:action.eventId,
              effectId:action.effectId||null, action:action.effectId?null:action,
              retryAtMs:Date.now() + recoveryRetryMs });
            deferred = true;
            if (typeof options.onError === 'function') options.onError(withRecoveryContext(error, action.eventId, action.effectId));
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
        fail('P4_EXECUTION_HOST_RECOVERY_BLOCKED', 'Startup Recovery did not permit normal Work supply.', {
          recoveryState: lastRecovery?.state,
          findings: [...(lastRecovery?.findings || [])],
          recovery: lastRecovery,
        });
      }
      requireRecovery();
      options.incidentObserver?.reconcileRecoveryReservations?.();
      state = 'ready';
      firstFault = null;
      await options.fallbackReconciler.start();
      // Owner startup may wake ordinary dispatch after the Recovery Gate opens.
      if(!['ready','draining'].includes(state))fail('P4_STARTUP_INTERRUPTED','Runtime startup was interrupted by shutdown.');
      wake();
      return Object.freeze({ state, normalSupplyAllowed: true, recovery: lastRecovery });
      })();
      try{return await starting;}catch(error){if(state==='recovering'||state==='ready')state='faulted';throw error;}finally{starting=null;}
    },
    wake,
    drainOnce,
    readiness() { return Object.freeze({ state, normalSupplyAllowed: state === 'ready', recovery: lastRecovery }); },
    backgroundOperations(){return options.fallbackReconciler.snapshot();},
    wakeBackground(request){if(typeof options.fallbackReconciler.wake!=='function')fail('P4_BACKGROUND_WAKE_UNAVAILABLE','Background reconciler does not support scoped wake.');return options.fallbackReconciler.wake(request);},
    quiesce() {
      if (quiescing) return quiescing;
      if (state === 'quiesced') return Promise.resolve(Object.freeze({state}));
      if (!['ready','draining','faulted'].includes(state)) fail('P4_QUIESCE_STATE_INVALID', 'Execution Runtime must be active before quiescing.');
      state = 'quiescing';
      if (timer) clearTimeout(timer);
      timer = null;
      wakeQueued = false;
      options.eventRuntime.beginShutdown?.();
      quiescing = (async () => {
        await options.fallbackReconciler.stop();
        if (draining) await draining;
        // Event completion may launch its Owner closure. Observe until all lanes are empty.
        while (inFlightEvents.size || inFlightRecoveries.size || inFlightOwnerReconciliations.size) {
          await Promise.all([...inFlightEvents.values(), ...inFlightRecoveries.values(), ...inFlightOwnerReconciliations.values()]);
        }
        state = 'quiesced';
        return Object.freeze({state});
      })().catch((error) => { quiescing=null;state='faulted';throw error; });
      return quiescing;
    },
    stop() {
      if(stopping)return stopping;
      if (state === 'stopped') return Promise.resolve(Object.freeze({ state, fault:firstFault }));
      state = 'stopping';
      if (timer) clearTimeout(timer);
      timer = null;
      wakeQueued = false;
      options.eventRuntime.beginShutdown?.();
      let deadlineTimer;
      const drain=(async()=>{
        if(starting)await starting.catch(()=>{});
        if (quiescing) await quiescing;
        await options.fallbackReconciler.stop();
        if(draining)await draining;
        await Promise.all([...inFlightEvents.values(),...inFlightRecoveries.values(),...inFlightOwnerReconciliations.values()]);
        state='stopped';
        return Object.freeze({state,fault:firstFault});
      })();
      const deadline=new Promise((_,reject)=>{deadlineTimer=setTimeout(()=>reject(new ExecutionRuntimeHostError(
        'P4_SHUTDOWN_CHECKPOINT_TIMEOUT','Shutdown checkpoint budget expired; durable execution remains recoverable.',
        {shutdownTimeoutMs,inFlightEvents:inFlightEvents.size,inFlightRecoveries:inFlightRecoveries.size})),shutdownTimeoutMs);});
      stopping=Promise.race([drain,deadline]).finally(()=>clearTimeout(deadlineTimer));
      return stopping;
    },
    activity(){return Object.freeze({state,inFlightEvents:inFlightEvents.size,inFlightPlanning,inFlightRecoveries:inFlightRecoveries.size,maxInFlightEvents,
      inFlightOwnerReconciliations:inFlightOwnerReconciliations.size,
      deferredRecoveryActions:deferredRecoveries.size+completionRetries.size,faulted:firstFault!==null});},
  });
}

module.exports = Object.freeze({ ExecutionRuntimeHostError, createExecutionRuntimeHost });
