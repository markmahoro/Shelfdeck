'use strict';

const fs = require('fs');
const path = require('path');
const metadataStatus = require('./metadataStatus');
const { DEFAULT_RESOURCE_CAPACITY } = require('./resourceCapacity');

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

class ConfigValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConfigValidationError';
    this.code = code;
    this.details = details;
  }
}

// Template version constants — bump when buildDefaultTemplate / buildTVDefaultTemplate logic changes
const DEFAULT_TEMPLATE_VERSION = 7;
const TV_DEFAULT_TEMPLATE_VERSION = 7;
const ADULT_JAV_DEFAULT_TEMPLATE_VERSION = 5;
const ADULT_WESTERN_DEFAULT_TEMPLATE_VERSION = 4;

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
  function targetRule(priority, conditionGroups, targetMediaFacts, reason) {
    return {
      priority,
      groupsConnector: 'and',
      groups: conditionGroups,
      targetMediaFacts,
      reason,
    };
  }

  const rules = [];

  rules.push(targetRule(5, [ratingGroup(5)], {
    qualityTier: 'premium',
    minResolution: '4K',
    targetBitrateByBucket: { '1080p': t1080[5] || 12, '4K': t4k[5] || 25 },
    targetCodec: 'h265',
    preferredAudioCodecs: ['DTS', 'TrueHD', 'Atmos'],
    maxSizeGB: 38,
  }, '5★ Premium 归档前目标'));

  rules.push(targetRule(4, [ratingGroup(4)], {
    qualityTier: 'high',
    targetBitrateByBucket: { '1080p': t1080[4] || 7, '4K': t4k[4] || 16 },
    targetCodec: 'h265',
  }, '4★ High 归档前目标'));

  rules.push(targetRule(3, [ratingGroup(3)], {
    qualityTier: 'standard',
    targetBitrateByBucket: { '1080p': t1080[3] || 4, '4K': t4k[3] || 10 },
    targetCodec: 'h265',
  }, '3★ Standard 归档前目标'));

  rules.push(targetRule(1, [ratingGroupIn([1, 2])], {
    qualityTier: 'baseline',
    targetBitrateByBucket: { '1080p': t1080[2] || 2, '4K': t4k[2] || 5 },
    targetCodec: 'h265',
  }, '1-2★ Baseline 归档前目标'));

  rules.push(targetRule(0, [], {
    qualityTier: 'baseline',
    targetBitrateByBucket: { '1080p': t1080[3] || 4, '4K': t4k[3] || 10 },
    targetCodec: 'h265',
  }, 'Baseline 归档前目标'));

  return {
    id: 'default',
    name: '默认策略（电影）',
    description: '依据用户感知映射归档前目标',
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
  function targetRule(priority, conditionGroups, targetMediaFacts, reason) {
    return {
      priority,
      groupsConnector: 'and',
      groups: conditionGroups,
      targetMediaFacts,
      reason,
    };
  }

  const rules = [];

  rules.push(targetRule(5, [ratingGroup(5)], {
    qualityTier: 'premium',
    minResolution: '4K',
    targetBitrateByBucket: { '1080p': t1080[5] || 8, '4K': t4k[5] || 18 },
    targetCodec: 'h265',
    preferredAudioCodecs: ['DTS', 'TrueHD', 'Atmos'],
    maxSizeGB: 50,
  }, '5★ Premium 归档前目标'));

  rules.push(targetRule(4, [ratingGroup(4)], {
    qualityTier: 'high',
    targetBitrateByBucket: { '1080p': t1080[4] || 5, '4K': t4k[4] || 12 },
    targetCodec: 'h265',
  }, '4★ High 归档前目标'));

  rules.push(targetRule(3, [ratingGroup(3)], {
    qualityTier: 'standard',
    targetBitrateByBucket: { '1080p': t1080[3] || 3, '4K': t4k[3] || 7 },
    targetCodec: 'h265',
  }, '3★ Standard 归档前目标'));

  rules.push(targetRule(1, [ratingGroupIn([1, 2])], {
    qualityTier: 'baseline',
    targetBitrateByBucket: { '1080p': t1080[2] || 1.5, '4K': t4k[2] || 3 },
    targetCodec: 'h265',
  }, '1-2★ Baseline 归档前目标'));

  rules.push(targetRule(0, [], {
    qualityTier: 'baseline',
    targetBitrateByBucket: { '1080p': t1080[3] || 3, '4K': t4k[3] || 7 },
    targetCodec: 'h265',
  }, 'Baseline 归档前目标'));

  return {
    id: 'tv_default',
    name: '默认策略（剧集）',
    description: '剧集类归档前目标整体低于电影一档',
    rules,
    tag: { type: 'default', version: TV_DEFAULT_TEMPLATE_VERSION },
  };
}

