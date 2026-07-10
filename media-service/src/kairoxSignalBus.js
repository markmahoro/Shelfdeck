'use strict';

const listeners = new Set();

function publish(signal = {}) {
  for (const listener of listeners) {
    try { listener({ ...signal, publishedAt: signal.publishedAt || new Date().toISOString() }); } catch (_) {}
  }
}

function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function resetForTests() { listeners.clear(); }

module.exports = { publish, subscribe, resetForTests };
