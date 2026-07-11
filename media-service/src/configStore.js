'use strict';

const fs = require('fs');
const path = require('path');
const metadataStatus = require('./metadataStatus');
const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');
const { HELIX_SCHEMA_VERSION } = require('./helixCleanState');

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
const DEFAULT_TEMPLATE_VERSION = 8;
const TV_DEFAULT_TEMPLATE_VERSION = 8;
const ADULT_JAV_DEFAULT_TEMPLATE_VERSION = 6;
const ADULT_WESTERN_DEFAULT_TEMPLATE_VERSION = 5;

// ── Default rule template builder ──────────────────────────────────────────────

function profileByBucket(target1080p, target4k) {
  return {
    '1080p': bitrateObjectiveProfile.targetBitrateProfileFromTarget(target1080p, '1080p'),
    '4K': bitrateObjectiveProfile.targetBitrateProfileFromTarget(target4k, '4K'),
  };
}

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
    targetBitrateProfileByBucket: profileByBucket(t1080[5] || 12, t4k[5] || 25),
    targetCodec: 'h265',
    preferredAudioCodecs: ['DTS', 'TrueHD', 'Atmos'],
    maxSizeGB: 38,
  }, '5★ Premium 归档前目标'));

  rules.push(targetRule(4, [ratingGroup(4)], {
    qualityTier: 'high',
    targetBitrateProfileByBucket: profileByBucket(t1080[4] || 7, t4k[4] || 16),
    targetCodec: 'h265',
  }, '4★ High 归档前目标'));

  rules.push(targetRule(3, [ratingGroup(3)], {
    qualityTier: 'standard',
    targetBitrateProfileByBucket: profileByBucket(t1080[3] || 4, t4k[3] || 10),
    targetCodec: 'h265',
  }, '3★ Standard 归档前目标'));

  rules.push(targetRule(1, [ratingGroupIn([1, 2])], {
    qualityTier: 'baseline',
    targetBitrateProfileByBucket: profileByBucket(t1080[2] || 2, t4k[2] || 5),
    targetCodec: 'h265',
  }, '1-2★ Baseline 归档前目标'));

  rules.push(targetRule(0, [], {
    qualityTier: 'baseline',
    targetBitrateProfileByBucket: profileByBucket(t1080[3] || 4, t4k[3] || 10),
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
    targetBitrateProfileByBucket: profileByBucket(t1080[5] || 8, t4k[5] || 18),
    targetCodec: 'h265',
    preferredAudioCodecs: ['DTS', 'TrueHD', 'Atmos'],
    maxSizeGB: 50,
  }, '5★ Premium 归档前目标'));

  rules.push(targetRule(4, [ratingGroup(4)], {
    qualityTier: 'high',
    targetBitrateProfileByBucket: profileByBucket(t1080[4] || 5, t4k[4] || 12),
    targetCodec: 'h265',
  }, '4★ High 归档前目标'));

  rules.push(targetRule(3, [ratingGroup(3)], {
    qualityTier: 'standard',
    targetBitrateProfileByBucket: profileByBucket(t1080[3] || 3, t4k[3] || 7),
    targetCodec: 'h265',
  }, '3★ Standard 归档前目标'));

  rules.push(targetRule(1, [ratingGroupIn([1, 2])], {
    qualityTier: 'baseline',
    targetBitrateProfileByBucket: profileByBucket(t1080[2] || 1.5, t4k[2] || 3),
    targetCodec: 'h265',
  }, '1-2★ Baseline 归档前目标'));

  rules.push(targetRule(0, [], {
    qualityTier: 'baseline',
    targetBitrateProfileByBucket: profileByBucket(t1080[3] || 3, t4k[3] || 7),
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
          targetBitrateProfileByBucket: profileByBucket(target1080p, target4k),
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
          targetBitrateProfileByBucket: profileByBucket(target1080p, target4k),
          targetCodec: 'h265',
        },
        reason: 'Adult Baseline 归档前目标',
      },
    ],
    tag: { type: 'default', version: ADULT_WESTERN_DEFAULT_TEMPLATE_VERSION },
  };
}

