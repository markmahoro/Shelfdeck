'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pack } = require('../../src/helix/contracts/buffalo-model-reference');
const { createBuffaloImageEngine } = require('../../src/helix/integrations/buffalo-image-engine');
const { createCleanUsAdultFrameExtractor } = require('../../src/clean-us-adult-frame-extractor');
const { computeBoundedMaterialFingerprint } = require('../../src/helix/integrations/bounded-material-fingerprint');

function prepareTempModels(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffalo-gpu-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const byPath = new Map();
  const byMarker = new Map();
  for (const item of pack.models) {
    const filePath = path.join(dir, item.file);
    const marker = Buffer.from('mock-onnx-' + item.role);
    fs.writeFileSync(filePath, marker);
    byPath.set(filePath, { item, marker });
    byMarker.set(marker, item.sha256);
  }
  const origLstat = fs.lstatSync;
  const origReadFile = fs.readFileSync;
  const origCreateHash = crypto.createHash;
  t.mock.method(fs, 'lstatSync', (filePath, opts) => {
    const entry = byPath.get(filePath);
    if (entry) {
      return { isFile: () => true, isSymbolicLink: () => false, size: entry.item.bytes };
    }
    return origLstat.call(fs, filePath, opts);
  });
  t.mock.method(fs, 'readFileSync', (filePath, opts) => {
    const entry = byPath.get(filePath);
    if (entry) return entry.marker;
    return origReadFile.call(fs, filePath, opts);
  });
  t.mock.method(crypto, 'createHash', (alg, opts) => {
    const real = origCreateHash.call(crypto, alg, opts);
    return {
      update(data, enc) {
        const expectedDigest = byMarker.get(data);
        if (expectedDigest) {
          return { digest: () => expectedDigest };
        }
        return real.update(data, enc);
      },
      digest(enc) { return real.digest(enc); },
    };
  });
  return dir;
}

test('buffalo-image-engine prefers CUDA EP when GPU is present on Linux and falls back cleanly to CPU on CUDA init failure', async (t) => {
  const modelRoot = prepareTempModels(t);

  {
    const seen = [];
    const ort = {
      env: { versions: { node: pack.runtimeVersion } },
      InferenceSession: {
        async create(file, settings) {
          seen.push({ file: path.basename(file), executionProviders: settings.executionProviders });
          return { inputNames: ['input'], outputNames: ['output'], async release() {} };
        },
      },
    };
    const engine = createBuffaloImageEngine({
      modelRoot,
      ort,
      platform: 'linux',
      hasCudaDevice: () => true,
      executionProviderMode: 'auto',
    });
    await engine.load();
    assert.equal(engine.executionProvider(), 'cuda');
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0].executionProviders, [{ name: 'cuda', deviceId: 0 }, 'cpu']);
    await engine.close();
  }

  {
    const attempts = [];
    const engine = createBuffaloImageEngine({
      modelRoot,
      ort: {
        env: { versions: { node: pack.runtimeVersion } },
        InferenceSession: {
          async create(_file, settings) {
            attempts.push(settings.executionProviders);
            if (typeof settings.executionProviders[0] === 'object') {
              throw new Error('OrtSessionOptionsAppendExecutionProvider_Cuda: libcuda.so.1 missing');
            }
            return { inputNames: ['input'], outputNames: ['output'], async release() {} };
          },
        },
      },
      platform: 'linux',
      hasCudaDevice: () => true,
      executionProviderMode: 'auto',
    });
    await engine.load();
    assert.equal(engine.executionProvider(), 'cpu');
    assert.deepEqual(attempts, [
      [{ name: 'cuda', deviceId: 0 }, 'cpu'],
      ['cpu'],
      ['cpu'],
    ]);
    await engine.close();
  }

  {
    const attempts = [];
    const engine = createBuffaloImageEngine({
      modelRoot,
      ort: {
        env: { versions: { node: pack.runtimeVersion } },
        InferenceSession: {
          async create(_file, settings) {
            attempts.push(settings.executionProviders);
            return { inputNames: ['input'], outputNames: ['output'], async release() {} };
          },
        },
      },
      platform: 'linux',
      hasCudaDevice: () => false,
      executionProviderMode: 'auto',
    });
    await engine.load();
    assert.equal(engine.executionProvider(), 'cpu');
    assert.deepEqual(attempts, [['cpu'], ['cpu']]);
    await engine.close();
  }
});

