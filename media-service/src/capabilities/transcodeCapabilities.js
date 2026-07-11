'use strict';

const fs = require('fs');
const path = require('path');
const sourceAccessResolver = require('../sourceAccessResolver');
const transcodeService = require('../services/transcodeService');
const bitrateObjectiveProfile = require('../bitrateObjectiveProfile');
const transcodeDevicePlan = require('../transcodeDevicePlan');

function targetFacts(task = {}) {
  const objective = task.taskTarget && task.taskTarget.gateObjective || {};
  return objective.targetMediaFacts || objective;
}
function sourcePathFor(task) {
  const canonical = task.itemInfo && (task.itemInfo.path || task.itemInfo.sourcePath)
    || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor && task.helixAdmission.sourceAccessDescriptor.locator && task.helixAdmission.sourceAccessDescriptor.locator.path;
  return sourceAccessResolver.resolve(canonical, { mustExist: true }).accessPath;
}
function profileFor(task, info) {
  return bitrateObjectiveProfile.resolveBitrateProfile({ objective: { targetMediaFacts: targetFacts(task) }, item: { ...(task.itemInfo || {}), ...info } });
}

function registerTranscodeCapabilities(register) {
  register({ capability: 'media.transcode.precheck', allowedTargetGates: ['optimize'], execute: async ({ task, event, config }) => {
    const sourcePath = sourcePathFor(task);
    const observation = await transcodeService.precheck(config, sourcePath);
    const bitrateProfile = profileFor(task, { originalWidth: observation.originalWidth, originalHeight: observation.originalHeight });
    if (!bitrateProfile) throw Object.assign(new Error('Optimize objective has no bitrate profile'), { code: 'KAIROX_TRANSCODE_PROFILE_MISSING' });
    const deviceSlots = transcodeDevicePlan.buildDeviceSlots(config);
    const rateControlPlan = transcodeDevicePlan.buildRateControlPlan(deviceSlots);
    if (!rateControlPlan.length) throw Object.assign(new Error('No encode devices in pool'), { code: 'TRANSCODE_DEVICE_POOL_EMPTY' });
    const workDir = path.join(config.transcodeTempRoot, `event-${event.eventId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    fs.mkdirSync(workDir, { recursive: true });
    return { result: { ...observation, bitrateProfile, deviceSlots, rateControlPlan, workDir, outputPath: path.join(workDir, `output${path.extname(sourcePath) || '.mkv'}`), targetCodec: targetFacts(task).targetCodec || 'h265' } };
  } });

  register({ capability: 'transcode.tonemap.accept', allowedTargetGates: ['optimize'], execute: async ({ input }) => ({ result: input.precheck }) });

  register({ capability: 'media.transcode', allowedTargetGates: ['optimize'], execute: async ({ event, config, input }) => {
    const plan = input.precheck;
    await transcodeService.startEncode(() => {}, {
      config,
      taskId: event.eventId,
      sourcePath: plan.sourcePath,
      partialPath: plan.outputPath,
      orderedDeviceSlots: plan.deviceSlots,
      durationSec: plan.durationSec || 3600,
      targetBitrate: plan.bitrateProfile.targetMbps,
      bitrateProfile: plan.bitrateProfile,
      isDolbyVision: plan.isDolbyVision,
      dolbyVisionTonemap: plan.dolbyVisionTonemap,
      dvTonemapFilter: plan.dolbyVisionTonemap && plan.dolbyVisionTonemap.filter,
      allowGpuCpuFallback: true,
      onLog: () => {},
    });
    return { result: { assetId: `staged:${event.eventId}`, path: plan.outputPath, outputPath: plan.outputPath, sourcePath: plan.sourcePath, workDir: plan.workDir, originalSizeBytes: plan.originalSizeBytes, bitrateProfile: plan.bitrateProfile, targetCodec: plan.targetCodec, replacementScope: 'file', producingEventId: event.eventId, precheck: plan } };
  } });

  register({ capability: 'output.preview.generate', allowedTargetGates: ['optimize'], execute: async ({ event, config, input }) => {
    const verified = input.verifiedAsset;
    const previewWorkDir = path.join(config.transcodeTempRoot, 'previews', event.eventId.replace(/[^A-Za-z0-9_-]/g, '_'));
    fs.mkdirSync(previewWorkDir, { recursive: true });
    const previewPath = path.join(previewWorkDir, 'preview.mp4');
    try {
      const preview = await transcodeService.extractPreviewClip(config, verified.outputPath, previewPath);
      return { result: { ...verified, preview, previewWorkDir } };
    } catch (error) {
      return { result: { ...verified, preview: null, previewWorkDir, previewFailure: { code: error.code || 'PREVIEW_GENERATION_FAILED', message: error.message, eventId: event.eventId } } };
    }
  } });

  register({ capability: 'workspace.cleanup', allowedTargetGates: ['optimize'], execute: async ({ event, input }) => {
    const replacement = input.replacement;
    const workDirs = [...new Set([replacement.stagedAsset && replacement.stagedAsset.replacementScope === 'file' ? replacement.stagedAsset.workDir : '', replacement.previewWorkDir || ''].filter(Boolean))];
    for (const workDir of workDirs) transcodeService.cleanupTaskWorkdir(workDir);
    return { result: { cleaned: workDirs.length > 0, workDirs }, commitMarker: `workspace-cleanup:${event.eventId}` };
  } });
}

module.exports = { registerTranscodeCapabilities };
