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
  durationUsFromFfmpeg,
  progressGroup,
  progressPhase,
  reportProcessProgress,
  matroskaCopyMapsFromProbe,
  productStreamMap,
} = require('../src/clean-media-production-effect-port');
const { createFfmpegProcessRegistry } = require('../src/clean-ffmpeg-process-registry');
const { createCleanMediaProbe } = require('../src/clean-media-probe');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } =
  require('../src/helix/integrations/bounded-material-fingerprint');
const { inspectIsoPlaybackPlan } = require('../src/helix/integrations/disc-topology');

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

function physicalReadHandle(location) {
  const observed = computeBoundedMaterialFingerprintSync(location);
  return Object.freeze({
    location,
    expectedSizeBytes:Number(observed.stat.size),
    expectedMtimeNs:Number(observed.stat.mtimeNs / 1_000_000n),
    expectedCtimeNs:Number(observed.stat.ctimeNs / 1_000_000n),
    identity:Object.freeze({
      inode:String(observed.stat.ino),
      sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,
      fingerprintVersion:observed.fingerprintVersion,
      contentFingerprint:observed.contentFingerprint,
    }),
  });
}

test('transcode maps copy only the EncodeIntent audio stream indexes', () => {
  assert.deepEqual(productStreamMap({ audio: { mode: 'copy' } }), [
    '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?',
  ]);
  assert.deepEqual(productStreamMap({ audio: { mode: 'copy', streamIndexes: [1, 2] } }), [
    '-map', '0:v:0', '-map', '0:1', '-map', '0:2', '-map', '0:s?',
  ]);
  assert.deepEqual(productStreamMap({ audio: { mode: 'copy', streamIndexes: [1] } }, '1'), [
    '-map', '0:v:0', '-map', '1:1', '-map', '1:s?',
  ]);
});

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

test('turns FFmpeg media time into bounded determinate progress', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-progress-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source.ts'), target = path.join(root, 'target.mkv');
  writeTinyMpegTs(source);
  const samples=[],group=progressGroup((sample)=>{samples.push(sample);return {sampled:true};});
  await runProcess(ffmpegPath,['-hide_banner','-nostdin','-y','-i',source,'-map','0:v:0','-c:v','libx264','-f','matroska',target],10_000,
    progressPhase(group,'fixture'));
  assert.equal(durationUsFromFfmpeg('Duration: 01:02:03.50, start: 0'),3723500000);
  assert.ok(samples.length>=1);
  assert.equal(samples.at(-1).mode,'determinate');
  assert.equal(samples.at(-1).currentValue,100);
  assert.equal(samples.at(-1).totalValue,100);
  assert.equal(samples.at(-1).unit,'percent');
  assert.equal(samples.at(-1).terminal,true);
});

test('recovered FFmpeg progress catches up to its persisted floor and uses the complete observation as identity', () => {
  const samples=[];
  const group=progressGroup((sample)=>{samples.push(sample);return sample;},1,
    {mode:'determinate',currentValue:40,totalValue:100,unit:'percent'});
  group.durationUs=100_000_000;
  const phase=progressPhase(group,'transcode');
  assert.deepEqual(reportProcessProgress(phase,20_000_000,1,false),{
    sampled:false,replayed:false,reasonCode:'RECOVERY_CATCHUP',currentValue:40,
  });
  assert.equal(samples.length,0);
  const first=reportProcessProgress(phase,50_000_000,1,false);
  const changedRate=reportProcessProgress(phase,50_000_000,2,false);
  const exactReplay=reportProcessProgress(phase,50_000_000,2,false);
  assert.equal(first.currentValue,50);
  assert.notEqual(first.sourceSequence,changedRate.sourceSequence);
  assert.equal(changedRate.sourceSequence,exactReplay.sourceSequence);
});

