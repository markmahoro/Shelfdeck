'use strict';

const fs = require('fs');

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const adultLibraryService = require('./adultLibraryService');
const japaneseJavScraper = require('./services/japaneseJavScraper');

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

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  const rp = task.resumePoint || 'scrape_precheck';
  if (rp === 'scrape_precheck') await runPrecheck(taskId, task);
  else if (rp === 'scrape_executing') await runExecuting(taskId, task);
}

async function runPrecheck(taskId, task) {
  setPhase(taskId, 'scrape_precheck');
  appendLog(taskId, 'info', 'Scrape precheck started');

  try {
    const config = configStore.loadConfig();
    const item = task.itemInfo || {};
    const subLib = getSubLibrary(config, item.subLibraryId);
    if (!subLib) throw new Error('SubLibrary not found');
    if (!adultLibraryService.isAdultFolderSubLibrary(subLib)) throw new Error('Task subLibrary is not an adult folder library');
    if (!subLib.watchRoot) throw new Error('watchRoot is not configured');
    if (!fs.existsSync(subLib.watchRoot)) throw new Error(`watchRoot does not exist: ${subLib.watchRoot}`);
    if ((subLib.adultRegion || 'japanese_jav') !== 'japanese_jav') {
      throw new Error(`No scraper adapter implemented for adultRegion=${subLib.adultRegion}`);
    }

    taskStore.updateTask(taskId, { resumePoint: 'scrape_executing' });
    await runExecuting(taskId, taskStore.getTask(taskId));
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    adultLibraryService.markScrapeFailed(task.itemId, e.message);
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function runExecuting(taskId, task) {
  setPhase(taskId, 'scrape_executing');
  scheduler.reportStatus(taskId, 'executing', 10);

  try {
    const config = configStore.loadConfig();
    const subLib = getSubLibrary(config, task.itemInfo && task.itemInfo.subLibraryId);
    if (!subLib) throw new Error('SubLibrary not found');

    // The task's itemInfo is a snapshot from enqueue time and may be stale —
    // e.g. the user rescraped with a corrected 番号 override, which was written
    // to library.json by resetScrapeStatus but never propagated into task.itemInfo.
    // Read the live library item so the override takes effect here.
    const mediaLibraryService = require('./mediaLibraryService');
    const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
    if (!liveItem) throw new Error('Library item not found');
    const adultId = (liveItem.adultMetadata && liveItem.adultMetadata.adultId)
      || (task.itemInfo && task.itemInfo.adultMetadata && task.itemInfo.adultMetadata.adultId);
    if (!adultId) {
      throw new Error('Adult ID could not be detected from file name; correct the adult ID and retry scraping');
    }

    appendLog(taskId, 'info', `Starting JAV scrape for ${adultId}`);
    const scrapeResult = await japaneseJavScraper.scrapeJapaneseJav({
      taskId,
      subLib,
      adultId,
      onLog: (level, msg) => appendLog(taskId, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
    });
    scheduler.reportStatus(taskId, 'executing', 75);

    const latestItem = await adultLibraryService.applyScrapeResultToItem(subLib, liveItem, scrapeResult, {
        taskId,
        onLog: (level, msg) => appendLog(taskId, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
      });

    const strategyEngine = require('./strategyEngine');
    try { mediaLibraryService.recomputeAllSelfFields(); } catch (_) {}
    try { strategyEngine.runOnce(); } catch (_) {}

    const itemAfterStrategy = mediaLibraryService.getLibraryItem(task.itemId) || latestItem;
    appendLog(taskId, 'info', 'Scrape metadata saved; strategy recalculated');

    taskStore.updateTask(taskId, {
      itemInfo: {
        ...(task.itemInfo || {}),
        ...(itemAfterStrategy ? adultLibraryService.itemInfoFromItem(itemAfterStrategy) : {}),
      },
      resumePoint: null,
    });
    setPhase(taskId, 'done');
    scheduler.reportStatus(taskId, 'done', 100);
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    adultLibraryService.markScrapeFailed(task.itemId, e.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function pause(taskId) {
  japaneseJavScraper.abort(taskId);
  taskStore.updateTask(taskId, { status: 'paused', phase: 'scrape_paused' });
}

async function cancel(taskId) {
  japaneseJavScraper.abort(taskId);
}

function confirmReceived() {}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
