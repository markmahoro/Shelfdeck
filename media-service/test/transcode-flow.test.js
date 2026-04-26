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

function createPartialFile(tempRoot) {
  const partialPath = path.join(tempRoot, `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.etp.partial.mkv`);
  fs.writeFileSync(partialPath, 'fake-encode-output-data');
  return partialPath;
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
