'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { BUSINESS_OWNERS, EFFECT_CLASSES } = require('../execution/runtime-contracts');

const SHARED_FOUNDATION_SCOPE = 'execution-foundation';
const OWNER_SCOPES = new Set([SHARED_FOUNDATION_SCOPE, ...BUSINESS_OWNERS]);

class CapabilityRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CapabilityRegistryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CapabilityRegistryError(code, message, details);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function createCapabilityRegistry(options) {
  if (!options || !Array.isArray(options.registrations) || !Array.isArray(options.expectedCapabilityRefs) ||
      options.registrations.length === 0 || options.expectedCapabilityRefs.length === 0) {
    fail('P4_CAPABILITY_REGISTRY_INPUT_REQUIRED', 'Registrations and exact expected Capability refs are required.');
  }
  const expected = [...options.expectedCapabilityRefs].sort();
  if (new Set(expected).size !== expected.length) fail('P4_CAPABILITY_EXPECTED_DUPLICATE', 'Expected Capability refs must be unique.');
  const entries = new Map();
  for (const registration of options.registrations) {
    const manifest = registration && registration.manifest;
    const executor = registration && registration.executor;
    const semantic = registration && registration.semanticValidator;
    if (!manifest || typeof manifest.capabilityRef !== 'string' || manifest.contractVersion !== 1 ||
        !OWNER_SCOPES.has(manifest.ownerScope) || !EFFECT_CLASSES.includes(manifest.effectClass) ||
        !manifest.executorCompatibility || !Number.isSafeInteger(manifest.executorCompatibility.minimumVersion) ||
        !executor || !Number.isSafeInteger(executor.version) || typeof executor.execute !== 'function' ||
        !semantic || semantic.ref !== manifest.semanticValidatorRef || typeof semantic.validateInputs !== 'function' ||
        typeof semantic.validateResult !== 'function') {
      fail('P4_CAPABILITY_INVALID_REGISTRATION', 'Capability registration must bind exact manifest, executor, and semantic validator.');
    }
    if (executor.version < manifest.executorCompatibility.minimumVersion) fail(
      'P4_CAPABILITY_EXECUTOR_VERSION_TOO_OLD', 'Executor does not satisfy the frozen minimum version.', { capabilityRef: manifest.capabilityRef }
    );
    if (entries.has(manifest.capabilityRef)) fail('P4_CAPABILITY_DUPLICATE_REGISTRATION', 'Capability ref may be registered once.', {
      capabilityRef: manifest.capabilityRef
    });
    entries.set(manifest.capabilityRef, Object.freeze({ manifest: Object.freeze(manifest), executor, semantic }));
  }
  const actual = [...entries.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('P4_CAPABILITY_REGISTRY_SET_MISMATCH', 'Runtime registry must exactly match the expected frozen Catalog.', {
    missing: expected.filter((ref) => !entries.has(ref)), unknown: actual.filter((ref) => !expected.includes(ref))
  });
  const snapshot = actual.map((capabilityRef) => {
    const entry = entries.get(capabilityRef);
    return Object.freeze({
      capabilityRef,
      contractVersion: entry.manifest.contractVersion,
      ownerScope: entry.manifest.ownerScope,
      effectClass: entry.manifest.effectClass,
      executorVersion: entry.executor.version,
      contractDigest: digest(JSON.stringify(canonical(entry.manifest)))
    });
  });
  return Object.freeze({
    size: entries.size,
    snapshot: Object.freeze(snapshot),
    viewFor(ownerDomain) {
      if (!BUSINESS_OWNERS.includes(ownerDomain)) fail('P4_CAPABILITY_INVALID_OWNER_VIEW', 'Catalog view requires a Business Owner.', { ownerDomain });
      return Object.freeze(snapshot.filter((entry) => entry.ownerScope === SHARED_FOUNDATION_SCOPE || entry.ownerScope === ownerDomain));
    },
    resolve(capabilityRef, ownerDomain) {
      if (!BUSINESS_OWNERS.includes(ownerDomain)) fail('P4_CAPABILITY_INVALID_OWNER_VIEW', 'Capability resolution requires a Business Owner.', { ownerDomain });
      const entry = entries.get(capabilityRef);
      if (!entry) fail('P4_CAPABILITY_NOT_REGISTERED', 'Exact Capability ref/version is not registered.', { capabilityRef });
      if (entry.manifest.ownerScope !== SHARED_FOUNDATION_SCOPE && entry.manifest.ownerScope !== ownerDomain) fail(
        'P4_CAPABILITY_NOT_VISIBLE', 'Capability is outside the requesting Domain Catalog view.', { capabilityRef, ownerDomain }
      );
      return entry;
    }
  });
}

module.exports = Object.freeze({ CapabilityRegistryError, createCapabilityRegistry });
