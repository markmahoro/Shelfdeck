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
const os = require('os');
const path = require('path');

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

function makeFakeRunCmdForDvPlan({
  libplaceboOk = false,
  softwareOk = true,
  software10Ok = null,
  software8Ok = null,
  includeSoftwareFilters = true,
} = {}) {
  const calls = [];
  const filterLines = [
    ' ... libplacebo        V->V       Apply various GPU filters from libplacebo',
    includeSoftwareFilters ? ' ... zscale            V->V       Apply resizing, colorspace and bit depth conversion' : '',
    includeSoftwareFilters ? ' ... tonemap           V->V       Conversion to/from different dynamic ranges' : '',
  ].filter(Boolean).join('\n');
  const fn = async function fakeRunCmd(bin, args) {
    const argv = Array.isArray(args) ? args.join(' ') : String(args);
    calls.push({ bin, argv });
    if (argv.includes('-filters')) return { code: 0, out: filterLines, err: '' };
    if (argv.includes('libplacebo=tonemapping')) {
      return libplaceboOk
        ? { code: 0, out: '', err: '' }
        : { code: 187, out: '', err: 'Failed initializing vulkan device' };
    }
    if (argv.includes('zscale=') && argv.includes('tonemap=tonemap=hable')) {
      const is10Bit = argv.includes('r=tv,format=yuv420p10le');
      const ok = is10Bit
        ? (software10Ok == null ? softwareOk : software10Ok)
        : (software8Ok == null ? softwareOk : software8Ok);
      return ok
        ? { code: 0, out: '', err: '' }
        : { code: 1, out: '', err: is10Bit ? 'libx265 10-bit failed' : 'zscale 8-bit failed' };
    }
    return { code: 0, out: '', err: '' };
  };
  return { fn, calls };
}

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

test('resolveDolbyVisionTonemapPlan falls back to software tonemap when libplacebo runtime fails', async () => {
  const { fn, calls } = makeFakeRunCmdForDvPlan({ libplaceboOk: false, softwareOk: true });
  transcodeService._setRunCmdForTest(fn);
  try {
    const plan = await transcodeService.resolveDolbyVisionTonemapPlan(config(), { forceRefresh: true });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.mode, 'software');
    assert.strictEqual(plan.bitDepth, 10);
    assert.strictEqual(plan.pixelFormat, 'yuv420p10le');
    assert.ok(/setparams=.*bt2020/.test(plan.filterGraph));
    assert.ok(/zscale/.test(plan.filterGraph));
    assert.ok(/tonemap=hable/.test(plan.filterGraph));
    assert.ok(/vulkan/i.test(plan.libplaceboError));
    assert.ok(calls.some((c) => c.argv.includes('libplacebo=tonemapping')), 'libplacebo self-test should run');
    assert.ok(calls.some((c) => c.argv.includes('tonemap=tonemap=hable')), 'software self-test should run');
  } finally {
    transcodeService._setRunCmdForTest(null);
  }
});

test('resolveDolbyVisionTonemapPlan falls back to 8-bit software tonemap when x265 cannot encode 10-bit', async () => {
  const { fn, calls } = makeFakeRunCmdForDvPlan({ libplaceboOk: false, software10Ok: false, software8Ok: true });
  transcodeService._setRunCmdForTest(fn);
  try {
    const plan = await transcodeService.resolveDolbyVisionTonemapPlan(config(), { forceRefresh: true });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.mode, 'software');
    assert.strictEqual(plan.bitDepth, 8);
    assert.strictEqual(plan.pixelFormat, 'yuv420p');
    assert.ok(/format=yuv420p(?:,|$)/.test(plan.filterGraph));
    assert.ok(/10-bit/i.test(plan.softwareError));
    assert.ok(calls.some((c) => c.argv.includes('format=yuv420p10le') && c.argv.includes('-c:v libx265')), '10-bit encode self-test should run');
    assert.ok(calls.some((c) => c.argv.includes('format=yuv420p') && c.argv.includes('-c:v libx265')), '8-bit encode self-test should run');
  } finally {
    transcodeService._setRunCmdForTest(null);
  }
});

test('resolveDolbyVisionTonemapPlan reports unavailable when both DV tonemap paths fail', async () => {
  const { fn } = makeFakeRunCmdForDvPlan({ libplaceboOk: false, softwareOk: false });
  transcodeService._setRunCmdForTest(fn);
  try {
    const plan = await transcodeService.resolveDolbyVisionTonemapPlan(config(), { forceRefresh: true });
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.mode, 'unavailable');
    assert.ok(/libplacebo/i.test(plan.message));
    assert.ok(/software fallback/i.test(plan.message));
  } finally {
    transcodeService._setRunCmdForTest(null);
  }
});

test('buildEncodeArgs uses selected Dolby Vision software tonemap filter and CPU encoder', () => {
  const customFilter = 'zscale=t=linear,tonemap=tonemap=hable,format=yuv420p10le';
  const built = transcodeService._buildEncodeArgsForTest({
    config: config(),
    sourcePath: '/src-dv.mkv',
    partialPath: '/out-dv.mkv',
    encoderMode: 'qsv',
    isDolbyVision: true,
    dvAcknowledged: true,
    targetBitrate: 5,
    dolbyVisionTonemap: { mode: 'software', filterGraph: customFilter },
  });
  const vfIndex = built.args.indexOf('-vf');
  const codecIndex = built.args.indexOf('-c:v');
  assert.ok(vfIndex >= 0, 'DV encode should include a video filter');
  assert.strictEqual(built.args[vfIndex + 1], customFilter);
  assert.ok(codecIndex >= 0, 'DV encode should set a video codec');
  assert.strictEqual(built.args[codecIndex + 1], 'libx265');
  assert.ok(!built.args.includes('hevc_qsv'), 'DV encode should not use QSV codec when acknowledged');
});

test('buildEncodeArgs uses strict QSV CBR for bitrate target hit attempts', () => {
  const built = transcodeService._buildEncodeArgsForTest({
    config: config(),
    sourcePath: '/src.mkv',
    partialPath: '/out.mkv',
    encoderMode: 'qsv',
    isDolbyVision: false,
    dvAcknowledged: false,
    targetBitrate: 1.5,
    bitrateProfile: { minMbps: 0.975, targetMbps: 1.5, maxMbps: 2.025 },
    rateControlStrategy: 'qsv_cbr',
  });
  const argv = built.args.join(' ');
  assert.match(argv, /-c:v hevc_qsv/);
  assert.match(argv, /-b:v 1\.5M/);
  assert.match(argv, /-minrate 1\.5M/);
  assert.match(argv, /-maxrate 1\.5M/);
  assert.match(argv, /-bufsize 3M/);
  assert.ok(!built.args.includes('-rc'), 'CBR attempt should not use QSV VBR rc flag');
});

test('buildTwoPassEncodeArgs creates CPU libx265 two-pass ABR commands', () => {
  const built = transcodeService._buildTwoPassEncodeArgsForTest({
    config: config(),
    sourcePath: '/src.mkv',
    partialPath: path.join(os.tmpdir(), 'out-two-pass.mkv'),
    targetBitrate: 1.5,
    bitrateProfile: { minMbps: 0.975, targetMbps: 1.5, maxMbps: 2.025 },
    isDolbyVision: false,
    dvAcknowledged: false,
  });
  const first = built.firstPassArgs.join(' ');
  const second = built.secondPassArgs.join(' ');
  assert.match(first, /-c:v libx265/);
  assert.match(second, /-c:v libx265/);
  assert.match(first, /-b:v 1\.5M/);
  assert.match(second, /-b:v 1\.5M/);
  assert.match(first, /-pass 1/);
  assert.match(second, /-pass 2/);
  assert.match(first, /vbv-maxrate=2025:vbv-bufsize=4050/);
  assert.match(second, /vbv-maxrate=2025:vbv-bufsize=4050/);
  assert.ok(built.passLogFile.includes('ffmpeg2pass'));
});

test('transcode health does not spawn ffmpeg for command-name references', async () => {
  const health = await transcodeService.getHealth({
    ffmpegPath: 'definitely-not-a-real-ffmpeg-for-health',
    transcodeTempRoot: os.tmpdir(),
    transcodeEncodingDevices: [{ id: 'cpu', inPool: true }],
  });

  assert.strictEqual(health.status, 'green');
  assert.strictEqual(health.ffmpegOk, true);
  assert.strictEqual(health.deviceCount, 1);
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
