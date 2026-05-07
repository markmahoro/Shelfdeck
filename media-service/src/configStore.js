'use strict';

const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function configFilePath() {
  return path.join(resolveDataDir(), 'config.json');
}

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Default rule template builder ──────────────────────────────────────────────

function buildDefaultTemplate(policy) {
  const t1080 = (policy && policy.target1080p) || {};
  const t4k = (policy && policy.target4k) || {};

  function ratingGroup(val) {
    return { connector: 'or', conditions: [['doubanRating', '=', val], ['userRating', '=', val]] };
  }
  function ratingGroupIn(vals) {
    return { connector: 'or', conditions: [['doubanRating', 'in', vals], ['userRating', 'in', vals]] };
  }
  function condGroup(conds) {
    return { connector: 'and', conditions: conds };
  }

  function transcodeRule(priority, rating, bucket, threshold, targetBitrate) {
    return {
      priority,
      groupsConnector: 'and',
      groups: [
        ratingGroup(rating),
        condGroup([['bucket', '=', bucket], ['equivalentBitrate', '>', threshold]]),
      ],
      action: 'transcode',
      actionParams: { targetBitrate, targetCodec: 'h265' },
      reason: `${rating}★ ${bucket} 码率 ${threshold} Mbps 超标，建议压缩`,
    };
  }

  const rules = [];

  // P10: no rating → keep
  rules.push({
    priority: 10,
    groupsConnector: 'and',
    groups: [condGroup([['doubanRating', '=', null], ['userRating', '=', null]])],
    action: 'keep',
    actionParams: {},
    reason: '无评分',
  });

  // P9: 1-2★ → delete
  rules.push({
    priority: 9,
    groupsConnector: 'and',
    groups: [ratingGroupIn([1, 2])],
    action: 'delete',
    actionParams: {},
    reason: '低分删除',
  });

  // P8: 5★ + 4K H.265 high-bitrate + high-quality audio → keep (already optimal)
  rules.push({
    priority: 8,
    groupsConnector: 'and',
    groups: [
      ratingGroup(5),
      condGroup([
        ['bucket', '=', '4K'],
        ['codec', 'in', ['h265', 'hevc']],
        ['equivalentBitrate', '>=', 20],
        ['audioCodecs', 'overlap', ['dts', 'truehd', 'atmos']],
      ]),
    ],
    action: 'keep',
    actionParams: {},
    reason: '5★ 已是4K H.265 高码率 + 高品质音轨，无需洗版',
  });

  // P7: 5★ → upgrade
  rules.push({
    priority: 7,
    groupsConnector: 'and',
    groups: [ratingGroup(5)],
    action: 'upgrade',
    actionParams: {
      targetBitrate: 25,
      targetCodec: 'h265',
      maxSizeGB: 38,
      seedPreferences: {
        resolutionPreference: ['4K'],
        codecPreference: ['h265', 'dv'],
        audioPreference: ['DTS', 'TrueHD', 'Atmos'],
        preferCNSub: true,
      },
    },
    reason: '5★ 洗版至4K高码率优质音轨',
  });

  // P6: isDiscLike → keep
  rules.push({
    priority: 6,
    groupsConnector: 'and',
    groups: [condGroup([['isDiscLike', '=', true]])],
    action: 'keep',
    actionParams: {},
    reason: '原盘不处理',
  });

  // P5: 3-4★ + modern codec + bitrate already within target → keep (already optimal)
  function modernKeepRule(priority, rating, bucket, threshold) {
    return {
      priority,
      groupsConnector: 'and',
      groups: [
        ratingGroup(rating),
        condGroup([['bucket', '=', bucket], ['codec', 'in', ['h265', 'hevc', 'av1']], ['equivalentBitrate', '<=', threshold]]),
      ],
      action: 'keep',
      actionParams: {},
      reason: `${rating}★ ${bucket} 现代编码且码率≤${threshold}M，已达标`,
    };
  }
  if (t1080[3]) rules.push(modernKeepRule(5, 3, '1080p', t1080[3]));
  if (t4k[3]) rules.push(modernKeepRule(5, 3, '4K', t4k[3]));
  if (t1080[4]) rules.push(modernKeepRule(5, 4, '1080p', t1080[4]));
  if (t4k[4]) rules.push(modernKeepRule(5, 4, '4K', t4k[4]));

  // P4: 3★ needs transcode (unless already optimal)
  if (t1080[3]) rules.push(transcodeRule(4, 3, '1080p', t1080[3], t1080[3]));
  if (t4k[3]) rules.push(transcodeRule(4, 3, '4K', t4k[3], t4k[3]));

  // P3: 4★ needs transcode (unless already optimal)
  if (t1080[4]) rules.push(transcodeRule(3, 4, '1080p', t1080[4], t1080[4]));
  if (t4k[4]) rules.push(transcodeRule(3, 4, '4K', t4k[4], t4k[4]));

  // P1: catch-all → keep
  rules.push({
    priority: 1,
    groupsConnector: 'and',
    groups: [],
    action: 'keep',
    actionParams: {},
    reason: '策略未覆盖',
  });

  return {
    id: 'default',
    name: '默认策略（电影）',
    description: '依据用户喜好智能生成策略',
    rules,
  };
}

