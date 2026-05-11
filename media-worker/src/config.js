'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const os = require('os');

const DEFAULTS = {
  name: os.hostname() || 'ShelfDeck Worker',
  port: 19000,
  apiKey: '',
  tempRoot: process.platform === 'win32'
    ? path.join(process.env.TEMP || 'C:\\temp', 'shelfdeck-worker')
    : '/tmp/shelfdeck-worker',
  ffmpegPath: '',
  ffprobePath: '',
};

let cached = null;

function loadConfig() {
  if (cached) return cached;

  let file = {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    file = JSON.parse(raw);
  } catch (_) {
    // config.json not found, use defaults + env
  }

  const merged = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (file[k] !== undefined) merged[k] = file[k];
  }

  // Env overrides
  if (process.env.WORKER_NAME) merged.name = process.env.WORKER_NAME;
  if (process.env.WORKER_PORT) merged.port = parseInt(process.env.WORKER_PORT, 10) || DEFAULTS.port;
  if (process.env.WORKER_API_KEY) merged.apiKey = process.env.WORKER_API_KEY;
  if (process.env.WORKER_TEMP_ROOT) merged.tempRoot = process.env.WORKER_TEMP_ROOT;
  if (process.env.FFMPEG_PATH) merged.ffmpegPath = process.env.FFMPEG_PATH;
  if (process.env.FFPROBE_PATH) merged.ffprobePath = process.env.FFPROBE_PATH;

  if (!merged.apiKey) {
    console.warn('[worker] WARNING: apiKey not configured. Worker API is unprotected.');
  }

  cached = merged;
  return merged;
}

function saveConfig(patch) {
  const current = loadConfig();
  const merged = { ...current, ...patch };
  // Only persist keys that exist in DEFAULTS
  const toSave = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (merged[k] !== undefined) toSave[k] = merged[k];
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2) + '\n', 'utf8');
  cached = merged;
  return merged;
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH, DEFAULTS };
