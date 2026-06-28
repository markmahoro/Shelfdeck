'use strict';

/**
 * SmartTaskEngine — independent periodic auto-enqueue engine.
 *
 * Scans library.json for items that are watched, rated, and have a
 * recommended action (transcode/upgrade/delete), then creates tasks
 * that feed into TaskScheduler.
 * Decoupled from StrategyEngine — only reads action/reason, never writes them.
 */

const activityLog = require('./activityLog');
const optimizationStatus = require('./optimizationStatus');
const assetIdentity = require('./assetIdentity');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');

let timer = null;
let initialTimer = null;
let lastRunAt = null;
let lastError = null;
let _enabled = false;
let configReader = null;
let lastEnabledActions = [];

function readEnabledActions(config) {
  return Array.isArray(config.smartTaskEnabledActions)
    ? config.smartTaskEnabledActions
    : ['transcode', 'upgrade'];
}

function maxTimestamp(a, b) {
  if (!a && !b) return 0;
  if (!a) return new Date(b).getTime();
  if (!b) return new Date(a).getTime();
  return Math.max(new Date(a).getTime(), new Date(b).getTime());
}

function start(configStore, mediaLibraryService, taskStore) {
  configReader = configStore;
  const cfg = configStore.loadConfig();
  lastEnabledActions = readEnabledActions(cfg);
  const intervalMs = (cfg.smartTaskPollIntervalMinutes || 10) * 60 * 1000;

  const run = () => {
    try {
      const cfg2 = configStore.loadConfig();
      const enabledActions = readEnabledActions(cfg2);
      lastEnabledActions = enabledActions;
      _enabled = enabledActions.length > 0;
      if (enabledActions.length === 0) {
        lastRunAt = Date.now();
        return;
      }

      const maxPerRun = cfg2.smartTaskMaxPerRun || 10;
      const lookbackDays = cfg2.smartTaskLookbackDays || 30;

      const lib = mediaLibraryService.getLibrary();
      if (!lib || !lib.items) return;

      const allTasks = taskStore.getTasks();
      const activeTasks = taskStore.loadTasks({ includeHistory: false });
      const optimizationIndex = optimizationStatus.buildOptimizationIndex(allTasks, cfg2);

      // Count active (non-terminal) tasks per action type
      const activeByType = {};
      for (const t of activeTasks) {
        activeByType[t.actionType] = (activeByType[t.actionType] || 0) + 1;
      }

      // Per-type queue cap: how many non-terminal tasks of a given type may be
      // in the queue at once. This decouples queue depth from concurrency slots
      // (previously concurrency×5, which kept the queue nearly empty) so a real
      // backlog forms and PriorityEngine ordering becomes meaningful.
      const maxQueueSize = Number(cfg2.smartTaskMaxQueueSize) > 0 ? Number(cfg2.smartTaskMaxQueueSize) : 50;
      const queueCap = {
        delete: maxQueueSize,
        transcode: maxQueueSize,
        upgrade: maxQueueSize,
        scrape: maxQueueSize,
      };

      const now = Date.now();
      const lookbackCutoff = now - lookbackDays * 86400000;
      const isFirstOrResume = !lastRunAt || (now - lastRunAt > intervalMs * 2);

      const candidates = lib.items.filter((item) => {
        const isAdultFolder = item.source === 'adult_folder';
        if (item.source !== 'emby' && !isAdultFolder) return false;
        if (item.type === 'series') return false;
        if (!item.watched) return false;
        if (!item.action || item.action === 'keep') return false;
        if (!enabledActions.includes(item.action)) return false;
        if (item.reason === '新入库') return false;

        // Lookback window for first/resume run
        if (isFirstOrResume && !isAdultFolder) {
          const ratingTs = maxTimestamp(item.userRatingUpdatedAt, item.doubanRatingUpdatedAt);
          if (ratingTs < lookbackCutoff) return false;
        }

        return true;
      });

      // Sort by rating available time DESC (most recent first)
      candidates.sort((a, b) => {
        return maxTimestamp(b.userRatingUpdatedAt, b.doubanRatingUpdatedAt)
             - maxTimestamp(a.userRatingUpdatedAt, a.doubanRatingUpdatedAt);
      });

      const toEnqueue = [];
      for (const item of candidates) {
        if (toEnqueue.length >= maxPerRun) break;

        // Per-action-type queue depth cap. Skip this type once the backlog is
        // full so one action doesn't starve others.
        const cur = activeByType[item.action] || 0;
        const cap = queueCap[item.action] || maxQueueSize;
        if (cur >= cap) continue;

        const subLibSchedule2 = configStore.resolveSubLibSchedule(item, cfg2);
        const status = subLibSchedule2.autoExecute ? 'queued' : 'pending_manual';

        // Compute initial priority via PriorityEngine (manual base for the
        // manual trigger path; auto base + library weight + rules here).
        const itemInfo = {
          name: item.name,
          itemId: item.itemId,
          embyItemId: assetIdentity.getEmbyItemId(item),
          path: item.path,
          subLibraryId: item.subLibraryId,
          assetKey: item.assetKey,
          assetRootPath: item.assetRootPath,
          externalRefs: item.externalRefs,
          resolution: item.resolution,
          bitrate: item.bitrate,
          size: item.size,
          duration: item.duration,
          type: item.type,
          isDiscLike: !!item.isDiscLike,
          doubanRating: item.doubanRating,
          userRating: item.userRating,
          tmdbId: item.tmdbId,
          seriesName: item.seriesName,
          seasonNumber: item.seasonNumber,
          targetBitrate: item.targetBitrate,
          targetCodec: item.targetCodec,
          seedPreferences: item.seedPreferences,
          maxSizeGB: item.maxSizeGB,
          equivalentBitrate: item.equivalentBitrate,
          scraped: !!item.scraped,
          adultMetadata: item.adultMetadata,
        };

        const admission = taskAdmission.canCreateTask({
          item,
          itemInfo,
          actionType: item.action,
          source: 'auto',
          config: cfg2,
          tasks: allTasks,
          optimizationIndex,
        });
        if (!admission.allowed) continue;
        activeByType[item.action] = cur + 1;

        const priority = priorityEngine.computePriority({
          source: 'auto',
          actionType: item.action,
          itemInfo,
          config: cfg2,
        });

        const task = taskStore.createTask({
          itemId: item.itemId,
          itemName: item.name,
          actionType: item.action,
          status,
          priority,
          itemInfo,
          logs: [{
            ts: new Date().toISOString(),
            source: 'smart_task_engine',
            action: 'auto_enqueued',
          }],
        });
        allTasks.push(task);
        console.log(`[smartTaskEngine] auto-enqueue ${item.itemId} ${item.action} "${item.name}"`);
        toEnqueue.push(item);
      }

      if (toEnqueue.length > 0) {
        const byAction = {};
        for (const item of toEnqueue) {
          byAction[item.action] = (byAction[item.action] || 0) + 1;
        }
        const parts = Object.entries(byAction).map(([a, n]) => {
          const label = a === 'transcode' ? '转码压缩' : a === 'upgrade' ? '洗版' : a === 'delete' ? '删除' : a;
          return `${label} ${n} 个`;
        });
        const msg = `智能入队：${toEnqueue.length} 个任务已自动创建（${parts.join('，')}）`;
        console.log(`[smartTaskEngine] ${msg} (${candidates.length} candidates total)`);
        activityLog.addActivity('smart_task_engine', msg, { enqueued: toEnqueue.length, byAction, totalCandidates: candidates.length });
      }

      lastRunAt = now;
    } catch (e) {
      lastError = e.message;
      console.error('[smartTaskEngine] error:', e.message);
    }
  };

  const initialDelaySeconds = Math.max(0, Number(cfg.smartTaskInitialDelaySeconds) || 0);
  console.log(`[smartTaskEngine] will run first scan in ${initialDelaySeconds}s, then every ${intervalMs / 60000}min`);
  initialTimer = setTimeout(() => {
    initialTimer = null;
    run();
    timer = setInterval(run, intervalMs);
    timer.unref && timer.unref();
  }, initialDelaySeconds * 1000);
  initialTimer.unref && initialTimer.unref();
}

function stop() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, getHealth };

function getHealth() {
  let enabledActions = lastEnabledActions;
  if (configReader) {
    try {
      enabledActions = readEnabledActions(configReader.loadConfig());
    } catch (_) {}
  }
  if (enabledActions.length === 0) {
    return {
      status: 'yellow',
      enabled: false,
      enabledActions,
      disabledReason: 'no_enabled_actions',
      message: '自动入队未选择任务类型',
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    };
  }
  if (!_enabled) {
    return { status: 'green', enabled: true, enabledActions, lastRunAt: null };
  }
  if (!timer) {
    return { status: 'red', enabled: true, enabledActions, lastRunAt };
  }
  if (!lastRunAt) {
    return { status: 'yellow', enabled: true, enabledActions, lastRunAt: null };
  }
  return { status: 'green', enabled: true, enabledActions, lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null };
}
