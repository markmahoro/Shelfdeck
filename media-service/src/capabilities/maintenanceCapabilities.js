'use strict';

const fs = require('fs');
const path = require('path');
const kairoxStore = require('../kairoxStore');
const artifacts = require('../metadataArtifactWorkspace');
const transcodeService = require('../services/transcodeService');
const sourceAccessResolver = require('../sourceAccessResolver');
const bitrateObjectiveProfile = require('../bitrateObjectiveProfile');
const optimizeGapAnalyzer = require('../optimizeGapAnalyzer');
const mediaReplacementService = require('../mediaReplacementService');

function sourcePathFor(task) {
  const canonical = task.itemInfo && (task.itemInfo.path || task.itemInfo.sourcePath) || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor && task.helixAdmission.sourceAccessDescriptor.locator && task.helixAdmission.sourceAccessDescriptor.locator.path;
  return sourceAccessResolver.resolve(canonical, { mustExist: true }).accessPath;
}
function normalizeCodec(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace('hevc', 'h265').replace('avc', 'h264'); }
function resolutionPixels(value) { const text = String(value || '').toLowerCase(); if (text.includes('2160') || text.includes('4k')) return 3840 * 2160; if (text.includes('1080')) return 1920 * 1080; if (text.includes('720')) return 1280 * 720; const match = text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/); return match ? Number(match[1]) * Number(match[2]) : 0; }

