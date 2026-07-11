'use strict';

const crypto = require('crypto');

const DEFAULT_CAPACITIES = Object.freeze({
  'control:libra': 1,
  'control:kairox': 1,
  'db:library:write': 1,
  'db:tasks:write': 1,
  'local:ffmpeg': 1,
  'service:task': 1,
});

const DEFAULT_QUEUE_LIMIT = 100;
const DEFAULT_AGING_MS = 60000;
const active = new Map();
const waiters = [];
let configProvider = () => ({});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function configure(provider) {
  configProvider = typeof provider === 'function' ? provider : () => (provider || {});
  drain();
}

function currentConfig() {
  try { return configProvider() || {}; } catch (_) { return {}; }
}

function capacityMap() {
  const config = currentConfig();
  const limits = config.resourceLimits || {};
  return {
    ...DEFAULT_CAPACITIES,
    ...((config.resourceGovernor && config.resourceGovernor.capacities) || {}),
    'local:ffmpeg': positiveInteger(limits.localFfmpeg, 1),
    'emby:*:api': positiveInteger(limits.embyApiPerServer, 1),
    'filesystem:*': positiveInteger(limits.filesystemPerVolume, 1),
    'worker:*': positiveInteger(limits.workerPerNode, 1),
  };
}

function capacityFor(resourceKey) {
  const key = clean(resourceKey);
  const capacities = capacityMap();
  const direct = positiveInteger(capacities[key], null);
  if (direct != null) return direct;
  if (key.startsWith('emby:')) return positiveInteger(capacities['emby:*:api'], 1);
  if (key.startsWith('filesystem:')) return positiveInteger(capacities['filesystem:*'], 1);
  if (key.startsWith('worker:')) return positiveInteger(capacities['worker:*'], 1);
  return positiveInteger(capacities['*'], 1);
}

function queueLimitFor(resourceKey) {
  const config = currentConfig();
  const governor = config.resourceGovernor || {};
  const direct = governor.queueLimits && governor.queueLimits[resourceKey];
  return positiveInteger(direct, positiveInteger(governor.defaultQueueLimit, DEFAULT_QUEUE_LIMIT));
}

function unitsInUse(resourceKey) {
  let count = 0;
  for (const permit of active.values()) {
    if (permit.resourceKey === resourceKey) count += permit.units;
  }
  return count;
}

function waitingFor(resourceKey) {
  return waiters.filter((waiter) => waiter.resourceKey === resourceKey && !waiter.settled).length;
}

function effectivePriority(waiter, now = Date.now()) {
  const config = currentConfig();
  const agingMs = positiveInteger(config.resourceGovernor && config.resourceGovernor.agingMs, DEFAULT_AGING_MS);
  return waiter.priority - Math.floor(Math.max(0, now - waiter.enqueuedAtMs) / agingMs);
}

function trafficRank(waiter) {
  if (waiter.trafficClass === 'control') return 0;
  return waiter.maintenancePriorityClass === 'expedited' ? 1 : 2;
}

function makePermit(waiter) {
  const permit = {
    permitId: crypto.randomUUID(),
    owner: waiter.owner,
    workId: waiter.workId,
    resourceKey: waiter.resourceKey,
    units: waiter.units,
    acquiredAt: new Date().toISOString(),
    released: false,
    release() {
      if (permit.released) return false;
      permit.released = true;
      active.delete(permit.permitId);
      drain();
      return true;
    },
  };
  active.set(permit.permitId, permit);
  return permit;
}

function drain() {
  if (waiters.length === 0) return;
  const now = Date.now();
  waiters.sort((a, b) => (
    trafficRank(a) - trafficRank(b)
    || effectivePriority(a, now) - effectivePriority(b, now)
    || a.enqueuedAtMs - b.enqueuedAtMs
  ));
  for (const waiter of waiters) {
    if (waiter.settled) continue;
    if (unitsInUse(waiter.resourceKey) + waiter.units > capacityFor(waiter.resourceKey)) continue;
    waiter.settled = true;
    waiter.resolve(makePermit(waiter));
  }
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    if (waiters[index].settled) waiters.splice(index, 1);
  }
}

