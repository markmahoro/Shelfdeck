'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { PRIORITY_CLASSES } = require('./runtime-contracts');

const QUEUE_CLASSES = Object.freeze(['control_plane', ...PRIORITY_CLASSES]);
const BACKOFF_MS = Object.freeze([5000, 30000, 120000, 600000]);
const DEFAULT_QUEUE_LIMITS = Object.freeze({ globalSoft: 192, globalHard: 256, perKeySoft: 48, perKeyHard: 64 });

class ResourceGovernorError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ResourceGovernorError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new ResourceGovernorError(code, message, details); }

function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code, 'Resource request shape is not exact.');
}

function definitions(schemaManifest) {
  return Object.freeze({
    events: createRepositoryDefinition({ repositoryId: 'governor_events', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: ['event_id', 'state', 'retry_at_ms'], keyColumns: ['event_id'] },
      defer: { kind: 'update', tableId: 'fx_workflow_events', setColumns: ['state', 'retry_at_ms'], keyColumns: ['event_id'] }
    } }),
    defers: createRepositoryDefinition({ repositoryId: 'governor_defers', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_resource_defer', columns: [
        'event_id', 'resource_key', 'queue_class', 'local_priority', 'enqueued_at_ms', 'retry_at_ms', 'state'
      ], keyColumns: [] },
      insert: { kind: 'insert', tableId: 'fx_resource_defer', columns: [
        'event_id', 'resource_key', 'queue_class', 'local_priority', 'enqueued_at_ms', 'retry_at_ms', 'state'
      ] },
      update: { kind: 'update', tableId: 'fx_resource_defer', setColumns: [
        'queue_class', 'local_priority', 'enqueued_at_ms', 'retry_at_ms', 'state'
      ], keyColumns: ['event_id', 'resource_key'] }
    } })
  });
}

function assertLimits(limits) {
  exact(limits, ['globalSoft', 'globalHard', 'perKeySoft', 'perKeyHard'], 'P4_RESOURCE_QUEUE_LIMIT_SHAPE_MISMATCH');
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1) ||
      limits.globalSoft >= limits.globalHard || limits.perKeySoft >= limits.perKeyHard) {
    fail('P4_RESOURCE_QUEUE_LIMIT_INVALID', 'Resource waiter queue limits require positive soft/hard pairs.');
  }
}

function validateRequest(request) {
  exact(request, ['eventId', 'queueClass', 'localPriority', 'priorityRevision', 'resources'], 'P4_RESOURCE_REQUEST_SHAPE_MISMATCH');
  if (typeof request.eventId !== 'string' || !request.eventId || !QUEUE_CLASSES.includes(request.queueClass) ||
      !Number.isSafeInteger(request.localPriority) || request.localPriority < 0 ||
      !Number.isSafeInteger(request.priorityRevision) || request.priorityRevision < 1 ||
      !Array.isArray(request.resources) || request.resources.length < 1 || request.resources.length > 16) {
    fail('P4_RESOURCE_REQUEST_INVALID', 'Resolved Resource Demand is invalid.');
  }
  const seen = new Set();
  const resources = request.resources.map((resource) => {
    exact(resource, ['resourceKey', 'units'], 'P4_RESOURCE_DEMAND_SHAPE_MISMATCH');
    if (typeof resource.resourceKey !== 'string' || !resource.resourceKey || !Number.isSafeInteger(resource.units) || resource.units < 1 ||
        seen.has(resource.resourceKey)) fail('P4_RESOURCE_DEMAND_INVALID', 'Resource Demand keys must be unique with positive units.');
    seen.add(resource.resourceKey);
    return Object.freeze({ ...resource });
  }).sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
  return Object.freeze({ ...request, resources: Object.freeze(resources) });
}

