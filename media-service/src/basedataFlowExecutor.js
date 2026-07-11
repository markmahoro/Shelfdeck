'use strict';

const fs = require('fs');
const configStore = require('./configStore');
const kairoxStore = require('./kairoxStore');
const taskStore = require('./taskStore');
const embyService = require('./services/embyService');
const transcodeService = require('./services/transcodeService');

let scheduler = null;
function setScheduler(value) { scheduler = value; }

function appendLog(taskId, level, msg) {
  taskStore.updateTask(taskId, { logs: [{ ts: new Date().toISOString(), level, msg }] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

function resolutionPixels(value) {
  const [width = 0, height = 0] = String(value || '').split('x').map((part) => Number(part) || 0);
  return width * height;
}

function aggregateEmbyFacts(items = []) {
  const candidates = items.filter(Boolean);
  const technical = candidates.filter((item) => ['movie', 'episode'].includes(item.type));
  const rows = technical.length > 0 ? technical : candidates;
  const bestResolution = rows.reduce((selected, item) => (
    resolutionPixels(item.resolution) > resolutionPixels(selected) ? item.resolution : selected
  ), '');
  const size = rows.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  const duration = rows.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  const bitrateValues = rows.map((item) => Number(item.bitrate) || 0).filter((value) => value > 0);
  return {
    path: rows.find((item) => item.path) && rows.find((item) => item.path).path || '',
    size,
    duration,
    bitrate: bitrateValues.length > 0 ? Math.round(bitrateValues.reduce((sum, value) => sum + value, 0) / bitrateValues.length) : 0,
    resolution: bestResolution,
    codec: rows.find((item) => item.codec) && rows.find((item) => item.codec).codec || '',
    audioCodecs: [...new Set(rows.flatMap((item) => item.audioCodecs || []))],
    isDiscLike: rows.some((item) => item.isDiscLike),
    episodeCount: technical.filter((item) => item.type === 'episode').length,
  };
}

async function observeEmby(admission, config) {
  const descriptor = admission.sourceAccessDescriptor || {};
  const identity = descriptor.identityPayload || {};
  const server = (config.embyServers || {})[identity.serverId];
  if (!server) throw Object.assign(new Error('Emby server is not configured for Basedata'), { code: 'BASEDATA_EMBY_SERVER_MISSING' });
  const sourceRefId = identity.embyItemId;
  if (!sourceRefId) throw Object.assign(new Error('Emby item id is missing from SourceBinding'), { code: 'BASEDATA_SOURCE_ID_MISSING' });
  const item = await embyService.getItemById(server, sourceRefId);
  const episodes = item && item.type === 'season' ? await embyService.getSeasonEpisodes(server, sourceRefId) : [];
  return { ...aggregateEmbyFacts([item, ...(episodes || [])]), sourceRefId };
}

async function observeFile(admission, config) {
  const descriptor = admission.sourceAccessDescriptor || {};
  const filePath = descriptor.locator && descriptor.locator.path || '';
  if (!filePath || !fs.existsSync(filePath)) {
    throw Object.assign(new Error('Bound source file is unavailable'), { code: 'BASEDATA_SOURCE_UNAVAILABLE' });
  }
  const stat = fs.statSync(filePath);
  const summary = await transcodeService.probeSummary(config, filePath, { timeoutMs: 5000 });
  const bitrate = summary.durationSec > 0 ? Math.round((stat.size * 8) / summary.durationSec) : 0;
  return {
    path: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    duration: Math.round(summary.durationSec || 0),
    bitrate,
    resolution: summary.width && summary.height ? `${summary.width}x${summary.height}` : '',
    codec: summary.videoCodec || '',
    audioCodecs: summary.audioCodec ? [String(summary.audioCodec).toLowerCase()] : [],
    isDiscLike: false,
  };
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  const admission = task.helixAdmission || {};
  setPhase(taskId, 'basedata_observe');
  scheduler.reportStatus(taskId, 'executing', 10);
  appendLog(taskId, 'info', 'Basedata observation started');
  try {
    if (scheduler.assertHelixAdmission) scheduler.assertHelixAdmission(taskId, 'basedata.beforeObserve');
    const config = configStore.loadConfig();
    const descriptor = admission.sourceAccessDescriptor || {};
    const facts = descriptor.sourceType === 'emby'
      ? await observeEmby(admission, config)
      : await observeFile(admission, config);
    if (scheduler.assertHelixAdmission) scheduler.assertHelixAdmission(taskId, 'basedata.beforePublish');
    const now = new Date().toISOString();
    const published = kairoxStore.publishBasedata({
      itemId: task.itemId,
      sourceRevision: admission.sourceRevision || '',
      facts,
      evidence: { taskId, sourceRevision: admission.sourceRevision || '' },
      observedAt: now,
      updatedAt: now,
    });
    const basedataRevision = published.factRevision;
    taskStore.updateTask(taskId, { basedataRevision, resumePoint: null });
    appendLog(taskId, 'info', 'Basedata facts published');
    setPhase(taskId, 'done');
    scheduler.reportStatus(taskId, 'done', 100);
  } catch (error) {
    appendLog(taskId, 'error', error.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function pause(taskId) {
  taskStore.updateTask(taskId, { status: 'paused', phase: 'basedata_paused' });
}

async function cancel() {}
function confirmReceived() {}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler, aggregateEmbyFacts };