function acquire(input = {}) {
  const resourceKey = clean(input.resourceKey);
  if (!resourceKey) {
    const error = new Error('resourceKey is required');
    error.code = 'RESOURCE_KEY_REQUIRED';
    return Promise.reject(error);
  }
  const units = positiveInteger(input.units, 1);
  if (units > capacityFor(resourceKey)) {
    const error = new Error(`Requested units exceed resource capacity: ${resourceKey}`);
    error.code = 'RESOURCE_CAPACITY_EXCEEDED';
    return Promise.reject(error);
  }
  const owner = clean(input.owner) || 'unknown';
  const workId = clean(input.workId);
  const existing = waiters.find((waiter) => (
    !waiter.settled
    && waiter.owner === owner
    && waiter.workId === workId
    && waiter.resourceKey === resourceKey
  ));
  if (existing) return existing.promise;
  if (waitingFor(resourceKey) >= queueLimitFor(resourceKey)) {
    const error = new Error(`Resource wait queue is full: ${resourceKey}`);
    error.code = 'RESOURCE_QUEUE_FULL';
    return Promise.reject(error);
  }
  let waiter;
  const promise = new Promise((resolve, reject) => {
    waiter = {
      owner,
      workId,
      resourceKey,
      units,
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 50,
      trafficClass: input.trafficClass === 'maintenance' ? 'maintenance' : 'control',
      maintenancePriorityClass: input.maintenancePriorityClass === 'expedited' ? 'expedited' : 'normal',
      enqueuedAtMs: Date.now(),
      resolve,
      reject,
      settled: false,
      promise: null,
    };
    waiters.push(waiter);
    drain();
  });
  waiter.promise = promise;
  return promise;
}

function hasWaitingWork(input = {}) {
  const owner = clean(input.owner);
  const workId = clean(input.workId);
  return waiters.some((waiter) => (
    !waiter.settled
    && (!owner || waiter.owner === owner)
    && (!workId || waiter.workId === workId)
  ));
}

function reprioritizeWork(input = {}) {
  const owner = clean(input.owner);
  const workId = clean(input.workId);
  let changed = 0;
  for (const waiter of waiters) {
    if (waiter.settled) continue;
    if (owner && waiter.owner !== owner) continue;
    if (workId && waiter.workId !== workId) continue;
    waiter.maintenancePriorityClass = input.maintenancePriorityClass === 'expedited' ? 'expedited' : 'normal';
    if (Number.isFinite(Number(input.priority))) waiter.priority = Number(input.priority);
    changed += 1;
  }
  if (changed > 0) drain();
  return changed;
}

async function runWithPermit(input, work) {
  const permit = await acquire(input);
  try {
    return await work(permit);
  } finally {
    permit.release();
  }
}

function snapshot() {
  const keys = new Set([
    ...Object.keys(capacityMap()),
    ...[...active.values()].map((entry) => entry.resourceKey),
    ...waiters.map((entry) => entry.resourceKey),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    resources: [...keys].sort().map((resourceKey) => ({
      resourceKey,
      capacity: capacityFor(resourceKey),
      active: unitsInUse(resourceKey),
      waiting: waitingFor(resourceKey),
    })),
    activePermits: [...active.values()].map((permit) => ({
      permitId: permit.permitId,
      owner: permit.owner,
      workId: permit.workId,
      resourceKey: permit.resourceKey,
      units: permit.units,
      acquiredAt: permit.acquiredAt,
    })),
    waitingWork: waiters.filter((waiter) => !waiter.settled).map((waiter) => ({
      owner: waiter.owner,
      workId: waiter.workId,
      resourceKey: waiter.resourceKey,
      trafficClass: waiter.trafficClass,
      maintenancePriorityClass: waiter.maintenancePriorityClass,
      priority: waiter.priority,
      enqueuedAt: new Date(waiter.enqueuedAtMs).toISOString(),
    })),
  };
}

function resetForTests() {
  for (const waiter of waiters.splice(0)) {
    waiter.settled = true;
    const error = new Error('Resource Governor reset');
    error.code = 'RESOURCE_GOVERNOR_RESET';
    waiter.reject(error);
  }
  active.clear();
  configProvider = () => ({});
}

module.exports = {
  DEFAULT_CAPACITIES,
  acquire,
  capacityFor,
  configure,
  runWithPermit,
  reprioritizeWork,
  hasWaitingWork,
  snapshot,
  resetForTests,
};
