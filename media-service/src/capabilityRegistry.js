'use strict';

const entries = new Map();
const capabilityContract = require('./capabilityContract');

function register(definition) {
  const capability = String(definition && definition.capability || '').trim();
  if (!capability || typeof definition.execute !== 'function') throw new TypeError('Capability definition requires capability and execute');
  if (entries.has(capability)) throw new Error(`Capability already registered: ${capability}`);
  const contracts = capabilityContract.normalizeDefinition({ ...definition, capability });
  const normalized = Object.freeze({
    capability,
    ...contracts,
    executorVersion: String(definition.executorVersion || 'v1'),
    idempotency: contracts.effectKind,
    sideEffect: contracts.effectKind !== 'pure',
    allowedTargetGates: Object.freeze([...(definition.allowedTargetGates || [])]),
    defaultResourceRequest: definition.defaultResourceRequest || null,
    execute: definition.execute,
    cancel: typeof definition.cancel === 'function' ? definition.cancel : null,
  });
  entries.set(capability, normalized);
  return normalized;
}

function get(capability) { return entries.get(String(capability || '')) || null; }
function has(capability) { return entries.has(String(capability || '')); }
function list() { return [...entries.values()]; }
function inventory() { return list().map(({ execute, cancel, ...definition }) => ({ ...definition, cancellable: !!cancel })); }
function resetForTests() { entries.clear(); }

module.exports = { register, get, has, list, inventory, resetForTests };
