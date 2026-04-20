'use strict';

/**
 * SSOT: docs/design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md
 * 与 media-tray-supervisor/electron/shelfdeckConnection.js 保持一致。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const KEYS = {
  baseUrl: 'shelfdeck.mediaService.baseUrl',
  apiKey: 'shelfdeck.mediaService.apiKey',
};

function getConnectionFilePath() {
  if (process.platform === 'win32') {
    const root = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(root, 'ShelfDeck', 'connection.json');
  }
  return path.join(os.homedir(), '.config', 'ShelfDeck', 'connection.json');
}

function readConnectionFile() {
  const p = getConnectionFilePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return null;
  }
}

function stripSlash(u) {
  return String(u || '').replace(/\/+$/, '');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ viteBaseUrl?: string; viteApiKey?: string }} [opts]
 * @returns {{ baseUrl: string; apiKey: string; source: string }}
 */
function resolveEffectiveConnection(env, opts = {}) {
  const e = env || process.env;

  const envUrl = String(e.MEDIA_SERVICE_URL || e.CONTROL_PLANE_URL || '').trim();
  if (envUrl) {
    return {
      baseUrl: stripSlash(envUrl),
      apiKey: String(e.MEDIA_SERVICE_API_KEY || e.CONTROL_PLANE_API_KEY || '').trim(),
      source: 'env',
    };
  }

  const disk = readConnectionFile() || {};
  const diskUrl = typeof disk[KEYS.baseUrl] === 'string' ? stripSlash(disk[KEYS.baseUrl]) : '';
  if (diskUrl) {
    const envKey = String(e.MEDIA_SERVICE_API_KEY || e.CONTROL_PLANE_API_KEY || '').trim();
    const diskKey = typeof disk[KEYS.apiKey] === 'string' ? String(disk[KEYS.apiKey]) : '';
    return {
      baseUrl: diskUrl,
      apiKey: envKey || diskKey,
      source: 'file',
    };
  }

  const viteUrl = String(opts.viteBaseUrl || e.VITE_MEDIA_SERVICE_URL || e.VITE_CONTROL_PLANE_URL || '').trim();
  if (viteUrl) {
    return {
      baseUrl: stripSlash(viteUrl),
      apiKey: String(
        opts.viteApiKey || e.VITE_MEDIA_SERVICE_API_KEY || e.VITE_CONTROL_PLANE_API_KEY || '',
      ).trim(),
      source: 'vite',
    };
  }

  return {
    baseUrl: 'http://127.0.0.1:18080',
    apiKey: '',
    source: 'default',
  };
}

function hasPersistedOrEnvBaseUrl(env) {
  const e = env || process.env;
  if (String(e.MEDIA_SERVICE_URL || e.CONTROL_PLANE_URL || '').trim()) return true;
  const disk = readConnectionFile();
  return !!(disk && typeof disk[KEYS.baseUrl] === 'string' && stripSlash(disk[KEYS.baseUrl]));
}

module.exports = {
  KEYS,
  getConnectionFilePath,
  readConnectionFile,
  resolveEffectiveConnection,
  hasPersistedOrEnvBaseUrl,
  stripSlash,
};
