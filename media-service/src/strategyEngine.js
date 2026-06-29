'use strict';

/**
 * StrategyEngine — rule-based strategy evaluation.
 *
 * Reads the media library store, evaluates each item against the subLibrary's rule
 * template, and writes action/reason/targetBitrate/targetCodec/predictedSizeGb.
 *
 * Decoupled from all data-writing paths. Only reads library + config,
 * only writes strategy fields.
 */

const activityLog = require('./activityLog');
const metadataStatus = require('./metadataStatus');
const runtimeResourceTracker = require('./runtimeResourceTracker');

let timer = null;
let lastRunAt = null;
let lastChanged = 0;
let lastError = null;

// ── Condition evaluation ───────────────────────────────────────────────────────

const OPERATORS = {
  '>':       (a, b) => typeof a === 'number' && a > b,
  '>=':      (a, b) => typeof a === 'number' && a >= b,
  '<':       (a, b) => typeof a === 'number' && a < b,
  '<=':      (a, b) => typeof a === 'number' && a <= b,
  '=':       (a, b) => a === b,
  'in':      (a, b) => Array.isArray(b) && b.includes(a),
  'not in':  (a, b) => Array.isArray(b) && !b.includes(a),
  'overlap': (a, b) => Array.isArray(a) && Array.isArray(b) && a.some((v) => b.includes(v)),
};

function conditionTrue(item, cond) {
  const [field, op, value] = cond;
  const itemVal = item[field];
  const fn = OPERATORS[op];
  if (!fn) return false;
  // null compared as number is always false (except strict equality to null)
  if (itemVal == null && op !== '=') return false;
  return fn(itemVal, value);
}

function groupTrue(item, group) {
  if (!group) return true;
  // Support both old format (array of conditions) and new format ({ connector, conditions })
  const conditions = Array.isArray(group) ? group : (group.conditions || []);
  const connector = Array.isArray(group) ? 'and' : (group.connector || 'and');
  if (conditions.length === 0) return true;

  for (const cond of conditions) {
    const ok = conditionTrue(item, cond);
    if (connector === 'and' && !ok) return false;
    if (connector === 'or' && ok) return true;
  }
  return connector === 'and';
}

function ruleMatches(item, rule) {
  const groups = rule.groups || [];
  if (groups.length === 0) return true; // catch-all

  // Support both old format (innerConnector) and new format (groupsConnector)
  // Old: innerConnector controls within-group, between-group is opposite
  // New: groupsConnector controls between-group, each group has its own connector
  const isNewFormat = groups.length > 0 && !Array.isArray(groups[0]);
  const outerConn = isNewFormat
    ? (rule.groupsConnector || 'and')
    : (rule.innerConnector === 'and' ? 'or' : 'and');

  for (const group of groups) {
    const ok = groupTrue(item, group);
    if (outerConn === 'or' && ok) return true;
    if (outerConn === 'and' && !ok) return false;
  }
  return outerConn === 'and';
}

// ── Result computation ─────────────────────────────────────────────────────────

function applyRule(item, rule) {
  item.action = rule.action;
  item.reason = rule.reason;

  const params = rule.actionParams || {};

  if (rule.action === 'transcode' || rule.action === 'upgrade') {
    item.targetBitrate = params.targetBitrate;
    item.targetCodec = params.targetCodec;
  } else {
    item.targetBitrate = undefined;
    item.targetCodec = undefined;
  }

  if (rule.action === 'upgrade') {
    item.seedPreferences = params.seedPreferences || {};
    item.maxSizeGB = params.maxSizeGB;
  } else {
    item.seedPreferences = undefined;
    item.maxSizeGB = undefined;
  }

  // predictedSizeGb
  if ((rule.action === 'transcode' || rule.action === 'upgrade') && params.targetBitrate && item.duration) {
    item.predictedSizeGb = (params.targetBitrate * 1_000_000 * item.duration) / (8 * 1024 * 1024 * 1024);
  } else if (rule.action === 'keep' && item.size) {
    item.predictedSizeGb = item.size / (1024 * 1024 * 1024);
  } else if (rule.action === 'delete') {
    item.predictedSizeGb = undefined;
  } else {
    item.predictedSizeGb = undefined;
  }
}

function clearOptimization(item, reason) {
  const old = {
    action: item.action,
    reason: item.reason,
    targetBitrate: item.targetBitrate,
    targetCodec: item.targetCodec,
    seedPreferences: JSON.stringify(item.seedPreferences || null),
    maxSizeGB: item.maxSizeGB,
    predictedSizeGb: item.predictedSizeGb,
  };
  item.action = '';
  item.reason = reason || '';
  item.targetBitrate = undefined;
  item.targetCodec = undefined;
  item.seedPreferences = undefined;
  item.maxSizeGB = undefined;
  item.predictedSizeGb = undefined;
  return (
    item.action !== old.action ||
    item.reason !== old.reason ||
    item.targetBitrate !== old.targetBitrate ||
    item.targetCodec !== old.targetCodec ||
    JSON.stringify(item.seedPreferences || null) !== old.seedPreferences ||
    item.maxSizeGB !== old.maxSizeGB ||
    item.predictedSizeGb !== old.predictedSizeGb
  );
}