function targetFactsForRule(rule = {}) {
  const facts = rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object'
    ? { ...rule.targetMediaFacts }
    : { qualityTier: 'standard', targetCodec: 'h265', targetBitrateProfileByBucket: profileByBucket(4, 10) };
  if (!facts.targetBitrateProfileByBucket) {
    facts.targetBitrateProfileByBucket = profileByBucket(4, 10);
  }
  delete facts.targetBitrateByBucket;
  delete facts.targetBitrate;
  return facts;
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

// ── Helix two-level automation ─────────────────────────────────────────────────

function defaultSubLibraryAutomation() {
  return {
    libraryAutomationMode: 'manual',
    maintenanceAutomationMode: 'manual',
  };
}

function resolveSubLibraryAutomation(itemInfo, config) {
  const subLibId = itemInfo && itemInfo.subLibraryId;
  const subLib = subLibId && (config.subLibraries || []).find((s) => s.uuid === subLibId);
  const defaults = defaultSubLibraryAutomation();
  return {
    libraryAutomationMode: subLib && subLib.libraryAutomationMode || defaults.libraryAutomationMode,
    maintenanceAutomationMode: subLib && subLib.maintenanceAutomationMode || defaults.maintenanceAutomationMode,
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
    helixSchemaVersion: HELIX_SCHEMA_VERSION,

    resourceGovernor: {
      capacities: {
        'control:libra': 1,
        'control:kairox': 1,
        'db:library:write': 1,
        'db:tasks:write': 1,
        'local:ffmpeg': 1,
        'emby:*:api': 1,
        'filesystem:*': 1,
        'worker:*': 1,
        'service:task': 1,
      },
      defaultQueueLimit: 100,
      agingMs: 60000,
    },
    resourceLimits: {
      embyApiPerServer: 1,
      filesystemPerVolume: 1,
      localFfmpeg: 1,
      workerPerNode: 1,
    },
    optimizeFlowPolicy: {
      allowedFlowKinds: ['transcode', 'upgrade'],
    },
    // Task queue priority (PriorityEngine). Lower number = runs first.
    // Final score = source weight + target gate weight + selected-flow hint + subLibrary weight + business
    // signal + queue age + retry penalty + rule deltas.
    // Per-subLibrary weight lives on subLibrary.priorityWeight (default 100).
    // Advanced overlay rules below are AND-matched, applied in order, and may
    // only add/subtract from the running score. They must not override it.
    taskPriority: {
      basePriority: 100,
      targetGateWeights: {
        basedata: 60,
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
      rulesByTargetGate: { basedata: [], metadata: [], optimize: [] },
    },

    approvalPolicy: {
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
        basedata: 50,
        metadata: 20,
        optimize: 50,
      },
      cooldownHoursByTargetGate: {
        basedata: 6,
        metadata: 6,
        optimize: 48,
      },
      automaticAttemptLimitsByTargetGate: {
        basedata: 3,
        metadata: 3,
        optimize: 1,
      },
      mediaFreezeHoursByCompletedTargetGate: {
        basedata: 0,
        metadata: 0,
        optimize: 24,
      },
    },

    // Transcode
    transcodeTempRoot: process.platform === 'linux' ? '/transcode' : '',
    transcodeCleanupOrphansOnStartup: true,
    transcodeEncodingDevices: [],
    transcodeCpuParticipationStrategy: 'normal',

    // Transcode nodes
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
      interestsRssUrl: '',
    },

    // Service auth
    apiKey: '',
  };
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
  const raw = normalizeMetadataGateConfig(transcodeNormalized).raw;
  const merged = { ...defaults, ...raw };
  merged.resourceGovernor = {
    ...(defaults.resourceGovernor || {}),
    ...((raw && raw.resourceGovernor) || {}),
    capacities: {
      ...((defaults.resourceGovernor && defaults.resourceGovernor.capacities) || {}),
      ...((raw && raw.resourceGovernor && raw.resourceGovernor.capacities) || {}),
    },
  };

  merged.resourceLimits = {
    ...(defaults.resourceLimits || {}),
    ...(raw.resourceLimits || {}),
  };

  merged.optimizeFlowPolicy = {
    ...(defaults.optimizeFlowPolicy || {}),
    ...(raw.optimizeFlowPolicy || {}),
  };

  merged.moviepilot = {
    ...(defaults.moviepilot || {}),
    ...(raw.moviepilot || {}),
  };

  merged.taskAdmission = {
    ...(defaults.taskAdmission || {}),
    ...(raw.taskAdmission || {}),
    cooldownHoursByTargetGate: {
      ...((defaults.taskAdmission || {}).cooldownHoursByTargetGate || {}),
      ...(((raw.taskAdmission || {}).cooldownHoursByTargetGate) || {}),
    },
    maxQueuedByTargetGate: {
      ...((defaults.taskAdmission || {}).maxQueuedByTargetGate || {}),
      ...(((raw.taskAdmission || {}).maxQueuedByTargetGate) || {}),
    },
    automaticAttemptLimitsByTargetGate: {
      ...((defaults.taskAdmission || {}).automaticAttemptLimitsByTargetGate || {}),
      ...(((raw.taskAdmission || {}).automaticAttemptLimitsByTargetGate) || {}),
    },
    mediaFreezeHoursByCompletedTargetGate: {
      ...((defaults.taskAdmission || {}).mediaFreezeHoursByCompletedTargetGate || {}),
      ...(((raw.taskAdmission || {}).mediaFreezeHoursByCompletedTargetGate) || {}),
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

  return merged;
}

const USER_CONFIG_FIELDS = Object.freeze([
  'helixSchemaVersion',
  'apiKey',
  'resourceLimits',
  'optimizeFlowPolicy',
  'approvalPolicy',
  'transcodeTempRoot',
  'transcodeEncodingDevices',
  'transcodeCpuParticipationStrategy',
  'moviepilot',
  'upgradeStagingLocalPath',
  'adultLibrary',
  'embyServers',
  'subLibraries',
  'ruleTemplates',
  'douban',
]);

function canonicalUserConfig(config = {}) {
  return USER_CONFIG_FIELDS.reduce((out, key) => {
    if (config[key] !== undefined) out[key] = config[key];
    return out;
  }, {});
}

function compactUserConfig(config = {}) {
  const canonical = canonicalUserConfig(config);
  const defaults = canonicalUserConfig(getDefaultConfig());
  const compact = {
    helixSchemaVersion: canonical.helixSchemaVersion || HELIX_SCHEMA_VERSION,
    apiKey: String(canonical.apiKey || ''),
  };
  for (const key of USER_CONFIG_FIELDS) {
    if (key === 'helixSchemaVersion' || key === 'apiKey' || canonical[key] === undefined) continue;
    if (JSON.stringify(canonical[key]) !== JSON.stringify(defaults[key])) compact[key] = canonical[key];
  }
  return compact;
}

const LEGACY_CONFIG_FIELDS = new Set([
  'executionMode',
  'automationMode',
  'scheduleMode',
  'autoCreate',
  'autoExecute',
  'wallRatingAutoEnqueue',
  'automaticTaskTargets',
  'optimizeAllowedFlowKinds',
  'smartTaskEnabledActions',
  'deleteGatePolicy',
  'ingestConcurrency',
  'deleteConcurrency',
  'scrapeConcurrency',
  'transcodeConcurrency',
  'upgradeConcurrency',
  'resourceCapacity',
  'resourceGovernor',
  'libraryAutomation',
  'maintenanceAutomation',
  'taskPriority',
  'taskAdmission',
  'upgradeCanary',
  'upgradeRetryInterval',
  'upgradeMaxRetries',
  'upgradeScrapingSettleSeconds',
  'nodeEnabled',
  'nodePollIntervalMs',
  'nodeHealthCheckIntervalMs',
  'transcodeCleanupOrphansOnStartup',
  'backgroundIoGuard',
  'strategyPollIntervalMinutes',
  'transcodeReplaceConfirmRequired',
  'upgradeReplaceConfirmRequired',
]);

const HELIX_TARGET_GATES = new Set(['basedata', 'metadata', 'optimize']);

function collectLegacyConfigPaths(raw = {}) {
  const paths = [];
  for (const key of Object.keys(raw || {})) {
    if (LEGACY_CONFIG_FIELDS.has(key) || key.startsWith('smartTask') || key.startsWith('mediaLibraryStartupRefresh')) {
      paths.push(key);
    }
  }
  for (const [index, subLibrary] of (raw.subLibraries || []).entries()) {
    for (const key of Object.keys(subLibrary || {})) {
      if (LEGACY_CONFIG_FIELDS.has(key) || key.startsWith('smartTask')) paths.push(`subLibraries[${index}].${key}`);
    }
  }
  for (const [serverId, server] of Object.entries(raw.embyServers || {})) {
    if (Object.prototype.hasOwnProperty.call(server || {}, 'apiKey')) paths.push(`embyServers.${serverId}.apiKey`);
    if (Object.prototype.hasOwnProperty.call(server || {}, 'embyUserPassword')) paths.push(`embyServers.${serverId}.embyUserPassword`);
    if (!server.baseUrl || !server.accessToken || !server.userId) paths.push(`embyServers.${serverId}.connection`);
  }
  return paths;
}

function invalidTargetPaths(raw = {}) {
  const paths = [];
  const maps = [
    ['taskPriority.targetGateWeights', raw.taskPriority && raw.taskPriority.targetGateWeights],
    ['taskPriority.rulesByTargetGate', raw.taskPriority && raw.taskPriority.rulesByTargetGate],
    ['taskAdmission.cooldownHoursByTargetGate', raw.taskAdmission && raw.taskAdmission.cooldownHoursByTargetGate],
    ['taskAdmission.maxQueuedByTargetGate', raw.taskAdmission && raw.taskAdmission.maxQueuedByTargetGate],
    ['taskAdmission.automaticAttemptLimitsByTargetGate', raw.taskAdmission && raw.taskAdmission.automaticAttemptLimitsByTargetGate],
    ['taskAdmission.mediaFreezeHoursByCompletedTargetGate', raw.taskAdmission && raw.taskAdmission.mediaFreezeHoursByCompletedTargetGate],
  ];
  for (const [prefix, values] of maps) {
    for (const key of Object.keys(values || {})) {
      if (!HELIX_TARGET_GATES.has(key)) paths.push(`${prefix}.${key}`);
    }
  }
  return paths;
}

function assertCleanConfig(raw = {}) {
  const violations = [];
  if (raw.helixSchemaVersion !== HELIX_SCHEMA_VERSION) violations.push('helixSchemaVersion');
  violations.push(...collectLegacyConfigPaths(raw));
  violations.push(...invalidTargetPaths(raw));
  for (const [index, subLibrary] of (raw.subLibraries || []).entries()) {
    if (!['auto', 'manual'].includes(subLibrary.libraryAutomationMode)) {
      violations.push(`subLibraries[${index}].libraryAutomationMode`);
    }
    if (!['auto', 'manual'].includes(subLibrary.maintenanceAutomationMode)) {
      violations.push(`subLibraries[${index}].maintenanceAutomationMode`);
    }
  }
  if (violations.length > 0) {
    throw new ConfigValidationError(
      'HELIX_CLEAN_INIT_REQUIRED',
      `Legacy or invalid Helix configuration detected: ${violations.join(', ')}`,
      { violations },
    );
  }
  return { ok: true, violations: [] };
}

function loadConfig() {
  ensureDataDir();
  const cfgFile = configFilePath();
  if (!fs.existsSync(cfgFile)) return getDefaultConfig();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  } catch (error) {
    throw new ConfigValidationError('HELIX_CLEAN_INIT_REQUIRED', `Invalid Helix config JSON: ${error.message}`);
  }
  assertCleanConfig(raw);
  return mergeConfigWithDefaults(raw);
}

function saveConfig(config, options = {}) {
  ensureDataDir();
  const canonical = canonicalUserConfig(config);
  assertCleanConfig(canonical);
  const merged = mergeConfigWithDefaults(canonical);
  if (options.skipMetadataGateValidation !== true) validateMetadataGateContracts(merged);
  fs.writeFileSync(configFilePath(), JSON.stringify(compactUserConfig(merged), null, 2), 'utf8');
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
  assertCleanConfig,
  compactUserConfig,
  getDefaultConfig,
  buildDefaultTemplate,
  buildAdultJavDefaultTemplate,
  buildAdultWesternDefaultTemplate,
  normalizeRuleTemplate,
  defaultSubLibraryAutomation,
  resolveSubLibraryAutomation,
  canonicalUserConfig,
};
