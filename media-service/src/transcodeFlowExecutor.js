'use strict';

/**
 * TranscodeFlowExecutor (TRANSCODE_FLOW.md).
 *
 * Flow phases: precheck → executing → verify → replace → done
 * Bidirectional API with TaskScheduler.
 */

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const transcodeService = require('./services/transcodeService');

let scheduler = null;
function setScheduler(s) { scheduler = s; }

function appendLog(taskId, level, msg) {
  const entry = { ts: new Date().toISOString(), level, msg };
  taskStore.updateTask(taskId, { logs: [entry] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

function buildDeviceSlots(config) {
  const devices = config.transcodeEncodingDevices || [];
  const cpuStrategy = config.transcodeCpuParticipationStrategy || 'normal';
  const maxCpuSlots = config.transcodeMaxCpuSlots || 1;

  const slots = [];
  for (const dev of devices) {
    if (!dev.inPool) continue;
    const sk = parseStableKey(dev.stableKey);
    if (!sk) continue;
    if (sk.backend === 'cpu' && cpuStrategy === 'backup_only') continue;
    slots.push({
      deviceId: dev.stableKey,
      maxSlots: sk.backend === 'cpu' ? maxCpuSlots : (dev.maxSlots || 1),
      priority: dev.priority || 100,
      backend: sk.backend,
    });
  }
  slots.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.backend === 'cpu' ? 1 : -1;
  });
  return slots;
}

function parseStableKey(stableKey) {
  const s = String(stableKey || '');
  if (s.startsWith('cpu:')) return { backend: 'cpu', gpuIndex: -1 };
  if (s.startsWith('nvenc:')) return { backend: 'nvenc', gpuIndex: parseInt(s.slice(7), 10) || 0 };
  if (s.startsWith('qsv:')) return { backend: 'qsv', gpuIndex: parseInt(s.slice(4), 10) || 0 };
  if (s.startsWith('amf:')) return { backend: 'amf', gpuIndex: parseInt(s.slice(4), 10) || 0 };
  return null;
}

// ── Flow Executor API ────────────────────────────────────────────────────────

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  const rp = task.resumePoint || 'transcode_precheck';
  const config = configStore.loadConfig();

  if (rp === 'transcode_precheck') {
    await runPrecheck(taskId, task, config);
  } else if (rp === 'transcode_executing') {
    await runExecuting(taskId, task, config);
  } else if (rp === 'transcode_replace') {
    await runReplace(taskId, task, config);
  }
}

