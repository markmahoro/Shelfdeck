'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { PRIORITY_CLASSES } = require('./runtime-contracts');

const TERMINAL_EVENT_STATES = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);
const WORK_STATES = new Set(['admitted', 'ready']);
const AGING_INTERVAL_MS = 60000;
const MINIMUM_BACKGROUND_RETRY_MS = 100;
// Planning is allowed to build a bounded immutable plan from durable facts.  A
// five-second technical lease is shorter than a legitimate plan construction
// (especially when SQLite is briefly contended), so the default must cover the
// whole planning critical section.  Long-running callers can still renew the
// lease; this is only the safe default, not a work-duration contract.
const DEFAULT_LEASE_TTL_MS = 60000;

class WorkSchedulerError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'WorkSchedulerError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new WorkSchedulerError(code, message, details); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function exactRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['targetType']) ||
      !['work', 'event'].includes(request.targetType)) {
    fail('P4_SCHEDULER_REQUEST_INVALID', 'Scheduler request must contain only an exact target type.');
  }
}

function repositories(schemaManifest) {
  return Object.freeze({
    works: createRepositoryDefinition({ repositoryId: 'scheduler_works', owner: 'execution-foundation', schemaManifest, statements: {
      list_by_states: { kind: 'select-in', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'priority_class', 'state', 'created_at_ms'
      ], keyColumn:'state', maxItems:4 },
      list_by_ids: { kind: 'select-in', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'priority_class', 'state', 'created_at_ms'
      ], keyColumn:'work_id', maxItems:500 }
    } }),
    events: createRepositoryDefinition({ repositoryId: 'scheduler_events', owner: 'execution-foundation', schemaManifest, statements: {
      list_by_states: { kind: 'select-in', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'work_id', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms'
      ], keyColumn:'state', maxItems:4 },
      list_by_plans: { kind: 'select-in', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'work_id', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms'
      ], keyColumn:'plan_id', maxItems:500 }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'scheduler_edges', owner: 'execution-foundation', schemaManifest, statements: {
      list_by_plans: { kind: 'select-in', tableId: 'fx_plan_edges', columns: [
        'plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'
      ], keyColumn:'plan_id', maxItems:500 }
    } })
  });
}

function boundedChunks(values, maximum = 500) {
  const chunks = [];
  for (let index = 0; index < values.length; index += maximum) {
    chunks.push(values.slice(index, index + maximum));
  }
  return chunks;
}

function assertProjection(projection, work) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection) ||
      JSON.stringify(Object.keys(projection).sort()) !== JSON.stringify(['localPriority', 'priorityClass', 'priorityRevision', 'supplyRole']) ||
      !PRIORITY_CLASSES.includes(projection.priorityClass) || !Number.isSafeInteger(projection.localPriority) || projection.localPriority < 0 ||
      !Number.isSafeInteger(projection.priorityRevision) || projection.priorityRevision < 1 ||
      !['expansion','completion'].includes(projection.supplyRole)) {
    fail('P4_SCHEDULER_PRIORITY_PROJECTION_INVALID', 'Owner priority provider returned an invalid projection.', { workId: work.work_id });
  }
  if (projection.priorityClass !== work.priority_class) {
    fail('P4_SCHEDULER_PRIORITY_PROJECTION_MISMATCH', 'Persisted Work priority class is stale against its Owner projection.', {
      workId: work.work_id, persisted: work.priority_class, projected: projection.priorityClass
    });
  }
  return projection;
}

function dependenciesSatisfied(event, eventsByPlanNode, inboundByPlanNode) {
  const inbound = inboundByPlanNode.get(event.plan_id + '\u0000' + event.node_id) || [];
  return inbound.every((edge) => {
    const predecessor = eventsByPlanNode.get(edge.plan_id + '\u0000' + edge.from_node_id);
    if (!predecessor) fail('P4_SCHEDULER_DEPENDENCY_FACT_MISSING', 'Plan dependency has no corresponding predecessor Event.', {
      planId: edge.plan_id, nodeId: edge.from_node_id
    });
    if (edge.dependency_kind === 'success') return predecessor.state === 'succeeded';
    if (edge.dependency_kind === 'terminal') return TERMINAL_EVENT_STATES.has(predecessor.state);
    fail('P4_SCHEDULER_DEPENDENCY_KIND_INVALID', 'Persisted dependency kind is not recognized.', { dependencyKind: edge.dependency_kind });
  });
}

