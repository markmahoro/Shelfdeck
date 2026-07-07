'use strict';

/**
 * StrategyEngine — legacy module for optimize target projection.
 *
 * Reads the media library store, evaluates each item against the subLibrary's rule
 * template, and writes archive-before target facts for lifecycle objective projection.
 *
 * Decoupled from all data-writing paths. Only reads library + config,
 * only writes optimize target projection fields. It must not make flow/task decisions.
 */

const activityLog = require('./activityLog');
const metadataStatus = require('./metadataStatus');
const lifecycleObjectiveResolver = require('./lifecycleObjectiveResolver');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const backgroundIoGuard = require('./backgroundIoGuard');

const BACKGROUND_IO_LOCK = 'library_background_io';

let timer = null;
let lastRunAt = null;
let lastChanged = 0;
let lastError = null;
let disabledReason = '';

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
  const projection = deriveTargetProjection(item, rule);
  item.reason = rule.reason;
  item.targetMediaFacts = rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object'
    ? { ...rule.targetMediaFacts }
    : undefined;

  const targetProjection = projection.targetProjection || {};

  item.targetBitrate = targetProjection.targetBitrate;
  item.targetCodec = targetProjection.targetCodec;

  item.seedPreferences = targetProjection.seedPreferences;
  item.maxSizeGB = targetProjection.maxSizeGB;

  // predictedSizeGb
  if (targetProjection.targetBitrate && item.duration) {
    item.predictedSizeGb = (targetProjection.targetBitrate * 1_000_000 * item.duration) / (8 * 1024 * 1024 * 1024);
  } else {
    item.predictedSizeGb = undefined;
  }
}

function normalizeCodec(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['h265', 'x265', 'hevc'].includes(raw)) return 'h265';
  if (['h264', 'x264', 'avc', 'avc1'].includes(raw)) return 'h264';
  return raw;
}

function normalizeBucket(value) {
  const raw = String(value || '').trim();
  if (/4k/i.test(raw)) return '4K';
  if (/1080/i.test(raw)) return '1080p';
  if (/720/i.test(raw)) return '720p';
  return raw || '1080p';
}

function bitrateForTarget(target = {}, item = {}) {
  if (typeof target.targetBitrate === 'number') return target.targetBitrate;
  const byBucket = target.targetBitrateByBucket || {};
  const bucket = normalizeBucket(item.bucket || item.resolution);
  const value = byBucket[bucket] || byBucket[normalizeBucket(bucket)] || byBucket['1080p'] || byBucket['4K'];
  return typeof value === 'number' ? value : undefined;
}

function deriveTargetProjection(item = {}, rule = {}) {
  const target = rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object' ? rule.targetMediaFacts : null;
  if (!target) {
    return { targetProjection: {} };
  }
  const targetBitrate = bitrateForTarget(target, item);
  return {
    targetProjection: {
      targetBitrate,
      targetCodec: target.targetCodec || target.codec,
      maxSizeGB: target.maxSizeGB,
      seedPreferences: target.seedPreferences,
    },
  };
}

function clearOptimization(item, reason) {
  const old = {
    reason: item.reason,
    targetBitrate: item.targetBitrate,
    targetCodec: item.targetCodec,
    seedPreferences: JSON.stringify(item.seedPreferences || null),
    maxSizeGB: item.maxSizeGB,
    predictedSizeGb: item.predictedSizeGb,
    targetMediaFacts: JSON.stringify(item.targetMediaFacts || null),
  };
  item.reason = reason || '';
  item.targetBitrate = undefined;
  item.targetCodec = undefined;
  item.seedPreferences = undefined;
  item.maxSizeGB = undefined;
  item.predictedSizeGb = undefined;
  item.targetMediaFacts = undefined;
  return (
    item.reason !== old.reason ||
    item.targetBitrate !== old.targetBitrate ||
    item.targetCodec !== old.targetCodec ||
    JSON.stringify(item.seedPreferences || null) !== old.seedPreferences ||
    item.maxSizeGB !== old.maxSizeGB ||
    item.predictedSizeGb !== old.predictedSizeGb ||
    JSON.stringify(item.targetMediaFacts || null) !== old.targetMediaFacts
  );
}

