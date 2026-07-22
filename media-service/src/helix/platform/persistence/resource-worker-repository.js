'use strict';

const { createRepositoryDefinition } = require('../../foundation/persistence/owner-repository');

class ResourceWorkerRepositoryError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ResourceWorkerRepositoryError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new ResourceWorkerRepositoryError(code, message, details); }

function createResourceWorkerRepository(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' || typeof options.digest !== 'function') {
    fail('P5_RESOURCE_REPOSITORY_DEPENDENCIES', 'Schema manifest and Platform unit of work are required.');
  }
  const definition = createRepositoryDefinition({ repositoryId: 'platform_resource_worker_registry', owner: 'platform-settings',
    schemaManifest: options.schemaManifest, statements: {
      profile_head_find: { kind: 'select-one', tableId: 'platform_resource_profiles', columns: ['profile_id','profile_key','name','current_revision','status','created_at_ms','updated_at_ms'], keyColumns: ['profile_key'] },
      profile_head_insert: { kind: 'insert', tableId: 'platform_resource_profiles', columns: ['profile_id','profile_key','name','status','created_at_ms','updated_at_ms'] },
      profile_head_init: { kind: 'update', tableId: 'platform_resource_profiles', setColumns: ['current_revision','updated_at_ms'], keyColumns: ['profile_id'] },
      profile_head_advance: { kind: 'update', tableId: 'platform_resource_profiles', setColumns: ['current_revision','updated_at_ms'], keyColumns: ['profile_id'], compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] },
      profile_revision_find: { kind: 'select-one', tableId: 'platform_resource_profile_revisions', columns: ['profile_id','revision','profile_schema_ref','profile_json','profile_digest','published_at_ms'], keyColumns: ['profile_id','revision'] },
      profile_revision_insert: { kind: 'insert', tableId: 'platform_resource_profile_revisions', columns: ['profile_id','revision','profile_schema_ref','profile_json','profile_digest','published_at_ms'] },

      policy_head_find: { kind: 'select-one', tableId: 'platform_resource_operating_policy', columns: ['singleton_key','current_revision','updated_at_ms'], keyColumns: ['singleton_key'] },
      policy_head_insert: { kind: 'insert', tableId: 'platform_resource_operating_policy', columns: ['singleton_key','updated_at_ms'] },
      policy_head_init: { kind: 'update', tableId: 'platform_resource_operating_policy', setColumns: ['current_revision','updated_at_ms'], keyColumns: ['singleton_key'] },
      policy_head_advance: { kind: 'update', tableId: 'platform_resource_operating_policy', setColumns: ['current_revision','updated_at_ms'], keyColumns: ['singleton_key'], compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] },
      policy_revision_find: { kind: 'select-one', tableId: 'platform_resource_operating_revisions', columns: ['singleton_key','revision','immediate_profile_key','timezone','schedule_schema_ref','schedule_json','schedule_digest','effective_at_ms'], keyColumns: ['singleton_key','revision'] },
      policy_revision_insert: { kind: 'insert', tableId: 'platform_resource_operating_revisions', columns: ['singleton_key','revision','immediate_profile_key','timezone','schedule_schema_ref','schedule_json','schedule_digest','effective_at_ms'] },

      device_head_find: { kind: 'select-one', tableId: 'platform_compute_devices', columns: ['device_id','device_kind','stable_device_key','current_probe_revision','enabled','state','updated_at_ms'], keyColumns: ['device_id'] },
      device_heads_list: { kind: 'select-all', tableId: 'platform_compute_devices', columns: ['device_id','device_kind','stable_device_key','current_probe_revision','enabled','state','updated_at_ms'] },
      device_head_insert: { kind: 'insert', tableId: 'platform_compute_devices', columns: ['device_id','device_kind','stable_device_key','enabled','state','updated_at_ms'] },
      device_head_init: { kind: 'update', tableId: 'platform_compute_devices', setColumns: ['current_probe_revision','enabled','state','updated_at_ms'], keyColumns: ['device_id'] },
      device_head_advance: { kind: 'update', tableId: 'platform_compute_devices', setColumns: ['current_probe_revision','enabled','state','updated_at_ms'], keyColumns: ['device_id'], compareColumns: [{ column: 'current_probe_revision', parameter: 'expected_current_probe_revision' }] },
      device_probe_find: { kind: 'select-one', tableId: 'platform_compute_device_probes', columns: ['device_id','revision','capability_schema_ref','capability_json','capability_digest','probe_result','probed_at_ms'], keyColumns: ['device_id','revision'] },
      device_probe_insert: { kind: 'insert', tableId: 'platform_compute_device_probes', columns: ['device_id','revision','capability_schema_ref','capability_json','capability_digest','probe_result','probed_at_ms'] },

      worker_head_find: { kind: 'select-one', tableId: 'platform_workers', columns: ['worker_id','name','status','current_revision','created_at_ms','terminal_at_ms'], keyColumns: ['worker_id'] },
      worker_heads_list: { kind: 'select-all', tableId: 'platform_workers', columns: ['worker_id','name','status','current_revision','created_at_ms','terminal_at_ms'] },
      worker_head_insert: { kind: 'insert', tableId: 'platform_workers', columns: ['worker_id','name','status','created_at_ms'] },
      worker_head_init: { kind: 'update', tableId: 'platform_workers', setColumns: ['current_revision','name','status'], keyColumns: ['worker_id'] },
      worker_head_advance: { kind: 'update', tableId: 'platform_workers', setColumns: ['current_revision','name','status'], keyColumns: ['worker_id'], compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] },
      worker_revision_find: { kind: 'select-one', tableId: 'platform_worker_revisions', columns: ['worker_id','revision','endpoint','protocol_version','config_schema_ref','config_json','config_digest','secret_ref','capability_digest','effective_at_ms'], keyColumns: ['worker_id','revision'] },
      worker_revision_insert: { kind: 'insert', tableId: 'platform_worker_revisions', columns: ['worker_id','revision','endpoint','protocol_version','config_schema_ref','config_json','config_digest','secret_ref','capability_digest','effective_at_ms'] },
      worker_devices_list: { kind: 'select-all', tableId: 'platform_worker_devices', columns: ['worker_id','worker_revision','device_key','capability_digest','enabled','max_slots'], keyColumns: ['worker_id','worker_revision'] },
      worker_device_insert: { kind: 'insert', tableId: 'platform_worker_devices', columns: ['worker_id','worker_revision','device_key','capability_digest','enabled','max_slots'] }
    } });

  function execute(body) { return options.unitOfWork.execute([{ participantId: definition.repositoryId, owner: 'platform-settings', repositories: [definition], execute: body }])[definition.repositoryId]; }
  function repository(context) { return context.repository(definition.repositoryId); }

  function getProfile(profileKey) {
    return execute((context) => {
      const repo = repository(context); const head = repo.invoke('profile_head_find', { profile_key: profileKey });
      return head && mapProfile(head, repo.invoke('profile_revision_find', { profile_id: head.profile_id, revision: head.current_revision }));
    });
  }
  function publishProfile(item) {
    return execute((context) => {
      const repo = repository(context); const head = repo.invoke('profile_head_find', { profile_key: item.profileKey });
      if (!head) {
        if (item.revision !== 1) fail('P5_RESOURCE_PROFILE_INITIAL_REVISION', 'Resource Profile must start at revision 1.');
        repo.invoke('profile_head_insert', { profile_id: item.profileId, profile_key: item.profileKey, name: item.profileKey,
          status: 'active', created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs });
      } else if (head.profile_id !== item.profileId || item.revision !== head.current_revision + 1) {
        fail('P5_RESOURCE_PROFILE_REVISION_CONFLICT', 'Resource Profile revision does not advance the same aggregate.');
      }
      repo.invoke('profile_revision_insert', { profile_id: item.profileId, revision: item.revision,
        profile_schema_ref: 'helix://platform/resource-profile/v1', profile_json: JSON.stringify({ logicalCpu: item.logicalCpu }),
        profile_digest: item.profileDigest, published_at_ms: item.publishedAtMs });
      const result = repo.invoke(head ? 'profile_head_advance' : 'profile_head_init', { profile_id: item.profileId,
        current_revision: item.revision, updated_at_ms: context.commitTimeMs,
        ...(head ? { expected_current_revision: head.current_revision } : {}) });
      if (result.changes !== 1) fail('P5_RESOURCE_PROFILE_REVISION_CONFLICT', 'Resource Profile changed concurrently.');
      return item;
    });
  }

  function getOperatingPolicy() {
    return execute((context) => {
      const repo = repository(context); const head = repo.invoke('policy_head_find', { singleton_key: 'resource-operating-policy' });
      return head && mapPolicy(repo.invoke('policy_revision_find', { singleton_key: head.singleton_key, revision: head.current_revision }));
    });
  }
  function publishOperatingPolicy(item) {
    return execute((context) => {
      const repo = repository(context); const key = 'resource-operating-policy';
      const head = repo.invoke('policy_head_find', { singleton_key: key });
      if ((!head && item.revision !== 1) || (head && item.revision !== head.current_revision + 1)) fail('P5_RESOURCE_POLICY_REVISION_CONFLICT', 'Operating Policy revision is not current+1.');
      if (!head) repo.invoke('policy_head_insert', { singleton_key: key, updated_at_ms: context.commitTimeMs });
      repo.invoke('policy_revision_insert', { singleton_key: key, revision: item.revision, immediate_profile_key: item.immediateProfileKey,
        timezone: item.timezone, schedule_schema_ref: 'helix://platform/resource-schedule/v1', schedule_json: JSON.stringify(item.schedule),
        schedule_digest: item.scheduleDigest, effective_at_ms: item.effectiveAtMs });
      const result = repo.invoke(head ? 'policy_head_advance' : 'policy_head_init', { singleton_key: key, current_revision: item.revision,
        updated_at_ms: context.commitTimeMs, ...(head ? { expected_current_revision: head.current_revision } : {}) });
      if (result.changes !== 1) fail('P5_RESOURCE_POLICY_REVISION_CONFLICT', 'Operating Policy changed concurrently.');
      return item;
    });
  }

  function getDevice(deviceId) { return execute((context) => currentDevice(repository(context), deviceId)); }
  function listDevices() { return execute((context) => { const repo = repository(context); return repo.invoke('device_heads_list').map((head) => currentDevice(repo, head.device_id)); }); }
  function publishDevice(item) {
    return execute((context) => {
      const repo = repository(context); const head = repo.invoke('device_head_find', { device_id: item.deviceId });
      const duplicate = repo.invoke('device_heads_list').find((row) => row.device_id !== item.deviceId && row.stable_device_key === item.stableDeviceKey);
      if (duplicate) fail('P5_COMPUTE_DEVICE_KEY_CONFLICT', 'Stable Compute Device key belongs to another aggregate.');
      if ((!head && item.revision !== 1) || (head && (head.stable_device_key !== item.stableDeviceKey || item.revision !== head.current_probe_revision + 1))) {
        fail('P5_COMPUTE_DEVICE_REVISION_CONFLICT', 'Compute Device probe revision is invalid.');
      }
      if (!head) repo.invoke('device_head_insert', { device_id: item.deviceId, device_kind: item.deviceKind,
        stable_device_key: item.stableDeviceKey, enabled: item.enabled ? 1 : 0, state: item.state, updated_at_ms: context.commitTimeMs });
      repo.invoke('device_probe_insert', { device_id: item.deviceId, revision: item.revision,
        capability_schema_ref: 'helix://platform/compute-device-capability/v1', capability_json: JSON.stringify(item.capability),
        capability_digest: item.capabilityDigest, probe_result: item.probeResult, probed_at_ms: item.probedAtMs });
      const result = repo.invoke(head ? 'device_head_advance' : 'device_head_init', { device_id: item.deviceId,
        current_probe_revision: item.revision, enabled: item.enabled ? 1 : 0, state: item.state, updated_at_ms: context.commitTimeMs,
        ...(head ? { expected_current_probe_revision: head.current_probe_revision } : {}) });
      if (result.changes !== 1) fail('P5_COMPUTE_DEVICE_REVISION_CONFLICT', 'Compute Device changed concurrently.');
      return item;
    });
  }

  function getWorker(workerId) { return execute((context) => currentWorker(repository(context), workerId)); }
  function listWorkers() { return execute((context) => { const repo = repository(context); return repo.invoke('worker_heads_list').map((head) => currentWorker(repo, head.worker_id)); }); }
  function publishWorker(item) {
    return execute((context) => {
      const repo = repository(context); const head = repo.invoke('worker_head_find', { worker_id: item.workerId });
      if ((!head && item.revision !== 1) || (head && item.revision !== head.current_revision + 1)) fail('P5_WORKER_REVISION_CONFLICT', 'Worker revision is not current+1.');
      if (!head) repo.invoke('worker_head_insert', { worker_id: item.workerId, name: item.name, status: item.status, created_at_ms: context.commitTimeMs });
      const config = { allowedOperations: item.allowedOperations };
      repo.invoke('worker_revision_insert', { worker_id: item.workerId, revision: item.revision, endpoint: item.endpointRef,
        protocol_version: item.protocolVersion, config_schema_ref: 'helix://platform/worker-config/v1', config_json: JSON.stringify(config),
        config_digest: options.digest(JSON.stringify(config)),
        secret_ref: item.secretRef, capability_digest: item.capabilityDigest, effective_at_ms: item.effectiveAtMs });
      for (const device of item.devices) repo.invoke('worker_device_insert', { worker_id: item.workerId, worker_revision: item.revision,
        device_key: device.deviceKey, capability_digest: device.capabilityDigest, enabled: device.enabled ? 1 : 0, max_slots: device.maxSlots });
      const result = repo.invoke(head ? 'worker_head_advance' : 'worker_head_init', { worker_id: item.workerId,
        current_revision: item.revision, name: item.name, status: item.status, ...(head ? { expected_current_revision: head.current_revision } : {}) });
      if (result.changes !== 1) fail('P5_WORKER_REVISION_CONFLICT', 'Worker changed concurrently.');
      return item;
    });
  }

  return Object.freeze({ publishProfile, getProfile, publishOperatingPolicy, getOperatingPolicy,
    publishDevice, getDevice, listDevices, publishWorker, getWorker, listWorkers });
}

