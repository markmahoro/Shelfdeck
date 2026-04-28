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

function getDefaultConfig() {
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
    transcodeTempRoot: '',
    transcodeReplaceConfirmRequired: false,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    transcodeEncodingDevices: [],
    transcodeMaxCpuSlots: 1,
    transcodeCpuParticipationStrategy: 'normal',

    // Upgrade (MoviePilot)
    moviepilot: {
      baseUrl: '',
      apiKey: '',
      savePath: '',
      stagingPath: '',
    },
    upgradeStagingLocalPath: '',
    upgradeRetryInterval: 3600000,
    upgradeMaxRetries: 3,

    // Emby multi-server
    embyServers: {},

    // SubLibraries
    subLibraries: [],

    // Douban
    douban: {
      userId: '',
      cookieHeader: '',
    },

    // MediaPolicy (global, deprecated — use subLibrary-level)
    mediaPolicy: {
      target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
      target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
    },

    // Service auth
    apiKey: '',
  };
}

function detectV1Config(raw) {
  // v1 had top-level `baseUrl` (Emby URL) without a non-empty `embyServers`
  const hasEmbyServers = raw.embyServers && Object.keys(raw.embyServers).length > 0;
  return !!(raw.baseUrl && !hasEmbyServers);
}

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

  // Build v2 config from v1 data
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
    transcodeMaxCpuSlots: 1,
    transcodeCpuParticipationStrategy: raw.transcodeCpuParticipationStrategy || 'normal',
    moviepilot: { baseUrl: '', apiKey: '', savePath: '', stagingPath: '' },
    upgradeStagingLocalPath: '',
    upgradeRetryInterval: (raw.upgradeRetryInterval || 3600) * 1000,
    upgradeMaxRetries: raw.upgradeMaxRetries || 3,
    embyServers,
    subLibraries: [],
    douban: { userId: '', cookieHeader: '' },
    mediaPolicy: raw.mediaPolicy || getDefaultConfig().mediaPolicy,
    // v1 serviceApiKey → v2 apiKey; explicitly clear old Emby apiKey
    apiKey: raw.serviceApiKey || '',
  };

  return v2;
}

function loadConfig() {
  ensureDataDir();
  const cfgFile = configFilePath();
  if (!fs.existsSync(cfgFile)) return getDefaultConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (detectV1Config(raw)) {
      console.log('[configStore] detected v1 config, migrating to v2 format');
      const migrated = migrateFromV1(raw);
      fs.writeFileSync(cfgFile + '.v1.backup', JSON.stringify(raw, null, 2), 'utf8');
      saveConfig(migrated);
      return { ...getDefaultConfig(), ...migrated };
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

module.exports = { loadConfig, saveConfig, patchConfig, getDefaultConfig };
