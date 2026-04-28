'use strict';

/**
 * StrategyEngine — independent periodic strategy calculation.
 *
 * Reads every item from library.json, computes action/reason via
 * mediaPolicyService.recommendedAction(), and writes back.
 * Decoupled from all data-writing paths (EmbyAdapter, DoubanAdapter, ratings).
 */

const mediaPolicyService = require('./mediaPolicyService');
const activityLog = require('./activityLog');

let timer = null;

function start(configStore, mediaLibraryService) {
  const cfg = configStore.loadConfig();
  const intervalMs = (cfg.strategyPollIntervalMinutes || 30) * 60 * 1000;

  const run = () => {
    try {
      const lib = mediaLibraryService.getLibrary();
      if (!lib || !lib.items) return;

      const cfg2 = configStore.loadConfig();
      const subLibs = cfg2.subLibraries || [];
      let changed = 0;

      for (const item of lib.items) {
        const subLib = subLibs.find((s) => s.uuid === item.subLibraryId);
        const policy = (subLib && subLib.mediaPolicy) ? subLib.mediaPolicy : cfg2.mediaPolicy;

        if (!policy) {
          if (item.action !== 'keep' || item.reason !== '无策略配置') {
            item.action = 'keep';
            item.reason = '无策略配置';
            changed++;
          }
          continue;
        }

        const { action, reason } = mediaPolicyService.recommendedAction(item, policy);
        if (item.action !== action || item.reason !== reason) {
          item.action = action;
          item.reason = reason;
          changed++;
        }
      }

      if (changed > 0) {
        mediaLibraryService.saveLibrary(lib);
        const msg = `策略重新计算完成，${changed} 个条目的推荐操作已更新`;
        console.log(`[strategyEngine] ${msg}`);
        activityLog.addActivity('strategy_engine', msg, { changed });
      }
    } catch (e) {
      console.error('[strategyEngine] error:', e.message);
    }
  };

  // Run immediately on startup
  run();

  timer = setInterval(run, intervalMs);
  timer.unref && timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop };
