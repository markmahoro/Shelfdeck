'use strict';

/**
 * TranscodeFlowExecutor (TRANSCODE_FLOW.md).
 *
 * Flow phases: precheck → executing → verify → replace → done
 * Bidirectional API with TaskScheduler.
 */

const fs = require('fs');
const taskStore = require('./taskStore');
const configStore = require('./configStore');
const transcodeService = require('./services/transcodeService');

// Tracks tasks intentionally aborted by pause/cancel so catch blocks
// in async flow phases don't overwrite the status with failed_hard.
const abortedTasks = new Set();

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

  const slots = [];
  for (const dev of devices) {
    if (!dev.inPool) continue;
    const sk = parseStableKey(dev.stableKey);
    if (!sk) continue;
    slots.push({
      deviceId: dev.stableKey,
      maxSlots: dev.maxSlots || 1,
      priority: dev.priority || 100,
      backend: sk.backend,
      cpuBackupOnly: sk.backend === 'cpu' && cpuStrategy === 'backup_only',
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

function resolveSourcePath(sourcePath, config) {
  const from = (config.pathMapFrom || '').trim();
  const to = (config.pathMapTo || '').trim();
  if (from && to && sourcePath.startsWith(from)) {
    const relative = sourcePath.slice(from.length).replace(/^\//, '');
    return require('path').join(to, relative);
  }
  return sourcePath;
}

// ── Flow Executor API ────────────────────────────────────────────────────────

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  // Clear stale abort flag so resumed tasks aren't silently swallowed
  abortedTasks.delete(taskId);

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
    const rawPath = task.itemInfo && task.itemInfo.path;
    if (!rawPath) throw new Error('Source path not available');
    const sourcePath = resolveSourcePath(rawPath, config);

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
    if (result.originalSizeBytes !== undefined) {
      const srcGb = (result.originalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
      appendLog(taskId, 'info', `Source: ${srcGb} GB, ${result.durationSec}s`);
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
        originalSizeBytes: result.originalSizeBytes,
        originalVideoCodec: result.originalVideoCodec,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        originalAudioCodec: result.originalAudioCodec,
        originalBitrate: result.originalBitrate,
      },
    });

    scheduler.reportStatus(taskId, 'executing', 0);
    await runExecuting(taskId, taskStore.getTask(taskId), config);
  } catch (e) {
    if (abortedTasks.has(taskId)) return;
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

  // Clean up residual partial from a previous interrupted encode (FFmpeg cannot resume)
  if (fs.existsSync(partialPath)) {
    const deleted = unlinkWithRetrySync(partialPath);
    if (deleted) {
      appendLog(taskId, 'info', 'Cleaned up leftover partial from previous run');
    } else {
      appendLog(taskId, 'warn', 'Could not delete leftover partial — file may be locked by orphan process');
    }
  }

  const slots = buildDeviceSlots(config);
  const orderedSlots = slots.map((s) => ({ deviceId: s.deviceId, maxSlots: s.maxSlots, cpuBackupOnly: s.cpuBackupOnly }));

  try {
    const encoderLabel = orderedSlots.length > 0
      ? orderedSlots.map((s) => s.deviceId).join(', ')
      : 'cpu';
    appendLog(taskId, 'info', `Encoder: ${encoderLabel}`);

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
    if (abortedTasks.has(taskId)) return;
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

    const outSizeBytes = fs.statSync(partialPath).size;
    const outBitrate = summary.durationSec > 0
      ? Math.round((outSizeBytes * 8) / (summary.durationSec * 1000))
      : 0;

    // Generate preview clip for trial viewing
    let previewPath = null;
    try {
      const previewFile = require('path').join(task.itemInfo.tempDir, 'preview.mp4');
      const previewResult = await transcodeService.extractPreviewClip(config, partialPath, previewFile);
      appendLog(taskId, 'info', `Preview clip generated (${previewResult.method}, ${previewResult.duration}s from ${previewResult.startSec}s)`);
      previewPath = previewResult.previewPath;
    } catch (e) {
      appendLog(taskId, 'warn', `Preview clip generation failed: ${e.message}`);
    }

    taskStore.updateTask(taskId, {
      verifyResult: {
        sizeBytes: outSizeBytes,
        videoCodec: summary.videoCodec,
        audioCodec: summary.audioCodec,
        width: summary.width,
        height: summary.height,
        bitrate: outBitrate,
        durationSec: summary.durationSec,
        previewPath,
        bytesSaved: ((task.itemInfo && task.itemInfo.originalSizeBytes || 0) - outSizeBytes),
      },
    });

    if (config.transcodeReplaceConfirmRequired) {
      appendLog(taskId, 'info', 'Replace confirmation required — awaiting user');
      scheduler.pauseForConfirm(taskId, 'transcode_replace');
      return;
    }

    await runReplace(taskId, task, config);
  } catch (e) {
    if (abortedTasks.has(taskId)) return;
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
    const tempDir = task.itemInfo && task.itemInfo.tempDir;
    if (tempDir) transcodeService.cleanupTaskWorkdir(tempDir);
  } catch (e) {
    if (abortedTasks.has(taskId)) return;
    appendLog(taskId, 'error', `Replace failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

// Windows: after abortTask kills FFmpeg, the file handle may not be
// released immediately. Retry unlink up to 2s to avoid silent failure.
function unlinkWithRetrySync(filePath) {
  const maxAttempts = 20;
  const delayMs = 100;
  for (let i = 0; i < maxAttempts; i++) {
    try { require('fs').unlinkSync(filePath); return true; } catch (_) {}
    if (i < maxAttempts - 1) {
      // Synchronous sleep approximation
      const end = Date.now() + delayMs;
      while (Date.now() < end) { /* busy-wait for short delay */ }
    }
  }
  return false;
}

function pause(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  abortedTasks.add(taskId);
  transcodeService.abortTask(taskId);

  const phase = task.phase || '';
  const partialPath = task.itemInfo && task.itemInfo.partialPath;

  // During replace, partialPath is the finished transcode output — never destroy it
  if (phase !== 'transcode_replace' && partialPath) {
    unlinkWithRetrySync(partialPath);
  }
  appendLog(taskId, 'info', 'Transcode paused by user');
  scheduler.reportStatus(taskId, 'paused', task.progress || 0);
}

function cancel(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  abortedTasks.add(taskId);
  transcodeService.abortTask(taskId);
  // Clean up partial file
  const partialPath = task.itemInfo && task.itemInfo.partialPath;
  if (partialPath) {
    unlinkWithRetrySync(partialPath);
  }
  appendLog(taskId, 'info', 'Transcode cancelled by user');
  setPhase(taskId, 'done');
  scheduler.reportStatus(taskId, 'done');
}

function confirmReceived(taskId) {
  // Called by confirm API after user confirms
}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
