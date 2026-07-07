'use strict';

const fs = require('fs');

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const adultLibraryService = require('./adultLibraryService');
const mediaLibraryService = require('./mediaLibraryService');

let scheduler = null;
function setScheduler(s) { scheduler = s; }

function appendLog(taskId, level, msg) {
  taskStore.updateTask(taskId, { logs: [{ ts: new Date().toISOString(), level, msg }] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

function getSubLibrary(config, subLibraryId) {
  return (config.subLibraries || []).find((sl) => sl.uuid === subLibraryId) || null;
}

function isEmbySourceCandidate(item = {}, subLib = {}) {
  return String(item.source || '').toLowerCase() === 'emby'
    || String(subLib.source || 'emby').toLowerCase() === 'emby';
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  const rp = task.resumePoint || 'ingest_precheck';
  if (rp === 'ingest_precheck') await runPrecheck(taskId, task);
  else if (rp === 'ingest_commit') await runCommit(taskId, task);
}

async function runPrecheck(taskId, task) {
  setPhase(taskId, 'ingest_precheck');
  appendLog(taskId, 'info', 'Ingest precheck started');

  try {
    const config = configStore.loadConfig();
    const item = task.itemInfo || {};
    const subLib = getSubLibrary(config, item.subLibraryId);
    if (!subLib) throw new Error('SubLibrary not found');
    if (isEmbySourceCandidate(item, subLib)) {
      if (!item.sourceId && !item.embyItemId) throw new Error('Emby source id is required');
    } else {
      if (!adultLibraryService.isAdultFolderSubLibrary(subLib)) throw new Error('Task subLibrary is not an adult folder library');
      if (!item.path) throw new Error('Media file path is required');
      if (!fs.existsSync(item.path)) throw new Error(`Media file does not exist: ${item.path}`);
    }

    taskStore.updateTask(taskId, { resumePoint: 'ingest_commit' });
    await runCommit(taskId, taskStore.getTask(taskId));
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function runCommit(taskId, task) {
  setPhase(taskId, 'ingest_commit');
  scheduler.reportStatus(taskId, 'executing', 20);

  try {
    const config = configStore.loadConfig();
    const item = task.itemInfo || {};
    const subLib = getSubLibrary(config, item.subLibraryId);
    if (!subLib) throw new Error('SubLibrary not found');
    if (isEmbySourceCandidate(item, subLib)) {
      const result = mediaLibraryService.commitEmbySourceCandidate(item, { config });
      taskStore.updateTask(taskId, {
        itemInfo: {
          ...(task.itemInfo || {}),
          itemId: result.item.itemId,
          ingestedItemId: result.item.itemId,
          ingestedAssetKey: result.item.assetKey,
          observationKind: result.observationKind,
        },
        resumePoint: null,
      });
      appendLog(taskId, 'info', `Emby source committed: ${result.item.name || result.item.itemId}`);
      setPhase(taskId, 'done');
      scheduler.reportStatus(taskId, 'done', 100);
      return;
    }
    if (!item.path || !fs.existsSync(item.path)) throw new Error(`Media file does not exist: ${item.path || ''}`);

    const libItem = await adultLibraryService.upsertFileItem(subLib, item.path);
    const itemInfo = adultLibraryService.itemInfoFromItem(libItem);
    taskStore.updateTask(taskId, {
      itemInfo: {
        ...(task.itemInfo || {}),
        ingestedItemId: libItem.itemId,
        ingestedAssetKey: libItem.assetKey,
        ...itemInfo,
        itemId: task.itemId,
      },
      resumePoint: null,
    });
    appendLog(taskId, 'info', `Media item ingested: ${libItem.name || libItem.itemId}`);
    setPhase(taskId, 'done');
    scheduler.reportStatus(taskId, 'done', 100);
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function pause(taskId) {
  taskStore.updateTask(taskId, { status: 'paused', phase: 'ingest_paused' });
}

async function cancel() {}

function confirmReceived() {}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