function registerMaintenanceCapabilities(register) {
  register({ capability: 'optimization.objective.verify', allowedTargetGates: ['optimize'], execute: async ({ task, event }) => {
    const analysis = optimizeGapAnalyzer.analyze({
      itemInfo: task.itemInfo || {},
      optimizeObjective: task.taskTarget && task.taskTarget.gateObjective || task.itemInfo && task.itemInfo.optimizeObjective,
      optimizeObjectiveStatus: task.itemInfo && task.itemInfo.optimizeObjectiveStatus,
      objectiveHash: task.objectiveRevisionSnapshot || '',
    });
    if (!analysis.satisfied) throw Object.assign(new Error(`Optimize objective is not satisfied: ${analysis.reason}`), { code: 'OPTIMIZE_OBJECTIVE_NOT_SATISFIED', details: analysis });
    return { result: { objectiveSatisfied: true, objectiveRevision: task.objectiveRevisionSnapshot || '', evidence: { eventId: event.eventId, analysis } } };
  } });
  register({ capability: 'output.media.verify', allowedTargetGates: ['optimize'], execute: async (context) => {
    const staged = context.input.stagedAsset; const outputPath = staged.path || staged.outputPath || '';
    if (staged.encodeFailed) return { result: { stagedAsset: staged, valid: false, objectiveSatisfied: false, encodeFailure: staged.encodeFailure, sourcePath: staged.sourcePath, originalSizeBytes: staged.originalSizeBytes, workDir: staged.workDir } };
    if (!outputPath) throw Object.assign(new Error('Staged media asset path is missing'), { code: 'STAGED_MEDIA_ASSET_PATH_MISSING' });
    const summary = await transcodeService.probeSummary(context.config, outputPath); if (!(summary.durationSec > 0)) throw Object.assign(new Error('Optimize output duration is zero'), { code: 'OPTIMIZE_OUTPUT_INVALID' });
    const sizeBytes = fs.statSync(outputPath).size; const bitrateKbps = Math.round((sizeBytes * 8) / summary.durationSec / 1000);
    const target = context.task.taskTarget && context.task.taskTarget.gateObjective && (context.task.taskTarget.gateObjective.targetMediaFacts || context.task.taskTarget.gateObjective) || {};
    const objectiveScope = context.parameters.objectiveScope || 'full';
    if (objectiveScope === 'full' && target.targetCodec && normalizeCodec(summary.videoCodec) !== normalizeCodec(target.targetCodec)) throw Object.assign(new Error(`Output codec ${summary.videoCodec} does not satisfy ${target.targetCodec}`), { code: 'OPTIMIZE_CODEC_MISMATCH' });
    if (target.minResolution && summary.width * summary.height < resolutionPixels(target.minResolution)) throw Object.assign(new Error(`Output resolution ${summary.width}x${summary.height} is below ${target.minResolution}`), { code: 'OPTIMIZE_RESOLUTION_MISMATCH' });
    const profile = staged.bitrateProfile || bitrateObjectiveProfile.resolveBitrateProfile({ objective: { targetMediaFacts: target }, item: { ...context.task.itemInfo, width: summary.width, height: summary.height } });
    const bitrateComparison = profile ? bitrateObjectiveProfile.compareBitrateToProfile(bitrateKbps / 1000, profile) : { status: 'no_profile' };
    const bitrateSatisfied = objectiveScope === 'upgrade_stage'
      ? bitrateComparison.status !== 'below'
      : ['within', 'no_profile'].includes(bitrateComparison.status);
    return { result: { stagedAsset: staged, valid: true, objectiveSatisfied: bitrateSatisfied, objectiveScope, bitrateComparison, outputPath, sizeBytes, bitrateKbps, summary, sourcePath: staged.sourcePath, originalSizeBytes: staged.originalSizeBytes, workDir: staged.workDir } };
  } });
  register({ capability: 'media.replace', allowedTargetGates: ['optimize'], execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task); const verified = context.input.verifiedAsset;
    if (!verified.valid || !verified.outputPath || !verified.sourcePath) throw Object.assign(new Error('Verified optimize output is unavailable'), { code: 'OPTIMIZE_REPLACE_INPUT_MISSING' });
    context.assertFence('before_media_replace');
    const result = await mediaReplacementService.replaceVerifiedAsset({ config: context.config, verifiedAsset: verified, operationId: context.event.eventId });
    return { result: { ...result, targetPath: verified.sourcePath, stagedAsset: verified.stagedAsset, previewWorkDir: verified.previewWorkDir || '', pathChanged: false }, commitMarker: `replace:${context.event.eventId}` };
  } });
  register({ capability: 'source.organize', allowedTargetGates: ['optimize'], execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task); const sourcePath = sourcePathFor(context.task); const descriptor = context.task.helixAdmission && context.task.helixAdmission.sourceAccessDescriptor || {};
    const library = (context.config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {}; const facts = context.task.itemInfo && context.task.itemInfo.metadataFacts || context.task.itemInfo || {};
    const identity = String(facts.adultId || facts.title || path.basename(sourcePath, path.extname(sourcePath))).replace(/[<>:"/\\|?*]/g, '_').trim();
    const destinationDir = path.join(library.watchRoot || path.dirname(sourcePath), library.organizedFolderName || context.config.adultLibrary && context.config.adultLibrary.organizedFolderName || 'scraped', identity); fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, path.basename(sourcePath));
    context.assertFence('before_source_organize');
    if (path.resolve(destination) !== path.resolve(sourcePath)) { const sourceExists = fs.existsSync(sourcePath); const destinationExists = fs.existsSync(destination); if (sourceExists && destinationExists) throw Object.assign(new Error('Organize destination already exists while source is still present'), { code: 'SOURCE_ORGANIZE_DESTINATION_CONFLICT' }); if (sourceExists) fs.renameSync(sourcePath, destination); else if (!destinationExists) throw Object.assign(new Error('Neither organize source nor committed destination exists'), { code: 'SOURCE_ORGANIZE_RECOVERY_UNRESOLVED' }); }
    const mutation = { mutationId: `mutation:${context.event.eventId}`, itemId: context.task.itemId, taskId: context.task.id, eventId: context.event.eventId, mutationKind: 'organize', oldSourceEvidence: { path: sourcePath }, newSourceEvidence: { path: destination }, admissionGeneration: context.task.helixAdmission && context.task.helixAdmission.admissionGeneration || 0, sourceRevision: context.task.helixAdmission && context.task.helixAdmission.sourceRevision || '', mappingRevision: sourceAccessResolver.getRevision(), committedAt: new Date().toISOString() };
    return { result: { destination, sourceMutationResult: mutation }, commitMarker: mutation.mutationId };
  } });
  register({ capability: 'metadata.artifacts.materialize', allowedTargetGates: ['optimize'], execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task); const revision = String(context.task.itemInfo && context.task.itemInfo.metadataArtifactRevision || context.task.objectiveRevisionSnapshot || context.task.id);
    const verified = artifacts.verifyManifest(context.config, context.task.itemId, revision); if (!verified.valid) throw Object.assign(new Error(`Metadata artifact manifest is invalid: ${verified.reason}`), { code: 'METADATA_ARTIFACT_MANIFEST_INVALID' });
    context.assertFence('before_metadata_artifacts_materialize');
    const targetDir = path.dirname(sourcePathFor(context.task)); const written = [];
    for (const [name, artifact] of Object.entries(verified.manifest.artifacts || {})) { const source = path.join(artifacts.revisionDir(context.config, context.task.itemId, revision), name); const record = artifacts.atomicWrite(path.join(targetDir, name), fs.readFileSync(source)); if (record.sha256 !== artifact.sha256) throw Object.assign(new Error(`Materialized artifact checksum mismatch: ${name}`), { code: 'METADATA_ARTIFACT_MATERIALIZE_VERIFY_FAILED' }); written.push(record); }
    return { result: { targetDir, written, metadataRevision: revision }, commitMarker: `materialize:${context.task.itemId}:${revision}` };
  } });
  register({ capability: 'filesystem.layout.verify', allowedTargetGates: ['optimize'], execute: async (context) => { const sourcePath = sourcePathFor(context.task); return { result: { valid: fs.existsSync(sourcePath), path: sourcePath, materialized: context.input.materialization && context.input.materialization.written || [] } }; } });
  register({ capability: 'optimization.result.publish', allowedTargetGates: ['optimize'], execute: async ({ task, event, input, assertFence }) => {
    if (!input.layout || input.layout.valid !== true) throw Object.assign(new Error('Optimize layout verification did not pass'), { code: 'OPTIMIZE_LAYOUT_NOT_VERIFIED' });
    assertFence('before_optimize_publish');
    kairoxStore.publishOptimize({ itemId: task.itemId, objectiveRevision: task.objectiveRevisionSnapshot || '', facts: { passed: true, metadataArtifactsMaterialized: !!(input.layout.materialized && input.layout.materialized.length), replacement: input.replacement || null }, evidence: { taskId: task.id, eventId: event.eventId }, observedAt: new Date().toISOString() });
    return { result: { passed: true, objectiveRevision: task.objectiveRevisionSnapshot || '' }, evidence: { taskId: task.id, eventId: event.eventId }, commitMarker: `optimize:${task.objectiveRevisionSnapshot || task.id}` };
  } });
}

module.exports = { registerMaintenanceCapabilities };
