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

let timer = null;
let lastRunAt = null;
let lastError = null;
let _enabled = false;

function maxTimestamp(a, b) {
  if (!a && !b) return 0;
  if (!a) return new Date(b).getTime();
  if (!b) return new Date(a).getTime();
  return Math.max(new Date(a).getTime(), new Date(b).getTime());
}

function start(configStore, mediaLibraryService, taskStore) {
  const cfg = configStore.loadConfig();
  const intervalMs = (cfg.smartTaskPollIntervalMinutes || 10) * 60 * 1000;

  const run = () => {
    try {
      const cfg2 = configStore.loadConfig();
      _enabled = true; // Enabling is now per-subLibrary via scheduleMode.autoCreate

      const maxPerRun = cfg2.smartTaskMaxPerRun || 10;
      const enabledActions = cfg2.smartTaskEnabledActions || ['transcode', 'upgrade'];
      const lookbackDays = cfg2.smartTaskLookbackDays || 30;

      const lib = mediaLibraryService.getLibrary();
      if (!lib || !lib.items) return;

      const allTasks = taskStore.getTasks();
      const optimizationIndex = optimizationStatus.buildOptimizationIndex(allTasks, cfg2);

      // Count active (non-terminal) tasks per action type
      const activeByType = {};
      const activeItemIds = new Set();
      for (const t of allTasks) {
        if (['done', 'failed_hard', 'deleted'].includes(t.status)) continue;
        activeByType[t.actionType] = (activeByType[t.actionType] || 0) + 1;
        activeItemIds.add(t.itemId);
      }

      // Per-type limit = concurrency slots × 5
      const limits = {
        delete: (cfg2.deleteConcurrency || 3) * 5,
        transcode: (cfg2.transcodeConcurrency || 2) * 5,
        upgrade: (cfg2.upgradeConcurrency || 1) * 5,
      };

      const now = Date.now();
      const lookbackCutoff = now - lookbackDays * 86400000;
      const isFirstOrResume = !lastRunAt || (now - lastRunAt > intervalMs * 2);

      const candidates = lib.items.filter((item) => {
        if (item.source !== 'emby') return false;
        if (item.type === 'series') return false;
        if (!item.watched) return false;
        if (!item.action || item.action === 'keep') return false;
        if (!enabledActions.includes(item.action)) return false;
        if (item.reason === '新入库') return false;
        if (activeItemIds.has(item.itemId)) return false;

        // Per-subLibrary autoCreate check
        const subLibSchedule = configStore.resolveSubLibSchedule(item, cfg2);
        if (!subLibSchedule.autoCreate) return false;

        // 48h freeze after task completion — wait for Emby to refresh metadata
        if (item.lastTaskDoneAt) {
          const freezeUntil = new Date(item.lastTaskDoneAt).getTime() + 48 * 3600 * 1000;
          if (now < freezeUntil) return false;
        }

        // Permanent anti-re-transcode: once transcoded, never auto-create again.
        // Manual trigger (POST /v1/tasks) bypasses this — only affects auto-enqueue.
        // The task/path lookup covers Emby itemId changes after disc-folder → MKV replacement.
        const opt = optimizationStatus.resolveOptimization(item, optimizationIndex, cfg2);
        if (item.action === 'transcode' && opt.optimizationStatus === 'transcoded') return false;

        // Lookback window for first/resume run
        if (isFirstOrResume) {
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

        // Check per-action-type queue limit
        const cur = activeByType[item.action] || 0;
        const lim = limits[item.action] || 50;
        if (cur >= lim) continue;

        const subLibSchedule2 = configStore.resolveSubLibSchedule(item, cfg2);
        const status = subLibSchedule2.autoExecute ? 'queued' : 'pending_manual';
        taskStore.createTask({
          itemId: item.itemId,
          itemName: item.name,
          actionType: item.action,

          status,
          itemInfo: {
            name: item.name,
            path: item.path,
            subLibraryId: item.subLibraryId,
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
          },
          logs: [{
            ts: new Date().toISOString(),
            source: 'smart_task_engine',
            action: 'auto_enqueued',
          }],
        });
        console.log(`[smartTaskEngine] auto-enqueue ${item.itemId} ${item.action} "${item.name}"`);
        toEnqueue.push(item);
        activeByType[item.action] = (activeByType[item.action] || 0) + 1;
      }

      if (toEnqueue.length > 0) {
        const byAction = {};
        for (const item of toEnqueue) {
          byAction[item.action] = (byAction[item.action] || 0) + 1;
        }
        const parts = Object.entries(byAction).map(([a, n]) => {
          const label = a === 'transcode' ? '码率压缩' : a === 'upgrade' ? '洗版' : a === 'delete' ? '删除' : a;
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

  // Short delay to let StrategyEngine complete its first pass (runs synchronously on startup)
  console.log(`[smartTaskEngine] will run first scan in 5s, then every ${intervalMs / 60000}min`);
  setTimeout(() => {
    run();
    timer = setInterval(run, intervalMs);
    timer.unref && timer.unref();
  }, 5000);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, getHealth };

function getHealth() {
  if (!_enabled) {
    return { status: 'green', enabled: false, lastRunAt: null };
  }
  if (!timer) {
    return { status: 'red', enabled: true, lastRunAt };
  }
  if (!lastRunAt) {
    return { status: 'yellow', enabled: true, lastRunAt: null };
  }
  return { status: 'green', enabled: true, lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null };
}
