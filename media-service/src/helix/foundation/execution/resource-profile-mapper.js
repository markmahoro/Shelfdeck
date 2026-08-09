'use strict';

const PROFILE_KEYS = Object.freeze(['default', 'full']);
const OPAQUE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

class ResourceProfileError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ResourceProfileError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new ResourceProfileError(code, message, details); }

function exactObject(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code, 'Resource projection shape is not exact.');
}

function assertSlot(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P4_RESOURCE_PROFILE_SLOT_INVALID', 'Resource slot count must be a non-negative integer.', { field });
}

function indexEntries(entries, kind, fields) {
  if (!Array.isArray(entries)) fail('P4_RESOURCE_PROFILE_PROJECTION_INVALID', 'Resource projection lists are required.', { kind });
  const result = new Map();
  for (const entry of entries) {
    exactObject(entry, fields, 'P4_RESOURCE_PROFILE_ENTRY_SHAPE_MISMATCH');
    const keyField = fields[0];
    if (typeof entry[keyField] !== 'string' || !OPAQUE_KEY.test(entry[keyField]) || result.has(entry[keyField])) {
      fail('P4_RESOURCE_PROFILE_KEY_INVALID', 'Resource projection key must be unique opaque text.', { kind });
    }
    result.set(entry[keyField], Object.freeze({ ...entry }));
  }
  return result;
}

function createResourceProfileMapper(rawProjection) {
  exactObject(rawProjection, ['profileKey', 'profileRevision', 'logicalCpu', 'integrations', 'volumes', 'encoders', 'aiDevices', 'workers'],
    'P4_RESOURCE_PROFILE_PROJECTION_SHAPE_MISMATCH');
  if (!PROFILE_KEYS.includes(rawProjection.profileKey) || !Number.isSafeInteger(rawProjection.profileRevision) || rawProjection.profileRevision < 1) {
    fail('P4_RESOURCE_PROFILE_IDENTITY_INVALID', 'Resource Profile must be an exact versioned system Profile.');
  }
  assertSlot(rawProjection.logicalCpu, 'logicalCpu');
  if (rawProjection.logicalCpu < 1) fail('P4_RESOURCE_PROFILE_CPU_INVALID', 'At least one logical CPU must be reported.');
  const integrations = indexEntries(rawProjection.integrations, 'integration', ['endpointKey', 'providerMaxConcurrency']);
  const volumes = indexEntries(rawProjection.volumes, 'volume', ['volumeKey']);
  const encoders = indexEntries(rawProjection.encoders, 'encoder', ['deviceKey', 'enabled', 'validated', 'validatedConcurrentSlots']);
  const aiDevices = indexEntries(rawProjection.aiDevices, 'ai_device', ['deviceKey', 'enabled', 'validated', 'validatedConcurrentSlots']);
  const workers = indexEntries(rawProjection.workers, 'worker', ['nodeKey', 'enabled', 'validated', 'validatedAdvertisedSlots']);
  for (const entry of integrations.values()) assertSlot(entry.providerMaxConcurrency, 'providerMaxConcurrency');
  for (const [kind, entries, slotField] of [
    ['encoder', encoders, 'validatedConcurrentSlots'], ['ai_device', aiDevices, 'validatedConcurrentSlots'],
    ['worker', workers, 'validatedAdvertisedSlots']
  ]) for (const entry of entries.values()) {
    if (typeof entry.enabled !== 'boolean' || typeof entry.validated !== 'boolean') fail(
      'P4_RESOURCE_PROFILE_DEVICE_STATE_INVALID', 'Device state must be explicit booleans.', { kind }
    );
    assertSlot(entry[slotField], slotField);
  }
  const full = rawProjection.profileKey === 'full';

  function capacityFor(resourceKey) {
    if (resourceKey === 'control_plane' || resourceKey === 'sqlite_write' || resourceKey === 'control_commit') return 1;
    if (resourceKey === 'cpu_heavy') return full ? Math.min(4, Math.max(1, Math.floor(rawProjection.logicalCpu / 2))) : 1;
    const separator = resourceKey.indexOf(':');
    if (separator < 1 || separator === resourceKey.length - 1) fail('P4_RESOURCE_KEY_INVALID', 'Resource key is not a typed key.', { resourceKey });
    const kind = resourceKey.slice(0, separator);
    const key = resourceKey.slice(separator + 1);
    if (!OPAQUE_KEY.test(key)) fail('P4_RESOURCE_KEY_INVALID', 'Resource key suffix must be opaque platform identity.', { resourceKey });
    if (kind === 'capability') return full ? 2 : 1;
    if (kind === 'integration') {
      const entry = integrations.get(key); if (!entry) return 0;
      return Math.min(full ? 2 : 1, entry.providerMaxConcurrency);
    }
    if (['volume_read', 'volume_write', 'volume_mutation'].includes(kind)) {
      if (!volumes.has(key)) return 0;
      if (kind === 'volume_read') return full ? 4 : 2;
      if (kind === 'volume_write') return full ? 2 : 1;
      return 1;
    }
    if (kind === 'encoder' || kind === 'ai_device' || kind === 'worker') {
      const source = kind === 'encoder' ? encoders : kind === 'ai_device' ? aiDevices : workers;
      const entry = source.get(key);
      if (!entry || !entry.enabled || !entry.validated) return 0;
      const slots = kind === 'worker' ? entry.validatedAdvertisedSlots : entry.validatedConcurrentSlots;
      if (!full) return Math.min(1, slots);
      if (kind === 'encoder') return Math.min(2, slots);
      if (kind === 'ai_device') return Math.min(2, slots);
      return Math.min(4, slots);
    }
    fail('P4_RESOURCE_KEY_KIND_UNKNOWN', 'Resource key kind is outside the SSOT capacity map.', { resourceKey });
  }

  return Object.freeze({ profileKey: rawProjection.profileKey, profileRevision: rawProjection.profileRevision, capacityFor });
}

module.exports = Object.freeze({ PROFILE_KEYS, ResourceProfileError, createResourceProfileMapper });
