'use strict';

const fs = require('fs');
const path = require('path');
const nodeService = require('../nodeService');
const peopleStore = require('../personCatalogStore');
const sourceAccessResolver = require('../sourceAccessResolver');
const localAi = require('../services/westernAdultLocalAiService');
const westernAdultAiService = require('../services/westernAdultAiService');

function westernConfig(task, config) {
  const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
  const library = (config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {};
  return { ...((config.adultLibrary || {}).western || {}), ...(library.western || {}) };
}

function sourcePath(task) {
  const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
  return sourceAccessResolver.resolve(descriptor.locator && descriptor.locator.path || task.itemInfo && task.itemInfo.path || '', { mustExist: true }).accessPath;
}

function workerNode(western) {
  const address = String(western.aiWorkerBaseUrl || '').trim();
  if (!address) throw Object.assign(new Error('Western adult AI worker is not configured'), { code: 'WESTERN_AI_WORKER_NOT_CONFIGURED' });
  return { address, apiKey: western.apiKey || '' };
}

function retryable(message, code, details = {}) { return Object.assign(new Error(message), { code, retryable: true, details }); }

function registerWesternAdultCapabilities(register) {
  register({ capability: 'media.frames.extract', allowedTargetGates: ['metadata'], execute: async ({ task, event, config }) => {
    const western = westernConfig(task, config);
    const frames = await localAi.extractFrames({ config, western, sourcePath: sourcePath(task), taskId: event.eventId });
    if (!frames.length) throw Object.assign(new Error('No frames extracted from source asset'), { code: 'WESTERN_FRAME_EXTRACTION_EMPTY' });
    return { result: { frames, sourcePath: sourcePath(task), frameCount: frames.length } };
  } });

  register({ capability: 'person.faces.embed', allowedTargetGates: ['metadata'], execute: async ({ task, config, input }) => {
    const western = westernConfig(task, config);
    const faces = western.faceRecognitionEnabled === false ? [] : await localAi.callFaceEmbeddingModel(western, input.frames.frames, {
      blacklist: peopleStore.listDismissedEmbeddings({ adultRegion: 'western_adult' }),
      blacklistThreshold: Number(western.blacklistThreshold) || 0.5,
    });
    return { result: { faces, frames: input.frames.frames } };
  } });

  register({ capability: 'person.faces.cluster', allowedTargetGates: ['metadata'], execute: async ({ task, config, input }) => {
    const western = westernConfig(task, config);
    return { result: { clusters: localAi.clusterFaces(input.embeddings.faces, Number(western.faceClusterThreshold) || 0.5), frames: input.embeddings.frames, faceCount: input.embeddings.faces.length } };
  } });

  register({ capability: 'person.faces.match', allowedTargetGates: ['metadata'], execute: async ({ task, config, input }) => {
    const western = westernConfig(task, config);
    const people = peopleStore.listPeople({ adultRegion: 'western_adult', includeArtifacts: true, limit: 200 }).people;
    const match = localAi.matchPeople(people, input.clusters.clusters, Number(western.faceSimilarityThreshold) || 0.25);
    const clusters = input.clusters.clusters.map((cluster) => {
      const found = match.faceClusters.find((entry) => entry.clusterId === cluster.clusterId);
      return { ...cluster, protagonistScore: Math.round((cluster.avgFaceArea || 0) * cluster.frameCount), matchedPersonId: found && found.matchedPersonId || '', matchedName: found && found.matchedName || '', matchConfidence: found && found.confidence || 0, referenceFaceId: found && found.referenceFaceId || '', status: found ? 'named' : 'unknown' };
    }).sort((a, b) => b.protagonistScore - a.protagonistScore);
    return { result: { match, clusters, frames: input.clusters.frames, faceCount: input.clusters.faceCount, people } };
  } });

  register({ capability: 'metadata.poster.compose', allowedTargetGates: ['metadata'], execute: async ({ task, input }) => {
    const matched = input.people;
    const protagonist = matched.clusters.find((entry) => entry.status === 'named') || null;
    const actorName = protagonist ? protagonist.matchedName : matched.match.actors[0] || 'Unknown Person';
    const sceneTitle = localAi.titleWordsFromFilename(sourcePath(task));
    const galleryImages = matched.frames.slice(0, 6).map((frame, frameIndex) => ({ frameIndex, imageBase64: fs.readFileSync(frame).toString('base64') }));
    const referenceImage = protagonist ? await localAi.referenceImageForPerson(matched.people, protagonist.matchedPersonId, protagonist.referenceFaceId) : null;
    const posterImageBase64 = await localAi.buildCompositePoster({ actorName, sceneTitle, referenceImage, galleryImages }) || (matched.frames[0] ? fs.readFileSync(matched.frames[0]).toString('base64') : '');
    return { result: { actorName, sceneTitle, protagonist, posterImageBase64, galleryImages, matched } };
  } });

  register({ capability: 'adult.metadata.compose', allowedTargetGates: ['metadata'], execute: async ({ input }) => {
    const presentation = input.presentation;
    const matched = presentation.matched;
    return { result: { facts: westernAdultAiService.normalizeCurationResult({
      title: localAi.safeName(`${presentation.actorName} - ${presentation.sceneTitle}`), generatedDescription: presentation.sceneTitle,
      actors: matched.match.actors, actorConfidence: matched.match.actorConfidence, matchedPeople: matched.match.matchedPeople,
      protagonist: presentation.protagonist ? { clusterId: presentation.protagonist.clusterId, personId: presentation.protagonist.matchedPersonId, name: presentation.protagonist.matchedName, confidence: presentation.protagonist.matchConfidence, protagonistScore: presentation.protagonist.protagonistScore } : null,
      tags: ['western_adult'], genres: ['Adult'], faceClusters: matched.clusters, unknownFaces: matched.clusters.filter((entry) => entry.status === 'unknown'),
      posterImageBase64: presentation.posterImageBase64, galleryImages: presentation.galleryImages, needsReview: !presentation.protagonist,
      ai: { provider: 'service-local', computeMode: 'local', frameCount: matched.frames.length, clusterCount: matched.clusters.length, faceCount: matched.faceCount },
    }, {}), evidence: { adapter: 'western_adult_local' } } };
  } });

  register({ capability: 'compute.asset.register', allowedTargetGates: ['metadata'], execute: async ({ task, event, config }) => {
    const western = westernConfig(task, config); const file = sourcePath(task); const stat = fs.statSync(file); const assetId = String(task.itemId || event.eventId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
    await nodeService.createAsset(workerNode(western), { assetId, assetKey: task.itemId, sourceFileName: path.basename(file), sourceFileSize: stat.size, fingerprint: { size: stat.size, mtimeMs: stat.mtimeMs } });
    return { result: { assetId, sourcePath: file, size: stat.size }, commitMarker: `worker-asset:${assetId}` };
  } });
  register({ capability: 'compute.asset.upload', allowedTargetGates: ['metadata'], execute: async ({ task, config, input }) => {
    const western = westernConfig(task, config); await nodeService.uploadAssetSource(workerNode(western), input.asset.assetId, input.asset.sourcePath, () => {}); return { result: { ...input.asset, uploaded: true } };
  } });
  register({ capability: 'adult.analysis.request', allowedTargetGates: ['metadata'], execute: async ({ task, event, config, input }) => {
    const western = westernConfig(task, config); const job = await nodeService.createAiJob(workerNode(western), { jobId: event.eventId, assetId: input.asset.assetId, itemName: task.itemInfo && task.itemInfo.name || path.basename(input.asset.sourcePath), people: peopleStore.listPeople({ adultRegion: 'western_adult', includeArtifacts: true, limit: 200 }).people, options: { frameSampleCount: western.frameSampleCount, frameWidth: western.frameWidth, faceRecognitionEnabled: western.faceRecognitionEnabled !== false, vlmEnabled: western.vlmEnabled !== false, blacklist: peopleStore.listDismissedEmbeddings({ adultRegion: 'western_adult' }), blacklistThreshold: Number(western.blacklistThreshold) || 0.5, faceSimilarityThreshold: Number(western.faceSimilarityThreshold) || 0.25 } });
    return { result: { jobId: job.jobId || event.eventId, assetId: input.asset.assetId }, commitMarker: `worker-ai-job:${job.jobId || event.eventId}` };
  } });
  register({ capability: 'adult.analysis.observe', allowedTargetGates: ['metadata'], execute: async ({ task, config, input }) => {
    const status = await nodeService.getAiJobStatus(workerNode(westernConfig(task, config)), input.job.jobId);
    if (status.status === 'error') throw Object.assign(new Error(status.error || 'AI worker analysis failed'), { code: 'WESTERN_AI_JOB_FAILED' });
    if (status.status !== 'done') throw retryable('AI worker analysis is still running', 'WESTERN_AI_JOB_PENDING', { jobId: input.job.jobId, status: status.status });
    return { result: { jobId: input.job.jobId, result: status.result || {} } };
  } });
  register({ capability: 'adult.metadata.normalize', allowedTargetGates: ['metadata'], execute: async ({ input }) => ({ result: { facts: westernAdultAiService.normalizeCurationResult(input.analysis.result || {}, {}), evidence: { adapter: 'western_adult_worker', jobId: input.analysis.jobId } } }) });
}

module.exports = { registerWesternAdultCapabilities };