function buildAdultJavDefaultTemplate(policy) {
  const p = policy || {};
  const target1080p = p.target1080p || 2.5;
  const target4k = p.target4k || 6;

  return {
    id: 'adult_jav_default',
    name: '默认策略（JAV）',
    description: '成人 JAV 文件夹库默认归档前目标，不依赖豆瓣评分或观看状态',
    rules: [
      {
        priority: 1,
        groupsConnector: 'and',
        groups: [],
        targetMediaFacts: {
          qualityTier: 'adult_baseline',
          targetBitrateByBucket: { '1080p': target1080p, '4K': target4k },
          targetCodec: 'h265',
        },
        reason: 'Adult Baseline 归档前目标',
      },
    ],
    tag: { type: 'default', version: ADULT_JAV_DEFAULT_TEMPLATE_VERSION },
  };
}

function buildAdultWesternDefaultTemplate(policy) {
  const p = policy || {};
  const target1080p = p.target1080p || 2.5;
  const target4k = p.target4k || 6;

  return {
    id: 'adult_western_default',
    name: '默认策略（欧美成人）',
    description: '欧美成人文件夹库默认归档前目标，等待 AI 整理完成后再计算',
    rules: [
      {
        priority: 1,
        groupsConnector: 'and',
        groups: [],
        targetMediaFacts: {
          qualityTier: 'adult_baseline',
          targetBitrateByBucket: { '1080p': target1080p, '4K': target4k },
          targetCodec: 'h265',
        },
        reason: 'Adult Baseline 归档前目标',
      },
    ],
    tag: { type: 'default', version: ADULT_WESTERN_DEFAULT_TEMPLATE_VERSION },
  };
}

