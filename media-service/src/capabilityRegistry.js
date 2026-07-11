'use strict';

const entries = new Map();

function register(definition) {
  const capability = String(definition && definition.capability || '').trim();
  if (!capability || typeof definition.execute !== 'function') throw new TypeError('Capability definition requires capability and execute');
  if (entries.has(capability)) throw new Error(`Capability already registered: ${capability}`);
  const normalized = Object.freeze({
    capability,
    executorVersion: String(definition.executorVersion || 'v1'),
    idempotency: definition.idempotency || 'pure',
    sideEffect: !!definition.sideEffect,
    allowedTargetGates: Object.freeze([...(definition.allowedTargetGates || [])]),
    defaultResourceRequest: definition.defaultResourceRequest || null,
    execute: definition.execute,
  });
  entries.set(capability, normalized);
  return normalized;
}

function get(capability) { return entries.get(String(capability || '')) || null; }
function has(capability) { return entries.has(String(capability || '')); }
function list() { return [...entries.values()]; }
function resetForTests() { entries.clear(); }

module.exports = { register, get, has, list, resetForTests };
