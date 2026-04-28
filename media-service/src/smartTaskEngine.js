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

let timer = null;
let lastRunAt = null;

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
      if (!cfg2.wallRatingAutoEnqueue) {
        if (!lastRunAt) {
          const msg = '智能入队未启用，请在系统设置中开启 wallRatingAutoEnqueue';
          console.log(`[smartTaskEngine] ${msg}`);
          activityLog.addActivity('smart_task_engine', msg);
        }
        return;
      }

      const maxPerRun = cfg2.smartTaskMaxPerRun || 10;
      const enabledActions = cfg2.smartTaskEnabledActions || ['transcode', 'upgrade'];
      const lookbackDays = cfg2.smartTaskLookbackDays || 30;

      const lib = mediaLibraryService.getLibrary();
      if (!lib || !lib.items) return;

      const allTasks = taskStore.getTasks();
      const activeItemIds = new Set(
        allTasks
          .filter((t) => !['done', 'failed_hard', 'deleted'].includes(t.status))
          .map((t) => t.itemId)
      );

      const now = Date.now();
      const lookbackCutoff = now - lookbackDays * 86400000;
      const isFirstOrResume = !lastRunAt || (now - lastRunAt > intervalMs * 2);

      const candidates = lib.items.filter((item) => {
        if (item.source !== 'emby') return false;
        if (!item.watched) return false;
        if (item.userRating == null && item.doubanRating == null) return false;
        if (!item.action || item.action === 'keep') return false;
        if (!enabledActions.includes(item.action)) return false;
        if (item.reason === '新入库') return false;
        if (activeItemIds.has(item.itemId)) return false;

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

      const toEnqueue = candidates.slice(0, maxPerRun);

      for (const item of toEnqueue) {
        const status = cfg2.executionMode === 'manual' ? 'pending_manual' : 'queued';
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
            type: item.type,
            doubanRating: item.doubanRating,
            userRating: item.userRating,
          },
          logs: [{
            ts: new Date().toISOString(),
            source: 'smart_task_engine',
            action: 'auto_enqueued',
          }],
        });
        console.log(`[smartTaskEngine] auto-enqueue ${item.itemId} ${item.action} "${item.name}"`);
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

module.exports = { start, stop };