function buildTVDefaultTemplate(policy) {
  const t1080 = (policy && policy.target1080p) || {};
  const t4k = (policy && policy.target4k) || {};

  function ratingGroup(val) {
    return { connector: 'or', conditions: [['doubanRating', '=', val], ['userRating', '=', val]] };
  }
  function ratingGroupIn(vals) {
    return { connector: 'or', conditions: [['doubanRating', 'in', vals], ['userRating', 'in', vals]] };
  }
  function condGroup(conds) {
    return { connector: 'and', conditions: conds };
  }

  function transcodeRule(priority, rating, bucket, threshold, targetBitrate) {
    return {
      priority,
      groupsConnector: 'and',
      groups: [
        ratingGroup(rating),
        condGroup([['bucket', '=', bucket], ['equivalentBitrate', '>', threshold]]),
      ],
      action: 'transcode',
      actionParams: { targetBitrate, targetCodec: 'h265' },
      reason: `${rating}★ ${bucket} 码率 ${threshold} Mbps 超标，建议压缩`,
    };
  }

  const rules = [];

  // P10: no rating → keep
  rules.push({
    priority: 10,
    groupsConnector: 'and',
    groups: [condGroup([['doubanRating', '=', null], ['userRating', '=', null]])],
    action: 'keep',
    actionParams: {},
    reason: '无评分',
  });

  // P9: 1-2★ → delete
  rules.push({
    priority: 9,
    groupsConnector: 'and',
    groups: [ratingGroupIn([1, 2])],
    action: 'delete',
    actionParams: {},
    reason: '低分删除',
  });

  // P8: 5★ + 4K H.265 high-bitrate + high-quality audio → keep (already optimal)
  rules.push({
    priority: 8,
    groupsConnector: 'and',
    groups: [
      ratingGroup(5),
      condGroup([
        ['bucket', '=', '4K'],
        ['codec', 'in', ['h265', 'hevc']],
        ['equivalentBitrate', '>=', 15],
        ['audioCodecs', 'overlap', ['dts', 'truehd', 'atmos']],
      ]),
    ],
    action: 'keep',
    actionParams: {},
    reason: '5★ 已是4K H.265 高码率 + 高品质音轨，无需洗版',
  });

  // P7: 5★ → upgrade (TV: lower bitrate target, season packs average lower Mbps)
  rules.push({
    priority: 7,
    groupsConnector: 'and',
    groups: [ratingGroup(5)],
    action: 'upgrade',
    actionParams: {
      targetBitrate: 15,
      targetCodec: 'h265',
      maxSizeGB: 50,
      seedPreferences: {
        resolutionPreference: ['4K'],
        codecPreference: ['h265', 'dv'],
        audioPreference: ['DTS', 'TrueHD', 'Atmos'],
        preferCNSub: true,
      },
    },
    reason: '5★ 洗版至4K高码率优质音轨',
  });

  // P6: isDiscLike → keep
  rules.push({
    priority: 6,
    groupsConnector: 'and',
    groups: [condGroup([['isDiscLike', '=', true]])],
    action: 'keep',
    actionParams: {},
    reason: '原盘不处理',
  });

  // P5: 3-4★ + modern codec + bitrate already within target → keep (already optimal)
  function modernKeepRule(priority, rating, bucket, threshold) {
    return {
      priority,
      groupsConnector: 'and',
      groups: [
        ratingGroup(rating),
        condGroup([['bucket', '=', bucket], ['codec', 'in', ['h265', 'hevc', 'av1']], ['equivalentBitrate', '<=', threshold]]),
      ],
      action: 'keep',
      actionParams: {},
      reason: `${rating}★ ${bucket} 现代编码且码率≤${threshold}M，已达标`,
    };
  }
  if (t1080[3]) rules.push(modernKeepRule(5, 3, '1080p', t1080[3]));
  if (t4k[3]) rules.push(modernKeepRule(5, 3, '4K', t4k[3]));
  if (t1080[4]) rules.push(modernKeepRule(5, 4, '1080p', t1080[4]));
  if (t4k[4]) rules.push(modernKeepRule(5, 4, '4K', t4k[4]));

  // P4: 3★ needs transcode (unless already optimal)
  if (t1080[3]) rules.push(transcodeRule(4, 3, '1080p', t1080[3], t1080[3]));
  if (t4k[3]) rules.push(transcodeRule(4, 3, '4K', t4k[3], t4k[3]));

  // P3: 4★ needs transcode (unless already optimal)
  if (t1080[4]) rules.push(transcodeRule(3, 4, '1080p', t1080[4], t1080[4]));
  if (t4k[4]) rules.push(transcodeRule(3, 4, '4K', t4k[4], t4k[4]));

  // P1: catch-all → keep
  rules.push({
    priority: 1,
    groupsConnector: 'and',
    groups: [],
    action: 'keep',
    actionParams: {},
    reason: '策略未覆盖',
  });

  return {
    id: 'tv_default',
    name: '默认策略（剧集）',
    description: '剧集类码率阈值整体低于电影一档',
    rules,
  };
}

