'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const ffmpegPath = require('ffmpeg-static');
const { createUdfBluRay, writeMpls } = require('../scripts/build-helix-movie-test-library');
const {
  runProcess,
  createCleanMediaProductionEffectPort,
  matroskaCopyMapsFromProbe,
} = require('../src/clean-media-production-effect-port');

function writeTinyMpegTs(target) {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-c:v', 'mpeg2video', '-q:v', '10', '-c:a', 'ac3', '-b:a', '64k',
    '-f', 'mpegts', target,
  ], { encoding:'utf8', windowsHide:true });
  if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg MPEG-TS fixture failed');
}

function writeTinyMkv(target) {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=1',
    '-c:v', 'mpeg4', '-f', 'matroska', target,
  ], { encoding:'utf8', windowsHide:true });
  if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg Matroska fixture failed');
}

function workspacePort(root) {
  return {
    async materializeMedia(request) {
      const temporaryTarget = path.join(root, 'workspace-out.mkv');
      await request.produce(temporaryTarget);
      return Object.freeze({
        effectReceiptId: 'receipt-1',
        outputTargetId: request.outputTargetId,
        outputTargetDigest: request.outputTargetDigest,
        effectScopeDigest: request.effectScopeDigest,
        workspaceMaterialHandle: { location: temporaryTarget, sizeBytes: fs.statSync(temporaryTarget).size },
        committedAtMs: 1,
      });
    },
  };
}

function copyPrefix(source, dest, bytes) {
  const fd = fs.openSync(source, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    fs.writeFileSync(dest, buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
}

function clearSecondVideoPts(file) {
  const bytes = fs.readFileSync(file);
  const packetSize = bytes[4] === 0x47 ? 192 : 188;
  const header = packetSize === 192 ? 4 : 0;
  let seen = 0;
  for (let offset = 0; offset + packetSize <= bytes.length; offset += packetSize) {
    if (bytes[offset + header] !== 0x47) continue;
    if (!(bytes[offset + header + 1] & 0x40)) continue;
    const adaptation = (bytes[offset + header + 3] >> 4) & 0x03;
    let payload = offset + header + 4;
    if (adaptation === 2) continue;
    if (adaptation === 3) {
      if (payload >= offset + packetSize) continue;
      payload += 1 + bytes[payload];
    }
    if (payload + 9 >= offset + packetSize) continue;
    if (bytes[payload] !== 0 || bytes[payload + 1] !== 0 || bytes[payload + 2] !== 1) continue;
    const streamId = bytes[payload + 3];
    if (streamId < 0xe0 || streamId > 0xef) continue;
    const ptsDts = bytes[payload + 7] >> 6;
    if (!ptsDts) continue;
    seen += 1;
    if (seen < 2) continue;
    bytes[payload + 7] = bytes[payload + 7] & 0x3f;
    fs.writeFileSync(file, bytes);
    return true;
  }
  return false;
}

function remuxRequest(sourceLocation) {
  return {
    source: {
      primaryMembers: [{
        member: { role: 'primary_payload' },
        readHandle: { location: sourceLocation },
      }],
    },
    productionIntent: { intentDigest: 'intent-1' },
    outputTarget: {
      libraRunId: 'run-1',
      workspaceId: 'ws-1',
      targetRelativePath: 'out.mkv',
      effectScopeDigest: 'scope-1',
      targetId: 'target-1',
      targetDigest: 'target-digest',
    },
    idempotencyKey: 'key-1',
  };
}

test('remux maps skip Matroska-uncopyable Blu-ray LPCM under copy_all_supported', () => {
  const stderr = [
    'Input #0, mpegts, from \'clip.m2ts\':',
    '  Stream #0:0[0x1011]: Video: h264 (High) (HDMV / 0x564D4448), yuv420p',
    '  Stream #0:1[0x1100]: Audio: dts (DTS-HD MA) ([134][0][0][0] / 0x0086), 48000 Hz',
    '  Stream #0:2[0x1101]: Audio: ac3 (AC-3 / 0x332D4341), 48000 Hz',
    '  Stream #0:3[0x1102]: Audio: pcm_bluray (HDMV / 0x564D4448), 48000 Hz, stereo',
    '  Stream #0:4[0x1200]: Subtitle: hdmv_pgs_subtitle ([144][0][0][0] / 0x0090)',
  ].join('\n');
  assert.deepEqual(matroskaCopyMapsFromProbe(stderr), [
    '-map', '0:0', '-map', '0:1', '-map', '0:2', '-map', '0:4',
  ]);
});

test('contains progress persistence failures inside the media effect promise', async () => {
  const failure = Object.assign(new Error('progress conflict'), {
    code: 'P4_PROGRESS_SOURCE_SEQUENCE_CONFLICT',
  });
  await assert.rejects(runProcess(ffmpegPath, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1',
    '-t', '0.1', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
  ], 10_000, {
    prefix: 'test-progress',
    report() { throw failure; },
  }), (error) => error === failure);
});

test('remux extracts proven ISO topology payloads instead of opening the image as a stream', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-iso-remux-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'CLIPINF'), { recursive:true });
  writeTinyMpegTs(path.join(source, 'BDMV', 'STREAM', '00000.m2ts'));
  fs.writeFileSync(path.join(source, 'BDMV', 'CLIPINF', '00000.clpi'), Buffer.from('clip'));
  fs.writeFileSync(path.join(source, 'BDMV', 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(source, 'BDMV', 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'source/BDMV/PLAYLIST/00000.mpls', [{ clipId:'00000', outTime:90000 }]);
  const image = path.join(root, 'udf-bluray.iso');
  createUdfBluRay(source, image);
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const port = createCleanMediaProductionEffectPort({
    ffmpegPath,
    workspaceProductPort: workspacePort(workspace),
  });
  const receipt = await port.executeRemux(remuxRequest(image));
  const output = path.join(workspace, 'workspace-out.mkv');
  assert.equal(receipt.outputTargetId, 'target-1');
  assert.ok(fs.existsSync(output));
  assert.ok(fs.statSync(output).size > 0);
  assert.equal(fs.existsSync(output + '.iso-clip-00000.m2ts'), false);
  assert.equal(fs.existsSync(output + '.iso-concat.txt'), false);
  const probe = spawnSync(ffmpegPath, ['-hide_banner', '-nostdin', '-i', output], { encoding:'utf8', windowsHide:true });
  assert.match(String(probe.stderr || ''), /matroska/i);
});

