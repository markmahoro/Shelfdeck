'use strict';

/**
 * TranscodeFlowExecutor (TRANSCODE_FLOW.md).
 *
 * Flow phases: precheck → executing → transcode_verify → replace → done
 * Bidirectional API with TaskScheduler.
 */

const fs = require('fs');
const taskStore = require('./taskStore');
const configStore = require('./configStore');
const transcodeService = require('./services/transcodeService');
const nodeStore = require('./nodeStore');
const approvalPolicy = require('./approvalPolicy');
const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');
const postOptimizeCanonicalRefresh = require('./postOptimizeCanonicalRefresh');

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

function setPhaseResumePoint(taskId, phase, resumePoint) {
  taskStore.updateTask(taskId, { phase, resumePoint });
}

function failureContext(task, phase, err, extra = {}) {
  const message = err && err.message ? err.message : String(err || extra.message || '');
  return {
    source: 'transcode_flow',
    flowKey: 'transcode',
    phase,
    resumePoint: extra.resumePoint || phase,
    recoveryClass: extra.recoveryClass || 'manual_retry_available',
    userAction: extra.userAction || 'inspect_task_failure_and_retry',
    message,
    failedAt: new Date().toISOString(),
    objectiveHash: extra.objectiveHash || (task && task.itemInfo && task.itemInfo.objectiveHash) || '',
    targetMbps: extra.targetMbps,
    targetCodec: extra.targetCodec,
    partialPath: extra.partialPath,
    sourcePath: extra.sourcePath,
  };
}

function failTask(taskId, task, phase, err, extra = {}) {
  const message = err && err.message ? err.message : String(err || extra.message || '');
  appendLog(taskId, 'error', `${extra.prefix || 'Transcode failed'}: ${message}`);
  taskStore.updateTask(taskId, {
    resumePoint: extra.resumePoint || phase,
    failureContext: failureContext(task, phase, err, extra),
  });
  scheduler.reportStatus(taskId, 'failed_hard');
  setPhase(taskId, 'failed_hard');
}