// ── SubLibrary scheduling defaults ─────────────────────────────────────────────

function defaultSubLibSchedule() {
  return {
    scheduleMode: 'full_auto',
    autoCreate: true,
    autoExecute: true,
    autoReplaceTranscode: false,
    autoReplaceUpgrade: false,
    smartSelectEnabled: false,
  };
}

function resolveSubLibSchedule(itemInfo, config) {
  const subLibId = itemInfo && itemInfo.subLibraryId;
  const subLib = subLibId && (config.subLibraries || []).find((s) => s.uuid === subLibId);
  const mode = (subLib && subLib.scheduleMode) || 'full_manual';

  if (mode === 'full_auto') {
    return { autoCreate: true, autoExecute: true, autoReplaceTranscode: true, autoReplaceUpgrade: true, smartSelectEnabled: true };
  }
  if (mode === 'full_manual') {
    return { autoCreate: false, autoExecute: false, autoReplaceTranscode: false, autoReplaceUpgrade: false, smartSelectEnabled: false };
  }
  // custom
  return {
    autoCreate: !!(subLib && subLib.autoCreate),
    autoExecute: !!(subLib && subLib.autoExecute),
    autoReplaceTranscode: !!(subLib && subLib.autoReplaceTranscode),
    autoReplaceUpgrade: !!(subLib && subLib.autoReplaceUpgrade),
    smartSelectEnabled: !!(subLib && subLib.smartSelectEnabled),
  };
}

// ── Config persistence ─────────────────────────────────────────────────────────

