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
  aiDataRoot: process.platform === 'win32'
    ? path.join(process.env.TEMP || 'C:\\temp', 'shelfdeck-worker-ai')
    : '/data/ai',
  visionBaseUrl: '',
  visionModel: '',
  visionApiKey: '',
  visionTimeoutSec: 180,
  faceEmbeddingsUrl: '',
  faceApiKey: '',
  faceTimeoutSec: 120,
  faceSimilarityThreshold: 0.25,
  faceClusterThreshold: 0.5,
  sceneDetectThreshold: 0.3,
  visionMaxTokens: 512,
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
  if (process.env.WORKER_AI_DATA_ROOT) merged.aiDataRoot = process.env.WORKER_AI_DATA_ROOT;
  if (process.env.VISION_BASE_URL) merged.visionBaseUrl = process.env.VISION_BASE_URL;
  if (process.env.VISION_MODEL) merged.visionModel = process.env.VISION_MODEL;
  if (process.env.VISION_API_KEY) merged.visionApiKey = process.env.VISION_API_KEY;
  if (process.env.VISION_TIMEOUT_SEC) merged.visionTimeoutSec = parseInt(process.env.VISION_TIMEOUT_SEC, 10) || DEFAULTS.visionTimeoutSec;
  if (process.env.FACE_EMBEDDINGS_URL) merged.faceEmbeddingsUrl = process.env.FACE_EMBEDDINGS_URL;
  if (process.env.FACE_API_KEY) merged.faceApiKey = process.env.FACE_API_KEY;
  if (process.env.FACE_TIMEOUT_SEC) merged.faceTimeoutSec = parseInt(process.env.FACE_TIMEOUT_SEC, 10) || DEFAULTS.faceTimeoutSec;
  if (process.env.FACE_SIMILARITY_THRESHOLD) merged.faceSimilarityThreshold = Number(process.env.FACE_SIMILARITY_THRESHOLD) || DEFAULTS.faceSimilarityThreshold;
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