test('remux refuses an ISO volume that has no proven Blu-ray topology', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-iso-unproven-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const fakeUdf = path.join(root, 'udf-without-volume.iso');
  const image = Buffer.alloc(2048 * 20);
  image.write('BEA01', 16 * 2048 + 1, 5, 'ascii');
  image.write('NSR03', 17 * 2048 + 1, 5, 'ascii');
  image.write('TEA01', 18 * 2048 + 1, 5, 'ascii');
  fs.writeFileSync(fakeUdf, image);
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const port = createCleanMediaProductionEffectPort({
    ffmpegPath,
    workspaceProductPort: workspacePort(workspace),
  });
  await assert.rejects(() => port.executeRemux(remuxRequest(fakeUdf)), (error) =>
    error.code === 'LIBRA_MEDIA_ISO_TOPOLOGY_UNPROVEN');
});

test('remux fills missing MPEG-TS video timestamps instead of failing Matroska mux', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-bdmv-nopts-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'nopts.m2ts');
  writeTinyMpegTs(source);
  assert.equal(clearSecondVideoPts(source), true);
  const broken = spawnSync(ffmpegPath, [
    '-hide_banner', '-nostdin', '-y', '-fflags', '+genpts',
    '-i', source, '-map', '0', '-c', 'copy', '-f', 'matroska', path.join(root, 'broken.mkv'),
  ], { encoding:'utf8', windowsHide:true });
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const port = createCleanMediaProductionEffectPort({
    ffmpegPath,
    workspaceProductPort: workspacePort(workspace),
  });
  const receipt = await port.executeRemux(remuxRequest(source));
  const output = path.join(workspace, 'workspace-out.mkv');
  assert.equal(receipt.outputTargetId, 'target-1');
  assert.ok(fs.existsSync(output));
  assert.ok(fs.statSync(output).size > 0);
  if (broken.status === 0) {
    assert.ok(fs.statSync(output).size >= 1);
    return;
  }
  assert.match(String(broken.stderr || ''), /unknown timestamp|Conversion failed/i);
});

test('remux copies a live BDAV HEVC TrueHD prefix that ffmpeg-static otherwise rejects', async (t) => {
  const canary = process.env.HELIX_BDMV_M2TS_FIXTURE ||
    'F:/canary/养蜂人 (2024)/养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1/BDMV/STREAM/00002.m2ts';
  if (!fs.existsSync(canary)) {
    t.skip('live BDMV STREAM fixture is absent');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-bdmv-prefix-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const prefix = path.join(root, 'prefix.m2ts');
  copyPrefix(canary, prefix, 12 * 1024 * 1024);
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const port = createCleanMediaProductionEffectPort({
    ffmpegPath,
    workspaceProductPort: workspacePort(workspace),
  });
  const receipt = await port.executeRemux(remuxRequest(prefix));
  const output = path.join(workspace, 'workspace-out.mkv');
  assert.equal(receipt.outputTargetId, 'target-1');
  assert.ok(fs.existsSync(output));
  assert.ok(fs.statSync(output).size > 64 * 1024);
});

test('remux still opens an ordinary stream file without ISO extraction', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-stream-remux-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'title.mkv');
  writeTinyMkv(source);
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const port = createCleanMediaProductionEffectPort({
    ffmpegPath,
    workspaceProductPort: workspacePort(workspace),
  });
  const receipt = await port.executeRemux(remuxRequest(source));
  const output = path.join(workspace, 'workspace-out.mkv');
  assert.equal(receipt.outputTargetId, 'target-1');
  assert.ok(fs.existsSync(output));
  assert.ok(fs.statSync(output).size > 0);
  assert.equal(fs.existsSync(output + '.iso-clip-00000.m2ts'), false);
});
