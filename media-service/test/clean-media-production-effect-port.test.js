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
