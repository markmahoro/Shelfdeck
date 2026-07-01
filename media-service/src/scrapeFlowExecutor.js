'use strict';

const fs = require('fs');

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const adultLibraryService = require('./adultLibraryService');
const japaneseJavScraper = require('./services/japaneseJavScraper');
const westernAdultAiService = require('./services/westernAdultAiService');
const approvalPolicy = require('./approvalPolicy');
const scrapeVerification = require('./scrapeVerification');
const metadataStatus = require('./metadataStatus');

let scheduler = null;
function setScheduler(s) { scheduler = s; }

function appendLog(taskId, level, msg) {
  taskStore.updateTask(taskId, { logs: [{ ts: new Date().toISOString(), level, msg }] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

function failureCodes(verification) {
  return (verification && Array.isArray(verification.failures) ? verification.failures : [])
    .map((failure) => failure && failure.code)
    .filter(Boolean);
}

function recordScrapeGateFailure(taskId, opts = {}) {
  const verification = opts.verification || null;
  const codes = failureCodes(verification);
  const message = opts.message || (codes.length
    ? `Scrape metadata gate failed: ${codes.join(', ')}`
    : 'Scrape metadata gate failed');
  const updates = {
    resumePoint: opts.resumePoint || 'scrape_executing',
  };
  if (opts.itemInfo !== undefined) updates.itemInfo = opts.itemInfo;
  if (verification) {
    updates.scrapeVerification = {
      ...verification,
      source: opts.source || verification.source || 'completion_snapshot',
    };
  }
  updates.metadataGateFailure = {
    gate: 'metadataGate',
    checkedAt: (verification && verification.checkedAt) || new Date().toISOString(),
    metadataStatus: verification && verification.metadataStatus,
    metadataMissingReasons: verification && verification.metadataMissingReasons || codes,
    failureCodes: codes,
    recovery: 'retry_current_scrape_after_fixing_upstream_facts_or_gate_config',
    userAction: 'inspect_gate_missing_reasons',
  };
  taskStore.updateTask(taskId, updates);
  appendLog(taskId, 'error', message);
  const latestTask = taskStore.getTask(taskId);
  taskStore.appendTaskEvent(latestTask, 'scrape.metadata_gate_failed', {
    message,
    gate: 'metadataGate',
    metadataStatus: updates.metadataGateFailure.metadataStatus,
    metadataMissingReasons: updates.metadataGateFailure.metadataMissingReasons,
    failureCodes: codes,
    verification: updates.scrapeVerification || null,
    recovery: updates.metadataGateFailure.recovery,
    userAction: updates.metadataGateFailure.userAction,
  });
  setPhase(taskId, 'failed_hard');
  scheduler.reportStatus(taskId, 'failed_hard', 0);
}

function getSubLibrary(config, subLibraryId) {
  return (config.subLibraries || []).find((sl) => sl.uuid === subLibraryId) || null;
}

function metadataVerification(meta, source = 'completion_snapshot') {
  const missingReasons = Array.isArray(meta && meta.metadataMissingReasons)
    ? meta.metadataMissingReasons
    : [];
  return {
    ok: missingReasons.length === 0,
    checkedAt: new Date().toISOString(),
    checks: Object.fromEntries(missingReasons.map((reason) => [reason, false])),
    failures: missingReasons.map((reason) => ({ code: reason, message: `Metadata missing: ${reason}` })),
    warnings: [],
    metadataStatus: meta && meta.metadataStatus,
    metadataMissingReasons: missingReasons,
    source,
  };
}

function isMediaSourceMissingError(err) {
  const message = String(err && err.message || err || '');
  return message.startsWith('Media file does not exist:');
}

function reportIngestInvalidation(taskId, task, err, phase) {
  if (!isMediaSourceMissingError(err)) return false;
  const message = String(err && err.message || err || '');
  const itemInfo = task && task.itemInfo || {};
  if (scheduler && typeof scheduler.reportGateInvalidation === 'function') {
    scheduler.reportGateInvalidation(taskId, {
      invalidatedGate: 'ingest',
      reason: 'source_missing',
      message,
      evidence: {
        path: itemInfo.path || '',
        phase: phase || '',
      },
      recovery: 'rerun_ingest_source_sync',
      userAction: 'rerun_ingest_source_sync',
    });
  } else {
    taskStore.updateTask(taskId, {
      upstreamGateInvalidation: {
        gate: 'ingest',
        invalidatedGate: 'ingest',
        reason: 'source_missing',
        message,
        evidence: {
          path: itemInfo.path || '',
          phase: phase || '',
        },
        sourceTaskId: taskId,
        sourceActionType: task && task.actionType || 'scrape',
        sourceTargetGate: 'metadata',
        invalidatedAt: new Date().toISOString(),
        recovery: 'rerun_ingest_source_sync',
        userAction: 'rerun_ingest_source_sync',
        stored: false,
        storeReason: 'scheduler_report_gate_invalidation_unavailable',
      },
    });
  }
  taskStore.appendTaskEvent(taskStore.getTask(taskId) || task, 'scrape.upstream_gate_invalidated', {
    invalidatedGate: 'ingest',
    reason: 'source_missing',
    message,
    phase: phase || '',
    recovery: 'rerun_ingest_source_sync',
  });
  return true;
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  const rp = task.resumePoint || 'scrape_precheck';
  if (rp === 'scrape_precheck') await runPrecheck(taskId, task);
  else if (rp === 'scrape_executing') await runExecuting(taskId, task);
  else if (rp === 'scrape_write_metadata') await runWriteMetadata(taskId, task);
  else if (rp === 'scrape_review') await finishScrape(taskId);
}

async function runPrecheck(taskId, task) {
  setPhase(taskId, 'scrape_precheck');
  appendLog(taskId, 'info', 'Scrape precheck started');

  try {
    const config = configStore.loadConfig();
    const item = task.itemInfo || {};
    const subLib = getSubLibrary(config, item.subLibraryId);
    if (!subLib) throw new Error('SubLibrary not found');
    if ((subLib.source || 'emby') === 'emby') {
      taskStore.updateTask(taskId, { resumePoint: 'scrape_executing' });
      await runExecuting(taskId, taskStore.getTask(taskId));
      return;
    }
    if (!adultLibraryService.isAdultFolderSubLibrary(subLib)) throw new Error('Task subLibrary is not an adult folder library');
    if (!subLib.watchRoot) throw new Error('watchRoot is not configured');
    if (!fs.existsSync(subLib.watchRoot)) throw new Error(`watchRoot does not exist: ${subLib.watchRoot}`);
    const region = subLib.adultRegion || 'japanese_jav';
    if (!['japanese_jav', 'western_adult'].includes(region)) {
      throw new Error(`No scraper adapter implemented for adultRegion=${subLib.adultRegion}`);
    }

    taskStore.updateTask(taskId, { resumePoint: 'scrape_executing' });
    await runExecuting(taskId, taskStore.getTask(taskId));
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    if (reportIngestInvalidation(taskId, task, e, 'scrape_precheck')) {
      setPhase(taskId, 'failed_hard');
      scheduler.reportStatus(taskId, 'failed_hard', 0);
      return;
    }
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
    if ((subLib.source || 'emby') === 'emby') {
      await runEmbyExecuting(taskId, task, config, subLib);
      return;
    }

    // The task's itemInfo is a snapshot from enqueue time and may be stale —
    // e.g. the user rescraped with a corrected 番号 override, which was written
    // to library.json by resetScrapeStatus but never propagated into task.itemInfo.
    // Read the live library item so the override takes effect here.
    const mediaLibraryService = require('./mediaLibraryService');
    const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
    if (!liveItem) throw new Error('Library item not found');
    const region = subLib.adultRegion || 'japanese_jav';
    if (region === 'western_adult') {
      await runWesternExecuting(taskId, task, config, subLib, liveItem);
      return;
    }

    const adultId = (liveItem.adultMetadata && liveItem.adultMetadata.adultId)
      || (task.itemInfo && task.itemInfo.adultMetadata && task.itemInfo.adultMetadata.adultId);
    if (!adultId) {
      throw new Error('Adult ID could not be detected from file name; correct the adult ID and retry scraping');
    }

    appendLog(taskId, 'info', `Starting JAV scrape for ${adultId}`);
    const scrapeResult = (task.itemInfo && task.itemInfo.pendingScrapeResult)
      || await japaneseJavScraper.scrapeJapaneseJav({
        taskId,
        subLib,
        adultId,
        onLog: (level, msg) => appendLog(taskId, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
      });
    scheduler.reportStatus(taskId, 'executing', 75);

    if (await pauseBeforeScrapeWrite(taskId, task, config, subLib, liveItem, { kind: 'jav', scrapeResult })) return;

    await applyJavScrapeResult(taskId, task, config, subLib, liveItem, scrapeResult);
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    if (reportIngestInvalidation(taskId, task, e, 'scrape_executing')) {
      setPhase(taskId, 'failed_hard');
      scheduler.reportStatus(taskId, 'failed_hard', 0);
      return;
    }
    adultLibraryService.markScrapeFailed(task.itemId, e.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function runEmbyExecuting(taskId, task, config, subLib) {
  setPhase(taskId, 'scrape_executing');
  scheduler.reportStatus(taskId, 'executing', 20);
  try {
    const mediaLibraryService = require('./mediaLibraryService');
    const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
    if (liveItem) {
      const liveMeta = metadataStatus.resolveMetadataStatus(liveItem, config);
      if (liveMeta.metadataComplete) {
        const updatedInfo = {
          ...(task.itemInfo || {}),
          ...buildUpdatedItemInfo(liveItem),
        };
        taskStore.updateTask(taskId, {
          itemInfo: updatedInfo,
          scrapeVerification: metadataVerification(liveMeta, 'live_item_precheck'),
          resumePoint: null,
          approval: null,
        });
        appendLog(taskId, 'info', 'Standard metadata already complete; repair skipped');
        setPhase(taskId, 'done');
        scheduler.reportStatus(taskId, 'done', 100);
        return;
      }
    }

    appendLog(taskId, 'info', 'Starting standard metadata repair');
    const latestItem = await mediaLibraryService.completeEmbyItemMetadata(task.itemId, { config });
    const repairSummary = latestItem && latestItem.metadataRepairSummary || {};
    appendLog(taskId, 'info', 'Fetched latest item facts from Emby');
    if (repairSummary.doubanCache) {
      appendLog(taskId, 'info', `Applied local Douban cache: ${repairSummary.doubanCache.matched || 0} matched, ${repairSummary.doubanCache.changed || 0} changed`);
    }
    appendLog(taskId, 'info', 'Recomputed ShelfDeck media facts and optimize targets');
    scheduler.reportStatus(taskId, 'executing', 85);
    const meta = metadataStatus.resolveMetadataStatus(latestItem, config);
    if (!meta.metadataComplete) {
      const updatedInfo = {
        ...(task.itemInfo || {}),
        ...buildUpdatedItemInfo(latestItem),
      };
      const verification = metadataVerification(meta, 'completion_snapshot');
      recordScrapeGateFailure(taskId, {
        itemInfo: updatedInfo,
        verification,
        message: `Metadata repair incomplete: ${meta.metadataMissingReasons.join(', ')}`,
      });
      return;
    }
    appendLog(taskId, meta.metadataComplete ? 'info' : 'warn', meta.metadataComplete
      ? 'Standard metadata repair verified'
      : `Metadata repair incomplete: ${meta.metadataMissingReasons.join(', ')}`);
    await afterScrapeApplied(taskId, task, config, latestItem, 'Standard metadata repair finished; optimize targets recalculated');
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function runWriteMetadata(taskId, task) {
  setPhase(taskId, 'scrape_executing');
  scheduler.reportStatus(taskId, 'executing', 80);

  try {
    const config = configStore.loadConfig();
    const subLib = getSubLibrary(config, task.itemInfo && task.itemInfo.subLibraryId);
    if (!subLib) throw new Error('SubLibrary not found');
    const mediaLibraryService = require('./mediaLibraryService');
    const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
    if (!liveItem) throw new Error('Library item not found');
    const pendingKind = task.itemInfo && task.itemInfo.pendingScrapeKind;
    if (pendingKind === 'western') {
      await applyWesternCuration(taskId, task, config, subLib, liveItem, task.itemInfo && task.itemInfo.pendingWesternCuration);
      return;
    }
    await applyJavScrapeResult(taskId, task, config, subLib, liveItem, task.itemInfo && task.itemInfo.pendingScrapeResult);
  } catch (e) {
    appendLog(taskId, 'error', e.message);
    if (reportIngestInvalidation(taskId, task, e, 'scrape_write_metadata')) {
      setPhase(taskId, 'failed_hard');
      scheduler.reportStatus(taskId, 'failed_hard', 0);
      return;
    }
    adultLibraryService.markScrapeFailed(task.itemId, e.message);
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
  }
}

async function pauseBeforeScrapeWrite(taskId, task, config, subLib, liveItem, pending) {
  const writeGate = approvalPolicy.requiresConfirmation('scrape.beforeWriteMetadata', { task, itemInfo: task.itemInfo, config, subLib });
  const organizeGate = approvalPolicy.requiresConfirmation('scrape.beforeOrganize', { task, itemInfo: task.itemInfo, config, subLib });
  if (!writeGate && !organizeGate) return false;
  const gateId = writeGate ? 'scrape.beforeWriteMetadata' : 'scrape.beforeOrganize';
  const approval = approvalPolicy.makeApproval(gateId, {
    task,
    itemInfo: task.itemInfo,
    config,
    subLib,
    message: writeGate
      ? 'Scrape result is ready. Confirm before writing NFO, artwork, marker files, and library metadata.'
      : 'Scrape result is ready. Confirm before organizing or renaming the folder.',
    payload: {
      adultId: (pending.scrapeResult && pending.scrapeResult.adultId) || (pending.curation && pending.curation.adultId) || '',
      title: (pending.scrapeResult && pending.scrapeResult.title) || (pending.curation && pending.curation.title) || '',
      path: liveItem && liveItem.path,
    },
  });
  taskStore.updateTask(taskId, {
    itemInfo: {
      ...(task.itemInfo || {}),
      pendingScrapeKind: pending.kind,
      ...(pending.kind === 'western' ? { pendingWesternCuration: pending.curation } : { pendingScrapeResult: pending.scrapeResult }),
    },
  });
  setPhase(taskId, 'scrape_write_metadata');
  scheduler.pauseForConfirm(taskId, 'scrape_write_metadata', approval);
  return true;
}

async function applyJavScrapeResult(taskId, task, config, subLib, liveItem, scrapeResult) {
  if (!scrapeResult) throw new Error('No pending scrape result to write');
  const mediaLibraryService = require('./mediaLibraryService');
  const latestItem = await adultLibraryService.applyScrapeResultToItem(subLib, liveItem, scrapeResult, {
    taskId,
    onLog: (level, msg) => appendLog(taskId, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
  });
  await afterScrapeApplied(taskId, task, config, latestItem, 'Scrape metadata saved; optimize targets recalculated');
}

async function runWesternExecuting(taskId, task, config, subLib, liveItem) {
  appendLog(taskId, 'info', 'Starting western adult AI curation');
  const curation = (task.itemInfo && task.itemInfo.pendingWesternCuration)
    || await westernAdultAiService.analyzeVideo({
      taskId,
      config,
      subLib,
      item: liveItem,
      onLog: (level, msg) => appendLog(taskId, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
    });
  scheduler.reportStatus(taskId, 'executing', 75);

  if (await pauseBeforeScrapeWrite(taskId, task, config, subLib, liveItem, { kind: 'western', curation })) return;

  await applyWesternCuration(taskId, task, config, subLib, liveItem, curation);
}

async function applyWesternCuration(taskId, task, config, subLib, liveItem, curation) {
  if (!curation) throw new Error('No pending western curation result to write');
  const mediaLibraryService = require('./mediaLibraryService');
  const applyOpts = {
    taskId,
    onLog: (level, msg) => appendLog(taskId, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
  };
  const latestItem = await adultLibraryService.applyWesternCurationResultToItem(subLib, liveItem, curation, applyOpts);

  // No protagonist named = western scrape failure (same lifecycle as a JAV
  // scrape that can't resolve a 番号). The item keeps its UNK-NNN placeholder
  // and stays unscraped; remediation is rescrape after the user names a face.
  if (!applyOpts.__hasProtagonist) {
    appendLog(taskId, 'warn', 'No protagonist recognized; western scrape failed (UNK retained)');
    adultLibraryService.markScrapeFailed(task.itemId, 'No protagonist recognized by face match; name a face and rescrape');
    const failedItem = mediaLibraryService.getLibraryItem(task.itemId) || latestItem;
    if (failedItem) {
      taskStore.updateTask(taskId, {
        itemInfo: {
          ...(task.itemInfo || {}),
          ...(adultLibraryService.itemInfoFromItem(failedItem) || {}),
        },
      });
    }
    setPhase(taskId, 'failed_hard');
    scheduler.reportStatus(taskId, 'failed_hard', 0);
    return;
  }

  await afterScrapeApplied(taskId, task, config, latestItem, 'Western adult AI metadata saved; optimize targets recalculated');
}

async function afterScrapeApplied(taskId, task, config, latestItem, logMessage) {
  const mediaLibraryService = require('./mediaLibraryService');
  const strategyEngine = require('./strategyEngine');
  try { mediaLibraryService.projectStoredMediaFactsForItem(task.itemId); } catch (_) {}
  try { strategyEngine.runOnce(); } catch (_) {}

  const itemAfterStrategy = mediaLibraryService.getLibraryItem(task.itemId) || latestItem;
  appendLog(taskId, 'info', logMessage);

  const updatedInfo = {
    ...(task.itemInfo || {}),
    ...(itemAfterStrategy ? buildUpdatedItemInfo(itemAfterStrategy) : {}),
  };
  delete updatedInfo.pendingScrapeKind;
  delete updatedInfo.pendingScrapeResult;
  delete updatedInfo.pendingWesternCuration;

  taskStore.updateTask(taskId, {
    itemInfo: updatedInfo,
    resumePoint: null,
    approval: null,
  });

  const latestTask = taskStore.getTask(taskId);
  if (approvalPolicy.requiresConfirmation('scrape.reviewResult', { task: latestTask, itemInfo: updatedInfo, config })) {
    const approval = approvalPolicy.makeApproval('scrape.reviewResult', {
      task: latestTask,
      itemInfo: updatedInfo,
      config,
      message: 'Scrape metadata has been written. Review the result before marking the task done.',
      payload: {
        adultId: updatedInfo.adultMetadata && updatedInfo.adultMetadata.adultId,
        title: updatedInfo.adultMetadata && updatedInfo.adultMetadata.title,
      },
    });
    setPhase(taskId, 'scrape_review');
    scheduler.pauseForConfirm(taskId, 'scrape_review', approval);
    return;
  }

  await finishScrape(taskId);
}

function buildUpdatedItemInfo(item) {
  if (!item) return {};
  if (item.source === 'adult_folder') return adultLibraryService.itemInfoFromItem(item);
  const meta = metadataStatus.resolveMetadataStatus(item, configStore.loadConfig());
  return {
    name: item.name,
    itemId: item.itemId,
    embyItemId: item.sourceId,
    path: item.path,
    subLibraryId: item.subLibraryId,
    assetKey: item.assetKey,
    assetRootPath: item.assetRootPath,
    externalRefs: item.externalRefs,
    resolution: item.resolution,
    bitrate: item.bitrate,
    audioCodecs: item.audioCodecs,
    size: item.size,
    duration: item.duration,
    type: item.type,
    isDiscLike: !!item.isDiscLike,
    doubanRating: item.doubanRating,
    userRating: item.userRating,
    watched: item.watched,
    tmdbId: item.tmdbId,
    providerIds: item.providerIds,
    seriesName: item.seriesName,
    seasonNumber: item.seasonNumber,
    targetBitrate: item.targetBitrate,
    targetCodec: item.targetCodec,
    seedPreferences: item.seedPreferences,
    maxSizeGB: item.maxSizeGB,
    equivalentBitrate: item.equivalentBitrate,
    ...meta,
  };
}

async function finishScrape(taskId) {
  const verification = captureCompletionVerification(taskId);
  if (verification && verification.ok === false) {
    const codes = failureCodes(verification);
    recordScrapeGateFailure(taskId, {
      verification: {
        ...verification,
        source: 'completion_snapshot',
      },
      message: codes.length
        ? `Scrape completion verification failed: ${codes.join(', ')}`
        : 'Scrape completion verification failed',
    });
    return;
  }
  taskStore.updateTask(taskId, { resumePoint: null, approval: null });
  setPhase(taskId, 'done');
  scheduler.reportStatus(taskId, 'done', 100);
}

function captureCompletionVerification(taskId) {
  try {
    const mediaLibraryService = require('./mediaLibraryService');
    const task = taskStore.getTask(taskId);
    if (!task || task.actionType !== 'scrape') return;
    const config = configStore.loadConfig();
    const item = mediaLibraryService.getLibraryItem(task.itemId);
    const subLib = item ? getSubLibrary(config, item.subLibraryId) : null;
    const verification = scrapeVerification.verifyScrapedItem(item, {
      config,
      subLib,
      scrapeTaskId: task.id,
    });
    taskStore.updateTask(taskId, {
      scrapeVerification: {
        ...verification,
        source: 'completion_snapshot',
      },
    });
    return verification;
  } catch (e) {
    const verification = {
      ok: false,
      checkedAt: new Date().toISOString(),
      checks: { 'verification.exception': false },
      failures: [{
        code: 'verification.exception',
        message: `Scrape completion verification failed: ${e.message}`,
      }],
      warnings: [],
      metadataStatus: 'unknown',
      metadataMissingReasons: ['verification.exception'],
      source: 'completion_snapshot',
    };
    taskStore.updateTask(taskId, { scrapeVerification: verification });
    appendLog(taskId, 'warn', `Scrape completion verification snapshot failed: ${e.message}`);
    return verification;
  }
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

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
