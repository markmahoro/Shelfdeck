'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getDefaultConfig() {
  return {
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
    transcodeEncodingDevices: [],
    transcodeCpuParticipationStrategy: 'normal',
    upgradeRetryInterval: 3600,
    upgradeMaxRetries: 5,
    ffmpegPath: '',
    ffprobePath: '',
  };
}

function loadConfig() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return getDefaultConfig();
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
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