function buildDeviceSlots(config) {
  const devices = config.transcodeEncodingDevices || [];
  const cpuStrategy = config.transcodeCpuParticipationStrategy || 'normal';

  const slots = [];

  // ── Local devices (existing) ─────────────────────────────────────────────
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

  // ── Remote node devices (only in-pool devices from online nodes) ──────────
  const nodes = nodeStore.getOnlineNodes();
  for (const node of nodes) {
    for (const dev of (node.capabilities && node.capabilities.devices || [])) {
      if (dev.inPool === false) continue; // Skip devices not in pool
      const sk = parseStableKey(dev.stableKey);
      if (!sk) continue;
      slots.push({
        deviceId: `node:${node.id}:${dev.stableKey}`,
        nodeId: node.id,
        maxSlots: dev.maxSlots || 1,
        priority: dev.priority || 150,
        backend: sk.backend,
        cpuBackupOnly: false,
        remote: true,
      });
    }
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

const RATE_CONTROL_ATTEMPTS = [
  { strategy: 'qsv_vbr', encoderKind: 'qsv', label: 'QSV VBR' },
  { strategy: 'cpu_two_pass_abr', encoderKind: 'cpu', label: 'CPU two-pass ABR' },
  { strategy: 'qsv_cbr', encoderKind: 'qsv', label: 'QSV CBR' },
  { strategy: 'cpu_strict_fallback', encoderKind: 'cpu', label: 'CPU strict fallback' },
];

function rateControlState(info = {}) {
  const existing = info.transcodeRateControl && typeof info.transcodeRateControl === 'object'
    ? info.transcodeRateControl
    : {};
  return {
    currentAttemptIndex: Number.isInteger(existing.currentAttemptIndex) ? existing.currentAttemptIndex : 0,
    attempts: Array.isArray(existing.attempts) ? existing.attempts : [],
    disabledEncoders: Array.isArray(existing.disabledEncoders) ? existing.disabledEncoders : [],
  };
}

function attemptByIndex(index) {
  return RATE_CONTROL_ATTEMPTS[index] || null;
}

function attemptSlots(allSlots, attempt) {
  const list = Array.isArray(allSlots) ? allSlots : [];
  if (!attempt) return [];
  return list.filter((slot) => {
    const sk = parseStableKey(slot.deviceId);
    return sk && sk.backend === attempt.encoderKind;
  });
}

function persistRateControlState(taskId, info, state) {
  taskStore.updateTask(taskId, {
    itemInfo: {
      ...info,
      transcodeRateControl: {
        currentAttemptIndex: state.currentAttemptIndex,
        attempts: state.attempts,
        disabledEncoders: state.disabledEncoders,
      },
    },
  });
}

function currentRateControlAttempt(taskId, task, config) {
  const info = task.itemInfo || {};
  const allSlots = buildDeviceSlots(config);
  const state = rateControlState(info);
  const disabled = new Set(state.disabledEncoders);

  while (state.currentAttemptIndex < RATE_CONTROL_ATTEMPTS.length) {
    const attempt = attemptByIndex(state.currentAttemptIndex);
    if (!attempt || disabled.has(attempt.encoderKind)) {
      state.currentAttemptIndex += 1;
      continue;
    }
    const slots = attemptSlots(allSlots, attempt);
    if (slots.length > 0) {
      persistRateControlState(taskId, info, state);
      return { attempt, slots, state };
    }
    state.attempts.push({
      index: state.currentAttemptIndex + 1,
      strategy: attempt.strategy,
      encoderKind: attempt.encoderKind,
      status: 'skipped',
      reason: 'encoder_slot_unavailable',
      at: new Date().toISOString(),
    });
    if (attempt.encoderKind === 'qsv') disabled.add('qsv');
    state.disabledEncoders = Array.from(disabled);
    state.currentAttemptIndex += 1;
  }

  persistRateControlState(taskId, info, state);
  return { attempt: null, slots: [], state };
}

function recordRateControlAttempt(taskId, task, patch) {
  const info = task.itemInfo || {};
  const state = rateControlState(info);
  const attempt = attemptByIndex(state.currentAttemptIndex);
  const row = {
    index: state.currentAttemptIndex + 1,
    strategy: attempt ? attempt.strategy : '',
    encoderKind: attempt ? attempt.encoderKind : '',
    at: new Date().toISOString(),
    ...patch,
  };
  state.attempts.push(row);
  persistRateControlState(taskId, info, state);
  return state;
}

function disableEncoderForTask(taskId, task, encoderKind) {
  const info = task.itemInfo || {};
  const state = rateControlState(info);
  if (encoderKind && !state.disabledEncoders.includes(encoderKind)) {
    state.disabledEncoders.push(encoderKind);
  }
  persistRateControlState(taskId, info, state);
  return state;
}

function advanceRateControlAttempt(taskId, task) {
  const info = task.itemInfo || {};
  const state = rateControlState(info);
  state.currentAttemptIndex += 1;
  persistRateControlState(taskId, info, state);
  return state.currentAttemptIndex < RATE_CONTROL_ATTEMPTS.length;
}

function cleanupPartialOutputs(info = {}) {
  if (Array.isArray(info.partialPaths)) {
    for (const row of info.partialPaths) {
      if (row && row.partial) unlinkWithRetrySync(row.partial);
    }
    return;
  }
  if (info.partialPath) unlinkWithRetrySync(info.partialPath);
}

function isBitrateRangeVerifyError(err) {
  return err && (err.code === 'bitrate_below_range' || err.code === 'bitrate_above_range');
}

function unableToHitBitrateProfileError(lastErr) {
  const e = new Error('unable_to_hit_bitrate_profile_after_retries');
  e.code = 'unable_to_hit_bitrate_profile_after_retries';
  e.lastReason = lastErr && lastErr.code;
  return e;
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

function normalizeCodec(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['h265', 'x265', 'hevc'].includes(raw)) return 'h265';
  if (['h264', 'x264', 'avc', 'avc1'].includes(raw)) return 'h264';
  return raw;
}

function resolutionBucket(info = {}) {
  const text = String(info.bucket || info.resolution || '').toLowerCase();
  const width = Number(info.originalWidth || info.width || 0);
  const height = Number(info.originalHeight || info.height || 0);
  if (text.includes('4k') || text.includes('2160') || width >= 3000 || height >= 2000) return '4K';
  return '1080p';
}

function objectiveForTask(task = {}) {
  const target = task.taskTarget && task.taskTarget.gateObjective;
  if (target && typeof target === 'object') return target;
  const info = task.itemInfo && typeof task.itemInfo === 'object' ? task.itemInfo : {};
  return info.optimizeObjective && typeof info.optimizeObjective === 'object' ? info.optimizeObjective : {};
}

function transcodeTargetForTask(task = {}, infoOverride = {}) {
  const info = {
    ...((task.itemInfo && typeof task.itemInfo === 'object') ? task.itemInfo : {}),
    ...(infoOverride || {}),
  };
  const objective = objectiveForTask(task);
  const targetFacts = objective.targetMediaFacts && typeof objective.targetMediaFacts === 'object'
    ? objective.targetMediaFacts
    : {};
  const bucket = resolutionBucket(info);
  const bitrateProfile = bitrateObjectiveProfile.resolveBitrateProfile({
    objective,
    item: { ...info, bucket },
    bucket,
  });
  return {
    bitrateProfile,
    targetMbps: bitrateProfile ? bitrateProfile.targetMbps : undefined,
    targetCodec: normalizeCodec(info.targetCodec || objective.targetCodec || targetFacts.targetCodec),
    objectiveHash: task.objectiveHash || info.objectiveHash || (task.taskTarget && task.taskTarget.gateObjective && task.taskTarget.gateObjective.objectiveHash) || '',
  };
}

function assertVerifySatisfiesObjective({ task, info, summary, outBitrate }) {
  const target = transcodeTargetForTask(task, info);
  const expectedDuration = Number(info && (info.durationSec || info.duration));
  const actualDuration = Number(summary && summary.durationSec);
  if (Number.isFinite(expectedDuration) && expectedDuration > 0 && Number.isFinite(actualDuration) && actualDuration > 0) {
    const tolerance = Math.max(5, expectedDuration * 0.1);
    if (Math.abs(actualDuration - expectedDuration) > tolerance) {
      throw new Error(`Output duration ${actualDuration}s does not match source duration ${expectedDuration}s`);
    }
  }
  if (target.targetCodec) {
    const actualCodec = normalizeCodec(summary && summary.videoCodec);
    if (actualCodec && actualCodec !== target.targetCodec) {
      throw new Error(`Output codec ${actualCodec} does not satisfy objective codec ${target.targetCodec}`);
    }
  }
  if (target.bitrateProfile) {
    const outMbps = Number(outBitrate) / 1000;
    const comparison = bitrateObjectiveProfile.compareBitrateToProfile(outMbps, target.bitrateProfile);
    if (comparison.status === 'below') {
      const err = new Error(`Output bitrate ${outBitrate} kbps is below objective range ${target.bitrateProfile.minMbps}-${target.bitrateProfile.maxMbps} Mbps`);
      err.code = 'bitrate_below_range';
      err.bitrateKbps = outBitrate;
      err.bitrateProfile = target.bitrateProfile;
      throw err;
    }
    if (comparison.status === 'above') {
      const err = new Error(`Output bitrate ${outBitrate} kbps exceeds objective range ${target.bitrateProfile.minMbps}-${target.bitrateProfile.maxMbps} Mbps`);
      err.code = 'bitrate_above_range';
      err.bitrateKbps = outBitrate;
      err.bitrateProfile = target.bitrateProfile;
      throw err;
    }
  }
  return target;
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
  } else if (rp === 'transcode_verify') {
    await runVerify(taskId, task, config);
  } else if (rp === 'transcode_replace') {
    await runReplace(taskId, task, config);
  } else if (rp === 'transcode_publish') {
    await publishCommittedReplacement(taskId, task);
  }
}

async function publishCommittedReplacement(taskId, task) {
  const latest = taskStore.getTask(taskId) || task;
  if (!latest.mediaMutation || latest.mediaMutation.status !== 'committed') {
    appendLog(taskId, 'error', 'Cannot publish optimize facts before media mutation is committed');
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
    return false;
  }
  try {
    postOptimizeCanonicalRefresh.recordPostOptimizeReplacement(
      latest,
      latest.mediaMutation.committedAt,
      'transcode',
    );
    appendLog(taskId, 'info', 'Optimize result published; Basedata refresh requested');
    taskStore.updateTask(taskId, { resumePoint: null });
    scheduler.reportStatus(taskId, 'done', 100);
    setPhase(taskId, 'done');
    return true;
  } catch (error) {
    appendLog(taskId, 'error', `Optimize publication interrupted: ${error.message}`);
    taskStore.updateTask(taskId, { phase: 'transcode_publish', resumePoint: 'transcode_publish' });
    scheduler.reportStatus(taskId, 'interrupted');
    return false;
  }
}

async function commitAndPublishReplacement(taskId, task) {
  const committedAt = new Date().toISOString();
  const latest = taskStore.updateTask(taskId, {
    phase: 'transcode_publish',
    resumePoint: 'transcode_publish',
    mediaMutation: { status: 'committed', kind: 'replace', flowKind: 'transcode', committedAt },
  }) || task;
  return publishCommittedReplacement(taskId, latest);
}

async function runPrecheck(taskId, task, config) {
  setPhaseResumePoint(taskId, 'precheck', 'transcode_precheck');
  appendLog(taskId, 'info', 'Transcode precheck started');

  try {
    const rawPath = task.itemInfo && task.itemInfo.path;
    if (!rawPath) throw new Error('Source path not available');
    const sourcePath = resolveSourcePath(rawPath, task, config);

    const isSeason = (task.itemInfo && task.itemInfo.type) === 'season';
    const isDiscLike = !!(task.itemInfo && task.itemInfo.isDiscLike);

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

    // Compute paths and create work dir before DV check so later phases
    // (transcode_executing, etc.) have them on resume after pauseForConfirm.
    const tempRoot = config.transcodeTempRoot;
    const taskWorkDir = require('path').join(tempRoot, `etp-task-${task.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`);
    require('fs').mkdirSync(taskWorkDir, { recursive: true });

    let effectiveSourcePath = isSeason ? episodeFiles[0] : sourcePath;
    let discRemux = null;
    if (!isSeason && isDiscLike) {
      appendLog(taskId, 'info', 'Disc-like source detected — remuxing to MKV before transcode');
      const remuxPath = require('path').join(taskWorkDir, 'disc-remux.mkv');
      discRemux = await transcodeService.remuxDiscToMkv({
        config,
        taskId,
        sourcePath,
        outputPath: remuxPath,
        workDir: taskWorkDir,
        onProgress: (pct) => {
          const overall = Math.min(20, Math.floor(pct / 5));
          taskStore.setProgress(taskId, overall);
          scheduler.reportStatus(taskId, 'executing', overall);
        },
      });
      effectiveSourcePath = discRemux.remuxPath;
      appendLog(
        taskId,
        'info',
        `Disc remux complete: ${discRemux.selectedPlaylist || discRemux.sourceKind}, ${discRemux.clipPaths.length} clip(s)`,
      );
    }

    const probePath = effectiveSourcePath;
    const result = await transcodeService.precheck(config, probePath);
    const objectiveTarget = transcodeTargetForTask(task, {
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
    });

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
      const base = isDiscLike ? 'disc-remux.mkv' : require('path').basename(effectiveSourcePath);
      const ext = require('path').extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      partialPath = require('path').join(taskWorkDir, `${stem}.etp.partial${ext}`);
    }

    // Persist essential fields needed by later phases (transcode_executing, transcode_verify, replace)
    taskStore.updateTask(taskId, {
      itemInfo: {
        ...task.itemInfo,
        sourcePath: effectiveSourcePath,
        originalSourcePath: sourcePath,
        originalDiscPath: discRemux ? discRemux.originalDiscPath : undefined,
        replacementTargetPath: discRemux ? discRemux.replacementTargetPath : undefined,
        discRemuxPath: discRemux ? discRemux.remuxPath : undefined,
        discPlaylist: discRemux ? discRemux.selectedPlaylist : undefined,
        discClipPaths: discRemux ? discRemux.clipPaths : undefined,
        partialPath,
        partialPaths: partialPaths || undefined,
        episodeFiles: isSeason ? episodeFiles : undefined,
        tempDir: taskWorkDir,
        isDolbyVision: result.isDolbyVision,
        dolbyVisionTonemap: result.dolbyVisionTonemap || undefined,
        dvTonemapFilter: result.dolbyVisionTonemap && result.dolbyVisionTonemap.filterGraph || undefined,
        durationSec: result.durationSec,
        originalSizeBytes: discRemux
          ? (discRemux.originalSizeBytes || result.originalSizeBytes)
          : isSeason
          ? episodeFiles.reduce((sum, f) => { try { return sum + fs.statSync(f).size; } catch (_) { return sum; } }, 0)
          : result.originalSizeBytes,
        originalVideoCodec: result.originalVideoCodec,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        originalAudioCodec: result.originalAudioCodec,
        originalBitrate: result.originalBitrate,
        targetMbps: objectiveTarget.targetMbps,
        targetCodec: objectiveTarget.targetCodec || task.itemInfo.targetCodec,
      },
    });

    if (result.dolbyVisionTonemap) {
      const level = result.dolbyVisionTonemap.mode === 'software' ? 'warn' : 'info';
      appendLog(taskId, level, `Dolby Vision tonemap path: ${result.dolbyVisionTonemap.mode} (${result.dolbyVisionTonemap.message || result.dolbyVisionTonemap.label || 'available'})`);
    }

    if (result.needsDvConfirm && !task.dvAcknowledged) {
      const cfg = configStore.loadConfig();
      const updatedTask = taskStore.getTask(taskId) || task;
      if (!approvalPolicy.requiresConfirmation('transcode.dolbyVisionTonemap', { task: updatedTask, itemInfo: updatedTask.itemInfo, config: cfg })) {
        taskStore.updateTask(taskId, { dvAcknowledged: true });
        appendLog(taskId, 'info', 'Dolby Vision detected — approval policy auto-passed, proceeding with HDR→SDR tonemap');
      } else {
        const approval = approvalPolicy.makeApproval('transcode.dolbyVisionTonemap', {
          task: updatedTask,
          itemInfo: updatedTask.itemInfo,
          config: cfg,
          message: 'Dolby Vision will be tone-mapped before transcode.',
          options: ['approve', 'reject'],
          payload: {
            sourcePath: updatedTask.itemInfo && updatedTask.itemInfo.sourcePath,
            isDolbyVision: true,
          },
        });
        appendLog(taskId, 'info', 'Dolby Vision detected — awaiting user confirmation');
        scheduler.pauseForConfirm(taskId, 'transcode_executing', approval);
        return;
      }
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

    scheduler.reportStatus(taskId, 'executing', 0);
    await runExecuting(taskId, taskStore.getTask(taskId), config);
  } catch (e) {
    if (abortedTasks.has(taskId)) return;
    failTask(taskId, task, 'transcode_precheck', e, {
      prefix: 'Precheck failed',
      recoveryClass: 'precheck_retry',
      userAction: 'inspect_source_and_encoder_config',
      sourcePath: task && task.itemInfo && task.itemInfo.path,
    });
  }
}

async function runExecuting(taskId, task, config) {
  setPhaseResumePoint(taskId, 'transcode_executing', 'transcode_executing');
  appendLog(taskId, 'info', 'Transcode encoding started');

  const info = task.itemInfo || {};
  const isSeason = info.type === 'season';
  const selected = currentRateControlAttempt(taskId, task, config);
  if (!selected.attempt) {
    failTask(taskId, task, 'transcode_executing', unableToHitBitrateProfileError(), {
      prefix: 'Encoding failed',
      recoveryClass: 'encode_retry',
      userAction: 'inspect_encoder_failure',
    });
    return;
  }
  appendLog(taskId, 'info', `Rate-control attempt ${selected.state.currentAttemptIndex + 1}: ${selected.attempt.label}`);

  if (isSeason) {
    // ── Season: encode each episode sequentially ──
    const pairs = info.partialPaths;
    if (!pairs || pairs.length === 0) {
      failTask(taskId, task, 'transcode_executing', new Error('No episode files to encode'), {
        prefix: 'Encoding failed',
        recoveryClass: 'encode_retry',
        userAction: 'inspect_encoder_failure',
      });
      return;
    }

    const orderedSlots = selected.slots.map((s) => ({ deviceId: s.deviceId, maxSlots: s.maxSlots, cpuBackupOnly: s.cpuBackupOnly }));
    const encoderLabel = orderedSlots.length > 0 ? orderedSlots.map((s) => s.deviceId).join(', ') : 'cpu';
    appendLog(taskId, 'info', `Encoder: ${encoderLabel}, encoding ${pairs.length} episodes`);

    try {
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
            dolbyVisionTonemap: info.dolbyVisionTonemap,
            dvTonemapFilter: info.dvTonemapFilter,
            durationSec: info.durationSec || 3600,
            targetBitrate: info.targetMbps,
            bitrateProfile: selected.attempt ? transcodeTargetForTask(task, info).bitrateProfile : null,
            rateControlStrategy: selected.attempt.strategy,
            allowGpuCpuFallback: false,
            onLog: (level, msg) => appendLog(taskId, level, msg),
          },
        );
        appendLog(taskId, 'info', `Episode ${i + 1}/${totalCount} complete`);
      }
    } catch (e) {
      if (abortedTasks.has(taskId)) return;
      recordRateControlAttempt(taskId, taskStore.getTask(taskId) || task, {
        status: selected.attempt.encoderKind === 'qsv' ? 'capability_failed' : 'encode_failed',
        reason: e && e.message || String(e || 'encode_failed'),
      });
      if (selected.attempt.encoderKind === 'qsv') {
        disableEncoderForTask(taskId, taskStore.getTask(taskId) || task, 'qsv');
      }
      cleanupPartialOutputs(info);
      if (advanceRateControlAttempt(taskId, taskStore.getTask(taskId) || task)) {
        appendLog(taskId, 'warn', `Rate-control attempt failed during encode; switching strategy: ${e.message}`);
        await runExecuting(taskId, taskStore.getTask(taskId), config);
        return;
      }
      failTask(taskId, taskStore.getTask(taskId) || task, 'transcode_executing', e, {
        prefix: 'Encoding failed',
        recoveryClass: 'encode_retry',
        userAction: 'inspect_encoder_failure',
      });
      return;
    }

    appendLog(taskId, 'info', 'All episodes encoded');
  } else {
    // ── Single file (movie) ──
    const sourcePath = info.sourcePath;
    const partialPath = info.partialPath;

    if (!sourcePath || !partialPath) {
      failTask(taskId, task, 'transcode_executing', new Error('Missing source or partial path'), {
        prefix: 'Encoding failed',
        recoveryClass: 'encode_retry',
        userAction: 'inspect_source_and_partial_path',
        sourcePath,
        partialPath,
      });
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

    const orderedSlots = selected.slots.map((s) => ({ deviceId: s.deviceId, maxSlots: s.maxSlots, cpuBackupOnly: s.cpuBackupOnly }));

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
          dolbyVisionTonemap: info.dolbyVisionTonemap,
          dvTonemapFilter: info.dvTonemapFilter,
          durationSec: info.durationSec || 3600,
          targetBitrate: info.targetMbps,
          bitrateProfile: selected.attempt ? transcodeTargetForTask(task, info).bitrateProfile : null,
          rateControlStrategy: selected.attempt.strategy,
          allowGpuCpuFallback: false,
          onLog: (level, msg) => appendLog(taskId, level, msg),
        },
      );

      if (abortedTasks.has(taskId)) return;
      appendLog(taskId, 'info', 'Encoding complete');
    } catch (e) {
      if (abortedTasks.has(taskId)) return;
      recordRateControlAttempt(taskId, taskStore.getTask(taskId) || task, {
        status: selected.attempt.encoderKind === 'qsv' ? 'capability_failed' : 'encode_failed',
        reason: e && e.message || String(e || 'encode_failed'),
      });
      if (selected.attempt.encoderKind === 'qsv') {
        disableEncoderForTask(taskId, taskStore.getTask(taskId) || task, 'qsv');
      }
      cleanupPartialOutputs(info);
      if (advanceRateControlAttempt(taskId, taskStore.getTask(taskId) || task)) {
        appendLog(taskId, 'warn', `Rate-control attempt failed during encode; switching strategy: ${e.message}`);
        await runExecuting(taskId, taskStore.getTask(taskId), config);
        return;
      }
      failTask(taskId, task, 'transcode_executing', e, {
        prefix: 'Encoding failed',
        recoveryClass: 'encode_retry',
        userAction: 'inspect_encoder_failure',
        sourcePath,
        partialPath,
        targetMbps: info.targetMbps,
        targetCodec: info.targetCodec,
      });
      return;
    }
  }

  taskStore.updateTask(taskId, { resumePoint: 'transcode_verify' });
  await runVerify(taskId, taskStore.getTask(taskId), config);
}

