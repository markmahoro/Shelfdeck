'use strict';

const fs = require('fs');
const path = require('path');
const nodeService = require('../nodeService');
const peopleStore = require('../personCatalogStore');
const westernAdultLocalAiService = require('./westernAdultLocalAiService');

const controllers = new Map();

function normalizeList(value) {
  return Array.isArray(value) ? value.map((x) => String(x || '').trim()).filter(Boolean) : [];
}

function normalizeCurationResult(raw, item) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const scene = body.scene && typeof body.scene === 'object' ? body.scene : {};
  const actors = normalizeList(body.actors || body.performers || body.matchedActors);
  const tags = normalizeList(body.tags || scene.tags || body.visualTags);
  const genres = normalizeList(body.genres);
  const description = String(
    body.shortDescription ||
    body.generatedDescription ||
    body.summary ||
    body.safeSummary ||
    scene.summary ||
    ''
  ).trim();
  const fallbackName = item && item.path ? require('path').basename(item.path, require('path').extname(item.path)) : 'Scene';
  const actorLabel = actors.length ? actors.join(', ') : 'Unknown Person';
  const generatedTitle = String(body.generatedTitle || body.title || `${actorLabel} - ${description || fallbackName}`).trim();

  return {
    ...body,
    title: String(body.title || generatedTitle).trim(),
    generatedTitle,
    generatedDescription: description,
    actors,
    tags,
    genres,
    scene,
    faceClusters: Array.isArray(body.faceClusters) ? body.faceClusters : [],
    unknownFaces: Array.isArray(body.unknownFaces) ? body.unknownFaces : [],
    actorConfidence: body.actorConfidence && typeof body.actorConfidence === 'object' ? body.actorConfidence : {},
    safetyFlags: body.safetyFlags && typeof body.safetyFlags === 'object' ? body.safetyFlags : {},
    needsReview: !!body.needsReview,
    ai: body.ai && typeof body.ai === 'object' ? body.ai : {},
  };
}

function mockAnalyze(item) {
  const path = require('path');
  const stem = item && item.path ? path.basename(item.path, path.extname(item.path)) : 'Scene';
  const cleaned = stem.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Scene';
  return normalizeCurationResult({
    title: `Unknown Person - ${cleaned}`,
    generatedTitle: `Unknown Person - ${cleaned}`,
    generatedDescription: cleaned,
    actors: [],
    tags: ['western_adult', 'needs_actor_name'],
    scene: { setting: '', style: '', performerCount: 0, tags: ['needs_actor_name'] },
    unknownFaces: [],
    faceClusters: [],
    needsReview: true,
    ai: { provider: 'mock', model: 'filename' },
  }, item);
}

async function analyzeVideo({ taskId, config, subLib, item, onLog }) {
  const western = {
    ...(((config.adultLibrary || {}).western) || {}),
    ...(subLib.western || {}),
  };
  if (western.provider === 'mock') {
    onLog && onLog('warn', 'Using western adult mock provider; no AI worker was called');
    return mockAnalyze(item);
  }
  if (western.enabled === false) {
    throw new Error('Western adult AI is disabled; enable adultLibrary.western.enabled');
  }
  const computeMode = String(western.computeMode || 'local').toLowerCase();
  if (computeMode !== 'worker') {
    return normalizeCurationResult(await westernAdultLocalAiService.analyzeVideo({
      taskId,
      config,
      subLib,
      item,
      western,
      onLog,
    }), item);
  }
  const address = String(western.aiWorkerBaseUrl || '').trim();
  if (!address) throw new Error('adultLibrary.western.aiWorkerBaseUrl is not configured');
  if (!item.path || !fs.existsSync(item.path)) throw new Error(`Media file does not exist: ${item.path || ''}`);

  const ac = new AbortController();
  controllers.set(String(taskId || ''), ac);
  const timeout = setTimeout(() => ac.abort(), Math.max(5000, Number(western.timeoutMs) || 600000));
  timeout.unref && timeout.unref();

  try {
    const node = { address, apiKey: western.apiKey || '' };
    const stat = fs.statSync(item.path);
    const assetId = String(item.itemId || taskId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    onLog && onLog('info', `Uploading source asset to AI worker (${Math.round(stat.size / 1024 / 1024)} MB)`);
    await nodeService.createAsset(node, {
      assetId,
      assetKey: item.assetKey || item.itemId,
      sourceFileName: path.basename(item.path),
      sourceFileSize: stat.size,
      fingerprint: { size: stat.size, mtimeMs: stat.mtimeMs },
    });
    await nodeService.uploadAssetSource(node, assetId, item.path, (sent, total) => {
      if (total && sent >= total) {
        onLog && onLog('info', 'Source asset uploaded to AI worker');
      }
    });

    const aiJob = await nodeService.createAiJob(node, {
      jobId: taskId,
      assetId,
      itemName: item.name || path.basename(item.path, path.extname(item.path)),
      people: peopleStore.listPeople({ adultRegion: 'western_adult', includeArtifacts: true, limit: 200 }).people,
      options: {
        frameSampleCount: western.frameSampleCount,
        frameWidth: western.frameWidth,
        faceRecognitionEnabled: western.faceRecognitionEnabled !== false,
        vlmEnabled: western.vlmEnabled !== false,
        allowExplicitGeneratedText: western.allowExplicitGeneratedText !== false,
        // Dismissed-actor blacklist so the worker drops male/supporting faces
        // before protagonist selection.
        blacklist: peopleStore.listDismissedEmbeddings({ adultRegion: 'western_adult' }),
        blacklistThreshold: Number(western.blacklistThreshold) || 0.5,
        faceSimilarityThreshold: Number(western.faceSimilarityThreshold) || 0.25,
      },
    });
    const jobId = aiJob.jobId || taskId;
    onLog && onLog('info', `AI worker job created: ${jobId}`);
    for (;;) {
      if (ac.signal.aborted) throw new Error('AI worker analyze aborted');
      const status = await nodeService.getAiJobStatus(node, jobId);
      if (status.status === 'done') {
        onLog && onLog('info', 'AI worker returned western adult curation metadata');
        return normalizeCurationResult(status.result || {}, item);
      }
      if (status.status === 'error') throw new Error(`AI worker analyze failed: ${status.error || 'unknown'}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    clearTimeout(timeout);
    controllers.delete(String(taskId || ''));
  }
}

function abort(taskId) {
  const ac = controllers.get(String(taskId || ''));
  if (!ac) return false;
  try { ac.abort(); } catch (_) {}
  controllers.delete(String(taskId || ''));
  return true;
}

module.exports = { analyzeVideo, abort, normalizeCurationResult };
