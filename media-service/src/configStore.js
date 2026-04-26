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

function loadConfig() {
  ensureDataDir();
  const cfgFile = configFilePath();
  if (!fs.existsSync(cfgFile)) return getDefaultConfig();
  try {
    const raw = fs.readFileSync(cfgFile, 'utf8');
    return { ...getDefaultConfig(), ...JSON.parse(raw) };
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