function targetFactsForRule(rule = {}) {
  if (rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object') return { ...rule.targetMediaFacts };
  return { qualityTier: 'standard', targetCodec: 'h265', targetBitrateByBucket: { '1080p': 4, '4K': 10 } };
}

function normalizeRuleTemplateRule(rule = {}) {
  const targetMediaFacts = targetFactsForRule(rule);
  const { action, actionParams, ...rest } = rule;
  return {
    ...rest,
    targetMediaFacts,
  };
}

function normalizeRuleTemplate(template = {}) {
  return {
    ...template,
    rules: (template.rules || []).map(normalizeRuleTemplateRule),
  };
}

// ── SubLibrary scheduling defaults ─────────────────────────────────────────────

function defaultSubLibSchedule() {
  return {
    automationMode: 'auto',
    scheduleMode: 'full_auto',
    autoCreate: true,
    autoExecute: true,
  };
}

function resolveSubLibSchedule(itemInfo, config) {
  const subLibId = itemInfo && itemInfo.subLibraryId;
  const subLib = subLibId && (config.subLibraries || []).find((s) => s.uuid === subLibId);
  const explicitAutomationMode = subLib && (subLib.automationMode === 'auto' || subLib.automationMode === 'manual')
    ? subLib.automationMode
    : null;
  const automationMode = explicitAutomationMode;
  if (automationMode === 'manual') {
    return {
      automationMode: 'manual',
      autoCreate: true,
      autoExecute: false,
      approvalPolicy: (subLib && subLib.approvalPolicy) || {},
    };
  }
  if (automationMode === 'auto') {
    return {
      automationMode: 'auto',
      autoCreate: true,
      autoExecute: true,
      approvalPolicy: (subLib && subLib.approvalPolicy) || {},
    };
  }

  // Legacy custom mode compatibility. New code should prefer automationMode +
  // approvalPolicy; these booleans remain readable for old configs/tests.
  const mode = (subLib && subLib.scheduleMode) || 'full_auto';

  if (mode === 'full_auto') {
    return { automationMode: 'auto', autoCreate: true, autoExecute: true, approvalPolicy: (subLib && subLib.approvalPolicy) || {} };
  }
  if (mode === 'full_manual') {
    return { automationMode: 'manual', autoCreate: true, autoExecute: false, approvalPolicy: (subLib && subLib.approvalPolicy) || {} };
  }
  return {
    automationMode: subLib && subLib.autoExecute ? 'auto' : 'manual',
    autoCreate: true,
    autoExecute: !!(subLib && subLib.autoExecute),
    approvalPolicy: (subLib && subLib.approvalPolicy) || {},
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
    ingestConcurrency: 1,
    deleteConcurrency: 1,
    transcodeConcurrency: 1,
    upgradeConcurrency: 1,
    scrapeConcurrency: 1,
    resourceCapacity: { ...DEFAULT_RESOURCE_CAPACITY },
    wallRatingAutoEnqueue: false,

    // SmartTaskEngine
    smartTaskPollIntervalMinutes: 10,
    smartTaskMaxPerRun: 10,
    smartTaskMaxQueueSize: 50,
    smartTaskDeferWhenActiveBacklog: false,
    smartTaskResourceQueueMultiplier: 5,
    smartTaskMaxQueuedByResource: {},
    automaticTaskTargets: [],
    optimizeAllowedFlowKinds: [],
    upgradeCanary: {
      maxActiveTasks: 1,
      requireMoviePilotConfig: true,
      allowDiscLike: false,
    },
    smartTaskLookbackDays: 30,
    smartTaskInitialDelaySeconds: 60,

    // Startup maintenance
    mediaLibraryStartupRefreshOnStartup: true,
    mediaLibraryStartupRefreshDelaySeconds: 30,
    mediaLibraryStartupRefreshStaleMinutes: 120,
    mediaLibraryStartupRefreshMaxLibraries: 1,
    mediaLibrarySelfComputeOnStartup: true,
    mediaLibrarySelfComputeEnabled: true,

    // Task queue priority (PriorityEngine). Lower number = runs first.
    // Final score = source weight + target gate weight + selected-flow hint + subLibrary weight + business
    // signal + queue age + retry penalty + rule deltas.
    // Per-subLibrary weight lives on subLibrary.priorityWeight (default 100).
    // Advanced overlay rules below are AND-matched, applied in order, and may
    // only add/subtract from the running score. They must not override it.
    taskPriority: {
      manualTaskPriority: 0,     // manual tasks (POST /v1/tasks) always high priority
      autoTaskPriorityBase: 100, // base for smartTaskEngine-created tasks
      targetGateWeights: {
        ingest: 60,
        archive: 70,
        delete: 90,
        metadata: 80,
        optimize: 110,
      },
      optimizeOperationHints: {
        upgrade: 0,
        transcode: 20,
      },
      businessSignalWeights: {
        adultWorkflowBonus: 20,
        maxTranscodeSavingBonus: 30,
      },
      queueAgeStepMinutes: 60,
      queueAgeBonusPerStep: 2,
      maxQueueAgeBonus: 40,
      retryPenalty: 20,
      maxRetryPenalty: 80,
      rulesByTargetGate: { ingest: [], metadata: [], optimize: [], archive: [], delete: [] },
    },

    approvalPolicy: {
      'delete.beforeExecute': 'confirm',
      'transcode.dolbyVisionTonemap': 'auto',
      'transcode.beforeReplace': 'confirm',
      'upgrade.candidateSelect': 'confirm',
      'upgrade.identityMismatch': 'forceConfirm',
      'upgrade.beforeReplace': 'confirm',
      'scrape.beforeWriteMetadata': 'auto',
      'scrape.beforeOrganize': 'auto',
      'scrape.reviewResult': 'auto',
    },

    taskAdmission: {
      defaultCooldownHours: 48,
      defaultMaxQueued: 50,
      maxQueuedByTargetGate: {
        ingest: 50,
        metadata: 20,
        optimize: 50,
        archive: 50,
        delete: 50,
      },
      cooldownHoursByTargetGate: {
        ingest: 6,
        metadata: 6,
        optimize: 48,
        archive: 0,
        delete: 48,
      },
      automaticAttemptLimitsByTargetGate: {
        ingest: 3,
        metadata: 3,
        optimize: 1,
        archive: 1,
        delete: 1,
      },
    },

    deleteGatePolicy: {
      enabled: false,
      rules: [],
    },

    // StrategyEngine
    strategyPollIntervalMinutes: 30,

    // Transcode
    transcodeTempRoot: process.platform === 'linux' ? '/transcode' : '',
    transcodeCleanupOrphansOnStartup: true,
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
      probeTimeoutMs: 5000,
      organizedFolderName: 'scraped',
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
        organizeAfterScrape: true,
        organizedFolderName: 'scraped',
      },
      western: {
        enabled: false,
        provider: 'http',
        computeMode: 'local',
        localConcurrency: 1,
        aiWorkerBaseUrl: '',
        apiKey: '',
        timeoutMs: 600000,
        frameSampleCount: 36,
        frameWidth: 640,
        faceTimeoutSec: 120,
        faceRecognitionEnabled: true,
        vlmEnabled: true,
        allowExplicitGeneratedText: true,
        reviewRequired: false,
        writeNfo: true,
        organizeAfterScrape: true,
        organizedFolderName: 'scraped',
        posterBasename: 'poster',
        fanartBasename: 'fanart',
        titleTemplate: '{actors} - {description}',
        tmdbApiKey: '',
        tmdbReadAccessToken: '',
        metadataApiBaseUrl: 'https://api.metadataapi.net',
        metadataApiKey: '',
        stashBoxGraphqlUrl: 'https://api.theporndb.net/graphql',
        stashBoxApiKey: '',
        actorImageProxyServer: '',
        // Self-assigned 番号 (番号 is metadata, not the primary key). Items
        // with no recognized protagonist get an UNK-NNN placeholder; once the
        // worker names a protagonist, the 番号 becomes {CODE}-{actor seq}.
        idPrefix: 'UNK',
        sequencePad: 3,
        faceSimilarityThreshold: 0.25,
        blacklistThreshold: 0.5,
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
      buildAdultWesternDefaultTemplate(),
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

    const targetFacts = rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object' ? rule.targetMediaFacts : {};
    const byBucket = targetFacts.targetBitrateByBucket && typeof targetFacts.targetBitrateByBucket === 'object'
      ? targetFacts.targetBitrateByBucket
      : {};
    const tgt = byBucket[bucket] != null ? byBucket[bucket] : targetFacts.targetBitrate;
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
      return normalizeRuleTemplate({ ...tpl, tag: { type: 'user' } });
    }

    if (tpl.tag.type === 'default') {
      const expected = tpl.id === 'default' ? DEFAULT_TEMPLATE_VERSION
        : tpl.id === 'tv_default' ? TV_DEFAULT_TEMPLATE_VERSION
        : tpl.id === 'adult_jav_default' ? ADULT_JAV_DEFAULT_TEMPLATE_VERSION
          : tpl.id === 'adult_western_default' ? ADULT_WESTERN_DEFAULT_TEMPLATE_VERSION : null;
      if (expected != null && tpl.tag.version !== expected) {
        const policy = extractPolicyFromTemplate(tpl) || {};
        migrated = true;
        if (tpl.id === 'default') return buildDefaultTemplate(policy);
        if (tpl.id === 'tv_default') return buildTVDefaultTemplate(policy);
        if (tpl.id === 'adult_jav_default') return buildAdultJavDefaultTemplate();
        if (tpl.id === 'adult_western_default') return buildAdultWesternDefaultTemplate();
      }
    }

    return normalizeRuleTemplate(tpl);
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
  if (!ids.has('adult_western_default')) {
    raw.ruleTemplates.push(buildAdultWesternDefaultTemplate());
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

  const western = {
    ...(defaults.adultLibrary.western || {}),
    ...(current.western || {}),
  };
  if (Object.prototype.hasOwnProperty.call(western, 'faceEmbeddingsUrl')) {
    delete western.faceEmbeddingsUrl;
    migrated = true;
  }
  if (Object.prototype.hasOwnProperty.call(western, 'faceApiKey')) {
    delete western.faceApiKey;
    migrated = true;
  }

  raw.adultLibrary = {
    ...(defaults.adultLibrary || {}),
    ...current,
    japaneseJav,
    western,
  };
  if (Object.prototype.hasOwnProperty.call(raw.adultLibrary, 'autoScrape')) {
    delete raw.adultLibrary.autoScrape;
    migrated = true;
  }
  if (Object.prototype.hasOwnProperty.call(raw.adultLibrary, 'scanIntervalMinutes')) {
    delete raw.adultLibrary.scanIntervalMinutes;
    migrated = true;
  }
  delete raw.adultLibrary.javsp;

  if (Array.isArray(raw.subLibraries)) {
    raw.subLibraries = raw.subLibraries.map((sl) => {
      if (!sl) return sl;
      let next = sl;
      if (sl && Object.prototype.hasOwnProperty.call(sl, 'scrapeSettleSeconds')) {
        migrated = true;
        next = { ...next };
        delete next.scrapeSettleSeconds;
      }
      if (next.mediaType === 'adult' && Object.prototype.hasOwnProperty.call(next, 'scrapeEnabled')) {
        migrated = true;
        next = { ...next };
        delete next.scrapeEnabled;
      }
      if (next.mediaType === 'adult' && Object.prototype.hasOwnProperty.call(next, 'scanIntervalMinutes')) {
        migrated = true;
        next = { ...next };
        delete next.scanIntervalMinutes;
      }
      if (next.mediaType === 'adult' && next.adultRegion === 'japanese_jav' && next.name === '日本 JAV') {
        migrated = true;
        next = { ...next, name: 'JAV' };
      }
      if (next.mediaType === 'adult' && next.scraperType === 'javsp') {
        migrated = true;
        next = { ...next, scraperType: 'shelfdeck_japanese_jav' };
      }
      return next;
    });
  }

  return { raw, migrated };
}

function normalizeTranscodeEncodingDevices(raw) {
  const devices = Array.isArray(raw && raw.transcodeEncodingDevices)
    ? raw.transcodeEncodingDevices
    : [];
  let migrated = false;
  const normalized = [];

  for (const dev of devices) {
    if (!dev || typeof dev !== 'object') continue;
    const stableKey = String(dev.stableKey || '').trim();
    if (!stableKey) {
      migrated = true;
      continue;
    }
    const next = {
      stableKey,
      inPool: dev.inPool !== false,
      priority: Math.max(1, Number.parseInt(dev.priority, 10) || 100),
      maxSlots: Math.max(1, Number.parseInt(dev.maxSlots, 10) || 1),
      encoder: String(dev.encoder || ''),
    };
    normalized.push(next);
    const allowed = new Set(Object.keys(next));
    for (const key of Object.keys(dev)) {
      if (!allowed.has(key) || dev[key] !== next[key]) {
        migrated = true;
        break;
      }
    }
  }

  if (devices.length !== normalized.length) migrated = true;
  return {
    raw: { ...(raw || {}), transcodeEncodingDevices: normalized },
    migrated,
  };
}

const AUTOMATIC_TASK_TARGETS = new Set(['ingest', 'metadata', 'optimize', 'archive', 'delete']);
const OPTIMIZE_ALLOWED_FLOW_KINDS = new Set(['transcode', 'upgrade']);

function normalizeStringList(values, allowed) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || !allowed.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function splitLegacySmartTaskActions(actions = []) {
  const taskTargets = new Set();
  const optimizeFlowKinds = new Set();
  for (const action of Array.isArray(actions) ? actions : []) {
    const normalized = String(action || '').trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'ingest') taskTargets.add('ingest');
    else if (normalized === 'scrape' || normalized === 'metadata') taskTargets.add('metadata');
    else if (normalized === 'archive') taskTargets.add('archive');
    else if (normalized === 'delete') taskTargets.add('delete');
    else if (normalized === 'optimize') {
      taskTargets.add('optimize');
      for (const flowKind of OPTIMIZE_ALLOWED_FLOW_KINDS) optimizeFlowKinds.add(flowKind);
    } else if (OPTIMIZE_ALLOWED_FLOW_KINDS.has(normalized)) {
      taskTargets.add('optimize');
      optimizeFlowKinds.add(normalized);
    }
  }
  return {
    automaticTaskTargets: Array.from(taskTargets),
    optimizeAllowedFlowKinds: Array.from(optimizeFlowKinds),
  };
}

function normalizeLifecycleAutomationConfig(raw) {
  const current = raw || {};
  const actions = Array.isArray(current.smartTaskEnabledActions)
    ? current.smartTaskEnabledActions.map((action) => String(action || '').trim()).filter(Boolean)
    : [];
  const migrations = current.migrations && typeof current.migrations === 'object'
    ? current.migrations
    : {};
  let migrated = false;

  let automaticTaskTargets = normalizeStringList(current.automaticTaskTargets, AUTOMATIC_TASK_TARGETS);
  let optimizeAllowedFlowKinds = normalizeStringList(current.optimizeAllowedFlowKinds, OPTIMIZE_ALLOWED_FLOW_KINDS);
  const hasNewAutomationFields = Array.isArray(current.automaticTaskTargets)
    || Array.isArray(current.optimizeAllowedFlowKinds);

  if (!hasNewAutomationFields) {
    const legacy = splitLegacySmartTaskActions(actions);
    automaticTaskTargets = legacy.automaticTaskTargets;
    optimizeAllowedFlowKinds = legacy.optimizeAllowedFlowKinds;
    if (actions.length > 0) migrated = true;
  }

  if (actions.map((action) => String(action || '').trim().toLowerCase()).includes('delete')
    && !automaticTaskTargets.includes('delete')) {
    automaticTaskTargets.push('delete');
    migrated = true;
  }

  if (!hasNewAutomationFields && actions.length > 0 && !automaticTaskTargets.includes('archive') && actions.includes('archive')) {
    automaticTaskTargets.push('archive');
  }

  if (!hasNewAutomationFields && actions.length > 0 && !actions.includes('archive') && migrations.v31ArchiveAutomation !== true) {
    automaticTaskTargets = normalizeStringList([...automaticTaskTargets, 'archive'], AUTOMATIC_TASK_TARGETS);
    migrated = true;
  }

  const nextMigrations = !hasNewAutomationFields && actions.length > 0 && migrations.v31ArchiveAutomation !== true
    ? { ...migrations, v31ArchiveAutomation: true }
    : migrations;

  const next = {
    ...current,
    automaticTaskTargets,
    optimizeAllowedFlowKinds,
  };
  delete next.smartTaskEnabledActions;
  delete next.optimizeAllowedOperations;
  if (Object.keys(nextMigrations).length > 0 || current.migrations !== undefined) {
    next.migrations = nextMigrations;
  }

  if (Array.isArray(current.automaticTaskTargets)
    && JSON.stringify(current.automaticTaskTargets) !== JSON.stringify(automaticTaskTargets)) migrated = true;
  if (Array.isArray(current.optimizeAllowedFlowKinds)
    && JSON.stringify(current.optimizeAllowedFlowKinds) !== JSON.stringify(optimizeAllowedFlowKinds)) migrated = true;
  if (Object.prototype.hasOwnProperty.call(current, 'optimizeAllowedOperations')) migrated = true;
  if (Object.prototype.hasOwnProperty.call(current, 'smartTaskEnabledActions')) migrated = true;

  return { raw: next, migrated };
}

function normalizeMetadataGateConfig(raw) {
  if (!raw || !Array.isArray(raw.subLibraries)) return { raw, migrated: false };
  let migrated = false;
  const subLibraries = raw.subLibraries.map((sl) => {
    if (!sl || !Object.prototype.hasOwnProperty.call(sl, 'metadataGate')) return sl;
    const sanitized = metadataStatus.sanitizeMetadataGate(sl.metadataGate);
    const before = JSON.stringify(sl.metadataGate || null);
    const after = JSON.stringify(sanitized || null);
    if (before === after) return sl;
    migrated = true;
    const next = { ...sl };
    if (sanitized) next.metadataGate = sanitized;
    else delete next.metadataGate;
    return next;
  });
  return { raw: { ...raw, subLibraries }, migrated };
}

function validateMetadataGateContracts(config = {}) {
  const violations = [];
  const subLibraries = Array.isArray(config.subLibraries) ? config.subLibraries : [];
  for (const subLib of subLibraries) {
    const result = metadataStatus.validateMetadataGateForSubLibrary(subLib, config);
    if (result.ok) continue;
    violations.push({
      subLibraryId: subLib && subLib.uuid || '',
      subLibraryName: subLib && subLib.name || '',
      ruleTemplateId: subLib && subLib.ruleTemplateId || '',
      missingRequirements: result.missingRequirements,
      requiredInputs: result.requiredInputs,
    });
  }
  if (violations.length > 0) {
    const first = violations[0];
    throw new ConfigValidationError(
      'METADATA_GATE_CONTRACT_BROKEN',
      `metadataGate does not cover optimize inputs: ${first.missingRequirements.join(', ')}`,
      { violations },
    );
  }
  return { ok: true, violations: [] };
}

// ── Load / Save ────────────────────────────────────────────────────────────────

function mergeConfigWithDefaults(config) {
  const defaults = getDefaultConfig();
  const transcodeNormalized = normalizeTranscodeEncodingDevices(config || {}).raw;
  const lifecycleNormalized = normalizeLifecycleAutomationConfig(transcodeNormalized).raw;
  const raw = normalizeMetadataGateConfig(lifecycleNormalized).raw;
  const merged = { ...defaults, ...raw };
  merged.resourceCapacity = {
    ...(defaults.resourceCapacity || {}),
    ...legacyConcurrencyToResourceCapacity(raw || {}),
    ...((raw && raw.resourceCapacity) || {}),
  };

  merged.taskAdmission = {
    ...(defaults.taskAdmission || {}),
    ...(raw.taskAdmission || {}),
    cooldownHoursByTargetGate: {
      ...((defaults.taskAdmission || {}).cooldownHoursByTargetGate || {}),
      ...legacyActionAdmissionToTargetGate(((raw.taskAdmission || {}).cooldownHoursByAction) || {}),
      ...(((raw.taskAdmission || {}).cooldownHoursByTargetGate) || {}),
    },
    maxQueuedByTargetGate: {
      ...((defaults.taskAdmission || {}).maxQueuedByTargetGate || {}),
      ...legacyActionAdmissionToTargetGate(((raw.taskAdmission || {}).maxQueuedByAction) || {}),
      ...(((raw.taskAdmission || {}).maxQueuedByTargetGate) || {}),
    },
    automaticAttemptLimitsByTargetGate: {
      ...((defaults.taskAdmission || {}).automaticAttemptLimitsByTargetGate || {}),
      ...(((raw.taskAdmission || {}).automaticAttemptLimitsByTargetGate) || {}),
    },
  };

  merged.taskPriority = {
    ...(defaults.taskPriority || {}),
    ...(raw.taskPriority || {}),
    targetGateWeights: {
      ...((defaults.taskPriority || {}).targetGateWeights || {}),
      ...(((raw.taskPriority || {}).targetGateWeights) || {}),
    },
    optimizeOperationHints: {
      ...((defaults.taskPriority || {}).optimizeOperationHints || {}),
      ...(((raw.taskPriority || {}).optimizeOperationHints) || {}),
    },
    rulesByTargetGate: {
      ...((defaults.taskPriority || {}).rulesByTargetGate || {}),
      ...(((raw.taskPriority || {}).rulesByTargetGate) || {}),
    },
  };

  merged.approvalPolicy = {
    ...(defaults.approvalPolicy || {}),
    ...(raw.approvalPolicy || {}),
  };

  merged.upgradeCanary = {
    ...(defaults.upgradeCanary || {}),
    ...(raw.upgradeCanary || {}),
  };

  merged.deleteGatePolicy = {
    ...(defaults.deleteGatePolicy || {}),
    ...(raw.deleteGatePolicy || {}),
    rules: Array.isArray(raw.deleteGatePolicy && raw.deleteGatePolicy.rules)
      ? raw.deleteGatePolicy.rules
      : ((defaults.deleteGatePolicy || {}).rules || []),
  };

  return merged;
}

function legacyActionAdmissionToTargetGate(byAction = {}) {
  const result = {};
  if (typeof byAction.ingest === 'number') result.ingest = byAction.ingest;
  if (typeof byAction.scrape === 'number') result.metadata = byAction.scrape;
  if (typeof byAction.archive === 'number') result.archive = byAction.archive;
  if (typeof byAction.delete === 'number') result.delete = byAction.delete;
  const optimizeValues = ['transcode', 'upgrade']
    .map((key) => Number(byAction[key]))
    .filter(Number.isFinite);
  if (optimizeValues.length > 0) result.optimize = Math.min(...optimizeValues);
  return result;
}

function legacyConcurrencyToResourceCapacity(raw = {}) {
  const result = {};
  if (typeof raw.ingestConcurrency === 'number') result['filesystem:ingest'] = raw.ingestConcurrency;
  if (typeof raw.deleteConcurrency === 'number') result['filesystem:mutation'] = raw.deleteConcurrency;
  if (typeof raw.scrapeConcurrency === 'number') result['scraper:metadata'] = raw.scrapeConcurrency;
  if (typeof raw.embyMetadataRepairConcurrency === 'number') result['emby:metadata'] = raw.embyMetadataRepairConcurrency;
  if (typeof raw.transcodeConcurrency === 'number') {
    result['local:ffmpeg'] = raw.transcodeConcurrency;
    result['worker:*'] = raw.transcodeConcurrency;
  }
  if (typeof raw.upgradeConcurrency === 'number') result.moviepilot = raw.upgradeConcurrency;
  return result;
}

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
      saveConfig(raw, { skipMetadataGateValidation: true });
    }

    if (detectV2Config(raw)) {
      console.log('[configStore] detected v2 config (mediaPolicy), migrating to v3 (ruleTemplates)');
      fs.writeFileSync(cfgFile + '.v2.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateFromV2(raw);
      saveConfig(raw, { skipMetadataGateValidation: true });
    }

    if (detectV3Config(raw)) {
      console.log('[configStore] detected v3 config, migrating subLibrary scheduling to v4');
      fs.writeFileSync(cfgFile + '.v3.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = migrateFromV3(raw);
      saveConfig(raw, { skipMetadataGateValidation: true });
    }

    const tmplResult = migrateDefaultTemplates(raw);
    if (tmplResult.migrated) {
      console.log('[configStore] template migration applied (tag added or default template regenerated)');
      fs.writeFileSync(cfgFile + '.v6.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = tmplResult.raw;
      saveConfig(raw, { skipMetadataGateValidation: true });
    }

    const adultResult = normalizeAdultLibraryConfig(raw);
    if (adultResult.migrated) {
      console.log('[configStore] adult library scraper config migration applied');
      fs.writeFileSync(cfgFile + '.v7.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = adultResult.raw;
      saveConfig(raw, { skipMetadataGateValidation: true });
    } else {
      raw = adultResult.raw;
    }

    const transcodeResult = normalizeTranscodeEncodingDevices(raw);
    if (transcodeResult.migrated) {
      console.log('[configStore] transcode device config migration applied');
      fs.writeFileSync(cfgFile + '.v8.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = transcodeResult.raw;
      saveConfig(raw, { skipMetadataGateValidation: true });
    } else {
      raw = transcodeResult.raw;
    }

    const lifecycleAutomationResult = normalizeLifecycleAutomationConfig(raw);
    if (lifecycleAutomationResult.migrated) {
      console.log('[configStore] lifecycle automation config migration applied');
      fs.writeFileSync(cfgFile + '.v9.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = lifecycleAutomationResult.raw;
      saveConfig(raw, { skipMetadataGateValidation: true });
    } else {
      raw = lifecycleAutomationResult.raw;
    }

    const metadataGateResult = normalizeMetadataGateConfig(raw);
    if (metadataGateResult.migrated) {
      console.log('[configStore] metadata gate config migration applied');
      fs.writeFileSync(cfgFile + '.v10.backup', JSON.stringify(raw, null, 2), 'utf8');
      raw = metadataGateResult.raw;
      saveConfig(raw, { skipMetadataGateValidation: true });
    } else {
      raw = metadataGateResult.raw;
    }

    return mergeConfigWithDefaults(raw);
  } catch (err) {
    console.error('[configStore] failed to load config:', err.message);
    return getDefaultConfig();
  }
}

function saveConfig(config, options = {}) {
  ensureDataDir();
  const merged = mergeConfigWithDefaults(config);
  if (options.skipMetadataGateValidation !== true) validateMetadataGateContracts(merged);
  fs.writeFileSync(configFilePath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function patchConfig(updates) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  return saveConfig(merged);
}

module.exports = {
  ConfigValidationError,
  resolveDataDir,
  loadConfig,
  saveConfig,
  patchConfig,
  validateMetadataGateContracts,
  getDefaultConfig,
  buildDefaultTemplate,
  buildAdultJavDefaultTemplate,
  buildAdultWesternDefaultTemplate,
  normalizeRuleTemplate,
  defaultSubLibSchedule,
  resolveSubLibSchedule,
};