function getDefaultConfig() {
  const moviePolicy = {
    target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
    target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
  };
  const tvPolicy = {
    target1080p: { '2': 1.5, '3': 3, '4': 5, '5': 8 },
    target4k: { '2': 3, '3': 7, '4': 12, '5': 18 },
  };

  return {
    // TaskScheduler
    executionMode: 'auto',
    deleteConcurrency: 1,
    transcodeConcurrency: 1,
    upgradeConcurrency: 1,
    wallRatingAutoEnqueue: false,

    // SmartTaskEngine
    smartTaskPollIntervalMinutes: 10,
    smartTaskMaxPerRun: 10,
    smartTaskMaxQueueSize: 50,
    smartTaskEnabledActions: ['transcode', 'upgrade'],
    smartTaskLookbackDays: 30,

    // StrategyEngine
    strategyPollIntervalMinutes: 30,

    // Transcode
    transcodeTempRoot: process.platform === 'linux' ? '/transcode' : '',
    transcodeReplaceConfirmRequired: false,
    upgradeReplaceConfirmRequired: false,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    transcodeEncodingDevices: [],
    transcodeCpuParticipationStrategy: 'normal',

    // Upgrade (MoviePilot)
    moviepilot: {
      baseUrl: '',
      apiKey: '',
      savePath: '',
    },
    upgradeStagingLocalPath: process.platform === 'linux' ? '/upgrade' : '',
    upgradeScrapingSettleSeconds: 1800,
    upgradeRetryInterval: 3600000,
    upgradeMaxRetries: 3,

    // Emby multi-server
    embyServers: {},

    // SubLibraries
    subLibraries: [],

    // Rule templates (v3)
    ruleTemplates: [buildDefaultTemplate(moviePolicy), buildTVDefaultTemplate(tvPolicy)],

    // Douban
    douban: {
      userId: '',
      cookieHeader: '',
    },

    // Service auth
    apiKey: '',
  };
}

// ── Version detection ──────────────────────────────────────────────────────────

function detectV1Config(raw) {
  const hasEmbyServers = raw.embyServers && Object.keys(raw.embyServers).length > 0;
  return !!(raw.baseUrl && !hasEmbyServers);
}

function detectV2Config(raw) {
  const hasGlobalPolicy = raw.mediaPolicy && Object.keys(raw.mediaPolicy).length > 0;
  const hasSubLibPolicy = (raw.subLibraries || []).some((s) => s.mediaPolicy);
  return !!(hasGlobalPolicy || hasSubLibPolicy) && !raw.ruleTemplates;
}

// ── Migrations ─────────────────────────────────────────────────────────────────

function migrateFromV1(raw) {
  const crypto = require('crypto');
  const embyServerId = crypto.randomUUID();

  const embyServers = {};
  embyServers[embyServerId] = {
    serverName: raw.baseUrl || '',
    baseUrl: raw.baseUrl || '',
    apiKey: raw.apiKey || '',
    userId: raw.userId || '',
    embyUserPassword: raw.embyUserPassword || '',
  };

  const v2 = {
    executionMode: raw.executionMode === 'scheduled' ? 'auto' : (raw.executionMode || 'auto'),
    deleteConcurrency: raw.deleteConcurrency ?? 3,
    transcodeConcurrency: raw.transcodeConcurrency ?? 1,
    upgradeConcurrency: raw.upgradeConcurrency ?? 1,
    wallRatingAutoEnqueue: raw.wallRatingAutoEnqueue || false,
    transcodeTempRoot: raw.transcodeTempRoot || '',
    transcodeReplaceConfirmRequired: raw.transcodeReplaceConfirmRequired || false,
    ffmpegPath: raw.ffmpegPath || 'ffmpeg',
    ffprobePath: raw.ffprobePath || 'ffprobe',
    transcodeEncodingDevices: [],
    transcodeCpuParticipationStrategy: raw.transcodeCpuParticipationStrategy || 'normal',
    moviepilot: { baseUrl: '', apiKey: '', savePath: '' },
    upgradeStagingLocalPath: process.platform === 'linux' ? '/upgrade' : '',
    embyServers,
    subLibraries: [],
    douban: { userId: '', cookieHeader: '' },
    apiKey: raw.serviceApiKey || '',
    mediaPolicy: raw.mediaPolicy || null,
  };

  return v2;
}