function createWorkScheduler(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' ||
      !options.supplyController || typeof options.supplyController.evaluate !== 'function' ||
      !options.priorityProjectionProvider || typeof options.priorityProjectionProvider.read !== 'function' || typeof options.now !== 'function' ||
      typeof options.nextLeaseId !== 'function' || (options.workSupplyEligibilityProvider &&
        typeof options.workSupplyEligibilityProvider.check !== 'function')) {
    fail('P4_SCHEDULER_DEPENDENCIES_REQUIRED', 'Scheduler requires scoped persistence, Supply Controller, Owner priority provider, clock, and lease ID source.');
  }
  const leaseTtlMs = options.leaseTtlMs === undefined ? DEFAULT_LEASE_TTL_MS : options.leaseTtlMs;
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1 || leaseTtlMs > 60000) {
    fail('P4_SCHEDULER_LEASE_TTL_INVALID', 'Technical lease TTL must be between 1ms and 60 seconds.');
  }
  const nextLeaseId = options.nextLeaseId;
  const definitions = repositories(options.schemaManifest);
  const activeLeases = new Map();
  const minimumBackgroundLeases = new Set();
  const resourceWaitNotBeforeByTarget = new Map();
  let minimumBackgroundNotBeforeMs = 0;

  function purgeExpired(nowMs) {
    for (const [targetKey, lease] of activeLeases) if (lease.expiresAtMs <= nowMs) {
      activeLeases.delete(targetKey);
      minimumBackgroundLeases.delete(lease.leaseId);
    }
    for (const [targetId, notBeforeMs] of resourceWaitNotBeforeByTarget) {
      if (notBeforeMs <= nowMs) resourceWaitNotBeforeByTarget.delete(targetId);
    }
  }

  function snapshot(targetType, nowMs) {
    return options.unitOfWork.execute([{
      participantId: 'work_scheduler_snapshot', owner: 'execution-foundation', repositories: Object.values(definitions),
      execute(context) {
        const worksRepository = context.repository('scheduler_works');
        const eventsRepository = context.repository('scheduler_events');
        if (targetType === 'work') {
          const works = worksRepository.invoke('list_by_states', { values:[...WORK_STATES] });
          return { works, candidates: works };
        }
        const candidates = eventsRepository.invoke('list_by_states', {
          values:['ready', 'waiting_for_resource', 'waiting_for_external'],
        });
        if (candidates.length === 0) return { works:[], candidates:[] };
        const planIds = [...new Set(candidates.map((event) => event.plan_id))];
        const workIds = [...new Set(candidates.map((event) => event.work_id))];
        const events = boundedChunks(planIds).flatMap((values) =>
          eventsRepository.invoke('list_by_plans', { values }));
        const edgesRepository = context.repository('scheduler_edges');
        const edges = boundedChunks(planIds).flatMap((values) =>
          edgesRepository.invoke('list_by_plans', { values }));
        const works = boundedChunks(workIds).flatMap((values) =>
          worksRepository.invoke('list_by_ids', { values }));
        const eventsByPlanNode = new Map(events.map((event) => [event.plan_id + '\u0000' + event.node_id, event]));
        const inboundByPlanNode = new Map();
        for (const edge of edges) {
          const key = edge.plan_id + '\u0000' + edge.to_node_id;
          if (!inboundByPlanNode.has(key)) inboundByPlanNode.set(key, []);
          inboundByPlanNode.get(key).push(edge);
        }
        return {
          works,
          candidates: candidates.filter((event) =>
            dependenciesSatisfied(event, eventsByPlanNode, inboundByPlanNode))
        };
      }
    }]).work_scheduler_snapshot;
  }

  function acquire(request) {
    exactRequest(request);
    const nowMs = options.now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('P4_SCHEDULER_CLOCK_INVALID', 'Scheduler clock must return epoch milliseconds.');
    purgeExpired(nowMs);
    const facts = snapshot(request.targetType, nowMs);
    const workById = new Map(facts.works.map((work) => [work.work_id, work]));
    const candidates = [];
    for (const target of facts.candidates) {
      const work = request.targetType === 'work' ? target : workById.get(target.work_id);
      if (!work) fail('P4_SCHEDULER_WORK_FACT_MISSING', 'Event has no corresponding Supporting Work.', { eventId: target.event_id });
      if(request.targetType==='work'&&options.workSupplyEligibilityProvider){
        const eligible=options.workSupplyEligibilityProvider.check(Object.freeze({ownerDomain:work.owner_domain,
          processType:work.process_type,processId:work.process_id,workKind:work.work_kind}));
        if(typeof eligible!=='boolean')fail('P4_SCHEDULER_WORK_SUPPLY_ELIGIBILITY_INVALID',
          'Work supply eligibility provider must return a boolean.',{workId:work.work_id});
        if(!eligible)continue;
      }
      const projection = assertProjection(options.priorityProjectionProvider.read(Object.freeze({
        ownerDomain: work.owner_domain, processType: work.process_type, processId: work.process_id, workKind:work.work_kind
      })), work);
      if (target.priority_class !== projection.priorityClass) fail(
        'P4_SCHEDULER_EVENT_PRIORITY_STALE', 'Event priority class is stale against its Owner projection.', { eventId: target.event_id }
      );
      const targetId = request.targetType === 'work' ? target.work_id : target.event_id;
      const targetKey = request.targetType + ':' + targetId;
      if (activeLeases.has(targetKey)) continue;
      if (request.targetType === 'event') {
        const resourceWaitNotBeforeMs = resourceWaitNotBeforeByTarget.get(targetId);
        if (resourceWaitNotBeforeMs !== undefined && resourceWaitNotBeforeMs > nowMs) continue;
      }
      const queuedAtMs = request.targetType === 'work' ? target.created_at_ms : target.ready_at_ms;
      if (!Number.isSafeInteger(queuedAtMs) || queuedAtMs < 0 || queuedAtMs > nowMs) fail(
        'P4_SCHEDULER_QUEUE_TIME_INVALID', 'Eligible target requires a valid non-future queue timestamp.', { targetId }
      );
      const aging = Math.floor((nowMs - queuedAtMs) / AGING_INTERVAL_MS);
      candidates.push({ target, work, projection, targetId, targetKey, queuedAtMs, aging,
        effectiveLocalPriority: projection.localPriority + aging });
    }
    candidates.sort((left, right) => PRIORITY_CLASSES.indexOf(left.projection.priorityClass) - PRIORITY_CLASSES.indexOf(right.projection.priorityClass) ||
      right.effectiveLocalPriority - left.effectiveLocalPriority || left.queuedAtMs - right.queuedAtMs || left.targetId.localeCompare(right.targetId));
    let selected = candidates[0] || null;
    let minimumBackgroundSelected = false;
    if (request.targetType === 'event') {
      const retryElapsed = (item) => item.target.retry_at_ms === null || item.target.retry_at_ms <= nowMs;
      const ordering = candidates.filter((item) => item.target.state === 'waiting_for_resource' || retryElapsed(item));
      const runnable = candidates.filter((item) =>
        (item.target.state === 'ready' ||
          item.target.state === 'waiting_for_resource' ||
          item.target.state === 'waiting_for_external') && retryElapsed(item));
      const head = ordering[0];
      selected = !head ? null : retryElapsed(head)
        ? head
        : runnable.find((item) =>
          PRIORITY_CLASSES.indexOf(item.projection.priorityClass) <= PRIORITY_CLASSES.indexOf(head.projection.priorityClass) &&
          (item.projection.localPriority >= head.projection.localPriority ||
            item.effectiveLocalPriority >= head.effectiveLocalPriority)) || null;
      const reservedHead = head && ['safety_liveness', 'handoff_acceptance'].includes(head.projection.priorityClass);
      const minimumBackground = !reservedHead && nowMs >= minimumBackgroundNotBeforeMs
        ? runnable.find((item) => item.projection.priorityClass === 'background_observation')
        : null;
      if (minimumBackground) { selected = minimumBackground; minimumBackgroundSelected = true; }
    }
    if (!selected) return Object.freeze({ kind: 'idle', reasonCode: 'NO_ELIGIBLE_TARGET' });
    const supply = options.supplyController.evaluate({
      supplyKind: request.targetType === 'work' ? 'work_attempt' : 'event_dispatch', targetId: selected.targetId
    });
    if (supply.kind !== 'permitted') return Object.freeze({
      kind: 'deferred', reasonCode: supply.reasonCode || 'SUPPLY_NOT_PERMITTED', targetType: request.targetType, targetId: selected.targetId
    });
    const leaseId = nextLeaseId();
    if (typeof leaseId !== 'string' || leaseId.length === 0) fail('P4_SCHEDULER_LEASE_ID_INVALID', 'Technical lease ID must be non-empty text.');
    const fenceDigest = digest(JSON.stringify(canonical({ targetType: request.targetType, targetId: selected.targetId,
      state: selected.target.state, priorityClass: selected.projection.priorityClass, priorityRevision: selected.projection.priorityRevision,
      queuedAtMs: selected.queuedAtMs, retryAtMs: selected.target.retry_at_ms === undefined ? null : selected.target.retry_at_ms })));
    const lease = Object.freeze({ leaseId, targetType: request.targetType, targetId: selected.targetId, issuedAtMs: nowMs,
      expiresAtMs: nowMs + leaseTtlMs, fenceDigest });
    activeLeases.set(selected.targetKey, lease);
    if (minimumBackgroundSelected) {
      minimumBackgroundLeases.add(leaseId);
      minimumBackgroundNotBeforeMs = nowMs + MINIMUM_BACKGROUND_RETRY_MS;
    }
    return Object.freeze({ kind: 'leased', lease, lane: minimumBackgroundSelected ? 'minimum_background' : supply.lane, priorityClass: selected.projection.priorityClass,
      localPriority: selected.projection.localPriority, aging: selected.aging });
  }

  function noteDispatchOutcome(lease, outcome) {
    const current = assertCurrent(lease);
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome) ||
        JSON.stringify(Object.keys(outcome)) !== JSON.stringify(['kind']) ||
        !['started', 'resource_wait'].includes(outcome.kind)) {
      fail('P4_SCHEDULER_DISPATCH_OUTCOME_INVALID', 'Dispatch outcome must be an exact started or resource_wait value.');
    }
    if (outcome.kind === 'resource_wait') {
      // The durable retry fence may already be elapsed when a waiter is
      // reconstructed after restart. Keep one short process-local dispatch
      // cooldown so the same waiter cannot consume every action in a tick and
      // starve the remaining eligible Events. Capacity release still wakes the
      // Host, and the bounded fallback retry remains within 100ms.
      resourceWaitNotBeforeByTarget.set(current.targetId, options.now() + MINIMUM_BACKGROUND_RETRY_MS);
    } else {
      resourceWaitNotBeforeByTarget.delete(current.targetId);
    }
    if (!minimumBackgroundLeases.has(current.leaseId)) return Object.freeze({ recorded:false });
    minimumBackgroundNotBeforeMs = options.now() + (outcome.kind === 'started' ? AGING_INTERVAL_MS : MINIMUM_BACKGROUND_RETRY_MS);
    minimumBackgroundLeases.delete(current.leaseId);
    return Object.freeze({ recorded:true, kind:outcome.kind, notBeforeMs:minimumBackgroundNotBeforeMs });
  }

  function assertCurrent(lease) {
    const nowMs = options.now();
    if (!lease || typeof lease !== 'object' || !['work', 'event'].includes(lease.targetType)) {
      fail('P4_SCHEDULER_LEASE_INVALID', 'Technical lease is invalid.');
    }
    purgeExpired(nowMs);
    const current = activeLeases.get(lease.targetType + ':' + lease.targetId);
    if (!current || current.leaseId !== lease.leaseId || current.fenceDigest !== lease.fenceDigest) {
      fail('P4_SCHEDULER_LEASE_STALE', 'Technical lease is absent, expired, released, or superseded.');
    }
    return current;
  }

  function release(lease) {
    const current = assertCurrent(lease);
    activeLeases.delete(current.targetType + ':' + current.targetId);
    minimumBackgroundLeases.delete(current.leaseId);
    return Object.freeze({ released: true, leaseId: current.leaseId });
  }

  function renew(lease) {
    const current = assertCurrent(lease);
    const nowMs = options.now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      fail('P4_SCHEDULER_CLOCK_INVALID', 'Scheduler clock must return epoch milliseconds.');
    }
    const renewed = Object.freeze({ ...current, expiresAtMs: nowMs + leaseTtlMs });
    activeLeases.set(current.targetType + ':' + current.targetId, renewed);
    return renewed;
  }

  return Object.freeze({ acquire, assertCurrent, noteDispatchOutcome, release, renew });
}

module.exports = Object.freeze({ AGING_INTERVAL_MS, DEFAULT_LEASE_TTL_MS, MINIMUM_BACKGROUND_RETRY_MS, WorkSchedulerError, createWorkScheduler });
