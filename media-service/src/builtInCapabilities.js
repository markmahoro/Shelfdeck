'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('./capabilityRegistry');
const basedata = require('./basedataObserver');
const metadata = require('./metadataProviderAdapter');
const kairoxStore = require('./kairoxStore');
const personCatalogStore = require('./personCatalogStore');
const artifacts = require('./metadataArtifactWorkspace');
const transcodeService = require('./services/transcodeService');
const sourceAccessResolver = require('./sourceAccessResolver');
const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');
const { registerUpgradeCapabilities } = require('./capabilities/upgradeCapabilities');
const capabilityCatalog = require('./capabilityCatalog');

let registered = false;
function metadataRevision(context) { return String(context.task.objectiveRevisionSnapshot || context.task.id); }
function xml(value) { return String(value == null ? '' : value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char])); }
function nfoFor(facts = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<movie>\n  <title>${xml(facts.title || facts.name)}</title>\n  <originaltitle>${xml(facts.originalTitle)}</originaltitle>\n  <plot>${xml(facts.plot)}</plot>\n  <id>${xml(facts.adultId || facts.tmdbId)}</id>\n</movie>\n`;
}
function taskTargetFacts(task = {}) {
  const objective = task.taskTarget && task.taskTarget.gateObjective || {};
  return objective.targetMediaFacts || objective;
}
function transcodeProfile(task = {}, info = {}) {
  const facts = taskTargetFacts(task);
  return bitrateObjectiveProfile.resolveBitrateProfile({ objective: { targetMediaFacts: facts }, item: info });
}
function sourcePathFor(task) {
  const canonical = task.itemInfo && (task.itemInfo.path || task.itemInfo.sourcePath)
    || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor && task.helixAdmission.sourceAccessDescriptor.locator && task.helixAdmission.sourceAccessDescriptor.locator.path;
  return sourceAccessResolver.resolve(canonical, { mustExist: true }).accessPath;
}
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error(`Artifact download failed: HTTP ${response.status}`), { code: 'METADATA_ARTIFACT_DOWNLOAD_FAILED' });
  return Buffer.from(await response.arrayBuffer());
}
function register(definition) { if (!registry.has(definition.capability)) registry.register(capabilityCatalog.apply(definition)); }

function registerBuiltIns() {
  if (registered) return registry;
  registered = true;
  register({ capability: 'workflow.blocked', allowedTargetGates: ['basedata', 'metadata', 'optimize'], execute: async ({ event }) => { throw Object.assign(new Error(event.intent.inputBindings && event.intent.inputBindings.reason || 'Workflow planning blocked'), { code: 'KAIROX_WORKFLOW_BLOCKED', details: event.intent.inputBindings || {} }); } });
  register({ capability: 'emby.item.observe', allowedTargetGates: ['basedata'], defaultResourceRequest: { resourceType: 'emby' }, execute: async ({ task, config }) => ({ result: { facts: await basedata.observeEmby(task.helixAdmission || {}, config) } }) });
  register({ capability: 'filesystem.media.probe', allowedTargetGates: ['basedata'], defaultResourceRequest: { resourceType: 'filesystem' }, execute: async ({ task, config }) => ({ result: { facts: await basedata.observeFile(task.helixAdmission || {}, config) } }) });
  register({ capability: 'filesystem.layout.observe', allowedTargetGates: ['basedata'], defaultResourceRequest: { resourceType: 'filesystem' }, execute: async ({ task, config }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const file = descriptor.locator && descriptor.locator.path || '';
    const library = (config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {};
    const relative = library.watchRoot && file ? path.relative(library.watchRoot, file).split(path.sep).filter(Boolean) : [];
    const organizedFolder = library.organizedFolderName || config.adultLibrary && config.adultLibrary.organizedFolderName || 'scraped';
    return { result: { layout: { path: file, parent: file ? path.dirname(file) : '', relativePath: relative.join('/'), organizedFolder, compliant: relative.length >= 3 && relative[0].toLowerCase() === organizedFolder.toLowerCase() } } };
  } });
  register({ capability: 'basedata.verify', allowedTargetGates: ['basedata'], execute: async (context) => {
    const observed = context.input.observation;
    if (!observed.facts || !observed.facts.path) throw Object.assign(new Error('Basedata observation did not produce a source path'), { code: 'BASEDATA_VERIFY_FAILED' });
    return { result: { facts: { ...observed.facts, layout: context.input.layout && context.input.layout.layout || null }, valid: true } };
  } });
  register({ capability: 'basedata.publish', allowedTargetGates: ['basedata'], idempotency: 'commit_once', execute: async (context) => {
    const verified = context.input.basedata;
    const published = kairoxStore.publishBasedata({ itemId: context.task.itemId, sourceRevision: context.task.helixAdmission && context.task.helixAdmission.sourceRevision || '', facts: verified.facts, evidence: { taskId: context.task.id, eventId: context.event.eventId }, observedAt: new Date().toISOString() });
    return { result: { basedataRevision: published.factRevision }, commitMarker: `basedata:${published.factRevision}` };
  } });
  register({ capability: 'media.identity.resolve', allowedTargetGates: ['metadata'], execute: async ({ task }) => ({ result: { descriptor: task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {} } }) });
  register({ capability: 'metadata.provider.fetch', allowedTargetGates: ['metadata'], defaultResourceRequest: { resourceType: 'scraper' }, execute: async ({ task, config }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const subLibraryId = descriptor.subLibraryId || task.itemInfo && task.itemInfo.subLibraryId || '';
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === subLibraryId);
    if (!subLibrary) throw Object.assign(new Error('SubLibrary not found'), { code: 'KAIROX_METADATA_LIBRARY_MISSING' });
    const value = descriptor.sourceType === 'emby' ? await metadata.observeEmbyMetadata(task, config, subLibrary) : await metadata.observeFolderMetadata(task, config, subLibrary);
    metadata.assertMetadataFacts(value.facts);
    return { result: value };
  } });
  register({ capability: 'person.relations.resolve', allowedTargetGates: ['metadata'], execute: async (context) => {
    const fetched = context.input.metadata;
    const facts = fetched.facts || {};
    const people = [...(facts.people || []), ...(facts.actors || []).map((actor) => typeof actor === 'string' ? { name: actor, role: 'actor', contentKinds: ['adult'] } : actor)];
    const projection = personCatalogStore.observeItemPeople({ itemId: context.task.itemId, people, metadataRevision: metadataRevision(context) });
    return { result: { facts: { ...facts, ...projection }, people, projection } };
  } });
  register({ capability: 'metadata.sidecar.render', allowedTargetGates: ['metadata'], sideEffect: true, idempotency: 'staged_write', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    const facts = context.input.metadata.facts || {};
    const artifact = artifacts.writeArtifact(context.config, { itemId: context.task.itemId, metadataRevision: metadataRevision(context), name: 'metadata.nfo', content: nfoFor(facts), source: 'metadata', eventId: context.event.eventId });
    return { result: { artifact } };
  } });
  register({ capability: 'metadata.image.acquire', allowedTargetGates: ['metadata'], sideEffect: true, idempotency: 'staged_write', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    const suffix = context.parameters.kind;
    const field = suffix === 'poster' ? 'posterUrl' : 'fanartUrl';
    const facts = context.input.metadata.facts || {};
    if (!facts[field]) return { result: { skipped: true, reason: `${field}_missing` } };
    const artifact = artifacts.writeArtifact(context.config, { itemId: context.task.itemId, metadataRevision: metadataRevision(context), name: `${suffix}.jpg`, content: await download(facts[field]), source: facts[field], eventId: context.event.eventId });
    return { result: { artifact } };
  } });
  register({ capability: 'metadata.artifacts.verify', allowedTargetGates: ['metadata'], execute: async (context) => ({ result: { ...artifacts.verifyManifest(context.config, context.task.itemId, metadataRevision(context)), artifacts: context.input.artifacts } }) });
  register({ capability: 'metadata.publish', allowedTargetGates: ['metadata'], idempotency: 'commit_once', execute: async (context) => {
    const resolved = context.input.metadata;
    const artifactVerification = context.input.artifacts || {};
    metadata.assertMetadataFacts(resolved.facts);
    const artifactRevision = artifactVerification.valid ? metadataRevision(context) : '';
    const published = kairoxStore.publishMetadata({ itemId: context.task.itemId, facts: resolved.facts, evidence: { taskId: context.task.id, eventId: context.event.eventId, ...(artifactRevision ? { artifactRevision } : {}) }, observedAt: new Date().toISOString() });
    return { result: { metadataRevision: published.factRevision, artifactRevision }, commitMarker: `metadata:${published.factRevision}` };
  } });
  register({ capability: 'media.transcode', allowedTargetGates: ['optimize'], sideEffect: true, idempotency: 'staged_write', defaultResourceRequest: { resourceType: 'transcode' }, execute: async (context) => {
    const task = context.task;
    const sourcePath = sourcePathFor(task);
    const precheck = await transcodeService.precheck(context.config, sourcePath);
    const profile = transcodeProfile(task, { ...task.itemInfo, originalWidth: precheck.originalWidth, originalHeight: precheck.originalHeight });
    if (!profile) throw Object.assign(new Error('Optimize objective has no bitrate profile'), { code: 'KAIROX_TRANSCODE_PROFILE_MISSING' });
    const tempRoot = context.config.transcodeTempRoot;
    if (!tempRoot) throw Object.assign(new Error('Transcode workspace is not configured'), { code: 'TRANSCODE_WORKSPACE_MISSING' });
    const workDir = path.join(tempRoot, `event-${context.event.eventId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    fs.mkdirSync(workDir, { recursive: true });
    const extension = path.extname(sourcePath) || '.mkv';
    const outputPath = path.join(workDir, `output${extension}`);
    const orderedDeviceSlots = (context.config.transcodeEncodingDevices || []).filter((device) => device.inPool !== false).sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100)).map((device) => ({ deviceId: device.stableKey, maxSlots: device.maxSlots || 1, cpuBackupOnly: device.stableKey.startsWith('cpu:') && context.config.transcodeCpuParticipationStrategy === 'backup_only' }));
    if (orderedDeviceSlots.length === 0) throw Object.assign(new Error('No encode devices in pool'), { code: 'TRANSCODE_DEVICE_POOL_EMPTY' });
    await transcodeService.startEncode(() => {}, { config: context.config, taskId: context.event.eventId, sourcePath, partialPath: outputPath, orderedDeviceSlots, durationSec: precheck.durationSec || 3600, targetBitrate: profile.targetMbps, bitrateProfile: profile, allowGpuCpuFallback: false, onLog: () => {} });
    return { result: { assetId: `staged:${context.event.eventId}`, path: outputPath, outputPath, sourcePath, workDir, originalSizeBytes: fs.statSync(sourcePath).size, bitrateProfile: profile, targetCodec: taskTargetFacts(task).targetCodec || 'h265', producingEventId: context.event.eventId } };
  } });
  registerUpgradeCapabilities(register);
  register({ capability: 'optimization.objective.verify', allowedTargetGates: ['optimize'], execute: async ({ task, event }) => ({ result: { objectiveSatisfied: true, objectiveRevision: task.objectiveRevisionSnapshot || '', evidence: { eventId: event.eventId } } }) });
  register({ capability: 'output.media.verify', allowedTargetGates: ['optimize'], execute: async (context) => {
    const staged = context.input.stagedAsset;
    const outputPath = staged.path || staged.outputPath || '';
    if (!outputPath) throw Object.assign(new Error('Staged media asset path is missing'), { code: 'STAGED_MEDIA_ASSET_PATH_MISSING' });
    const summary = await transcodeService.probeSummary(context.config, outputPath);
    if (!(summary.durationSec > 0)) throw Object.assign(new Error('Optimize output duration is zero'), { code: 'OPTIMIZE_OUTPUT_INVALID' });
    const sizeBytes = fs.statSync(outputPath).size;
    const bitrateKbps = Math.round((sizeBytes * 8) / summary.durationSec / 1000);
    const profile = staged.bitrateProfile;
    if (profile) {
      const comparison = bitrateObjectiveProfile.compareBitrateToProfile(bitrateKbps / 1000, profile);
      if (!['within', 'no_profile'].includes(comparison.status)) throw Object.assign(new Error(`Output bitrate is ${comparison.status}`), { code: `OPTIMIZE_${comparison.status.toUpperCase()}` });
    }
    return { result: { stagedAsset: staged, valid: true, objectiveSatisfied: true, outputPath, sizeBytes, bitrateKbps, summary, sourcePath: staged.sourcePath, originalSizeBytes: staged.originalSizeBytes, workDir: staged.workDir } };
  } });
  register({ capability: 'media.replace', allowedTargetGates: ['optimize'], sideEffect: true, idempotency: 'commit_once', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task);
    const verified = context.input.verifiedAsset;
    if (!verified.valid || !verified.outputPath || !verified.sourcePath) throw Object.assign(new Error('Verified optimize output is unavailable'), { code: 'OPTIMIZE_REPLACE_INPUT_MISSING' });
    const result = await transcodeService.replaceWithRetries({ config: context.config, targetPath: verified.sourcePath, partialPath: verified.outputPath });
    return { result: { ...result, targetPath: verified.sourcePath, stagedAsset: verified.stagedAsset, pathChanged: false }, commitMarker: `replace:${context.event.eventId}` };
  } });
  register({ capability: 'source.organize', allowedTargetGates: ['optimize'], sideEffect: true, idempotency: 'commit_once', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task);
    const canonical = context.task.itemInfo && (context.task.itemInfo.path || context.task.itemInfo.sourcePath)
      || context.task.helixAdmission && context.task.helixAdmission.sourceAccessDescriptor && context.task.helixAdmission.sourceAccessDescriptor.locator && context.task.helixAdmission.sourceAccessDescriptor.locator.path;
    const sourcePath = sourceAccessResolver.resolve(canonical).accessPath;
    const descriptor = context.task.helixAdmission && context.task.helixAdmission.sourceAccessDescriptor || {};
    const library = (context.config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {};
    const facts = context.task.itemInfo && context.task.itemInfo.metadataFacts || context.task.itemInfo || {};
    const identity = String(facts.adultId || facts.title || path.basename(sourcePath, path.extname(sourcePath))).replace(/[<>:"/\\|?*]/g, '_').trim();
    const destinationDir = path.join(library.watchRoot || path.dirname(sourcePath), library.organizedFolderName || context.config.adultLibrary && context.config.adultLibrary.organizedFolderName || 'scraped', identity);
    fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, path.basename(sourcePath));
    if (path.resolve(destination) !== path.resolve(sourcePath)) {
      const sourceExists = fs.existsSync(sourcePath);
      const destinationExists = fs.existsSync(destination);
      if (sourceExists && destinationExists) throw Object.assign(new Error('Organize destination already exists while source is still present'), { code: 'SOURCE_ORGANIZE_DESTINATION_CONFLICT' });
      if (sourceExists) fs.renameSync(sourcePath, destination);
      else if (!destinationExists) throw Object.assign(new Error('Neither organize source nor committed destination exists'), { code: 'SOURCE_ORGANIZE_RECOVERY_UNRESOLVED' });
    }
    const mutation = { mutationId: `mutation:${context.event.eventId}`, itemId: context.task.itemId, taskId: context.task.id, eventId: context.event.eventId, mutationKind: 'organize', oldSourceEvidence: { path: sourcePath }, newSourceEvidence: { path: destination }, admissionGeneration: context.task.helixAdmission && context.task.helixAdmission.admissionGeneration || 0, sourceRevision: context.task.helixAdmission && context.task.helixAdmission.sourceRevision || '', mappingRevision: sourceAccessResolver.getRevision(), committedAt: new Date().toISOString() };
    return { result: { destination, sourceMutationResult: mutation }, commitMarker: mutation.mutationId };
  } });
  register({ capability: 'metadata.artifacts.materialize', allowedTargetGates: ['optimize'], sideEffect: true, idempotency: 'commit_once', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task);
    const revision = String(context.task.itemInfo && context.task.itemInfo.metadataArtifactRevision || context.task.objectiveRevisionSnapshot || context.task.id);
    const verifiedManifest = artifacts.verifyManifest(context.config, context.task.itemId, revision);
    if (!verifiedManifest.valid) throw Object.assign(new Error(`Metadata artifact manifest is invalid: ${verifiedManifest.reason}`), { code: 'METADATA_ARTIFACT_MANIFEST_INVALID' });
    const manifest = verifiedManifest.manifest;
    const organized = output(context, 'organize');
    const sourcePath = organized.destination || sourcePathFor(context.task);
    const targetDir = path.dirname(sourcePath);
    const written = [];
    for (const [name, artifact] of Object.entries(manifest.artifacts || {})) {
      const source = path.join(artifacts.revisionDir(context.config, context.task.itemId, revision), name);
      const target = path.join(targetDir, name);
      const record = artifacts.atomicWrite(target, fs.readFileSync(source));
      if (record.sha256 !== artifact.sha256) throw Object.assign(new Error(`Materialized artifact checksum mismatch: ${name}`), { code: 'METADATA_ARTIFACT_MATERIALIZE_VERIFY_FAILED' });
      written.push(record);
    }
    return { result: { targetDir, written, metadataRevision: revision }, commitMarker: `materialize:${context.task.itemId}:${revision}` };
  } });
  register({ capability: 'filesystem.layout.verify', allowedTargetGates: ['optimize'], execute: async (context) => {
    const sourcePath = sourcePathFor(context.task);
    return { result: { valid: fs.existsSync(sourcePath), path: sourcePath, materialized: context.input.materialization && context.input.materialization.written || [] } };
  } });
  register({ capability: 'optimization.result.publish', allowedTargetGates: ['optimize'], idempotency: 'commit_once', execute: async ({ task, event, input }) => {
    if (!input.layout || input.layout.valid !== true) throw Object.assign(new Error('Optimize layout verification did not pass'), { code: 'OPTIMIZE_LAYOUT_NOT_VERIFIED' });
    kairoxStore.publishOptimize({ itemId: task.itemId, objectiveRevision: task.objectiveRevisionSnapshot || '', facts: { passed: true, metadataArtifactsMaterialized: !!(input.layout.materialized && input.layout.materialized.length), replacement: input.replacement || null }, evidence: { taskId: task.id, eventId: event.eventId }, observedAt: new Date().toISOString() });
    return { result: { passed: true, objectiveRevision: task.objectiveRevisionSnapshot || '' }, evidence: { taskId: task.id, eventId: event.eventId }, commitMarker: `optimize:${task.objectiveRevisionSnapshot || task.id}` };
  } });
  return registry;
}

module.exports = { registerBuiltIns, nfoFor };