async function runPrecheck(taskId, task, config) {
  setPhase(taskId, 'precheck');
  appendLog(taskId, 'info', 'Transcode precheck started');

  try {
    const sourcePath = task.itemInfo && task.itemInfo.path;
    if (!sourcePath) throw new Error('Source path not available');

    const result = await transcodeService.precheck(config, sourcePath);

    if (result.needsDvConfirm && !task.dvAcknowledged) {
      appendLog(taskId, 'info', 'Dolby Vision detected — awaiting user confirmation');
      scheduler.pauseForConfirm(taskId, 'transcode_executing');
      return;
    }

    // Check device pool
    const slots = buildDeviceSlots(config);
    if (slots.length === 0) {
      throw new Error('No encode devices in pool');
    }

    // Estimate output size vs original
    if (result.originalSizeGb !== undefined) {
      appendLog(taskId, 'info', `Source: ${result.originalSizeGb.toFixed(2)} GB, ${result.durationSec}s`);
    }

    // Store precheck results on task for later phases
    const tempRoot = config.transcodeTempRoot;
    const taskWorkDir = require('path').join(tempRoot, `etp-task-${task.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`);
    require('fs').mkdirSync(taskWorkDir, { recursive: true });

    const base = require('path').basename(sourcePath);
    const ext = require('path').extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const partialPath = require('path').join(taskWorkDir, `${stem}.etp.partial${ext}`);

    taskStore.updateTask(taskId, {
      itemInfo: {
        ...task.itemInfo,
        sourcePath,
        partialPath,
        tempDir: taskWorkDir,
        isDolbyVision: result.isDolbyVision,
        durationSec: result.durationSec,
      },
    });

    scheduler.reportStatus(taskId, 'executing', 0);
    await runExecuting(taskId, taskStore.getTask(taskId), config);
  } catch (e) {
    appendLog(taskId, 'error', `Precheck failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

async function runExecuting(taskId, task, config) {
  setPhase(taskId, 'transcode_executing');
  appendLog(taskId, 'info', 'Transcode encoding started');

  const info = task.itemInfo || {};
  const sourcePath = info.sourcePath;
  const partialPath = info.partialPath;

  if (!sourcePath || !partialPath) {
    appendLog(taskId, 'error', 'Missing source or partial path');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  const slots = buildDeviceSlots(config);
  const orderedSlots = slots.map((s) => ({ deviceId: s.deviceId, maxSlots: s.maxSlots }));

  try {
    await transcodeService.startEncode(
      (pct) => {
        taskStore.updateTask(taskId, { progress: pct });
        scheduler.reportStatus(taskId, 'executing', pct);
      },
      {
        config,
        taskId,
        sourcePath,
        partialPath,
        orderedDeviceSlots: orderedSlots,
        isDolbyVision: info.isDolbyVision,
        dvAcknowledged: task.dvAcknowledged || false,
        durationSec: info.durationSec || 3600,
      },
    );

    appendLog(taskId, 'info', 'Encoding complete');
    await runVerify(taskId, task, config);
  } catch (e) {
    appendLog(taskId, 'error', `Encoding failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

async function runVerify(taskId, task, config) {
  setPhase(taskId, 'verify');
  scheduler.reportStatus(taskId, 'executing', 90);
  appendLog(taskId, 'info', 'Verifying transcode output');

  const partialPath = task.itemInfo && task.itemInfo.partialPath;
  if (!partialPath) {
    appendLog(taskId, 'error', 'Partial path not available for verify');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  try {
    const summary = await transcodeService.probeSummary(config, partialPath);
    if (summary.durationSec <= 0) throw new Error('Output duration is zero');
    appendLog(taskId, 'info', `Verify OK: ${summary.width}x${summary.height}, ${summary.videoCodec}, ${summary.durationSec}s`);

    // Check if replace confirmation is required
    if (config.transcodeReplaceConfirmRequired) {
      appendLog(taskId, 'info', 'Replace confirmation required — awaiting user');
      scheduler.pauseForConfirm(taskId, 'transcode_replace');
      return;
    }

    await runReplace(taskId, task, config);
  } catch (e) {
    appendLog(taskId, 'error', `Verify failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

async function runReplace(taskId, task, config) {
  setPhase(taskId, 'transcode_replace');
  appendLog(taskId, 'info', 'Replacing original file');

  const targetPath = task.itemInfo && task.itemInfo.sourcePath;
  const partialPath = task.itemInfo && task.itemInfo.partialPath;

  if (!targetPath || !partialPath) {
    appendLog(taskId, 'error', 'Missing paths for replace');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  try {
    await transcodeService.replaceWithRetries({ config, targetPath, partialPath });
    appendLog(taskId, 'info', 'Replace complete');
    scheduler.reportStatus(taskId, 'done', 100);
    setPhase(taskId, 'done');
  } catch (e) {
    appendLog(taskId, 'error', `Replace failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

function pause(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  transcodeService.abortTask(taskId);
  appendLog(taskId, 'info', 'Transcode paused by user');
  scheduler.reportStatus(taskId, 'paused', task.progress || 0);
}

function cancel(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  transcodeService.abortTask(taskId);
  // Clean up partial file
  const partialPath = task.itemInfo && task.itemInfo.partialPath;
  if (partialPath) {
    try { require('fs').unlinkSync(partialPath); } catch (_) {}
  }
  appendLog(taskId, 'info', 'Transcode cancelled by user');
  scheduler.reportStatus(taskId, 'done');
}

function confirmReceived(taskId) {
  // Called by confirm API after user confirms
}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
