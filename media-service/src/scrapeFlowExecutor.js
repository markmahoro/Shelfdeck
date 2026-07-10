'use strict';

const fs = require('fs');
const path = require('path');

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const adultSourceIdentity = require('./adultSourceIdentity');
const kairoxStore = require('./kairoxStore');
const embyService = require('./services/embyService');
const japaneseJavScraper = require('./services/japaneseJavScraper');
const westernAdultAiService = require('./services/westernAdultAiService');

let scheduler = null;
function setScheduler(value) { scheduler = value; }

function appendLog(taskId, level, msg) {
  taskStore.updateTask(taskId, { logs: [{ ts: new Date().toISOString(), level, msg }] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

function getSubLibrary(config, subLibraryId) {
  return (config.subLibraries || []).find((subLibrary) => subLibrary.uuid === subLibraryId) || null;
}

function descriptorForTask(task = {}) {
  return task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
}

function cleanObject(input = {}) {
  return Object.entries(input).reduce((out, [key, value]) => {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
    return out;
  }, {});
}

function embyMetadataFacts(item = {}, episodes = []) {
  return cleanObject({
    title: item.name || '',
    name: item.name || '',
    type: item.type || '',
    premiereDate: item.premiereDate || '',
    genres: item.genres || [],
    providerIds: item.providerIds || {},
    tmdbId: item.tmdbId || '',
    seriesName: item.seriesName || '',
    seriesId: item.seriesId || '',
    seasonNumber: item.parentIndexNumber,
    episodeNumber: item.indexNumber,
    episodeCount: episodes.length,
  });
}

function adultMetadataFacts(result = {}, item = {}, adultId = '') {
  return cleanObject({
    title: result.title || result.generatedTitle || adultId || path.basename(item.path || '', path.extname(item.path || '')),
    name: result.title || result.generatedTitle || adultId || '',
    type: 'movie',
    adultId: result.adultId || adultId,
    originalTitle: result.originalTitle || '',
    plot: result.plot || result.overview || result.generatedDescription || '',
    actors: result.actors || [],
    actorThumbs: result.actorThumbs || {},
    genres: result.genres || [],
    tags: result.tags || [],
    studio: result.studio || '',
    director: result.director || '',
    series: result.series || '',
    rating: result.rating,
    premiered: result.premiered || '',
    runtimeMinutes: result.runtimeMinutes,
    posterUrl: result.posterUrl || '',
    fanartUrl: result.fanartUrl || '',
    trailerUrl: result.trailerUrl || '',
    country: result.country || '',
    needsReview: !!result.needsReview,
    ai: result.ai || {},
    faceClusters: Array.isArray(result.faceClusters) ? result.faceClusters : [],
    unknownFaces: Array.isArray(result.unknownFaces) ? result.unknownFaces : [],
    actorConfidence: result.actorConfidence || {},
  });
}

function assertMetadataFacts(facts) {
  if (!facts || !String(facts.title || '').trim()) {
    const error = new Error('Metadata title is missing');
    error.code = 'KAIROX_METADATA_TITLE_MISSING';
    throw error;
  }
}

async function observeEmbyMetadata(task, config, subLibrary) {
  const descriptor = descriptorForTask(task);
  const identity = descriptor.identityPayload || {};
  const serverId = identity.serverId || subLibrary.embyServerId;
  const server = (config.embyServers || {})[serverId];
  if (!server) throw Object.assign(new Error('Emby server is not configured for Metadata'), { code: 'KAIROX_METADATA_EMBY_SERVER_MISSING' });
  const embyItemId = identity.embyItemId || descriptor.locator && descriptor.locator.sourceRefId;
  if (!embyItemId) throw Object.assign(new Error('Emby item id is missing from SourceBinding'), { code: 'KAIROX_METADATA_SOURCE_ID_MISSING' });
  const item = await embyService.getItemById(server, embyItemId);
  const episodes = item && item.type === 'season' ? await embyService.getSeasonEpisodes(server, embyItemId) : [];
  return {
    facts: embyMetadataFacts(item, episodes || []),
    evidence: { adapter: 'emby', embyItemId, serverId, episodeCount: (episodes || []).length },
  };
}

async function observeFolderMetadata(task, config, subLibrary) {
  const descriptor = descriptorForTask(task);
  const filePath = descriptor.locator && descriptor.locator.path || task.itemInfo && task.itemInfo.path || '';
  if (!filePath || !fs.existsSync(filePath)) {
    const error = new Error(`Media file does not exist: ${filePath}`);
    error.code = 'KAIROX_SOURCE_INCIDENT';
    throw error;
  }
  const item = { ...(task.itemInfo || {}), itemId: task.itemId, path: filePath };
  const region = subLibrary.adultRegion || 'japanese_jav';
  if (region === 'western_adult') {
    const result = await westernAdultAiService.analyzeVideo({
      taskId: task.id,
      config,
      subLib: subLibrary,
      item,
      onLog: (level, msg) => appendLog(task.id, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
    });
    return {
      facts: adultMetadataFacts(result, item, result.adultId || ''),
      evidence: { adapter: 'western_adult_ai', region },
    };
  }
  const adultId = item.adultMetadata && item.adultMetadata.adultId
    || adultSourceIdentity.extractAdultId(path.basename(filePath))
    || adultSourceIdentity.extractAdultId(filePath);
  if (!adultId) throw Object.assign(new Error('Adult ID could not be detected from SourceBinding path'), { code: 'KAIROX_METADATA_ID_UNRESOLVED' });
  const result = await japaneseJavScraper.scrapeJapaneseJav({
    taskId: task.id,
    subLib: subLibrary,
    adultId,
    onLog: (level, msg) => appendLog(task.id, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
  });
  return {
    facts: adultMetadataFacts(result, item, adultId),
    evidence: { adapter: 'japanese_jav', region, adultId },
  };
}

function failTask(taskId, task, error) {
  const sourceIncident = error && error.code === 'KAIROX_SOURCE_INCIDENT'
    ? { code: error.code, message: error.message, observedAt: new Date().toISOString() }
    : null;
  taskStore.updateTask(taskId, {
    resumePoint: task && task.resumePoint || 'scrape_executing',
    metadataFailure: { code: error.code || 'KAIROX_METADATA_FAILED', message: error.message },
    ...(sourceIncident ? { sourceIncident } : {}),
  });
  appendLog(taskId, 'error', error.message);
  setPhase(taskId, 'failed_hard');
  scheduler.reportStatus(taskId, 'failed_hard', 0);
}

async function publishMetadata(taskId, task) {
  const latest = taskStore.getTask(taskId) || task;
  const pending = latest.pendingMetadataPublication;
  if (!pending || !pending.facts) {
    failTask(taskId, latest, Object.assign(new Error('Pending metadata publication is missing'), { code: 'KAIROX_METADATA_PUBLICATION_MISSING' }));
    return;
  }
  try {
    if (scheduler && typeof scheduler.assertHelixAdmission === 'function') {
      scheduler.assertHelixAdmission(taskId, 'scrape_publish');
    }
    assertMetadataFacts(pending.facts);
    const now = new Date().toISOString();
    kairoxStore.publishMetadata({
      itemId: latest.itemId,
      facts: pending.facts,
      evidence: { ...(pending.evidence || {}), taskId: latest.id },
      observedAt: pending.observedAt || now,
      updatedAt: now,
    });
    taskStore.updateTask(taskId, {
      itemInfo: { ...(latest.itemInfo || {}), ...pending.facts, metadataComplete: true },
      pendingMetadataPublication: null,
      resumePoint: null,
    });
    appendLog(taskId, 'info', 'Metadata facts published');
    setPhase(taskId, 'done');
    scheduler.reportStatus(taskId, 'done', 100);
  } catch (error) {
    appendLog(taskId, 'error', `Metadata publication interrupted: ${error.message}`);
    taskStore.updateTask(taskId, { phase: 'scrape_publish', resumePoint: 'scrape_publish' });
    scheduler.reportStatus(taskId, 'interrupted');
  }
}

async function runExecuting(taskId, task) {
  setPhase(taskId, 'scrape_executing');
  scheduler.reportStatus(taskId, 'executing', 10);
  try {
    const config = configStore.loadConfig();
    const descriptor = descriptorForTask(task);
    const subLibraryId = descriptor.subLibraryId || task.itemInfo && task.itemInfo.subLibraryId || '';
    const subLibrary = getSubLibrary(config, subLibraryId);
    if (!subLibrary) throw Object.assign(new Error('SubLibrary not found'), { code: 'KAIROX_METADATA_LIBRARY_MISSING' });
    const result = descriptor.sourceType === 'emby'
      ? await observeEmbyMetadata(task, config, subLibrary)
      : await observeFolderMetadata(task, config, subLibrary);
    assertMetadataFacts(result.facts);
    const latest = taskStore.updateTask(taskId, {
      pendingMetadataPublication: {
        facts: result.facts,
        evidence: result.evidence,
        observedAt: new Date().toISOString(),
      },
      resumePoint: 'scrape_publish',
      phase: 'scrape_publish',
    }) || task;
    scheduler.reportStatus(taskId, 'executing', 85);
    await publishMetadata(taskId, latest);
  } catch (error) {
    failTask(taskId, taskStore.getTask(taskId) || task, error);
  }
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  const resumePoint = task.resumePoint || 'scrape_precheck';
  if (resumePoint === 'scrape_publish') {
    await publishMetadata(taskId, task);
    return;
  }
  if (resumePoint !== 'scrape_precheck' && resumePoint !== 'scrape_executing') {
    failTask(taskId, task, Object.assign(new Error(`Unsupported scrape resume point: ${resumePoint}`), { code: 'KAIROX_METADATA_RESUME_POINT_INVALID' }));
    return;
  }
  taskStore.updateTask(taskId, { resumePoint: 'scrape_executing' });
  await runExecuting(taskId, taskStore.getTask(taskId) || task);
}

async function pause(taskId) {
  japaneseJavScraper.abort(taskId);
  westernAdultAiService.abort(taskId);
  taskStore.updateTask(taskId, { status: 'paused', phase: 'scrape_paused' });
}

async function cancel(taskId) {
  japaneseJavScraper.abort(taskId);
  westernAdultAiService.abort(taskId);
}

function confirmReceived() {}

module.exports = {
  driveTask,
  pause,
  cancel,
  confirmReceived,
  setScheduler,
  embyMetadataFacts,
  adultMetadataFacts,
};
