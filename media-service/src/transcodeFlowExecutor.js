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

function resolveSourcePath(sourcePath, task, config) {
  const subLibId = task.itemInfo && task.itemInfo.subLibraryId;
  const subLib = subLibId && (config.subLibraries || []).find((s) => s.uuid === subLibId);
  const from = (subLib && subLib.pathMapFrom || '').trim();
  const to = (subLib && subLib.pathMapTo || '').trim();
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
    const sourcePath = resolveSourcePath(rawPath, task, config);

    const isSeason = (task.itemInfo && task.itemInfo.type) === 'season';

    // For seasons: enumerate all episode files in the season folder
    let episodeFiles = [];
    if (isSeason) {
      let seasonDir = sourcePath;
      try { if (fs.statSync(seasonDir).isFile()) seasonDir = require('path').dirname(seasonDir); } catch (_) {}
      if (fs.existsSync(seasonDir)) {
        const entries = fs.readdirSync(seasonDir, { withFileTypes: true });
        const mediaExts = ['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov'];
        episodeFiles = entries
          .filter((e) => e.isFile() && mediaExts.includes(require('path').extname(e.name).toLowerCase()))
          .map((e) => require('path').join(seasonDir, e.name))
          .sort();
      }
      if (episodeFiles.length === 0) throw new Error('No media files found in season folder: ' + seasonDir);
      appendLog(taskId, 'info', `Season: ${episodeFiles.length} episode files found`);
    }

    const probePath = isSeason ? episodeFiles[0] : sourcePath;
    const result = await transcodeService.precheck(config, probePath);

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
      const totalSize = isSeason
        ? episodeFiles.reduce((sum, f) => { try { return sum + fs.statSync(f).size; } catch (_) { return sum; } }, 0)
        : result.originalSizeBytes;
      const srcGb = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
      appendLog(taskId, 'info', `Source: ${srcGb} GB, ${result.durationSec}s${isSeason ? ` (${episodeFiles.length} episodes)` : ''}`);
    }

    // Store precheck results on task for later phases
    const tempRoot = config.transcodeTempRoot;
    const taskWorkDir = require('path').join(tempRoot, `etp-task-${task.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`);
    require('fs').mkdirSync(taskWorkDir, { recursive: true });

    let partialPath, partialPaths;
    if (isSeason) {
      partialPaths = episodeFiles.map((fp) => {
        const base = require('path').basename(fp);
        const ext = require('path').extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        return { source: fp, partial: require('path').join(taskWorkDir, `${stem}.etp.partial${ext}`) };
      });
      partialPath = partialPaths[0].partial; // for verify preview
    } else {
      const base = require('path').basename(sourcePath);
      const ext = require('path').extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      partialPath = require('path').join(taskWorkDir, `${stem}.etp.partial${ext}`);
    }

    taskStore.updateTask(taskId, {
      itemInfo: {
        ...task.itemInfo,
        sourcePath,
        partialPath,
        partialPaths: partialPaths || undefined,
        episodeFiles: isSeason ? episodeFiles : undefined,
        tempDir: taskWorkDir,
        isDolbyVision: result.isDolbyVision,
        durationSec: result.durationSec,
        originalSizeBytes: isSeason
          ? episodeFiles.reduce((sum, f) => { try { return sum + fs.statSync(f).size; } catch (_) { return sum; } }, 0)
          : result.originalSizeBytes,
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
  const isSeason = info.type === 'season';

  if (isSeason) {
    // ── Season: encode each episode sequentially ──
    const pairs = info.partialPaths;
    if (!pairs || pairs.length === 0) {
      appendLog(taskId, 'error', 'No episode files to encode');
      scheduler.reportStatus(taskId, 'failed_hard');
      return;
    }

    const slots = buildDeviceSlots(config);
    const orderedSlots = slots.map((s) => ({ deviceId: s.deviceId, maxSlots: s.maxSlots, cpuBackupOnly: s.cpuBackupOnly }));
    const encoderLabel = orderedSlots.length > 0 ? orderedSlots.map((s) => s.deviceId).join(', ') : 'cpu';
    appendLog(taskId, 'info', `Encoder: ${encoderLabel}, encoding ${pairs.length} episodes`);

    const totalCount = pairs.length;
    for (let i = 0; i < totalCount; i++) {
      if (abortedTasks.has(taskId)) return;
      const { source, partial } = pairs[i];
      appendLog(taskId, 'info', `Encoding episode ${i + 1}/${totalCount}: ${require('path').basename(source)}`);

      // Clean up residual partial
      if (fs.existsSync(partial)) {
        unlinkWithRetrySync(partial);
      }

      const baseProgress = (i / totalCount) * 100;
      await transcodeService.startEncode(
        (pct) => {
          const overall = Math.round(baseProgress + pct / totalCount);
          taskStore.setProgress(taskId, overall);
          scheduler.reportStatus(taskId, 'executing', overall);
        },
        {
          config,
          taskId,
          sourcePath: source,
          partialPath: partial,
          orderedDeviceSlots: orderedSlots,
          isDolbyVision: info.isDolbyVision,
          dvAcknowledged: task.dvAcknowledged || false,
          durationSec: info.durationSec || 3600,
          targetBitrate: info.targetBitrate,
        },
      );
      appendLog(taskId, 'info', `Episode ${i + 1}/${totalCount} complete`);
    }

    appendLog(taskId, 'info', 'All episodes encoded');
  } else {
    // ── Single file (movie) ──
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
          taskStore.setProgress(taskId, pct);
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
          targetBitrate: info.targetBitrate,
        },
      );

      appendLog(taskId, 'info', 'Encoding complete');
    } catch (e) {
      if (abortedTasks.has(taskId)) return;
      appendLog(taskId, 'error', `Encoding failed: ${e.message}`);
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }
  }

  await runVerify(taskId, taskStore.getTask(taskId), config);
}

