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
  register({ capability: 'container.remux', allowedTargetGates: ['optimize'], cancel: ({ event }) => transcodeService.abortTask(event.eventId), execute: async ({ task, event, config }) => {
    const sourcePath = sourcePathFor(task);
    const workDir = path.join(config.transcodeTempRoot, `event-${event.eventId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    fs.mkdirSync(workDir, { recursive: true });
    const remux = await transcodeService.remuxDiscToMkv({ config, taskId: event.eventId, sourcePath, outputPath: path.join(workDir, 'disc-remux.mkv'), workDir, onProgress: () => {} });
    return { result: { assetId: `staged:${event.eventId}`, path: remux.remuxPath, outputPath: remux.remuxPath, sourcePath: remux.replacementTargetPath, workDir, originalSizeBytes: remux.originalSizeBytes, originalDiscPath: remux.originalDiscPath, replacementTargetPath: remux.replacementTargetPath, replacementScope: 'disc', remuxEvidence: remux, producingEventId: event.eventId } };
  } });

  register({ capability: 'media.transcode.precheck', allowedTargetGates: ['optimize'], execute: async ({ task, event, config, input }) => {
    const sourceAsset = input.sourceAsset || null;
    const sourcePath = sourceAsset ? sourceAsset.path : sourcePathFor(task);
    const observation = await transcodeService.precheck(config, sourcePath);
    const bitrateProfile = profileFor(task, { originalWidth: observation.originalWidth, originalHeight: observation.originalHeight });
    if (!bitrateProfile) throw Object.assign(new Error('Optimize objective has no bitrate profile'), { code: 'KAIROX_TRANSCODE_PROFILE_MISSING' });
    const deviceSlots = transcodeDevicePlan.buildDeviceSlots(config);
    const rateControlPlan = transcodeDevicePlan.buildRateControlPlan(deviceSlots);
    if (!rateControlPlan.length) throw Object.assign(new Error('No encode devices in pool'), { code: 'TRANSCODE_DEVICE_POOL_EMPTY' });
    const workDir = path.join(config.transcodeTempRoot, `event-${event.eventId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    fs.mkdirSync(workDir, { recursive: true });
    return { result: { ...observation, bitrateProfile, deviceSlots, rateControlPlan, workDir, outputPath: path.join(workDir, `output${path.extname(sourcePath) || '.mkv'}`), targetCodec: targetFacts(task).targetCodec || 'h265', sourceAsset, replacementTargetPath: sourceAsset && sourceAsset.replacementTargetPath || sourcePath, originalDiscPath: sourceAsset && sourceAsset.originalDiscPath || '' } };
  } });

  register({ capability: 'transcode.tonemap.accept', allowedTargetGates: ['optimize'], execute: async ({ input }) => ({ result: input.precheck }) });

  register({ capability: 'media.transcode', allowedTargetGates: ['optimize'], cancel: ({ event }) => transcodeService.abortTask(event.eventId), execute: async ({ event, config, input, parameters }) => {
    const plan = input.precheck;
    const outputPath = path.join(plan.workDir, `output-${event.eventId.replace(/[^A-Za-z0-9_-]/g, '_')}${path.extname(plan.sourcePath) || '.mkv'}`);
    const slots = plan.deviceSlots.filter((slot) => slot.backend === parameters.encoderKind);
    if (plan.isDolbyVision && parameters.encoderKind !== 'cpu') return { result: { assetId: `staged:${event.eventId}`, path: '', outputPath: '', sourcePath: plan.replacementTargetPath || plan.sourcePath, workDir: plan.workDir, originalSizeBytes: plan.sourceAsset && plan.sourceAsset.originalSizeBytes || plan.originalSizeBytes, bitrateProfile: plan.bitrateProfile, targetCodec: plan.targetCodec, replacementScope: plan.originalDiscPath ? 'disc' : 'file', originalDiscPath: plan.originalDiscPath, producingEventId: event.eventId, precheck: plan, encodeFailed: true, encodeFailure: { code: 'DOLBY_VISION_REQUIRES_CPU', message: 'Dolby Vision tonemap uses the CPU attempt' }, attempt: parameters } };
    try {
      await transcodeService.startEncode(() => {}, {
        config, taskId: event.eventId, sourcePath: plan.sourcePath, partialPath: outputPath,
        orderedDeviceSlots: slots, durationSec: plan.durationSec || 3600,
        targetBitrate: plan.bitrateProfile.targetMbps, bitrateProfile: plan.bitrateProfile,
        rateControlStrategy: parameters.strategy, isDolbyVision: plan.isDolbyVision,
        dvAcknowledged: plan.isDolbyVision, dolbyVisionTonemap: plan.dolbyVisionTonemap,
        dvTonemapFilter: plan.dolbyVisionTonemap && plan.dolbyVisionTonemap.filter,
        allowGpuCpuFallback: false, onLog: () => {},
      });
      return { result: { assetId: `staged:${event.eventId}`, path: outputPath, outputPath, sourcePath: plan.replacementTargetPath || plan.sourcePath, workDir: plan.workDir, originalSizeBytes: plan.sourceAsset && plan.sourceAsset.originalSizeBytes || plan.originalSizeBytes, bitrateProfile: plan.bitrateProfile, targetCodec: plan.targetCodec, replacementScope: plan.originalDiscPath ? 'disc' : 'file', originalDiscPath: plan.originalDiscPath, producingEventId: event.eventId, precheck: plan, attempt: parameters } };
    } catch (error) {
      return { result: { assetId: `staged:${event.eventId}`, path: '', outputPath: '', sourcePath: plan.replacementTargetPath || plan.sourcePath, workDir: plan.workDir, originalSizeBytes: plan.sourceAsset && plan.sourceAsset.originalSizeBytes || plan.originalSizeBytes, bitrateProfile: plan.bitrateProfile, targetCodec: plan.targetCodec, replacementScope: plan.originalDiscPath ? 'disc' : 'file', originalDiscPath: plan.originalDiscPath, producingEventId: event.eventId, precheck: plan, encodeFailed: true, encodeFailure: { code: error.code || 'TRANSCODE_ATTEMPT_FAILED', message: error.message }, attempt: parameters } };
    }
  } });

  register({ capability: 'output.media.select', allowedTargetGates: ['optimize'], execute: async ({ input }) => {
    const attempts = (input.attempts || []).filter(Boolean);
    const selected = attempts.find((attempt) => attempt.objectiveSatisfied === true);
    if (!selected) throw Object.assign(new Error('No staged media attempt satisfied the Optimize objective'), { code: 'OPTIMIZE_OUTPUT_ATTEMPTS_EXHAUSTED', attempts: attempts.map((attempt) => ({ comparison: attempt.bitrateComparison, encodeFailure: attempt.stagedAsset && attempt.stagedAsset.encodeFailure })) });
    return { result: selected };
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

  register({ capability: 'output.media.disposition', allowedTargetGates: ['optimize'], execute: async ({ input }) => {
    const verified = input.verifiedAsset;
    const isTranscode = verified.stagedAsset && verified.stagedAsset.replacementScope === 'file';
    const outputLarger = isTranscode && verified.originalSizeBytes > 0 && verified.sizeBytes >= verified.originalSizeBytes;
    return { result: { ...verified, action: outputLarger ? 'discard' : 'replace', dispositionReason: outputLarger ? 'output_not_smaller' : 'verified_replacement', acceptedAsNoBenefit: outputLarger } };
  } });

  register({ capability: 'staged.asset.discard', allowedTargetGates: ['optimize'], execute: async ({ event, input }) => {
    const verified = input.verifiedAsset;
    const workDir = verified.stagedAsset && verified.stagedAsset.workDir || verified.workDir || '';
    if (workDir) transcodeService.cleanupTaskWorkdir(workDir);
    return { result: { committed: false, disposition: 'no_beneficial_mutation', reason: verified.dispositionReason, stagedAsset: verified.stagedAsset, targetPath: verified.sourcePath }, commitMarker: `staged-discard:${event.eventId}` };
  } });

  register({ capability: 'optimization.outcome.select', allowedTargetGates: ['optimize'], execute: async ({ input }) => {
    const outcome = (input.outcomes || []).find(Boolean);
    if (!outcome) throw Object.assign(new Error('Optimize workflow produced no replacement or discard outcome'), { code: 'OPTIMIZE_OUTCOME_MISSING' });
    return { result: outcome };
  } });

  register({ capability: 'workspace.cleanup', allowedTargetGates: ['optimize'], execute: async ({ event, input }) => {
    const replacement = input.replacement;
    const workDirs = [...new Set([replacement.stagedAsset && replacement.stagedAsset.replacementScope === 'file' ? replacement.stagedAsset.workDir : '', replacement.previewWorkDir || ''].filter(Boolean))];
    for (const workDir of workDirs) transcodeService.cleanupTaskWorkdir(workDir);
    return { result: { cleaned: workDirs.length > 0, workDirs }, commitMarker: `workspace-cleanup:${event.eventId}` };
  } });
}

module.exports = { registerTranscodeCapabilities };