function createResourceGovernor(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' ||
      !options.profileProvider || typeof options.profileProvider.current !== 'function' || typeof options.now !== 'function' ||
      typeof options.nextPermitId !== 'function') fail(
    'P4_RESOURCE_GOVERNOR_DEPENDENCIES_REQUIRED', 'Governor requires persistence, current Profile provider, clock, and Permit ID source.'
  );
  const queueLimits = Object.freeze({ ...(options.queueLimits || DEFAULT_QUEUE_LIMITS) });
  assertLimits(queueLimits);
  const repositories = definitions(options.schemaManifest);
  const inUse = new Map();
  const permits = new Map();
  const eventPermits = new Map();
  const waiters = new Map();

  function now() {
    const value = options.now();
    if (!Number.isSafeInteger(value) || value < 0) fail('P4_RESOURCE_GOVERNOR_CLOCK_INVALID', 'Governor clock must return epoch milliseconds.');
    return value;
  }

  function mapper() {
    const current = options.profileProvider.current();
    if (!current || typeof current.capacityFor !== 'function' || !Number.isSafeInteger(current.profileRevision) || current.profileRevision < 1) {
      fail('P4_RESOURCE_PROFILE_CURRENT_INVALID', 'Current Resource Profile mapping is invalid.');
    }
    return current;
  }

  function canAcquire(resources, currentMapper) {
    return resources.every((resource) => (inUse.get(resource.resourceKey) || 0) + resource.units <= currentMapper.capacityFor(resource.resourceKey));
  }

  function persistReleaseDefers(eventId) {
    return options.unitOfWork.execute([{
      participantId: 'resource_governor_release_defer', owner: 'execution-foundation',
      repositories: Object.values(repositories),
      execute(context) {
        const waiting = context.repository('governor_defers').invoke('list')
          .filter((row) => row.event_id === eventId && row.state === 'waiting');
        for (const row of waiting) {
          context.repository('governor_defers').invoke('update', {
            event_id: eventId, resource_key: row.resource_key, queue_class: row.queue_class,
            local_priority: row.local_priority, enqueued_at_ms: row.enqueued_at_ms,
            retry_at_ms: row.retry_at_ms, state: 'released',
          });
        }
        return Object.freeze({ released: waiting.length });
      },
    }]).resource_governor_release_defer;
  }

  function issue(request, currentMapper, issuedAtMs) {
    if (eventPermits.has(request.eventId)) fail('P4_RESOURCE_EVENT_ALREADY_PERMITTED', 'Event already owns an active Permit bundle.');
    const permitId = options.nextPermitId();
    if (typeof permitId !== 'string' || !permitId || permits.has(permitId)) fail('P4_RESOURCE_PERMIT_ID_INVALID', 'Permit identity must be unique non-empty text.');
    persistReleaseDefers(request.eventId);
    for (const resource of request.resources) inUse.set(resource.resourceKey, (inUse.get(resource.resourceKey) || 0) + resource.units);
    const permit = Object.freeze({ permitId, eventId: request.eventId, resources: request.resources,
      profileRevision: currentMapper.profileRevision, issuedAtMs });
    permits.set(permitId, permit); eventPermits.set(request.eventId, permitId);
    return permit;
  }

  function persistDeferred(request, deferredAtMs) {
    return options.unitOfWork.execute([{
      participantId: 'resource_governor_defer', owner: 'execution-foundation', repositories: Object.values(repositories),
      execute(context) {
        const event = context.repository('governor_events').invoke('find', { event_id: request.eventId });
        if (!event || !['ready', 'waiting_for_resource'].includes(event.state)) fail(
          'P4_RESOURCE_DEFER_EVENT_INELIGIBLE', 'Resource defer requires a ready or resource-waiting Event.', { eventId: request.eventId }
        );
        const all = context.repository('governor_defers').invoke('list');
        const existing = all.filter((row) => row.event_id === request.eventId);
        const requestedKeys = request.resources.map((item) => item.resourceKey).sort();
        if (existing.length > 0) {
          const existingKeys = existing.map((item) => item.resource_key).sort();
          if (JSON.stringify(existingKeys) !== JSON.stringify(requestedKeys)) fail(
            'P4_RESOURCE_DEFER_DEMAND_DRIFT', 'Durable Resource Demand cannot change for the same Event.'
          );
          const retryAt = Math.max(...existing.map((row) => row.retry_at_ms));
          if (retryAt > deferredAtMs) return Object.freeze({ retryAtMs: retryAt, replayed: true });
        }
        const previousDelay = existing.length ? Math.max(...existing.map((row) => row.retry_at_ms - row.enqueued_at_ms)) : 0;
        const previousIndex = BACKOFF_MS.indexOf(previousDelay);
        const delay = BACKOFF_MS[Math.min(previousIndex < 0 ? 0 : previousIndex + 1, BACKOFF_MS.length - 1)];
        const retryAtMs = deferredAtMs + delay;
        const byKey = new Map(existing.map((row) => [row.resource_key, row]));
        for (const resource of request.resources) {
          const values = { event_id: request.eventId, resource_key: resource.resourceKey, queue_class: request.queueClass,
            local_priority: request.localPriority, enqueued_at_ms: deferredAtMs, retry_at_ms: retryAtMs, state: 'waiting' };
          context.repository('governor_defers').invoke(byKey.has(resource.resourceKey) ? 'update' : 'insert', values);
        }
        context.repository('governor_events').invoke('defer', {
          event_id: request.eventId, state: 'waiting_for_resource', retry_at_ms: retryAtMs
        });
        return Object.freeze({ retryAtMs, replayed: false });
      }
    }]).resource_governor_defer;
  }

  function persistSoftWait(request, deferredAtMs) {
    const delayMs = 100;
    return options.unitOfWork.execute([{
      participantId: 'resource_governor_soft_wait', owner: 'execution-foundation', repositories: Object.values(repositories),
      execute(context) {
        const event = context.repository('governor_events').invoke('find', { event_id: request.eventId });
        if (!event || !['ready', 'waiting_for_resource'].includes(event.state)) fail(
          'P4_RESOURCE_DEFER_EVENT_INELIGIBLE', 'Resource defer requires a ready or resource-waiting Event.', { eventId: request.eventId }
        );
        const all = context.repository('governor_defers').invoke('list');
        const existing = all.filter((row) => row.event_id === request.eventId);
        const requestedKeys = request.resources.map((item) => item.resourceKey).sort();
        if (existing.length > 0) {
          const existingKeys = existing.map((item) => item.resource_key).sort();
          if (JSON.stringify(existingKeys) !== JSON.stringify(requestedKeys)) fail(
            'P4_RESOURCE_DEFER_DEMAND_DRIFT', 'Durable Resource Demand cannot change for the same Event.'
          );
          const retryAt = Math.max(...existing.map((row) => row.retry_at_ms));
          if (retryAt > deferredAtMs) return Object.freeze({ retryAtMs: retryAt, replayed: true });
        }
        const retryAtMs = deferredAtMs + delayMs;
        const byKey = new Map(existing.map((row) => [row.resource_key, row]));
        for (const resource of request.resources) {
          const values = { event_id: request.eventId, resource_key: resource.resourceKey, queue_class: request.queueClass,
            local_priority: request.localPriority, enqueued_at_ms: deferredAtMs, retry_at_ms: retryAtMs, state: 'waiting' };
          context.repository('governor_defers').invoke(byKey.has(resource.resourceKey) ? 'update' : 'insert', values);
        }
        context.repository('governor_events').invoke('defer', {
          event_id: request.eventId, state: 'waiting_for_resource', retry_at_ms: retryAtMs
        });
        return Object.freeze({ retryAtMs, replayed: false });
      }
    }]).resource_governor_soft_wait;
  }

  function waiting(request, replayed, atMs) {
    const deferred = persistSoftWait(request, atMs);
    return Object.freeze({ kind: 'waiting', eventId: request.eventId, replayed, retryAtMs: deferred.retryAtMs });
  }

  function waiterPerKey(resourceKey) {
    let count = 0;
    for (const waiter of waiters.values()) if (waiter.request.resources.some((resource) => resource.resourceKey === resourceKey)) count += 1;
    return count;
  }

  function queueFull(request) {
    return waiters.size >= queueLimits.globalHard || request.resources.some((resource) => waiterPerKey(resource.resourceKey) >= queueLimits.perKeyHard);
  }

  function acquire(rawRequest) {
    const request = validateRequest(rawRequest);
    const requestedAtMs = now();
    if (eventPermits.has(request.eventId)) fail('P4_RESOURCE_EVENT_ALREADY_PERMITTED', 'Event already owns an active Permit bundle.');
    const currentMapper = mapper();
    const existingWaiter = waiters.get(request.eventId);
    if (existingWaiter) {
      const same = JSON.stringify(existingWaiter.request) === JSON.stringify(request);
      if (!same) {
        const sameResources = JSON.stringify(existingWaiter.request.resources) ===
          JSON.stringify(request.resources);
        const priorityOnly = sameResources &&
          request.priorityRevision > existingWaiter.request.priorityRevision;
        if (!priorityOnly) fail('P4_RESOURCE_DUPLICATE_WAITER_CONFLICT',
          'Event cannot register a second or changed Resource waiter.');
        waiters.set(request.eventId, Object.freeze({
          ...existingWaiter,
          request,
        }));
      }
      const currentWaiter = waiters.get(request.eventId);
      // Work Scheduler owns Event ordering. Governor only arbitrates whether the selected
      // Event's complete resource bundle fits; a second hidden queue head would deadlock
      // when its ordering differs from the durable Scheduler lease ordering.
      if (canAcquire(currentWaiter.request.resources, currentMapper)) {
        waiters.delete(request.eventId);
        return Object.freeze({ kind: 'permitted', permit: issue(currentWaiter.request, currentMapper, requestedAtMs) });
      }
      return waiting(currentWaiter.request, true, requestedAtMs);
    }
    const impossible = request.resources.find((resource) => resource.units > currentMapper.capacityFor(resource.resourceKey));
    if (impossible) return Object.freeze({ kind: 'unavailable', reasonCode: 'RESOURCE_MAP_UNSATISFIABLE', resourceKey: impossible.resourceKey });
    const contendsWithWaiter = [...waiters.values()].some((waiter) => waiter.request.resources.some((held) =>
      request.resources.some((resource) => resource.resourceKey === held.resourceKey)));
    if (!contendsWithWaiter && canAcquire(request.resources, currentMapper)) {
      return Object.freeze({ kind: 'permitted', permit: issue(request, currentMapper, requestedAtMs) });
    }
    if (queueFull(request)) {
      const deferred = persistDeferred(request, requestedAtMs);
      return Object.freeze({ kind: 'deferred', reasonCode: 'RESOURCE_QUEUE_HARD_CAP', retryAtMs: deferred.retryAtMs, replayed: deferred.replayed });
    }
    waiters.set(request.eventId, Object.freeze({ request, enqueuedAtMs: requestedAtMs }));
    return waiting(request, false, requestedAtMs);
  }

  function compareWaiters(left, right, atMs) {
    const classOrder = QUEUE_CLASSES.indexOf(left.request.queueClass) - QUEUE_CLASSES.indexOf(right.request.queueClass);
    const leftScore = left.request.localPriority + Math.floor((atMs - left.enqueuedAtMs) / 60000);
    const rightScore = right.request.localPriority + Math.floor((atMs - right.enqueuedAtMs) / 60000);
    return classOrder || rightScore - leftScore || left.enqueuedAtMs - right.enqueuedAtMs || left.request.eventId.localeCompare(right.request.eventId);
  }

  function release(permit) {
    if (!permit || typeof permit !== 'object') fail('P4_RESOURCE_PERMIT_INVALID', 'Permit is required for release.');
    const current = permits.get(permit.permitId);
    if (!current || current.eventId !== permit.eventId || current !== permit) fail('P4_RESOURCE_PERMIT_STALE', 'Permit is absent, foreign, or already released.');
    for (const resource of current.resources) {
      const remaining = (inUse.get(resource.resourceKey) || 0) - resource.units;
      if (remaining < 0) fail('P4_RESOURCE_PERMIT_ACCOUNTING_BROKEN', 'Permit release would make capacity accounting negative.');
      if (remaining === 0) inUse.delete(resource.resourceKey); else inUse.set(resource.resourceKey, remaining);
    }
    permits.delete(current.permitId); eventPermits.delete(current.eventId);
    return Object.freeze({ released: true, permitId: current.permitId });
  }

  function updateWaiterPriority(request) {
    exact(request, ['eventId', 'queueClass', 'localPriority', 'priorityRevision'], 'P4_RESOURCE_PRIORITY_UPDATE_SHAPE_MISMATCH');
    const waiter = waiters.get(request.eventId);
    if (!waiter) fail('P4_RESOURCE_WAITER_NOT_FOUND', 'Only an existing waiter can be reprioritized.');
    if (!QUEUE_CLASSES.includes(request.queueClass) || !Number.isSafeInteger(request.localPriority) || request.localPriority < 0 ||
        !Number.isSafeInteger(request.priorityRevision) || request.priorityRevision <= waiter.request.priorityRevision) fail(
      'P4_RESOURCE_PRIORITY_UPDATE_INVALID', 'Waiter priority update requires a newer valid Owner projection.'
    );
    waiters.set(request.eventId, Object.freeze({ ...waiter, request: Object.freeze({ ...waiter.request, queueClass: request.queueClass,
      localPriority: request.localPriority, priorityRevision: request.priorityRevision }) }));
    return Object.freeze({ updated: true, eventId: request.eventId });
  }

  async function withPermit(request, operation) {
    if (typeof operation !== 'function') fail('P4_RESOURCE_OPERATION_REQUIRED', 'Permit operation must be callable.');
    const acquired = acquire(request);
    if (acquired.kind !== 'permitted') return acquired;
    try { return await operation(acquired.permit); }
    finally { release(acquired.permit); }
  }

  function snapshot() {
    return Object.freeze({ permitCount: permits.size, waiterCount: waiters.size,
      inUse: Object.freeze([...inUse.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([resourceKey, units]) => Object.freeze({ resourceKey, units }))),
      queueSoftExceeded: waiters.size >= queueLimits.globalSoft });
  }

  return Object.freeze({ acquire, release, snapshot, updateWaiterPriority, withPermit });
}

module.exports = Object.freeze({ BACKOFF_MS, DEFAULT_QUEUE_LIMITS, QUEUE_CLASSES, ResourceGovernorError, createResourceGovernor });
