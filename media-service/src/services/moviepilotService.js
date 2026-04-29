'use strict';

/**
 * MoviePilot REST API client.
 *
 * Auth: query param `?token=xxx` (confirmed working on test server).
 * Pattern follows embyService.js.
 */

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function buildUrl(mpConfig, relativePath, extraQuery = {}) {
  const base = normalizeBaseUrl(mpConfig.baseUrl);
  const u = new URL(relativePath.replace(/^\//, ''), `${base}/`);
  u.searchParams.set('token', (mpConfig.apiKey || '').trim());
  for (const [k, v] of Object.entries(extraQuery)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function mpFetchJson(mpConfig, relativePath, options = {}, extraQuery = {}) {
  const url = buildUrl(mpConfig, relativePath, extraQuery);
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MoviePilot request failed (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  return res.json();
}

// ── Exports ───────────────────────────────────────────────────────────────────

async function checkConnection(mpConfig) {
  // Use download/list as a lightweight health check (search might trigger real work)
  const res = await mpFetchJson(mpConfig, '/api/v1/download/');
  return { ok: Array.isArray(res), raw: res };
}

async function searchMediaByTitle(mpConfig, title) {
  return mpFetchJson(mpConfig, '/api/v1/media/search', {}, { title });
}

async function searchTorrents(mpConfig, keyword) {
  return mpFetchJson(mpConfig, '/api/v1/search/title', {}, { keyword });
}

async function addDownload(mpConfig, { torrentInfo, savePath }) {
  const body = { torrent_in: torrentInfo };
  if (savePath) body.save_path = savePath;
  const res = await mpFetchJson(mpConfig, '/api/v1/download/add', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res;
}

async function listDownloads(mpConfig) {
  return mpFetchJson(mpConfig, '/api/v1/download/');
}

async function deleteDownload(mpConfig, hashString) {
  const res = await mpFetchJson(mpConfig, `/api/v1/download/${hashString}`, {
    method: 'DELETE',
  });
  return res;
}

async function pauseDownload(mpConfig, hashString) {
  return mpFetchJson(mpConfig, `/api/v1/download/stop/${hashString}`);
}

async function resumeDownload(mpConfig, hashString) {
  return mpFetchJson(mpConfig, `/api/v1/download/start/${hashString}`);
}

// Get transfer history for scraping completion detection
async function getTransferHistory(mpConfig, count = 5) {
  return mpFetchJson(mpConfig, '/api/v1/history/transfer', {}, { count });
}

async function listSites(mpConfig) {
  return mpFetchJson(mpConfig, '/api/v1/site/');
}

const fs = require('fs');

module.exports = {
  checkConnection,
  searchMediaByTitle,
  searchTorrents,
  listSites,
  addDownload,
  listDownloads,
  deleteDownload,
  pauseDownload,
  resumeDownload,
  getTransferHistory,
  getHealth,
};

async function getHealth(config) {
  const subLibs = (config && config.subLibraries) || [];
  const smartSelectEnabled = subLibs.some((sl) => sl.upgradeSmartSelect && sl.upgradeSmartSelect.enabled);

  if (!smartSelectEnabled) {
    return { status: 'green', smartSelectEnabled: false };
  }

  const mp = config.moviepilot;
  if (!mp || !mp.baseUrl) {
    return { status: 'red', smartSelectEnabled: true, message: 'MoviePilot 未配置' };
  }

  let apiOk = false;
  let apiError = '';
  try {
    const r = await checkConnection(mp);
    apiOk = r.ok;
    if (!apiOk) apiError = 'API 返回异常';
  } catch (e) {
    apiError = e.message;
  }

  const stagingPath = (config.upgradeStagingLocalPath || '').trim();
  let pathOk = false;
  if (stagingPath) {
    try {
      pathOk = fs.existsSync(stagingPath);
      if (!pathOk) apiError = apiError || '暂存路径不可写';
    } catch (_) {
      apiError = apiError || '暂存路径不可写';
    }
  }

  if (!apiOk || !pathOk) {
    return { status: 'red', smartSelectEnabled: true, message: apiError || '暂存路径不可写' };
  }

  return { status: 'green', smartSelectEnabled: true };
}
