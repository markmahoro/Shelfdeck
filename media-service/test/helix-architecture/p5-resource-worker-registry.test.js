'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

const { createResourceWorkerRegistry } = require('../../src/helix/platform/application/resource-worker-registry');
const { createResourceWorkerRepository } = require('../../src/helix/platform/persistence/resource-worker-repository');
const { createResourceProfileMapper } = require('../../src/helix/foundation/execution/resource-profile-mapper');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const SHA = 'a'.repeat(64);
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function repository() {
  const profiles = new Map(); const devices = new Map(); const workers = new Map(); let policy;
  return {
    publishProfile(item) { const old = profiles.get(item.profileKey); if (old && item.revision !== old.revision + 1) throw Object.assign(new Error(), { code: 'REVISION' }); profiles.set(item.profileKey, item); return item; },
    getProfile(key) { return profiles.get(key); },
    publishOperatingPolicy(item) { if (policy && item.revision !== policy.revision + 1) throw Object.assign(new Error(), { code: 'REVISION' }); policy = item; return item; },
    getOperatingPolicy() { return policy; },
    publishDevice(item) { const old = devices.get(item.deviceId); if (old && item.revision !== old.revision + 1) throw Object.assign(new Error(), { code: 'REVISION' });
      if ([...devices.values()].some((other) => other.deviceId !== item.deviceId && other.stableDeviceKey === item.stableDeviceKey)) throw Object.assign(new Error(), { code: 'DUPLICATE' });
      devices.set(item.deviceId, item); return item; },
    getDevice(id) { return devices.get(id); }, listDevices() { return [...devices.values()]; },
    publishWorker(item) { const old = workers.get(item.workerId); if (old && item.revision !== old.revision + 1) throw Object.assign(new Error(), { code: 'REVISION' }); workers.set(item.workerId, item); return item; },
    getWorker(id) { return workers.get(id); }, listWorkers() { return [...workers.values()]; }
  };
}
function fixture(changes = {}) {
  let handle = 0;
  const repo = repository();
  const probes = { rejectDevice: false, rejectWorker: false };
  const service = createResourceWorkerRegistry({ repository: repo, digest, now: () => 1000, nextHandleId: () => 'worker-handle-' + (++handle),
    probeVerifier: { verifyDevice: () => !probes.rejectDevice, verifyWorker: () => !probes.rejectWorker },
    infrastructureProjection: { current: () => ({ integrations: [{ endpointKey: 'tmdb-1', providerMaxConcurrency: 2 }], volumes: [{ volumeKey: 'volume-1' }] }) },
    ...changes });
  return { service, repo, probes };
}
function persistentFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-resource-worker-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
  const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
  const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
  let now = 100;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const repo = createResourceWorkerRepository({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }), digest });
  let handle = 0;
  const service = createResourceWorkerRegistry({ repository: repo, digest, now: () => 1000, nextHandleId: () => 'handle-' + (++handle),
    probeVerifier: { verifyDevice: () => true, verifyWorker: () => true },
    infrastructureProjection: { current: () => ({ integrations: [], volumes: [] }) } });
  try { return run({ databasePath, repo, service }); } finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
function seed(service) {
  service.publishProfile({ profileId: 'profile-default', profileKey: 'default', revision: 1, logicalCpu: 8, publishedAtMs: 1 });
  service.publishProfile({ profileId: 'profile-full', profileKey: 'full', revision: 1, logicalCpu: 8, publishedAtMs: 1 });
  service.publishOperatingPolicy({ revision: 1, immediateProfileKey: 'default', timezone: 'Asia/Shanghai', schedule: {}, scheduleDigest: digest('{}'), effectiveAtMs: 1 });
  service.publishDevice({ deviceId: 'encoder-1', deviceKind: 'nvidia_nvenc', stableDeviceKey: 'nvenc-1', revision: 1, availability: 'available', enabled: true,
    validatedConcurrentSlots: 3, capability: { supportedVideoCodecs: ['hevc'], supportedRateControlModes: ['target_size', 'quality_bound'] }, probeResult: 'passed', probedAtMs: 1 });
  service.publishWorker({ workerId: 'worker-1', name: 'Worker-1', revision: 1, healthState: 'healthy', endpointRef: 'endpoint-worker-1', protocolVersion: 'worker-v1',
    secretRef: 'secret-worker-1', capabilityDigest: SHA, allowedOperations: ['asset.register@1'], effectiveAtMs: 1,
    devices: [{ deviceKey: 'worker-gpu-1', capabilityDigest: SHA, enabled: true, maxSlots: 2 }] });
}

