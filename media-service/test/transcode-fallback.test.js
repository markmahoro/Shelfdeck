'use strict';

// Tests the GPU→CPU fallback path in transcodeService.startEncode.
//
// We don't spawn a real ffmpeg here (fragile across Windows/Docker and hard to
// force a GPU-only failure). Instead we inject a fake spawn via the module's
// _setSpawnForTest hook. The fake inspects the argv to decide whether the
// "ffmpeg" call should fail (GPU encoder present) or succeed (CPU libx265).
// This exercises the real startEncode orchestration: device acquisition, the
// first-attempt failure, the GPU→CPU fallback decision, stderr-tail capture,
// and the onLog fallback event.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

const transcodeService = require('../src/services/transcodeService');

const FAKE_BIN = '/usr/local/bin/fake-ffmpeg';

/**
 * Fake spawn: argv with a GPU encoder flag => emit stderr + close non-zero;
 * argv with libx265 => close 0 (success). Each child exposes stdout/stderr
 * emitters and a no-op kill(), matching the surface runLocalEncode touches.
 */
function makeFakeSpawn({ gpuExitCode = 187, gpuStderr = 'qsv init failed: No capable devices', cpuExitCode = 0, cpuStderr = 'frame=1' } = {}) {
  const attempts = [];
  const fn = function fakeSpawn(bin, args) {
    const argv = Array.isArray(args) ? args.join(' ') : String(args);
    const isGpu = /hevc_qsv|hevc_nvenc|hevc_amf/.test(argv);
    attempts.push({ bin, argv, isGpu });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
    child.kill = () => {};
    setImmediate(() => {
      if (isGpu) {
        child.stderr.emit('data', gpuStderr + '\n');
        child.emit('close', gpuExitCode);
      } else {
        child.stderr.emit('data', cpuStderr + '\n');
        child.emit('close', cpuExitCode);
      }
    });
    return child;
  };
  return { fn, attempts };
}

const config = () => ({ ffmpegPath: FAKE_BIN, ffprobePath: FAKE_BIN, transcodeTempRoot: '/tmp' });

test('findCpuSlot returns the CPU device from an ordered pool', () => {
  const pool = [
    { deviceId: 'qsv:0', maxSlots: 1, cpuBackupOnly: false },
    { deviceId: 'cpu:libx265', maxSlots: 1, cpuBackupOnly: true },
  ];
  assert.strictEqual(transcodeService.findCpuSlot(pool).deviceId, 'cpu:libx265');
  assert.strictEqual(transcodeService.findCpuSlot([{ deviceId: 'nvenc:0', maxSlots: 1 }]), null);
});

test('normalizeEncodeError turns a rejection object into a diagnostic Error', () => {
  const e = transcodeService.normalizeEncodeError({ code: 187, stderrTail: 'qsv init failed' });
  assert.ok(e instanceof Error);
  assert.ok(/187/.test(e.message));
  assert.ok(/qsv init failed/.test(e.message));
  const real = new Error('spawn ENOENT');
  assert.strictEqual(transcodeService.normalizeEncodeError(real), real);
});