function migrateFromV2(raw) {
  const policy = raw.mediaPolicy && Object.keys(raw.mediaPolicy).length > 0
    ? raw.mediaPolicy
    : ((raw.subLibraries || []).find((s) => s.mediaPolicy) || {}).mediaPolicy;

  const template = buildDefaultTemplate(policy || {
    target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
    target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
  });

  const v3 = { ...raw };
  delete v3.mediaPolicy;

  v3.ruleTemplates = [template];

  v3.subLibraries = (v3.subLibraries || []).map((sl) => {
    const migrated = { ...sl };
    delete migrated.mediaPolicy;
    migrated.ruleTemplateId = migrated.ruleTemplateId || 'default';
    return migrated;
  });

  return v3;
}

function detectV3Config(raw) {
  const hasSubLibs = (raw.subLibraries || []).length > 0;
  if (!hasSubLibs) return false;
  const missingSchedule = (raw.subLibraries || []).some((s) => !s.scheduleMode);
  return missingSchedule;
}

function migrateFromV3(raw) {
  const sls = (raw.subLibraries || []);
  const globalAutoCreate = raw.wallRatingAutoEnqueue || false;
  const globalAutoExecute = raw.executionMode === 'auto';
  const globalAutoReplaceTranscode = !(raw.transcodeReplaceConfirmRequired);
  const globalAutoReplaceUpgrade = !(raw.upgradeReplaceConfirmRequired);
  const globalSmartSelect = raw.smartSelectMode === 'auto' ? true : raw.smartSelectMode === 'manual' ? false : null;

  const allAuto = globalAutoCreate && globalAutoExecute && globalAutoReplaceTranscode && globalAutoReplaceUpgrade && globalSmartSelect === true;
  const allManual = !globalAutoCreate && !globalAutoExecute && !globalAutoReplaceTranscode && !globalAutoReplaceUpgrade && globalSmartSelect === false;

  raw.subLibraries = sls.map((sl) => {
    if (sl.scheduleMode) return sl;
    const ssEnabled = !!(sl.upgradeSmartSelect && sl.upgradeSmartSelect.enabled);

    let scheduleMode = 'custom';
    if (allAuto) scheduleMode = 'full_auto';
    else if (allManual) scheduleMode = 'full_manual';

    const smartSelectEnabled = globalSmartSelect != null ? globalSmartSelect : ssEnabled;

    return {
      ...sl,
      scheduleMode,
      autoCreate: globalAutoCreate,
      autoExecute: globalAutoExecute,
      autoReplaceTranscode: globalAutoReplaceTranscode,
      autoReplaceUpgrade: globalAutoReplaceUpgrade,
      smartSelectEnabled,
    };
  });

  return raw;
}

function detectV4Rules(raw) {
  const templates = raw.ruleTemplates || [];
  if (templates.length === 0) return false;
  return templates.some((tpl) =>
    (tpl.rules || []).some((r) => r.innerConnector !== undefined) ||
    // Old 7-rule default template (before P6 split into 4 precise modern-codec-keep rules)
    (tpl.id === 'default' && (tpl.rules || []).length < 10)
  );
}

// V5: detect old default template (pre audioCodec filter + seedPreferences)
function detectV5DefaultTemplate(raw) {
  const templates = raw.ruleTemplates || [];
  const dfl = templates.find((t) => t.id === 'default');
  if (!dfl) return false;
  const rules = dfl.rules || [];
  // Old template has a P8 5★ upgrade rule without seedPreferences
  const upgrade5Star = rules.find((r) =>
    r.priority === 8 && r.action === 'upgrade' &&
    (!r.actionParams || !r.actionParams.seedPreferences || Object.keys(r.actionParams.seedPreferences).length === 0)
  );
  return !!upgrade5Star;
}