test('P5 Resource Profile projection feeds the existing P4 mapper without owning permits', () => {
  const { service } = fixture(); seed(service);
  const projection = service.queryResourceProfile({ expectedPolicyRevision: 1 });
  const mapper = createResourceProfileMapper(projection);
  assert.equal(mapper.capacityFor('cpu_heavy'), 1);
  assert.equal(mapper.capacityFor('encoder:nvenc-1'), 1);
  assert.equal(mapper.capacityFor('worker:worker-1'), 1);
  assert.equal(mapper.capacityFor('integration:tmdb-1'), 1);
  assert.equal(mapper.capacityFor('volume_write:volume-1'), 1);
  assert.equal(mapper.capacityFor('worker:unknown'), 0);
  assert.equal(Object.hasOwn(service, 'acquire'), false);
});

test('full profile changes only P4 capacity mapping, not Worker or Device ownership', () => {
  const { service } = fixture(); seed(service);
  service.publishOperatingPolicy({ revision: 2, immediateProfileKey: 'full', timezone: 'Asia/Shanghai', schedule: {}, scheduleDigest: digest('{}'), effectiveAtMs: 2 });
  const mapper = createResourceProfileMapper(service.queryResourceProfile({ expectedPolicyRevision: 2 }));
  assert.equal(mapper.capacityFor('encoder:nvenc-1'), 2);
  assert.equal(mapper.capacityFor('worker:worker-1'), 2);
  assert.equal(mapper.capacityFor('cpu_heavy'), 4);
});

test('unverified devices and workers are rejected before Registry publication', () => {
  const { service, probes } = fixture();
  probes.rejectDevice = true;
  assert.throws(() => service.publishDevice({ deviceId: 'device-1', deviceKind: 'nvidia_nvenc', stableDeviceKey: 'gpu-1', revision: 1, availability: 'available',
    enabled: true, validatedConcurrentSlots: 1, capability: { supportedVideoCodecs: ['hevc'], supportedRateControlModes: ['target_size'] }, probeResult: 'passed', probedAtMs: 1 }),
  (error) => error.code === 'P5_COMPUTE_DEVICE_PROBE_REJECTED');
  probes.rejectWorker = true;
  assert.throws(() => service.publishWorker({ workerId: 'worker-1', name: 'Worker-1', revision: 1, healthState: 'healthy', endpointRef: 'endpoint-1', protocolVersion: 'v1',
    secretRef: 'secret-1', capabilityDigest: SHA, allowedOperations: ['asset.register@1'], effectiveAtMs: 1, devices: [] }),
  (error) => error.code === 'P5_WORKER_PROBE_REJECTED');
});

test('WorkerHandle freezes active revision, operation, secret ref, capability and expiry', () => {
  const { service } = fixture(); seed(service);
  const handle = service.resolveWorkerHandle({ workerId: 'worker-1', expectedWorkerRevision: 1, allowedOperation: 'asset.register@1', ttlMs: 5000 });
  assert.equal(handle.schemaRef, 'helix://contracts/types/WorkerHandle/v1');
  assert.equal(handle.workerRevision, 1);
  assert.equal(handle.secretRef, 'secret-worker-1');
  assert.equal(handle.expiresAtMs, 6000);
  assert.match(handle.fenceDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(handle), true);
});

test('stale policy/device/worker revisions and unadvertised operation fail closed', () => {
  const { service } = fixture(); seed(service);
  assert.throws(() => service.queryResourceProfile({ expectedPolicyRevision: 2 }), (error) => error.code === 'P5_RESOURCE_POLICY_STALE');
  assert.throws(() => service.queryDevice({ deviceId: 'encoder-1', expectedProbeRevision: 2 }), (error) => error.code === 'P5_COMPUTE_DEVICE_STALE');
  assert.throws(() => service.resolveWorkerHandle({ workerId: 'worker-1', expectedWorkerRevision: 2, allowedOperation: 'asset.register@1', ttlMs: 1 }),
    (error) => error.code === 'P5_WORKER_UNAVAILABLE');
  assert.throws(() => service.resolveWorkerHandle({ workerId: 'worker-1', expectedWorkerRevision: 1, allowedOperation: 'raw.command', ttlMs: 1 }),
    (error) => error.code === 'P5_WORKER_OPERATION_DENIED');
});