test('startEncode falls back from GPU to CPU when the GPU encode fails', async () => {
  const { fn, attempts } = makeFakeSpawn({ gpuExitCode: 187 });
  transcodeService._setSpawnForTest(fn);
  const orderedDeviceSlots = [
    { deviceId: 'qsv:0', maxSlots: 1, cpuBackupOnly: false },
    { deviceId: 'cpu:libx265', maxSlots: 1, cpuBackupOnly: true },
  ];
  const logs = [];
  try {
    const result = await transcodeService.startEncode(() => {}, {
      config: config(), taskId: 'fb-1', sourcePath: '/src.mkv', partialPath: '/out.etp.partial.mkv',
      orderedDeviceSlots, isDolbyVision: false, dvAcknowledged: false, durationSec: 10, targetBitrate: 5,
      onLog: (level, msg) => logs.push({ level, msg }),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.encoderUsed, 'cpu');
    assert.strictEqual(result.resolvedDeviceId, 'cpu:libx265');
    assert.strictEqual(attempts.length, 2, 'should spawn twice (GPU then CPU)');
    assert.strictEqual(attempts[0].isGpu, true);
    assert.strictEqual(attempts[1].isGpu, false);

    const fb = logs.find((l) => /降级到 CPU/.test(l.msg));
    assert.ok(fb, 'expected a fallback log, got: ' + JSON.stringify(logs));
    assert.strictEqual(fb.level, 'warn');
    assert.ok(/187/.test(fb.msg));
    assert.ok(/qsv init failed/i.test(fb.msg));
  } finally {
    transcodeService._setSpawnForTest(null);
  }
});

test('startEncode fails loudly (no fallback) when GPU fails and no CPU slot exists', async () => {
  const { fn, attempts } = makeFakeSpawn({ gpuExitCode: 187 });
  transcodeService._setSpawnForTest(fn);
  const orderedDeviceSlots = [{ deviceId: 'qsv:0', maxSlots: 1, cpuBackupOnly: false }];
  const logs = [];
  try {
    await assert.rejects(
      () => transcodeService.startEncode(() => {}, {
        config: config(), taskId: 'fb-2', sourcePath: '/src.mkv', partialPath: '/out.etp.partial.mkv',
        orderedDeviceSlots, isDolbyVision: false, dvAcknowledged: false, durationSec: 10, targetBitrate: 5,
        onLog: (level, msg) => logs.push({ level, msg }),
      }),
      (err) => {
        assert.ok(err instanceof Error, 'should reject with an Error, got ' + typeof err);
        assert.ok(/187/.test(err.message));
        assert.ok(/qsv init failed/i.test(err.message));
        return true;
      },
    );
    assert.strictEqual(attempts.length, 1);
    assert.ok(!logs.some((l) => /降级/.test(l.msg)));
  } finally {
    transcodeService._setSpawnForTest(null);
  }
});

test('startEncode reports the CPU failure when the CPU fallback also fails', async () => {
  const { fn, attempts } = makeFakeSpawn({ gpuExitCode: 187, cpuExitCode: 1, cpuStderr: 'libx265 fatal error' });
  transcodeService._setSpawnForTest(fn);
  const orderedDeviceSlots = [
    { deviceId: 'qsv:0', maxSlots: 1, cpuBackupOnly: false },
    { deviceId: 'cpu:libx265', maxSlots: 1, cpuBackupOnly: true },
  ];
  const logs = [];
  try {
    await assert.rejects(
      () => transcodeService.startEncode(() => {}, {
        config: config(), taskId: 'fb-3', sourcePath: '/src.mkv', partialPath: '/out.etp.partial.mkv',
        orderedDeviceSlots, isDolbyVision: false, dvAcknowledged: false, durationSec: 10, targetBitrate: 5,
        onLog: (level, msg) => logs.push({ level, msg }),
      }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/libx265 fatal error/i.test(err.message), 'should carry the CPU stderr tail');
        return true;
      },
    );
    assert.strictEqual(attempts.length, 2, 'should have tried GPU then CPU');
    assert.ok(logs.some((l) => /降级重试也失败/.test(l.msg)), 'should log that CPU fallback also failed');
  } finally {
    transcodeService._setSpawnForTest(null);
  }
});

test('startEncode does NOT fall back for Dolby Vision (needsCpu selects CPU directly)', async () => {
  const { fn, attempts } = makeFakeSpawn();
  transcodeService._setSpawnForTest(fn);
  const orderedDeviceSlots = [
    { deviceId: 'qsv:0', maxSlots: 1, cpuBackupOnly: false },
    { deviceId: 'cpu:libx265', maxSlots: 1, cpuBackupOnly: true },
  ];
  const logs = [];
  try {
    const result = await transcodeService.startEncode(() => {}, {
      config: config(), taskId: 'fb-4', sourcePath: '/src.mkv', partialPath: '/out.etp.partial.mkv',
      orderedDeviceSlots, isDolbyVision: true, dvAcknowledged: true, durationSec: 10, targetBitrate: 5,
      onLog: (level, msg) => logs.push({ level, msg }),
    });
    // DV path: needsCpu disables the GPU→CPU fallback, so there must be
    // exactly one attempt and no fallback event — regardless of which device
    // was picked (buildEncodeArgs forces the CPU codec for DV).
    assert.ok(result.ok, 'DV encode should succeed');
    assert.strictEqual(attempts.length, 1, 'only one attempt for DV (no fallback)');
    assert.strictEqual(logs.length, 0, 'no fallback events for DV');
  } finally {
    transcodeService._setSpawnForTest(null);
  }
});

test('abortTask releases the acquired device slot', async () => {
  const attempts = [];
  const fn = function fakeLongSpawn(bin, args) {
    attempts.push({ bin, argv: Array.isArray(args) ? args.join(' ') : String(args) });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
    child.kill = () => setImmediate(() => child.emit('close', 255));
    return child;
  };
  transcodeService._setSpawnForTest(fn);
  const taskId = 'abort-slot-' + Date.now();
  try {
    const promise = transcodeService.startEncode(() => {}, {
      config: config(), taskId, sourcePath: '/src.mkv', partialPath: '/out.etp.partial.mkv',
      orderedDeviceSlots: [{ deviceId: 'qsv:0', maxSlots: 1, cpuBackupOnly: false }],
      isDolbyVision: false, dvAcknowledged: false, durationSec: 10, targetBitrate: 5,
    });

    for (let i = 0; i < 20; i++) {
      if (attempts.length === 1 && transcodeService.getDeviceSlotUsage()['qsv:0'] === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(attempts.length, 1);
    assert.strictEqual(transcodeService.getDeviceSlotUsage()['qsv:0'], 1);
    assert.strictEqual(transcodeService.abortTask(taskId), true);
    assert.strictEqual(transcodeService.getDeviceSlotUsage()['qsv:0'], 0);

    await assert.rejects(promise, /255/);
    assert.strictEqual(transcodeService.getDeviceSlotUsage()['qsv:0'], 0);
  } finally {
    transcodeService._setSpawnForTest(null);
  }
});