// ── Engine ─────────────────────────────────────────────────────────────────────

function evaluateItem(item, templates, subLibs, config = {}) {
  const subLib = subLibs.find((s) => s.uuid === item.subLibraryId);
  const tplId = (subLib && subLib.ruleTemplateId) || 'default';
  const template = (templates || []).find((t) => t.id === tplId);
  const meta = metadataStatus.resolveMetadataStatus(item, config);

  item.metadataStatus = meta.metadataStatus;
  item.metadataComplete = meta.metadataComplete;
  item.metadataMissingReasons = meta.metadataMissingReasons;
  item.metadataKind = meta.metadataKind;

  if (!meta.metadataComplete) {
    return clearOptimization(item, `元数据缺失：${meta.metadataMissingReasons.join(', ')}`);
  }

  if (!template || !template.rules || template.rules.length === 0) {
    return clearOptimization(item, '无策略模板');
  }

  // Sort rules by priority ascending (P1 → P10), evaluate, last match wins
  const sorted = [...template.rules].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  let matched = null;
  for (const rule of sorted) {
    if (ruleMatches(item, rule)) {
      matched = rule;
    }
  }

  if (!matched) {
    return clearOptimization(item, '策略未覆盖');
  }

  const oldAction = item.action;
  const oldReason = item.reason;
  const oldTargetBitrate = item.targetBitrate;
  const oldTargetCodec = item.targetCodec;
  const oldSeedPreferences = JSON.stringify(item.seedPreferences || null);
  const oldMaxSizeGB = item.maxSizeGB;
  const oldPredictedSizeGb = item.predictedSizeGb;

  applyRule(item, matched);

  return (
    item.action !== oldAction ||
    item.reason !== oldReason ||
    item.targetBitrate !== oldTargetBitrate ||
    item.targetCodec !== oldTargetCodec ||
    JSON.stringify(item.seedPreferences || null) !== oldSeedPreferences ||
    item.maxSizeGB !== oldMaxSizeGB ||
    item.predictedSizeGb !== oldPredictedSizeGb
  );
}

let _configStore = null;
let _mediaLibraryService = null;

function runOnce() {
  return runtimeResourceTracker.trackEvent({
    eventType: 'strategy.run',
    component: 'strategyEngine',
    resourceType: 'service_cpu',
    resourceKey: 'service:strategy',
    resourceLabel: 'Strategy engine',
    successPayload: (result) => result,
  }, () => {
    const lib = _mediaLibraryService.getLibrary();
    if (!lib || !lib.items) return { changed: 0, itemCount: 0 };

    const cfg = _configStore.loadConfig();
    const templates = cfg.ruleTemplates || [];
    const subLibs = cfg.subLibraries || [];
    let changed = 0;
    const changedItems = [];

    for (const item of lib.items) {
      if (item.type === 'series') {
        // Series items are rating anchors only — never produce tasks
        if (item.action !== 'keep' || item.reason !== '系列条目(非媒体文件)') {
          item.action = 'keep';
          item.reason = '系列条目(非媒体文件)';
          item.targetBitrate = undefined;
          item.targetCodec = undefined;
          item.seedPreferences = undefined;
          item.predictedSizeGb = undefined;
          changed++;
          changedItems.push(item);
        }
        continue;
      }
      if (evaluateItem(item, templates, subLibs, cfg)) {
        changed++;
        changedItems.push(item);
      }
    }

    lastChanged = changed;
    lastRunAt = Date.now();

    if (changed > 0) {
      if (typeof _mediaLibraryService.updateLibraryItems === 'function') {
        _mediaLibraryService.updateLibraryItems(changedItems);
      } else {
        _mediaLibraryService.saveLibrary(lib);
      }
      const msg = `策略重新计算完成，${changed} 个条目的推荐操作已更新`;
      console.log(`[strategyEngine] ${msg}`);
      activityLog.addActivity('strategy_engine', msg, { changed });
    }

    lastError = null;
    return { changed, itemCount: lib.items.length };
  });
}

function start(configStore, mediaLibraryService) {
  _configStore = configStore;
  _mediaLibraryService = mediaLibraryService;

  const cfg = configStore.loadConfig();
  const intervalMs = (cfg.strategyPollIntervalMinutes || 30) * 60 * 1000;

  runOnce();

  timer = setInterval(runOnce, intervalMs);
  timer.unref && timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function getHealth() {
  if (!timer) {
    return { status: 'red', lastRunAt: null, lastChanged: null };
  }
  if (!lastRunAt) {
    return { status: 'yellow', lastRunAt: null, lastChanged: null };
  }
  return {
    status: 'green',
    lastRunAt: new Date(lastRunAt).toISOString(),
    lastChanged,
  };
}

module.exports = { start, stop, runOnce, getHealth, ruleMatches, conditionTrue };