test('clean-us-adult-frame-extractor uses -hwaccel cuda when present, falls back to software decode, and disables cuda after 3 failures', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvdec-fallback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mediaFile = path.join(dir, 'sample.mp4');
  fs.writeFileSync(mediaFile, Buffer.from('fake-mp4'));
  const fp = await computeBoundedMaterialFingerprint(mediaFile);
  const sourceHandle = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialReadHandle/v1',
    ownerDomain: 'libra',
    ownerScope: { scopeType: 'libra_run', scopeId: 'run-nvdec' },
    location: mediaFile,
    identity: {
      inode: String(fp.stat.ino),
      sizeBytes: Number(fp.stat.size),
      fingerprintAlgorithm: fp.fingerprintAlgorithm,
      fingerprintVersion: fp.fingerprintVersion,
      contentFingerprint: fp.contentFingerprint,
    },
    expectedMtimeNs: Number(fp.stat.mtimeNs / 1000000n),
    expectedCtimeNs: Number(fp.stat.ctimeNs / 1000000n),
  };
  const context = {
    ownerScope: { domain: 'libra', processType: 'libra_run', processId: 'run-nvdec' },
    assertExecutionActive() {},
  };
  const spawns = [];
  let mode = 'fail_hwaccel';

  function fakeSpawn(_binary, args) {
    spawns.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      setImmediate(() => child.emit('close', null));
    };
    const hasCudaFlag = args.includes('-hwaccel');
    setImmediate(() => {
      if (mode === 'timeout') {
        return; // leave hanging until killed by assertActive or timeout
      }
      if (hasCudaFlag && mode === 'fail_hwaccel') {
        child.stderr.emit('data', Buffer.from('nvdec init failed'));
        child.emit('close', 1);
        return;
      }
      child.stdout.emit('data', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      child.emit('close', 0);
    });
    return child;
  }

  const extractor = createCleanUsAdultFrameExtractor({
    ffmpegPath: '/usr/local/bin/ffmpeg',
    mediaProbe: { async probe() { return { durationMs: 10000 }; } },
    spawnImpl: fakeSpawn,
    platform: 'linux',
    hasCudaDevice: () => true,
    hwaccelMode: 'auto',
  });
  t.after(async () => { await extractor.close(); });

  // 3 frames where hardware decode fails: each falls back to software decode.
  const out = await extractor.extractPoints({
    sourceHandle,
    context,
    durationMs: 10000,
    timestampsMs: [1000, 2000, 3000],
  });
  assert.equal(out.length, 3);
  assert.equal(spawns.length, 6);
  assert.equal(spawns[0].includes('-hwaccel'), true);
  assert.equal(spawns[1].includes('-hwaccel'), false);

  // 4th frame should go straight to software decode after 3 consecutive hwaccel failures.
  const out4 = await extractor.extractPoints({
    sourceHandle,
    context,
    durationMs: 10000,
    timestampsMs: [4000],
  });
  assert.equal(out4.length, 1);
  assert.equal(spawns.length, 7);
  assert.equal(spawns[6].includes('-hwaccel'), false);

  // Separate extractor with working CUDA keeps using -hwaccel cuda; authority cancellation must not retry.
  const activeSpawns = [];
  let active = true;
  const activeExtractor = createCleanUsAdultFrameExtractor({
    ffmpegPath: '/usr/local/bin/ffmpeg',
    mediaProbe: { async probe() { return { durationMs: 10000 }; } },
    spawnImpl(_bin, args) {
      activeSpawns.push(args);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => setImmediate(() => child.emit('close', 1));
      setImmediate(() => {
        if (!active) return;
        child.stdout.emit('data', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        child.emit('close', 0);
      });
      return child;
    },
    platform: 'linux',
    hasCudaDevice: () => true,
    hwaccelMode: 'auto',
  });
  t.after(async () => { await activeExtractor.close(); });
  const ok = await activeExtractor.extractPoints({ sourceHandle, context, durationMs: 10000, timestampsMs: [1000] });
  assert.equal(ok.length, 1);
  assert.equal(activeSpawns[0].includes('-hwaccel'), true);
  assert.equal(activeSpawns[0][activeSpawns[0].indexOf('-hwaccel') + 1], 'cuda');

  active = false;
  await assert.rejects(
    activeExtractor.extractPoints({
      sourceHandle,
      context: {
        ownerScope: context.ownerScope,
        assertExecutionActive() {
          throw Object.assign(new Error('cancelled'), { code: 'TEST_CANCELLED' });
        },
      },
      durationMs: 10000,
      timestampsMs: [1000],
    }),
    { code: 'TEST_CANCELLED' },
  );
  assert.equal(activeSpawns.length, 1, 'authority cancellation must not spawn a retry');
});
