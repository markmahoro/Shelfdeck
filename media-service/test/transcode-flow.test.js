'use strict';

/**
 * TranscodeFlowExecutor unit tests — pause / cancel behaviour.
 *
 * Verifies:
 *   - pause() kills FFmpeg, deletes partial file, reports 'paused'
 *   - cancel() kills FFmpeg, deletes partial file, reports 'done'
 *   - Both handle missing task / missing partialPath gracefully
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Test harness ──────────────────────────────────────────────────────────────

function setupDataDir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-flow-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dataDir;
  return dataDir;
}

function writeMinimalConfig(dataDir, tempRoot) {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    transcodeTempRoot: tempRoot,
    transcodeEncodingDevices: [],
  }));
}

function writeConfigWithCpuDevice(dataDir, tempRoot) {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    transcodeTempRoot: tempRoot,
    transcodeEncodingDevices: [{ stableKey: 'cpu:libx265', inPool: true, maxSlots: 1, priority: 1 }],
  }));
}

function createPartialFile(tempRoot) {
  const partialPath = path.join(tempRoot, `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.etp.partial.mkv`);
  fs.writeFileSync(partialPath, 'fake-encode-output-data');
  return partialPath;
}

function isoDirRecord(name, extent, size, isDir) {
  let nameBuf;
  if (name === '.') nameBuf = Buffer.from([0]);
  else if (name === '..') nameBuf = Buffer.from([1]);
  else nameBuf = Buffer.from(name, 'ascii');
  let len = 33 + nameBuf.length;
  if (len % 2) len++;
  const b = Buffer.alloc(len);
  b[0] = len;
  b.writeUInt32LE(extent, 2);
  b.writeUInt32BE(extent, 6);
  b.writeUInt32LE(size, 10);
  b.writeUInt32BE(size, 14);
  b[25] = isDir ? 2 : 0;
  b.writeUInt16LE(1, 28);
  b.writeUInt16BE(1, 30);
  b[32] = nameBuf.length;
  nameBuf.copy(b, 33);
  return b;
}

function writeIsoDirectory(buf, sector, records) {
  let off = sector * 2048;
  for (const rec of records) {
    const b = isoDirRecord(rec.name, rec.extent, rec.size, rec.isDir);
    b.copy(buf, off);
    off += b.length;
  }
}

function writeMinimalDvdIso(filePath, files) {
  const sectors = 80;
  const buf = Buffer.alloc(sectors * 2048);
  const rootExtent = 20;
  const videoTsExtent = 21;
  const rootSize = 2048;
  const videoTsSize = 2048;

  const pvd = 16 * 2048;
  buf[pvd] = 1;
  buf.write('CD001', pvd + 1, 'ascii');
  buf[pvd + 6] = 1;
  isoDirRecord('.', rootExtent, rootSize, true).copy(buf, pvd + 156);

  writeIsoDirectory(buf, rootExtent, [
    { name: '.', extent: rootExtent, size: rootSize, isDir: true },
    { name: '..', extent: rootExtent, size: rootSize, isDir: true },
    { name: 'VIDEO_TS', extent: videoTsExtent, size: videoTsSize, isDir: true },
  ]);

  const videoRecords = [
    { name: '.', extent: videoTsExtent, size: videoTsSize, isDir: true },
    { name: '..', extent: rootExtent, size: rootSize, isDir: true },
  ];
  let nextExtent = 30;
  for (const file of files) {
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content || ''), 'utf8');
    videoRecords.push({ name: `${file.name};1`, extent: nextExtent, size: content.length, isDir: false });
    content.copy(buf, nextExtent * 2048);
    nextExtent += Math.max(1, Math.ceil(content.length / 2048));
  }
  writeIsoDirectory(buf, videoTsExtent, videoRecords);
  fs.writeFileSync(filePath, buf);
}

/**
 * Bust require cache and return fresh modules bound to the current data dir.
 */