async function runVerify(taskId, task, config) {
  setPhase(taskId, 'verify');
  scheduler.reportStatus(taskId, 'executing', 90);
  appendLog(taskId, 'info', 'Verifying transcode output');

  const info = task.itemInfo || {};
  const isSeason = info.type === 'season';
  const partialPath = info.partialPath;

  if (!partialPath) {
    appendLog(taskId, 'error', 'Partial path not available for verify');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  if (isSeason) {
    // Verify all episode partials exist
    const pairs = info.partialPaths || [];
    for (const { partial } of pairs) {
      if (!fs.existsSync(partial)) {
        appendLog(taskId, 'error', `Missing partial: ${partial}`);
        scheduler.reportStatus(taskId, 'failed_hard');
        return;
      }
    }
    appendLog(taskId, 'info', `All ${pairs.length} episode partials verified`);
  }

  try {
    const summary = await transcodeService.probeSummary(config, partialPath);
    if (summary.durationSec <= 0) throw new Error('Output duration is zero');
    appendLog(taskId, 'info', `Verify OK: ${summary.width}x${summary.height}, ${summary.videoCodec}, ${summary.durationSec}s`);

    const episodeCount = isSeason ? (info.partialPaths || []).length : 1;
    const outSizeBytes = isSeason
      ? (info.partialPaths || []).reduce((sum, { partial }) => { try { return sum + fs.statSync(partial).size; } catch (_) { return sum; } }, 0)
      : fs.statSync(partialPath).size;
    const outBitrate = summary.durationSec > 0
      ? Math.round((outSizeBytes * 8) / (summary.durationSec * episodeCount * 1000))
      : 0;

    // Discard output if it ended up larger than the source
    const originalBytes = task.itemInfo && task.itemInfo.originalSizeBytes || 0;
    if (originalBytes > 0 && outSizeBytes > originalBytes) {
      const origGb = (originalBytes / 1e9).toFixed(2);
      const outGb = (outSizeBytes / 1e9).toFixed(2);
      appendLog(taskId, 'warn', `Output larger than input (${outGb}GB > ${origGb}GB) — discarding`);
      try { fs.unlinkSync(partialPath); } catch (_) {}
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }

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

    const sched = configStore.resolveSubLibSchedule(task.itemInfo || {}, config);
    if (!sched.autoReplaceTranscode) {
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

  const info = task.itemInfo || {};
  const isSeason = info.type === 'season';

  if (isSeason) {
    // Season: replace each episode file individually
    const pairs = info.partialPaths || [];
    if (pairs.length === 0) {
      appendLog(taskId, 'error', 'No episode partial paths for replace');
      scheduler.reportStatus(taskId, 'failed_hard');
      return;
    }
    appendLog(taskId, 'info', `Replacing ${pairs.length} episode files`);
    try {
      for (const { source, partial } of pairs) {
        if (!fs.existsSync(partial)) throw new Error('Missing partial: ' + partial);
        await transcodeService.replaceWithRetries({ config, targetPath: source, partialPath: partial });
        appendLog(taskId, 'info', `Replaced: ${require('path').basename(source)}`);
      }
      appendLog(taskId, 'info', `All ${pairs.length} episodes replaced`);
      scheduler.reportStatus(taskId, 'done', 100);
      setPhase(taskId, 'done');
      const tempDir = info.tempDir;
      if (tempDir) transcodeService.cleanupTaskWorkdir(tempDir);
    } catch (e) {
      if (abortedTasks.has(taskId)) return;
      appendLog(taskId, 'error', `Replace failed: ${e.message}`);
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
    }
    return;
  }

  // Single file (movie)
  const targetPath = info.sourcePath;
  const partialPath = info.partialPath;

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
    const tempDir = info.tempDir;
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
  scheduler.reportStatus(taskId, 'paused', taskStore.getProgress(taskId));
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