async function runVerify(taskId, task, config) {
  if (abortedTasks.has(taskId)) return;
  setPhaseResumePoint(taskId, 'transcode_verify', 'transcode_verify');
  scheduler.reportStatus(taskId, 'executing', 90);
  appendLog(taskId, 'info', 'Verifying transcode output');

  const info = task.itemInfo || {};
  const isSeason = info.type === 'season';
  const partialPath = info.partialPath;

  if (!partialPath) {
    failTask(taskId, task, 'transcode_verify', new Error('Partial path not available for verify'), {
      prefix: 'Verify failed',
      recoveryClass: 'verify_retry',
      userAction: 'inspect_partial_output',
    });
    return;
  }

  if (isSeason) {
    // Verify all episode partials exist
    const pairs = info.partialPaths || [];
    for (const { partial } of pairs) {
      if (!fs.existsSync(partial)) {
        failTask(taskId, task, 'transcode_verify', new Error(`Missing partial: ${partial}`), {
          prefix: 'Verify failed',
          recoveryClass: 'verify_retry',
          userAction: 'inspect_partial_output',
          partialPath: partial,
        });
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
      appendLog(taskId, 'info', `Output larger than input (${outGb}GB > ${origGb}GB) — discarding, original kept`);
      try { fs.unlinkSync(partialPath); } catch (_) {}
      const tempDir = task.itemInfo && task.itemInfo.tempDir;
      if (tempDir) transcodeService.cleanupTaskWorkdir(tempDir);
      scheduler.reportStatus(taskId, 'done', 100);
      setPhase(taskId, 'done');
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

    const objectiveTarget = assertVerifySatisfiesObjective({
      task,
      info,
      summary,
      outBitrate,
    });
    const latestBeforeVerifyResult = taskStore.getTask(taskId) || task;
    const rcState = recordRateControlAttempt(taskId, latestBeforeVerifyResult, {
      status: 'verified',
      actualKbps: outBitrate,
      bitrateProfile: objectiveTarget.bitrateProfile || undefined,
    });
    const latestAfterAttemptRecord = taskStore.getTask(taskId) || latestBeforeVerifyResult;

    taskStore.updateTask(taskId, {
      verifyResult: {
        sizeBytes: outSizeBytes,
        videoCodec: summary.videoCodec,
        audioCodec: summary.audioCodec,
        width: summary.width,
        height: summary.height,
        bitrate: outBitrate,
        durationSec: summary.durationSec,
        outputPath: partialPath,
        previewPath,
        bytesSaved: ((task.itemInfo && task.itemInfo.originalSizeBytes || 0) - outSizeBytes),
        objectiveHash: objectiveTarget.objectiveHash || undefined,
        targetMbps: objectiveTarget.targetMbps || undefined,
        targetCodec: objectiveTarget.targetCodec || undefined,
        bitrateProfile: objectiveTarget.bitrateProfile || undefined,
        rateControlAttempt: {
          index: rcState.currentAttemptIndex + 1,
          strategy: attemptByIndex(rcState.currentAttemptIndex) && attemptByIndex(rcState.currentAttemptIndex).strategy,
        },
        rateControlAttempts: rcState.attempts,
        disabledEncoders: rcState.disabledEncoders,
      },
    });

    const latestTask = taskStore.getTask(taskId) || latestAfterAttemptRecord;
    if (approvalPolicy.requiresConfirmation('transcode.beforeReplace', { task: latestTask, itemInfo: latestTask.itemInfo, config })) {
      const approval = approvalPolicy.makeApproval('transcode.beforeReplace', {
        task: latestTask,
        itemInfo: latestTask.itemInfo,
        config,
        message: 'Transcode finished. Confirm before replacing the original media.',
        options: ['approve', 'reject'],
        payload: {
          originalPath: latestTask.itemInfo && latestTask.itemInfo.sourcePath,
          outputPath: latestTask.itemInfo && latestTask.itemInfo.partialPath,
          verifyResult: latestTask.verifyResult,
        },
      });
      appendLog(taskId, 'info', 'Replace confirmation required — awaiting user');
      scheduler.pauseForConfirm(taskId, 'transcode_replace', approval);
      return;
    }

    appendLog(taskId, 'info', 'Replace approval auto-passed');
    taskStore.updateTask(taskId, { resumePoint: 'transcode_replace' });
    await runReplace(taskId, latestTask, config);
  } catch (e) {
    if (abortedTasks.has(taskId)) return;
    if (isBitrateRangeVerifyError(e)) {
      const latest = taskStore.getTask(taskId) || task;
      recordRateControlAttempt(taskId, latest, {
        status: 'produced_but_not_in_range',
        reason: e.code,
        actualKbps: e.bitrateKbps,
        bitrateProfile: e.bitrateProfile,
      });
      cleanupPartialOutputs((latest && latest.itemInfo) || info);
      if (advanceRateControlAttempt(taskId, taskStore.getTask(taskId) || latest)) {
        appendLog(taskId, 'warn', `Rate-control attempt produced ${e.code}; switching strategy`);
        taskStore.updateTask(taskId, { resumePoint: 'transcode_executing' });
        await runExecuting(taskId, taskStore.getTask(taskId), config);
        return;
      }
      failTask(taskId, taskStore.getTask(taskId) || latest, 'transcode_verify', unableToHitBitrateProfileError(e), {
        prefix: 'Verify failed',
        recoveryClass: 'verify_retry',
        userAction: 'inspect_verify_failure',
        partialPath,
        targetMbps: info.targetMbps,
        targetCodec: info.targetCodec,
      });
      return;
    }
    failTask(taskId, task, 'transcode_verify', e, {
      prefix: 'Verify failed',
      recoveryClass: 'verify_retry',
      userAction: 'inspect_verify_failure',
      partialPath,
      targetMbps: info.targetMbps,
      targetCodec: info.targetCodec,
    });
  }
}

async function runReplace(taskId, task, config) {
  if (scheduler && typeof scheduler.assertHelixAdmission === 'function') {
    scheduler.assertHelixAdmission(taskId, 'transcode_replace');
  }
  setPhaseResumePoint(taskId, 'transcode_replace', 'transcode_replace');
  appendLog(taskId, 'info', 'Replacing original file');

  const info = task.itemInfo || {};
  const isSeason = info.type === 'season';

  if (isSeason) {
    // Season: replace each episode file individually
    const pairs = info.partialPaths || [];
    if (pairs.length === 0) {
      failTask(taskId, task, 'transcode_replace', new Error('No episode partial paths for replace'), {
        prefix: 'Replace failed',
        recoveryClass: 'replace_retry',
        userAction: 'inspect_replace_target',
      });
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
      await commitAndPublishReplacement(taskId, taskStore.getTask(taskId) || task);
      const tempDir = info.tempDir;
      if (tempDir) transcodeService.cleanupTaskWorkdir(tempDir);
    } catch (e) {
      if (abortedTasks.has(taskId)) return;
      failTask(taskId, task, 'transcode_replace', e, {
        prefix: 'Replace failed',
        recoveryClass: 'replace_retry',
        userAction: 'inspect_replace_target',
      });
    }
    return;
  }

  // Single file (movie)
  const targetPath = info.replacementTargetPath || info.sourcePath;
  const partialPath = info.partialPath;

  if (!targetPath || !partialPath) {
    failTask(taskId, task, 'transcode_replace', new Error('Missing paths for replace'), {
      prefix: 'Replace failed',
      recoveryClass: 'replace_retry',
      userAction: 'inspect_replace_target',
      sourcePath: targetPath,
      partialPath,
    });
    return;
  }

  try {
    await transcodeService.replaceWithRetries({
      config,
      targetPath,
      partialPath,
      originalDiscPath: info.originalDiscPath,
    });
    appendLog(taskId, 'info', 'Replace complete');
    await commitAndPublishReplacement(taskId, taskStore.getTask(taskId) || task);
    const tempDir = info.tempDir;
    if (tempDir) transcodeService.cleanupTaskWorkdir(tempDir);
  } catch (e) {
    if (abortedTasks.has(taskId)) return;
    failTask(taskId, task, 'transcode_replace', e, {
      prefix: 'Replace failed',
      recoveryClass: 'replace_retry',
      userAction: 'inspect_replace_target',
      sourcePath: targetPath,
      partialPath,
    });
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
