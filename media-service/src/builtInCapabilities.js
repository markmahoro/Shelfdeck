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
const workflowStore = require('./workflowStore');
const gateInvalidationService = require('./gateInvalidationService');
const moviepilotService = require('./services/moviepilotService');
const kairoxSignalBus = require('./kairoxSignalBus');

let registered = false;
function output(context, suffix) {
  const entry = context.events.find((event) => event.eventId.endsWith(`:${suffix}`));
  return entry && entry.result || {};
}
function dependencyOutput(context, predicate = () => true) {
  const dependencies = new Set(context.event && context.event.intent && context.event.intent.dependsOn || []);
  const entries = context.events.filter((event) => dependencies.has(event.eventId) && predicate(event));
  return entries.length ? entries[entries.length - 1].result || {} : {};
}
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
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function findMediaFile(root) {
  const extensions = new Set(['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov']);
  const candidates = [];
  const visit = (entry) => {
    const stat = fs.statSync(entry);
    if (stat.isFile() && extensions.has(path.extname(entry).toLowerCase())) candidates.push({ path: entry, size: stat.size });
    else if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
  };
  visit(root);
  return candidates.sort((a, b) => b.size - a.size)[0]?.path || '';
}
function mapTransferPath(remotePath, moviepilot, stagingRoot) {
  const remote = String(remotePath || '');
  const base = String(moviepilot.savePath || '');
  if (!remote || !base) return '';
  const normalizedRemote = remote.replace(/\\/g, '/');
  const normalizedBase = base.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalizedRemote !== normalizedBase && !normalizedRemote.startsWith(`${normalizedBase}/`)) return '';
  return path.join(stagingRoot, ...normalizedRemote.slice(normalizedBase.length).replace(/^\//, '').split('/').filter(Boolean));
}

function register(definition) { if (!registry.has(definition.capability)) registry.register(definition); }

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
    const observed = output(context, 'observe');
    if (!observed.facts || !observed.facts.path) throw Object.assign(new Error('Basedata observation did not produce a source path'), { code: 'BASEDATA_VERIFY_FAILED' });
    return { result: { facts: { ...observed.facts, layout: output(context, 'layout').layout || null }, valid: true } };
  } });
  register({ capability: 'basedata.publish', allowedTargetGates: ['basedata'], idempotency: 'commit_once', execute: async (context) => {
    const verified = output(context, 'verify');
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
    const fetched = output(context, 'metadata-fetch');
    const facts = fetched.facts || {};
    const people = [...(facts.people || []), ...(facts.actors || []).map((actor) => typeof actor === 'string' ? { name: actor, role: 'actor' } : actor)];
    return { result: { facts, people } };
  } });
  register({ capability: 'metadata.sidecar.render', allowedTargetGates: ['metadata'], sideEffect: true, idempotency: 'staged_write', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    const facts = output(context, 'people').facts || {};
    const artifact = artifacts.writeArtifact(context.config, { itemId: context.task.itemId, metadataRevision: metadataRevision(context), name: 'metadata.nfo', content: nfoFor(facts), source: 'metadata', eventId: context.event.eventId });
    return { result: { artifact } };
  } });
  for (const [capability, suffix, field] of [['metadata.poster.acquire', 'poster', 'posterUrl'], ['metadata.fanart.acquire', 'fanart', 'fanartUrl']]) register({ capability, allowedTargetGates: ['metadata'], sideEffect: true, idempotency: 'staged_write', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    const facts = output(context, 'people').facts || {};
    if (!facts[field]) return { result: { skipped: true, reason: `${field}_missing` } };
    const artifact = artifacts.writeArtifact(context.config, { itemId: context.task.itemId, metadataRevision: metadataRevision(context), name: `${suffix}.jpg`, content: await download(facts[field]), source: facts[field], eventId: context.event.eventId });
    return { result: { artifact } };
  } });
  register({ capability: 'metadata.artifacts.verify', allowedTargetGates: ['metadata'], execute: async (context) => ({ result: artifacts.verifyManifest(context.config, context.task.itemId, metadataRevision(context)) }) });
  register({ capability: 'metadata.publish', allowedTargetGates: ['metadata'], idempotency: 'commit_once', execute: async (context) => {
    const resolved = output(context, 'people');
    const artifactVerification = output(context, 'artifacts-verify');
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
    return { result: { sourcePath, outputPath, workDir, originalSizeBytes: fs.statSync(sourcePath).size, bitrateProfile: profile, targetCodec: taskTargetFacts(task).targetCodec || 'h265' } };
  } });
  register({ capability: 'source.upgrade.search', allowedTargetGates: ['optimize'], defaultResourceRequest: { resourceType: 'moviepilot' }, execute: async ({ task, config }) => {
    const mp = config.moviepilot || {};
    if (!mp.baseUrl || !mp.apiKey) throw Object.assign(new Error('MoviePilot is not configured'), { code: 'MOVIEPILOT_NOT_CONFIGURED' });
    const title = task.itemInfo && (task.itemInfo.name || task.itemInfo.title) || '';
    if (!title) throw Object.assign(new Error('Upgrade search title is missing'), { code: 'UPGRADE_TITLE_MISSING' });
    const response = await moviepilotService.searchTorrents(mp, title);
    const raw = Array.isArray(response) ? response : response && response.data || [];
    const candidates = raw.map((entry, index) => ({ index, title: entry.torrent_info && entry.torrent_info.title || entry.title || '', site: entry.torrent_info && entry.torrent_info.site_name || '', size: Number(entry.torrent_info && entry.torrent_info.size || 0), torrentInfo: entry.torrent_info || entry }));
    if (!candidates.length) throw Object.assign(new Error('MoviePilot returned no upgrade candidate'), { code: 'UPGRADE_CANDIDATE_NOT_FOUND' });
    return { result: { candidates } };
  } });
  register({ capability: 'source.upgrade.download', allowedTargetGates: ['optimize'], sideEffect: true, idempotency: 'staged_write', defaultResourceRequest: { resourceType: 'moviepilot' }, execute: async (context) => {
    const search = output(context, 'upgrade-search');
    const approval = context.event.result || {};
    const selectedIndex = Number(approval.confirmData && approval.confirmData.selectedIndex || 0);
    const candidate = search.candidates && search.candidates[selectedIndex];
    if (!candidate) throw Object.assign(new Error('Upgrade candidate selection is invalid'), { code: 'UPGRADE_CANDIDATE_SELECTION_INVALID' });
    const mp = context.config.moviepilot || {};
    const added = await moviepilotService.addDownload(mp, { torrentInfo: candidate.torrentInfo, savePath: mp.savePath || undefined });
    if (!added || added.success === false) throw Object.assign(new Error(added && added.message || 'MoviePilot rejected the download'), { code: 'UPGRADE_DOWNLOAD_REJECTED' });
    const hash = added.data && added.data.download_id || '';
    if (!hash) throw Object.assign(new Error('MoviePilot did not return download_id'), { code: 'UPGRADE_DOWNLOAD_ID_MISSING' });
    const deadline = Date.now() + Math.max(60000, Number(context.config.upgradeDownloadTimeoutMs) || 6 * 60 * 60 * 1000);
    while (Date.now() < deadline) {
      const active = await moviepilotService.listDownloads(mp);
      if (!(Array.isArray(active) ? active : []).some((entry) => [entry.hash, entry.hashString, entry.download_hash].includes(hash))) break;
      await sleep(10000);
    }
    if (Date.now() >= deadline) throw Object.assign(new Error('MoviePilot download timed out'), { code: 'UPGRADE_DOWNLOAD_TIMEOUT' });
    const history = await moviepilotService.getTransferHistory(mp, 50);
    const rows = Array.isArray(history) ? history : history && history.data || [];
    const transfer = rows.find((entry) => [entry.download_hash, entry.downloadHash, entry.hash].includes(hash));
    const remote = transfer && (transfer.dest || transfer.target_path || transfer.transfer_path || transfer.path) || '';
    const local = mapTransferPath(remote, mp, context.config.upgradeStagingLocalPath || '');
    const outputPath = local && fs.existsSync(local) ? findMediaFile(local) : '';
    if (!outputPath) throw Object.assign(new Error('MoviePilot transfer output cannot be resolved in upgrade staging'), { code: 'UPGRADE_STAGING_OUTPUT_UNRESOLVED' });
    const sourcePath = sourcePathFor(context.task);
    return { result: { hash, candidate: { index: candidate.index, title: candidate.title }, outputPath, sourcePath, originalSizeBytes: fs.statSync(sourcePath).size, workDir: path.dirname(outputPath) } };
  } });
  register({ capability: 'output.media.verify', allowedTargetGates: ['optimize'], execute: async (context) => {
    const transcode = output(context, 'transcode');
    const download = output(context, 'upgrade-download');
    const outputPath = transcode.outputPath || download.outputPath || '';
    if (!outputPath) return { result: { valid: true, noMutation: true } };
    const summary = await transcodeService.probeSummary(context.config, outputPath);
    if (!(summary.durationSec > 0)) throw Object.assign(new Error('Optimize output duration is zero'), { code: 'OPTIMIZE_OUTPUT_INVALID' });
    const sizeBytes = fs.statSync(outputPath).size;
    const bitrateKbps = Math.round((sizeBytes * 8) / summary.durationSec / 1000);
    const profile = transcode.bitrateProfile;
    if (profile) {
      const comparison = bitrateObjectiveProfile.compareBitrateToProfile(bitrateKbps / 1000, profile);
      if (!['within', 'no_profile'].includes(comparison.status)) throw Object.assign(new Error(`Output bitrate is ${comparison.status}`), { code: `OPTIMIZE_${comparison.status.toUpperCase()}` });
    }
    return { result: { valid: true, outputPath, sizeBytes, bitrateKbps, summary, sourcePath: transcode.sourcePath || download.sourcePath, originalSizeBytes: transcode.originalSizeBytes || download.originalSizeBytes, workDir: transcode.workDir || download.workDir } };
  } });
  register({ capability: 'media.replace', allowedTargetGates: ['optimize'], sideEffect: true, idempotency: 'commit_once', defaultResourceRequest: { resourceType: 'filesystem' }, execute: async (context) => {
    sourceAccessResolver.assertTaskRevision(context.task);
    const verified = dependencyOutput(context, (event) => event.capability === 'output.media.verify');
    if (!verified.valid || !verified.outputPath || !verified.sourcePath) throw Object.assign(new Error('Verified optimize output is unavailable'), { code: 'OPTIMIZE_REPLACE_INPUT_MISSING' });
    const result = await transcodeService.replaceWithRetries({ config: context.config, targetPath: verified.sourcePath, partialPath: verified.outputPath });
    gateInvalidationService.recordGateInvalidation({ itemId: context.task.itemId, invalidatedGate: 'basedata', reason: 'post_optimize_replace', taskId: context.task.id });
    return { result: { ...result, pathChanged: false }, commitMarker: `replace:${context.event.eventId}` };
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
    workflowStore.recordMutation(mutation);
    kairoxStore.markBasedataStale({ itemId: context.task.itemId, reason: 'source_mutation_pending_rebind' });
    kairoxSignalBus.publish({ kind: 'source_mutation', itemId: context.task.itemId, mutationId: mutation.mutationId });
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
    const organized = output(context, 'organize');
    const sourcePath = organized.destination || sourcePathFor(context.task);
    return { result: { valid: fs.existsSync(sourcePath), path: sourcePath, materialized: output(context, 'materialize').written || [] } };
  } });
  register({ capability: 'optimization.result.publish', allowedTargetGates: ['optimize'], idempotency: 'commit_once', execute: async ({ task, event, events }) => {
    const layoutEvent = events.find((entry) => entry.eventId.endsWith(':layout-verify'));
    if (layoutEvent && (!layoutEvent.result || layoutEvent.result.valid !== true)) throw Object.assign(new Error('Optimize layout verification did not pass'), { code: 'OPTIMIZE_LAYOUT_NOT_VERIFIED' });
    const materialized = events.find((entry) => entry.eventId.endsWith(':materialize'));
    kairoxStore.publishOptimize({ itemId: task.itemId, objectiveRevision: task.objectiveRevisionSnapshot || '', facts: { passed: true, metadataArtifactsMaterialized: !!(materialized && materialized.status === 'succeeded') }, evidence: { taskId: task.id, eventId: event.eventId }, observedAt: new Date().toISOString() });
    return { result: { passed: true, objectiveRevision: task.objectiveRevisionSnapshot || '' }, evidence: { taskId: task.id, eventId: event.eventId }, commitMarker: `optimize:${task.objectiveRevisionSnapshot || task.id}` };
  } });
  return registry;
}

module.exports = { registerBuiltIns, nfoFor };
