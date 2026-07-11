'use strict';

const test = require('node:test');
const assert = require('node:assert');

const transcodeFlowExecutor = require('../src/transcodeDevicePlan');
const transcodeService = require('../src/services/transcodeService');

test('Windows hardware inventory rejects AMF false positives on NVIDIA-only hosts', () => {
  const controllers = ['NVIDIA GeForce RTX 4080 SUPER'];
  assert.strictEqual(transcodeService._backendAllowedByHostForTest('amf', { platform: 'win32', controllers }), false);
  assert.strictEqual(transcodeService._backendAllowedByHostForTest('qsv', { platform: 'win32', controllers }), false);
  assert.strictEqual(transcodeService._backendAllowedByHostForTest('nvenc', { platform: 'win32', controllers }), true);
});

test('Windows hardware inventory permits matching AMD and Intel backends', () => {
  assert.strictEqual(transcodeService._backendAllowedByHostForTest('amf', {
    platform: 'win32', controllers: ['AMD Radeon RX 7900 XTX'],
  }), true);
  assert.strictEqual(transcodeService._backendAllowedByHostForTest('qsv', {
    platform: 'win32', controllers: ['Intel(R) UHD Graphics 770'],
  }), true);
});

test('rate-control plan follows configured NVENC priority before backup-only CPU', () => {
  const slots = transcodeFlowExecutor.buildDeviceSlots({
    transcodeCpuParticipationStrategy: 'backup_only',
    transcodeEncodingDevices: [
      { stableKey: 'cpu:libx265', inPool: true, priority: 900, maxSlots: 1 },
      { stableKey: 'nvenc:0', inPool: true, priority: 101, maxSlots: 1 },
    ],
  });
  const plan = transcodeFlowExecutor.buildRateControlPlan(slots);

  assert.deepStrictEqual(
    plan.map((attempt) => attempt.strategy),
    ['nvenc_vbr', 'cpu_two_pass_abr', 'cpu_strict_fallback'],
  );
});

test('backup-only CPU stays after GPU even when its numeric priority is lower', () => {
  const plan = transcodeFlowExecutor.buildRateControlPlan([
    { deviceId: 'cpu:libx265', backend: 'cpu', priority: 1, cpuBackupOnly: true },
    { deviceId: 'nvenc:0', backend: 'nvenc', priority: 100, cpuBackupOnly: false },
  ]);

  assert.deepStrictEqual(
    plan.map((attempt) => attempt.encoderKind),
    ['nvenc', 'cpu', 'cpu'],
  );
});

test('QSV retains its bitrate verification retry before CPU fallback', () => {
  const plan = transcodeFlowExecutor.buildRateControlPlan([
    { deviceId: 'qsv:0', backend: 'qsv', priority: 100, cpuBackupOnly: false },
    { deviceId: 'cpu:libx265', backend: 'cpu', priority: 900, cpuBackupOnly: true },
  ]);

  assert.deepStrictEqual(
    plan.map((attempt) => attempt.strategy),
    ['qsv_vbr', 'qsv_cbr', 'cpu_two_pass_abr', 'cpu_strict_fallback'],
  );
});

test('normal CPU participation respects explicit device priority', () => {
  const slots = transcodeFlowExecutor.buildDeviceSlots({
    transcodeCpuParticipationStrategy: 'normal',
    transcodeEncodingDevices: [
      { stableKey: 'cpu:libx265', inPool: true, priority: 50, maxSlots: 1 },
      { stableKey: 'nvenc:0', inPool: true, priority: 100, maxSlots: 1 },
    ],
  });
  const plan = transcodeFlowExecutor.buildRateControlPlan(slots);

  assert.deepStrictEqual(
    plan.map((attempt) => attempt.strategy),
    ['cpu_two_pass_abr', 'cpu_strict_fallback', 'nvenc_vbr'],
  );
});