function freshModules() {
  delete require.cache[require.resolve('../src/taskStore')];
  delete require.cache[require.resolve('../src/configStore')];
  delete require.cache[require.resolve('../src/services/transcodeService')];
  delete require.cache[require.resolve('../src/transcodeFlowExecutor')];

  const taskStore = require('../src/taskStore');
  const transcodeService = require('../src/services/transcodeService');
  const transcodeFlow = require('../src/transcodeFlowExecutor');

  const schedulerCalls = [];
  transcodeFlow.setScheduler({
    pauseForConfirm(taskId, resumePoint) {
      schedulerCalls.push({ method: 'pauseForConfirm', taskId, resumePoint });
      taskStore.updateTask(taskId, { status: 'awaiting_user_confirm', resumePoint });
    },
    reportStatus(taskId, status, progress) {
      schedulerCalls.push({ method: 'reportStatus', taskId, status, progress });
      const updates = { status };
      if (typeof progress === 'number') updates.progress = progress;
      taskStore.updateTask(taskId, updates);
    },
  });

  return { taskStore, transcodeService, transcodeFlow, schedulerCalls };
}

/**
 * Create a task and update it to executing state with an optional partial file.
 * Returns the generated task id (createTask ignores caller-supplied id).
 */
function createExecutingTask(taskStore, tempRoot, partial) {
  const task = taskStore.createTask({ itemId: 'test-item', actionType: 'transcode' });
  const itemInfo = {};
  if (partial) {
    itemInfo.partialPath = createPartialFile(tempRoot);
  }
  taskStore.updateTask(task.id, { status: 'executing', phase: 'transcode_executing', progress: 45, itemInfo });
  taskStore.setProgress(task.id, 45);
  return taskStore.getTask(task.id);
}

// ── pause() ───────────────────────────────────────────────────────────────────

