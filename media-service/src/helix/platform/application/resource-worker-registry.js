'use strict';

const PROFILE_KEYS = new Set(['default', 'full']);
const DEVICE_KINDS = new Set(['encoder', 'ai_device']);
const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/;

class ResourceWorkerRegistryError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ResourceWorkerRegistryError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new ResourceWorkerRegistryError(code, message, details); }
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(code, 'Platform resource value must match the exact contract.');
}
function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_RESOURCE_TOKEN', 'Platform resource token is invalid.', { field });
  return value;
}
function digest(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('P5_RESOURCE_DIGEST', 'Platform resource digest is invalid.', { field });
  return value;
}
function positive(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('P5_RESOURCE_NUMBER', 'Platform resource number is invalid.', { field });
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function createResourceWorkerRegistry(options) {
  if (!options || !options.repository || !options.probeVerifier || typeof options.probeVerifier.verifyDevice !== 'function' ||
      typeof options.probeVerifier.verifyWorker !== 'function' || typeof options.digest !== 'function' || typeof options.now !== 'function' ||
      typeof options.nextHandleId !== 'function' || !options.infrastructureProjection ||
      typeof options.infrastructureProjection.current !== 'function') fail('P5_RESOURCE_DEPENDENCIES', 'Resource/Worker Registry dependencies are required.');

  function publishProfile(request) {
    exact(request, ['logicalCpu', 'profileId', 'profileKey', 'publishedAtMs', 'revision'], 'P5_RESOURCE_PROFILE_SHAPE');
    token(request.profileId, 'profileId');
    if (!PROFILE_KEYS.has(request.profileKey)) fail('P5_RESOURCE_PROFILE_KEY', 'Only default and full Resource Profiles are supported.');
    positive(request.revision, 'revision', 1000000); positive(request.logicalCpu, 'logicalCpu', 4096);
    const profile = freeze({ profileId: request.profileId, profileKey: request.profileKey, revision: request.revision,
      logicalCpu: request.logicalCpu, profileDigest: options.digest(canonical({ profileKey: request.profileKey, logicalCpu: request.logicalCpu })),
      publishedAtMs: request.publishedAtMs });
    return options.repository.publishProfile(profile);
  }

  function publishOperatingPolicy(request) {
    exact(request, ['effectiveAtMs', 'immediateProfileKey', 'revision', 'schedule', 'scheduleDigest', 'timezone'], 'P5_RESOURCE_POLICY_SHAPE');
    if (!PROFILE_KEYS.has(request.immediateProfileKey) || typeof request.timezone !== 'string' || request.timezone.length < 1 || request.timezone.length > 128) {
      fail('P5_RESOURCE_POLICY_INVALID', 'Resource Operating Policy is invalid.');
    }
    positive(request.revision, 'revision', 1000000); digest(request.scheduleDigest, 'scheduleDigest');
    if (!request.schedule || typeof request.schedule !== 'object' || Array.isArray(request.schedule) ||
        Buffer.byteLength(canonical(request.schedule), 'utf8') > 16384 || options.digest(canonical(request.schedule)) !== request.scheduleDigest) {
      fail('P5_RESOURCE_POLICY_SCHEDULE', 'Resource Operating Policy schedule is invalid or has the wrong digest.');
    }
    if (!options.repository.getProfile(request.immediateProfileKey)) fail('P5_RESOURCE_POLICY_PROFILE_UNKNOWN', 'Operating Policy references an unpublished Profile.');
    return options.repository.publishOperatingPolicy(freeze({ ...request }));
  }

  function publishDevice(request) {
    exact(request, ['availability', 'capability', 'deviceId', 'deviceKind', 'enabled', 'probeEvidenceDigest', 'probedAtMs', 'revision',
      'stableDeviceKey', 'validatedConcurrentSlots'], 'P5_COMPUTE_DEVICE_SHAPE');
    token(request.deviceId, 'deviceId'); token(request.stableDeviceKey, 'stableDeviceKey');
    if (!DEVICE_KINDS.has(request.deviceKind) || typeof request.enabled !== 'boolean' || !['available', 'unavailable'].includes(request.availability) ||
        (request.enabled && request.availability !== 'available')) fail('P5_COMPUTE_DEVICE_KIND', 'Compute Device kind/state is invalid.');
    positive(request.revision, 'revision', 1000000); positive(request.validatedConcurrentSlots, 'validatedConcurrentSlots', 1024);
    digest(request.probeEvidenceDigest, 'probeEvidenceDigest');
    if (!request.capability || typeof request.capability !== 'object' || Array.isArray(request.capability) ||
        Buffer.byteLength(canonical(request.capability), 'utf8') > 16384) fail('P5_COMPUTE_DEVICE_CAPABILITY', 'Compute Device capability is invalid.');
    const capability = freeze({ details: request.capability, validatedConcurrentSlots: request.validatedConcurrentSlots });
    const capabilityDigest = options.digest(canonical(capability));
    const proposal = freeze({ deviceId: request.deviceId, deviceKind: request.deviceKind, stableDeviceKey: request.stableDeviceKey,
      revision: request.revision, enabled: request.enabled, state: request.availability, capability, capabilityDigest,
      probeEvidenceDigest: request.probeEvidenceDigest, validatedConcurrentSlots: request.validatedConcurrentSlots, probedAtMs: request.probedAtMs });
    if (options.probeVerifier.verifyDevice(proposal) !== true) fail('P5_COMPUTE_DEVICE_PROBE_REJECTED', 'Compute Device probe was not verified.');
    return options.repository.publishDevice(proposal);
  }

  function publishWorker(request) {
    exact(request, ['allowedOperations', 'capabilityDigest', 'devices', 'effectiveAtMs', 'endpointRef', 'healthState', 'name', 'protocolVersion', 'revision',
      'secretRef', 'workerId'], 'P5_WORKER_SHAPE');
    token(request.workerId, 'workerId'); token(request.name, 'name'); token(request.endpointRef, 'endpointRef');
    token(request.protocolVersion, 'protocolVersion'); token(request.secretRef, 'secretRef'); digest(request.capabilityDigest, 'capabilityDigest');
    positive(request.revision, 'revision', 1000000);
    if (!['healthy', 'offline'].includes(request.healthState)) fail('P5_WORKER_HEALTH', 'Worker health state is invalid.');
    if (!Array.isArray(request.allowedOperations) || request.allowedOperations.length < 1 || request.allowedOperations.length > 64 ||
        new Set(request.allowedOperations).size !== request.allowedOperations.length) fail('P5_WORKER_OPERATIONS', 'Worker operation list is invalid.');
    const allowedOperations = request.allowedOperations.map((operation) => token(operation, 'allowedOperation'));
    if (!Array.isArray(request.devices) || request.devices.length > 64) fail('P5_WORKER_DEVICES', 'Worker device list is invalid.');
    const seen = new Set();
    const devices = request.devices.map((item) => {
      exact(item, ['capabilityDigest', 'deviceKey', 'enabled', 'maxSlots'], 'P5_WORKER_DEVICE_SHAPE');
      token(item.deviceKey, 'deviceKey'); digest(item.capabilityDigest, 'capabilityDigest'); positive(item.maxSlots, 'maxSlots', 1024);
      if (seen.has(item.deviceKey) || typeof item.enabled !== 'boolean') fail('P5_WORKER_DEVICE_DUPLICATE', 'Worker device must be unique with explicit state.');
      seen.add(item.deviceKey); return freeze({ ...item });
    });
    const proposal = freeze({ workerId: request.workerId, name: request.name, status: request.healthState === 'healthy' ? 'active' : 'offline', revision: request.revision,
      endpointRef: request.endpointRef, protocolVersion: request.protocolVersion, secretRef: request.secretRef,
      capabilityDigest: request.capabilityDigest, allowedOperations, devices, health: request.healthState, effectiveAtMs: request.effectiveAtMs });
    if (options.probeVerifier.verifyWorker(proposal) !== true) fail('P5_WORKER_PROBE_REJECTED', 'Worker capability/health probe was not verified.');
    return options.repository.publishWorker(proposal);
  }

  function queryResourceProfile(request) {
    exact(request, ['expectedPolicyRevision'], 'P5_RESOURCE_QUERY_SHAPE');
    positive(request.expectedPolicyRevision, 'expectedPolicyRevision', 1000000);
    const policy = options.repository.getOperatingPolicy();
    if (!policy || policy.revision !== request.expectedPolicyRevision) fail('P5_RESOURCE_POLICY_STALE', 'Resource Operating Policy revision is stale.');
    const profile = options.repository.getProfile(policy.immediateProfileKey);
    if (!profile) fail('P5_RESOURCE_PROFILE_UNKNOWN', 'Current Resource Profile does not exist.');
    const devices = options.repository.listDevices();
    const workers = options.repository.listWorkers();
    const infrastructure = options.infrastructureProjection.current();
    exact(infrastructure, ['integrations', 'volumes'], 'P5_RESOURCE_INFRASTRUCTURE_SHAPE');
    return freeze({ profileKey: profile.profileKey, profileRevision: profile.revision, logicalCpu: profile.logicalCpu,
      integrations: infrastructure.integrations, volumes: infrastructure.volumes,
      encoders: devices.filter((item) => item.deviceKind === 'encoder').map(deviceProjection),
      aiDevices: devices.filter((item) => item.deviceKind === 'ai_device').map(deviceProjection),
      workers: workers.map((item) => ({ nodeKey: item.workerId, enabled: item.status === 'active', validated: item.health === 'healthy',
        validatedAdvertisedSlots: item.health === 'healthy' ? item.devices.filter((device) => device.enabled).reduce((sum, device) => sum + device.maxSlots, 0) : 0 })) });
  }

  function queryDevice(request) {
    exact(request, ['deviceId', 'expectedProbeRevision'], 'P5_COMPUTE_DEVICE_QUERY_SHAPE');
    const item = options.repository.getDevice(token(request.deviceId, 'deviceId'));
    if (!item || item.revision !== request.expectedProbeRevision) fail('P5_COMPUTE_DEVICE_STALE', 'Compute Device probe revision is stale.');
    return freeze({ ...item });
  }

  function resolveWorkerHandle(request) {
    exact(request, ['allowedOperation', 'expectedWorkerRevision', 'ttlMs', 'workerId'], 'P5_WORKER_HANDLE_REQUEST_SHAPE');
    const worker = options.repository.getWorker(token(request.workerId, 'workerId'));
    if (!worker || worker.status !== 'active' || worker.health !== 'healthy' || worker.revision !== request.expectedWorkerRevision) {
      fail('P5_WORKER_UNAVAILABLE', 'Worker is absent, stale, inactive, or unhealthy.');
    }
    token(request.allowedOperation, 'allowedOperation'); positive(request.ttlMs, 'ttlMs', 60000);
    if (!worker.allowedOperations.includes(request.allowedOperation)) fail('P5_WORKER_OPERATION_DENIED', 'Worker does not advertise the requested operation.');
    const expiresAtMs = options.now() + request.ttlMs;
    const fenceDigest = options.digest(canonical({ workerId: worker.workerId, workerRevision: worker.revision,
      capabilityDigest: worker.capabilityDigest, allowedOperation: request.allowedOperation, expiresAtMs }));
    return freeze({ schemaRef: 'helix://contracts/types/WorkerHandle/v1', schemaVersion: 1,
      handleId: token(options.nextHandleId(), 'handleId'), workerId: worker.workerId, workerRevision: worker.revision,
      protocolVersion: worker.protocolVersion, secretRef: worker.secretRef, capabilityDigest: worker.capabilityDigest,
      allowedOperation: request.allowedOperation, expiresAtMs, fenceDigest });
  }

  return freeze({ publishProfile, publishOperatingPolicy, publishDevice, publishWorker, queryResourceProfile, queryDevice, resolveWorkerHandle });
}

function deviceProjection(item) {
  const healthy = item.state === 'available';
  return { deviceKey: item.stableDeviceKey, enabled: item.enabled, validated: healthy,
    validatedConcurrentSlots: healthy ? item.validatedConcurrentSlots : 0 };
}

module.exports = Object.freeze({ ResourceWorkerRegistryError, createResourceWorkerRegistry });
