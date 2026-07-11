'use strict';

const crypto = require('crypto');

const DEFAULT_RECENT_LIMIT = 200;
const DEFAULT_RECENT_WINDOW_MS = 30 * 60 * 1000;

const activeEvents = new Map();
const recentEvents = [];

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function cleanText(value) {
  return String(value == null ? '' : value);
}

function cleanObject(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    if (typeof raw === 'function') continue;
    out[key] = raw;
  }
  return out;
}

function pruneRecent(opts = {}) {
  const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : DEFAULT_RECENT_WINDOW_MS;
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : DEFAULT_RECENT_LIMIT;
  const cutoff = nowMs() - maxAgeMs;
  for (let i = recentEvents.length - 1; i >= 0; i -= 1) {
    const event = recentEvents[i];
    const eventTime = event.endedAtMs
      || event.startedAtMs
      || Date.parse(event.endedAt || event.startedAt || '')
      || nowMs();
    if (eventTime < cutoff) recentEvents.splice(i, 1);
  }
  if (recentEvents.length > limit) recentEvents.splice(limit);
}

function snapshot(event) {
  const current = nowMs();
  const endedAtMs = event.endedAtMs || null;
  const durationMs = endedAtMs
    ? Math.max(0, endedAtMs - event.startedAtMs)
    : Math.max(0, current - event.startedAtMs);
  return {
    id: event.id,
    eventId: event.id,
    eventType: event.eventType,
    eventStatus: event.eventStatus,
    component: event.component,
    resourceType: event.resourceType,
    resourceKey: event.resourceKey,
    resourceLabel: event.resourceLabel,
    taskId: event.taskId || '',
    subjectId: event.subjectId || '',
    subjectName: event.subjectName || '',
    subLibraryId: event.subLibraryId || '',
    source: event.source || '',
    startedAt: event.startedAt,
    endedAt: event.endedAt || null,
    durationMs,
    payload: cleanObject(event.payload),
  };
}

function startEvent(input = {}) {
  pruneRecent();
  const startedAtMs = nowMs();
  const id = cleanText(input.id || input.eventId || crypto.randomUUID());
  const event = {
    id,
    eventType: cleanText(input.eventType || input.type || 'runtime.event'),
    eventStatus: cleanText(input.eventStatus || input.status || 'running'),
    component: cleanText(input.component || 'service'),
    resourceType: cleanText(input.resourceType || 'service'),
    resourceKey: cleanText(input.resourceKey || input.resourceType || 'service'),
    resourceLabel: cleanText(input.resourceLabel || input.resourceKey || input.resourceType || 'Service'),
    taskId: cleanText(input.taskId),
    subjectId: cleanText(input.subjectId),
    subjectName: cleanText(input.subjectName),
    subLibraryId: cleanText(input.subLibraryId),
    source: cleanText(input.source),
    payload: cleanObject(input.payload),
    startedAt: input.startedAt || new Date(startedAtMs).toISOString(),
    startedAtMs,
    endedAt: null,
    endedAtMs: null,
  };

  activeEvents.set(id, event);

  let finished = false;
  return {
    id,
    update(payload = {}) {
      Object.assign(event.payload, cleanObject(payload));
      return snapshot(event);
    },
    finish(status = 'done', payload = {}) {
      if (finished) return snapshot(event);
      finished = true;
      event.eventStatus = cleanText(status || 'done');
      Object.assign(event.payload, cleanObject(payload));
      event.endedAtMs = nowMs();
      event.endedAt = new Date(event.endedAtMs).toISOString();
      activeEvents.delete(id);
      recentEvents.unshift(snapshot(event));
      pruneRecent();
      return snapshot(event);
    },
    snapshot() {
      return snapshot(event);
    },
  };
}

function recordInstant(input = {}) {
  const tracker = startEvent(input);
  return tracker.finish(input.eventStatus || input.status || 'done', input.payload || {});
}

function trackEvent(input, fn) {
  const tracker = startEvent(input);
  const successPayload = typeof input.successPayload === 'function'
    ? input.successPayload
    : (() => cleanObject(input.successPayload));
  try {
    const result = fn(tracker);
    if (result && typeof result.then === 'function') {
      return result.then((value) => {
        tracker.finish('done', successPayload(value));
        return value;
      }).catch((err) => {
        tracker.finish('failed', { error: err && err.message ? err.message : String(err) });
        throw err;
      });
    }
    tracker.finish('done', successPayload(result));
    return result;
  } catch (err) {
    tracker.finish('failed', { error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

function listEvents(opts = {}) {
  pruneRecent(opts);
  const active = [...activeEvents.values()].map(snapshot);
  const recentLimit = Number(opts.recentLimit) >= 0 ? Number(opts.recentLimit) : DEFAULT_RECENT_LIMIT;
  const recent = recentEvents.slice(0, recentLimit);
  return {
    active,
    recent,
    events: [...active, ...recent],
    generatedAt: nowIso(),
  };
}

function resetForTests() {
  activeEvents.clear();
  recentEvents.splice(0);
}

module.exports = {
  listEvents,
  recordInstant,
  resetForTests,
  startEvent,
  trackEvent,
};