function extractPolicyFromTemplate(template) {
  if (!template || !template.rules) return null;
  const target1080p = {};
  const target4k = {};

  for (const rule of template.rules) {
    if (rule.action !== 'transcode' && rule.action !== 'upgrade') continue;
    const groups = rule.groups || [];
    if (groups.length < 2) continue;

    const g0 = Array.isArray(groups[0]) ? groups[0] : (groups[0].conditions || []);
    const g1 = Array.isArray(groups[1]) ? groups[1] : (groups[1].conditions || []);

    const ratingCond = g0.find((c) => c[0] === 'doubanRating' || c[0] === 'userRating');
    if (!ratingCond) continue;
    const rating = ratingCond[2];

    const bucketCond = g1.find((c) => c[0] === 'bucket');
    if (!bucketCond) continue;
    const bucket = bucketCond[2];

    const tgt = rule.actionParams && rule.actionParams.targetBitrate;
    if (typeof tgt !== 'number') continue;

    if (bucket === '1080p') target1080p[String(rating)] = tgt;
    else if (bucket === '4K') target4k[String(rating)] = tgt;
  }

  const hasData = Object.keys(target1080p).length > 0 || Object.keys(target4k).length > 0;
  if (!hasData) return null;

  return { target1080p, target4k };
}

function migrateV4Rules(raw) {
  const oldDefault = (raw.ruleTemplates || []).find((t) => t.id === 'default');
  const policy = extractPolicyFromTemplate(oldDefault) || {
    target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
    target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
  };
  const newDefault = buildDefaultTemplate(policy);
  raw.ruleTemplates = (raw.ruleTemplates || []).map((tpl) => {
    if (tpl.id === 'default') return newDefault;
    return tpl;
  });
  return raw;
}

// ── Load / Save ────────────────────────────────────────────────────────────────

function loadConfig() {
  ensureDataDir();
  const cfgFile = configFilePath();
  if (!fs.existsSync(cfgFile)) return getDefaultConfig();
  try {
    let raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

    if (detectV1Config(raw)) {
      console.log('[configStore] detected v1 config, migrating to v2 format');
      fs.writeFileSync(cfgFile + '.v1.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateFromV1(raw);
      saveConfig(raw);
    }

    if (detectV2Config(raw)) {
      console.log('[configStore] detected v2 config (mediaPolicy), migrating to v3 (ruleTemplates)');
      fs.writeFileSync(cfgFile + '.v2.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateFromV2(raw);
      saveConfig(raw);
    }

    if (detectV3Config(raw)) {
      console.log('[configStore] detected v3 config, migrating subLibrary scheduling to v4');
      fs.writeFileSync(cfgFile + '.v3.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateFromV3(raw);
      saveConfig(raw);
    }

    if (detectV4Rules(raw)) {
      console.log('[configStore] detected old rule format (innerConnector), regenerating default template');
      fs.writeFileSync(cfgFile + '.v4.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateV4Rules(raw);
      saveConfig(raw);
    }

    if (detectV5DefaultTemplate(raw)) {
      console.log('[configStore] detected old default template (v5 update), regenerating');
      fs.writeFileSync(cfgFile + '.v5.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateV4Rules(raw);
      saveConfig(raw);
    }

    return { ...getDefaultConfig(), ...raw };
  } catch (err) {
    console.error('[configStore] failed to load config:', err.message);
    return getDefaultConfig();
  }
}

function saveConfig(config) {
  ensureDataDir();
  const merged = { ...getDefaultConfig(), ...config };
  fs.writeFileSync(configFilePath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function patchConfig(updates) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  return saveConfig(merged);
}

module.exports = { resolveDataDir, loadConfig, saveConfig, patchConfig, getDefaultConfig, buildDefaultTemplate, defaultSubLibSchedule, resolveSubLibSchedule };
