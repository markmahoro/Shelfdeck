'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createResourceProfileMapper } = require('../../src/helix/foundation/execution/resource-profile-mapper');
const { volumeReadUnitsForCapability } = require('../../src/helix/composition/create-procurement-execution-runtime');

function projection(profileKey) {
  return {
    profileKey, profileRevision: 3, logicalCpu: 12,
    integrations: [{ endpointKey: 'emby-main', providerMaxConcurrency: 1 }, { endpointKey: 'tmdb', providerMaxConcurrency: 8 }],
    volumes: [{ volumeKey: 'nas-a' }],
    encoders: [{ deviceKey: 'gpu-ok', enabled: true, validated: true, validatedConcurrentSlots: 5 },
      { deviceKey: 'gpu-unprobed', enabled: true, validated: false, validatedConcurrentSlots: 5 }],
    aiDevices: [{ deviceKey: 'ai-ok', enabled: true, validated: true, validatedConcurrentSlots: 5 }],
    workers: [{ nodeKey: 'worker-ok', enabled: true, validated: true, validatedAdvertisedSlots: 9 }]
  };
}

test('default Profile preserves exact conservative capacities and single writers', () => {
  const mapper = createResourceProfileMapper(projection('default'));
  assert.deepEqual(['control_plane', 'sqlite_write', 'control_commit', 'cpu_heavy'].map((key) => mapper.capacityFor(key)), [1, 1, 1, 1]);
  assert.deepEqual(['volume_read:nas-a', 'volume_write:nas-a', 'volume_mutation:nas-a'].map((key) => mapper.capacityFor(key)), [2, 1, 1]);
  assert.deepEqual(['integration:tmdb', 'encoder:gpu-ok', 'ai_device:ai-ok', 'worker:worker-ok'].map((key) => mapper.capacityFor(key)), [1, 1, 1, 1]);
});

test('full Profile applies exact caps without exceeding Provider or validated slots', () => {
  const mapper = createResourceProfileMapper(projection('full'));
  assert.equal(mapper.capacityFor('cpu_heavy'), 4);
  assert.equal(mapper.capacityFor('integration:emby-main'), 1);
  assert.equal(mapper.capacityFor('integration:tmdb'), 2);
  assert.deepEqual(['volume_read:nas-a', 'volume_write:nas-a', 'volume_mutation:nas-a'].map((key) => mapper.capacityFor(key)), [4, 2, 1]);
  assert.deepEqual(['encoder:gpu-ok', 'ai_device:ai-ok', 'worker:worker-ok'].map((key) => mapper.capacityFor(key)), [2, 2, 4]);
});

test('unknown or unvalidated resources have zero capacity and unknown kinds fail closed', () => {
  const mapper = createResourceProfileMapper(projection('full'));
  assert.equal(mapper.capacityFor('encoder:gpu-unprobed'), 0);
  assert.equal(mapper.capacityFor('encoder:missing'), 0);
  assert.equal(mapper.capacityFor('volume_read:missing'), 0);
  assert.throws(() => mapper.capacityFor('disk:C:\\media'), { code: 'P4_RESOURCE_KEY_INVALID' });
  assert.throws(() => mapper.capacityFor('mystery:thing'), { code: 'P4_RESOURCE_KEY_KIND_UNKNOWN' });
});

test('Transcode input preflight reserves the full default volume read capacity', () => {
  assert.equal(volumeReadUnitsForCapability('libra.transcode.input.verify@1'), 2);
  assert.equal(volumeReadUnitsForCapability('libra.product_media.verify@1'), 1);
  assert.equal(volumeReadUnitsForCapability('shared.material.media.probe@1'), 1);
});

test('Acceptance Spec execution is a bounded completion stage ahead of production expansion', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  assert.match(source, /processType==='libra_acceptance_spec'[\s\S]*?priorityClass:'normal_foreground',localPriority:230,priorityRevision:1,supplyRole:'completion'/);
});

test('Profile projection is exact, versioned, bounded and duplicate-free', () => {
  assert.throws(() => createResourceProfileMapper({ ...projection('pause'), extra: true }), { code: 'P4_RESOURCE_PROFILE_PROJECTION_SHAPE_MISMATCH' });
  assert.throws(() => createResourceProfileMapper(projection('pause')), { code: 'P4_RESOURCE_PROFILE_IDENTITY_INVALID' });
  const duplicate = projection('default'); duplicate.volumes.push({ volumeKey: 'nas-a' });
  assert.throws(() => createResourceProfileMapper(duplicate), { code: 'P4_RESOURCE_PROFILE_KEY_INVALID' });
});

test('Profile mapper source cannot change Plan, priority, Outcome, authorization, or Control', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/resource-profile-mapper.js'), 'utf8').toLowerCase();
  for (const forbidden of ['workflow_plan', 'priority_class', 'outcome_kind', 'authorization', 'material_control', '../domains']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
