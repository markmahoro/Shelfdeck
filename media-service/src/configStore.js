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

// Template version constants — bump when buildDefaultTemplate / buildTVDefaultTemplate logic changes
const DEFAULT_TEMPLATE_VERSION = 4;
const TV_DEFAULT_TEMPLATE_VERSION = 4;
const ADULT_JAV_DEFAULT_TEMPLATE_VERSION = 1;

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

  // P8: 5★ disc-like sources are protected from both transcode and upgrade.
  rules.push({
    priority: 8,
    groupsConnector: 'and',
    groups: [
      ratingGroup(5),
      condGroup([['isDiscLike', '=', true]]),
    ],
    action: 'keep',
    actionParams: {},
    reason: '5★ 原盘保留，不压缩',
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
    tag: { type: 'default', version: DEFAULT_TEMPLATE_VERSION },
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

  // P8: 5★ disc-like sources are protected from both transcode and upgrade.
  rules.push({
    priority: 8,
    groupsConnector: 'and',
    groups: [
      ratingGroup(5),
      condGroup([['isDiscLike', '=', true]]),
    ],
    action: 'keep',
    actionParams: {},
    reason: '5★ 原盘保留，不压缩',
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
    tag: { type: 'default', version: TV_DEFAULT_TEMPLATE_VERSION },
  };
}

function buildAdultJavDefaultTemplate(policy) {
  const p = policy || {};
  const target1080p = p.target1080p || 4;
  const target4k = p.target4k || 10;

  function condGroup(conds) {
    return { connector: 'and', conditions: conds };
  }

  return {
    id: 'adult_jav_default',
    name: '默认策略（日本 JAV）',
    description: '成人日本 JAV 文件夹库默认压缩策略，不依赖豆瓣评分或观看状态',
    rules: [
      {
        priority: 10,
        groupsConnector: 'and',
        groups: [condGroup([['scraped', '=', true], ['bucket', '=', '4K'], ['equivalentBitrate', '>', target4k]])],
        action: 'transcode',
        actionParams: { targetBitrate: target4k, targetCodec: 'h265' },
        reason: `日本 JAV 4K 码率 ${target4k} Mbps 超标，建议压缩`,
      },
      {
        priority: 9,
        groupsConnector: 'and',
        groups: [condGroup([['scraped', '=', true], ['bucket', '=', '1080p'], ['equivalentBitrate', '>', target1080p]])],
        action: 'transcode',
        actionParams: { targetBitrate: target1080p, targetCodec: 'h265' },
        reason: `日本 JAV 1080p 码率 ${target1080p} Mbps 超标，建议压缩`,
      },
      {
        priority: 1,
        groupsConnector: 'and',
        groups: [],
        action: 'keep',
        actionParams: {},
        reason: '成人库策略未触发转码',
      },
    ],
    tag: { type: 'default', version: ADULT_JAV_DEFAULT_TEMPLATE_VERSION },
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
  const mode = (subLib && subLib.scheduleMode) || 'full_auto';

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
    scrapeConcurrency: 1,
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

    // Transcode nodes
    nodeEnabled: true,
    nodePollIntervalMs: 2000,
    nodeHealthCheckIntervalMs: 30000,

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

    // Adult folder libraries
    adultLibrary: {
      settleSeconds: 30,
      scanIntervalMinutes: 10,
      autoScrape: true,
      videoExtensions: ['.3gp', '.avi', '.f4v', '.flv', '.iso', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.rm', '.rmvb', '.ts', '.vob', '.webm', '.wmv'],
      japaneseJav: {
        proxyServer: '',
        retry: 2,
        timeout: 'PT20S',
        crawlers: ['jav321', 'javbus'],
        highresCover: true,
        writeNfo: true,
        posterBasename: 'poster',
        fanartBasename: 'fanart',
      },
      western: {
        enabled: false,
      },
    },

    // Emby multi-server
    embyServers: {},

    // SubLibraries
    subLibraries: [],

    // Rule templates (v3)
    ruleTemplates: [
      buildDefaultTemplate(moviePolicy),
      buildTVDefaultTemplate(tvPolicy),
      buildAdultJavDefaultTemplate(),
    ],

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

function migrateDefaultTemplates(raw) {
  const templates = raw.ruleTemplates || [];
  if (templates.length === 0) {
    raw.ruleTemplates = getDefaultConfig().ruleTemplates;
    return { raw, migrated: true };
  }

  const MOVIE_DEFAULTS = {
    target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
    target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
  };
  const TV_DEFAULTS = {
    target1080p: { '2': 1.5, '3': 3, '4': 5, '5': 8 },
    target4k: { '2': 3, '3': 7, '4': 12, '5': 18 },
  };

  let migrated = false;

  raw.ruleTemplates = templates.map((tpl) => {
    if (!tpl.tag) {
      if (tpl.id === 'default') {
        const policy = extractPolicyFromTemplate(tpl) || MOVIE_DEFAULTS;
        migrated = true;
        return buildDefaultTemplate(policy);
      }
      if (tpl.id === 'tv_default') {
        const policy = extractPolicyFromTemplate(tpl) || TV_DEFAULTS;
        migrated = true;
        return buildTVDefaultTemplate(policy);
      }
      migrated = true;
      return { ...tpl, tag: { type: 'user' } };
    }

    if (tpl.tag.type === 'default') {
      const expected = tpl.id === 'default' ? DEFAULT_TEMPLATE_VERSION
        : tpl.id === 'tv_default' ? TV_DEFAULT_TEMPLATE_VERSION
        : tpl.id === 'adult_jav_default' ? ADULT_JAV_DEFAULT_TEMPLATE_VERSION : null;
      if (expected != null && tpl.tag.version !== expected) {
        const policy = extractPolicyFromTemplate(tpl) || {};
        migrated = true;
        if (tpl.id === 'default') return buildDefaultTemplate(policy);
        if (tpl.id === 'tv_default') return buildTVDefaultTemplate(policy);
        if (tpl.id === 'adult_jav_default') return buildAdultJavDefaultTemplate();
      }
    }

    return tpl;
  });

  const ids = new Set((raw.ruleTemplates || []).map((tpl) => tpl.id));
  if (!ids.has('default')) {
    raw.ruleTemplates.push(buildDefaultTemplate(MOVIE_DEFAULTS));
    migrated = true;
  }
  if (!ids.has('tv_default')) {
    raw.ruleTemplates.push(buildTVDefaultTemplate(TV_DEFAULTS));
    migrated = true;
  }
  if (!ids.has('adult_jav_default')) {
    raw.ruleTemplates.push(buildAdultJavDefaultTemplate());
    migrated = true;
  }

  return { raw, migrated };
}

function normalizeAdultLibraryConfig(raw) {
  const defaults = getDefaultConfig();
  let migrated = false;
  const current = raw.adultLibrary || {};
  const legacy = current.javsp || {};
  const japaneseJav = {
    ...(defaults.adultLibrary.japaneseJav || {}),
    ...(current.japaneseJav || {}),
  };

  for (const key of ['proxyServer', 'retry', 'timeout', 'highresCover']) {
    if (japaneseJav[key] === (defaults.adultLibrary.japaneseJav || {})[key] && legacy[key] !== undefined) {
      japaneseJav[key] = legacy[key];
      migrated = true;
    }
  }
  if (!current.japaneseJav && legacy.crawlerSelection && Array.isArray(legacy.crawlerSelection.normal)) {
    // Preserve the user's original crawler order; only drop names we no longer
    // support. Fall back to defaults if nothing valid remains.
    const supported = new Set(['jav321', 'javbus']);
    const carried = legacy.crawlerSelection.normal.filter((c) => supported.has(c));
    japaneseJav.crawlers = carried.length ? carried : defaults.adultLibrary.japaneseJav.crawlers;
    migrated = true;
  }
  if (current.javsp) migrated = true;

  raw.adultLibrary = {
    ...(defaults.adultLibrary || {}),
    ...current,
    japaneseJav,
    western: {
      ...(defaults.adultLibrary.western || {}),
      ...(current.western || {}),
    },
  };
  delete raw.adultLibrary.javsp;

  if (Array.isArray(raw.subLibraries)) {
    raw.subLibraries = raw.subLibraries.map((sl) => {
      if (sl && sl.mediaType === 'adult' && sl.scraperType === 'javsp') {
        migrated = true;
        return { ...sl, scraperType: 'shelfdeck_japanese_jav' };
      }
      return sl;
    });
  }

  return { raw, migrated };
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

    const tmplResult = migrateDefaultTemplates(raw);
    if (tmplResult.migrated) {
      console.log('[configStore] template migration applied (tag added or default template regenerated)');
      fs.writeFileSync(cfgFile + '.v6.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = tmplResult.raw;
      saveConfig(raw);
    }

    const adultResult = normalizeAdultLibraryConfig(raw);
    if (adultResult.migrated) {
      console.log('[configStore] adult library scraper config migration applied');
      fs.writeFileSync(cfgFile + '.v7.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = adultResult.raw;
      saveConfig(raw);
    } else {
      raw = adultResult.raw;
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

module.exports = { resolveDataDir, loadConfig, saveConfig, patchConfig, getDefaultConfig, buildDefaultTemplate, buildAdultJavDefaultTemplate, defaultSubLibSchedule, resolveSubLibSchedule };