function mapProfile(head, revision) { if (!revision) return undefined; const json = JSON.parse(revision.profile_json); return Object.freeze({
  profileId: head.profile_id, profileKey: head.profile_key, revision: revision.revision, logicalCpu: json.logicalCpu,
  profileDigest: revision.profile_digest, publishedAtMs: revision.published_at_ms }); }
function mapPolicy(row) { if (!row) return undefined; return Object.freeze({ revision: row.revision, immediateProfileKey: row.immediate_profile_key,
  timezone: row.timezone, schedule: JSON.parse(row.schedule_json), scheduleDigest: row.schedule_digest, effectiveAtMs: row.effective_at_ms }); }
function currentDevice(repo, deviceId) { const head = repo.invoke('device_head_find', { device_id: deviceId }); if (!head) return undefined;
  const probe = repo.invoke('device_probe_find', { device_id: deviceId, revision: head.current_probe_revision }); return Object.freeze({
    deviceId: head.device_id, deviceKind: head.device_kind, stableDeviceKey: head.stable_device_key, revision: probe.revision,
    enabled: head.enabled === 1, state: head.state, capability: JSON.parse(probe.capability_json), capabilityDigest: probe.capability_digest,
    probeResult: probe.probe_result, validatedConcurrentSlots: JSON.parse(probe.capability_json).validatedConcurrentSlots,
    probedAtMs: probe.probed_at_ms }); }
function currentWorker(repo, workerId) { const head = repo.invoke('worker_head_find', { worker_id: workerId }); if (!head) return undefined;
  const revision = repo.invoke('worker_revision_find', { worker_id: workerId, revision: head.current_revision });
  const config = JSON.parse(revision.config_json); const devices = repo.invoke('worker_devices_list', { worker_id: workerId, worker_revision: head.current_revision });
  return Object.freeze({ workerId: head.worker_id, name: head.name, status: head.status, health: head.status === 'active' ? 'healthy' : 'unhealthy',
    revision: revision.revision, endpointRef: revision.endpoint, protocolVersion: revision.protocol_version, secretRef: revision.secret_ref,
    capabilityDigest: revision.capability_digest, allowedOperations: Object.freeze(config.allowedOperations),
    devices: Object.freeze(devices.map((item) => Object.freeze({ deviceKey: item.device_key, capabilityDigest: item.capability_digest,
      enabled: item.enabled === 1, maxSlots: item.max_slots }))), effectiveAtMs: revision.effective_at_ms }); }

module.exports = Object.freeze({ ResourceWorkerRepositoryError, createResourceWorkerRepository });