test('pause() aborts encode job', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { taskStore, transcodeService, transcodeFlow, schedulerCalls } = freshModules();

  const task = createExecutingTask(taskStore, tempRoot, /*partial*/ true);
  const partialPath = task.itemInfo.partialPath;

  let abortCalls = [];
  const origAbort = transcodeService.abortTask;
  transcodeService.abortTask = (tid) => { abortCalls.push(tid); return origAbort.call(transcodeService, tid); };

  transcodeFlow.pause(task.id);

  assert.strictEqual(abortCalls.length, 1, 'abortTask should be called once');
  assert.strictEqual(abortCalls[0], task.id);

  const pauseReport = schedulerCalls.find((c) => c.method === 'reportStatus' && c.status === 'paused');
  assert.ok(pauseReport, 'should report paused status');
  assert.strictEqual(pauseReport.taskId, task.id);

  transcodeService.abortTask = origAbort;
  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('pause() deletes partial file', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { taskStore, transcodeFlow } = freshModules();

  const task = createExecutingTask(taskStore, tempRoot, /*partial*/ true);
  const partialPath = task.itemInfo.partialPath;

  assert.strictEqual(fs.existsSync(partialPath), true, 'partial file should exist before pause');

  transcodeFlow.pause(task.id);

  assert.strictEqual(fs.existsSync(partialPath), false, 'partial file should be deleted after pause');

  const reloaded = taskStore.getTask(task.id);
  assert.strictEqual(reloaded.status, 'paused');
  assert.strictEqual(reloaded.progress, 45, 'progress should be preserved');

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('pause() on non-existent task is no-op', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { transcodeFlow } = freshModules();

  assert.doesNotThrow(() => transcodeFlow.pause('nonexistent-task'));

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('pause() does not crash when partialPath is missing', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { taskStore, transcodeFlow } = freshModules();

  const task = createExecutingTask(taskStore, tempRoot, /*partial*/ false);

  assert.doesNotThrow(() => transcodeFlow.pause(task.id));

  const reloaded = taskStore.getTask(task.id);
  assert.strictEqual(reloaded.status, 'paused');

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

// ── cancel() ───────────────────────────────────────────────────────────────────

test('cancel() aborts encode job', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { taskStore, transcodeService, transcodeFlow, schedulerCalls } = freshModules();

  const task = createExecutingTask(taskStore, tempRoot, /*partial*/ true);

  let abortCalls = [];
  const origAbort = transcodeService.abortTask;
  transcodeService.abortTask = (tid) => { abortCalls.push(tid); return origAbort.call(transcodeService, tid); };

  transcodeFlow.cancel(task.id);

  assert.strictEqual(abortCalls.length, 1, 'abortTask should be called once');
  assert.strictEqual(abortCalls[0], task.id);

  const doneReport = schedulerCalls.find((c) => c.method === 'reportStatus' && c.status === 'done');
  assert.ok(doneReport, 'should report done status');
  assert.strictEqual(doneReport.taskId, task.id);

  transcodeService.abortTask = origAbort;
  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('cancel() deletes partial file', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { taskStore, transcodeFlow } = freshModules();

  const task = createExecutingTask(taskStore, tempRoot, /*partial*/ true);
  const partialPath = task.itemInfo.partialPath;

  assert.strictEqual(fs.existsSync(partialPath), true, 'partial file should exist before cancel');

  transcodeFlow.cancel(task.id);

  assert.strictEqual(fs.existsSync(partialPath), false, 'partial file should be deleted after cancel');

  const reloaded = taskStore.getTask(task.id);
  assert.strictEqual(reloaded.status, 'done');

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('cancel() on non-existent task is no-op', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { transcodeFlow } = freshModules();

  assert.doesNotThrow(() => transcodeFlow.cancel('nonexistent-task'));

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('cancel() does not crash when partialPath is missing', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const { taskStore, transcodeFlow } = freshModules();

  const task = createExecutingTask(taskStore, tempRoot, /*partial*/ false);

  assert.doesNotThrow(() => transcodeFlow.cancel(task.id));

  const reloaded = taskStore.getTask(task.id);
  assert.strictEqual(reloaded.status, 'done');

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

// ── Behaviour parity ──────────────────────────────────────────────────────────

test('pause and cancel both delete partial file (behaviour parity)', () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  // ── pause path ──
  {
    const { taskStore: ts, transcodeFlow: tf } = freshModules();
    const task = createExecutingTask(ts, tempRoot, /*partial*/ true);
    const pp = task.itemInfo.partialPath;
    assert.strictEqual(fs.existsSync(pp), true);
    tf.pause(task.id);
    assert.strictEqual(fs.existsSync(pp), false, 'pause: partial file deleted');
    assert.strictEqual(ts.getTask(task.id).status, 'paused', 'pause: status is paused');
  }

  // ── cancel path ──
  {
    const { taskStore: ts, transcodeFlow: tf } = freshModules();
    const task = createExecutingTask(ts, tempRoot, /*partial*/ true);
    const pp = task.itemInfo.partialPath;
    assert.strictEqual(fs.existsSync(pp), true);
    tf.cancel(task.id);
    assert.strictEqual(fs.existsSync(pp), false, 'cancel: partial file deleted');
    assert.strictEqual(ts.getTask(task.id).status, 'done', 'cancel: status is done');
  }

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
});

test('resolveDiscInput selects largest DVD title set and skips menu VOBs', async () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const dvdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-dvd-'));
  const videoTs = path.join(dvdRoot, 'VIDEO_TS');
  fs.mkdirSync(videoTs, { recursive: true });
  fs.writeFileSync(path.join(videoTs, 'VTS_01_0.VOB'), Buffer.alloc(1000)); // menu, must be ignored
  fs.writeFileSync(path.join(videoTs, 'VTS_01_1.VOB'), Buffer.alloc(50));
  fs.writeFileSync(path.join(videoTs, 'VTS_02_1.VOB'), Buffer.alloc(100));
  fs.writeFileSync(path.join(videoTs, 'VTS_02_2.VOB'), Buffer.alloc(100));
  fs.writeFileSync(path.join(videoTs, 'VTS_03_1.VOB'), Buffer.alloc(80));

  const { transcodeService } = freshModules();
  const resolved = await transcodeService.resolveDiscInput(dvdRoot);

  assert.strictEqual(resolved.input.kind, 'dvd_vobset');
  assert.strictEqual(resolved.input.playlistName, 'VTS_02');
  assert.deepStrictEqual(
    resolved.input.clips.map((clip) => path.basename(clip.path)),
    ['VTS_02_1.VOB', 'VTS_02_2.VOB'],
  );

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
  try { fs.rmSync(dvdRoot, { recursive: true }); } catch (_) {}
});

test('resolveDiscInput extracts only the largest DVD title set from ISO', async () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeMinimalConfig(dataDir, tempRoot);

  const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-iso-'));
  const isoPath = path.join(isoDir, 'movie.iso');
  writeMinimalDvdIso(isoPath, [
    { name: 'VTS_01_0.VOB', content: Buffer.alloc(1000, 1) }, // menu, must be ignored
    { name: 'VTS_01_1.VOB', content: Buffer.alloc(40, 2) },
    { name: 'VTS_02_1.VOB', content: Buffer.alloc(80, 3) },
    { name: 'VTS_02_2.VOB', content: Buffer.alloc(90, 4) },
    { name: 'VTS_03_1.VOB', content: Buffer.alloc(60, 5) },
  ]);

  const { transcodeService } = freshModules();
  const resolved = await transcodeService.resolveDiscInput(isoPath, { workDir: tempRoot });

  assert.strictEqual(resolved.input.kind, 'dvd_iso_vobset');
  assert.strictEqual(resolved.input.playlistName, 'VTS_02');
  assert.deepStrictEqual(
    resolved.input.clips.map((clip) => path.basename(clip.path)),
    ['VTS_02_1.VOB', 'VTS_02_2.VOB'],
  );
  assert.strictEqual(fs.readFileSync(resolved.input.clips[0].path)[0], 3);
  assert.strictEqual(fs.readFileSync(resolved.input.clips[1].path)[0], 4);

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
  try { fs.rmSync(isoDir, { recursive: true }); } catch (_) {}
});

test('driveTask remuxes disc-like movie before encoding', async () => {
  const dataDir = setupDataDir();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-temp-'));
  writeConfigWithCpuDevice(dataDir, tempRoot);

  const discDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-disc-'));
  fs.mkdirSync(path.join(discDir, 'BDMV'), { recursive: true });

  const { taskStore, transcodeService, transcodeFlow } = freshModules();

  const task = taskStore.createTask({
    itemId: 'disc-item',
    actionType: 'transcode',
    itemInfo: {
      name: 'Disc Movie',
      path: discDir,
      type: 'movie',
      isDiscLike: true,
      targetBitrate: 4,
    },
  });

  const calls = { remux: null, start: null, replace: null };
  transcodeService.remuxDiscToMkv = async (params) => {
    calls.remux = params;
    fs.writeFileSync(params.outputPath, 'remuxed');
    return {
      ok: true,
      sourceKind: 'bluray_playlist',
      selectedPlaylist: '00001.mpls',
      clipPaths: [path.join(discDir, 'BDMV', 'STREAM', '00002.m2ts')],
      durationSec: 60,
      remuxPath: params.outputPath,
      originalDiscPath: discDir,
      replacementTargetPath: `${discDir}.mkv`,
      originalSizeBytes: 1000,
    };
  };
  transcodeService.precheck = async (_config, sourcePath) => ({
    ok: true,
    needsDvConfirm: false,
    sourcePath,
    isDolbyVision: false,
    durationSec: 60,
    originalSizeBytes: 900,
    originalVideoCodec: 'h264',
    originalWidth: 1920,
    originalHeight: 1080,
    originalAudioCodec: 'ac3',
    originalBitrate: 12000,
  });
  transcodeService.startEncode = async (_onProgress, params) => {
    calls.start = params;
    fs.writeFileSync(params.partialPath, 'encoded-output');
    return { ok: true, encoderUsed: 'cpu', resolvedDeviceId: 'cpu:libx265' };
  };
  transcodeService.probeSummary = async () => ({
    durationSec: 60,
    videoCodec: 'hevc',
    audioCodec: 'ac3',
    width: 1920,
    height: 1080,
  });
  transcodeService.extractPreviewClip = async (_config, _sourcePath, outputPath) => {
    fs.writeFileSync(outputPath, 'preview');
    return { previewPath: outputPath, method: 'copy', startSec: 0, duration: 30 };
  };
  transcodeService.replaceWithRetries = async (params) => {
    calls.replace = params;
    return { preReplaceHash: '', resultSizeBytes: 100 };
  };

  await transcodeFlow.driveTask(task.id);

  assert.ok(calls.remux, 'disc remux should run');
  assert.strictEqual(calls.remux.sourcePath, discDir);
  assert.ok(calls.start, 'encode should run after remux');
  assert.strictEqual(calls.start.sourcePath, calls.remux.outputPath);
  assert.ok(calls.replace, 'replace should run');
  assert.strictEqual(calls.replace.targetPath, `${discDir}.mkv`);
  assert.strictEqual(calls.replace.originalDiscPath, discDir);
  assert.strictEqual(taskStore.getTask(task.id).status, 'done');

  try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true }); } catch (_) {}
  try { fs.rmSync(discDir, { recursive: true }); } catch (_) {}
});