test('FFmpeg failures retain the actual stderr tail after a long diagnostic stream', async () => {
  await assert.rejects(runProcess(process.execPath,['-e',
    "process.stderr.write('x'.repeat(300*1024));process.stderr.write('FINAL_FFMPEG_DIAGNOSTIC');process.exit(2)"],10_000),
  (error)=>error.code==='LIBRA_MEDIA_FFMPEG_FAILED'&&error.details.stderr.includes('FINAL_FFMPEG_DIAGNOSTIC'));
});

test('service process registry terminates an active FFmpeg child during shutdown', async () => {
  const registry=createFfmpegProcessRegistry();
  const running=runProcess(ffmpegPath,['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i',
    'color=c=black:s=256x256:r=24:d=30','-f','null',process.platform==='win32'?'NUL':'/dev/null'],60_000,null,{processRegistry:registry});
  const stopped=assert.rejects(running,(error)=>error.code==='LIBRA_MEDIA_FFMPEG_FAILED');
  await new Promise((resolve)=>setTimeout(resolve,100));
  assert.equal(registry.size(),1);
  await registry.close();
  await stopped;
  assert.equal(registry.size(),0);
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

test('UAT-135 observes a proven UDF ISO selected payload with fresh Probe and 5/50/95 Decode', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-iso-acceptance-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'CLIPINF'), { recursive:true });
  writeTinyMpegTs(path.join(source, 'BDMV', 'STREAM', '00000.m2ts'));
  fs.writeFileSync(path.join(source, 'BDMV', 'CLIPINF', '00000.clpi'), Buffer.from('clip'));
  fs.writeFileSync(path.join(source, 'BDMV', 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(source, 'BDMV', 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'source/BDMV/PLAYLIST/00000.mpls', [
    { clipId:'00000', inTime:0, outTime:45000 },
  ]);
  const image = path.join(root, 'movie.iso');
  createUdfBluRay(source, image);
  const workspace = path.join(root, 'workspace'), scratch = path.join(root, 'acceptance-scratch');
  fs.mkdirSync(workspace);
  const mediaProbe = createCleanMediaProbe();
  const handle = physicalReadHandle(image);
  const containerProbe = await mediaProbe.probe(handle);
  assert.equal(containerProbe.discTopology.discKind, 'iso');
  const port = createCleanMediaProductionEffectPort({
    ffmpegPath,
    workspaceProductPort:workspacePort(workspace),
    mediaProbe,
    acceptanceScratchRoot:path.resolve(scratch),
  });
  const observed = await port.observeDiscPlayback({
    physicalMaterialReadHandle:handle,
    outputProbeEvidence:containerProbe,
    deadlineAtMs:Date.now() + 30_000,
    shouldContinue:() => true,
  });
  assert.equal(observed.probeEvidence.resultKind, 'probed');
  assert.equal(observed.probeEvidence.sourceHandleDigest, canonicalDigest(handle));
  assert.ok(observed.probeEvidence.videoStreams.length > 0);
  assert.deepEqual(observed.samplePointsPercent, [5,50,95]);
  assert.deepEqual(observed.passedSamplePointsPercent, [5,50,95]);
  assert.match(observed.observationBindingDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(fs.readdirSync(scratch), []);
});

test('UAT-135 fails closed on topology or signed Handle drift and always reclaims scratch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-iso-acceptance-negative-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'CLIPINF'), { recursive:true });
  writeTinyMpegTs(path.join(source, 'BDMV', 'STREAM', '00000.m2ts'));
  fs.writeFileSync(path.join(source, 'BDMV', 'CLIPINF', '00000.clpi'), Buffer.from('clip'));
  fs.writeFileSync(path.join(source, 'BDMV', 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(source, 'BDMV', 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'source/BDMV/PLAYLIST/00000.mpls', [{ clipId:'00000', outTime:45000 }]);
  const image = path.join(root, 'movie.iso');
  createUdfBluRay(source, image);
  const workspace = path.join(root, 'workspace'), scratch = path.resolve(path.join(root, 'acceptance-scratch'));
  fs.mkdirSync(workspace);
  const mediaProbe = createCleanMediaProbe(), handle = physicalReadHandle(image),
    containerProbe = await mediaProbe.probe(handle), port = createCleanMediaProductionEffectPort({
      ffmpegPath, workspaceProductPort:workspacePort(workspace), mediaProbe,
      acceptanceScratchRoot:scratch,
    });
  const changedTopology = Object.freeze({ ...containerProbe,
    discTopology:Object.freeze({ ...containerProbe.discTopology, topologyDigest:'0'.repeat(64) }) });
  await assert.rejects(() => port.observeDiscPlayback({physicalMaterialReadHandle:handle,
    outputProbeEvidence:changedTopology,deadlineAtMs:Date.now()+30_000,shouldContinue:()=>true}),
  (error) => error.code === 'ARCA_MEDIA_DISC_TOPOLOGY_DRIFT');
  assert.deepEqual(fs.readdirSync(scratch), []);
  const staleHandle = Object.freeze({ ...handle, identity:Object.freeze({
    ...handle.identity, contentFingerprint:'f'.repeat(64),
  }) });
  await assert.rejects(() => port.observeDiscPlayback({physicalMaterialReadHandle:staleHandle,
    outputProbeEvidence:containerProbe,deadlineAtMs:Date.now()+30_000,shouldContinue:()=>true}),
  (error) => error.code === 'ARCA_MEDIA_DISC_SOURCE_STALE');
  assert.deepEqual(fs.readdirSync(scratch), []);
});

test('UAT-135 preserves multi-clip MPLS order, repetition, and in/out boundaries', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-iso-play-plan-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'CLIPINF'), { recursive:true });
  for (const clipId of ['00000','00001']) {
    writeTinyMpegTs(path.join(source, 'BDMV', 'STREAM', clipId + '.m2ts'));
    fs.writeFileSync(path.join(source, 'BDMV', 'CLIPINF', clipId + '.clpi'), Buffer.from('clip-' + clipId));
  }
  fs.writeFileSync(path.join(source, 'BDMV', 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(source, 'BDMV', 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'source/BDMV/PLAYLIST/00000.mpls', [
    { clipId:'00001', inTime:0, outTime:22500 },
    { clipId:'00000', inTime:0, outTime:22500 },
    { clipId:'00001', inTime:22500, outTime:45000 },
  ]);
  const image = path.join(root, 'movie.iso');
  createUdfBluRay(source, image);
  const inspection = inspectIsoPlaybackPlan(image);
  assert.deepEqual(inspection.selectedPlan.playItems.map((item) => item.clipId),
    ['00001','00000','00001']);
  assert.deepEqual(inspection.selectedPlan.playItems.map((item) => [item.inTimeTicks,item.outTimeTicks]),
    [[0,22500],[0,22500],[22500,45000]]);
  assert.equal(new Set(inspection.selectedPlan.playItems.map((item) => item.relativeLocation)).size, 2);
  const workspace = path.join(root, 'workspace'), scratch = path.resolve(path.join(root, 'acceptance-scratch'));
  fs.mkdirSync(workspace);
  const mediaProbe = createCleanMediaProbe(), handle = physicalReadHandle(image),
    containerProbe = await mediaProbe.probe(handle), port = createCleanMediaProductionEffectPort({
      ffmpegPath, workspaceProductPort:workspacePort(workspace), mediaProbe,
      acceptanceScratchRoot:scratch,
    });
  const observed = await port.observeDiscPlayback({physicalMaterialReadHandle:handle,
    outputProbeEvidence:containerProbe,deadlineAtMs:Date.now()+30_000,shouldContinue:()=>true});
  assert.equal(observed.probeEvidence.resultKind, 'probed');
  assert.deepEqual(observed.passedSamplePointsPercent, [5,50,95]);
  assert.deepEqual(fs.readdirSync(scratch), []);
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
