'use strict';

const { canonicalJson } = require('../contracts/canonical-json');
const { createBuffaloCpuSession } = require('./buffalo-cpu-session');

const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_IDLE_PER_KEY = 1;
const TAINTED_CODES = new Set([
  'BUFFALO_CPU_TIMEOUT',
  'BUFFALO_CPU_CANCELLED',
  'BUFFALO_CPU_FAILED',
  'BUFFALO_CPU_PROTOCOL_INVALID',
  'BUFFALO_CPU_CLOSED',
  'BUFFALO_CPU_STOPPED',
  'FACE_CATALOGUE_FILES_CHANGED',
]);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function poolKey(settings) {
  return canonicalJson({
    modelRoot: settings?.modelRoot || '',
    catalogueRoot: settings?.catalogueRoot ?? null,
    catalogueGeneration: settings?.catalogueGeneration ?? null,
    catalogueSearchPolicy: settings?.catalogueSearchPolicy ?? null,
  });
}

function createBuffaloSessionPool({
  createSession = createBuffaloCpuSession,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  maxIdlePerKey = DEFAULT_MAX_IDLE_PER_KEY,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const idle = new Map();
  const active = new Set();
  let poolClosed = false;

  function popHealthy(key) {
    const bucket = idle.get(key);
    while (bucket && bucket.length) {
      const entry = bucket.pop();
      clearTimer(entry.timer);
      if (!bucket.length) idle.delete(key);
      if (typeof entry.raw.isHealthy !== 'function' || entry.raw.isHealthy()) {
        return entry.raw;
      }
      void Promise.resolve(entry.raw.stop()).catch(() => {});
    }
    return null;
  }

  function acquire(settings) {
    if (poolClosed) throw failure('BUFFALO_CPU_CLOSED', 'The buffalo session pool is closed.');
    const key = poolKey(settings);
    const raw = popHealthy(key) || createSession(settings);
    active.add(raw);
    let released = false;
    let tainted = false;
    let stopPromise = null;

    async function call(method, ...args) {
      if (released || poolClosed) {
        throw failure('BUFFALO_CPU_CLOSED', 'The leased buffalo CPU session is closed.');
      }
      try {
        return await raw[method](...args);
      } catch (error) {
        if (TAINTED_CODES.has(error?.code) || (typeof raw.isHealthy === 'function' && !raw.isHealthy())) {
          tainted = true;
        }
        throw error;
      }
    }

    function stop() {
      if (stopPromise) return stopPromise;
      released = true;
      stopPromise = (async () => {
        active.delete(raw);
        const healthy = typeof raw.isHealthy === 'function' ? raw.isHealthy() : true;
        const bucket = idle.get(key) || [];
        if (poolClosed || tainted || !healthy || bucket.length >= maxIdlePerKey || idleTimeoutMs <= 0) {
          await raw.stop();
          return;
        }
        const entry = { raw, timer: null };
        entry.timer = setTimer(() => {
          const current = idle.get(key);
          if (current) {
            const index = current.indexOf(entry);
            if (index >= 0) current.splice(index, 1);
            if (!current.length) idle.delete(key);
          }
          void Promise.resolve(raw.stop()).catch(() => {});
        }, idleTimeoutMs);
        entry.timer?.unref?.();
        bucket.push(entry);
        idle.set(key, bucket);
      })();
      return stopPromise;
    }

    return Object.freeze({
      faceModelRef: raw.faceModelRef,
      load: (options) => call('load', options),
      loadCatalogue: (options) => call('loadCatalogue', options),
      searchCatalogue: (vector, options) => call('searchCatalogue', vector, options),
      analyzeEvidence: (bytes, options) => call('analyzeEvidence', bytes, options),
      groupFaces: (faces, parameters, options) => call('groupFaces', faces, parameters, options),
      renderRepresentative: (request, options) => call('renderRepresentative', request, options),
      stop,
    });
  }

  async function close() {
    poolClosed = true;
    const stops = [];
    for (const entries of idle.values()) {
      for (const entry of entries) {
        clearTimer(entry.timer);
        stops.push(Promise.resolve().then(() => entry.raw.stop()));
      }
    }
    idle.clear();
    for (const raw of active) {
      stops.push(Promise.resolve().then(() => raw.stop()));
    }
    active.clear();
    await Promise.allSettled(stops);
  }

  function stats() {
    let idleCount = 0;
    for (const entries of idle.values()) idleCount += entries.length;
    return Object.freeze({ idleCount, activeCount: active.size });
  }

  return Object.freeze({ acquire, close, stats });
}

module.exports = Object.freeze({
  createBuffaloSessionPool,
  DEFAULT_IDLE_TIMEOUT_MS,
});