function projectLifecycleObjective(item, config = {}) {
  const before = JSON.stringify({
    optimizeObjectiveStatus: item.optimizeObjectiveStatus || null,
    optimizeObjective: item.optimizeObjective || null,
    objectiveHash: item.objectiveHash || null,
    objectiveVersion: item.objectiveVersion || null,
    objectiveDerivedFrom: item.objectiveDerivedFrom || null,
    objectiveBlockedReason: item.objectiveBlockedReason || null,
    objectiveMissingPerceptionFacts: item.objectiveMissingPerceptionFacts || null,
  });
  lifecycleObjectiveResolver.applyOptimizeObjectiveProjection(item, { config, ignoreExistingProjection: true });
  const after = JSON.stringify({
    optimizeObjectiveStatus: item.optimizeObjectiveStatus || null,
    optimizeObjective: item.optimizeObjective || null,
    objectiveHash: item.objectiveHash || null,
    objectiveVersion: item.objectiveVersion || null,
    objectiveDerivedFrom: item.objectiveDerivedFrom || null,
    objectiveBlockedReason: item.objectiveBlockedReason || null,
    objectiveMissingPerceptionFacts: item.objectiveMissingPerceptionFacts || null,
  });
  return before !== after;
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
    const changed = clearOptimization(item, `元数据缺失：${meta.metadataMissingReasons.join(', ')}`);
    return projectLifecycleObjective(item, config) || changed;
  }

  if (!template || !template.rules || template.rules.length === 0) {
    const changed = clearOptimization(item, '无策略模板');
    return projectLifecycleObjective(item, config) || changed;
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
    const changed = clearOptimization(item, '策略未覆盖');
    return projectLifecycleObjective(item, config) || changed;
  }

  const oldReason = item.reason;
  const oldTargetBitrate = item.targetBitrate;
  const oldTargetCodec = item.targetCodec;
  const oldSeedPreferences = JSON.stringify(item.seedPreferences || null);
  const oldMaxSizeGB = item.maxSizeGB;
  const oldPredictedSizeGb = item.predictedSizeGb;
  const oldTargetMediaFacts = JSON.stringify(item.targetMediaFacts || null);

  applyRule(item, matched);

  const changed = (
    item.reason !== oldReason ||
    item.targetBitrate !== oldTargetBitrate ||
    item.targetCodec !== oldTargetCodec ||
    JSON.stringify(item.seedPreferences || null) !== oldSeedPreferences ||
    item.maxSizeGB !== oldMaxSizeGB ||
    item.predictedSizeGb !== oldPredictedSizeGb ||
    JSON.stringify(item.targetMediaFacts || null) !== oldTargetMediaFacts
  );
  return projectLifecycleObjective(item, config) || changed;
}

let _configStore = null;
let _mediaLibraryService = null;

function runOnce(options = {}) {
  if (options.background === true) {
    return backgroundIoGuard.runExclusive({
      operation: 'optimize.target_projection.run',
      component: 'strategyEngine',
      lockKey: BACKGROUND_IO_LOCK,
      resourceType: 'background_io',
      resourceKey: 'optimize-targets:run',
      source: 'background',
      payload: { trigger: options.trigger || 'timer' },
    }, () => runOnce({ ...options, background: false }), {
      onSkipped: () => ({ skipped: true, reason: 'background_io_busy' }),
    });
  }

  return runtimeResourceTracker.trackEvent({
    eventType: 'optimize.target_projection.run',
    component: 'strategyEngine',
    resourceType: 'service_cpu',
    resourceKey: 'service:optimize-targets',
    resourceLabel: 'Optimize target projection',
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
        if (item.reason !== '系列条目(非媒体文件)') {
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
      const msg = `优化目标计算完成，${changed} 个条目的归档前目标已更新`;
      console.log(`[strategyEngine] ${msg}`);
      activityLog.addActivity('optimize_target_projection', msg, { changed });
    }

    lastError = null;
    return { changed, itemCount: lib.items.length };
  });
}

function start(configStore, mediaLibraryService) {
  _configStore = configStore;
  _mediaLibraryService = mediaLibraryService;
  disabledReason = '';

  const cfg = configStore.loadConfig();
  const pollMinutes = Number(cfg.strategyPollIntervalMinutes);
  if (Number.isFinite(pollMinutes) && pollMinutes <= 0) {
    disabledReason = 'poll_interval_disabled';
    console.log('[strategyEngine] disabled: strategyPollIntervalMinutes <= 0');
    return;
  }
  const intervalMs = (pollMinutes || 30) * 60 * 1000;

  runOnce({ background: true, trigger: 'startup' });

  timer = setInterval(() => runOnce({ background: true, trigger: 'timer' }), intervalMs);
  timer.unref && timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function getHealth() {
  if (disabledReason) {
    return { status: 'green', disabled: true, disabledReason, lastRunAt, lastChanged };
  }
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
