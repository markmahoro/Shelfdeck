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

function DATA_DIR() {
  return resolveDataDir();
}

function CONFIG_FILE() {
  return path.join(DATA_DIR(), 'config.json');
}

function ensureDataDir() {
  const dir = DATA_DIR();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDefaultConfig() {
  return {
    embyClient: { baseUrl: '', apiKey: '', userId: '', embyUserPassword: '' },
    embyProfiles: {},
    baseUrl: '',
    apiKey: '',
    userId: '',
    embyUserPassword: '',
    enabledSectionIds: [],
    playerExePath: '',
    argsTemplate: '',
    pathMapFrom: '',
    pathMapTo: '',
    markPlayedThresholdPercent: 90,
    fallbackMinSeconds: 0,
    executionMode: 'manual',
    deleteConcurrency: 1,
    transcodeConcurrency: 1,
    upgradeConcurrency: 1,
    wallRatingAutoEnqueue: false,
    transcodeTempRoot: '',
    transcodeReplaceConfirmRequired: false,
    transcodeEncodePool: { entries: [], cpuParticipation: 'normal' },
    transcodeCpuParticipationStrategy: 'normal',
    upgradeRetryInterval: 3600,
    upgradeMaxRetries: 5,
    ffmpegPath: '',
    ffprobePath: '',
    mediaPolicy: {
      target1080p: { 2: 2, 3: 4, 4: 7, 5: 12 },
      target4k: { 2: 5, 3: 10, 4: 16, 5: 25 },
    },
    serviceApiKey: '',
    adminPin: '',
  };
}

function loadConfig() {
  ensureDataDir();
  const cfgFile = CONFIG_FILE();
  if (!fs.existsSync(cfgFile)) {
    return getDefaultConfig();
  }
  try {
    const raw = fs.readFileSync(cfgFile, 'utf8');
    const loaded = JSON.parse(raw);
    return { ...getDefaultConfig(), ...loaded };
  } catch (err) {
    console.error('Failed to load config:', err.message);
    return getDefaultConfig();
  }
}

function saveConfig(config) {
  ensureDataDir();
  const merged = { ...getDefaultConfig(), ...config };
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function patchConfig(updates) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  return saveConfig(merged);
}

module.exports = {
  loadConfig,
  saveConfig,
  patchConfig,
  getDefaultConfig,
};