test('persisted unavailable Device and offline Worker contribute zero capacity and cannot issue handles', () => {
  const { service } = fixture(); seed(service);
  service.publishDevice({ deviceId: 'encoder-1', deviceKind: 'nvidia_nvenc', stableDeviceKey: 'nvenc-1', revision: 2,
    availability: 'unavailable', enabled: false, validatedConcurrentSlots: 3,
    capability: { supportedVideoCodecs: ['hevc'], supportedRateControlModes: ['target_size', 'quality_bound'] },
    probeResult: 'passed', probedAtMs: 2 });
  service.publishWorker({ workerId: 'worker-1', name: 'Worker-1', revision: 2, healthState: 'offline',
    endpointRef: 'endpoint-worker-1', protocolVersion: 'worker-v1', secretRef: 'secret-worker-1', capabilityDigest: SHA,
    allowedOperations: ['asset.register@1'], effectiveAtMs: 2,
    devices: [{ deviceKey: 'worker-gpu-1', capabilityDigest: SHA, enabled: true, maxSlots: 2 }] });
  const mapper = createResourceProfileMapper(service.queryResourceProfile({ expectedPolicyRevision: 1 }));
  assert.equal(mapper.capacityFor('encoder:nvenc-1'), 0);
  assert.equal(mapper.capacityFor('worker:worker-1'), 0);
  assert.throws(() => service.resolveWorkerHandle({ workerId: 'worker-1', expectedWorkerRevision: 2,
    allowedOperation: 'asset.register@1', ttlMs: 100 }), (error) => error.code === 'P5_WORKER_UNAVAILABLE');
});

test('P3 Platform Repository atomically advances immutable Profile, Device, Policy, and Worker revisions', () => {
  persistentFixture(({ databasePath, service }) => {
    seed(service);
    service.publishProfile({ profileId: 'profile-default', profileKey: 'default', revision: 2, logicalCpu: 12, publishedAtMs: 2 });
    service.publishDevice({ deviceId: 'encoder-1', deviceKind: 'nvidia_nvenc', stableDeviceKey: 'nvenc-1', revision: 2, availability: 'available', enabled: true,
      validatedConcurrentSlots: 4, capability: { supportedVideoCodecs: ['hevc'], supportedRateControlModes: ['target_size', 'quality_bound'] }, probeResult: 'passed', probedAtMs: 2 });
    service.publishWorker({ workerId: 'worker-1', name: 'Worker-1', revision: 2, healthState: 'healthy', endpointRef: 'endpoint-worker-1', protocolVersion: 'worker-v1',
      secretRef: 'secret-worker-1', capabilityDigest: SHA, allowedOperations: ['asset.register@1'], effectiveAtMs: 2,
      devices: [{ deviceKey: 'worker-gpu-1', capabilityDigest: SHA, enabled: true, maxSlots: 3 }] });
    assert.equal(service.queryResourceProfile({ expectedPolicyRevision: 1 }).logicalCpu, 12);
    assert.equal(service.queryDevice({ deviceId: 'encoder-1', expectedProbeRevision: 2 }).validatedConcurrentSlots, 4);
    assert.equal(service.resolveWorkerHandle({ workerId: 'worker-1', expectedWorkerRevision: 2,
      allowedOperation: 'asset.register@1', ttlMs: 100 }).workerRevision, 2);

    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT count(*) AS n FROM platform_resource_profile_revisions').get().n, 3);
    assert.equal(inspected.prepare('SELECT count(*) AS n FROM platform_compute_device_probes').get().n, 2);
    assert.equal(inspected.prepare('SELECT count(*) AS n FROM platform_worker_revisions').get().n, 2);
    assert.equal(inspected.prepare('SELECT current_revision FROM platform_workers WHERE worker_id=?').get('worker-1').current_revision, 2);
    inspected.close();
  });
});

test('reads one exact P9 MediaExecutionDeviceSnapshot without current/latest fallback',()=>{
  const {service}=fixture();seed(service);const query={deviceId:'encoder-1',expectedProbeRevision:1};
  query.queryDigest=canonicalDigest(query);const found=service.readDeviceSnapshot(query);
  assert.equal(found.resultKind,'found');assert.equal(found.snapshot.deviceClass,'nvidia_nvenc');assert.equal(found.snapshot.state,'ready');
  const stale={...query,expectedProbeRevision:2};stale.queryDigest=canonicalDigest({deviceId:stale.deviceId,expectedProbeRevision:2});
  assert.equal(service.readDeviceSnapshot(stale).reasonCode,'device_probe_changed');
});

test('lists only bounded ready device refs without applying Planner preference',()=>{
  const {service}=fixture();seed(service);
  service.publishDevice({deviceId:'cpu-1',deviceKind:'software_cpu',stableDeviceKey:'cpu-1',revision:1,availability:'available',enabled:true,
    validatedConcurrentSlots:1,capability:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['two_pass_abr','strict_abr']},
    probeResult:'passed',probedAtMs:1});
  const query={queryContract:'platform.compute-ready-device-refs@1',limit:64};query.queryDigest=canonicalDigest(query);
  const result=service.listReadyDeviceRefs(query);
  assert.equal(result.resultKind,'available');assert.deepEqual(result.items.map((item)=>item.deviceClass),['nvidia_nvenc','software_cpu']);
  assert.ok(result.items.every((item)=>item.refDigest===canonicalDigest(Object.fromEntries(Object.entries(item).filter(([key])=>key!=='refDigest')))));
});
