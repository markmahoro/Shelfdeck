'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { PRIORITY_CLASSES } = require('./runtime-contracts');

const TERMINAL_EVENT_STATES = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);
const WORK_STATES = new Set(['admitted', 'ready']);
const AGING_INTERVAL_MS = 60000;
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
      list: { kind: 'select-all', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'priority_class', 'state', 'created_at_ms'
      ], keyColumns: [] }
    } }),
    events: createRepositoryDefinition({ repositoryId: 'scheduler_events', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'work_id', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms'
      ], keyColumns: [] }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'scheduler_edges', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_plan_edges', columns: [
        'plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'
      ], keyColumns: [] }
    } })
  });
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
      typeof options.nextLeaseId !== 'function') {
    fail('P4_SCHEDULER_DEPENDENCIES_REQUIRED', 'Scheduler requires scoped persistence, Supply Controller, Owner priority provider, clock, and lease ID source.');
  }
  const leaseTtlMs = options.leaseTtlMs === undefined ? DEFAULT_LEASE_TTL_MS : options.leaseTtlMs;
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1 || leaseTtlMs > 60000) {
    fail('P4_SCHEDULER_LEASE_TTL_INVALID', 'Technical lease TTL must be between 1ms and 60 seconds.');
  }
  const nextLeaseId = options.nextLeaseId;
  const definitions = repositories(options.schemaManifest);
  const activeLeases = new Map();

  function purgeExpired(nowMs) {
    for (const [targetKey, lease] of activeLeases) if (lease.expiresAtMs <= nowMs) activeLeases.delete(targetKey);
  }

  function snapshot(targetType, nowMs) {
    return options.unitOfWork.execute([{
      participantId: 'work_scheduler_snapshot', owner: 'execution-foundation', repositories: Object.values(definitions),
      execute(context) {
        const works = context.repository('scheduler_works').invoke('list');
        const events = context.repository('scheduler_events').invoke('list');
        if (targetType === 'work') return { works, candidates: works.filter((work) => WORK_STATES.has(work.state)) };
        const edges = context.repository('scheduler_edges').invoke('list');
        const eventsByPlanNode = new Map(events.map((event) => [event.plan_id + '\u0000' + event.node_id, event]));
        const inboundByPlanNode = new Map();
        for (const edge of edges) {
          const key = edge.plan_id + '\u0000' + edge.to_node_id;
          if (!inboundByPlanNode.has(key)) inboundByPlanNode.set(key, []);
          inboundByPlanNode.get(key).push(edge);
        }
        return {
          works,
          candidates: events.filter((event) =>
            (event.state === 'ready' ||
              event.state === 'waiting_for_resource' ||
              event.state === 'waiting_for_external') &&
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
      const projection = assertProjection(options.priorityProjectionProvider.read(Object.freeze({
        ownerDomain: work.owner_domain, processType: work.process_type, processId: work.process_id, workKind:work.work_kind
      })), work);
      if (target.priority_class !== projection.priorityClass) fail(
        'P4_SCHEDULER_EVENT_PRIORITY_STALE', 'Event priority class is stale against its Owner projection.', { eventId: target.event_id }
      );
      const targetId = request.targetType === 'work' ? target.work_id : target.event_id;
      const targetKey = request.targetType + ':' + targetId;
      if (activeLeases.has(targetKey)) continue;
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
          item.projection.localPriority >= head.projection.localPriority) || null;
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
    return Object.freeze({ kind: 'leased', lease, lane: supply.lane, priorityClass: selected.projection.priorityClass,
      localPriority: selected.projection.localPriority, aging: selected.aging });
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

  return Object.freeze({ acquire, assertCurrent, release, renew });
}

module.exports = Object.freeze({ AGING_INTERVAL_MS, DEFAULT_LEASE_TTL_MS, WorkSchedulerError, createWorkScheduler });
